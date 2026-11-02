// V2026-10-26 治本 (4 督导流派幂等播种 — supervision_schools):
//   原因: `supervision_schools` 表由 migration 1714900000006 建出来了, 但**从没播种过** ——
//     表是空的. 而 4 流派反馈是 vpt / 单次训练结束后的**技术统计唯一来源**
//     (流派那一次 LLM 调用一次同时产: 反馈 + techStats + 错误分类 + 成长建议).
//     后果链: 流派 job 反复报「督导流派 cbt 不存在」→ 重试 3 次仍失败 →
//     `training_sessions.tech_stats` 永远为空 → 复盘报告的技术统计永远是空的.
//   修法: 用 `INSERT ... ON DUPLICATE KEY UPDATE` (upsert) 幂等播种 4 流派, 按 `code`
//     的 UNIQUE 索引 (uniq_ss_code) 匹配 —— 存在则更新、不存在则插入, 重复执行不报错、
//     不堆重复行.
//
//   关键取舍: **内容直接 import `SUPERVISION_SCHOOL_PRESETS`, 不内联成 SQL 字面量**.
//     仓库的先例 `1714900000004-AddMicroInterventionScenarios` 把 7 个场景的内容内联进了
//     SQL —— 那次可以 (内容是纯静态展示文案), 但这里的内容是 4 份**临床 prompt 模板**
//     (每份 ~1KB 中文), 内联进 SQL 就是:
//       ① 手抄 → 改 TS 配置后 DB 里的旧副本不会跟着变 (内容漂移, 且 LLM 跑的是旧 prompt)
//       ② SQL 里塞多行中文 prompt → 引号 / 换行转义地狱
//     参数化 + import 是唯一能做到「零手抄 + 零漂移」的方式. upsert 语法则与仓库先例
//     (`VALUES(col)` 形式) 保持一致.
//
//   反双胞胎:
//     - 不写成 `bin/seed-*.ts` 独立脚本: 仓库既有惯例是内容走 seed 脚本, 但那是**手工步骤**
//       —— 本次的故障恰恰就是"建了表忘了播种", 再加一个手工步骤就是复发温床. seed 走
//       migration = 跟着部署流程走, 不可能漏.
//     - 不硬删回滚: `supervision_feedback.school_id` 引用着这 4 行, 硬删会让历史反馈的
//       流派引用悬空 → down 只软删 (deleted_at + is_active=0).
//     - 不在 up 里改 id: 已存在的行**原地更新**, 保住 school.id → 历史 feedback 的外键
//       引用不失效 (这也是不能用"删了重建"实现幂等的原因).
//     - 不改 1714900000006 (已执行过的迁移): 迁移只增不改.
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SELECT code, name, is_active FROM supervision_schools ORDER BY code; → 4 行
//     2. 再跑一次 npm run migration:run → 不报错, 行数仍为 4 (幂等)
//     3. SHOW CREATE TABLE supervision_schools → UNIQUE INDEX uniq_ss_code (code) 在
//   时间戳: 2026-10-26
import { MigrationInterface, QueryRunner } from 'typeorm';

import { SUPERVISION_SCHOOL_PRESETS } from '../counselor/config/supervision-school-presets';

export class SeedSupervisionSchools1714900000021 implements MigrationInterface {
  name = 'SeedSupervisionSchools1714900000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 逐流派 upsert (参数化: 内容不手抄, 改 TS preset 就跟着改).
    // 列名全部加反引号 (跟仓库既有 migration 风格一致, 防 MySQL 保留字冲突).
    for (const preset of Object.values(SUPERVISION_SCHOOL_PRESETS)) {
      await queryRunner.query(
        `INSERT INTO \`supervision_schools\`
          (\`id\`, \`code\`, \`name\`, \`focus_areas\`, \`example_feedback\`, \`prompt_template\`,
           \`is_active\`, \`created_at\`, \`updated_at\`, \`deleted_at\`)
         VALUES (UUID(), ?, ?, ?, ?, ?, 1, NOW(6), NOW(6), NULL)
         ON DUPLICATE KEY UPDATE
          \`name\`                = VALUES(\`name\`),
          \`focus_areas\`        = VALUES(\`focus_areas\`),
          \`example_feedback\`   = VALUES(\`example_feedback\`),
          \`prompt_template\`    = VALUES(\`prompt_template\`),
          \`is_active\`           = 1,
          \`deleted_at\`         = NULL,
          \`updated_at\`          = NOW(6)`,
        [preset.code, preset.name, JSON.stringify(preset.focusAreas), JSON.stringify(preset.exampleFeedback), preset.promptTemplate],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚: **软删**而不是硬删 —— supervision_feedback.school_id 引用着这 4 行,
    // 硬删会让历史反馈的流派引用指向不存在的行.
    const codes = Object.values(SUPERVISION_SCHOOL_PRESETS).map((preset) => preset.code);
    const placeholders = codes.map(() => '?').join(', ');
    await queryRunner.query(
      `UPDATE \`supervision_schools\`
         SET \`deleted_at\` = NOW(6), \`is_active\` = 0, \`updated_at\` = NOW(6)
       WHERE \`code\` IN (${placeholders})`,
      codes,
    );
  }
}
