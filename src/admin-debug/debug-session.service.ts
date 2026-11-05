// V2026-11-05 治本 (WP58 · 引擎调试面板 · 调试会话服务):
//   职责: 给 admin 调试面板提供**真实跑引擎**的能力 —— 开一场调试会话 → 一轮一轮
//         发对话 → 每轮返回完整内部状态 (BDI 快照 / delta / 意图 / 渲染规格 /
//         prompt 全文 / 审议 trace).
//   边界: 只做「编排 + 组装」; 不做决策、不改内核、不落库.
//
//   三条硬纪律 (任务单 §3 / §5):
//     ① **调试会话不落库**: 状态只在内存 `Map` 里, 不写 `training_sessions`,
//        不写 `turn_debug_trace` —— 调试是 admin 临时跑的, 落库会污染学员的正式场次.
//     ② **不落库也不等于不记录**: 面板要看的每轮内部状态**只在 HTTP 响应里**,
//        拿完即弃. (prompt 全文同理 —— 见 `buildPromptFull` 的纪律说明.)
//     ③ **心理内容不进日志**: 本文件的日志只出定位信息 (会话 id / 轮次 / 耗时),
//        不打对话原文、不打 BDI 快照细节、不打审议 trace 内容.
//
//   为什么"复用 EngineTurnService"而不是自己调内核 (任务单 §3 D2):
//     门面已经包好了「open → 归属登记 → turn → close」与滚动摘要的释放;
//     调试器要做的只是**把每轮的内部状态摊开给人看**, 不是再造一套会话生命周期.
//     自己调内核端口 = 归属登记会漏 (审议 trace 的 key 就对不上了).
//
//   为什么走 `turnStream` 而不是聚合的 `turn` (任务单 §4.2 写的是 `turn`):
//     聚合路径**拿不到 prompt** —— 门面在聚合出口只传空真值给 `buildSpecSummary`,
//     于是 `promptPreview` 恒为 `''`、没有 `finishReason` / `ttftMs`.
//     任务单 §7.1 又明确要求"prompt 全文 (不只前 500 字)" —— 聚合路径给不了.
//     流式出口能拿到全部真值 (真值只在适配器里), 所以调试面板走流式.
//     ⚠️ 流式**不等于**改变了引擎行为: 两条路径共用同一套闭环
//     (内核决策 / 规格组装 / 落账), 只差"怎么把文本取回来".
//
//   审议 trace 为什么"等一会儿"再读 (WP64–WP68):
//     影子审议是 **BullMQ 异步**跑的 (入队 → Worker → LLM → 写 Redis trace),
//     单次审议 3–8s. turn 返回的那一刻 trace **通常还没写进去** ——
//     直接读必然读到 null, 面板上"审议 trace"那一栏永远是空的.
//     所以这里做**有界等待** (默认 5s, env 可调): 轮询 Redis, 写到了就返回.
//     超出等待窗口 → 返回 null (如实说"这一轮没拿到", 不编).
//     ⚠️ 第 1 轮**永远**没有审议 trace (门面首轮没有起始快照 → 跳过影子审议),
//        所以第 1 轮不等待 —— 白等 5s 什么也等不到.
//
//   反双胞胎:
//     - 不新造第 2 套 delta 口径: delta 用内核那一份 (`computeRuleDelta`),
//       与影子审议的 `ruleDelta` **逐字同源** (审议的对标基准就是它).
//     - 不自己算 BDI 快照: 快照是内核出参, 适配层只做**字段映射**.
//     - 不用 `TraceRecorder`: 留痕是给正式训练场次写库的, 调试数据不写库.
//     - 不把"取不到审议 trace"当成错误: 审议开关关着 / 熔断中 / 超时 都是常态,
//       返回 null 即可, 不该让整轮调试失败.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/wp58-debug-session.spec.ts 覆盖开关 / 角色解析 / delta /
//        审议 trace / 边界
//     3. git diff --stat HEAD -- src/engine-core 为空 (本单不动内核)

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { setTimeout as sleep } from 'node:timers/promises';

