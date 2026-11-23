// AF-358 · 角色愿望映射来源保全（P1-2）:
//   合并到同一内核键时, 原始角色键与标签必须保留, 不做“删除式合并”.
//   边界：纯数据 + 纯函数；不连 DB，不读 env，不起 Nest 容器.

import { describe, expect, it } from 'vitest';

import { mapRoleDesiresToCore, mapRoleDesiresToCoreDetailed } from '../../src/engine-adapters/wiring/character/character-desire-mapping.js';
import { buildInitialSnapshot } from '../../src/engine-core/domain/bootstrap.js';
import type { UnderlyingDesireSeed } from '../../src/engine-core/index.js';

describe('AF-358 · P1-2 映射来源保全', () => {
  it('安然 acceptance + authenticity 合并到 accepted，两条来源都保留', () => {
    const details = mapRoleDesiresToCoreDetailed([
      { key: 'acceptance', label: '被接纳与认可', baselineWeight: 0.6 },
      { key: 'authenticity', label: '能按自己的样子生活', baselineWeight: 0.55 },
    ]);
    expect(details.desires).toHaveLength(1);
    expect(details.desires[0]).toMatchObject({
      key: 'accepted',
      label: '被接纳与认可',
      baselineWeight: 0.6,
      sourceKeys: ['acceptance', 'authenticity'],
      sourceLabels: ['被接纳与认可', '能按自己的样子生活'],
    });
  });

  it('权重仍取最大不求和，来源保全不改变决策信号', () => {
    const mapped = mapRoleDesiresToCore([
      { key: 'recognition', label: '被看见', baselineWeight: 0.2 },
      { key: 'safe_grief', label: '悲伤被接住', baselineWeight: 0.5 },
    ]);
    expect(mapped[0]?.baselineWeight).toBe(0.5);
  });

  it('已映射结果再映射一次 → 来源字段与权重逐字不变（幂等）', () => {
    const once = mapRoleDesiresToCore([
      { key: 'acceptance', label: '被接纳与认可', baselineWeight: 0.6 },
      { key: 'authenticity', label: '能按自己的样子生活', baselineWeight: 0.55 },
    ]);
    const twice = mapRoleDesiresToCore(once);
    expect(twice).toEqual(once);
  });

  it('bootstrap 快照承载来源字段，内核决策仍只读四键', () => {
    const seed: UnderlyingDesireSeed[] = [
      { key: 'acceptance', label: '被接纳与认可', baselineWeight: 0.6 },
      { key: 'authenticity', label: '能按自己的样子生活', baselineWeight: 0.55 },
    ];
    const snapshot = buildInitialSnapshot({
      underlyingDesires: mapRoleDesiresToCore(seed),
      forbiddenBehaviors: [],
      sensitiveTopics: [],
      coreBeliefs: [],
    });
    const accepted = snapshot.underlyingDesires.find((desire) => desire.key === 'accepted');
    expect(accepted?.sourceKeys).toEqual(['acceptance', 'authenticity']);
    expect(accepted?.sourceLabels).toEqual(['被接纳与认可', '能按自己的样子生活']);
    expect(
      snapshot.underlyingDesires.filter((desire) => ['understood', 'accepted', 'avoid_pain', 'control'].includes(desire.key)),
    ).toHaveLength(1);
  });
});
