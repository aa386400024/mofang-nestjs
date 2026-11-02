// V2026-10-22 治本 (V1.3 §2.1 / §6.3 — 场景变体内容库幂等 seed):
//   原因: spec §6.3 硬约束「内容库 seed 走独立脚本按 scenario_key upsert, 不进
//     migration」. 理由与 training-exercises.seed.ts 同源: 场景内容是会持续演进的
//     **内容**, 不是一次性结构变更 —— 若灌进 migration, 改一句参考回应就要加一条
//     migration, 迁移历史被业务内容淹没, 且 migration 只跑一次, 内容无法幂等重灌.
//   修法: 按 scenario_key 幂等 upsert:
//     - 不存在 → INSERT
//     - 已存在且内容有变 → UPDATE (修正文案/难度/rubric)
//     - 已存在且内容一致 → no-op (不产生无谓写, 避免 updated_at 抖动)
//   反双胞胎:
//     - 不用 migration 灌内容: 见上
//     - 不在 service 里兜底灌内容: 那等于把内容又绑回应用二进制 (V2026-10-20 治本
//       已在 training-exercise.service.ts 定过这条规矩)
//     - 不用 INSERT ... ON DUPLICATE KEY: 那样会把"内容有变"和"内容没变"混成
//       一次写, updated_at 永远在抖, "这条内容何时被改过"失去参考价值
//     - 不在灌库前跳过自检: 内容错了必须在**灌库之前**炸掉, 而不是灌进库再让
//       线上用户碰到 (自检见 practice-scenario-seeds.ts)
//   验证:
//     1. npm run seed:practice → 新增 60 / 更新 0 / 未变 0
//     2. 再跑一次 → 新增 0 / 更新 0 / 未变 60 (幂等)
//     3. 改某条 referenceResponse 后重跑 → 该行被更新而非新增
//     4. 改坏某条 scenarioKey (重复) → 灌库前自检报错, 不写库
//   时间戳: 2026-10-22
import type { DataSource } from 'typeorm';

import { PRACTICE_SYSTEM_TENANT_ID } from '../config/practice-display-meta';
import { PRACTICE_SCENARIO_SEEDS, validatePracticeScenarioSeeds } from '../config/practice-scenario-seeds';
import type { PracticeScenarioSeed } from '../domain/practice/practice-seed.types';
import { PracticeScenario } from '../entities/practice-scenario.entity';

/**
 * 场景 seed 执行结果.
 */
export interface PracticeScenarioSeedResult {
  /** 新增条数 */
  inserted: number;
  /** 更新条数 */
  updated: number;
  /** 未变条数 */
  unchanged: number;
}

/**
 * 幂等灌入场景变体内容库.
 *
 * 语义与知识库同步任务保持一致: 按**稳定 scenario_key** upsert.
 * scenario_key 必须是可复现的稳定串, 否则知识库无法做幂等同步.
 *
 * @param dataSource 应用 DataSource
 * @returns 统计结果, 供脚本输出与人工核对
 * @throws Error 内容库自检不通过 (在写库之前抛出)
 */
export async function seedPracticeScenarios(dataSource: DataSource): Promise<PracticeScenarioSeedResult> {
  // 灌库前自检: 条数 / 唯一性 / 难度分布 / 引擎字段匹配.
  const validation = validatePracticeScenarioSeeds();
  if (!validation.valid) {
    throw new Error(`场景内容库自检未通过, 已中止灌库 (共 ${validation.errors.length} 项问题):\n- ${validation.errors.join('\n- ')}`);
  }

  const repo = dataSource.getRepository(PracticeScenario);
  const seeds = PRACTICE_SCENARIO_SEEDS;

  const existing = await repo.find({ where: seeds.map((seed) => ({ scenarioKey: seed.scenarioKey })) });
  const existingByKey = new Map(existing.map((row) => [row.scenarioKey, row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seed of seeds) {
    const row = existingByKey.get(seed.scenarioKey);
    const payload = toEntityPayload(seed);

    if (!row) {
      await repo.insert(payload);
      inserted++;
      continue;
    }

    if (hasDrift(row, payload)) {
      // 保留 created_at, 仅更新内容字段
      await repo.update({ scenarioKey: seed.scenarioKey }, payload);
      updated++;
    } else {
      unchanged++;
    }
  }

  return { inserted, updated, unchanged };
}

/**
 * 内容 → entity 字段映射.
 *
 * 全局内容库的行: user_id = NULL (共享), tenant_id = 系统租户哨兵值,
 * is_ai_generated = 0 (手工题库), enabled = 1 (共享内容的审核闸门 —— AI 产出的
 * 共享内容必须先置 0, 待持证咨询师审核后才置 1, 延续 v1.2 §11.1).
 */
function toEntityPayload(seed: PracticeScenarioSeed) {
  return {
    tenantId: PRACTICE_SYSTEM_TENANT_ID,
    userId: null,
    exerciseMode: seed.exerciseMode,
    scenarioKey: seed.scenarioKey,
    difficulty: seed.difficulty,
    isAiGenerated: false,
    persona: seed.persona,
    openingLine: seed.openingLine,
    taskPrompt: seed.taskPrompt,
    botchedUtterance: seed.botchedUtterance,
    voiceScript: seed.voiceScript,
    referenceResponse: seed.referenceResponse,
    commonPitfalls: seed.commonPitfalls,
    rubric: seed.rubric,
    expectedTurns: 1,
    enabled: true,
    deletedAt: null,
  };
}

/**
 * 布尔归一比较 — tinyint 列读出来是 0/1, entity 上声明为 boolean.
 */
function sameBoolean(dbValue: unknown, seedValue: boolean): boolean {
  const normalised = dbValue === true || dbValue === 1 || dbValue === '1';
  return normalised === seedValue;
}

/**
 * 结构化深比较 (键序无关, 类型敏感) — 用于比对 JSON 列内容.
 *
 * MySQL 的 JSON 类型存储时会规范化对象键序, 不能用 JSON.stringify 直接比,
 * 否则 drift 检测恒真, seed 永远报"更新 60", 幂等性形同虚设.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left).toSorted((a2, b2) => a2.localeCompare(b2));
    const rightKeys = Object.keys(right).toSorted((a2, b2) => a2.localeCompare(b2));
    if (leftKeys.length !== rightKeys.length) return false;
    if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

/**
 * 内容漂移检测 — 只比对影响用户可见结果的字段, 忽略审计字段.
 */
function hasDrift(row: PracticeScenario, payload: ReturnType<typeof toEntityPayload>): boolean {
  return (
    row.exerciseMode !== payload.exerciseMode ||
    row.difficulty !== payload.difficulty ||
    row.openingLine !== payload.openingLine ||
    row.taskPrompt !== payload.taskPrompt ||
    row.botchedUtterance !== payload.botchedUtterance ||
    row.voiceScript !== payload.voiceScript ||
    row.referenceResponse !== payload.referenceResponse ||
    row.expectedTurns !== payload.expectedTurns ||
    !sameBoolean(row.isAiGenerated, payload.isAiGenerated) ||
    !sameBoolean(row.enabled, payload.enabled) ||
    !deepEqual(row.persona, payload.persona) ||
    !deepEqual(row.commonPitfalls, payload.commonPitfalls) ||
    !deepEqual(row.rubric, payload.rubric)
  );
}
