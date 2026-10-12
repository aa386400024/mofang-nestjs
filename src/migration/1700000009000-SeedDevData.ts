// V2026-10-12 (Phase 8.5 — Dev seed / SPEC §0 + §3 A9 + §12.4):
//   V0.x dev seed: 3 admin 账户 (editor / reviewer / admin) + 5 KB 样例 (3 published +
//   1 review + 1 draft), 跟客户端 7.8 V0.x dev fallback 对齐, dev 跑通 RBAC 矩阵 +
//   列表 + 5 工作流 action + Analytics 4 KPI 验证.
//
//   大厂 spec (跟 src/database/seeds/ pattern):
//     - migration 形式 (跟 migration:run 一起, V0.x 简化不另起 bin/seed.ts)
//     - 用 bcryptjs 现场 hash 密码 (跟 user.service.ts 同 BCRYPT_ROUNDS=10)
//     - UUID 用 SQL 生成 (MySQL 8.0 UUID()), 跟现有 V2 风格一致
//     - 一次性 INSERT, 不写 update (idempotent 设计: V0.x dev 反复 migration:run
//       会重复插入, 接受; 真正 production 上线前用 truncate + re-seed)
//
//   治本:
//     - 不放真实 persona / case 内容 (V0.x 简化, 文本 placeholder; V1.x 接 RAG
//       索引时, 真 case 内容进 knowledge_chunks 表 + Qdrant)
//     - 密码统一 "dev" (跟 V0.x dev 体验对齐, V1.x 上线前必须改成随机密码
//       + 强制改密流程, 治本注释标 V1.x next-step)

