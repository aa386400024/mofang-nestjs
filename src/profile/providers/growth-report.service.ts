import { Injectable } from '@nestjs/common';

import { DimensionChangeDto, GrowthReportDto, TrendPointDto } from '../dto/growth-report.dto';

/**
 * GrowthReport service — 心塑「我的」Tab 心理成长报告核心服务.
 *
 * V2.0 占位: 全部静态 mock 数据 (V3 接评估 / 练习 / 情绪数据 真实统计).
 *
 * 设计:
 *   - 跟前端 V2.0 §Tab4 心理成长报告"占位文案"完全对齐
 *   - V3 接入后, 趋势数据走评估 + 练习 + 情绪三表 JOIN, 维度变化走规则引擎
 *   - summary + suggestions 走 LLM 总结 (V3)
 *
 * 时间范围:
 *   - 1m: 30 天, 7 个采样点 (V2.0 用 5 个点)
 *   - 3m: 90 天, 13 个采样点 (V2.0 用 7 个点)
 */
@Injectable()
export class GrowthReportService {
  /**
   * V2.0 mock: 返回静态趋势 + 维度变化 + summary.
   * V3: query Assessment / PracticeLog / MoodLog + 统计 pipeline.
   */
  async getReport(_uid: string, range: '1m' | '3m'): Promise<GrowthReportDto> {
    return {
      range,
      emotionCurve: this.generateMockEmotionCurve(range),
      practiceTrend: this.generateMockPracticeTrend(range),
      dimensions: this.getMockDimensions(),
      summary:
        '你这段时间在「情绪调节」上进步明显, 「人际关系」维度略有波动。' +
        '建议继续每日练习 + 增加人际互动类的练习。\n\n' +
        '数据接入中, 此页面展示预览结构。',
      suggestions: ['坚持每日呼吸练习, 帮助稳定情绪基线', '增加人际互动类练习, 提升人际关系维度', '每周复盘一次成长曲线, 关注自我变化'],
    };
  }

  private generateMockEmotionCurve(range: '1m' | '3m'): TrendPointDto[] {
    const points = range === '1m' ? 5 : 7;
    const stepDays = range === '1m' ? 7 : 14;
    const today = new Date();
    const result: TrendPointDto[] = [];
    for (let i = points - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i * stepDays);
      const dateStr = d.toISOString().split('T', 1)[0] ?? '';
      const value = 70 + ((i * 7) % 25) + (i % 2 === 0 ? 0 : 3); // V2.0 占位波动
      result.push({ date: dateStr, value });
    }
    return result;
  }

  private generateMockPracticeTrend(range: '1m' | '3m'): TrendPointDto[] {
    const points = range === '1m' ? 5 : 7;
    const stepDays = range === '1m' ? 7 : 14;
    const today = new Date();
    const result: TrendPointDto[] = [];
    for (let i = points - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i * stepDays);
      const dateStr = d.toISOString().split('T', 1)[0] ?? '';
      // V2.0 占位: 分钟数 5-30 递增
      const value = 5 + (points - i) * 3;
      result.push({ date: dateStr, value });
    }
    return result;
  }

  private getMockDimensions(): DimensionChangeDto[] {
    return [
      { label: '情绪调节', delta: 'up', deltaText: '↑ 较稳定' },
      { label: '自我接纳', delta: 'up', deltaText: '↑ 提升' },
      { label: '心理韧性', delta: 'flat', deltaText: '— 持平' },
      { label: '人际关系', delta: 'down', deltaText: '↓ 略有波动' },
    ];
  }
}
