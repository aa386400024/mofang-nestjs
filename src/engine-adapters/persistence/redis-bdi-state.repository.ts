// V2026-11-05 治本 (WP32 · B 层 · BDI 状态 Redis 仓储):
//   职责: `BdiStateRepository` 端口的 **Redis 实现** —— BDI 状态快照落 Redis,
//         进程重启后跨会话恢复自动生效 (内核 `resumeFromSessionId` 已在调 `bdiStates.load()`).
//   边界: **B 层** (src/engine-adapters/), 触 Redis / 触网络 —— 不在 src/engine-core/ 内.
//         内核端口 (`BdiStateRepository` / `BdiStateRecord`) **一行未改** —— 本单只补实现.
//
//   为什么这一层是"加实现"而不是"改内核":
//     WP0 就把端口定好了 (乐观锁契约写在端口注释里), 适配层此前只有 `InMemoryBdiStateRepository`
//     一个实现 —— 进程重启 = 状态全丢 (内测每次重启都要从头开始).
//     端口就位 → 本期只补一个 Redis 实现, 内核零改动 (红线: `git diff --stat HEAD -- src/engine-core` 为空).
//
//   反双胞胎:
//     - **不直接依赖 ioredis 的类型** —— 声明窄面 `RedisBdiStateClient`
//       (get + compareAndSetByRevision 两个方法), 单测能用极小替身覆盖,
//       将来换 Redis 客户端只改这一个窄面 (与 `QdrantMemoryClient` 同一治本).
//     - **乐观锁用 Lua 原子 CAS, 不用"先 GET 再 SET"** —— 后者跨 `await` 有窗口:
//       两个并发写者都读到同一 revision 时, 后写者会**静默覆盖**先写者的状态且无法追溯.
//       内存版没有这个问题 (单线程 + 检查与写入之间没有 await), Redis 版必须用原子原语补上.
//     - **不在仓储里读 env** —— TTL 由适配层读好后注入 (同仓库其余 config 层的做法).
//     - **不提供 delete / list** —— 端口没定义, 实现不擅自扩大契约 (同内存版口径).
//     - **运行期不静默回落成内存版** —— Redis 不可达要抛 `STORAGE_FAILURE`.
//       "用哪个实现"是**部署形态**的决定 (env 显式选), 运行期悄悄回落 = 线上以为在持久化,
//       实际一条都没存 —— 仓库既有装配层铁律.
//     - **不把 TTL 做成"缓存过期"** —— 状态是会话级持久物, TTL 只负责清理**没人再续**的僵尸会话,
//       每次 save 都会续期 (在用的一场会话不会因为 TTL 到期而丢状态).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp32-bdi-state-persistence.spec.ts 覆盖存取往返 / 乐观锁冲突 /
//        参数校验 / 存储故障 / TTL / 租户隔离 / 与内存版口径一致 / 装配分流
//     3. ⚠️ Lua 脚本本体需**真 Redis** 才能验证 (本地无 Redis 时用替身复刻其语义) —— 见交付记录 §3.

import { Logger } from '@nestjs/common';

import {
  cloneBdiSnapshot,
  EngineCoreError,
  EngineErrorCode,
  type BdiSnapshot,
  type BdiStateRecord,
  type BdiStateRepository,
} from '../../engine-core/index.js';
import type { RedisService } from '../../shared/infra/redis/redis.service.js';

/**
 * Redis 版 BDI 状态的默认存活时长 (秒) —— 7 天.
 *
 * 口径: **自动清理没人再续的僵尸会话**. 一场还在进行的对练每轮都会 save → TTL 续期 →
 * 不会因为 7 天到了而丢状态; 只有"开完就再没回来"的会话才会在 7 天后被自动清掉.
 */
export const DEFAULT_BDI_STATE_REDIS_TTL_SECONDS = 604_800;

/** Redis key 的逻辑前缀 (ioredis 还会自动拼 `REDIS_KEY_PREFIX`, 多环境隔离靠它). */
const BDI_STATE_KEY_PREFIX = 'bdi';

