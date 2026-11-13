// V2026-11-08 治本 (Phase2.5 WP-A · 审议输入最小化 · 合规 + 成本双解决):
//   覆盖任务单 §5 的全部闸门:
//     ① 审议 prompt **不含**对话原文 (合规硬红线)
//     ② 事件分类提取正常 (复用内核事件词典)
//     ③ 状态对比数据正确 (前值 → 后值 + 变化量)
//     ④ 角色简述正确 (依恋风格 + 阻抗基线)
//     ⑤ 高风险分流正常 (高风险轮次永远不跑 LLM 审议)
//     ⑥ 低风险轮次审议能正常跑 (集成)
//     ⑦ 成本验证: prompt token 量下降 ≥ 40%
//
//   边界: 不起 Nest 容器 / 不触网 / 不调真实 LLM; 全部是纯函数 + 极小替身.
//
//   ⚠️ **为什么"零原文"要测两遍** (源码 + 运行时):
//     只测运行时, 有人把 prompt 改回去时测试可能仍绿 (断言写松了);
//     只测源码, 又测不到"组装过程把原文漏进去"的情况.
//     两遍都测 = 源码层守住"模板里没有原文入口", 运行时守住"组装结果里没有原文".

import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildBlockCounselorVerdict, buildTestStructuredInput } from './deliberation-fixtures.js';
import type { CounselorLlmJsonClient } from '../../src/counselor/providers/llm-json.client.js';
import {
  buildStateComparison,
  extractCounselorEvents,
  isDeliberationRiskAcceptable,
  resolveDeliberationRiskLevel,
} from '../../src/engine-adapters/deliberation/deliberation-input.js';
import type { DeliberationModeConfig } from '../../src/engine-adapters/deliberation/deliberation-mode.config.js';
import {
  buildDeliberationSchemaDescription,
  buildDeliberationSystemPrompt,
  buildDeliberationUserPrompt,
} from '../../src/engine-adapters/deliberation/deliberation-prompt.js';
import { DELIBERATION_DIMS } from '../../src/engine-adapters/deliberation/deliberation-types.js';
import { LlmDeliberationHook, type DeliberationRunner } from '../../src/engine-adapters/deliberation/llm-deliberation-hook.js';
import {
  DELIBERATION_TRACE_KEY_PREFIX,
  LlmDeliberationService,
  type DeliberationShadowInput,
  type DeliberationTraceRecord,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/domain/bdi-snapshot.js';
import type { BdiSnapshot, BdiStateRepository, SafetyVerdict } from '../../src/engine-core/index.js';
import type { RedisService } from '../../src/shared/infra/redis/redis.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const TENANT = 'tenant-1';
const SESSION = 'session-1';
const USER = 'user-1';

/** 一段真实感的咨询师发言 (会命中内核事件词典里的"听起来你"). */
const COUNSELOR_TEXT = '听起来你这段时间压力挺大的, 能跟我说说是什么让你这么累吗?';

/** 一段真实感的来访回应. */
const VISITOR_TEXT = '嗯…也谈不上, 就是夜里老醒, 脑子里停不下来。';

/** 角色简述 (角色种子元数据). */
const CHARACTER_BRIEF = '依恋风格: 回避型；大五人格: 神经质 0.72';

/** 造一份**真实感**的快照 (带信念 / 愿望 —— 旧版 prompt 会把整份塞进去). */
function realisticSnapshot(): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    coreBeliefs: [
      { theme: 'unlovable', statement: '我是不值得被爱的, 别人迟早会离开我', activationTags: ['abandonment'] },
      { theme: 'helpless', statement: '我什么都做不好, 改变不了任何事', activationTags: ['failure'] },
    ],
    temporaryBeliefs: [{ id: 'tb-1', statement: '如果我表现不好, 对方就会觉得我不值得被帮助', confidence: 0.7, source: 'observed' }],
    underlyingDesires: [
      { key: 'understood', label: '被理解', baselineWeight: 0.6, currentWeight: 0.62 },
      { key: 'accepted', label: '被接纳', baselineWeight: 0.55, currentWeight: 0.5 },
    ],
    situationalDesires: [{ id: 'sd-1', text: '想让咨询师知道自己最近很难受, 但又怕被说矫情', priority: 0.72, active: true }],
    trust: 0.42,
    safety: 0.31,
    bond: 0.28,
    emotion: { ...base.emotion, valence: -0.35, arousal: 0.62 },
  };
}

