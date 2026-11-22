import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — User consent 表 (使用协议 + 隐私条款同意记录).
 *
 * 设计要点:
 *   - UUID 主键 (char(36)), 跟 users/sessions 风格一致
 *   - 设备指纹 deviceId 作为游客态唯一标识 (用户未登录也能记录)
 *   - UNIQUE(deviceId, version, type) 幂等约束 (重复 POST 不创建新行)
 *   - metadata 用 JSON 类型 (MySQL 5.7+ 原生, 比 TEXT 性能高 + 支持 JSON 表达式查询)
 *   - accepted_at 用 datetime(6) 精度, 跟其他时间字段对齐
 *   - 不加 FK 到 users.uid (用户表还在演化, V3 后续可加 FK; 当前用 application 关联 user_id)
 *
 * 后续 V3 migrations:
 *   - 1700000006001-AddConsentUserFk (添加 user_id FK, 等用户表稳定后)
 *   - 1700000006002-AddConsentEventBus (event bus pub/sub)
 */
export class AddUserConsent1700000006000 implements MigrationInterface {
  name = 'AddUserConsent1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_consents\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` char(36) NULL,
        \`device_id\` varchar(128) NOT NULL,
        \`consent_version\` varchar(32) NOT NULL,
        \`consent_type\` varchar(64) NOT NULL,
        \`platform\` varchar(32) NOT NULL,
        \`app_id\` varchar(64) NOT NULL,
        \`accepted_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`ip_address\` varchar(64) NULL,
        \`user_agent\` varchar(512) NULL,
        \`metadata\` json NULL,
        UNIQUE INDEX \`uq_user_consents_device_version_type\` (\`device_id\`, \`consent_version\`, \`consent_type\`),
        INDEX \`idx_user_consents_user_id\` (\`user_id\`),
        INDEX \`idx_user_consents_app_id\` (\`app_id\`),
        INDEX \`idx_user_consents_accepted_at\` (\`accepted_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_consents\`;`);
  }
}
