// V2026-11-22 (AF-314 · 自动对练场次模型可观测):
//   `ap_practice_sessions` 增三列 —— 来访者渲染主候选 provider / 来访者模型 / 咨询师模型.
//
//   为什么必须分列而不是复用 model_version:
//     `model_version` 是推理环境指纹里的全局 LLM 模型（当前取 `MINIMAX_LLM_MODEL`），
//     用于批次版本对比；来访者在灰度期可能走 `VISITOR_LLM_PROVIDER=doubao`，
//     两者不是同一个真相。把全局模型标成来访者模型会造成历史追溯错误。
//
//   幂等: 逐列 hasColumn，缺才加；重复跑不报错。
//   历史行保持 NULL —— 不回填，不替历史数据编造当时未记录的模型。

import { MigrationInterface, QueryRunner } from 'typeorm';

/** 表名. */
const TABLE = 'ap_practice_sessions';

/** 新增列（列名 / 定义 / 注释）. */
const COLUMNS: readonly { readonly name: string; readonly ddl: string }[] = [
  {
    name: 'visitor_model_provider',
    ddl: "VARCHAR(32) NULL COMMENT '来访者渲染主候选 provider (doubao / minimax / ...)'",
  },
  {
    name: 'visitor_model',
    ddl: "VARCHAR(128) NULL COMMENT '来访者渲染主候选模型 id'",
  },
  {
    name: 'counselor_model',
    ddl: "VARCHAR(128) NULL COMMENT '咨询师生成模型 id'",
  },
];

/**
 * 给自动对练场次补三列模型可观测字段.
 */
export class AddPracticeSessionModelColumns1714900000050 implements MigrationInterface {
  /** 迁移名 (TypeORM 以类名为准). */
  name = 'AddPracticeSessionModelColumns1714900000050';

  /**
   * 正向迁移：缺列才加，已存在则跳过.
   *
   * @param queryRunner 查询运行器
   */
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    for (const column of COLUMNS) {
      if (await queryRunner.hasColumn(TABLE, column.name)) continue;
      await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${column.name} ${column.ddl}`);
    }
  }

  /**
   * 回滚: 删三列.
   *
   * 只删本迁移新增的可观测列，不碰既有 `model_version` / 成本 / 危机指标.
   *
   * @param queryRunner 查询运行器
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    for (const column of COLUMNS) {
      if (!(await queryRunner.hasColumn(TABLE, column.name))) continue;
      await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${column.name}`);
    }
  }
}
