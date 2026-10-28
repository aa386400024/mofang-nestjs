// V2026-10-23 治本 (Voice 会话基础设施模块 — @Global):
//   原因: 演练登记 (VoiceSessionRegistry) 与模板解析插槽 (VoiceTemplateRegistry) 要被
//     **两个方向**的模块使用:
//       - voice 侧: 网关要登记会谈、要解析 templateId
//       - counselor 侧: 上下文贡献者要按 sessionId 反查登记; 模板解析器要注册实现
//     若做成普通 module, 两侧就得互相 import —— voice → counselor 是反向依赖,
//     counselor → voice 又会把语音链路拖进咨询业务, 极易成环.
//   修法: 跟 `VisitorContextModule` 同一套范式 —— @Global 模块, 两侧都直接注入,
//     业务模块在自己的 onModuleInit 里注册实现.
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到 "voice template resolver: counselor-visitor-pool" 注册成功
//     3. agent 侧 0 处 import counselor
//   时间戳: 2026-10-23

import { Global, Module } from '@nestjs/common';

import { VoiceCatalogRegistry } from './voice-catalog-slot';
import { VoiceFrameRegistry } from './voice-frame-registry';
import { VoiceSessionBridgeRegistry } from './voice-session-bridge';
import { VoiceSessionRegistry } from './voice-session-registry';
import { VoiceTemplateRegistry } from './voice-template-slot';

/**
 * Voice 会话基础设施模块 (@Global).
 *
 * 全局可见的业务意图: "任何业务模块都能参与一场语音会谈的设定" ——
 * voice 侧负责登记与消费, 业务侧负责提供数据, 两侧互不认识.
 */
@Global()
@Module({
  providers: [
    VoiceSessionRegistry,
    VoiceTemplateRegistry,
    VoiceCatalogRegistry,
    // V2026-10-26 治本 (vpt 会话增强 — 2 个新注册表):
    //   VoiceSessionBridgeRegistry  voice → business 方向 (会话落库插槽)
    //   VoiceFrameRegistry          business → voice 方向 (WS 帧出口: 轻提示 / 移情标记)
    VoiceSessionBridgeRegistry,
    VoiceFrameRegistry,
  ],
  exports: [VoiceSessionRegistry, VoiceTemplateRegistry, VoiceCatalogRegistry, VoiceSessionBridgeRegistry, VoiceFrameRegistry],
})
export class VoiceSessionModule {}