/**
 * 乐观锁的原子 CAS 脚本 (Lua).
 *
 * 语义 (与内存版 `InMemoryBdiStateRepository.save` **同一口径**):
 *   - 键不存在 → 直接写入 (首次落库);
 *   - 已存 revision **>=** 传入 revision → 判定并发写冲突, **不写** (返回 0);
 *   - 否则写入并顺带续期 TTL (返回 1).
 *
 * 为什么必须放在 Redis 侧原子执行:
 *   "先 GET 再 SET"跨 `await` 有窗口 —— 两个并发写者都读到 revision=1 时, 两者都会通过检查,
 *   后写的那个会**静默覆盖**先写者的状态. 内存版靠"单线程 + 检查与写入之间没有 await"免疫,
 *   Redis 版没有这层保护, 只能靠原子原语.
 *
 * 为什么用 `cjson` 读已存 revision (而不是把 revision 拆成第二个 key):
 *   一个 key = 一份状态, 读写都只有一次往返; 拆两个 key 会让"payload 与 revision 不一致"
 *   这种半截状态**变得可能** (多 key 原子写要靠 Lua 同时操作两个 key, 复杂度不划算).
 *
 * 边界: 已存值**不是合法 JSON** 或没有数值型 revision → 视为"没有可比的已存版本",
 * 允许覆盖 (那份数据本来就不可用, 留着只会让这场会话永远写不进去 = 自我拒绝服务).
 */
export const BDI_STATE_CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' and type(decoded.revision) == 'number' then
    if decoded.revision >= tonumber(ARGV[1]) then
      return 0
    end
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

/**
 * B 层对 Redis 的**最小依赖面**.
 *
 * 为什么只留两个方法 (同 `QdrantMemoryClient` 的治本):
 *   - 单测能用极小替身覆盖, 不必伪造整个 RedisService;
 *   - 仓储层**不认识** ioredis, 将来换 Redis 客户端只影响这一个窄面;
 *   - CAS 做成**语义方法**而不是"给一段 Lua 让调用方自己拼" —— 乐观锁规则只有一份,
 *     调用方拿不到"忘了传 revision"这种用法.
 */
