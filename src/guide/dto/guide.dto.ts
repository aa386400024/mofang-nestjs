import { ApiProperty } from '@nestjs/swagger';

/**
 * 陪伴者端「指南」Tab DTO — V3.0 §4 Tab3 设计文档.
 *
 * 涵盖:
 *   - 3 大分类 (入门课程 / 场景手册 / 避坑指南)
 *   - 课程 (带 progress + 难度 + 时长)
 *   - 我的学习 (已学 / 收藏)
 */

export const GUIDE_CATEGORY_KEYS = ['intro_courses', 'scenario_handbook', 'pitfall_guide'] as const;
export type GuideCategoryKey = (typeof GUIDE_CATEGORY_KEYS)[number];

export const ROLE_FILTER_KEYS = ['partner', 'family', 'general'] as const;
export type RoleFilterKey = (typeof ROLE_FILTER_KEYS)[number];

export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard'] as const;
export type DifficultyKey = (typeof DIFFICULTY_KEYS)[number];

// ═══════════════════════════════════════════════════════════════════
// 分类 DTO
// ═══════════════════════════════════════════════════════════════════

export class GuideCategoryDto {
  @ApiProperty({ description: '分类标识', enum: GUIDE_CATEGORY_KEYS })
  key!: GuideCategoryKey;

  @ApiProperty({ description: '分类名称', example: '入门课程' })
  label!: string;

  @ApiProperty({ description: '分类副标题', example: '陪伴者入门必学' })
  subtitle!: string;

  @ApiProperty({ description: 'emoji 图标', example: '📚' })
  emoji!: string;

  @ApiProperty({ description: '课程数量', example: 12 })
  courseCount!: number;

  @ApiProperty({ description: '强调色 (mistyPink / softBlue / mintCyan / primary)' })
  accentColor!: 'mistyPink' | 'softBlue' | 'mintCyan' | 'primary';
}

// ═══════════════════════════════════════════════════════════════════
// 课程 DTO
// ═══════════════════════════════════════════════════════════════════

export class GuideCourseDto {
  @ApiProperty({ description: '课程 ID (UUID)' })
  id!: string;

  @ApiProperty({ description: '所属分类', enum: GUIDE_CATEGORY_KEYS })
  categoryKey!: GuideCategoryKey;

  @ApiProperty({ description: '课程标题', example: '陪伴者的 4 个基础姿态' })
  title!: string;

  @ApiProperty({ description: '课程副标题', example: '听懂对方的弦外之音' })
  subtitle!: string;

  @ApiProperty({ description: '封面 emoji', example: '💝' })
  coverEmoji!: string;

  @ApiProperty({ description: '时长 (分钟)', example: 8 })
  durationMinutes!: number;

  @ApiProperty({ description: '难度', enum: DIFFICULTY_KEYS })
  difficulty!: DifficultyKey;

  @ApiProperty({ description: '角色过滤', type: [String] })
  roleFilters!: RoleFilterKey[];

  @ApiProperty({ description: '标签', type: [String] })
  tags!: string[];

  @ApiProperty({ description: '课程简介', example: '本课程从倾听、共情、边界、自我关怀 4 个维度…' })
  description!: string;

  @ApiProperty({ description: '是否已收藏', example: false })
  isFavorited!: boolean;

  @ApiProperty({ description: '学习进度 0-1, 1=已完成', example: 0 })
  progress!: number;
}

export class GuideCourseListDto {
  @ApiProperty({ type: [GuideCourseDto] })
  courses!: GuideCourseDto[];

  @ApiProperty({ description: '总数', example: 12 })
  total!: number;
}

// ═══════════════════════════════════════════════════════════════════
// 课程详情 + 目录 + 笔记
// ═══════════════════════════════════════════════════════════════════

export class GuideLessonDto {
  @ApiProperty({ description: '小节 ID' })
  id!: string;

  @ApiProperty({ description: '小节序号', example: 1 })
  order!: number;

  @ApiProperty({ description: '小节标题', example: '倾听的 3 个层次' })
  title!: string;

  @ApiProperty({ description: '小节内容 (Markdown)' })
  contentMarkdown!: string;

  @ApiProperty({ description: '音频 URL', required: false })
  audioUrl?: string;

  @ApiProperty({ description: '时长 (分钟)', example: 3 })
  durationMinutes!: number;
}

export class GuideCourseDetailDto {
  @ApiProperty({ description: '课程基础信息' })
  course!: GuideCourseDto;

  @ApiProperty({ type: [GuideLessonDto] })
  lessons!: GuideLessonDto[];

  @ApiProperty({ description: '我的笔记', type: [Object] })
  notes!: {
    id: string;
    lessonId: string;
    content: string;
    createdAt: string;
  }[];
}

export class SaveCourseProgressDto {
  @ApiProperty({ description: '课程 ID' })
  courseId!: string;

  @ApiProperty({ description: '学习进度 0-1', example: 0.5 })
  progress!: number;
}

export class SaveCourseNoteDto {
  @ApiProperty({ description: '小节 ID' })
  lessonId!: string;

  @ApiProperty({ description: '笔记内容' })
  content!: string;
}

export class ToggleFavoriteDto {
  @ApiProperty({ description: '课程 ID' })
  courseId!: string;

  @ApiProperty({ description: '是否收藏', example: true })
  favorited!: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// 我的学习
// ═══════════════════════════════════════════════════════════════════

export class MyLearningOverviewDto {
  @ApiProperty({ description: '已学课程数', example: 3 })
  learnedCount!: number;

  @ApiProperty({ description: '收藏课程数', example: 5 })
  favoritedCount!: number;

  @ApiProperty({ description: '累计学习时长 (分钟)', example: 86 })
  totalMinutes!: number;

  @ApiProperty({ type: [GuideCourseDto], description: '最近学习' })
  recentCourses!: GuideCourseDto[];
}
