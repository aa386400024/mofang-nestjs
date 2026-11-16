// V2026-11-12 治本 (D-1 第二段 · 模型轨事件分类器):
//   职责: EventClassifier 的**模型轨**实现 —— 与规则轨同接口, 可替换内核分类器;
//         内部持规则轨实例做**逐字等价回落**, 按业务会话分桶持有跨轮状态,
//         并把「两轨逐轮对照」写进旁路观测 (不进 core events, 不改 delta).
//   边界: 适配层; 零 @nestjs 装饰器 (由装配层 new 出来); 结构化输出**只有一条链**
//         (CounselorLlmJsonClient —— 仓库硬约束 6).
//
//   四条工程纪律 (任务单 §1.3, 全部由本文件实现):
//     ① 回落必须**逐字等价于规则轨** —— 本类内部持有规则轨实例, 失败时直接返回
//        规则轨 classify 的结果. 回落代码**只有一处**, 不会漂.
//     ② **不能先跑同步再跑异步** —— 每轮两次词表扫描 + 一次 LLM = 白烧 CPU,
//        且两条结果并存易漂. 存在 classifyAsync 就只走异步, 由本类内部决定是否回落.
//     ③ 跨轮状态分桶键用**业务 sessionId** (禁用 handleId: 运行时维度, 恢复后会变).
//     ④ 模型轨每条事件 strength **恒 1** —— 置信度只进观测, 不参与 delta 缩放.
//
//   三态形态 (D-7 已接线; 逐场判定唯一真相源 = model-classifier-mode.config.ts):
//     · rule_only  : 只跑规则轨 (缺省; 一次 LLM 都不发);
//     · shadow 模式: 跑模型轨 → 写观测 → **返回规则轨结果** (core events 与 BDI 逐字不变);
//     · llm_active: 模型轨结果**替换**规则轨结果进 core events (名单内场次; 考核场次恒 rule_only).
//
//   ⚠️ **考核红线**: exam 场景恒 rule_only —— 判定在 model-classifier-mode.config.ts 里,
//     优先于一切配置与名单, 模型轨在考核场次**一次 LLM 都不发**.
//
//   如何验证:
//     1. pnpm exec tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/model-event-classifier.spec.ts 覆盖回落 / 熔断 / 跨轮 / 影子零回归

import { Logger } from '@nestjs/common';

import {
  resolveModelClassifierSessionMode,
  type ModelClassifierEffectiveMode,
  type ModelClassifierModeConfig,
} from './model-classifier-mode.config.js';
import { resolveLatencyBucket, type ModelClassifierObservation, type ModelClassifierObserver } from './model-classifier-observation.js';
import {
  mapModelLabels,
  validateModelClassification,
  type MappedModelLabels,
  type ModelClassificationOutput,
} from './model-event-mapping.js';
import { COUNSELOR_LLM_PROFILES } from '../../counselor/config/counselor-llm.config.js';
import type { CounselorLlmJsonRequest, CounselorLlmJsonResult } from '../../counselor/providers/llm-json.client.js';
import { RuleBasedClassifier, type ClassifyContext, type EventClassifier, type SessionEvent } from '../../engine-core/index.js';
import type { DeliberationScenarioType } from '../deliberation/deliberation-mode.config.js';

/**
 * 结构化输出出口的**窄面** (只认 requestJson 一个方法).
 *
 * ⚠️ 为什么不定死 CounselorLlmJsonClient 这个类: 测试要注入桩 (不打真模型),
 *   换实现也不该改判定链 (仓库硬约束 6: 结构化输出只有一条链, 但**注入面**可以窄).
 */
export interface ModelClassifierLlmPort {
  /**
   * 发一次结构化输出请求 (错误当数据, 不抛).
   *
   * @param input 请求入参
   * @returns 结构化结果或带 errorCode 的失败结果
   */
  requestJson<T>(input: CounselorLlmJsonRequest<T>): Promise<CounselorLlmJsonResult<T>>;
}

