// V2026-11-11 治本 (Phase2.5 I-12 · 会话级同盟门槛注入缝 · 适配层测试):
//   覆盖适配层的职责边界:
//     ① 无解析端口 → 开场入参**原样**传给内核 (逐字零回归, 连字段都不多);
//     ② 有解析端口且返回覆盖 → 原样转发 (适配层**不复算**门槛);
//     ③ 解析端口抛错 / 返回非对象 → 按"无覆盖"处理 (失败不炸会话开场);
//     ④ 缺省 provider = 永远无覆盖.
//
//   ⚠️ **三条回落规则 (覆盖优先 / 缺项回落单例 / 非法值回落种子) 的断言在内核 spec**
//      (test/engine-core/i12-session-alliance-config.spec.ts) —— 因为规则由内核的
//      `resolveAllianceThresholds` 一处裁决 (唯一真相源). 适配层若自己再校验一遍,
//      就是第二套判定, 迟早对不上 (仓库"反双胞胎"纪律). 适配层的职责是**忠实转发**.
//
//   形态: 单元 (替身端口); 不起 Nest 容器、不连 DB.
//
//   验证: pnpm exec vitest run test/engine-adapters/i12-session-threshold-plumbing.spec.ts

import { describe, expect, it, vi } from 'vitest';

import { NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE } from '../../src/engine-adapters/wiring/alliance-threshold-resolver.js';
import { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import type { EngineSessionPort } from '../../src/engine-core/index.js';

const TENANT = 'tenant-i12';
const VISITOR = 'visitor-i12';

/** 开场入参 (最小可用形状). */
const INPUT = {
  sessionId: 's-1',
  tenantId: TENANT,
  visitorId: VISITOR,
  seed: 7,
} as const;

/**
 * 造一个门面: 会话端口 / 编排器 / 归属登记全是替身.
 *
 * @param resolver 解析端口 (缺省 = 不注入)
 */
function createService(resolver?: Parameters<typeof EngineTurnService>[5]): {
  readonly service: EngineTurnService;
  readonly openSession: ReturnType<typeof vi.fn>;
} {
  const openSession = vi.fn(async (input: unknown) => ({ handleId: 'h-1', sessionId: 's-1' }));
  const session = { openSession } as unknown as EngineSessionPort;
  const orchestrator = {} as never;
  const registry = { register: vi.fn() } as never;
  const service = new EngineTurnService(session, orchestrator, registry, undefined, undefined, resolver);
  return { service, openSession };
}

describe('I-12 · 会话级同盟门槛注入缝 · 适配层', () => {
  it('无解析端口 → 开场入参原样传给内核 (逐字零回归)', () => {
    const { service, openSession } = createService();
    service.open(INPUT, { characterLabel: '晚晴' });

    expect(openSession).toHaveBeenCalledTimes(1);
    const passed = openSession.mock.calls[0]?.[0];
    // 同一引用 —— 连"多一个字段"都没有.
    expect(passed).toBe(INPUT);
    expect(Object.keys(passed as object)).not.toContain('allianceThresholds');
  });

  it('解析端口返回覆盖 → 原样转发 (适配层不复算门槛)', () => {
    const resolver = { resolve: vi.fn(() => ({ open: 0.85 })) };
    const { service, openSession } = createService(resolver);
    service.open(INPUT, { characterLabel: '晚晴', attachmentStyle: 'secure' });

    const passed = openSession.mock.calls[0]?.[0] as { allianceThresholds?: { open?: number } };
    expect(passed.allianceThresholds).toEqual({ open: 0.85 });
    // 解析端口拿到了会话上下文 (角色档案维度可用).
    expect(resolver.resolve).toHaveBeenCalledWith({
      sessionId: 's-1',
      tenantId: TENANT,
      visitorId: VISITOR,
      characterLabel: '晚晴',
      attachmentStyle: 'secure',
    });
  });

  it('解析端口抛错 → 按无覆盖处理 (失败不炸会话开场)', () => {
    const resolver = {
      resolve: vi.fn(() => {
        throw new Error('source exploded');
      }),
    };
    const { service, openSession } = createService(resolver);

    expect(() => service.open(INPUT)).not.toThrow();
    const passed = openSession.mock.calls[0]?.[0];
    expect(passed).toBe(INPUT);
  });

  it('解析端口返回非对象 → 按无覆盖处理', () => {
    const resolver = { resolve: vi.fn(() => 'not-an-object' as never) };
    const { service, openSession } = createService(resolver);
    service.open(INPUT);

    const passed = openSession.mock.calls[0]?.[0];
    expect(passed).toBe(INPUT);
  });

  it('缺省 provider (NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE) 永远返回无覆盖', () => {
    const result = NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE.resolve({
      sessionId: 's-1',
      tenantId: TENANT,
      visitorId: VISITOR,
    });
    expect(result).toBeUndefined();
  });
});
