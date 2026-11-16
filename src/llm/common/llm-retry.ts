// V2026-11-09 治本 (Phase2.5 WP-H · 改动 3): LLM 上游重试策略 (显式 · 有界 · 可单测).
//   职责: 回答两个问题 —— 「这次失败该不该重试」与「重试前等多久」.
//   边界: 纯 TS + 可注入时钟/随机源, 零 IO / 零 @nestjs / 零网络 / 零 env.
//
//   为什么需要这个文件 (而不是"直接依赖 SDK 的重试"):
//     1. 渲染链路 (ChatOpenAI → LangChain AsyncCaller) 的隐式重试是 **maxRetries=6**,
//        且 **OpenAI SDK 层被 LangChain 置 maxRetries=0** —— 于是"重试策略"既不显式、
//        也不可配、也没有单测覆盖.
//     2. 更要命的是**它不看我们的截止时间**: 适配器 30s 超时后放弃, 那条 6 次退避链
//        仍在后台继续打上游 (「幽灵重试」) —— 上游越限流, 我们自己加压越多.
//     3. 「哪些错误该重试」的判定散落在 SDK 内部: 401/400 不重试是对的, 但没人能
//        回答"我们这次到底重试了几次、为什么".
//     所以这里把策略**显式化**: 单一真相 + 单一执行点 + 单一可测口径.
//
//   口径 (与任务单 §五 改动 3 一致):
//     · 可重试: 429 (限流) / 5xx (上游故障) / 408 与网络超时 / 连接重置;
//     · 不可重试: 401 / 403 (坏 key) / 400 / 404 / 422 (参数错) —— 重试只会放大延迟;
//     · 退避: 指数退避 500ms → 1.5s → 4s + 随机抖动 (±25%), 避免整批请求同频重试.
//     · 中止: 调用方给了 signal 且已中止 → **立刻不再重试** (这一条是"幽灵重试"的解药).
//
//   反双胞胎:
//     - 不在这里读 env / 不在这里定"重试几次": 次数与退避基数由调用方注入 (默认值在本文件),
//       于是同一个策略能被 llm 层与单测共用, 不产生第二份真相.
//     - 不吞异常: 重试用尽后**原样上抛**最后一个错误 —— 上层 (渲染适配器) 要靠它判
//       "该不该切备 / 该不该记熔断", 吞掉就等于把失败藏起来.
//     - 不把"重试"与"切备候选"混成一层: 同一候选重试与换候选是两件事 —— 前者是
//       上游抖了, 后者是这个候选本身不行. 混在一起会让熔断器背错锅.

/**
 * 退避基数序列 (ms) — 第 n 次重试等 base[n-1] (超出则取最后一个).
 *
 * 为什么是 500 / 1500 / 4000 而不是纯指数 (500 / 1000 / 2000):
 *   上游限流通常持续**秒级**, 纯指数退避在第 3 次只等了 2s, 很可能又撞上同一波限流;
 *   拉长到 4s 能多覆盖一段限流窗口, 而单轮渲染的截止时间 (30s) 仍留得住 3 次尝试.
 */
export const LLM_RETRY_BASE_DELAYS_MS: readonly number[] = [500, 1500, 4000];

/** 默认最大重试次数 (2 次重试 = 总共 3 次尝试). */
export const DEFAULT_LLM_MAX_RETRIES = 2;

/**
 * 默认的**客户端**单次请求超时 (ms).
 *
 * 缺省为什么是 60s 而不是"不下发": 不下发时上游 SDK 用自己的默认 (10 分钟),
 * 一个卡住的上游请求就会挂 10 分钟 —— 批量跑批时这等于整批卡死.
 * 60s 高于渲染路径自己的预算 (30s, 由适配器 + 中止信号兜底), 因此不会误伤正常轮次.
 */
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 60_000;

/** 抖动比例 (0~1): 在退避基数上叠加 ±比例 的随机偏移. */
export const LLM_RETRY_JITTER_RATIO = 0.25;

/** 可重试的网络层错误码 (连接被重置 / 超时 / DNS 抖动). */
const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * 网络层错误的兜底文案特征 (错误码缺失时看文案).
 *
 * 为什么需要文案兜底: Node fetch 抛的是 `TypeError: fetch failed`, 真正的
 * `code` 藏在 `cause` 里 —— 只看顶层就判不出"这是网络抖动, 该重试".
 */
const RETRYABLE_MESSAGE_PATTERN = /timeout|timed out|socket hang up|fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i;

/**
 * 从任意错误形状里取 HTTP 状态码 (有则用).
 *
 * @param error 错误对象
 * @returns 状态码; 取不到则 undefined
 */
function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const raw = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * 取错误码 (顶层 code, 或 cause.code).
 *
 * @param error 错误对象
 * @returns 错误码字符串; 取不到则 undefined
 */
function extractCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  const raw = candidate.code ?? candidate.cause?.code;
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * 取错误文案.
 *
 * @param error 错误对象
 * @returns 文案; 取不到则空串
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

