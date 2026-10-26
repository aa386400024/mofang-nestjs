// V2026-10-26 治本 (vpt 会话增强 — 纯函数与降级语义单测):
//   原因: 本轮新增了三处"一旦错了后果很大、但靠运行很难发现"的不变量:
//     ① **年龄区间 → 下限** (voice-visitor-card.ts): 解析不出时必须返回 null 而不是 0 ——
//        0 岁是荒谬的假值, 前端会拿它排版, 报告里也会写"0 岁".
//     ② **落库桥的降级语义** (voice-session-bridge.ts): 桥未注册 / 桥抛错时,
//        `open()` 必须返回 `{ persisted: false }` 而**不是**抛异常 —— 抛异常会让整场
//        语音会话断连 (一次 DB 抖动就把"能对聊"打成"不能用"). 这是本轮最关键的不变量.
//     ③ **帧出口的路由语义** (voice-frame-registry.ts): 帧必须**按会话精确路由** ——
//        A 会话的提示推给 B 会话的用户是严重隐私事故; 没有出口时要静默丢弃而不是报错.
//     三者都是无 IO 的纯逻辑 / 纯对象, 因此不需要起应用就能测.
//
//   范围说明: 带 DI 的部分 (WS 握手真连 / get_voice 真连上游 / DB 落库 / BullMQ 分析)
//     不在本文件覆盖范围 —— 那些依赖真实环境与账号, 按项目惯例走人工联调.
//
//   验证:
//     1. npx jest test/voice/vpt-session.spec.ts 全绿
//     2. 故意让 VoiceSessionBridgeRegistry.open 不吞异常 → "桥抛错降级"用例变红
//     3. 故意让 parseAgeRangeLowerBound 解析不出时返回 0 → "解析不出返回 null"用例变红
//
//   时间戳: 2026-10-26
import { parseAgeRangeLowerBound, buildVoiceVisitorCard } from '../../src/voice/voice-visitor-card';
import { VoiceFrameRegistry } from '../../src/voice/voice-frame-registry';
import { VoiceSessionBridgeRegistry, type VoiceSessionBridge } from '../../src/voice/voice-session-bridge';
import type { VoiceTemplateSummary } from '../../src/voice/voice-session.types';
import type { VoiceServerMessage } from '../../src/voice/voice.types';

/** 一份公共人物模板摘要 (字段与 counselor 侧 resolver 产出 1:1). */
const SUMMARY: VoiceTemplateSummary = {
  templateId: 'vpt_x',
  codename: '晚晴',
  ageRange: '28-35',
  presentingComplaint: '总在关系里先讨好，事后又一个人觉得委屈',
  difficulty: 'L2',
  styleHint: 'cooperative',
  emotionBaselineDefault: 0.35,
  defenseLevelDefault: 0.2,
  defenseType: 'avoidance',
  occupation: '平面设计师',
  riskTags: ['涉及危机需识别转介'],
};

/** 一份可用的桥 (落库成功). */
const OK_BRIDGE: VoiceSessionBridge = {
  name: 'ok',
  open: async () => ({ persisted: true, dbSessionId: 'db-session-1' }),
  appendTurn: async () => undefined,
  close: async () => undefined,
};

/** 一份总是抛错的桥 (模拟 DB 故障). */
const FAILING_BRIDGE: VoiceSessionBridge = {
  name: 'failing',
  open: async () => {
    throw new Error('db down');
  },
  appendTurn: async () => {
    throw new Error('db down');
  },
  close: async () => {
    throw new Error('db down');
  },
};

describe('年龄区间 → 下限 (速查卡字段)', () => {
  it('常规区间取下限', () => {
    expect(parseAgeRangeLowerBound('28-35')).toBe(28);
  });

  it('开区间也取数字部分', () => {
    expect(parseAgeRangeLowerBound('40+')).toBe(40);
  });

  it('解析不出 → null (**不是 0** —— 0 岁是荒谬的假值)', () => {
    expect(parseAgeRangeLowerBound('未知')).toBeNull();
    expect(parseAgeRangeLowerBound('')).toBeNull();
  });
});

describe('来访者速查卡构造', () => {
  it('字段逐个映射到位', () => {
    const card = buildVoiceVisitorCard(SUMMARY);

    expect(card.codename).toBe('晚晴');
    expect(card.ageRange).toBe('28-35');
    expect(card.ageLowerBound).toBe(28);
    expect(card.occupation).toBe('平面设计师');
    expect(card.presentingComplaint).toBe(SUMMARY.presentingComplaint);
    expect(card.riskTags).toEqual(['涉及危机需识别转介']);
  });

  it('riskTags 是**拷贝** (改卡片不影响源摘要)', () => {
    const card = buildVoiceVisitorCard(SUMMARY);

    // 卡片的 riskTags 声明是 readonly (不让人乱改), 所以这里比对**引用**而不是去 push ——
    // 断言的是"卡片拿到的是副本, 不是源摘要那个数组".
    expect(card.riskTags).not.toBe(SUMMARY.riskTags);
    expect(card.riskTags).toEqual(SUMMARY.riskTags);
  });

  it('卡片里不含 7 大块剧本字段 (零压红线的结构级保证)', () => {
    const card = buildVoiceVisitorCard(SUMMARY);
    const keys = Object.keys(card);
    const forbidden = [
      'script',
      'basics',
      'innerWorkingModel',
      'socialMap',
      'coping',
      'therapyExpectation',
      'developmentalTimeline',
    ];

    for (const key of forbidden) {
      expect(keys).not.toContain(key);
    }
  });
});

