/**
 * AF-013 / AF-015 · GUI 派发通道规则（adapter 层；纯规则 + 可注入接口位，零进程 / 剪贴板 IO）。
 *
 * 口径（设计备忘 §3 派发通道；框架 reliability.md §3/§4/§5/§6、human-in-the-loop.md §4）：
 *   - 进程自愈：派发前探测进程 / 窗口；未开启自动拉起，启动失败按预算重试；不可恢复才保持 ready、写审计并升级 Human；
 *   - 定位四层：健康检查 → 元素树 → 快捷键（Mini Chat → 新任务页）→ 粘贴 + 结果校验；逐层降级；
 *   - 会话降级链：旧会话追加（默认）→ Mini Chat 小窗 → 主窗口新建任务页；
 *   - 重试预算：任务级单一总尝试上限；会话 / 定位降级路径切换计一次尝试；可恢复故障指数退避；
 *   - 终态出口（对齐 reliability.md §4.1）：不可恢复类别直接 `failed` 不重试；可恢复重试耗尽保持 `held-ready` 升级 Human；
 *   - 失败定性（对齐 §4.2）：确定性缺陷 / 偶发波动 / 既有债三选一；既有债基线与本次改动分栏记录；
 *   - 逐次留痕：审计保留每次尝试的定位层、会话路径、原因、退避时长、结果与时间戳；
 *   - 熔断 / 死信为框架 §5 预留位，本版本不实现，通道侧不独立计数；
 *   - 审计与回执只留 taskId、路径、尝试次数、结果、时间戳、原因与定性，不含对话原文；
 *   - 单任务队列：一次只派一个 executor 任务，在办任务未回收不发下一个。
 *
 * 边界：真实进程探测、窗口操作、剪贴板、退避等待与发送由 CLI / relay 层经注入接口调用；本模块只做决策、
 * 降级选择、审计记录构造与路径成功率聚合，便于单测替身复现。
 */

/** 通道标识。 */
export const CHANNEL_GUI = 'gui';

/** 会话选择降级链（顺序即优先级）。 */
export const SESSION_PATHS = ['existing-session', 'mini-chat', 'new-task'];

/** 输入框定位四层（顺序即降级方向）。 */
export const LOCATE_LAYERS = ['health', 'element-tree', 'shortcut', 'paste-verify'];

/** 进程 / 窗口启动失败重试上限（含首次；分层内局部约束，受任务级总预算封顶）。 */
export const MAX_START_RETRIES = 1;

/** 发送失败换路径重试上限（含首次；分层内局部约束，受任务级总预算封顶）。 */
export const MAX_SEND_RETRIES = 1;

/**
 * 任务级总尝试预算（含首次；对齐 reliability.md §4.1 任务级单一限次）。
 * 会话降级路径切换、定位层切换均计一次尝试；分层内局部重试不突破本预算。
 */
export const MAX_TOTAL_ATTEMPTS = 3;

/**
 * 指数退避序列（毫秒；纯数据，实际等待由 relay 层执行，本模块不 sleep）。
 * 索引 0 = 首次尝试无退避；序列用尽后复用末位退避，不再线性叠加。
 */
export const BACKOFF_MS = [0, 500, 1000];

/** 不可恢复失败类别（对齐 reliability.md §4.1 框架四类；直接 `failed`，不重试）。 */
export const IRRECOVERABLE_CAUSES = ['contract-invalid', 'input-invalid', 'permission-denied', 'deterministic-defect'];

/** 失败定性三分法（对齐 reliability.md §4.2；既有债基线与本次改动分开记录）。 */
export const FAILURE_CLASSIFICATIONS = ['deterministic', 'flaky', 'legacy-debt'];

/** 任务在办状态（队列互斥判定口径，与 scheduler 状态机一致）。 */
export const ACTIVE_DISPATCH_STATUSES = ['submitted', 'working'];

