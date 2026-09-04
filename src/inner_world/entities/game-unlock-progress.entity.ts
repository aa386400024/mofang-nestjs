// V2026-09-04 治本 (V6.0 §6 + §3.3 + audit P0-1):
//   游戏化模块解锁进度表 — Inner World 扩展 (§6 高阶游戏化).
//   原因: 前端 game_unlock_progress 表 (commit 14935e3 §J) 已实装, 服务端
//         需要权威表存储 6 大高阶功能 (内部声音教练 / 卡点小怪兽 / 共种
//         陪伴树 / 默契拼图 / 宠物养成 / 时间胶囊) 的解锁进度 + 进度详情.
//   修复: 字段命名跟前端 schema 1:1 对齐 (module_id / state / progress_json
//         / updated_at), 服务端用作跨设备同步 + 服务端聚合 (§3.3 AI 解锁
//         算法底层数据源); state enum 4 态跟 AIUnlockState 对齐.
//   如何验证:
//     1. 服务端 cron 每 5 分钟拉 ai_unlock_states 表, 按 feature → module_id
//        映射同步到 game_unlock_progress (state / progress_json).
//     2. SELECT * FROM game_unlock_progress WHERE uid = ? AND module_id = 'companion_tree'
//        → 单功能进度详情.
//     3. 跨设备: 客户端启动 → POST /inner-world/game-unlock/sync 上传本地
//        缓存 → 服务端 merge (last-write-wins on updated_at).

import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AIUnlockState } from '../../ai-engine/enums/ai-unlock.enums';

/**
 * 游戏化模块解锁进度 — V6.0 §6 + Inner World 扩展.
 *
 * 反双胞胎:
 *   - 跟 ai-engine/entities/ai-unlock-state.entity.ts 的 feature 字段 1:1
 *     对应 (companion_tree / pet_cultivation 等), 后者是服务端权威 AI 评估
 *     结果, 这个是 Inner World 模块进度详情. V2 cron 同步, V3 合并.
 *   - state enum 复用 AIUnlockState (locked / unlocking / unlocked / rolled_back),
 *     不重新定义.
 */
@Entity('inner_world_game_unlock_progress')
@Index('idx_inner_game_unlock_uid_module', ['uid', 'moduleId'], { unique: true })
@Index('idx_inner_game_unlock_state', ['state'])
export class GameUnlockProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  /**
   * 模块 id — 跟 ai_unlock_states.feature.code 一一对应:
   *   - inner_voice_coach / genome_reshape / life_script / embodied_deep /
   *     companion_tree / pet_cultivation (§3.3 表)
   *   - V2 扩展: 'time_capsule' / 'bottled_message' / 'puzzle_pet' (§6 增值模块)
   */
  @Column({ type: 'varchar', length: 64, name: 'module_id' })
  moduleId!: string;

  @Column({
    type: 'enum',
    enum: AIUnlockState,
    name: 'state',
    default: AIUnlockState.LOCKED,
  })
  state!: AIUnlockState;

  /**
   * 进度详情 JSON — 模块专用字段:
   *   - companion_tree: { week: 3, waterCount: 12, decorationIds: ['star', 'moon'] }
   *   - pet_cultivation: { petId: 'jellyfish', level: 'medium', bodySize: 0.7 }
   *   - time_capsule: { sealedAtMs: ..., openAtMs: ..., messageCount: 3 }
   *   - puzzle_pet: { matchedCount: 8, totalCount: 10, syncRate: 0.8 }
   *
   * 大厂 standard: 模块专用字段不建独立表, 存 JSON 减少 join 成本.
   * 反双胞胎: 不复用 entity/practice/practice_records 那种规范化设计 (那里
   *           字段固定, 走 SQL 聚合).
   */
  @Column({ type: 'json', name: 'progress_json', nullable: true })
  progressJson!: Record<string, unknown> | null;

  @UpdateDateColumn({ type: 'datetime', precision: 6, name: 'updated_at' })
  updatedAt!: Date;
}
