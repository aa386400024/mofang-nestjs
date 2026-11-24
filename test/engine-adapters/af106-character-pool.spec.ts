// V2026-11-18 治本 (AF-106 · 角色池扩展; AF-466 扩到 10 角色):
//   钉死 B 类（DB-only）角色的三条契约:
//     1. 4 条内容行都能装配出来，且与 A 类 6 条一起构成 10 个互不重复的 profile；
//     2. 每行核心信念带真实陈述与主题，不出现 `unspecified` 占位；
//     3. 数值 / 台词指纹 / 语域指纹与本仓权威标定表逐列相等，没有复制第二份基线真相。

import { describe, expect, it } from 'vitest';

import { getBaselineCalibration } from '../../src/engine-adapters/wiring/character/character-baseline-calibration.js';
import {
  buildDbOnlyCharacterProfileSeeds,
  DB_ONLY_CHARACTER_PROFILE_SEED_SPECS,
} from '../../src/engine-adapters/wiring/character/character-profile.db-only.seed.js';
import {
  CHARACTER_PROFILE_SEED_SPECS,
  deriveCharacterProfileId,
} from '../../src/engine-adapters/wiring/character/character-profile.seed.js';
import { getVisitorSpeechRegister } from '../../src/shared/speech-register/speech-register.calibration.js';

describe('AF-106 · 10 角色池', () => {
  const dbOnly = buildDbOnlyCharacterProfileSeeds();

  it('B 类 4 条与 A 类 6 条合并后是 10 个互不重复的 profile', () => {
    const aIds = CHARACTER_PROFILE_SEED_SPECS.map((spec) => deriveCharacterProfileId(spec.templateId));
    const allIds = [...aIds, ...dbOnly.map((seed) => seed.id)];

    expect(dbOnly).toHaveLength(4);
    expect(aIds).toHaveLength(6);
    expect(allIds).toHaveLength(10);
    expect(new Set(allIds).size).toBe(10);
    expect(allIds.every((id) => id.length >= 32)).toBe(true);
  });

  it('每行核心信念都带真实陈述与主题, 不出现 unspecified 占位', () => {
    for (const seed of dbOnly) {
      expect(seed.displayName.length).toBeGreaterThan(0);
      expect(seed.coreBeliefs.length).toBeGreaterThanOrEqual(2);
      expect(seed.coreBeliefs.every((belief) => belief.statement.length > 0)).toBe(true);
      expect(seed.coreBeliefs.every((belief) => belief.theme !== 'unspecified')).toBe(true);
      // AF-357 起，装配后的 underlyingDesires 已是内核四键规范形；多个角色级愿望
      //   可能合并到同一内核键（如安然 acceptance+authenticity→accepted），
      //   因此这里守的是“原始池至少有 2 条诉求 + 规范形至少保留 1 条”，
      //   而不是要求规范形长度仍为 2（那会把映射合并误判成数据缺失）。
      const raw = DB_ONLY_CHARACTER_PROFILE_SEED_SPECS.find((spec) => spec.templateId === seed.templateId);
      expect(raw?.underlyingDesires.length).toBeGreaterThanOrEqual(2);
      expect(seed.underlyingDesires.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('数值 / 台词指纹 / 语域指纹与权威标定表逐列相等', () => {
    for (const seed of dbOnly) {
      const row = getBaselineCalibration(seed.templateId);
      expect(seed.trust).toBe(row.trust);
      expect(seed.resistance).toBe(row.resistance);
      expect(seed.emotion).toBe(row.emotion);
      expect(seed.safety).toBe(row.safety);
      expect(seed.bond).toBe(row.bond);
      expect(seed.verbalVoice).toEqual(row.verbalVoice);
      // AF-466: B 类角色没有来访池模板, 语域只能随内容 seed 一起装配;
      //   这里钉住"真的有值, 且等于唯一真相源".
      expect(seed.speechRegister).toBeDefined();
      expect(seed.speechRegister).toEqual(getVisitorSpeechRegister(seed.templateId));
    }
  });
});