/**
 * 会话归属的**最小切片** (模型轨只需要这三样).
 *
 * ⚠️ 归属登记表 (EngineSessionRegistry) 天然满足这个形状 —— 结构化类型, 不必改它.
 */
export interface ModelClassifierSessionContext {
  /** 租户隔离键 (观测与计费都要). */
  readonly tenantId: string;
  /** 学员账号 id (计费 + 审计); 缺省 = 空串. */
  readonly userId?: string;
  /** 本场场景类型; undefined = 查不到 (按考核红线保守处理). */
  readonly scenarioType?: DeliberationScenarioType;
}

/**
 * 会话归属反查端口 (适配层窄面).
 *
 * ⚠️ **为什么反查而不是往内核端口加字段**: 场景类型是**业务维度** (开局时才知道),
 *   内核契约长不出它自己填不了的字段 (要过内核红线). 复用归属登记表, 零重复状态.
 */
export interface ModelClassifierSessionResolver {
  /**
   * 按业务会话 id 反查归属.
   *
   * @param sessionId 业务会话 id
   * @returns 归属切片; undefined = 查不到 (调用方按「不发 LLM」处理)
   */
  resolveBySessionId(sessionId: string): ModelClassifierSessionContext | undefined;
}

/**
 * 跨轮上下文的**窄面** (编排器 → 分类器).
 *
 * ⚠️ **为什么由编排器写「上一轮来访话语」**:
 *   上一轮来访话语只存在于编排器的历史里 (它才有「问 + 答」两条腿);
 *   内核的 workingWindow 只累积**咨询师**文本, 算不出来.
 *   而**连续计数**由分类器自持 (更新者 = 判定者, 单一真相源) —— 两者职责不同, 分开.
 */
export interface ModelClassifierContextPort {
  /**
   * 写入「上一轮来访话语」 (编排器在每轮开始前写).
   *
   * @param sessionId 业务会话 id
   * @param visitorText 上一轮来访话语 (空串 = 本场还没有来访发言)
   */
  recordVisitorTurn(sessionId: string, visitorText: string): void;

  /**
   * 清掉某场会话的跨轮上下文 (会话关闭时调用).
   *
   * @param sessionId 业务会话 id
   */
  forgetSession(sessionId: string): void;
}

/**
 * 适配层的规则轨**共享单例** (审议兜底与模型轨回落用**同一份**).
 *
 * ⚠️ **为什么要共享**: 仓库纪律是「判定只有一份」. 内核那份由 InMemoryEngineSession 持有
 *   (拿不到, 也不该拿 —— 跨内核边界暴露实例等于把内核状态漏给适配层),
 *   但**适配层内部**的兜底分类与回落分类必须是同一份 —— 两处各 new 一个,
 *   将来有人改了词典只改一处, 两边就漂了 (三处同源风险 B).
 *
 * ⚠️ RuleBasedClassifier 是**无状态纯函数** —— 共享实例与各建实例的输出逐字相同,
 *   共享只是为了让「同一份」这件事在代码上看得见 (而不是靠口头约定).
 */
export const SHARED_RULE_TRACK = new RuleBasedClassifier();

/** prompt 版本 (写进观测, 供口径核对 —— 风险 J). */
export const MODEL_CLASSIFIER_PROMPT_VERSION = 'model-event-classifier-v1';

/**
 * 低置信阈值 (低于它 → 回落规则轨 + 记 low_confidence).
 *
 * ⚠️ **本单取 0.6 是工程缺省, 不是临床口径** —— 缺席轮数阈值与 delta 数值一起留 D-2.
 *   刻意**不设 env 键**: 少一个开关 = 少一类歧义 (env 覆盖度契约只登记真正要配的键).
 */
export const DEFAULT_MODEL_CLASSIFIER_MIN_CONFIDENCE = 0.6;

/** 熔断阈值 (连续失败多少次后开闸). */
export const DEFAULT_MODEL_CLASSIFIER_CIRCUIT_THRESHOLD = 3;

