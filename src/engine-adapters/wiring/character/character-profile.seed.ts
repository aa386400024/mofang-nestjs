// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池内容基线 + 幂等灌入):
//   职责: 首批 4 个**真实 vpt slug** 的角色基线内容 (5Ps / 信念 / 愿望 / 负向约束 /
//         敏感议题 / 基线数值), 以及"按稳定 template_id 幂等 upsert"的灌入实现.
//   边界: 纯数据 + 纯函数 + 一段 upsert; 零 Nest 装饰器、零 counselor import
//         (来访池内容由调用方传入), 零映射公式 (映射在 WP9-A 的 buildCharacterProfile).
//
//   为什么内容不进 migration (跟仓库内容治理同范式):
//     角色内容是**会持续演进的内容资产** (运营改数值 / 改文案 / 上下架 / 审核).
//     灌进 migration 意味着"改一句主诉"也要加一条迁移 —— schema 与内容必须解耦.
//     故: migration 只建表; 内容走独立 seed 脚本 (bin/seed-character-profiles.ts),
//     按稳定 template_id 幂等 upsert, 跟 visitor_pool / quotes / practice_scenarios 同款.
//
//   为什么核心信念**从来访池抽取**而不是另写一份 (任务单 §6 硬要求):
//     同一个公共人物 (例: 晚晴) 的核心信念必须**只有一个真相**.
//     若引擎侧另写一份, 运营改了来访池剧本里的信念, 引擎侧不会跟着变 ——
//     于是"速查卡里的晚晴"和"引擎里的晚晴"变成了两个人.
//     所以本文件只声明**结构信息** (theme / 激活标签 / 数量), statement 一律从
//     `visitor_pool_templates.script.innerWorkingModel.coreBeliefs` 按下标抽取.
//
//   反双胞胎:
//     - 不在种子数据里手写 statement: 手写 = 第二份真相, 必然漂.
//     - 不把 5Ps 长文与基线数值混在一起: 长文给人读 (评审/报告), 数值给内核吃.
//     - **不改已有行的 enabled / audit_status**: 种子只写**内容字段**.
//       运营下架过的角色不该被 seed 悄悄重新上架, 审核结论也不该被种子推翻
//       (跟 visitor_pool "不改 enabled" 同款理由).
//     - 不用随机 UUID 做 id: id 由 template_id 内容派生 —— 同一模板永远同一个 id,
//       seed 重跑不会产生重复行, 不同库之间也可对照.
//     - 不在本文件写映射公式: 基线数值是**种子值**, 临场叠加归映射层.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9b-db-character-resolver.spec.ts 覆盖内容基线自检 + 与来访池对齐
//     3. npm run seed:character-profiles → 4 行; 连跑两次行数不变
//
//   时间戳: 2026-10-29

import { createHash } from 'node:crypto';

import { type DataSource } from 'typeorm';

import type { CharacterFivePs } from './character-profile.entity';
import { CharacterProfileEntity } from './character-profile.entity';
import type { AttachmentStyle, UnderlyingDesireSeed } from '../../../engine-core';

/**
 * 公共模板的内容来源 (最小结构).
 *
 * 为什么要**结构化声明**而不是 import 来访池的 seed 类型:
 *   本文件不 import counselor —— 引擎层不该在运行时/编译期依赖 counselor 层.
 *   来访池内容由调用方 (bin/seed-character-profiles.ts / 单测) 传入, 本文件只声明
 *   "我需要哪几个字段". 依赖方向因此是**单向的**: 脚本 → 两边, 引擎 ← 脚本.
 *   (本轮唯一需要来访池内容的地方是"抽取核心信念", 走参数注入比走跨层 import 更干净.)
 */
export interface VisitorTemplateBeliefSource {
  /** 公共模板 id (`vpt_*` slug). */
  readonly id: string;
  /** 匿名称呼 (例「晚晴」). */
  readonly codename: string;
  /** 7 大块剧本 (本文件只用 innerWorkingModel.coreBeliefs). */
  readonly script: {
    readonly innerWorkingModel: {
      /** 核心信念 (第一人称陈述, 字符串数组). */
      readonly coreBeliefs: readonly string[];
    };
  };
}

