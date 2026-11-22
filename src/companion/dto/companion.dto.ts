import { ApiProperty } from '@nestjs/swagger';

/**
 * Companion 模块 DTO 集合 — V2.0 §Tab2 陪伴者端陪伴 (大厂 Clean Architecture).
 *
 * 设计:
 *   - 字段 nullable + 默认值兜底, 后端契约变更时不炸前端
 *   - 跟前端 lib/features/companion/data/dto/companion_dtos.dart 1:1 对齐
 *   - 时间字段全 ISO string (前端 dart DateTime.parse)
 *   - enum 字段全 String 字面量 (前端 enum.name 1:1 映射)
 */

// ════════════════════════════════════════════════════════════════
// 枚举常量 (跟前端 enum.name 严格一致)
// ════════════════════════════════════════════════════════════════

export type CompanionRelationKey = 'partner' | 'family' | 'friend' | 'colleague' | 'other';
export type CompanionPermissionLevelKey = 'L1' | 'L2' | 'L3';
export type SoothingCardDirectionKey = 'sent' | 'received';
export type SoothingCardTemplateKey = 'gentle' | 'breathing' | 'grounding' | 'warmth' | 'listening' | 'space';
export type DualSessionStatusKey =
  'idle' | 'invited' | 'partnerAccepted' | 'inProgress' | 'pausedByConflictRisk' | 'completed' | 'declined';
export type RehabItemKindKey = 'medication' | 'appointment' | 'checkin' | 'crisis_followup';
export type CompanionRecordEventTypeKey = 'status_change' | 'exercise' | 'dual' | 'rehab' | 'soothing';
export type AccentColorToken = 'primary' | 'mistyPink' | 'softBlue' | 'mintCyan' | 'warning';

// ════════════════════════════════════════════════════════════════
// 1. 陪伴对象 DTO
// ════════════════════════════════════════════════════════════════

export class CompanionPersonDto {
  @ApiProperty({ description: '被陪伴的人 ID', example: 'person-1' })
  id!: string;

  @ApiProperty({ description: '昵称', example: '小雨' })
  nickname!: string;

  @ApiProperty({ description: '头像 key (前端 entity 用 IconData, 这里透传)', example: 'avatar-rain' })
  avatarKey!: string;

  @ApiProperty({ description: '关系中文标签', example: '伴侣' })
  relationLabel!: string;

  @ApiProperty({ description: '强调色 token', enum: ['primary', 'mistyPink', 'softBlue', 'mintCyan', 'warning'], example: 'mistyPink' })
  accentColorToken!: AccentColorToken;

  @ApiProperty({ enum: ['L1', 'L2', 'L3'], example: 'L3' })
  permissionLevel!: CompanionPermissionLevelKey;

  @ApiProperty({ description: '最近同步时间 ISO string', required: false, nullable: true, example: '2026-08-31T18:00:00Z' })
  lastSyncAt?: string | null;
}

export class CompanionPersonsDto {
  @ApiProperty({ type: [CompanionPersonDto] })
  persons!: CompanionPersonDto[];

  @ApiProperty({ description: '当前激活的陪伴对象 ID', example: 'person-1' })
  activePersonId!: string;
}

export class SwitchPersonRequestDto {
  @ApiProperty({ description: '要切换到的陪伴对象 ID', example: 'person-2' })
  personId!: string;
}

// ════════════════════════════════════════════════════════════════
// 2. 安抚卡片 DTO
// ════════════════════════════════════════════════════════════════

export class SoothingCardDto {
  @ApiProperty({ description: '卡片 ID', example: 'card-uuid-v4' })
  id!: string;

  @ApiProperty({ description: '发送者 UID', example: 'companion-self' })
  fromPersonId!: string;

  @ApiProperty({ description: '接收者 UID', example: 'person-1' })
  toPersonId!: string;

  @ApiProperty({ enum: ['gentle', 'breathing', 'grounding', 'warmth', 'listening', 'space'], example: 'gentle' })
  templateKey!: SoothingCardTemplateKey;

  @ApiProperty({ description: '卡片标题', example: '我在这里' })
  title!: string;

  @ApiProperty({ description: '卡片正文', example: '不需要说什么，我陪着你。' })
  body!: string;

  @ApiProperty({ description: '强调色 token', enum: ['primary', 'mistyPink', 'softBlue', 'mintCyan', 'warning'], example: 'mistyPink' })
  accentColorToken!: AccentColorToken;

  @ApiProperty({ description: '发送时间 ISO string', example: '2026-08-31T14:00:00Z' })
  sentAt!: string;

  @ApiProperty({ enum: ['sent', 'received'], example: 'sent' })
  direction!: SoothingCardDirectionKey;

