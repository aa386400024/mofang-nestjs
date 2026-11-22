import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

/**
 * 强调色枚举别名 — 抽出来后被多个 DTO 复用 (DailyCompanionTip / ToolboxItem / DualPracticeItem).
 *
 * 大厂: sonarjs/use-type-alias 要求超过 3 个字面量的 union 必须抽 type alias,
 * 避免 property 类型注解里出现内联 union (sonarjs 误报 + 可读性差).
 */
export type CompanionAccent = 'coral' | 'mint' | 'iris' | 'sand';

/** 自我关怀强调色 (跟 CompanionAccent 不共用, 语义不同). */
export type SelfCareAccent = 'low' | 'mid' | 'high';

/**
 * 陪伴者端首页综合快照 DTO — GET /home/companion-overview.
 *
 * 跟成长用户端 /home/overview 是 sibling 接口, 共用 home 模块,
 * 各自 DTO 互不依赖, 双角色模型相互独立.
 *
 * 设计要点 (DESIGN V2.0 §4 Tab1 陪伴者首页):
 *   - 弱化监控感, 强化支持感
 *   - 状态展示按权限等级过滤 (L1 / L2 / L3)
 *   - 「被陪伴者状态」是核心 — 心率 / 趋势 / 风险, 但严格按权限
 *
 * 排版约定: 子 DTO 先声明, 父 DTO 后声明 (避免 TS6133 "used before declaration").
 */

// ════════════════════════════════════════════════════════════════════════════
// 1. 子 DTO (子先, 父后)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 今日陪伴小贴士 — 每日更新一条低压力陪伴建议.
 *
 * V2.0: 服务端按日期 hash + 用户 uid 推同一条 (保证一致性)
 * V3: 接 LLM 个性化 (基于被陪伴者历史 + 陪伴者偏好)
 */
export class DailyCompanionTipDto {
  @ApiProperty({ description: '小贴士 id (e.g. tip-2026-08-31)' })
  id!: string;

  @ApiProperty({ description: '标题 (e.g.「先稳住自己」)' })
  title!: string;

  @ApiProperty({ description: '副标题 / 详细建议' })
  body!: string;

  @ApiProperty({ description: '强调色 (coral/mint/iris/sand)' })
  accent!: CompanionAccent;

  @ApiProperty({ description: 'Material icon 名 (前端 Material Icons 渲染用)', example: 'self_improvement' })
  icon!: string;
}

/**
 * 被陪伴者状态 — 严格按权限等级过滤 (DESIGN §4 权限说明).
 *
 *   L1 (基础): 仅在线状态 + 紧急信号
 *   L2 (进阶): + 情绪等级 + 练习状态
 *   L3 (完整): + 本周趋势 + 康复进度
 *
 * 服务端根据当前用户对该 binding 的 permissionLevel 决定字段填充:
 *   - L1: overallStatus 必有, 其余 null
 *   - L2: + emotionLevel + recentPractice
 *   - L3: + weeklyTrend + rehabProgress
 */
export class CompanionPersonStatusDto {
  @ApiProperty({ description: '被陪伴者昵称 (L1+)' })
  nickname!: string;

  @ApiProperty({ description: '被陪伴者头像 emoji (L1+)' })
  avatarEmoji!: string;

  @ApiProperty({ description: '关系 (family/friend/partner/colleague/other)' })
  relation!: 'family' | 'friend' | 'partner' | 'colleague' | 'other';

  @ApiProperty({ description: '当前权限等级', enum: ['L1', 'L2', 'L3'] })
  permissionLevel!: 'L1' | 'L2' | 'L3';

  @ApiProperty({ description: '总体状态 (L1+)', enum: ['normal', 'attention', 'crisis'] })
  overallStatus!: 'normal' | 'attention' | 'crisis';

  @ApiProperty({ description: '最近活跃时间 (UTC ISO, L1+)', nullable: true })
  lastActiveAt!: string | null;

  @ApiProperty({ description: '情绪档位 (L2+)', enum: ['great', 'okay', 'low', 'crisis'], nullable: true })
  emotionLevel!: 'great' | 'okay' | 'low' | 'crisis' | null;

  @ApiProperty({ description: '情绪记录时间 (L2+, UTC ISO)', nullable: true })
  emotionLoggedAt!: string | null;

