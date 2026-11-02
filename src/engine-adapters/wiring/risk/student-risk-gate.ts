// V2026-11-02 治本 (WP14 §1.6 — 重点监测场次的强制远端探测):
//   职责: 实现 `StudentRiskGate` 端口 —— 记住"哪几场已经出过高危", 并在监测中的
//         场次上**强制再问一次远端探测器**.
//   边界: 装配层 (src/engine-adapters/wiring/risk/); 只做"要不要问 / 问谁 / 怎么记状态",
//         不做等级判定 (判定口径全在 `rendering/student-risk-disposal.ts`).
//
//   为什么这件事不能在 probe 层做 (这是本单最硬的一条工程约束):
//     内核的 `RiskProbePort.probe(text, side)` **没有 session id**, 而
//     `createEngineSessionPort` 只造**一个** `InMemoryEngineSession` —— 探测器是
//     **进程级共享**的. 于是"这一场已经出过高危, 后续每轮都必须走 PsyGUARD"
//     在 probe 层**根本无法表达**: probe 不知道自己在为哪场会话服务.
//     若为了它去改内核端口签名 = 动红线 (engine-core 整树不可改).
//     所以这里走"装配层闸门": 监测状态按**句柄**记, 门面在**渲染前**额外问一次远端,
//     与内核判定合并后取更严的一档. 内核一行不动.
//
//   为什么"强制远端"用的是**独立**探测器实例 (不带本地词典兜底):
//     任务单 §1.6 要的是"后续每轮**强制走 PsyGUARD**" —— 问的是远端.
//     本地词典兜底已经由 D12 治本挂在主探测链路上了 (内核那一次判定里已经覆盖),
//     这里再挂一遍 = 同一段文本判两遍 = 双倍延迟 + "永远按高危走"的风险.
//     所以这里的远端探测器**只走远端**: 远端挂了就返回 undefined, 按内核判定继续.
//
//   失败语义 (与主链路同款纪律):
//     远端探测失败 / 超时 → **静默失败** (undefined), 不抛给对练主链路.
//     "查不到"与"没有风险"是两件事, 但都**不许**把会话搞挂.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp14-student-risk-disposal.spec.ts 覆盖监测置位/清除/强制探测
//   时间戳: 2026-11-02

import { Injectable, Logger } from '@nestjs/common';

import type { RiskProbePort } from '../../../engine-core/index.js';
import {
  buildStudentRiskDecisionFromProbe,
  type StudentRiskDecision,
  type StudentRiskGate,
} from '../../rendering/student-risk-disposal.js';

/**
 * 学员侧处置闸门的依赖注入 token.
 *
 * 用 Symbol 而不是字符串: 字符串 token 撞名时 Nest **不报错**, 而是静默注入错东西
 * (与 `voice-turn-backend.port.ts` / `engine.tokens.ts` 同款纪律).
 */
export const STUDENT_RISK_GATE = Symbol('STUDENT_RISK_GATE');

/**
 * 学员侧处置闸门 (装配层实现).
 *
 * 生命周期: **模块内单例** —— 编排门面与对话后端适配器必须拿到**同一个**实例,
 * 否则"适配器置位的监测状态"门面看不见 (等于闸门形同虚设).
 */
@Injectable()
export class StudentRiskGateService implements StudentRiskGate {
  private readonly logger = new Logger(StudentRiskGateService.name);
  /** 重点监测中的内核句柄. */
  private readonly monitored = new Set<string>();

  /**
   * @param remoteProbe **只走远端**的探测器 (缺省 = 没配 PsyGUARD → 不强制探测).
   */
  constructor(private readonly remoteProbe?: RiskProbePort) {}

  /**
   * 该场次是否处于重点监测.
   *
   * @param handleId 内核会话句柄
   * @returns true = 重点监测中
   */
  isMonitored(handleId: string): boolean {
    return this.monitored.has(handleId);
  }

  /**
   * 置位重点监测 (出过一次 high 事件后调用).
   *
   * @param handleId 内核会话句柄
   */
  markMonitored(handleId: string): void {
    this.monitored.add(handleId);
    this.logger.warn(`[monitored_on] handle=${handleId}`);
  }

  /**
   * 清重点监测 (会话关闭时调用).
   *
   * 为什么必须清: 句柄是**进程内**标识, 进程不重启就一直复用 ——
   * 不清的话, 上一场的高危会把**下一场**也拖进重点监测 (串场).
   *
   * @param handleId 内核会话句柄
   */
  clearMonitored(handleId: string): void {
    this.monitored.delete(handleId);
  }

  /**
   * 强制走一次远端探测.
   *
   * @param text 学员本轮输入
   * @param handleId 内核会话句柄
   * @returns 处置决定; undefined = 没问出结果 (没配远端 / 远端失败 / 空文本)
   */
  async forceRemoteProbe(text: string, handleId: string): Promise<StudentRiskDecision | undefined> {
    const probe = this.remoteProbe;
    if (!probe) return undefined;
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    try {
      const result = await probe.probe(trimmed, 'counselor_input');
      return buildStudentRiskDecisionFromProbe(result);
    } catch (error) {
      this.logger.warn(`[force_remote_probe_failed] handle=${handleId} err=${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}
