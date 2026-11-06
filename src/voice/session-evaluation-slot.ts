// V2026-11-06 治本 (WP43 · 评估引擎插槽 — 依赖倒置):
//   职责: 声明"一场对练结束后, 把内核出参交给业务侧算分"这个接口 + 一个全局注册表.
//   边界: 纯类型 + 一个 @Global 注册表; 零 IO / 零 ORM / 零评分规则.
//
//   为什么要有这个插槽 (而不是让引擎直接调评估服务):
//     评估引擎是**业务能力** (counselor 侧: 算分 + 落 session_evaluations + 出接口),
//     而内核出参在**引擎装配层**. engine → counselor 是仓库明令禁止的反向依赖
//     (见 student-risk-audit-slot.ts 同款说明: "voice 层是两侧都能依赖的位置").
//     修法与 VoiceSessionBridgeRegistry / StudentRiskAuditRegistry / CharacterVersionRegistry 同款:
//       · voice 侧只声明接口 + 全局注册表;
//       · 引擎侧 (engine-adapters) 只认接口, 收尾时把本场出参交给注册表;
//       · 业务侧 (counselor) 实现接口, 在自己的 onModuleInit 里注册.
//
//   为什么形状是**纯数据** (不带任何 engine-core 类型):
//     跨层契约越窄越不容易漂 —— 业务侧不该认识内核的快照类型,
//     也不该被内核改一个字段就带崩 (与 CharacterVersionResolver 只回字符串同款思路).
//
//   反双胞胎:
//     - 不用 NestJS provider token 直接注入实现: 同名 token 在各 module 里各有一份,
//       消费方拿到的是自己 module 的那份, 业务实现根本到不了消费者;
//     - **不在插槽里放评分规则**: 规则归业务侧 (counselor/evaluation/evaluation-engine.ts),
//       插槽只负责搬运数据 —— 插槽一旦长出规则, 两侧就会各有一份口径.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/wp43-evaluation-engine.spec.ts 覆盖注册 / 注销 / 无实现时静默跳过
//
//   时间戳: 2026-11-06

import { Injectable, Logger } from '@nestjs/common';

/**
 * 一轮评估输入 (内核出参的最小投影).
 *
 * 为什么只取这 9 个数: 评估要算的只有"事件计数 / BDI 首末差值 / 安全判定"三类事实,
 *   其余内核状态 (信念 / 愿望 / 移情) 本单不评 —— 少取一个字段, 跨层契约就窄一分.
 */
export interface SessionEvaluationTurnInput {
  /** 本轮序号 (从 1 开始). */
  readonly turnIndex: number;
  /** 信任 [0,1]. */
  readonly trust: number;
  /** 安全感 [0,1]. */
  readonly safety: number;
  /** 纽带感 [0,1] (本单不单独计分, 落进原始统计供回溯). */
  readonly bond: number;
  /** 话量阻抗 [0,1]. */
  readonly resistance: number;
  /** 情绪效价 [-1,1]. */
  readonly valence: number;
  /** 情绪唤醒 [0,1]. */
  readonly arousal: number;
  /** 内核事件分类 (本轮命中的 kind). */
  readonly events: readonly string[];
  /** 本轮安全判定等级 ('pass' / 'warn' / 'block'; 无判定 = null). */
  readonly safetyLevel: string | null;
  /** 本轮安全判定命中的类别. */
  readonly safetyCategories: readonly string[];
}

/**
 * 一场会话的评估输入 (整场).
 */
export interface SessionEvaluationSessionInput {
  /** 引擎会话 id (voice 侧). */
  readonly sessionId: string;
  /** 业务会话 id (`training_sessions.id`; 落库与查询都用它). */
  readonly dbSessionId: string;
  /** 学员 id (评估归属). */
  readonly userId: string;
  /** 租户 id. */
  readonly tenantId: string;
  /** 逐轮输入 (按轮次升序). */
  readonly turns: readonly SessionEvaluationTurnInput[];
}

/**
 * 评估落库方 (业务侧实现).
 */
export interface SessionEvaluationSink {
  /** 实现标识 (日志用). */
  readonly name: string;
  /**
   * 会话结束 → 算分并落库.
   *
   * @param input 本场会话的评估输入
   */
  finalize(input: SessionEvaluationSessionInput): Promise<void>;
}

/**
 * 评估落库注册表 (@Global; 业务侧在 onModuleInit 注册自己的实现).
 */
@Injectable()
export class SessionEvaluationRegistry {
  private readonly logger = new Logger(SessionEvaluationRegistry.name);
  /** 已注册的实现 (缺省 = 业务侧没装 = 不做评估). */
  private readonly sinks = new Map<string, SessionEvaluationSink>();

  /**
   * 注册一个实现 (同 name 覆盖, 便于测试时热替换).
   *
   * @param sink 评估落库方
   */
  register(sink: SessionEvaluationSink): void {
    this.sinks.set(sink.name, sink);
    this.logger.log(`[registered] session evaluation sink: ${sink.name}`);
  }

  /**
   * 注销一个实现.
   *
   * @param name 实现名
   */
  unregister(name: string): void {
    this.sinks.delete(name);
  }

  /**
   * 交办一场会话的评估 (逐个实现调, 失败不互相牵连).
   *
   * 为什么失败只记 warn 不抛: 评估是**增强** —— 业务侧没装 / 落库失败时,
   *   会话照常收尾, 只是"这场没有快速评分" (与引擎侧其它可选端口同款语义).
   *
   * @param input 本场会话的评估输入
   */
  async finalize(input: SessionEvaluationSessionInput): Promise<void> {
    for (const sink of this.sinks.values()) {
      try {
        await sink.finalize(input);
      } catch (error) {
        // 只记错误类型 (隐私红线: 报错文案可能带心理内容片段).
        this.logger.warn(`[session_evaluation] 评估落库失败 sink=${sink.name} session=${input.sessionId}: ${errorName(error)}`);
      }
    }
  }
}

/**
 * 错误类型名 (不取 message —— 隐私红线: 报错文案可能带内容片段).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
