// V2026-10-29 治本 (WP18 · 督导主报告 · 生成链路):
//   覆盖任务单 §1.1 (报告生成触发链路) / §1.2 (字段对齐) / §1.3 (四态边界) 在
//   **主报告生产侧** 的可测行为:
//     ① 走**主报告专属参数档** (maxCompletionTokens + reasoningEffort + timeoutMs),
//        不再用旧的 `maxTokens` —— 旧预算被思考吃满 → 正文为空 → 报告恒 parse_error;
//     ② JSON 容错抽取生效: 模型加 ```json 围栏 / 前后废话, 仍能出 completed 报告;
//     ③ 失败原因可区分: 上游按长度截断 (`finish_reason=length`) → 标 `truncated_by_length`;
//        正文为空但没截断信号 → 标 `empty_response` (思考吃光预算的典型症状);
//     ④ 字段缺失 → 仍是 parse_error (红线: 不编造评分).
//
//   全 mock, 不连真实上游: 只喂 LlmService.streamChat 的假流, 不发请求.
//   验证: npx jest test/agent/wp18-supervisor-report.spec.ts
//   时间戳: 2026-10-29 GMT+8

import type { LlmService } from '../../src/agent/llm/llm.service';
import type { LlmStreamChunk, LlmStreamOptions } from '../../src/agent/llm/llm.types';
import type { SupervisionReportRepository } from '../../src/agent/supervisor/domain/repositories/supervision-report.repository';
import type { SupervisorLlmProfile } from '../../src/agent/supervisor/supervisor-llm.config';
import { SupervisorService } from '../../src/agent/supervisor/supervisor.service';
import type { RunReportInput, SupervisionReportRow } from '../../src/agent/supervisor/supervisor.types';

/** 一份合法的督导报告 JSON (字段与 `validateReportShape` 的强约束 1:1). */
const VALID_REPORT = {
  overallScore: 72,
  dimensions: {
    empathy: 80,
    activeListening: 75,
    questioning: 68,
    boundary: 85,
    response: 70,
    professionalism: 78,
  },
  annotations: [
    {
      timestamp: 1_700_000_000_000,
      type: 'good',
      category: '共情回应',
      message: '准确复述了来访者的情绪. ',
    },
  ],
  errorPatterns: ['急于给建议'],
  growthSuggestions: ['多停顿, 让来访者先说完.'],
};

/** 最小 runReport 入参. */
function input(): RunReportInput {
  return {
    sessionId: 'session-1',
    tenantId: 'default',
    userId: 'user-1',
    persona: { id: 'vpt_x', name: '晚晴', voiceId: '', difficulty: 'L1' },
    transcript: [
      { role: 'user', content: '最近有点累.', at: 1 },
      { role: 'assistant', content: '嗯, 听起来挺不容易的.', at: 2 },
    ],
    emotionTimeline: [],
  };
}

