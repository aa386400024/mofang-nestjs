import { Injectable } from '@nestjs/common';

import {
  type LoosenessReportDto,
  type ReshapeWeeklyTaskDto,
  type StuckPointDto,
  type StuckPointId,
  type TargetedReshapeStatusDto,
  CompleteTaskDto,
} from '../dto/genome-reshape.dto';

/**
 * 心理基因靶向重塑服务 — V3.0 §3 Tab3 评估子模块 + 心理健身房共用.
 *
 * V3.0 范围:
 *   - 3 个核心卡点 (从心理基因报告派生)
 *   - 4 周渐进重塑计划 (每卡点 4 周)
 *   - 进度跟踪 + 松动度上报
 *   - 趣味模式: 小怪兽图鉴解锁
 *
 * V3.0 治本:
 *   - 全内存态: 用户进度 Map, 卡点规则静态
 *   - 跟 LifeMapService 共享 stuck_point 来源 (心理基因盘点) — 接口层而非数据层
 *   - 不依赖外部 AI 服务
 *
 * 大厂原则:
 *   - 单一职责: 卡点识别由 genome report 完成, 本 service 只做重塑执行
 *   - 4 周任务定义静态, 解锁 + 完成态动态计算
 *   - 趣味数据 (creatureKey) 跟任务耦合, 完成任务自动解锁对应小怪兽
 */
@Injectable()
export class GenomeReshapeService {
  // ═════════════════════════════════════════════════════════════
  // 静态卡点库
  // ═════════════════════════════════════════════════════════════

  readonly stuckPoints: StuckPointDto[] = [
    {
      id: 'people_pleaser',
      label: '讨好型模式',
      formationStage: '童年 (0-12 岁)',
      impactLevel: 4,
      rootCause: '童年需求常被否定, 形成 "我不值得被爱" 的核心信念',
      creatureKey: 'people_pleaser_slime',
      creatureTrait: '软趴趴想贴向别人, 不敢说不',
    },
    {
      id: 'catastrophizing',
      label: '灾难化思维',
      formationStage: '青少年 (12-18 岁)',
      impactLevel: 3,
      rootCause: '高压成长环境, 形成 "坏事一定会发生在我身上" 的预期',
      creatureKey: 'catastrophe_dino',
      creatureTrait: '圆滚滚背冒小火苗, 容易慌',
    },
    {
      id: 'need_suppress',
      label: '需求压抑',
      formationStage: '童年 (0-12 岁)',
      impactLevel: 5,
      rootCause: '表达需求常被忽视, 形成 "我的需求不重要" 的压抑模式',
      creatureKey: 'need_ghost',
      creatureTrait: '半透明, 总是躲在角落',
    },
  ];

