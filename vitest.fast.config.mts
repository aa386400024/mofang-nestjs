/* eslint-disable import/no-default-export */
// V2026-11-12 闸门提速 · 内循环专用配置 (非权威闸门).
//
// 用途: 改代码后要一个 3-4 分钟以内的全量信号时用它 (`pnpm test:fast`).
// 与 vitest.config.mts 的唯一差异: isolate: false —— 不在文件之间销毁 worker,
// 一个 worker 复用模块图, 把 import 成本从 186 次降到 worker 数次 (实测 1467s → 206s).
//
// 为什么不能当权威闸门: 同 worker 内 process.env 与模块级单例跨文件共享. 实测有 10 例
// 因 env 泄漏而假失败 (wp66 配置默认值 / i12 实例级配置 / wp12 逐字稿覆盖),
// 属 spec 卫生债 (见 backlog: 测试间 process.env 泄漏). 该债清理完成后, 可把
// isolate:false 提升为权威闸门配置, 再省一次 70% 的 import 开销.
import { loadEnvFile } from 'node:process';
import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config.mts';

try {
  loadEnvFile();
} catch {}

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      isolate: false,
    },
  }),
);
