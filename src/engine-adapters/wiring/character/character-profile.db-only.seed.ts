// V2026-11-18 治本 (AF-106 · 8 角色池扩展):
//   背景: 批次脚本按 8 个 slug 选题，但库里只有 4 个 approved 的 character_profiles，
//   另外 4 个（安然 / 语桐 / 沉舟 / 惊尘）只做过基线校准、没有内容行，角色池实际只跑到 4 位。
//
//   本文件是 B 类（DB-only，没有来访池模板）角色的**内容种子**:
//   - 数值与台词指纹仍从 `character-baseline-calibration.ts` 装配，不复制第二份真相；
//   - 核心信念陈述随规格自带（B 类没有来访池模板可抽取）；
//   - 装配走 `assembleCharacterProfileSeed`，与 A 类共享同一份字段映射。
//
//   边界: 纯数据 + 纯函数，零 IO / 零 NestJS / 零网络；不碰来访池模板。

import { getBaselineCalibration } from './character-baseline-calibration.js';
import { assembleCharacterProfileSeed, type CharacterProfileSeed, type CharacterProfileSeedSpec } from './character-profile.seed.js';

/**
 * 从权威标定表装配数值 + 台词指纹（与 A 类 `baselineOf` 同口径）。
 *
 * @param templateId 角色模板 slug
 * @returns 可直接展开进规格的基线字段
 */
function baselineOf(
  templateId: string,
): Pick<CharacterProfileSeedSpec, 'trust' | 'resistance' | 'emotion' | 'safety' | 'bond' | 'verbalVoice'> {
  const row = getBaselineCalibration(templateId);
  return {
    trust: row.trust,
    resistance: row.resistance,
    emotion: row.emotion,
    safety: row.safety,
    bond: row.bond,
    verbalVoice: row.verbalVoice,
  };
}

/**
 * B 类角色内容规格（4 位，均为既有标定表里的 profile slug）。
 *
 * 临床口径: 都是普通来访者样本，不含急性危机 / 自伤计划 / 具体创伤事件细节；
 * 5Ps 只写维持机制与保护因素，供人读，不进内核决策。
 */
