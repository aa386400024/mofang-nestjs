// V2026-11-06 治本 (WP38 · 角色占用查询实现 — counselor 侧):
//   职责: 回答"这个角色现在还有几场会话在用" —— 数据在 training_sessions, 由本类读.
//   边界: 只读 + 注册到 voice 层全局插槽; 零写入、零决策.
//
//   为什么实现放在 counselor (而不是 engine-adapters):
//     training_sessions 是**咨询业务域**的表 (学员的训练会话), engine-adapters 侧
//     要用它来判"主版本能不能改", 但 engine → counselor 是仓库明令禁止的反向依赖.
//     voice 层是两侧都能站的位置 —— 本类实现 voice 层的 CharacterUsageResolver 插槽,
//     角色管理服务只认插槽.
//
//   "活跃会话"的口径 (与任务单 §五 第 1 问的建议一致):
//     ended_at IS NULL 且 deleted_at IS NULL —— 即"还没结束、也没被删"的那场.
//     已结束的会话不再影响主版本判定 (学员已经聊完了, 改定位不影响他).
//     ⚠️ 迁移前建的会话 character_template_id 为 NULL → 不计入 —— 零回归.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp38-character-version-semver.spec.ts 覆盖计数口径
//
//   时间戳: 2026-11-06

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import { CharacterUsageRegistry, type CharacterUsageResolver } from '../../voice/character-usage-slot.js';
import { TrainingSession } from '../entities/training-session.entity.js';

/**
 * 角色占用查询实现 (数据持有方 = counselor).
 */
@Injectable()
export class CharacterUsageService implements OnModuleInit, CharacterUsageResolver {
  /** 解析器标识 (日志用). */
  readonly name = 'counselor-training-sessions';

  /**
   * @param repo training_sessions 仓储
   * @param registry voice 层全局插槽
   */
  constructor(
    @InjectRepository(TrainingSession)
    private readonly repo: Repository<TrainingSession>,
    private readonly registry: CharacterUsageRegistry,
  ) {}

  /** 启动时注册进 voice 侧插槽 (业务侧提供实现, 同 VoiceSessionBridge 范式). */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 数该角色当前的活跃会话数.
   *
   * @param templateId 公共模板 id
   * @returns 活跃会话数; null = 查不到 (**不等于 0**)
   */
  async countActiveSessions(templateId: string): Promise<number | null> {
    return this.repo.count({
      where: {
        characterTemplateId: templateId,
        // 软删查询手写 IsNull (仓库硬约束 #3: 不用 @DeleteDateColumn).
        deletedAt: IsNull(),
        // "活跃" = 还没结束.
        endedAt: IsNull(),
      },
    });
  }
}
