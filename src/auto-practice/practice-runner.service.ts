// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练循环):
//   职责: 核心循环 —— 开一场引擎会话 → (LLM 咨询师说一句 → 引擎来访回一句) × N → 关会话.
//
//   这个循环**不新写对话处理**: 每一轮"来访回一句"完全走 TurnEnginePort (= DebugSessionService),
//     BDI 决策 / 记忆 / 渲染 / 危机探测 / delta 审计全是现有引擎在跑.
//     本类只做两件事:
//       ① 把咨询师那半边的"人输入"换成 CounselorAgentService 的 LLM 生成;
//       ② 判断什么时候该停 (maxTurns / crisis / 来访复读).
//
//   结束条件 (按优先级):
//     ① crisisDetected —— 来访者说了自伤/自杀相关 → 立刻停, 标记 crisis_ended;
//     ② 咨询师判断可自然收尾 (输出 [[END]] 标记, 且已过最小轮数) → status=completed, exitReason=natural_close;
//     ③ 来访复读 —— 连续 3 轮来访回复几乎一样 → 停 (对话僵住了, 再跑没意义);
//     ④ maxTurns —— 跑满轮数 (此时它退化成"上限保护", 不是正常的结束方式);
//     ⑤ 抛异常 —— 标记 failed, 写 error_message.
//
//   反双胞胎:
//     - **不改 DebugSessionService**: 它服务手动调试, 自动对练只是新消费者.
//     - **不在循环里打心理内容日志**: 日志只出 practiceSessionId / turn / 耗时 / 退出原因.
//     - **engine-core 零改动**: 所有变化在适配层 (本类 + counselor agent).
//     - **crisis 也走现有探测**: 不自己写危机关键词表, trace.crisis.detected 是引擎算的.
//
//   验证: test/auto-practice/practice-runner.spec.ts

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { Repository } from 'typeorm';

import {
  AUTO_PRACTICE_EVENTS,
  type AutoPracticeSessionEndPayload,
  type AutoPracticeSessionStartPayload,
  type AutoPracticeTurnPayload,
} from './auto-practice.events.js';
import { AutoPracticeGateway } from './auto-practice.gateway.js';
import { CounselorAgentService, type CounselorHistoryTurn } from './counselor-agent.service.js';
import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeSession, type PracticeSessionStatus } from './entities/practice-session.entity.js';
import { InferenceFingerprintService, type ScenarioType } from './inference-fingerprint.service.js';
import { TURN_ENGINE_PORT, type TurnEnginePort } from './ports/turn-engine.port.js';

/** 默认最大轮数 (一场对练聊多少轮). */
export const DEFAULT_MAX_TURNS = 15;

/** 来访复读阈值: 连续 N 轮回复几乎一样就判停滞. */
const STAGNANT_REPEAT_LIMIT = 2; // 第 3 轮复读时停 (共 3 轮相同)

/** 允许"自然收尾"的最少轮数: 太早收尾等于没聊, 至少建立议题后再结束. */
const MIN_TURNS_BEFORE_CLOSE = 5;

/**
 * 跑一场对练的入参.
 */
export interface RunPracticeInput {
  /** 来访者角色 slug. */
  readonly characterSlug: string;
  /** 咨询师模式. */
  readonly counselorMode: CounselorMode;
  /** 最大轮数 (缺省 DEFAULT_MAX_TURNS). */
  readonly maxTurns?: number;
  /** 批量批次 id (单场实时跑为 null). */
  readonly batchId?: string | null;
  /** 预生成的场次 id (controller 立即返回给前端用; 不传则 runner 自己生成). */
  readonly practiceSessionId?: string;
  /** 场景类型 (WP-B: 考核场景硬隔离 rule_only; 缺省 full_simulation). */
  readonly scenarioType?: ScenarioType;
}

/**
 * 一场对练的结果摘要.
 */
export interface RunPracticeResult {
  readonly practiceSessionId: string;
  readonly debugSessionId: string;
  readonly status: PracticeSessionStatus;
  readonly exitReason: string;
  readonly turnCount: number;
  readonly crisisEnded: boolean;
}

