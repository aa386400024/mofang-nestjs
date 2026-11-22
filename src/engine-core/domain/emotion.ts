// V2026-10-28 WP1 (引擎内核 · 情绪状态):
//   职责: 情绪 = 离散标签 + 效价 valence[-1,1] + 唤醒 arousal[0,1].
//   边界: 纯 TS. 规则轨只迁移 valence/arousal 数值, 标签由双轴象限落点决定
//         (resolveEmotionLabel), 不训练情绪模型, 不使用自由文本情绪.
//
//   为什么是"离散标签 + 双轴"而不是纯离散或纯连续:
//     - 纯离散(只有 happy/sad)表达不了强度, 无法被规则做可复现的增减;
//     - 纯连续(valence/arousal)无法直接喂给 WP5 渲染一个"口语情绪基调";
//     - 双轴承载强度与唤醒, 标签做可渲染的归类, 两者都要.

/** 离散情绪标签 (规则轨可产出子集; 其余标签留给模型轨). */
export type EmotionLabel = 'neutral' | 'sad' | 'anxious' | 'angry' | 'hurt' | 'guarded' | 'relieved' | 'hopeful' | 'ashamed' | 'empty';

/** 情绪状态: 离散标签 + 效价 + 唤醒. */
export interface EmotionState {
  readonly label: EmotionLabel;
  /** 效价 -1(极负) .. 1(极正). */
  readonly valence: number;
  /** 唤醒 0(平静) .. 1(高唤醒). */
  readonly arousal: number;
}

/** 把数值 clamp 到 [0,1]. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 把效价 clamp 到 [-1,1]. */
export function clampValence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * 由 valence × arousal 象限确定性映射离散标签 (规则轨, 可复现).
 * 这是工程落点表, 非临床标定; 后期模型轨可替换为情绪分类, 不影响双轴数值.
 */
export function resolveEmotionLabel(valence: number, arousal: number): EmotionLabel {
  if (valence >= 0.25) return arousal >= 0.4 ? 'hopeful' : 'relieved';
  if (valence <= -0.5) {
    if (arousal >= 0.65) return 'angry';
    if (arousal >= 0.45) return 'hurt';
    if (arousal < 0.2) return 'empty';
    return 'sad';
  }
  if (arousal >= 0.6) return 'anxious';
  if (arousal >= 0.4) return 'guarded';
  return 'neutral';
}
