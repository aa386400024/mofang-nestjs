// V2026-09-04 治本 (V6.0 §3.4):
//   效果聚合 cron — 周维度 / 月维度由 cron 周期聚合写入.
//   关键反双胞胎:
//     - 不写客户端上报 (POST /ai/effect/immediate) — 那是 AIEffectService.
//     - 不写 dashboard 聚合 (那是 dashboard 模块, 同源 ai_effect_records
//       但独立聚合策略).
//   如何验证:
//     1. 上报 N 条 immediate (近 7 天).
//     2. 周日 23:59 cron 触发 → SELECT * FROM ai_effect_records WHERE
//        horizon='weekly' AND recorded_at BETWEEN ... → 看 weekly_delta
//        是否被填写.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { AIEffectRecordEntity } from '../entities/ai-effect-record.entity';
import { AIEffectHorizon } from '../enums/ai-effect.enums';

/**
 * 效果聚合 cron — §3.4 周 / 月维度.
 *
 * V2.0 实现: 周维度每周日凌晨 0 点跑, 月维度每月 1 号 0 点跑.
 * 算法: 按 uid + tool_id 分组, 计算该周/月 average intensity delta,
 *       写入 weekly_delta / monthly_delta 字段 (所有该周/月的 row 都更新).
 *
 * V3: 接 gamification_engagement 字段 (游戏化参与度, 端侧上报).
 */
@Injectable()
export class EffectAggregateCron {
  private readonly logger = new Logger(EffectAggregateCron.name);

  constructor(
    @InjectRepository(AIEffectRecordEntity)
    private readonly repo: Repository<AIEffectRecordEntity>,
  ) {}

  /**
   * 每周日 0 点跑 — 周维度聚合.
   *
   * 时间窗: 上周日 0 点 ~ 本周日 0 点 (7 天).
   */
  @Cron(CronExpression.EVERY_WEEK)
  async aggregateWeekly(): Promise<void> {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
    await this.aggregateWindow(start, end, AIEffectHorizon.WEEKLY, 'weekly_delta');
  }

  /**
   * 每月 1 号 0 点跑 — 月维度聚合.
   *
   * 时间窗: 上月 1 号 0 点 ~ 本月 1 号 0 点.
   */
  @Cron('0 0 1 * *')
  async aggregateMonthly(): Promise<void> {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
    await this.aggregateWindow(start, end, AIEffectHorizon.MONTHLY, 'monthly_delta');
  }

  /**
   * 通用聚合窗口.
   *
   * V2026-09-04 治本: 按 (uid, toolId) 分组, 算 average intensity delta,
   * 然后 UPDATE 该窗口内所有 (uid, toolId) 对应的 immediate row.
   * 反双胞胎: 不写通用 ETL pipeline (那是 data 模块, 不在 ai-engine).
   */
  private async aggregateWindow(
    start: Date,
    end: Date,
    horizon: AIEffectHorizon,
    deltaField: 'weekly_delta' | 'monthly_delta',
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      // 1. 拉窗口内所有 immediate 记录.
      const records = await this.repo.find({
        where: {
          horizon: AIEffectHorizon.IMMEDIATE,
          recordedAt: Between(start, end),
        },
      });

      // 2. 按 (uid, toolId) 分组聚合.
      const groups = new Map<string, AIEffectRecordEntity[]>();
      for (const r of records) {
        const key = `${r.uid}|${r.toolId}`;
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      }

      // 3. 逐组计算 + UPDATE (单 SQL 走 .save 不走 .update, typeorm upsert 友好).
      let updatedGroups = 0;
      for (const [key, items] of groups.entries()) {
        const withDelta = items.filter((i) => i.intensityBefore !== null && i.intensityAfter !== null);
        if (withDelta.length === 0) continue;
        const avg = withDelta.reduce((s, i) => s + ((i.intensityBefore ?? 0) - (i.intensityAfter ?? 0)), 0) / withDelta.length;
        const normalized = Math.max(-1, Math.min(1, avg / 10)); // 归一化 -1..1

        // UPDATE 该组所有 row 的 deltaField.
        for (const item of items) {
          (item as unknown as Record<string, unknown>)[deltaField] = normalized.toFixed(3);
        }
        await this.repo.save(items);
        updatedGroups++;
        void key;
      }

      this.logger.log(
        `${horizon} aggregate done: groups=${updatedGroups}/${groups.size} ` +
          `window=${start.toISOString().slice(0, 10)}~${end.toISOString().slice(0, 10)} ` +
          `elapsed=${Date.now() - startedAt}ms`,
      );
    } catch (e) {
      this.logger.error(`${horizon} aggregate failed: ${(e as Error).message}`);
    }
  }
}