/** 派发审计结果枚举。 */
export const DISPATCH_RESULTS = ['dispatched', 'failed', 'held-ready', 'human-escalated'];

/** 熔断扩展位（框架 reliability.md §5.1）：复用通用熔断口径，通道侧不另立独立计数。 */
export const CIRCUIT_BREAKER_RESERVED = {
  reserved: false,
  semantics: '同一通道连续失败达阈值后快速失败并升级为可观察事件；阈值与冷却期参数化，归任务级通用熔断',
};

/** 熔断默认参数（框架 §5.1 扩展位；可按仓在 config.circuitBreaker 覆盖）。 */
export const CIRCUIT_BREAKER_DEFAULTS = {
  consecutiveFailureThreshold: 3,
  cooldownMinutes: 10,
};

/**
 * IM-017 · 通道熔断判定（纯函数）。
 *
 * 口径：按**通道 + 连续失败次数**判定，不按任务累计重试次数——
 * 任务级预算（`MAX_TOTAL_ATTEMPTS`）回答「这单还能不能试」，
 * 熔断回答「这条通道现在还能不能用」。两者分开，避免一个坏通道把所有人的单都拖死，
 * 也避免同一任务的多次尝试被误当成通道故障。
 *
 * 输入取自运行态 `delivery`（`consecutiveFailures` 由 `fallbackDelivery` 递增），
 * 状态 `open` 表示该通道应快速失败、不再派发，需冷却期结束或人工复位。
 *
 * @param {{delivery?:object, channel?:string}} input
 * @param {{circuitBreaker?:object}} [config]
 * @returns {{state:'closed'|'open', channel:string|null, consecutiveFailures:number, threshold:number, reason:string|null}}
 */
export function evaluateCircuitBreaker(input = {}, config = {}) {
  const settings = { ...CIRCUIT_BREAKER_DEFAULTS, ...(config?.circuitBreaker ?? {}) };
  const threshold = Math.max(1, Number(settings.consecutiveFailureThreshold ?? 3));
  const channel = input.channel ?? input.delivery?.lastAttempt?.channel ?? null;
  const failures = Number(input.delivery?.consecutiveFailures ?? 0);
  if (failures >= threshold) {
    return {
      state: 'open',
      channel,
      consecutiveFailures: failures,
      threshold,
      reason: `通道 ${channel ?? 'unknown'} 连续失败 ${failures} 次，达阈值 ${threshold}，快速失败待冷却`,
    };
  }
  return { state: 'closed', channel, consecutiveFailures: failures, threshold, reason: null };
}

/** 死信预留位（框架 reliability.md §5）：本版本不实现隔离区，反复失败转人工并保留完整上下文。 */
export const DEAD_LETTER_RESERVED = {
  reserved: true,
  semantics: '反复失败的任务进入隔离区，附完整错误上下文与已尝试路径，转人工处理；不自动丢弃',
};

function nextInChain(chain, attempted) {
  for (const item of chain) {
    if (!attempted.includes(item)) return item;
  }
  return null;
}

/** 会话降级：返回下一条未尝试路径；链尾返回 null（应升级人工）。 */
export function nextSessionPath(attempted = []) {
  return nextInChain(SESSION_PATHS, attempted);
}

/** 定位层降级：返回下一层未尝试定位方式；链尾返回 null。 */
export function nextLocateLayer(attempted = []) {
  return nextInChain(LOCATE_LAYERS, attempted);
}

/** 是否不可恢复类别（对齐 reliability.md §4.1；直接 `failed`，不重试）。 */
export function isIrrecoverable(cause) {
  return IRRECOVERABLE_CAUSES.includes(cause);
}

/**
 * 第 attemptIndex 次尝试对应的退避毫秒（纯数据查询，不 sleep）。
 * 索引 0 无退避；序列用尽后复用末位退避。
 */
export function nextBackoff(attemptIndex = 0) {
  const idx = Math.max(0, Math.min(attemptIndex, BACKOFF_MS.length - 1));
  return BACKOFF_MS[idx];
}

