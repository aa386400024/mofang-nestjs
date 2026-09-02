import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { HOME_EMOTION_LEVELS, HOME_TIME_SLOTS, type HomeEmotionLevel, type HomeTimeSlot } from '../home.constants';

/**
 * 首页综合快照 DTO — GET /home/overview 返回.
 *
 * 大厂 immutable snapshot 设计 (跟前端 HomeOverview entity 一一对应):
 *   - 一次性聚合首页渲染所需数据 (greeting / mood / 微干预 / 推荐 / 陪伴者 / 未读)
 *   - 字段全 nullable 友好 (后端部分字段可空)
 *   - 子 DTO 通过 @ApiProperty 校验, 嵌套对象失败 → 400
 *
 * 重要: 字段顺序跟前端 entity 一致, 改字段必须同步两端.
 *
 * 排版约定: 子 DTO 先声明, 父 DTO 后声明 (避免 TS6133 "used before declaration").
 */

// ════════════════════════════════════════════════════════════════════════════
// 1. 子 DTO (子先, 父后)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 推荐 DTO — see DESIGN.md V2.0 §3 (Tab1 今日推荐).
 *
 * 匹配维度:
 *   1. 当前情绪档位 — crisis 推「接地」, okay 推「成长」, great 推「巩固」
 *   2. 心理画像 (安全感 / 自尊 / 自主性) — 推对应发展工具
 *   3. 今日时段 (早 / 中 / 晚 / 夜)
 */
export class TodayRecommendationDto {
  @ApiProperty({ description: '推荐 id (来自练习 / 工具表)', example: 'rec-grounding-54321' })
  id!: string;

  @ApiProperty({ description: '工具名称', example: '5-4-3-2-1 接地法' })
  title!: string;

  @ApiProperty({ description: '工具副标题 / 一句话描述', example: '用 5 感回到当下, 把漂浮的感觉拉回地面' })
  summary!: string;

  @ApiProperty({ description: '时长 (分钟)', example: 5 })
  durationMinutes!: number;

  @ApiProperty({ description: '适合场景', example: '情绪失控时' })
  scenario!: string;

  @ApiProperty({ description: '为什么推荐这个 (透明化推荐理由)', example: '听起来你正在难受, 这套方法能帮大脑暂时「着陆」' })
  matchedReason!: string;

  @ApiProperty({ description: '推荐类型', enum: ['breathing_and_mindfulness', 'cbt', 'act', 'growth', 'embodied'] })
  kind!: 'breathing_and_mindfulness' | 'cbt' | 'act' | 'growth' | 'embodied';

  /** 落地页路由 — 后端拼好, 前端直接 push. */
  @ApiProperty({ description: '落地页 deep link (后端拼好, 前端 router.push)', example: '/tools/breathing' })
  routePath!: string;
}

/**
 * 微干预 DTO — see DESIGN.md V2.0 §3 + §6 (场景化微干预卡片).
 */
export class MicroInterventionDto {
  @ApiProperty({ description: '微干预 id (来自练习 / 工具表)', example: 'mi-night-anchor' })
  id!: string;

  @ApiProperty({ description: '显示标题', example: '睡前的 30 秒平稳' })
  title!: string;

  @ApiProperty({ description: '时长 (秒)', example: 30 })
  durationSeconds!: number;

  @ApiProperty({ description: '微干预类型', enum: ['breathing', 'grounding', 'cognitive_defusion', 'self_talk'] })
  kind!: 'breathing' | 'grounding' | 'cognitive_defusion' | 'self_talk';

  @ApiProperty({ description: '副描述 (单行, 详情页用)' })
  description!: string;

  @ApiProperty({ description: 'CTA 按钮文案', example: '开始 30 秒' })
  cta!: string;

  @ApiProperty({ description: '触发场景 (用于埋点 + 设置页)', example: 'before_sleep' })
  trigger!:
    'before_meeting' | 'before_social' | 'before_sleep' | 'after_argument' | 'scrolling_anxiety' | 'late_night' | 'waking_up_anxious';

  /** 落地页路由. */
  @ApiProperty({ description: '落地页 deep link', example: '/micro-intervention/execute' })
  routePath!: string;
}

/**
 * 陪伴者档案 (轻量版, 首页列表用) — 跟前端 SupportCompanion entity 一一对应.
 *
 * 大厂设计要点:
 *   - 状态字段走 enum (L1 / L2 / L3) — 对应「权限等级」语义
 *   - 关系字段走 enum (家属 / 朋友 / 恋人 / 同事) — 关系中台统一标签
 *   - 不在 DTO 里出现「完整关系档案」字段 (避免 entity 膨胀)
 */
