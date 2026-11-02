// V2026-10-30 治本 (WP24 · 单场成本日志):
//   职责: 把"本场每轮的 LLM 用量"累加成整场汇总, 并按可配定价折算成预估费用.
//   边界: **纯函数 + 纯数据**, 零 @nestjs/* / typeorm / IO / 日志.
//         日志的"打"由调用方 (engine-stream-backend.adapter) 负责 ——
//         这里只回答"这场花了多少", 不管谁来问.
//
//   为什么单独成文件 (而不是塞进 adapter):
//     ① 成本口径是**要被人引用、要能单测断言**的东西 —— 定价换算、
//        输入/输出分档、"上游没报 promptTokens 时怎么办", 这些都是纯逻辑,
//        埋在 adapter 里就只能靠跑整条链路来验.
//     ② "成本口径"与"成本日志"是两件事: 前者是算, 后者是打.
//        混在一起会出现"想复用成本计算却没有日志"或"想改日志格式却被成本逻辑绑住".
//
//   为什么 costBasis 是一等字段 (而不是一句注释):
//     上游**流式**路径只给累计 tokenCount, 没有 prompt/completion 拆分 ——
//     于是输入侧用量**不可得**. 这时若照样报一个"estimatedCostCny",
//     读日志的人会以为那就是全场成本, 而它其实**只含输出侧**, 系统性偏低.
//     所以口径必须**写在数据里**: costBasis='full' (输入输出都计) /
//     'output_only' (只计输出侧, 输入侧不可得).
//     一个数带不清的口径, 不该只靠"看文档的人记得"来解释.
//
//   反双胞胎:
//     - 不在这里打日志: 本文件不 import Logger.
//     - 不在这里读 env: 定价由装配层注入 (纯函数收参数, 不读全局).
//     - 不把"拿不到 promptTokens"当成 0 来算输入侧: 那是**编造** ——
//       口径必须落成 output_only, 而不是把输入侧悄悄算成 0.
//     - 不做按用户/按租户汇总: 那是 WP22 / Phase2 的事, 本单只做单场.
//     - 不做告警与看板: 本单只打一条结构化日志.

/**
 * 单价 (元 / 千 token).
 *
 * 为什么要 env 可配 (而不是写死在代码里):
 *   厂商调价是**外部事实**, 写死在代码里意味着每次调价都要发一次版.
 *   本单把两个单价做成 env, 装配层注入进来 —— 定价表换版只改配置.
 */
export interface SessionCostPricing {
  /** 输入单价 (元 / 千 token). */
  readonly inputPer1k: number;
  /** 输出单价 (元 / 千 token). */
  readonly outputPer1k: number;
}

/**
 * 默认单价 (MiniMax Token Plan 口径; 与 `.env.example` 的默认值同源).
 *
 * ⚠️ 这是**工程默认值**, 不是与厂商合同核对过的报价 —— 真正计费以厂商账单为准.
 *    本单的用途是"内测期防烧额度", 量级够用即可; 上生产前应对一遍当期报价.
 */
export const DEFAULT_SESSION_COST_PRICING: SessionCostPricing = {
  inputPer1k: 0.0015,
  outputPer1k: 0.0045,
};

/**
 * 单轮用量增量 (从渲染结果里取到的口径).
 *
 * 全部可选: 不同上游给的东西不一样, 缺的就是"不可得", **不补零、不编造**.
 */
export interface SessionUsageDelta {
  /** 输入 token (缺省 = 上游没报). */
  readonly promptTokens?: number;
  /** 输出 token. */
  readonly completionTokens?: number;
  /** 总 token (上游口径). */
  readonly totalTokens?: number;
  /** 思考 token (推理模型专用; WP9-C 已单列). */
  readonly reasoningTokens?: number;
  /** 本轮实际用的模型名 (缺省 = 上游没报). */
  readonly model?: string;
}

/**
 * 本场累计用量.
 */
export interface SessionUsageTotals {
  /** 本场轮数 (每轮记一次). */
  readonly turnCount: number;
  /** 输入 token 累计 (上游没报时恒 0, 且 promptTokensAvailable=false). */
  readonly promptTokens: number;
  /** 输出 token 累计. */
  readonly completionTokens: number;
  /** 总 token 累计 (上游口径). */
  readonly totalTokens: number;
  /** 思考 token 累计. */
  readonly reasoningTokens: number;
  /** 输入侧用量是否可得 (上游报过 promptTokens). */
  readonly promptTokensAvailable: boolean;
  /** 本场用过的模型名 (最后一次; 缺省 = 上游没报). */
  readonly model?: string;
}

/**
 * 成本口径.
 *
 * - `full`: 输入侧与输出侧都计入了 —— 成本是全场成本.
 * - `output_only`: **只计了输出侧** —— 上游没报输入侧用量, 成本是全场成本的**下界**.
 */
export type SessionCostBasis = 'full' | 'output_only';

/**
 * 空的累计量 (一场会话的起点).
 */
export function emptySessionUsageTotals(): SessionUsageTotals {
  return {
    turnCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    promptTokensAvailable: false,
  };
}

