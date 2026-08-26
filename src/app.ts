import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';

import { middleware } from './app.middleware';
import { AppModule } from './app.module';
import { ensureUtf8Console } from './common/console-utf8';

// 治本: Windows GBK 环境下, Node stdout 默认按系统代码页 (CP936) 输出,
// 中文会变乱码 (日志里的 "服务内部错误" 会变 "鏈嶅姟鍐呴儴閿欒鍓").
// 拆到独立模块 (见 ./common/console-utf8.ts) 保证 import 顺序最先执行.
ensureUtf8Console();
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