/**
 * 单任务队列判定：在办（submitted / working）任务中除自身外无其他任务时才可派发。
 * @param {{tasks?: Array<{taskId:string,status:string}>}} index
 * @param {string} taskId 待派发任务自身标识
 */
export function canDispatch(index, taskId) {
  const active = (index?.tasks ?? []).filter((t) => ACTIVE_DISPATCH_STATUSES.includes(t.status) && t.taskId !== taskId);
  return { allowed: active.length === 0, blockers: active.map((t) => t.taskId) };
}

/**
 * 派发决策（纯规则）。终态出口对齐 reliability.md §4.1：不可恢复直接 `failed` 不重试；
 * 可恢复故障在任务级预算内降级重试，耗尽保持 `held-ready` 升级 Human（不直接 `failed`）。
 * @param {{
 *   processRunning: boolean, windowReady: boolean, startRetries: number, sendRetries: number,
 *   loginGate: boolean, sessionAttempted?: string[], locateAttempted?: string[],
 *   cause?: string, attemptCount?: number
 * }} input
 * @returns {{action:string, result:string|null, reason:string, cause?:string, sessionPath?:string, layer?:string, retries?:number, backoffMs?:number}}
 */
export function resolveDispatchDecision(input) {
  const sessionAttempted = input.sessionAttempted ?? [];
  const locateAttempted = input.locateAttempted ?? [];
  const startRetries = input.startRetries ?? 0;
  const sendRetries = input.sendRetries ?? 0;
  const attemptCount = input.attemptCount ?? 0;

  // 登录门最高优先：认证未完成先交人工接管；登录解除后再按失败类别判定终态。
  if (input.loginGate === true) {
    return { action: 'human-login', result: 'human-escalated', reason: '登录门须人工接管完成认证；脚本不自行填账号密码或凭证' };
  }
  // 不可恢复类别短路：直接终态 failed，不进入重试 / 降级链。
  if (isIrrecoverable(input.cause)) {
    return {
      action: 'fail-terminal',
      result: 'failed',
      cause: input.cause,
      reason: `不可恢复类别（${input.cause}），按 reliability.md §4.1 直接置 failed，不重试`,
    };
  }
  // 任务级总预算封顶：降级路径切换计一次尝试；预算耗尽保持 ready 升级人工。
  if (attemptCount >= MAX_TOTAL_ATTEMPTS) {
    return {
      action: 'human-escalate',
      result: 'held-ready',
      reason: `任务级尝试预算耗尽（${MAX_TOTAL_ATTEMPTS} 次），保持任务 ready 并升级 Human`,
      retries: attemptCount,
    };
  }
  if (input.processRunning !== true) {
    if (startRetries < MAX_START_RETRIES)
      return {
        action: 'start-process',
        result: null,
        reason: '执行代理进程未开启，自动拉起',
        retries: startRetries,
        backoffMs: nextBackoff(attemptCount),
      };
    return {
      action: 'human-escalate',
      result: 'held-ready',
      reason: `执行代理进程启动失败达局部重试上限（${MAX_START_RETRIES}），保持任务 ready 并升级 Human`,
    };
  }
  if (input.windowReady !== true) {
    if (startRetries < MAX_START_RETRIES)
      return {
        action: 'relaunch-window',
        result: null,
        reason: '窗口未就绪，重新聚焦 / 拉起',
        retries: startRetries,
        backoffMs: nextBackoff(attemptCount),
      };
    return {
      action: 'human-escalate',
      result: 'held-ready',
      reason: `执行代理窗口不可恢复达局部重试上限（${MAX_START_RETRIES}），升级 Human`,
    };
  }
  const layer = nextLocateLayer(locateAttempted);
  if (layer !== null) {
    return { action: 'locate', result: null, reason: `按定位层降级：${layer}`, layer };
  }
  if (sendRetries < MAX_SEND_RETRIES) {
    const sessionPath = nextSessionPath(sessionAttempted);
    if (sessionPath !== null)
      return {
        action: 'send',
        result: null,
        reason: '定位完成，沿会话降级链发送',
        sessionPath,
        retries: sendRetries,
        backoffMs: nextBackoff(attemptCount),
      };
    return { action: 'human-escalate', result: 'held-ready', reason: '会话降级链已走完且发送仍未成功，升级 Human' };
  }
  return {
    action: 'human-escalate',
    result: 'held-ready',
    reason: `发送失败达局部重试上限（${MAX_SEND_RETRIES}），保持任务 ready 并升级 Human`,
  };
}

