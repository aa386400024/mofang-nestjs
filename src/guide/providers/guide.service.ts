import { Injectable, NotFoundException } from '@nestjs/common';

import {
  type GuideCategoryDto,
  type GuideCategoryKey,
  type GuideCourseDetailDto,
  type GuideCourseDto,
  type GuideCourseListDto,
  type GuideLessonDto,
  type MyLearningOverviewDto,
  type RoleFilterKey,
  SaveCourseNoteDto,
  SaveCourseProgressDto,
  ToggleFavoriteDto,
} from '../dto/guide.dto';

/**
 * 陪伴者端「指南」Tab 服务 — V3.0 §4 Tab3.
 *
 * V3.0 范围:
 *   - 3 大分类 (入门课程 / 场景手册 / 避坑指南)
 *   - 课程库 (V3.0 初版: 12 门课程, 静态 seed)
 *   - 学习进度 / 笔记 / 收藏 (内存态, V3.0 简化)
 *
 * V3.0 治本:
 *   - 课程内容静态 seed, 无 LLM / RAG 依赖, 启动即可用
 *   - 学习进度用 Map 内存存储, 后续 V3.1 接 typeorm 持久化
 *   - 笔记同理 (V3.0 占位, 不接 typeorm)
 *
 * 大厂原则:
 *   - 数据全静态, 满足 V3.0 设计文档"课程库"基本要求
 *   - 3 个分类用 enum + 静态字段, 跨模块不复用 (独有命名空间)
 *   - 角色过滤: partner / family / general — 兼容前端 `RoleFilterKey`
 */
/**
 * 课程笔记 DTO — V3.0 占位.
 * 注: 跟 SaveCourseNoteDto 区分, 返回给前端的是完整 entity (含 id / createdAt).
 */
interface CourseNoteDto {
  id: string;
  lessonId: string;
  content: string;
  createdAt: string;
}

@Injectable()
export class GuideService {
  // ═════════════════════════════════════════════════════════════
  // 静态 seed 数据 (V3.0)
  // ═════════════════════════════════════════════════════════════

  readonly categories: GuideCategoryDto[] = [
    {
      key: 'intro_courses',
      label: '入门课程',
      subtitle: '陪伴者必学的基础认知与心态',
      emoji: '📚',
      courseCount: 4,
      accentColor: 'primary',
    },
    {
      key: 'scenario_handbook',
      label: '场景手册',
      subtitle: '常见场景的错误示范 + 正确话术',
      emoji: '🎯',
      courseCount: 5,
      accentColor: 'softBlue',
    },
    {
      key: 'pitfall_guide',
      label: '避坑指南',
      subtitle: '陪伴者最容易踩的认知与行为雷区',
      emoji: '🚧',
      courseCount: 3,
      accentColor: 'mintCyan',
    },
  ];

