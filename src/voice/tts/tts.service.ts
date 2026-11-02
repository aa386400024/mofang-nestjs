// V2026-10-23 治本 (TTS 高层 facade — 业务层唯一入口):
//   职责: 屏蔽连接池细节, 给 VoiceService 一把"句级 mp3 流"的 handle.
//   调用方: VoiceService (逐句出声编排), 流程:
//     1. startSession → 拿 handle (events 流 + sendText + cancel + finish + dispose)
//     2. LLM 增量文本 → handle.sendText(chunk) (内部按句切分下发)
//     3. 消费 handle.events → 转发 sentence_start / tts_audio / sentence_end / done 给前端
//     4. LLM 结束 → handle.finish() → 等 done 事件
//     5. 用户打断 → handle.cancel() (协议级 task_cancel)
//     6. 无论哪条路径 → handle.dispose() 释放连接 (幂等, 池按租约 id 释放)
//
//   反双胞胎:
//   - 不用 callback (onAudio / onSentence / onError): 回调地狱, 改 AsyncIterable
//   - 不在 service 里做 pool acquire/release 的 retry: 池内部已有排队与超时
//   - 不在 service 里做 base64 编码: 字节 → 文本是传输层的事, 由 WS 帧层做
//
//   验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. startSession → 1 个 pool 租约
//     3. sendText('你好。') → events 输出 sentence_start / sentence_audio / sentence_end
//     4. finish() → events 输出 done
//     5. dispose() → 池内条目归零
//
//   时间戳: 2026-10-23

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { TtsBidiPoolService } from './tts-bidi-pool.service';
import type { TtsOptions, TtsSessionHandle } from './tts.types';

@Injectable()
export class TtsService implements OnModuleDestroy {
  private readonly logger = new Logger(TtsService.name);

  /**
   * @param pool TTS 连接池
   */
  constructor(private readonly pool: TtsBidiPoolService) {}

  /**
   * 启动 TTS session — 业务侧在用户开始一轮对话时调.
   *
   * @param opts 会话选项
   * @returns TTS 句柄
   * @throws 上游握手失败 (连接池已回滚)
   */
  async startSession(opts: TtsOptions): Promise<TtsSessionHandle> {
    const lease = await this.pool.acquire(opts);
    this.logger.log(`[start_session] session=${opts.sessionId} tenant=${opts.tenantId} user=${opts.userId} lease=${lease.id}`);

    const client = lease.client;
    return {
      sessionId: opts.sessionId,
      events: client,
      sendText: (text: string) => client.sendText(text),
      cancel: () => client.cancel(),
      finish: () => client.finish(),
      dispose: () => this.pool.release(lease.id),
    };
  }

  /**
   * 进程退出时关闭所有连接.
   */
  async onModuleDestroy(): Promise<void> {
    await this.pool.shutdown();
  }
}
