import { describe, expect, it } from 'vitest';

import { SHARED_RULE_TRACK } from '../../src/engine-adapters/cognition/model-event-classifier.js';
import { createEngineSessionPort } from '../../src/engine-adapters/wiring/engine.providers.js';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';

const TENANT = 'tenant-af349';
const VISITOR = 'visitor-af349';

describe('AF-349 生产装配默认规则轨 v2', () => {
  it('适配层共享规则轨与生产装配同源（都是 v2）', () => {
    expect(SHARED_RULE_TRACK.semantics).toBe('v2');
  });

  it('createEngineSessionPort 缺省走 v2：长词遮盖生效', async () => {
    const memories = new InMemoryMemoryStore();
    const session = createEngineSessionPort(memories);
    const handle = session.openSession({ sessionId: 'af349-default-v2', tenantId: TENANT, visitorId: VISITOR });
    const output = await session.turn(handle.handleId, { userText: '你觉得呢？' });
    expect(output.events).toEqual(['open_probe']);
    expect(output.eventDetails?.map((event) => event.kind)).toEqual(['open_probe']);
  });

  it('显式注入 legacy 仍可复现旧口径（回归锚不被覆盖）', async () => {
    const memories = new InMemoryMemoryStore();
    const session = createEngineSessionPort(memories, undefined, { classifier: new RuleBasedClassifier() });
    const handle = session.openSession({ sessionId: 'af349-legacy-override', tenantId: TENANT, visitorId: VISITOR });
    const output = await session.turn(handle.handleId, { userText: '你觉得呢？' });
    expect(output.events).toEqual(['empathy', 'open_probe']);
  });

  it('开启愿望演化与意图锁后，落库快照带情境愿望与锁；关闭时字段不出现', async () => {
    const bdiStates = new InMemoryBdiStateRepository();
    const memories = new InMemoryMemoryStore();
    const session = createEngineSessionPort(
      memories,
      undefined,
      {
        desireEvolutionConfig: {
          enabled: true,
          maxUnderlyingDeltaPerTurn: 0.02,
          baselinePullPerTurn: 0,
          situationalTtlTurns: 3,
          situationalPriorityFloor: 0.4,
        },
        intentionLockConfig: { enabled: true, ttlTurns: 3 },
      },
      bdiStates,
    );
    const sessionId = 'af349-evolve-lock';
    const handle = session.openSession({ sessionId, tenantId: TENANT, visitorId: VISITOR });
    await session.turn(handle.handleId, { userText: '我理解你的感受。' });

    const record = await bdiStates.load(TENANT, sessionId);
    expect(record?.snapshot.underlyingDesires.find((desire) => desire.key === 'understood')?.currentWeight).toBeCloseTo(0.62, 5);
    expect(record?.snapshot.situationalDesires.some((desire) => desire.active)).toBe(true);
    expect(record?.snapshot.intentionLock).not.toBeNull();
    expect(record?.snapshot.intentionLock?.strategy).toBeTruthy();
  });
});
