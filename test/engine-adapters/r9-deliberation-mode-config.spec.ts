// V2026-11-08 治本 (R9 · 适配层 · 灰度切换配置):
//   目的: 钉死"这一场会话走哪种审议模式"这条判定的**每一处分支** ——
//     ① 三态解析 (shadow / rule_only / llm_active) + 大小写/空白归一;
//     ② 非法值 → 回退 shadow (最保守方向), 空 / 未配 → shadow;
//     ③ 会话白名单解析 (逗号分隔, 空 = 全量);
//     ④ 总开关折叠 (ENGINE_DELIBERATION_ENABLED 关着 → 模式一律降级 rule_only);
//     ⑤ 会话级判定矩阵 (全局模式 × 名单);
//     ⑥ 场景路由: 考核场景**恒为 rule_only** (可复现性红线, 不接受配置覆盖);
//     ⑦ 超时解析 (非法值 → 3000);
//     ⑧ **场景红线** (V2026-11-11 G-1): 考核场景在**任何**全局模式/白名单下
//        都恒为 rule_only —— 判定链的**首条命中**, 优先于一切配置.
//
//   为什么"非法值必须回退"要单独钉:
//     灰度期改 env 的人**不是**开发者 —— 填错一个值不该让整场对练的行为面目全非.
//     回退到 shadow = 退回当前生产现状 (审议跑但不生效), 零回归.
//
//   反依赖污染: 只读配置解析, 不起 Nest 容器, 不发任何请求.
//
//   验证: npx vitest run test/engine-adapters/r9-deliberation-mode-config.spec.ts

import type { ConfigService } from '@nestjs/config';

import {
  DELIBERATION_EFFECTIVE_MODES,
  DELIBERATION_SCENARIO_TYPES,
  isLlmDeliberationActiveForSession,
  parseDeliberationGrayscaleSessions,
  resolveDeliberationEffectiveMode,
  resolveDeliberationEffectiveTimeoutMs,
  resolveDeliberationModeConfig,
  resolveSessionEffectiveMode,
} from '../../src/engine-adapters/deliberation/deliberation-mode.config.js';

/** 假 ConfigService: 只按 map 回值 (只读, 不碰 process.env). */
function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

