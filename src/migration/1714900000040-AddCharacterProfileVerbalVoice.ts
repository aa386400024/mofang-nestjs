// WP-J P2: character_profiles 加 verbal_voice 列 (台词指纹).
//   自由文本描述角色"说话的味道", 渲染层 prompt 用, 不进内核决策.
//   NULL = 不渲染 = 零回归.
import { MigrationInterface, QueryRunner } from 'typeorm';

async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'character_profiles'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddCharacterProfileVerbalVoice1714900000040 implements MigrationInterface {
  name = 'AddCharacterProfileVerbalVoice1714900000040';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (!present.has('verbal_voice')) {
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN verbal_voice VARCHAR(500) NULL AFTER expression_tone;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (present.has('verbal_voice')) {
      await qr.query(`ALTER TABLE character_profiles DROP COLUMN verbal_voice;`);
    }
  }
}