  @ApiProperty({ description: '最近练习名称 (L2+)', nullable: true })
  recentPracticeTitle!: string | null;

  @ApiProperty({ description: '最近练习时间 (L2+, UTC ISO)', nullable: true })
  recentPracticeAt!: string | null;

  @ApiProperty({ description: '本周情绪趋势 (L3+, 数组索引 0=周一, 6=周日)', type: [String], nullable: true })
  weeklyEmotionTrend!: ('great' | 'okay' | 'low' | 'crisis')[] | null;

  @ApiProperty({ description: '本周求助次数 (L3+)' })
  weeklyHelpRequests!: number;

  @ApiProperty({ description: '康复进度百分比 (L3+, 0-100)', nullable: true })
  rehabProgressPct!: number | null;
}

/**
 * 陪伴工具箱 — DESIGN §4 Tab1 陪伴者首页 4 宫格 + V2.0 双人协同入口.
 */
export class ToolboxItemDto {
  @ApiProperty({ description: '工具 id', example: 'reassurance_card' })
  id!: string;

  @ApiProperty({ description: '工具标题', example: '安抚卡片' })
  title!: string;

  @ApiProperty({ description: '工具副标题', example: '发送温暖卡片给对方' })
  subtitle!: string;

  @ApiProperty({ description: 'emoji 图标', example: '💌' })
  emoji!: string;

  @ApiProperty({ description: '强调色 (coral/mint/iris/sand)' })
  accent!: CompanionAccent;

  /** 落地页路由 — 后端拼好, 前端 router.push. */
  @ApiProperty({ description: '落地页 deep link', example: '/companion/reassurance' })
  routePath!: string;

  /** 是否新 (V2.0 红点 — DESIGN「双人协同成长」入口). */
  @ApiProperty({ description: '是否 V2.0 新功能 (前端显示红点)', example: false })
  isNew!: boolean;
}

/**
 * 自我关怀状态 — DESIGN §4 Tab1「自我关怀入口」卡片.
 *
 * 大厂 standard: 陪伴者端必须监控耗竭, 给量化反馈.
 *   - daysSinceLastBreak: 距离上次休息天数 (> 7 天提示)
 *   - burnoutLevel: 0-100 (根据陪伴时长 + 状态切换频次算)
 *   - recommendedAction: 服务端给出推荐 (e.g.「休息一下」)
 */
export class SelfCareStatusDto {
  @ApiProperty({ description: '距离上次主动休息天数', example: 2 })
  daysSinceLastBreak!: number;

  @ApiProperty({ description: '耗竭指数 (0-100, 越高越需要休息)', example: 35 })
  burnoutLevel!: number;

  @ApiProperty({ description: '推荐动作 (无评判)', example: '本周陪伴时长有点长, 给自己 5 分钟呼吸一下' })
  recommendedAction!: string;

  @ApiProperty({ description: '强调色 (low=green / mid=yellow / high=red)' })
  accent!: SelfCareAccent;
}

/**
 * 双人协同练习库 — V2.0 新增 (DESIGN §4「双人协同成长系统」).
 *
 * 陪伴者端点击「一起成长练习」进入, 服务端返回练习列表 (按关系类型筛).
 */
export class DualPracticeItemDto {
  @ApiProperty({ description: '练习 id', example: 'dp-attachment-repair-5steps' })
  id!: string;

  @ApiProperty({ description: '练习标题', example: '依恋修复五步法' })
  title!: string;

  @ApiProperty({ description: '练习副标题', example: '30 分钟 · 双端同步' })
  subtitle!: string;

  @ApiProperty({ description: '适用关系 (partner/family/friend)', enum: ['partner', 'family', 'friend'] })
  relationScope!: ('partner' | 'family' | 'friend')[];

  @ApiProperty({ description: '时长 (分钟)', example: 30 })
  durationMinutes!: number;

  @ApiProperty({ description: 'emoji 图标', example: '🤝' })
  emoji!: string;

  @ApiProperty({ description: '强调色' })
  accent!: CompanionAccent;

  /** 落地页 deep link. */
  @ApiProperty({ description: '落地页 deep link', example: '/companion/dual-practice/dp-attachment-repair-5steps' })
  routePath!: string;
}

/**
 * 双人协同练习库列表响应 — GET /home/companion/dual-practices.
 */