  /**
   * 4 周任务模板 — 每个卡点对应一组 4 周渐进任务.
   * V3.0 治本: 任务定义静态, V3.1 接 LLM 动态生成个性化任务.
   */
  readonly weeklyTaskTemplates: Record<StuckPointId, Omit<ReshapeWeeklyTaskDto, 'weekNumber' | 'unlocked' | 'completed'>[]> = {
    people_pleaser: [
      {
        stuckPointId: 'people_pleaser',
        title: '认识讨好型怪兽',
        modality: 'narrative',
        summary: '回忆讨好型模式最初如何形成',
        steps: [
          '写下 5 个你讨好过的具体场景',
          '识别讨好时的身体反应 (心跳/胃部不适)',
          '追溯最早的一次 "为了不让人失望而委屈自己" 的记忆',
          '给自己写一段话: "你不需要让所有人满意"',
        ],
      },
      {
        stuckPointId: 'people_pleaser',
        title: '摸一摸讨好型怪兽',
        modality: 'imagery_desensitization',
        summary: '在安全想象空间, 慢慢靠近它',
        steps: [
          '想象讨好型模式是一个具体的形态 (动物/颜色/形状)',
          '想象自己安全地站在远处观察它',
          '逐步靠近, 注意身体的反应',
          '如果害怕就停下来, 告诉自己 "我可以选择靠近的节奏"',
        ],
      },
      {
        stuckPointId: 'people_pleaser',
        title: '和讨好型怪兽说话',
        modality: 'relational_drill',
        summary: '练习拒绝一个不重要的请求',
        steps: [
          '本周找出 1 个可以拒绝的小请求',
          '写下拒绝的话 (先写下来, 说出来更稳)',
          '说出后记录对方的反应 + 你的感受',
          '无论结果如何, 给自己一个肯定',
        ],
      },
      {
        stuckPointId: 'people_pleaser',
        title: '带着讨好型怪兽去新场景',
        modality: 'graded_exposure',
        summary: '在真实场景中, 练习有边界的相处',
        steps: [
          '选择一个你常讨好的关系',
          '在 1 次互动中, 至少说一次 1 次 "不"',
          '记录: 拒绝后关系真的变了吗?',
          '用 "我变得不那么累了" 作为这次行动的奖赏',
        ],
      },
    ],
    catastrophizing: [
      {
        stuckPointId: 'catastrophizing',
        title: '认识焦虑小恐龙',
        modality: 'narrative',
        summary: '识别灾难化触发的具体场景',
        steps: [
          '写下本周 3 个让你觉得 "完了完了" 的瞬间',
          '给每个瞬间的 "灾难想象" 打个分 (0-100)',
          '区分 "想象" vs "真实发生" 的差距',
          '写下 "最坏情况下, 真实会发生什么"',
        ],
      },
      {
        stuckPointId: 'catastrophizing',
        title: '摸一摸焦虑小恐龙',
        modality: 'imagery_desensitization',
        summary: '让小恐龙的火苗变小',
        steps: [
          '焦虑时做 1 次 4-7-8 呼吸 (吸 4 秒, 屏 7 秒, 呼 8 秒)',
          '想象焦虑是火苗, 呼气时火苗变小',
          '连续 3 次后, 重新评估灾难想象的分值',
          '对比: 呼吸前后的分值差差',
        ],
      },
      {
        stuckPointId: 'catastrophizing',
        title: '和焦虑小恐龙说话',
        modality: 'relational_drill',
        summary: '练习 "最可能发生" 的视角替换',
        steps: [
          '当灾难想象出现时, 写下 "最可能发生" 的版本',
          '对比: 灾难想象 vs 最可能发生',
          '通常会发现: 大多数灾难不会真的发生',
          '给自己: "我已经能识别灾难化, 这就是进步"',
        ],
      },
      {
        stuckPointId: 'catastrophizing',
        title: '带着小恐龙去新场景',
        modality: 'graded_exposure',
        summary: '在可控场景中, 主动降低风险预期',
        steps: [
          '选择一个你常恐惧的领域',
          '给自己: "我主动走进去看看会发生什么"',
          '记录: 真实结果 vs 灾难想象的差距',
          '复盘: 你的恐惧被夸大多少?',
        ],
      },
    ],
    need_suppress: [
      {
        stuckPointId: 'need_suppress',
        title: '认识透明小幽灵',
        modality: 'narrative',
        summary: '识别被压抑的需求',
        steps: [
          '本周写下 3 个你 "想要但没说出口" 的需求',
          '给每个需求贴标签: 关系 / 物质 / 情感 / 空间',
          '追溯: 这个需求第一次被否定是什么时候?',
          '告诉自己: "我的需求值得被听见"',
        ],
      },
      {
        stuckPointId: 'need_suppress',
        title: '摸一摸透明小幽灵',
        modality: 'imagery_desensitization',
        summary: '让小幽灵慢慢变清晰',
        steps: [
          '想象需求是透明的, 需要被看见',
          '找一个安全的人 (朋友 / AI / 写日记), 说出 1 个需求',
          '注意: 说出来后身体的反应',
          '记录: 你的需求被拒绝的次数 vs 满足的次数',
        ],
      },
      {
        stuckPointId: 'need_suppress',
        title: '和透明小幽灵说话',
        modality: 'relational_drill',
        summary: '在低风险场景中, 练习表达需求',
        steps: [
          '本周 1 次, 向亲近的人说: "我需要..."',
          '无论对方是否回应, 你已经做完了这一步',
          '记录: 表达后你的感受变化',
          '告诉自己: "我的需求不会因为说出来就消失"',
        ],
      },
      {
        stuckPointId: 'need_suppress',
        title: '带着小幽灵去新场景',
        modality: 'graded_exposure',
        summary: '在更高风险的关系中, 表达需求',
        steps: ['选择一个你常压抑需求的场景', '提前写好 "我需要..." 的话', '说出来, 记录对方的反应', '无论结果如何, 这是一次巨大的突破'],
      },
    ],
    self_blame: [
      {
        stuckPointId: 'self_blame',
        title: '认识自我责备幽灵',
        modality: 'narrative',
        summary: '追溯自我责备的根源',
        steps: [
          '写下本周 3 次 "都怪我" 的瞬间',
          '给每个瞬间找一个外部原因',
          '对比: 你的责任 vs 整体情境的责任',
          '通常会发现: 你的责任被夸大',
        ],
      },
      {
        stuckPointId: 'self_blame',
        title: '摸一摸自我责备幽灵',
        modality: 'imagery_desensitization',
        summary: '在安全空间, 给幽灵一个拥抱',
        steps: ['想象自我责备是冰冷的声音', '想象一个温暖的声音说: "这不完全是你的错"', '让两个声音对话, 观察变化', '让温暖声音变得更强'],
      },
      {
        stuckPointId: 'self_blame',
        title: '和自我责备幽灵说话',
        modality: 'relational_drill',
        summary: '把 "都怪我" 换成 "我能做什么"',
        steps: ['本周 1 次: 把 "都怪我" 换成 "我下次可以..."', '记录: 这两个句子的情绪差异', '告诉自己: "我已经不怪自己了"'],
      },
      {
        stuckPointId: 'self_blame',
        title: '带着幽灵去新场景',
        modality: 'graded_exposure',
        summary: '在真实挫败中, 练习自我原谅',
        steps: [
          '本周允许自己犯 1 个错',
          '不批评自己, 只问: "我学到了什么?"',
          '记录: 自我原谅后的感受',
          '复盘: 不责备自己, 事情是否变得更糟?',
        ],
      },
    ],
    avoidance: [
      {
        stuckPointId: 'avoidance',
        title: '认识回避型幽灵',
        modality: 'narrative',
        summary: '识别回避的场景',
        steps: [
          '写下本周 3 次你选择回避的场景',
          '给每个回避贴标签: 怕失败 / 怕拒绝 / 怕受伤 / 怕冲突',
          '追溯: 第一次学会回避是什么时候?',
          '告诉自己: "我可以慢慢来"',
        ],
      },
      {
        stuckPointId: 'avoidance',
        title: '摸一摸回避型幽灵',
        modality: 'imagery_desensitization',
        summary: '让回避慢慢变温和',
        steps: ['想象回避是灰色的厚墙', '想象墙上有一个小门, 是你可以打开的', '告诉自己: "我可以只看一眼"', '打开门, 不必走出去'],
      },
      {
        stuckPointId: 'avoidance',
        title: '和回避型幽灵说话',
        modality: 'relational_drill',
        summary: '从一个最小的行动开始',
        steps: ['本周选择 1 个回避的事情', '给自己 5 分钟的 "只看一眼" 时间', '只看, 不必做决定', '记录: 看完后你的感受'],
      },
      {
        stuckPointId: 'avoidance',
        title: '带着幽灵去新场景',
        modality: 'graded_exposure',
        summary: '主动迈出小步',
        steps: ['本周 1 次: 主动走出回避, 哪怕只做 1 步', '记录: 你的感受变化', '告诉自己: "我做到了 1 1 步"', '下次可以尝试 2 步'],
      },
    ],
  };

