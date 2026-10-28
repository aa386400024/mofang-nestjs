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
import { IsNull, type DataSource } from 'typeorm';

import { isAcceptableCodename, resolveCompliantCodename } from '../config/visitor-pool-codename';
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
 * 幂等订正历史脏代号 (V2026-10-27, spec 任务 D2).
 *
 * 为什么要单独做一遍:
 *   6 位官方人物的代号由 seed 基线保证合规, 但库里还有**历史 AI 生成行**
 *   (§3.5 生成端点) —— 它们的代号可能带旧版系统前缀 (「来访者·X」) 或其它违规形态,
 *   而 seed 的 upsert 只覆盖那 6 条, 碰不到它们.
 *
 * 幂等性:
 *   - 合规行 → `resolveCompliantCodename` 返回 null → **不改写** (跑两次结果一致)
 *   - 修正过的行 → 变成合规 → 下次跑同样返回 null → 不重复写
 *
 * 确定性: 按 id 排序后逐条修正, 且 `composeCodename(taken)` 对同一 taken 集合可重放 ——
 *   同样的库内容, 两次订正得到同样的结果 (可审计).
 *
 * @param dataSource 应用 DataSource
 * @returns 扫描数 / 修正数
 */
export async function correctVisitorPoolCodenames(dataSource: DataSource): Promise<{ scanned: number; corrected: number }> {
  const repo = dataSource.getRepository(VisitorPoolTemplate);
  const rows = await repo.find({ where: { deletedAt: IsNull() } });
  // 已占用的**合规**代号 (脏行本身不算占用 —— 它们马上就要被改掉).
  const taken = new Set<string>();
  for (const row of rows) {
    if (isAcceptableCodename(row.codename)) {
      taken.add(row.codename);
    }
  }
  let corrected = 0;
  // 按 id 排序 → 修正顺序确定 (可重放 / 可审计).
  // 用 toSorted 而不是 sort: sort 会**就地改** rows 的顺序, 而 rows 后面还要用;
  // toSorted 返回新数组 (ES2023, Node ≥20 / 本仓 engines >=24).
  const ordered = rows.toSorted((a, b) => a.id.localeCompare(b.id));
  for (const row of ordered) {
    const next = resolveCompliantCodename(row.codename, taken);
    if (next === null) {
      continue;
    }
    taken.add(next);
    await repo.update(row.id, { codename: next });
    corrected += 1;
  }
  return { scanned: rows.length, corrected };
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
    // V2026-10-27 治本 (来访池 — 公共人物绑定系统音色):
    //   null = 未绑定 (回退 env 默认). 这里必须显式带上, 否则改了 seed 的音色不会触发 UPDATE.
    voiceId: seed.voiceId ?? null,
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
    voiceId: string | null;
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
    // V2026-10-27 治本 (公共人物绑定系统音色): 音色也参与漂移判定 ——
    //   否则改了 seed 的音色不会触发 UPDATE, 库里留着旧音色.
    row.voiceId !== payload.voiceId ||
    JSON.stringify(row.script) !== JSON.stringify(payload.script)
  );
}
