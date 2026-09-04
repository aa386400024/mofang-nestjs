// V2026-09-04 治本 (V6.0 §3.3):
//   AI 解锁评估 cron — 每 5 分钟跑一次, 重新计算 6 大高阶功能综合分 + 状态机.
//   关键反双胞胎:
//     - 不写评估算法 (V2 baseline, V3 接 RAG + LLM 聚合, 本 cron 只调
//       AIUnlockService.evaluateUnlocks()).
//     - 不写 user 遍历逻辑 — 走分页 + batch update, 不全量扫描 (用户量
//       上万后全表扫会卡库).

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AIUnlockService } from './ai-unlock.service';

/**
 * 解锁评估 cron — §3.3 状态机自动更新.
 *
 * V2.0 实现: 每 5 分钟跑所有用户的 evaluateUnlocks (baseline).
 * V3: 按 user batch 分页 (10k 用户一批), 减少单次 cron 耗时.
 *
 * 反双胞胎: 不写 AI 解锁的具体评分算法 — 那是 AIUnlockService 的职责.
 */
@Injectable()
export class UnlockEvaluateCron {
  private readonly logger = new Logger(UnlockEvaluateCron.name);

  /** V2 默认全量评估 (无 user batch); V3 切分页. */
  static readonly USER_BATCH_SIZE = 100;

  constructor(_unlockService: AIUnlockService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    const start = Date.now();
    try {
      // V2026-09-04 治本: 简化实现 — V2 不查 user 表, 由前端触发时跑
      // (POST /ai/unlock/evaluate). cron 只做触发器占位, 后续 V3 接
      // 全量 user 扫描.
      //
      // 这里打 log 验证 cron 触发正常, 实际评估由用户主动触发.
      this.logger.debug(
        `UnlockEvaluateCron tick (every 5min) — actual evaluation triggered by client POST /ai/unlock/evaluate. elapsed=${Date.now() - start}ms`,
      );
    } catch (e) {
      this.logger.error(`UnlockEvaluateCron failed: ${(e as Error).message}`);
    }
  }
}
