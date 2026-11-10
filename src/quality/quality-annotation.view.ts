// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 出参视图):
//   职责: 五个端点的**出参形状** —— 与前端 `admin-dashboard/src/api/types.ts`
//         的 Annotation* 类型严格 1:1.
//   边界: 只有类型, 零逻辑.
//
//   ⚠️ **不出参不含逐字稿以外的任何内部字段** (traces / kernelState / prompt):
//     那是引擎内部状态, 标注台用不上, 且含心理内容 (隐私红线 AGENTS.md §5.4).

import type { AnnotationLabel } from './quality-annotation.constants.js';

/**
 * 列表行 (前端 AnnotationRow).
 */
export interface AnnotationRowView {
  /** 标注记录 id (前端拿它做详情/保存/reveal 的路径参数). */
  readonly id: string;
  /** 调试会话 id (逐字稿文件名). */
  readonly debugSessionId: string;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 依恋风格. */
  readonly attachmentStyle: string;
  /** 人工标注: 探索开始轮次 (NULL = 未标). */
  readonly firstExplorationTurn: number | null;
  /** 人工标注: 主导标签 (NULL = 未标). */
  readonly dominantLabel: AnnotationLabel | null;
  /** 人工标注: 危机峰值档位 (0~3). */
  readonly crisisPeakLevel: number;
  /** 人工标注: 危机首次出现轮次 (NULL = 无). */
  readonly crisisFirstTurn: number | null;
  /** 人工标注: 该断轮次 (NULL = 未标). */
  readonly shouldEndTurn: number | null;
  /** 存疑 / 待复审. */
  readonly needsReview: boolean;
  /** 本场标注耗时 (毫秒). */
  readonly durationMs: number;
  /** 备注 (NULL = 无). */
  readonly notes: string | null;
  /** 最后保存时刻 (ISO 字符串). */
  readonly updatedAt: string;
}

/**
 * 列表响应 (前端 AnnotationListResponse).
 */
export interface AnnotationListResponse {
  /** 行 (按锚点清单顺序). */
  readonly items: readonly AnnotationRowView[];
  /** 已标注场次 (全量口径, 不随 status 过滤变化). */
  readonly done: number;
  /** 总场次 (全量口径). */
  readonly total: number;
}

/**
 * 逐字稿消息 (只双方台词; 前端 AnnotationMessage).
 */
export interface AnnotationMessageView {
  /** 谁说的 (visitor = AI 来访者 / counselor = 学员扮演的咨询师). */
  readonly role: string;
  /** 台词原文. */
  readonly text: string;
  /** 轮次 (从 1 起). */
  readonly turnIndex: number;
}

/**
 * 详情 (前端 AnnotationDetail).
 */
export interface AnnotationDetail {
  /** 该场标注行. */
  readonly row: AnnotationRowView;
  /** 来访者展示名 (逐字稿里的 characterLabel, 如"沉舟"; 缺省 null). */
  readonly characterLabel: string | null;
  /** 该场逐字稿 (只台词; 逐字稿缺失 → 空数组). */
  readonly messages: readonly AnnotationMessageView[];
}

/**
 * 双盲揭示 (前端 AnnotationReveal).
 */
export interface AnnotationReveal {
  /** 自动判定结果 (保存人工标注后才返回). */
  readonly auto: {
    /** 自动探索轮次 (NULL = 全场没进探索). */
    readonly explorationTurn: number | null;
    /** 自动主导标签 (NULL = 无可映射策略). */
    readonly dominantLabel: AnnotationLabel | null;
    /** 自动危机档位 (0~3). */
    readonly crisisLevel: number;
  };
}

/**
 * 一致性报告 (前端 AnnotationConsistency).
 */
export interface AnnotationConsistency {
  /** 已标注场次. */
  readonly labeled: number;
  /** 总场次. */
  readonly total: number;
  /** 主导标签一致率 (NULL = 没有可比场次). */
  readonly labelAgreement: number | null;
  /** 危机档位一致率 (NULL = 没有可比场次). */
  readonly crisisAgreement: number | null;
  /** 探索轮次平均绝对误差 (NULL = 没有可比场次). */
  readonly explorationTurnMae: number | null;
}
