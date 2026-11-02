// V2026-09-04 治本 (V6.0 §6 + Inner World 模块进度):
//   游戏化模块解锁进度服务 — 端侧上传同步 + 服务端权威表.
//   关键反双胞胎: 不写「AI 评估解锁」逻辑 (那是 ai-engine/ai-unlock-state.service.ts),
//             本服务只负责读 + 写, V2 cron 把 ai_unlock_states 同步到这里.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import type { GameUnlockProgressDto, GameUnlockProgressListDto, UpsertGameUnlockDto } from '../dto/game-unlock.dto';
import { GameUnlockProgressEntity } from '../entities/game-unlock-progress.entity';

@Injectable()
export class GameUnlockService {
  // V2026-09-04 治本: 移除未使用的 logger 声明 (audit tsc 暴露 noUnusedLocals).
  // service 当前 2 个方法 (list/upsert) 都不需要 log, 真要 trace 时再开.

  constructor(
    @InjectRepository(GameUnlockProgressEntity)
    private readonly repo: Repository<GameUnlockProgressEntity>,
  ) {}

  async list(uid: string): Promise<GameUnlockProgressListDto> {
    const rows = await this.repo.find({ where: { uid } });
    return {
      items: rows.map((r) => ({
        moduleId: r.moduleId,
        state: r.state,
        progressJson: r.progressJson,
        updatedAtMs: r.updatedAt.getTime(),
      })),
      fetchedAtMs: Date.now(),
    };
  }

  /**
   * 单模块详情 — controller `GET /inner-world/game-unlock/:moduleId` 用.
   *
   * V2026-09-04 治本 (audit tsc 暴露): 旧 controller 引用 `getOne`,
   * 本服务从未实装. 补齐, 跟 list 共享 mapper, 单测 mock 跟 list 同源.
   */
  async getOne(uid: string, moduleId: string): Promise<GameUnlockProgressDto | null> {
    const row = await this.repo.findOne({ where: { uid, moduleId } });
    if (!row) return null;
    return {
      moduleId: row.moduleId,
      state: row.state,
      progressJson: row.progressJson,
      updatedAtMs: row.updatedAt.getTime(),
    };
  }

  /**
   * Upsert 单条模块进度 — (uid, moduleId) 唯一约束兜底, 跨设备同步幂等.
   *
   * V2026-09-04 治本 (audit 暴露 TS2345):
   *   原因: 旧实现 `this.repo.upsert({ ..., progressJson: dto.progressJson as unknown as object }, ['uid', 'moduleId'])`
   *     触发 typeorm 1.x 玄学: progressJson 字段类型 `Record<string, unknown>` 跟
   *     `_QueryDeepPartialEntity<GameUnlockProgressEntity>` 的 json 列类型
   *     `(() => string) | _QueryDeepPartialEntity<...> | undefined` 不兼容, TS2345
   *     编译失败; 即便绕过 TS, runtime extractUpsertSet 也会丢字段抛 ER_NO_DEFAULT.
   *   修复: 走 raw SQL `INSERT ... ON DUPLICATE KEY UPDATE`, 1 SQL 完成.
   *     JSON.stringify(progressJson) 走 mysql2 driver 透传 (entity 列类型 `json`
   *     接受 string, MySQL 5.7+ 原生 json 类型).
   *   Fallback: dto.progressJson 为 null 时 SQL 列也存 NULL (entity 列 nullable).
   */
  async upsert(uid: string, dto: UpsertGameUnlockDto): Promise<GameUnlockProgressDto> {
    await this.repo.query(
      `INSERT INTO inner_world_game_unlock_progress
         (id, uid, module_id, state, progress_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state),
         progress_json = VALUES(progress_json)`,
      [randomUUID(), uid, dto.moduleId, dto.state, dto.progressJson === null ? null : JSON.stringify(dto.progressJson)],
    );

    const row = await this.repo.findOne({
      where: { uid, moduleId: dto.moduleId },
    });
    if (!row) {
      throw new Error(`Game unlock upsert failed uid=${uid} moduleId=${dto.moduleId}`);
    }
    return {
      moduleId: row.moduleId,
      state: row.state,
      progressJson: row.progressJson,
      updatedAtMs: row.updatedAt.getTime(),
    };
  }
}
