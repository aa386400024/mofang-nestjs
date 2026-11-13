// V2026-11-13 建立 (TD-6 · 观察项 #3 · 角色实体 row builder):
//   职责: 给 `character_profiles` 表的行造**一份**共享夹具 —— 默认值工厂 + overrides 合并.
//   边界: 纯 TS, 零 IO; 只描述**行**的形状, 不碰内核映射 (那是 resolver 的事).
//
//   为什么要有这个文件 (而不是每个 spec 各写一份):
//     角色实体**后加列**很多 (WP38 semver 三列 / WP49 大五人格 / WP51 同盟两列 / WP-J P2 台词指纹),
//     四个 spec 各有**局部** buildRow —— 每份只填自己关心的列, 剩下的列"缺着".
//     缺着的后果不是编译错误, 而是**夹具漂移**: 生产实体加列时四份夹具要各改一次,
//     漏改的那份仍然绿 (它用的是类型断言), 但它测的是**旧形状**的世界.
//     共享一份 = 默认值只有一处真相, 与实体列的 default / nullable 口径逐条对齐.
//
//   ⚠️ 它**不是** spec (文件名不含 `.spec`) —— vitest 不会把它当测试收集.
//
//   ⚠️ 默认值口径 (与 `character-profile.entity.ts` 的列定义对齐):
//     · NOT NULL DEFAULT 列 → 用 DDL 里的默认值 (versionMajor=1 / versionMinor=0 / versionPatch=0 等);
//     · nullable 列 → null (personalityTraits / verbalVoice);
//     · 内容列 (fivePs / coreBeliefs / underlyingDesires / forbiddenBehaviors / sensitiveTopics)
//       → 空集合 —— "这一行没有内容", 不是"这一行的内容是 undefined".

import type { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';

/**
 * 造一行角色实体 (默认值工厂 + overrides).
 *
 * @param overrides 列覆盖 (缺省 = 全默认)
 * @returns 角色行
 */
export function buildCharacterProfileRow(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
  return {
    id: 'row-1',
    templateId: 'vpt_test_l1',
    displayName: '测试角色',
    attachmentStyle: 'avoidant',
    fivePs: {
      presenting: '',
      precipitating: '',
      maintaining: '',
      protective: '',
      vulnerability: '',
    },
    // WP49: 大五人格是**可空**列 —— NULL = 角色没表态 (内核按"没说"处理).
    personalityTraits: null,
    baselineTrust: 0.3,
    baselineResistanceVerbal: 0.5,
    baselineResistanceDepth: 0.5,
    baselineResistanceStyle: 0.5,
    baselineEmotionValence: 0,
    baselineEmotionArousal: 0.4,
    // WP51: 同盟两列 NOT NULL DEFAULT —— 与内核 DEFAULT_SAFETY / DEFAULT_BOND 同值.
    baselineSafety: 0.5,
    baselineBond: 0,
    // WP10A: 表达风格三列 NOT NULL DEFAULT.
    speechVolumeBaseline: 0.5,
    narrativeStyle: 'mixed',
    expressionTone: 'restrained',
    // WP-J P2: 台词指纹可空 —— NULL = 不渲染.
    verbalVoice: null,
    coreBeliefs: [],
    underlyingDesires: [],
    forbiddenBehaviors: [],
    sensitiveTopics: [],
    auditStatus: 'draft',
    enabled: true,
    version: 1,
    // WP38: semver 三列 —— 版本判定只读这三列 (version 只是"改过几次"的计数).
    versionMajor: 1,
    versionMinor: 0,
    versionPatch: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}
