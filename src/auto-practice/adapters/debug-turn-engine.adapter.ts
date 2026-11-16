// V2026-11-08 治本 (Phase2.5 WP-D · 调试会话引擎适配器):
//   职责: 把 `DebugSessionService` (admin 调试面板那套) 包装成 `TurnEnginePort`.
//
//   为什么要这一层薄壳:
//     ① runner 不直接依赖 admin-debug 的具体类 (依赖倒转, 好测);
//     ② DebugSessionService.runTurn 返回 { reply, trace }, 这里把 trace 里的
//        crisis / turnIndex 摊平成 runner 要的字段, runner 不用知道 trace 结构.
//
//   反双胞胎:
//     - **不新写对话循环**: 所有"开 / 跑 / 关"全转给 DebugSessionService,
//       本类零业务逻辑, 只做字段映射.
//     - **不改 DebugSessionService**: 它服务于手动调试面板, 自动对练只是新消费者.

import { Injectable, Logger } from '@nestjs/common';

import { DebugSessionService } from '../../admin-debug/debug-session.service.js';
import type { ScenarioType } from '../inference-fingerprint.service.js';
import type { EngineTurnResult, TurnEnginePort } from '../ports/turn-engine.port.js';

/**
 * 调试会话引擎适配器 (TurnEnginePort 的生产实现).
 *
 * 自动对练 = "AI 咨询师把人输入换成 LLM 生成", 后面的引擎处理完全走 DebugSessionService.
 */
@Injectable()
export class DebugTurnEngineAdapter implements TurnEnginePort {
  private readonly logger = new Logger(DebugTurnEngineAdapter.name);

  constructor(private readonly debugSession: DebugSessionService) {}

  /** @inheritdoc */
  async open(characterSlug: string, scenarioType: ScenarioType = 'full_simulation'): Promise<{ readonly debugSessionId: string }> {
    // ⚠️ **场景必须透传下去** (V2026-11-11 G-1): 不透传 = 引擎侧不知道本场是考核场景
    //   → 审议运行时按"查不到场景"回落 full_simulation → 考核场次照样跑 LLM 审议
    //   (逐字复现没了), 而落库指纹却写着 rule_only —— **记录说谎**。
    //   场景要从这里一路登记进引擎归属表, 审议钩子才能按 sessionId 反查到它。
    const created = await this.debugSession.createSession(characterSlug, scenarioType);
    // 考核场景硬隔离: 日志标记, 实际 rule_only 强制由审议层 resolveSessionEffectiveMode
    // (场景红线首条命中) 与 InferenceFingerprintService (同一判定函数) 共同保证.
    if (scenarioType === 'exam') {
      this.logger.log(`[debug_engine] 考核场景会话 session=${created.sessionId} — 强制 rule_only`);
    }
    return { debugSessionId: created.sessionId };
  }

  /** @inheritdoc */
  async turn(debugSessionId: string, counselorText: string): Promise<EngineTurnResult> {
    const { reply, trace } = await this.debugSession.runTurn(debugSessionId, counselorText);
    return {
      reply,
      turnIndex: trace.turnIndex,
      crisisDetected: trace.crisis.detected,
      crisisCategory: trace.crisis.category,
      trace,
    };
  }

  /** @inheritdoc */
  close(debugSessionId: string): void {
    this.debugSession.closeSession(debugSessionId);
  }
}