import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';
import {
  buildDeliberationTraceKey,
  computeRuleDelta,
  resolveDeliberationEnabled,
  type DeliberationTraceRecord,
} from '../engine-adapters/deliberation/llm-deliberation.service.js';
import {
  CHARACTER_PROFILE_RESOLVER,
  type CharacterProfileResolver,
  type ResolvedCharacter,
} from '../engine-adapters/wiring/character/character-profile.resolver.js';
import { EngineTurnService } from '../engine-adapters/wiring/engine-turn.service.js';
import type { BdiSnapshot, CharacterProfile, DeltaVector, Intention } from '../engine-core/index.js';
import { RedisService } from '../shared/infra/redis/redis.service.js';

/**
 * 调试会话的固定租户 id.
 *
 * 为什么固定成一个常量而不是每场随机: 审议 trace 的 Redis key 由
 * (tenantId, sessionId, turnIndex) 三件套拼成, 调试会话必须用**同一个**
 * tenantId 才能算出正确的 key —— 随机租户 = 每轮 key 都对不上.
 */
export const DEBUG_CHAT_TENANT_ID = 'debug';

/**
 * 调试会话的固定来访者 id.
 *
 * 同时也用作**审议侧的学员账号 id**: 影子审议要求 userId 非空
 * (否则审议层会跳过这一轮, 面板就看不到审议 trace 了).
 */
export const DEBUG_CHAT_VISITOR_ID = 'debug-admin';

/**
 * 调试会话 id 的前缀 —— 一眼能看出"这不是一场正式训练".
 */
export const DEBUG_CHAT_SESSION_ID_PREFIX = 'debug_';

/**
 * 读取审议 trace 的轮询间隔 (ms).
 */
export const DEBUG_CHAT_TRACE_POLL_INTERVAL_MS = 200;

/**
 * 等待审议 trace 的默认上限 (ms).
 *
 * 口径: 审议单次 3–8s (推理模型 thinking + 输出). 5s 能覆盖绝大多数轮次;
 * 超了就返回 null —— 面板显示"这一轮没拿到审议 trace", 而不是把请求挂死.
 */
export const DEFAULT_DEBUG_CHAT_DELIBERATION_WAIT_MS = 5000;

/**
 * 调试会话的内存状态.
 *
 * ⚠️ 进程内瞬时: 进程重启即失效 (调试场景可接受 —— 任务单 §3 D1).
 */
export interface DebugSessionState {
  /** 调试会话 id (也是内核的 sessionId —— 审议 trace 的 key 要用它). */
  readonly debugSessionId: string;
  /** 内核会话句柄 (运行时维度). */
  readonly handleId: string;
  /** 角色代号 (调试面板要显示). */
  readonly characterSlug: string;
  /** 角色展示名. */
  readonly characterLabel: string;
  /** 创建时刻 (ISO). */
  readonly createdAt: string;
  /** 上一轮结束时的快照 (算 delta 用; 第 1 轮没有). */
  lastSnapshot?: BdiSnapshot;
  /** 已跑的轮数 (观测用). */
  turnCount: number;
}

/**
 * 单轮 delta 的**前端投影** (admin-dashboard 的 `DeltaDetail` 契约).
 *
 * ⚠️ 它是 `DeltaVector` 的**投影**, 不是另一份真相:
 *   8 个数值维度逐个来自 `delta`, 只多一个 `events` (内核的逐事件明细不对外).
 */
export interface DebugDeltaDetail {
  readonly trust: number;
  readonly safety: number;
  readonly bond: number;
  readonly valence: number;
  readonly arousal: number;
  readonly verbal: number;
  readonly depth: number;
  readonly style: number;
  /**
   * 触发本轮变化的事件类型.
   *
   * ⚠️ 恒为空数组: 事件明细是内核内部产物, 适配层拿不到 ——
   *   与其编一个, 不如如实留空 (面板上标"内核未对外暴露").
   */
  readonly events: readonly string[];
}

