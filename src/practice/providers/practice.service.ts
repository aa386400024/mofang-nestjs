import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EmbodiedService } from '../../embodied/providers/embodied.service';
import {
  EmbodiedAuthStatusDto,
  EmbodiedFeedbackDto,
  EmbodiedToolDto,
  EmbodiedVitalsDto,
  GymCurrentPlanDto,
  GymDimensionDto,
  GymGenomeReportDto,
  GymModuleKey,
  GymRecordEntryDto,
  GymWeeklyPlanDto,
  PracticeCategoryDto,
  PracticeCategoryKey,
  PracticeFeedbackDto,
  PracticeSessionDto,
  PracticeToolDto,
  TargetedReshapeDto,
} from '../dto/practice.dto';
import { PracticeRecord } from '../entities/practice-record.entity';
import { PracticeSession } from '../entities/practice-session.entity';

// ════════════════════════════════════════════════════════════════
// 1. PracticeCategoryService — 8 大分类
// ════════════════════════════════════════════════════════════════

@Injectable()
export class PracticeCategoryService {
  /**
   * V2026-09-01 治本 (TS6133):
   *   删未用 logger — V2.0 阶段服务内零业务日志需求, 直接删,
   *   不加 underscore 前缀骗 lint. V3 接事件总线 / BullMQ 后再加回.
   *
   * V2.0 sample: 跟前端 InMemoryDataSource 1:1 对齐的 8 大分类.
   * V3 接动态解锁引擎时, 改成查库 + 个性化推荐.
   */
  async listCategories(_uid: string): Promise<PracticeCategoryDto[]> {
    return [
      {
        id: 'emotion_emergency',
        label: '情绪急救',
        description: '难受时打开的快速锚定工具包',
        icon: 'sos_outlined',
        toolCount: 5,
        accentColorToken: 'mistyPink',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'cbt',
        label: 'CBT 认知',
        description: '认知歪曲识别与思维重构',
        icon: 'psychology_outlined',
        toolCount: 4,
        accentColorToken: 'softBlue',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'act',
        label: 'ACT 接纳',
        description: '认知解离与价值澄清',
        icon: 'spa_outlined',
        toolCount: 4,
        accentColorToken: 'mintCyan',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'mindfulness',
        label: '正念调节',
        description: '从 3 分钟到 30 分钟的正念练习',
        icon: 'self_improvement_outlined',
        toolCount: 5,
        accentColorToken: 'mintCyan',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'dbt',
        label: 'DBT 技能',
        description: '情绪调节与人际效能训练',
        icon: 'balance_outlined',
        toolCount: 4,
        accentColorToken: 'softBlue',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'development',
        label: '发展成长',
        description: 'WOOP / 依恋 / 繁衍任务等发展心理学工具',
        icon: 'timeline_outlined',
        toolCount: 5,
        accentColorToken: 'primary',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'gym',
        label: '心理健身房',
        description: '像锻炼肌肉一样锻炼心理能力',
        icon: 'fitness_center_outlined',
        toolCount: 6,
        accentColorToken: 'primary',
        unlockStatus: 'unlocked',
        lockedReason: null,
        unlockProgress: null,
      },
      {
        id: 'embodied',
        label: '具身认知',
        description: '打通心理与身体的精准干预',
        icon: 'accessibility_new_outlined',
        toolCount: 4,
        accentColorToken: 'mintCyan',
        // V3.0 渐进解锁: 用户未授权传感器时置灰
        unlockStatus: 'locking',
        lockedReason: '授权身体传感器后解锁',
        unlockProgress: 0,
      },
    ];
  }
}

// ════════════════════════════════════════════════════════════════
// 2. PracticeToolService — 工具元数据
// ════════════════════════════════════════════════════════════════

