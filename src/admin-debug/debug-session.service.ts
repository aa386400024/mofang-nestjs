// V2026-11-05 治本 (WP58 · 引擎调试面板 · 调试会话服务):
//   职责: 给 admin 调试面板提供**真实跑引擎**的能力 —— 开一场调试会话 → 一轮一轮
//         发对话 → 每轮返回完整内部状态 (BDI 快照 / delta / 意图 / 渲染规格 /
//         prompt 全文 / 审议 trace).
//   边界: 只做「编排 + 组装」; 不做决策、不改内核; 持久化落**文件**不落库.
//
//   V2026-11-05 扩展 (调试会话持久化):
//     引擎侧会话 (句柄 / BDI 状态) 仍然只在内存 —— 那是内核的运行时, 进程重启即失效.
//     但**对话过程**落 JSON 文件 (`DebugSessionStore`):
//       · 建会话时建档 (空会话文件);
//       · 每轮对话后**追加** (消息 + trace) —— 中途崩溃 / 进程重启不丢数据,
//         刷新页面就能看到跑了一半的会话;
//       · 关会话时标 `completed`;
//       · 第 3 轮后用 LLM 自动起标题 (失败兜底成创建时的「未命名会话 - 时间戳」).
//     为什么"每轮写"而不是"关会话时一次性写": 后者在崩溃时**全丢** ——
//     而调试面板最需要保留的恰恰是"崩之前那几轮" (那是复现问题的现场).
//     ⚠️ 文件含心理内容 (对话原文 + prompt 全文): 目录已在 `.gitignore` 里, 永不进版本库.
//
//   三条硬纪律 (任务单 §3 / §5):
//     ① **调试会话不落库**: 状态**不写** `training_sessions`, **不写**
//        `turn_debug_trace` —— 调试是 admin 临时跑的, 落正式表会污染学员的场次.
//        V2026-11-05 扩展: 改落 **JSON 文件** (`data/debug-sessions/{id}.json`),
//        刷新页面不丢数据 —— 但**仍然不写**那两张正式表 (扩展登记见交付记录 §偏差 B1).
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

import {
  buildDebugKernelState,
  buildDebugMemoryId,
  DEBUG_MEMORY_IMPORTANCE,
  DebugKernelStateRestorer,
  type DebugKernelMemory,
  type DebugKernelState,
} from './debug-kernel-state.js';
import {
  DebugSessionStore,
  type DebugSessionMessage,
  type DebugSessionRecord,
  type DebugSessionStatus,
  type DebugSessionSummary,
  type DebugSessionTitleSource,
} from './debug-session-store.js';
import {
  buildFallbackTitle,
  DEBUG_SESSION_TITLE_GENERATOR,
  type DebugSessionTitleGenerator,
  type DebugSessionTitleTurn,
} from './debug-session-title.generator.js';
import { labelCounselorEvent } from './event-tag-labels.js';
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
 * 跑满多少轮之后自动生成会话标题.
 *
 * 为什么是 3: 1 轮看不出这场在聊什么 (只有一句开场), 2 轮还太短;
 * 3 轮足够看出「来访者特征 + 话题」, 又不至于让面板空等太久.
 * 标题生成是**异步**的 (不阻塞那一轮的响应), 所以这个阈值只影响"什么时候开始生成".
 */
export const DEBUG_SESSION_TITLE_TRIGGER_TURN = 3;

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
  /**
   * BDI 状态版本号 (乐观锁 revision; 每轮 +1).
   *
   * V2026-11-06 (WP38 补做 · 调试会话恢复): 恢复时按它把快照写回状态仓储 ——
   *   引擎的乐观锁要求版本**单调递增**, 版本号本身没有业务含义,
   *   但必须大于仓储里已存的那份.
   */
  revision: number;
  /**
   * 已积累的内核记忆条目 (每轮追加; 恢复时按持久化快照重建).
   *
   * 它同时是"渲染上下文"的来源 —— 引擎写进记忆仓储的, 正是上一轮说过的话.
   */
  memories: DebugKernelMemory[];
}

/**
 * 会话列表的一行 = 落盘摘要 + **运行时活跃标记** (WP69).
 *
 * ⚠️ `active` 与落盘字段 `status` **不是一回事**, 别混:
 *   · `status` = 落盘时这场会话**被显式关过没有** ('active' | 'completed');
 *   · `active` = **当前进程**的内存里还有没有它的运行时状态 (内核句柄).
 *   进程重启后: 文件里的 status 仍可能是 'active', 但内存里已经没有它了 ——
 *   那时 `active` 才是"还能不能继续聊"的唯一真值.
 */