/**
 * 单轮调试 trace (面板拿到的完整内部状态).
 *
 * 形状与 WP19-R 的留痕契约 (`TurnTrace`) **同源**, 另外多带调试专属的几块
 * (delta / 意图 / 审议 trace / prompt 全文).
 */
export interface DebugTurnTrace {
  /** 本轮序号 (内核累计轮次). */
  readonly turnIndex: number;
  /** 本场角色代号. */
  readonly characterSlug: string;
  /** 本轮 BDI 快照 (含同盟三维 + 阻抗三维). */
  readonly bdiSnapshot: {
    readonly trust: number;
    readonly safety: number;
    readonly bond: number;
    readonly valence: number;
    readonly arousal: number;
    /** 阻抗标量口径 = 话量阻抗 (与 WP19-R 留痕同款). */
    readonly resistance: number;
    readonly resistanceVerbal: number;
    readonly resistanceDepth: number;
    readonly resistanceStyle: number;
    /** 情绪标签 (内核按 valence × arousal 象限算的离散标签). */
    readonly anxiousSecure: string;
  };
  /** 本轮 delta (全量 11 维); 第 1 轮为 null (没有上一轮快照可比). */
  readonly delta: DeltaVector | null;
  /** 本轮 delta 的前端投影 (8 维 + events). */
  readonly deltaDetail: DebugDeltaDetail | null;
  /** 本轮意图 (内核派生输出; 未产出时省略). */
  readonly intention?: Intention;
  /** 本轮渲染规格 (含 prompt 全文). */
  readonly renderSpec: {
    readonly taskKind: string;
    readonly promptPreview: string;
    readonly promptFull: string;
    readonly maxCompletionTokens: number;
    readonly reasoningEffort: string;
  };
  /** 本轮模型用量. */
  readonly llmUsage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly reasoningTokens: number;
    readonly ttftMs: number;
    readonly finishReason: string;
  };
  /** 本轮危机判定. */
  readonly crisis: {
    readonly detected: boolean;
    readonly category: string | null;
  };
  /** 本轮审议 trace (从 Redis 读; 拿不到为 null). */
  readonly deliberationTrace: DeliberationTraceRecord | null;
  /** 本轮时刻 (ISO). */
  readonly ts: string;
}

/**
 * 创建调试会话的返回体.
 *
 * ⚠️ `sessionId` 与 `debugSessionId` 是**同一个值**的两个名字:
 *   前端 (`DebugChat.vue`) 读 `sessionId`; 任务单 §4.1 写的是 `debugSessionId`.
 *   两个都给 = 两套契约都能用, 但只有**一个**真相 (同一个字符串).
 */
export interface DebugSessionCreated {
  readonly sessionId: string;
  readonly debugSessionId: string;
  readonly characterSlug: string;
  readonly characterLabel: string;
  readonly createdAt: string;
}

/**
 * 调试面板开关解析 (env `ENGINE_DEBUG_CHAT_ENABLED`).
 *
 * 口径与 `resolveTraceEnabled` **同款** (显式配了按配的来; 没配则 dev 开 / prod 关):
 *   · 显式配了 → true/1/yes/on 开, false/0/no/off 关;
 *   · 没配 → 非生产环境开, 生产环境关 (fail-close).
 *
 * 为什么生产必须关: 这是**能真跑引擎**的写接口 —— 开着就等于让任何人
 * (只要有 admin 凭据) 反复烧 LLM 额度, 且调试会话会占住内核会话与记忆仓储.
 *
 * @param config 配置服务
 * @returns 调试接口是否开放
 */
export function resolveDebugChatEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('ENGINE_DEBUG_CHAT_ENABLED') ?? '').trim().toLowerCase();
  if (raw.length > 0) return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  const env = (config.get<string>('NODE_ENV') ?? '').trim().toLowerCase();
  return env !== 'production' && env !== 'prod';
}

