// V2026-10-20 治本 (专项技能 Hero 显示偏好 — 建表):
//   原因: 设计规格 §14-2「Hero 可由用户关闭」需要服务端持久化; 该表在 counselor 模块
//     首个「非训练数据」的实体, 必须走 migration (ADR-0003 已禁 synchronize).
//   修复: 新建 counselor_ui_preferences, user_id 唯一保证一人一行 (upsert 语义).
//   反双胞胎:
//     - 不用 IF NOT EXISTS 掩盖失败 (表已存在通常意味着 migration 被重复执行, 应显式报错;
//       但项目其余 migration 均用 IF NOT EXISTS, 此处保持一致以免风格分裂)
//     - prefs 用 JSON 而非多列 (偏好项会增长, 多列 = 每加一项一次 DDL)
//   验证: 大炮手动跑 migration:run 后 SHOW CREATE TABLE counselor_ui_preferences.
//   时间戳: 2026-10-20
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCounselorUiPreferences1714900000012 implements MigrationInterface {
  name = 'AddCounselorUiPreferences1714900000012';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS counselor_ui_preferences (
        id CHAR(36) NOT NULL PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        prefs JSON NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX uq_cup_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS counselor_ui_preferences;`);
  }
}
