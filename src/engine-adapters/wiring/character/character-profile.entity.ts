// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池实体):
//   职责: 承载 `character_profiles` 表 —— 公共来访模板对应的**引擎侧角色基线**
//         (5Ps 专业长文 + 内核基线数值 + 结构化心理要素 + 审核/上下架状态).
//   边界: 只描述表结构与列语义; 零业务逻辑、零 IO. 映射公式不在这里 ——
//         角色定义 → 内核 CharacterProfile 的映射**只有一份**
//         (WP9-A `buildCharacterProfile`), 本实体只是"行"的形状.
//
//   为什么这张表在 engine-adapters 而不在 counselor:
//     表的**消费者**是引擎 (resolver 读它注入内核), 它的生命周期也随引擎走.
//     若把实体放在 counselor, 运行时就得让引擎依赖 counselor ——
//     而引擎是更底层的一层. 所以: 表归引擎, 速查卡字段 (codename/age_range/
//     presenting_complaint) 继续留在 visitor_pool_templates 由 voice 层读,
//     两表按 template_id 逻辑关联 (任务单 §11 写明: 这是**临时切分**, 终局收敛成
//     单一角色注册中心).
//
//   反双胞胎:
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//     - **不用 @DeleteDateColumn**: 软删查询手写 `deletedAt: IsNull()`
//       (仓库硬约束 #2; 跟 visitor_pool_templates 同款).
//     - **不落 tenant_id**: system 级资产, 公共模板同款 (spec §2.1).
//     - **不落任何计数字段** (使用数/收藏数/评分): 零压红线, 列都不存在 = 物理上不可能下发.
//     - **不把 5Ps 长文塞进内核**: five_ps 是给人读的专业材料 (评审/报告),
//       内核只吃数值 + 结构化心理要素 —— 两类数据分列, 不让内核读长文.
//     - **display_name 冗余存一份**: 让 resolver 返回的展示名与 voice 速查卡一致,
//       避免出现"引擎叫『回避依恋·L1』、速查卡叫『晚晴』"的分裂.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. migration:run 后 DESCRIBE character_profiles 与任务单 §3 一致
//     3. test/engine-adapters/wp9b-*.spec.ts 覆盖 resolver / seed / admin
//
//   V2026-11-04 治本 (WP51 · B 层 · 同盟三维基线两列):
//   职责: 给 `character_profiles` 加 2 列 —— `baseline_safety` / `baseline_bond`,
//         让角色种子能按依恋风格给出**开场**的安全感 / 联结感.
//   边界: 只加列 + 让 resolver 读; 数值口径在 seed 与内置种子两处 (各一份内容,
//         同一档位), 映射公式仍只有 WP9-A 的 buildCharacterProfile 一份.
//
//   为什么这两列不是"纯预留" (与 WP10A 三列相反):
//     WP10A 那三列是**表达风格** (话量/叙事/语态) —— 本期无消费方, 先占位.
//     而 safety / bond 是**同盟三维**的基线: 内核 bootstrap 已经从
//     `profile.baseline` 读 (WP51 同期), 列一到位就**真的生效**.
//
//   默认值与内核常量对齐:
//     `baseline_safety` 默认 0.5 = 内核 `DEFAULT_SAFETY`;
//     `baseline_bond` 默认 0 = 内核 `DEFAULT_BOND`.
//     存量行由 MySQL 的 ADD COLUMN ... DEFAULT 自动填充, 不需要 UPDATE ——
//     老角色加列后的行为与加列前逐字一致 (零回归).
//
//   V2026-11-04 治本 (WP49 · B 层 · 大五人格一列):
//   职责: 给 `character_profiles` 加 1 列 —— `personality_traits` (JSON),
//         让角色的**大五人格 (OCEAN) 数值**有地方存, 进内核后由 WP34 的人格
//         调节算子消费 (本期只有宜人性一条规则真的接上).
//   边界: 只加列 + 让 resolver 读; 数值口径在种子与内置种子两处 (各一份内容,
//         同一档位), 映射公式仍只有 WP9-A 的 buildCharacterProfile 一份.
//
//   为什么这列是 **JSON NULL** 而不是 NOT NULL DEFAULT (与 WP51 两列不同口径):
//     大五人格是**可选**的 —— 角色没表态 = 内核不做特质调节 (回退口径住在内核).
//     若给它一个 DB DEFAULT (比如 0.5), "这个角色没说"与"这个角色正好是 0.5"就在
//     数据源上被抹平了, 而适配层的条件展开也就失去了意义.
//     同理, MySQL 的 JSON 列本来也不该挂 DEFAULT —— 默认值写在 DDL 里就是第二份
//     真相源 (内核已经有一份).
//
//   为什么放在 `five_ps` 旁边 (而不是 baseline_* 那一组):
//     `five_ps` 是**临床 5Ps** (易感 / 维持 / 诱发 / 保护 / 持续因素), 是给人读的
//     长材料; `personality_traits` 是**大五人格数值**, 是给内核算子吃的.
//     两者**不是一回事** (内核 `PersonalityTraits` 的注释里专门警告过), 但它们是
//     "角色画像"里最容易被人混淆的两个东西 —— 并排放, 让"这是两列"一眼可见.
//
//   V2026-10-30 治本 (WP10A · B 层 · 表达风格基线字段预留):
//   职责: 给 `character_profiles` 加 3 列**纯预留**字段 —— 话量基线 / 叙事风格 / 语态倾向,
//         供 Phase2 P1 的表达风格渲染消费.
//   边界: 只加列; **不写任何消费逻辑** —— 不进内核 CharacterProfile / 不进 RenderSpec /
//         不改 resolver 映射 / 不暴露给前端 DTO (本期字段存在但完全不参与决策).
//
//   为什么"纯预留"也要现在加列:
//     这三个字段本质是**角色人格特质** (话多话少 / 叙事条理 / 语态倾向), 属于角色基线,
//     不是剧本节点的行为 —— 表刚建 (WP9-B), 现在加列成本最低; 等 Phase2 真要用时再加
//     migration, 还得回头补 seed, 反而更贵.
//
//   为什么"预留"不等于"造第二份真相":
//     三列都有 DB 级 DEFAULT (0.5 / 'mixed' / 'restrained'), **未指定 = 走 DB 默认**,
//     seed 不写自己没把握的值 —— 默认值只有一处真相 (DDL), 不在 seed 里再抄一份.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. migration:run 后 DESCRIBE character_profiles 与任务单 §1.1 一致
//     3. test/engine-adapters/wp10a-*.spec.ts 覆盖列定义 / migration 幂等 / 种子默认值
//
//   V2026-11-04 治本 (WP41 · B 层 · 表达风格三列接通):
//     WP10A 加的这 3 列此前是**纯预留** —— 有列、有种子、**零消费方**. 本期把它们
//     接上: resolver 读列 → 内核 `CharacterProfile` → `RenderSpec` → 渲染层.
//     本文件的两处改动:
//       ① `CharacterNarrativeStyle` / `CharacterExpressionTone` 两个类型改为
//          **从内核契约派生** (`NonNullable<CharacterProfile['...']>`) —— 内核是规范,
//          本文件是镜像; 自己再写一份联合类型 = 两个真相源, 内核加一档而这里没加
//          时 DB 行能装进去、内核却接不住, 而且**没有任何报错**;
//       ② 三列的注释从"纯预留"改成真实状态 (注释过期 = 给下一个人的假话).
//     列的定义 / DEFAULT **一字未改** (WP10A 的 DDL 口径不变, 不加 migration).
//
//   时间戳: 2026-10-29

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { AttachmentStyle, CharacterProfile, CoreBelief, PersonalityTraits, UnderlyingDesireSeed } from '../../../engine-core/index.js';

