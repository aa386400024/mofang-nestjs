// V2026-11-03 治本 (WP15 · B 层 · 单回合 delta cap 观测日志):
//   职责: 钉死"内核只上报、adapter 决定打"这条分工 —— 被砍时逐维度打一条 warning,
//         没被砍时**一条都不打** (观测面只报"哪里出过问题", 不打噪声).
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络.
//
//   为什么断言日志文本而不是内部字段:
//     对外产物就是这条日志 —— 断言日志才是在断言"运维实际能拿到什么".
//     格式与任务单 §1.4 的示例逐字对齐:
//       [WP15] turn delta capped: trust raw=+0.30 capped=+0.20 events=[empathy,...]
//
//   验证: npx vitest run test/engine-adapters/wp15-delta-cap-log.spec.ts

import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

import { DeltaCapLogger } from '../../src/engine-adapters/wiring/delta-cap.logger.js';
import { observeDeltaCaps, transitionState } from '../../src/engine-core/cognition/state-transition.js';
import { createEmptyBdiSnapshot, type BdiSnapshot, type CounselorEventKind, type SessionEvent } from '../../src/engine-core/index.js';

/** 造一条标准事件 (strength 缺省 1 = 规则轨满强度). */
function ev(kind: CounselorEventKind, strength = 1): SessionEvent {
  return { kind, matchedTerms: [], strength };
}

/** 造一份基线快照, 允许覆盖 trust / valence (其余走中性默认基线). */
function snap(overrides: { trust?: number; valence?: number } = {}): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: overrides.trust ?? base.trust,
    emotion: { ...base.emotion, valence: overrides.valence ?? base.emotion.valence },
  };
}

describe('WP15 · adapter 侧 cap warning 日志', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(typeof message === 'string' ? message : String(message));
    });
    // 装配等价动作: 模块启动时实例化本服务并注册观察者.
    new DeltaCapLogger().onModuleInit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // 观察者是内核里的模块级单槽 —— 测试结束必须注销, 否则会串到后面的用例.
    observeDeltaCaps(null);
  });

  it('被砍时逐维度打一条 warning (格式与任务单 §1.4 一致)', () => {
    transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('empathy'), ev('empathy')]);

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toBeDefined();
    expect(line).toContain('[WP15] turn delta capped: trust raw=+0.30 capped=+0.20');
    expect(line).toContain('events=[empathy]');
  });

  it('下向被砍时方向与幅度都带上 (负号不丢)', () => {
    transitionState(snap({ trust: 0.5 }), [ev('boundary_cross'), ev('boundary_cross'), ev('boundary_cross')]);

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toContain('raw=-0.45 capped=-0.30');
  });

  it('没被砍时一条都不打 (不打噪声日志)', () => {
    transitionState(snap({ trust: 0.5 }), [ev('empathy')]);

    expect(warnings).toEqual([]);
  });

  it('事件清单带上本轮所有事件类型 (运维要能回看是什么触发的)', () => {
    transitionState(snap({ trust: 0.5 }), [ev('empathy'), ev('acceptance'), ev('affirmation')]);

    const line = warnings.find((item) => item.includes('trust'));
    expect(line).toContain('events=[empathy,acceptance,affirmation]');
  });
});