  @ApiProperty({ description: '已读时间 ISO string (未读时为 null)', required: false, nullable: true, example: '2026-08-31T14:30:00Z' })
  readAt?: string | null;
}

export class SendSoothingCardDto {
  @ApiProperty({ enum: ['gentle', 'breathing', 'grounding', 'warmth', 'listening', 'space'], example: 'gentle' })
  templateKey!: SoothingCardTemplateKey;

  @ApiProperty({ description: '接收者 UID', example: 'person-1' })
  toPersonId!: string;

  @ApiProperty({ description: '正文 (允许用户改写)', example: '不需要说什么，我陪着你。' })
  body!: string;
}

// ════════════════════════════════════════════════════════════════
// 3. 同步练习 DTO
// ════════════════════════════════════════════════════════════════

export class SyncPracticeDto {
  @ApiProperty({ description: '同步练习 ID', example: 'sync.box-breathing' })
  id!: string;

  @ApiProperty({ description: '练习标题', example: '方形呼吸同步' })
  title!: string;

  @ApiProperty({ description: '副标题', example: '4-4-4-4 一起呼吸' })
  subtitle!: string;

  @ApiProperty({ description: '时长 (分钟)', example: 5 })
  durationMinutes!: number;

  @ApiProperty({ enum: ['partner', 'family', 'friend', 'other'], example: 'partner' })
  relation!: CompanionRelationKey;

  @ApiProperty({ description: '强调色 token', enum: ['primary', 'mistyPink', 'softBlue', 'mintCyan', 'warning'], example: 'mintCyan' })
  accentColorToken!: AccentColorToken;

  @ApiProperty({ description: '步骤说明 (用户 + 陪伴者各一行)', example: ['我方：描述节奏', '对方：跟随节奏'], type: [String] })
  steps!: string[];

  @ApiProperty({ description: '图标 key (前端 enum → IconData)', example: 'crop_square_outlined' })
  iconKey!: string;
}

// ════════════════════════════════════════════════════════════════
// 4. 双人协同 DTO
// ════════════════════════════════════════════════════════════════

export class DualExerciseDto {
  @ApiProperty({ description: '练习 ID', example: 'dual.partner.attach-repair' })
  id!: string;

  @ApiProperty({ description: '练习标题', example: '依恋修复五步法' })
  title!: string;

  @ApiProperty({ description: '副标题', example: '重建安全感的结构化练习' })
  subtitle!: string;

  @ApiProperty({ description: '适配关系列表', example: ['partner'], type: [String] })
  relation!: string[];

  @ApiProperty({ enum: ['narrative', 'communication', 'defusion', 'boundary'], example: 'narrative' })
  modality!: string;

  @ApiProperty({ description: '预估时长 (分钟)', example: 30 })
  estimatedMinutes!: number;

  @ApiProperty({ description: '步骤说明', example: ['我方：描述最近一次情绪触发的场景', '对方：复述听到的内容, 不评论'], type: [String] })
  steps!: string[];

  @ApiProperty({ description: '风险护栏', example: ['任何一方感到受伤可暂停', '不做关系评判'], type: [String] })
  guardrails!: string[];

  @ApiProperty({ description: '强调色 token', enum: ['primary', 'mistyPink', 'softBlue', 'mintCyan', 'warning'], example: 'mistyPink' })
  accentColorToken!: AccentColorToken;

  @ApiProperty({ description: '图标 key (前端 enum → IconData)', example: 'favorite_outline' })
  iconKey!: string;
}

export class DualSessionDto {
  @ApiProperty({ description: '会话 ID', example: 'session-uuid-v4' })
  sessionId!: string;

  @ApiProperty({ description: '练习 ID', example: 'dual.partner.attach-repair' })
  exerciseId!: string;

  @ApiProperty({
    enum: ['idle', 'invited', 'partnerAccepted', 'inProgress', 'pausedByConflictRisk', 'completed', 'declined'],
    example: 'invited',
  })
  status!: DualSessionStatusKey;

  @ApiProperty({ description: '开始时间 ISO string', example: '2026-09-01T12:00:00Z' })
  startedAt!: string;

  @ApiProperty({ description: '完成的步骤 index 列表', example: [1, 2], type: [Number] })
  completedSteps!: number[];

  @ApiProperty({ description: '会话笔记', required: false, nullable: true })
  notes?: string | null;
}

export class StartDualSessionDto {
  @ApiProperty({ description: '双人练习 ID', example: 'dual.partner.attach-repair' })
  exerciseId!: string;

  @ApiProperty({ description: '对方 UID (被陪伴的成长用户)', example: 'person-1' })
  ownerUid!: string;
}

export class UpdateDualSessionDto {
  @ApiProperty({
    enum: ['idle', 'invited', 'partnerAccepted', 'inProgress', 'pausedByConflictRisk', 'completed', 'declined'],
    example: 'inProgress',
  })
  status!: DualSessionStatusKey;

