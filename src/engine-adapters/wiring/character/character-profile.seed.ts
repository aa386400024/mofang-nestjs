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
//   V2026-10-30 治本 (WP10A · 表达风格基线字段预留):
//   职责: 给内容基线加 3 个**可选**表达风格字段 (话量基线 / 叙事风格 / 语态倾向),
//         并把"种子明确表态的才写"这条口径落到灌库载荷上.
//   边界: **只写内容, 不写消费** —— 字段不进内核 / 不进 RenderSpec / 不暴露前端.
//         本轮只有"既有数据自己就写明了该特质"的角色才表态, 其余一律走 DB DEFAULT.
//
//   为什么是"可选 + 没表态就不出现" (而不是每个角色都显式写三个值):
//     ① 默认值只有一处真相 (DDL 的 DEFAULT). seed 再抄一份 0.5/'mixed'/'restrained',
//        两边迟早漂 (改了 DDL 忘了改 seed, 或反过来).
//     ② TypeORM 语义天然支持: INSERT 时 undefined → `DEFAULT`; UPDATE 时 undefined →
//        **整列跳过** (TypeORM UpdateQueryBuilder: "it doesn't make sense to update
//        undefined properties"). 于是 Phase2 P1 在库里标定好的值, 不会被 seed 冲回默认.
//     ③ "种子没表态"和"库里没这列"不是一回事 —— 列是 NOT NULL DEFAULT, 永远有值.
//
//   判定口径 (什么算"明确表态"):
//     只认**该角色自己的既有数据** (模板 slug / 5Ps 文本) 是否明文写出了这个特质 ——
//     不是我们对这些角色的主观印象. 本轮只有 slug 为 `*_intellectualization_*` 的两个角色
//     (小满 / 亦舟) 填了 `expressionTone: 'intellectualizing'`; 其余留默认.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp10a-*.spec.ts 覆盖列定义 / migration 幂等 / 种子表态口径
//     3. npm run seed:character-profiles → 4 行; 连跑两次行数不变
//
//   V2026-11-04 治本 (WP51 · 同盟三维基线):
//   职责: 给内容基线加 2 个**可选**字段 (安全感 / 联结感), 并把"种子明确表态的才写"
//         这条口径落到灌库载荷上.
//   边界: 只写内容, 不写消费 —— 内核 bootstrap 同期从 `profile.baseline` 读这两项.
//
//   为什么 DB 侧的角色**这次要表态** (与 WP10A 的"不表态"相反):
//     生产默认数据源是 **db** (见 character-pool.module.ts 的 readCharacterSource:
//     缺省 db, builtin 才是回退/测试档). 若 DB 侧的角色不表态, 库里全是
//     DEFAULT 0.5 / 0 —— 那么**生产上这个 WP 等于没做**, 内测看到的仍是
//     "回避型和安全型安全感一样". 所以 DB 侧必须表态.
//
//   数值口径: **抄 WP9-A 同风格内置种子的档位** (anxious / avoidant 各一档) ——
//     与本文件既有的 trust / 阻抗 / 情绪口径完全一致 (不是我们对这些角色的主观印象).
//     ⚠️ 工程种子值, 非临床标定.
//
//   补值路径: **不写一次性回填脚本** —— 靠本文件既有的幂等 upsert 自然完成
//     (重跑 seed → hasDrift 命中 → UPDATE 两列). 迁移只管 schema, 内容归 seed.
//     ⚠️ 部署顺序: migration 先跑 (加列), 再跑 seed (补值).
//
//   V2026-11-10 治本 (WP-J · 角色基线差异化标定):
//   职责: 让 8 个角色的基线数值"每个角色各自独立", 并把数值收敛到**唯一真相源**.
//   边界: 内容字段 (5Ps / 信念 / 愿望 / 约束 / 敏感议题 / 表达语态) **一字不动**;
//         数值字段改为从 `character-baseline-calibration.ts` 按 templateId **装配** (不复制);
//         新增 `applyBaselineCalibration` —— 给 B 类 (DB-only) 角色**只更新已存在行的 8 个基线列**.
//
//   为什么数值不再手写 (反双胞胎):
//     此前 4 个 seed 角色按"焦虑 / 回避两档"抄内置种子的档位 —— 同档角色 8 个基线字段
//     一字不差 (晚晴 == 小满, 亦舟 == 念安), 同档角色在内核眼里是同一个人.
//     现在数值由权威标定表统一声明 (循证研究 v2), seed 只**引用** —— 全仓再无第二份硬编码.
//
//   为什么 B 类要单独走一条校准路径 (而不是给它们补 seed):
//     沉舟 / 安然 / 语桐 / 惊尘 **没有来访池模板** (DB-only) —— 补 seed 等于替它们造
//     来访池模板, 那是越权. 它们的行只存在于库里, 所以校准路径是"只 UPDATE 已存在且
//     未软删的行": **不 INSERT、不补内容、不碰 enabled / audit_status / version**.
//     找不到行 → 进 missing 显式报告 (新环境没有这些行是正常的), 而不是静默造行.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/character-baseline-*.spec.ts 覆盖标定自检 + 校准幂等
//     3. npm run seed:character-profiles → 先内容 seed 后基线校准; 连跑两次第二次全"未变"
//
//   时间戳: 2026-10-29

