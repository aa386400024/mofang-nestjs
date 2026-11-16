// V2026-11-05 治本 (Admin Dashboard PsyGUARD 面板 · PsyGUARD 健康检查模块):
//   职责: 把 **一个** `PsyGuardHealthChecker` 实例提供给两个消费方 ——
//         ① 引擎装配层 (WP11 · 启动期自检: 探一次 `/health`, 失败只记 warn);
//         ② admin 调试面 (新面板: 按需探活, 拿真实的 reachable / modelLoaded / contractOk).
//   边界: 只做装配; 探活逻辑全在 `psyguard-health.checker.ts`.
//
//   为什么**单独成模块** (而不是在 admin 侧再 new 一个):
//     `PsyGuardHealthChecker` 实现了 `OnApplicationBootstrap` —— 它的**启动自检**
//     是靠这个钩子触发的. 若 admin 侧自己 new 一个, 同一个进程里就有**两份**实例:
//     启动时探两次 `/health`, 且两份实例的结论可能不同 (探活有网络抖动).
//     那正是仓库对 Qdrant 立过的规矩 ("再造一份 = 双探活") —— 一份真相, 一个实例.
//     抽成模块后, 两个消费方 import 的是**同一个** Nest 模块实例 → 同一个探针.
//
//   为什么**不用 forwardRef**:
//     本模块只依赖 `ConfigModule` (全局) —— 它不被引擎装配层 import, 反之亦然,
//     依赖是**单向**的, 没有循环可言.
//
//   验证: npx tsc -p tsconfig.build.json --noEmit 0 错

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PsyGuardHealthChecker } from './psyguard-health.checker.js';

@Module({
  providers: [
    {
      // 走 useFactory 而不是直接 `useClass`: 它的构造参数是**一个选项对象**
      // (`{ baseUrl, fetchImpl }`), Nest 直接 new 会把那个对象当成待注入依赖而报错.
      provide: PsyGuardHealthChecker,
      useFactory: (config: ConfigService): PsyGuardHealthChecker =>
        new PsyGuardHealthChecker({ baseUrl: (config.get<string>('PSYGUARD_BASE_URL') ?? '').trim() }),
      inject: [ConfigService],
    },
  ],
  exports: [PsyGuardHealthChecker],
})
export class PsyGuardHealthModule {}
