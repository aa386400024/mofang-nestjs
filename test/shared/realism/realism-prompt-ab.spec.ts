// V2026-11-23 建立 (AF-329 · 真人度 prompt A/B 单测):
//   覆盖 prompt 分支、情绪标签剥离、消息序列、失败中止、分支数字与差值.
//   纯函数测试: 不调用真实模型, 不使用任何真实咨询文本.

import { describe, expect, it } from 'vitest';

import { buildBranchResult, buildDelta, runBranch } from '../../../bin/visitor-realism-prompt-ab.js';
import {
  REALISM_AB_BASE_SYSTEM,
  REALISM_AB_COUNSELOR_TURNS,
  buildCounselorMessage,
  buildRealismAbSystemPrompt,
  stripEmotionTags,
} from '../../../src/shared/realism/realism-prompt-ab.js';

describe('AF-329 · prompt 构造', () => {
  it('off 分支只有基础人设', () => {
    expect(buildRealismAbSystemPrompt('off')).toBe(REALISM_AB_BASE_SYSTEM);
    expect(buildRealismAbSystemPrompt('off')).not.toContain('你这一轮说话的真人质感');
  });

  it('active 分支在基础人设上追加生产同款真人度块', () => {
    const prompt = buildRealismAbSystemPrompt('active');
    expect(prompt.startsWith(REALISM_AB_BASE_SYSTEM)).toBe(true);
    expect(prompt).toContain('你这一轮说话的真人质感');
    expect(prompt.length).toBeGreaterThan(REALISM_AB_BASE_SYSTEM.length);
  });

  it('固定 6 个咨询师轮次', () => {
    expect(REALISM_AB_COUNSELOR_TURNS).toHaveLength(6);
    expect(buildCounselorMessage(REALISM_AB_COUNSELOR_TURNS[0]).startsWith('咨询师：')).toBe(true);
  });

  it('剥离情绪标签', () => {
    expect(stripEmotionTags('嗯，我有点累 [emotion:疲惫]')).toBe('嗯，我有点累');
    expect(stripEmotionTags('[emotion:anxious] 我睡不着')).toBe('我睡不着');
    expect(stripEmotionTags('没有标签')).toBe('没有标签');
  });
});

describe('AF-329 · 分支执行', () => {
  it('按 6 轮交替追加咨询师与来访者消息', async () => {
    const seen: number[] = [];
    const result = await runBranch(
      'active',
      async (messages) => {
        seen.push(messages.length);
        return `嗯，第 ${seen.length} 轮我有点说不上来`;
      },
      6,
    );
    expect(result.texts).toHaveLength(6);
    expect(result.failedTurns).toBe(0);
    expect(result.failure).toBeNull();
    expect(seen).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('模型失败时立即停止并如实计数', async () => {
    let calls = 0;
    const result = await runBranch(
      'off',
      async () => {
        calls += 1;
        if (calls === 3) throw new Error('mock failure');
        return '嗯，我还好';
      },
      6,
    );
    expect(result.texts).toHaveLength(2);
    expect(result.failedTurns).toBe(1);
    expect(result.failure).toContain('mock failure');
    expect(calls).toBe(3);
  });
});

describe('AF-329 · 分支数字与差值', () => {
  const texts = [
    '嗯，我最近总是睡不好',
    '就是……躺下以后脑子停不下来',
    '不对，我是说一到晚上就开始想工作的事',
    '白天也一直绷着',
    '那个，我其实不太想让家里知道',
    '我想试试看',
  ];

  it('分支汇总六类与宽度指标', () => {
    const branch = buildBranchResult('active', texts, 0, null);
    expect(branch.mode).toBe('active');
    expect(branch.completedTurns).toBe(6);
    expect(branch.typeCounts.filler).toBeGreaterThan(0);
    expect(branch.metrics['text.disfluency.event_turn_rate']).toBeGreaterThan(0);
    expect(branch.auditEvaluation.status).toBe('not_applicable');
    expect(branch.activeHypothetical).not.toBeNull();
    expect(branch.activeHypothetical?.applicable).toBe(true);
  });

  it('差值按 active - off 计算', () => {
    const off = buildBranchResult('off', texts, 0, null);
    const active = buildBranchResult('active', texts, 0, null);
    const delta = buildDelta(off, active);
    expect(delta['text.disfluency.events_per_turn']).toBe(0);
    expect(delta['text.disfluency.event_turn_rate']).toBe(0);
  });
});