import { createHash } from 'node:crypto';

import { In, IsNull, type DataSource, type Repository } from 'typeorm';

import {
  CHARACTER_BASELINE_CALIBRATION,
  STORAGE_FLOAT_TOLERANCE,
  type CharacterBaselineCalibration,
  getBaselineCalibration,
  validateBaselineRowRanges,
} from './character-baseline-calibration.js';
import type { CharacterExpressionTone, CharacterFivePs, CharacterNarrativeStyle } from './character-profile.entity.js';
import { CharacterProfileEntity } from './character-profile.entity.js';
import type { AttachmentStyle, UnderlyingDesireSeed } from '../../../engine-core/index.js';

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
  /**
   * 关系安全感基线 [0,1] (WP51).
   *
   * **缺省 = 走 DB DEFAULT 0.5** (= 内核 DEFAULT_SAFETY) —— 种子不写自己没把握的值.
   */
  readonly safety?: number;
  /**
   * 关系联结基线 [0,1] (WP51).
   *
   * **缺省 = 走 DB DEFAULT 0** (= 内核 DEFAULT_BOND) —— 种子不写自己没把握的值.
   */
  readonly bond?: number;
  /** 底层愿望种子. */
  readonly underlyingDesires: readonly UnderlyingDesireSeed[];
  /** 绝不会做的事 (负向约束). */
  readonly forbiddenBehaviors: readonly string[];
  /** 敏感议题词表. */
  readonly sensitiveTopics: readonly string[];
  /** 5Ps 专业材料 (人读, 不进内核). */
  readonly fivePs: CharacterFivePs;
  /**
   * 话量基线 [0,1] (WP10A · 表达风格预留).
   *
   * **缺省 = 走 DB DEFAULT 0.5** —— 种子不写自己没把握的值.
   */
  readonly speechVolumeBaseline?: number;
  /**
   * 叙事逻辑风格 (WP10A · 表达风格预留).
   *
   * **缺省 = 走 DB DEFAULT 'mixed'**.
   */
  readonly narrativeStyle?: CharacterNarrativeStyle;
  /**
   * 语态倾向 (WP10A · 表达风格预留).
   *
   * **缺省 = 走 DB DEFAULT 'restrained'**.
   */
  readonly expressionTone?: CharacterExpressionTone;
  /**
   * 台词指纹 (WP-J P2) —— 渲染层文案, 不进内核决策.
   *
   * **缺省 = 不表态** (INSERT 走 DB DEFAULT NULL / UPDATE 整列不碰).
   * A 类四个角色实际都由 `baselineOf()` 从标定表装配, 不会缺省; 留可选是为了
   * 将来"只有数值没有台词"的角色也能存在, 不用为此改类型.
   */
  readonly verbalVoice?: string;
}

