import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../../common/decorators/public.decorator';
import { ConfigService } from '../../../common';

import { MetricsService } from './metrics.service';

/**
 * Metrics controller — Prometheus scrape endpoint.
 *
 * 设计:
 *   - GET /metrics (env 可配 METRICS_PATH)
 *   - 不走全局 throttler (Prometheus scrape 高频)
 *   - 不走 BizExceptionFilter (走 Prometheus text format)
 *   - @Public() 装饰器让全局 Guard 跳过鉴权 (如果有)
 *
 * 路径:
 *   - 默认挂载在根路径 '/metrics'
 *   - 如果 METRICS_PATH 改了, 用 Controller 路径覆盖
 */
@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  public async scrape(@Res() res: Response): Promise<void> {
    if (!this.config.get('metrics').enabled) {
      res.status(404).send('Metrics disabled');
      return;
    }
    const body = await this.metrics.getRegistry().metrics();
    res.setHeader('Content-Type', this.metrics.getRegistry().contentType);
    res.status(200).send(body);
  }
}