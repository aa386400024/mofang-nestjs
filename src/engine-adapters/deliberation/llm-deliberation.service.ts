// V2026-11-05 治本 (WP64 · B 层 · LLM 审议层 PoC · 影子模式):
//   职责: 跑一次 LLM 审议 —— 组装 WP63 的三个 prompt 零件 → 调
//         `CounselorLlmJsonClient.requestJson()` → 算 delta 差异 → 写 Redis trace 表.
//         结果**不写进状态** (影子模式 = 只观察, 不生效).
//   边界: B 层 (src/engine-adapters/), 触网络 / 触 Redis —— **不在** src/engine-core/ 内.
//         内核一行未改: 影子模式**不进内核管道** (任务单 §4.1 —— 进管道 = 改 turn 方法 = 破红线).
//
//   V2026-11-05 治本 (WP65 · 影子模式 BullMQ 队列化):
//     本文件**降级为执行器** —— `runShadowMode()` 改名 `executeShadowMode()`, 语义不变
//     (跑 LLM + 写 trace), 但**只由 BullMQ Worker 调用**.
//     编排门面那一侧改由 `DeliberationProcessor` 实现同一个端口 (`runShadowMode` = 入队).
//     门面完全感知不到内部从"直接调"改成了"入队" —— 端口签名一个字没动.
//
//   为什么这一层在适配层:
//     审议层带 prompt / 模型 / 网络, 内核是纯层 (零 @nestjs / 零网络 / 零 prompt).
//     北极星 (hybrid-bdi-agent-blueprint-v1.0.md §2.2) 也写明「审议服务在适配层」.
//
//   影子模式的**三条硬纪律** (任务单 §1.3 / §4.2):
//     ① 结果**不生效** —— 审议 delta 只进 trace 表, 绝不回写 BDI 快照;
//     ② **旁路** —— 调用方不 await, 主流程响应时间不受审议影响 (WP65 起: 入队即返回);
//     ③ **永不抛穿** —— 任何异常都在本层 catch 住, 影子模式挂了不能炸主流程.
//
//   反双胞胎:
//     - **不自己拼 "systemPrompt + schemaDescription"** —— `CounselorLlmJsonClient`
//       已经把 schemaDescription 拼到 system prompt 尾部 (llm-json.client.ts:115).
//       本服务只出三个零件, 拼装由 client 独家负责 (WP63 交付记录 §2.4 同一治本).
//     - **不自己解析 JSON** —— 结构化输出只有一条链: `CounselorLlmJsonClient`
//       (仓库硬约束 6). 本服务只提供一个 `validate` 回调.
//     - **不自己写 LLM 请求** —— 复用 counselor 域唯一的结构化出口, 不引第二套 client.
//     - **不用 `config.get<number>()` 读数值** —— ConfigService 不做类型转换, 拿到的是
//       **字符串** ('3000'), 一路传到 `AbortSignal.timeout()` 会抛 (仓库 WP9-B 已踩过).
//       本文件自己解析 + 回退默认值.
//     - **不给审议结果开"第二次写状态"的口子** —— trace 表是 append-only 的观察面,
//       没有回写 BDI 的通道 (切灰度是 Phase3A 的事).
//     - **不把审议原文 (reason / summary) 打进日志** —— 心理内容禁止进普通日志
//       (隐私红线 AGENTS.md §5.4). 日志只出 id / 计数 / 错误码.
//     - **不自己读 env 开关** —— 开关判定收敛到 `resolveDeliberationEnabled()` 一个纯函数,
//       入队前 (processor) 与执行时 (本服务) 共用同一份真相, 杜绝两处口径漂移.
//
//   ⚠️ 硬安全维度 (自杀倾向 / 自伤风险 / 危机等级) **永远只走规则**, 不跑 LLM 审议:
//     WP63 的 `DELIBERATION_DIMS` 只列了 11 个软状态维度; 模型若硬塞一个硬安全维度,
//     校验层会把它判为**非法条目**并丢进 `rejectedEntries` —— 证据留在 trace 表里
//     (PoC 验收: "高安全维度零误触发" 就能一眼查), 但**不会**进入 delta 建议.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp64-deliberation-shadow.spec.ts 覆盖开关 / 成功 / 格式非法 /
//        超时 / 差异计算 / 异常不炸主流程 / 键设计 / TTL
//     3. test/engine-adapters/wp65-deliberation-queue.spec.ts 覆盖入队 / Worker 配置 / 队列生命周期
//     4. `git diff --stat HEAD -- src/engine-core` 为空 (本期不动内核)

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { buildDeliberationSchemaDescription, buildDeliberationSystemPrompt, buildDeliberationUserPrompt } from './deliberation-prompt.js';
import {
  DELIBERATION_DIMS,
  DELIBERATION_LLM_ONLY_TAGS,
  DELIBERATION_MAX_ABS_DELTA,
  DELIBERATION_RULE_ALIGNED_TAGS,
  type DeliberationDeltaEntry,
  type DeliberationDim,
  type DeliberationMode,
  type DeliberationOperatorTag,
  type DeliberationOutput,
} from './deliberation-types.js';
import type { CounselorLlmJsonClient } from '../../counselor/providers/llm-json.client.js';
import type { BdiSnapshot, DeltaVector } from '../../engine-core/index.js';
import type { RedisService } from '../../shared/infra/redis/redis.service.js';

