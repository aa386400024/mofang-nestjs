// AF-462: visitor_full_personas 加 speech 列 (长程人设的语域指纹).
//   JSON 可空; NULL = 未标定 = 旧链路不渲染 (零回归). 语域属于渲染层, 不进内核决策.
import { MigrationInterface, QueryRunner } from 'typeorm';

async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visitor_full_personas'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddVisitorFullPersonaSpeech1714900000053 implements MigrationInterface {
  name = 'AddVisitorFullPersonaSpeech1714900000053';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (!present.has('speech')) {
      await qr.query(`ALTER TABLE visitor_full_personas ADD COLUMN speech JSON NULL AFTER presenting_issue;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (present.has('speech')) {
      await qr.query(`ALTER TABLE visitor_full_personas DROP COLUMN speech;`);
    }
  }
}
