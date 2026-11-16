/**
 * AF-005 · Store 持久化端口与后端适配。
 *
 * 端口抽象：上层流程只经 Store 接口读写任务状态，不感知后端是 JSON 文件还是
 * SQLite；后端切换由 config `store.backend`（json | sqlite）决定，默认 json。
 *
 * 边界：SQLite 只存指针 / 状态 / 租约 / history，工件正文仍留在文件（轻量索引口径
 * 不变）。JSON 后端复用既有 state-store，保持 L0 行为等价；SQLite 为可选后端。
 * 本模块为 adapter 层扩展，不进业务 MySQL。
 */
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PATHS, findTask, loadIndex, nowIso, saveIndex } from './state-store.mjs';

const require = createRequire(import.meta.url);

/**
 * Store 端口接口（两后端共同实现）：
 *   loadIndex()                      读取完整状态索引 { version, tasks[], archivedTasks[] }
 *   saveIndex(index)                 落盘完整索引
 *   getTask(taskId)                  取单条在途任务，未找到返回 null
 *   listByStatus(status)             按状态列出在途任务
 *   claim(taskId, agent)              登记领取（写 agent 与 claimedAt）
 *   release(taskId)                  释放领取
 *   appendHistory(taskId, record)    追加一条状态迁移历史
 */

/** 基于 loadIndex / saveIndex 的通用索引操作（两后端共享）。 */
function withIndexOperations(backend) {
  return {
    ...backend,
    close: backend.close ?? (() => {}),
    getTask(taskId) {
      return findTask(backend.loadIndex(), taskId);
    },
    listByStatus(status) {
      return backend.loadIndex().tasks.filter((task) => task.status === status);
    },
    claim(taskId, agent) {
      const index = backend.loadIndex();
      const task = findTask(index, taskId);
      if (!task) return false;
      task.agent = agent;
      task.claimedAt = nowIso();
      backend.saveIndex(index);
      return true;
    },
    release(taskId) {
      const index = backend.loadIndex();
      const task = findTask(index, taskId);
      if (!task) return false;
      task.agent = null;
      task.claimedAt = null;
      backend.saveIndex(index);
      return true;
    },
    appendHistory(taskId, record) {
      const index = backend.loadIndex();
      const task = findTask(index, taskId);
      if (!task) return false;
      if (!Array.isArray(task.history)) task.history = [];
      task.history.push(record);
      backend.saveIndex(index);
      return true;
    },
  };
}

/** JSON 文件后端：直接复用既有 state-store，行为与 L0 现状等价；可注入读写以便隔离测试。 */
export function createJsonStore(opts = {}) {
  return withIndexOperations({
    backend: 'json',
    loadIndex: opts.loadIndex ?? loadIndex,
    saveIndex: opts.saveIndex ?? saveIndex,
  });
}

function rowToTask(row) {
  return {
    taskId: row.taskId,
    contextId: row.contextId,
    type: row.type,
    title: row.title,
    status: row.status,
    agent: row.agent,
    claimedAt: row.claimedAt,
    deadline: row.deadline,
    artifacts: row.artifacts ? JSON.parse(row.artifacts) : {},
    history: row.history ? JSON.parse(row.history) : [],
    createdAt: row.createdAt,
  };
}

/** SQLite 后端（内置 node:sqlite，实验特性；仅存指针 / 状态 / 历史，不存工件正文）。 */
export function createSqliteStore(dbPath = PATHS.sqliteDb) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (err) {
    throw new Error(`SQLite 后端不可用：${err.message}`);
  }
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      taskId TEXT PRIMARY KEY,
      contextId TEXT,
      type TEXT,
      title TEXT,
      status TEXT NOT NULL,
      agent TEXT,
      claimedAt TEXT,
      deadline TEXT,
      artifacts TEXT,
      history TEXT,
      createdAt TEXT,
      archived INTEGER DEFAULT 0
    )
  `);

  function loadIndexSqlite() {
    const rows = db.prepare('SELECT * FROM tasks').all();
    const tasks = [];
    const archivedTasks = [];
    for (const row of rows) {
      const record = rowToTask(row);
      if (row.archived === 1) archivedTasks.push({ taskId: record.taskId, status: record.status, artifacts: record.artifacts });
      else tasks.push(record);
    }
    return { version: '1.0.0', tasks, archivedTasks };
  }

  function saveIndexSqlite(index) {
    db.exec('DELETE FROM tasks');
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO tasks
        (taskId, contextId, type, title, status, agent, claimedAt, deadline, artifacts, history, createdAt, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const task of index.tasks ?? []) {
      upsert.run(
        task.taskId,
        task.contextId ?? null,
        task.type ?? null,
        task.title ?? null,
        task.status,
        task.agent ?? null,
        task.claimedAt ?? null,
        task.deadline ?? null,
        JSON.stringify(task.artifacts ?? {}),
        JSON.stringify(task.history ?? []),
        task.createdAt ?? null,
        0,
      );
    }
    for (const task of index.archivedTasks ?? []) {
      upsert.run(task.taskId, null, null, null, task.status, null, null, null, JSON.stringify(task.artifacts ?? {}), '[]', null, 1);
    }
  }

  return withIndexOperations({
    backend: 'sqlite',
    db,
    loadIndex: loadIndexSqlite,
    saveIndex: saveIndexSqlite,
    close: () => db.close(),
  });
}

/**
 * 按配置创建 Store。
 * @param {{store?: {backend?: 'json'|'sqlite'}}} config 归一化配置
 * @param {{dbPath?: string}} opts sqlite 后端数据库路径覆盖
 */
export function createStore(config = {}, opts = {}) {
  const backend = config.store?.backend ?? 'json';
  if (backend === 'sqlite') return createSqliteStore(opts.dbPath ?? PATHS.sqliteDb);
  return createJsonStore(opts);
}
