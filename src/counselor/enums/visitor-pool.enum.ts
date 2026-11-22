// V2026-10-23 治本 (AI 模拟来访池 — 公共模板 4 组枚举):
//   原因: `docs/specs/counselor-visitor-pool.md` §2.1 / §3.5.1 给公共模板表定了一组
//     新的受控词表 (议题领域 / 防御类型 / 难度 / 案例来源). 这些词表是**前端契约的一部分**
//     (图鉴筛选条 + 人物卡标签), 必须由后端单点定义, 前端按字符串对齐 —— 跟仓库既有
//     `TrainingDifficulty` / `VisitorStyle` / `VisitorMode` 同 1:1 wire 口径.
//
//   修法: 本文件集中 4 组枚举:
//     - VisitorPoolIssueDomain  6 档议题领域 (亲密关系/职场/亲子/哀伤/自我价值/社交焦虑)
//     - VisitorPoolDefenseType  5 档主导防御机制 (理智化/回避/理想化/投射/退行)
//     - VisitorPoolSource       3 档案例来源 (官方/专家/投稿)
//     - VisitorPoolTemplateStatus 3 档上架状态 (草稿/上架/下架) —— 仅管理端 §3.6 用
//
//   反双胞胎 (重点: 不造已有概念的孪生枚举):
//     - **难度不新建** `VisitorPoolDifficulty`: 仓库已有 `TrainingDifficulty` (L1/L2/L3),
//       语义完全一致 (配合度梯度, V1.1 §4.2.7 拍板), 值也一致. 再造一个 L1/L2/L3 的
//       孪生枚举, 将来两端各改一处必然 drift —— 直接复用 `TrainingDifficulty`.
//     - **配合风格不新建** `VisitorPoolStyle`: 仓库已有 `VisitorStyle`
//       (cooperative/defensive/resistant/avoidant/mixed, V1.1 §4.2.5 拍板), 模板表
//       的 `style_hint` 列直接用它的值 —— 不造孪生.
//     - **训练模式不新建**: `VisitorMode` (useMySettings/fullyReal) 已是会话启动参数,
//       临场参数层直接复用, 不另起一套.
//     - 防御类型 (defenseType) 确实是**新概念** (V1.1 只有"行为风格"没有"防御机制类型"),
//       故新建; 但它与 `VisitorStyle` 是**两个正交维度**: 防御类型 = 人物内在的防御机制
//       (理智化/回避/...), 行为风格 = 训练中呈现出的配合姿态 (配合型/阻抗型/...).
//       两者绝不能合成一个枚举 —— spec §1 表层契约明确 "防御类型" 与 "styleHint" 是两列.
//
//   验证:
//     1. tsc 0 错
//     2. grep 'VisitorPoolDifficulty\|VisitorPoolStyle' → 0 命中 (无孪生枚举)
//     3. 前端按本文件字符串对齐筛选条与卡片标签
//
//   时间戳: 2026-10-23

/**
 * 公共模板 · 议题领域 6 档 (spec §2.1 issue_domain).
 *
 * 面向用户展示的口径是中文标签 (前端负责), server 侧只持久化稳定英文串.
 * 可扩展集合 (spec §2.1「可扩展」) —— 未来加一档只改本枚举 + 一条 seed, 不动 schema.
 */
export enum VisitorPoolIssueDomain {
  /** 亲密关系 */
  INTIMATE = 'intimate',
  /** 亲子冲突 */
  PARENTING = 'parenting',
  /** 职场压力 */
  WORKPLACE = 'workplace',
  /** 哀伤丧失 */
  GRIEF = 'grief',
  /** 自我价值 */
  SELF_WORTH = 'self_worth',
  /** 社交焦虑 */
  SOCIAL_ANXIETY = 'social_anxiety',
}

/**
 * 公共模板 · 主导防御类型 5 档 (spec §2.1 defense_type).
 *
 * 「主一种, 锁定不可临场改」—— 防御**类型**是人物属性, 临场可推拉的只是防御**数值**,
 * 用户不能把「理智化」改成「退行」, 那等于换人 (前端契约 §1 红线).
 */
export enum VisitorPoolDefenseType {
  /** 理智化: 用分析/讲道理回避情绪 */
  INTELLECTUALIZATION = 'intellectualization',
  /** 回避: 转移话题/回避冲突 */
  AVOIDANCE = 'avoidance',
  /** 理想化: 美化现实/过度理想化他人 */
  IDEALIZATION = 'idealization',
  /** 投射: 把自己的情绪归因于他人 */
  PROJECTION = 'projection',
  /** 退行: 退回到更幼稚的应对方式 */
  REGRESSION = 'regression',
}

/**
 * 公共模板 · 案例来源 3 档 (spec §2.1 source).
 *
 * 本期恒为 `official` (官方库) —— `expert` / `contributed` 是为后置的专家共建与投稿
 * 预留的取值位 (spec §8 非目标: 本期不做投稿/审核流).
 */
export enum VisitorPoolSource {
  /** 官方库 (内部 AI 生成 + 人工审核后上架) */
  OFFICIAL = 'official',
  /** 专家共建 (后置) */
  EXPERT = 'expert',
  /** 用户投稿 (后置) */
  CONTRIBUTED = 'contributed',
}

/**
 * 公共模板 · 上架状态 3 档 (spec §3.6 管理列表的 status 筛选口径).
 *
 * 注意: 状态是**派生**的, 不是表里的独立列 —— 表里只有 `enabled` (tinyint) 一个开关列,
 * 状态由 `enabled` + `deleted_at` 共同决定:
 *   - draft  = enabled=0 且未软删 (待审核的草稿)
 *   - enabled = enabled=1 且未软删 (已上架, 公共图鉴可见)
 *   - off    = enabled=0 且已软删 (下架/已删除)
 *
 * 之所以不落成独立列: 再存一份状态必然与 `enabled` 漂移 (改了一个忘了另一个),
 * 而「派生」是纯函数, 零漂移.
 */
export enum VisitorPoolTemplateStatus {
  /** 草稿 (未上架, 公共图鉴不可见) */
  DRAFT = 'draft',
  /** 已上架 (公共图鉴可见) */
  ENABLED = 'enabled',
  /** 已下架 (软删) */
  OFF = 'off',
}
