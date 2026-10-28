// V2026-10-22 治本 (V1.3 — 微技能自由练习引擎纯函数单测):
//   原因: 本引擎有两类"不靠运行就能测、但一旦错了后果很大"的不变量:
//     ① 内容库不变量 —— 60 条 / scenarioKey 唯一 / 每基本功 L1L2L3 各 2 /
//        引擎字段匹配. 内容是**会持续编辑**的 (运营改文案、加变体), 靠人工核对
//        迟早漏; 而内容错了会直接变成线上用户看到的坏素材.
//     ② 评判行为不变量 —— LLM 开关解析 + 批注侧重点轮换. 轮换是"练完就没了"的
//        解药 (§3.3), 一旦退化成永远看同一个点, 留存机制静默失效.
//     这两类都是**纯函数**, 无 DI / 无 DB, 因此不需要起应用就能测.
//   范围说明: 带 DI 的 service (LLM 调用 / 库读写) 不在本文件覆盖范围 ——
//     那些依赖真实环境与模型, 按项目惯例走人工 curl 验证 (见 impl 文档 §7).
//   验证:
//     1. npx jest test/counselor/practice-engine.spec.ts 全绿
//     2. 故意把某条 scenarioKey 改成重复 → 第 2 组用例变红
//   时间戳: 2026-10-22
import { evaluationFocusOf } from '../../src/counselor/config/practice-evaluation-prompts';
import { isPracticeLlmEvaluationEnabled } from '../../src/counselor/config/practice-evaluation.config';
import { PRACTICE_SCENARIO_SEEDS, validatePracticeScenarioSeeds } from '../../src/counselor/config/practice-scenario-seeds';
import type { PracticeScenarioSeed } from '../../src/counselor/domain/practice/practice-seed.types';
import { PracticeDifficulty } from '../../src/counselor/enums/practice-difficulty.enum';
import { TrainingExerciseMode } from '../../src/counselor/enums/training-exercise-mode.enum';

describe('V1.3 场景内容库自检', () => {
  it('随库内容通过自检 (60 条 / 10 基本功 / 每基本功 L1L2L3 各 2)', () => {
    const result = validatePracticeScenarioSeeds();

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.total).toBe(60);

    for (const mode of Object.values(TrainingExerciseMode)) {
      expect(result.perMode[mode]).toBe(6);
    }
  });

  it('scenarioKey 全局唯一', () => {
    const keys = PRACTICE_SCENARIO_SEEDS.map((seed) => seed.scenarioKey);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('能抓出重复的 scenarioKey (幂等 upsert 会互相覆盖, 丢内容)', () => {
    const first = PRACTICE_SCENARIO_SEEDS[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    const duplicated: PracticeScenarioSeed = { ...first, scenarioKey: first.scenarioKey };
    const result = validatePracticeScenarioSeeds([...PRACTICE_SCENARIO_SEEDS, duplicated]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('scenarioKey 重复'))).toBe(true);
  });

  it('能抓出改写工坊场景缺失 botchedUtterance (客户端改写工坊会拿到空原话)', () => {
    const rewriteSeed = PRACTICE_SCENARIO_SEEDS.find(
      (seed) => seed.exerciseMode === TrainingExerciseMode.CLOSED_TO_OPEN && seed.botchedUtterance !== null,
    );
    expect(rewriteSeed).toBeDefined();
    if (!rewriteSeed) {
      return;
    }

    const broken: PracticeScenarioSeed = { ...rewriteSeed, botchedUtterance: null };
    const result = validatePracticeScenarioSeeds([
      ...PRACTICE_SCENARIO_SEEDS.filter((seed) => seed.scenarioKey !== rewriteSeed.scenarioKey),
      broken,
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('缺少 botchedUtterance'))).toBe(true);
  });

  it('能抓出难度分布被改乱的情况 (每个基本功必须 L1/L2/L3 各 2 条)', () => {
    const target = PRACTICE_SCENARIO_SEEDS.find((seed) => seed.difficulty === PracticeDifficulty.L3);
    expect(target).toBeDefined();
    if (!target) {
      return;
    }

    const flattened: PracticeScenarioSeed = { ...target, difficulty: PracticeDifficulty.L1 };
    const result = validatePracticeScenarioSeeds([
      ...PRACTICE_SCENARIO_SEEDS.filter((seed) => seed.scenarioKey !== target.scenarioKey),
      flattened,
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('期望 2'))).toBe(true);
  });
});

describe('V1.3 评判运行开关', () => {
  it('缺省走 LLM 主路径 (失败自动降级)', () => {
    expect(isPracticeLlmEvaluationEnabled(undefined)).toBe(true);
    expect(isPracticeLlmEvaluationEnabled('')).toBe(true);
  });

  it('显式关闭时直接走确定性路径, 不发起 LLM 调用', () => {
    expect(isPracticeLlmEvaluationEnabled('off')).toBe(false);
    expect(isPracticeLlmEvaluationEnabled('OFF')).toBe(false);
    expect(isPracticeLlmEvaluationEnabled('false')).toBe(false);
    expect(isPracticeLlmEvaluationEnabled('0')).toBe(false);
  });

  it('其余取值视为开启 (不因拼写差异静默关掉 LLM 评判)', () => {
    expect(isPracticeLlmEvaluationEnabled('on')).toBe(true);
    expect(isPracticeLlmEvaluationEnabled('ON')).toBe(true);
    expect(isPracticeLlmEvaluationEnabled('true')).toBe(true);
  });
});

describe('V1.3 批注侧重点轮换', () => {
  it('第 1 次看动作 / 第 2 次看语气长度 / 第 3 次起给稳定确认', () => {
    expect(evaluationFocusOf(1)).toBe('action');
    expect(evaluationFocusOf(2)).toBe('tone');
    expect(evaluationFocusOf(3)).toBe('stability');
    expect(evaluationFocusOf(4)).toBe('action');
    expect(evaluationFocusOf(5)).toBe('tone');
  });
});
