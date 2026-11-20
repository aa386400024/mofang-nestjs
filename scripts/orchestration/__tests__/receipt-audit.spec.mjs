/**
 * 回执可信度留痕：内容指纹与发布者识别。
 * 只测纯函数；不验证签（本机信任模型下不做密码学身份绑定）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receiptDigest, receiptPublisher } from '../receipts.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orch-receipt-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('receipt 可信度留痕', () => {
  it('同一内容指纹稳定，内容改动后指纹变化', () => {
    const file = join(dir, 'AF-900.json');
    writeFileSync(file, JSON.stringify({ taskId: 'AF-900', finalStatus: 'completed' }), 'utf8');
    const first = receiptDigest(file);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(receiptDigest(file)).toBe(first);
    writeFileSync(file, JSON.stringify({ taskId: 'AF-900', finalStatus: 'failed' }), 'utf8');
    expect(receiptDigest(file)).not.toBe(first);
  });

  it('发布者优先 publisher，其次 agentRole，认不出记 unspecified', () => {
    expect(receiptPublisher({ publisher: ' agent-A ', agentRole: 'executor' })).toBe('agent-A');
    expect(receiptPublisher({ agentRole: 'executor' })).toBe('executor');
    expect(receiptPublisher({})).toBe('unspecified');
    expect(receiptPublisher({ publisher: '   ' })).toBe('unspecified');
  });
});