/**
 * 校验单次尝试留痕条目（逐次重试留痕载体，对齐 reliability.md §4.1「每次重试留痕」）。
 * @param {object} entry
 * @param {string[]} errors 累积错误
 */
function validateAttemptEntry(entry, errors) {
  if (entry?.sessionPath && !SESSION_PATHS.includes(entry.sessionPath)) errors.push(`逐次留痕会话路径非法：${entry.sessionPath}`);
  if (entry?.locateLayer && !LOCATE_LAYERS.includes(entry.locateLayer)) errors.push(`逐次留痕定位层非法：${entry.locateLayer}`);
  if (entry?.result && !DISPATCH_RESULTS.includes(entry.result)) errors.push(`逐次留痕 result 非法：${entry.result}`);
  if (entry?.backoffMs !== undefined && entry?.backoffMs !== null && (!Number.isInteger(entry.backoffMs) || entry.backoffMs < 0))
    errors.push('逐次留痕 backoffMs 须为非负整数或 null');
}

/**
 * 构造派发审计记录。只接收路径、计数、结果、定性与原因；不接收消息正文，杜绝对话原文落审计。
 * @param {{taskId:string, contextId?:string, channel?:string, sessionPath?:string,
 *   locateLayer?:string, attempt:number, result:string, reason?:string, timestamp?:string,
 *   classification?:string, baseline?:{legacyDebt?:string, changeIntroduced?:string},
 *   attempts?:Array<object>}} record
 * @returns {{valid:boolean, errors:string[], audit:object|null}}
 */
export function buildDispatchAudit(record) {
  const errors = [];
  if (!record?.taskId) errors.push('审计记录缺 taskId');
  if (!Number.isInteger(record?.attempt) || record.attempt < 0) errors.push('审计记录 attempt 须为非负整数');
  if (!DISPATCH_RESULTS.includes(record?.result)) errors.push(`审计记录 result 非法：${String(record?.result)}`);
  if (record?.sessionPath && !SESSION_PATHS.includes(record.sessionPath)) errors.push(`会话路径非法：${record.sessionPath}`);
  if (record?.locateLayer && !LOCATE_LAYERS.includes(record.locateLayer)) errors.push(`定位层非法：${record.locateLayer}`);
  if (record?.classification && !FAILURE_CLASSIFICATIONS.includes(record.classification))
    errors.push(`失败定性非法：${record.classification}`);
  if (record?.baseline !== undefined && record?.baseline !== null) {
    if (typeof record.baseline !== 'object' || Array.isArray(record.baseline))
      errors.push('baseline 须为对象 {legacyDebt, changeIntroduced}');
    else {
      for (const key of ['legacyDebt', 'changeIntroduced']) {
        if (record.baseline[key] !== undefined && record.baseline[key] !== null && typeof record.baseline[key] !== 'string')
          errors.push(`baseline.${key} 须为字符串或 null`);
      }
    }
  }
  if (record?.attempts !== undefined && record?.attempts !== null) {
    if (!Array.isArray(record.attempts)) errors.push('attempts 须为数组');
    else record.attempts.forEach((entry) => validateAttemptEntry(entry, errors));
  }
  if (errors.length > 0) return { valid: false, errors, audit: null };

  const baseline = record.baseline ?? null;
  const attempts = Array.isArray(record.attempts)
    ? record.attempts.map((entry) => ({
        sessionPath: entry?.sessionPath ?? null,
        locateLayer: entry?.locateLayer ?? null,
        reason: entry?.reason ?? null,
        backoffMs: entry?.backoffMs ?? null,
        result: entry?.result ?? null,
        timestamp: entry?.timestamp ?? null,
      }))
    : [];

  return {
    valid: true,
    errors: [],
    audit: {
      taskId: record.taskId,
      contextId: record.contextId ?? null,
      channel: record.channel ?? CHANNEL_GUI,
      sessionPath: record.sessionPath ?? null,
      locateLayer: record.locateLayer ?? null,
      attempt: record.attempt,
      result: record.result,
      reason: record.reason ?? null,
      classification: record.classification ?? null,
      baseline: baseline ? { legacyDebt: baseline.legacyDebt ?? null, changeIntroduced: baseline.changeIntroduced ?? null } : null,
      attempts,
      timestamp: record.timestamp ?? new Date().toISOString(),
    },
  };
}

