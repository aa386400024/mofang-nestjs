/* eslint-disable prettier/prettier, vitest/no-disabled-tests */



import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { AppModule } from '../../src/app.module';
// V2026-10-14 治本 (VS-3e 关联 — crud e2e 加 WsAdapter 跟 v2-user-flow + gql + jwt-auth + local-auth + src/app.ts 一致):
//   原因: 大炮跑 pnpm test:e2e 报 "No driver (WebSockets) has been selected" (crud.spec.ts:18
//     `await app.init()` 触发, 我之前修 4 个 e2e 漏了 crud). 治本: 1 行 import WsAdapter + 1 行
//     app.useWebSocketAdapter(new WsAdapter(app)), 跟其他 4 个 e2e 同 pattern.
//   反双胞胎: 跟 v2-user-flow 一样, 不装 socket.io, 不用 mock (workaround 埋雷).
//   时间戳: 2026-10-14 17:27.

let app: NestExpressApplication | undefined;
let request: supertest.Agent;
let idx: number;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>();
  // V2026-10-14 治本 (VS-3e 关联 — 跟 src/app.ts L49 + v2-user-flow/gql/jwt-auth/local-auth 同 pattern):
  //   修法: 1 行 call, 跑 app.init() 前注册 WsAdapter, 避免 SocketModule 找不到 driver.
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  request = supertest(app.getHttpServer());
});

// V2026-10-14 治本 (VS-3e 关联 — V2 治本删 /test/crud endpoint, V0.5 test 假设错位): 原因: 大炮跑 pnpm test:e2e 报 POST /test/crud → 404. V2 治本 V0.5 测试专用 endpoint 已删. 治本: test.skip 整套, 保留代码作 V1.x 升级 reference.
test.skip('POST: /test/crud', async () => {
  const { status, body } = await request.post('/test/crud').send({ title: 'FooBar', content: 'Hello World', tags: ['new'] });

  expect([200, 201]).toContain(status);
  expect(body).toHaveProperty('id');

  idx = body.id;
});

// V2026-10-14 治本 (VS-3e 关联 — V2 治本删 /test/crud endpoint, POST 已 skip, GET/PUT/DELETE 跟改): 跟 POST /test/crud 同治本, test.skip 整套.
  test.skip('GET: /test/crud/:idx', async () => {
  const { body } = await request.get(`/test/crud/${idx}`).expect(200);

  expect(body).toHaveProperty('title', 'FooBar');
});

// V2026-10-14 治本 (VS-3e 关联 — V2 治本删 /test/crud endpoint, POST 已 skip, GET/PUT/DELETE 跟改): 跟 POST /test/crud 同治本, test.skip 整套.
  test.skip('PUT: /test/crud/:idx', async () => {
  const { body } = await request
    .put(`/test/crud/${idx}`)
    .send({ title: 'Blahblahblah', tags: ['update'] })
    .expect(200);

  expect(body).toHaveProperty('success', true);
});

// V2026-10-14 治本 (VS-3e 关联 — V2 治本删 /test/crud endpoint, POST 已 skip, GET/PUT/DELETE 跟改): 跟 POST /test/crud 同治本, test.skip 整套.
  test.skip('DELETE: /test/crud/:idx', async () => {
  const { body } = await request.delete(`/test/crud/${idx}`).expect(200);

  expect(body).toHaveProperty('success', true);
});

afterAll(async () => {
  await app?.close();
});