/**
 * 角色审核状态 (字符串联合, 非 enum —— 它是纯数据判别式, 不需要运行时值).
 *
 * 只有 `approved` 可被 resolver 命中 (任务单 §4.2).
 */
export type CharacterAuditStatus = 'draft' | 'approved' | 'rejected';

/**
 * 叙事逻辑风格 (V2026-10-30 WP10A · 表达风格基线).
 *
 * - structured   —— 条理清晰 / 时间线明确;
 * - disorganized —— 话题跳跃 / 想到哪说到哪;
 * - mixed        —— 兼有 (默认档).
 *
 * V2026-11-04 WP41: 这三列**不再纯预留** —— 内核 `CharacterProfile` 顶层已有同名字段,
 * 渲染层据此产出叙事 / 语态两行 (详见 `turn-render-orchestrator.ts`).
 *
 * 为什么这里的类型**从内核契约派生**而不是自己再写一遍联合类型:
 *   内核 `CharacterProfile` 是这 3 个字段的**规范定义**, 本文件是它的**镜像**.
 *   自己再写一份 = 两个真相源, 内核加一档而这里没加时, DB 行能装进去、
 *   内核却接不住 (而且**没有任何报错**). 派生写法让两者永远同步.
 *   (内核类型没进公开 barrel —— 边界断言 ⑥ 是双向精确白名单, 加导出要动第三个
 *    内核文件; 这里用**派生**而不是重复声明, 是与 WP59 同一套做法.)
 */
