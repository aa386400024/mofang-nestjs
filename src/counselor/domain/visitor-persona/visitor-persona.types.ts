// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 7 大块结构 + 两层视图契约):
//   原因: v1.2 spec §4.1 给出了 `visitor_full_personas` 的 7 大块 JSON schema (basics /
//     developmentalTimeline / innerWorkingModel / socialMap / coping / therapyExpectation /
//     presentingIssue), §4.2 给出「用户两层视图」(视图 A 表层配置 / 视图 B 动态解锁档案).
//     这些 schema 会被 3 个地方消费: entity (落库) / DTO (给前端) / LLM prompt (生成脚本),
//     若各写一份 TS 类型, 必然 drift (尤其 7 大块的可选字段).
//   修法: 本文件是 **人设结构的唯一真值源**:
//     - 7 大块类型 (VisitorPersonaBasics / DevelopmentalTimeline / InnerWorkingModel /
//       SocialMap / Coping / TherapyExpectation / PresentingIssue)
//     - 视图 A 契约 (VisitorPersonaSurfaceView): 只暴露"来访初次见面愿意主动呈现的内容"
//     - 视图 B 契约 (CaseProfileEntry) 的 layer / anchorKey 语义
//     - 信任度分级常量 (TRUST_LEVEL_THRESHOLDS): §4.1「信息暴露节奏」的 4 档阈值
//   反双胞胎:
//     - 不用 class-validator class 承载这 7 块: 它们是**嵌套 JSON 结构** (数组/对象),
//       class-validator 对嵌套 json 表达力弱; 校验走手写 validate 函数 (跟 supervisor
//       payload 校验同范式), 类型靠 TS 保证编译期
//     - 不把 7 大块塞进 1 个 json 列: 那样无法对单块做 SQL 过滤/统计; 拆 7 列,
//       未来要按"防御水平"筛人设时可直接加索引
//     - 不在类型里放"信任度": 信任度是**会话演进状态** (随咨访关系变化), 不是人设静态属性,
//       落 long_term_case_sessions 侧的 session context, 不落 visitor_full_personas
//   验证:
//     1. tsc 0 错
//     2. 大炮建个案 → 表层视图只含 basics/presentingIssue/socialMap(intimate+parent) 3 类
//     3. godViewEnabled=false 时 GET 全量接口 → 400 (拒绝上帝视角)
//   时间戳: 2026-10-21

// ════════════════════════════════════════════════════════════════════════════
// 1. 基础信息
// ════════════════════════════════════════════════════════════════════════════

