import { ApiProperty } from '@nestjs/swagger';

/**
 * Practice 模块 DTO 集合 — V2.0 §Tab2 练习 (大厂 Clean Architecture).
 *
 * 设计:
 *   - 字段 nullable + 默认值兜底, 后端契约变更时不炸前端
 *   - 跟前端 lib/features/practice/data/dto/practice_dtos.dart 1:1 对齐
 *   - 时间字段全 ISO string (前端 dartz / dart DateTime.parse)
 *   - enum 字段全 String 字面量, 前端 enum.fromKey() 容错映射
 *
 * 大厂做法:
 *   - DTO 跟 entity 解耦: DTO 是 API 契约 (可空 + 默认), entity 是持久化结构 (NOT NULL)
 *   - 转换由 Service 完成 (避免 controller 写业务逻辑)
 */

// ════════════════════════════════════════════════════════════════
// 枚举常量 (跟前端 PracticeCategoryId / GymModule / PracticeEvidence / EmbodiedToolKind 严格一致)
// ════════════════════════════════════════════════════════════════

/** 8 大分类. */
export const PRACTICE_CATEGORY_KEYS = [
  'emotion_emergency', // 情绪急救
  'cbt', // CBT 认知
  'act', // ACT 接纳
  'mindfulness', // 正念调节
  'dbt', // DBT 技能
  'development', // 发展成长
  'gym', // 心理健身
  'embodied', // 具身认知
] as const;
export type PracticeCategoryKey = (typeof PRACTICE_CATEGORY_KEYS)[number];

/** 4 大训练模块 (跟 shared/types/practice.types GYM_MODULES 一致). */
export const GYM_MODULE_KEYS = [
  'physical_basics', // 基础体能训练 (原 basicStamina)
  'cognitive_muscle', // 认知肌肉训练 (原 cognitiveMuscle)
  'self_esteem_gain', // 自尊增肌训练 (原 selfEsteemMuscle)
  'interpersonal_efficacy', // 人际效能训练 (原 interpersonalMuscle)
] as const;
export type GymModuleKey = (typeof GYM_MODULE_KEYS)[number];

/** 训练阶段 (跟前端 GymStage enum 一致). */
export const GYM_STAGE_KEYS = ['foundation', 'intermediate', 'advanced'] as const;
export type GymStageKey = (typeof GYM_STAGE_KEYS)[number];

/** 循证等级 (跟前端 PracticeEvidence enum 一致). */
export const PRACTICE_EVIDENCE_KEYS = ['cbt', 'act', 'dbt', 'mindfulness', 'growth', 'embodied'] as const;
export type PracticeEvidenceKey = (typeof PRACTICE_EVIDENCE_KEYS)[number];

/** 具身认知工具分类. */
export const EMBODIED_TOOL_KIND_KEYS = ['heartRegulation', 'somaticRelaxation', 'actionAnchor', 'hrvTraining'] as const;
export type EmbodiedToolKindKey = (typeof EMBODIED_TOOL_KIND_KEYS)[number];

/** 具身认知授权状态 (跟前端 EmbodiedAuthStatus enum.name 一致). */
export const EMBODIED_AUTH_STATUS_KEYS = ['notRequested', 'authorized', 'denied', 'partial'] as const;
export type EmbodiedAuthStatusKey = (typeof EMBODIED_AUTH_STATUS_KEYS)[number];

/** 渐进解锁状态 (前端 PracticeCategory.locked / unlockProgress 字段). */
export type UnlockStatusDto = 'unlocked' | 'locking' | 'locked';

// ════════════════════════════════════════════════════════════════
// 1. 分类 DTO
// ════════════════════════════════════════════════════════════════

export class PracticeCategoryDto {
  @ApiProperty({ enum: PRACTICE_CATEGORY_KEYS, example: 'emotion_emergency' })
  id!: PracticeCategoryKey;

  @ApiProperty({ description: '中文标签', example: '情绪急救' })
  label!: string;

  @ApiProperty({ description: '分类描述', example: '难受时打开的快速锚定工具包' })
  description!: string;

  @ApiProperty({ description: 'Material icon 名 (前端 enumFromKey 解析)', example: 'sos_outlined' })
  icon!: string;

  @ApiProperty({ description: '该分类下工具数量', example: 5 })
  toolCount!: number;