/**
 * 核心信念的结构信息 (statement 从来访池抽取, 这里只给 theme 与激活标签).
 */
export interface CharacterBeliefMeta {
  /** 主题标签 (内核按 activationTags 触发, theme 供报告/检索). */
  readonly theme: string;
  /** 激活标签 (命中即触发该信念的激活). */
  readonly activationTags: readonly string[];
}

/**
 * 角色内容基线 (一条 = 一个 vpt 模板的引擎侧角色).
 */
export interface CharacterProfileSeedSpec {
  /** 关联的公共模板 id (`vpt_*` slug). */
  readonly templateId: string;
  /** 展示用角色名 (= 模板 codename). */
  readonly displayName: string;
  /** 依恋风格. */
  readonly attachmentStyle: AttachmentStyle;
  /** 核心信念的结构信息 (与来访池 coreBeliefs **按下标**一一对应). */
  readonly beliefMeta: readonly CharacterBeliefMeta[];
  /** 初始信任 [0,1]. */
  readonly trust: number;
  /** 三维阻抗基线 [0,1]. */
  readonly resistance: { readonly verbal: number; readonly depth: number; readonly style: number };
  /** 情绪基调 (valence [-1,1] / arousal [0,1]). */
  readonly emotion: { readonly valence: number; readonly arousal: number };
  /** 底层愿望种子. */
  readonly underlyingDesires: readonly UnderlyingDesireSeed[];
  /** 绝不会做的事 (负向约束). */
  readonly forbiddenBehaviors: readonly string[];
  /** 敏感议题词表. */
  readonly sensitiveTopics: readonly string[];
  /** 5Ps 专业材料 (人读, 不进内核). */
  readonly fivePs: CharacterFivePs;
}

/**
 * 首批内容基线 (任务单 §6 拍板: 4 个 slug, 2 焦虑 × 2 回避).
 *
 * 基线数值口径: **抄 WP9-A 两个内置种子的档位** (anxious / avoidant 各一档) ——
 * 这是**工程种子值, 不是临床标定** (专业校准归后期专业评审).
 * 两档的可区分性由单测钉住 ("换角色 → 基线明显不同").
 */