export interface VisitorPersonaBasics {
  /** 年龄 */
  age: number;
  /** 自报性别 */
  gender: string;
  /** 职业 */
  occupation: string;
  /** 教育程度 */
  education: string;
  /** 居住状态: 独居 / 合租 / 与家人同住 */
  livingStatus: string;
  /** 躯体健康史 */
  somaticHistory: string;
  /** 既往精神科就诊 / 咨询史 */
  psychHistory: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 成长时间线 (5 段)
// ════════════════════════════════════════════════════════════════════════════

/** 成长阶段 (5 段). */
export type DevelopmentalStage = '0-6' | '7-12' | '13-18' | '19-25' | '26+';

export interface VisitorPersonaDevelopmentalStage {
  stage: DevelopmentalStage;
  /** 养育模式 */
  parentingStyle: string;
  /** 重大事件 */
  keyEvents: string[];
  /** 家庭禁忌话题 (触发阻抗的钩子) */
  tabooTopics: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 内在工作模型
// ════════════════════════════════════════════════════════════════════════════

export type AttachmentType = 'secure' | 'anxious' | 'avoidant' | 'disorganized';

export interface VisitorPersonaInnerWorkingModel {
  attachmentType: AttachmentType;
  /** 核心信念 (如 "我不值得被爱") */
  coreBeliefs: string[];
  /** 隐性创伤 */
  hiddenTrauma: string[];
  /** 未完成情结 */
  unfinishedBusiness: string[];
  /** 防御机制 (压抑/否认/合理化/投射/升华...) */
  defenseMechanisms: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 社会关系图谱
// ════════════════════════════════════════════════════════════════════════════

export type SocialRelationType = 'parent' | 'intimate' | 'workplace' | 'peer';

export type SocialResourceDrain = 'resource' | 'drain' | 'neutral';

export interface VisitorPersonaSocialRelation {
  relationType: SocialRelationType;
  /** 当前关系状态 */
  currentStatus: string;
  /** 冲突模式 */
  conflictPattern: string;
  /** 该关系是资源还是消耗 */
  resourceOrDrain: SocialResourceDrain;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 应对模式
// ════════════════════════════════════════════════════════════════════════════

export interface VisitorPersonaCoping {
  /** 适应性资源 */
  adaptiveResources: string[];
  /** 非适应性策略 */
  maladaptiveStrategies: string[];
  /** 情绪触发点 */
  emotionTriggers: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 咨询预设
// ════════════════════════════════════════════════════════════════════════════

export interface VisitorPersonaTherapyExpectation {
  /** 对咨询的偏见 */
  biases: string[];
  /** 期待 */
  expectations: string[];
  /** 潜在移情倾向 */
  transferenceTrend: string;
  /** 阻抗模式 */
  resistancePattern: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 当前主诉
// ════════════════════════════════════════════════════════════════════════════

export type SelfReportedRisk = 'low' | 'medium' | 'high' | 'concealed';

export interface VisitorPersonaPresentingIssue {
  /** 来访自述症状 */
  selfReport: string;
  /** 持续时长 */
  duration: string;
  /** 睡眠 / 食欲 */
  sleepAppetite: string;
  /** 自述风险水平 (可隐瞒真实风险) */
  selfReportedRisk: SelfReportedRisk;
}

// ════════════════════════════════════════════════════════════════════════════
// 全量人设 (7 大块聚合)
// ════════════════════════════════════════════════════════════════════════════

/**
 * AI 底层全量人设**剧本内容** (7 大块聚合, 不含表行元数据).
 *
 * 这 7 块是 AI 行为基准: 所有情绪 / 反应 / 用词必须从 innerWorkingModel.coreBeliefs 派生,
 * 不出现逻辑冲突. 用户只能通过「视图 A」编辑表层字段, 「视图 B」在会谈中逐步解锁.
 *
 * V2026-10-21 治本 (V1.2 VS-B1 第 1 轮 build 修复 — 同名冲突改名):
 *   原因: 本类型原名 `VisitorFullPersona`, 与 entity 类
 *     `src/counselor/entities/visitor-full-persona.entity.ts` 的 `VisitorFullPersona` **重名**.
 *     tsc 实测 TS2300 ×2, 并级联出 27 个错: type-only 导入赢了类型位 →
 *     `@InjectRepository(VisitorFullPersona)` 报 TS2693 (只有类型没有值),
 *     entity 的 id/caseId/displayName/trustLevel/createdAt 全报 TS2339 (不存在),
 *     DeepPartial<VisitorFullPersona> 认不出 tenantId → TS2769.
 *   修法: 本类型改名 `VisitorFullPersonaScript` (剧本 = 内容), **entity 类保持 `VisitorFullPersona`**
 *     (表行是主公民, 跟仓库既有 entity 命名风格一致 — TrainingSession / LongTermCase 都不带后缀).
 *   反双胞胎:
 *     - 不把 entity 改名成 `VisitorFullPersonaEntity`: 仓库 11 个 counselor entity 全部不带
 *       Entity 后缀, 破例会让新人以为有两种命名体系
 *     - 不靠 import 别名 (`import { VisitorFullPersona as VisitorFullPersonaRow }`) 糊过去:
 *       别名能编译, 但两个概念在代码里仍同名, 下一个人复制粘贴必再踩一次; 改名是治本
 *   验证: 1. tsc 0 错  2. grep 'VisitorFullPersonaScript' 命中 domain types + service 2 处
 *   时间戳: 2026-10-21 15:26 GMT+8
 */
export interface VisitorFullPersonaScript {
  basics: VisitorPersonaBasics;
  developmentalTimeline: VisitorPersonaDevelopmentalStage[];
  innerWorkingModel: VisitorPersonaInnerWorkingModel;
  socialMap: VisitorPersonaSocialRelation[];
  coping: VisitorPersonaCoping;
  therapyExpectation: VisitorPersonaTherapyExpectation;
  presentingIssue: VisitorPersonaPresentingIssue;
}

// ════════════════════════════════════════════════════════════════════════════
// 视图 A: 表层信息 (新建个案时可见可编辑)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 视图 A —— 表层信息.
 *
 * 只展示"来访初次见面愿意主动呈现的内容", 对应真实咨询的初始主诉:
 *   - 代号 / 年龄 / 性别 / 职业  ← basics
 *   - 主诉与当下状态            ← presentingIssue
 *   - 表层关系简述              ← socialMap 中 relationType ∈ {intimate, parent} 的 currentStatus
 *   - 自述风险水平              ← presentingIssue.selfReportedRisk
 *
 * **不含** 成长时间线 / 内在工作模型 / 应对模式 / 咨询预设 —— 那是 AI 独享层.
 */
export interface VisitorPersonaSurfaceView {
  /** 代号 / 姓名 */
  name: string;
  basics: Pick<VisitorPersonaBasics, 'age' | 'gender' | 'occupation'>;
  presentingIssue: VisitorPersonaPresentingIssue;
  /** 表层关系简述 (只含 intimate / parent 2 类) */
  relations: {
    relationType: SocialRelationType;
    currentStatus: string;
  }[];
}

// ════════════════════════════════════════════════════════════════════════════
// 视图 B: 动态解锁档案
// ════════════════════════════════════════════════════════════════════════════

/**
 * 档案条目层级.
 *
 * - self_disclosed: 来访在会谈中主动披露 (AI 抽取)
 * - therapist_note: 咨询师手写观察 / 假设 (人工)
 */
export type CaseProfileEntryLayer = 'self_disclosed' | 'therapist_note';

/**
 * 档案条目锚点 —— 对应 VisitorFullPersona 的 JSON path.
 *
 * 例: "innerWorkingModel.attachmentType" / "basics.psychHistory" / "coping.emotionTriggers[0]".
 * 锚点让"已解锁了什么"可被精确定位, 前端可按锚点高亮人设图谱的对应节点.
 *
 * V2026-10-21 治本 (V1.2 VS-B1 第 3 轮 lint 修复 — sonarjs/redundant-type-aliases):
 *   原因: 原先定义 `export type CaseProfileAnchorKey = string;` —— 就是 string 的别名,
 *     ESLint sonarjs/redundant-type-aliases 报 "Remove this redundant type alias and
 *     replace its occurrences with string".
 *   修法: 删掉这个别名, 直接用 string.
 *   反双胞胎:
 *     - 不改成 `= string & { __brand: 'anchorKey' }` 之类: 品牌化类型 (branded type) 确实能
 *       防止把任意字符串当锚点传进来, 但本仓所有 json 字段 (含 anchor_key) 都是 varchar,
 *       DB 层不区分锚点与自由文本, 品牌化只会在 TS 层制造一种 DB 并不保证的错觉
 *     - 不留 `type CaseProfileAnchorKey = string` 并加 eslint-disable: 纯冗余, 零收益
 *   验证: 1. lint 0 错  2. entity 的 anchorKey 字段类型改为 string, 行为不变
 *   时间戳: 2026-10-21 15:38 GMT+8
 */

// ════════════════════════════════════════════════════════════════════════════
// 信任度分级 (§4.1 信息暴露节奏)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 咨访信任度 4 档阈值 (spec §4.1).
 *
 * - [0.0, 0.3): 只答表层
 * - [0.3, 0.6): 谈关系
 * - [0.6, 0.8): 谈情绪
 * - [0.8, 1.0]: 才允许碰禁忌话题
 *
 * 信任度是**会话演进状态** (随咨访关系加深而上升), 不是人设静态属性 →
 * 落 long_term_case_sessions 的 session context, 不落 visitor_full_personas.
 */
export const TRUST_LEVEL_THRESHOLDS = {
  /** 信任度达到此值才开始谈关系 */
  relationship: 0.3,
  /** 达到此值才开始谈情绪 */
  emotion: 0.6,
  /** 达到此值才允许碰禁忌话题 */
  taboo: 0.8,
} as const;

/**
 * 信任度 → 允许的暴露层级 (供 prompt 渲染与前端提示共用).
 *
 * @param trustLevel 信任度 0-1
 */
export function trustExposureLevel(trustLevel: number): 'surface' | 'relationship' | 'emotion' | 'taboo' {
  if (trustLevel >= TRUST_LEVEL_THRESHOLDS.taboo) {
    return 'taboo';
  }
  if (trustLevel >= TRUST_LEVEL_THRESHOLDS.emotion) {
    return 'emotion';
  }
  if (trustLevel >= TRUST_LEVEL_THRESHOLDS.relationship) {
    return 'relationship';
  }
  return 'surface';
}
