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
      //   include / exclude 沿用既有口径, 本单不改.
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/entity/**'],
      // TD-12 · 阈值门禁: **全局聚合**（非逐文件）四指标下限 —— 低于阈值时采集命令 exit 非 0、
      //   CI coverage job 转红. 日常 `pnpm test` 不带 --coverage, 不触发阈值校验.
      //   基线来源: TD-11 交付记录 §5.3（采集于 HEAD `1696e59`, 全量 194 文件 / 3252 例, 插桩 117.48s）
      //     statements 46.92% · branches 45.66% · functions 42.48% · lines 46.68%
      //   拍板日期: 2026-11-14.
      //   演进纪律: **只随实测覆盖率提升而上调, 不向下放宽** —— 任何向下放宽必须另立任务单
      //     显式批准, 不得在实现单里下调凑绿.
      //   本文件是阈值的**唯一真相源**: CI job / 报告 / 索引文档只引用本配置, 不另抄数字.
      thresholds: {
        statements: 44,
        branches: 43,
        functions: 40,
        lines: 44,
        perFile: false,
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
});
