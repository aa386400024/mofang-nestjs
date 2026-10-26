// V2026-10-26 治本 (复盘报告状态归一 — 纯函数单测):
//   原因: 本轮要治的 P0 是「vpt 结束后报告一直 pending, 前端永远转圈」. 兜底逻辑
//     (陈旧 pending → parse_error) 是**纯函数** (无 IO), 所以能单测 —— 而它一旦写错:
//       - 阈值判反 → 正常还在生成的报告被误报成"失败" (用户白跑一趟)
//       - 漏判 endedAt=null → 会话**还没结束**就被判失败 (逻辑上不可能, 但代码上看不出来)
//       - 边界用 >= 而非 > → 恰好在阈值上的报告被判失败
//     这三类都不会抛异常, 只会让状态**安静地错**, 所以必须用测试锁死.
//
//   验证:
//     1. npx jest test/counselor/session-report-status.spec.ts 全绿
//     2. 故意把 `>` 改成 `>=` → "恰好在阈值上"用例变红
//     3. 故意去掉 endedAtMs === null 分支 → "会话未结束"用例变红
//
//   时间戳: 2026-10-26
import { resolveSessionReportStatus } from '../../src/counselor/domain/session-core/session-core.types';

/** 陈旧阈值 (与 env `SUPERVISION_REPORT_PENDING_TIMEOUT_MS` 默认值一致). */
const TIMEOUT_MS = 900_000;

/** 固定"当前时刻", 免得测试随系统时间漂移. */
const NOW = 1_800_000_000_000;

describe('复盘报告状态归一', () => {
  it('已有报告且成功 → completed', () => {
    expect(resolveSessionReportStatus('completed', NOW - 1000, NOW, TIMEOUT_MS)).toBe('completed');
  });

  it('已有报告但生成失败 (parse_error) → parse_error', () => {
    expect(resolveSessionReportStatus('parse_error', NOW - 1000, NOW, TIMEOUT_MS)).toBe('parse_error');
  });

  it('会话**还没结束** → pending (报告本来就还没开始生成)', () => {
    expect(resolveSessionReportStatus(undefined, null, NOW, TIMEOUT_MS)).toBe('pending');
  });

  it('会话刚结束、还在生成 → pending', () => {
    expect(resolveSessionReportStatus(undefined, NOW - 60_000, NOW, TIMEOUT_MS)).toBe('pending');
  });

  it('会话已结束且**超过阈值**、无报告行 → parse_error (不再永远 pending)', () => {
    expect(resolveSessionReportStatus(undefined, NOW - TIMEOUT_MS - 1000, NOW, TIMEOUT_MS)).toBe('parse_error');
  });

  it('边界: 恰好等于阈值 → 仍是 pending (用 `>` 不是 `>=`, 不误杀正在生成的报告)', () => {
    expect(resolveSessionReportStatus(undefined, NOW - TIMEOUT_MS, NOW, TIMEOUT_MS)).toBe('pending');
  });

  it('阈值可配: 阈值调大后, 同一个"已结束很久"不再被判失败', () => {
    const endedAt = NOW - TIMEOUT_MS - 1000;

    expect(resolveSessionReportStatus(undefined, endedAt, NOW, TIMEOUT_MS)).toBe('parse_error');
    expect(resolveSessionReportStatus(undefined, endedAt, NOW, TIMEOUT_MS * 10)).toBe('pending');
  });
});