export interface DebugSessionListItem extends DebugSessionSummary {
  /** 这场会话在本进程内存里还有运行时状态 → 可继续发消息 (否则只能看历史). */
  readonly active: boolean;
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
   * 触发本轮变化的事件类型 (WP38 · 内核真值).
   *
   * V2026-11-06 治本: 此前恒为空数组, 注释写的是"事件明细是内核内部产物, 适配层拿不到".
   * WP38 给内核加了只读出口 (EngineTurnOutput.events), 这里终于能填**真值** ——
   * 那句"与其编一个, 不如如实留空"已经过期, 继续留着就是给下一个人的假话.
   *
   * 第 1 轮没有 delta 时整个 deltaDetail 为 null (与本字段无关).
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
  /**
   * 本轮咨询师事件分类 (WP38 · 内核真值, 数组形态).
   *
   * 内容 = 内核分类器算出的事件种类 (共情 / 接纳 / 开放提问 / 评判 / 越界等),
   * 已去重保序; 本轮无事件时为空数组.
   *
   * 边界: 只挂 kind, 不带命中词明细 (内核内部产物, 不对外) —— 面板要的是
   * "这一轮说了什么 techniques", 不是"命中了哪几个词".
   */
  readonly eventTags: readonly string[];
  /**
   * 与 eventTags **同序**的中文标签 (WP38).
   *
   * 为什么后端连标签一起给: 面板原本自带一份手写映射, 只有 6~8 个键 ——
   * 内核 11 类里缺 7 个、多 3 个 (那 3 个内核根本不产). 让前端自己补 = 又抄一份,
   * 迟早再漂. 映射的唯一真相在后端 (event-tag-labels.ts), 前端按序取用即可.
   */
  readonly eventTagLabels: readonly string[];
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
    /**
     * 本轮输入侧 token.
     *
     * V2026-11-10 治本 (WP-H · 改动 7): **null = 上游没报 (不可得)**, 不是 0.
     *   此前这里是必填数字, "没报"被填成 0 —— 于是"上游没报输入侧"与"输入侧确实是 0"
     *   分不开, 成本口径只能靠猜. 消费方按 `?? 0` 累加, 按 `> 0` 判断可得性.
     */
    readonly promptTokens: number | null;
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
  /** 本轮来访者侧是否走了渲染降级 (LLM 失败/超时回兜底句). */
  readonly degraded: boolean;
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
 * 恢复调试会话的返回体 (V2026-11-06 · WP38 补做).
 */
export interface DebugSessionResumed {
  /** 会话 id (= debugSessionId). */
  readonly sessionId: string;
  /** 会话 id (与 `sessionId` 同值; 两个名字都给 = 两套契约都能用). */
  readonly debugSessionId: string;
  /** 是否真的做了恢复 (false = 本进程里本来就活着 → 无需恢复). */
  readonly resumed: boolean;
  /** 恢复前这场是不是已经在跑 (true = 幂等命中, 没重复开内核句柄). */
  readonly alreadyActive: boolean;
  /** 恢复到的那一轮 (会话累计轮次). */
  readonly turnIndex: number;
  /** 这场会话累计跑了几轮. */
  readonly turnCount: number;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 角色展示名. */
  readonly characterLabel: string;
  /** 恢复了什么 (给面板显示"到底恢复了哪些东西"). */
  readonly restored: {
    /** BDI 快照是否回灌进了状态仓储 (false = 仓储里已有更新的状态, 原样保留). */
    readonly snapshot: boolean;
    /** 回灌的记忆条数. */
    readonly memories: number;
    /** 还原的渲染上下文档数 (引擎写进记忆仓储的, 正是上一轮说过的话). */
    readonly contextTurns: number;
    /** 是否带回了轨迹节点 (调试会话目前无剧本 → false). */
    readonly trajectory: boolean;
  };
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
    private readonly store: DebugSessionStore,
    @Inject(DEBUG_SESSION_TITLE_GENERATOR) private readonly titleGenerator: DebugSessionTitleGenerator,
    private readonly restorer: DebugKernelStateRestorer,
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
        // WP-J P1d: 依恋风格登记 —— 自动对练 / 调试面板都走这一条开场路径.
        //   不登记则渲染层拿不到 attachmentStyle, anxious 行为指引永远不渲染.
        ...(resolved.characterProfile.attachmentStyle === undefined ? {} : { attachmentStyle: resolved.characterProfile.attachmentStyle }),
        // WP-J P2: 台词指纹登记 —— 与依恋风格同一条开场路径.
        //   缺了这一步, 渲染层拿不到「你说话的味道」, 库里的文案等于白落.
        ...(resolved.verbalVoice === undefined ? {} : { verbalVoice: resolved.verbalVoice }),
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
      // 全新会话: 还没有任何内核状态 (第一轮跑完才有快照).
      revision: 0,
      memories: [],
    });
    // 建档 (V2026-11-05 持久化): 空会话文件先落下来 ——
    // 这样"刚开一场就跑崩了"也能在列表里看到这场会话存在过.
    // 落盘失败**不阻断**开会话 (引擎句柄已经开出来了, 那是更要紧的);
    // 只记 warn —— 调试工具不该因为磁盘问题就开不出会话.
    await this.persistCreate(debugSessionId, slug, resolved.displayName, createdAt);
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
    state.revision += 1;

    // 审议 trace 的 Redis key 用的是**内核轮次** (恢复后的会话里内核轮次从头算起,
    // 但审议侧写的也是内核轮次 —— 两边用同一个数, key 才对得上).
    const deliberationTrace = await this.readDeliberationTrace(debugSessionId, result.turnIndex);
    // 日志只出定位信息: 会话 id / 轮次 / 耗时. 不打对话原文, 不打快照细节.
    this.logger.log(`[debug_chat] 调试轮次完成 session=${debugSessionId} turn=${result.turnIndex} elapsedMs=${Date.now() - startedAt}`);

    // WP38: 事件分类 —— 内核出参原样取用 (适配层不预判); 空则空数组 (前端不用分支).
    const eventTags = result.events ?? [];

    // 面板显示的轮次 = **会话累计轮次** (不是内核轮次).
    //   为什么: 恢复出来的会话, 内核句柄是新的 → 内核轮次从头算起 (1,2,3...),
    //   但面板要回答"这是第几轮" —— 恢复后必须**接着上一轮往下数** (4,5,6...).
    //   全新会话时两者恒等 (都是 1,2,3...), 所以对老路径**逐字无影响**.
    const turnIndex = state.turnCount;

    // V2026-11-06 (WP38 补做 · 调试会话恢复): 本轮的内核状态快照 (BDI + 记忆 + 轨迹).
    //   每轮存一份, 恢复接口按它重建内核句柄 —— 这是"后端重启后还能继续调试"的底座.
    const turnMemories = buildTurnMemories(debugSessionId, turnIndex, text, result.reply, result.render.fallbackUsed);
    const kernelState = buildDebugKernelState({
      snapshot: result.snapshot,
      revision: state.revision,
      turnIndex,
      updatedAt: Date.now(),
      memories: [...state.memories, ...turnMemories],
      ...(result.trajectoryTrace ? { trajectoryTrace: result.trajectoryTrace } : {}),
    });
    state.memories = [...state.memories, ...turnMemories];

    const trace: DebugTurnTrace = {
      turnIndex,
      characterSlug: state.characterSlug,
      bdiSnapshot: buildBdiSnapshot(result.snapshot),
      delta,
      deltaDetail: delta ? buildDeltaDetail(delta, eventTags) : null,
      ...(result.intention ? { intention: result.intention } : {}),
      eventTags: [...eventTags],
      eventTagLabels: eventTags.map((kind) => labelCounselorEvent(kind)),
      renderSpec: buildRenderSpec(result),
      llmUsage: buildLlmUsage(result),
      crisis: buildCrisisSummary(result.safety),
      degraded: result.render.providerHint === 'degraded',
      deliberationTrace,
      ts: new Date().toISOString(),
    };

    // 追加落盘 (V2026-11-05 持久化): **每轮都写** —— 中途崩溃也不丢数据.
    // 落盘失败不阻断本轮 (引擎已经算完了, 响应要照常返回).
    const persisted = await this.persistTurn(debugSessionId, text, result.reply, trace, kernelState);
    // 跑满阈值 → 异步起标题 (不阻塞本轮响应).
    if (persisted && persisted.turnCount === DEBUG_SESSION_TITLE_TRIGGER_TURN) {
      void this.generateTitle(debugSessionId);
    }

    return { reply: result.reply, trace };
  }

  /**
   * 关掉调试会话 (清内存 + 关内核句柄 + 标记文件为已完成).
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
    // 标记文件为已完成 (V2026-11-05 持久化).
    // fire-and-forget: 关会话是同步接口, 不该为了一个文件标记去 await.
    void this.store.markCompleted(debugSessionId).catch((error: unknown) => {
      this.logger.warn(`[debug_chat] 调试会话落盘标记失败 session=${debugSessionId}: ${errorName(error)}`);
    });
    this.logger.log(`[debug_chat] 调试会话已关闭 session=${debugSessionId}`);
  }

  /**
   * 恢复一场调试会话 (后端重启后继续调试).
   *
   * V2026-11-06 (WP38 补做 · 调试会话恢复): 恢复 = 从**持久化的内核状态快照**重建内核句柄,
   *   恢复后能接着聊, 而且**从最后一轮的状态继续** (不是从头开始).
   *
   * 三步 (顺序不能换):
   *   ① 回灌内核状态 (BDI 快照 → 状态仓储; 记忆条目 → 记忆仓储) ——
   *      必须**先于**开会话: 内核在**第一轮**才去状态仓储取状态,
   *      回灌晚了, 第一轮就会用中性初始快照 (那等于"恢复失败但看不出来").
   *   ② 开内核句柄 (同一个 sessionId —— 状态仓储按 sessionId 取).
   *   ③ 还原渲染上下文 (上一轮说过什么) —— 否则第一轮发给模型的是空上下文.
   *
   * 失败一律**如实报错**: 快照缺失 / 角色没了 / 回灌失败 → 明确报错,
   *   绝不静默建一个中性新会话 (那会让调试者以为"恢复好了", 实际从头开始).
   *
   * @param debugSessionId 调试会话 id
   * @returns 恢复结果
   * @throws BizException 开关关闭 (403) / 会话不存在 (404) / 没有可恢复的快照 (400) / 角色不存在 (400)
   */
  async resumeSession(debugSessionId: string): Promise<DebugSessionResumed> {
    this.assertEnabled();
    const record = await this.store.get(debugSessionId);
    if (!record) {
      throw new BizException(BizCode.ResourceNotFound, '调试会话不存在');
    }
    // 本进程里还活着 → 不用恢复 (幂等: 前端手滑点两次也不会出错).
    if (this.sessions.has(debugSessionId)) {
      return {
        sessionId: debugSessionId,
        debugSessionId,
        resumed: false,
        alreadyActive: true,
        turnIndex: record.turnCount,
        turnCount: record.turnCount,
        characterSlug: record.characterSlug,
        characterLabel: record.characterLabel,
        restored: { snapshot: false, memories: 0, contextTurns: 0, trajectory: false },
      };
    }
    const kernelState = record.kernelState;
    if (!kernelState) {
      throw new BizException(BizCode.InvalidParameter, '该调试会话没有可恢复的内核状态快照 (可能还没跑过一轮)');
    }
    // 角色基线 (与建会话同一条路): 角色没了 → 恢复不了 (内核要角色基线起手).
    const resolved = await this.resolver.resolve({ templateId: record.characterSlug });
    if (!resolved) {
      throw new BizException(BizCode.InvalidParameter, '角色不存在, 无法恢复该调试会话');
    }
    // ① 回灌内核状态 (BDI 快照 + 记忆).
    let restoredSnapshot = false;
    let restoredMemories = 0;
    try {
      const outcome = await this.restorer.restoreBdiState(DEBUG_CHAT_TENANT_ID, debugSessionId, kernelState);
      restoredSnapshot = outcome === 'restored';
      restoredMemories = await this.restorer.restoreMemories(
        DEBUG_CHAT_TENANT_ID,
        DEBUG_CHAT_VISITOR_ID,
        debugSessionId,
        kernelState.memories,
      );
    } catch (error) {
      // 只记错误类型 (隐私红线: 报错文案可能带内容片段).
      this.logger.warn(`[debug_chat] 调试会话内核状态回灌失败 session=${debugSessionId}: ${errorName(error)}`);
      throw new BizException(BizCode.UnknownError, '调试会话恢复失败: 内核状态回灌异常');
    }
    // ② 开内核句柄 (同一个 sessionId —— 状态仓储按 sessionId 取).
    let handleId: string;
    try {
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
          userId: DEBUG_CHAT_VISITOR_ID,
          characterBrief: buildCharacterBrief(resolved),
          // WP-J P1d: 依恋风格登记 (恢复路径与新建路径同口径).
          ...(resolved.characterProfile.attachmentStyle === undefined
            ? {}
            : { attachmentStyle: resolved.characterProfile.attachmentStyle }),
          // WP-J P2: 台词指纹登记 (恢复路径与新建路径同口径).
          ...(resolved.verbalVoice === undefined ? {} : { verbalVoice: resolved.verbalVoice }),
        },
      );
      handleId = opened.handleId;
    } catch (error) {
      this.logger.warn(`[debug_chat] 调试会话恢复时开启内核句柄失败 session=${debugSessionId}: ${errorName(error)}`);
      throw new BizException(BizCode.UnknownError, '调试会话恢复失败: 内核会话开启异常');
    }
    // ③ 还原渲染上下文 (引擎写进记忆仓储的, 正是上一轮说过的话).
    const contextTurns = kernelState.memories.map((memory) => ({ role: memory.role, text: memory.content }));
    this.engine.restoreRenderContext(handleId, contextTurns);
    // 登记内存态 (下一轮从这里接着跑).
    this.sessions.set(debugSessionId, {
      debugSessionId,
      handleId,
      characterSlug: record.characterSlug,
      characterLabel: resolved.displayName,
      createdAt: record.createdAt,
      // 上一轮快照 → 下一轮的 delta 才有"与最后一轮比"的口径.
      lastSnapshot: kernelState.snapshot,
      turnCount: record.turnCount,
      revision: kernelState.revision,
      memories: [...kernelState.memories],
    });
    // 文件状态改回"进行中" (关过的会话恢复回来就是活的).
    // ⚠️ 这里**等它落定** (而不是 fire-and-forget): 恢复接口是异步的, 响应回去之前
    //   状态就该写好 —— 否则调用方紧接着读列表, 拿到的还是"已完成".
    //   写失败只记 warn (状态标记不该反过来把恢复搞失败).
    try {
      await this.store.markActive(debugSessionId);
    } catch (error) {
      this.logger.warn(`[debug_chat] 调试会话恢复后状态回写失败 session=${debugSessionId}: ${errorName(error)}`);
    }
    // 日志只出定位信息: 会话 id / 轮次 / 条数. 不打对话原文, 不打快照细节.
    this.logger.log(`[debug_chat] 调试会话已恢复 session=${debugSessionId} turn=${kernelState.turnIndex} memories=${restoredMemories}`);
    return {
      sessionId: debugSessionId,
      debugSessionId,
      resumed: true,
      alreadyActive: false,
      turnIndex: kernelState.turnIndex,
      turnCount: record.turnCount,
      characterSlug: record.characterSlug,
      characterLabel: resolved.displayName,
      restored: {
        snapshot: restoredSnapshot,
        memories: restoredMemories,
        contextTurns: contextTurns.length,
        trajectory: kernelState.trajectory !== null,
      },
    };
  }

  // ── 持久化会话的 CRUD (V2026-11-05) ──────────────────────────────

  /**
   * 列历史调试会话 (按创建时间倒序) + 运行时活跃标记.
   *
   * ⚠️ 与内存里的"活会话"是**两回事**: 这里列的是**落过盘**的会话,
   *   包括进程重启前跑过的那些 —— 那正是"刷新不丢数据"的兑现.
   *
   * V2026-11-06 (WP69 · 调试面板改进 1): 每行多带一个 `active` ——
   *   **这场会话在当前进程的内存里还有运行时状态** (内核句柄活着) → 可以继续发消息.
   *   没有它, 前端刷新页面后只能靠"这次是我新建的"来猜, 刷新即丢 ——
   *   一场**还活着**的会话会被误判成只读历史 (发消息按钮灰掉).
   *
   * @returns 会话摘要 + 活跃标记
   */
  async listPersistedSessions(): Promise<DebugSessionListItem[]> {
    const summaries = await this.store.list();
    return summaries.map((summary) => ({ ...summary, active: this.sessions.has(summary.id) }));
  }

  /**
   * 读一个历史调试会话的完整记录 (messages + traces).
   *
   * @param debugSessionId 调试会话 id
   * @returns 详情视图; 不存在 → 404
   * @throws BizException 会话不存在 (404)
   */
  async getPersistedSession(debugSessionId: string): Promise<DebugSessionDetail> {
    const record = await this.store.get(debugSessionId);
    if (!record) {
      throw new BizException(BizCode.ResourceNotFound, '调试会话不存在');
    }
    return projectDebugSessionDetail(record);
  }

  /**
   * 改会话标题 (人工改名).
   *
   * ⚠️ 人工改过的标题**不会再被自动命名覆盖** —— 覆盖规则在
   *   `DebugSessionStore.updateTitle` 里 (source='llm' 只能盖 'fallback').
   *
   * @param debugSessionId 调试会话 id
   * @param title 新标题
   * @returns 更新后的记录; 会话不存在 → 404
   * @throws BizException 标题为空 (400) / 会话不存在 (404)
   */
  async updatePersistedTitle(debugSessionId: string, title: string): Promise<DebugSessionRecord> {
    const trimmed = (title ?? '').trim();
    if (trimmed.length === 0) {
      throw new BizException(BizCode.InvalidParameter, '会话标题不能为空');
    }
    const record = await this.store.updateTitle(debugSessionId, trimmed, 'manual');
    if (!record) {
      throw new BizException(BizCode.ResourceNotFound, '调试会话不存在');
    }
    return record;
  }

  /**
   * 删除一个历史调试会话 (删文件).
   *
   * ⚠️ 与"关会话"是**两件事**:
   *   · 关会话 = `DELETE /debug/session/:id` → 释放引擎句柄 + 标记 completed;
   *   · 删会话 = `DELETE /debug/sessions/:id` → **删掉文件**, 这条历史彻底没了.
   *
   * @param debugSessionId 调试会话 id
   * @returns 确实删掉了 → true
   */
  async deletePersistedSession(debugSessionId: string): Promise<boolean> {
    return this.store.remove(debugSessionId);
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
   * 建档 (落盘).
   *
   * 失败**只记 warn**: 引擎句柄已经开出来了, 那是更要紧的东西 ——
   * 磁盘写不进去不该让"开会话"整个失败 (顶多是这次会话刷新后看不到).
   *
   * @param debugSessionId 调试会话 id
   * @param characterSlug 角色代号
   * @param characterLabel 角色展示名
   * @param createdAt 创建时刻 (ISO)
   */
  private async persistCreate(debugSessionId: string, characterSlug: string, characterLabel: string, createdAt: string): Promise<void> {
    try {
      await this.store.create({
        id: debugSessionId,
        // 兜底标题**建档时就写上** —— 列表里永远有一行能看, 不是空白.
        // LLM 标题 (第 3 轮后) 再覆盖它 (来源从 fallback 变 llm).
        title: buildFallbackTitle(createdAt),
        titleSource: 'fallback',
        characterSlug,
        characterLabel,
        createdAt,
        updatedAt: createdAt,
        status: 'active',
        turnCount: 0,
        messages: [],
        traces: [],
        // 内核快照: 建档时还没有 (第一轮跑完才有).
        kernelState: null,
      });
    } catch (error) {
      this.logger.warn(`[debug_chat] 调试会话建档失败 session=${debugSessionId}: ${errorName(error)}`);
    }
  }

  /**
   * 追加一轮到落盘记录.
   *
   * @param debugSessionId 调试会话 id
   * @param counselorText 咨询师这一轮说的话
   * @param visitorText 来访者这一轮的回应
   * @param trace 本轮调试 trace
   * @returns 更新后的记录; 落盘失败 / 文件不存在 → null
   */
  private async persistTurn(
    debugSessionId: string,
    counselorText: string,
    visitorText: string,
    trace: DebugTurnTrace,
    kernelState: DebugKernelState,
  ): Promise<DebugSessionRecord | null> {
    const ts = trace.ts;
    try {
      const counselor: DebugSessionMessage = { role: 'counselor', text: counselorText, turnIndex: trace.turnIndex, ts };
      const visitor: DebugSessionMessage = { role: 'visitor', text: visitorText, turnIndex: trace.turnIndex, ts };
      return await this.store.appendTurn(debugSessionId, counselor, visitor, trace, kernelState);
    } catch (error) {
      this.logger.warn(`[debug_chat] 调试轮次落盘失败 session=${debugSessionId} turn=${trace.turnIndex}: ${errorName(error)}`);
      return null;
    }
  }

  /**
   * 自动生成会话标题 (异步, 失败不抛).
   *
   * 为什么要**异步 fire-and-forget**: 标题是锦上添花, 不能让那一轮的 HTTP 响应
   * 等一次 LLM 调用 (3–8s). 失败就**保留兜底标题** (建档时已经写上了).
   *
   * ⚠️ **不覆盖人工改过的标题**: 覆盖规则在 `DebugSessionStore.updateTitle`
   *   (source='llm' 只能盖 'fallback').
   *
   * @param debugSessionId 调试会话 id
   */
  private async generateTitle(debugSessionId: string): Promise<void> {
    try {
      const record = await this.store.get(debugSessionId);
      if (!record) return;
      // 用户已手动改过标题 → 不生成, 更不覆盖.
      if (record.titleSource === 'manual') return;
      const turns = buildTitleTurns(record.messages);
      // 一句话都没说 → 没什么可概括的, 保留兜底标题.
      if (turns.length === 0) return;
      const title = (await this.titleGenerator.generate({ characterLabel: record.characterLabel, turns })).trim();
      // 生成器给不出可用标题 → 保留兜底标题 (不写空标题).
      if (title.length === 0) return;
      await this.store.updateTitle(debugSessionId, title, 'llm');
      this.logger.log(`[debug_chat] 调试会话标题已生成 session=${debugSessionId}`);
    } catch (error) {
      // 生成失败 → 兜底标题生效 (建档时已写). 只记 warn, 不打断任何东西.
      this.logger.warn(`[debug_chat] 调试会话标题生成失败 session=${debugSessionId}: ${errorName(error)}`);
    }
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
 * 构造本轮的内核记忆条目 (咨询师半边 + 来访者半边).
 *
 * 口径与引擎**逐字同源**:
 *   · 咨询师半边 —— 内核每轮都写一条工作记忆;
 *   · 来访者半边 —— 编排层写访客半边工作记忆, 但**降级轮不写**
 *     (兜底句不是来访者真说的话, 喂回模型等于教模型输出兜底话术).
 *
 * 同一份条目兼着"渲染上下文"的职责 —— 引擎写进记忆仓储的, 正是上一轮说过的话.
 * 两处口径若分叉, 恢复出来的会话就会"记忆里有、上下文里没有" (或反过来).
 *
 * @param sessionId 调试会话 id
 * @param turnIndex 轮次 (从 1 开始)
 * @param counselorText 咨询师这一轮说的话
 * @param visitorText 来访者这一轮的回应
 * @param degraded 本轮是否走了渲染降级 (降级 → 来访者半边不记)
 * @returns 本轮的记忆条目
 */
function buildTurnMemories(
  sessionId: string,
  turnIndex: number,
  counselorText: string,
  visitorText: string,
  degraded: boolean,
): DebugKernelMemory[] {
  const occurredAt = Date.now();
  const memories: DebugKernelMemory[] = [
    {
      id: buildDebugMemoryId(sessionId, turnIndex, 'counselor'),
      role: 'counselor',
      content: counselorText,
      occurredAt,
      importance: DEBUG_MEMORY_IMPORTANCE,
    },
  ];
  if (degraded) return memories;
  memories.push({
    id: buildDebugMemoryId(sessionId, turnIndex, 'visitor'),
    role: 'visitor',
    content: visitorText,
    occurredAt,
    importance: DEBUG_MEMORY_IMPORTANCE,
  });
  return memories;
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
 * @param events 本轮事件分类 (WP38 · 内核真值; 缺省 = 空数组)
 * @returns 前端契约形状 (缺移情三维 —— 面板没那一栏)
 */
function buildDeltaDetail(delta: DeltaVector, events: readonly string[] = []): DebugDeltaDetail {
  return {
    trust: delta.trust,
    safety: delta.safety,
    bond: delta.bond,
    valence: delta.valence,
    arousal: delta.arousal,
    verbal: delta.verbal,
    depth: delta.depth,
    style: delta.style,
    // WP38: 真实事件类型 (此前恒为空数组 —— 内核没出口, 现在有了).
    events: [...events],
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
    // V2026-11-10 (WP-H · 改动 7): 上游没报就落 null (不可得), 不写 0 冒充"输入侧免费".
    promptTokens: usage?.promptTokens ?? null,
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
 * 调试会话详情里的一条消息 (前端面板的形状).
 */
export interface DebugSessionDetailMessage {
  /** 谁说的. */
  readonly role: 'counselor' | 'visitor';
  /** 原文. */
  readonly text: string;
  /** 属于第几轮. */
  readonly turnIndex: number;
  /** 时刻 (ISO). */
  readonly ts: string;
  /**
   * 本轮的调试 trace.
   *
   * ⚠️ **只有来访者那条带 trace** —— 与前端"实时对话"里的形状**逐字一致**
   *   (咨询师发言不带 trace, 来访者回应带). 面板恢复历史时按同一个规则读,
   *   于是"实时跑"和"加载历史"两条路径渲染出**一样的**面板.
   *
   * ⚠️ 类型是 `unknown` (不是 `unknown | null`): `unknown` 已经涵盖 null ——
   *   写 `unknown | null` 等于把 null 抹平, 读的人就分不出"没有 trace"与"trace 是 null".
   *   这里的"没有"用 `null` 这个**值**表达 (咨询师那条恒为 null).
   */
  readonly trace: unknown;
}

/**
 * 调试会话详情视图.
 */
export interface DebugSessionDetail {
  readonly id: string;
  readonly title: string;
  readonly titleSource: DebugSessionTitleSource;
  readonly characterSlug: string;
  readonly characterLabel: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: DebugSessionStatus;
  readonly turnCount: number;
  /**
   * 能不能恢复 (V2026-11-06 · WP38 补做): 有内核状态快照 → 调 resume 能接着聊.
   */
  readonly resumable: boolean;
  readonly messages: readonly DebugSessionDetailMessage[];
}

/**
 * 落盘记录 → 详情视图 (把 trace 挂回对应的来访者消息).
 *
 * ⚠️ 为什么要**投影**而不是直接把落盘记录端出去:
 *   落盘格式把消息与 trace **分两个数组**存 (写侧按轮次追加, 分开存更好写);
 *   而面板要的是"消息自带 trace" (前端 `DebugChat.vue` 的实时路径就是这个形状).
 *   两种形状各有一份就会漂 —— 这里做**单向投影**, 面板那侧永远是消息自带 trace.
 *
 * @param record 落盘记录
 * @returns 详情视图
 */
export function projectDebugSessionDetail(record: DebugSessionRecord): DebugSessionDetail {
  // trace 按轮次号归位: 一轮一条 trace, 挂在该轮的**来访者**消息上.
  const traceByTurn = new Map<number, unknown>();
  for (const [index, trace] of record.traces.entries()) {
    const turnIndex = readTurnIndex(trace) ?? index + 1;
    traceByTurn.set(turnIndex, trace);
  }
  return {
    id: record.id,
    title: record.title,
    titleSource: record.titleSource,
    characterSlug: record.characterSlug,
    characterLabel: record.characterLabel,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    turnCount: record.turnCount,
    // 能不能恢复 = 有没有内核状态快照.
    resumable: record.kernelState !== null,
    messages: record.messages.map((message) => ({
      role: message.role,
      text: message.text,
      turnIndex: message.turnIndex,
      ts: message.ts,
      trace: message.role === 'visitor' ? (traceByTurn.get(message.turnIndex) ?? null) : null,
    })),
  };
}

/**
 * 从 trace 上读轮次号 (读不到 → null).
 */
function readTurnIndex(trace: unknown): number | null {
  if (!trace || typeof trace !== 'object') return null;
  const value = (trace as Record<string, unknown>)['turnIndex'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 错误类型名 (不取 message —— 隐私红线: 报错文案可能带内容片段).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * 落盘消息 → 标题生成用的轮次.
 *
 * 为什么**按轮次配对**而不是把消息平铺: 一轮是"咨询师问 + 来访者答"**一个不可拆的单位**.
 * 平铺给模型, 它看到的是一串交替的句子 —— 分不清哪句是问、哪句是答,
 * 起的标题就会跑偏 ("来访者一直在提问"这种).
 *
 * ⚠️ 只取**前 3 轮**: 标题要的是"这场在聊什么", 3 轮足够; 再多只是多烧 token
 *   (而且对话越长, 模型越容易抓不住重点).
 *
 * @param messages 落盘的消息序列 (咨询师 / 来访者交替)
 * @returns 轮次列表 (最多 3 轮)
 */
function buildTitleTurns(messages: readonly DebugSessionMessage[]): DebugSessionTitleTurn[] {
  const turns: DebugSessionTitleTurn[] = [];
  let counselor = '';
  for (const message of messages) {
    if (message.role === 'counselor') {
      counselor = message.text;
      continue;
    }
    turns.push({ counselorText: counselor, visitorText: message.text });
    counselor = '';
    if (turns.length >= DEBUG_SESSION_TITLE_TRIGGER_TURN) break;
  }
  // 有咨询师发言但没等到回应 (会话在这一轮中途断了) → 这一轮也拿去做标题.
  if (turns.length < DEBUG_SESSION_TITLE_TRIGGER_TURN && counselor.length > 0) {
    turns.push({ counselorText: counselor, visitorText: '' });
  }
  return turns;
}