/** 熔断冷却时长 (ms). */
export const DEFAULT_MODEL_CLASSIFIER_CIRCUIT_COOLDOWN_MS = 60_000;

/**
 * 跨轮状态分桶的存活时长 (ms) —— 2 小时.
 *
 * ⚠️ **TTL 是兜底, 不是主清理路径** —— 主路径是挂 forgetSession (与编排器历史同生命周期).
 *   TTL 防的是「会话没走 close 就走了进程」的漏网 (探测器共享同一个内核实例, 不能靠析构清理).
 */
export const DEFAULT_MODEL_CLASSIFIER_STATE_TTL_MS = 2 * 60 * 60 * 1000;

/** 熔断器三态. */
export type ModelClassifierCircuitStatus = 'closed' | 'open' | 'half-open';

/**
 * 算熔断器当前处于哪一态 (纯函数, 可单测).
 *
 * 口径与审议的 resolveCircuitStatus 一致 (存出来的状态容易与算出来的不一致, 算出来的永远是准的).
 *
 * @param state 熔断状态 (读不到 = null)
 * @param threshold 失败阈值
 * @param cooldownMs 冷却时长 (ms)
 * @param now 当前时刻 (ms)
 * @returns 三态之一
 */
export function resolveModelClassifierCircuitStatus(
  state: { readonly failureCount: number; readonly openedAt: number | null } | null,
  threshold: number,
  cooldownMs: number,
  now: number,
): ModelClassifierCircuitStatus {
  if (!state || state.failureCount < threshold) return 'closed';
  if (state.openedAt === null) return 'closed';
  return now - state.openedAt < cooldownMs ? 'open' : 'half-open';
}

/**
 * 把上游错误码归一到**真实码表** (任务单 "4.5).
 *
 * ⚠️ **不自造码**: 超时在既有码表里**不存在** —— 它落 catch-all 的 fetch_error.
 *   所以这里只做两件事: 把 http_5xx 家族 (http_500 / http_502 / ...) 归成 http_5xx;
 *   以及**防御性**地把 timeout 归到 fetch_error —— 万一将来上游吐出这个码,
 *   观测表里也不能出现一个语义重叠的「超时码」.
 *
 * @param errorCode 上游错误码 (可空)
 * @returns 归一后的错误码
 */
export function normalizeModelClassifierFallbackCode(errorCode: string | null | undefined): string {
  const code = (errorCode ?? '').trim();
  if (code.length === 0) return 'fetch_error';
  if (code === 'timeout') return 'fetch_error';
  if (code.startsWith('http_5')) return 'http_5xx';
  return code;
}

/**
 * 比较两轨的标签集合是否一致 (集合语义, 顺序无关).
 *
 * ⚠️ **口径**: 规则轨的标签集 vs 模型轨的标签集 (D-2 起两者都是 core kind 集合).
 *   规则轨判 neutral 而模型判 holding_present → **不一致** —— 这正是本单要量的那个差.
 *
 * @param ruleKinds 规则轨标签
 * @param modelKinds 模型轨标签
 * @returns 是否一致
 */
export function computeModelClassifierAgreement(ruleKinds: readonly string[], modelKinds: readonly string[]): boolean {
  if (ruleKinds.length !== modelKinds.length) return false;
  const left = [...ruleKinds].toSorted((a, b) => a.localeCompare(b));
  const right = [...modelKinds].toSorted((a, b) => a.localeCompare(b));
  return left.every((kind, index) => kind === right[index]);
}

/**
 * 判定用的 system prompt.
 *
 * ⚠️ **只描述判定口径, 不含任何心理内容** —— prompt 全文是部署资产, 不进观测表.
 */
