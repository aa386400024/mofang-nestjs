// V2026-11-20 治本 (AF-187 · 自动对练场景与危机收尾结论列):
//   原因: 两场导出会话暴露两个**表结构缺口**:
//     ① 场次表没有"接触方式"列 —— 面对面 / 线上视频 / 线上语音 / 线上文字
//        无法区分, 统计与筛选只能靠猜;
//     ② 危机收尾只有 `crisis_ended` 一个 0/1 列, 语义是"因危机终止"（坏结果）,
//        无法表达"安全计划已完成"（好结果）, 于是导出里出现
//        `crisis_practice_max + crisisEnded=false` 这种读起来自相矛盾的组合.
//
//   本迁移给 `ap_practice_sessions` 补 3 列:
//     encounter_mode    VARCHAR(16) NOT NULL DEFAULT 'in_person' — 接触方式
//     encounter_channel VARCHAR(16) NULL                          — 线上子通道
//     crisis_outcome    VARCHAR(32) NULL                          — 危机收尾结论
//
//   存量回填:
//     · encounter_mode 全表回填 'in_person'（历史 prompt 实际按聊天腔跑, 这里只统一
//       业务默认口径, 不反推历史内容）;
//     · encounter_channel / crisis_outcome 保持 NULL（"当时没记"是事实, 不补假值）.
//
//   反双胞胎 (与 0041 / 0045 / 0047 同纪律):
//     - 手写 DDL, 不用 migration:generate（counselor 系 migration 一律手写）;
//     - 幂等: INFORMATION_SCHEMA 查列, 缺才加; 重复跑不报错;
//     - 不加 FK / 不做软删 / 不落对话原文.

import { MigrationInterface, QueryRunner } from 'typeorm';

/** 表名. */
const TABLE = 'ap_practice_sessions';

/** 列名 → DDL 片段. */
const COLUMN_DDL: Readonly<Record<string, string>> = {
  encounter_mode: "encounter_mode VARCHAR(16) NOT NULL DEFAULT 'in_person' COMMENT '接触方式: in_person / online'",
  encounter_channel: "encounter_channel VARCHAR(16) NULL COMMENT '线上子通道: video / voice / text'",
  crisis_outcome: "crisis_outcome VARCHAR(32) NULL COMMENT '危机收尾结论: safety_plan_completed / escalated / incomplete'",
};

/**
 * 查表已有列.
 *
 * @param qr 查询运行器
 * @returns 列名集合
 */
async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [TABLE],
  )) as { name?: unknown }[];
  return new Set(rows.map((row) => String(row.name ?? '').toUpperCase()));
}

/**
 * 补列（幂等）.
 */
export class AddEncounterAndCrisisOutcome1714900000048 implements MigrationInterface {
  /** 迁移名（TypeORM 以类名为准）. */
  name = 'AddEncounterAndCrisisOutcome1714900000048';

  /**
   * 正向迁移.
   *
   * @param queryRunner 查询运行器
   */
  async up(queryRunner: QueryRunner): Promise<void> {
    const columns = await existingColumns(queryRunner);
    for (const [column, ddl] of Object.entries(COLUMN_DDL)) {
      if (columns.has(column.toUpperCase())) continue;
      await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${ddl}`);
    }
    // 存量回填: 已有行统一面对面默认口径（只回填 mode, 其余保持 NULL）.
    await queryRunner.query(`UPDATE ${TABLE} SET encounter_mode = 'in_person' WHERE encounter_mode IS NULL OR encounter_mode = ''`);
  }

  /**
   * 回滚.
   *
   * @param queryRunner 查询运行器
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    const columns = await existingColumns(queryRunner);
    for (const column of Object.keys(COLUMN_DDL)) {
      if (!columns.has(column.toUpperCase())) continue;
      await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${column}`);
    }
  }
}