  // ═════════════════════════════════════════════════════════════
  // 用户进度 (内存态)
  // ═════════════════════════════════════════════════════════════

  /** userId → stuckPointId → Set<weekNumber> (已完成周数) */
  readonly completedTasks = new Map<string, Map<string, Set<number>>>();

  /** userId → stuckPointId → 松动度自评 */
  readonly loosenessReports = new Map<string, Map<string, number[]>>();

  // ═════════════════════════════════════════════════════════════
  // 1. 状态查询 (聚合: 卡点 + 4 周任务 + 进度 + 解锁状态)
  // ═════════════════════════════════════════════════════════════

  async getStatus(uid: string, ctx: { hasCompletedAssessment: boolean; basicPracticeCount: number }): Promise<TargetedReshapeStatusDto> {
    const unlockStatus = this.evaluateUnlock(ctx);

    if (unlockStatus === 'locked') {
      return {
        stuckPoints: [],
        weeklyTasks: [],
        completedWeekCount: 0,
        loosenessScore: 0,
        currentWeek: 1,
        unlockStatus: 'locked',
        lockedReason: '完成 1 次标准评估 + 累计 3 次基础心理练习后解锁',
        unlockedCreatureCount: 0,
        totalCreatureCount: this.stuckPoints.length,
      };
    }

    const stuckPoints = this.stuckPoints;
    const userCompleted = this.completedTasks.get(uid) ?? new Map<string, Set<number>>();
    const userLooseness = this.loosenessReports.get(uid) ?? new Map<string, number[]>();

    const completedWeeks: number[] = [];
    const allWeeklyTasks: ReshapeWeeklyTaskDto[] = [];

    for (const sp of stuckPoints) {
      const completedSet = userCompleted.get(sp.id) ?? new Set<number>();
      const templates = this.weeklyTaskTemplates[sp.id] ?? [];
      for (const [idx, tpl] of templates.entries()) {
        const weekNumber = idx + 1;
        const isCompleted = completedSet.has(weekNumber);
        // 解锁逻辑: 第一周总是解锁; 第 N 周需 N-1 周完成 (任意卡点的 N-1 周)
        const unlocked = weekNumber === 1 ? true : this.isWeekUnlocked(userCompleted, weekNumber);
        if (isCompleted) completedWeeks.push(weekNumber);
        allWeeklyTasks.push({
          weekNumber,
          stuckPointId: sp.id,
          title: tpl.title,
          modality: tpl.modality,
          summary: tpl.summary,
          steps: tpl.steps,
          unlocked,
          completed: isCompleted,
        });
      }
    }

    const completedWeekCount = new Set(completedWeeks).size;
    const currentWeek = Math.min(completedWeekCount + 1, 4);

    // 松动度聚合
    let totalLooseness = 0;
    let loosenessCount = 0;
    // 治本: userLooseness 是 Map<string, number[]>, for-of Map 直接迭代会走
    // (string | number[])[] union (因为 MapIterator 同时返回 key + value).
    // 显式调 .values() 让 arr 锁定为 number[], arr.at(-1) 才是干净的 number.
    for (const arr of userLooseness.values()) {
      if (arr.length > 0) {
        const last = arr.at(-1);
        if (typeof last === 'number') {
          totalLooseness += last;
          loosenessCount++;
        }
      }
    }
    const loosenessScore = loosenessCount > 0 ? Math.round(totalLooseness / loosenessCount) : 0;

    // 小怪兽解锁数 = 已完成过至少 1 周任务的卡点数
    const unlockedCreatureCount = stuckPoints.filter((sp) => {
      const completedSet = userCompleted.get(sp.id);
      return completedSet && completedSet.size > 0;
    }).length;

    return {
      stuckPoints,
      weeklyTasks: allWeeklyTasks,
      completedWeekCount,
      loosenessScore,
      currentWeek,
      unlockStatus,
      unlockedCreatureCount,
      totalCreatureCount: stuckPoints.length,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 2. 完成任务
  // ═════════════════════════════════════════════════════════════

  async completeTask(uid: string, dto: CompleteTaskDto): Promise<{ ok: true }> {
    const userCompleted = this.completedTasks.get(uid) ?? new Map<string, Set<number>>();
    const set = userCompleted.get(dto.stuckPointId) ?? new Set<number>();
    set.add(dto.weekNumber);
    userCompleted.set(dto.stuckPointId, set);
    this.completedTasks.set(uid, userCompleted);
    return { ok: true };
  }

  // ═════════════════════════════════════════════════════════════
  // 3. 松动度上报
  // ═════════════════════════════════════════════════════════════

  async reportLooseness(uid: string, dto: LoosenessReportDto): Promise<{ ok: true }> {
    const userLooseness = this.loosenessReports.get(uid) ?? new Map<string, number[]>();
    const arr = userLooseness.get(dto.stuckPointId) ?? [];
    arr.push(dto.weekLooseness);
    userLooseness.set(dto.stuckPointId, arr);
    this.loosenessReports.set(uid, userLooseness);
    return { ok: true };
  }

  // ═════════════════════════════════════════════════════════════
  // 私有 helper
  // ═════════════════════════════════════════════════════════════

  evaluateUnlock(ctx: { hasCompletedAssessment: boolean; basicPracticeCount: number }): 'unlocked' | 'locking' | 'locked' {
    if (ctx.hasCompletedAssessment && ctx.basicPracticeCount >= 3) {
      return 'unlocked';
    }
    if (ctx.hasCompletedAssessment && ctx.basicPracticeCount >= 1) {
      return 'locking';
    }
    return 'locked';
  }

  isWeekUnlocked(userCompleted: Map<string, Set<number>>, week: number): boolean {
    if (week === 1) return true;
    // 第 N 周需 N-1 周完成 (任意卡点的 N-1 周都算)
    for (const set of userCompleted.values()) {
      if (set.has(week - 1)) return true;
    }
    return false;
  }
}
