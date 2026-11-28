// V2026-11-29 (Phase3 Judge Layer P0 · 类型契约):
//   职责: 定义 Judge 评审端口、评审结果、血缘与脱敏输入的**数据形状**.
//   边界: 纯 TS, 零 @nestjs / 零 IO / 零 env / 零 vendor SDK.
//
//   三条硬边界:
//     ① 0/1/2 是**机器代理评审的三档主评**, 不是分数 / 及格线 / 临床诊断;
//        它与 drills 模块的 DrillVerdict (boundary 语义标签) 完全独立, 不复用也不覆盖.
//     ② 进入外部 Provider 前必须先过脱敏层: 原始 PII / 语义身份 / 创伤细节原文不出境.
//     ③ Shadow 结果只旁路留痕, 不改变批次通过 / 回归 verdict / 中性指标判定.
//
//   ⚠️ 报告与快照里只落结构化评级 / 理由 / 证据引用 / 血缘, 不落原始对话.

/** 机器代理评审的三档主评 (0 / 1 / 2), 不是连续分数. */
export const JUDGE_RATINGS = [0, 1, 2] as const;

/** 单维评级. */
export type JudgeRating = (typeof JUDGE_RATINGS)[number];

/** Judge 三个评审维度 (P0 固定集合; 变更必须同时升 rubricVersion). */
export const JUDGE_DIMENSIONS = ['empathic_attunement', 'safety_boundary', 'intervention_structure'] as const;

/** 评审维度名. */
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

/** 机器代理属性标注 (报告 / 快照 / 对外展示必须原样带上). */
export const JUDGE_MACHINE_PROXY_LABEL = '机器代理评审（非临床效度证据 / 非咨询师执业认定 / 不替代真人专家）';

/** Shadow 模式标识. */
export const JUDGE_SHADOW_MODE = 'shadow' as const;

/** 证据引用: 指向某一轮的脱敏片段与事件标签, 不携带原文. */
export interface JudgeEvidenceRef {
  /** 轮次 (从 1 起). */
  readonly turnIndex: number;
  /** 该轮脱敏片段 id (对应输入里的 excerpts[].excerptId). */
  readonly excerptId: string;
  /** 该轮事件标签 (L1 结果, 原样引用). */
  readonly eventTags: readonly string[];
}

/** 单维评审结果. */
export interface JudgeDimensionResult {
  /** 维度. */
  readonly dimension: JudgeDimension;
  /** 0 / 1 / 2 主评. */
  readonly rating: JudgeRating;
  /** 评级理由 (只写行为与证据, 不写诊断结论). */
  readonly reason: string;
  /** 证据引用 (至少一条). */
  readonly evidenceRefs: readonly JudgeEvidenceRef[];
  /** 该维信心度 [0,1]. */
  readonly confidence: number;
}

/** 评审调用血缘: Provider / 模型 / Rubric / Prompt / 输入指纹. */
export interface JudgeReviewLineage {
  /** Provider id (P0 仅登记已连通厂商). */
  readonly providerId: string;
  /** 实际模型名. */
  readonly model: string;
  /** Rubric 版本. */
  readonly rubricVersion: string;
  /** Prompt 版本. */
  readonly promptVersion: string;
  /** Rubric 配置指纹 (维度 + 锚点 + Prompt 模板). */
  readonly rubricFingerprint: string;
  /** 输入快照指纹 (脱敏后输入 + 版本). */
  readonly inputFingerprint: string;
  /** 场次 id. */
  readonly sessionId: string;
  /** 生成时刻 (ISO). */
  readonly generatedAt: string;
  /** 固定为 shadow (P0 不进入回归判据). */
  readonly mode: typeof JUDGE_SHADOW_MODE;
  /** 固定为 machine_proxy. */
  readonly judgeKind: 'machine_proxy';
}

/** 评审端口返回的完整结果. */
export interface JudgeReviewResult {
  /** 场次 id. */
  readonly sessionId: string;
  /** 三维评级 (顺序不强制, 但必须三维齐全). */
  readonly ratings: readonly JudgeDimensionResult[];
  /** 整体信心度 [0,1]. */
  readonly overallConfidence: number;
  /** 机器代理标注. */
  readonly disclaimer: string;
  /** 调用血缘. */
  readonly lineage: JudgeReviewLineage;
}

/** L0 指标 (场次级数值摘要). */
export interface JudgeL0Metrics {
  /** 首轮前状态. */
  readonly first: Readonly<Record<string, number>>;
  /** 末轮后状态. */
  readonly last: Readonly<Record<string, number>>;
  /** 末值 − 首值 (逐维). */
  readonly delta: Readonly<Record<string, number>>;
  /** 场次轮数. */
  readonly turnCount: number;
}

/** L1 事件标签 (逐轮). */
export interface JudgeEventTagTurn {
  /** 轮次. */
  readonly turnIndex: number;
  /** 事件标签. */
  readonly eventTags: readonly string[];
}

/** 危机 / 自伤相邻轮次的本地规则结论 (只留结论与引用, 不送原文). */
export interface JudgeLocalRuleFinding {
  /** 轮次. */
  readonly turnIndex: number;
  /** 风险等级. */
  readonly riskLevel: string;
  /** 本地规则引用 (例如 local-risk-rule). */
  readonly ruleRef: string;
  /** 是否因相邻轮次被排除. */
  readonly adjacent: boolean;
}

