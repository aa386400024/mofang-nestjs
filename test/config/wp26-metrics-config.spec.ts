// V2026-11-03 治本 (WP26 · P2-3 · /metrics 加鉴权 · 配置口径):
//   /metrics 端点本身的行为由 test/shared/wp26-metrics-auth.spec.ts 钉住;
//   本套件钉住**配置层**的口径 (src/config/envs/default.ts 的 resolveMetricsEnabled):
//     ① 缺省: 生产**关**, 非生产开 (本地调试方便);
//     ② 显式值: 只有 'true' 算开 —— 写错 env 不该把一个对外端点打开 (fail-close);
//     ③ METRICS_TOKEN 透传到配置层 (空 = 没开鉴权 = 端点拒绝一切).
//
//   为什么"生产缺省关"落在共享的 default.ts (而不是 production.ts):
//     default.ts 是三份 env (development / test / production) 共用的底座, 加载顺序是
//     default → ${NODE_ENV}; 生产实际跑的就是 production.ts + default.ts ——
//     缺省值写在共享层, 结果与写在 production.ts 一致, 但不用碰另外两份 env 文件.
//
//   边界: 只读 src/config/envs/default.ts; 不起 Nest 容器.
//
//   验证: npx vitest run test/config/wp26-metrics-config.spec.ts
//   时间戳: 2026-11-03 GMT+8

import { vi } from 'vitest';

type MetricsConfig = (typeof import('../../src/config/envs/default.js'))['config']['metrics'];

/**
 * 在指定 env 下重新加载配置 (default.ts 是 import 时求值的, 所以必须重载模块).
 *
 * @param overrides 要覆盖的 env (undefined = 删掉这个键)
 * @returns metrics 配置段
 */
async function loadMetricsConfig(overrides: Record<string, string | undefined>): Promise<MetricsConfig> {
  vi.resetModules();
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    const module_ = await import('../../src/config/envs/default.js');
    return module_.config.metrics;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('WP26 · P2-3 · /metrics 配置口径', () => {
  describe('① 缺省: 生产关 / 非生产开', () => {
    it('NODE_ENV=production 且没配 METRICS_ENABLED → 关', async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: undefined });

      expect(metrics.enabled).toBe(false);
    });

    it('NODE_ENV=development 且没配 METRICS_ENABLED → 开 (本地调试方便)', async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'development', METRICS_ENABLED: undefined });

      expect(metrics.enabled).toBe(true);
    });

    it('NODE_ENV=test 且没配 METRICS_ENABLED → 开', async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'test', METRICS_ENABLED: undefined });

      expect(metrics.enabled).toBe(true);
    });

    it('配了空串 = 等同没配 (生产关 / 开发开)', async () => {
      const production = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: '' });
      const development = await loadMetricsConfig({ NODE_ENV: 'development', METRICS_ENABLED: '' });

      expect(production.enabled).toBe(false);
      expect(development.enabled).toBe(true);
    });
  });

  describe('② 显式值: 只有 true 算开 (fail-close)', () => {
    it("'true' → 开 (哪怕在生产)", async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: 'true' });

      expect(metrics.enabled).toBe(true);
    });

    it("'TRUE' (大小写不敏感) → 开", async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: 'TRUE' });

      expect(metrics.enabled).toBe(true);
    });

    it("'false' → 关 (哪怕在开发)", async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'development', METRICS_ENABLED: 'false' });

      expect(metrics.enabled).toBe(false);
    });

    it("'yes' / '1' / 拼错的值 → 一律按关 (写错 env 不该把对外端点打开)", async () => {
      const yes = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: 'yes' });
      const one = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: '1' });
      const typo = await loadMetricsConfig({ NODE_ENV: 'production', METRICS_ENABLED: 'ture' });

      expect(yes.enabled).toBe(false);
      expect(one.enabled).toBe(false);
      expect(typo.enabled).toBe(false);
    });
  });

  describe('③ METRICS_TOKEN 透传 (空 = 没开鉴权)', () => {
    it('配了 token → 配置里能读到', async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'development', METRICS_TOKEN: 's3cret' });

      expect(metrics.token).toBe('s3cret');
    });

    it('没配 token → undefined (端点据此 fail-close)', async () => {
      const metrics = await loadMetricsConfig({ NODE_ENV: 'development', METRICS_TOKEN: undefined });

      expect(metrics.token).toBeUndefined();
    });
  });
});