/**
 * 是否是"调用方主动中止"的错误 (AbortError).
 *
 * 中止**不是**上游故障, 重试它等于无视调用方的放弃决定 —— 这是幽灵重试的另一半.
 *
 * @param error 错误对象
 * @returns 是否中止错误
 */
export function isLlmAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return true;
  const message = extractMessage(error);
  return /abort/i.test(message) && !/abort.*retry/i.test(message);
}

/**
 * 这次失败是否值得重试.
 *
 * @param error 错误对象
 * @returns true = 可重试 (429 / 5xx / 408 / 网络抖动); false = 不可重试 (鉴权 / 参数错 / 中止)
 */
export function isRetryableLlmError(error: unknown): boolean {
  if (isLlmAbortError(error)) return false;

  const status = extractStatus(error);
  if (status !== undefined) {
    if (status === 408 || status === 429) return true;
    if (status >= 500) return true;
    // 其余 4xx 一律不重试: 401/403 是 key 的问题, 400/404/422 是请求本身的问题,
    // 重试只是把同一次失败放大成 N 次延迟. 兜底方向是保守 —— 宁可少重试不可乱重试.
    return false;
  }

  const code = extractCode(error);
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return true;

  // LangChain 把 429 包装成带 lc_error_code 的错误, 状态码未必还在.
  const lcCode = (error as { lc_error_code?: unknown }).lc_error_code;
  if (lcCode === 'MODEL_RATE_LIMIT') return true;

  return RETRYABLE_MESSAGE_PATTERN.test(extractMessage(error));
}

/**
 * 第 n 次重试的等待时长 (ms) = 退避基数 + 随机抖动.
 *
 * 抖动为什么必须有: 批量跑批时几十个请求**同时**失败, 不抖动就是同时重试 =
 * 再造一次同频尖峰 —— 那正是限流的成因.
 *
 * @param attemptIndex 已重试次数 (0 = 第一次重试)
 * @param baseDelaysMs 退避基数序列
 * @param random 随机源 (单测注入确定性随机)
 * @returns 等待毫秒
 */
export function computeLlmRetryDelayMs(
  attemptIndex: number,
  baseDelaysMs: readonly number[] = LLM_RETRY_BASE_DELAYS_MS,
  random: () => number = Math.random,
): number {
  const fallback = baseDelaysMs.at(-1) ?? 0;
  const base = baseDelaysMs[Math.min(Math.max(attemptIndex, 0), baseDelaysMs.length - 1)] ?? fallback;
  const jitter = (random() * 2 - 1) * LLM_RETRY_JITTER_RATIO * base;
  return Math.max(0, Math.round(base + jitter));
}

/**
 * 重试执行选项.
 */
export interface LlmRetryOptions {
  /** 最大重试次数 (0 = 不重试). */
  readonly maxRetries?: number;
  /** 退避基数序列 (缺省 `LLM_RETRY_BASE_DELAYS_MS`). */
  readonly baseDelaysMs?: readonly number[];
  /** 中止信号 (调用方放弃 → 立刻停止重试). */
  readonly signal?: AbortSignal;
  /** 随机源 (单测注入确定性随机). */
  readonly random?: () => number;
  /** 睡眠实现 (单测注入即时返回). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 每次重试的回调 (观测用; 只应打状态码/错误类型名, 不打内容). */
  readonly onRetry?: (info: { readonly attempt: number; readonly delayMs: number; readonly error: unknown }) => void;
}

/**
 * 带显式退避的重试执行.
 *
 * 语义:
 *   · 成功即返回;
 *   · 失败且**不可重试** → 原样上抛 (不吞);
 *   · 失败且可重试但次数用尽 → 原样上抛**最后一个**错误;
 *   · 调用方 signal 已中止 → 不再重试, 原样上抛.
 *
 * @param fn 实际调用 (收到已重试次数, 便于打日志)
 * @param options 重试选项
 * @returns 调用结果
 */
export async function runWithLlmRetry<T>(fn: (attempt: number) => Promise<T>, options: LlmRetryOptions = {}): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_LLM_MAX_RETRIES);
  const baseDelaysMs = options.baseDelaysMs ?? LLM_RETRY_BASE_DELAYS_MS;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      if (!isRetryableLlmError(error)) throw error;
      if (options.signal?.aborted) throw error;

      const delayMs = computeLlmRetryDelayMs(attempt, baseDelaysMs, options.random);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleepForRetry(delayMs, options);
      attempt += 1;
    }
  }
}

/**
 * 退避等待 (可被中止信号打断).
 *
 * @param delayMs 等待毫秒
 * @param options 重试选项
 */
async function sleepForRetry(delayMs: number, options: LlmRetryOptions): Promise<void> {
  if (options.signal?.aborted) throw new Error('LLM 重试已中止 (调用方放弃)');
  if (options.sleep) {
    await options.sleep(delayMs);
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, delayMs));
    // 不吊住事件循环: 单测与进程收尾都不该被一个退避计时器拖住.
    timer.unref();
  });
  if (options.signal?.aborted) throw new Error('LLM 重试已中止 (调用方放弃)');
}
