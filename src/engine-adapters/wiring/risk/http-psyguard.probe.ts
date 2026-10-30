// V2026-10-30 治本 (WP11 · B 层 · PsyGUARD HTTP 风险探测器):
//   职责: 实现内核 WP4 的 `RiskProbePort` —— 把一段文本 POST 给**独立仓库**的
//         PsyGUARD-RoBERTa Python 服务 (mofang-psyguard), 拿回危机类别与等级.
//   边界: 只做「发请求 → 归一形状」; 任何失败都**抛错**, 由内核 `assessSafety`
//         兜住并回落本地规则 (`LocalCrisisProbe`).
//
//   为什么是"独立仓库 + HTTP"而不是进程内加载模型:
//     内核是**零依赖纯 TS** (WP0 边界: 不许引 torch / 任何 SDK). 模型推理必须
//     在进程外 —— 于是内核 WP4 预留了 `RiskProbePort`, 本文件是它在 B 层的实现.
//     换模型 / 换部署 (本地进程 / 队列 / gRPC) 只改这一个文件, 内核一行不动.
//
//   失败语义 (本文件最重要的一条):
//     端口**不承诺一定成功**. 连接拒绝 / 超时 / 503 / 非 JSON / 形状不对 ——
//     全部抛错, 内核 `assessSafety` 的 catch 会**静默回落规则结果**.
//     把失败留给调用方处理是端口设计里最容易做错的一环: 一个假设自己永远成功的
//     依赖, 会把网络抖动直接变成"会话没风险信号"甚至"会话失败".
//     ⚠️ 但"抛错"不等于"悄悄失败": 本文件在抛错前**先记 warn**, 否则运维看到的是
//     "探测器好像没生效", 而日志里一条线索都没有 (内核的 catch 是静默的).
//
//   等级映射 (wire 词汇 ≠ 内核词汇):
//     Python 服务的 wire 等级是通用风险刻度 `low | medium | high`;
//     内核的 `SafetyLevel` 是动作刻度 `pass | warn | block`.
//     两者分区**刻意对齐** (Python 侧的类别→粗档表与内核 `PSYGUARD_LEVEL_MAP`
//     的 block/warn/pass 分区一致), 所以这里是**一一对应**而不是重新判断严重度.
//     即使某一侧判偏保守, 内核最终等级仍取 max(规则, 探测, 类别映射) —— 宁可偏高.
//
//   超时的真相 (别被这个数字骗了):
//     内核 `assessSafety` 的探测超时是 `DEFAULT_PROBE_TIMEOUT_MS` = **150ms**, 且是
//     **硬上限** (内核那层自己 race, 适配层改不动 —— engine-core 是红线).
//     本文件的 `timeoutMs` 只是**提前掐断 HTTP 连接**, 让 socket 早点释放;
//     把它调大**不会**放宽内核的判定上限 (内核照样 150ms 回落规则).
//     所以真正的工程约束是: **Python 服务必须在 150ms 内答完** (见 mofang-psyguard
//     的 README「延迟预算」一节).
//
//   不做:
//     - 不缓存探测结果 (风险判定要实时; 缓存会漏判) —— 任务单 §2 明确红线;
//     - 不重试 (重试会让每轮探测的最坏耗时翻倍, 而内核预算只有 150ms);
//     - 不做熔断 (连接被拒是**瞬时**返回, 不像超时那样等满 150ms; 真需要熔断
//       应该在内核那层统一做, 而不是每加一个探测实现就各写一套).

import { Logger } from '@nestjs/common';

import {
  DEFAULT_PROBE_TIMEOUT_MS,
  PSYGUARD_LEVEL_MAP,
  isSafetyLevel,
  type RiskProbePort,
  type RiskProbeResult,
  type SafetyLevel,
  type SafetySide,
  type VisitorRiskCategory,
} from '../../../engine-core';

/**
 * Python 服务的 wire 等级 (通用风险刻度).
 *
 * 与内核 `SafetyLevel` 的关系是**分区一致的一一对应**:
 *   low ↔ pass / medium ↔ warn / high ↔ block.
 */
export type PsyGuardWireLevel = 'low' | 'medium' | 'high';

