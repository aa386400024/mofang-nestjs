// V2026-10-29 治本 (WP9-A · B 层 · 角色解析映射单测):
//   覆盖任务单 §10 清单 1-6:
//     1. 内置角色按 key 解析出非 null 的 characterProfile, 字段完整、数值落在 [0,1]
//     2. 可复现: 同角色 + 同 preset 连续两次 resolve 深相等 (含基线数值与 seed)
//     3. 可区分: 两角色的阻抗 / 信任 / 核心信念明显不同
//     4. 未知 templateId / 无任何角色参数 → 返回 null (不抛、不造默认角色)
//     5. 越界 preset → clamp01 兜底 (不抛、不 NaN、不越界)
//     6. baseline.emotion 不手填 label (只给 valence / arousal)
//
//   全 mock: 纯数据 + 纯函数, 不连上游 / DB / 网络.
//
//   为什么"可复现"与"可区分"必须各有用例 (而不是靠人读种子表):
//     可复现 = 同一角色每次开场是**同一个人** —— 伦理盲盒 (WP3/WP10) 的触发点不能漂;
//     可区分 = 两个角色不能共用一副底色 —— 否则"选角色"这个产品动作没有意义.
//     人眼看两个种子表只能确认"好像不一样", 只有把数值断言下来才钉得住.
//
//   为什么第 5 条要盯"clamp 而不是裸加":
//     越界参数如果裸加 (0.62 + (-0.2) = 0.42), 结果看着"合理"却已经偏离种子基线 ——
//     而防御水平为负在物理上没有意义. 断言"越界 → 夹到边界, 且不低于种子基线"
//     才能证明夹取真的发生了, 而不是碰巧算出了一个看起来差不多的数.
//
//   验证: npx jest test/engine-adapters/wp9a-character-resolver.spec.ts
//   时间戳: 2026-10-29 GMT+8

import {
  BUILTIN_ANXIOUS_LOW_MOOD_L1,
  BUILTIN_AVOIDANT_L1,
  BuiltinCharacterProfileResolver,
  stableSeedFromKey,
  type CharacterPresetInput,
} from '../../src/engine-adapters/wiring/character';

const PRESET: CharacterPresetInput = {
  difficulty: 'L2',
  style: 'mixed',
  emotionBaseline: 0.4,
  defenseLevel: 0.3,
};

/** 解析器 (每条用例用独立实例, 避免互相污染). */
function buildResolver(): BuiltinCharacterProfileResolver {
  return new BuiltinCharacterProfileResolver();
}

/** 断言一个数值落在 [0,1] 且不是 NaN. */
function expectUnitInterval(value: number): void {
  expect(Number.isNaN(value)).toBe(false);
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
}

