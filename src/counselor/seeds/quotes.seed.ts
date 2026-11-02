// V2026-10-22 治本 (首页金句 · 内容库灌入 — 幂等 upsert):
//   原因: spec `home-quote-backend-api.md` §1 说「内容来自前端 `localQuotes` 种子,
//     按天轮换; 远端就绪后**只换数据源, UI 不动**」—— 即内容的所有权从客户端
//     迁到服务端. 而金句是**会持续演进的内容** (运营改文案/加条目/换背景图),
//     不是一次性结构变更, 故走项目既有内容治理 pattern:
//       内容基线 (config/quote-seeds.ts) → 独立 seed 脚本 → 按稳定 id 幂等 upsert
//     而不是灌进 migration (migration 一旦执行即冻结, 改一句文案就要加一条
//     migration, 迁移历史会被业务内容淹没).
//
//   修法 (跟 training-exercises.seed.ts / practice-scenarios.seed.ts 同 pattern):
//     - 不存在 → INSERT
//     - 已存在且内容有变 → UPDATE (改文案/换背景图/改署名)
//     - 已存在且内容一致 → no-op (不产生无谓写, 避免 updated_at 抖动)
//
//   反双胞胎:
//     - 不用 migration 灌内容: 见上
//     - 不用随机 UUID 做 id: id 是对外契约 (游标 + 收藏路径参数), 必须内容方可复现
//     - 不静默跳过内容漂移: 有漂移就 UPDATE, 并在返回值里报出 updated 计数
//
//   验证:
//     1. npm run seed:quotes → 输出 16 条, 连续执行两次不产生重复行 (幂等)
//     2. SELECT id, published_at FROM quotes → 16 行, id 形如 q_20261022_xxx
//     3. 改某条 text 后重跑 seed → 该行被更新而非新增
//
//   时间戳: 2026-10-22
import type { DataSource } from 'typeorm';

import { PRACTICE_SYSTEM_TENANT_ID } from '../config/practice-display-meta';
import { QUOTE_SEEDS, type QuoteSeed } from '../config/quote-seeds';
import { Quote } from '../entities/quote.entity';

/**
 * 幂等灌入金句内容库.
 *
 * 语义与知识库同步任务保持一致: 按**稳定 id** upsert.
 *
 * @param dataSource 应用 DataSource
 * @param backgroundUrlBuilder 背景图完整地址组装器 (CDN base 由调用方从 env 注入)
 * @returns 统计结果, 供脚本输出与人工核对
 */
export async function seedQuotes(
  dataSource: DataSource,
  backgroundUrlBuilder: (assetFileName: string) => string,
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const repo = dataSource.getRepository(Quote);
  const seeds: (QuoteSeed & { backgroundUrl: string })[] = QUOTE_SEEDS.map((seed) => ({
    ...seed,
    backgroundUrl: backgroundUrlBuilder(seed.backgroundAsset),
  }));

  const existing = await repo.find({ where: seeds.map((seed) => ({ id: seed.id })) });
  const existingById = new Map(existing.map((row) => [row.id, row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seed of seeds) {
    const row = existingById.get(seed.id);
    const payload = toEntityPayload(seed);

    if (!row) {
      await repo.insert({ ...payload, id: seed.id });
      inserted += 1;
      continue;
    }

    if (hasDrift(row, payload)) {
      // 保留 created_at, 仅更新内容字段
      await repo.update(row.id, payload);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { inserted, updated, unchanged };
}

/**
 * seed → entity payload.
 *
 * `publishedAt` 用 `new Date('YYYY-MM-DD')` 解析: 该形式按 **UTC** 零点解释,
 * 与后续 `toISOString()` 输出保持一致 (例: '2026-10-22' → '2026-10-22T00:00:00.000Z'),
 * 不会出现"存进去是 08:00 凌晨"的时区漂移.
 */
function toEntityPayload(seed: QuoteSeed & { backgroundUrl: string }) {
  return {
    tenantId: PRACTICE_SYSTEM_TENANT_ID,
    userId: null,
    text: seed.text,
    author: seed.author,
    sourceWork: seed.sourceWork,
    category: seed.category,
    backgroundUrl: seed.backgroundUrl,
    publishedAt: new Date(`${seed.publishedAt}T00:00:00.000Z`),
    enabled: true,
    deletedAt: null,
  };
}

/**
 * 判定内容是否有漂移 (需要 UPDATE).
 *
 * 只比对**内容字段**, 不比对 updated_at (那是 DB 自己维护的).
 */
function hasDrift(
  row: Quote,
  payload: {
    text: string;
    author: string;
    sourceWork: string | null;
    category: string;
    backgroundUrl: string;
    publishedAt: Date;
    enabled: boolean;
  },
): boolean {
  return (
    row.text !== payload.text ||
    row.author !== payload.author ||
    row.sourceWork !== payload.sourceWork ||
    row.category !== payload.category ||
    row.backgroundUrl !== payload.backgroundUrl ||
    row.publishedAt.getTime() !== payload.publishedAt.getTime() ||
    row.enabled !== payload.enabled
  );
}