export const CHARACTER_PROFILE_SEED_SPECS: readonly CharacterProfileSeedSpec[] = [
  {
    templateId: 'vpt_intimate_avoidance_l1',
    displayName: '晚晴',
    attachmentStyle: 'anxious',
    beliefMeta: [
      { theme: 'conditional_self_worth', activationTags: ['closeness', 'approval', 'self_worth'] },
      { theme: 'abandonment', activationTags: ['conflict', 'rejection', 'expression'] },
    ],
    trust: 0.28,
    resistance: { verbal: 0.42, depth: 0.5, style: 0.38 },
    emotion: { valence: -0.45, arousal: 0.62 },
    underlyingDesires: [
      { key: 'acceptance', label: '被接纳与认可', baselineWeight: 0.72 },
      { key: 'stability', label: '情绪与关系的稳定', baselineWeight: 0.55 },
    ],
    forbiddenBehaviors: ['主动表达不满', '直接说出自己的需要', '当面指出对方的问题'],
    sensitiveTopics: ['童年需求', '亲密关系', '表达不满'],
    fivePs: {
      presenting: '在亲密关系里反复压抑自己的不满, 事后又一个人觉得委屈, 想学会怎么把需求说出来。',
      precipitating: '近期在亲密关系中因一次未被回应的表达而再次感到自己"不被当回事"。',
      maintaining: '习惯先满足对方、把不满咽下, 用"我没事"维持表面平静, 冲突因此始终谈不开。',
      protective: '较强的关系维系意愿与对被抛弃的敏感, 让她愿意留在咨询里持续尝试表达。',
      vulnerability: '童年需求常被忽略, 形成"先满足别人才值得被留下"的核心信念。',
    },
  },
  {
    templateId: 'vpt_self_worth_intellectualization_l1',
    displayName: '小满',
    attachmentStyle: 'anxious',
    beliefMeta: [
      { theme: 'worthlessness', activationTags: ['failure', 'self_worth', 'approval'] },
      { theme: 'conditional_worth', activationTags: ['achievement', 'evaluation', 'rejection'] },
    ],
    trust: 0.28,
    resistance: { verbal: 0.42, depth: 0.5, style: 0.38 },
    emotion: { valence: -0.45, arousal: 0.62 },
    underlyingDesires: [
      { key: 'recognition', label: '被看见与认可', baselineWeight: 0.7 },
      { key: 'self_reliability', label: '对自己的信任', baselineWeight: 0.6 },
    ],
    forbiddenBehaviors: ['主动说出自己做得不好', '直接接受赞美', '评价咨询师的专业水平'],
    sensitiveTopics: ['失败', '自我价值', '被评价'],
    fivePs: {
      presenting: '把自我价值全部押在"我够不够有用、够不够优秀"上, 一停下来就慌。',
      precipitating: '实习期反复被否定, 让他习惯用"我可以做得更好"压住被否定的感受。',
      maintaining: '以高标准与长期自我要求维持"优秀"身份, 不允许自己有"不够好"的部分。',
      protective: '强执行力与持续投入的能力, 让他有资源把注意力放在"做得更好"上。',
      vulnerability: '长期靠外界评价确认自己, 一旦停止被肯定就失去支点。',
    },
  },
  {
    templateId: 'vpt_workplace_intellectualization_l1',
    displayName: '亦舟',
    attachmentStyle: 'avoidant',
    beliefMeta: [
      { theme: 'intellectualization', activationTags: ['problem', 'analysis', 'control'] },
      { theme: 'self_sufficiency', activationTags: ['help', 'dependence', 'trust'] },
    ],
    trust: 0.2,
    resistance: { verbal: 0.62, depth: 0.68, style: 0.6 },
    emotion: { valence: -0.55, arousal: 0.18 },
    underlyingDesires: [
      { key: 'competence', label: '能力被认可与掌控感', baselineWeight: 0.7 },
      { key: 'autonomy', label: '自主与不被打扰', baselineWeight: 0.5 },
    ],
    forbiddenBehaviors: ['承认自己撑不住', '主动寻求帮助', '直接表达脆弱感受'],
    sensitiveTopics: ['工作压力', '承认撑不住', '被否定'],
    fivePs: {
      presenting: '一被问"最近怎么样"就用工作安排和解决方案作答, 回避谈自己的感受。',
      precipitating: '被提拔为小组负责人后负荷陡增, 长期"自己扛"的模式被推到极限。',
      maintaining: '用讲道理替代表达情绪、把感受分析成问题清单, 让咨询难以触到情绪层。',
      protective: '强执行力与可靠的自我管理, 让他能把局面稳住、继续把事情做好。',
      vulnerability: '长期缺少被肯定的体验, "求助即软弱"的信念让求助通道长期关闭。',
    },
  },
  {
    templateId: 'vpt_grief_avoidance_l1',
    displayName: '念安',
    attachmentStyle: 'avoidant',
    beliefMeta: [
      { theme: 'self_sufficiency', activationTags: ['help', 'dependence', 'collapse'] },
      { theme: 'grief_avoidance', activationTags: ['loss', 'partner', 'memory'] },
    ],
    trust: 0.2,
    resistance: { verbal: 0.62, depth: 0.68, style: 0.6 },
    emotion: { valence: -0.55, arousal: 0.18 },
    underlyingDesires: [
      { key: 'continuity', label: '维持现有的生活秩序', baselineWeight: 0.68 },
      { key: 'safe_grief', label: '有处安放未被哀悼的悲伤', baselineWeight: 0.58 },
    ],
    forbiddenBehaviors: ['主动谈论伴侣离世的细节', '在他人面前崩溃', '承认自己需要支持'],
    sensitiveTopics: ['伴侣离世', '未能告别', '崩溃'],
    fivePs: {
      presenting: '伴侣离世后用"我不能倒下"撑着, 不谈悲伤, 也不敢碰那段记忆。',
      precipitating: '伴侣去世时没能及时赶到, 未完成的告别成了悬在心里的结。',
      maintaining: '用忙碌盖过情绪、把话题转到琐事, 靠"一切照旧"维持日常 functioning。',
      protective: '可靠的照料能力与家庭责任感, 让他还能把日子撑起来。',
      vulnerability: '早年丧母时无人可依靠的经历, 让他在最需要支持时仍选择独自承担。',
    },
  },
];

