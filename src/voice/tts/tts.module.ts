// V2026-10-23 治本 (TTS 子模块 — 生命周期修正, spec §3.6):
//   变化: 删掉 `onApplicationBootstrap` 里的 `pool.init(config)` 手工注入.
//     旧写法把 ConfigService 的传递藏在"外部记得调 init"这个隐式契约里 ——
//     模块一旦没走 bootstrap (单测 / 独立引入 / 未来抽成子模块), 池就拿不到 config,
//     表现为运行时 undefined 报错, 排查成本远高于构造器注入.
//   导出: TtsService (供 VoiceService 使用) + TtsBidiPoolService (诊断用)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceGateway: 单向依赖, 业务模块主动 import TtsModule
//     - 不在 Module 里做 env 校验: 配置校验属于"用它的那个动作", 由 client 构造时 fail-fast
//
//   时间戳: 2026-10-23

import { Module } from '@nestjs/common';

import { TtsBidiPoolService } from './tts-bidi-pool.service';
import { TtsService } from './tts.service';

@Module({
  providers: [TtsService, TtsBidiPoolService],
  exports: [TtsService, TtsBidiPoolService],
})
export class TtsModule {}
