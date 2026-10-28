// V2026-10-20 治本 (训练题内容来源 — DB mock seed + 知识库接入点):
//
//   ── 决策由来 ──
//   大炮拍板: 「训练题先数据库 mock, 回头咱们有专门的知识库, 从那里面弄」.
//   由此确立本项目的内容架构:
//
//     training_exercises 表 = 训练题内容的**单一事实源**
//       ├── 现在: 由本 seed 灌入 mock 10 项 (PRD v1.0 §5.2 的 1:1 结构)
//       └── 将来: 由知识库同步任务 upsert 进同一张表
//
//   ── 为什么不用 migration 灌数据 ──
//   项目既有约定 (src/migration/1700000009000-SeedDevData.ts) 用 migration 灌 dev
//   数据, 本项目遵循一致性. 但训练题属于**会持续演进的内容**, 不是一次性结构变更:
//     - migration 一旦执行即冻结, 知识库后续更新内容无法通过新 migration 表达
//       (每改一句专家反馈就要加一条 migration, 迁移历史被业务内容淹没)
//     - 内容无法幂等重灌 (migration 只跑一次), 改完文案只能手工改库
//   故本模块做成**可重复执行的 upsert**, 由独立脚本触发, 生命周期与 schema 解耦.
//
//   ── 知识库接入点 (V1.x 契约预留) ──
//   知识库接入时只需实现同样的 upsert 语义, 写入同一张表:
//     upsertById(id) —— id 必须稳定可复现, 否则知识库无法做幂等同步.
//   因此本模块为每题分配**确定性 ID** (见 TRAINING_EXERCISE_SEED_IDS),
//   而非依赖 DB 生成的随机 UUID. 这是为知识库预留的关键设计, 不可改为自增/随机.
//
//   ── 验证 ──
//   1. npm run seed:training → 输出 10 条, 连续执行两次不产生重复行 (幂等)
//   2. SELECT id, type, mode FROM training_exercises → 10 行, id 为稳定串
//   3. 改某条 expertFeedback 后重跑 seed → 该行被更新而非新增
//
//   时间戳: 2026-10-20
import type { DataSource } from 'typeorm';

import { TRAINING_EXERCISE_SEEDS, type TrainingExerciseSeed } from '../config/training-exercise-seeds';
import { TrainingExercise } from '../entities/training-exercise.entity';

/**
 * 训练项 → 稳定 ID 映射 (知识库 upsert 的主键契约, 不可改为随机 UUID).
 *
 * 命名前缀 `ts_` 表示 training-seed; 一旦发布即为对外契约,
 * 知识库侧会以此 ID 建立映射, 改名等同于换一道题 (会丢失历史答题记录).
 */
export const TRAINING_EXERCISE_SEED_IDS = {
  emotionReflection: 'ts_emotion_reflection',
  factFeelingSeparation: 'ts_fact_feeling_separation',
  noAdviceChallenge: 'ts_no_advice_challenge',
  closedToOpen: 'ts_closed_to_open',
  oneAtATime: 'ts_one_at_a_time',
  avoidInterrogation: 'ts_avoid_interrogation',
  focusTopic: 'ts_focus_topic',
  speechRate: 'ts_speech_rate',
  toneStability: 'ts_tone_stability',
  iceBreaking: 'ts_ice_breaking',
} as const;

export type TrainingExerciseSeedKey = keyof typeof TRAINING_EXERCISE_SEED_IDS;

/**
 * 幂等灌入训练题 mock 数据.
 *
 * 语义与知识库同步任务保持一致: 按**稳定 id** upsert.
 * - 不存在 → INSERT
 * - 已存在且内容有变 → UPDATE (修正文案/难度/选项)
 * - 已存在且内容一致 → no-op (不产生无谓写, 避免 updated_at 抖动)
 *
 * @param dataSource 应用 DataSource (复用 bin/ormconfig.ts 配置)
 * @returns 统计结果, 供脚本输出与人工核对
 */
