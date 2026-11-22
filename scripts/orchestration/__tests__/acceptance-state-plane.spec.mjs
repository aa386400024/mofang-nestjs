import { describe, expect, it } from 'vitest';

import { STATE_PLANE_ARTIFACTS, isStatePlaneArtifact } from '../acceptance-runner.mjs';

describe('acceptance state-plane artifacts', () => {
  it('excludes CLI-generated improvement ledger from task delivery face', () => {
    expect(isStatePlaneArtifact('docs/team/agent-orchestration/improvement-log.json')).toBe(true);
  });

  it('excludes every declared state-plane artifact', () => {
    for (const artifact of STATE_PLANE_ARTIFACTS) {
      expect(isStatePlaneArtifact(artifact)).toBe(true);
    }
  });

  it('does not treat a task deliverable as state plane', () => {
    expect(isStatePlaneArtifact('docs/worklog/pending/phase2.5-README.md')).toBe(false);
    expect(isStatePlaneArtifact('src/auto-practice/metrics/counselor-quality.ts')).toBe(false);
  });
});
