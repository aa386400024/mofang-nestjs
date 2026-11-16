// V2026-11-05 治本 (WP45 · P3-1 · Qdrant SDK 契约回归):
//   背景: `qdrant.service.ts` 原来用 `private client: any` + 文件级 eslint-disable ——
//     于是**整个文件对类型系统隐形**, 而它藏着一个真的线上 bug:
//     `setPayload` 按 v0.x 的**三参**形状调 `client.setPayload(collection, id, payload)`,
//     而真 SDK v1.19 是**两参** `client.setPayload(collection, { payload, points })`.
//     SDK 运行时把第 2 参 (那个**字符串 id**) 解构成 `{payload, points, filter, ...}`
//     → payload / points 全是 undefined, 第 3 个参数**被整个忽略**
//     → 请求打过去必被 Qdrant 拒 → WP12 的**冲突消解标记从未真正落库**
//     → 内核 `recall-policy` 排除"已被取代的记忆"那道判定永远不生效
//     → **同主题的新旧两条矛盾记忆会一起被召回**.
//
//   为什么这个测试要**打到 HTTP 层**:
//     窄端口替身 (`QdrantMemoryClient`) 两端自洽 —— 替身也是三参形状, 所以
//     "实现 vs 替身"的测试永远抓不到这个错 (第一版就是这么漏掉的).
//     只有**真的把请求发出去**、看**真的请求体长什么样**, 才钉得住 SDK 契约.
//
//   做法: 用真 `QdrantClient` + 拦 `globalThis.fetch`, 断言发出去的 URL 与 body.
//     不用真 Qdrant 容器 —— 被拦的 fetch 不会真的发包.
//
//   验证: npx vitest run test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts
//   时间戳: 2026-11-05 GMT+8
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QdrantService } from '../../src/ai-engine/providers/qdrant.service.js';

/**
 * 拦下来的请求.
 */
interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * 造一个 `QdrantService`, 把真 SDK 客户端装上去.
 *
 * ⚠️ 为什么要反射写私有字段: SDK 客户端是在 `onModuleInit` 里 new 出来的,
 *   而 `onModuleInit` 会顺手探活 (发一个 `GET /` 版本请求). 本测试要的是
 *   "**某一次具体请求**的 body 长什么样", 所以自己装客户端, 自己造探活响应.
 *
 * @param captured 收集到的请求
 * @returns 装好客户端的 service
 */
async function buildService(captured: CapturedRequest[]): Promise<QdrantService> {
  const service = new QdrantService(stubConfig({ QDRANT_URL: 'http://qdrant.test:6333' }) as unknown as ConfigService);
  const { QdrantClient } = await import('@qdrant/js-client-rest');
  const client = new QdrantClient({ url: 'http://qdrant.test:6333' });
  // 反射写入私有字段 (TS 私有只是编译期约束, 运行时是普通属性).
  Reflect.set(service, 'client', client);
  void captured;
  return service;
}

describe('WP45 · P3-1 · Qdrant SDK 契约 (请求体形状)', () => {
  const captured: CapturedRequest[] = [];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    captured.length = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      let body: unknown;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      captured.push({ url, method, body });
      // 探活 (GET /) 与所有写操作都回一个合法的 Qdrant 响应.
      return Response.json({ result: true, status: 'ok', time: 0 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('setPayload → 打的是 POST /points/payload, body 带 payload + points', async () => {
    const service = await buildService(captured);

    await service.setPayload('visitor_long_memory', 'old-point-1', { supersededBy: 'new-point-2' });

    const write = captured.find((request) => request.method === 'POST');
    expect(write, '应该发出一次 POST 请求').toBeDefined();
    expect(write?.url).toContain('/collections/visitor_long_memory/points/payload');

    // ⚠️ 这就是那个 bug 的核心断言: body 里必须有 **points 数组** 和 **payload 对象**.
    //   旧的三参写法会让这两个字段全是 undefined → body 形如 {} → Qdrant 直接拒.
    expect(write?.body).toMatchObject({
      points: ['old-point-1'],
      payload: { supersededBy: 'new-point-2' },
    });
  });

  it('upsert → body 是 { points: [{ id, vector, payload }] }', async () => {
    const service = await buildService(captured);

    await service.upsert('knowledge_chunks', 'doc-1', [0.1, 0.2], { tags: ['anxiety'] });

    // ⚠️ Qdrant 的 upsert 是 **PUT** (不是 POST) —— 方法本身也是契约的一部分.
    const write = captured.find((request) => request.method === 'PUT');
    expect(write?.url).toContain('/collections/knowledge_chunks/points');
    expect(write?.body).toMatchObject({
      points: [{ id: 'doc-1', vector: [0.1, 0.2], payload: { tags: ['anxiety'] } }],
    });
  });

  it('scroll → body 带 filter + limit + with_payload', async () => {
    const service = await buildService(captured);

    await service.scroll('visitor_long_memory', { tenantId: 't1' }, 50);

    const write = captured.find((request) => request.method === 'POST');
    expect(write?.url).toContain('/collections/visitor_long_memory/points/scroll');
    expect(write?.body).toMatchObject({ filter: { tenantId: 't1' }, limit: 50, with_payload: true });
  });

  it('delete → body 是 { points: [id] }', async () => {
    const service = await buildService(captured);

    await service.delete('knowledge_chunks', 'doc-1');

    const write = captured.find((request) => request.method === 'POST');
    expect(write?.url).toContain('/collections/knowledge_chunks/points/delete');
    expect(write?.body).toMatchObject({ points: ['doc-1'] });
  });
});