/**
 * 等待审议 trace 的上限解析 (env `ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS`).
 *
 * 数值键读到的**一定是字符串** (ConfigService 不做类型转换), 必须自己解析.
 * 非法值 / 负数 → 回退默认 (填错一个 env 不该让服务起不来).
 *
 * @param config 配置服务
 * @returns 等待上限 (ms; 0 = 不等待)
 */
export function resolveDebugChatDeliberationWaitMs(config: ConfigService): number {
  const raw = (config.get<string>('ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS') ?? '').trim();
  if (raw.length === 0) return DEFAULT_DEBUG_CHAT_DELIBERATION_WAIT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DEBUG_CHAT_DELIBERATION_WAIT_MS;
  return Math.floor(parsed);
}

/**
 * 引擎调试会话服务 (WP58).
 */
@Injectable()
export class DebugSessionService {
  private readonly logger = new Logger(DebugSessionService.name);
  /** 调试会话表 (进程内; 进程重启即失效). */
  private readonly sessions = new Map<string, DebugSessionState>();
  /** 调试接口是否开放 (env `ENGINE_DEBUG_CHAT_ENABLED`). */
  private readonly enabled: boolean;
  /** 等待审议 trace 的上限 (ms). */
  private readonly deliberationWaitMs: number;
  /** 影子审议是否开着 (关着就不必等 —— 等也等不到). */
  private readonly deliberationEnabled: boolean;

  constructor(
    private readonly engine: EngineTurnService,
    @Inject(CHARACTER_PROFILE_RESOLVER) private readonly resolver: CharacterProfileResolver,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = resolveDebugChatEnabled(config);
    this.deliberationWaitMs = resolveDebugChatDeliberationWaitMs(config);
    this.deliberationEnabled = resolveDeliberationEnabled(config.get<string>('ENGINE_DELIBERATION_ENABLED'));
    if (!this.enabled) {
      this.logger.warn('[debug_chat] 调试面板接口关闭 (ENGINE_DEBUG_CHAT_ENABLED), 本次进程的调试写接口不可用');
    }
  }

  /**
   * 开一场调试会话.
   *
   * 角色解析失败 → 400 ("角色不存在"), **不**开一场中性会话:
   *   调试者要的就是"这个角色跑起来是什么样", 开错角色等于白跑一轮.
   *
   * @param characterSlug 角色代号 (从 `GET /admin/api/characters` 拿)
   * @returns 调试会话信息
   * @throws BizException 开关关闭 (403) / 角色代号为空 (400) / 角色不存在 (400)
   */
  async createSession(characterSlug: string | undefined): Promise<DebugSessionCreated> {
    this.assertEnabled();
    const slug = (characterSlug ?? '').trim();
    if (slug.length === 0) {
      throw new BizException(BizCode.InvalidParameter, '角色代号必填');
    }
    const resolved = await this.resolver.resolve({ templateId: slug });
    if (!resolved) {
      throw new BizException(BizCode.InvalidParameter, '角色不存在');
    }

    const debugSessionId = `${DEBUG_CHAT_SESSION_ID_PREFIX}${nanoid()}`;
    const opened = this.engine.open(
      {
        sessionId: debugSessionId,
        tenantId: DEBUG_CHAT_TENANT_ID,
        visitorId: DEBUG_CHAT_VISITOR_ID,
        characterProfile: resolved.characterProfile,
        ...(resolved.seed === undefined ? {} : { seed: resolved.seed }),
      },
      {
        characterLabel: resolved.displayName,
        // 审议侧要一个非空 userId (否则影子审议跳过这一轮 → 面板看不到审议 trace).
        userId: DEBUG_CHAT_VISITOR_ID,
        characterBrief: buildCharacterBrief(resolved),
      },
    );

    const createdAt = new Date().toISOString();
    this.sessions.set(debugSessionId, {
      debugSessionId,
      handleId: opened.handleId,
      characterSlug: slug,
      characterLabel: resolved.displayName,
      createdAt,
      turnCount: 0,
    });
    // 日志只出定位信息 (隐私红线): 会话 id + 角色代号, 不打角色基线内容.
    this.logger.log(`[debug_chat] 调试会话已开启 session=${debugSessionId} character=${slug}`);
    return {
      sessionId: debugSessionId,
      debugSessionId,
      characterSlug: slug,
      characterLabel: resolved.displayName,
      createdAt,
    };
  }

