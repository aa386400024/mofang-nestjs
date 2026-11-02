// V2026-10-23 治本 (演练登记 — 进程内内存, spec §2.2):
//   原因: 公共人物 (`vpt_*`) 的剧本要进 AI 来访者的 system prompt, 而 AI 来访者在
//     **agent 模块** (不认识 counselor 业务). 仓库既有的解法是"上下文贡献者插槽"
//     (VisitorContextRegistry), 但它按 sessionId 反查的是**长程会话表** ——
//     单次零压演练不落库, 反查不到 → 只能回退内置 persona, 用户选的人物根本没生效.
//     治本: WS 握手时把"这场会谈用了哪个模板 + 什么临场参数"登记进内存,
//     贡献者优先查这份登记 (演练登记 > 长程反查 > 无上下文).
//   边界 (spec §2.2/§5):
//     - **不落库**: 单次演练的临时设定, 不写 training_sessions / visitor_full_personas
//     - **不克隆私有副本**: 不调 instantiate, 不写信任度 / 档案解锁
//     - 登记在 endSession / disconnect 双路径都要清, 防泄漏 + 防同 sid 串设定
//   反双胞胎:
//     - 不用 Redis: 单实例内存即可; 多实例共享是后续基建, 提前接只会增加耦合
//     - 不把登记塞进 VisitorService 的 memory: 那是"对话历史", 语义不同, 混在一起
//       会让"历史"与"设定"的清理时机绑死 (一个是每轮裁剪, 一个是整场结束)
//   验证:
//     1. tsc 0 错
//     2. 带 templateId 连接 → 登记里有该 sessionId
//     3. session_finish / disconnect 后登记被清
//   时间戳: 2026-10-23

import { Injectable, Logger } from '@nestjs/common';

import type { VoiceSessionRegistration } from './voice-session.types';

/**
 * 演练登记处 (进程内内存).
 */
@Injectable()
export class VoiceSessionRegistry {
  private readonly logger = new Logger(VoiceSessionRegistry.name);
  private readonly registrations = new Map<string, VoiceSessionRegistration>();

  /**
   * 登记一场会谈.
   *
   * @param registration 登记内容
   */
  register(registration: VoiceSessionRegistration): void {
    this.registrations.set(registration.sessionId, registration);
    this.logger.log(
      `[registered] session=${registration.sessionId} template=${registration.templateId ?? '<none>'} ` +
        `mode=${registration.mode} preset=${JSON.stringify(registration.preset)}`,
    );
  }

  /**
   * 查某场会谈的登记.
   *
   * @param sessionId 会话 id
   * @returns 登记内容; 无则 null
   */
  find(sessionId: string): VoiceSessionRegistration | null {
    return this.registrations.get(sessionId) ?? null;
  }

  /**
   * 清除某场会谈的登记 (幂等).
   *
   * @param sessionId 会话 id
   */
  remove(sessionId: string): void {
    if (this.registrations.delete(sessionId)) {
      this.logger.log(`[removed] session=${sessionId}`);
    }
  }

  /** 当前登记数 (诊断用). */
  size(): number {
    return this.registrations.size;
  }
}
