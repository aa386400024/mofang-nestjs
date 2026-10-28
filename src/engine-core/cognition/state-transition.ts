// V2026-10-28 WP1 (引擎内核 · 状态迁移算子):
//   职责: 标准事件 → 信任 / 三维阻抗 / 情绪 / 移情的确定性增减, 统一 clamp.
//   边界: 纯函数, 无状态, 无随机, 可复现. 输入旧快照 + 事件列表, 输出新快照
//         (值语义, 整体替换, 不就地改).
//
//   架构原则: 阻抗 / 情绪是来访内部防御状态, 由**咨询师事件**推动升降, 作为 WP5
//   渲染参数; 绝不从来访自己的输出反推 (来访输出是 WP5 渲染结果, 反推 = 循环论证).
//
//   delta 表是工程种子值 (非临床标定), 集中在此便于后期调参 / 换模型轨.

import type { BdiSnapshot } from '../domain/bdi-snapshot';
import { clamp01, clampValence, resolveEmotionLabel } from '../domain/emotion';
import type { CounselorEventKind, SessionEvent } from '../domain/events/session-event';

/** 单事件对各维度的增量. */
interface DeltaVector {
  readonly trust: number;
  readonly verbal: number;
  readonly depth: number;
  readonly style: number;
  readonly valence: number;
  readonly arousal: number;
  readonly positive: number;
  readonly negative: number;
  readonly dependency: number;
}

const ZERO: DeltaVector = {
  trust: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  valence: 0,
  arousal: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/**
 * 初始 delta 表 (任务单 §6.1 种子值).
 * 正值 = 提升该维度; 负值 = 下降. 叠加后统一 clamp, 不逐事件 clamp.
 */
const DELTA_TABLE: Readonly<Record<CounselorEventKind, DeltaVector>> = {
  empathy: {
    trust: 0.1,
    verbal: -0.08,
    depth: -0.1,
    style: -0.06,
    valence: 0.1,
    arousal: -0.05,
    positive: 0.03,
    negative: 0,
    dependency: 0,
  },
  acceptance: {
    trust: 0.08,
    verbal: -0.06,
    depth: -0.08,
    style: -0.05,
    valence: 0.08,
    arousal: -0.04,
    positive: 0.02,
    negative: 0,
    dependency: 0,
  },
  normalization: {
    trust: 0.07,
    verbal: -0.05,
    depth: -0.07,
    style: -0.04,
    valence: 0.07,
    arousal: 0,
    positive: 0.01,
    negative: 0,
    dependency: 0,
  },
  open_probe: {
    trust: 0.05,
    verbal: -0.03,
    depth: -0.06,
    style: -0.03,
    valence: 0.04,
    arousal: 0.02,
    positive: 0,
    negative: 0,
    dependency: 0,
  },
  affirmation: {
    trust: 0.08,
    verbal: -0.04,
    depth: -0.06,
    style: -0.04,
    valence: 0.1,
    arousal: -0.03,
    positive: 0.04,
    negative: 0,
    dependency: 0.02,
  },
  judgment: {
    trust: -0.12,
    verbal: 0.06,
    depth: 0.08,
    style: 0.12,
    valence: -0.12,
    arousal: 0.06,
    positive: 0,
    negative: 0.05,
    dependency: 0,
  },
  preaching: {
    trust: -0.1,
    verbal: 0.08,
    depth: 0.06,
    style: 0.06,
    valence: -0.08,
    arousal: 0.03,
    positive: 0,
    negative: 0.03,
    dependency: 0,
  },
  minimizing: {
    trust: -0.1,
    verbal: 0.05,
    depth: 0.1,
    style: 0.05,
    valence: -0.12,
    arousal: 0.04,
    positive: 0,
    negative: 0.04,
    dependency: 0,
  },
  boundary_cross: {
    trust: -0.15,
    verbal: 0.04,
    depth: 0.05,
    style: 0.15,
    valence: -0.15,
    arousal: 0.08,
    positive: 0,
    negative: 0.1,
    dependency: 0,
  },
  sensitive_touch: {
    trust: 0,
    verbal: 0.05,
    depth: 0.05,
    style: 0.06,
    valence: -0.05,
    arousal: 0.15,
    positive: 0,
    negative: 0.04,
    dependency: 0,
  },
  neutral: ZERO,
};

/** 把多事件 delta 乘强度后聚合 (内部可变累加, 返回只读向量). */
function aggregate(events: readonly SessionEvent[]): DeltaVector {
  const sum = {
    trust: 0,
    verbal: 0,
    depth: 0,
    style: 0,
    valence: 0,
    arousal: 0,
    positive: 0,
    negative: 0,
    dependency: 0,
  };
  for (const event of events) {
    const delta = DELTA_TABLE[event.kind] ?? ZERO;
    const strength = clamp01(event.strength);
    sum.trust += delta.trust * strength;
    sum.verbal += delta.verbal * strength;
    sum.depth += delta.depth * strength;
    sum.style += delta.style * strength;
    sum.valence += delta.valence * strength;
    sum.arousal += delta.arousal * strength;
    sum.positive += delta.positive * strength;
    sum.negative += delta.negative * strength;
    sum.dependency += delta.dependency * strength;
  }
  return sum;
}

/**
 * 状态迁移: 旧快照 + 事件 → 新快照.
 * 信念层 / 愿望层规则轨不改写 (原样透传, 其演进入模型轨 / 后续);
 * 只推进信任 / 阻抗 / 情绪 / 移情.
 */
export function transitionState(snapshot: BdiSnapshot, events: readonly SessionEvent[]): BdiSnapshot {
  const delta = aggregate(events);

  const valence = clampValence(snapshot.emotion.valence + delta.valence);
  const arousal = clamp01(snapshot.emotion.arousal + delta.arousal);

  return {
    coreBeliefs: snapshot.coreBeliefs,
    temporaryBeliefs: snapshot.temporaryBeliefs,
    memoryBeliefs: snapshot.memoryBeliefs,
    underlyingDesires: snapshot.underlyingDesires,
    situationalDesires: snapshot.situationalDesires,
    emotion: { label: resolveEmotionLabel(valence, arousal), valence, arousal },
    resistance: {
      verbal: clamp01(snapshot.resistance.verbal + delta.verbal),
      depth: clamp01(snapshot.resistance.depth + delta.depth),
      style: clamp01(snapshot.resistance.style + delta.style),
    },
    transference: {
      positive: clamp01(snapshot.transference.positive + delta.positive),
      negative: clamp01(snapshot.transference.negative + delta.negative),
      dependency: clamp01(snapshot.transference.dependency + delta.dependency),
    },
    trust: clamp01(snapshot.trust + delta.trust),
  };
}
