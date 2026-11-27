// AF-584 (Phase3 P3): character_profiles 加角色级不流利配置两列.
//   disfluency_level   VARCHAR(16) NULL —— none/light/natural/heavy; NULL = 角色没表态。
//   disfluency_density FLOAT NULL       —— [0,1] 密度倾向; NULL = 修正量 0。
//   两列都可空、无默认值: 存量行零影响, 行为与 AF-204 逐字一致.
import { MigrationInterface, QueryRunner } from 'typeorm';

async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'character_profiles'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddCharacterProfileDisfluencyConfig1714900000058 implements MigrationInterface {
  name = 'AddCharacterProfileDisfluencyConfig1714900000058';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (!present.has('disfluency_level')) {
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN disfluency_level VARCHAR(16) NULL AFTER speech_register;`);
    }
    if (!present.has('disfluency_density')) {
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN disfluency_density FLOAT NULL AFTER disfluency_level;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (present.has('disfluency_density')) {
      await qr.query(`ALTER TABLE character_profiles DROP COLUMN disfluency_density;`);
    }
    if (present.has('disfluency_level')) {
      await qr.query(`ALTER TABLE character_profiles DROP COLUMN disfluency_level;`);
    }
  }
}
