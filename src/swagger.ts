import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// V2026-10-30: 本文件是 `npm run doc:api` 的入口, 同样需要注册 WS adapter.
//   两处入口用**同一个** IoAdapter, 不各写各的.
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

/**
 * https://docs.nestjs.com/recipes/swagger
 */
async function bootstrap(): Promise<string> {
  const app = await NestFactory.create(AppModule);

  // 注册 IoAdapter 走 Socket.IO (见 app.ts 的注释).
  app.useWebSocketAdapter(new IoAdapter(app));

  const options = new DocumentBuilder()
    .setTitle('OpenAPI Documentation')
    .setDescription('The sample API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env['SWAGGER_PORT'] ?? 8000);

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
