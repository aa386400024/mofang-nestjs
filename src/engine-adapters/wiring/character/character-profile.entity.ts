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
//   时间戳: 2026-10-29

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { AttachmentStyle, CoreBelief, UnderlyingDesireSeed } from '../../../engine-core';

/**
 * 角色审核状态 (字符串联合, 非 enum —— 它是纯数据判别式, 不需要运行时值).
 *
 * 只有 `approved` 可被 resolver 命中 (任务单 §4.2).
 */
export type CharacterAuditStatus = 'draft' | 'approved' | 'rejected';

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

  /** 版本号 (预留; 版本迁移本身归 Phase2). */
  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟仓库既有 entity 一致, 非 @DeleteDateColumn → 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
