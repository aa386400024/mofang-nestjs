// V2026-11-02 治本 (WP14 — student_risk_events 学员心理风险事件审计表):
//   原因: 任务单 `docs/progress/engine-wp14-student-risk-disposal-backend-2026-11-02.md`
//     §1.2 —— 检测层能判出"学员这句话命中了危机类别", 但判出来之后**无处留痕**.
//     这张表是平台安全保障义务的证据: 谁 / 哪一场 / 第几轮 / 判成什么 / 怎么处置的.
//   表结构: 任务单 §1.2 的 13 列 1:1 落地 (唯一偏差见下方 user_id / reviewed_by 说明).
//
//   ⚠️ **append-only**: 本表**故意没有** `updated_at` / `deleted_at` ——
//     审计表的价值在于"不可篡改". 给了软删列就会出现"这条风险记录被删了"这种
//     查不到事实的情况, 那比没有表更糟. 唯一允许 update 的是 `user_choice`
//     (学员点完弹窗后的选择 —— 是用户主动反馈, 不是审计篡改; 任务单 §1.3 已拍板).
//
//   ⚠️ **user_id / reviewed_by 用 varchar(36) 而不是任务单写的 bigint**:
//     本仓的用户主键是 **uuid** (`users.uid`, varchar 36) ——
//     `training_sessions.user_id` 也是 varchar(36). 跟着仓库走, 否则审计表里的
//     学员 id 跟会话表对不上, 督导按 id 复核时根本 join 不起来.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: `CREATE TABLE IF NOT EXISTS` + 索引守卫 (缺才补) ——
//       重复跑 up 不报错, 半途中断后重跑能补齐.
//     - **不加 DB-level FK**: 跟仓库既有 pattern 一致.
//     - **不加 tenant_id**: 学员侧审计行按 user_id 隔离 (学员 id 即租户 id, V0.x 一人一租户).
//     - **不改已执行的迁移**: 0025 及以前的一行不动 —— 迁移只增不改.
//
//   部署顺序:
//     entity 加了表 → 运行时写入前 **必须先 migration:run**, 否则写库报
//     "Table 'student_risk_events' doesn't exist". (建表类迁移的固有代价.)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE student_risk_events;   # 13 列 + 2 索引, 无 updated_at / deleted_at
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//     3. pnpm migration:revert → 表消失; 再 migration:run → 表回来
//
//   时间戳: 2026-11-02
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查表是否已存在 (INFORMATION_SCHEMA; 走 DATABASE() = 当前连接的库).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @returns 存在则 true
 */
async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = (await qr.query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [
    table,
  ])) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * 查表里已有的索引名 (SHOW INDEX).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @returns 已存在的索引名集合
 */
async function existingIndexes(qr: QueryRunner, table: string): Promise<Set<string>> {
  const rows = (await qr.query(`SHOW INDEX FROM ${table};`)) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['Key_name'] === 'string' ? row['Key_name'] : '')));
}

export class AddStudentRiskEvents1714900000026 implements MigrationInterface {
  name = 'AddStudentRiskEvents1714900000026';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 表不存在才建 (CREATE TABLE IF NOT EXISTS 兜底半途中断).
    if (!(await tableExists(qr, 'student_risk_events'))) {
      await qr.query(`
        CREATE TABLE IF NOT EXISTS student_risk_events (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          session_id VARCHAR(64) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          turn_index INT NOT NULL,
          level ENUM('low','medium','high') NOT NULL,
          category VARCHAR(64) NOT NULL,
          snippet VARCHAR(200) NOT NULL,
          source ENUM('rule','psyguard','local_dict') NOT NULL,
          action_taken ENUM('silent','toast','modal') NOT NULL,
          user_choice ENUM('phone','continue','dismissed') NULL DEFAULT NULL,
          monitored_after TINYINT(1) NOT NULL DEFAULT 0,
          reviewed_by VARCHAR(36) NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_sre_session (session_id),
          INDEX idx_sre_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    // 幂等守卫: 表已存在时 (上一轮跑过 / 半途中断), 补齐缺失的索引.
    const indexes = await existingIndexes(qr, 'student_risk_events');
    if (!indexes.has('idx_sre_session')) {
      await qr.query(`ALTER TABLE student_risk_events ADD INDEX idx_sre_session (session_id);`);
    }
    if (!indexes.has('idx_sre_user')) {
      await qr.query(`ALTER TABLE student_risk_events ADD INDEX idx_sre_user (user_id);`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 本迁移只建了这 1 张表, 删表即净回滚 (不残留列 / 不残留索引).
    await qr.query(`DROP TABLE IF EXISTS student_risk_events;`);
  }
}