@Injectable()
export class PracticeToolService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 PracticeCategoryService 同上 — 删未用 logger.
   */

  /** V2.0 sample: 30 个工具, 跟前端 InMemoryDataSource 完全一致. */
  private readonly tools: PracticeToolDto[] = [
    // 情绪急救 (5)
    {
      id: 'emergency.5-4-3-2-1',
      categoryId: 'emotion_emergency',
      title: '5-4-3-2-1 接地法',
      subtitle: '焦虑发作时的快速锚定',
      description: '通过五感依次回到当下，',
      icon: 'sos_outlined',
      durationMinutes: 3,
      difficulty: 1,
      evidenceLevel: 'mindfulness',
      // V2026-09-03 治本: routePath 改为前端 V4.2 急救专用路由, 避免
      // 落入 /practice/tool/* 兜底走通用 ToolExecutionPage 导致"闪一下
      // 老版倒计时模板". 必须与前端 router.dart / practice_tool_navigator.dart
      // 保持一致.
      routePath: '/tools/emergency/grounding',
      tags: ['急救', '入门'],
      hasFunMode: true,
      unlockHint: null,
    },
    {
      id: 'emergency.4-4-8',
      categoryId: 'emotion_emergency',
      title: '4-4-8 呼吸法',
      subtitle: '3 分钟让神经系统平稳',
      description: '吸气 4 秒 — 屏息 4 秒 — 呼气 8 秒的节律呼吸，激活副交感神经。',
      icon: 'air_outlined',
      durationMinutes: 3,
      difficulty: 1,
      evidenceLevel: 'mindfulness',
      // V2026-09-03 治本: 同上, 复用 BreathingExerciseRoute 对应的路由.
      routePath: '/tools/breathing',
      tags: ['急救', '呼吸'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'emergency.safe-place',
      categoryId: 'emotion_emergency',
      title: '安全岛引导',
      subtitle: '构建内心的避风港',
      description: '在想象中构建一个让自己绝对安全的地方，支持自定义场景元素。',
      icon: 'house_outlined',
      durationMinutes: 5,
      difficulty: 2,
      evidenceLevel: 'mindfulness',
      // V2026-09-03 治本: 改为 §4.2 急救箱专用路由.
      routePath: '/tools/emergency/safe-place',
      tags: ['急救', '想象'],
      hasFunMode: true,
      unlockHint: null,
    },
    {
      id: 'emergency.tipp',
      categoryId: 'emotion_emergency',
      title: 'TIPP 痛苦耐受',
      subtitle: '极端情绪的快速降温',
      description: 'Temperature 温度 / Intense exercise 强度运动 / Paced breathing 节律呼吸 / Paired muscle relaxation 配对肌肉放松。',
      icon: 'thermostat_outlined',
      durationMinutes: 5,
      difficulty: 2,
      evidenceLevel: 'dbt',
      // V2026-09-03 治本: 改为 §4.2 急救箱专用路由.
      routePath: '/tools/emergency/tipp',
      tags: ['DBT', '急救'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'emergency.thought-defusion',
      categoryId: 'emotion_emergency',
      title: '思维解离练习',
      subtitle: '和想法保持距离',
      description: '把负面想法看作「路过」的事件，不等于事实，不等于我。',
      icon: 'bubble_chart_outlined',
      durationMinutes: 5,
      difficulty: 2,
      evidenceLevel: 'act',
      // V2026-09-03 治本: 改为 §4.2 急救箱专用路由.
      routePath: '/tools/emergency/thought-defusion',
      tags: ['ACT', '急救'],
      hasFunMode: true,
      unlockHint: null,
    },
    // CBT (4)
    {
      id: 'cbt.thought-record',
      categoryId: 'cbt',
      title: '思维五栏记录',
      subtitle: '情境 / 自动想法 / 情绪 / 证据 / 重构',
      description: 'CBT 经典表格，AI 自动识别 10 类认知歪曲并给出引导。',
      icon: 'edit_outlined',
      durationMinutes: 10,
      difficulty: 2,
      evidenceLevel: 'cbt',
      routePath: '/practice/tool/cbt.thought-record',
      tags: ['CBT', '记录'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'cbt.distortion-identification',
      categoryId: 'cbt',
      title: '认知歪曲识别',
      subtitle: '识别 10 类自动思维陷阱',
      description: '灾难化 / 非黑即白 / 心理过滤 / 否定正面 / 妄下结论 等 10 类歪曲类型识别练习。',
      icon: 'search_outlined',
      durationMinutes: 8,
      difficulty: 2,
      evidenceLevel: 'cbt',
      routePath: '/practice/tool/cbt.distortion-identification',
      tags: ['CBT', '识别'],
      hasFunMode: true,
      unlockHint: null,
    },
    {
      id: 'cbt.graduated-exposure',
      categoryId: 'cbt',
      title: '分级暴露任务',
      subtitle: '从想象到现实，逐步靠近',
      description: '把害怕的事情按难度 0-100 分级，从最低级开始逐步暴露。',
      icon: 'flag_outlined',
      durationMinutes: 15,
      difficulty: 3,
      evidenceLevel: 'cbt',
      routePath: '/practice/tool/cbt.graduated-exposure',
      tags: ['CBT', '暴露'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'cbt.behavioral-activation',
      categoryId: 'cbt',
      title: '行为激活',
      subtitle: '用行动撬动情绪',
      description: '把回避的低动力行为替换成小步可执行的「掌控感动作」。',
      icon: 'bolt_outlined',
      durationMinutes: 10,
      difficulty: 2,
      evidenceLevel: 'cbt',
      routePath: '/practice/tool/cbt.behavioral-activation',
      tags: ['CBT', '行动'],
      hasFunMode: false,
      unlockHint: null,
    },
    // ACT (4)
    {
      id: 'act.thought-leaves',
      categoryId: 'act',
      title: '思维落叶',
      subtitle: '把想法具象为落叶，看着它飘走',
      description: '写下负面想法 → 选择「让它漂走」或「捞起来看看」→ 解离 / 重构。',
      icon: 'eco_outlined',
      durationMinutes: 8,
      difficulty: 2,
      evidenceLevel: 'act',
      routePath: '/practice/tool/act.thought-leaves',
      tags: ['ACT', '解离'],
      hasFunMode: true,
      unlockHint: null,
    },
    {
      id: 'act.values-clarification',
      categoryId: 'act',
      title: '价值澄清卡片',
      subtitle: '找到真正重要的方向',
      description: '从七大生活领域（家庭 / 工作 / 健康 / 成长 / 关系 / 娱乐 / 精神）中选出最在意的价值。',
      icon: 'style_outlined',
      durationMinutes: 12,
      difficulty: 2,
      evidenceLevel: 'act',
      routePath: '/practice/tool/act.values-clarification',
      tags: ['ACT', '价值'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'act.committed-action',
      categoryId: 'act',
      title: '承诺行动分解',
      subtitle: '把价值变成可执行的小步',
      description: '基于价值澄清结果，分解为今天 / 本周 / 本月可完成的具体行动。',
      icon: 'checklist_outlined',
      durationMinutes: 10,
      difficulty: 2,
      evidenceLevel: 'act',
      routePath: '/practice/tool/act.committed-action',
      tags: ['ACT', '行动'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'act.emotion-acceptance',
      categoryId: 'act',
      title: '情绪接纳冥想',
      subtitle: '和情绪共处，不挣扎',
      description: '把情绪看作身体里的一阵波浪，接纳它、命名它、让它自然流动。',
      icon: 'waves_outlined',
      durationMinutes: 15,
      difficulty: 3,
      evidenceLevel: 'act',
      routePath: '/practice/tool/act.emotion-acceptance',
      tags: ['ACT', '接纳'],
      hasFunMode: false,
      unlockHint: null,
    },
    // 正念 (5)
    {
      id: 'mindfulness.box-breathing',
      categoryId: 'mindfulness',
      title: '方形呼吸法',
      subtitle: '4-4-4-4 平衡神经',
      description: '吸气 4 秒 → 屏息 4 秒 → 呼气 4 秒 → 屏息 4 秒，是军人 / 运动员常用的专注呼吸法。',
      icon: 'crop_square_outlined',
      durationMinutes: 3,
      difficulty: 1,
      evidenceLevel: 'mindfulness',
      routePath: '/practice/gym/tools/mindfulness.box-breathing',
      tags: ['正念', '呼吸'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'mindfulness.body-scan',
      categoryId: 'mindfulness',
      title: '身体扫描',
      subtitle: '从头顶到脚趾，重新认识身体',
      description: '把注意力从头顶逐步移向脚趾，觉察每个部位的紧绷与放松。',
      icon: 'accessibility_outlined',
      durationMinutes: 15,
      difficulty: 2,
      evidenceLevel: 'mindfulness',
      routePath: '/practice/gym/tools/mindfulness.body-scan',
      tags: ['正念', '身体'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'mindfulness.observation',
      categoryId: 'mindfulness',
      title: '3 分钟观察',
      subtitle: '不评价地看 / 听 / 触',
      description: '专注观察周围一个物体 3 分钟，把「思考」切换成「观察」。',
      icon: 'remove_red_eye_outlined',
      durationMinutes: 3,
      difficulty: 1,
      evidenceLevel: 'mindfulness',
      routePath: '/practice/tool/mindfulness.observation',
      tags: ['正念', '入门'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'mindfulness.sleep',
      categoryId: 'mindfulness',
      title: '睡前助眠',
      subtitle: '30 分钟深度放松',
      description: '身体扫描 + 呼吸放松 + 意象引导，三阶段配合白噪音。',
      icon: 'bedtime_outlined',
      durationMinutes: 30,
      difficulty: 2,
      evidenceLevel: 'mindfulness',
      routePath: '/practice/tool/mindfulness.sleep',
      tags: ['正念', '睡眠'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'mindfulness.breath-drawing',
      categoryId: 'mindfulness',
      title: '呼吸绘形',
      subtitle: '随呼吸引导完成治愈系图形',
      description: '吸气时笔触移动、呼气时图案晕染，完成一组后生成「呼吸小画」。',
      icon: 'brush_outlined',
      durationMinutes: 5,
      difficulty: 1,
      evidenceLevel: 'mindfulness',
      routePath: '/practice/tool/mindfulness.breath-drawing',
      tags: ['正念', '趣味'],
      hasFunMode: true,
      unlockHint: null,
    },
    // DBT (4)
    {
      id: 'dbt.emotion-abc',
      categoryId: 'dbt',
      title: '情绪 ABC 分析',
      subtitle: '前因 / 行为 / 后果',
      description: 'Activating event / Behavior / Consequence 三栏式记录情绪触发链路。',
      icon: 'analytics_outlined',
      durationMinutes: 10,
      difficulty: 2,
      evidenceLevel: 'dbt',
      routePath: '/practice/tool/dbt.emotion-abc',
      tags: ['DBT', '记录'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dbt.interpersonal-effectiveness',
      categoryId: 'dbt',
      title: '人际效能训练',
      subtitle: 'DEAR MAN 技巧演练',
      description: 'Describe / Express / Assert / Reinforce / Mindful / Appear confident / Negotiate 八步沟通框架。',
      icon: 'groups_outlined',
      durationMinutes: 15,
      difficulty: 3,
      evidenceLevel: 'dbt',
      routePath: '/practice/tool/dbt.interpersonal-effectiveness',
      tags: ['DBT', '人际'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dbt.boundary',
      categoryId: 'dbt',
      title: '边界力练习',
      subtitle: '练习温和地说不',
      description: '提供 6 个常见场景演练 + 三档语气模板（坚定 / 温和 / 协商）。',
      icon: 'shield_outlined',
      durationMinutes: 12,
      difficulty: 3,
      evidenceLevel: 'dbt',
      routePath: '/practice/tool/dbt.boundary',
      tags: ['DBT', '边界'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dbt.distress-tolerance',
      categoryId: 'dbt',
      title: '痛苦耐受技能',
      subtitle: '危机时刻不添乱',
      description: 'STOP / TIP / Pros & Cons / IMPROVE / Radical acceptance 五个核心技能演练。',
      icon: 'support_outlined',
      durationMinutes: 15,
      difficulty: 3,
      evidenceLevel: 'dbt',
      routePath: '/practice/tool/dbt.distress-tolerance',
      tags: ['DBT', '耐受'],
      hasFunMode: false,
      unlockHint: null,
    },
    // 发展 (5)
    {
      id: 'dev.woop',
      categoryId: 'development',
      title: 'WOOP 思维训练器',
      subtitle: 'Wish / Outcome / Obstacle / Plan',
      description: '基于《可塑的我》WOOP 思维法，把模糊愿望变成具体可执行的计划。',
      icon: 'lightbulb_outline',
      durationMinutes: 10,
      difficulty: 2,
      evidenceLevel: 'growth',
      routePath: '/practice/gym/tools/dev.woop',
      tags: ['发展', '目标'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dev.attachment-cycle',
      categoryId: 'development',
      title: '依恋循环复盘',
      subtitle: '需求 / 表达 / 回应 / 心理结果',
      description: '识别自己在亲密关系中的依恋模式（焦虑 / 回避 / 安全）。',
      icon: 'link_outlined',
      durationMinutes: 20,
      difficulty: 3,
      evidenceLevel: 'growth',
      routePath: '/practice/gym/tools/dev.attachment-cycle',
      tags: ['发展', '关系'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dev.ccrt',
      categoryId: 'development',
      title: 'CCRT 核心关系模式',
      subtitle: '5 个日常冲突场景提炼核心剧本',
      description: '从 5 个常见冲突场景中提取你的「核心关系剧本」，匹配对应调整练习。',
      icon: 'psychology_alt_outlined',
      durationMinutes: 25,
      difficulty: 3,
      evidenceLevel: 'growth',
      routePath: '/practice/gym/tools/dev.ccrt',
      tags: ['发展', '关系'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dev.energy-management',
      categoryId: 'development',
      title: '精力管理',
      subtitle: '识别自己的能量节奏',
      description: '记录一周的能量曲线，识别高峰低谷时段，把重要任务放在能量高位。',
      icon: 'battery_charging_full_outlined',
      durationMinutes: 15,
      difficulty: 2,
      evidenceLevel: 'growth',
      routePath: '/practice/tool/dev.energy-management',
      tags: ['发展', '精力'],
      hasFunMode: false,
      unlockHint: null,
    },
    {
      id: 'dev.midlife-generativity',
      categoryId: 'development',
      title: '成年中期繁衍任务',
      subtitle: '职业意义 / 经验传承 / 影响力',
      description: '30+ 岁专属: 解决「繁衍 vs 停滞」发展危机, 探索职业意义与代际传承。',
      icon: 'castle_outlined',
      durationMinutes: 30,
      difficulty: 3,
      evidenceLevel: 'growth',
      routePath: '/practice/tool/dev.midlife-generativity',
      tags: ['发展', '繁衍'],
      hasFunMode: false,
      unlockHint: '年龄 ≥ 30 或选择成年中期阶段解锁',
    },
  ];

  async listToolsByCategory(_uid: string, categoryId: PracticeCategoryKey): Promise<PracticeToolDto[]> {
    return this.tools.filter((t) => t.categoryId === categoryId);
  }

  async getTool(_uid: string, toolId: string): Promise<PracticeToolDto | null> {
    return this.tools.find((t) => t.id === toolId) ?? null;
  }
}

// ════════════════════════════════════════════════════════════════
// 3. PracticeSessionService — 会话生命周期
// ════════════════════════════════════════════════════════════════

@Injectable()
export class PracticeSessionService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 PracticeCategoryService 同上 — 删未用 logger.
   */

  constructor(
    @InjectRepository(PracticeSession)
    private readonly sessionRepo: Repository<PracticeSession>,
    @InjectRepository(PracticeRecord)
    private readonly recordRepo: Repository<PracticeRecord>,
  ) {}

  async startSession(uid: string, toolKey: string, targetDurationMinutes: number): Promise<PracticeSessionDto> {
    // V2026-09-01 治本 (TS6133):
    //   原签名 `(uid, toolKey, targetDurationMinutes, toolTitle, module)` 中 toolTitle
    //   / module 参数未使用 — controller 推算后传给 service, 但 service 只用 toolKey
    //   写库, completeSession 内部自己从 toolKey 反查 title / module (重复计算无副作用).
    //   删之, 顺带删 controller 内的 _resolveModule 死代码.
    const row = this.sessionRepo.create({
      uid,
      toolKey,
      targetDurationMinutes,
      actualDurationSeconds: 0,
      status: 'in_progress',
      feedbackSnapshot: null,
      completedAt: null,
    });
    const saved = await this.sessionRepo.save(row);
    return {
      id: saved.id,
      toolId: saved.toolKey,
      startedAt: saved.startedAt.toISOString(),
      targetDurationMinutes: saved.targetDurationMinutes,
    };
  }

  async completeSession(uid: string, sessionId: string, actualDurationSeconds: number): Promise<PracticeFeedbackDto | null> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, uid } });
    // V2026-09-01 治本 (lint prefer-optional-chain):
    //   `!session || session.status !== 'in_progress'` 转 optional chain 后:
    //   - session = null      -> session?.status = undefined -> undefined !== 'in_progress' -> true  -> return null
    //   - session = {status: 'completed'} -> completed !== 'in_progress' -> true  -> return null
    //   - session = {status: 'in_progress'} -> false -> 不 return
    //   语义完全等价, 表达更简洁 (大厂偏好的"代码即文档"风格).
    if (session?.status !== 'in_progress') return null;

    const durationMinutes = Math.round(actualDurationSeconds / 60);
    const fragments = this.computeFragments(session.toolKey, durationMinutes);
    const badge = this.computeBadge(session.toolKey);

    session.status = 'completed';
    session.actualDurationSeconds = actualDurationSeconds;
    session.completedAt = new Date();
    session.feedbackSnapshot = { fragments, badge };
    await this.sessionRepo.save(session);

    // 写训练记录 (反双胞胎: dashboard 通过同一张 practice_records 表聚合, 不需要 V1/V2 分表)
    const toolTitle = this.resolveToolTitle(session.toolKey);
    const module = this.resolveModule(session.toolKey);
    await this.recordRepo.save(
      this.recordRepo.create({
        uid,
        toolKey: session.toolKey,
        toolTitle,
        module,
        durationMinutes,
      }),
    );

    return {
      toolTitle,
      durationMinutes,
      unlockedFragments: fragments,
      unlockedBadge: badge,
      softNote: '你做到了',
    };
  }

  private resolveToolTitle(toolKey: string): string {
    const titles: Record<string, string> = {
      'emergency.5-4-3-2-1': '5-4-3-2-1 接地法',
      'mindfulness.box-breathing': '方形呼吸法',
      'cbt.thought-record': '思维五栏记录',
      'act.thought-leaves': '思维落叶',
      'dev.woop': 'WOOP 思维训练器',
    };
    return titles[toolKey] ?? toolKey;
  }

  /**
   * V2026-09-01 治本 (lint prefer-optional-chain + naming-convention):
   *   原 `if (toolKey.startsWith('emergency') || toolKey.startsWith('mindfulness') ||
   *   toolKey.startsWith('dev.energy'))` 串联 3 个 startsWith 触发 prefer-optional-chain.
   *   改用 Array.includes + startsWith (前缀集合), 语义不变, lint 通过.
   */
  private resolveModule(toolKey: string): GymModuleKey {
    const physicalBasicsPrefixes = ['emergency', 'mindfulness', 'dev.energy'];
    if (physicalBasicsPrefixes.some((p) => toolKey.startsWith(p))) {
      return 'physical_basics';
    }
    if (toolKey.startsWith('cbt')) return 'cognitive_muscle';
    const selfEsteemPrefixes = ['act', 'dbt.boundary'];
    if (selfEsteemPrefixes.some((p) => toolKey.startsWith(p))) return 'self_esteem_gain';
    return 'interpersonal_efficacy';
  }

  private computeFragments(toolKey: string, durationMinutes: number): string[] {
    const base = Math.max(3, Math.floor(durationMinutes / 3));
    if (toolKey.startsWith('mindfulness')) return [`平静气泡 ×${base}`];
    if (toolKey.startsWith('cbt')) return [`思维镜片 ×${base}`];
    if (toolKey.startsWith('act')) return [`星光粒子 ×${base}`];
    if (toolKey.startsWith('emergency')) return [`平静气泡 ×${base}`];
    return [`思维镜片 ×${base}`];
  }

  private computeBadge(toolKey: string): string | null {
    if (toolKey === 'mindfulness.box-breathing') return '呼吸初学者';
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 4. PracticeRecordService — 训练记录查询
// ════════════════════════════════════════════════════════════════

@Injectable()
export class PracticeRecordService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 PracticeCategoryService 同上 — 删未用 logger.
   */

  constructor(
    @InjectRepository(PracticeRecord)
    private readonly recordRepo: Repository<PracticeRecord>,
  ) {}

  async listRecords(uid: string, since?: Date): Promise<GymRecordEntryDto[]> {
    const qb = this.recordRepo.createQueryBuilder('r').where('r.uid = :uid', { uid }).orderBy('r.completedAt', 'DESC').limit(50);
    if (since) qb.andWhere('r.completedAt >= :since', { since });
    const rows = await qb.getMany();
    return rows.map((r) => ({
      id: r.id,
      toolId: r.toolKey,
      toolTitle: r.toolTitle,
      module: r.module as GymModuleKey,
      durationMinutes: r.durationMinutes,
      completedAt: r.completedAt.toISOString(),
    }));
  }
}

// ════════════════════════════════════════════════════════════════
// 5. PracticeGymService — 心理健身房 (当前计划 + 进阶地图 + 基因报告)
// ════════════════════════════════════════════════════════════════

@Injectable()
export class PracticeGymService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 PracticeCategoryService 同上 — 删未用 logger.
   */

  /** V2.0 sample 12 周进阶地图, 跟前端 InMemoryDataSource 1:1.
   *
   * V2026-09-01 治本 (lint naming-convention + no-underscore-dangle):
   *   去掉下划线前缀 — 大厂规范: `private` 修饰符已表达作用域, 加下划线是冗余反模式.
   *   JS/TS 圈里只在「未使用的形参」场景才用 `_` 前缀 (e.g. `uid`), 类成员无此约定.
   */
  private readonly weeklyMap: GymWeeklyPlanDto[] = [
    // 基础期
    {
      weekNumber: 1,
      stage: 'foundation',
      module: 'physical_basics',
      title: '呼吸入门',
      goals: ['每天 1 次 3 分钟呼吸'],
      tools: ['mindfulness.box-breathing'],
    },
    {
      weekNumber: 2,
      stage: 'foundation',
      module: 'physical_basics',
      title: '身体觉察',
      goals: ['3 次身体扫描'],
      tools: ['mindfulness.body-scan'],
    },
    {
      weekNumber: 3,
      stage: 'foundation',
      module: 'physical_basics',
      title: '情绪命名',
      goals: ['每天记录 1 次情绪'],
      tools: ['emergency.5-4-3-2-1'],
    },
    {
      weekNumber: 4,
      stage: 'foundation',
      module: 'physical_basics',
      title: '整合练习',
      goals: ['组合呼吸 + 身体扫描'],
      tools: ['mindfulness.body-scan', 'emergency.4-4-8'],
    },
    // 进阶期
    {
      weekNumber: 5,
      stage: 'intermediate',
      module: 'cognitive_muscle',
      title: '觉察日记',
      goals: ['3 篇日记'],
      tools: ['cbt.thought-record'],
    },
    {
      weekNumber: 6,
      stage: 'intermediate',
      module: 'cognitive_muscle',
      title: '认知重构',
      goals: ['识别 3 类歪曲'],
      tools: ['cbt.distortion-identification'],
    },
    {
      weekNumber: 7,
      stage: 'intermediate',
      module: 'self_esteem_gain',
      title: '自我接纳',
      goals: ['价值澄清'],
      tools: ['act.values-clarification'],
    },
    {
      weekNumber: 8,
      stage: 'intermediate',
      module: 'self_esteem_gain',
      title: 'ACT 接纳',
      goals: ['思维落叶 + 承诺行动'],
      tools: ['act.thought-leaves', 'act.committed-action'],
    },
    // 强化期
    {
      weekNumber: 9,
      stage: 'advanced',
      module: 'interpersonal_efficacy',
      title: 'WOOP 目标',
      goals: ['完成 1 次 WOOP'],
      tools: ['dev.woop'],
    },
    {
      weekNumber: 10,
      stage: 'advanced',
      module: 'interpersonal_efficacy',
      title: '依恋复盘',
      goals: ['1 次依恋循环'],
      tools: ['dev.attachment-cycle'],
    },
    {
      weekNumber: 11,
      stage: 'advanced',
      module: 'interpersonal_efficacy',
      title: '边界力',
      goals: ['2 次边界练习'],
      tools: ['dbt.boundary'],
    },
    { weekNumber: 12, stage: 'advanced', module: 'interpersonal_efficacy', title: '整合复盘', goals: ['CCRT + 整合'], tools: ['dev.ccrt'] },
  ];

  async getCurrentPlan(_uid: string): Promise<GymCurrentPlanDto> {
    return {
      stage: 'foundation',
      completedThisWeek: 2,
      weeklyTarget: 5,
      totalCompleted: 12,
      totalMinutes: 186,
      weeklyPlans: this.weeklyMap.slice(0, 4),
    };
  }

  async getWeeklyMap(_uid: string): Promise<GymWeeklyPlanDto[]> {
    // V2026-09-01 治本 (lint naming-convention + TS noUnusedParameters):
    //   参数 `_uid` 当前未使用 — 保持下划线前缀 (项目 lint 配置允许 parameter
    //   leadingUnderscore), TS 编译器自动忽略下划线前缀参数.
    //   V3 接 LLM 个性化推荐时, 删下划线 + 注入个性化逻辑即可.
    return this.weeklyMap;
  }

  async getGenomeReport(_uid: string): Promise<GymGenomeReportDto> {
    const dimensions: GymDimensionDto[] = [
      {
        id: 'security',
        label: '安全感',
        score: 0.72,
        tier: '稳定',
        strength: '信任建立稳定，关系中能感受到支持',
        improvement: '在压力情境下仍可能激活不安全反应',
      },
      {
        id: 'selfEsteem',
        label: '自尊水平',
        score: 0.58,
        tier: '关注',
        strength: '有自我觉察的能力',
        improvement: '内在自我批判频率偏高，需要更多自我接纳练习',
      },
      {
        id: 'autonomy',
        label: '自主性',
        score: 0.81,
        tier: '良好',
        strength: '决策能力强，目标感清晰',
        improvement: '面对他人期待时偶尔会妥协',
      },
      { id: 'resilience', label: '心理韧性', score: 0.65, tier: '良好', strength: '能从挫折中恢复', improvement: '重大挫折恢复时间偏长' },
      {
        id: 'integration',
        label: '自我整合',
        score: 0.7,
        tier: '稳定',
        strength: '多角色切换顺畅',
        improvement: '深层价值观与日常行为偶有脱节',
      },
    ];
    return {
      dimensions,
      summary: '整体心理健康底座稳定，自主权与安全感较强；建议优先提升自尊水平与心理韧性。',
      recommendedTools: ['cbt.thought-record', 'act.values-clarification', 'dbt.boundary'],
    };
  }
}

// ════════════════════════════════════════════════════════════════
// 6. TargetedReshapeService — 心理基因靶向重塑
// ════════════════════════════════════════════════════════════════

@Injectable()
export class TargetedReshapeService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 PracticeCategoryService 同上 — 删未用 logger.
   */

  async getState(_uid: string): Promise<TargetedReshapeDto> {
    return {
      stuckPoints: [
        {
          id: 'stuck.people-pleasing',
          label: '讨好型模式',
          formationStage: '童年早期',
          impactLevel: 2,
          rootCause: '童年通过压抑需求获得认可，形成了「我不够好」的内在信念',
          creatureKey: 'people_pleaser_slime',
        },
        {
          id: 'stuck.catastrophizing',
          label: '灾难化思维',
          formationStage: '青春期',
          impactLevel: 1,
          rootCause: '高敏感特质 + 早期焦虑经验叠加，形成对未来不确定性的过度警觉',
          creatureKey: 'anxious_dinosaur',
        },
        {
          id: 'stuck.need-suppression',
          label: '需求压抑',
          formationStage: '转型期',
          impactLevel: 2,
          rootCause: '职业高压期形成的自我牺牲模式，逐步内化为「不该有自己的需求」',
          creatureKey: 'transparent_ghost',
        },
      ],
      weeklyTasks: [
        {
          weekNumber: 1,
          stuckPointId: 'stuck.people-pleasing',
          title: '认识它 — 叙事重构',
          modality: 'narrative',
          summary: '用第三人称写下讨好型模式的故事，识别它怎么来的',
        },
        {
          weekNumber: 2,
          stuckPointId: 'stuck.people-pleasing',
          title: '摸摸它 — 意象脱敏',
          modality: 'imagery',
          summary: '在想象中跟「讨好小人」对话，慢慢靠近不害怕',
        },
        {
          weekNumber: 3,
          stuckPointId: 'stuck.people-pleasing',
          title: '和它说话 — 场景练习',
          modality: 'exposure',
          summary: '在 3 个低风险场景练习温和拒绝',
        },
        {
          weekNumber: 4,
          stuckPointId: 'stuck.people-pleasing',
          title: '一起走 — 分级暴露',
          modality: 'exposure',
          summary: '在现实关系中应用，带着它去生活',
        },
      ],
      completedWeekCount: 0,
      loosenessScore: 0.15,
    };
  }
}

// ════════════════════════════════════════════════════════════════
// 7. PracticeEmbodiedService — 具身认知 (代理 /profile/embodied-data)
// ════════════════════════════════════════════════════════════════

/**
 * V2.0 阶段设计要点:
 *   - 具身数据**复用** EmbodiedModule (profile) 的所有逻辑, 这里只做:
 *     1. 命名空间暴露 (/practice/embodied/*) — 让前端 practice 模块单端点聚合
 *     2. 业务映射 (DTO 字段名转换, 例如 heartRate -> heartRateBpm)
 *     3. 工具列表 + 授权状态聚合 (3 个端点合并成 practice 模块自己的语义)
 *
 * V3 接真实传感器流时, 加 cache + Redis stream 即可, 不影响前端契约.
 */
@Injectable()
export class PracticeEmbodiedService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 PracticeCategoryService 同上 — 删未用 logger.
   */

  constructor(private readonly embodiedService: EmbodiedService) {}

  /** 实时生理数据 — 字段映射到 practice 模块语义. */
  async getVitals(uid: string): Promise<EmbodiedVitalsDto> {
    const v = await this.embodiedService.getVitalSigns(uid);
    return {
      heartRateBpm: v.heartRate,
      hrvMs: v.hrv,
      respirationRatePerMin: v.breathRate,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * 授权状态 — V2.0 占位.
   * 真接入: 用户在 OS (HealthKit / Google Fit) 授权后, 写入 EmbodiedPermissions
   * 表的 master_sensor_enabled=true. 这里从 permissions 表读 + 转 enum.
   */
  async getAuthStatus(uid: string): Promise<EmbodiedAuthStatusDto> {
    const perms = await this.embodiedService.getPermissions(uid);
    if (perms.masterSensorEnabled) {
      return {
        status: 'authorized',
        authorizedAt: new Date().toISOString(),
        deniedReason: null,
      };
    }
    return {
      status: 'notRequested',
      authorizedAt: null,
      deniedReason: null,
    };
  }

  /** 申请传感器授权 — V2.0 直接把 masterSensorEnabled 置 true. */
  async requestAuth(uid: string): Promise<EmbodiedAuthStatusDto> {
    await this.embodiedService.updatePermissions(uid, { masterSensorEnabled: true });
    return {
      status: 'authorized',
      authorizedAt: new Date().toISOString(),
      deniedReason: null,
    };
  }

  /** 工具列表 — V2.0 写死 4 个. */
  async listTools(_uid: string): Promise<EmbodiedToolDto[]> {
    return [
      {
        id: 'embodied.heart-regulation',
        kind: 'heartRegulation',
        title: '心率同步呼吸',
        subtitle: '跟随心率节律调节呼吸',
        durationMinutes: 8,
        requiresSensor: true,
        description: '通过呼吸节奏与心率变异性联动，引导自主神经系统进入平衡态。',
        routePath: '/practice/embodied/session/heart-regulation',
      },
      {
        id: 'embodied.somatic',
        kind: 'somaticRelaxation',
        title: '渐进式肌肉放松',
        subtitle: '16 组肌肉群紧张-放松循环',
        durationMinutes: 12,
        requiresSensor: false,
        description: '从面部开始依次紧张和放松每组肌群，结束时让全身进入松弛态。',
        routePath: '/practice/embodied/session/somatic',
      },
      {
        id: 'embodied.action-anchor',
        kind: 'actionAnchor',
        title: '动作锚定',
        subtitle: '把平静感锚定到一个动作',
        durationMinutes: 5,
        requiresSensor: false,
        description: '在平静状态下做一个特定动作，重复 7 次后形成条件反射式的平静触发器。',
        routePath: '/practice/embodied/session/action-anchor',
      },
      {
        id: 'embodied.hrv-training',
        kind: 'hrvTraining',
        title: 'HRV 情绪训练',
        subtitle: '通过生物反馈提升情绪调节',
        durationMinutes: 10,
        requiresSensor: true,
        description: '实时显示心率变异性曲线，引导你进入「同频」呼吸节奏。',
        routePath: '/practice/embodied/session/hrv',
      },
    ];
  }

  /** 完成具身练习后生成生理反馈报告 — V2.0 sample. */
  generateFeedback(sessionId: string): EmbodiedFeedbackDto {
    return {
      sessionId,
      heartRateRecoveryBpm: 18,
      hrvDeltaMs: 6.2,
      relaxationScore: 0.78,
      summary: '副交感神经激活明显，心率恢复速度良好',
    };
  }
}