/** wire 等级 → 内核等级 (分区一致的直接映射). */
const WIRE_LEVEL_TO_SAFETY_LEVEL: Readonly<Record<PsyGuardWireLevel, SafetyLevel>> = {
  low: 'pass',
  medium: 'warn',
  high: 'block',
};

/** wire 等级清单 (脏值按"整体不合法"处理). */
const WIRE_LEVELS: ReadonlySet<string> = new Set<string>(['low', 'medium', 'high']);

/**
 * 合法来访类别集合.
 *
 * 来源: 内核**已导出**的 `PSYGUARD_LEVEL_MAP` 的键 —— 那张表按 `VisitorRiskCategory`
 * 逐项列出 11 类, 键集恰好就是合法类别集.
 *
 * 为什么不用内核的 `isVisitorRiskCategory`: 它**没有**从内核 barrel 导出
 * (`engine-core/index.ts` 只导出了 `isSafetyLevel` / `maxSafetyLevel` /
 * `PSYGUARD_LEVEL_MAP`), 而内核整树是**红线不可改**. 与其为了一个判定函数去改
 * 内核 barrel (会动红线范围), 不如用已导出的映射表键集 —— 同一份真相, 零改动.
 */
const VISITOR_RISK_CATEGORY_SET: ReadonlySet<string> = new Set<string>(Object.keys(PSYGUARD_LEVEL_MAP));

/**
 * 是否合法的来访风险类别名.
 *
 * @param value 待判断值
 * @returns 合法则 true (并收窄类型)
 */
function isVisitorRiskCategoryName(value: string): value is VisitorRiskCategory {
  return VISITOR_RISK_CATEGORY_SET.has(value);
}

/**
 * fetch 的窄面 (便于单测注入假实现, 不引第三方 HTTP 库).
 */
export type PsyGuardFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

/**
 * 去掉末尾斜杠 (避免拼出 `//v1/classify`).
 *
 * 用循环而不是正则: 仓库 lint 的 `sonarjs/super-linear-regex` 会把 `/\/+$/` 判成
 * 可回溯的超线性正则 —— 哪怕它实际上线性. 与其跟规则打架, 不如用一段显然正确的
 * 三行循环 (URL 末尾斜杠数量本来就个位数).
 *
 * @param url 原始地址
 * @returns 去掉末尾斜杠后的地址
 */
export function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charAt(end - 1) === '/') {
    end -= 1;
  }
  return url.slice(0, end);
}

/**
 * HTTP 探针装配入参.
 */
export interface HttpPsyGuardProbeOptions {
  /** Python 服务基地址 (例 `http://127.0.0.1:8100`; 末尾斜杠会被去掉). */
  readonly baseUrl: string;
  /**
   * 内部 HTTP 超时 (ms).
   *
   * 默认 = 内核 `DEFAULT_PROBE_TIMEOUT_MS` (150) —— **不另造常量**.
   * 它只用于提前掐断连接, 放宽它不会放宽内核的判定上限 (见文件头).
   */
  readonly timeoutMs?: number;
  /** 注入的 fetch 实现 (单测用; 缺省用全局 fetch). */
  readonly fetchImpl?: PsyGuardFetch;
}

/**
 * PsyGUARD HTTP 风险探测器 (实现内核 `RiskProbePort`).
 *
 * 纯类: 可脱离 Nest 容器 `new` 出来跑 (单测友好).
 */
export class HttpPsyGuardProbe implements RiskProbePort {
  private readonly logger = new Logger(HttpPsyGuardProbe.name);
  /** 基地址 (去掉末尾斜杠, 避免拼出 `//v1/classify`). */
  private readonly baseUrl: string;
  /** 内部 HTTP 超时 (ms). */
  private readonly timeoutMs: number;
  /** fetch 实现 (缺省全局 fetch). */
  private readonly fetchImpl: PsyGuardFetch;