export async function seedTrainingExercises(dataSource: DataSource): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const repo = dataSource.getRepository(TrainingExercise);
  const seeds: (TrainingExerciseSeed & { id: string })[] = TRAINING_EXERCISE_SEEDS.map((seed) => ({
    ...seed,
    id: resolveSeedId(seed.mode),
  }));

  const existing = await repo.find({ where: seeds.map((s) => ({ id: s.id })) });
  const existingById = new Map(existing.map((row) => [row.id, row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seed of seeds) {
    const row = existingById.get(seed.id);
    const payload = toEntityPayload(seed);

    if (!row) {
      await repo.insert({ ...payload, id: seed.id });
      inserted++;
      continue;
    }

    if (hasDrift(row, payload)) {
      // 保留 created_at, 仅更新内容字段
      await repo.update(row.id, payload);
      updated++;
    } else {
      unchanged++;
    }
  }

  return { inserted, updated, unchanged };
}

/** mode → 稳定 id. 显式 switch 而非索引访问, 新增 mode 时编译期即暴露遗漏. */
function resolveSeedId(mode: TrainingExerciseSeed['mode']): string {
  switch (mode) {
    case 'emotionReflection':
      return TRAINING_EXERCISE_SEED_IDS.emotionReflection;
    case 'factFeelingSeparation':
      return TRAINING_EXERCISE_SEED_IDS.factFeelingSeparation;
    case 'noAdviceChallenge':
      return TRAINING_EXERCISE_SEED_IDS.noAdviceChallenge;
    case 'closedToOpen':
      return TRAINING_EXERCISE_SEED_IDS.closedToOpen;
    case 'oneAtATime':
      return TRAINING_EXERCISE_SEED_IDS.oneAtATime;
    case 'avoidInterrogation':
      return TRAINING_EXERCISE_SEED_IDS.avoidInterrogation;
    case 'focusTopic':
      return TRAINING_EXERCISE_SEED_IDS.focusTopic;
    case 'speechRate':
      return TRAINING_EXERCISE_SEED_IDS.speechRate;
    case 'toneStability':
      return TRAINING_EXERCISE_SEED_IDS.toneStability;
    case 'iceBreaking':
      return TRAINING_EXERCISE_SEED_IDS.iceBreaking;
    default: {
      const exhaustive: never = mode;
      throw new Error(`未登记稳定 ID 的训练项: ${String(exhaustive)}`);
    }
  }
}

function toEntityPayload(seed: TrainingExerciseSeed & { id: string }) {
  return {
    type: seed.type,
    mode: seed.mode,
    difficulty: seed.difficulty,
    scenarioContext: seed.scenarioContext,
    options: seed.options,
    correctOptionIndex: seed.correctOptionIndex,
    rubric: seed.rubric,
    expertFeedback: seed.expertFeedback,
    durationMinutes: seed.durationMinutes,
    personaName: seed.personaName,
    personaBackground: seed.personaBackground,
    realTimeCorrectionEnabled: seed.realTimeCorrectionEnabled ?? false,
    enabled: true,
    deletedAt: null,
  };
}

/**
 * 布尔归一比较 — 用于「DB tinyint 列」与「seed boolean 值」的语义比对.
 *
 * V2026-10-20: training_exercises.enabled / real_time_correction_enabled 是
 *   tinyint 列, TypeORM 读出为 0/1 数字, 而 entity 上声明为 boolean.
 *   直接用 !== 比较会永远不等, 必须先归一为布尔再比.
 */
function sameBoolean(dbValue: unknown, seedValue: boolean): boolean {
  const normalised = dbValue === true || dbValue === 1 || dbValue === '1';
  return normalised === seedValue;
}

/**
 * 结构化深比较 (键序无关, 类型敏感) — 用于比对 JSON 列内容.
 *
 * V2026-10-20: MySQL JSON 列会规范化键序, 故不能用 JSON.stringify 直接比.
 *   数组保序比较 (options 顺序有语义), 对象按键名排序后递归比较.
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
    // V2026-10-20 修 (eslint unicorn/no-array-sort + sonarjs/no-alphabetical-sort):
    //   sort() 是原地修改, 这里比较的是临时数组没必要改动调用方语义, 故用 toSorted();
    //   裸 sort() 默认按 UTF-16 码位比较, 非「字母序」, 规则要求用 localeCompare.
    //   两者都不影响比较结果 (仅影响内部排序方式), 纯风格/安全规则.
    const leftKeys = Object.keys(left).toSorted((a, b) => a.localeCompare(b));
    const rightKeys = Object.keys(right).toSorted((a, b) => a.localeCompare(b));
    if (leftKeys.length !== rightKeys.length) return false;
    if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

/** 内容漂移检测 — 只比对影响用户可见结果的字段, 忽略审计字段. */
function hasDrift(row: TrainingExercise, payload: ReturnType<typeof toEntityPayload>): boolean {
  return (
    row.type !== payload.type ||
    row.mode !== payload.mode ||
    row.difficulty !== payload.difficulty ||
    row.scenarioContext !== payload.scenarioContext ||
    row.expertFeedback !== payload.expertFeedback ||
    row.durationMinutes !== payload.durationMinutes ||
    row.personaName !== payload.personaName ||
    row.personaBackground !== payload.personaBackground ||
    row.correctOptionIndex !== payload.correctOptionIndex ||
    // V2026-10-20 修正 (tinyint 列的布尔语义 — 漂移检测恒真的第二个真凶):
    //   entity 里 enabled / realTimeCorrectionEnabled 声明为 boolean, 但列类型是
    //   tinyint, MySQL 读回来是数字 0/1 而不是 JS 布尔. 于是 row.enabled(1)
    //   !== payload.enabled(true) 恒成立 → 每一行都被判为漂移 → 永远「更新 10」.
    //   治本: 语义化比较 —— tinyint(0/1) 与 boolean 表达的是同一含义, 必须先归一.
    //   反双胞胎: 不改成 `as unknown as boolean` 强转 (那只是骗过编译器, 运行时仍错).
    !sameBoolean(row.realTimeCorrectionEnabled, payload.realTimeCorrectionEnabled) ||
    !sameBoolean(row.enabled, payload.enabled) ||
    // V2026-10-20 修正 (MySQL JSON 列键序规范化 — 幂等失效的真凶):
    //   MySQL 的 JSON 类型存储时会按「键长度 → 字节序」重排对象键, 读回来的
    //   options/rubric 键序与写入时不同, 因此 JSON.stringify 直接比较**永远不等**,
    //   导致 hasDrift 恒 true → 每次 seed 都把 10 行全 UPDATE 一遍, 且永远报
    //   「更新 10」而不是「未变 10」, 幂等性形同虚设.
    //   改为键序无关的深比较. 注: 这不只是日志难看 —— 无谓 UPDATE 会刷新
    //   updated_at, 让"这条数据何时被改过"失去参考价值.
    !deepEqual(row.options, payload.options) ||
    !deepEqual(row.rubric, payload.rubric)
  );
}