/**
 * 按 templateId 从权威标定表装配**数值部分 + 台词指纹** (trust / 三维阻抗 / 情绪 / safety / bond / verbalVoice).
 *
 * 为什么是"装配"而不是"抄一份":
 *   数值与台词都是**工程标定内容**, 唯一真相源在 character-baseline-calibration.ts (循证研究 v2 + 文案定稿).
 *   在这里手写就等于开了第二份真相 —— 改了标定表忘了改 seed, 库里就会一半新一半旧,
 *   而且**没有任何报错**. 装配 = 改一处, 全仓跟着动.
 *
 * 为什么找不到就抛:
 *   "内容存在但数值缺一行"是结构性错误; 静默落回 DB DEFAULT 会让这个角色变成"又一个
 *   平庸角色" —— 那正是本单要消灭的同档化.
 *
 * @param templateId 公共模板 id
 * @returns 该角色的数值部分与台词指纹 (可直接展开进种子规格)
 * @throws Error 标定表里没有这个 templateId
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
    // WP-J P2: 台词指纹同源装配 —— 8 条文案全仓只有标定表这一份 (A/B 两类都从这里取).
    verbalVoice: row.verbalVoice,
  };
}

/**
 * 首批内容基线 (任务单 §6 拍板: 4 个 slug, 2 焦虑 × 2 回避).
 *
 * 基线数值口径 (WP-J 起): **从权威标定表按 templateId 装配** ——
 * 每个角色**各自独立**的数值剖面 (不再按"焦虑 / 回避两档"一刀切).
 * 这是**工程标定值, 不是临床标定** (专业校准归后期专业评审).
 * 可区分性由 character-baseline-calibration.spec.ts 钉住 ("换角色 → 基线明显不同").
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
    // WP-J: 数值从权威标定表按 templateId **装配** (不复制) ——
    //   内容与数值分离; 数值的唯一真相源在 character-baseline-calibration.ts.
    //   ⚠️ 工程标定值, 非临床标定.
    ...baselineOf('vpt_intimate_avoidance_l1'),
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
    // WP-J: 数值从权威标定表按 templateId **装配** (不复制) ——
    //   与晚晴**不再同档**: 两个焦虑型角色各有自己的数值剖面.
    //   ⚠️ 工程标定值, 非临床标定.
    ...baselineOf('vpt_self_worth_intellectualization_l1'),
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
    // WP10A: 语态倾向. 判定口径 = **该角色自己的模板 slug 与 5Ps 文本是否明确写出了
    //   这个特质** —— 本角色 slug 直接是 `..._intellectualization_...`, 5Ps 也写着
    //   "用'我可以做得更好'压住被否定的感受" (以讲道理压感受). 这不是我们对角色的
    //   主观印象, 是同一份既有数据的转写; 拿不准的一律留默认 (走 DB DEFAULT).
    expressionTone: 'intellectualizing',
  },
  {
    templateId: 'vpt_workplace_intellectualization_l1',
    displayName: '亦舟',
    attachmentStyle: 'avoidant',
    beliefMeta: [
      { theme: 'intellectualization', activationTags: ['problem', 'analysis', 'control'] },
      { theme: 'self_sufficiency', activationTags: ['help', 'dependence', 'trust'] },
    ],
    // WP-J: 数值从权威标定表按 templateId **装配** (不复制) ——
    //   职场倦怠 → 低唤醒 + 风格阻抗最高 (理智化), 联结感 8 人最低.
    //   ⚠️ 工程标定值, 非临床标定.
    ...baselineOf('vpt_workplace_intellectualization_l1'),
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
    // WP10A: 语态倾向. 判定口径同上 (小满): slug 直接是 `..._intellectualization_...`,
    //   5Ps 写着"用讲道理替代表达情绪、把感受分析成问题清单" —— 理智化是既有数据的明文.
    expressionTone: 'intellectualizing',
  },
  {
    templateId: 'vpt_grief_avoidance_l1',
    displayName: '念安',
    attachmentStyle: 'avoidant',
    beliefMeta: [
      { theme: 'self_sufficiency', activationTags: ['help', 'dependence', 'collapse'] },
      { theme: 'grief_avoidance', activationTags: ['loss', 'partner', 'memory'] },
    ],
    // WP-J: 数值从权威标定表按 templateId **装配** (不复制) ——
    //   哀伤双过程模型 → 深度阻抗比亦舟低一档, 唤醒略高 (昼夜节律).
    //   ⚠️ 工程标定值, 非临床标定.
    ...baselineOf('vpt_grief_avoidance_l1'),
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
 * DB-only 角色 (B 类) 的基线标定行 —— 沉舟 / 安然 / 语桐 / 惊尘.
 *
 * 口径: 权威标定表里**没有** seed 规格的那些行.
 * 这 4 个角色**没有来访池模板**, 行只存在于数据库 —— 所以它们的数值**不能**靠内容
 * seed 带进去 (内容 seed 只处理 A 类), 得走 `applyBaselineCalibration` 这条只写数值的路.
 *
 * 为什么是**推导**而不是手写一份名单:
 *   手写名单 = 第二份真相 (哪天 seed 规格增删, 名单就漂, 而且漂了没人知道).
 *   这里从"权威表 − 有规格的行"推导 —— 名单永远跟着真相处.
 */