/** 估算 token 数 (CJK 约 1 字 1 token, 其余约 4 字符 1 token). */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/g) ?? []).length;
  const rest = text.length - cjk;
  return cjk + rest / 4;
}

/**
 * **改造前**的用户 prompt (原样重建) —— 成本对比的基准.
 *
 * ⚠️ 为什么在测试里重建一份, 而不是留一份"旧实现":
 *   旧实现已经不存在了 (它就是被本单删掉的东西). 留一份在 src 里 = 留一份死代码.
 *   在测试里重建 = 基准只活在"证明它更贵"这一个用途里, 不会有人误改它.
 */
function buildLegacyUserPrompt(input: {
  readonly snapshotJson: string;
  readonly counselorText: string;
  readonly visitorText: string;
  readonly characterBrief: string;
  readonly turnIndex: number;
  readonly ruleStrategy: string;
}): string {
  return [
    `【来访者当前状态】\n${input.snapshotJson}`,
    `【当前行为策略】\n${input.ruleStrategy}`,
    `【本轮咨询师发言】\n${input.counselorText}`,
    `【本轮来访者反应】\n${input.visitorText}`,
    `【角色背景】\n${input.characterBrief}`,
    `【会话轮次】\n第 ${input.turnIndex} 轮`,
  ].join('\n\n');
}