const MODEL_CLASSIFIER_SYSTEM_PROMPT = [
  '你是心理咨询培训里的「咨询师行为判定器」.',
  '给你咨询师本轮发言 (以及可选的上一轮来访话语), 判断这一轮咨询师的行为标签.',
  '',
  '可选标签 (只能从下面这份清单里选, 不要自造):',
  '- empathy: 共情 / 反映来访者的感受;',
  '- acceptance: 接纳 / 允许来访者有这样的感受;',
  '- normalization: 正常化 / 把困扰放进普遍经验;',
  '- open_probe: 开放式提问;',
  '- affirmation: 肯定来访者已有的资源与努力;',
  '- judgment: 评判 / 给来访者的处境或想法打分;',
  '- preaching: 说教 / 讲道理;',
  '- minimizing: 淡化 / 轻描淡写;',
  '- boundary_cross: 越界 (承诺治愈 / 双重关系 / 替来访者做决定);',
  '- sensitive_touch: 触碰来访者当下的敏感议题;',
  '- neutral: 本轮没有命中任何行为标签;',
  '- holding_present: 咨询师在场但没有推进干预 —— 温和稳定地陪着, 不评判也不机械 (在场状态事件);',
  '- cold_absent: 咨询师实质缺席 —— 心不在焉 / 敷衍 / 模板化 / 只顾自己 (在场状态事件).',
  '',
  '判定口径:',
  '- 一轮可以给多个标签, 但只给确实成立的, 不要为了凑数多选;',
  '- 没有命中任何行为标签时给 neutral;',
  '- holding_present 与 cold_absent 描述的是咨询师的在场状态, 可以与 neutral 同时出现, 也可以单独出现.',
].join('\n');

/** 输出契约 (拼到 system prompt 尾部). */
const MODEL_CLASSIFIER_SCHEMA_DESCRIPTION = [
  '输出 JSON 对象, 形状固定为:',
  '{',
  '  "kinds": ["<清单里的标签>", "..."],',
  '  "confidence": 0 到 1 之间的数字',
  '}',
  '- kinds: 数组, 至少一个元素, 元素只能取清单里的标签;',
  '- confidence: 0 到 1 之间的数字, 表示你对本次判断的把握.',
].join('\n');

/**
 * 拼 user prompt (输入最小化 —— 风险 I).
 *
 * ⚠️ **只送判定必需的字段**: 本轮咨询师发言 (判定对象) + 上一轮来访话语 (模型轨的核心增量)
 *   + 连续计数 + 敏感议题词表. **不送整段 transcript** —— 那是审议的做法, 不是分类的.
 *
 * @param input 拼装入参
 * @returns user prompt 文本
 */
function buildModelClassifierUserPrompt(input: {
  readonly counselorText: string;
  readonly previousVisitorText: string | null;
  readonly neutralStreak: number;
  readonly coldStreak: number;
  readonly sensitiveTopics: readonly string[];
  readonly turnIndex: number;
}): string {
  const blocks: string[] = [
    '【本轮咨询师发言】\n' + input.counselorText,
    ...(input.previousVisitorText ? ['【上一轮来访话语】\n' + input.previousVisitorText] : []),
    '【连续未命中任何行为标签的轮数】' + String(input.neutralStreak),
    '【连续判为 cold_absent 的轮数】' + String(input.coldStreak),
    ...(input.sensitiveTopics.length > 0 ? ['【来访者的敏感议题词表】\n' + input.sensitiveTopics.join('、')] : []),
    '【轮次】' + String(input.turnIndex),
  ];
  return blocks.join('\n\n');
}

/**
 * 一场会话的跨轮状态 (**分桶键 = 业务 sessionId**).
 *
 * ⚠️ 更新者 = 判定者 (本类) —— 状态与判定不在两处, 不会出现两份真相.
 */
interface ModelClassifierSessionState {
  /** 本场已判定轮数 (观测用的轮次号). */
  turnIndex: number;
  /** 连续「两轨都判 neutral」的轮数. */
  consecutiveNeutral: number;
  /** 连续「判为 cold_absent」的轮数. */
  consecutiveColdAbsent: number;
  /** 上一轮来访是否有实质回应. */
  lastVisitorResponded: boolean;
  /** 上一轮来访话语 (判定时取用). */
  lastVisitorText: string | null;
  /** 熔断: 连续失败次数. */
  failureCount: number;
  /** 熔断: 开闸时刻 (ms); 未达阈值时为 null. */
  openedAt: number | null;
  /** 最近一次更新时刻 (TTL 兜底). */
  updatedAt: number;
}