export class SupportCompanionDto {
  @ApiProperty({ description: '绑定 id' })
  id!: string;

  @ApiProperty({ description: '陪伴者昵称 (用户给陪伴者起的爱称, 不是真实姓名)' })
  nickname!: string;

  @ApiProperty({ description: '头像 emoji (用户可选头像, 用 emoji 不引入图片依赖)' })
  avatarEmoji!: string;

  @ApiProperty({ description: '关系类型', enum: ['family', 'friend', 'partner', 'colleague', 'other'] })
  relation!: 'family' | 'friend' | 'partner' | 'colleague' | 'other';

  @ApiProperty({ description: '权限等级', enum: ['L1', 'L2', 'L3'] })
  permissionLevel!: 'L1' | 'L2' | 'L3';

  @ApiProperty({ description: '最近活跃时间 (UTC ISO)', nullable: true })
  lastActiveAt!: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 父 DTO (最后声明, 引用前面的子 DTO)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 首页综合快照 (父 DTO).
 */
export class HomeOverviewDto {
  @ApiProperty({ description: '用户昵称 (来自 session / profile)', nullable: true })
  nickname!: string;

  @ApiProperty({ description: '用户头像 URL (陪者陪伴者头像 + emoji 之外的另一路径)', nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ description: '当前角色', enum: ['growth_user', 'companion'] })
  currentRole!: 'growth_user' | 'companion';

  @ApiProperty({ description: '时段 (dawn/morning/noon/afternoon/evening/night)' })
  timeSlot!: HomeTimeSlot;

  @ApiProperty({ description: '时段问候 (e.g.「晚上好」)', example: '晚上好' })
  greeting!: string;

  @ApiProperty({ description: '日期标签 (e.g.「11 月 18 日 · 周二」)', example: '11 月 18 日 · 周二' })
  dateLabel!: string;

  @ApiProperty({ description: '今日情绪档位 (最后一次打卡, null = 还没选过)', enum: HOME_EMOTION_LEVELS, nullable: true })
  emotionLevel!: HomeEmotionLevel | null;

  @ApiProperty({ description: '今日情绪备注 (最后一次打卡)', nullable: true })
  emotionNote!: string | null;

  @ApiProperty({ description: '今日情绪记录时间 (UTC ISO)', nullable: true })
  emotionLoggedAt!: string | null;

  @ApiProperty({ description: '当前激活的微干预 (默认 null, 仅在场景触发时设置)', nullable: true, type: MicroInterventionDto })
  activeMicroIntervention!: MicroInterventionDto | null;

  @ApiProperty({ description: '待触发的微干预 (在「今日推荐」下方, 用户可手动展开)', nullable: true, type: MicroInterventionDto })
  pendingMicroIntervention!: MicroInterventionDto | null;

  @ApiProperty({ description: '今日智能推荐', type: TodayRecommendationDto })
  todayRecommendation!: TodayRecommendationDto;

  @ApiProperty({ description: '已绑定陪伴者 (上限 3, 超出由前端折叠)', type: [SupportCompanionDto] })
  companions!: SupportCompanionDto[];

  @ApiProperty({ description: '陪伴者总数 (超出 3 部分前端折叠)', example: 5 })
  companionsTotal!: number;

  @ApiProperty({ description: '未读消息数 (顶部消息入口红点)', example: 0 })
  unreadMessageCount!: number;
}

/**
 * 推荐查询 DTO — GET /home/recommendation/today.
 *
 * V2.0 设计: 把当前情绪档位作为 query 参数传入, 让后端做智能匹配.
 * 后续 V3 接 emotion_logs 表后, 这个参数变成可选 (后端从表里读最新一条).
 */
export class RecommendationQueryDto {
  @ApiProperty({ description: '当前情绪档位 (前端从 EmotionBloc 注入)', required: false, enum: HOME_EMOTION_LEVELS })
  @IsOptional()
  @IsString()
  @IsIn(HOME_EMOTION_LEVELS)
  emotionLevel?: HomeEmotionLevel;
}

/**
 * 微干预查询 DTO — GET /home/micro-intervention/active.
 *
 * 服务端根据当前时间 + 用户最近行为 + emotion level 决定返回哪一条.
 */
export class MicroInterventionQueryDto {
  @ApiProperty({ description: '当前情绪档位 (前端从 EmotionBloc 注入)', required: false, enum: HOME_EMOTION_LEVELS })
  @IsOptional()
  @IsString()
  @IsIn(HOME_EMOTION_LEVELS)
  emotionLevel?: HomeEmotionLevel;