/** 装一个审议服务 (三个依赖全是极小替身). */
function buildService(options: { env?: Record<string, string>; requestJson?: ReturnType<typeof vi.fn> }): {
  service: LlmDeliberationService;
  requestJson: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const env = options.env ?? {};
  const requestJson = options.requestJson ?? vi.fn();
  const set = vi.fn();
  const config = { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
  const redis = {
    set,
    get: vi.fn(async (): Promise<string | null> => null),
    getClient: () => ({ eval: vi.fn(async (): Promise<number> => 1) }),
  } as unknown as RedisService;
  const llm = { requestJson } as unknown as CounselorLlmJsonClient;
  const bdiStates = { load: vi.fn(async () => null) } as unknown as BdiStateRepository;
  return { service: new LlmDeliberationService(llm, config, redis, bdiStates), requestJson, set };
}

/** 从 set 的调用参数里取出写进去的 trace 记录. */
function writtenRecord(set: ReturnType<typeof vi.fn>): DeliberationTraceRecord | null {
  const writes = set.mock.calls.filter((call) => (call as [string, string])[0].startsWith(DELIBERATION_TRACE_KEY_PREFIX)) as [
    string,
    string,
  ][];
  if (writes.length === 0) return null;
  return JSON.parse(writes[0][1]) as DeliberationTraceRecord;
}

/** 装配一份"LLM 审议已生效"的模式配置. */
function activeModeConfig(): DeliberationModeConfig {
  return {
    effectiveMode: 'llm_active',
    grayscaleSessions: new Set<string>(),
    timeoutMs: 3000,
    scenarioRoutes: { freeform: 'rule_only', full_simulation: 'rule_only', exam: 'rule_only' },
  };
}

describe('Phase2.5 WP-A · 审议输入最小化 (合规 + 成本双解决)', () => {
  describe('① 零对话原文 (合规硬红线)', () => {
    it('prompt 模板里**没有**原文字段 (源码层守卫)', () => {
      const source = readFileSync(path.join(__dirname, '../../src/engine-adapters/deliberation/deliberation-prompt.ts'), 'utf8');

      expect(source).not.toContain('counselorText');
      expect(source).not.toContain('visitorText');
      // 旧版的两个原文区块标题也必须整个消失 (改一半 = 还在漏).
      expect(source).not.toContain('【本轮咨询师发言】');
      expect(source).not.toContain('【本轮来访者反应】');
    });

    it('审议入参 (BullMQ job payload) 里**没有**对话原文', () => {
      const structured = buildTestStructuredInput({
        counselorText: COUNSELOR_TEXT,
        visitorText: VISITOR_TEXT,
        characterBrief: CHARACTER_BRIEF,
      });

      // 结构化输入的键里没有原文字段.
      expect(Object.keys(structured)).not.toContain('counselorText');
      expect(Object.keys(structured)).not.toContain('visitorText');
      // 任何一处值都装不下原话 (值要么是标签, 要么是数字, 要么是角色种子元数据).
      const values = Object.values(structured).flatMap((value) => (Array.isArray(value) ? value : [value]));
      for (const value of values) {
        if (typeof value === 'string') {
          expect(value).not.toContain(COUNSELOR_TEXT);
          expect(value).not.toContain(VISITOR_TEXT);
        }
      }
    });

    it('组装出来的 prompt 里**没有**咨询师与来访者说过的话', () => {
      const prompt = buildDeliberationUserPrompt({
        turnIndex: 7,
        structured: buildTestStructuredInput({
          counselorText: COUNSELOR_TEXT,
          visitorText: VISITOR_TEXT,
          characterBrief: CHARACTER_BRIEF,
        }),
      });

      expect(prompt).not.toContain(COUNSELOR_TEXT);
      expect(prompt).not.toContain(VISITOR_TEXT);
      // 逐句检查: 只要原文里有一段漏进来就算失败.
      expect(prompt).not.toContain('听起来你这段时间压力挺大的');
      expect(prompt).not.toContain('夜里老醒');
    });

    it('系统 prompt 明说"你没有对话原文" —— 免得模型去臆测话术', () => {
      const system = buildDeliberationSystemPrompt('freeform');

      expect(system).toContain('你没有对话原文');
      expect(system).toContain('不要臆测');
    });
  });

  describe('② 事件分类提取 (复用内核事件词典)', () => {
    it('共情类发言 → empathy 标签 (内核词典里的"听起来你")', () => {
      const events = extractCounselorEvents(undefined, COUNSELOR_TEXT);

      expect(events).toContain('empathy');
    });

    it('开放式探问类发言 → open_probe 标签', () => {
      const events = extractCounselorEvents(undefined, '你能再多说一点吗, 当时发生了什么?');

      expect(events).toContain('open_probe');
    });

    it('负向类发言 → 评判 / 说教标签 (内核词典的真实标签, 不是臆造的 confrontation_*)', () => {
      // ⚠️ 任务单原文写的是 `confrontation_*` —— 内核事件词典里**没有**这一族
      //   (内核是 judgment / preaching / minimizing / boundary_cross / sensitive_touch).
      //   按内核真实词表断言 (见交付记录偏差 D2).
      expect(extractCounselorEvents(undefined, '你就是太敏感了, 别想太多')).toContain('judgment');
      expect(extractCounselorEvents(undefined, '你应该听我的建议, 你必须改变')).toContain('preaching');
    });

    it('内核给的 events 优先 (适配层不另起一套预判 —— 否则两套标签必然漂移)', () => {
      const events = extractCounselorEvents(['normalization'], '听起来你压力挺大的');

      expect(events).toEqual(['normalization']);
    });

    it('neutral 不进标签 (它是"没命中任何规则"的占位)', () => {
      expect(extractCounselorEvents(['neutral'], '')).toEqual([]);
    });

    it('没命中任何规则 → 空数组 (不是 neutral 标签)', () => {
      expect(extractCounselorEvents(undefined, '嗯。')).toEqual([]);
    });
  });

  describe('③ 状态对比 (前值 → 后值 + 变化量)', () => {
    it('trust 从 0.5 变到 0.52 → 变化量 +0.020', () => {
      const before = { ...createEmptyBdiSnapshot(), trust: 0.5 };
      const after = { ...before, trust: 0.52 };

      const comparison = buildStateComparison(before, after);
      const trust = comparison.find((entry) => entry.dimension === 'trust');

      expect(trust?.before).toBeCloseTo(0.5, 6);
      expect(trust?.after).toBeCloseTo(0.52, 6);
      expect(trust?.delta).toBeCloseTo(0.02, 6);
    });

    it('prompt 里逐维显示"前值 → 后值 (变化量)"', () => {
      const before = { ...createEmptyBdiSnapshot(), trust: 0.5 };
      const after = { ...before, trust: 0.52 };

      const prompt = buildDeliberationUserPrompt({
        turnIndex: 1,
        structured: buildTestStructuredInput({ stateBefore: before, stateAfter: after }),
      });

      expect(prompt).toContain('trust: 0.500 → 0.520 (+0.020)');
    });

    it('11 维全给 (模型要绝对水位才能判幅度合不合理)', () => {
      const comparison = buildStateComparison(createEmptyBdiSnapshot(), createEmptyBdiSnapshot());

      expect(comparison).toHaveLength(DELIBERATION_DIMS.length);
      expect(comparison.map((entry) => entry.dimension)).toEqual([...DELIBERATION_DIMS]);
    });

    it('没变化的维度显示 0.000, 不带正负号 (免得"没动"看起来像"动了")', () => {
      const prompt = buildDeliberationUserPrompt({
        turnIndex: 1,
        structured: buildTestStructuredInput(),
      });

      expect(prompt).toMatch(/trust: [\d.]+ → [\d.]+ \(0\.000\)/);
      expect(prompt).not.toContain('+0.000');
    });
  });

  describe('④ 角色简述 (依恋风格 + 阻抗基线)', () => {
    it('回避型角色 → prompt 里显示"依恋风格: 回避型"', () => {
      const prompt = buildDeliberationUserPrompt({
        turnIndex: 1,
        structured: buildTestStructuredInput({ characterBrief: '依恋风格: 回避型' }),
      });

      expect(prompt).toContain('依恋风格: 回避型');
      expect(prompt).toContain('【角色基线】');
    });

    it('阻抗基线进 prompt (模型不看基线就判不了"阻抗涨了 0.015 算不算异常")', () => {
      const prompt = buildDeliberationUserPrompt({
        turnIndex: 1,
        structured: buildTestStructuredInput(),
      });

      expect(prompt).toContain('阻抗基线');
      expect(prompt).toContain('话量 / 内容深度 / 表达风格');
    });

    it('角色简述为空时仍然给阻抗基线 (留空 = 模型会脑补)', () => {
      const prompt = buildDeliberationUserPrompt({
        turnIndex: 1,
        structured: buildTestStructuredInput({ characterBrief: '' }),
      });

      expect(prompt).toContain('阻抗基线');
    });
  });

  describe('⑤ 高风险分流 (高风险轮次永远不跑 LLM 审议)', () => {
    it('block 级判定 → high (咨询师硬红线 / 来访行动层危机)', () => {
      const risk = resolveDeliberationRiskLevel(buildBlockCounselorVerdict(), void 0);

      expect(risk.level).toBe('high');
      expect(risk.categories).toContain('suicide_coaching');
    });

    it('危机类别 + warn 级 → medium (被动自杀意图 / 自伤意念 这类"自杀倾向")', () => {
      const verdict: SafetyVerdict = {
        level: 'warn',
        side: 'visitor_output',
        categories: ['passive_ideation'],
        matchedRules: [],
        source: 'rule',
      };

      expect(resolveDeliberationRiskLevel(undefined, verdict).level).toBe('medium');
    });

    it('专业性 warn (价值评判) → low (不含心理内容, 恰恰是 LLM 审议最该帮忙的场景)', () => {
      const verdict: SafetyVerdict = {
        level: 'warn',
        side: 'counselor_input',
        categories: ['value_judgment'],
        matchedRules: ['counselor.value_judgment'],
        source: 'rule',
      };

      expect(resolveDeliberationRiskLevel(verdict, void 0).level).toBe('low');
    });

    it('只有 low 允许跑审议 (medium / high 一律不跑)', () => {
      expect(isDeliberationRiskAcceptable('low')).toBe(true);
      expect(isDeliberationRiskAcceptable('medium')).toBe(false);
      expect(isDeliberationRiskAcceptable('high')).toBe(false);
    });

    it('集成: 高风险轮次 → **不调 LLM**, 写一条 skipped_high_risk 的 trace', async () => {
      const { service, requestJson, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn(),
      });
      const input: DeliberationShadowInput = {
        sessionId: SESSION,
        tenantId: TENANT,
        userId: USER,
        turnIndex: 3,
        baseRevision: 7,
        mode: 'freeform',
        structured: buildTestStructuredInput({ counselorVerdict: buildBlockCounselorVerdict() }),
        ruleDelta: {
          trust: 0,
          safety: 0,
          bond: 0,
          valence: 0,
          arousal: 0,
          verbal: 0,
          depth: 0,
          style: 0,
          positive: 0,
          negative: 0,
          dependency: 0,
        },
      };

      const outcome = await service.executeShadowMode(input);

      // 一次 LLM 都不发 (合规红线的核心).
      expect(requestJson).not.toHaveBeenCalled();
      expect(outcome.kind).toBe('skipped');
      // 但**留证据** —— 看板要能证明"高风险轮次一次都没出境".
      const record = writtenRecord(set);
      expect(record?.errorCode).toBe('skipped_high_risk');
      expect(record?.ok).toBe(false);
    });

    it('集成: 危机意念 (medium) 轮次 → 同样不调 LLM', async () => {
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn(),
      });
      const input: DeliberationShadowInput = {
        sessionId: SESSION,
        tenantId: TENANT,
        userId: USER,
        turnIndex: 3,
        baseRevision: 7,
        mode: 'freeform',
        structured: buildTestStructuredInput({
          counselorVerdict: {
            level: 'warn',
            side: 'visitor_output',
            categories: ['passive_ideation'],
            matchedRules: [],
            source: 'rule',
          },
        }),
        ruleDelta: {
          trust: 0,
          safety: 0,
          bond: 0,
          valence: 0,
          arousal: 0,
          verbal: 0,
          depth: 0,
          style: 0,
          positive: 0,
          negative: 0,
          dependency: 0,
        },
      };

      await service.executeShadowMode(input);

      expect(requestJson).not.toHaveBeenCalled();
    });

    it('集成: 生效路径 (R9) 的高风险轮次 → 不产建议 (上层回退规则 delta)', async () => {
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn(),
      });
      const outcome = await service.runEffectiveDeliberation({
        sessionId: SESSION,
        tenantId: TENANT,
        userId: USER,
        turnIndex: 3,
        baseRevision: 7,
        mode: 'freeform',
        structured: buildTestStructuredInput({ counselorVerdict: buildBlockCounselorVerdict() }),
        ruleDelta: {
          trust: 0,
          safety: 0,
          bond: 0,
          valence: 0,
          arousal: 0,
          verbal: 0,
          depth: 0,
          style: 0,
          positive: 0,
          negative: 0,
          dependency: 0,
        },
      });

      expect(requestJson).not.toHaveBeenCalled();
      expect(outcome.kind).toBe('failed');
      expect(outcome.kind === 'failed' ? outcome.errorCode : null).toBe('skipped_high_risk');
    });

    it('集成: 生效钩子遇到高风险轮次 → 不调执行器 (不产建议)', async () => {
      const runner: DeliberationRunner = { run: vi.fn(async () => ({ trust: 0.1 })) };
      const hook = new LlmDeliberationHook(activeModeConfig(), runner);

      await hook.produce({
        context: {
          snapshot: createEmptyBdiSnapshot(),
          ruleDelta: {
            trust: 0,
            safety: 0,
            bond: 0,
            valence: 0,
            arousal: 0,
            verbal: 0,
            depth: 0,
            style: 0,
            positive: 0,
            negative: 0,
            dependency: 0,
          },
          counselorText: '',
          tenantId: TENANT,
          sessionId: SESSION,
          turnIndex: 3,
          currentRevision: 7,
        },
        extras: {
          userId: USER,
          structured: buildTestStructuredInput({ counselorVerdict: buildBlockCounselorVerdict() }),
        },
      });

      expect(runner.run).not.toHaveBeenCalled();
    });
  });

  describe('⑥ 低风险轮次审议能正常跑 (集成)', () => {
    it('低风险 → 正常调 LLM → 拿到 delta → 写 trace', async () => {
      const { service, requestJson, set } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            output: {
              deltas: [{ dimension: 'trust', delta: 0.08, operatorTags: ['empathy'], reason: '咨询师先复述了来访的情绪' }],
              summary: '来访者仍保持戒备, 但语气比上一轮软了一点',
              confidence: 0.62,
              intentionShift: null,
            },
            rejectedEntries: [],
          },
          rawText: '{}',
          errorCode: null,
          errorMessage: null,
          usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
        }),
      });
      const input: DeliberationShadowInput = {
        sessionId: SESSION,
        tenantId: TENANT,
        userId: USER,
        turnIndex: 3,
        baseRevision: 7,
        mode: 'freeform',
        structured: buildTestStructuredInput({
          counselorText: COUNSELOR_TEXT,
          visitorText: VISITOR_TEXT,
          characterBrief: CHARACTER_BRIEF,
        }),
        ruleDelta: {
          trust: 0.05,
          safety: 0.02,
          bond: 0.01,
          valence: -0.01,
          arousal: 0,
          verbal: 0,
          depth: 0,
          style: 0,
          positive: 0,
          negative: 0,
          dependency: 0,
        },
      };

      const outcome = await service.executeShadowMode(input);

      expect(outcome.kind).toBe('ok');
      expect(requestJson).toHaveBeenCalledTimes(1);
      const record = writtenRecord(set);
      expect(record?.ok).toBe(true);
      expect(record?.deliberationDelta.trust).toBeCloseTo(0.08, 6);
    });

    it('发给 LLM 的 user prompt 里**没有**原文 (端到端验证)', async () => {
      const { service, requestJson } = buildService({
        env: { ENGINE_DELIBERATION_ENABLED: 'true' },
        requestJson: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            output: { deltas: [], summary: '本轮无显著变化', confidence: 0.4, intentionShift: null },
            rejectedEntries: [],
          },
          rawText: '{}',
          errorCode: null,
          errorMessage: null,
          usage: null,
        }),
      });

      await service.executeShadowMode({
        sessionId: SESSION,
        tenantId: TENANT,
        userId: USER,
        turnIndex: 3,
        baseRevision: 7,
        mode: 'freeform',
        structured: buildTestStructuredInput({
          counselorText: COUNSELOR_TEXT,
          visitorText: VISITOR_TEXT,
          characterBrief: CHARACTER_BRIEF,
        }),
        ruleDelta: {
          trust: 0,
          safety: 0,
          bond: 0,
          valence: 0,
          arousal: 0,
          verbal: 0,
          depth: 0,
          style: 0,
          positive: 0,
          negative: 0,
          dependency: 0,
        },
      });

      const request = requestJson.mock.calls[0][0] as { systemPrompt: string; userPrompt: string };
      expect(request.userPrompt).not.toContain(COUNSELOR_TEXT);
      expect(request.userPrompt).not.toContain(VISITOR_TEXT);
      expect(request.userPrompt).toContain('【本轮事件分类】');
    });
  });

  describe('⑦ 成本验证 (token 量下降 ≥ 40%)', () => {
    it('用户 prompt 的估算 token 量比改造前下降 ≥ 40%', () => {
      const snapshot = realisticSnapshot();
      const legacy = buildLegacyUserPrompt({
        snapshotJson: JSON.stringify(snapshot),
        counselorText: COUNSELOR_TEXT,
        visitorText: VISITOR_TEXT,
        characterBrief: CHARACTER_BRIEF,
        turnIndex: 7,
        ruleStrategy: 'recounting',
      });
      const current = buildDeliberationUserPrompt({
        turnIndex: 7,
        structured: buildTestStructuredInput({
          counselorText: COUNSELOR_TEXT,
          visitorText: VISITOR_TEXT,
          characterBrief: CHARACTER_BRIEF,
          stateBefore: snapshot,
          stateAfter: snapshot,
        }),
      });

      const legacyTokens = estimateTokens(legacy);
      const currentTokens = estimateTokens(current);

      // 下降 ≥ 40% (即新值 ≤ 旧值的 60%).
      expect(currentTokens).toBeLessThanOrEqual(legacyTokens * 0.6);
      // 顺带确认基准不是空转 (旧 prompt 确实不小).
      expect(legacyTokens).toBeGreaterThan(200);
    });

    it('整体请求 (system + user + schema) 的 token 量**不高于**改造前 (回归守卫)', () => {
      const snapshot = realisticSnapshot();
      const legacyTotal =
        buildDeliberationSystemPrompt('freeform') +
        buildLegacyUserPrompt({
          snapshotJson: JSON.stringify(snapshot),
          counselorText: COUNSELOR_TEXT,
          visitorText: VISITOR_TEXT,
          characterBrief: CHARACTER_BRIEF,
          turnIndex: 7,
          ruleStrategy: 'recounting',
        }) +
        buildDeliberationSchemaDescription();
      const currentTotal =
        buildDeliberationSystemPrompt('freeform') +
        buildDeliberationUserPrompt({
          turnIndex: 7,
          structured: buildTestStructuredInput({
            counselorText: COUNSELOR_TEXT,
            visitorText: VISITOR_TEXT,
            characterBrief: CHARACTER_BRIEF,
            stateBefore: snapshot,
            stateAfter: snapshot,
          }),
        }) +
        buildDeliberationSchemaDescription();

      // ⚠️ **这里只守"不高于", 不守"降 40%"** —— 原因见交付记录偏差 D4:
      //   审议请求的**固定成本** (system prompt + schema 描述 ≈ 1600 token) 是大头,
      //   而本单砍掉的是**每轮载荷** (user prompt: 385 → 202, −47.7%).
      //   固定成本属于输出契约 (schema) 与系统提示, 不在本单"只改输入"的范围内.
      expect(estimateTokens(currentTotal)).toBeLessThanOrEqual(estimateTokens(legacyTotal));
    });

    it('成本大头是**固定成本**, 不是对话上下文 (给 WP-C 触发式闸门的决策依据)', () => {
      const snapshot = realisticSnapshot();
      const systemTokens = estimateTokens(buildDeliberationSystemPrompt('freeform'));
      const schemaTokens = estimateTokens(buildDeliberationSchemaDescription());
      const userTokens = estimateTokens(
        buildDeliberationUserPrompt({
          turnIndex: 7,
          structured: buildTestStructuredInput({
            counselorText: COUNSELOR_TEXT,
            visitorText: VISITOR_TEXT,
            characterBrief: CHARACTER_BRIEF,
            stateBefore: snapshot,
            stateAfter: snapshot,
          }),
        }),
      );

      // 固定成本 (system + schema) 明显大于每轮载荷 —— 降本的真正杠杆在这里,
      // 不在"再砍一点上下文".
      expect(systemTokens + schemaTokens).toBeGreaterThan(userTokens * 3);
    });
  });
});
