/**
 * 逐字稿文本审计（只读）—— 兜底句命中率 / 话术重复率 / TOP 高频话术。
 *
 * 用法: node scripts/ops/canary/transcript-audit.mjs <batchId1> [batchId2 ...]
 *
 * 为什么不只看数据库: `degraded_turns` 存在双计数缺陷（WP-H 改动 5 未落地）,
 * 单看计数器会误判。文本层是用户可感知的真相。
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';

const batches = process.argv.slice(2);
if (batches.length === 0) {
  console.error('用法: node scripts/ops/canary/transcript-audit.mjs <batchId1> [batchId2 ...]');
  process.exit(1);
}

const DIR = path.resolve('data/debug-sessions');

/** 与 src/engine-adapters/rendering/render-adapter.config.ts 的默认兜底池保持一致。 */
const VISITOR_FALLBACKS = [
  '……我先缓一下，我们接着说。',
  '嗯……让我想想，该怎么说。',
  '最近确实有点难说出口……我们慢慢聊吧。',
  '我不太想现在讲清楚，能先聊点别的吗？',
];
/** 与 src/auto-practice/counselor-agent.service.ts 的 FALLBACK_REPLY 保持一致。 */
const COUNSELOR_FALLBACK = '嗯，我在听。你可以接着说。';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

for (const batchId of batches) {
  const [rows] = await conn.execute(
    'SELECT debug_session_id FROM ap_practice_sessions WHERE batch_id = ?',
    [batchId],
  );

  let filesRead = 0;
  let visitorMsgs = 0;
  let counselorMsgs = 0;
  let visitorFallbackHits = 0;
  let counselorFallbackHits = 0;
  const visitorTexts = new Map();

  for (const r of rows) {
    const file = path.join(DIR, `${r.debug_session_id}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    filesRead += 1;
    for (const m of data.messages ?? []) {
      const text = String(m.text ?? '').trim();
      if (m.role === 'visitor') {
        visitorMsgs += 1;
        visitorTexts.set(text, (visitorTexts.get(text) ?? 0) + 1);
        if (VISITOR_FALLBACKS.some((p) => text.includes(p))) visitorFallbackHits += 1;
      } else if (m.role === 'counselor') {
        counselorMsgs += 1;
        if (text.includes(COUNSELOR_FALLBACK)) counselorFallbackHits += 1;
      }
    }
  }

  const pct = (a, b) => `${((a / Math.max(b, 1)) * 100).toFixed(1)}%`;
  const uniq = visitorTexts.size;
  const top = [...visitorTexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  console.log(`\n================ batch ${batchId} ================`);
  console.log(`  会话 ${rows.length} 份，读到逐字稿 ${filesRead} 份`);
  console.log(`  来访者消息 ${visitorMsgs} 条，咨询师消息 ${counselorMsgs} 条`);
  console.log(`  来访兜底句 ${visitorFallbackHits} 条 → 占来访消息 ${pct(visitorFallbackHits, visitorMsgs)}`);
  console.log(`  咨询师兜底句 ${counselorFallbackHits} 条 → 占咨询师消息 ${pct(counselorFallbackHits, counselorMsgs)}`);
  console.log(`  来访唯一话术 ${uniq} / ${visitorMsgs} → 重复率 ${(100 - (uniq / Math.max(visitorMsgs, 1)) * 100).toFixed(1)}%`);
  console.log('  TOP5 高频来访话术:');
  for (const [t, n] of top) console.log(`    ${String(n).padStart(3)}× ${t.slice(0, 44)}`);
}

await conn.end();