  @ApiProperty({ description: '已完成步骤 index (可选)', required: false, nullable: true, example: 1 })
  completedStep?: number | null;

  @ApiProperty({ description: '笔记 (可选)', required: false, nullable: true })
  notes?: string | null;
}

// ════════════════════════════════════════════════════════════════
// 5. 康复协同 DTO (L3)
// ════════════════════════════════════════════════════════════════

export class RehabItemDto {
  @ApiProperty({ description: '康复项 ID', example: 'rehab-uuid-v4' })
  id!: string;

  @ApiProperty({ description: '标题', example: '周三复诊提醒 · 上海市精神卫生中心' })
  title!: string;

  @ApiProperty({ enum: ['medication', 'appointment', 'checkin', 'crisis_followup'], example: 'appointment' })
  kind!: RehabItemKindKey;

  @ApiProperty({ description: '截止时间 ISO string', example: '2026-09-03T16:00:00Z' })
  dueAt!: string;

  @ApiProperty({ description: '关联成长用户 UID', example: 'person-1' })
  relatedPersonId!: string;

  @ApiProperty({ description: '完成时间 ISO string (未完成时为 null)', required: false, nullable: true, example: null })
  completedAt?: string | null;

  @ApiProperty({ description: '备注', required: false, nullable: true })
  note?: string | null;
}

// ════════════════════════════════════════════════════════════════
// 6. 陪伴记录 DTO
// ════════════════════════════════════════════════════════════════

export class CompanionRecordDto {
  @ApiProperty({ description: '记录 ID', example: 'record-uuid-v4' })
  id!: string;

  @ApiProperty({ description: '关联成长用户 UID', example: 'person-1' })
  relatedPersonId!: string;

  @ApiProperty({ enum: ['status_change', 'exercise', 'dual', 'rehab', 'soothing'], example: 'soothing' })
  eventType!: CompanionRecordEventTypeKey;

  @ApiProperty({ description: '摘要', example: '发送安抚卡片「我在这里」, 已读' })
  summary!: string;

  @ApiProperty({ description: '发生时间 ISO string', example: '2026-08-31T14:00:00Z' })
  occurredAt!: string;

  @ApiProperty({ description: '关联工具 ID', required: false, nullable: true })
  toolId?: string | null;

  @ApiProperty({ description: '关联双人练习 ID', required: false, nullable: true })
  dualExerciseId?: string | null;

  @ApiProperty({ description: '关联康复项 ID', required: false, nullable: true })
  rehabItemId?: string | null;
}

// ════════════════════════════════════════════════════════════════
// 7. AI 辅助指引 DTO
// ════════════════════════════════════════════════════════════════

export class AiGuideTipDto {
  @ApiProperty({ description: '指引 ID', example: 'tip-1' })
  id!: string;

  @ApiProperty({ description: '标题', example: '对方在做 AI 练习时, 我该做什么?' })
  title!: string;

  @ApiProperty({ description: '副标题', example: '陪伴者配合基础' })
  subtitle!: string;

  @ApiProperty({ description: '正文', example: '给对方一个安静不被打扰的环境...' })
  body!: string;

  @ApiProperty({ description: '图标 key (前端 enum → IconData)', example: 'hearing_outlined' })
  iconKey!: string;

  @ApiProperty({ description: '最低权限等级 (低于此权限不展示)', enum: ['L1', 'L2', 'L3'], example: 'L1' })
  minimumLevel!: CompanionPermissionLevelKey;
}

// ════════════════════════════════════════════════════════════════
// 8. 关系管理 DTO (复用 profile/CompanionBinding entity)
// ════════════════════════════════════════════════════════════════

export class RelationEntryDto {
  @ApiProperty({ description: '关系 ID', example: 'rel-uuid-v4' })
  id!: string;

  @ApiProperty({ description: '对方 UID', example: 'person-1' })
  personId!: string;

  @ApiProperty({ enum: ['partner', 'family', 'friend', 'other'], example: 'partner' })
  relation!: CompanionRelationKey;

  @ApiProperty({ description: '绑定时间 ISO string', example: '2026-01-01T00:00:00Z' })
  boundAt!: string;

  @ApiProperty({ enum: ['L1', 'L2', 'L3'], example: 'L3' })
  permissionLevel!: CompanionPermissionLevelKey;

  @ApiProperty({ description: '备注', required: false, nullable: true, example: 'L3 信任建立 8 个月' })
  remark?: string | null;
}

export class AdjustRelationPermissionDto {
  @ApiProperty({ enum: ['L1', 'L2', 'L3'], example: 'L2' })
  level!: CompanionPermissionLevelKey;
}