  @ApiProperty({ description: '辅助色 token', enum: ['primary', 'mistyPink', 'softBlue', 'mintCyan'], example: 'mistyPink' })
  accentColorToken!: 'primary' | 'mistyPink' | 'softBlue' | 'mintCyan';

  @ApiProperty({ description: '解锁状态', enum: ['unlocked', 'locking', 'locked'], example: 'unlocked' })
  unlockStatus!: UnlockStatusDto;

  @ApiProperty({ description: '锁定原因 (locked 状态展示)', required: false, nullable: true })
  lockedReason?: string | null;

  @ApiProperty({ description: '解锁进度 0-1 (locking 状态展示)', required: false, nullable: true, example: 0.5 })
  unlockProgress?: number | null;
}

// ════════════════════════════════════════════════════════════════
// 2. 工具 DTO
// ════════════════════════════════════════════════════════════════

export class PracticeToolDto {
  @ApiProperty({ description: '全局唯一 ID (snake_case, 跟前端 entity 1:1)', example: 'emergency.5-4-3-2-1' })
  id!: string;

  @ApiProperty({ enum: PRACTICE_CATEGORY_KEYS, example: 'emotion_emergency' })
  categoryId!: PracticeCategoryKey;

  @ApiProperty({ description: '工具名称', example: '5-4-3-2-1 接地法' })
  title!: string;

  @ApiProperty({ description: '副标题', example: '焦虑发作时的快速锚定' })
  subtitle!: string;

  @ApiProperty({ description: '长描述 (执行页 intro 用)', example: '通过五感依次回到当下' })
  description!: string;

  @ApiProperty({ description: 'Material icon 名', example: 'sos_outlined' })
  icon!: string;

  @ApiProperty({ description: '建议时长 (分钟)', example: 3 })
  durationMinutes!: number;

  @ApiProperty({ description: '难度 1-3', example: 1 })
  difficulty!: number;

  @ApiProperty({ enum: PRACTICE_EVIDENCE_KEYS, example: 'mindfulness' })
  evidenceLevel!: PracticeEvidenceKey;

  @ApiProperty({ description: '跳转路由', example: '/practice/tool/emergency.5-4-3-2-1' })
  routePath!: string;

  @ApiProperty({ description: '标签', example: ['急救', '入门'], type: [String] })
  tags!: string[];

  @ApiProperty({ description: '是否提供趣味模式', example: true })
  hasFunMode!: boolean;

  @ApiProperty({ description: '解锁提示 (locked 时)', required: false, nullable: true })
  unlockHint?: string | null;
}

// ════════════════════════════════════════════════════════════════
// 3. 练习会话 DTO
// ════════════════════════════════════════════════════════════════

export class StartSessionDto {
  @ApiProperty({ description: '工具 ID', example: 'emergency.5-4-3-2-1' })
  toolId!: string;

  @ApiProperty({ description: '目标时长 (分钟)', example: 5 })
  targetDurationMinutes!: number;
}

export class PracticeSessionDto {
  @ApiProperty({ description: '会话 ID (后端生成)', example: 'session-uuid-v4' })
  id!: string;

  @ApiProperty({ description: '工具 ID', example: 'emergency.5-4-3-2-1' })
  toolId!: string;

  @ApiProperty({ description: '开始时间 ISO string', example: '2026-09-01T12:00:00Z' })
  startedAt!: string;

  @ApiProperty({ description: '目标时长 (分钟)', example: 5 })
  targetDurationMinutes!: number;
}

export class CompleteSessionDto {
  @ApiProperty({ description: '实际时长 (秒)', example: 300 })
  actualDurationSeconds!: number;
}

export class PracticeFeedbackDto {
  @ApiProperty({ description: '工具标题', example: '5-4-3-2-1 接地法' })
  toolTitle!: string;

  @ApiProperty({ description: '实际时长 (分钟)', example: 5 })
  durationMinutes!: number;

  @ApiProperty({ description: '获得的碎片 (例: ["平静气泡 x3"])', example: ['平静气泡 x3'] })
  unlockedFragments!: string[];

  @ApiProperty({ description: '解锁的徽章', required: false, nullable: true, example: '呼吸初学者' })
  unlockedBadge?: string | null;

