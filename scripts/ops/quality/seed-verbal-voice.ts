// V2026-11-10 一次性脚本 (WP-J · verbal_voice 文案落库):
//   职责: 把 8 个角色的"说话味道"文案 UPDATE 到 character_profiles.verbal_voice 列.
//   为什么是一次性脚本而不是改 seed:
//     · 当前 MiniMax 正在改 engine-adapters / practice-runner / audit 脚本, 改 seed 文件会撞车
//     · 文案是初稿, 还没经过大炮审, 先落库跑一批对练看效果, 定稿后再写回 seed
//     · 等 MiniMax 交付 + 文案定稿后, 再把这 8 条搬进 character-profile.seed.ts
//
//   用法:
//     npx tsx scripts/ops/quality/seed-verbal-voice.ts
//
//   幂等: 跑两次结果一样 (UPDATE 同值不产生漂移).
//   安全: 只 UPDATE verbal_voice 一列, 不碰 enabled / audit_status / 其他任何字段.

import 'dotenv/config';

import mysql from 'mysql2/promise';

/**
 * 8 角色 verbal_voice 文案 (初稿, 待审).
 *
 * 文案来源: docs/worklog/pending/phase2.5-verbal-voice-drafts-2026-11-10.md
 * 长度控制: 每条 ≤120 字 (varchar 500 上限, 一行渲染"你说话的味道：xxx").
 * 原则: 不跟已有的 narrative_style / expression_tone / attachment_behavior 重复,
 *       补充的是更细的句式习惯 / 口头禅 / 节奏 / 语气质感.
 */
const VERBAL_VOICE_SEEDS: readonly { readonly slug: string; readonly voice: string }[] = [
  {
    slug: 'vpt_general_secure_l1',
    voice: '说话自然直接，不绕弯。会用"我觉得"、"其实吧"开头，不把自己当受害者。说到压力时会停顿一下，但说完就过了，不反复咀嚼。语气放松，偶尔带点自嘲。',
  },
  {
    slug: 'vpt_social_anxious_l1',
    voice: '说话前会犹豫，常用"就是…那个…"、"可能吧"填充。刚说完一句话会立刻修正——"我不是那个意思，我是说…"。怕说错，观点刚出口就往回收。声音偏小，语速偏快。',
  },
  {
    slug: 'vpt_intimate_avoidance_l1',
    voice: '说话柔和，常说"没事"、"我都行"、"你决定就好"。说到委屈时不直接说生气，而是绕着场景讲——"那天他回来得晚，我就一个人吃了饭"。会快速把话题拉回对方："你呢，你最近怎么样？"',
  },
  {
    slug: 'vpt_self_worth_intellectualization_l1',
    voice: '习惯用"我分析"、"客观来讲"开头。描述自己时像在写绩效自评——"这个事我其实还有提升空间"。被夸会立刻说"没有没有，差得远"。不直接说"我慌"，会说"效率有点波动"。',
  },
  {
    slug: 'vpt_depression_avoidant_l1',
    voice: '句子短，停顿多。"不知道"、"没什么"、"就那样"是高频回答。语速慢，声音平，没有起伏。问到感受会答"还好"，然后沉默。不会主动展开任何话题。',
  },
  {
    slug: 'vpt_grief_avoidance_l1',
    voice: '说话像在汇报日常——"早上送了孩子，中午开了会，晚上煮了面"。条理清楚，不带情绪。问到伴侣会停一下，然后说"都过去了"。用"还好"开场每一句话。不会主动提那个人的名字。',
  },
  {
    slug: 'vpt_workplace_intellectualization_l1',
    voice: '被问感受会自动切到"问题清单"——"这个事主要分三块"。用"我理解"、"从逻辑上讲"代替"我觉得"。不说"我难受"，说"这个状态影响了产出"。偶尔自嘲但立刻收住。',
  },
  {
    slug: 'vpt_trauma_disorganized_l1',
    voice: '说话前后矛盾——刚说"我没事"突然又说"那晚走廊的声音…"然后戛然而止。会突然换话题。有时语速很快像倒豆子，有时像失忆一样接不上。偶尔会问"我刚才说到哪了？"',
  },
];

async function main(): Promise<void> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST ?? '117.72.30.78',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'mofang',
    password: process.env.DB_PASSWORD ?? 'mofang_dev_pwd',
    database: process.env.DB_NAME ?? 'mofang_dev',
  });

  try {
    console.log('=== verbal_voice 文案落库 ===\n');

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const seed of VERBAL_VOICE_SEEDS) {
      // 先查这条在不在库里
      const [rows] = await conn.query(
        'SELECT template_id, display_name, verbal_voice FROM character_profiles WHERE template_id = ?',
        [seed.slug],
      );
      const existing = rows as Array<{ template_id: string; display_name: string; verbal_voice: string | null }>;

      if (existing.length === 0) {
        console.log(`❌ ${seed.slug} —— 库里没有这个角色`);
        notFound += 1;
        continue;
      }

      const row = existing[0];
      if (row.verbal_voice === seed.voice) {
        console.log(`⏭️  ${row.display_name} (${seed.slug}) —— 已是目标值，跳过`);
        skipped += 1;
        continue;
      }

      await conn.query(
        'UPDATE character_profiles SET verbal_voice = ? WHERE template_id = ?',
        [seed.voice, seed.slug],
      );
      const prev = row.verbal_voice === null ? 'NULL' : `"${row.verbal_voice.slice(0, 20)}…"`;
      console.log(`✅ ${row.display_name} (${seed.slug}) —— 已更新（原值 ${prev}）`);
      updated += 1;
    }

    console.log(`\n=== 完成 ===`);
    console.log(`更新: ${updated} | 跳过(已是目标值): ${skipped} | 未找到: ${notFound} | 总计: ${VERBAL_VOICE_SEEDS.length}`);

    // 落库后校验：8 个角色的 verbal_voice 都不是 NULL
    console.log(`\n=== 校验：8 角色 verbal_voice 非 NULL 计数 ===`);
    const [verify] = await conn.query(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN verbal_voice IS NOT NULL AND verbal_voice != '' THEN 1 ELSE 0 END) AS filled
       FROM character_profiles
       WHERE template_id IN (?)`,
      [VERBAL_VOICE_SEEDS.map((s) => s.slug)],
    );
    const v = verify as Array<{ total: number; filled: number }>;
    console.log(`总计 ${v[0].total} 个角色，已填 ${v[0].filled} 个`);
    if (v[0].total !== v[0].filled) {
      console.warn(`⚠️  还有 ${v[0].total - v[0].filled} 个角色 verbal_voice 为 NULL，请检查上方"未找到"列表`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('落库失败:', error);
  process.exit(1);
});
