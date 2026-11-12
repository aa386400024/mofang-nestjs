// V2026-11-12 治本 (D-1 第二段 · 模型轨事件分类器 · 映射规则表):
//   职责: 定义「模型轨判定 → core 事件 + 旁路标签」的**唯一**映射规则表 (纯函数, 零 IO).
//   边界: 纯类型 + 纯函数; 零 @nestjs / 零网络 / 零 prompt.
//
//   为什么是「映射回 core kind + 旁路标签」 (任务单 §7.3 方案 b):
//     · core 的 CounselorEventKind 联合**不动** —— 扩联合会打红两处穷尽 Record
//       (cognition/state-transition.ts 的 DELTA_TABLE / admin-debug/event-tag-labels.ts
//        的 COUNSELOR_EVENT_LABELS), 那是 D-2 的改动面, 本单不碰 (断言⑥⑦ 必须保持绿).
//     · 模型轨判出的两类新标签 (holding_present / cold_absent) 只进**旁路记录**,
//       不进 core events —— 首版是「中间态」: 产出新标签, 但不改 delta.
//     · 映射规则表从一开始就按 D-2 的最终形状写 → D-2 只换实现, 类型层不返工.
//
//   ⚠️ **映射是有损压缩**: 两类新标签在 D-2 接 delta 时, 映射表本身要重做.
//     本单**只落形状**, 不落任何 delta 方向 / 数值 / 权重斜率 / 缺席轮数阈值 ——
//     那些是 D-2 + 标定批次的事 (临床口径, 不由工程拍板).
//
//   如何验证:
//     1. pnpm exec tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/model-event-classifier.spec.ts 覆盖映射 / 去重 / 未知标签丢弃

import type { CounselorEventKind } from '../../engine-core/index.js';

/**
 * core 事件种类的**穷尽**登记表.
 *
 * ⚠️ 为什么要写成穷尽 Record 而不是数组字面量:
 *   数组字面量漏一个键 = 静默漂移 (模型轨少认一个 kind → 观察数据里那个 kind 永远不出现).
 *   写成 Record<CounselorEventKind, true> → 内核联合一变, 这里**编译报错**, 逼着补.
 *   (与 admin-debug/event-tag-labels.ts 的 COUNSELOR_EVENT_LABELS 同一款纪律.)
 *
 * ⚠️ 本表**不含** holding_present / cold_absent —— 那两个是旁路标签, 不是 core 事件种类.
 */
const CORE_EVENT_KIND_TABLE: Readonly<Record<CounselorEventKind, true>> = {
  empathy: true,
  acceptance: true,
  normalization: true,
  open_probe: true,
  affirmation: true,
  judgment: true,
  preaching: true,
  minimizing: true,
  boundary_cross: true,
  sensitive_touch: true,
  neutral: true,
};

/**
 * core 事件种类的运行时清单 (顺序 = 上表的声明顺序, 稳定可比).
 *
 * ⚠️ 用 Object.keys 而不是另写一份数组: 少写一个 = 静默漏认 (模型轨的观察数据会缺一类).
 */
export const CORE_EVENT_KINDS: readonly CounselorEventKind[] = Object.keys(CORE_EVENT_KIND_TABLE) as CounselorEventKind[];

/**
 * 旁路标签的**唯一**合法取值清单 (两类新标签).
 *
 * ⚠️ 这两个标签**不进 core events** —— 首版只进旁路记录 (D-2 才接 delta).
 */
export const MODEL_SIDE_LABELS = ['holding_present', 'cold_absent'] as const;

/** 旁路标签类型 (两类新标签). */
export type ModelSideLabel = (typeof MODEL_SIDE_LABELS)[number];

/** 模型轨的标签全集 = core 事件种类 + 旁路标签. */
export type ModelEventLabel = CounselorEventKind | ModelSideLabel;

/** 模型轨标签全集的运行时清单 (校验 / prompt 用). */
export const MODEL_EVENT_LABELS: readonly ModelEventLabel[] = [...CORE_EVENT_KINDS, ...MODEL_SIDE_LABELS];

/**
 * 模型轨判定的结果 (映射后).
 *
 * ⚠️ **confidence 只进观测, 不参与 delta 缩放** —— strength 首版恒 1 (风险 G).
 */
export interface ModelClassification {
  /** 映射回现有 core 事件种类 (11 类 = 10 行为 + neutral); core 侧零类型变化. */
  readonly coreKinds: readonly CounselorEventKind[];
  /** 旁路标签 (只进观测记录, **不进** core events). */
  readonly sideLabels: readonly ModelSideLabel[];
  /** 模型置信度 [0,1]. */
  readonly confidence: number;
}

