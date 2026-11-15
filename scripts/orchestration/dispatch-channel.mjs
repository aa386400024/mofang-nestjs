/**
 * AF-013 · GUI 派发通道规则（adapter 层；纯规则 + 可注入接口位，零进程 / 剪贴板 IO）。
 *
 * 口径（设计备忘 §3 派发通道；框架 reliability.md §3/§4/§6、human-in-the-loop.md §4）：
 *   - 进程自愈：派发前探测进程 / 窗口；未开启自动拉起，启动失败重试一次；不可恢复才保持 ready、写审计并升级 Human；
 *   - 定位四层：健康检查 → 元素树 → 快捷键（Mini Chat → 新任务页）→ 粘贴 + 结果校验；逐层降级；
 *   - 会话降级链：旧会话追加（默认）→ Mini Chat 小窗 → 主窗口新建任务页；
 *   - 发送失败只重试一次（换路径）；登录门交人工接管，不自行填凭证；
 *   - 审计与回执只留 taskId、路径、尝试次数、结果、时间戳与原因，不含对话原文；
 *   - 单任务队列：一次只派一个 executor 任务，在办任务未回收不发下一个。
 *
 * 边界：真实进程探测、窗口操作、剪贴板与发送由 CLI / relay 层经注入接口调用；本模块只做决策、
 * 降级选择、审计记录构造与路径成功率聚合，便于单测替身复现。
 */

/** 通道标识。 */
export const CHANNEL_GUI = 'gui';

/** 会话选择降级链（顺序即优先级）。 */
export const SESSION_PATHS = ['existing-session', 'mini-chat', 'new-task'];

/** 输入框定位四层（顺序即降级方向）。 */
export const LOCATE_LAYERS = ['health', 'element-tree', 'shortcut', 'paste-verify'];

/** 进程 / 窗口启动失败重试上限（含首次）。 */
export const MAX_START_RETRIES = 1;

/** 发送失败换路径重试上限（含首次）。 */
export const MAX_SEND_RETRIES = 1;

/** 任务在办状态（队列互斥判定口径，与 scheduler 状态机一致）。 */
export const ACTIVE_DISPATCH_STATUSES = ['submitted', 'working'];

/** 派发审计结果枚举。 */
export const DISPATCH_RESULTS = ['dispatched', 'failed', 'held-ready', 'human-escalated'];

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
 * 派发决策（纯规则）。
 * @param {{
 *   processRunning: boolean, windowReady: boolean, startRetries: number, sendRetries: number,
 *   loginGate: boolean, sessionAttempted?: string[], locateAttempted?: string[]
 * }} input
 * @returns {{action:string, reason:string, sessionPath?:string, layer?:string, retries?:number}}
 */
export function resolveDispatchDecision(input) {
  const sessionAttempted = input.sessionAttempted ?? [];
  const locateAttempted = input.locateAttempted ?? [];
  const startRetries = input.startRetries ?? 0;
  const sendRetries = input.sendRetries ?? 0;

  if (input.loginGate === true) {
    return { action: 'human-login', reason: '登录门须人工接管完成认证；脚本不自行填账号密码或凭证' };
  }
  if (input.processRunning !== true) {
    if (startRetries < MAX_START_RETRIES) return { action: 'start-process', reason: '执行代理进程未开启，自动拉起', retries: startRetries };
    return { action: 'human-escalate', reason: `执行代理进程启动失败达重试上限（${MAX_START_RETRIES}），保持任务 ready 并升级 Human` };
  }
  if (input.windowReady !== true) {
    if (startRetries < MAX_START_RETRIES)
      return { action: 'relaunch-window', reason: '窗口未就绪，重新聚焦 / 拉起', retries: startRetries };
    return { action: 'human-escalate', reason: `执行代理窗口不可恢复达重试上限（${MAX_START_RETRIES}），升级 Human` };
  }
  const layer = nextLocateLayer(locateAttempted);
  if (layer !== null) {
    return { action: 'locate', reason: `按定位层降级：${layer}`, layer };
  }
  if (sendRetries < MAX_SEND_RETRIES) {
    const sessionPath = nextSessionPath(sessionAttempted);
    if (sessionPath !== null) return { action: 'send', reason: '定位完成，沿会话降级链发送', sessionPath, retries: sendRetries };
    return { action: 'human-escalate', reason: '会话降级链已走完且发送仍未成功，升级 Human' };
  }
  return { action: 'human-escalate', reason: `发送失败达重试上限（${MAX_SEND_RETRIES}），保持任务 ready 并升级 Human` };
}

/**
 * 构造派发审计记录。只接收路径、计数、结果与原因；不接收消息正文，杜绝对话原文落审计。
 * @param {{taskId:string, contextId?:string, channel?:string, sessionPath?:string,
 *   locateLayer?:string, attempt:number, result:string, reason?:string, timestamp?:string}} record
 * @returns {{valid:boolean, errors:string[], audit:object|null}}
 */
export function buildDispatchAudit(record) {
  const errors = [];
  if (!record?.taskId) errors.push('审计记录缺 taskId');
  if (!Number.isInteger(record?.attempt) || record.attempt < 0) errors.push('审计记录 attempt 须为非负整数');
  if (!DISPATCH_RESULTS.includes(record?.result)) errors.push(`审计记录 result 非法：${String(record?.result)}`);
  if (record?.sessionPath && !SESSION_PATHS.includes(record.sessionPath)) errors.push(`会话路径非法：${record.sessionPath}`);
  if (record?.locateLayer && !LOCATE_LAYERS.includes(record.locateLayer)) errors.push(`定位层非法：${record.locateLayer}`);
  if (errors.length > 0) return { valid: false, errors, audit: null };

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
    else if (rec.result === 'failed' || rec.result === 'human-escalated') bucket.failed += 1;
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
