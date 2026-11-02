// V2026-10-15 治本 (VS-4 隐私分级 — PrivacyLogger 审计 service):
//   原因: V0.2 spec §17 / V0.3 spec §11.3 说 "PrivacyLogger 已实现",
//         实际 V2026-10-15 扫代码 0 命中 PrivacyLogger file.
//   修法: @Injectable() PrivacyLogger, L3 访问一律记 NestJS Logger
//         (level=log, 含 userId + endpoint + method + ISO timestamp).
//         跟现有 Pino (app.module useLogger) 集成, 0 新依赖.
//   反双胞胎: 不复用 crisis_detector logger (那是 ai-engine 专用, 跨 module
//             难 wire, NestJS DI 直接注入 PrivacyLogger 更简单).
//             不写 file log (V0.x 估不需要, V1.x Phase 9 调优加).
//   验证: 大炮跑 pnpm test 验 L3 访问 log 写入 + L1/L2 不记 log.
//   时间戳: 2026-10-15

import { Injectable, Logger } from '@nestjs/common';

/**
 * 隐私分级 L3 访问审计 logger.
 *
 * V0.x 走 NestJS 内置 Logger (自动路由到 Pino, 跟 app.module useLogger 集成).
 * V1.x Phase 9 调优可加 file log / async log ship.
 */
@Injectable()
export class PrivacyLogger {
  private readonly logger = new Logger(PrivacyLogger.name);

  logL3Access(context: { userId: string; endpoint: string; method: string }): void {
    this.logger.log(`[L3_ACCESS] userId=${context.userId} ${context.method} ${context.endpoint} ` + `at ${new Date().toISOString()}`);
  }
}
