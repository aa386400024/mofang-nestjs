// V2026-10-27 治本 (来访池 — 公共人物绑定系统音色, visitor_pool_templates 加 voice_id):
//   原因: 6 位官方人物**共用 env 同一个音色** (`MINIMAX_TTS_VOICE_ID`) ——
//     `voice.gateway.ts#resolveVoiceId` 只认「握手 voiceId」, 模板级恒为空, 于是
//     学员听到的 6 个人物声线完全一样, 听不出人物差别.
//     `voice.service.ts#resolveSessionVoice` 的注释里早就预留了「模板绑定音色」位,
//     但表里没有列可存, 一直没接通.
//   修法: `visitor_pool_templates` 加 1 个**可空**列 `voice_id VARCHAR(64) NULL`.
//
//   设计 (跟 0019 同款手写 DDL 风格):
//     - **可空** = 未绑定回退 env 默认: 旧行零影响, 老库不需要回填
//     - 不加索引: 本列**不参与查询条件** (只在按 id 取模板时随行读出),
//       加索引是给"按音色筛模板"这种还不存在的需求提前买单
//     - 不加 DB-level FK 到音色表: 音色目录是**上游账号的运行时事实**
//       (`GET /counselor/voices?type=system` 拉取, 不在本库), FK 建不了;
//       可用性判定走应用层 `VoiceCatalogResolver.check()` (三态: available/unavailable/unknown)
//
//   反双胞胎:
//     - 不用 synchronize: true 自动建列: ADR-0003 已禁, 一切 schema 变更走 migration
//     - 不把音色写进 `script` json: script 是 7 大块人物内容快照 (公共接口绝不下发),
//       音色是**技术配置**, 混进去会让"人物内容"与"会话技术参数"两件事耦在一起
//     - 不加"音色名"列: 上游音色名会变, 只有 id 是稳定契约; 名字由目录代理实时查
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE visitor_pool_templates; # voice_id varchar(64) YES (可空)
//     2. 重复跑 migration:run → 不报错 (列已存在就跳过)
//     3. SELECT id, voice_id FROM visitor_pool_templates; # 老行全为 NULL
//
//   时间戳: 2026-10-27
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把 `QueryRunner.query()` 的 any 返回值收成"行数组".
 *
 * 原因: `query()` 的返回类型是 `Promise<any>`, 直接赋值给变量会触发
 *   `@typescript-eslint/no-unsafe-assignment`. 跟 0016 / 0018 / 0019 同款收口.
 */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * 取某列的当前类型 (大写, 如 "VARCHAR(64)"); 列不存在返回空串.
 *
 * @param qr 查询执行器
 * @param table 表名
 * @param column 列名
 */
async function readColumnType(qr: QueryRunner, table: string, column: string): Promise<string> {
  const rows = asRows(await qr.query(`SHOW COLUMNS FROM ${table} LIKE '${column}';`));
  const first = rows[0];
  const type = first && typeof first['Type'] === 'string' ? first['Type'] : '';
  return type.toUpperCase();
}

export class AddVisitorPoolTemplateVoiceId1714900000022 implements MigrationInterface {
  name = 'AddVisitorPoolTemplateVoiceId1714900000022';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 列已存在就跳过 (重复执行不报错, 也不做无谓的 ALTER).
    // MySQL 8.0 不支持 `ADD COLUMN IF NOT EXISTS`, 只能先查再改 (跟 0019 同款做法).
    const voiceIdType = await readColumnType(qr, 'visitor_pool_templates', 'voice_id');
    if (!voiceIdType) {
      await qr.query(`ALTER TABLE visitor_pool_templates ADD COLUMN voice_id VARCHAR(64) NULL;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 回滚: 删列 (幂等: 列不存在就跳过).
    const voiceIdType = await readColumnType(qr, 'visitor_pool_templates', 'voice_id');
    if (voiceIdType) {
      await qr.query(`ALTER TABLE visitor_pool_templates DROP COLUMN voice_id;`);
    }
  }
}
