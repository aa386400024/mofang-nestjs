// V2026-10-15 治本 (V2.1 — supervision_schools entity, 4 流派配置表):
//   原因: counselor-mode-v1.0 §6.2 拍板 supervision_schools 表 (4 流派 code/name/focusAreas/
//     exampleFeedback), V0.3 §8 baseline 0 流派配置, 1:1 wire 0 破坏. 4 流派走 DB
//     配置表 (不走 V0.5 静态 enum) 是因为: 1) 高级会员可解锁多流派对比 (4 流派是
//     server 端 runtime 行为, 不是 client 端 enum 硬编码); 2) 未来 B 端 / 海外扩展
//     需要新增流派 (e.g. ACT/DBT/EFT), 改 DB 行不需发版.
//
//   修法 (跟 knowledge-item.entity.ts V0.x 风格一致):
//     - UUID PK + char(36) id
//     - code varchar(50) UNIQUE 存 SupervisionSchoolCode enum 字符串
//     - name varchar(200) 流派中文名 (跟 LongTermCaseType 5 预设 1:1)
//     - focusAreas json 关注重点 (string[], 跟 counselor-mode-v1.0 §4.6 表 1:1)
//     - exampleFeedback json 典型反馈示例 (string[], 跟 §4.6 1:1)
//     - promptTemplate text nullable (V0.5 mock 阶段用, V1.x 真接 LLM 时改 provider
//       注入, 字段保留方便 V1.x 升级)
//     - isActive TINYINT(1) (V0.x 阶段 4 流派都 active, 未来灰度流派 A/B 用)
//     - 1 UNIQUE INDEX (code) + 1 普通 INDEX (is_active)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 LongTermCaseType enum: 4 督导流派 ≠ 5 长程类型, 业务正交
//     - 不用 enum 类型 (code 走 varchar + 应用层 SupervisionSchoolCode 校验): V0.x pattern
//     - 4 流派不进 hardcode: 走 DB 配置表, 未来 B 端 / 海外扩展只需 INSERT 1 行
//
//   验证:
//     1. tsc 0 错
//     2. pnpm migration:run 后 SHOW INDEX FROM supervision_schools; 3 索引 (PRIMARY + UNIQUE + active)
//
//   时间戳: 2026-10-15

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';

/**
 * supervision_schools 表.
 *
 * 跟 xin_su_app SupervisionSchool entity 1:1 wire.
 * 1:N supervision_feedback (schoolId 应用层校验).
 */
@Entity('supervision_schools')
@Index('uniq_ss_code', ['code'], { unique: true })
@Index('idx_ss_active', ['isActive'])
export class SupervisionSchool {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: code 走 varchar(50) + 应用层 enum 校验, 不写 DB-level ENUM (跟 knowledge-items.type
  // varchar 同 pattern, V0.5 V2026-10-12 治本一致), 防 schema 跟 enum 字符串 drift.
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: SupervisionSchoolCode;

  // 流派中文名 (跟 counselor-mode-v1.0 §4.6 表 1:1).
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  // 关注重点 string[] (跟 counselor-mode-v1.0 §4.6 4 流派 1:1).
  @Column({ type: 'json', name: 'focus_areas' })
  focusAreas!: string[];

  // 典型反馈示例 string[] (跟 counselor-mode-v1.0 §4.6 1:1, UI 展示流派特征用).
  @Column({ type: 'json', name: 'example_feedback' })
  exampleFeedback!: string[];

  // V0.5 mock: prompt 模板存 DB 方便运行时拼接. V1.x 真接 LLM 时, 改 provider 注入,
  // 字段保留 (不用 promptTemplate 也兼容老行).
  @Column({ type: 'text', name: 'prompt_template', nullable: true })
  promptTemplate!: string | null;

  // V0.x 阶段 4 流派都 active=1. 未来灰度新流派 A/B 用, 0 表示不展示.
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
