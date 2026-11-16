// V2026-11-06 治本 (WP44 · 成长档案体系 — 对练信号回写入口):
//   职责: 把"对练数据"这件事接到**能力信号统一聚合器**上 ——
//         对练能喂养的 5 个子指标, 逐个聚合并写回 ability_scores.
//   边界: 只做「圈定子指标集合 → 调聚合器」; 聚合口径在 ability-aggregate.service.ts,
//         映射口径在 config/session-ability-mapping.ts.
//
//   为什么单独一个服务 (而不是在 growth-archive.service 里直接写):
//     写入侧的触发点将来会变多 (打开档案页 / 跑完一场对练 / 后台补跑),
//     但"对练 → 哪些子指标"这条口径**只有一个**. 单独成服务 →
//     触发点随便加, 口径不跟着长出第二份.
//
//   失败只记 warn 不抛 (同 practice-ability-sync 的口径):
//     能力画像是**附加价值** —— 拉不到画像不该让用户看不到成长档案总览.
//
//   验证: npx tsc -p tsconfig.build.json --noEmit 0 错
//
//   时间戳: 2026-11-06
import { Injectable, Logger } from '@nestjs/common';

import { AbilityAggregateService, type AbilitySyncOutcome } from './ability-aggregate.service.js';
import { SESSION_ABILITY_DIMENSION_CODES } from '../config/session-ability-mapping.js';

/**
 * 对练能力同步的结果 (给调用方打日志 / 排查).
 */
export interface SessionAbilitySyncResult {
  /** 同步成功的子指标数. */
  readonly syncedCount: number;
  /** 逐个子指标的同步结果. */
  readonly outcomes: readonly AbilitySyncOutcome[];
}

/**
 * 对练数据 → 能力雷达 的回写服务.
 */
@Injectable()
export class SessionAbilitySyncService {
  private readonly logger = new Logger(SessionAbilitySyncService.name);

  constructor(private readonly aggregate: AbilityAggregateService) {}

  /**
   * 把该用户的对练数据同步进能力雷达 (5 个可喂养子指标).
   *
   * 幂等: 每次都**全量重算** (刷题 + 快评 + 督导 三来源合并取均值) 后覆盖写 ——
   *   所以重复调用得到同一个值, 不存在"增量累加越加越多"的漂移.
   *
   * @param userId 用户 id
   * @returns 同步结果
   */
  async syncFromSessions(userId: string): Promise<SessionAbilitySyncResult> {
    try {
      // 一次装载信号, 五个子指标复用 (不能每个子指标各查一遍).
      const bundle = await this.aggregate.loadSignals(userId);
      const outcomes: AbilitySyncOutcome[] = [];
      for (const dimensionCode of SESSION_ABILITY_DIMENSION_CODES) {
        outcomes.push(await this.aggregate.syncDimension(userId, dimensionCode, bundle));
      }
      const syncedCount = outcomes.filter((outcome) => outcome.synced).length;
      this.logger.log(`[session_ability_sync] user=${userId} synced=${syncedCount}/${outcomes.length}`);
      return { syncedCount, outcomes };
    } catch (error) {
      // 画像回写失败**不能**打断成长档案主链路.
      this.logger.warn(`[session_ability_sync_failed] user=${userId} err=${error instanceof Error ? error.name : 'unknown'}`);
      return { syncedCount: 0, outcomes: [] };
    }
  }
}