/**
 * 累加一轮用量.
 *
 * 纯函数: 不改传入对象, 返回新的累计量 (调用方负责替换).
 *
 * `promptTokensAvailable` 的口径: **本场只要有一轮报了输入侧, 就算可得**.
 * 反过来, 一轮都没报 → 不可得 → 成本按 output_only 算.
 *
 * 为什么不用"总 token 减输出 token"倒推输入侧:
 *   ① 流式路径上游给的是**累计** tokenCount, total 与 completion 本就是同一个数,
 *      倒推出来恒等于 0 —— 那不是"输入侧为零", 是"输入侧不可得", 两者意义完全不同;
 *   ② 聚合路径下 total 还含思考 token, 倒推会把思考量算进输入侧.
 *   仓库既有纪律是"不编造" (`llm-render.adapter.ts` 流式路径同样只映射拿得到的字段),
 *   这里必须守住同一条.
 *
 * @param totals 当前累计量
 * @param delta 本轮用量
 * @returns 新的累计量
 */
export function accumulateSessionUsage(totals: SessionUsageTotals, delta: SessionUsageDelta): SessionUsageTotals {
  const promptAvailable = totals.promptTokensAvailable || delta.promptTokens !== undefined;
  const model = delta.model ?? totals.model;
  return {
    turnCount: totals.turnCount + 1,
    promptTokens: totals.promptTokens + (delta.promptTokens ?? 0),
    completionTokens: totals.completionTokens + (delta.completionTokens ?? 0),
    totalTokens: totals.totalTokens + (delta.totalTokens ?? 0),
    reasoningTokens: totals.reasoningTokens + (delta.reasoningTokens ?? 0),
    promptTokensAvailable: promptAvailable,
    ...(model === undefined ? {} : { model }),
  };
}

/**
 * 折算预估费用.
 *
 * @param totals 本场累计量
 * @param pricing 单价 (元 / 千 token)
 * @returns 预估费用 + 口径
 */
export function estimateSessionCost(
  totals: SessionUsageTotals,
  pricing: SessionCostPricing,
): { readonly estimatedCostCny: number; readonly costBasis: SessionCostBasis } {
  const outputCost = (totals.completionTokens / 1000) * pricing.outputPer1k;
  if (!totals.promptTokensAvailable) {
    // 输入侧不可得 → 只报输出侧, 并**明说**这是下界 (不拿 0 冒充输入侧开销).
    return { estimatedCostCny: roundCost(outputCost), costBasis: 'output_only' };
  }
  const inputCost = (totals.promptTokens / 1000) * pricing.inputPer1k;
  return { estimatedCostCny: roundCost(inputCost + outputCost), costBasis: 'full' };
}

/**
 * 成本汇总 (日志里 `session_cost_summary` 那条的形状).
 */
export interface SessionCostSummary {
  /** 事件名 (grep 用). */
  readonly event: 'session_cost_summary';
  readonly sessionId: string;
  /** 本场模型名 (上游没报 = null). */
  readonly model: string | null;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostCny: number;
  /** 成本口径 (见 SessionCostBasis). */
  readonly costBasis: SessionCostBasis;
  readonly turnCount: number;
  /** 走的哪条链路 (本单恒为 'bdi' —— 新引擎路径). */
  readonly enginePath: string;
}

/**
 * 构造成本汇总.
 *
 * @param params 入参
 * @returns 成本汇总
 */
export function buildSessionCostSummary(params: {
  readonly sessionId: string;
  readonly totals: SessionUsageTotals;
  readonly pricing: SessionCostPricing;
  readonly enginePath: string;
}): SessionCostSummary {
  const cost = estimateSessionCost(params.totals, params.pricing);
  return {
    event: 'session_cost_summary',
    sessionId: params.sessionId,
    model: params.totals.model ?? null,
    totalPromptTokens: params.totals.promptTokens,
    totalCompletionTokens: params.totals.completionTokens,
    totalTokens: params.totals.totalTokens,
    estimatedCostCny: cost.estimatedCostCny,
    costBasis: cost.costBasis,
    turnCount: params.totals.turnCount,
    enginePath: params.enginePath,
  };
}

/**
 * 成本保留 6 位小数 (元).
 *
 * 为什么不是原样输出: token 数除以 1000 再乘单价的量级在 1e-4 ~ 1e-2 之间,
 * 浮点尾数会让同一次会话两次打出的字符串长得不一样 —— 日志要能被 diff, 就要定点.
 */
function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * 从 env 原始值解析单价.
 *
 * 非法值 (空串 / 非数字 / 负数) → **回退默认, 不抛**:
 *   定价是观测增强, 配错一个 env 不该让服务起不来 —— 与仓库既有的
 *   `resolveMemoryConfig` 同一口径 (非法值回退, 不抛).
 *
 * @param raw env 原始值 (缺省 / undefined = 用默认)
 * @returns 单价
 */
export function resolveSessionCostPricing(raw: {
  readonly inputPer1k?: string | undefined;
  readonly outputPer1k?: string | undefined;
}): SessionCostPricing {
  return {
    inputPer1k: parsePrice(raw.inputPer1k, DEFAULT_SESSION_COST_PRICING.inputPer1k),
    outputPer1k: parsePrice(raw.outputPer1k, DEFAULT_SESSION_COST_PRICING.outputPer1k),
  };
}

/**
 * 解析一个单价 (非法 → 回退).
 */
function parsePrice(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