export type CharacterNarrativeStyle = NonNullable<CharacterProfile['narrativeStyle']>;

/**
 * 语态倾向 (V2026-10-30 WP10A · 表达风格基线).
 *
 * - restrained          —— 克制内敛 / 情绪平淡 (默认档);
 * - emotional           —— 情绪化宣泄 / 语句破碎;
 * - intellectualizing   —— 理智化隔离 / 讲道理 / 自我分析;
 * - passive_aggressive  —— 被动攻击 / 言语带刺 / 表面顺从实则抵触.
 *
 * 取值口径与来源: 见 `CharacterNarrativeStyle` (同一个内核契约派生).
 */
export type CharacterExpressionTone = NonNullable<CharacterProfile['expressionTone']>;

/**
 * 5Ps 专业材料 (给人读, 不进内核决策).
 *
 * 字段名沿用任务单 §3 的拍板口径:
 *   presenting    —— 当前主诉 (来访者自己怎么说)
 *   precipitating —— 诱发因素 (最近发生了什么)
 *   maintaining   —— 维持因素 (什么让它持续)
 *   protective    —— 保护因素 (什么在托住他)
 *   vulnerability —— 易感因素 (什么让他脆弱)
 */
export interface CharacterFivePs {
  readonly presenting: string;
  readonly precipitating: string;
  readonly maintaining: string;
  readonly protective: string;
  readonly vulnerability: string;
}

/**
 * `character_profiles` 表 —— 公共来访模板的引擎侧角色基线 (system 级, 全局共享).
 *
 * 一行 = 一个 `visitor_pool_templates.id` (`vpt_*` slug) 的引擎基线.
 * 逻辑外键 `template_id` → `visitor_pool_templates.id` (**不加 DB FK**).
 */
@Entity('character_profiles')
// 唯一键: 一个模板一份角色基线 (resolver 按 template_id 命中).
@Index('uniq_cp_template_id', ['templateId'], { unique: true })
// resolver 的主查询路径: 「已审核 + 已上架」筛选.
@Index('idx_cp_audit_enabled', ['auditStatus', 'enabled'])
export class CharacterProfileEntity {
  /** 内部主键 (内容派生, 同一 template_id 永远同一个 id —— 保证 seed 幂等). */
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  /** 关联的公共模板 id (`vpt_*` slug); 与 `visitor_pool_templates.id` 逻辑关联. */
  @Column({ type: 'varchar', length: 64, name: 'template_id' })
  templateId!: string;

  /** 展示用角色名 (= 对应模板的 codename, 例「晚晴」). */
  @Column({ type: 'varchar', length: 100, name: 'display_name' })
  displayName!: string;

