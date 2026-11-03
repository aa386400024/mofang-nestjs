// V2026-11-03 治本 (WP15 · B 层 · 单回合 delta cap 观测日志):
//   职责: 订阅内核上报的 cap 报告, 把"这一回合 BDI 被砍了多少"打成 warning.
//   边界: 只打日志, 不改任何状态; 不起 Nest 容器也能 new 出来单测.
//
//   为什么日志落在这一层 (而不是内核里):
//     内核是纯层 —— 不 import logger, 也不该有"要不要打日志"的决策权.
//     任务单 §1.4 的口径: 内核只把"是否被砍、砍了多少"带出来, 由 adapter 决定打不打.
//     本类就是那个"决定打"的 adapter. 内核侧对应实现是 state-transition.ts 的
//     observeDeltaCaps (报告通道, 零 logger 依赖).
//
//   为什么深路径 import 内核的 state-transition (不走 engine-core/index.js):
//     WP15 限定内核只改 state-transition.ts 一个文件, 而公开出口 (index.ts) 的导出
//     白名单是**契约测试** (test/engine-core/boundary.spec.ts 双向比对) —— 往 barrel
//     加导出就得同步改那份白名单, 那是第二个内核文件. 深路径 import 是内核 barrel
//     注释里写明的用法 ("需要时从 in-memory/ 显式深路径 import —— 意图写在代码里").
//
//   为什么逐维度一条日志 (而不是一轮一条汇总):
//     维度不同, 砍的方向与幅度也不同 (上向 +0.20 / 下向 -0.30), 汇总成一行就得再解析
//     才能知道砍在哪; 逐维度一行, 运维一眼能看出"是信任被砍了还是阻抗被砍了".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp15-delta-cap-log.spec.ts 覆盖日志格式与触发条件

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { observeDeltaCaps, type TurnDeltaCapReport } from '../../engine-core/cognition/state-transition.js';

/** 带符号的两位小数 (raw=+0.30 / capped=-0.30) —— 负号不能丢, 方向是这条日志的重点. */
function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

/**
 * 单回合 delta cap 观测日志 (WP15).
 *
 * 装配: 引擎装配模块 (EngineWiringModule) 把它列为 provider —— Nest 启动时实例化,
 * `onModuleInit` 里注册观察者; 引擎没装配这个类时, 内核照常砍幅, 只是没人打日志.
 */
@Injectable()
export class DeltaCapLogger implements OnModuleInit {
  private readonly logger = new Logger(DeltaCapLogger.name);

  onModuleInit(): void {
    observeDeltaCaps((report) => this.log(report));
  }

  /**
   * 打一条 cap warning (每个被砍维度一条).
   *
   * @param report 内核上报的本轮 cap 报告
   */
  private log(report: TurnDeltaCapReport): void {
    for (const entry of report.entries) {
      this.logger.warn(
        `[WP15] turn delta capped: ${entry.dimension} raw=${signed(entry.raw)} capped=${signed(entry.capped)} events=[${report.events.join(',')}]`,
      );
    }
  }
}
