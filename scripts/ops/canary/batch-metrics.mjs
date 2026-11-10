/**
 * 自动对练批次指标汇总（只读）。
 *
 * 用法: node scripts/ops/canary/batch-metrics.mjs <batchId>
 * 需在仓库根执行（依赖 .env 与 node_modules）。
 *
 * 输出三段: 按状态汇总 / 批次合计 / 轮次最多的 8 场。
 *
 * 注意: 本表不查 `render_fallback_ratio` —— 该列属 WP-H 改动 6, 迁移落地前不存在,
 *      查了会抛 ER_BAD_FIELD_ERROR。
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const batchId = process.argv[2];
if (!batchId) {
  console.error('用法: node scripts/ops/canary/batch-metrics.mjs <batchId>');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [byStatus] = await conn.execute(
  `SELECT status, COUNT(*) AS n,
          SUM(CASE WHEN total_tokens > 0 THEN 1 ELSE 0 END) AS tok_gt0,
          ROUND(AVG(total_tokens), 1) AS avg_tok,
          ROUND(AVG(turn_count), 1) AS avg_turns,
          SUM(CASE WHEN degraded_turns > turn_count THEN 1 ELSE 0 END) AS over_deg
     FROM ap_practice_sessions WHERE batch_id = ? GROUP BY status`,
  [batchId],
);

console.log('--- 按状态汇总 ---');
for (const r of byStatus) {
  console.log(
    `  ${r.status.padEnd(14)} n=${String(r.n).padEnd(4)} tokens>0=${String(r.tok_gt0).padEnd(4)}` +
      ` avg_tokens=${r.avg_tok}  avg_turns=${r.avg_turns}  degraded>turns=${r.over_deg}`,
  );
}

const [total] = await conn.execute(
  `SELECT COUNT(*) AS n, SUM(total_tokens) AS sum_tok, SUM(turn_count) AS sum_turns,
          SUM(degraded_turns) AS sum_deg,
          SUM(CASE WHEN total_tokens = 0 THEN 1 ELSE 0 END) AS zero_tok,
          ROUND(SUM(total_cost_cny), 4) AS cost,
          MAX(prompt_tokens) AS max_prompt, GROUP_CONCAT(DISTINCT exit_reason) AS exits
     FROM ap_practice_sessions WHERE batch_id = ?`,
  [batchId],
);
console.log('--- 批次合计 ---');
console.log(' ', JSON.stringify(total[0]));

const [top] = await conn.execute(
  `SELECT character_slug, counselor_mode_id, status, turn_count, total_tokens,
          prompt_tokens, completion_tokens, degraded_turns, exit_reason, engine_version
     FROM ap_practice_sessions WHERE batch_id = ? ORDER BY turn_count DESC LIMIT 8`,
  [batchId],
);
console.log('--- 轮次最多的 8 场 ---');
for (const r of top) {
  console.log(
    `  ${r.character_slug.padEnd(30)} ${String(r.counselor_mode_id).padEnd(10)} ` +
      `${r.status.padEnd(12)} turns=${String(r.turn_count).padStart(2)} ` +
      `tok=${r.total_tokens}/p=${r.prompt_tokens}/c=${r.completion_tokens} ` +
      `deg=${r.degraded_turns} exit=${r.exit_reason} ver=${r.engine_version}`,
  );
}

await conn.end();