import * as bcrypt from 'bcryptjs';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedDevData1700000009000 implements MigrationInterface {
  name = 'SeedDevData1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. 3 admin 账户 (V0.x dev 密码统一 "dev", 跟上线后必须改密) ───
    const passwordHash = await bcrypt.hash('dev', 10);
    const users = [
      { uid: '00000000-0000-0000-0000-00000000e001', email: 'editor@dev.local', adminRole: 'editor' },
      { uid: '00000000-0000-0000-0000-00000000e002', email: 'reviewer@dev.local', adminRole: 'reviewer' },
      { uid: '00000000-0000-0000-0000-00000000e003', email: 'admin@dev.local', adminRole: 'admin' },
    ];
    for (const u of users) {
      await queryRunner.query(
        `INSERT INTO \`users\` (
          \`uid\`, \`tenant_id\`, \`phone\`, \`email\`, \`password_hash\`, \`state\`,
          \`email_verified_at\`, \`phone_verified_at\`, \`failed_login_count\`,
          \`locked_until\`, \`password_changed_at\`, \`must_change_password\`,
          \`admin_role\`, \`created_at\`, \`updated_at\`, \`deleted_at\`
        ) VALUES (?, ?, NULL, ?, ?, 'active', NOW(6), NULL, 0, NULL, NOW(6), 0, ?, NOW(6), NOW(6), NULL)`,
        [u.uid, u.uid, u.email, passwordHash, u.adminRole],
      );
    }

    // ─── 2. 5 KB 样例 (3 published + 1 review + 1 draft) ───
    const items = [
      {
        id: '10000000-0000-0000-0000-00000000a001',
        tenantId: '00000000-0000-0000-0000-00000000e003', // 属 admin tenant
        type: 'case',
        title: '焦虑来访者: 失眠与紧张 (V0.x 样例)',
        contentBody:
          '来访者 L 是一位 28 岁的女性工程师, 近 3 个月因项目压力出现入睡困难, 凌晨 2-3 点易醒, 伴随心悸手抖. 求助意识强, 愿意尝试放松训练.',
        contentPreview: '来访者 L 是一位 28 岁的女性工程师, 近 3 个月因项目压力出现入睡困难...',
        metadata: {
          tags: ['焦虑', '失眠', 'CBT', '放松训练'],
          difficulty: 2,
          category: 'CBT 认知重构',
          personaId: 'anxious',
          searchKeywords: ['54321', '睡眠卫生'],
        },
        status: 'published',
        version: 1,
        authorId: '00000000-0000-0000-0000-00000000e001', // editor
        reviewerId: '00000000-0000-0000-0000-00000000e002', // reviewer
        publishedAt: '2026-10-01 10:00:00.000000',
      },
      {
        id: '10000000-0000-0000-0000-00000000a002',
        tenantId: '00000000-0000-0000-0000-00000000e003',
        type: 'standard',
        title: 'CBT 认知重构: 5 步法 (V0.x 样例)',
        contentBody:
          '认知行为治疗 (CBT) 经典 5 步法: 1) 识别自动思维 2) 评估证据 3) 识别认知歪曲 4) 替代性解释 5) 行为实验验证. 适用于焦虑 / 抑郁来访者的核心干预技术.',
        contentPreview: '认知行为治疗 (CBT) 经典 5 步法: 1) 识别自动思维 2) 评估证据 3) 识别认知歪曲...',
        metadata: {
          tags: ['CBT', '认知重构', '技术', '标准'],
          difficulty: 3,
          category: 'CBT 认知重构',
          personaId: null,
          searchKeywords: ['自动思维', '认知歪曲'],
        },
        status: 'published',
        version: 1,
        authorId: '00000000-0000-0000-0000-00000000e001',
        reviewerId: '00000000-0000-0000-0000-00000000e002',
        publishedAt: '2026-10-02 10:00:00.000000',
      },
      {
        id: '10000000-0000-0000-0000-00000000a003',
        tenantId: '00000000-0000-0000-0000-00000000e003',
        type: 'knowledge',
        title: '正念呼吸入门: 4-7-8 呼吸法 (V0.x 样例)',
        contentBody:
          '4-7-8 呼吸法源自美国整合医学家 Andrew Weil, 步骤: 闭嘴用鼻吸气 4 秒, 屏息 7 秒, 缓慢用口呼气 8 秒. 重复 4 轮. 适用于急性焦虑发作的快速镇静.',
        contentPreview: '4-7-8 呼吸法源自美国整合医学家 Andrew Weil, 步骤: 闭嘴用鼻吸气 4 秒...',
        metadata: {
          tags: ['正念', '呼吸', '急性焦虑', '工具'],
          difficulty: 1,
          category: 'ACT 接纳',
          personaId: null,
          searchKeywords: ['4-7-8', '呼吸法'],
        },
        status: 'published',
        version: 1,
        authorId: '00000000-0000-0000-0000-00000000e001',
        reviewerId: '00000000-0000-0000-0000-00000000e002',
        publishedAt: '2026-10-03 10:00:00.000000',
      },
      {
        id: '10000000-0000-0000-0000-00000000a004',
        tenantId: '00000000-0000-0000-0000-00000000e003',
        type: 'enterprise',
        title: 'B 端定制: 员工 EAP 危机干预流程 (V0.x 样例, 待审)',
        contentBody:
          '企业 EAP 危机干预 5 步流程: 1) 初步风险评估 2) 安全计划制定 3) 资源链接 (24h 热线) 4) 短期随访 5) 长期转介. 适用于高风险员工.',
        contentPreview: '企业 EAP 危机干预 5 步流程: 1) 初步风险评估 2) 安全计划制定 3) 资源链接...',
        metadata: {
          tags: ['EAP', '危机干预', '企业', 'B 端'],
          difficulty: 3,
          category: '危机干预',
          personaId: 'crisis',
          searchKeywords: ['EAP', '危机'],
        },
        status: 'review',
        version: 1,
        authorId: '00000000-0000-0000-0000-00000000e001',
        reviewerId: null,
        publishedAt: null,
      },
      {
        id: '10000000-0000-0000-0000-00000000a005',
        tenantId: '00000000-0000-0000-0000-00000000e003',
        type: 'case',
        title: '抑郁来访者: 大三女生 (V0.x 样例, 草稿)',
        contentBody:
          '来访者 W 是 21 岁的女生, 大三, 近 2 个月情绪低落, 兴趣减退, 睡眠早醒, 自我评价低 ("我什么都做不好"). 想过不活了但没具体计划. 求助意识弱, 由室友陪同.',
        contentPreview: '来访者 W 是 21 岁的女生, 大三, 近 2 个月情绪低落...',
        metadata: {
          tags: ['抑郁', '大学生', '自杀风险', '低求助动机'],
          difficulty: 3,
          category: 'CBT 认知重构',
          personaId: 'depressed',
          searchKeywords: ['抑郁', '大学生'],
        },
        status: 'draft',
        version: 1,
        authorId: '00000000-0000-0000-0000-00000000e001',
        reviewerId: null,
        publishedAt: null,
      },
    ];
    for (const it of items) {
      await queryRunner.query(
        `INSERT INTO \`knowledge_items\` (
          \`id\`, \`tenant_id\`, \`type\`, \`title\`, \`content\`, \`metadata\`,
          \`status\`, \`version\`, \`author_id\`, \`reviewer_id\`,
          \`published_at\`, \`scheduled_publish_at\`, \`created_at\`, \`updated_at\`
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(6), NOW(6))`,
        [
          it.id,
          it.tenantId,
          it.type,
          it.title,
          JSON.stringify({ format: 'doc', body: it.contentBody, preview: it.contentPreview }),
          JSON.stringify(it.metadata),
          it.status,
          it.version,
          it.authorId,
          it.reviewerId,
          it.publishedAt,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // V0.x dev seed 反向: 删 seed 出来的 3 user + 5 KB, 留表结构 (其他 migration 负责).
    await queryRunner.query(`DELETE FROM \`knowledge_items\` WHERE \`id\` LIKE '10000000-0000-0000-0000-00000000a00%';`);
    await queryRunner.query(`DELETE FROM \`users\` WHERE \`uid\` LIKE '00000000-0000-0000-0000-00000000e00%';`);
  }
}
