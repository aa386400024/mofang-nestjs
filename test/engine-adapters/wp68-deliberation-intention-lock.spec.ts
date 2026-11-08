// V2026-11-05 治本 (WP68 · B 层 · 意图锁定机制 · PoC 组最后一单):
//   覆盖任务单 §5 的 13 条 + 若干防漂移用例:
//     ① 锁定状态判断 (5 例) —— 纯函数 `resolveIntentionLock` 的五个情况
//     ② intentionShift 校验 (3 例) —— 合法 / 非法策略名 / 空理由
//     ③ 配置 (2 例) —— 锁定轮数默认值 / 非法值回退
//     ④ 边界 (3 例) —— 开关关闭不跑锁定 / key 撞键防护 / 内核零改动
//   额外覆盖 (防漂移):
//     · 采纳后锁定期内**保持** (LLM 建议的切换不被"顶掉") —— 见交付记录 §2.2;
//     · 锁定期**不因"没有建议"而重置** (只切换才重新上锁);
//     · 锁定 0 轮 = 关掉锁定 (做对照实验用);
//     · trace 四个字段 (规则策略 / LLM 建议 / 锁定后实际 / 有没有被采纳);
//     · 失败轮次**不动**锁状态 (压根没有建议可判);
//     · prompt 带当前策略 + schema 列出 8 种合法策略 (模型猜不出英文名就建议不准);
//     · 编排门面只多传**一个**字段;
//     · 隐私: 锁定相关日志只出定位信息, 不出审议原文.
//
//   ⚠️ 关于"锁定逻辑放哪一层" (与任务单的出入, 见交付记录 §2.1):
//     任务单写 processor 算锁定、service 写 trace —— 但 trace 是 service 写的,
//     processor 算完再塞进去就得二次改写 Redis (竞态窗口). 已与大炮确认走 service 层.
//
//   边界: 全 mock, 不起 Nest 容器, 不发网络, 不连 Redis ——
//     RedisService / LLM service / ConfigService 全是极小替身.
//
//   验证: npx vitest run test/engine-adapters/wp68-deliberation-intention-lock.spec.ts