  /**
   * 发一轮对话 (跑引擎 + 组装调试 trace).
   *
   * @param debugSessionId 调试会话 id
   * @param counselorText 咨询师这一轮说的话
   * @returns 本轮来访口语 + 完整调试 trace
   * @throws BizException 开关关闭 (403) / 会话不存在 (404) / 输入为空 (400)
   */
  async runTurn(debugSessionId: string, counselorText: string): Promise<{ readonly reply: string; readonly trace: DebugTurnTrace }> {
    this.assertEnabled();
    const state = this.sessions.get(debugSessionId);
    if (!state) {
      throw new BizException(BizCode.ResourceNotFound, '调试会话不存在');
    }
    const text = (counselorText ?? '').trim();
    if (text.length === 0) {
      throw new BizException(BizCode.InvalidParameter, '咨询师输入不能为空');
    }

    const startedAt = Date.now();
    // 流式出口: 唯一能拿到 prompt 预览 / 全文 / TTFT / finishReason 的路径 (见文件头).
    // 增量回调面这里不需要 —— 完整文本由门面在返回体里给.
    const result = await this.engine.turnStream(state.handleId, { userText: text }, { onDelta: () => {} }, { includePromptFull: true });

    const delta = state.lastSnapshot ? computeRuleDelta(state.lastSnapshot, result.snapshot) : null;
    state.lastSnapshot = result.snapshot;
    state.turnCount += 1;

    const deliberationTrace = await this.readDeliberationTrace(debugSessionId, result.turnIndex);
    // 日志只出定位信息: 会话 id / 轮次 / 耗时. 不打对话原文, 不打快照细节.
    this.logger.log(`[debug_chat] 调试轮次完成 session=${debugSessionId} turn=${result.turnIndex} elapsedMs=${Date.now() - startedAt}`);

    return {
      reply: result.reply,
      trace: {
        turnIndex: result.turnIndex,
        characterSlug: state.characterSlug,
        bdiSnapshot: buildBdiSnapshot(result.snapshot),
        delta,
        deltaDetail: delta ? buildDeltaDetail(delta) : null,
        ...(result.intention ? { intention: result.intention } : {}),
        renderSpec: buildRenderSpec(result),
        llmUsage: buildLlmUsage(result),
        crisis: buildCrisisSummary(result.safety),
        deliberationTrace,
        ts: new Date().toISOString(),
      },
    };
  }

  /**
   * 关掉调试会话 (清内存 + 关内核句柄).
   *
   * @param debugSessionId 调试会话 id
   * @throws BizException 开关关闭 (403) / 会话不存在 (404)
   */
  closeSession(debugSessionId: string): void {
    this.assertEnabled();
    const state = this.sessions.get(debugSessionId);
    if (!state) {
      throw new BizException(BizCode.ResourceNotFound, '调试会话不存在');
    }
    // 先从表里摘掉: 关内核句柄即使抛错, 这场会话也不再是"活着的".
    this.sessions.delete(debugSessionId);
    try {
      this.engine.close(state.handleId);
    } catch (error) {
      // 关句柄失败只记 warn —— 内存已经清了, 不该让调用方以为"没关掉".
      this.logger.warn(`[debug_chat] 调试会话关闭内核句柄失败 session=${debugSessionId}: ${errorName(error)}`);
    }
    this.logger.log(`[debug_chat] 调试会话已关闭 session=${debugSessionId}`);
  }

