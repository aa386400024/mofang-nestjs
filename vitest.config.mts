/* eslint-disable import/no-default-export */
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'vitest/config';

import { nestGraphqlPlugin } from './test/vitest.graphql-plugin.mjs';

try {
  loadEnvFile();
} catch {}

export default defineConfig({
  plugins: [nestGraphqlPlugin()],
  test: {
    globals: true,
    root: './',
    testTimeout: 30_000,
    // Vitest keeps an existing NODE_ENV (e.g. `development` from the shell), so override it to always load `envs/test.ts`.
    env: { NODE_ENV: 'test' },
    // V2026-11-12 闸门提速: deps.optimizer.ssr 已试并回退 —— 把 bullmq 预打包后,
    //   4 个 spec (wp65-queue / wp65-mutex / wp66-retry / wp67-circuit) 的 `vi.mock('bullmq')`
    //   (只有命名导出) 整文件收集失败: `No "default" export is defined on the "bullmq" mock`.
    //   结论: 本仓这些重型依赖同时被大量 spec 以 vi.mock 替换, 预打包会改变模块导出形态,
    //   收益未验证而风险确定, 故不启用. 若要再试, 只排除 bullmq/ioredis 这类被 mock 的包.
    coverage: {
      // TD-11 · T-D: 采集口径 —— provider v8 / text+lcov 双报告 / 输出目录 ./coverage.
      //   只配采集, **不设 thresholds**: 阈值必须先跑一轮真实全量报告再拍板 (另案).
      //   include / exclude 沿用既有口径, 本单不改.
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/entity/**'],
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
});
