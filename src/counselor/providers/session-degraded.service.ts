// V2026-11-07 治本 (degraded 会话打标 · 写入侧插槽实现 + 读取侧过滤助手):
//   职责: ① 实现 voice 层评估插槽的**第二个**实现 —— 会话结束时一次性判定,
//         命中阈值就把 `training_sessions.degraded` 置 1 并写原因码;
//         ② 提供读取侧用的过滤助手 (查 degraded 会话 id / 生成排除算子).
//   边界: 判定规则在 `domain/session-degraded.ts` (纯函数), 本文件只做「取数 → 落库」.
//
//   为什么复用**评估插槽**而不是新造一个插槽:
//     失败轮次的事实只活在**引擎适配器的内存台账**里 (评估台账) ——
//     transcript 里没有失败标记 (降级轮次压根不写逐字稿), trace 又没有 ok 字段且 prod 缺省关.
//     而评估插槽正好在**会话结束的收尾点**被交办, 且它携带的正是逐轮内核出参 ——
//     新造一个插槽 = 新造一条跨层通道 + 新的装配点, 而事实已经在评估台账里了.
//     跨层契约只多**一个可选字段** (`degraded?: boolean`), 既有实现与既有测试不受影响.
//
//   为什么"两个 sink"而不是把判定塞进评估落库方:
//     评估落库方 (SessionEvaluationService) 的职责是「算分 + 落 session_evaluations」;
//     degraded 打标是「判这场会话坏没坏 + 写 training_sessions」—— 两件事的行与列都不同.
//     插槽注册表支持多个实现 (Map 按名字去重, 逐个 await, 失败只记 warn), 分开更干净.
//
//   **写入的列与业务收尾的列不重叠**:
//     会话收尾 (vpt-session-bridge.doClose) 写 `status` + `ended_at`;
//     本单写 `degraded` + `degraded_reason` —— 两处都是**局部列更新** (TypeORM update 只写给定列),
//     互不覆盖, 也就没有先后顺序的竞态.
//
//   **幂等**: degraded 是终态 (任务单 §七 "不自动恢复") —— 命中才写, 不命中**不动**那一行.
//
//   隐私红线: 日志只出 sessionId / 原因码 / 计数, 不出任何对话原文或心理内容.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/session-degraded.spec.ts 覆盖写入侧 + 读取侧过滤
//
//   时间戳: 2026-11-07

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, type FindOperator, type Repository } from 'typeorm';

import {
  SessionEvaluationRegistry,
  type SessionEvaluationSessionInput,
  type SessionEvaluationSink,
} from '../../voice/session-evaluation-slot.js';
import { evaluateSessionDegraded } from '../domain/session-degraded.js';
import { TrainingSession } from '../entities/training-session.entity.js';

/**
 * 装载「排除 degraded 会话」的过滤算子.
 *
 * 为什么返回 null 而不是空数组的算子:
 *   TypeORM 的 `In([])` 会生成 `IN ()` —— 那在 MySQL 上是**语法错误**, 不是"匹配不到".
 *   所以"这个用户没有 degraded 会话"必须走**不加过滤条件**的分支 (返回 null 让调用方跳过).
 *
 * @param repo 训练会话仓储
 * @param userId 学员 id
 * @returns 排除算子; 没有 degraded 会话 → null (调用方据此不加过滤)
 */
export async function loadDegradedSessionExclusion(
  repo: Repository<TrainingSession>,
  userId: string,
): Promise<FindOperator<string> | null> {
  const rows = await repo.find({
    where: { userId, degraded: 1, deletedAt: IsNull() },
    select: { id: true },
  });
  if (rows.length === 0) return null;
  return Not(In(rows.map((row) => row.id)));
}

/**
 * degraded 打标服务 (写入侧).
 *
 * 判定规则在 `domain/session-degraded.ts` —— 本类只负责:
 *   「拿到逐轮事实 → 跑判定 → 命中就写标」.
 */
@Injectable()
export class SessionDegradedService implements SessionEvaluationSink, OnModuleInit {
  /** 插槽实现标识 (注册表按名字去重). */
  readonly name = 'counselor-session-degraded';

  private readonly logger = new Logger(SessionDegradedService.name);

  constructor(
    @InjectRepository(TrainingSession) private readonly sessionRepo: Repository<TrainingSession>,
    private readonly registry: SessionEvaluationRegistry,
  ) {}

  /**
   * 注册到 voice 层插槽 (与评估落库方共用同一个注册表).
   */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 会话结束 → 一次性判定 → 打标.
   *
   * 三种"不打标"都不是错误:
   *   · 没有业务会话 id → 挂不上 training_sessions;
   *   · 一轮都没跑 → 没有事实 → 不写一个"空场次是坏的"的结论;
   *   · 未命中阈值 → 这场是好的.
   *
   * @param input 本场会话的评估输入 (逐轮带 degraded 标记)
   */
  async finalize(input: SessionEvaluationSessionInput): Promise<void> {
    const dbSessionId = input.dbSessionId.trim();
    if (dbSessionId.length === 0) return;
    const verdict = evaluateSessionDegraded(input.turns);
    if (!verdict.degraded) return;
    const result = await this.sessionRepo.update({ id: dbSessionId }, { degraded: 1, degradedReason: verdict.reason });
    if (result.affected === 0) {
      // 会话行不在了 (被软删 / 跨环境跑) —— 记 warn, 不抛 (收尾不能被标记搞挂).
      this.logger.warn(`[session_degraded] 打标未命中任何行 session=${dbSessionId} reason=${verdict.reason}`);
      return;
    }
    this.logger.log(
      `[session_degraded] 已打标 session=${dbSessionId} reason=${verdict.reason} ` +
        `failed=${verdict.failedTurns}/${verdict.totalTurns} consecutive=${verdict.maxConsecutiveFailures}`,
    );
  }
}
