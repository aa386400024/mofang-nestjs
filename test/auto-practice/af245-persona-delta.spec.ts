import { describe, expect, it } from 'vitest';

import type { SimScoredSession } from '../../bin/visitor-sim-analysis.js';
import { auditPersonaDeltas } from '../../bin/visitor-sim-persona-delta.js';

function scored(
  arm: string,
  personaId: string,
  difficulty: 'L1' | 'L2' | 'L3',
  overall: readonly [number, number],
  dims: readonly [number, number, number, number, number],
): SimScoredSession {
  return {
    sessionId: `af232_${arm}_${personaId}_${difficulty}`,
    arm,
    difficulty,
    scores: [
      {
        raterId: 'R1',
        provider: 'minimax',
        model: 'MiniMax-M3.1-Flash',
        dimensions: {
          naturalness: dims[0],
          emotional_continuity: dims[1],
          turn_shape: dims[2],
          scene_congruence: dims[3],
          relational_presence: dims[4],
        },
        overall: overall[0],
        parseRetries: 0,
        promptTokens: 1,
        completionTokens: 1,
        reasoningTokens: 0,
      },
      {
        raterId: 'R2',
        provider: 'doubao',
        model: 'doubao-seed-2-1-lite-260915',
        dimensions: {
          naturalness: dims[0],
          emotional_continuity: dims[1],
          turn_shape: dims[2],
          scene_congruence: dims[3],
          relational_presence: dims[4],
        },
        overall: overall[1],
        parseRetries: 0,
        promptTokens: 1,
        completionTokens: 1,
        reasoningTokens: 0,
      },
    ],
  };
}

describe('AF-245 逐 persona 差异审计', () => {
  it('按 persona × 难度聚合均分，输出升序 delta 与赢/平/输计数', () => {
    const summary = auditPersonaDeltas(
      [
        scored('E', 'vpt_grief', 'L1', [3, 3], [3, 3, 3, 3, 3]),
        scored('H', 'vpt_grief', 'L1', [4, 4], [4, 4, 4, 4, 5]),
        scored('E', 'vpt_worth', 'L2', [4, 4], [4, 4, 4, 4, 4]),
        scored('H', 'vpt_worth', 'L2', [3, 3], [3, 3, 3, 3, 2]),
        scored('E', 'vpt_same', 'L3', [3, 3], [3, 3, 3, 3, 3]),
        scored('H', 'vpt_same', 'L3', [3, 3], [3, 3, 3, 3, 3]),
      ],
      'E',
      'H',
    );

    expect(summary.improved).toBe(1);
    expect(summary.regressed).toBe(1);
    expect(summary.tied).toBe(1);
    const first = summary.rows[0];
    expect(first).toMatchObject({ personaId: 'vpt_worth', difficulty: 'L2', baselineMean: 4, candidateMean: 3, delta: -1 });
    // eslint-disable-next-line @typescript-eslint/dot-notation -- noPropertyAccessFromIndexSignature 要求索引访问
    expect(first?.dimensionDeltas['relational_presence']).toBe(-2);
    expect(summary.rows.at(-1)).toMatchObject({ personaId: 'vpt_grief', delta: 1 });
  });

  it('样本缺失时按实际场次计数，不把缺失当 0 分', () => {
    const summary = auditPersonaDeltas([scored('E', 'vpt_grief', 'L1', [3, 3], [3, 3, 3, 3, 3])], 'E', 'H');
    expect(summary.rows[0]).toMatchObject({ baselineSessions: 1, candidateSessions: 0, candidateMean: 0 });
  });
});
