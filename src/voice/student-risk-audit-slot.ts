// V2026-11-02 治本 (WP14 · 学员风险事件审计插槽 — voice → business 方向):
//   职责: 声明"把学员心理风险事件写进业务库"这个**插槽**, 由业务侧 (counselor)
//         注册真库实现; 引擎适配层只管"我判出来了, 帮我记一条".
//   边界: 只定义插槽形状 + 一个 @Global 注册表; 不碰 ORM / 不碰实体 / 不做业务判断.
//
//   为什么这个插槽住在 voice 层 (而不是 engine-adapters 或 counselor):
//     ① 依赖方向: 引擎装配层要写业务数据, 业务侧要提供实现 —— 但 engine → counselor
//        是**反向依赖** (仓库既有纪律: session-closeout / voice-session-bridge 都用它),
//        而 voice 层是**两侧都能依赖**的位置 (engine-adapters → voice ✔,
//        counselor → voice ✔). 跟 `VoiceSessionBridgeRegistry` (会话落库插槽)
//        完全是同一套范式: voice 侧声明插槽, 业务侧在自己的 onModuleInit 里注册实现.
//     ② voice 层本来就有 `VoiceFrameRegistry` (WS 帧出口) —— 危机帧与审计写
//        在同一场会话的同一个时刻发生, 放一起才看得出全貌.
//     ③ 插槽缺席时**不影响对练**: 注册表空 → 引擎侧只是"这次没留痕" (打 warn),
//        学员侧该弹的弹窗照弹 —— 留痕是审计能力, 不是会话能力.
//
//   反双胞胎:
//     - 不在 voice 层直接写库: voice 层不认识任何业务实体.
//     - 不让引擎适配层直接拿 Repository: 装配层零 ORM (WP8-A §8-9 护栏).
//     - 不用事件总线广播: 风险事件必须**按场次精确路由** (A 学员的事件不能进 B 学员的审计).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp14-student-risk-disposal.spec.ts 覆盖插槽缺席时的降级
//   时间戳: 2026-11-02

import { Injectable, Logger } from '@nestjs/common';

/**
 * 风险等级 (审计口径).
 */
export type StudentRiskAuditLevel = 'low' | 'medium' | 'high';

/**
 * 判定来源 (审计口径).
 */
export type StudentRiskAuditSource = 'rule' | 'psyguard' | 'local_dict';

/**
 * 对用户采取的动作.
 */
export type StudentRiskAuditAction = 'silent' | 'toast' | 'modal';

/**
 * 学员在弹窗后的选择.
 */
export type StudentRiskAuditChoice = 'phone' | 'continue' | 'dismissed';

/**
 * 待落库的学员风险事件.
 */
export interface StudentRiskAuditEventInput {
  /** 训练会话 id (training_sessions.id). */
  readonly sessionId: string;
  /** 学员 id (users.uid). */
  readonly userId: string;
  /** 触发轮次 (从 1 起). */
  readonly turnIndex: number;
  /** 风险等级. */
  readonly level: StudentRiskAuditLevel;
  /** 命中类别 (内核 SafetyCategory 口径). */
  readonly category: string;
  /** 命中片段 (调用方已截断 200 字). */
  readonly snippet: string;
  /** 判定来源. */
  readonly source: StudentRiskAuditSource;
  /** 对用户采取的动作. */
  readonly actionTaken: StudentRiskAuditAction;
  /** 本场后续是否进入重点监测. */
  readonly monitoredAfter: boolean;
}

/**
 * 审计落库口 (业务侧实现).
 */
export interface StudentRiskAuditSink {
  /**
   * 记一条风险事件 (append-only).
   *
   * @param event 事件内容
   */
  record(event: StudentRiskAuditEventInput): Promise<void>;
  /**
   * 回写学员在弹窗后的选择 (唯一允许 update 的字段).
   *
   * @param sessionId 训练会话 id
   * @param choice 学员的选择
   */
  markUserChoice(sessionId: string, choice: StudentRiskAuditChoice): Promise<void>;
}

/**
 * 学员风险事件审计插槽注册表 (@Global).
 */
@Injectable()
export class StudentRiskAuditRegistry {
  private readonly logger = new Logger(StudentRiskAuditRegistry.name);
  /** 已注册的实现 (缺省 = 业务侧没装). */
  private sink?: StudentRiskAuditSink;

  /**
   * 注册实现 (业务侧在 onModuleInit 里调).
   *
   * @param sink 落库实现
   */
  register(sink: StudentRiskAuditSink): void {
    this.sink = sink;
    this.logger.log('[registered] student risk audit sink');
  }

  /**
   * 取当前实现.
   *
   * @returns 已注册的实现; 没注册则 undefined
   */
  get(): StudentRiskAuditSink | undefined {
    return this.sink;
  }
}
