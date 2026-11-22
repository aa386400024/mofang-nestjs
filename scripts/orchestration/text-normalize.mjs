/**
 * AF-084 · 文本换行与编码规范化工具。
 *
 * 机读护栏按 LF 口径读取交付记录；Windows 编辑器容易写入 CRLF 或 UTF-8 BOM，
 * 导致「内容正确但格式判失败」。本模块提供无副作用检查与显式 --apply 落盘两条路径，
 * 默认只读，避免误改用户文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BOM = '\uFEFF';

/** 规范化文本：去 UTF-8 BOM，CRLF / 孤立 CR 统一为 LF。 */
export function normalizeLf(text) {
  if (typeof text !== 'string') throw new Error('normalizeLf: 入参必须是字符串');
  const withoutBom = text.startsWith(BOM) ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/**
 * 只读检查文件编码与换行。
 * @param {string} absPath 绝对路径
 * @returns {{path:string,hasBom:boolean,crCount:number,needsNormalize:boolean,bytes:number}}
 */
export function inspectTextFile(absPath) {
  const buffer = readFileSync(absPath);
  const text = buffer.toString('utf8');
  const hasBom = text.startsWith(BOM);
  const crCount = (text.match(/\r/g) ?? []).length;
  return {
    path: absPath,
    hasBom,
    crCount,
    needsNormalize: hasBom || crCount > 0,
    bytes: buffer.length,
  };
}

/**
 * 规范化文件。默认 dry-run；apply=true 才写盘。
 * @param {string} absPath 绝对路径
 * @param {{apply?: boolean}} opts
 * @returns {{path:string,changed:boolean,hasBom:boolean,crCount:number,bytesBefore:number,bytesAfter:number,applied:boolean}}
 */
export function normalizeTextFile(absPath, opts = {}) {
  const buffer = readFileSync(absPath);
  const text = buffer.toString('utf8');
  const normalized = normalizeLf(text);
  const changed = normalized !== text;
  const result = {
    path: absPath,
    changed,
    hasBom: text.startsWith(BOM),
    crCount: (text.match(/\r/g) ?? []).length,
    bytesBefore: buffer.length,
    bytesAfter: Buffer.byteLength(normalized, 'utf8'),
    applied: false,
  };
  if (changed && opts.apply === true) {
    writeFileSync(absPath, normalized, { encoding: 'utf8' });
    result.applied = true;
  }
  return result;
}