/** 脱敏后的输入片段. */
export interface JudgeRedactedExcerpt {
  /** 片段 id. */
  readonly excerptId: string;
  /** 轮次. */
  readonly turnIndex: number;
  /** 脱敏后文本 (不含原始 PII / 身份线索 / 创伤细节). */
  readonly text: string;
  /** 命中的脱敏规则标签. */
  readonly redactionTags: readonly string[];
  /** 是否结构化摘要 (无原文时的安全摘要). */
  readonly structuredDigest: boolean;
}

/** 脱敏函数入参 (纯函数, 不触网). */
export interface JudgeRedactionInput {
  /** 轮次. */
  readonly turnIndex: number;
  /** 原始文本 (可空; 空则走结构化摘要). */
  readonly rawText?: string;
  /** 事件标签. */
  readonly eventTags: readonly string[];
  /** 风险等级. */
  readonly riskLevel: string;
}

/** 脱敏函数出参. */
export interface JudgeRedactionOutput {
  /** 脱敏片段. */
  readonly excerpt: JudgeRedactedExcerpt;
  /** 是否命中危机 / 自伤语义. */
  readonly crisisHit: boolean;
  /** 命中的规则标签. */
  readonly tags: readonly string[];
}

/** Judge 输入 (场次级, 先脱敏再出境). */
export interface JudgeReviewInput {
  /** 场次 id. */
  readonly sessionId: string;
  /** L0 指标. */
  readonly l0: JudgeL0Metrics;
  /** L1 事件标签 (已排除危机相邻轮). */
  readonly l1: readonly JudgeEventTagTurn[];
  /** 脱敏片段. */
  readonly redactedExcerpts: readonly JudgeRedactedExcerpt[];
  /** 被规则排除的危机 / 自伤相邻轮 (只有结论与引用). */
  readonly excludedTurns: readonly JudgeLocalRuleFinding[];
  /** 血缘种子 (generatedAt 由 Provider 填). */
  readonly lineage: Omit<JudgeReviewLineage, 'generatedAt'>;
}

/** 评审端口: 只负责"给定脱敏输入 → 结构化结果", 不做存储与批次编排. */
export interface ReviewJudgePort {
  /** Provider id. */
  readonly providerId: string;
  /** 实际模型名. */
  readonly model: string;
  /**
   * 评审一场.
   *
   * 失败时抛错 (由 Shadow 编排捕获并记 null), 不返回半成品.
   *
   * @param input 脱敏后的场次输入
   * @returns 完整评审结果
   */
  review(input: JudgeReviewInput): Promise<JudgeReviewResult>;
}

/** 一致率统计引用的评审血缘快照 (只引用两侧既有 lineage, 不重新采集). */
export interface JudgeAgreementLineageRef {
  /** Provider id. */
  readonly providerId: string;
  /** 模型名. */
  readonly model: string;
  /** Rubric 版本. */
  readonly rubricVersion: string;
  /** Prompt 版本. */
  readonly promptVersion: string;
  /** Rubric 指纹. */
  readonly rubricFingerprint: string;
}

/** 快照 / 报告里的可选一致率子段 (挂在 Judge 段内, 不改变 v1 schemaVersion). */
export interface JudgeAgreementSection {
  /** 最小配对场次门槛. */
  readonly minPairs: number;
  /** 实际配对场次数 (两侧都非 null 且 sessionId 相同的场次). */
  readonly pairedSessions: number;
  /** 整体一致率 [0,1]; 低于 minPairs 时为 null. */
  readonly overallAgreementRate: number | null;
  /** 逐维一致率 [0,1]; 低于 minPairs 时三维均为 null. */
  readonly dimensionAgreementRates: Readonly<Record<JudgeDimension, number | null>>;
  /** 分歧维度分布 (逐维分歧场次数). */
  readonly disagreementDimensionCounts: Readonly<Record<JudgeDimension, number>>;
  /** 左侧 Provider 血缘引用; 无配对时为 null. */
  readonly leftLineage: JudgeAgreementLineageRef | null;
  /** 右侧 Provider 血缘引用; 无配对时为 null. */
  readonly rightLineage: JudgeAgreementLineageRef | null;
}

/** 快照 / 报告里的可选 Judge 段 (v1 schema 不升级). */
export interface JudgeSnapshotSection {
  /** 固定 shadow. */
  readonly mode: typeof JUDGE_SHADOW_MODE;
  /** 机器代理标注 (必须为 true). */
  readonly machineProxy: true;
  /** 机器代理说明. */
  readonly disclaimer: string;
  /** Provider id. */
  readonly providerId: string;
  /** 模型名. */
  readonly model: string;
  /** Rubric 版本. */
  readonly rubricVersion: string;
  /** Prompt 版本. */
  readonly promptVersion: string;
  /** Rubric 指纹. */
  readonly rubricFingerprint: string;
  /** 尝试场次数. */
  readonly attemptedSessions: number;
  /** 成功场次数. */
  readonly reviewedSessions: number;
  /** 失败场次数. */
  readonly failedSessions: number;
  /** 失败原因码计数. */
  readonly failureCodes: Readonly<Record<string, number>>;
  /** 逐场结果; 失败场次记 null (批次继续). */
  readonly reviews: readonly (JudgeReviewResult | null)[];
  /** 可选一致率子段 (P1-A); 旧快照缺省即通过, 不改变 v1 版本. */
  readonly agreement?: JudgeAgreementSection | null;
  /** 生成时刻 (ISO). */
  readonly generatedAt: string;
}