@Injectable()
export class PracticeRunnerService implements OnModuleInit {
  private readonly logger = new Logger('PracticeRunnerService');

  constructor(
    @Inject(TURN_ENGINE_PORT) private readonly engine: TurnEnginePort,
    private readonly counselorAgent: CounselorAgentService,
    private readonly fingerprintService: InferenceFingerprintService,
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
    // gateway 在单测里没有 (optional), 生产环境存在就推事件.
    // 注意: 参数类型写成 `AutoPracticeGateway | undefined` 时, TS 会把 design:paramtypes
    // 退化成 `Object`, Nest 按 `Object` 找不到 provider 就静默注入 undefined —— 于是
    // 所有 `publishToSession` 变成空调用 (WS 能连上但永远收不到事件). 必须显式 @Inject 令牌.
    @Optional() @Inject(AutoPracticeGateway) private readonly gateway?: AutoPracticeGateway,
  ) {}

  /**
   * 启动时清理"孤儿 running 场次".
   *
   * 循环跑在本进程里, 进程重启/崩溃会带走它, 但 DB 里 status 仍是 running ——
   * 前端会一直显示一个永远不动、也永远不会结束的幽灵场次, 看起来像"又卡了".
   * 单实例部署下, 启动瞬间还留在 running 的必然是上次进程留下的.
   */
  async onModuleInit(): Promise<void> {
    try {
      const stale = await this.sessionRepo.find({ where: { status: 'running' }, select: { id: true } });
      if (stale.length === 0) return;
      await this.sessionRepo.update(
        { status: 'running' },
        { status: 'failed', exitReason: 'interrupted', errorMessage: '进程重启中断', finishedAt: new Date() },
      );
      this.logger.warn(`[auto_practice] 启动清理 ${stale.length} 个孤儿 running 场次 (标记 failed/interrupted)`);
    } catch (error) {
      this.logger.warn(`[auto_practice] 清理孤儿场次失败: ${errorName(error)}`);
    }
  }