  /** 当前调试会话数 (观测用). */
  size(): number {
    return this.sessions.size;
  }

  /**
   * 开关闸门 (关着 → 403).
   *
   * 为什么放在**服务层**而不是只在 controller:
   *   这是"这个能力开没开"的判断, 属于能力本身 —— 将来别的入口 (CLI / 测试)
   *   调这个服务时, 不该绕过开关.
   */
  private assertEnabled(): void {
    if (this.enabled) return;
    throw new BizException(BizCode.Forbidden, '引擎调试面板接口未启用');
  }

  /**
   * 读本轮的审议 trace (Redis); 拿不到返回 null.
   *
   * 有界等待的理由见文件头 —— 审议是异步的, 不等就必然读到 null.
   *
   * @param debugSessionId 调试会话 id (= 内核 sessionId)
   * @param turnIndex 本轮序号
   * @returns 审议 trace; 没有 / 等待超时 → null
   */
  private async readDeliberationTrace(debugSessionId: string, turnIndex: number): Promise<DeliberationTraceRecord | null> {
    // 第 1 轮没有审议 trace (门面首轮跳过影子审议) —— 别白等.
    if (turnIndex <= 1) return null;
    if (!this.deliberationEnabled) return null;
    if (this.deliberationWaitMs <= 0) return this.readTraceRecord(debugSessionId, turnIndex);

    const deadline = Date.now() + this.deliberationWaitMs;
    for (;;) {
      const record = await this.readTraceRecord(debugSessionId, turnIndex);
      if (record) return record;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await sleep(Math.min(DEBUG_CHAT_TRACE_POLL_INTERVAL_MS, remaining));
    }
  }

  /**
   * 读一条审议 trace (读不到 / 解析失败 → null).
   *
   * ⚠️ **不打原始内容** (隐私红线): `JSON.parse` 的报错文案里会带内容片段,
   *   所以这里只打错误**类型名**, 不打 message.
   */
  private async readTraceRecord(debugSessionId: string, turnIndex: number): Promise<DeliberationTraceRecord | null> {
    const key = buildDeliberationTraceKey(DEBUG_CHAT_TENANT_ID, debugSessionId, turnIndex);
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as DeliberationTraceRecord;
    } catch (error) {
      this.logger.warn(`[debug_chat] 审议 trace 读取失败 session=${debugSessionId} turn=${turnIndex} (${errorName(error)})`);
      return null;
    }
  }
}

/**
 * 内核快照 → 面板的 BDI 快照 (字段映射, 不重算).
 *
 * 口径说明:
 *   · `resistance` 标量 = **话量阻抗** (`resistance.verbal`) —— 与 WP19-R 留痕同款
 *     (调试器最先想看的是"这轮说了多少"); 三维原值另带 `resistance*` 三个字段;
 *   · `anxiousSecure` = 情绪标签 (内核按 valence × arousal 象限算的离散标签).
 *
 * @param snapshot 内核本轮快照
 * @returns 面板快照
 */
function buildBdiSnapshot(snapshot: BdiSnapshot): DebugTurnTrace['bdiSnapshot'] {
  return {
    trust: snapshot.trust,
    safety: snapshot.safety,
    bond: snapshot.bond,
    valence: snapshot.emotion.valence,
    arousal: snapshot.emotion.arousal,
    resistance: snapshot.resistance.verbal,
    resistanceVerbal: snapshot.resistance.verbal,
    resistanceDepth: snapshot.resistance.depth,
    resistanceStyle: snapshot.resistance.style,
    anxiousSecure: snapshot.emotion.label,
  };
}

/**
 * delta 向量 → 面板的 8 维投影.
 *
 * @param delta 本轮 delta (全量 11 维)
 * @returns 前端契约形状 (缺移情三维 —— 面板没那一栏)
 */