export interface RedisBdiStateClient {
  /** 读原始字符串 (未命中 = null). */
  get(key: string): Promise<string | null>;
  /**
   * 原子 compare-and-set (乐观锁).
   *
   * @param key 目标键
   * @param incomingRevision 传入的 revision (必须严格大于已存 revision 才写)
   * @param value 新值 (整条记录的 JSON)
   * @param ttlSeconds 存活时长 (秒)
   * @returns true = 已写入; false = 乐观锁冲突 (已存 revision >= incomingRevision)
   */
  compareAndSetByRevision(key: string, incomingRevision: number, value: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * 基于仓库既有 `RedisService` 的窄面实现.
 *
 * 为什么走 `getClient()` 而不是给 `RedisService` 加方法:
 *   - `RedisService` 是**全仓共用**的基础设施 —— 为引擎的乐观锁加一个专用方法,
 *     等于让基础设施认识"BDI 状态"这件事 (层次倒置);
 *   - `getClient()` 本来就是为"multi / pipeline / SCAN MATCH 这类特殊场景"开的口子,
 *     EVAL 正是其中之一;
 *   - ioredis 会给 EVAL 的 key 自动拼 `keyPrefix` (已实测: `eval(script, 1, key, ...)` → `mofang:bdi:...`),
 *     所以多环境隔离口径与其它 Redis 键**完全一致**, 不用手工拼前缀.
 */
export class RedisServiceBdiStateClient implements RedisBdiStateClient {
  constructor(private readonly redis: RedisService) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async compareAndSetByRevision(key: string, incomingRevision: number, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.getClient().eval(BDI_STATE_CAS_SCRIPT, 1, key, incomingRevision, value, ttlSeconds);
    // Lua 返回 1 = 写入, 0 = 冲突. 其它取值视为"没写进去" (保守方向: 不误报成功).
    return result === 1;
  }
}

/** Redis 版 BDI 状态仓储的构造选项. */
export interface RedisBdiStateRepositoryOptions {
  /** Redis 窄面客户端. */
  readonly client: RedisBdiStateClient;
  /** 存活时长 (秒; 缺省 = 7 天). */
  readonly ttlSeconds?: number;
}

/** 已存记录的形状 (JSON 反序列化后的校验对象). */
interface StoredBdiState {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly snapshot: BdiSnapshot;
}

/**
 * BDI 状态的 Redis 仓储 (内核 `BdiStateRepository` 端口的 Redis 实现).
 *
 * 与内存版的**同一口径** (逐条对齐):
 *   - load 未命中 → 返回 null (**不抛错**);
 *   - save 的 revision 必须严格大于已存 revision, 否则抛 `STATE_CONFLICT`;
 *   - save 的 tenantId / sessionId 为空、revision 非法 → 抛 `INVALID_INPUT`;
 *   - 存取两侧都做防御性拷贝 (JSON 往返天然隔离);
 *   - 不提供 delete / list (端口没定义).
 *
 * Redis 版**多**出来的两条 (内存版不可能遇到):
 *   - 底层存储不可达 / 读写失败 → `STORAGE_FAILURE` (WP26 · P2-18 定的依赖侧错误码);
 *   - 已存值形状非法 → `STORAGE_FAILURE` (数据被改写或撞键, 必须**响**, 不能当成"没有状态").
 */
export class RedisBdiStateRepository implements BdiStateRepository {
  private readonly client: RedisBdiStateClient;
  private readonly ttlSeconds: number;
  private readonly logger = new Logger(RedisBdiStateRepository.name);

  constructor(options: RedisBdiStateRepositoryOptions) {
    this.client = options.client;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_BDI_STATE_REDIS_TTL_SECONDS;
  }

  async load(tenantId: string, sessionId: string): Promise<BdiStateRecord | null> {
    const raw = await this.readRaw(this.buildKey(tenantId, sessionId), tenantId, sessionId);
    if (raw === null) return null;
    return this.parseRecord(raw, tenantId, sessionId);
  }

  async save(record: BdiStateRecord): Promise<BdiStateRecord> {
    this.assertValidRecord(record);
    const key = this.buildKey(record.tenantId, record.sessionId);
    const payload = this.serialize(record);

    let written: boolean;
    try {
      written = await this.client.compareAndSetByRevision(key, record.revision, payload, this.ttlSeconds);
    } catch (error) {
      throw new EngineCoreError(EngineErrorCode.STORAGE_FAILURE, `RedisBdiStateRepository.save: 写入 BDI 状态失败 (${messageOf(error)})`, {
        tenantId: record.tenantId,
        sessionId: record.sessionId,
      });
    }

    if (!written) {
      throw await this.buildConflictError(record);
    }
    return this.toDetachedCopy(record);
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 复合键: `bdi:{租户长度}:{租户}:{会话长度}:{会话}`.
   *
   * ⚠️ 与任务单 §3.1 给的 `bdi:{tenantId}:{sessionId}` **有一处刻意偏差**:
   *   任务单那版用 `:` 直接拼, (租户="a:b", 会话="c") 与 (租户="a", 会话="b:c") 会**撞键** ——
   *   撞键的后果是**跨租户串状态** (静默的隐私事故).
   *   内存版 `InMemoryBdiStateRepository.buildKey` 早就用长度前缀解决了同一问题,
   *   这里沿用**同一套复合键纪律**, 让两个实现对"什么算同一场会话"的判断**逐字一致**.
   *   长度前缀不影响可读性 (运维 `redis-cli --scan --pattern 'mofang:bdi:*'` 照常能看到租户与会话).
   */
  private buildKey(tenantId: string, sessionId: string): string {
    return `${BDI_STATE_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}`;
  }

  /** 参数校验 (与内存版同一口径: 空租户 / 空会话 / 非法 revision → INVALID_INPUT). */
  private assertValidRecord(record: BdiStateRecord): void {
    if (!record.tenantId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'RedisBdiStateRepository.save: tenantId 不能为空');
    }
    if (!record.sessionId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'RedisBdiStateRepository.save: sessionId 不能为空');
    }
    if (!Number.isInteger(record.revision) || record.revision < 1) {
      throw new EngineCoreError(
        EngineErrorCode.INVALID_INPUT,
        `RedisBdiStateRepository.save: revision 必须是 >= 1 的整数, 收到 ${record.revision}`,
        {
          tenantId: record.tenantId,
          sessionId: record.sessionId,
          revision: record.revision,
        },
      );
    }
  }

  /** 序列化整条记录 (快照走 `cloneBdiSnapshot` → 存进去的是**规范形状**, 不带调用方的多余字段). */
  private serialize(record: BdiStateRecord): string {
    return JSON.stringify({
      tenantId: record.tenantId,
      sessionId: record.sessionId,
      revision: record.revision,
      updatedAt: record.updatedAt,
      snapshot: cloneBdiSnapshot(record.snapshot),
    });
  }

  /** 反序列化 + 形状校验 + 归属校验. */
  private parseRecord(raw: string, tenantId: string, sessionId: string): BdiStateRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new EngineCoreError(
        EngineErrorCode.STORAGE_FAILURE,
        `RedisBdiStateRepository.load: 已存状态不是合法 JSON (${messageOf(error)})`,
        { tenantId, sessionId },
      );
    }
    if (!isStoredBdiState(parsed)) {
      throw new EngineCoreError(EngineErrorCode.STORAGE_FAILURE, 'RedisBdiStateRepository.load: 已存状态形状非法', {
        tenantId,
        sessionId,
      });
    }
    // 归属校验: 键是按 (租户, 会话) 拼出来的, 值里又存了一份同样的归属.
    //   两者对不上 = 撞键或数据被改写 —— **响**, 不能当成"没有状态" (那会让跨租户串状态变成静默的).
    if (parsed.tenantId !== tenantId || parsed.sessionId !== sessionId) {
      throw new EngineCoreError(
        EngineErrorCode.STORAGE_FAILURE,
        'RedisBdiStateRepository.load: 已存状态的归属与请求不一致 (撞键或数据被改写)',
        {
          tenantId,
          sessionId,
          storedTenantId: parsed.tenantId,
          storedSessionId: parsed.sessionId,
        },
      );
    }
    return {
      tenantId: parsed.tenantId,
      sessionId: parsed.sessionId,
      revision: parsed.revision,
      updatedAt: parsed.updatedAt,
      snapshot: parsed.snapshot,
    };
  }

  /** 读原始字符串 (未命中 = null; 底层不可达 → STORAGE_FAILURE). */
  private async readRaw(key: string, tenantId: string, sessionId: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      throw new EngineCoreError(EngineErrorCode.STORAGE_FAILURE, `RedisBdiStateRepository.load: 读取 BDI 状态失败 (${messageOf(error)})`, {
        tenantId,
        sessionId,
      });
    }
  }

  /**
   * 构造乐观锁冲突错误.
   *
   * 已存 revision 是**多读一次**拿的: 冲突是罕见路径, 多一次往返换错误细节里有
   * `storedRevision` (与内存版的错误细节**同款**, 排障时能直接看出"写到几了").
   * 取不到就算了 —— 不该因为"取不到已存版本"把"冲突"变成"存储故障".
   */
  private async buildConflictError(record: BdiStateRecord): Promise<EngineCoreError> {
    const stored = await this.loadQuietly(record.tenantId, record.sessionId);
    return new EngineCoreError(
      EngineErrorCode.STATE_CONFLICT,
      `RedisBdiStateRepository.save: revision 不单调递增 (incoming=${record.revision}, stored=${stored?.revision ?? 'unknown'})`,
      {
        tenantId: record.tenantId,
        sessionId: record.sessionId,
        incomingRevision: record.revision,
        storedRevision: stored?.revision,
      },
    );
  }

  /** 尽力读一次已存记录 (读不到就返回 null, 不抛错). */
  private async loadQuietly(tenantId: string, sessionId: string): Promise<BdiStateRecord | null> {
    try {
      const raw = await this.client.get(this.buildKey(tenantId, sessionId));
      if (raw === null) return null;
      return this.parseRecord(raw, tenantId, sessionId);
    } catch {
      this.logger.warn(`[BDI 状态] 取已存 revision 失败, 冲突错误里不填 storedRevision (tenant=${tenantId})`);
      return null;
    }
  }

  /** 防御性拷贝 —— 内部存一份、对外给一份 (与内存版同一口径). */
  private toDetachedCopy(record: BdiStateRecord): BdiStateRecord {
    return {
      tenantId: record.tenantId,
      sessionId: record.sessionId,
      revision: record.revision,
      updatedAt: record.updatedAt,
      snapshot: cloneBdiSnapshot(record.snapshot),
    };
  }
}

/** 已存记录是不是一个形状合法的 BDI 状态记录. */
function isStoredBdiState(value: unknown): value is StoredBdiState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredBdiState>;
  // 快照单独走 `unknown` 槽位: JSON 里 `{"snapshot": null}` 是**能解析出来**的,
  // 而 `typeof null === 'object'` —— 不显式挡掉 null, 一份坏数据会被当成合法快照放行.
  const snapshot: unknown = candidate.snapshot;
  return (
    typeof candidate.tenantId === 'string' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.revision === 'number' &&
    Number.isInteger(candidate.revision) &&
    typeof candidate.updatedAt === 'number' &&
    typeof snapshot === 'object' &&
    snapshot !== null
  );
}

/** 取错误信息 (跨 unknown 边界的安全取法). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