  constructor(options: HttpPsyGuardProbeOptions) {
    this.baseUrl = stripTrailingSlashes(options.baseUrl.trim());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * 探测一段文本的风险信号.
   *
   * @param text 待判定文本
   * @param _side 检测面 (本探测器**两侧同判**: 危机语言不因说话人是谁而改变性质)
   * @returns 归一后的等级与危机类别
   * @throws Error 连接失败 / 超时 / 非 2xx / 非 JSON / 形状不合法
   */
  async probe(text: string, _side: SafetySide): Promise<RiskProbeResult> {
    const url = `${this.baseUrl}/v1/classify`;
    const trimmed = text.trim();
    if (!trimmed) {
      // 空文本不进网络: 探空是纯浪费, 且会让"服务挂掉"的日志被空转淹没.
      return { level: 'pass', categories: [] };
    }

    let response: Awaited<ReturnType<PsyGuardFetch>>;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`[WP11] PsyGUARD 探测失败(连接/超时), 回落本地规则: ${describeError(error)}`);
      throw error;
    }

    if (!response.ok) {
      this.logger.warn(`[WP11] PsyGUARD 探测返回 HTTP ${response.status}, 回落本地规则`);
      throw new Error(`PsyGUARD 探测返回 HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.logger.warn(`[WP11] PsyGUARD 响应不是合法 JSON, 回落本地规则: ${describeError(error)}`);
      throw new Error('PsyGUARD 响应不是合法 JSON');
    }

    const normalized = normalizePsyGuardResponse(payload);
    if (!normalized) {
      this.logger.warn('[WP11] PsyGUARD 响应形状不合法, 回落本地规则');
      throw new Error('PsyGUARD 响应形状不合法');
    }
    return normalized;
  }
}

/**
 * Python 服务的响应 → 内核 `RiskProbeResult`.
 *
 * **严格在哪 / 宽松在哪** (这个分寸很关键):
 *   - **level 严格**: 缺字段 / 非法值 → 整个响应不可信 → 返回 null (调用方抛错回落规则).
 *     level 是**载荷主体**, 它不可信时后面什么都没意义.
 *   - **categories 宽松**: 未知类别名**丢掉**, 不影响其余类别. Python 服务可能比
 *     内核新 (多一个标签), 这时"丢掉没见过的那个"远好于"整条判定作废".
 *     内核 `mergeVerdicts` 也会再过滤一次 —— 两层过滤是刻意的冗余, 不是重复.
 *   - **score 宽松**: 非数字 / 越界 → 省略 (内核只拿它做展示, 不做阈值判定).
 *
 * @param payload 服务返回的原始 JSON
 * @returns 归一结果; 形状不合法 → null
 */
export function normalizePsyGuardResponse(payload: unknown): RiskProbeResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const rawLevel = record['level'];
  if (typeof rawLevel !== 'string' || !WIRE_LEVELS.has(rawLevel)) return null;
  const level = WIRE_LEVEL_TO_SAFETY_LEVEL[rawLevel as PsyGuardWireLevel];
  if (!isSafetyLevel(level)) return null;

  const rawCategories = record['categories'];
  const categories: VisitorRiskCategory[] = [];
  if (Array.isArray(rawCategories)) {
    for (const item of rawCategories) {
      if (typeof item !== 'string') continue;
      if (!isVisitorRiskCategoryName(item)) continue;
      // 'neutral' 不是风险类别 (它表示"无关"), 不进类别清单.
      if (item === 'neutral') continue;
      if (!categories.includes(item)) categories.push(item);
    }
  }

  const rawScore = record['score'];
  const score = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 1 ? rawScore : undefined;

  return {
    level,
    categories,
    ...(score === undefined ? {} : { score }),
  };
}

/**
 * 探测超时归一 (从 env 字符串读, 不另造常量).
 *
 * ⚠️ **必须自己解析**: `ConfigService.get<number>(...)` 拿到的是**字符串**
 * (WP9-B 在 `LlmService` 上踩过: `'60000'` 一路传到 `AbortSignal.timeout` 直接抛
 * `The "delay" argument must be of type number` → 每次调用都炸). 这里显式 `Number()`
 * 并做边界检查, 非法值一律回退内核默认值.
 *
 * @param raw env 原始值 (可能是字符串 / undefined / 非法值)
 * @returns 合法超时 (ms)
 */
export function resolvePsyGuardTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PROBE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.floor(parsed);
}

/**
 * 错误描述 (统一一句, 不把整个堆栈塞进日志).
 *
 * @param error 捕获到的错误
 * @returns 可读描述
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
