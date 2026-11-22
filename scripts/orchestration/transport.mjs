/**
 * AF-008 / AF-009 · Transport 端口与文件 Transport 默认实现。
 *
 * 端口接口（实现须提供四方法）：
 *   submitTask(task)          投递标准任务模型
 *   submitReceipt(receipt)   投递回执模型
 *   submitReview(review)     投递协商轮意见模型（AF-009）
 *   publishArtifact(ref)     发布工件引用
 *
 * 文件 Transport 为默认实现：把模型序列化为交接 JSON 文件，对齐现状文件交接口径。
 * 结构校验归 handover-contract.mjs 纯函数；本层保持薄 IO，不强制校验、不回写索引。
 * 预留实现位：MCP / HTTP Transport —— 仅注释占位，本批次不实现、不引协议栈依赖。
 * 厂商中立：模型不变，只换传输层。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, REPO_ROOT } from './state-store.mjs';

/** 文件名安全化：去除路径分隔符与控制字符。 */
function safeName(value) {
  return String(value ?? 'unnamed').replace(/[\\/:*?"<>|\s]+/g, '-');
}

/**
 * 交接件指针统一为仓内相对路径（AF-024 评审 §25）：落盘仍在绝对路径，
 * 但记录里只存仓内正斜杠相对指针，避免把本机目录布局带进快照与看板数据。
 */
function toRepoPointer(absPath) {
  const posixAbs = absPath.replace(/\\/g, '/');
  const posixRoot = REPO_ROOT.replace(/\\/g, '/');
  if (posixAbs.startsWith(`${posixRoot}/`)) return posixAbs.slice(posixRoot.length + 1);
  return posixAbs;
}

function writeHandover(dir, fileName, payload) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record = { deliveredAt: new Date().toISOString(), payload };
  const absPath = join(dir, fileName);
  writeFileSync(absPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return toRepoPointer(absPath);
}

/**
 * 文件 Transport：交接文件落盘，不回写编排索引。
 * @param {{outDir?: string}} opts outDir 交接文件根目录
 */
export function createFileTransport(opts = {}) {
  const outDir = opts.outDir ?? PATHS.transportDir;
  const dirs = {
    tasks: join(outDir, 'tasks'),
    receipts: join(outDir, 'receipts'),
    reviews: join(outDir, 'reviews'),
    artifacts: join(outDir, 'artifacts'),
  };
  return {
    kind: 'file',
    submitTask(task) {
      return writeHandover(dirs.tasks, `${safeName(task?.taskId)}.json`, task);
    },
    submitReceipt(receipt) {
      return writeHandover(dirs.receipts, `${safeName(receipt?.receiptId ?? receipt?.taskId)}.json`, receipt);
    },
    submitReview(review) {
      return writeHandover(dirs.reviews, `${safeName(review?.reviewId ?? review?.taskId)}.json`, review);
    },
    publishArtifact(ref) {
      return writeHandover(dirs.artifacts, `${safeName(ref?.refId ?? ref?.kind)}.json`, ref);
    },
    close() {},
  };
}

/**
 * Transport 工厂：按配置选择实现。
 * - type=file（默认）→ 文件 Transport；
 * - type=mcp / http → 预留位，本批次抛未实现错误，不静默回退掩盖配置。
 * @param {{transport?: {type?: 'file'|'mcp'|'http'}}} config
 * @param {{outDir?: string}} opts
 */
export function createTransport(config = {}, opts = {}) {
  const type = config.transport?.type ?? 'file';
  if (type === 'file') return createFileTransport(opts);
  // 预留实现位：MCP / HTTP Transport 不在本批次落地（方案 §10 遗留）。
  throw new Error(`Transport 类型 ${type} 尚未实现（预留 MCP / HTTP 位，本批次仅文件 Transport）`);
}