  @ApiProperty({ description: '软反馈 (例: "你做到了")', example: '你做到了' })
  softNote!: string;
}

// ════════════════════════════════════════════════════════════════
// 4. 心理健身房 DTO
// ════════════════════════════════════════════════════════════════

export class GymWeeklyPlanDto {
  @ApiProperty({ description: '周次 (1-12)', example: 1 })
  weekNumber!: number;

  @ApiProperty({ enum: GYM_STAGE_KEYS, example: 'foundation' })
  stage!: GymStageKey;

  @ApiProperty({ enum: GYM_MODULE_KEYS, example: 'physical_basics' })
  module!: GymModuleKey;

  @ApiProperty({ description: '本周主题', example: '呼吸入门' })
  title!: string;

  @ApiProperty({ description: '本周目标', example: ['每天 1 次 3 分钟呼吸'], type: [String] })
  goals!: string[];

  @ApiProperty({ description: '本周推荐工具 ID 列表', example: ['mindfulness.box-breathing'], type: [String] })
  tools!: string[];
}

export class GymCurrentPlanDto {
  @ApiProperty({ enum: GYM_STAGE_KEYS, example: 'foundation' })
  stage!: GymStageKey;

  @ApiProperty({ description: '本周已完成次数', example: 2 })
  completedThisWeek!: number;

  @ApiProperty({ description: '本周目标次数', example: 5 })
  weeklyTarget!: number;

  @ApiProperty({ description: '累计完成次数', example: 12 })
  totalCompleted!: number;

  @ApiProperty({ description: '累计时长 (分钟)', example: 186 })
  totalMinutes!: number;

  @ApiProperty({ type: [GymWeeklyPlanDto] })
  weeklyPlans!: GymWeeklyPlanDto[];
}

export class GymDimensionDto {
  @ApiProperty({ description: '维度 ID', example: 'security' })
  id!: string;

  @ApiProperty({ description: '维度名称', example: '安全感' })
  label!: string;

  @ApiProperty({ description: '分数 0-1', example: 0.72 })
  score!: number;

  @ApiProperty({ description: '档位标签', example: '稳定' })
  tier!: string;

  @ApiProperty({ description: '优势说明', example: '信任建立稳定' })
  strength!: string;

  @ApiProperty({ description: '提升建议', example: '在压力情境下可能激活不安全反应' })
  improvement!: string;
}

export class GymGenomeReportDto {
  @ApiProperty({ type: [GymDimensionDto] })
  dimensions!: GymDimensionDto[];

  @ApiProperty({ description: '综合解读', example: '整体心理健康底座稳定' })
  summary!: string;

  @ApiProperty({ description: '推荐工具 ID 列表', example: ['cbt.thought-record'], type: [String] })
  recommendedTools!: string[];
}

export class CoreStuckPointDto {
  @ApiProperty({ example: 'stuck.people-pleasing' })
  id!: string;

  @ApiProperty({ description: '卡点名称', example: '讨好型模式' })
  label!: string;

  @ApiProperty({ description: '形成阶段', example: '童年早期' })
  formationStage!: string;

  @ApiProperty({ description: '影响等级 1-3', example: 2 })
  impactLevel!: number;

  @ApiProperty({ description: '根源解释', example: '童年通过压抑需求获得认可' })
  rootCause!: string;

  @ApiProperty({ description: '趣味模式怪兽 key', required: false, nullable: true, example: 'people_pleaser_slime' })
  creatureKey?: string | null;
}

export class ReshapeWeeklyTaskDto {
  @ApiProperty({ description: '周次 (1-4)', example: 1 })
  weekNumber!: number;

  @ApiProperty({ description: '关联卡点 ID', example: 'stuck.people-pleasing' })
  stuckPointId!: string;

  @ApiProperty({ description: '任务标题', example: '认识它 — 叙事重构' })
  title!: string;

  @ApiProperty({ enum: ['narrative', 'imagery', 'exposure', 'communication'], example: 'narrative' })
  modality!: 'narrative' | 'imagery' | 'exposure' | 'communication';

  @ApiProperty({ description: '任务摘要', example: '用第三人称写下讨好型模式的故事' })
  summary!: string;
}

export class TargetedReshapeDto {
  @ApiProperty({ type: [CoreStuckPointDto] })
  stuckPoints!: CoreStuckPointDto[];