  readonly courses: GuideCourseDto[] = [
    // ── 入门课程 (4) ─────────────────────────────────
    {
      id: 'intro_001',
      categoryKey: 'intro_courses',
      title: '陪伴者的 4 个基础姿态',
      subtitle: '听懂对方的弦外之音',
      coverEmoji: '💝',
      durationMinutes: 8,
      difficulty: 'easy',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['入门', '倾听'],
      description: '陪伴不是修复, 是共处。本课程从倾听、共情、边界、自我关怀 4 个维度,带你理解陪伴的本质。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'intro_002',
      categoryKey: 'intro_courses',
      title: '依恋循环与镜映原理',
      subtitle: '看见关系中的卡点',
      coverEmoji: '🔗',
      durationMinutes: 12,
      difficulty: 'normal',
      roleFilters: ['partner', 'family'],
      tags: ['理论', '依恋'],
      description: '依恋循环的 4 个步骤 (需求 / 表达 / 回应 / 心理结果) 是关系疗愈的底层逻辑。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'intro_003',
      categoryKey: 'intro_courses',
      title: '陪伴者自我关怀',
      subtitle: '先稳住自己, 再陪伴对方',
      coverEmoji: '🌿',
      durationMinutes: 6,
      difficulty: 'easy',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['自我关怀'],
      description: '耗竭是陪伴者的职业病。本课教你 3 个日常自我关怀锚点。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'intro_004',
      categoryKey: 'intro_courses',
      title: '边界与权限等级',
      subtitle: '什么该问, 什么不该问',
      coverEmoji: '🚪',
      durationMinutes: 10,
      difficulty: 'normal',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['边界'],
      description: 'L1 / L2 / L3 三级权限的本质, 以及如何在尊重隐私的前提下有效支持。',
      isFavorited: false,
      progress: 0,
    },

    // ── 场景手册 (5) ─────────────────────────────────
    {
      id: 'scenario_001',
      categoryKey: 'scenario_handbook',
      title: '对方说"我没事"时',
      subtitle: '识别隐性求助信号',
      coverEmoji: '🎭',
      durationMinutes: 5,
      difficulty: 'normal',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['识别', '话术'],
      description: '"我没事" 经常是 "我不太好但不想让你担心"。本课给 3 种回应模板。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'scenario_002',
      categoryKey: 'scenario_handbook',
      title: '对方在哭泣时',
      subtitle: '不打断、不评判、不修复',
      coverEmoji: '💧',
      durationMinutes: 7,
      difficulty: 'normal',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['共情'],
      description: '陪伴哭泣的人最大的忌讳是想办法让他别哭。本课教你如何在场而不打扰。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'scenario_003',
      categoryKey: 'scenario_handbook',
      title: '对方拒绝帮助时',
      subtitle: '不越界, 不强求',
      coverEmoji: '🚶',
      durationMinutes: 6,
      difficulty: 'hard',
      roleFilters: ['partner', 'family'],
      tags: ['边界', '尊重'],
      description: '对方说 "我自己能行" 时, 你该怎么办? 本课给你 5 种不越界的陪伴方式。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'scenario_004',
      categoryKey: 'scenario_handbook',
      title: '对方想结束一段关系时',
      subtitle: '听 vs 给建议的平衡',
      coverEmoji: '💔',
      durationMinutes: 9,
      difficulty: 'hard',
      roleFilters: ['partner', 'family'],
      tags: ['关系'],
      description: '"该不该分手" 是最常被问到的问题。本课教你如何不替他做决定。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'scenario_005',
      categoryKey: 'scenario_handbook',
      title: '高危时刻的紧急应对',
      subtitle: '何时升级到专业支持',
      coverEmoji: '🚨',
      durationMinutes: 8,
      difficulty: 'hard',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['危机'],
      description: '当对方出现自伤/自杀信号, 陪伴者必须知道的 5 个应急步骤。',
      isFavorited: false,
      progress: 0,
    },

    // ── 避坑指南 (3) ─────────────────────────────────
    {
      id: 'pitfall_001',
      categoryKey: 'pitfall_guide',
      title: '陪伴者最容易踩的 7 个认知坑',
      subtitle: '"我是为他好" 不一定是为他好',
      coverEmoji: '⚠️',
      durationMinutes: 7,
      difficulty: 'easy',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['认知'],
      description: '从 "我比你懂" 到 "我替他决定", 7 个隐藏的认知偏差让你越陪越累。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'pitfall_002',
      categoryKey: 'pitfall_guide',
      title: '耗竭的早期信号',
      subtitle: '5 个你忽略的求救信号',
      coverEmoji: '🔋',
      durationMinutes: 5,
      difficulty: 'easy',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['耗竭'],
      description: '易怒、失眠、对他的痛苦麻木... 这些都是耗竭的信号, 不是 "我变冷了"。',
      isFavorited: false,
      progress: 0,
    },
    {
      id: 'pitfall_003',
      categoryKey: 'pitfall_guide',
      title: '角色边界: 陪伴者不是治疗师',
      subtitle: '专业的事交给专业的人',
      coverEmoji: '👨‍⚕️',
      durationMinutes: 6,
      difficulty: 'normal',
      roleFilters: ['partner', 'family', 'general'],
      tags: ['边界', '专业'],
      description: '陪伴者不能诊断、不能开药、不能替代咨询。本课告诉你 "什么时候必须升级"。',
      isFavorited: false,
      progress: 0,
    },
  ];