/**
 * 一个标签的映射结果.
 *
 * ⚠️ coreKind 与 sideLabel **至多一个非空**: 旁路标签在 D-2 之前不映射到任何 core kind
 *   (它的 delta 方向 / 数值属临床口径, 未标定 → 映射它 = 凭空发明数值).
 */
export interface ModelLabelMapping {
  /** 映射回 core 的事件种类. */
  readonly coreKind?: CounselorEventKind;
  /** 旁路标签 (只进观测). */
  readonly sideLabel?: ModelSideLabel;
}

/**
 * 映射规则表 (**穷尽** Record: 标签集变了 → 编译报错, 不会静默漏映射).
 *
 * ⚠️ 这张表是 D-2 的**改写起点** —— D-2 接 delta 时改的是这张表与它的消费点,
 *   类型层 (core 联合 / 标签字典 / 指标字典) 不用返工.
 */
export const MODEL_LABEL_MAPPING: Readonly<Record<ModelEventLabel, ModelLabelMapping>> = {
  empathy: { coreKind: 'empathy' },
  acceptance: { coreKind: 'acceptance' },
  normalization: { coreKind: 'normalization' },
  open_probe: { coreKind: 'open_probe' },
  affirmation: { coreKind: 'affirmation' },
  judgment: { coreKind: 'judgment' },
  preaching: { coreKind: 'preaching' },
  minimizing: { coreKind: 'minimizing' },
  boundary_cross: { coreKind: 'boundary_cross' },
  sensitive_touch: { coreKind: 'sensitive_touch' },
  neutral: { coreKind: 'neutral' },
  holding_present: { sideLabel: 'holding_present' },
  cold_absent: { sideLabel: 'cold_absent' },
};

/** 映射后的标签集合 (不含置信度). */
export interface MappedModelLabels {
  readonly coreKinds: readonly CounselorEventKind[];
  readonly sideLabels: readonly ModelSideLabel[];
}

/**
 * 把模型吐出的标签映射成 core kind + 旁路标签.
 *
 * 口径 (与预研 S5-6 一致):
 *   · **未知标签 → 丢弃** (不是整轮失败) —— 模型偶尔多吐一个自造标签, 不该把整轮判废;
 *   · **去重保序** —— 一轮多标签是合法的 (规则轨本身支持一轮多标签);
 *   · **全被丢弃 → 返回 null** —— 空判定没有意义 → 调用方回落规则轨 + 记 schema_validation_failed.
 *
 * @param labels 模型吐出的原始标签数组 (未校验类型)
 * @returns 映射结果; null = 没有一个标签可用 (调用方按 schema_validation_failed 回落)
 */
export function mapModelLabels(labels: readonly unknown[]): MappedModelLabels | null {
  const coreKinds: CounselorEventKind[] = [];
  const sideLabels: ModelSideLabel[] = [];
  for (const raw of labels) {
    if (typeof raw !== 'string') continue;
    const mapping: ModelLabelMapping | undefined = MODEL_LABEL_MAPPING[raw as ModelEventLabel];
    if (!mapping) continue;
    if (mapping.coreKind && !coreKinds.includes(mapping.coreKind)) coreKinds.push(mapping.coreKind);
    if (mapping.sideLabel && !sideLabels.includes(mapping.sideLabel)) sideLabels.push(mapping.sideLabel);
  }
  if (coreKinds.length === 0 && sideLabels.length === 0) return null;
  return { coreKinds, sideLabels };
}

/**
 * 模型轨的**原始**结构化输出形状 (LLM 那条链吐出来的).
 *
 * ⚠️ 只有两个字段: 标签数组 + 置信度. **没有解释文本** —— 解释会变成新的心理内容落库面
 *   (风险 Q): 只出码, 不出话.
 */
export interface ModelClassificationOutput {
  readonly kinds: readonly string[];
  readonly confidence: number;
}

/**
 * 手写校验器 (纯函数, 可单测, 不引 IO).
 *
 * 校验点 (预研 S5-6):
 *   · kinds 必须是字符串数组 (非数组 / 含非字符串 → 非法);
 *   · confidence 必须是 [0,1] 内的有限数 (越界 / 非数 → 非法).
 *
 * ⚠️ **不在这里校验标签是否已知** —— 未知标签在映射阶段被丢弃 (那里才判「全丢 = 非法」).
 *   两处分开: 这里管**形状**, 那里管**取值域**.
 *
 * @param raw 模型返回的原始对象
 * @returns 合法时返回结构化形状; 非法返回 null (调用方回落规则轨 + schema_validation_failed)
 */
export function validateModelClassification(raw: unknown): ModelClassificationOutput | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kinds = record['kinds'];
  if (!Array.isArray(kinds)) return null;
  const confidence = record['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const labels: string[] = [];
  for (const item of kinds) {
    if (typeof item !== 'string') return null;
    labels.push(item);
  }
  return { kinds: labels, confidence };
}
