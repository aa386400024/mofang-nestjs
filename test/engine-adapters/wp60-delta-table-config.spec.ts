// V2026-11-08 WP60 (B 层 · delta 规则表装配):
//   职责: 钉死"env → DeltaTableConfig 端口"这条装配链 ——
//     ① 没配 env → 装配结果与内核种子值逐字一致 (端口是空的, 零回归);
//     ② JSON 覆写真的按 env 生效, 且**按维度**生效 (只写 trust 时其余维度回基础值);
//     ③ 非法值 (JSON 语法错 / 维度名不认识 / 值不是有限数) 一律忽略 = 回退内核基础值,
//        且**必须喊一声** (onWarn) —— 静默忽略 = 配了不生效却什么提示都没有.
//
//   为什么这层要有单测:
//     env 解析是**纯配置层**, 但它决定 BDI 的迁移系数 —— 而 env 默认在测试环境
//     是**没配**的, 所以"配错"这条路径在别的套件里根本走不到, 只能在这里显式造出来.
//
//   边界: 不起 Nest 容器 (ConfigService 用手写桩); 不连 Redis / DB / 网络.
//
//   验证: npx vitest run test/engine-adapters/wp60-delta-table-config.spec.ts

import { ConfigService } from '@nestjs/config';

import { resolveDeltaTableConfig } from '../../src/engine-adapters/wiring/delta-table.config.js';
import { DEFAULT_DELTA_TABLE_CONFIG, aggregateTurnDelta, type CounselorEventKind } from '../../src/engine-core/index.js';

/**
 * 造一个 ConfigService 桩 (只实现 get).
 *
 * 为什么不 new 真 ConfigService: 它要连整个配置加载链 (dotenv / 校验), 而本用例
 * 要验的是"**拿到什么值 → 装配成什么**", 与配置怎么加载无关.
 */