  /** 依恋风格 (内核消费; 不由临场 preset 推导). */
  @Column({ type: 'varchar', length: 20, name: 'attachment_style' })
  attachmentStyle!: AttachmentStyle;

  /** 5Ps 专业长文 (评审/报告用; **不进内核决策**). */
  @Column({ type: 'json', name: 'five_ps' })
  fivePs!: CharacterFivePs;

  /**
   * 大五人格 (OCEAN) 数值 (WP49).
   *
   * NULL = 角色**没表态** = 内核不做特质调节 —— 回退口径住在内核, 本层不兜底.
   * 与 `baseline_safety` / `baseline_bond` (NOT NULL DEFAULT) **口径相反**:
   * 那两列是必填基线, 本列是可选人格.
   *
   * ⚠️ 与 `five_ps` 不是一回事: 那是临床 5Ps (人读材料), 本列是大五人格数值
   * (给内核算子吃) —— 两个概念, 不要混用.
   */
  @Column({ type: 'json', name: 'personality_traits', nullable: true })
  personalityTraits!: PersonalityTraits | null;

  /** 初始信任 [0,1] (种子给, 临场 preset 不覆盖). */
  @Column({ type: 'float', name: 'baseline_trust', default: 0.3 })
  baselineTrust!: number;

  /** 三维阻抗 · 话量 [0,1] (越高越不愿说). */
  @Column({ type: 'float', name: 'baseline_resistance_verbal' })
  baselineResistanceVerbal!: number;

  /** 三维阻抗 · 内容深度 [0,1]. */
  @Column({ type: 'float', name: 'baseline_resistance_depth' })
  baselineResistanceDepth!: number;

  /** 三维阻抗 · 表达风格 [0,1]. */
  @Column({ type: 'float', name: 'baseline_resistance_style' })
  baselineResistanceStyle!: number;

  /** 情绪效价 [-1,1] (负 = 负向基调). */
  @Column({ type: 'float', name: 'baseline_emotion_valence' })
  baselineEmotionValence!: number;

  /** 情绪唤醒 [0,1]. */
  @Column({ type: 'float', name: 'baseline_emotion_arousal' })
  baselineEmotionArousal!: number;

  /**
   * 关系安全感基线 [0,1] (WP51).
   *
   * 缺省 0.5 —— 与内核 `DEFAULT_SAFETY` 一致 (存量行加列后自动就是这个值,
   * 一条 UPDATE 都不用写).
   */
  @Column({ type: 'float', name: 'baseline_safety', default: 0.5 })
  baselineSafety!: number;

  /**
   * 关系联结基线 [0,1] (WP51).
   *
   * 缺省 0 —— 与内核 `DEFAULT_BOND` 一致 (纽带感开场时不存在, 只能长出来).
   */
  @Column({ type: 'float', name: 'baseline_bond', default: 0 })
  baselineBond!: number;

  /**
   * 话量基线 [0,1] (V2026-10-30 WP10A · 表达风格预留).
   *
   * 0 = 极沉默 / 长停顿, 1 = 絮叨 / 长篇大论.
   *
   * 与 `baseline_resistance_verbal` **正交**: verbal 阻抗是"不信任、不愿暴露",
   * 话量基线是"天然性格话多话少" —— 两者会同时反向变化 (话多但不愿说, 或话少但很能说),
   * 合成成一个维度会把"防御性沉默"和"气质性沉默"混成同一种人 (任务单 §1.1).
   *
   * V2026-11-04 WP41: 这一列**已接通** —— resolver 读它 → 内核 `CharacterProfile`
   * → `RenderSpec` → 渲染层拿它对**话量档位边界**做基线修正 (天生话多的人不容易
   * 被判"话少"). 缺省 0.5 = 中位 = 修正量为 0 = 与没接一样.
   */
  @Column({ type: 'float', name: 'speech_volume_baseline', default: 0.5 })
  speechVolumeBaseline!: number;