describe('R9 · 灰度切换配置 (适配层)', () => {
  it('① 三态解析 + 归一 (大小写 / 前后空白都不影响)', () => {
    expect(resolveDeliberationEffectiveMode('shadow')).toBe('shadow');
    expect(resolveDeliberationEffectiveMode('rule_only')).toBe('rule_only');
    expect(resolveDeliberationEffectiveMode('llm_active')).toBe('llm_active');
    expect(resolveDeliberationEffectiveMode('  LLM_ACTIVE  ')).toBe('llm_active');
    expect(resolveDeliberationEffectiveMode('Rule_Only')).toBe('rule_only');
  });

  it('① 合法取值清单就是那三个 (不多不少)', () => {
    expect(DELIBERATION_EFFECTIVE_MODES).toEqual(['shadow', 'rule_only', 'llm_active']);
  });

  it('② 非法值 / 空 / 未配 → 一律回退 shadow', () => {
    expect(resolveDeliberationEffectiveMode('active')).toBe('shadow');
    expect(resolveDeliberationEffectiveMode('on')).toBe('shadow');
    expect(resolveDeliberationEffectiveMode('')).toBe('shadow');
    expect(resolveDeliberationEffectiveMode(' '.repeat(3))).toBe('shadow');
    expect(resolveDeliberationEffectiveMode(void 0)).toBe('shadow');
  });

  it('③ 白名单解析: 逗号分隔, 去空白, 丢空项; 空串 = 空集合 (= 全量)', () => {
    expect([...parseDeliberationGrayscaleSessions('a,b, c ')]).toEqual(['a', 'b', 'c']);
    expect([...parseDeliberationGrayscaleSessions('a,,b')]).toEqual(['a', 'b']);
    expect([...parseDeliberationGrayscaleSessions('')]).toEqual([]);
    expect([...parseDeliberationGrayscaleSessions(void 0)]).toEqual([]);
  });

  it('④ 总开关关着 → 模式一律降级 rule_only (一次 LLM 都不发)', () => {
    // 总开关未配 (缺省 = 关).
    expect(resolveDeliberationModeConfig(fakeConfig({})).effectiveMode).toBe('rule_only');
    // 总开关显式关.
    expect(resolveDeliberationModeConfig(fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'false' })).effectiveMode).toBe('rule_only');
    // 总开关开着 + 模式写 llm_active → 保持 llm_active.
    expect(
      resolveDeliberationModeConfig(fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active' }))
        .effectiveMode,
    ).toBe('llm_active');
    // 总开关开着 + 模式写 shadow → 保持 shadow (影子跑, 不生效).
    expect(
      resolveDeliberationModeConfig(fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'shadow' }))
        .effectiveMode,
    ).toBe('shadow');
  });

  it('④ 总开关开着但模式非法 → 回退 shadow (不是 rule_only, 也不是 llm_active)', () => {
    expect(
      resolveDeliberationModeConfig(fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: '乱填' }))
        .effectiveMode,
    ).toBe('shadow');
  });

  it('⑤ 会话级判定: rule_only → 一律 rule_only (名单无关)', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'rule_only' }),
    );
    expect(resolveSessionEffectiveMode(config, 's1', 'full_simulation')).toBe('rule_only');
    expect(resolveSessionEffectiveMode(config, '不在名单里', 'full_simulation')).toBe('rule_only');
  });

  it('⑤ 会话级判定: shadow → 一律 shadow (名单无关)', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'shadow' }),
    );
    expect(resolveSessionEffectiveMode(config, 's1', 'full_simulation')).toBe('shadow');
  });

  it('⑤ 会话级判定: llm_active + 名单为空 → 全量生效', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active' }),
    );
    expect(config.grayscaleSessions.size).toBe(0);
    expect(resolveSessionEffectiveMode(config, '随便哪场', 'full_simulation')).toBe('llm_active');
    expect(isLlmDeliberationActiveForSession(config, '随便哪场', 'full_simulation')).toBe(true);
  });

  it('⑤ 会话级判定: llm_active + 名单非空 → 名单内生效, 名单外 **rule_only**', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({
        ENGINE_DELIBERATION_ENABLED: 'true',
        ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active',
        ENGINE_DELIBERATION_GRAYSCALE_SESSIONS: 's1,s2',
      }),
    );
    expect(resolveSessionEffectiveMode(config, 's1', 'full_simulation')).toBe('llm_active');
    expect(resolveSessionEffectiveMode(config, 's2', 'full_simulation')).toBe('llm_active');
    // 名单外 = 纯规则 (**不是** shadow): 名单外会话此刻不该跑审议 (省 LLM 成本).
    expect(resolveSessionEffectiveMode(config, 's3', 'full_simulation')).toBe('rule_only');
    expect(isLlmDeliberationActiveForSession(config, 's3', 'full_simulation')).toBe(false);
  });

  it('⑧ 场景红线: 考核场景恒 rule_only (任何全局模式 / 白名单下都不生效)', () => {
    // llm_active + 名单内 —— 唯一能让普通场次生效的配置.
    const active = resolveDeliberationModeConfig(
      fakeConfig({
        ENGINE_DELIBERATION_ENABLED: 'true',
        ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active',
        ENGINE_DELIBERATION_GRAYSCALE_SESSIONS: 's1',
      }),
    );
    expect(resolveSessionEffectiveMode(active, 's1', 'full_simulation')).toBe('llm_active');
    // 同一场会话, 只是场景变成考核 → 恒 rule_only (红线优先于白名单).
    expect(resolveSessionEffectiveMode(active, 's1', 'exam')).toBe('rule_only');
    expect(isLlmDeliberationActiveForSession(active, 's1', 'exam')).toBe(false);

    // shadow / rule_only 全局模式下, 考核场景同样是 rule_only.
    const shadow = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'shadow' }),
    );
    expect(resolveSessionEffectiveMode(shadow, 's1', 'exam')).toBe('rule_only');
    const ruleOnly = resolveDeliberationModeConfig(fakeConfig({}));
    expect(resolveSessionEffectiveMode(ruleOnly, 's1', 'exam')).toBe('rule_only');
  });

  it('⑧ 非考核场景不受红线影响 (freeform 与 full_simulation 走同一口径)', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active' }),
    );
    expect(resolveSessionEffectiveMode(config, 's1', 'freeform')).toBe('llm_active');
    expect(resolveSessionEffectiveMode(config, 's1', 'full_simulation')).toBe('llm_active');
  });

  it('⑧ 场景类型清单与 ScenarioRouteConfig 的键一一对应 (三处不留两份)', () => {
    const config = resolveDeliberationModeConfig(fakeConfig({}));
    expect([...DELIBERATION_SCENARIO_TYPES].toSorted()).toEqual(['exam', 'freeform', 'full_simulation']);
    expect(Object.keys(config.scenarioRoutes).toSorted()).toEqual([...DELIBERATION_SCENARIO_TYPES].toSorted());
  });

  it('⑥ 场景路由: 考核场景**恒为 rule_only** (可复现性红线, 不接受配置覆盖)', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active' }),
    );
    expect(config.scenarioRoutes.exam).toBe('rule_only');
    expect(config.scenarioRoutes.freeform).toBe('rule_only');
    expect(config.scenarioRoutes.full_simulation).toBe('rule_only');
  });

  it('⑦ 超时解析: 非法值 / 空 → 3000; 合法值取整', () => {
    expect(resolveDeliberationEffectiveTimeoutMs(void 0)).toBe(3000);
    expect(resolveDeliberationEffectiveTimeoutMs('')).toBe(3000);
    expect(resolveDeliberationEffectiveTimeoutMs('abc')).toBe(3000);
    expect(resolveDeliberationEffectiveTimeoutMs('0')).toBe(3000);
    expect(resolveDeliberationEffectiveTimeoutMs('-1')).toBe(3000);
    expect(resolveDeliberationEffectiveTimeoutMs('1500')).toBe(1500);
    expect(resolveDeliberationEffectiveTimeoutMs('1500.9')).toBe(1500);
  });

  it('⑦ 装配结果里的超时读同一个 env 键 (与影子模式同一把尺子)', () => {
    const config = resolveDeliberationModeConfig(
      fakeConfig({ ENGINE_DELIBERATION_ENABLED: 'true', ENGINE_DELIBERATION_TIMEOUT_MS: '2222' }),
    );
    expect(config.timeoutMs).toBe(2222);
  });
});