/** Redis key 的逻辑前缀 (ioredis 还会自动拼 `REDIS_KEY_PREFIX`, 多环境隔离靠它). */
export const DELIBERATION_TRACE_KEY_PREFIX = 'deliberation_trace';

/**
 * trace 数据的存活时长 (秒) —— 30 天.
 *
 * 口径: 影子模式的数据量不大 (100 场 × 每轮一次 ≈ 几千条), 留一个月够 PoC 分析完.
 */
export const DEFAULT_DELIBERATION_TRACE_TTL_SECONDS = 2_592_000;

/** 审议请求的默认超时 (ms). */
export const DEFAULT_DELIBERATION_TIMEOUT_MS = 3000;

/**
 * 审议请求的默认温度.
 *
 * ⚠️ **M3.1-Flash 会忽略 temperature / top_p** (官方固定 1 / 0.95) —— 仓库硬约束 8.
 * 所以这个值只对**换掉的模型**生效 (例如运维把 `ENGINE_DELIBERATION_MODEL` 指到别的模型).
 * 保留这个键是因为: 换模型时不必再改代码, 且不配就沿用上游默认值.
 */
export const DEFAULT_DELIBERATION_TEMPERATURE = 0.3;

/**
 * 审议输出的生成长度上限.
 *
 * ⚠️ 任务单写 512, **这里给 2048** —— 见交付记录 §2.5 (偏差 D7):
 *   MiniMax-M3.1-Flash 是推理模型, **thinking token 计入生成长度上限** (仓库硬约束 8).
 *   引擎渲染侧的既有做法是 1500 (思考 ~700-1000 + 输出 ~500-800, 见 turn-render-orchestrator.ts
 *   的 DEFAULT_TURN_TOKEN_BUDGET 注释). 审议输出本身约 200-300 token, 但思考要先吃预算 ——
 *   给 512 的话, 思考吃掉一两百 token 后正文就被截断, JSON 半截 → `json_not_found` /
 *   `json_parse_failed` 连续失败 (影子模式直接白跑). 2048 是"思考 + 正文都留足"的档.
 */
export const DELIBERATION_MAX_COMPLETION_TOKENS = 2048;

/** 数值保留的小数位 (避免浮点噪声进 JSON). */
const DELIBERATION_VALUE_PRECISION = 6;

/** 扁平理由字段的长度上限 (逐条明细在 `entries` 里, 这里只是给人看的摘要). */
const DELIBERATION_FLAT_REASON_MAX_CHARS = 500;

/**
 * 影子审议的入参.
 *
 * 为什么是"输入"而不是"服务自己去取": 审议服务在适配层, 但**只有编排门面**
 * 同时握有三样东西 —— 本轮咨询师的话、本轮来访的渲染回应、本轮前后的 BDI 快照.
 * 让门面把这三样组装好传进来, 审议服务就保持"纯消费 + 纯产出", 不必自己去翻会话.
 */