  readonly lessonsByCourse: Record<string, GuideLessonDto[]> = {
    intro_001: [
      {
        id: 'intro_001_l1',
        order: 1,
        title: '倾听的 3 个层次',
        contentMarkdown:
          '# 倾听的 3 个层次\n\n倾听不是 "等他说完", 而是 3 个层次的层层递进:\n\n- **听见** (听到对方说的话)\n- **听懂** (理解对方话语背后的情绪)\n- **听见未说出口的** (识别对方想说但说不出的)\n\n',
        durationMinutes: 3,
      },
      {
        id: 'intro_001_l2',
        order: 2,
        title: '共情 ≠ 同情',
        contentMarkdown:
          '# 共情 ≠ 同情\n\n**同情**: "你好可怜" (站在自己视角)\n**共情**: "我能理解你现在的感受" (站在对方视角)\n\n共情的核心是 "我看见你了", 而不是 "我觉得你好惨"。',
        durationMinutes: 3,
      },
      {
        id: 'intro_001_l3',
        order: 3,
        title: '边界让陪伴更可持续',
        contentMarkdown:
          '# 边界让陪伴更可持续\n\n没有边界的陪伴会变成消耗。3 个简单边界:\n\n- **时间边界**: 每天最多 1 小时陪伴对话\n- **情绪边界**: 对方崩溃时不卷入\n- **能力边界**: 不试图修复, 不替他做决定',
        durationMinutes: 2,
      },
    ],
  };

  readonly courseProgress: Record<string, Map<string, number>> = {};
  readonly courseFavorites: Record<string, Set<string>> = {};
  readonly courseNotes: Record<string, Map<string, CourseNoteDto[]>> = {};

  // ═════════════════════════════════════════════════════════════
  // 1. 分类
  // ═════════════════════════════════════════════════════════════

  listCategories(): GuideCategoryDto[] {
    return this.categories;
  }

  // ═════════════════════════════════════════════════════════════
  // 2. 课程列表 (带 progress + favorite)
  // ═════════════════════════════════════════════════════════════

