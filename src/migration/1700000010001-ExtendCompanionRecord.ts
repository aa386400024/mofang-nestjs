import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-01 — 扩展 profile/companion_records 表 (心塑「陪伴」Tab2 复用).
 *
 * 加 4 个 nullable 字段:
 *   - related_person_id: 关联成长用户 UID (跟 companion_to_uid 同义冗余, 跟前端契约对齐)
 *   - tool_id / dual_exercise_id / rehab_item_id: 关联工具 / 双人练习 / 康复项 ID
 *
 * 设计:
 *   - V2.0 占位为 NULL (老数据兼容, queryBuilder 加 .where(... .related_person_id IS NOT NULL)
 *     或者 service 层 fallback 到 companionToUid)
 *   - V3 由 service 写入 (companion Tab2 service 实时记录关联)
 *
 * 反双胞胎 (重要):
 *   - 复用现有 companion_records 表 (1700000007004), 不新建 companion_tab2_records 表
 *   - companion Tab1 跟 Tab2 共享同一张 records 表 (companion 模块的所有记录)
 *
 * 大厂做法:
 *   - 加列走 ALTER TABLE, nullable 默认 NULL, 不破坏老数据
 *   - 加索引: related_person_id 走联合索引 (companion_uid, related_person_id)
 *   - 不加 FK (related_person_id 引用 users, 但允许 nullable + 软删不一致, 应用层校验)
 */
export class ExtendCompanionRecord1700000010001 implements MigrationInterface {
  name = 'ExtendCompanionRecord1700000010001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`companion_records\`
        ADD COLUMN \`related_person_id\` char(36) NULL AFTER \`tag\`,
        ADD COLUMN \`tool_id\` varchar(64) NULL AFTER \`related_person_id\`,
        ADD COLUMN \`dual_exercise_id\` varchar(64) NULL AFTER \`tool_id\`,
        ADD COLUMN \`rehab_item_id\` varchar(64) NULL AFTER \`dual_exercise_id\`,
        ADD INDEX \`idx_companion_records_uid_related\` (\`companion_uid\`, \`related_person_id\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`companion_records\`
        DROP INDEX \`idx_companion_records_uid_related\`,
        DROP COLUMN \`rehab_item_id\`,
        DROP COLUMN \`dual_exercise_id\`,
        DROP COLUMN \`tool_id\`,
        DROP COLUMN \`related_person_id\`;
    `);
  }
}
