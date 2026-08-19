import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';

import { middleware } from './app.middleware';
import { AppModule } from './app.module';
// V2-debug: HttpMetricsInterceptor 暂时禁用, import 跟着注释, 避免 noUnusedLocals 阻塞编译
// import { HttpMetricsInterceptor } from './shared/infra/metrics';

/**
 * https://docs.nestjs.com
 * https://github.com/nestjs/nest/tree/master/sample
 * https://github.com/nestjs/nest/issues/2249#issuecomment-494734673
 */
async function bootstrap(): Promise<string> {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false, // V2: dev/prod 立即输出日志, pm2 能看到启动失败原因
  });

  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  // V2-debug: 暂时禁用 metrics interceptor, 看是否是它启动时卡
  // app.useGlobalInterceptors(app.get(HttpMetricsInterceptor));

  if (isProduction) {
    app.enable('trust proxy');
  }

  // Express Middleware
  middleware(app);

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);

  return await app.getUrl();
}

void (async (): Promise<void> => {
  try {
    const url = await bootstrap();
    NestLogger.log(url, 'Bootstrap');
  } catch (error) {
    NestLogger.error(error, 'Bootstrap');
  }
})();