/**
 * 灌库用的完整行 (内容基线 + 从来访池抽取的信念陈述).
 */
export interface CharacterProfileSeed {
  /** 内容派生的内部主键 (同一 template_id 永远同一个 id). */
  readonly id: string;
  readonly templateId: string;
  readonly displayName: string;
  readonly attachmentStyle: AttachmentStyle;
  readonly fivePs: CharacterFivePs;
  readonly trust: number;
  readonly resistance: { readonly verbal: number; readonly depth: number; readonly style: number };
  readonly emotion: { readonly valence: number; readonly arousal: number };
  /** 核心信念 (statement 从来访池抽取). */
  readonly coreBeliefs: readonly { readonly theme: string; readonly statement: string; readonly activationTags: readonly string[] }[];
  readonly underlyingDesires: readonly UnderlyingDesireSeed[];
  readonly forbiddenBehaviors: readonly string[];
  readonly sensitiveTopics: readonly string[];
}

/**
 * 内容基线自检.
 *
 * 为什么要**入库前就炸**: 角色内容是普通用户第一眼看到的东西 (速查卡 + 内核基线),
 * 结构性错误 (挂错模板 / 信念数量对不上 / 数值越界) 应该在 seed 脚本里当场抛,
 * 而不是等线上发现"这个角色的引擎基线和速查卡对不上".
 *
 * @param sources 公共模板内容来源
 * @returns 错误描述; 全部通过 → null
 */
export function validateCharacterProfileSeedSpecs(sources: readonly VisitorTemplateBeliefSource[]): string | null {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();

  for (const spec of CHARACTER_PROFILE_SEED_SPECS) {
    if (seen.has(spec.templateId)) {
      return `角色内容基线重复: ${spec.templateId}`;
    }
    seen.add(spec.templateId);

    const error = validateSeedSpec(spec, sourceById);
    if (error) {
      return error;
    }
  }
  return null;
}

/**
 * 单条内容基线的自检.
 *
 * 为什么要拆成独立函数: 自检规则一多, 单个函数就会顶穿认知复杂度上限 ——
 * 而"拆函数"在这里不是为指标, 是让"哪一条规则不通过"读得出来.
 *
 * @param spec 待检基线
 * @param sourceById 公共模板索引
 * @returns 错误描述; 通过 → null
 */
function validateSeedSpec(spec: CharacterProfileSeedSpec, sourceById: ReadonlyMap<string, VisitorTemplateBeliefSource>): string | null {
  const source = sourceById.get(spec.templateId);
  if (!source) {
    return `角色 ${spec.templateId} 在来访池里找不到对应模板 (内容基线与公共人物库脱节)`;
  }
  if (source.codename !== spec.displayName) {
    return `角色 ${spec.templateId} 的展示名 ${spec.displayName} 与模板代号 ${source.codename} 不一致`;
  }
  const statements = source.script.innerWorkingModel.coreBeliefs;
  if (statements.length !== spec.beliefMeta.length) {
    return `角色 ${spec.templateId} 的核心信念数量对不上 (来访池 ${statements.length} 条 / 基线 ${spec.beliefMeta.length} 条)`;
  }
  if (statements.length === 0) {
    return `角色 ${spec.templateId} 缺少核心信念`;
  }
  if (spec.underlyingDesires.length === 0) {
    return `角色 ${spec.templateId} 缺少底层愿望`;
  }
  if (spec.forbiddenBehaviors.length === 0) {
    return `角色 ${spec.templateId} 缺少负向约束 (forbiddenBehaviors)`;
  }
  if (spec.sensitiveTopics.length === 0) {
    return `角色 ${spec.templateId} 缺少敏感议题词表`;
  }
  return validateSeedRanges(spec);
}

/**
 * 数值区间自检 (信任/阻抗 ∈ [0,1]; 效价 ∈ [-1,1]; 唤醒 ∈ [0,1]).
 *
 * @param spec 待检基线
 * @returns 错误描述; 通过 → null
 */
