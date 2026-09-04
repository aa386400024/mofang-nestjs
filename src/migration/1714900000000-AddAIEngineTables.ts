import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-04 — 心塑 V6.0 §3 AI 引擎 5 张表 (audit P0-1 治本).
 *
 * 设计:
 *   - ai_profile_cache:    §3.1 7 维度画像单维度快照, (uid, dimension) 唯一.
 *   - ai_unlock_states:    §3.3 6 大高阶功能 + 4 维度评分 + composite_score.
 *   - ai_effect_records:   §3.4 短/中/长 3 维效果, cron 聚合 weekly/monthly.
 *   - crisis_events:       §11.2 三级风险响应审计, level 4 态 + 3 来源.
 *   - llm_conversations:   §3.5 对话会话, token 累计 + crisis 关联 + 商业化计费基础.
 *
 * 反双胞胎 (重要):
 *   - 不重复 ai-companion/chat-session.entity.ts (那是历史浏览, 摘要已生成),
 *     这里存实时流式会话 (§3.5 + §11.2 + §9 计费).
 *   - 不重复 dashboard 模块的 weekly / milestones 聚合 (那是从 practice_records /
 *     inner_world_fragment_logs 聚合, 不在 AI 引擎).
 *
 * 大厂做法:
 *   - 所有日期字段 datetime(6) 精度.
 *   - (uid, xxx) 复合索引覆盖常见查询 pattern.
 *   - JSON 字段全部 nullable, V2.0 占位为 null, V3 由 service 写入.
 *   - crisis_events.uid nullable 支撑匿名游客模式 (§11.2 不依赖登录).
 *   - llm_conversations.crisis_event_id 用 varchar(36) (不是 FK 约束, 因为
 *     crisis_events 可能跨用户清理; 上层 service 保证引用一致).
 */
export class AddAIEngineTables1714900000000 implements MigrationInterface {
  name = 'AddAIEngineTables1714900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. ai_profile_cache — §3.1 单维度画像快照
    await queryRunner.query(`
      CREATE TABLE \`ai_profile_cache\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`dimension\` enum('emotion','trait','habit','stage','tolerance','effect','gamification') NOT NULL,
        \`payload\` json NOT NULL,
        \`source\` enum('cloud','local','user_override') NOT NULL DEFAULT 'cloud',
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_ai_profile_uid_dim\` (\`uid\`, \`dimension\`),
        INDEX \`idx_ai_profile_uid_updated\` (\`uid\`, \`updated_at\`),
        CONSTRAINT \`FK_ai_profile_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. ai_unlock_states — §3.3 高阶功能解锁 + 4 维度评分
    await queryRunner.query(`
      CREATE TABLE \`ai_unlock_states\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`feature\` enum('inner_voice_coach','genome_reshape','life_script','embodied_deep','companion_tree','pet_cultivation') NOT NULL,
        \`state\` enum('locked','unlocking','unlocked','rolled_back') NOT NULL DEFAULT 'locked',
        \`score_need\` decimal(4,3) NOT NULL DEFAULT 0,
        \`score_usage\` decimal(4,3) NOT NULL DEFAULT 0,
        \`score_effect\` decimal(4,3) NOT NULL DEFAULT 0,
        \`score_readiness\` decimal(4,3) NOT NULL DEFAULT 0,
        \`composite_score\` decimal(4,3) NOT NULL DEFAULT 0,
        \`rollback_reason\` varchar(200) NULL,
        \`last_evaluated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_ai_unlock_uid_feature\` (\`uid\`, \`feature\`),
        INDEX \`idx_ai_unlock_state\` (\`state\`),
        CONSTRAINT \`FK_ai_unlock_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. ai_effect_records — §3.4 干预效果追踪
    await queryRunner.query(`
      CREATE TABLE \`ai_effect_records\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`tool_id\` varchar(64) NOT NULL,
        \`session_id\` varchar(64) NOT NULL,
        \`horizon\` enum('immediate','weekly','monthly') NOT NULL,
        \`intensity_before\` tinyint NULL,
        \`intensity_after\` tinyint NULL,
        \`mood_score\` decimal(3,2) NULL,
        \`weekly_delta\` decimal(4,3) NULL,
        \`monthly_delta\` decimal(4,3) NULL,
        \`gamification_engagement\` decimal(4,3) NULL,
        \`context\` json NULL,
        \`recorded_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_ai_effect_uid_recorded\` (\`uid\`, \`recorded_at\`),
        INDEX \`idx_ai_effect_uid_tool_recorded\` (\`uid\`, \`tool_id\`, \`recorded_at\`),
        INDEX \`idx_ai_effect_horizon\` (\`horizon\`),
        CONSTRAINT \`FK_ai_effect_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. crisis_events — §11.2 危机事件审计 (uid nullable 支撑匿名游客)
    await queryRunner.query(`
      CREATE TABLE \`crisis_events\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NULL,
        \`level\` enum('low','medium','high') NOT NULL,
        \`source\` enum('keyword','llm_classifier','user_report') NOT NULL,
        \`keywords\` json NOT NULL,
        \`context\` text NULL,
        \`suggested_resource\` varchar(500) NULL,
        \`conversation_id\` char(36) NULL,
        \`detected_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_crisis_uid_detected\` (\`uid\`, \`detected_at\`),
        INDEX \`idx_crisis_level_detected\` (\`level\`, \`detected_at\`),
        INDEX \`idx_crisis_source\` (\`source\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. llm_conversations — §3.5 实时流式会话 (审计 + token + crisis 关联)
    await queryRunner.query(`
      CREATE TABLE \`llm_conversations\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`tier\` enum('basic','rag','advanced') NOT NULL DEFAULT 'rag',
        \`provider_id\` varchar(32) NULL,
        \`model\` varchar(64) NULL,
        \`title\` varchar(80) NULL,
        \`prompt_tokens\` int NOT NULL DEFAULT 0,
        \`completion_tokens\` int NOT NULL DEFAULT 0,
        \`crisis_event_id\` char(36) NULL,
        \`started_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`ended_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_llm_conv_uid_started\` (\`uid\`, \`started_at\`),
        INDEX \`idx_llm_conv_tier\` (\`tier\`),
        CONSTRAINT \`FK_llm_conv_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`llm_conversations\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`crisis_events\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`ai_effect_records\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`ai_unlock_states\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`ai_profile_cache\`;`);
  }
}
