import { describe, expect, it } from 'vitest';

import {
  TIGHTENING_ARMS,
  TIGHTENING_PERSONAS,
  buildSubtractiveBlock,
  buildShapeCappedBlock,
  buildTightenedBlock,
  buildTypedBlock,
  buildTypedNoShapeBlock,
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
  it('固定十个分支与两个人设', () => {
    expect(TIGHTENING_ARMS).toEqual([
      'off',
      'full',
      'no-shape',
      'no-event',
      'no-quota',
      'minimal',
      'tightened',
      'typed',
      'typed-noshape',
      'shape-capped',
    ]);
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

  it('分型候选与 full 行数一致, 只替换配额与事件两行', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const fullLines = buildSubtractiveBlock(persona, 'full').split('\n');
      const typed = buildTypedBlock(persona).split('\n');
      expect(typed[0]).toBe(fullLines[0]);
      expect(typed).toHaveLength(fullLines.length);
      expect(typed.filter((line, index) => line !== fullLines[index])).toHaveLength(2);
    }
  });

  it('焦虑分型候选禁用改口, 只留填充词与停顿', () => {
    const block = buildTypedBlock(ANXIOUS);
    expect(block).toContain('只允许填充词或停顿，不要改口');
    expect(block).toContain('不要改口、不要重复词、不要拖长音');
    expect(block).not.toContain('改口 1 处');
  });

  it('回避分型候选把停顿压到每两轮一次, 保留半截话', () => {
    const block = buildTypedBlock(GUARDED);
    expect(block).toContain('停顿最多每两轮一次');
    expect(block).toContain('只在自然卡住时保留一处半截话或停顿');
    expect(block).toContain('不要每轮都停顿');
  });

  it('分型去形态候选只比 typed 少形态一行', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const typed = buildTypedBlock(persona).split('\n');
      const noShape = buildTypedNoShapeBlock(persona).split('\n');
      expect(noShape[0]).toBe(typed[0]);
      expect(noShape).toHaveLength(typed.length - 1);
      expect(noShape.some((line) => directiveText(line).startsWith('话轮形态层：'))).toBe(false);
      expect(noShape).toEqual(typed.filter((line) => !directiveText(line).startsWith('话轮形态层：')));
    }
  });

  it('分型去形态候选仍保留分型配额与事件限制', () => {
    expect(buildTypedNoShapeBlock(ANXIOUS)).toContain('只允许填充词或停顿，不要改口');
    expect(buildTypedNoShapeBlock(GUARDED)).toContain('停顿最多每两轮一次');
  });

  it('形态限次候选与 full 行数一致, 只替换形态一行', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const fullLines = buildSubtractiveBlock(persona, 'full').split('\n');
      const capped = buildShapeCappedBlock(persona).split('\n');
      expect(capped[0]).toBe(fullLines[0]);
      expect(capped).toHaveLength(fullLines.length);
      const changed = capped.filter((line, index) => line !== fullLines[index]);
      expect(changed).toHaveLength(1);
      expect(directiveText(changed[0])).toMatch(/^话轮形态层：/);
    }
  });

  it('形态限次候选把每轮执行改成整场最多三次, 保留人设原形态', () => {
    const anxious = buildShapeCappedBlock(ANXIOUS);
    const guarded = buildShapeCappedBlock(GUARDED);
    expect(anxious).toContain('整场最多三次、本轮最多一次');
    expect(anxious).toContain('前一轮已经用过就跳过');
    expect(anxious).toContain('说出口后改一次口');
    expect(guarded).toContain('这个……我不太想说');
    expect(anxious).not.toContain('这个……我不太想说');
  });

  it('形态限次候选逐字保留 full 的配额与事件层', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const fullLines = buildSubtractiveBlock(persona, 'full').split('\n').slice(1);
      const cappedLines = buildShapeCappedBlock(persona).split('\n').slice(1);
      for (const line of fullLines) {
        if (directiveText(line).startsWith('话轮形态层：')) continue;
        expect(cappedLines).toContain(line);
      }
    }
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
