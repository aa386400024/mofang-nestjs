import { describe, expect, it } from 'vitest';

import {
  TIGHTENING_ARMS,
  TIGHTENING_PERSONAS,
  buildSubtractiveBlock,
  buildTightenedBlock,
  buildTighteningPromptBlock,
  buildTighteningSystemPrompt,
  getTighteningPersona,
} from '../../../src/shared/realism/realism-prompt-tightening.js';

const ANXIOUS = getTighteningPersona('anxious');
const GUARDED = getTighteningPersona('guarded');

function directiveText(line: string): string {
  return line.startsWith('- ') ? line.slice(2) : line;
}

function directiveLines(block: string): readonly string[] {
  return block.split('\n').slice(1);
}

function hasPrefix(block: string, prefix: string): boolean {
  return directiveLines(block).some((line) => directiveText(line).startsWith(prefix));
}

describe('realism-prompt-tightening', () => {
  it('固定七个分支与两个人设', () => {
    expect(TIGHTENING_ARMS).toEqual(['off', 'full', 'no-shape', 'no-event', 'no-quota', 'minimal', 'tightened']);
    expect(TIGHTENING_PERSONAS).toEqual(['anxious', 'guarded']);
  });

  it('off 分支不返回块, prompt 逐字等于基础人设', () => {
    expect(buildTighteningPromptBlock(ANXIOUS, 'off')).toBe('');
    expect(buildTighteningSystemPrompt(ANXIOUS, 'off')).toBe(ANXIOUS.baseSystem);
  });

  it('full 分支块逐字等于生产块', () => {
    expect(buildTighteningPromptBlock(ANXIOUS, 'full')).toBe(buildSubtractiveBlock(ANXIOUS, 'full'));
    expect(buildTighteningPromptBlock(GUARDED, 'full')).toBe(buildSubtractiveBlock(GUARDED, 'full'));
  });

  it('no-shape 只删掉话轮形态行, 其余行与 full 逐字一致', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const full = buildSubtractiveBlock(persona, 'full').split('\n');
      const reduced = buildSubtractiveBlock(persona, 'no-shape').split('\n');
      expect(reduced[0]).toBe(full[0]);
      expect(reduced).toHaveLength(full.length - 1);
      expect(reduced).toEqual(full.filter((line) => !directiveText(line).startsWith('话轮形态层：')));
    }
  });

  it('no-event 只删掉事件层行, 仍保留形态与配额', () => {
    const block = buildSubtractiveBlock(ANXIOUS, 'no-event');
    expect(hasPrefix(block, '话轮形态层：')).toBe(true);
    expect(hasPrefix(block, '不流利配额：')).toBe(true);
    expect(hasPrefix(block, '事件层：')).toBe(false);
  });

  it('no-quota 只删掉配额行, 仍保留形态与事件层', () => {
    const block = buildSubtractiveBlock(ANXIOUS, 'no-quota');
    expect(hasPrefix(block, '话轮形态层：')).toBe(true);
    expect(hasPrefix(block, '不流利配额：')).toBe(false);
    expect(hasPrefix(block, '事件层：')).toBe(true);
  });

  it('minimal 同时删掉形态与事件层, 只留下配额与稳定层', () => {
    const block = buildSubtractiveBlock(ANXIOUS, 'minimal');
    expect(hasPrefix(block, '话轮形态层：')).toBe(false);
    expect(hasPrefix(block, '事件层：')).toBe(false);
    expect(hasPrefix(block, '不流利配额：')).toBe(true);
    expect(hasPrefix(block, '优先级：')).toBe(true);
  });

  it('四个减层分支都是 full 的逐字行子集且顺序不变', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const fullLines = buildSubtractiveBlock(persona, 'full').split('\n').slice(1);
      for (const arm of ['no-shape', 'no-event', 'no-quota', 'minimal'] as const) {
        const reduced = buildSubtractiveBlock(persona, arm).split('\n').slice(1);
        expect(reduced.length).toBeLessThan(fullLines.length);
        for (const line of reduced) expect(fullLines).toContain(line);
        expect(reduced).toEqual(fullLines.filter((line) => reduced.includes(line)));
      }
    }
  });

  it('tightened 与 full 行数一致, 只替换形态、配额、事件三行', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const fullLines = buildSubtractiveBlock(persona, 'full').split('\n');
      const tightened = buildTightenedBlock(persona).split('\n');
      expect(tightened[0]).toBe(fullLines[0]);
      expect(tightened).toHaveLength(fullLines.length);
      const changed = tightened.filter((line, index) => line !== fullLines[index]);
      expect(changed).toHaveLength(3);
      expect(
        changed.every((line) => ['话轮形态层：', '不流利配额：', '事件层：'].some((prefix) => directiveText(line).startsWith(prefix))),
      ).toBe(true);
      expect(tightened).not.toContain(fullLines.find((line) => directiveText(line).startsWith('事件层：')));
      expect(tightened).not.toContain(fullLines.find((line) => directiveText(line).startsWith('不流利配额：')));
    }
  });

  it('tightened 去掉事件候选清单与节奏条件, 避免逐轮命令', () => {
    const block = buildTightenedBlock(ANXIOUS);
    expect(block).not.toContain('候选：');
    expect(block).not.toContain('按需取用');
    expect(block).not.toContain('节奏条件');
    expect(block).toContain('整场最多两次、本轮最多一次');
    expect(block).toContain('单轮通常为 0、最多 1 处');
    expect(block).toContain('自然出现时保留最多一处');
  });

  it('焦虑与回避的形态文本不同, 都保留各自底色', () => {
    expect(buildTightenedBlock(ANXIOUS)).toContain('说出口后改一次口');
    expect(buildTightenedBlock(GUARDED)).toContain('这个……我不太想说');
    expect(buildTightenedBlock(ANXIOUS)).not.toContain('这个……我不太想说');
  });

  it('非 off 分支的 prompt 都以基础人设开头并空一行接块', () => {
    for (const arm of TIGHTENING_ARMS.filter((entry) => entry !== 'off')) {
      expect(buildTighteningSystemPrompt(ANXIOUS, arm)).toBe(`${ANXIOUS.baseSystem}\n\n${buildTighteningPromptBlock(ANXIOUS, arm)}`);
    }
  });

  it('未知人设与非本单允许的人设都抛错', () => {
    expect(() => getTighteningPersona('unknown')).toThrow(/未知人设/);
  });
});