export const DB_ONLY_CHARACTER_PROFILE_SEED_SPECS: readonly CharacterProfileSeedSpec[] = [
  {
    templateId: 'vpt_general_secure_l1',
    displayName: '安然',
    attachmentStyle: 'secure',
    beliefMeta: [
      { theme: 'secure_self_worth', activationTags: ['self_worth', 'acceptance', 'closeness'] },
      { theme: 'secure_conflict', activationTags: ['conflict', 'repair', 'trust'] },
    ],
    coreBeliefStatements: ['我大体上是值得被好好对待的，不用先证明自己。', '关系里有分歧不等于关系要结束，可以坐下来谈。'],
    ...baselineOf('vpt_general_secure_l1'),
    underlyingDesires: [
      { key: 'acceptance', label: '被接纳与认可', baselineWeight: 0.6 },
      { key: 'authenticity', label: '能按自己的样子生活', baselineWeight: 0.55 },
    ],
    forbiddenBehaviors: ['贬低自己来维持关系', '用沉默惩罚对方', '把问题全部归咎于对方'],
    sensitiveTopics: ['被比较', '让家人失望', '被当成“不懂事”'],
    fivePs: {
      presenting: '工作与家庭两头忙，最近容易累，但能说清自己的感受，也想学会更早地给自己留空间。',
      precipitating: '连续几周加班后，发现自己对家人说话开始没耐心，担心把压力带回家。',
      maintaining: '习惯先扛住、事后再处理情绪，短期有效但长期消耗；好在愿意主动求助与试新方法。',
      protective: '安全型依恋带来的关系修复能力、稳定的社会支持，以及较好的自我觉察。',
      vulnerability: '早年经历过一次重要分离，遇到“被落下”的场景仍会短暂紧张。',
    },
  },
  {
    templateId: 'vpt_social_anxious_l1',
    displayName: '语桐',
    attachmentStyle: 'anxious',
    beliefMeta: [
      { theme: 'negative_evaluation', activationTags: ['evaluation', 'attention', 'mistake'] },
      { theme: 'rejection_sensitivity', activationTags: ['rejection', 'approval', 'expression'] },
    ],
    coreBeliefStatements: ['别人会注意到我的不自然，然后觉得我很奇怪。', '我说错一句话，就会被否定整个人。'],
    ...baselineOf('vpt_social_anxious_l1'),
    underlyingDesires: [
      { key: 'belonging', label: '被群体接纳、不被排斥', baselineWeight: 0.7 },
      { key: 'acceptance', label: '被看见真实的样子', baselineWeight: 0.62 },
    ],
    forbiddenBehaviors: ['在别人面前表达强烈不满', '主动成为注意中心', '直接拒绝别人'],
    sensitiveTopics: ['被注视', '当众发言', '说错话'],
    fivePs: {
      presenting: '开会发言前会反复打草稿，说完又反复回想自己哪句说错了，越想越不敢开口。',
      precipitating: '新团队要求轮流主持周会，第一次主持后觉得自己“卡壳了”，之后开始回避发言。',
      maintaining: '用提前准备和少说话来控制风险，短期减少焦虑，长期让“我不擅长表达”的信念更牢固。',
      protective: '对关系敏感、准备充分、愿意观察学习，咨询中能较快建立信任。',
      vulnerability: '童年常被当众纠正，形成“说错就会被否定”的敏感点。',
    },
  },
  {
    templateId: 'vpt_depression_avoidant_l1',
    displayName: '沉舟',
    attachmentStyle: 'avoidant',
    beliefMeta: [
      { theme: 'hopelessness', activationTags: ['fatigue', 'meaning', 'change'] },
      { theme: 'isolation', activationTags: ['withdrawal', 'understanding', 'help'] },
    ],
    coreBeliefStatements: ['我没有力气改变什么，努力也不会有用。', '没有人真的能理解我，说了也只是添麻烦。'],
    ...baselineOf('vpt_depression_avoidant_l1'),
    underlyingDesires: [
      { key: 'rest', label: '能停下来喘口气', baselineWeight: 0.55 },
      { key: 'being_understood', label: '被理解而不被催促', baselineWeight: 0.5 },
    ],
    forbiddenBehaviors: ['主动求助', '表达愤怒', '承诺具体的未来计划'],
    sensitiveTopics: ['无意义感', '起床与出门', '被催促“振作一点”'],
    fivePs: {
      presenting: '睡不好、没胃口，工作还能勉强做完，但下班后什么都不想做，觉得日子“就那样”。',
      precipitating: '项目收尾后连续两周低电量，被家人催着“振作”，更不想开口。',
      maintaining: '用少说话、少出门减少消耗，短期撑住日常，长期让支持系统越来越远。',
      protective: '仍有稳定的工作与基本自理能力，过去遇到困难时能靠责任感撑住。',
      vulnerability: '长期把情绪压在心里、缺少被接住的体验，形成“说了也没用”的预期。',
    },
  },
  {
    templateId: 'vpt_trauma_disorganized_l1',
    displayName: '惊尘',
    attachmentStyle: 'disorganized',
    beliefMeta: [
      { theme: 'unsafe_closeness', activationTags: ['closeness', 'trust', 'safety'] },
      { theme: 'hypervigilance', activationTags: ['noise', 'sudden', 'control'] },
    ],
    coreBeliefStatements: ['靠近别人最后会受伤，我得先保护好自己。', '我必须一直警惕，稍微放松就会出事。'],
    ...baselineOf('vpt_trauma_disorganized_l1'),
    underlyingDesires: [
      { key: 'safety', label: '确定自己是安全的', baselineWeight: 0.72 },
      { key: 'control', label: '能掌控周围发生的事', baselineWeight: 0.5 },
    ],
    forbiddenBehaviors: ['详细讲述创伤经过', '在陌生人面前放松警惕', '完全依赖别人'],
    sensitiveTopics: ['突然的声响', '被靠近', '失控'],
    fivePs: {
      presenting: '容易紧张、睡浅，遇到突然的动静会很久缓不过来；想靠近人，又怕靠近之后受伤。',
      precipitating: '最近搬进合租房，夜里听到关门声就会惊醒，白天上班注意力下降。',
      maintaining: '用警觉和保持距离来防止“再受伤”，短期有安全感，长期让人际支持难以建立。',
      protective: '较强的观察力与自我保护能力，愿意在安全节奏下一点点尝试。',
      vulnerability: '早年照养环境不稳定，形成“靠近与危险绑在一起”的混乱型预期。',
    },
  },
];

/**
 * 构造 B 类角色的完整灌库行。
 *
 * @returns 4 条完整行（顺序与 `DB_ONLY_CHARACTER_PROFILE_SEED_SPECS` 一致）
 * @throws Error 核心信念数量与结构声明不一致
 */
export function buildDbOnlyCharacterProfileSeeds(): CharacterProfileSeed[] {
  return DB_ONLY_CHARACTER_PROFILE_SEED_SPECS.map((spec) => {
    const statements = spec.coreBeliefStatements ?? [];
    if (statements.length !== spec.beliefMeta.length || statements.length === 0) {
      throw new Error(`角色 ${spec.templateId} 的核心信念数量对不上 (自带 ${statements.length} 条 / 结构 ${spec.beliefMeta.length} 条)`);
    }
    return assembleCharacterProfileSeed(spec, statements);
  });
}
