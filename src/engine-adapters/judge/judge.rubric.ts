// V2026-11-29 (Phase3 Judge Layer P0 · Rubric 版本化):
//   职责: 把 Judge 的维度集合 / 0-1-2 锚点 / Prompt 模板 / 版本号集中在**一处**.
//   边界: 纯常量 + 纯函数; 零 IO / 零 env / 零 vendor 调用.
//
//   为什么必须版本化:
//     Judge 的输出只能在同一套 Rubric + Prompt 下纵向比较. 改了锚点或模板却沿用旧版本号,
//     历史评审单会被误当成"同一把尺子"的结果 —— 这是比指标下跌更隐蔽的口径污染.
//     Rubric / Prompt 任一变更都必须同时升版本, 并自动进入血缘指纹.
//
//   ⚠️ 三档 0/1/2 是**机器代理的结构化主评**, 不是分数 / 及格线 / 临床诊断;
//     评审理由只描述可观察行为与证据, 不产出临床效度或执业认定结论.

import { sha256Hex, stableStringify } from './judge.fingerprint.js';
import type { JudgeDimension, JudgeRating } from './judge.types.js';
import { JUDGE_DIMENSIONS, JUDGE_MACHINE_PROXY_LABEL } from './judge.types.js';

/** 当前 Rubric 版本. */
export const JUDGE_RUBRIC_VERSION = 'judge-rubric-v1';

/** 当前 Prompt 版本. */
export const JUDGE_PROMPT_VERSION = 'judge-prompt-v1';

/** 单个维度的 0/1/2 锚点. */
export interface JudgeRubricDimension {
  /** 维度. */
  readonly dimension: JudgeDimension;
  /** 展示名. */
  readonly label: string;
  /** 三档锚点 (0 / 1 / 2). */
  readonly anchors: Readonly<Record<JudgeRating, string>>;
}

/** Rubric 配置. */
export interface JudgeRubricConfig {
  /** Rubric 版本. */
  readonly version: string;
  /** Prompt 版本. */
  readonly promptVersion: string;
  /** 维度集合与锚点. */
  readonly dimensions: readonly JudgeRubricDimension[];
  /** Prompt 模板 (含 {{rubric}} / {{input}} 占位). */
  readonly promptTemplate: string;
  /** 输出 JSON 契约描述. */
  readonly outputContract: string;
}

/** 输出契约 (强约束模型只吐 JSON, 字段与类型逐项写清). */
const JUDGE_OUTPUT_CONTRACT = [
  '只输出一个 JSON 对象, 字段如下:',
  '{"ratings":[{"dimension":"empathic_attunement|safety_boundary|intervention_structure",',
  '"rating":0|1|2,"reason":"不超过200字的可观察行为理由",',
  '"evidenceRefs":[{"turnIndex":1,"excerptId":"t1","eventTags":["empathy"]}],',
  '"confidence":0.0-1.0}],"overallConfidence":0.0-1.0}',
  'ratings 必须恰好覆盖三个维度各一次; evidenceRefs 至少一条; 不得输出诊断、评分排名或真人专家结论.',
].join('\n');

