// V2026-10-15 治本 (V3.2 — ability_dimensions entity, 28 子指标静态配置表):
//   原因: counselor-mode-v1.0 §6.3 拍板 ability_dimensions 表 (7 维度 28 子指标配置),
//     V0.3 §13 baseline 0 子指标表 (V0.x AIProfileSnapshot 只存 7 维度名字), 1:1 wire
//     0 破坏. 28 子指标走 DB 配置表 (不走 V0.5 静态 enum) 是因为: 1) 28 子指标粒度细,
//     enum 静态定义难维护; 2) 未来 B 端 / 海外扩展需要新增子指标, 改 DB 行不需发版;
//     3) 跟 W3-4 supervision_schools 4 流派配置同 pattern, V0.x 风格一致.
//
//   修法 (跟 supervision-school.entity.ts W3-4 风格一致):
//     - UUID PK + char(36) id
//     - tenantId 字段预留 (V0.x 一人一租户, A9) — V0.5 阶段不写, V1.x 多租户上线后加
//     - parentDimension varchar(50) 存 AbilityParentDimension enum 字符串
//     - subIndicatorCode varchar(100) UNIQUE (28 子指标 code, 跟 supervisor 4 流派同 pattern)
//     - subIndicatorName varchar(200) 子指标中文名 (UI 雷达图标签用)
//     - description text nullable (子指标定义说明, 督导报告 / UI 详情用)
//     - displayOrder int (UI 雷达图 28 标签排序)
//     - isActive TINYINT(1) (V0.x 阶段 28 子指标全 active, 未来灰度子指标 A/B 用)
//     - 2 UNIQUE INDEX (sub_indicator_code) + 普通 INDEX (parent_dimension)
//     - 软删 deletedAt
//
//   反双胞胎:
//     - 不复用 V0.x AIProfileSnapshot 7 维度: 28 子指标粒度更细, 1:1 wire 增量
//     - 不用 enum 类型 (parentDimension 走 varchar + 应用层 enum 校验): V0.x pattern
//     - 28 子指标不进 hardcode: 走 DB 配置表, 未来 B 端 / 海外扩展只 INSERT
//
//   验证:
//     1. tsc 0 错
//     2. pnpm migration:run + seed 后 SELECT * FROM ability_dimensions; # 28 行
//
//   时间戳: 2026-10-15

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AbilityParentDimension } from '../enums/ability-parent-dimension.enum';

/**
 * ability_dimensions 表.
 *
 * 跟 xin_su_app AbilityDimension entity 1:1 wire.
 * 1:N ability_scores (dimensionId 应用层校验).
 */
@Entity('ability_dimensions')
@Index('uniq_ad_code', ['subIndicatorCode'], { unique: true })
@Index('idx_ad_parent', ['parentDimension'])
export class AbilityDimension {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: parentDimension 走 varchar(50) + 应用层 enum 校验, 不写 DB-level ENUM
  // (跟 W3-4 supervision_schools.code 同 pattern, V0.5 V2026-10-12 治本一致).
  @Column({ type: 'varchar', length: 50, name: 'parent_dimension' })
  parentDimension!: AbilityParentDimension;

  // 子指标 code, 跟 W3-4 supervision_schools.code 同 pattern (varchar + UNIQUE).
  @Column({ type: 'varchar', length: 100, name: 'sub_indicator_code', unique: true })
  subIndicatorCode!: string;

  // 子指标中文名 (UI 雷达图标签 + 详情用).
  @Column({ type: 'varchar', length: 200, name: 'sub_indicator_name' })
  subIndicatorName!: string;

  // 子指标定义说明 (督导报告 / UI 详情用), nullable 兼容老行.
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // UI 雷达图 28 标签排序 (基础技能 5 个子指标 1-5, 专业知识 6-8, ..., 跟 §5.1 表 1:1).
  @Column({ type: 'int', name: 'display_order', default: 0 })
  displayOrder!: number;

  // V0.x 阶段 28 子指标全 active=1. 未来灰度新子指标 A/B 用, 0 表示不展示.
  @Column({ type: 'tinyint', name: 'is_active', default: 1 })
  isActive!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