/**
 * 汇总各会话路径成功率（供通道规则备忘统计；不涉及消息正文）。
 * @param {Array<{sessionPath:string|null, result:string}>} records
 * @returns {Array<{sessionPath:string, attempted:number, dispatched:number, failed:number, successRate:number|null}>}
 */
export function summarizeChannelOutcomes(records = []) {
  const byPath = new Map();
  for (const path of SESSION_PATHS) byPath.set(path, { attempted: 0, dispatched: 0, failed: 0 });
  for (const rec of records) {
    if (!rec.sessionPath || !byPath.has(rec.sessionPath)) continue;
    const bucket = byPath.get(rec.sessionPath);
    bucket.attempted += 1;
    if (rec.result === 'dispatched') bucket.dispatched += 1;
    else if (rec.result === 'failed' || rec.result === 'held-ready' || rec.result === 'human-escalated') bucket.failed += 1;
  }
  return SESSION_PATHS.map((sessionPath) => {
    const bucket = byPath.get(sessionPath);
    return {
      sessionPath,
      attempted: bucket.attempted,
      dispatched: bucket.dispatched,
      failed: bucket.failed,
      successRate: bucket.attempted === 0 ? null : bucket.dispatched / bucket.attempted,
    };
  });
}

/**
 * 构造升级消息（对齐 human-in-the-loop.md §4 标准字段）。
 * @param {{taskId:string, contextId?:string, currentStatus:string, attemptedPaths:Array<{path:string, conclusion:string}>,
 *   failureEvidence:Array<object>, options:Array<object>, recommendedDecision:string}} msg
 * @returns {{valid:boolean, errors:string[], message:object|null}}
 */
export function buildEscalationMessage(msg) {
  const errors = [];
  if (!msg?.taskId) errors.push('升级消息缺 taskId');
  if (!msg?.currentStatus) errors.push('升级消息缺 currentStatus');
  if (!Array.isArray(msg?.attemptedPaths) || msg.attemptedPaths.length === 0) errors.push('升级消息缺 attemptedPaths');
  if (!Array.isArray(msg?.failureEvidence) || msg.failureEvidence.length === 0) errors.push('升级消息缺 failureEvidence（须含可复现数字）');
  if (!Array.isArray(msg?.options) || msg.options.length < 2) errors.push('升级消息 options 至少两条');
  if (!msg?.recommendedDecision) errors.push('升级消息缺 recommendedDecision（单一决定点）');
  if (errors.length > 0) return { valid: false, errors, message: null };

  return {
    valid: true,
    errors: [],
    message: {
      taskId: msg.taskId,
      contextId: msg.contextId ?? null,
      currentStatus: msg.currentStatus,
      attemptedPaths: msg.attemptedPaths,
      failureEvidence: msg.failureEvidence,
      options: msg.options,
      recommendedDecision: msg.recommendedDecision,
    },
  };
}
