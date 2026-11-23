// AF-359 · 映射来源 (key,label) 对契约：长度 1:1、赢家标签置首、二次映射幂等.
//   边界：纯函数，不读 DB / 不读 env.

import { describe, expect, it } from 'vitest';

import { mapRoleDesiresToCore, mapRoleDesiresToCoreDetailed } from '../../src/engine-adapters/wiring/character/character-desire-mapping.js';

describe('AF-359 · 来源对契约', () => {
  it('同内核键合并 → keys 与 labels 长度一致，赢家标签置首', () => {
    const result = mapRoleDesiresToCoreDetailed([
      { key: 'acceptance', label: '被接纳（旧）', baselineWeight: 0.4 },
      { key: 'authenticity', label: '真实的我', baselineWeight: 0.7 },
    ]);
    const accepted = result.desires.find((desire) => desire.key === 'accepted');
    expect(accepted?.sourceKeys).toHaveLength(2);
    expect(accepted?.sourceLabels).toHaveLength(2);
    expect(accepted?.label).toBe('真实的我');
    expect(accepted?.sourceLabels?.[0]).toBe('真实的我');
    expect(accepted?.sourceKeys?.[0]).toBe('authenticity');
  });

  it('两个来源键同名标签 → 按 (key,label) 对保留两条，长度仍 1:1', () => {
    const result = mapRoleDesiresToCoreDetailed([
      { key: 'acceptance', label: '被接纳', baselineWeight: 0.4 },
      { key: 'authenticity', label: '被接纳', baselineWeight: 0.7 },
    ]);
    const accepted = result.desires.find((desire) => desire.key === 'accepted');
    expect(accepted?.sourceKeys).toHaveLength(2);
    expect(accepted?.sourceLabels).toHaveLength(2);
    expect(accepted?.sourceLabels).toEqual(['被接纳', '被接纳']);
  });

  it('已带来源但 labels 缺项 → 补齐到与 keys 等长，不产生空洞', () => {
    const first = mapRoleDesiresToCore([
      { key: 'accepted', label: '合并后', baselineWeight: 0.6, sourceKeys: ['a', 'b'], sourceLabels: ['x'] },
    ]);
    const accepted = first[0];
    expect(accepted?.sourceKeys).toHaveLength(2);
    expect(accepted?.sourceLabels).toHaveLength(2);
    expect(accepted?.sourceLabels?.[1]).toBe('合并后');
  });

  it('二次映射幂等：来源数组逐字不变', () => {
    const first = mapRoleDesiresToCore([
      { key: 'acceptance', label: '被接纳（旧）', baselineWeight: 0.4 },
      { key: 'authenticity', label: '真实的我', baselineWeight: 0.7 },
    ]);
    const second = mapRoleDesiresToCore(first);
    expect(second).toEqual(first);
  });
});