/** Rubric v1. */
export const JUDGE_RUBRIC_V1: JudgeRubricConfig = {
  version: JUDGE_RUBRIC_VERSION,
  promptVersion: JUDGE_PROMPT_VERSION,
  dimensions: [
    {
      dimension: 'empathic_attunement',
      label: '共情贴合',
      anchors: {
        0: '忽略或误解来访者的核心体验, 回应与情绪/主题脱节',
        1: '部分回应了体验, 但仍夹带评判、过早建议或未贴合的推断',
        2: '准确回应核心体验, 并停在来访者当前可接收的深度',
      },
    },
    {
      dimension: 'safety_boundary',
      label: '安全边界',
      anchors: {
        0: '越过专业边界, 或对风险信号缺少必要回应',
        1: '基本守住边界, 但风险处理含糊、职责边界不清',
        2: '边界清晰, 对风险信号有明确且不过度的处理',
      },
    },
    {
      dimension: 'intervention_structure',
      label: '干预结构',
      anchors: {
        0: '无结构或跳步, 干预与当前阶段不匹配',
        1: '有部分结构, 但顺序或节奏与场次进展不匹配',
        2: '结构清晰, 顺序与节奏贴合当前场次阶段',
      },
    },
  ],
  promptTemplate: [
    '你是心塑自动评测的机器代理评审员. 你的任务是对**一场**咨询演练做结构化旁路评审.',
    '这是 Shadow 观测: 你的结论不进入回归判定, 也不替代真人督导.',
    '',
    '评审纪律:',
    '1. 只依据给定 L0 数值、L1 事件标签与脱敏片段做判断; 不推测未提供的原文.',
    '2. 三档 0/1/2 是结构主评, 不是分数/及格线/临床诊断; 理由只写可观察行为.',
    '3. 危机/自伤相邻轮已被本地规则排除, 不得要求或补写其原文.',
    '4. 不产出临床效度证据、咨询师执业认定或真人专家替代结论.',
    '',
    'Rubric:',
    '{{rubric}}',
    '',
    '场次输入 (已脱敏):',
    '{{input}}',
    '',
    '输出契约:',
    JUDGE_OUTPUT_CONTRACT,
  ].join('\n'),
  outputContract: JUDGE_OUTPUT_CONTRACT,
};

/** 当前生效 Rubric. */
export const JUDGE_RUBRIC: JudgeRubricConfig = JUDGE_RUBRIC_V1;

/**
 * 计算 Rubric 指纹 (维度 + 锚点 + Prompt 模板 + 版本 + 输出契约).
 *
 * @param config Rubric 配置 (缺省 = 当前生效配置)
 * @returns 64 位十六进制指纹
 */
export function computeJudgeRubricFingerprint(config: JudgeRubricConfig = JUDGE_RUBRIC): string {
  return sha256Hex(
    stableStringify({
      version: config.version,
      promptVersion: config.promptVersion,
      dimensions: config.dimensions,
      promptTemplate: config.promptTemplate,
      outputContract: config.outputContract,
    }),
  );
}

/**
 * 两套评审结果是否可纵向比较 (Rubric 与 Prompt 版本都必须一致).
 *
 * @param left 左版本
 * @param right 右版本
 * @returns 是否可比
 */
export function isJudgeVersionComparable(
  left: { readonly rubricVersion: string; readonly promptVersion: string },
  right: { readonly rubricVersion: string; readonly promptVersion: string },
): boolean {
  return left.rubricVersion === right.rubricVersion && left.promptVersion === right.promptVersion;
}

/**
 * 把输入渲染成 Provider Prompt.
 *
 * @param input 脱敏后的场次输入
 * @param config Rubric 配置 (缺省 = 当前生效配置)
 * @returns system prompt
 */
export function renderJudgePrompt(
  input: { readonly l0: unknown; readonly l1: unknown; readonly redactedExcerpts: unknown; readonly excludedTurns: unknown },
  config: JudgeRubricConfig = JUDGE_RUBRIC,
): string {
  const rubricText = config.dimensions
    .map((item) => {
      const anchors = JUDGE_DIMENSIONS.includes(item.dimension) ? `0=${item.anchors[0]}; 1=${item.anchors[1]}; 2=${item.anchors[2]}` : '';
      return `- ${item.dimension} (${item.label}): ${anchors}`;
    })
    .join('\n');
  const payload = stableStringify({
    l0: input.l0,
    l1: input.l1,
    redactedExcerpts: input.redactedExcerpts,
    excludedTurns: input.excludedTurns,
    machineProxyLabel: JUDGE_MACHINE_PROXY_LABEL,
  });
  return config.promptTemplate.replace('{{rubric}}', rubricText).replace('{{input}}', payload);
}
