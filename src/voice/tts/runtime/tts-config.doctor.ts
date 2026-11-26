/**
 * TTS 配置自检 — 启动时只告警, 不阻断.
 *
 * 为什么不阻断:
 * - Turbo 是保底档, 豆包 key 缺失不应让整进程起不来;
 * - 真正建连时会 fail-fast, 并回退 Turbo, 用户仍有可用语音.
 * 为什么仍要自检:
 * - `.env` 被 gitignore, 本地漂移 CI 看不见; 启动日志是唯一能提前发现的地方.
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { TtsProfileResolver } from './tts-profile.resolver.js';

@Injectable()
export class TtsConfigDoctor implements OnApplicationBootstrap {
  private readonly logger = new Logger(TtsConfigDoctor.name);

  constructor(private readonly resolver: TtsProfileResolver) {}

  onApplicationBootstrap(): void {
    try {
      const report = this.resolver.inspect();
      for (const warning of report.warnings) this.logger.warn(`[tts_config] ${warning}`);
      this.logger.log(`[tts_config] enabled_profiles=${report.enabledProfiles.join(',') || 'none'}`);
    } catch (err) {
      this.logger.warn(`[tts_config] 自检失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
