/* eslint-disable new-cap, prettier/prettier, vitest/no-disabled-tests */



import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';

import { middleware } from '../../src/app.middleware';
import { AppModule } from '../../src/app.module';
// V2026-10-14 治本 (VS-3e 关联 — local-auth e2e 加 WsAdapter 跟 v2-user-flow + gql + jwt-auth + src/app.ts 一致):
//   原因: 大炮跑 pnpm test:e2e 报 "No driver (WebSockets) has been selected" (第 4 个 e2e spec
//     漏修, 我之前修 v2-user-flow + gql + jwt-auth 时漏 local-auth). 治本: 1 行 import WsAdapter
//     + 1 行 app.useWebSocketAdapter(new WsAdapter(app)), 跟其他 3 个 e2e 同 pattern.
//   反双胞胎: 跟 v2-user-flow 一样, 不装 socket.io, 不用 mock (workaround 埋雷).
//   时间戳: 2026-10-14 17:20.

let app: NestExpressApplication | undefined;
let request: supertest.Agent;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>();
  // https://docs.nestjs.com/fundamentals/lifecycle-events
  // Error: passport.initialize() middleware not in use
  middleware(app);
  // V2026-10-14 治本 (VS-3e 关联 — 跟 src/app.ts L49 + v2-user-flow/gql/jwt-auth 同 pattern):
  //   修法: 1 行 call, 跑 app.init() 前注册 WsAdapter, 避免 SocketModule 找不到 driver.
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  // https://github.com/visionmedia/supertest/issues/46#issuecomment-58534736
  request = new supertest.agent(app.getHttpServer());
});

// V2026-10-14 治本 (VS-3e 关联 — local-auth 3 test 全 skip, V2 治本拆 /login + /check + /logout 走 JWT):
//   原因: V0.5 e2e 走 local passport session 鉴权 (POST /login, GET /check, GET /logout),
//     V2 治本全拆走 JWT 鉴权 (POST /user/login + /user/me + Authorization Bearer token), 3 endpoint
//     在 V2 返 404. 治本: 3 test 全 test.skip, 保留代码作 V1.x 升级 reference (V1.x 不会复用 local
//     passport session, 走统一 JWT 治本).
//   反双胞胎: 不重装 passport session 兼容 V0.5 (V2 治本已定, 回滚 = 反治本), 不删 test (保留 reference).
test.skip('POST: /login', async () => {
  const { status, body } = await request.post('/login').send({ username: 'foobar', password: 'crypto' });

  expect([200, 201]).toContain(status);
  expect(body).toHaveProperty('username', 'foobar');
});

test.skip('GET: /check', async () => {
  const { body } = await request.get('/check').expect(200);

  expect(body).toHaveProperty('userId', 'test');
});

test.skip('GET: /logout', async () => {
  await request.get('/logout').expect(302);
  await request.get('/check').expect(403);
});

afterAll(async () => {
  await app?.close();
});

