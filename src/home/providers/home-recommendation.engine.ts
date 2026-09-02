import { Injectable } from '@nestjs/common';

import type { TodayRecommendationDto } from '../dto/home-overview.dto';
import { formatDateLabel, getTimeSlotFromHour, HOME_GREETING_BY_SLOT, type HomeEmotionLevel, type HomeTimeSlot } from '../home.constants';

/**
 * 首页「今日推荐」算法引擎 — 大厂「配置驱动」设计 (V2.0 §3 Tab1 今日推荐).
 *
 * 算法语义:
 *   1. 主维度: 情绪档位 (crisis > low > okay > great > null)
 *   2. 次维度: 时段 (早晨推启动类, 晚间推放松类)
 *   3. 兜底: 当情绪 + 时段都没匹配时, 推轻量觉察
 *
 * 大厂做法:
 *   - 算法集中在 engine, service 只负责 IO + 调用 — 测试容易
 *   - 每条推荐带 matchedReason, 透明化推荐理由 (心理产品原则「无评判」)
 *   - 落地页 routePath 后端拼好, 前端 router.push — 减少前端魔法字符串
 */
@Injectable()
export class HomeRecommendationEngine {
  /**
   * 主入口: 根据情绪 + 时间生成今日推荐.
   *
   * @param emotionLevel  当前情绪档位 (来自前端 EmotionBloc 或服务端 mood_logs 表)
   * @param now           当前时间 (服务端时钟)
   */
  pick(emotionLevel: HomeEmotionLevel | null, now: Date): TodayRecommendationDto {
    const hour = now.getHours();
    const slot = getTimeSlotFromHour(hour);

    // 1. late-night 兜底 (晚 21:00 后没选情绪, 推睡前放松)
    if (slot === 'night' && emotionLevel === null) {
      return this.sleepBreath();
    }

    // 2. 主维度: 情绪档位
    const base = this.byEmotion(emotionLevel);
    if (base === null) {
      // 兜底
      return this.welcomeAwareness();
    }

    // 3. 时段修正 (晚 21-23 时, crisis 档 + great 档都偏向睡前)
    if (slot === 'night' && (emotionLevel === 'great' || emotionLevel === 'okay')) {
      return this.sleepWindDown();
    }

    return base;
  }

  /**
   * 情绪驱动推荐 — 4 档映射.
   *
   * 大厂心理产品原则:
   *   - crisis 推「5-4-3-2-1 接地法」 — 把人拉回身体
   *   - low 推「自我接纳短冥想」 — 跟情绪同在
   *   - okay 推「觉察日记」 — 看见想法
   *   - great 推「好状态日记」 — 把好感觉留住
   */
  private byEmotion(emotion: HomeEmotionLevel | null): TodayRecommendationDto | null {
    switch (emotion) {
      case 'crisis':
        return {
          id: 'rec-grounding-54321',
          title: '5-4-3-2-1 接地法',
          summary: '用 5 感回到当下, 把漂浮的感觉拉回地面',
          durationMinutes: 5,
          scenario: '情绪失控时',
          matchedReason: '听起来你正在难受, 这套方法能帮大脑暂时「着陆」',
          kind: 'breathing_and_mindfulness',
          routePath: '/tools/breathing?mode=grounding_54321',
        };
      case 'low':
        return {
          id: 'rec-self-compassion',
          title: '自我接纳短冥想',
          summary: '不分析, 不修复, 只是陪着当下的自己',
          durationMinutes: 7,
          scenario: '低落疲惫时',
          matchedReason: '允许自己「就这样」也是成长的一部分',
          kind: 'act',
          routePath: '/tools/breathing?mode=self_compassion',
        };
      case 'okay':
        return {
          id: 'rec-awareness-journal',
          title: '觉察日记',
          summary: '把今天的一件事写下来, 看看自己的想法',
          durationMinutes: 10,
          scenario: '日常觉察',
          matchedReason: '平平淡淡的日子, 写下来会比想象中更有收获',
          kind: 'cbt',
          routePath: '/tools/journal?kind=awareness',
        };
      case 'great':
        return {
          id: 'rec-growth-journal',
          title: '好状态日记',
          summary: '记录今天发光的事, 让好感觉留得久一点',
          durationMinutes: 8,
          scenario: '状态好时',
          matchedReason: '好状态也值得记录, 它不是理所当然的',
          kind: 'growth',
          routePath: '/tools/journal?kind=growth',
        };
      default:
        return null;
    }
  }

  /**
   * 兜底: 用户还没选情绪时, 推轻量觉察 (3 分钟呼吸).
   */
  private welcomeAwareness(): TodayRecommendationDto {
    return {
      id: 'rec-welcome',
      title: '3 分钟呼吸觉察',
      summary: '先从呼吸开始, 把注意力交给自己',
      durationMinutes: 3,
      scenario: '随时',
      matchedReason: '刚打开应用, 先从最轻的入口开始',
      kind: 'breathing_and_mindfulness',
      routePath: '/tools/breathing',
    };
  }

  /**
   * 晚 21:00 后, 推睡前呼吸引导 (替代默认的 great / okay 推荐).
   */
  private sleepWindDown(): TodayRecommendationDto {
    return {
      id: 'rec-sleep-breath',
      title: '睡前呼吸引导',
      summary: '3 分钟慢呼吸, 帮身体进入休息模式',
      durationMinutes: 3,
      scenario: '睡前',
      matchedReason: '夜深了, 先把身体放下来, 脑子的事明天再说',
      kind: 'breathing_and_mindfulness',
      routePath: '/tools/breathing?mode=sleep_wind_down',
    };
  }

  private sleepBreath(): TodayRecommendationDto {
    return this.sleepWindDown();
  }

  /**
   * 给 greeting 服务用 — 服务端拼 greeting + dateLabel.
   */
  greet(now: Date): { greeting: string; dateLabel: string; timeSlot: HomeTimeSlot } {
    const slot = getTimeSlotFromHour(now.getHours());
    return {
      greeting: HOME_GREETING_BY_SLOT[slot],
      dateLabel: formatDateLabel(now),
      timeSlot: slot,
    };
  }
}