export class DualPracticeListResponseDto {
  @ApiProperty({ description: '练习列表', type: [DualPracticeItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DualPracticeItemDto)
  items!: DualPracticeItemDto[];
}

/**
 * 陪伴对象切换 DTO — DESIGN §4 Tab2 「陪伴对象切换」.
 */
export class SwitchAccompaniedPersonDto {
  @ApiProperty({ description: '目标 binding id', example: 'uuid' })
  @IsString()
  bindingId!: string;
}

/**
 * 陪伴对象切换响应 DTO.
 */
export class SwitchAccompaniedPersonResponseDto {
  @ApiProperty({ description: '当前 binding id' })
  bindingId!: string;

  @ApiProperty({ description: '被陪伴者昵称' })
  nickname!: string;

  @ApiProperty({ description: '被陪伴者头像 emoji' })
  avatarEmoji!: string;

  @ApiProperty({ description: '当前权限等级' })
  permissionLevel!: 'L1' | 'L2' | 'L3';
}

/**
 * 一键求助触发响应 DTO — POST /home/companion/panic-check.
 *
 * 陪伴者主动触发「被陪伴者需要紧急联系」检查, 后端扫描最近 24h
 * 状态, 返回建议动作.
 */
export class PanicCheckResponseDto {
  @ApiProperty({ description: '风险等级', enum: ['low', 'mid', 'high'] })
  riskLevel!: 'low' | 'mid' | 'high';

  @ApiProperty({ description: '建议动作文案' })
  suggestedAction!: string;

  @ApiProperty({ description: '24h 求助信号数量', example: 0 })
  helpSignalsLast24h!: number;

  @ApiProperty({ description: '最近一次情绪等级', enum: ['great', 'okay', 'low', 'crisis'], nullable: true })
  lastEmotionLevel!: 'great' | 'okay' | 'low' | 'crisis' | null;

  @ApiProperty({ description: '是否需要立即联系 (true → 弹官方援助热线)' })
  needsImmediateContact!: boolean;
}

/**
 * 双人协同练习启动请求 DTO — POST /home/companion/dual-practices/:id/start.
 */
export class StartDualPracticeDto {
  @ApiProperty({ description: '被陪伴者 binding id (用于双方同步)' })
  @IsString()
  bindingId!: string;
}

/**
 * 双人协同练习启动响应 DTO.
 */
export class StartDualPracticeResponseDto {
  @ApiProperty({ description: '练习 session id (双方同步用)' })
  sessionId!: string;

  @ApiProperty({ description: '练习 id' })
  practiceId!: string;

  @ApiProperty({ description: '落地页 deep link (前端 push 后, WS 推送给对方)' })
  routePath!: string;

  @ApiProperty({ description: '开始时间 (UTC ISO)' })
  startedAt!: string;

  @ApiProperty({ description: '双方是否已就绪 (true 才开始执行)' })
  bothReady!: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 父 DTO (最后声明, 引用前面的子 DTO)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 陪伴者端首页综合快照 (父 DTO).
 */
export class CompanionHomeOverviewDto {
  @ApiProperty({ description: '陪伴者昵称' })
  nickname!: string;

  @ApiProperty({ description: '陪伴者头像 emoji (陪伴者端首页不需要头像 URL, 统一 emoji)' })
  avatarEmoji!: string;

  @ApiProperty({ description: '实名认证状态', enum: ['unverified', 'pending', 'verified', 'rejected'] })
  certificationStatus!: 'unverified' | 'pending' | 'verified' | 'rejected';

  @ApiProperty({ description: '今日陪伴小贴士', type: DailyCompanionTipDto })
  dailyTip!: DailyCompanionTipDto;

  @ApiProperty({ description: '被陪伴者状态 (按权限等级过滤)', type: CompanionPersonStatusDto })
  accompaniedPersonStatus!: CompanionPersonStatusDto;

  @ApiProperty({ description: '陪伴工具箱 (4 宫格 + 双人协同)', type: [ToolboxItemDto] })
  toolbox!: ToolboxItemDto[];

  @ApiProperty({ description: '自我关怀状态', type: SelfCareStatusDto })
  selfCareStatus!: SelfCareStatusDto;

  @ApiProperty({ description: '未读消息数', example: 0 })
  unreadMessageCount!: number;

  @ApiProperty({ description: '被陪伴者总数 (多对多关系下)', example: 1 })
  accompaniedPersonsTotal!: number;
}
