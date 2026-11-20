// V2026-11-20 建立 (AF-204 · 输出闸门扩充 · JSON/结构化/未闭合推理/英文残片):
//   覆盖四类"模型交上来的是结构、不是台词"的坏输出：
//     ① JSON 对象 / 数组摘要（`{"emotion": "焦虑"}`、`["焦虑", "疲惫"]`）；
//     ② 字段化结构输出（`情绪：焦虑\n原因：压力`）；
//     ③ 未闭合推理（`让我想想……`：思考说出口且没说完）；
//     ④ 无标签英文推理残片（出现在台词中间，无推理标签也无开头标记）。
//   以及安全兜底台词的**场景中立**约束（四个场景档案逐个断言零漂移）。
//
//   纯函数测试：不起 Nest、不连 DB、不调 LLM、不读任何真实逐字稿。
//
//   验证: pnpm exec vitest run test/auto-practice/af204-output-integrity-shape.spec.ts

import { describe, expect, it } from 'vitest';

import { detectEncounterDrift, ENCOUNTER_SCENE_PROFILES } from '../../src/shared/encounter/encounter-scene.js';
import { inspectGeneratedOutput, safeOutputFallback, type OutputRole } from '../../src/shared/text/output-integrity.js';

/** 兜底句必须在这些场景下都零漂移（面对面 + 线上三通道）。 */
const SCENE_PROFILES: readonly { readonly mode: string; readonly channel?: string }[] = [
  { mode: 'in_person' },
  { mode: 'online', channel: 'voice' },
  { mode: 'online', channel: 'video' },
  { mode: 'online', channel: 'text' },
];

describe('AF-204 · 输出闸门 · JSON 摘要 / 结构化输出', () => {
  it.each([
    ['JSON 对象摘要', '{"emotion": "焦虑", "summary": "来访者提到工作压力"}', 'visitor', 'json_object'],
    ['截断的未闭合 JSON 对象', '{"emotion": "焦虑", "risk"', 'counselor', 'json_object'],
    ['没加引号键的 JSON 退化形态', '{emotion: 焦虑}', 'visitor', 'json_object'],
    ['JSON 数组摘要', '["焦虑", "疲惫"]', 'visitor', 'json_array'],
    ['字段化结构输出', '情绪：焦虑\n原因：工作压力\n建议：继续倾听', 'visitor', 'structured_output'],
    ['单行摘要标签', '情绪：焦虑', 'visitor', 'structured_output'],
  ])('%s 判非法', (_name, text, role, reason) => {
    const verdict = inspectGeneratedOutput(text, role as OutputRole);
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain(reason);
  });

  it('结构化输出不得误伤正常口语里的单行引语', () => {
    // 「他说：我不去」是引语, 不是结构化输出; 单行字段标签不判非法.
    const verdict = inspectGeneratedOutput('他说：我不想去。', 'visitor');
    expect(verdict.invalid).toBe(false);
    expect(verdict.reasons).not.toContain('structured_output');
  });

  it('结构化输出不得误伤长引语句', () => {
    // 标签过长（> 6 汉字）不是字段名, 只是一个被引出来的话.
    const verdict = inspectGeneratedOutput('我说的是这个意思：我有点难受。', 'visitor');
    expect(verdict.invalid).toBe(false);
  });
});

describe('AF-204 · 输出闸门 · 未闭合推理', () => {
  it('「让我想想……」判非法', () => {
    const verdict = inspectGeneratedOutput('让我想想……', 'visitor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('unclosed_reasoning');
  });

  it('推理开头 + 悬空标点同样判非法', () => {
    const verdict = inspectGeneratedOutput('让我想想，', 'counselor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('unclosed_reasoning');
  });

  it('说完的思考（后面有结论）不判非法', () => {
    const verdict = inspectGeneratedOutput('让我想想……我大概知道该怎么说了。', 'visitor');
    expect(verdict.invalid).toBe(false);
    expect(verdict.reasons).not.toContain('unclosed_reasoning');
  });
});

describe('AF-204 · 输出闸门 · 无标签英文推理残片', () => {
  it('台词中间的英文推理片段判非法', () => {
    const verdict = inspectGeneratedOutput('我有点紧张。We should respond with empathy.', 'counselor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('english_reasoning');
  });

  it('短英文残片（没到 4 字母阈值）也判非法', () => {
    const verdict = inspectGeneratedOutput('我有点紧张。I do.', 'visitor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('english_reasoning');
  });

  it('约定缩写不误判成英文推理残片', () => {
    for (const line of ['你之前做过 CBT 吗？', '这次量表 PHQ 的分数先不谈。', '我们用 EMDR 试试。']) {
      const verdict = inspectGeneratedOutput(line, 'counselor');
      expect(verdict.invalid, `约定缩写被误杀: ${line}`).toBe(false);
    }
  });
});

describe('AF-204 · 安全兜底台词 · 场景中立', () => {
  it('兜底句在四个场景档案下都零漂移（不预设线上 / 线下）', () => {
    for (const scene of SCENE_PROFILES) {
      for (const role of ['visitor', 'counselor'] as const) {
        const fallback = safeOutputFallback(role);
        const drift = detectEncounterDrift(fallback, scene);
        expect(drift, `${role}/${scene.mode}/${scene.channel ?? '-'} 兜底句违反场景契约: ${drift.join(',')}`).toEqual([]);
      }
    }
  });

  it('兜底句自身能通过输出闸门（不会刚兜底就被再拦一次）', () => {
    for (const role of ['visitor', 'counselor'] as const) {
      const verdict = inspectGeneratedOutput(safeOutputFallback(role), role);
      expect(verdict.invalid, `${role} 兜底句自身被判非法: ${verdict.reasons.join(',')}`).toBe(false);
    }
  });

  it('兜底句不含任何媒介词（面对面 / 线上通用）', () => {
    const forbidden = [...ENCOUNTER_SCENE_PROFILES.in_person.forbiddenMedia, ...ENCOUNTER_SCENE_PROFILES.online.forbiddenMedia];
    for (const role of ['visitor', 'counselor'] as const) {
      const fallback = safeOutputFallback(role);
      for (const term of forbidden) {
        expect(fallback.includes(term), `${role} 兜底句含媒介词「${term}」`).toBe(false);
      }
    }
  });
});

describe('AF-204 · 输出闸门 · 正常中文台词零误报', () => {
  it('口语台词不被新拦截面误杀', () => {
    const lines = [
      '……嗯，我有点说不出来。',
      '你慢慢说，我在这里，不着急。',
      '我最近有点累，睡不太着。',
      '是这样吗？我可能没太听明白。',
      '我周末去爬山了，你平时周末都做什么？',
      '你应该先想清楚自己到底要什么。',
      '他不是本地人，是外地来这边工作的。',
    ];
    for (const line of lines) {
      const verdict = inspectGeneratedOutput(line, 'visitor');
      expect(verdict.invalid, `正常台词被误杀: ${line} → ${verdict.reasons.join(',')}`).toBe(false);
    }
  });
});
