/**
 * 批次逐场时间轴（只读）。
 *
 * 用法: node scripts/ops/canary/session-timeline.mjs <batchId>
 *
 * 用途: 一眼看出"从第几场开始崩"。正常场次耗时 30~60 秒且 token>0;
 *      崩塌场次 1~3 秒结束且 token=0 —— 说明整场没有一次真实上游调用。
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const batchId = process.argv[2];
if (!batchId) {
  console.error('用法: node scripts/ops/canary/session-timeline.mjs <batchId>');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [rows] = await conn.execute(
  `SELECT character_slug, counselor_mode_id, status, turn_count, total_tokens,
          degraded_turns, exit_reason,
          DATE_FORMAT(created_at, '%H:%i:%s') AS c,
          DATE_FORMAT(updated_at, '%H:%i:%s') AS u
     FROM ap_practice_sessions WHERE batch_id = ? ORDER BY created_at`,
  [batchId],
);

console.log('  开始      结束      角色                          模式    轮   token   deg  退出原因');
for (const r of rows) {
  console.log(
    `  ${r.c.padEnd(10)}${r.u.padEnd(10)}${r.character_slug.padEnd(30)}` +
      `${String(r.counselor_mode_id).padEnd(8)}${String(r.turn_count).padStart(3)}` +
      `${String(r.total_tokens).padStart(8)}${String(r.degraded_turns).padStart(6)}  ${r.exit_reason}`,
  );
}

const broken = rows.filter((r) => Number(r.turn_count) >= 10 && Number(r.total_tokens) === 0);
console.log('');
console.log(`  合计 ${rows.length} 场；跑满 10 轮但 token=0 的场次 = ${broken.length}（疑似整场未调用上游）`);

await conn.end();