  @ApiProperty({ description: '客户端时区 (e.g. Asia/Shanghai)', required: false, example: 'Asia/Shanghai' })
  @IsOptional()
  @IsString()
  clientTimezone?: string;
}

/**
 * 微干预 start / complete / dismiss 请求 DTO.
 */
export class MicroInterventionActionDto {
  @ApiProperty({ description: '前端时间戳 (用于 SLO 监控), required: false', example: '2026-08-31T21:34:00.000Z' })
  @IsOptional()
  @IsString()
  clientTimestamp?: string;
}

export class MicroInterventionCompleteDto extends MicroInterventionActionDto {
  @ApiProperty({ description: '是否完成 (false = 中途退出)', example: true })
  completed!: boolean;

  @ApiProperty({ description: '实际执行时长 (秒)', required: false, example: 32 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  durationSeconds?: number;
}

/**
 * 微干预 start 响应 DTO.
 */
export class MicroInterventionStartResponseDto {
  @ApiProperty({ description: '微干预 id' })
  interventionId!: string;

  @ApiProperty({ description: '本次执行 session id (complete 时回传)' })
  sessionId!: string;

  @ApiProperty({ description: '开始时间 (UTC ISO)' })
  startedAt!: string;

  @ApiProperty({ description: '落地页 deep link' })
  routePath!: string;
}

/**
 * 微干预 complete 响应 DTO.
 */
export class MicroInterventionCompleteResponseDto {
  @ApiProperty({ description: '本次执行 session id' })
  sessionId!: string;

  @ApiProperty({ description: '是否完成' })
  completed!: boolean;

  @ApiProperty({ description: '完成时间 (UTC ISO)' })
  completedAt!: string;

  @ApiProperty({ description: '执行时长 (秒)' })
  durationSeconds!: number;

  @ApiProperty({ description: '反馈文案 (无评判, 仅记录)' })
  feedbackCopy!: string;
}

/**
 * 微干预配置 DTO — see DESIGN §1.5「场景化微干预植入系统」.
 */
export class MicroInterventionSettingsDto {
  @ApiProperty({ description: '总开关' })
  masterEnabled!: boolean;

  @ApiProperty({ description: '灵敏度', enum: ['low', 'medium', 'high'] })
  sensitivity!: 'low' | 'medium' | 'high';

  @ApiProperty({ description: '已启用的触发场景', type: [String] })
  enabledTriggers!: string[];

  @ApiProperty({ description: '静默时段开始 (HH:mm)', example: '22:00' })
  quietStart!: string;

  @ApiProperty({ description: '静默时段结束 (HH:mm)', example: '08:00' })
  quietEnd!: string;
}

/**
 * 微干预 active 响应 DTO.
 */
export class MicroInterventionActiveResponseDto {
  @ApiProperty({ description: '当前激活 (顶部置顶展示)', type: MicroInterventionDto, nullable: true })
  active!: MicroInterventionDto | null;

  @ApiProperty({ description: '待触发 (在今日推荐下方, 用户可手动展开)', type: MicroInterventionDto, nullable: true })
  pending!: MicroInterventionDto | null;
}

/**
 * 消息未读数响应 DTO — GET /home/messages/unread-count.
 */
export class UnreadMessageCountDto {
  @ApiProperty({ description: '当前未读消息数', example: 0 })
  count!: number;
}

/**
 * 标记消息已读请求 DTO — POST /home/messages/mark-read.
 *
 * 大厂做法: 支持批量 + 全量.
 *   - 不传 messageIds = 标记所有
 *   - 传 messageIds = 仅标记指定 (用于「某些已读」)
 */
export class MarkMessagesReadDto {
  @ApiProperty({ description: '指定消息 id 列表 (不传 = 标记所有)', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  messageIds?: string[];
}

/**
 * 标记消息已读响应 DTO.
 */
export class MarkMessagesReadResponseDto {
  @ApiProperty({ description: '剩余未读数' })
  count!: number;

  @ApiProperty({ description: '本次标记的消息数' })
  markedCount!: number;
}

// Re-export 跨模块共享类型 (供其他模块引用时用 alias).
export { HOME_EMOTION_LEVELS, HOME_TIME_SLOTS };
