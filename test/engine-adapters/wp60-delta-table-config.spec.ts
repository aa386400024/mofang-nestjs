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
import { DEFAULT_DELTA_TABLE_CONFIG, type CounselorEventKind } from '../../src/engine-core/index.js';

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

  it('11 个事件键都能生效 (表里没漏事件)', () => {
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
      // D-2: 两类新 kind 本单**刻意不开 env 通道** (任务单 §3.2「不新增 env 键」) ——
      //   临床幅度是标定批次的事, 那一单再扩这两个字面量读取.
      //   这里显式写成 undefined: 联合一变, 编译仍逼着人显式决定, 不会静默漏掉.
      holding_present: undefined,
      cold_absent: undefined,
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

  it('D-2: 两类新 kind 刻意**没有** env 通道 (临床幅度留标定批次)', () => {
    // 任务单 §3.2 明确「不新增 env 键」—— 临床幅度由标定批次经 DeltaTableConfig 覆写落地.
    //   这里把「没有通道」钉成显式事实: 填了 env 也不生效, 且**不告警** (不是解析失败).
    const { config, warnings } = assemble({
      ENGINE_DELTA_HOLDING_PRESENT: '{"trust":0.11}',
      ENGINE_DELTA_COLD_ABSENT: '{"trust":0.11}',
    });

    expect(config.deltas.holding_present).toBeUndefined();
    expect(config.deltas.cold_absent).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});
