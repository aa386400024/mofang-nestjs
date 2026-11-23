import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  classifyPresence,
  isBroadQuestion,
  isQuestion,
  isShortAck,
  projectDimensions,
  summarizeTurns,
} from '../../ops/quality/af408-presence-calibration.mjs';

describe('AF-408 在场信号纯函数', () => {
  it('严格疑问只认句末问号或句末吗呢，宽疑问补充句中疑问词', () => {
    expect(isQuestion('你最近睡得怎么样？')).toBe(true);
    expect(isQuestion('这种状态持续多久了')).toBe(false);
    expect(isBroadQuestion('这种状态持续多久了')).toBe(true);
    expect(isQuestion('你好。我们先从最近最困扰你的一件事开始。')).toBe(false);
  });

  it('短承接只认 12 字以内的承接开头', () => {
    expect(isShortAck('嗯')).toBe(true);
    expect(isShortAck('好，继续')).toBe(true);
    expect(isShortAck('嗯，我明白你的意思，但我们先放一放')).toBe(false);
  });

  it('变体 A 用宽疑问且限 40 字，AS 只升级严格疑问', () => {
    expect(classifyPresence('这种状态持续多久了', 'A')).toBe('holding_present');
    expect(classifyPresence('这种状态持续多久了', 'AS')).toBe('neutral');
    expect(classifyPresence('你最近睡得怎么样？', 'AS')).toBe('holding_present');
    expect(classifyPresence(`${'关于最近的工作节奏和睡眠变化，'.repeat(3)}你怎么看？`, 'A')).toBe('neutral');
    expect(classifyPresence('嗯。', 'AS')).toBe('neutral');
  });

  it('变体 ABS 追加短承接，ABCS 把无问句纯短句降为 cold_absent', () => {
    expect(classifyPresence('嗯。', 'ABS')).toBe('holding_present');
    expect(classifyPresence('嗯。', 'ABCS')).toBe('cold_absent');
    expect(classifyPresence('好，继续。', 'ABCS')).toBe('cold_absent');
    expect(classifyPresence('开会具体占用了哪些时间？', 'ABCS')).toBe('holding_present');
  });

  it('长陈述保持 neutral，不被短承接规则误伤', () => {
    const text = '我听到你说最近很累，我们先从最困扰的一件事开始，慢慢来。';
    expect(classifyPresence(text, 'ABCS')).toBe('neutral');
  });

  it('汇总计数与 neutral 比率可复算', () => {
    const summary = summarizeTurns(['你最近睡得怎么样？', '嗯。', '你好，我们开始。', '这种状态持续多久了？'], 'ABS');
    expect(summary).toMatchObject({ turns: 4, holding: 3, cold: 0, neutral: 1 });
    expect(summary.neutralRate).toBeCloseTo(0.25, 6);
  });

  it('14 轮 holding 不抬高 trust，只推进 safety/bond/valence', () => {
    const projected = projectDimensions(Array(14).fill('holding_present'));
    expect(projected.trust).toBeCloseTo(0.25, 6);
    expect(projected.safety).toBeCloseTo(0.356, 6);
    expect(projected.bond).toBeCloseTo(0.278, 6);
    expect(projected.valence).toBeCloseTo(0.556, 6);
  });

  it('14 轮 cold 只小幅压低 trust，不会击穿下界', () => {
    const projected = projectDimensions(Array(14).fill('cold_absent'));
    expect(projected.trust).toBeCloseTo(0.194, 6);
    expect(projected.safety).toBeCloseTo(0.272, 6);
    expect(projected.bond).toBeCloseTo(0.222, 6);
  });

  it('影子审计脚本默认 v2，legacy 只在显式开关下启用', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts/ops/quality/af322-classifier-shadow-audit.ts'), 'utf8');
    expect(source).toContain("options.legacy ? 'legacy' : 'v2'");
    expect(source).not.toContain('new RuleBasedClassifier()');
  });
});