  @ApiProperty({ type: [ReshapeWeeklyTaskDto] })
  weeklyTasks!: ReshapeWeeklyTaskDto[];

  @ApiProperty({ description: '已完成周数', example: 0 })
  completedWeekCount!: number;

  @ApiProperty({ description: '松动度自评 0-1', example: 0.15 })
  loosenessScore!: number;
}

export class GymRecordEntryDto {
  @ApiProperty({ description: '记录 ID', example: 'record-uuid-v4' })
  id!: string;

  @ApiProperty({ description: '工具 ID', example: 'mindfulness.box-breathing' })
  toolId!: string;

  @ApiProperty({ description: '工具标题', example: '方形呼吸法' })
  toolTitle!: string;

  @ApiProperty({ enum: GYM_MODULE_KEYS, example: 'physical_basics' })
  module!: GymModuleKey;

  @ApiProperty({ description: '时长 (分钟)', example: 5 })
  durationMinutes!: number;

  @ApiProperty({ description: '完成时间 ISO string', example: '2026-09-01T08:00:00Z' })
  completedAt!: string;
}

// ════════════════════════════════════════════════════════════════
// 5. 具身认知 DTO (代理 /profile/embodied-data, 不重复实现)
// ════════════════════════════════════════════════════════════════

export class EmbodiedVitalsDto {
  @ApiProperty({ description: '心率 (bpm)', example: 72 })
  heartRateBpm!: number;

  @ApiProperty({ description: 'HRV (ms)', example: 48.3 })
  hrvMs!: number;

  @ApiProperty({ description: '呼吸频率 (次/分钟)', example: 14.5 })
  respirationRatePerMin!: number;

  @ApiProperty({ description: '采集时间 ISO string', example: '2026-09-01T12:00:00Z' })
  capturedAt!: string;
}

export class EmbodiedAuthStatusDto {
  @ApiProperty({ enum: EMBODIED_AUTH_STATUS_KEYS, example: 'authorized' })
  status!: EmbodiedAuthStatusKey;

  @ApiProperty({ description: '授权时间 ISO string (未授权时为 null)', required: false, nullable: true, example: '2026-09-01T12:00:00Z' })
  authorizedAt?: string | null;

  @ApiProperty({ description: '拒绝原因 (denied 时展示)', required: false, nullable: true })
  deniedReason?: string | null;
}

export class EmbodiedToolDto {
  @ApiProperty({ description: '工具 ID', example: 'embodied.heart-regulation' })
  id!: string;

  @ApiProperty({ enum: EMBODIED_TOOL_KIND_KEYS, example: 'heartRegulation' })
  kind!: EmbodiedToolKindKey;

  @ApiProperty({ description: '工具标题', example: '心率同步呼吸' })
  title!: string;

  @ApiProperty({ description: '副标题', example: '跟随心率节律调节呼吸' })
  subtitle!: string;

  @ApiProperty({ description: '时长 (分钟)', example: 8 })
  durationMinutes!: number;

  @ApiProperty({ description: '是否需要传感器', example: true })
  requiresSensor!: boolean;

  @ApiProperty({ description: '长描述', example: '通过呼吸节奏与心率变异性联动' })
  description!: string;

  @ApiProperty({ description: '跳转路由', example: '/practice/embodied/session/heart-regulation' })
  routePath!: string;
}

export class RequestEmbodiedAuthDto {
  @ApiProperty({
    description: '授权请求来源 (例如 os_healthkit / os_google_fit / os_health_connect)',
    example: 'os_health_connect',
    required: false,
  })
  source?: string;
}

export class EmbodiedFeedbackDto {
  @ApiProperty({ description: '会话 ID', example: 'session-uuid-v4' })
  sessionId!: string;

  @ApiProperty({ description: '心率恢复速度 (从峰值到静息态的下降 bpm)', example: 18 })
  heartRateRecoveryBpm!: number;

  @ApiProperty({ description: 'HRV 变化 (ms)', example: 6.2 })
  hrvDeltaMs!: number;

  @ApiProperty({ description: '放松程度 0-1', example: 0.78 })
  relaxationScore!: number;

  @ApiProperty({ description: '反馈摘要', example: '副交感神经激活明显' })
  summary!: string;
}