export const DB_ONLY_BASELINE_CALIBRATION: readonly CharacterBaselineCalibration[] = CHARACTER_BASELINE_CALIBRATION.filter(
  (row) => !CHARACTER_PROFILE_SEED_SPECS.some((spec) => spec.templateId === row.templateId),
);

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
  /**
   * 同盟三维基线两列 (WP51).
   *
   * **缺省 = 不表态** (走 DB DEFAULT) —— 种子没说的列, 灌库时整列不出现.
   */
  readonly safety?: number;
  readonly bond?: number;
  /** 核心信念 (statement 从来访池抽取). */
  readonly coreBeliefs: readonly { readonly theme: string; readonly statement: string; readonly activationTags: readonly string[] }[];
  readonly underlyingDesires: readonly UnderlyingDesireSeed[];
  readonly forbiddenBehaviors: readonly string[];
  readonly sensitiveTopics: readonly string[];
  /**
   * 表达风格三列 (WP10A · 纯预留).
   *
   * **缺省 = 不表态** (走 DB DEFAULT) —— 种子没说的列, 灌库时整列不出现,
   * 存量行里的值 (Phase2 P1 标定过的) 也不会被 seed 冲掉.
   */
  readonly speechVolumeBaseline?: number;
  readonly narrativeStyle?: CharacterNarrativeStyle;
  readonly expressionTone?: CharacterExpressionTone;
  /**
   * 台词指纹 (WP-J P2 · 渲染层文案).
   *
   * **缺省 = 不表态** (走 DB DEFAULT NULL) —— 种子没写的列, 灌库时整列不出现,
   * 存量行里运营改过的文案也不会被 seed 冲掉.
   */
  readonly verbalVoice?: string;
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
 * 数值区间自检 (信任/阻抗/唤醒/安全感/联结感 ∈ [0,1]; 效价 ∈ [-1,1]).
 *
 * WP-J: 基线八维的区间校验**复用权威标定模块**那一份 (`validateBaselineRowRanges`),
 * 不在本文件再写第二份 —— 两份区间逻辑迟早在边界值上分叉.
 * 话量基线是**表达风格**字段 (WP10A), 不属基线八维, 校验仍留在本文件.
 *
 * @param spec 待检基线
 * @returns 错误描述; 通过 → null
 */
