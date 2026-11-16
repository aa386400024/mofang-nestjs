import { Controller, Get, Header, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

import { MetricsService } from './metrics.service.js';
// ⚠️ 必须直接 import 文件, 详见 redis.service.ts 治本注释.
import { Public } from '../../../common/decorators/public.decorator.js';
import { ConfigService } from '../../../common/providers/config.service.js';

/**
 * Metrics controller — Prometheus scrape endpoint.
 *
 * 设计:
 *   - GET /metrics (env 可配 METRICS_PATH)
 *   - 不走全局 throttler (Prometheus scrape 高频)
 *   - 不走 BizExceptionFilter (走 Prometheus text format)
 *   - @Public() 装饰器让全局 Guard 跳过鉴权 (如果有) —— 本端点**自带**鉴权, 见下方口径
 *
 * 路径:
 *   - 默认挂载在根路径 '/metrics'
 *   - 如果 METRICS_PATH 改了, 用 Controller 路径覆盖
 *
 * V2026-11-03 治本 (WP26 · P2-3 · /metrics 加鉴权):
 *   之前这个端点**默认开启且零鉴权** —— 拿到域名就能拉到 QPS / 延迟分位 / 错误率
 *   (WP25 扫描报告 P2-3). 现在口径是"默认关 + 开了必须带凭据":
 *     ① enabled=false                 → 404 (端点等于不存在, 不暴露"这里有监控");
 *     ② enabled=true 且没配 token      → 401 (fail-close: 配错 = 关掉, 不是放开);
 *     ③ enabled=true 且凭据不对        → 401;
 *     ④ enabled=true 且凭据对          → 200.
 *   凭据形态: `Authorization: Bearer <token>` 或 `x-metrics-token: <token>`
 *     (两种都收: Prometheus 侧用前者最省事, 手工 curl 排查用后者顺手).
 */
@Controller()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  /** "鉴权没配"只 warn 一次 (免得每次抓取都刷屏). */
  private warnedAuthNotConfigured = false;

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  public async scrape(@Req() req: Request, @Res() res: Response): Promise<void> {
    const settings = this.config.get('metrics');
    if (!settings.enabled) {
      res.status(404).send('Metrics disabled');
      return;
    }
    if (!this.isAuthorized(req, settings.token)) {
      // 不回显"为什么拒绝" (是 token 没配还是 token 不对), 只给标准的 WWW-Authenticate.
      res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
      res.status(401).send('Unauthorized');
      return;
    }
    const registry = this.metrics.getRegistry();
    const body = await registry.metrics();
    res.setHeader('Content-Type', registry.contentType);
    res.status(200).send(body);
  }

  /**
   * 判定这次抓取请求带了对的凭据.
   *
   * fail-close 口径: **没配 token = 一律拒绝** —— 运营忘了配 token 的后果应该是
   * "抓不到指标" (看得见的故障), 而不是 "指标裸奔" (看不见的泄漏).
   *
   * @param req 请求
   * @param expectedToken 配置里的期望 token (未配置 = 空串)
   * @returns 是否放行
   */
  private isAuthorized(req: Request, expectedToken: string | undefined): boolean {
    const expected = expectedToken?.trim() ?? '';
    if (expected.length === 0) {
      this.warnAuthNotConfigured();
      return false;
    }
    const presented = extractPresentedToken(req);
    if (presented === undefined) {
      return false;
    }
    // 定长比较: 先各自取 sha256 再 timingSafeEqual ——
    //   直接 timingSafeEqual(Buffer.from(a), Buffer.from(b)) 在长度不等时会抛,
    //   而"长度是否相等"本身就是信息 (可据此爆破 token 长度); 摘要后两边恒为 32 字节.
    return timingSafeEqual(sha256(presented), sha256(expected));
  }

  /**
   * 告警一次"开了 metrics 但没配 token".
   *
   * 为什么只打一次: 抓取是高频动作, 每次都 warn 会把日志刷爆 (真正的告警反而被埋掉);
   * 配错这件事本身在进程生命周期内不会变, 一次足够.
   */
  private warnAuthNotConfigured(): void {
    if (this.warnedAuthNotConfigured) {
      return;
    }
    this.warnedAuthNotConfigured = true;
    this.logger.warn(
      'METRICS_ENABLED=true 但 METRICS_TOKEN 未配置 —— /metrics 拒绝一切请求 (fail-close); 请配 METRICS_TOKEN 或把 METRICS_ENABLED 设为 false',
    );
  }
}

/**
 * 从请求头里取出抓取方给的 token.
 *
 * 收两种形态:
 *   · `Authorization: Bearer <token>` —— Prometheus 标准写法 (authorization.credentials);
 *   · `x-metrics-token: <token>` —— 手工 curl / 浏览器排查时省事.
 *
 * @param req 请求
 * @returns token 文本; 没带凭据时返回 undefined (与"带了但不对"区分开)
 */
function extractPresentedToken(req: Request): string | undefined {
  const direct = firstHeaderValue(req.headers['x-metrics-token']);
  if (direct !== undefined && direct.length > 0) {
    return direct;
  }
  const authorization = req.headers.authorization;
  if (authorization === undefined) {
    return undefined;
  }
  const separator = authorization.indexOf(' ');
  if (separator === -1) {
    return undefined;
  }
  // scheme 大小写不敏感 (RFC 7235: auth-scheme = token, 大小写不敏感).
  if (authorization.slice(0, separator).toLowerCase() !== 'bearer') {
    return undefined;
  }
  const value = authorization.slice(separator + 1).trim();
  return value.length > 0 ? value : undefined;
}

/**
 * 取请求头的第一个值 (Express 的 header 值可能是数组).
 *
 * @param value 原始 header 值
 * @returns 去掉首尾空白的字符串; 没有则 undefined
 */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim();
}

/**
 * 取文本的 sha256 摘要 (定长比较用).
 *
 * @param value 原文
 * @returns 32 字节摘要
 */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