  /**
   * 跑一场完整对练 (同步阻塞, 直到结束).
   *
   * 批量场景由 BullMQ worker 调它; 单场实时场景由 controller 直接 await 它.
   *
   * @param input 入参
   * @returns 结果摘要
   */
  async run(input: RunPracticeInput): Promise<RunPracticeResult> {
    const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
    const practiceSessionId = input.practiceSessionId ?? nanoid();
    const scenarioType = input.scenarioType ?? 'full_simulation';
    let debugSessionId = '';
    let status: PracticeSessionStatus = 'running';
    let exitReason = 'max_turns';
    let crisisEnded = 0;
    let turnCount = 0;
    let errorMessage: string | null = null;

    // ① 开引擎会话 (失败就建 failed 行, 然后 return —— 不 throw).
    // V2026-11-09 P0-1 修复: 原来这里落库后 throw, controller 是 fire-and-forget
    // (void this.runner.run(...)), unhandled rejection 直接打崩整个 Node 进程.
    // 失败信息已经落库 (status=failed/errorMessage), 调用方不需要再靠 throw 感知.
    try {
      const opened = await this.engine.open(input.characterSlug, scenarioType);
      debugSessionId = opened.debugSessionId;
    } catch (error) {
      status = 'failed';
      exitReason = 'error';
      errorMessage = errorName(error);
      this.logger.error(`[auto_practice] 开引擎会话失败 session=${practiceSessionId}: ${errorMessage}`);
      await this.persistSession(practiceSessionId, {
        debugSessionId: '',
        characterSlug: input.characterSlug,
        counselorModeId: input.counselorMode.id,
        status,
        maxTurns,
        turnCount: 0,
        crisisEnded: 0,
        exitReason,
        batchId: input.batchId ?? null,
        errorMessage,
      });
      return {
        practiceSessionId,
        debugSessionId: '',
        status,
        exitReason,
        turnCount: 0,
        crisisEnded: false,
      };
    }

    // ② 生成推理环境指纹 (WP-B): 模型/角色版本/审议模式/场景类型.
    const fingerprint = await this.fingerprintService.build(
      input.characterSlug,
      input.counselorMode.id,
      scenarioType,
      input.batchId ?? null,
      practiceSessionId,
    );

    // ③ 落库 running 行 (带版本指纹).
    await this.persistSession(practiceSessionId, {
      debugSessionId,
      characterSlug: input.characterSlug,
      counselorModeId: input.counselorMode.id,
      status,
      maxTurns,
      turnCount: 0,
      crisisEnded: 0,
      exitReason,
      batchId: input.batchId ?? null,
      errorMessage: null,
      modelVersion: fingerprint.model,
      seedValue: fingerprint.sessionSeed,
      characterVersion: fingerprint.characterVersion,
      deliberationMode: fingerprint.deliberationMode,
      engineVersion: fingerprint.engineVersion,
    });

    // ④ 推 session_start (带指纹).
    const startPayload: AutoPracticeSessionStartPayload = {
      practiceSessionId,
      debugSessionId,
      characterSlug: input.characterSlug,
      counselorModeId: input.counselorMode.id,
      maxTurns,
      fingerprint,
    };
    this.gateway?.publishToSession(practiceSessionId, AUTO_PRACTICE_EVENTS.sessionStart, startPayload);

    const history: CounselorHistoryTurn[] = [];
    let repeatStreak = 0;
    let lastVisitorText = '';
    // V2026-11-09 P1-3: 累计咨询师侧降级轮数 (上游 429/超时/空回复时 counselor-agent 回 FALLBACK_REPLY).
    let degradedTurns = 0;

    try {
      // ④ 主循环.
      for (let i = 1; i <= maxTurns; i += 1) {
        // ④a AI 咨询师生成台词.
        const counselorReply = await this.counselorAgent.generate(input.counselorMode, history);
        if (counselorReply.degraded) {
          degradedTurns += 1;
        }
        history.push({ role: 'counselor', text: counselorReply.text });

        // ④b 引擎跑一轮 (来访回复).
        const result = await this.engine.turn(debugSessionId, counselorReply.text);
        turnCount = result.turnIndex;
        // V2026-11-09 P1-3b: 来访者侧降级——trace.degraded=true 说明这轮来访者是兜底句.
        if (result.trace.degraded) {
          degradedTurns += 1;
        }
        history.push({ role: 'visitor', text: result.reply });

        // ④c 推 turn 事件.
        const turnPayload: AutoPracticeTurnPayload = {
          practiceSessionId,
          turnIndex: result.turnIndex,
          counselorText: counselorReply.text,
          visitorText: result.reply,
          crisisDetected: result.crisisDetected,
          trace: result.trace,
        };
        this.gateway?.publishToSession(practiceSessionId, AUTO_PRACTICE_EVENTS.turn, turnPayload);

        // ④c' 每轮落一次 turn_count —— 左栏场次列表要实时看到轮次增长 (不然跑到一半一直显示 0 轮).
        await this.sessionRepo.update(practiceSessionId, { turnCount }).catch((error: unknown) => {
          this.logger.warn(`[auto_practice] 更新轮次失败 session=${practiceSessionId}: ${errorName(error)}`);
        });

        // ④d 结束条件: 危机.
        if (result.crisisDetected) {
          status = 'crisis_ended';
          exitReason = 'crisis';
          crisisEnded = 1;
          break;
        }

        // ④e 结束条件: 咨询师判断已自然收尾 (给足最小轮数, 避免一两轮就草率结束).
        if (counselorReply.closeRequested && result.turnIndex >= MIN_TURNS_BEFORE_CLOSE) {
          status = 'completed';
          exitReason = 'natural_close';
          break;
        }

        // ④e 结束条件: 来访复读 (停滞).
        if (isNearDuplicate(result.reply, lastVisitorText)) {
          repeatStreak += 1;
          if (repeatStreak >= STAGNANT_REPEAT_LIMIT) {
            status = 'stagnant';
            exitReason = 'stagnant';
            break;
          }
        } else {
          repeatStreak = 0;
        }
        lastVisitorText = result.reply;
      }

      // 跑满 maxTurns 时 status 保持 'completed' (默认值).
      if (status === 'running') {
        status = 'completed';
        exitReason = 'max_turns';
      }

      // V2026-11-09 P1-3: 降级比 ≥ 50% 时, exitReason 加重度降级后缀,
      // 评测/统计一眼能筛出"这场一半以上是兜底句"的场次. 不改 status (它确实跑完了),
      // 只在 exitReason 上做标记 —— 跟 training_sessions.degraded 同款思路.
      if (degradedTurns > 0 && turnCount > 0 && degradedTurns / turnCount >= 0.5) {
        exitReason = `${exitReason}_heavy_degraded`;
      }
    } catch (error) {
      status = 'failed';
      exitReason = 'error';
      errorMessage = errorName(error);
      this.logger.error(`[auto_practice] 对练循环异常 session=${practiceSessionId}: ${errorMessage}`);
    } finally {
      // ⑤ 关引擎会话 (失败只记 warn, 不阻断).
      try {
        this.engine.close(debugSessionId);
      } catch (error) {
        this.logger.warn(`[auto_practice] 关引擎会话失败 session=${practiceSessionId}: ${errorName(error)}`);
      }
    }

    // ⑥ 更新终态.
    await this.updateSessionResult(practiceSessionId, {
      status,
      exitReason,
      turnCount,
      crisisEnded,
      errorMessage,
      degradedTurns,
    });

    // ⑦ 推 session_end.
    const endPayload: AutoPracticeSessionEndPayload = {
      practiceSessionId,
      status,
      exitReason,
      turnCount,
      crisisEnded: crisisEnded === 1,
    };
    this.gateway?.publishToSession(practiceSessionId, AUTO_PRACTICE_EVENTS.sessionEnd, endPayload);

    this.logger.log(`[auto_practice] 对练结束 session=${practiceSessionId} status=${status} turns=${turnCount} reason=${exitReason}`);
    return {
      practiceSessionId,
      debugSessionId,
      status,
      exitReason,
      turnCount,
      crisisEnded: crisisEnded === 1,
    };
  }

