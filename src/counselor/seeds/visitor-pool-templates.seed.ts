// V2026-10-23 治本 (AI 模拟来访池 — 公共模板内容库灌入, 幂等 upsert):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §6 要求「初始官方库」有确定内容,
//     但内容**不进 migration** —— 迁移一旦执行即冻结, 而官方人物库是会持续演进的
//     内容资产 (改一句主诉 / AI 重新生成 / 上下架). 故走项目既有内容治理 pattern:
//       内容基线 (config/visitor-pool-seed.ts) → 独立 seed 脚本 → 按稳定 id 幂等 upsert
//     运行时增补走 §3.5 内部 AI 生成端点, 二者**落同一张表**.
//
//   修法 (跟 training-exercises.seed.ts / practice-scenarios.seed.ts / quotes.seed.ts 同范式):
//     - 不存在 → INSERT
//     - 已存在且内容有变 → UPDATE (改主诉 / 改剧本 / 改默认值)
//     - 已存在且内容一致 → no-op (不产生无谓写, 避免 updated_at 抖动)
//
//   反双胞胎:
//     - 不用随机 UUID 做 id: id 是对外契约 (图鉴详情 / 实例化 / 收藏三条路径的参数),
//       必须内容方可复现.
//     - **不静默跳过内容漂移**: 有漂移就 UPDATE, 并在返回值里报出 updated 计数.
//     - **不写 source**: 案例来源由后端固定写 official (spec §3.5.1), 种子无权自称.
//     - **不写 trust_level / 任何计数字段**: 公共模板不挂信任度 (那是私有副本的演进状态),
//       也不挂计数 (零压红线).
//     - **不改 enabled**: 初始基线是**已上架**的官方库 (人工撰写 = 已过审);
//       只有 §3.5 的 AI 生成产物才默认落草稿. 种子反复执行不会把人偶下架.
//
//   验证:
//     1. npm run seed:visitor-pool → 输出 6 条; 连跑两次 → 第二次全部"未变"
//     2. SELECT id, enabled FROM visitor_pool_templates → 6 行, enabled 全为 1
//     3. 改某条 presentingComplaint 后重跑 seed → 该行被更新而非新增
//
//   时间戳: 2026-10-23
import type { DataSource } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_SEEDS, type VisitorPoolTemplateSeed } from '../config/visitor-pool-seed';
import { VisitorPoolTemplate } from '../entities/visitor-pool-template.entity';
import { VisitorPoolSource } from '../enums/visitor-pool.enum';

/**
 * 幂等灌入公共来访模板内容库.
 *
 * 语义与知识库同步任务 / 金句 seed 一致: 按**稳定 id** upsert.
 *
 * @param dataSource 应用 DataSource
 * @returns 统计结果, 供脚本输出与人工核对
 */
export async function seedVisitorPoolTemplates(dataSource: DataSource): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const repo = dataSource.getRepository(VisitorPoolTemplate);
  const seeds: readonly VisitorPoolTemplateSeed[] = VISITOR_POOL_TEMPLATE_SEEDS;

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
      // 保留 created_at, 仅更新内容字段 (enabled 不动 —— 种子不改变上架状态).
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
 */
function toEntityPayload(seed: VisitorPoolTemplateSeed) {
  return {
    codename: seed.codename,
    ageRange: seed.ageRange,
    presentingComplaint: seed.presentingComplaint,
    defenseType: seed.defenseType,
    issueDomain: seed.issueDomain,
    trainingGoal: seed.trainingGoal,
    difficulty: seed.difficulty,
    // source 由后端固定写 (spec §3.5.1: 不让生成方自称来源).
    source: VisitorPoolSource.OFFICIAL,
    styleHint: seed.styleHint,
    emotionBaselineDefault: seed.emotionBaselineDefault,
    defenseLevelDefault: seed.defenseLevelDefault,
    script: seed.script,
    sortOrder: seed.sortOrder,
    deletedAt: null,
  };
}

/**
 * 判定内容是否有漂移 (需要 UPDATE).
 *
 * 只比对**内容字段**, 不比对 updated_at (那是 DB 自己维护的), 也不比对 enabled
 * (上架状态归管理端管, 种子不该动它).
 */
function hasDrift(
  row: VisitorPoolTemplate,
  payload: {
    codename: string;
    ageRange: string;
    presentingComplaint: string;
    defenseType: string;
    issueDomain: string;
    trainingGoal: string;
    difficulty: string;
    source: string;
    styleHint: string;
    emotionBaselineDefault: number;
    defenseLevelDefault: number;
    script: unknown;
    sortOrder: number;
  },
): boolean {
  return (
    row.codename !== payload.codename ||
    row.ageRange !== payload.ageRange ||
    row.presentingComplaint !== payload.presentingComplaint ||
    row.defenseType !== payload.defenseType ||
    row.issueDomain !== payload.issueDomain ||
    row.trainingGoal !== payload.trainingGoal ||
    row.difficulty !== payload.difficulty ||
    row.source !== payload.source ||
    row.styleHint !== payload.styleHint ||
    row.emotionBaselineDefault !== payload.emotionBaselineDefault ||
    row.defenseLevelDefault !== payload.defenseLevelDefault ||
    row.sortOrder !== payload.sortOrder ||
    JSON.stringify(row.script) !== JSON.stringify(payload.script)
  );
}
