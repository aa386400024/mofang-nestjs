// V2026-09-04 治本 (V6.0 §6 + §3.3):
//   Inner World 游戏化模块解锁进度服务 — 端侧 SQLCipher 镜像表 + 跨设备同步.
//   关键反双胞胎:
//     - 不写模块本身的游戏逻辑 (那是端侧 Unity/Flare, 服务端不参与).
//     - 不写 AI 解锁评估 (那是 ai-engine 的 AIUnlockService, 本服务只
//       做 Inner World 模块的进度 JSON 读写).

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { GameUnlockProgressDto, GameUnlockProgressListDto, UpsertGameUnlockDto } from '../dto/game-unlock.dto';
import { GameUnlockProgressEntity } from '../entities/game-unlock-progress.entity';

/**
 * Inner World 游戏化模块解锁进度服务.
 *
 * 行为:
 *   - list(uid): 一次拉该用户所有模块进度.
 *   - upsert(uid, dto): 端侧进度变更上报 (浇水 / 喂养 / 时间胶囊封存).
 *   - bulkFromAi(uid): V3 由 cron 从 ai_unlock_states 同步 state 字段.
 */
@Injectable()
export class GameUnlockService {
  private readonly logger = new Logger(GameUnlockService.name);

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

  async upsert(uid: string, dto: UpsertGameUnlockDto): Promise<GameUnlockProgressDto> {
    await this.repo.upsert(
      {
        uid,
        moduleId: dto.moduleId,
        state: dto.state,
        progressJson: dto.progressJson as unknown as object,
      },
      ['uid', 'moduleId'],
    );
    const row = await this.repo.findOne({
      where: { uid, moduleId: dto.moduleId },
    });
    if (!row) {
      throw new Error(`Game unlock upsert failed uid=${uid} moduleId=${dto.moduleId}`);
    }
    this.logger.debug(`upsert game unlock uid=${uid} moduleId=${dto.moduleId} state=${dto.state}`);
    return {
      moduleId: row.moduleId,
      state: row.state,
      progressJson: row.progressJson,
      updatedAtMs: row.updatedAt.getTime(),
    };
  }

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
   * V3 cron 同步入口 — 从 ai_unlock_states 同步 state 字段 (按 module_id ↔ feature 映射).
   *
   * V2.0 占位: 不接 cron, V3 接 inner-world scheduler service.
   */
  async syncFromAiStates(uid: string): Promise<{ synced: number }> {
    // V3: 查 ai_unlock_states WHERE uid=? JOIN module_id_map.
    // V2: 不接, 返回 0.
    void uid;
    return { synced: 0 };
  }
}