/** 一次模型轨尝试的结局 (内部形状). */
interface ModelTrackOutcome {
  /** 映射后的标签 (null = 没跑起来 / 判定不可用). */
  readonly labels: MappedModelLabels | null;
  /** 置信度 (不可用时 = 0). */
  readonly confidence: number;
  /** 回落原因码 (null = 没回落). */
  readonly fallbackReason: string | null;
  /** 本次尝试的耗时 (ms). */
  readonly latencyMs: number;
}

/**
 * 模型轨事件分类器 (EventClassifier 的模型轨实现).
 *
 * 装配层在**非 rule_only** 时把它注入内核会话端口; 缺省不注入 = 内核走缺省规则轨 (逐字零回归).
 */
export class ModelEventClassifier implements EventClassifier, ModelClassifierContextPort {
  private readonly logger = new Logger(ModelEventClassifier.name);
  /** 规则轨实例 (回落用; 共享单例 —— 无状态纯函数, 持有它不增加任何状态). */
  private readonly rule = SHARED_RULE_TRACK;
  /** 跨轮状态分桶 (业务 sessionId → 状态). */
  private readonly sessions = new Map<string, ModelClassifierSessionState>();
  /** 低置信阈值. */
  private readonly minConfidence: number;
  /** 熔断阈值. */
  private readonly circuitThreshold: number;
  /** 熔断冷却时长 (ms). */
  private readonly circuitCooldownMs: number;
  /** 状态分桶存活时长 (ms). */
  private readonly stateTtlMs: number;
  /** 当前时刻 (便于测试注入). */
  private readonly now: () => number;

