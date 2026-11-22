/**
 * AF-084 · 任务 scope 重签发（reissue）纯函数。
 *
 * 设计口径：任务登记后的 scope 属于任务契约的一部分，不允许原地改写。
 * 需要修正 scope 时，登记一个新任务并在 `priorTasks` 显式指向原任务，同时把原任务
 * 闭合到 canceled；新任务继承原任务的上下文与目标，但拥有独立的 taskId、任务单与事件链。
 *
 * 本模块只做「能否重签发」的判定，零副作用；真正的登记 / 提级 / 取消由 CLI 调 scheduler
 * 与 task-intake 完成，保证状态面仍走事件日志单一写面。
 */

const REISSUABLE_STATUSES = ['backlog', 'ready'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判定一次 scope 重签发是否合法。
 * @param {{tasks?: object[], archivedTasks?: object[]}} index 当前状态索引
 * @param {{fromTaskId: string, newTask: object}} input
 * @returns {{ok: boolean, errors: string[], oldTask: object|null}}
 */
export function planReissue(index, input) {
  const errors = [];
  const tasks = Array.isArray(index?.tasks) ? index.tasks : [];
  const archived = Array.isArray(index?.archivedTasks) ? index.archivedTasks : [];
  const fromTaskId = input?.fromTaskId;
  const newTask = input?.newTask;

  if (typeof fromTaskId !== 'string' || fromTaskId.length === 0) {
    errors.push('fromTaskId: 缺失');
  }
  const oldTask = tasks.find((task) => task.taskId === fromTaskId) ?? null;
  if (!oldTask) {
    errors.push(`fromTaskId: 任务不在活跃列表：${String(fromTaskId)}`);
  } else if (!REISSUABLE_STATUSES.includes(oldTask.status)) {
    errors.push(
      `fromTaskId: 只允许对 backlog / ready 任务重签发；${fromTaskId} 当前 ${oldTask.status}，已进入实现的任务不得改 scope，请走返修任务`,
    );
  }

  if (!isObject(newTask)) {
    errors.push('newTask: 缺失或不是对象');
    return { ok: false, errors, oldTask };
  }
  const newTaskId = newTask.taskId;
  if (typeof newTaskId !== 'string' || !/^[A-Z0-9]+-[0-9]+$/.test(newTaskId)) {
    errors.push('newTask.taskId: 缺失或不符合 ^[A-Z0-9]+-[0-9]+$');
  } else if (newTaskId === fromTaskId) {
    errors.push('newTask.taskId: 重签发必须使用新 taskId，不得复用原任务标识');
  }
  if (newTaskId && [...tasks, ...archived].some((task) => task.taskId === newTaskId)) {
    errors.push(`newTask.taskId: 任务已存在：${newTaskId}`);
  }
  const priorTasks = Array.isArray(newTask.priorTasks) ? newTask.priorTasks : [];
  if (typeof fromTaskId === 'string' && fromTaskId.length > 0 && !priorTasks.includes(fromTaskId)) {
    errors.push(`newTask.priorTasks: 必须显式包含 ${fromTaskId}，用于保留审计链路`);
  }
  const taskSheet = newTask?.artifacts?.taskSheet;
  if (typeof taskSheet !== 'string' || !taskSheet.endsWith('.md')) {
    errors.push('newTask.artifacts.taskSheet: 必须指向 docs/worklog/pending 下的 .md 任务单');
  }

  return { ok: errors.length === 0, errors, oldTask };
}
