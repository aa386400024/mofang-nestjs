// V2026-11-03 治本 (WP15 · B 层 · 单回合 delta cap 观测日志):
//   职责: 订阅内核上报的 cap 报告, 把"这一回合 BDI 被砍了多少"打成 warning.
//   边界: 只打日志, 不改任何状态; 不起 Nest 容器也能 new 出来单测.
//
//   为什么日志落在这一层 (而不是内核里):
//     内核是纯层 —— 不 import logger, 也不该有"要不要打日志"的决策权.
//     任务单 §1.4 的口径: 内核只把"是否被砍、砍了多少"带出来, 由 adapter 决定打不打.
//     本类就是那个"决定打"的 adapter.
//
//   V2026-11-03 治本 (WP26 · P2-11/P2-13/P2-14/P2-16):
//     ① 观察者改**注入**: 原先本类在 `onModuleInit` 里往内核的**模块级单槽**
//        (`observeDeltaCaps`) 注册观察者 —— 那是内核里唯一的模块级可变状态, 与内核
//        "无状态"的自述直接冲突; 且进程内第二个引擎实例会把第一个的观察者顶掉
//        (多实例部署直接串台). 现在本类只**提供一个观察者函数**, 由装配层注入
//        内核会话实例 —— 内核不再持有任何全局槽.
//     ② 走 **barrel** (`engine-core/index.js`) 而不是深路径 import:
//        深路径 import 的符号不在 boundary.spec.ts 断言⑥ (公开面双向白名单) 的
//        守卫视野内 —— 内核改文件名/目录, adapter 直接断, 没有任何断言会红.
//     ③ 报告带 **sessionId / handleId**: 多人内测时, 一条没有会话标识的
//        "[WP15] turn delta capped: trust raw=+0.30" 无法定位是哪场会话被砍.
//     ④ 口径是**本轮总 delta** (事件 + 剧本, WP26 P2-12): 报告里的 raw 就是
//        这一轮实际被砍掉的量, 与状态迁移用的是同一把尺子.
//
//   为什么逐维度一条日志 (而不是一轮一条汇总):
//     维度不同, 砍的方向与幅度也不同 (上向 +0.20 / 下向 -0.30), 汇总成一行就得再解析
//     才能知道砍在哪; 逐维度一行, 运维一眼能看出"是信任被砍了还是阻抗被砍了".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp15-delta-cap-log.spec.ts 覆盖日志格式与触发条件

import { Injectable, Logger } from '@nestjs/common';

import type { DeltaCapObserver, TurnDeltaCapReport } from '../../engine-core/index.js';

/** 带符号的两位小数 (raw=+0.30 / capped=-0.30) —— 负号不能丢, 方向是这条日志的重点. */
function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

/**
 * 单回合 delta cap 观测日志 (WP15).
 *
 * 装配: 引擎装配模块 (EngineWiringModule) 把它列为 provider —— Nest 启动时实例化;
 * 装配层把 `observer` 注入内核会话 (ENGINE_SESSION_PORT). 引擎没装配这个类时,
 * 内核照常砍幅, 只是没人打日志.
 */
@Injectable()
export class DeltaCapLogger {
  private readonly logger = new Logger(DeltaCapLogger.name);

  /**
   * cap 观察者 (装配层注入内核会话).
   *
   * 为什么是**只读属性**而不是注册方法: 内核不该有"谁注册了观察者"的状态 ——
   * 观察者是这次实例的依赖, 装配时给足, 与实例同生命周期.
   *
   * 为什么用箭头函数字段: 观察者会被内核**原样调用** (`observer(report)`), 不带
   * 接收者 —— 箭头函数天然保住 `this`, 不用 bind.
   */
  readonly observer: DeltaCapObserver = (report: TurnDeltaCapReport): void => {
    this.log(report);
  };

  /**
   * 打一条 cap warning (每个被砍维度一条).
   *
   * @param report 内核上报的本轮 cap 报告
   */
  private log(report: TurnDeltaCapReport): void {
    for (const entry of report.entries) {
      this.logger.warn(
        `[WP15] turn delta capped: ${entry.dimension} raw=${signed(entry.raw)} capped=${signed(entry.capped)} ` +
          `session=${report.sessionId ?? '-'} handle=${report.handleId ?? '-'} events=[${report.events.join(',')}]`,
      );
    }
  }
}