function buildDeltaDetail(delta: DeltaVector): DebugDeltaDetail {
  return {
    trust: delta.trust,
    safety: delta.safety,
    bond: delta.bond,
    valence: delta.valence,
    arousal: delta.arousal,
    verbal: delta.verbal,
    depth: delta.depth,
    style: delta.style,
    events: [],
  };
}

/**
 * 本轮渲染规格 (含 prompt 全文).
 *
 * @param result 本轮结算结果
 * @returns 渲染规格
 */
function buildRenderSpec(result: {
  readonly render: {
    readonly spec?: {
      readonly taskKind: string;
      readonly promptPreview: string;
      readonly maxCompletionTokens: number;
      readonly reasoningEffort: string;
    };
    readonly promptFull?: string;
  };
}): DebugTurnTrace['renderSpec'] {
  const spec = result.render.spec;
  return {
    taskKind: spec?.taskKind ?? 'unknown',
    promptPreview: spec?.promptPreview ?? '',
    promptFull: result.render.promptFull ?? '',
    maxCompletionTokens: spec?.maxCompletionTokens ?? 0,
    reasoningEffort: spec?.reasoningEffort ?? 'unknown',
  };
}

/**
 * 本轮模型用量.
 *
 * ⚠️ 输入侧用量在流式路径上**不可得** (上游只给累计 tokenCount) → 落 0,
 *   口径与 WP19-R 留痕一致 ("不可得" 与 "确实是 0" 分不开时, 不拿 0 冒充).
 *
 * @param result 本轮结算结果
 * @returns 用量
 */
function buildLlmUsage(result: {
  readonly render: {
    readonly usage?: { readonly promptTokens?: number; readonly completionTokens?: number; readonly reasoningTokens?: number };
    readonly ttftMs?: number;
    readonly finishReason?: string;
  };
}): DebugTurnTrace['llmUsage'] {
  const usage = result.render.usage;
  return {
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    ttftMs: result.render.ttftMs ?? 0,
    finishReason: result.render.finishReason ?? 'unknown',
  };
}

/**
 * 本轮危机判定.
 *
 * ⚠️ 口径: `safety` 存在 = 内核**判出了**非 pass (缺省 = pass, 不算危机).
 *   与 WP19-R 留痕同款 (`detected: safety !== undefined`).
 *
 * @param safety 本轮安全判定
 * @returns 危机判定
 */
function buildCrisisSummary(safety: { readonly categories?: readonly string[] } | undefined): DebugTurnTrace['crisis'] {
  return {
    detected: safety !== undefined,
    category: safety?.categories?.[0] ?? null,
  };
}

/**
 * 角色底色简述 (审议 prompt 的「角色背景」块).
 *
 * ⚠️ 这里只拼**结构性描述** (依恋风格 / 大五系数) —— 不带角色的核心信念内容
 *   (那是内核资产, 不该被抄进日志或 trace 的可读字段).
 *
 * @param resolved 角色解析结果
 * @returns 角色简述 (可能为空串)
 */
function buildCharacterBrief(resolved: ResolvedCharacter): string {
  const profile: CharacterProfile = resolved.characterProfile;
  const parts: string[] = [];
  if (profile.attachmentStyle) parts.push(`依恋风格: ${profile.attachmentStyle}`);
  const traits = profile.personalityTraits;
  if (traits) {
    const pairs: string[] = [];
    if (traits.openness !== undefined) pairs.push(`openness=${traits.openness}`);
    if (traits.conscientiousness !== undefined) pairs.push(`conscientiousness=${traits.conscientiousness}`);
    if (traits.extraversion !== undefined) pairs.push(`extraversion=${traits.extraversion}`);
    if (traits.agreeableness !== undefined) pairs.push(`agreeableness=${traits.agreeableness}`);
    if (traits.neuroticism !== undefined) pairs.push(`neuroticism=${traits.neuroticism}`);
    if (pairs.length > 0) parts.push(`大五人格: ${pairs.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * 错误类型名 (不取 message —— 隐私红线: 报错文案可能带内容片段).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