  /** 建/更新一行场次记录. */
  private async persistSession(id: string, fields: Partial<PracticeSession>): Promise<void> {
    const row = this.sessionRepo.create({
      id,
      startedAt: new Date(),
      finishedAt: null,
      ...fields,
    } as Partial<PracticeSession>);
    await this.sessionRepo.save(row).catch((error: unknown) => {
      this.logger.warn(`[auto_practice] 落库场次记录失败 session=${id}: ${errorName(error)}`);
    });
  }

  /** 更新终态 (status / turnCount / finishedAt). */
  private async updateSessionResult(
    id: string,
    fields: {
      status: PracticeSessionStatus;
      exitReason: string;
      turnCount: number;
      crisisEnded: number;
      errorMessage: string | null;
      degradedTurns: number;
    },
  ): Promise<void> {
    await this.sessionRepo
      .update(id, {
        ...fields,
        finishedAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn(`[auto_practice] 更新场次终态失败 session=${id}: ${errorName(error)}`);
      });
  }
}

/**
 * 判断来访回复是否跟上一轮几乎一样 (停滞检测).
 *
 * 口径:
 *   ① 去掉空白后完全相同 → 复读 ("嗯""好的"这种短答重复也要抓);
 *   ② 都 >= 15 字, 长度差 < 10% 且前 15 字相同 → 复读 (长文几乎不会撞).
 */
function isNearDuplicate(current: string, previous: string): boolean {
  if (previous.length === 0) return false;
  const a = current.trim();
  const b = previous.trim();
  if (a === b) return true;
  if (a.length < 15 || b.length < 15) return false;
  const lenDiff = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  return lenDiff < 0.1 && a.slice(0, 15) === b.slice(0, 15);
}

/** 错误类型名 (不取 message —— 隐私红线). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}
