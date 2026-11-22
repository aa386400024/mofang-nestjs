import { describe, expect, it } from 'vitest';

import { REALISM_AB_BASE_SYSTEM, REALISM_AB_CONTEXT } from '../../../src/shared/realism/realism-prompt-ab.js';
import {
  ABLATION_ARMS,
  ABLATION_PERSONAS,
  buildAblationPromptBlock,
  buildAblationSystemPrompt,
  getAblationPersona,
  selectAblationDirectives,
} from '../../../src/shared/realism/realism-prompt-ablation.js';
import { buildVisitorRealismPromptBlock, buildVisitorRealismProfile } from '../../../src/shared/realism/visitor-realism-profile.js';

const ANXIOUS = getAblationPersona('anxious');
const GUARDED = getAblationPersona('guarded');

function fullBlockFor(personaId: 'anxious' | 'guarded'): string {
  const persona = getAblationPersona(personaId);
  return buildVisitorRealismPromptBlock(buildVisitorRealismProfile(persona.context, 'active'));
}

function blockLines(block: string): readonly string[] {
  return block.split('\n').slice(1);
}

function directiveText(line: string): string {
  return line.startsWith('- ') ? line.slice(2) : line;
}

describe('realism-prompt-ablation', () => {
  it('固定五个消融分支与两个人设', () => {
    expect(ABLATION_ARMS).toEqual(['off', 'full', 'quota', 'event', 'context']);
    expect(ABLATION_PERSONAS).toEqual(['anxious', 'guarded']);
  });

  it('焦虑人设复用 AF-329 的基础人设, 并显式补上焦虑依恋底色', () => {
    expect(ANXIOUS.baseSystem).toBe(REALISM_AB_BASE_SYSTEM);
    expect(ANXIOUS.context.trust).toBe(REALISM_AB_CONTEXT.trust);
    expect(ANXIOUS.context.attachmentStyle).toBe('anxious');
    expect(ANXIOUS.label).toBe('焦虑依恋');
  });

  it('回避人设解析为 guarded_withdrawn / guarded', () => {
    const profile = buildVisitorRealismProfile(GUARDED.context, 'active');
    expect(profile.role).toBe('guarded_withdrawn');
    expect(profile.state).toBe('guarded');
  });

  it('焦虑人设解析为 anxious_seeker / steady', () => {
    const profile = buildVisitorRealismProfile(ANXIOUS.context, 'active');
    expect(profile.role).toBe('anxious_seeker');
    expect(profile.state).toBe('steady');
  });

  it('off 分支不返回块, prompt 逐字等于基础人设', () => {
    expect(buildAblationPromptBlock(ANXIOUS, 'off')).toBe('');
    expect(buildAblationSystemPrompt(ANXIOUS, 'off')).toBe(ANXIOUS.baseSystem);
  });

  it('full 分支块逐字等于生产 prompt 块, prompt 只多一个换行段', () => {
    const block = buildAblationPromptBlock(ANXIOUS, 'full');
    expect(block).toBe(fullBlockFor('anxious'));
    expect(buildAblationSystemPrompt(ANXIOUS, 'full')).toBe(`${ANXIOUS.baseSystem}\n\n${block}`);
  });

  it('quota 分支只保留不流利配额行', () => {
    const block = buildAblationPromptBlock(ANXIOUS, 'quota');
    const lines = blockLines(block);
    expect(lines).toHaveLength(1);
    expect(directiveText(lines[0] ?? '')).toMatch(/^不流利配额：/u);
    expect(lines.some((line) => directiveText(line).startsWith('事件层：'))).toBe(false);
    expect(lines.some((line) => directiveText(line).startsWith('场景层：'))).toBe(false);
  });

  it('event 分支只保留事件层行', () => {
    const block = buildAblationPromptBlock(ANXIOUS, 'event');
    const lines = blockLines(block);
    expect(lines).toHaveLength(1);
    expect(directiveText(lines[0] ?? '')).toMatch(/^事件层：/u);
    expect(lines.some((line) => directiveText(line).startsWith('不流利配额：'))).toBe(false);
  });

  it('context 分支保留优先级、场景、语域、角色声音与话轮形态, 不包含配额或事件层', () => {
    const lines = blockLines(buildAblationPromptBlock(ANXIOUS, 'context'));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.some((line) => directiveText(line).startsWith('优先级：'))).toBe(true);
    expect(lines.some((line) => directiveText(line).startsWith('场景层：'))).toBe(true);
    expect(lines.some((line) => directiveText(line).startsWith('语域层：'))).toBe(true);
    expect(lines.some((line) => directiveText(line).startsWith('角色声音层：'))).toBe(true);
    expect(lines.some((line) => directiveText(line).startsWith('话轮形态层：'))).toBe(true);
    expect(lines.some((line) => directiveText(line).startsWith('不流利配额：'))).toBe(false);
    expect(lines.some((line) => directiveText(line).startsWith('事件层：'))).toBe(false);
  });

  it('除 off 外, 每个分支的块都是 full 块的逐字行子集, 首行标题一致', () => {
    for (const personaId of ABLATION_PERSONAS) {
      const fullLines = fullBlockFor(personaId).split('\n');
      for (const arm of ABLATION_ARMS.filter((entry) => entry !== 'off')) {
        const block = buildAblationPromptBlock(getAblationPersona(personaId), arm);
        const lines = block.split('\n');
        expect(lines[0]).toBe(fullLines[0]);
        const selected = lines.slice(1);
        const fullDirectives = fullLines.slice(1);
        for (const line of selected) {
          expect(fullDirectives).toContain(line);
        }
        expect(selected).toEqual(fullDirectives.filter((line) => selected.includes(line)));
      }
    }
  });

  it('selectAblationDirectives 对合成行做同样分层', () => {
    const lines = ['优先级：x', '场景层：y', '不流利配额：z', '事件层：w', '不要解释自己'];
    expect(selectAblationDirectives(lines, 'off')).toEqual([]);
    expect(selectAblationDirectives(lines, 'full')).toEqual(lines);
    expect(selectAblationDirectives(lines, 'quota')).toEqual(['不流利配额：z']);
    expect(selectAblationDirectives(lines, 'event')).toEqual(['事件层：w']);
    expect(selectAblationDirectives(lines, 'context')).toEqual(['优先级：x', '场景层：y']);
  });

  it('未知人设 id 直接抛错, 不静默回落', () => {
    expect(() => getAblationPersona('unknown')).toThrow(/未知人设/);
  });

  it('两个人设的 full prompt 都包含生产块, off 都不包含', () => {
    for (const persona of [ANXIOUS, GUARDED]) {
      const fullPrompt = buildAblationSystemPrompt(persona, 'full');
      const offPrompt = buildAblationSystemPrompt(persona, 'off');
      expect(fullPrompt.length).toBeGreaterThan(offPrompt.length);
      expect(fullPrompt.startsWith(persona.baseSystem)).toBe(true);
      expect(offPrompt).not.toContain('你这一轮说话的真人质感');
    }
  });
});