describe('落库桥注册表 · 降级语义', () => {
  it('没人注册桥 → 降级为未落库 (**不抛** —— 一次 DB 抖动不该把会话打死)', async () => {
    const registry = new VoiceSessionBridgeRegistry();

    const result = await registry.open({
      sessionId: 'ws-1',
      userId: 'u-1',
      tenantId: 't-1',
      templateId: null,
      visitor: buildVoiceVisitorCard(SUMMARY),
      preset: { difficulty: 'L1', style: 'mixed', emotionBaseline: 0.35, defenseLevel: 0.2, visitorMode: 'useMySettings' },
      skillCode: null,
    });

    expect(result.persisted).toBe(false);
    expect(result.dbSessionId).toBeNull();
  });

  it('桥抛错 → 降级为未落库, **异常不冒泡**', async () => {
    const registry = new VoiceSessionBridgeRegistry();
    registry.register(FAILING_BRIDGE);

    const result = await registry.open({
      sessionId: 'ws-1',
      userId: 'u-1',
      tenantId: 't-1',
      templateId: null,
      visitor: buildVoiceVisitorCard(SUMMARY),
      preset: { difficulty: 'L1', style: 'mixed', emotionBaseline: 0.35, defenseLevel: 0.2, visitorMode: 'useMySettings' },
      skillCode: null,
    });

    expect(result.persisted).toBe(false);
    expect(result.dbSessionId).toBeNull();
  });

  it('桥成功 → 返回稳定落库 id', async () => {
    const registry = new VoiceSessionBridgeRegistry();
    registry.register(OK_BRIDGE);

    const result = await registry.open({
      sessionId: 'ws-1',
      userId: 'u-1',
      tenantId: 't-1',
      templateId: 'vpt_x',
      visitor: buildVoiceVisitorCard(SUMMARY),
      preset: { difficulty: 'L1', style: 'mixed', emotionBaseline: 0.35, defenseLevel: 0.2, visitorMode: 'useMySettings' },
      skillCode: 'listening',
    });

    expect(result.persisted).toBe(true);
    expect(result.dbSessionId).toBe('db-session-1');
  });

  it('appendTurn / close 抛错也不冒泡 (收尾动作不该炸掉会话结束)', async () => {
    const registry = new VoiceSessionBridgeRegistry();
    registry.register(FAILING_BRIDGE);

    await expect(
      registry.appendTurn({
        sessionId: 'ws-1',
        dbSessionId: 'db-1',
        userId: 'u-1',
        tenantId: 't-1',
        turnIndex: 0,
        counselorText: '你好',
        visitorText: '还行吧',
      }),
    ).resolves.toBeUndefined();

    await expect(
      registry.close({
        sessionId: 'ws-1',
        dbSessionId: 'db-1',
        userId: 'u-1',
        tenantId: 't-1',
        reason: 'user_finish',
        turnCount: 1,
        durationMs: 1000,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('WS 帧出口注册表 · 路由语义', () => {
  it('帧送到**对应会话**的出口 (按会话精确路由)', () => {
    const registry = new VoiceFrameRegistry();
    const received: VoiceServerMessage[] = [];
    registry.register('db-1', (frame) => received.push(frame));

    const published = registry.publish('db-1', { type: 'paused' });

    expect(published).toBe(true);
    expect(received).toEqual([{ type: 'paused' }]);
  });

  it('没登记出口 → 静默丢弃并返回 false (非 vpt 会话不该收到帧)', () => {
    const registry = new VoiceFrameRegistry();

    expect(registry.publish('db-unknown', { type: 'resumed' })).toBe(false);
  });

  it('出口抛错 → 吞掉并返回 false (一个坏出口不该把分析 worker 打死)', () => {
    const registry = new VoiceFrameRegistry();
    registry.register('db-1', () => {
      throw new Error('socket closed');
    });

    expect(registry.publish('db-1', { type: 'paused' })).toBe(false);
  });

  it('注销后不再投递 (连接断开即退订)', () => {
    const registry = new VoiceFrameRegistry();
    const received: VoiceServerMessage[] = [];
    const unregister = registry.register('db-1', (frame) => received.push(frame));

    unregister();

    expect(registry.publish('db-1', { type: 'paused' })).toBe(false);
    expect(received).toHaveLength(0);
  });
});