function validateSeedRanges(spec: CharacterProfileSeedSpec): string | null {
  const baselineError = validateBaselineRowRanges({
    templateId: spec.templateId,
    trust: spec.trust,
    resistance: spec.resistance,
    emotion: spec.emotion,
    ...(spec.safety === undefined ? {} : { safety: spec.safety }),
    ...(spec.bond === undefined ? {} : { bond: spec.bond }),
  });
  if (baselineError) {
    return baselineError;
  }
  // WP10A: 话量基线 ∈ [0,1] (只在该角色明确表态时才校验 —— 没表态就没有值可越界).
  if (spec.speechVolumeBaseline !== undefined && (spec.speechVolumeBaseline < 0 || spec.speechVolumeBaseline > 1)) {
    return `角色 ${spec.templateId} 的话量基线越界: ${spec.speechVolumeBaseline}`;
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
      // WP51: 同盟三维基线两列 —— 只在基线**明确表态**时才带上 (没表态 = 不出现 = 走 DB DEFAULT).
      ...(spec.safety === undefined ? {} : { safety: spec.safety }),
      ...(spec.bond === undefined ? {} : { bond: spec.bond }),
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
      // 表达风格三列: 只在基线**明确表态**时才带上 (没表态 = 不出现 = 走 DB DEFAULT).
      ...(spec.speechVolumeBaseline === undefined ? {} : { speechVolumeBaseline: spec.speechVolumeBaseline }),
      ...(spec.narrativeStyle === undefined ? {} : { narrativeStyle: spec.narrativeStyle }),
      ...(spec.expressionTone === undefined ? {} : { expressionTone: spec.expressionTone }),
      // WP-J P2: 台词指纹 —— 同样只在规格表态时带上 (A 类四个角色由 baselineOf 装配, 都有值).
      ...(spec.verbalVoice === undefined ? {} : { verbalVoice: spec.verbalVoice }),
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
 * B 类 (DB-only) 角色的基线校准 —— **只 UPDATE 已存在且未软删的行**.
 *
 * 语义 (与内容 seed 的幂等 upsert 同一套纪律):
 *   - 找不到行 → 进 missing 显式报告 (**不 INSERT**): 新环境没有这些行是**正常**的,
 *     静默造行等于替它们补内容 + 补来访池模板 —— 那是越权, 也是本单明令禁止的.
 *   - 行值与目标一致 → unchanged (不产生无谓写, 不抖动 updated_at).
 *   - 行值有差 → 只 UPDATE 8 个基线列 + 台词指纹.
 *
 * 载荷里**不得**出现: 内容列 (five_ps / core_beliefs / underlying_desires /
 * forbidden_behaviors / sensitive_topics / 表达风格三列)、enabled / audit_status /
 * version* —— 那些是**运营决策**, 校准无权推翻.
 *
 * 为什么台词指纹能进这个载荷 (WP-J P2):
 *   它不是运营决策, 是**角色标定内容** —— 与那 8 个数值同源 (同一张标定表), 且 B 类
 *   角色的行只存在于数据库, 内容 seed 带不进去. 除此之外仍一列不加.
 *
 * @param repo 角色行仓储
 * @param calibration 待校准的标定行 (缺省 = DB-only 那批)
 * @returns 统计结果, 供脚本输出与人工核对
 */
export async function applyBaselineCalibration(
  repo: Repository<CharacterProfileEntity>,
  calibration: readonly CharacterBaselineCalibration[] = DB_ONLY_BASELINE_CALIBRATION,
): Promise<{ updated: number; unchanged: number; missing: string[] }> {
  if (calibration.length === 0) {
    return { updated: 0, unchanged: 0, missing: [] };
  }

  const templateIds = calibration.map((row) => row.templateId);
  // 软删不是 @DeleteDateColumn —— 查询手写 deletedAt: IsNull() (仓库硬约束 #3).
  const rows = await repo.findBy({ templateId: In(templateIds), deletedAt: IsNull() });
  const rowByTemplateId = new Map(rows.map((row) => [row.templateId, row]));

  let updated = 0;
  let unchanged = 0;
  const missing: string[] = [];

  for (const target of calibration) {
    const row = rowByTemplateId.get(target.templateId);
    if (!row) {
      missing.push(target.templateId);
      continue;
    }
    const payload = toBaselineColumns(target);
    if (hasBaselineDrift(row, payload)) {
      await repo.update(row.id, payload);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged, missing };
}

/**
 * 标定行 → 8 个基线列 + 台词指纹的写入载荷 (只有这 9 列, 别的一律不碰).
 *
 * 为什么台词指纹也走这条路 (而不是内容 seed):
 *   B 类 4 个角色**没有来访池模板**, 内容 seed 根本碰不到它们 —— 它们的行只存在于数据库.
 *   所以它们的文案只能随基线校准一起写: 同一行、同一次 UPDATE、同一份幂等判定.
 *
 * @param target 标定行
 * @returns 基线列 + 文案列载荷
 */
function toBaselineColumns(target: CharacterBaselineCalibration): {
  readonly baselineTrust: number;
  readonly baselineResistanceVerbal: number;
  readonly baselineResistanceDepth: number;
  readonly baselineResistanceStyle: number;
  readonly baselineEmotionValence: number;
  readonly baselineEmotionArousal: number;
  readonly baselineSafety: number;
  readonly baselineBond: number;
  /** 台词指纹 (`varchar(500)` NULL — 空串不算"没写", 但自检已挡住空串). */
  readonly verbalVoice: string;
} {
  return {
    baselineTrust: target.trust,
    baselineResistanceVerbal: target.resistance.verbal,
    baselineResistanceDepth: target.resistance.depth,
    baselineResistanceStyle: target.resistance.style,
    baselineEmotionValence: target.emotion.valence,
    baselineEmotionArousal: target.emotion.arousal,
    baselineSafety: target.safety,
    baselineBond: target.bond,
    verbalVoice: target.verbalVoice,
  };
}

/**
 * 8 个基线列 + 台词指纹的漂移检测 (只看这 9 列).
 *
 * 数值比较用 `STORAGE_FLOAT_TOLERANCE` 而非裸 `!==`: 基线列是 MySQL **单精度 FLOAT**,
 * 同一组数值经二进制协议读回会带约 1e-8 量级的表示误差 (0.65 → 0.6499999761581421).
 * 用 `!==` 判定会把"值其实没变"误判成"有漂移" → 每次 seed 都 UPDATE, 幂等静默破功.
 * 当前 TypeORM 走 text protocol 暂时掩盖了该误差, 但读取路径一旦变化就会暴露.
 *
 * 台词指纹是 `varchar`, 没有精度问题 —— 一字之差都算真漂移, 严格比较.
 *
 * @param row 库里的行
 * @param payload 期望的基线列与文案
 * @returns 有漂移 → true
 */
function hasBaselineDrift(row: CharacterProfileEntity, payload: ReturnType<typeof toBaselineColumns>): boolean {
  if (row.verbalVoice !== payload.verbalVoice) return true;
  const pairs: readonly (readonly [number, number])[] = [
    [row.baselineTrust, payload.baselineTrust],
    [row.baselineResistanceVerbal, payload.baselineResistanceVerbal],
    [row.baselineResistanceDepth, payload.baselineResistanceDepth],
    [row.baselineResistanceStyle, payload.baselineResistanceStyle],
    [row.baselineEmotionValence, payload.baselineEmotionValence],
    [row.baselineEmotionArousal, payload.baselineEmotionArousal],
    [row.baselineSafety, payload.baselineSafety],
    [row.baselineBond, payload.baselineBond],
  ];
  return pairs.some(([actual, expected]) => Math.abs(actual - expected) > STORAGE_FLOAT_TOLERANCE);
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
  /** 同盟三维基线两列 (WP51; 缺省 = 不出现 → INSERT 走 DB DEFAULT / UPDATE 整列不碰). */
  readonly baselineSafety?: number;
  readonly baselineBond?: number;
  readonly coreBeliefs: { theme: string; statement: string; activationTags: string[] }[];
  readonly underlyingDesires: UnderlyingDesireSeed[];
  readonly forbiddenBehaviors: string[];
  readonly sensitiveTopics: string[];
  /** 表达风格三列 (WP10A; 缺省 = 不出现 → INSERT 走 DB DEFAULT / UPDATE 整列不碰). */
  readonly speechVolumeBaseline?: number;
  readonly narrativeStyle?: CharacterNarrativeStyle;
  readonly expressionTone?: CharacterExpressionTone;
  /** 台词指纹 (WP-J P2; 缺省 = 不出现 → INSERT 走 DEFAULT NULL / UPDATE 整列不碰). */
  readonly verbalVoice?: string;
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
    // WP51: 同盟三维基线两列 —— **只写种子自己拿得准的** (口径同表达风格三列):
    //   没给 → 整列不出现 (TypeORM: INSERT 写 DEFAULT / UPDATE 跳过 undefined),
    //   于是默认值只有 DDL 一处真相, 也不存在"seed 把库里标定好的值冲回默认"的路径.
    ...(seed.safety === undefined ? {} : { baselineSafety: seed.safety }),
    ...(seed.bond === undefined ? {} : { baselineBond: seed.bond }),
    coreBeliefs: seed.coreBeliefs.map((belief) => ({ ...belief, activationTags: [...belief.activationTags] })),
    underlyingDesires: seed.underlyingDesires.map((desire) => ({ ...desire })),
    forbiddenBehaviors: [...seed.forbiddenBehaviors],
    sensitiveTopics: [...seed.sensitiveTopics],
    // 表达风格三列: **只写种子自己拿得准的** ——
    //   没给 → 整列不出现 (TypeORM: INSERT 写 DEFAULT / UPDATE 跳过 undefined),
    //   于是默认值只有 DDL 一处真相, 也不存在"seed 把库里标定好的值冲回默认"的路径.
    ...(seed.speechVolumeBaseline === undefined ? {} : { speechVolumeBaseline: seed.speechVolumeBaseline }),
    ...(seed.narrativeStyle === undefined ? {} : { narrativeStyle: seed.narrativeStyle }),
    ...(seed.expressionTone === undefined ? {} : { expressionTone: seed.expressionTone }),
    // WP-J P2: 台词指纹 —— 口径同表达风格三列: 种子没给 → 整列不出现 (不冲掉运营改过的文案).
    ...(seed.verbalVoice === undefined ? {} : { verbalVoice: seed.verbalVoice }),
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
  // "种子表态过"的可选列 (表达风格三列 + 同盟三维两列) 单独走一条检测.
  return hasOptionalColumnDrift(row, payload);
}

/**
 * **可选列**的漂移检测 (表达风格三列 + 同盟三维两列).
 *
 * 为什么单独拆出来: 主体漂移检测有 13 条**必填列**, 再加 5 条"只在表态时才算"的
 * 可选列, 单个函数的复杂度就顶穿上限了 —— 拆开不只是为指标, 更让"可选列"的
 * 判定口径 (**只在种子给了值时才算漂移**) 集中在**一处**, 将来加第 6 个可选列
 * 不用再动主体.
 *
 * 口径与 WP10A 表达风格三列完全一致:
 *   种子没表态的行, 库里是什么就是什么 (运营标定过的值不该被 seed 冲回默认).
 *
 * @param row 库里的行
 * @param payload 期望内容
 * @returns 有漂移 → true
 */
function hasOptionalColumnDrift(row: CharacterProfileEntity, payload: ReturnType<typeof toEntityPayload>): boolean {
  if (payload.speechVolumeBaseline !== undefined && row.speechVolumeBaseline !== payload.speechVolumeBaseline) return true;
  if (payload.narrativeStyle !== undefined && row.narrativeStyle !== payload.narrativeStyle) return true;
  if (payload.expressionTone !== undefined && row.expressionTone !== payload.expressionTone) return true;
  // WP-J P2: 台词指纹 —— 同样只在种子给了值时才算漂移.
  if (payload.verbalVoice !== undefined && row.verbalVoice !== payload.verbalVoice) return true;
  // WP51: 同盟三维基线两列 —— 同样只在种子给了值时才算漂移.
  if (payload.baselineSafety !== undefined && row.baselineSafety !== payload.baselineSafety) return true;
  if (payload.baselineBond !== undefined && row.baselineBond !== payload.baselineBond) return true;
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