export interface DeliberationShadowInput {
  /** 业务会话 id (租户内唯一). */
  readonly sessionId: string;
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 发起这次审议的用户 id (计费 + 审计; 引擎会话的学员账号). */
  readonly userId: string;
  /** 本轮序号 (内核累计轮次, 从 1 起). */
  readonly turnIndex: number;
  /** 当前会话模式 (考核 / 自由练习) —— 决定用哪套 prompt 模板. */
  readonly mode: DeliberationMode;
  /** 本轮**开始时**的 BDI 状态快照 (旧状态, 不是变化后的). */
  readonly baseSnapshot: BdiSnapshot;
  /** 本轮咨询师说的话. */
  readonly counselorText: string;
  /**
   * 本轮来访的反应 (**LLM 渲染输出的文本**, 不是真实用户语音转文字).
   *
   * ⚠️ 看 trace 数据的人不要搞混: 这是 AI 扮演的来访者说的话.
   */
  readonly visitorText: string;
  /** 角色种子信息 (依恋类型 / 大五人格 简述). */
  readonly characterBrief: string;
  /** 规则算子算出的最终 delta (用来跟审议 delta 对比). */
  readonly ruleDelta: DeltaVector;
}

/**
 * 影子审议的**窄端口** (编排门面只依赖这一个动作).
 *
 * 为什么要端口而不是直接依赖实现类:
 *   门面 (`TurnRenderOrchestrator`) 是**纯类** (零 @nestjs), 单测里 new 出来就能跑.
 *   直接依赖 Nest service 会把框架拖进门面, 也让"装配缺席"变成"门面起不来".
 *   窄端口 + 缺省缺席 = 纯增强 (装配缺席时只是没有影子审议, 会话照常).
 *
 * ⚠️ V2026-11-05 (WP65): **实现方换了, 签名一个字没动**.
 *   实现是 `DeliberationProcessor` (同目录) —— 它把审议请求**入队**, 由 BullMQ Worker
 *   异步跑 LLM. 门面拿到的是"入队就返回"的语义, 与 WP64 的"直接跑"对门面**完全透明**.
 *   这个接口继续声明在本文件 (而不是 processor 里): 门面只认这一个 import 路径,
 *   换了实现不该连门面与它的端口定义一起搬走.
 */
export interface DeliberationShadowPort {
  /**
   * 影子模式跑一次审议 (不生效, 只记录对比数据).
   *
   * fire-and-forget: 调用方**不需要** await, 不影响主流程响应时间.
   * 内部捕获所有异常, **不抛** —— 影子模式挂了不能炸主流程.
   */
  runShadowMode(input: DeliberationShadowInput): Promise<void>;
}

/**
 * 影子审议开关的**唯一判定口径** (`ENGINE_DELIBERATION_ENABLED`).
 *
 * ⚠️ 为什么是导出给两处用的纯函数 (WP65):
 *   开关在**两个时间点**各判一次, 理由不同:
 *     · 入队前 (processor) —— 关着就**不入队**, 白占队列也不白等上游;
 *     · 执行时 (service) —— 排队期间运维把开关关了 → 队列里的旧 job 要**跳过**,
 *       不该在开关已关的情况下照样烧 LLM (仓库硬约束 12: 异步任务的偏好在执行时读).
 *   两处各写一份判定 = 两份真相, 迟早漂移 (一处认 'on' 一处不认) → 收口到这里.
 *
 * 缺省 = **关** (影子模式每轮多烧一次 LLM, 不配就零成本).
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns true = 开
 */
