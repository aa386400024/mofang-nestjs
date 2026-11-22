// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 出参视图):
//   职责: 端点的**出参形状** —— 与前端 `admin-dashboard/src/api/types.ts`
//         的 Annotation* 类型对齐.
//   边界: 只有类型, 零逻辑.
//
//   ⚠️ **不出参不含逐字稿以外的任何内部字段** (traces / kernelState / prompt):
//     那是引擎内部状态, 标注台用不上, 且含心理内容 (隐私红线 AGENTS.md §5.4).
//
// V2026-11-11 治本 (WP-N · 标注台批次化):
//   行视图**只增字段**, 既有 13 个字段的语义一字未改 —— 前端不改也能跑.
//   新增: id 可空 (未落行的派生视图) / 批次归属 6 列 / 轮级 3 列 / 逐字稿来源 / 告警.
//   ⚠️ `id` 由 string 放宽成 string | null: 派生行还没落库, 没有 id ——
//     前端遇到 null 要改用 debugSessionId (契约文档 §三 已写明).

import type { AnnotationLabel } from './quality-annotation.constants.js';
import type { ComparabilityReason, ComparabilityWarning, TranscriptSource } from './quality-annotation.constants.js';

/**
 * 列表行 (前端 AnnotationRow).
 */
export interface AnnotationRowView {
  /** 标注记录 id (**NULL = 尚未落行**, 首次 PUT 才建). */
  readonly id: string | null;
  /** 调试会话 id (逐字稿文件名; 派生视图用它当主键). */
  readonly debugSessionId: string;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 依恋风格 (由 character_profiles 反查; 取不到 → 'unknown'). */
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
  /** 最后保存时刻 (ISO 字符串; 派生视图 = NULL, 尚未保存). */
  readonly updatedAt: string | null;
  // ── V2026-11-11 (WP-N): 以下为**纯增量**字段 ──
  /** 归属批次 id (NULL = 无法归属的历史单场). */
  readonly batchId: string | null;
  /** 该场咨询师模式 id. */
  readonly counselorModeId: string | null;
  /** 该场轮数 (派生时的快照值). */
  readonly turnCount: number | null;
  /** 该场引擎版本 (结论对应哪版引擎). */
  readonly engineVersion: string | null;
  /** 该场 prompt 模板指纹. */
  readonly promptVersion: string | null;
  /** 该场角色版本. */
  readonly characterVersion: string | null;
  /** 轮级标记: 从第几轮开始不对 (NULL = 未标 / 整场无问题). */
  readonly firstBadTurn: number | null;
  /** 轮级标记: 有问题的轮次清单 (逗号分隔). */
  readonly badTurns: string | null;
  /** 轮级说明 (事实描述; 禁评分 / 等级). */
  readonly turnNote: string | null;
  /** 逐字稿来源 (frozen = 冻结副本 / live = 活文件 / missing = 都没有). */
  readonly transcriptSource: TranscriptSource;
  /** 本行的告警码 (空数组 = 无告警). */
  readonly warnings: readonly string[];
}

/**
 * 列表响应 (前端 AnnotationListResponse).
 */
export interface AnnotationListResponse {
  /** 行 (按锚点清单顺序 / 按批派生顺序). */
  readonly items: readonly AnnotationRowView[];
  /** 已标注场次 (全量口径, 不随 status 过滤变化; 给了 batchId 时按该批口径). */
  readonly done: number;
  /** 总场次 (全量口径; 给了 batchId 时按该批口径). */
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
  /** 该场标注行 (未落行时 id 为 null). */
  readonly row: AnnotationRowView;
  /** 来访者展示名 (逐字稿里的 characterLabel, 如"沉舟"; 缺省 null). */
  readonly characterLabel: string | null;
  /** 该场逐字稿 (只台词; 逐字稿缺失 → 空数组 + transcriptSource='missing'). */
  readonly messages: readonly AnnotationMessageView[];
  /** 逐字稿来源 (V2026-11-11 WP-N). */
  readonly transcriptSource: TranscriptSource;
  /** 告警码 (空数组 = 无告警; 逐字稿缺失 → ['TRANSCRIPT_MISSING']). */
  readonly warnings: readonly string[];
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
 * 一致性报告的**口径** (V2026-11-11 WP-N).
 *
 * ⚠️ `comparable=false` 时, 上面的数字**仍然返回** —— 但前端必须挂横幅遮住,
 *   因为跨引擎版本的标签一致率没有解释力 (WP-K 的教训).
 */
export interface AnnotationConsistencyScope {
  /** 批次 id (NULL = 全量口径, 向后兼容). */
  readonly batchId: string | null;
  /** 该口径覆盖的场次数. */
  readonly sessions: number;
  /** 去重后的引擎版本集合 (NULL → '<unknown>'). */
  readonly engineVersions: readonly string[];
  /** 去重后的 prompt 版本集合 (NULL → '<unknown>'). */
  readonly promptVersions: readonly string[];
  /** 是否可比 (false → 前端必须遮住数字). */
  readonly comparable: boolean;
  /** 不可比原因码 (空 = 可比). */
  readonly incomparableReasons: readonly ComparabilityReason[];
  /** 只告警的码 (不影响 comparable). */
  readonly warnings: readonly ComparabilityWarning[];
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
  /** 口径 (V2026-11-11 WP-N). */
  readonly scope: AnnotationConsistencyScope;
}

/**
 * 可标注批次的一行 (V2026-11-11 WP-N).
 */
export interface AnnotationBatchView {
  /** 批次 id (真批次 id, 非合成值). */
  readonly batchId: string;
  /** 批次首场 started_at 的最小值 (ISO; NULL = 未知). */
  readonly createdAt: string | null;
  /** 该批场次数. */
  readonly sessions: number;
  /** status = 'completed' 的场次数. */
  readonly completedSessions: number;
  /** 可进队列的场次数 (可标注判定的四个条件全满足). */
  readonly annotatableSessions: number;
  /** 已有人工标签的场次数 (dominant_label 非 NULL). */
  readonly annotatedSessions: number;
  /** 逐字稿仍在的场次数 (冻结或活文件任一可取). */
  readonly transcriptAvailableSessions: number;
  /** 批次有效性 (NULL = 没有批次行, 无法判定). */
  readonly valid: boolean | null;
  /** 不达标原因码 (拆开存储的逗号串). */
  readonly validityFlags: readonly string[];
  /** 该批引擎版本. */
  readonly engineVersion: string | null;
  /** 该批 prompt 版本. */
  readonly promptVersion: string | null;
  /** 该批配置指纹. */
  readonly configFingerprint: string | null;
}

/**
 * 可标注批次清单响应 (V2026-11-11 WP-N).
 */
export interface AnnotationBatchListResponse {
  /** 批次行 (按 createdAt DESC, batchId ASC 兜底). */
  readonly data: readonly AnnotationBatchView[];
  /** 元信息. */
  readonly meta: {
    /** 生成时刻 (ISO). */
    readonly generatedAt: string;
    /** 返回的批次数. */
    readonly total: number;
  };
  /** 告警码 (如 'INVALID_BATCHES_HIDDEN:4' —— 默认过滤时**必须**报出被隐藏的数量). */
  readonly warnings: readonly string[];
}
