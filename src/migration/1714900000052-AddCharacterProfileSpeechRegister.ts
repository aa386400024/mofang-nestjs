// AF-462: character_profiles 加 speech_register 列 (结构化语域指纹).
//   JSON 可空; NULL = 未标定 = 不渲染 (零回归). 语域属于渲染层, 不进内核决策.
import { MigrationInterface, QueryRunner } from 'typeorm';

async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'character_profiles'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddCharacterProfileSpeechRegister1714900000052 implements MigrationInterface {
  name = 'AddCharacterProfileSpeechRegister1714900000052';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (!present.has('speech_register')) {
      await qr.query(`ALTER TABLE character_profiles ADD COLUMN speech_register JSON NULL AFTER verbal_voice;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (present.has('speech_register')) {
      await qr.query(`ALTER TABLE character_profiles DROP COLUMN speech_register;`);
    }
  }
}
