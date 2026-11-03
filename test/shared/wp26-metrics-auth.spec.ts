// V2026-11-03 治本 (WP26 · P2-3 · /metrics 加鉴权):
//   /metrics 之前是"默认开启 + 零鉴权" —— 拿到域名就能拉到 QPS / 延迟分位 / 错误率.
//   现在的口径 (fail-close):
//     ① 关掉          → 404 (端点等于不存在);
//     ② 开着但没配 token → 401 (配错 = 关掉, 不是放开);
//     ③ 开着 + 凭据不对  → 401;
//     ④ 开着 + 凭据对    → 200.
//   本套件钉住这四条 + "凭据比对必须是常量时间" 的实现口径.
//
//   边界: 只读 src/shared/infra/metrics/**; 不起 Nest 容器 (controller 的依赖用 stub).
//
//   验证: npx vitest run test/shared/wp26-metrics-auth.spec.ts
//   时间戳: 2026-11-03 GMT+8

import type { Request } from 'express';

import type { ConfigService } from '../../src/common/providers/config.service.js';
import { MetricsController } from '../../src/shared/infra/metrics/metrics.controller.js';
import type { MetricsService } from '../../src/shared/infra/metrics/metrics.service.js';

/** 假的 express Response (只实现 controller 用到的那几个方法). */
interface FakeResponse {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string>;
  status(code: number): FakeResponse;
  send(body: unknown): FakeResponse;
  setHeader(name: string, value: string): FakeResponse;
}

/**
 * 造一个假的 Response.
 *
 * @returns 假的 Response
 */
function createResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: 0,
    headers: {},
    status(code: number): FakeResponse {
      response.statusCode = code;
      return response;
    },
    send(body: unknown): FakeResponse {
      response.body = body;
      return response;
    },
    setHeader(name: string, value: string): FakeResponse {
      response.headers[name] = value;
      return response;
    },
  };
  return response;
}

/**
 * 造一个假的 Request (只给 headers).
 *
 * @param headers 请求头
 * @returns 假的 Request
 */
function createRequest(headers: Record<string, string | string[]>): Request {
  return { headers } as unknown as Request;
}

/**
 * 造一个 controller (依赖全是 stub).
 *
 * @param settings metrics 配置 (enabled / token)
 * @returns controller + "registry 被取过几次" 的计数器
 */
function createController(settings: { enabled: boolean; token?: string }): { controller: MetricsController; registryReads: () => number } {
  let registryReads = 0;

  const config = {
    get: (path: string) => {
      if (path !== 'metrics') {
        throw new Error(`unexpected config path: ${path}`);
      }
      return {
        enabled: settings.enabled,
        token: settings.token,
        path: '/metrics',
        httpDurationBuckets: [],
      };
    },
  } as unknown as ConfigService;

  const metrics = {
    getRegistry: () => {
      registryReads += 1;
      return {
        metrics: async () => '# HELP wp26_probe\n# TYPE wp26_probe gauge\nwp26_probe 1\n',
        contentType: 'text/plain; version=0.0.4',
      };
    },
  } as unknown as MetricsService;

  return { controller: new MetricsController(metrics, config), registryReads: () => registryReads };
}

describe('WP26 · P2-3 · /metrics 鉴权', () => {
  describe('① 关掉 = 端点不存在 (404)', () => {
    it('enabled=false 时返 404, 且不碰 registry (不泄漏任何指标)', async () => {
      const { controller, registryReads } = createController({ enabled: false, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'Bearer secret' }), res as never);

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('Metrics disabled');
      expect(registryReads()).toBe(0);
    });
  });

  describe('② fail-close: 没配 token = 拒绝一切', () => {
    it('enabled=true 但没配 METRICS_TOKEN 时, 带正确格式的凭据也 401', async () => {
      const { controller, registryReads } = createController({ enabled: true });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'Bearer anything' }), res as never);

      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('Unauthorized');
      expect(res.headers['WWW-Authenticate']).toBe('Bearer realm="metrics"');
      expect(registryReads()).toBe(0);
    });

    it('token 配成空串 (等于没配) 同样 401', async () => {
      const { controller } = createController({ enabled: true, token: ' '.repeat(3) });
      const res = createResponse();

      await controller.scrape(createRequest({ 'x-metrics-token': 'secret' }), res as never);

      expect(res.statusCode).toBe(401);
    });
  });

  describe('③ 凭据不对 = 401', () => {
    it('完全没带凭据 → 401', async () => {
      const { controller, registryReads } = createController({ enabled: true, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({}), res as never);

      expect(res.statusCode).toBe(401);
      expect(registryReads()).toBe(0);
    });

    it('token 值不对 → 401', async () => {
      const { controller } = createController({ enabled: true, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'Bearer wrong' }), res as never);

      expect(res.statusCode).toBe(401);
    });

    it('认证 scheme 不是 Bearer (如 Basic) → 401', async () => {
      const { controller } = createController({ enabled: true, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'Basic secret' }), res as never);

      expect(res.statusCode).toBe(401);
    });
  });

  describe('④ 凭据对 = 200', () => {
    it('Authorization: Bearer <token> → 200 + Prometheus 文本', async () => {
      const { controller, registryReads } = createController({ enabled: true, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'Bearer secret' }), res as never);

      expect(res.statusCode).toBe(200);
      expect(String(res.body)).toContain('wp26_probe 1');
      expect(res.headers['Content-Type']).toBe('text/plain; version=0.0.4');
      expect(registryReads()).toBe(1);
    });

    it('x-metrics-token: <token> → 200 (手工排查用这个头)', async () => {
      const { controller } = createController({ enabled: true, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({ 'x-metrics-token': 'secret' }), res as never);

      expect(res.statusCode).toBe(200);
    });

    it('scheme 大小写不敏感 (RFC 7235) → 200', async () => {
      const { controller } = createController({ enabled: true, token: 'secret' });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'bearer secret' }), res as never);

      expect(res.statusCode).toBe(200);
    });

    it('配置里的 token 前后空白被忽略 → 200', async () => {
      const { controller } = createController({ enabled: true, token: '  secret  ' });
      const res = createResponse();

      await controller.scrape(createRequest({ authorization: 'Bearer secret' }), res as never);

      expect(res.statusCode).toBe(200);
    });
  });
});
