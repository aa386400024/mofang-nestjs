// AF-611 · Judge 脱敏纯函数: PII / 语义身份 / 自伤创伤降级 / 结构化摘要 / 危机识别.

import { describe, expect, it } from 'vitest';

import { makeSession, makeTurn } from './judge-test-fixtures.js';
import { assertJudgeReviewInput } from '../../../src/engine-adapters/judge/judge.contract.js';
import { isCrisisSignal, redactJudgeInput } from '../../../src/engine-adapters/judge/judge.redaction.js';
import { buildJudgeInput } from '../../../src/engine-adapters/judge/judge.shadow.js';

describe('AF-611 · Judge 脱敏', () => {
  it('手机号 / 身份证 / 邮箱走既有 pii-redactor 口径, 不残留原文', () => {
    const output = redactJudgeInput({
      turnIndex: 1,
      riskLevel: 'low',
      eventTags: ['empathy'],
      rawText: '手机 13800138000, 邮箱 a@b.com, 身份证 440101199001011234',
    });

    expect(output.excerpt.text).not.toContain('13800138000');
    expect(output.excerpt.text).not.toContain('a@b.com');
    expect(output.excerpt.text).not.toContain('440101199001011234');
    expect(output.tags).toEqual(expect.arrayContaining(['phone', 'email', 'id_card']));
  });

  it('人名 / 地点 / 单位 / 家庭关系泛化为角色类别', () => {
    const output = redactJudgeInput({
      turnIndex: 2,
      riskLevel: 'low',
      eventTags: ['open_probe'],
      rawText: '我叫李雷, 王老师在深圳市南山区上班, 我妈和老婆都在腾讯公司。',
    });

    expect(output.excerpt.text).not.toContain('李雷');
    expect(output.excerpt.text).not.toContain('深圳市南山区');
    expect(output.excerpt.text).not.toContain('腾讯公司');
    expect(output.excerpt.text).not.toContain('我妈');
    expect(output.excerpt.text).toContain('[人名]');
    expect(output.excerpt.text).toContain('[地点]');
    expect(output.excerpt.text).toContain('[单位]');
    expect(output.excerpt.text).toContain('[家庭成员]');
    expect(output.tags).toEqual(expect.arrayContaining(['person_name', 'location', 'affiliation', 'family_role']));
  });

  it('自伤 / 创伤细节整句降级为类别标签', () => {
    const output = redactJudgeInput({
      turnIndex: 3,
      riskLevel: 'medium',
      eventTags: ['sensitive_touch'],
      rawText: '我最近总是闪回被家暴的场景, 晚上睡不着。',
    });

    expect(output.excerpt.text).not.toContain('家暴');
    expect(output.excerpt.text).not.toContain('闪回');
    expect(output.excerpt.text).toContain('[自伤/创伤细节已降级为类别标签]');
    expect(output.tags).toContain('self_harm_or_trauma_detail');
    expect(output.crisisHit).toBe(true);
  });

  it('无原文时生成不含身份线索的结构化摘要', () => {
    const output = redactJudgeInput({
      turnIndex: 4,
      riskLevel: 'low',
      eventTags: ['empathy', 'open_probe'],
    });

    expect(output.excerpt.structuredDigest).toBe(true);
    expect(output.excerpt.text).toContain('第4轮');
    expect(output.excerpt.text).toContain('empathy/open_probe');
    expect(output.excerpt.text).not.toContain('手机');
    expect(output.tags).toEqual(['structured_digest']);
  });

  it('危机识别覆盖高危等级 / 危机事件标签 / 自伤语义词', () => {
    expect(isCrisisSignal('high', [])).toBe(true);
    expect(isCrisisSignal('low', ['self_harm'])).toBe(true);
    expect(isCrisisSignal('low', [], '我想自杀')).toBe(true);
    expect(isCrisisSignal('low', ['empathy'], '今天聊了聊工作')).toBe(false);
  });

  it('装配出的 Judge 输入通过出境守卫 (无原始 PII)', () => {
    const session = makeSession('s-redaction', [
      makeTurn(1, { rawText: '我叫韩梅梅, 电话 13800138000' }),
      makeTurn(2, { events: ['empathy'] }),
    ]);
    const input = buildJudgeInput(session, { providerId: 'minimax', model: 'MiniMax-M3.1-Flash' });

    expect(input).not.toBeNull();
    expect(() => assertJudgeReviewInput(input)).not.toThrow();
    expect(input?.redactedExcerpts[0]?.text).not.toContain('韩梅梅');
    expect(input?.redactedExcerpts[0]?.text).not.toContain('13800138000');
  });
});
