// V2026-10-22 治本 (V1.3 §2.1 — 场景变体内容库汇总 + 自检):
//   原因: spec §2.1 要求「10 个基本功 × 每个 6 个 AI 场景变体」= 60 条内容库.
//     内容按 3 个文件承载 (倾听共情 / 提问技术 / 语音微训练), 本文件是它们的
//     **唯一汇总口**: seed 脚本只认这里导出的这一个数组, 将来接知识库时也是
//     替换这一个数组, 不影响脚本与调用方.
//   修法: 汇总 3 份内容 + 运行期自检 (条数 / scenarioKey 唯一 / 每基本功 L1L2L3
//     各 2 条 / 引擎字段与基本功匹配). 自检失败直接抛错 —— 内容库错了必须在
//     **灌库之前**炸掉, 而不是灌进库再让线上用户碰到.
//   反双胞胎:
//     - 不把 60 条塞进一个文件: 单文件 1600+ 行, 内容编辑与代码评审都难做;
//       按引擎族拆 3 份, 职责清晰, 合并只有一处
//     - 不在 service 里 import 内容: service 只读库, 内容由 seed 脚本灌 ——
//       避免"内容与应用二进制同版本"的老问题 (跟 training-exercises.seed.ts 同思路)
//     - 不用运行期断言代替自检: 自检放在 seed 脚本入口, 应用启动路径不读内容
//   验证:
//     1. tsc 0 错
//     2. npm run seed:practice → 60 行入库, 连跑两次行数不变
//     3. 自检: 60 条 / scenarioKey 唯一 / 每基本功 6 条且 L1L2L3 各 2
//     4. 改坏任一条的 scenarioKey → seed 脚本在灌库前报错并指出是哪一条
//   时间戳: 2026-10-22
import { LISTENING_PRACTICE_SCENARIO_SEEDS } from './practice-scenario-seeds.listening';
import { QUESTIONING_PRACTICE_SCENARIO_SEEDS } from './practice-scenario-seeds.questioning';
import { VOICE_PRACTICE_SCENARIO_SEEDS } from './practice-scenario-seeds.voice';
import type { PracticeScenarioSeed } from '../domain/practice/practice-seed.types';
import { PracticeDifficulty } from '../enums/practice-difficulty.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';

/**
 * 场景变体内容库全集 (10 基本功 × 6 变体 = 60 条).
 *
 * 这是**内容的单一事实源**: 由 bin/seed-practice-scenarios.ts 按 scenario_key
 * 幂等 upsert 进 practice_scenarios 表 (spec §6.3).
 */
export const PRACTICE_SCENARIO_SEEDS: readonly PracticeScenarioSeed[] = [
  ...LISTENING_PRACTICE_SCENARIO_SEEDS,
  ...QUESTIONING_PRACTICE_SCENARIO_SEEDS,
  ...VOICE_PRACTICE_SCENARIO_SEEDS,
];

/** 每个基本功期望的场景条数 (spec §1.2). */
export const PRACTICE_SCENARIOS_PER_MODE = 6;

/**
 * 自检结果.
 */
export interface PracticeScenarioSeedValidation {
  /** 总条数 */
  total: number;
  /** 每个基本功的条数 */
  perMode: Record<string, number>;
  /** 是否通过 */
  valid: boolean;
  /** 失败原因 (逐条列出, 便于内容编辑直接定位) */
  errors: string[];
}

/**
 * 内容库自检.
 *
 * 检查 4 件事:
 *   1. 总条数 = 60 (10 基本功 × 6)
 *   2. scenarioKey 全局唯一 (重复 = 幂等 upsert 会互相覆盖, 丢内容)
 *   3. 每个基本功 6 条, 且 L1/L2/L3 各 2 条
 *   4. 引擎相关字段与基本功匹配 (改写工坊必有 botchedUtterance 且无 voiceScript;
 *      语音微训练必有 voiceScript 且无 botchedUtterance; 接话演练两者皆无)
 *
 * @param seeds 待检内容 (缺省用全量内容库)
 * @returns 自检结果
 */
export function validatePracticeScenarioSeeds(
  seeds: readonly PracticeScenarioSeed[] = PRACTICE_SCENARIO_SEEDS,
): PracticeScenarioSeedValidation {
  const errors: string[] = [];
  const perMode: Record<string, number> = {};
  const difficultyBuckets = new Map<TrainingExerciseMode, Map<PracticeDifficulty, number>>();

  for (const seed of seeds) {
    perMode[seed.exerciseMode] = (perMode[seed.exerciseMode] ?? 0) + 1;
    bucketDifficulty(difficultyBuckets, seed);
    errors.push(...validateSeedContent(seed));
  }

  // 一次 push 收拢两类错误 (unicorn/prefer-single-call: 不连续调用 Array#push)
  errors.push(...findDuplicateKeyErrors(seeds), ...validateCoverage(perMode, difficultyBuckets));

  const expectedTotal = Object.values(TrainingExerciseMode).length * PRACTICE_SCENARIOS_PER_MODE;
  if (seeds.length !== expectedTotal) {
    errors.push(`场景总数为 ${seeds.length}, 期望 ${expectedTotal}`);
  }

  return { total: seeds.length, perMode, valid: errors.length === 0, errors };
}

