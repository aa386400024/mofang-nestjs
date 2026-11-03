// V2026-11-03 治本 (WP15 · B 层 · 单回合 delta cap 观测日志):
//   职责: 钉死"内核只上报、adapter 决定打"这条分工 —— 被砍时逐维度打一条 warning,
//         没被砍时**一条都不打** (观测面只报"哪里出过问题", 不打噪声).
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络.
//
//   为什么断言日志文本而不是内部字段:
//     对外产物就是这条日志 —— 断言日志才是在断言"运维实际能拿到什么".
//     格式与任务单 §1.4 的示例逐字对齐:
//       [WP15] turn delta capped: trust raw=+0.30 capped=+0.20 session=... events=[empathy,...]
//
//   V2026-11-03 治本 (WP26 · P2-11/P2-14/P2-16):
//     · 观察者改**注入**: 不再有模块级单槽, 本类只提供一个 `observer` 函数,
//       由装配层注入内核会话 —— 测试也不再有"注册/注销"的动作.
//     · 日志带 session / handle 标识 (P2-11): 多人内测时能定位到是哪场会话被砍.
//     · 导入走公开 barrel: `TurnDeltaCapReport` 现在是内核公开面 (P2-16).
//
//   验证: npx vitest run test/engine-adapters/wp15-delta-cap-log.spec.ts

import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

import { DeltaCapLogger } from '../../src/engine-adapters/wiring/delta-cap.logger.js';
import type { TurnDeltaCapReport } from '../../src/engine-core/index.js';

/** 造一份 cap 报告 (模拟内核上报). */
function report(overrides: Partial<TurnDeltaCapReport> = {}): TurnDeltaCapReport {
  return {
    entries: [{ dimension: 'trust', raw: 0.3, capped: 0.2 }],
    events: ['empathy'],
    ...overrides,
  };
}

describe('WP15 · adapter 侧 cap warning 日志', () => {
  let warnings: string[];
  let capLogger: DeltaCapLogger;

  beforeEach(() => {
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(typeof message === 'string' ? message : String(message));
    });
    // 装配等价动作: Nest 启动时实例化本服务, 装配层把它的 observer 注入内核会话.
    capLogger = new DeltaCapLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('被砍时逐维度打一条 warning (格式与任务单 §1.4 一致)', () => {
    capLogger.observer(report());

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toBeDefined();
    expect(line).toContain('[WP15] turn delta capped: trust raw=+0.30 capped=+0.20');
    expect(line).toContain('events=[empathy]');
  });

  it('下向被砍时方向与幅度都带上 (负号不丢)', () => {
    capLogger.observer(report({ entries: [{ dimension: 'trust', raw: -0.45, capped: -0.3 }] }));

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toContain('raw=-0.45 capped=-0.30');
  });

  it('没被砍时一条都不打 (不打噪声日志)', () => {
    // 观察者只在上游**真的报了**时才被调用; 内核侧"没被砍就不报"已由内核测试覆盖.
    // 这里验证的是"报告为空块时 logger 自身也不打" —— 防御性: 万一有人手工传空 entries.
    capLogger.observer(report({ entries: [] }));

    expect(warnings).toEqual([]);
  });

  it('事件清单带上本轮所有事件类型 (运维要能回看是什么触发的)', () => {
    capLogger.observer(report({ events: ['empathy', 'acceptance', 'affirmation'] }));

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toContain('events=[empathy,acceptance,affirmation]');
  });

  // V2026-11-03 治本 (WP26 · P2-11): 报告必须自带会话标识 ——
  //   多人内测时一条没有 session 的 cap warning 无法定位是哪场会话被砍.
  it('日志带 session / handle 标识 (多人内测可定位)', () => {
    capLogger.observer(report({ sessionId: 'sess-42', handleId: 'handle-7' }));

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toContain('session=sess-42');
    expect(line).toContain('handle=handle-7');
  });

  it('上下文缺省时打占位符 (不打印 undefined)', () => {
    capLogger.observer(report());

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toContain('session=-');
    expect(line).toContain('handle=-');
    expect(line).not.toContain('undefined');
  });
});