  /**
   * @param llm 结构化输出出口
   * @param modeConfig 灰度配置
   * @param observer 观测写入器
   * @param sessionResolver 会话归属反查
   * @param modelId 用的模型标识 (写进观测)
   * @param options 其余可调项 (测试用)
   */
  constructor(
    private readonly llm: ModelClassifierLlmPort,
    private readonly modeConfig: ModelClassifierModeConfig,
    private readonly observer: ModelClassifierObserver,
    private readonly sessionResolver: ModelClassifierSessionResolver,
    private readonly modelId: string,
    options: {
      readonly minConfidence?: number;
      readonly circuitThreshold?: number;
      readonly circuitCooldownMs?: number;
      readonly stateTtlMs?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.minConfidence = options.minConfidence ?? DEFAULT_MODEL_CLASSIFIER_MIN_CONFIDENCE;
    this.circuitThreshold = options.circuitThreshold ?? DEFAULT_MODEL_CLASSIFIER_CIRCUIT_THRESHOLD;
    this.circuitCooldownMs = options.circuitCooldownMs ?? DEFAULT_MODEL_CLASSIFIER_CIRCUIT_COOLDOWN_MS;
    this.stateTtlMs = options.stateTtlMs ?? DEFAULT_MODEL_CLASSIFIER_STATE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * 当前**全局**生效模式 (装配层据此决定注不注入).
   *
   * ⚠️ 为什么暴露它: 装配层要在「内核会话端口」与「编排门面」两处决定挂不挂模型轨,
   *   而判定**只有一份** —— 这里读的就是分类器内部那份 modeConfig, 不另读 env.
   *
   * @returns 全局生效模式
   */
  effectiveMode(): ModelClassifierEffectiveMode {
    return this.modeConfig.effectiveMode;
  }

  /**
   * 同步分类 —— **规则轨** (模型轨没有同步形态).
   *
   * ⚠️ 为什么要保留同步实现: EventClassifier 的契约要求它; 而内核在有 classifyAsync 时
   *   根本不会走这条分支 (两条分支互斥). 这里给的是规则轨 = 回落的目标结果.
   *
   * @param text 咨询师本轮文本
   * @param context 分类上下文
   * @returns 规则轨事件
   */
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[] {
    return this.rule.classify(text, context);
  }

  /**
   * 异步分类 —— **模型轨** (内核 await 它).
   *
   * ⚠️ **回落必须逐字等价于规则轨**: 本方法在**任何**失败路径上返回的都是
   *   `this.rule.classify(text, context)` 的结果 —— 回落代码只有这一处.
   *
   * @param text 咨询师本轮文本
   * @param context 分类上下文
   * @returns 事件 (影子模式下 = 规则轨结果, core 与 BDI 逐字不变)
   */
  async classifyAsync(text: string, context?: ClassifyContext): Promise<readonly SessionEvent[]> {
    const ruleEvents = this.rule.classify(text, context);
    const sessionId = (context?.sessionId ?? '').trim();
    if (sessionId.length === 0) return ruleEvents;
    const session = this.sessionResolver.resolveBySessionId(sessionId);
    if (!session) return ruleEvents;
    const mode = resolveModelClassifierSessionMode(this.modeConfig, sessionId, session.scenarioType);
    if (mode === 'rule_only') return ruleEvents;

    const state = this.stateOf(sessionId);
    const turnIndex = state.turnIndex + 1;
    const outcome = await this.runModelTrack(text, context, state, turnIndex, session);

    this.advanceState(state, ruleEvents, outcome, turnIndex);
    this.observeRound(session, sessionId, turnIndex, ruleEvents, outcome);

    if (mode === 'llm_active' && outcome.labels && outcome.fallbackReason === null) {
      // D-7 已接线: 模型轨结果替换规则轨结果进 core events.
      //   走到这里 = 全局 llm_active + 本场在名单内 + 场景非考核
      //   (逐场判定在 model-classifier-mode.config.ts —— 装配层只管全局形态).
      //   ⚠️ **必须同时判 fallbackReason === null**: 低置信这一轮**是回落**
      //     (模型标签仍进观测, 但判定不可用) —— 它带着 labels 回来.
      //     只看 labels 的话, 低置信轮会把模型事件**漏进 core**, 违反
      //     「回落一律规则轨等价事件」红线 (D-7 接线时发现并补上).
      //   ⚠️ 两类新 kind (holding_present / cold_absent) 在 DELTA_TABLE 里种子仍是 ZERO ——
      //     本单接的是**通路**, 幅度改善待标定批次赋表行增量.
      return outcome.labels.coreKinds.map((kind) => ({ kind, matchedTerms: [], strength: 1 }));
    }
    // shadow: core events 与 BDI **逐字**保持规则轨 (首版是中间态: 只观测, 不改 delta).
    return ruleEvents;
  }

  /**
   * 写入「上一轮来访话语」 (编排器每轮开始前调).
   *
   * @param sessionId 业务会话 id
   * @param visitorText 上一轮来访话语 (空串 = 本场还没有来访发言)
   */
  recordVisitorTurn(sessionId: string, visitorText: string): void {
    const state = this.stateOf(sessionId);
    const trimmed = visitorText.trim();
    state.lastVisitorText = trimmed.length > 0 ? trimmed : null;
    state.lastVisitorResponded = trimmed.length > 0;
    state.updatedAt = this.now();
  }

  /**
   * 清掉某场会话的跨轮上下文 (会话关闭时调 —— 与编排器历史同生命周期).
   *
   * @param sessionId 业务会话 id
   */
  forgetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 当前分桶数 (观测 / 测试用).
   *
   * @returns 分桶数
   */
  bucketCount(): number {
    return this.sessions.size;
  }

  /**
   * 跑一次模型轨 (LLM + 校验 + 熔断).
   *
   * @param text 咨询师本轮文本
   * @param context 分类上下文
   * @param state 本场跨轮状态
   * @param turnIndex 本轮轮次
   * @param session 会话归属切片
   * @returns 本次尝试的结局
   */
  private async runModelTrack(
    text: string,
    context: ClassifyContext | undefined,
    state: ModelClassifierSessionState,
    turnIndex: number,
    session: ModelClassifierSessionContext,
  ): Promise<ModelTrackOutcome> {
    const now = this.now();
    const circuit = resolveModelClassifierCircuitStatus(
      { failureCount: state.failureCount, openedAt: state.openedAt },
      this.circuitThreshold,
      this.circuitCooldownMs,
      now,
    );
    if (circuit === 'open') {
      // 熔断中: **一次 LLM 都不发** (省调用, 也免得在上游已经挂掉时继续烧钱).
      return { labels: null, confidence: 0, fallbackReason: 'circuit_open', latencyMs: 0 };
    }

    const profile = COUNSELOR_LLM_PROFILES.liveTurnAnalysis;
    const startedAt = this.now();
    const result = await this.llm.requestJson<ModelClassificationOutput>({
      systemPrompt: MODEL_CLASSIFIER_SYSTEM_PROMPT,
      userPrompt: buildModelClassifierUserPrompt({
        counselorText: text,
        previousVisitorText: state.lastVisitorText,
        neutralStreak: state.consecutiveNeutral,
        coldStreak: state.consecutiveColdAbsent,
        sensitiveTopics: context?.sensitiveTopics ?? [],
        turnIndex,
      }),
      schemaDescription: MODEL_CLASSIFIER_SCHEMA_DESCRIPTION,
      validate: validateModelClassification,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: this.modeConfig.timeoutMs,
      tenantId: session.tenantId,
      userId: (session.userId ?? '').trim(),
    });
    const latencyMs = this.now() - startedAt;

    if (!result.ok || result.data === null) {
      const code = normalizeModelClassifierFallbackCode(result.errorCode);
      this.recordFailure(state);
      return { labels: null, confidence: 0, fallbackReason: code, latencyMs };
    }
    const labels = mapModelLabels(result.data.kinds);
    if (!labels) {
      // 标签全不可用 (空数组 / 全是未知标签) → 形状不合契约.
      this.recordFailure(state);
      return { labels: null, confidence: 0, fallbackReason: 'schema_validation_failed', latencyMs };
    }
    if (result.data.confidence < this.minConfidence) {
      // 低置信 = 判定不可用 → 回落规则轨. **不计入熔断** (上游没挂, 只是这一轮把握不足).
      return { labels, confidence: result.data.confidence, fallbackReason: 'low_confidence', latencyMs };
    }
    this.recordSuccess(state);
    return { labels, confidence: result.data.confidence, fallbackReason: null, latencyMs };
  }

  /**
   * 推进跨轮状态.
   *
   * ⚠️ **回落也推进** (回落是一次有效判定): 否则一次 LLM 故障会让连续计数**断链**
   *   (计数器被上游故障污染). 回落时按规则轨结果推进.
   *
   * @param state 本场跨轮状态
   * @param ruleEvents 规则轨结果
   * @param outcome 本次模型轨结局
   * @param turnIndex 本轮轮次
   */
  private advanceState(
    state: ModelClassifierSessionState,
    ruleEvents: readonly SessionEvent[],
    outcome: ModelTrackOutcome,
    turnIndex: number,
  ): void {
    const ruleNeutral = ruleEvents.every((event) => event.kind === 'neutral');
    // D-2: 两类新 kind 已进 coreKinds —— 「模型判 neutral」= coreKinds **全**是 neutral.
    //   (D-1 时代还要额外判 sideLabels 为空; 现在两类本身就是 core kind,
    //    判 holding_present / cold_absent 时 coreKinds 里就有非 neutral 项 → 自动不算 neutral.)
    const modelNeutral = outcome.labels === null ? ruleNeutral : outcome.labels.coreKinds.every((kind) => kind === 'neutral');
    state.consecutiveNeutral = ruleNeutral && modelNeutral ? state.consecutiveNeutral + 1 : 0;
    // D-2: 取值来源从 sideLabels 改到 coreKinds —— **判定语义不变** (见任务单 §5).
    const cold = outcome.labels?.coreKinds.includes('cold_absent') ?? false;
    const holding = outcome.labels?.coreKinds.includes('holding_present') ?? false;
    const ruleHit = ruleEvents.some((event) => event.kind !== 'neutral');
    state.consecutiveColdAbsent = cold && !holding && !ruleHit ? state.consecutiveColdAbsent + 1 : 0;
    state.turnIndex = turnIndex;
    state.updatedAt = this.now();
  }

  /**
   * 写一条对照观测 (fire-and-forget).
   *
   * @param session 会话归属切片
   * @param sessionId 业务会话 id
   * @param turnIndex 本轮轮次
   * @param ruleEvents 规则轨结果
   * @param outcome 本次模型轨结局
   */
  private observeRound(
    session: ModelClassifierSessionContext,
    sessionId: string,
    turnIndex: number,
    ruleEvents: readonly SessionEvent[],
    outcome: ModelTrackOutcome,
  ): void {
    const ruleKinds = ruleEvents.map((event) => event.kind as string);
    // D-2: modelKinds 直接取 coreKinds (旁路标签层已取消).
    const modelKinds = outcome.labels ? [...outcome.labels.coreKinds] : [];
    const observation: ModelClassifierObservation = {
      tenantId: session.tenantId,
      sessionId,
      turnIndex,
      ruleKinds,
      modelKinds,
      agreement: computeModelClassifierAgreement(ruleKinds, modelKinds),
      confidence: outcome.confidence,
      fallbackReason: outcome.fallbackReason,
      latencyBucket: resolveLatencyBucket(outcome.latencyMs),
      modelId: this.modelId,
      promptVersion: MODEL_CLASSIFIER_PROMPT_VERSION,
      strength: 1,
      degraded: outcome.fallbackReason !== null,
    };
    try {
      void Promise.resolve(this.observer.record(observation)).catch(() => {});
    } catch (error) {
      this.logger.warn(
        '[model_classifier_observe_failed] session=' +
          sessionId +
          ' turn=' +
          turnIndex +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * 取 (或建) 某场会话的状态分桶.
   *
   * @param sessionId 业务会话 id
   * @returns 该场会话的状态
   */
  private stateOf(sessionId: string): ModelClassifierSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: ModelClassifierSessionState = {
      turnIndex: 0,
      consecutiveNeutral: 0,
      consecutiveColdAbsent: 0,
      lastVisitorResponded: false,
      lastVisitorText: null,
      failureCount: 0,
      openedAt: null,
      updatedAt: this.now(),
    };
    this.sessions.set(sessionId, created);
    this.pruneExpired();
    return created;
  }

  /**
   * 清掉超 TTL 的分桶 (防 Map 无限增长 —— 风险 O).
   *
   * ⚠️ 主清理路径仍是 forgetSession; TTL 只是兜底 (会话没走 close 就走了进程的漏网).
   */
  private pruneExpired(): void {
    const now = this.now();
    for (const [sessionId, state] of this.sessions) {
      if (now - state.updatedAt > this.stateTtlMs) this.sessions.delete(sessionId);
    }
  }

  /**
   * 记一次失败 (熔断记账).
   *
   * @param state 本场跨轮状态
   */
  private recordFailure(state: ModelClassifierSessionState): void {
    state.failureCount += 1;
    if (state.failureCount >= this.circuitThreshold) {
      // 熔断中再失败 → 保留原来的 openedAt (冷却继续走, 不重置).
      state.openedAt = state.openedAt ?? this.now();
    }
    state.updatedAt = this.now();
  }

  /**
   * 记一次成功 (熔断清零).
   *
   * @param state 本场跨轮状态
   */
  private recordSuccess(state: ModelClassifierSessionState): void {
    state.failureCount = 0;
    state.openedAt = null;
    state.updatedAt = this.now();
  }
}
