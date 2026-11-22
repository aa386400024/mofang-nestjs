// V2026-11-08 治本 (Phase2.5 WP-D · 咨询师模式幂等播种):
//   职责: 把 COUNSELOR_MODE_SEEDS 按 id upsert 进 ap_counselor_modes.
//   幂等: 连跑两次, 第二次全是 unchanged.

import type { DataSource, Repository } from 'typeorm';

import { COUNSELOR_MODE_SEEDS } from './counselor-modes.seed.js';
import { CounselorMode } from '../entities/counselor-mode.entity.js';

/** 播种结果. */
export interface SeedResult {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
}

/**
 * 幂等 upsert 7 种咨询师模式.
 *
 * @param dataSource TypeORM DataSource
 * @returns 新增/更新/未变计数
 */
export async function seedCounselorModes(dataSource: DataSource): Promise<SeedResult> {
  const repo: Repository<CounselorMode> = dataSource.getRepository(CounselorMode);
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seed of COUNSELOR_MODE_SEEDS) {
    const existing = await repo.findOne({ where: { id: seed.id } });
    if (!existing) {
      await repo.save(
        repo.create({
          id: seed.id,
          name: seed.name,
          systemPrompt: seed.systemPrompt,
          description: seed.description,
          enabled: 1,
          sortOrder: seed.sortOrder,
        }),
      );
      inserted += 1;
      continue;
    }
    // 只覆盖我们管的字段 (name / systemPrompt / description / sortOrder),
    // 不动 enabled (admin 后台可能手动关过某个模式).
    const changed =
      existing.name !== seed.name ||
      existing.systemPrompt !== seed.systemPrompt ||
      existing.description !== seed.description ||
      existing.sortOrder !== seed.sortOrder;
    if (changed) {
      await repo.update(seed.id, {
        name: seed.name,
        systemPrompt: seed.systemPrompt,
        description: seed.description,
        sortOrder: seed.sortOrder,
      });
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  return { inserted, updated, unchanged };
}