export function resolveDeliberationEnabled(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/** 审议产出的 token 用量. */
export interface DeliberationTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** trace 表里单条 delta 的**明细** (逐维可复核). */
export interface DeliberationTraceEntry {
  readonly dimension: DeliberationDim;
  readonly delta: number;
  readonly operatorTags: readonly DeliberationOperatorTag[];
  readonly reason: string;
}

/**
 * 一条审议 trace (Redis value 的形状).
 *
 * ⚠️ 这份记录**含心理内容** (LLM 写的 reason / summary) —— 它是**数据**, 不是日志:
 *   只落 Redis, 不进普通日志 / crash report / 网络日志 (隐私红线 AGENTS.md §5.4).
 *
 * 失败时 (ok=false): `errorCode` 有值, `deliberationDelta` / `entries` 为空,
 * `tokenUsage` 可能仍带 (上游报了用量但 JSON 不合法时).
 */
export interface DeliberationTraceRecord {
  /** 租户隔离键 (与 key 里的那段一致, 便于按值反查归属). */
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  /** 写入时刻 (ISO). */
  readonly timestamp: string;
  /** 审议是否成功 (格式合法 + API 不报错). */
  readonly ok: boolean;
  /** 失败原因码 (成功时为 null). */
  readonly errorCode: string | null;
  /** 本次审议耗时 (ms). */
  readonly durationMs: number;
  /** 审议模式 (考核 / 自由练习). */
  readonly mode: DeliberationMode;
  /** token 用量 (上游没报时为 null). */
  readonly tokenUsage: DeliberationTokenUsage | null;
  /** 规则算子这一轮的实际 delta (逐维全量). */
  readonly ruleDelta: DeltaVector;
  /** 审议建议的 delta (**稀疏**: 只含模型明确提到的维度). */
  readonly deliberationDelta: Readonly<Partial<Record<DeliberationDim, number>>>;
  /** 逐维差异 (审议 - 规则; **全量 11 维**, 没提到的维度按 0 算). */
  readonly deltaDiff: Readonly<Record<DeliberationDim, number>>;
  /** 本轮审议打出的操作标签全集 (去重, 按出现顺序). */
  readonly operatorTags: readonly DeliberationOperatorTag[];
  /** 逐条理由的合并文本 (多条用 '；' 连接; 逐条明细在 `entries` 里). */
  readonly reason: string | null;
  /** 整体置信度 [0,1]. */
  readonly confidence: number | null;
  /** 整体判断 (一句话中文). */
  readonly summary: string | null;
  /** 逐条 delta 明细 (人工复核用). */
  readonly entries: readonly DeliberationTraceEntry[];
  /** 被校验层丢掉的**原始**条目 (非法维度 / 非法标签 / 越界幅度等). */
  readonly rejectedEntries: readonly unknown[];
}

/**
 * 校验通过后的审议产物 (外加被丢掉的条目).
 *
 * 为什么要把 `rejectedEntries` 带出来:
 *   模型偶尔会吐出非法维度 (最典型的是**硬安全维度** —— prompt 明令不许, 但模型未必听话).
 *   那些条目必须**留下证据** (PoC 验收: "高安全维度零误触发" 就是查这一项),
 *   静默丢掉 = 把"模型试图越界"这件事藏起来.
 */
export interface ValidatedDeliberation {
  /** 通过校验的 delta 列表. */
  readonly output: DeliberationOutput;
  /** 被丢掉的原始条目 (逐条保留, 便于事后审计). */
  readonly rejectedEntries: readonly unknown[];
}

/**
 * 构造 trace 表的 Redis key.
 *
 * 口径: **长度前缀复合键** (与 WP32 的 `RedisBdiStateRepository` 同一套纪律):
 *   `deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`
 *
 * 为什么加长度前缀:
 *   直接用 ':' 拼的话, (租户="a:b", 会话="c") 与 (租户="a", 会话="b:c") 会**撞键** ——
 *   撞键的后果是**跨租户串数据** (静默的隐私事故). 同一套纪律 = 两个 Redis 实现
 *   对"什么算同一场会话"的判断**逐字一致**, 运维扫 key 的方式也一样.
 */
export function buildDeliberationTraceKey(tenantId: string, sessionId: string, turnIndex: number): string {
  return `${DELIBERATION_TRACE_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}:${turnIndex}`;
}

/**
 * 算规则算子这一轮的**实际** delta (逐维快照差).
 *
 * ⚠️ 口径说明 (交付记录 §2.3 · 偏差 D3):
 *   任务单要的是"规则算子算出的最终 delta (capped 后的)". 但**适配层拿不到**内核的
 *   `cappedTotal` —— 它是内核 `turn()` 内部的局部变量, 出口只有"本轮结束后的快照".
 *   内核零改动是本期红线, 所以这里只能用**快照差**反推:
 *     · 优点: 口径与"状态实际怎么动了"**完全一致**, 也正是审议 delta 该对齐的基准;
 *     · 代价: 快照落盘时会 clamp 到 [0,1] / 情绪区间 —— 贴着边界的那一轮,
 *             快照差会**小于**内核的 capped delta (差值 = 被 clamp 掉的部分).
 *   边界值附近的偏差对"差异均值 < 0.01"这个 PoC 指标的影响可忽略 (绝大多数轮次不在边界).
 *
 * @param base 本轮开始时的快照
 * @param next 本轮结束后的快照
 * @returns 逐维增量 (11 维全量)
 */
export function computeRuleDelta(base: BdiSnapshot, next: BdiSnapshot): DeltaVector {
  return {
    trust: round(next.trust - base.trust),
    safety: round(next.safety - base.safety),
    bond: round(next.bond - base.bond),
    valence: round(next.emotion.valence - base.emotion.valence),
    arousal: round(next.emotion.arousal - base.emotion.arousal),
    verbal: round(next.resistance.verbal - base.resistance.verbal),
    depth: round(next.resistance.depth - base.resistance.depth),
    style: round(next.resistance.style - base.resistance.style),
    positive: round(next.transference.positive - base.transference.positive),
    negative: round(next.transference.negative - base.transference.negative),
    dependency: round(next.transference.dependency - base.transference.dependency),
  };
}

/**
 * 逐维差异 = 审议 delta - 规则 delta (**全量 11 维**).
 *
 * 为什么是全量而不是"只算模型提到的维度":
 *   PoC 的验收指标是"软状态维度差异均值 < 0.01" —— 均值的**分母**必须是确定的维度集.
 *   只算模型提到的维度, 分母就变成"模型想说多少维", 均值会被人为抬高.
 *   全量 11 维 = 每轮的统计口径完全一致, 跨轮 / 跨会话可加.
 */
export function computeDeliberationDeltaDiff(
  ruleDelta: DeltaVector,
  deliberationDelta: Readonly<Partial<Record<DeliberationDim, number>>>,
): Readonly<Record<DeliberationDim, number>> {
  const diff = {} as Record<DeliberationDim, number>;
  for (const dim of DELIBERATION_DIMS) {
    diff[dim] = round((deliberationDelta[dim] ?? 0) - ruleDelta[dim]);
  }
  return diff;
}

/**
 * 审议输出的**最简**格式校验 (WP66 正式做校验 + 重试).
 *
 * 本期口径:
 *   - **顶层**形状不对 (不是对象 / deltas 不是数组 / summary 不是字符串 / confidence 不是数字)
 *     → 整份判不合法 (返回 null → client 返 `schema_validation_failed`);
 *   - **单条**条目不合法 → 丢掉这一条, 但把**原始条目**带进 `rejectedEntries`
 *     (证据不能丢: 非法维度最典型就是模型硬塞硬安全维度).
 *
 * 校验项:
 *   · dimension 必须在 `DELIBERATION_DIMS` 里 (硬安全维度不在其中 → 必被丢);
 *   · delta 必须是有限数字, 且绝对值不超过 `DELIBERATION_MAX_ABS_DELTA`;
 *   · operatorTags 至少 1 个, 且每个都必须是合法标签;
 *   · reason 必须是非空字符串.
 *
 * @param raw LLM 返回的原始 JSON (反序列化后)
 * @returns 校验通过则返回产物 + 被丢掉的条目; 不通过返回 null
 */
export function validateDeliberationOutput(raw: unknown): ValidatedDeliberation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { deltas?: unknown; summary?: unknown; confidence?: unknown };
  if (!Array.isArray(candidate.deltas)) return null;
  if (typeof candidate.summary !== 'string') return null;
  if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) return null;

  const deltas: DeliberationDeltaEntry[] = [];
  const rejectedEntries: unknown[] = [];
  for (const item of candidate.deltas) {
    const entry = validateDeltaEntry(item);
    if (entry === null) {
      rejectedEntries.push(item);
      continue;
    }
    deltas.push(entry);
  }

  return {
    output: { deltas, summary: candidate.summary, confidence: candidate.confidence },
    rejectedEntries,
  };
}

