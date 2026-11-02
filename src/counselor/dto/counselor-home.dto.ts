// V2026-10-13 治本 (Phase 7.10 — counselor-home.dto.ts, counselor 端 home Tab):
//   心理咨询师学员端「首页」Tab (V6.1 §2 / counselorLearner 5 Tab shell 入口) DTO 契约.
//   跟 xin_su_app CounselorHomeOverview entity 字段一一对应.
//
//   V0.5 简化: 4 大训练分类 + 9 个 mock 场景 (与 xin_su_app Batch 1 Stage 1 mock
//              1:1 对应) + 6 维能力雷达 + 4 KPI 进度. V0.x 走内存 mock, V1.x 走
//              ai-profile + training-sessions + voice-sessions 跨表聚合.
//
//   治本:
//     - 4 大分类 enum 跟 TrainingCategory 1:1 对齐 (skill/fullSession/script/caseConcept)
//     - 6 维能力跟 ai-profile 7 维子集 (去掉 "边界" 合并到 "专业度")
//     - AI 推荐 emotion-aware (crisis/low 推倾听, 其它推全流程 L1)
//
//   反双胞胎:
//     - 4 大分类名称跟 xin_su_app CounselorTrainingPage._GroupHeader 1:1 (不能自由命名)
//     - 9 场景 id 跟 xin_su_app mock 1:1 (skill_listening / full_l1 / script_polish 等)

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { HOME_EMOTION_LEVELS, type HomeEmotionLevel } from '../../home/home.constants';

/**
 * V2026-10-20 治本 (专项技能训练中心改版 — 路由意图显式化):
 *   原因: 客户端原用 `scenario.id.startsWith('skill_')` / `id === 'script_polish'`
 *     做字符串前缀匹配来猜该跳哪个页面. 这把「业务路由」藏在字符串字面量里:
 *     后端新增或改名任何场景 id, 客户端会静默走错分支, 编译器与测试都无法发现.
 *     这与设计规格 §2.2 审计出的 `specRef: '§6.1.1'` 是同一类反模式.
 *   修复: 后端在 DTO 上显式声明 `target`, 客户端只做 switch(target) 单一分派.
 *   反双胞胎:
 *     - 不让客户端维护 id → 路由的映射表 (映射表会再次与后端 drift)
 *     - 不用任意字符串 target (用联合类型, 拼错编译期报错)
 */
export type CounselorTrainingTarget = 'specializedSkills' | 'visitorPreset' | 'scriptWorkshop' | 'examLibrary';

// ════════════════════════════════════════════════════════════════════════════
// 子 DTO: 单个训练场景 (Stage 1 mock 数据跟 xin_su_app 一致)
// ════════════════════════════════════════════════════════════════════════════

export class CounselorTrainingScenarioDto {
  @ApiProperty({ description: '场景 id (Stage 1 mock: skill_listening / full_l1 / script_polish 等)', example: 'skill_listening' })
  id!: string;

  @ApiProperty({ description: '场景标题', example: '倾听与共情' })
  title!: string;

  @ApiProperty({ description: '场景副标题 / 一句话描述', example: '主动倾听 · 情绪反映 · 共情验证' })
  subtitle!: string;

  @ApiProperty({ description: '训练模式', enum: ['text', 'voice', 'text_voice'] })
  mode!: 'text' | 'voice' | 'text_voice';

  @ApiProperty({
    description:
      '难度 (L1 入门 / L2 进阶 / L3 挑战). full_process card 默认 L1, 用户在 VisitorPresetPage 顶部 "难度" 段 1:1 wire 改 L1/L2/L3 (C1 大炮 17:10 拍板)',
    example: 'L1',
  })
  difficulty!: 'L1' | 'L2' | 'L3';

  @ApiProperty({ description: '训练时长 (分钟)', example: 5 })
  durationMinutes!: number;

  @ApiProperty({ description: '是否已解锁 (默认 true, V0.x 全部 unlocked, V1.x 跟训练记录聚合)', example: true })
  unlocked!: boolean;

  @ApiProperty({
    description:
      'V2026-10-20 治本: 该场景点击后应跳转的客户端目的地. 客户端只按此字段分派, ' +
      '不再用 scenario.id 字符串前缀猜测路由 (消除 id 改名导致静默走错的隐患).',
    enum: ['specializedSkills', 'visitorPreset', 'scriptWorkshop', 'examLibrary'],
    example: 'visitorPreset',
  })
  target!: CounselorTrainingTarget;
}

// ════════════════════════════════════════════════════════════════════════════
// 子 DTO: 4 大训练分类 (跟 xin_su_app CounselorTrainingPage._GroupHeader 1:1)
// ════════════════════════════════════════════════════════════════════════════

export class CounselorTrainingCategoryDto {
  @ApiProperty({ description: '分类 enum (跟 xin_su_app TrainingCategory 1:1)', enum: ['skill', 'fullSession', 'script', 'caseConcept'] })
  category!: 'skill' | 'fullSession' | 'script' | 'caseConcept';

  @ApiProperty({ description: 'emoji 图标 (跟 xin_su_app TrainingCategoryDisplay.emoji 1:1)', example: '🎯' })
  emoji!: string;

  @ApiProperty({ description: '分类标题 (跟 xin_su_app TrainingCategoryDisplay.title 1:1)', example: '专项技能' })
  title!: string;

  @ApiProperty({
    description: '该分类下所有训练场景. collapsed=true 时为空数组, 客户端走分类级 target',
    type: [CounselorTrainingScenarioDto],
  })
  scenarios!: CounselorTrainingScenarioDto[];