import type { ConfigService } from '@nestjs/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  buildDeliberationSchemaDescription,
  buildDeliberationUserPrompt,
} from '../../src/engine-adapters/deliberation/deliberation-prompt.js';
import {
  DELIBERATION_BEHAVIOR_STRATEGIES,
  isBehaviorStrategy,
  type DeliberationIntentionShift,
  type DeliberationOutput,
} from '../../src/engine-adapters/deliberation/deliberation-types.js';
import {
  DEFAULT_DELIBERATION_INTENTION_LOCK_ROUNDS,
  DELIBERATION_INTENTION_LOCK_KEY_PREFIX,
  LlmDeliberationService,
  buildDeliberationIntentionLockKey,
  buildDeliberationTraceKey,
  resolveIntentionLock,
  validateDeliberationOutput,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
  type IntentionLockState,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { createEmptyBdiSnapshot, type BehaviorStrategy, type BdiStateRepository, type DeltaVector } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

const TENANT = 'tenant-1';
const SESSION = 'session-1';
const USER = 'user-1';
const LOCK_ROUNDS = DEFAULT_DELIBERATION_INTENTION_LOCK_ROUNDS;

/** 规则算子这一轮的实际 delta (测试基准). */
const RULE_DELTA: DeltaVector = {
  trust: 0.05,
  safety: 0.02,
  bond: 0.01,
  valence: -0.01,
  arousal: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/** 造一份影子审议入参 (基准). */
function buildInput(overrides: Partial<DeliberationShadowInput> = {}): DeliberationShadowInput {
  return {
    sessionId: SESSION,
    tenantId: TENANT,
    userId: USER,
    turnIndex: 3,
    mode: 'freeform',
    baseSnapshot: createEmptyBdiSnapshot(),
    counselorText: '你最近睡得怎么样？',
    visitorText: '有点累，夜里老醒。',
    characterBrief: '依恋风格: 回避型',
    ruleDelta: RULE_DELTA,
    ruleStrategy: 'recounting',
    // WP65: 本轮审议对应的快照版本号 (切灰度时判断审议结果有没有过期).
    baseRevision: 1,
    ...overrides,
  };
}

/** 假 Redis (只实现锁定状态与 trace 用到的命令). */
class FakeRedis {
  readonly store = new Map<string, string>();
  readonly get = vi.fn(async (key: string): Promise<string | null> => this.store.get(key) ?? null);
  readonly set = vi.fn(async (key: string, value: string): Promise<void> => {
    this.store.set(key, value);
  });

  readonly del = vi.fn(async (key: string): Promise<number> => (this.store.delete(key) ? 1 : 0));

  /** V2026-11-07: service 写 trace 时同步累加统计计数器 (走 getClient().eval). */
  readonly getClient = () => ({ eval: vi.fn(async (): Promise<number> => 1) });

  /** 塞一份锁定状态. */
  seed(state: IntentionLockState, key = buildDeliberationIntentionLockKey(TENANT, SESSION)): void {
    this.store.set(key, JSON.stringify(state));
  }

  /** 读回锁定状态. */
  readLock(key = buildDeliberationIntentionLockKey(TENANT, SESSION)): IntentionLockState | null {
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as IntentionLockState);
  }

  /** 读回某一轮的 trace. */
  readTrace(turnIndex: number): DeliberationTraceRecord | null {
    const raw = this.store.get(buildDeliberationTraceKey(TENANT, SESSION, turnIndex));
    return raw === undefined ? null : (JSON.parse(raw) as DeliberationTraceRecord);
  }
}

/** 审议成功时的 client 返回体 (可带 intentionShift). */
function okResult(intentionShift: DeliberationIntentionShift | null = null): {
  ok: true;
  data: { output: DeliberationOutput; rejectedEntries: unknown[] };
  rawText: string;
  errorCode: null;
  errorMessage: null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
} {
  return {
    ok: true,
    data: {
      output: { deltas: [], summary: '来访情绪略有低落', confidence: 0.65, intentionShift },
      rejectedEntries: [],
    },
    rawText: '{}',
    errorCode: null,
    errorMessage: null,
    usage: { promptTokens: 1200, completionTokens: 180, totalTokens: 1380 },
  };
}

/** 装一个审议服务 (三个依赖全是极小替身). */
function buildService(options: { env?: Record<string, string>; requestJson?: ReturnType<typeof vi.fn>; redis?: FakeRedis }): {
  service: LlmDeliberationService;
  requestJson: ReturnType<typeof vi.fn>;
  redis: FakeRedis;
} {
  const env = options.env ?? {};
  const requestJson = options.requestJson ?? vi.fn();
  const redis = options.redis ?? new FakeRedis();
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  // ⚠️ V2026-11-07 起 service 还要**读** BDI 状态仓储 (过期判定) → 替身补上.
  //   读不到 = 保守兜底 (判没过期) —— 与"会话还没落库"同款分支.
  const bdiStates = { load: vi.fn(async () => null) } as unknown as BdiStateRepository;
  return {
    service: new LlmDeliberationService(llm, config, redis as unknown as RedisService, bdiStates),
    requestJson,
    redis,
  };
}

/** 一条 LLM 的切换建议 (测试基准). */
function shift(targetStrategy: BehaviorStrategy = 'insight'): DeliberationIntentionShift {
  return { targetStrategy, reason: '来访开始触及核心议题' };
}

/** 造一份锁定状态 (测试基准). */
function lockState(overrides: Partial<IntentionLockState> = {}): IntentionLockState {
  return {
    ruleStrategy: 'recounting',
    effectiveStrategy: 'recounting',
    lockedUntilRound: 5,
    roundIndex: 2,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('WP68 · 意图锁定机制 (基础版)', () => {
  describe('① 锁定状态判断 (5 例)', () => {
    it('①-1 没锁过 (第一轮) → 用规则算子的策略, 开始锁定', () => {
      const result = resolveIntentionLock(null, 'recounting', shift('insight'), LOCK_ROUNDS, 2);

      expect(result.effectiveStrategy).toBe('recounting');
      // 第一轮不采纳 LLM 的建议 —— 先把规则算子的意图锁住.
      expect(result.llmSuggestionAccepted).toBe(false);
      expect(result.newState).toEqual({
        ruleStrategy: 'recounting',
        effectiveStrategy: 'recounting',
        lockedUntilRound: 2 + LOCK_ROUNDS,
        roundIndex: 2,
      });
    });

    it('①-2 规则算子选的策略变了 → 重新锁定 (内核的切换优先于 LLM 的建议)', () => {
      const result = resolveIntentionLock(
        lockState({ ruleStrategy: 'recounting', effectiveStrategy: 'recounting' }),
        'resistance',
        shift('insight'),
        LOCK_ROUNDS,
        6,
      );

      expect(result.effectiveStrategy).toBe('resistance');
      expect(result.llmSuggestionAccepted).toBe(false);
      expect(result.newState.ruleStrategy).toBe('resistance');
      expect(result.newState.effectiveStrategy).toBe('resistance');
      expect(result.newState.lockedUntilRound).toBe(6 + LOCK_ROUNDS);
    });

    it('①-3 还在锁定期内 → 忽略 LLM 建议', () => {
      const result = resolveIntentionLock(lockState({ lockedUntilRound: 5 }), 'recounting', shift('insight'), LOCK_ROUNDS, 4);

      expect(result.effectiveStrategy).toBe('recounting');
      expect(result.llmSuggestionAccepted).toBe(false);
      // 锁定期**不重置** —— 还剩 1 轮就到期.
      expect(result.newState.lockedUntilRound).toBe(5);
      expect(result.newState.roundIndex).toBe(4);
    });

    it('①-4 锁定期过了 + LLM 有建议 → 采纳建议, 重新锁定', () => {
      const result = resolveIntentionLock(lockState({ lockedUntilRound: 5 }), 'recounting', shift('insight'), LOCK_ROUNDS, 5);

      expect(result.effectiveStrategy).toBe('insight');
      expect(result.llmSuggestionAccepted).toBe(true);
      expect(result.newState.effectiveStrategy).toBe('insight');
      expect(result.newState.ruleStrategy).toBe('recounting');
      expect(result.newState.lockedUntilRound).toBe(5 + LOCK_ROUNDS);
    });

    it('①-5 锁定期过了 + LLM 没建议 → 继续用当前策略', () => {
      const result = resolveIntentionLock(lockState({ lockedUntilRound: 5 }), 'recounting', null, LOCK_ROUNDS, 5);

      expect(result.effectiveStrategy).toBe('recounting');
      expect(result.llmSuggestionAccepted).toBe(false);
      // ⚠️ 不重新上锁: 只有**切换**才重新锁 3 轮 (任务单 §2 D3).
      expect(result.newState.lockedUntilRound).toBe(5);
    });
  });

  describe('② intentionShift 校验 (3 例)', () => {
    it('②-6 targetStrategy 合法 → 校验通过', () => {
      const validated = validateDeliberationOutput({
        deltas: [],
        summary: '来访开始触及核心议题',
        confidence: 0.7,
        intentionShift: { targetStrategy: 'insight', reason: '触及核心议题' },
      });

      expect(validated?.output.intentionShift).toEqual({
        targetStrategy: 'insight',
        reason: '触及核心议题',
      });
      expect(validated?.rejectedEntries).toHaveLength(0);
    });

    it('②-7 targetStrategy 非法 (不在内核 8 种里) → 校验失败, 丢掉', () => {
      const validated = validateDeliberationOutput({
        deltas: [],
        summary: 's',
        confidence: 0.7,
        intentionShift: { targetStrategy: 'catharsis', reason: '瞎编的策略' },
      });

      // 丢掉 → 当成"不建议切换"; 原始值留在 rejectedEntries 里 (证据不丢).
      expect(validated?.output.intentionShift).toBeNull();
      expect(validated?.rejectedEntries).toHaveLength(1);
      expect((validated?.rejectedEntries[0] as { targetStrategy: string }).targetStrategy).toBe('catharsis');
    });

    it('②-8 reason 为空字符串 → 校验失败, 丢掉', () => {
      const validated = validateDeliberationOutput({
        deltas: [],
        summary: 's',
        confidence: 0.7,
        intentionShift: { targetStrategy: 'insight', reason: ' '.repeat(3) },
      });

      expect(validated?.output.intentionShift).toBeNull();
      expect(validated?.rejectedEntries).toHaveLength(1);
    });

    it('②-9 缺省 intentionShift → null, 且**不算**被丢掉的条目', () => {
      const validated = validateDeliberationOutput({
        deltas: [],
        summary: 's',
        confidence: 0.7,
      });

      expect(validated?.output.intentionShift).toBeNull();
      expect(validated?.rejectedEntries).toHaveLength(0);
    });

    it('②-10 非法建议**不影响**整份输出的合法性 (一条非法建议不该让整轮白跑)', () => {
      const validated = validateDeliberationOutput({
        deltas: [{ dimension: 'trust', delta: 0.05, operatorTags: ['empathy'], reason: '共情回应' }],
        summary: 's',
        confidence: 0.7,
        intentionShift: { targetStrategy: 'not_a_strategy', reason: 'x' },
      });

      expect(validated).not.toBeNull();
      expect(validated?.output.deltas).toHaveLength(1);
      expect(validated?.output.intentionShift).toBeNull();
    });
  });

  describe('③ 配置 (2 例)', () => {
    it('③-11 ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS 默认 3', async () => {
      const redis = new FakeRedis();
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
        redis,
      });

      await service.executeShadowMode(buildInput({ turnIndex: 2 }));

      // 第一轮锁定 3 轮 → 锁到第 5 轮 (2 + 3).
      expect(redis.readLock()?.lockedUntilRound).toBe(2 + 3);
      expect(DEFAULT_DELIBERATION_INTENTION_LOCK_ROUNDS).toBe(3);
    });

    it('③-12 env 配非法值时回退默认 3, 不抛错', async () => {
      for (const value of ['abc', '-1', ' ']) {
        const redis = new FakeRedis();
        const { service } = buildService({
          env: { ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS: value },
          requestJson: vi.fn().mockResolvedValue(okResult()),
          redis,
        });

        await expect(service.executeShadowMode(buildInput({ turnIndex: 2 }))).resolves.toMatchObject({
          kind: 'ok',
        });
        expect(redis.readLock()?.lockedUntilRound, `env=${JSON.stringify(value)} 应回退默认 3`).toBe(2 + 3);
      }
    });

    it('③-13 env 配 0 = 关掉锁定机制 (对照实验用), 不是非法值', async () => {
      const redis = new FakeRedis();
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS: '0' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
        redis,
      });

      await service.executeShadowMode(buildInput({ turnIndex: 2 }));

      // 锁定 0 轮 → lockedUntilRound = 当前轮 → 下一轮就不锁了.
      expect(redis.readLock()?.lockedUntilRound).toBe(2);
    });
  });

  describe('④ 边界 (3 例)', () => {
    it('④-14 开关关闭时: 不跑意图锁定逻辑 (Redis 都不碰)', async () => {
      const redis = new FakeRedis();
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'false' },
        requestJson: vi.fn().mockResolvedValue(okResult()),
        redis,
      });

      const outcome = await service.executeShadowMode(buildInput());

      expect(outcome).toMatchObject({ kind: 'skipped' });
      expect(requestJson).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('④-15 Redis key 带租户与会话长度前缀 (撞键防护)', () => {
      const key = buildDeliberationIntentionLockKey('a:b', 'c');
      expect(key).toBe(`${DELIBERATION_INTENTION_LOCK_KEY_PREFIX}:3:a:b:1:c`);
      // 撞键对照: (租户="a:b", 会话="c") 与 (租户="a", 会话="b:c") 必须**不同** key.
      expect(buildDeliberationIntentionLockKey('a:b', 'c')).not.toBe(buildDeliberationIntentionLockKey('a', 'b:c'));
    });

    it('④-16 内核树里零审议**实现** (R9: 内核只留一个**纯类型端口**, 实现全在适配层)', () => {
      const kernelRoot = path.join(__dirname, '../../src/engine-core');
      const hits: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.endsWith('.ts')) continue;
          if (readFileSync(full, 'utf8').toLowerCase().includes('deliberat')) {
            hits.push(path.relative(kernelRoot, full).replaceAll('\\', '/'));
          }
        }
      };
      walk(kernelRoot);

      // ⚠️ V2026-11-08 (R9) 治本: 这条断言从「整棵内核树不含 deliberat」**收紧**为
      //   「只含下面这三处, 且这三处是**纯类型**的」.
      //   为什么改: R9 要让审议建议**真的生效**, 就必须在内核留一道「落库前改 delta」的口子 ——
      //   适配层拿到的是落库**之后**的快照, 事后改快照会破坏「一轮一次落库」的
      //   不变量 (版本号跳两跳, 乐观锁语义变味). 所以内核新增一个**纯类型端口**.
      //   ⚠️ 这不是放宽: 白名单**显式且最小** (多一处即红), 且下面追加了三条**更严**的断言
      //     (端口零实现 / 端口零外部引用 / 白名单恰好三处).
      const allowed = new Set([
        'runtime/deliberation-hook.port.ts', // 纯类型端口 (零实现)
        'in-memory/in-memory-engine-session.ts', // 调用端口的那一行
        'index.ts', // 端口类型的 barrel 再导出
      ]);
      expect(hits.filter((file) => !allowed.has(file))).toEqual([]);

      // 端口必须是**纯类型契约**: 零 class / 零 function / 零 const (只有形状, 没有实现).
      const portSource = readFileSync(path.join(kernelRoot, 'runtime/deliberation-hook.port.ts'), 'utf8');
      expect(/export\s+(class|function|const)\b/.test(portSource)).toBe(false);
      // 端口**不得**引用适配层 / 框架 (审议的实现必须留在适配层).
      expect(portSource).not.toMatch(/from\s+['"][^'"]*(engine-adapters|@nestjs|typeorm)/);
      // 白名单里的三处必须**都**在 (少一处 = 内核里还留着别处的审议痕迹, 或端口被删了).
      expect([...allowed].filter((file) => hits.includes(file)).sort()).toEqual([...allowed].sort());
    });
  });

  describe('⑤ 端到端: 锁定真的会拦住"乱改意图"', () => {
    it('⑤-17 锁定期内的建议被拦住, 到期后放行', async () => {
      const redis = new FakeRedis();
      const requestJson = vi.fn(async () => okResult(shift('insight')));
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson,
        redis,
      });

      // 第 2 轮: 第一次审议 → 建立锁定 (锁到第 5 轮).
      await service.executeShadowMode(buildInput({ turnIndex: 2 }));
      expect(redis.readTrace(2)?.llmIntentionAccepted).toBe(false);
      expect(redis.readTrace(2)?.lockedStrategy).toBe('recounting');

      // 第 3 轮: 还在锁定期内 → 建议被拦住.
      await service.executeShadowMode(buildInput({ turnIndex: 3 }));
      expect(redis.readTrace(3)?.llmIntentionShift?.targetStrategy).toBe('insight');
      expect(redis.readTrace(3)?.llmIntentionAccepted).toBe(false);
      expect(redis.readTrace(3)?.lockedStrategy).toBe('recounting');

      // 第 4 轮: 仍在锁定期内.
      await service.executeShadowMode(buildInput({ turnIndex: 4 }));
      expect(redis.readTrace(4)?.llmIntentionAccepted).toBe(false);

      // 第 5 轮: 锁定期过了 → 建议被采纳.
      await service.executeShadowMode(buildInput({ turnIndex: 5 }));
      expect(redis.readTrace(5)?.llmIntentionAccepted).toBe(true);
      expect(redis.readTrace(5)?.lockedStrategy).toBe('insight');
    });

    it('⑤-18 采纳之后, 锁定期内**保持** LLM 建议的策略 (不被规则策略顶掉)', async () => {
      const redis = new FakeRedis();
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn(async () => okResult(shift('insight'))),
        redis,
      });

      // 第 2 轮: 第一次审议 → 建立锁定 (锁到第 5 轮).
      await service.executeShadowMode(buildInput({ turnIndex: 2 }));

      // 第 5 轮: 锁定期外 → 采纳 'insight', 重新锁到第 8 轮.
      await service.executeShadowMode(buildInput({ turnIndex: 5 }));
      expect(redis.readTrace(5)?.llmIntentionAccepted).toBe(true);
      expect(redis.readTrace(5)?.lockedStrategy).toBe('insight');

      // 第 6 轮: 在新的锁定期内 → 有效策略**仍然是** 'insight' (建议被拦住, 但已采纳的不回滚).
      await service.executeShadowMode(buildInput({ turnIndex: 6 }));
      expect(redis.readTrace(6)?.llmIntentionAccepted).toBe(false);
      expect(redis.readTrace(6)?.lockedStrategy).toBe('insight');
      expect(redis.readTrace(6)?.ruleStrategy).toBe('recounting');
    });

    it('⑤-19 规则算子换了意图 → 重新锁定 (内核的切换优先)', async () => {
      const redis = new FakeRedis();
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn(async () => okResult(shift('insight'))),
        redis,
      });

      await service.executeShadowMode(buildInput({ turnIndex: 2 }));
      // 第 3 轮: 规则算子换成了 'resistance' → 重新锁定, LLM 的建议不算数.
      await service.executeShadowMode(buildInput({ turnIndex: 3, ruleStrategy: 'resistance' }));

      const trace = redis.readTrace(3);
      expect(trace?.ruleStrategy).toBe('resistance');
      expect(trace?.lockedStrategy).toBe('resistance');
      expect(trace?.llmIntentionAccepted).toBe(false);
      expect(redis.readLock()?.lockedUntilRound).toBe(3 + LOCK_ROUNDS);
    });

    it('⑤-20 没有建议时, 锁定期**不重置** (只切换才重新上锁)', async () => {
      const redis = new FakeRedis();
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn(async () => okResult(null)),
        redis,
      });

      await service.executeShadowMode(buildInput({ turnIndex: 2 }));
      expect(redis.readLock()?.lockedUntilRound).toBe(2 + LOCK_ROUNDS);

      await service.executeShadowMode(buildInput({ turnIndex: 3 }));
      expect(redis.readLock()?.lockedUntilRound).toBe(2 + LOCK_ROUNDS);
      expect(redis.readTrace(3)?.llmIntentionShift).toBeNull();
      expect(redis.readTrace(3)?.llmIntentionAccepted).toBe(false);
    });

    it('⑤-21 失败轮次**不动**锁状态 (压根没有建议可判)', async () => {
      const redis = new FakeRedis();
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue({
          ok: false,
          data: null,
          rawText: '',
          errorCode: 'fetch_error',
          errorMessage: 'boom',
          usage: null,
        }),
        redis,
      });

      await service.executeShadowMode(buildInput({ turnIndex: 2 }));

      expect(redis.readLock()).toBeNull();
      // trace 形状仍然一致 (消费方不用判分支).
      const trace = redis.readTrace(2);
      expect(trace?.ruleStrategy).toBe('recounting');
      expect(trace?.llmIntentionShift).toBeNull();
      expect(trace?.lockedStrategy).toBe('recounting');
      expect(trace?.llmIntentionAccepted).toBe(false);
    });

    it('⑤-22 锁状态读写坏掉 → 当"没锁过", 不让一个坏 key 永久卡住会话', async () => {
      const redis = new FakeRedis();
      redis.store.set(buildDeliberationIntentionLockKey(TENANT, SESSION), '{ 这不是 JSON');
      const { service } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue(okResult(null)),
        redis,
      });

      await expect(service.executeShadowMode(buildInput({ turnIndex: 2 }))).resolves.toMatchObject({
        kind: 'ok',
      });
      expect(redis.readLock()?.lockedUntilRound).toBe(2 + LOCK_ROUNDS);
    });
  });

  describe('⑥ 防漂移 (策略枚举 / prompt / 门面 / 隐私)', () => {
    it('⑥-23 策略枚举与内核的 8 种**逐字一致**, 且不多不少', () => {
      expect(DELIBERATION_BEHAVIOR_STRATEGIES).toHaveLength(8);
      expect([...DELIBERATION_BEHAVIOR_STRATEGIES].sort()).toEqual(
        [
          'affective_exploration',
          'cognitive_exploration',
          'discussing_plans',
          'insight',
          'recounting',
          'request',
          'resistance',
          'simple_response',
        ].sort(),
      );
      for (const strategy of DELIBERATION_BEHAVIOR_STRATEGIES) {
        expect(isBehaviorStrategy(strategy)).toBe(true);
      }
      expect(isBehaviorStrategy('catharsis')).toBe(false);
      expect(isBehaviorStrategy('')).toBe(false);
    });

    it('⑥-24 prompt 里有"当前行为策略" —— 模型不知道现在用啥就建议不准', () => {
      const prompt = buildDeliberationUserPrompt({
        currentSnapshotJson: '{}',
        counselorText: '你在想什么？',
        visitorText: '说不上来。',
        characterBrief: '回避型',
        turnIndex: 7,
        ruleStrategy: 'affective_exploration',
      });

      expect(prompt).toContain('【当前行为策略】');
      expect(prompt).toContain('affective_exploration');
      // 英文名在前 (模型要原样输出英文名), 中文在后帮它理解.
      expect(prompt).toContain('affective_exploration（情感探索）');
    });

    it('⑥-25 schema 描述里写了 intentionShift 的写法 + 8 种合法策略', () => {
      const schema = buildDeliberationSchemaDescription();

      expect(schema).toContain('intentionShift');
      expect(schema).toContain('targetStrategy');
      for (const strategy of DELIBERATION_BEHAVIOR_STRATEGIES) {
        expect(schema).toContain(strategy);
      }
    });

    it('⑥-26 编排门面只多传一个字段: 门面只认端口, 不知道锁定的存在', () => {
      const facade = readFileSync(path.join(__dirname, '../../src/engine-adapters/rendering/turn-render-orchestrator.ts'), 'utf8');

      // 门面**不**做锁定判定, 也不 import 锁定相关的任何东西.
      expect(facade).toContain('ruleStrategy');
      expect(facade).not.toContain('resolveIntentionLock');
      expect(facade).not.toContain('IntentionLockState');
      expect(facade).not.toContain('IntentionLock');
    });

    it('⑥-27 隐私红线: 锁定相关的日志只出定位信息, 不出审议原文', () => {
      const service = readFileSync(path.join(__dirname, '../../src/engine-adapters/deliberation/llm-deliberation.service.ts'), 'utf8');

      // 锁定状态读写失败时的日志里**不许**出现审议原文 (counselorText / visitorText / reason).
      const lockLogs = service
        .split('\n')
        .filter((line) => line.includes('deliberation_intention_lock]'))
        .join('\n');
      expect(lockLogs).not.toContain('counselorText');
      expect(lockLogs).not.toContain('visitorText');
      expect(lockLogs).not.toContain('reason');
    });
  });
});
