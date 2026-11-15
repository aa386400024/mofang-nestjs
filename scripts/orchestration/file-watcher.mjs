/**
 * AF-005 · 文件事件 watcher（adapter 层扩展）。
 *
 * 监听回执 / 工件目录，防抖聚合文件变更事件后回调一轮处理；watcher 自身不推进
 * 状态机，回调由 CLI / 调度器注入。内置 fs.watch，不引第三方文件监听依赖；
 * watcher 异常只经 onError 上报，不影响单次 run-once。
 */
import { existsSync, watch } from 'node:fs';

/** 事件去重：同一相对路径在一个防抖窗口内合并为一条。 */
export function dedupeEvents(events) {
  const seen = new Map();
  for (const event of events ?? []) {
    if (!event?.path) continue;
    seen.set(event.path, { path: event.path, kind: event.kind ?? 'change', count: (seen.get(event.path)?.count ?? 0) + 1 });
  }
  return [...seen.values()];
}

/**
 * 创建目录 watcher。
 * @param {{dirs: string[], onChange: (events: object[]) => void, debounceMs?: number, onError?: (err: Error) => void}} opts
 * @returns {{watchers: object[], stop: () => void}}
 */
export function createWatcher({ dirs, onChange, debounceMs = 300, onError } = {}) {
  const watchers = [];
  let pending = new Map();
  let timer = null;

  const flush = () => {
    timer = null;
    if (pending.size === 0) return;
    const events = dedupeEvents([...pending.values()]);
    pending = new Map();
    onChange?.(events);
  };

  const schedule = (event) => {
    pending.set(event.path, event);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  for (const dir of dirs ?? []) {
    if (!existsSync(dir)) continue;
    try {
      const watcher = watch(dir, (eventType, fileName) => {
        if (!fileName) return;
        schedule({ path: fileName, kind: eventType });
      });
      watcher.on('error', (err) => onError?.(err));
      watchers.push(watcher);
    } catch (err) {
      onError?.(err);
    }
  }

  const stop = () => {
    if (timer) clearTimeout(timer);
    pending = new Map();
    for (const watcher of watchers) watcher.close();
  };

  return { watchers, stop };
}