function configStub(env: Readonly<Record<string, string>>): ConfigService {
  return {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
}

/** 跑一次装配, 同时收集告警. */
function assemble(env: Readonly<Record<string, string>>): {
  readonly config: ReturnType<typeof resolveDeltaTableConfig>;
  readonly warnings: readonly string[];
} {
  const warnings: string[] = [];
  const config = resolveDeltaTableConfig(configStub(env), (message) => warnings.push(message));
  return { config, warnings };
}

describe('WP60 · delta 规则表装配 (env → DeltaTableConfig)', () => {
  it('没配任何 env → 装配结果与内核种子值逐字一致 (零回归)', () => {
    const { config, warnings } = assemble({});

    expect(config).toEqual(DEFAULT_DELTA_TABLE_CONFIG);
    expect(config.deltas).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('配了 JSON 覆写 → 真的按 env 生效', () => {
    const { config } = assemble({
      ENGINE_DELTA_EMPATHY: '{"trust":0.15,"safety":0.02}',
      ENGINE_DELTA_JUDGMENT: '{"trust":-0.2}',
    });

    expect(config.deltas.empathy).toEqual({ trust: 0.15, safety: 0.02 });
    expect(config.deltas.judgment).toEqual({ trust: -0.2 });
  });

  it('只写一个维度 → 其余维度不产生覆写项 (缺项回内核基础值)', () => {
    const { config } = assemble({
      ENGINE_DELTA_EMPATHY: '{"trust":0.15}',
    });

    expect(config.deltas.empathy).toEqual({ trust: 0.15 });
    expect(config.deltas.empathy?.safety).toBeUndefined();
  });

  it('负数是合法值 (受损方向的覆写)', () => {
    const { config } = assemble({
      ENGINE_DELTA_BOUNDARY_CROSS: '{"trust":-0.3,"style":0.2}',
    });

    expect(config.deltas.boundary_cross).toEqual({ trust: -0.3, style: 0.2 });
  });

  it('空串 → 无覆写 (模板里那些空行就是这一档), 且不告警', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_EMPATHY: '',
      ENGINE_DELTA_JUDGMENT: ' '.repeat(3),
    });

    expect(config.deltas).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('非法 JSON → 忽略该事件 + 告警 (不抛错, 不影响其余事件)', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_EMPATHY: '{trust: 0.15}',
      ENGINE_DELTA_JUDGMENT: '{"trust":-0.2}',
    });

    expect(config.deltas.empathy).toBeUndefined();
    expect(config.deltas.judgment).toEqual({ trust: -0.2 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ENGINE_DELTA_EMPATHY');
  });

  it('JSON 不是对象 (数组 / 数字 / 字符串 / null) → 忽略 + 告警', () => {
    for (const raw of ['[1,2]', '42', '"text"', 'null']) {
      const { config, warnings } = assemble({ ENGINE_DELTA_EMPATHY: raw });

      expect(config.deltas.empathy).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ENGINE_DELTA_EMPATHY');
    }
  });

  it('维度名不认识 → 忽略该维度 (其余维度保留) + 告警', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_EMPATHY: '{"trst":0.15,"trust":0.12}',
    });

    expect(config.deltas.empathy).toEqual({ trust: 0.12 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('trst');
  });

  it('值不是有限数 (字符串 / null / true) → 忽略该维度 + 告警', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_EMPATHY: '{"trust":"0.15","safety":null,"bond":true,"depth":0.05}',
    });

    expect(config.deltas.empathy).toEqual({ depth: 0.05 });
    expect(warnings).toHaveLength(3);
  });

  it('所有维度都被丢弃 → 不留空壳条目 (端口里只放真正生效的覆写)', () => {
    const { config } = assemble({
      ENGINE_DELTA_EMPATHY: '{"trst":0.15}',
    });

    expect(config.deltas.empathy).toBeUndefined();
    expect(Object.keys(config.deltas)).toEqual([]);
  });

  it('13 个事件键都能生效 (表里没漏事件)', () => {
    const kinds: readonly CounselorEventKind[] = [
      'empathy',
      'acceptance',
      'normalization',
      'open_probe',
      'affirmation',
      'judgment',
      'preaching',
      'minimizing',
      'boundary_cross',
      'sensitive_touch',
      'neutral',
      'holding_present',
      'cold_absent',
    ];
    const envKeys: Readonly<Record<CounselorEventKind, string | undefined>> = {
      empathy: 'ENGINE_DELTA_EMPATHY',
      acceptance: 'ENGINE_DELTA_ACCEPTANCE',
      normalization: 'ENGINE_DELTA_NORMALIZATION',
      open_probe: 'ENGINE_DELTA_OPEN_PROBE',
      affirmation: 'ENGINE_DELTA_AFFIRMATION',
      judgment: 'ENGINE_DELTA_JUDGMENT',
      preaching: 'ENGINE_DELTA_PREACHING',
      minimizing: 'ENGINE_DELTA_MINIMIZING',
      boundary_cross: 'ENGINE_DELTA_BOUNDARY_CROSS',
      sensitive_touch: 'ENGINE_DELTA_SENSITIVE_TOUCH',
      neutral: 'ENGINE_DELTA_NEUTRAL',
      // AF-419: 两类在场状态事件补上 env 通道 (此前刻意关闭, 标定只能改代码).
      holding_present: 'ENGINE_DELTA_HOLDING_PRESENT',
      cold_absent: 'ENGINE_DELTA_COLD_ABSENT',
    };

    const env: Record<string, string> = {};
    for (const kind of kinds) {
      const key = envKeys[kind];
      if (key === undefined) continue;
      env[key] = '{"trust":0.11}';
    }

    const { config, warnings } = assemble(env);

    expect(warnings).toEqual([]);
    for (const kind of kinds) {
      expect(config.deltas[kind]).toEqual({ trust: 0.11 });
    }
  });

  it('AF-419: 两类在场状态事件有 env 通道，且只覆写写到的维度', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_HOLDING_PRESENT: '{"safety":0.01,"bond":0.005}',
      ENGINE_DELTA_COLD_ABSENT: '{"trust":-0.01}',
    });

    expect(config.deltas.holding_present).toEqual({ safety: 0.01, bond: 0.005 });
    expect(config.deltas.cold_absent).toEqual({ trust: -0.01 });
    // 未写到的维度不进覆写项 → 仍回内核 AF-322 种子值.
    expect(config.deltas.holding_present?.verbal).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('AF-419: 在场事件覆写走同一套校验 (非法 JSON / 非法维度 / 非法值 → 丢弃 + 告警)', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_HOLDING_PRESENT: '{safety: 0.01}',
      ENGINE_DELTA_COLD_ABSENT: '{"trst":-0.01,"trust":-0.02}',
    });

    expect(config.deltas.holding_present).toBeUndefined();
    expect(config.deltas.cold_absent).toEqual({ trust: -0.02 });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('ENGINE_DELTA_HOLDING_PRESENT');
    expect(warnings[1]).toContain('trst');
  });

  it('AF-419: 在场事件空串 / 未设 → 不产生覆写项 (照常走内核种子值)', () => {
    const { config, warnings } = assemble({
      ENGINE_DELTA_HOLDING_PRESENT: '',
      ENGINE_DELTA_COLD_ABSENT: ' '.repeat(3),
    });

    expect(config.deltas).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('AF-420: 覆写在聚合层生效且逐维度合并 (只覆写 safety 时 bond 仍走内核种子值)', () => {
    // 端到端钉口径: env → 端口 → aggregateTurnDelta 的三段链路真的接通,
    //   而不是"解析出来了但内核不认". 内核种子 holding_present: safety +0.004 / bond +0.002.
    const events = [{ kind: 'holding_present' as const, matchedTerms: [], strength: 1 }];
    const seeded = aggregateTurnDelta(events);
    expect(seeded.safety).toBeCloseTo(0.004, 10);
    expect(seeded.bond).toBeCloseTo(0.002, 10);

    const { config } = assemble({ ENGINE_DELTA_HOLDING_PRESENT: '{"safety":0.02}' });
    const overridden = aggregateTurnDelta(events, undefined, config);
    expect(overridden.safety).toBeCloseTo(0.02, 10);
    // 未覆写维度仍回种子值 —— 覆写是"逐维度换", 不是"整行替换".
    expect(overridden.bond).toBeCloseTo(0.002, 10);
    expect(overridden.verbal).toBeCloseTo(-0.002, 10);
  });
});