/** 造一个只吐给定 chunk 的 LlmService 替身 (并记录收到的 opts). */
function stubLlm(chunks: readonly LlmStreamChunk[], captured: LlmStreamOptions[]): LlmService {
  return {
    streamChat(_messages: unknown, opts: LlmStreamOptions): AsyncIterable<LlmStreamChunk> {
      captured.push(opts);
      return (async function* (): AsyncGenerator<LlmStreamChunk> {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
  } as unknown as LlmService;
}

/** 造一个只记录写入行的仓储替身. */
function stubRepo(saved: SupervisionReportRow[]): SupervisionReportRepository {
  return {
    save: async (row: SupervisionReportRow): Promise<SupervisionReportRow> => {
      saved.push(row);
      return row;
    },
  } as unknown as SupervisionReportRepository;
}

/** usage 固定值 (本套件不关心 token 口径). */
const USAGE = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };

describe('WP18 · 督导主报告生成链路', () => {
  describe('① 走主报告专属参数档', () => {
    it('注入的档位原样传给 LLM (maxCompletionTokens / reasoningEffort / timeoutMs)', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const profile: SupervisorLlmProfile = { reasoningEffort: 'high', maxCompletionTokens: 8192, timeoutMs: 120_000 };
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: JSON.stringify(VALID_REPORT) },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
        profile,
      );

      await service.runReport(input());

      expect(captured).toHaveLength(1);
      expect(captured[0]?.maxCompletionTokens).toBe(8192);
      expect(captured[0]?.reasoningEffort).toBe('high');
      expect(captured[0]?.timeoutMs).toBe(120_000);
    });

    it('**不再**下发旧的 maxTokens (那是预算被思考吃光的元凶)', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: JSON.stringify(VALID_REPORT) },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      await service.runReport(input());

      expect(captured[0]?.maxTokens).toBeUndefined();
    });

    it('未注入档位时用默认档 (单测直接 new 的场景)', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: JSON.stringify(VALID_REPORT) },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      await service.runReport(input());

      expect(captured[0]?.maxCompletionTokens).toBe(8192);
      expect(captured[0]?.reasoningEffort).toBe('high');
    });
  });

  describe('② JSON 容错抽取', () => {
    it('模型加 ```json 围栏 → 照样出 completed 报告', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: '```json\n' + JSON.stringify(VALID_REPORT) + '\n```' },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      const row = await service.runReport(input());

      expect(row.status).toBe('completed');
      expect(row.overallScore).toBe(72);
      expect(row.dimensions.empathy).toBe(80);
      expect(row.annotations).toHaveLength(1);
    });

    it('模型在 JSON 前后加废话 → 照样出 completed 报告', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: '以下是督导报告: ' + JSON.stringify(VALID_REPORT) + ' 以上为本次分析.' },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      const row = await service.runReport(input());

      expect(row.status).toBe('completed');
      expect(row.overallScore).toBe(72);
    });

    it('内联 <think> 思考块 → 照样出 completed 报告', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: '<think>先看看维度…</think>' + JSON.stringify(VALID_REPORT) },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      const row = await service.runReport(input());

      expect(row.status).toBe('completed');
    });
  });

  describe('③ 失败原因可区分', () => {
    it('上游按长度截断 → 失败原因标 truncated_by_length', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(stubLlm([{ type: 'done', usage: USAGE, finishReason: 'length' }], captured), stubRepo(saved));

      const row = await service.runReport(input());

      expect(row.status).toBe('parse_error');
      expect(row.annotations[0]?.category).toBe('parse_error');
      expect(row.annotations[0]?.message).toContain('truncated_by_length');
    });

    it('正文为空但无截断信号 → 失败原因标 empty_response (思考吃光预算的典型症状)', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(stubLlm([{ type: 'done', usage: USAGE }], captured), stubRepo(saved));

      const row = await service.runReport(input());

      expect(row.status).toBe('parse_error');
      expect(row.annotations[0]?.message).toContain('empty_response');
    });

    it('纯文本回复 (无 JSON) → 失败原因标 json_not_found', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: '抱歉，我无法生成该报告。' },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      const row = await service.runReport(input());

      expect(row.status).toBe('parse_error');
      expect(row.annotations[0]?.message).toContain('json_not_found');
    });

    it('失败行不编造评分 (总分 0 / 六维全 0 是占位, 不是"评出来的 0 分")', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(stubLlm([{ type: 'done', usage: USAGE, finishReason: 'length' }], captured), stubRepo(saved));

      const row = await service.runReport(input());

      expect(row.overallScore).toBe(0);
      expect(row.dimensions.empathy).toBe(0);
      expect(row.growthSuggestions).toEqual([]);
    });
  });

  describe('④ 字段缺失 → 仍是 parse_error (红线: 不编造)', () => {
    it('缺 dimensions → parse_error', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: '{"overallScore": 70}' },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      const row = await service.runReport(input());

      expect(row.status).toBe('parse_error');
    });

    it('annotations 空数组 → parse_error (标注至少要 1 条)', async () => {
      const captured: LlmStreamOptions[] = [];
      const saved: SupervisionReportRow[] = [];
      const service = new SupervisorService(
        stubLlm(
          [
            { type: 'content', content: JSON.stringify({ ...VALID_REPORT, annotations: [] }) },
            { type: 'done', usage: USAGE },
          ],
          captured,
        ),
        stubRepo(saved),
      );

      const row = await service.runReport(input());

      expect(row.status).toBe('parse_error');
    });
  });
});