  /**
   * 叙事逻辑风格 (V2026-10-30 WP10A · 表达风格预留).
   *
   * V2026-11-04 WP41: 这一列**已接通** —— resolver 读它 → 内核 `CharacterProfile`
   * → `RenderSpec` → 渲染层渲染"说话一贯的样子"那一行.
   */
  @Column({ type: 'varchar', length: 20, name: 'narrative_style', default: 'mixed' })
  narrativeStyle!: CharacterNarrativeStyle;

  /**
   * 语态倾向 (V2026-10-30 WP10A · 表达风格预留).
   *
   * V2026-11-04 WP41: 这一列**已接通** —— resolver 读它 → 内核 `CharacterProfile`
   * → `RenderSpec` → 渲染层渲染"说话一贯的样子"那一行.
   */
  @Column({ type: 'varchar', length: 20, name: 'expression_tone', default: 'restrained' })
  expressionTone!: CharacterExpressionTone;

  /** 核心信念 (第一人称, 永久不可变): `[{theme, statement, activationTags[]}]`. */
  @Column({ type: 'json', name: 'core_beliefs' })
  coreBeliefs!: CoreBelief[];

  /** 底层愿望种子: `[{key, label, baselineWeight}]`. */
  @Column({ type: 'json', name: 'underlying_desires' })
  underlyingDesires!: UnderlyingDesireSeed[];

  /** 绝不会做的事 (负向约束; 透传内核意图规划, **不作风险信号**). */
  @Column({ type: 'json', name: 'forbidden_behaviors' })
  forbiddenBehaviors!: string[];

  /** 敏感议题词表 (命中触发 sensitive_touch 事件). */
  @Column({ type: 'json', name: 'sensitive_topics' })
  sensitiveTopics!: string[];

  /** 审核状态; 只有 `approved` 可被 resolver 命中. */
  @Column({ type: 'varchar', length: 20, name: 'audit_status', default: 'draft' })
  auditStatus!: CharacterAuditStatus;

  /** 上下架开关: 1 = 在架 (可被命中), 0 = 下架. */
  @Column({ type: 'tinyint', default: 1 })
  enabled!: boolean;

  /**
   * 内容修改计数 (int 自增).
   *
   * V2026-11-06 治本 (WP38): 本列**不再是版本的真相源** —— 真相源是下面三列 semver.
   * 本列保留为"改过几次"的粗粒度计数 (既有对外契约 + 既有单测依赖它), 但它
   * **表达不出**"这次改动是主版本还是次版本" —— 那正是 semver 要回答的问题.
   * (两个真相源并存的风险: 有人改本列不改 semver → 版本号对不上. 所以本列的
   *  注释写明它是"计数", 版本判定一律读三列.)
   */
  @Column({ type: 'int', default: 1 })
  version!: number;

  /**
   * 主版本号 (semver major) — WP38.
   *
   * 语义: 角色定位大改 (依恋风格变了 / 核心信念变了).
   * **进行中锁定**: 有活跃会话在用这个角色时不允许改主版本 (要改先等会话结束).
   *
   * 缺省 1 —— 与"初始版本 1.0.0"一致; 存量行加列后自动就是这个值 (零回归).
   */
  @Column({ type: 'int', name: 'version_major', default: 1 })
  versionMajor!: number;

  /**
   * 次版本号 (semver minor) — WP38.
   *
   * 语义: 参数调整 (信任基线微调 / 阻抗档位调整) —— 平滑生效: 新会话用新版本,
   * 已在跑的会话不受影响.
   */
  @Column({ type: 'int', name: 'version_minor', default: 0 })
  versionMinor!: number;

  /**
   * 修订号 (semver patch) — WP38.
   *
   * 语义: 文案错别字 / 小参数微调 —— 实时生效档.
   */
  @Column({ type: 'int', name: 'version_patch', default: 0 })
  versionPatch!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟仓库既有 entity 一致, 非 @DeleteDateColumn → 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