  @ApiProperty({
    description:
      'V2026-10-20 治本: true 表示该分类应收敛为「单入口大卡」而非逐场景 carousel. ' +
      '专项技能分类因已有独立详情页 (含 10 个训练项) 而置 true, 避免同一页面出现 3 个指向同一目的地的入口.',
    example: false,
  })
  collapsed!: boolean;

  @ApiProperty({
    description: 'V2026-10-20 治本: collapsed=true 时的分类级跳转目标 (客户端单入口卡使用)',
    required: false,
    enum: ['specializedSkills', 'visitorPreset', 'scriptWorkshop', 'examLibrary'],
  })
  target?: CounselorTrainingTarget;

  @ApiProperty({
    description: 'V2026-10-20 治本: 分类级进度摘要, 供单入口卡展示「N 项 · M 已完成」',
    required: false,
    // V2026-10-20 修正 (tsc TS2322): 本项目 @nestjs/swagger 版本的 SchemaObject.type
    //   不接受字符串 'object' (合法值仅 string/number/boolean/array/integer/file/null
    //   或构造函数/Type). 改用 Object 构造函数, 并移除不被支持的 additionalProperties.
    type: Object,
    example: { totalItems: 10, completedItems: 0 },
  })
  progress?: { totalItems: number; completedItems: number };
}

// ════════════════════════════════════════════════════════════════════════════
// 6 维能力雷达 (V0.5 简化, 跟 ai-profile 7 维子集)
// ════════════════════════════════════════════════════════════════════════════

export class CounselorAbilitySnapshotDto {
  @ApiProperty({ description: '倾听 (0.0 - 1.0, 跟 ai-profile listening 一致)', example: 0.35 })
  listening!: number;

  @ApiProperty({ description: '共情 (0.0 - 1.0, 跟 ai-profile empathy 一致)', example: 0.2 })
  empathy!: number;

  @ApiProperty({ description: '提问 (0.0 - 1.0, 跟 ai-profile questioning 一致)', example: 0.45 })
  questioning!: number;

  @ApiProperty({ description: '边界 (0.0 - 1.0, 跟 ai-profile boundary 一致)', example: 0.15 })
  boundary!: number;

  @ApiProperty({ description: '语音专业度 (0.0 - 1.0, 跟 ai-profile voiceProfessionalism 一致)', example: 0.3 })
  voiceProfessionalism!: number;

  @ApiProperty({ description: '个案概念化 (0.0 - 1.0, 跟 ai-profile caseConceptualization 一致)', example: 0.25 })
  caseConceptualization!: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 4 KPI 本周成长概览 (V0.5 简化, mock 全 0, V1.x 接 training-sessions 聚合)
// ════════════════════════════════════════════════════════════════════════════

export class CounselorWeeklyProgressDto {
  @ApiProperty({ description: '本周完成训练数 (V0.x mock 0, V1.x 聚合 training-sessions.completedAt 本周)', example: 0 })
  toolsCompletedThisWeek!: number;

  @ApiProperty({ description: '本周获得碎片数 (V0.x mock 0, V1.x 聚合 inner_world.fragments_history 本周)', example: 0 })
  fragmentsEarnedThisWeek!: number;

  @ApiProperty({ description: '本周解锁岛屿数 (V0.x mock 0, V1.x 聚合 inner_world.islands 首次解锁本周)', example: 0 })
  islandsUnlockedThisWeek!: number;

  @ApiProperty({ description: '连续活跃天数 (V0.x mock 0, V1.x 计算 daily_active)', example: 0 })
  consecutiveActiveDays!: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 父 DTO: counselor home overview (跟 xin_su_app CounselorHomeOverview entity 1:1)
// ════════════════════════════════════════════════════════════════════════════

export class CounselorHomeOverviewDto {
  @ApiProperty({ description: '问候语 (V0.5 写死, V1.x 跟 home-overview greeting 复用)', example: '今天可以开始哪一项训练?' })
  greeting!: string;

  @ApiProperty({ description: '日期标签 (V0.5 client local time, V1.x server 时区感知)', example: '10 月 13 日 · 周二' })
  dateLabel!: string;

  @ApiProperty({
    description: '今日 AI 智能推荐 (含 1 句话理由, emotion-aware)',
    example: { title: '倾听与共情 · 入门', subtitle: '针对「倾听」维度低分', scenarioId: 'skill_listening', difficulty: 'L1' },
  })
  todayRecommendation!: {
    title: string;
    subtitle: string;
    scenarioId: string;
    difficulty: 'L1' | 'L2' | 'L3';
  };

  @ApiProperty({ description: '6 维能力雷达', type: CounselorAbilitySnapshotDto })
  ability!: CounselorAbilitySnapshotDto;

  @ApiProperty({ description: '本周成长概览 (4 KPI)', type: CounselorWeeklyProgressDto })
  weeklyProgress!: CounselorWeeklyProgressDto;

  @ApiProperty({ description: '4 大训练分类 + 9 场景 (跟 xin_su_app Stage 1 mock 1:1)', type: [CounselorTrainingCategoryDto] })
  trainingCategories!: CounselorTrainingCategoryDto[];

  @ApiProperty({ description: '用户当前角色 (V0.5 写死 counselor_learner, V1.x 跟 profile.currentRole 1:1)', enum: ['counselor_learner'] })
  currentRole!: 'counselor_learner';
}

// ════════════════════════════════════════════════════════════════════════════
// 查询 DTO
// ════════════════════════════════════════════════════════════════════════════

export class CounselorHomeQueryDto {
  @ApiProperty({ description: '当前情绪档位 (前端 EmotionBloc 注入, 影响 AI 推荐)', required: false, enum: HOME_EMOTION_LEVELS })
  @IsOptional()
  @IsString()
  @IsIn(HOME_EMOTION_LEVELS)
  emotionLevel?: HomeEmotionLevel;
}