/**
 * 校验单条 delta 建议.
 *
 * @param raw 单条原始条目
 * @returns 合法则返回规范条目; 不合法返回 null
 */
function validateDeltaEntry(raw: unknown): DeliberationDeltaEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { dimension?: unknown; delta?: unknown; operatorTags?: unknown; reason?: unknown };
  if (typeof candidate.dimension !== 'string') return null;
  if (!isDeliberationDim(candidate.dimension)) return null;
  if (typeof candidate.delta !== 'number' || !Number.isFinite(candidate.delta)) return null;
  if (Math.abs(candidate.delta) > DELIBERATION_MAX_ABS_DELTA) return null;
  if (!Array.isArray(candidate.operatorTags) || candidate.operatorTags.length === 0) return null;
  const tags: DeliberationOperatorTag[] = [];
  for (const tag of candidate.operatorTags) {
    if (typeof tag !== 'string' || !isDeliberationOperatorTag(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0) return null;
  return {
    dimension: candidate.dimension,
    delta: candidate.delta,
    operatorTags: tags,
    reason: candidate.reason.trim(),
  };
}

/** 这个维度名在审议枚举里吗 (硬安全维度不在其中). */
function isDeliberationDim(value: string): value is DeliberationDim {
  return (DELIBERATION_DIMS as readonly string[]).includes(value);
}

/** 这个操作标签在审议枚举里吗. */
function isDeliberationOperatorTag(value: string): value is DeliberationOperatorTag {
  return DELIBERATION_OPERATOR_TAG_SET.has(value);
}

/** 合法操作标签的集合 (建一次, 反复查). */
const DELIBERATION_OPERATOR_TAG_SET: ReadonlySet<string> = new Set<string>([
  ...DELIBERATION_RULE_ALIGNED_TAGS,
  ...DELIBERATION_LLM_ONLY_TAGS,
]);

/** 数值保留固定小数位 (消掉浮点噪声). */
function round(value: number): number {
  const factor = 10 ** DELIBERATION_VALUE_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * LLM 审议服务 (影子模式的**执行器**).
 *
 * 装配: 引擎装配模块 (EngineWiringModule) 把它列为 provider; 由
 * `DeliberationProcessor` (BullMQ Worker) 调用.
 *
 * ⚠️ V2026-11-05 (WP65): 它**不再实现** `DeliberationShadowPort` ——
 *   门面那一侧的端口实现在 `DeliberationProcessor` (入队), 本类只负责"真跑".
 *   两者拆开的原因: 让门面与"队列"解耦 —— 以后换队列 (Redis Stream / MQ),
 *   或给 Worker 扩缩容, 都不牵动本类.
 */
@Injectable()
export class LlmDeliberationService {
  private readonly logger = new Logger(LlmDeliberationService.name);

  constructor(
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 真正跑一次影子审议 (不生效, 只记录对比数据).
   *
   * **永不抛穿**: 任何异常都在这里 catch 住 —— 影子模式挂了不能炸主流程,
   * 更不能把 BullMQ 的 job 打成 failed (那会触发无意义的重试).
   *
   * @param input 本轮审议所需的全部上下文
   */
  async executeShadowMode(input: DeliberationShadowInput): Promise<void> {
    // 开关在**执行时**再判一次: 入队到执行之间可能隔了几十秒, 运维这期间把开关
    // 关了 → 队列里的旧 job 直接跳过, 不烧这次 LLM (仓库硬约束 12).
    if (!this.isEnabled()) return;
    const startedAt = Date.now();
    try {
      const model = this.resolveModel();
      const result = await this.llmJson.requestJson<ValidatedDeliberation>({
        systemPrompt: buildDeliberationSystemPrompt(input.mode),
        userPrompt: buildDeliberationUserPrompt({
          currentSnapshotJson: JSON.stringify(input.baseSnapshot),
          counselorText: input.counselorText,
          visitorText: input.visitorText,
          characterBrief: input.characterBrief,
          turnIndex: input.turnIndex,
        }),
        schemaDescription: buildDeliberationSchemaDescription(),
        validate: validateDeliberationOutput,
        maxCompletionTokens: DELIBERATION_MAX_COMPLETION_TOKENS,
        timeoutMs: this.resolveTimeoutMs(),
        tenantId: input.tenantId,
        userId: input.userId,
        temperature: this.resolveTemperature(),
        ...(model ? { model } : {}),
      });

      if (!result.ok || !result.data) {
        await this.writeTrace(this.buildFailureRecord(input, result.errorCode, startedAt, result.usage));
        return;
      }
      await this.writeTrace(this.buildSuccessRecord(input, result.data, startedAt, result.usage));
    } catch (error) {
      // 影子模式的**最后一道防线**: 连 client 都抛了 (如 tenantId/userId 缺失导致
      // LlmService 同步抛) —— 记一条失败 trace, 绝不把异常抛回主流程.
      this.logger.warn(`[deliberation_shadow] 审议异常, 已忽略 (session=${input.sessionId} turn=${input.turnIndex}): ${messageOf(error)}`);
      await this.writeTrace(this.buildFailureRecord(input, 'shadow_exception', startedAt, null));
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 影子模式开关 (`ENGINE_DELIBERATION_ENABLED`).
   *
   * 判定口径在共享纯函数 `resolveDeliberationEnabled()` —— 入队前 (processor) 与
   * 执行时 (这里) 共用同一份真相, 不各写一份.
   */
  private isEnabled(): boolean {
    return resolveDeliberationEnabled(this.config.get<string>('ENGINE_DELIBERATION_ENABLED'));
  }

  /**
   * 审议专用模型 (`ENGINE_DELIBERATION_MODEL`).
   *
   * 缺省 = 空 = **沿用 counselor 域的默认模型** (client 内部按
   * `MINIMAX_COUNSELOR_LLM_MODEL` → 默认模型 解析). 换模型不必改代码.
   */
  private resolveModel(): string | undefined {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_MODEL') ?? '').trim();
    return raw.length > 0 ? raw : undefined;
  }

  /**
   * 审议超时 (`ENGINE_DELIBERATION_TIMEOUT_MS`).
   *
   * 非法值 → 回退默认 3000 (不抛错): 超时旋钮填错不该让服务起不来.
   */
  private resolveTimeoutMs(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_TIMEOUT_MS') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIBERATION_TIMEOUT_MS;
    return Math.floor(parsed);
  }

  /**
   * 审议温度 (`ENGINE_DELIBERATION_TEMPERATURE`).
   *
   * 非法值 (非数字 / 越界) → 回退默认 0.3 (不抛错).
   */
  private resolveTemperature(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_TEMPERATURE') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_TEMPERATURE;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) return DEFAULT_DELIBERATION_TEMPERATURE;
    return parsed;
  }

  /** 成功记录. */
  private buildSuccessRecord(
    input: DeliberationShadowInput,
    validated: ValidatedDeliberation,
    startedAt: number,
    usage: DeliberationTokenUsage | null,
  ): DeliberationTraceRecord {
    const { output, rejectedEntries } = validated;
    const deliberationDelta: Partial<Record<DeliberationDim, number>> = {};
    const entries: DeliberationTraceEntry[] = [];
    const tags: DeliberationOperatorTag[] = [];
    for (const delta of output.deltas) {
      deliberationDelta[delta.dimension] = round(delta.delta);
      entries.push({
        dimension: delta.dimension,
        delta: round(delta.delta),
        operatorTags: delta.operatorTags,
        reason: delta.reason,
      });
      for (const tag of delta.operatorTags) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
    return {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      timestamp: new Date().toISOString(),
      ok: true,
      errorCode: null,
      durationMs: Date.now() - startedAt,
      mode: input.mode,
      tokenUsage: usage ? { ...usage } : null,
      ruleDelta: input.ruleDelta,
      deliberationDelta,
      deltaDiff: computeDeliberationDeltaDiff(input.ruleDelta, deliberationDelta),
      operatorTags: tags,
      reason: entries.length > 0 ? truncate(entries.map((entry) => entry.reason).join('；')) : null,
      confidence: output.confidence,
      summary: output.summary,
      entries,
      rejectedEntries,
    };
  }

  /** 失败记录 (LLM 报错 / JSON 不合法 / 超时). */
  private buildFailureRecord(
    input: DeliberationShadowInput,
    errorCode: string | null,
    startedAt: number,
    usage: DeliberationTokenUsage | null,
  ): DeliberationTraceRecord {
    return {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      timestamp: new Date().toISOString(),
      ok: false,
      errorCode: errorCode ?? 'unknown_error',
      durationMs: Date.now() - startedAt,
      mode: input.mode,
      tokenUsage: usage ? { ...usage } : null,
      ruleDelta: input.ruleDelta,
      deliberationDelta: {},
      deltaDiff: computeDeliberationDeltaDiff(input.ruleDelta, {}),
      operatorTags: [],
      reason: null,
      confidence: null,
      summary: null,
      entries: [],
      rejectedEntries: [],
    };
  }

  /**
   * 写 trace 表 (Redis).
   *
   * 写失败**只打日志**, 不抛 —— 观察面写不进去不是会话失败 (与仓库既有降级口径一致).
   */
  private async writeTrace(record: DeliberationTraceRecord): Promise<void> {
    try {
      const key = buildDeliberationTraceKey(record.tenantId, record.sessionId, record.turnIndex);
      await this.redis.set(key, JSON.stringify(record), DEFAULT_DELIBERATION_TRACE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`[deliberation_shadow] trace 写入失败 (session=${record.sessionId} turn=${record.turnIndex}): ${messageOf(error)}`);
    }
  }
}

/** 取错误信息 (跨 unknown 边界的安全取法). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 截断到上限 (超长加省略号). */
function truncate(text: string, maxChars = DELIBERATION_FLAT_REASON_MAX_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}
