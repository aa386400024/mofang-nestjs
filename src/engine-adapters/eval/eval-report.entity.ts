// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · eval_reports 表实体):
//   职责: 承载 eval_reports 表 —— 每次评测跑完落一份报告, 历史可查、可对比.
//   边界: 只描述表结构与列语义; 零业务逻辑.
//
//   为什么这张表在 engine-adapters 而不是 counselor:
//     表的**写入方**是评测流水线 (离线批处理通道), 生命周期随评测走 ——
//     与 turn_delta_audits 同一归属理由.
//
//   反双胞胎:
//     - **不落对话原文**: 报告里只有数值化的指标 / 枚举 / id —— 心理内容不进普通表.
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//     - **不做软删**: 报告是审计数据, 删了就等于让"跟上一版比"断链.
//     - **report_json 存整份报告快照**: 跨版本对比要的是**当时那一版**的完整事实
//       (含阈值 / 数据集版本 / 告警), 只存几个汇总列不够复现当时的结论.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE eval_reports;
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-09

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * eval_reports 表 —— 一次评测 = 一行.
 */
@Entity('eval_reports')
// 按生成时间倒序取"上一版报告" (回归对比要用).
@Index('idx_eval_report_created_at', ['createdAt'])
// 按数据集版本取上一版 (同一数据集内跨版本对比).
@Index('idx_eval_report_dataset_version', ['datasetVersion'])
export class EvalReportEntity {
  /** 主键 (uuid). */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 报告 id (全局唯一 —— 人工抽检口子靠它定位样本). */
  @Column({ type: 'varchar', length: 128, name: 'report_id', unique: true })
  reportId!: string;

  /** 数据集版本 (同一版本内才有可比性). */
  @Column({ type: 'varchar', length: 128, name: 'dataset_version' })
  datasetVersion!: string;

  /** 评测模式 (offline / full). */
  @Column({ type: 'varchar', length: 16, name: 'mode' })
  mode!: string;

  /** 运行配置快照 (模型 / prompt 版本 / 阈值 / 切分 / 真值来源). */
  @Column({ type: 'json', name: 'config_json' })
  configJson!: Record<string, unknown>;

  /** 指标明细 (触发质量 / 建议质量 / 基线对比 / 多轮汇总 / 成本). */
  @Column({ type: 'json', name: 'metrics_json' })
  metricsJson!: Record<string, unknown>;

  /** 数据质量统计 (总场次 / 有效场次 / 丢弃原因). */
  @Column({ type: 'json', name: 'data_quality_json' })
  dataQualityJson!: Record<string, unknown>;

  /** 整份报告快照 (含告警与样本 id). */
  @Column({ type: 'json', name: 'report_json' })
  reportJson!: Record<string, unknown>;

  /** 落库时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