/** 改写工坊基本功 (必须有 botchedUtterance, 不能有 voiceScript). */
const REWRITE_MODES: ReadonlySet<TrainingExerciseMode> = new Set([
  TrainingExerciseMode.FACT_FEELING_SEPARATION,
  TrainingExerciseMode.CLOSED_TO_OPEN,
  TrainingExerciseMode.AVOID_INTERROGATION,
]);

/** 语音微训练基本功 (必须有 voiceScript, 不能有 botchedUtterance). */
const VOICE_MODES: ReadonlySet<TrainingExerciseMode> = new Set([
  TrainingExerciseMode.SPEECH_RATE,
  TrainingExerciseMode.TONE_STABILITY,
  TrainingExerciseMode.ICE_BREAKING,
]);

/**
 * 单条场景的内容自检 —— 引擎字段匹配 + rubric 维度数.
 *
 * 拆成独立函数的原因: 自检本身是"多规则并列"的检查, 写在一个函数里会让圈复杂度
 * 超过仓库上限 (complexity 20 / cognitive 25). 拆开后每条规则各自独立可读,
 * 新增规则时只加一个分支, 不用重排整个函数.
 *
 * @param seed 待检场景
 * @returns 错误列表 (空数组 = 该条通过)
 */
function validateSeedContent(seed: PracticeScenarioSeed): string[] {
  const errors: string[] = [];
  const isRewrite = REWRITE_MODES.has(seed.exerciseMode);
  const isVoice = VOICE_MODES.has(seed.exerciseMode);

  if (isRewrite) {
    if (!seed.botchedUtterance || seed.botchedUtterance.trim().length === 0) {
      errors.push(`改写工坊场景缺少 botchedUtterance: ${seed.scenarioKey}`);
    }
    if (seed.voiceScript !== null) {
      errors.push(`改写工坊场景不应有 voiceScript: ${seed.scenarioKey}`);
    }
  } else if (isVoice) {
    if (!seed.voiceScript || seed.voiceScript.trim().length === 0) {
      errors.push(`语音场景缺少 voiceScript: ${seed.scenarioKey}`);
    }
    if (seed.botchedUtterance !== null) {
      errors.push(`语音场景不应有 botchedUtterance: ${seed.scenarioKey}`);
    }
  } else {
    if (seed.botchedUtterance !== null) {
      errors.push(`接话演练场景不应有 botchedUtterance: ${seed.scenarioKey}`);
    }
    if (seed.voiceScript !== null) {
      errors.push(`接话演练场景不应有 voiceScript: ${seed.scenarioKey}`);
    }
  }

  if (seed.rubric.dimensions.length < 3) {
    errors.push(`rubric 维度少于 3 条: ${seed.scenarioKey}`);
  }

  return errors;
}

/**
 * scenarioKey 重复检测.
 *
 * 重复 = 幂等 upsert 时两条互相覆盖 = 丢一条内容, 必须在灌库前拦住.
 *
 * @param seeds 待检内容
 * @returns 错误列表
 */
function findDuplicateKeyErrors(seeds: readonly PracticeScenarioSeed[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const seed of seeds) {
    if (seen.has(seed.scenarioKey)) {
      duplicated.add(seed.scenarioKey);
    }
    seen.add(seed.scenarioKey);
  }
  return [...duplicated].map((key) => `scenarioKey 重复: ${key}`);
}

/**
 * 把一条场景计入它所属基本功的难度分桶.
 */
function bucketDifficulty(buckets: Map<TrainingExerciseMode, Map<PracticeDifficulty, number>>, seed: PracticeScenarioSeed): void {
  const inner = buckets.get(seed.exerciseMode) ?? new Map<PracticeDifficulty, number>();
  inner.set(seed.difficulty, (inner.get(seed.difficulty) ?? 0) + 1);
  buckets.set(seed.exerciseMode, inner);
}

/**
 * 覆盖度自检 —— 10 个基本功都要有 6 条, 且每个基本功 L1/L2/L3 各 2 条.
 *
 * @param perMode 每个基本功的条数
 * @param buckets 每个基本功的难度分桶
 * @returns 错误列表
 */
function validateCoverage(perMode: Record<string, number>, buckets: Map<TrainingExerciseMode, Map<PracticeDifficulty, number>>): string[] {
  const errors: string[] = [];
  for (const mode of Object.values(TrainingExerciseMode)) {
    const count = perMode[mode] ?? 0;
    if (count !== PRACTICE_SCENARIOS_PER_MODE) {
      errors.push(`基本功 ${mode} 的场景数为 ${count}, 期望 ${PRACTICE_SCENARIOS_PER_MODE}`);
    }
    const inner = buckets.get(mode);
    for (const difficulty of [PracticeDifficulty.L1, PracticeDifficulty.L2, PracticeDifficulty.L3]) {
      const difficultyCount = inner?.get(difficulty) ?? 0;
      if (difficultyCount !== 2) {
        errors.push(`基本功 ${mode} 的 ${difficulty} 场景数为 ${difficultyCount}, 期望 2`);
      }
    }
  }
  return errors;
}