  listCourses(
    uid: string,
    opts: {
      categoryKey?: GuideCategoryKey;
      roleFilter?: RoleFilterKey;
      onlyFavorited?: boolean;
    } = {},
  ): GuideCourseListDto {
    let courses = [...this.courses];

    if (opts.categoryKey) {
      courses = courses.filter((c) => c.categoryKey === opts.categoryKey);
    }

    if (opts.roleFilter) {
      courses = courses.filter((c) => c.roleFilters.includes(opts.roleFilter!));
    }

    const favoritedSet = this.courseFavorites[uid] ?? new Set<string>();
    const progressMap = this.courseProgress[uid] ?? new Map<string, number>();

    const enriched = courses.map((c) => ({
      ...c,
      isFavorited: favoritedSet.has(c.id),
      progress: progressMap.get(c.id) ?? 0,
    }));

    const filtered = opts.onlyFavorited ? enriched.filter((c) => c.isFavorited) : enriched;

    return {
      courses: filtered,
      total: filtered.length,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 3. 课程详情
  // ═════════════════════════════════════════════════════════════

  getCourseDetail(uid: string, courseId: string): GuideCourseDetailDto {
    const course = this.courses.find((c) => c.id === courseId);
    if (!course) {
      throw new NotFoundException(`Course ${courseId} not found`);
    }

    const favoritedSet = this.courseFavorites[uid] ?? new Set<string>();
    const progressMap = this.courseProgress[uid] ?? new Map<string, number>();
    const notesMap = this.courseNotes[uid] ?? new Map<string, CourseNoteDto[]>();

    const lessons = this.lessonsByCourse[courseId] ?? this.generateDefaultLessons(course);

    return {
      course: {
        ...course,
        isFavorited: favoritedSet.has(courseId),
        progress: progressMap.get(courseId) ?? 0,
      },
      lessons,
      notes: notesMap.get(courseId) ?? [],
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 4. 进度 + 笔记 + 收藏
  // ═════════════════════════════════════════════════════════════

  saveProgress(uid: string, dto: SaveCourseProgressDto): { courseId: string; progress: number } {
    const progressMap = this.courseProgress[uid] ?? new Map<string, number>();
    progressMap.set(dto.courseId, dto.progress);
    this.courseProgress[uid] = progressMap;
    return { courseId: dto.courseId, progress: dto.progress };
  }

  toggleFavorite(uid: string, dto: ToggleFavoriteDto): { courseId: string; favorited: boolean } {
    const favoritedSet = this.courseFavorites[uid] ?? new Set<string>();
    if (dto.favorited) {
      favoritedSet.add(dto.courseId);
    } else {
      favoritedSet.delete(dto.courseId);
    }
    this.courseFavorites[uid] = favoritedSet;
    return { courseId: dto.courseId, favorited: dto.favorited };
  }

  saveNote(uid: string, courseId: string, dto: SaveCourseNoteDto): { id: string; lessonId: string; content: string; createdAt: string } {
    const notesMap = this.courseNotes[uid] ?? new Map<string, CourseNoteDto[]>();
    const courseNotes = notesMap.get(courseId) ?? [];
    const note = {
      id: `note_${Date.now()}`,
      lessonId: dto.lessonId,
      content: dto.content,
      createdAt: new Date().toISOString(),
    };
    courseNotes.push(note);
    notesMap.set(courseId, courseNotes);
    this.courseNotes[uid] = notesMap;
    return note;
  }

  // ═════════════════════════════════════════════════════════════
  // 5. 我的学习总览
  // ═════════════════════════════════════════════════════════════

  getMyLearning(uid: string): MyLearningOverviewDto {
    const progressMap = this.courseProgress[uid] ?? new Map<string, number>();
    const favoritedSet = this.courseFavorites[uid] ?? new Set<string>();

    const learnedIds: string[] = [];
    let totalMinutes = 0;
    for (const [id, p] of progressMap.entries()) {
      if (p >= 1) learnedIds.push(id);
      const course = this.courses.find((c) => c.id === id);
      if (course) totalMinutes += Math.round(course.durationMinutes * p);
    }

    const recentCourses = this.courses
      .filter((c) => progressMap.has(c.id))
      .slice(0, 5)
      .map((c) => ({
        ...c,
        isFavorited: favoritedSet.has(c.id),
        progress: progressMap.get(c.id) ?? 0,
      }));

    return {
      learnedCount: learnedIds.length,
      favoritedCount: favoritedSet.size,
      totalMinutes,
      recentCourses,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 私有 helper
  // ═════════════════════════════════════════════════════════════

  /**
   * 给未配目录的课程生成默认小节 — V3.0 治本:
   *   - 静态课程库内容量小, 后续 V3.1 接 markdown content
   *   - 当前兜底: 课程简介作为唯一小节, 时长 = 课程时长
   */
  generateDefaultLessons(course: GuideCourseDto): GuideLessonDto[] {
    return [
      {
        id: `${course.id}_default`,
        order: 1,
        title: course.title,
        contentMarkdown: `# ${course.title}\n\n${course.description}\n\n`,
        durationMinutes: course.durationMinutes,
      },
    ];
  }
}