describe('WP9-A · 角色解析 (内置种子 → 内核 CharacterProfile)', () => {
  describe('① 按 key 解析出完整角色基线', () => {
    it('解析出非 null 的 characterProfile, 核心字段齐全且数值落在 [0,1]', async () => {
      const resolved = await buildResolver().resolve({ templateId: BUILTIN_AVOIDANT_L1.key });

      expect(resolved).not.toBeNull();
      const profile = resolved?.characterProfile;
      expect(profile).toBeDefined();

      // 信念 / 负向约束 / 敏感议题 / 底层愿望: 都必须是非空数组.
      expect(profile?.coreBeliefs.length ?? 0).toBeGreaterThan(0);
      expect(profile?.forbiddenBehaviors.length ?? 0).toBeGreaterThan(0);
      expect(profile?.sensitiveTopics.length ?? 0).toBeGreaterThan(0);
      expect(profile?.underlyingDesires?.length ?? 0).toBeGreaterThan(0);

      // 依恋风格由种子声明 (不由 preset 推导).
      expect(profile?.attachmentStyle).toBe('avoidant');

      // 基线数值全部落在 [0,1].
      const baseline = profile?.baseline;
      expect(baseline).toBeDefined();
      expectUnitInterval(baseline?.trust ?? Number.NaN);
      expectUnitInterval(baseline?.resistance?.verbal ?? Number.NaN);
      expectUnitInterval(baseline?.resistance?.depth ?? Number.NaN);
      expectUnitInterval(baseline?.resistance?.style ?? Number.NaN);
      expectUnitInterval(baseline?.emotion?.arousal ?? Number.NaN);
      expect(baseline?.emotion?.valence ?? Number.NaN).toBeGreaterThanOrEqual(-1);
      expect(baseline?.emotion?.valence ?? Number.NaN).toBeLessThanOrEqual(1);

      // 移情固定全零 (开场不预设正负).
      expect(baseline?.transference).toEqual({ positive: 0, negative: 0, dependency: 0 });

      // 展示名来自种子 (供 persona 快照 / 报告).
      expect(resolved?.displayName).toBe(BUILTIN_AVOIDANT_L1.displayName);
    });

    it('核心信念是第一人称陈述 + 带激活标签 (内核按标签触发)', async () => {
      const resolved = await buildResolver().resolve({ templateId: BUILTIN_ANXIOUS_LOW_MOOD_L1.key });

      for (const belief of resolved?.characterProfile.coreBeliefs ?? []) {
        expect(belief.statement.length).toBeGreaterThan(0);
        expect(belief.theme.length).toBeGreaterThan(0);
        expect(belief.activationTags.length).toBeGreaterThan(0);
      }
    });
  });

  describe('② 可复现 (同角色同 preset → 同一结果)', () => {
    it('连续两次 resolve 结果深相等 (含基线数值与 seed)', async () => {
      const resolver = buildResolver();

      const first = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key, preset: PRESET });
      const second = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key, preset: PRESET });

      expect(second).toEqual(first);
      expect(second?.seed).toBe(first?.seed);
      expect(second?.characterProfile.baseline?.trust).toBe(first?.characterProfile.baseline?.trust);
      expect(second?.characterProfile.baseline?.resistance).toEqual(first?.characterProfile.baseline?.resistance);
    });

    it('seed 由角色 key 稳定派生 (同一 key 永远同一个种子)', async () => {
      const resolver = buildResolver();

      const first = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });
      const second = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });

      expect(first?.seed).toBe(stableSeedFromKey(BUILTIN_AVOIDANT_L1.key));
      expect(second?.seed).toBe(first?.seed);
      // 不同角色 → 不同种子 (否则两个角色会共用同一条轨迹).
      const other = await resolver.resolve({ templateId: BUILTIN_ANXIOUS_LOW_MOOD_L1.key });
      expect(other?.seed).not.toBe(first?.seed);
    });

    it('结果对象不共享可变引用 (改一个不影响另一个)', async () => {
      const resolver = buildResolver();

      const first = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });
      const second = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });

      expect(second?.characterProfile.coreBeliefs).not.toBe(first?.characterProfile.coreBeliefs);
      expect(second?.characterProfile.forbiddenBehaviors).not.toBe(first?.characterProfile.forbiddenBehaviors);
      expect(second?.characterProfile.sensitiveTopics).not.toBe(first?.characterProfile.sensitiveTopics);
    });
  });

  describe('③ 可区分 (两个角色不是一副底色)', () => {
    it('两角色的阻抗 / 信任 / 核心信念明显不同', async () => {
      const resolver = buildResolver();

      const avoidant = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });
      const anxious = await resolver.resolve({ templateId: BUILTIN_ANXIOUS_LOW_MOOD_L1.key });

      expect(avoidant?.characterProfile.baseline?.trust).not.toBe(anxious?.characterProfile.baseline?.trust);
      expect(avoidant?.characterProfile.baseline?.resistance).not.toEqual(anxious?.characterProfile.baseline?.resistance);
      expect(avoidant?.characterProfile.coreBeliefs.map((belief) => belief.statement)).not.toEqual(
        anxious?.characterProfile.coreBeliefs.map((belief) => belief.statement),
      );
      expect(avoidant?.characterProfile.attachmentStyle).not.toBe(anxious?.characterProfile.attachmentStyle);
    });

    it('回避型阻抗高于焦虑型 (种子口径: 回避型更难被打开)', async () => {
      const resolver = buildResolver();

      const avoidant = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });
      const anxious = await resolver.resolve({ templateId: BUILTIN_ANXIOUS_LOW_MOOD_L1.key });

      expect(avoidant?.characterProfile.baseline?.resistance?.depth ?? 0).toBeGreaterThan(
        anxious?.characterProfile.baseline?.resistance?.depth ?? 0,
      );
      expect(avoidant?.characterProfile.baseline?.trust ?? 1).toBeLessThan(anxious?.characterProfile.baseline?.trust ?? 0);
    });

    it('临场参数能叠加出可区分的差异 (同角色不同难度 → 不同阻抗)', async () => {
      const resolver = buildResolver();

      const easy = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key, preset: { difficulty: 'L1' } });
      const hard = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key, preset: { difficulty: 'L3' } });

      expect(hard?.characterProfile.baseline?.resistance?.depth ?? 0).toBeGreaterThan(
        easy?.characterProfile.baseline?.resistance?.depth ?? 0,
      );
    });
  });

  describe('④ 查不到角色 → null (不抛, 不造默认角色)', () => {
    it('未知 templateId → null', async () => {
      await expect(buildResolver().resolve({ templateId: 'vpt_not_exists' })).resolves.toBeNull();
    });

    it('没有任何角色参数 → null (本场无角色)', async () => {
      await expect(buildResolver().resolve({})).resolves.toBeNull();
    });

    it('空白 templateId → null (等价于没传)', async () => {
      await expect(buildResolver().resolve({ templateId: ' '.repeat(3) })).resolves.toBeNull();
    });

    it('只给 skillCode 不给 templateId → null (skillCode 不是角色 key)', async () => {
      await expect(buildResolver().resolve({ skillCode: 'listening' })).resolves.toBeNull();
    });
  });

  describe('⑤ 越界临场参数 → clamp01 兜底', () => {
    it('emotionBaseline=1.9 → 唤醒夹到 1; defenseLevel=-0.2 → 夹到 0 (不低于种子基线)', async () => {
      const resolved = await buildResolver().resolve({
        templateId: BUILTIN_AVOIDANT_L1.key,
        preset: { emotionBaseline: 1.9, defenseLevel: -0.2 },
      });

      const baseline = resolved?.characterProfile.baseline;
      expect(baseline?.emotion?.arousal).toBe(1);
      expectUnitInterval(baseline?.emotion?.arousal ?? Number.NaN);
      // valence 是 [-1,1] 区间 (不是 [0,1]).
      expect(Number.isNaN(baseline?.emotion?.valence ?? Number.NaN)).toBe(false);
      expect(baseline?.emotion?.valence ?? Number.NaN).toBeGreaterThanOrEqual(-1);
      expect(baseline?.emotion?.valence ?? Number.NaN).toBeLessThanOrEqual(1);

      const resistance = baseline?.resistance;
      expectUnitInterval(resistance?.verbal ?? Number.NaN);
      expectUnitInterval(resistance?.depth ?? Number.NaN);
      expectUnitInterval(resistance?.style ?? Number.NaN);
      // 防御水平夹到 0 → 阻抗等于种子基线 (不是裸加一个负数).
      expect(resistance?.verbal).toBe(BUILTIN_AVOIDANT_L1.baseline.resistance.verbal);
      expect(resistance?.depth).toBe(BUILTIN_AVOIDANT_L1.baseline.resistance.depth);
    });

    it('emotionBaseline=-5 / defenseLevel=9 → 全部夹进 [0,1], 不出 NaN', async () => {
      const resolved = await buildResolver().resolve({
        templateId: BUILTIN_ANXIOUS_LOW_MOOD_L1.key,
        preset: { emotionBaseline: -5, defenseLevel: 9 },
      });

      const baseline = resolved?.characterProfile.baseline;
      expect(baseline?.emotion?.arousal).toBe(0);
      expectUnitInterval(baseline?.trust ?? Number.NaN);
      expectUnitInterval(baseline?.resistance?.verbal ?? Number.NaN);
      expectUnitInterval(baseline?.resistance?.depth ?? Number.NaN);
      expectUnitInterval(baseline?.resistance?.style ?? Number.NaN);
    });
  });

  describe('⑥ 情绪标签不由适配层手填', () => {
    it('baseline.emotion 只给 valence / arousal, 不含 label (标签由内核重算)', async () => {
      const resolved = await buildResolver().resolve({ templateId: BUILTIN_AVOIDANT_L1.key, preset: PRESET });

      const emotion = resolved?.characterProfile.baseline?.emotion;
      expect(emotion).toBeDefined();
      expect(emotion?.label).toBeUndefined();
      // 只有两个键 —— 多一个 label 就说明适配层在抢内核的活.
      expect(Object.keys(emotion ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual(['arousal', 'valence']);
    });

    it('valence 由种子给 (临场 emotionBaseline 只动唤醒, 不动效价)', async () => {
      const resolver = buildResolver();

      const withPreset = await resolver.resolve({
        templateId: BUILTIN_AVOIDANT_L1.key,
        preset: { emotionBaseline: 0.9 },
      });
      const withoutPreset = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });

      expect(withPreset?.characterProfile.baseline?.emotion?.valence).toBe(withoutPreset?.characterProfile.baseline?.emotion?.valence);
      expect(withPreset?.characterProfile.baseline?.emotion?.arousal).not.toBe(withoutPreset?.characterProfile.baseline?.emotion?.arousal);
    });
  });
});