function validateSeedRanges(spec: CharacterProfileSeedSpec): string | null {
  if (Math.abs(spec.trust) > 1) {
    return `角色 ${spec.templateId} 的初始信任越界: ${spec.trust}`;
  }
  for (const [name, value] of Object.entries(spec.resistance)) {
    if (Math.abs(value) > 1) {
      return `角色 ${spec.templateId} 的 ${name} 阻抗越界: ${value}`;
    }
  }
  if (Math.abs(spec.emotion.valence) > 1) {
    return `角色 ${spec.templateId} 的情绪效价越界: ${spec.emotion.valence}`;
  }
  if (Math.abs(spec.emotion.arousal) > 1) {
    return `角色 ${spec.templateId} 的情绪唤醒越界: ${spec.emotion.arousal}`;
  }
  return null;
}

/**
 * 内容基线 + 来访池来源 → 完整灌库行.
 *
 * @param sources 公共模板内容来源
 * @returns 完整行 (按 CHARACTER_PROFILE_SEED_SPECS 的顺序)
 * @throws Error 内容基线自检不通过
 */
export function buildCharacterProfileSeeds(sources: readonly VisitorTemplateBeliefSource[]): CharacterProfileSeed[] {
  const error = validateCharacterProfileSeedSpecs(sources);
  if (error) {
    throw new Error(`角色内容基线自检失败: ${error}`);
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return CHARACTER_PROFILE_SEED_SPECS.map((spec) => {
    const source = sourceById.get(spec.templateId);
    const statements = source?.script.innerWorkingModel.coreBeliefs ?? [];
    return {
      id: deriveCharacterProfileId(spec.templateId),
      templateId: spec.templateId,
      displayName: spec.displayName,
      attachmentStyle: spec.attachmentStyle,
      fivePs: spec.fivePs,
      trust: spec.trust,
      resistance: spec.resistance,
      emotion: spec.emotion,
      // statement 从来访池抽取 (按声明顺序一一对应), theme/标签来自基线声明.
      coreBeliefs: statements.map((statement, index) => {
        const meta = spec.beliefMeta[index];
        return {
          theme: meta?.theme ?? 'unspecified',
          statement,
          activationTags: [...(meta?.activationTags ?? [])],
        };
      }),
      underlyingDesires: spec.underlyingDesires.map((desire) => ({ ...desire })),
      forbiddenBehaviors: [...spec.forbiddenBehaviors],
      sensitiveTopics: [...spec.sensitiveTopics],
    };
  });
}

/**
 * 由 template_id 派生内部主键 (内容派生, 稳定不变).
 *
 * 为什么不用随机 UUID: 随机 id 让"同一份内容"在不同库里主键不同, seed 重跑
 * 也会换 id —— 那就谈不上幂等. 用 sha1 派生成标准 UUID 形态: 稳定、可对照、
 * 且与内容一一对应.
 *
 * @param templateId 公共模板 id
 * @returns 36 位 UUID 形态字符串
 */
export function deriveCharacterProfileId(templateId: string): string {
  const hex = createHash('sha1').update(`character_profile:${templateId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 幂等灌入角色内容.
 *
 * 语义与仓库既有内容治理一致:
 *   - 不存在 → INSERT (初始审核态 approved / 已上架 —— 人工撰写 = 已过审)
 *   - 已存在且内容有变 → UPDATE (**只改内容字段**, 不动 enabled / audit_status)
 *   - 已存在且内容一致 → no-op (不产生无谓写, 避免 updated_at 抖动)
 *
 * @param dataSource 应用 DataSource
 * @param seeds 完整灌库行
 * @returns 统计结果, 供脚本输出与人工核对
 */
export async function seedCharacterProfiles(
  dataSource: DataSource,
  seeds: readonly CharacterProfileSeed[],
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const repo = dataSource.getRepository(CharacterProfileEntity);
  const existing = await repo.find({ where: seeds.map((seed) => ({ templateId: seed.templateId })) });
  const existingByTemplateId = new Map(existing.map((row) => [row.templateId, row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seed of seeds) {
    const row = existingByTemplateId.get(seed.templateId);
    const payload = toEntityPayload(seed);

    if (!row) {
      await repo.insert({
        ...payload,
        id: seed.id,
        // 初始行即"已过审 + 已上架" (人工撰写 = 已过审, 跟 visitor_pool 同口径).
        auditStatus: 'approved',
        enabled: true,
      });
      inserted += 1;
      continue;
    }

    if (hasDrift(row, payload)) {
      // 只改内容字段: enabled / audit_status 是**运营决策**, 种子无权推翻.
      await repo.update(row.id, payload);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { inserted, updated, unchanged };
}

/**
 * 内容基线 → 实体写入载荷 (只含内容字段).
 *
 * @param seed 完整行
 * @returns 实体载荷
 */
function toEntityPayload(seed: CharacterProfileSeed): {
  readonly templateId: string;
  readonly displayName: string;
  readonly attachmentStyle: AttachmentStyle;
  readonly fivePs: CharacterFivePs;
  readonly baselineTrust: number;
  readonly baselineResistanceVerbal: number;
  readonly baselineResistanceDepth: number;
  readonly baselineResistanceStyle: number;
  readonly baselineEmotionValence: number;
  readonly baselineEmotionArousal: number;
  readonly coreBeliefs: { theme: string; statement: string; activationTags: string[] }[];
  readonly underlyingDesires: UnderlyingDesireSeed[];
  readonly forbiddenBehaviors: string[];
  readonly sensitiveTopics: string[];
} {
  return {
    templateId: seed.templateId,
    displayName: seed.displayName,
    attachmentStyle: seed.attachmentStyle,
    fivePs: seed.fivePs,
    baselineTrust: seed.trust,
    baselineResistanceVerbal: seed.resistance.verbal,
    baselineResistanceDepth: seed.resistance.depth,
    baselineResistanceStyle: seed.resistance.style,
    baselineEmotionValence: seed.emotion.valence,
    baselineEmotionArousal: seed.emotion.arousal,
    coreBeliefs: seed.coreBeliefs.map((belief) => ({ ...belief, activationTags: [...belief.activationTags] })),
    underlyingDesires: seed.underlyingDesires.map((desire) => ({ ...desire })),
    forbiddenBehaviors: [...seed.forbiddenBehaviors],
    sensitiveTopics: [...seed.sensitiveTopics],
  };
}

/**
 * 内容漂移检测 (只看内容字段).
 *
 * JSON 列用**规范化序列化**比较 (键排序) —— 否则运营在后台改了 JSON 键顺序
 * 就会被判成"内容变了", 每次跑 seed 都白写一遍.
 *
 * @param row 库里的行
 * @param payload 期望内容
 * @returns 有漂移 → true
 */
function hasDrift(row: CharacterProfileEntity, payload: ReturnType<typeof toEntityPayload>): boolean {
  if (row.displayName !== payload.displayName) return true;
  if (row.attachmentStyle !== payload.attachmentStyle) return true;
  if (row.baselineTrust !== payload.baselineTrust) return true;
  if (row.baselineResistanceVerbal !== payload.baselineResistanceVerbal) return true;
  if (row.baselineResistanceDepth !== payload.baselineResistanceDepth) return true;
  if (row.baselineResistanceStyle !== payload.baselineResistanceStyle) return true;
  if (row.baselineEmotionValence !== payload.baselineEmotionValence) return true;
  if (row.baselineEmotionArousal !== payload.baselineEmotionArousal) return true;
  if (canonicalJson(row.fivePs) !== canonicalJson(payload.fivePs)) return true;
  if (canonicalJson(row.coreBeliefs) !== canonicalJson(payload.coreBeliefs)) return true;
  if (canonicalJson(row.underlyingDesires) !== canonicalJson(payload.underlyingDesires)) return true;
  if (canonicalJson(row.forbiddenBehaviors) !== canonicalJson(payload.forbiddenBehaviors)) return true;
  if (canonicalJson(row.sensitiveTopics) !== canonicalJson(payload.sensitiveTopics)) return true;
  return false;
}

/**
 * 规范化 JSON (键排序) 后序列化 —— 用于"内容是否相同"的比较.
 *
 * @param value 任意可序列化值
 * @returns 规范化后的 JSON 字符串
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * 递归排序对象键 (数组保持原顺序).
 *
 * @param value 任意值
 * @returns 排序后的副本
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).toSorted((left, right) => left.localeCompare(right))) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
