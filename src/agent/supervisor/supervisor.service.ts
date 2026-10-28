// V2026-10-09 治本 (Supervisor Agent 服务 — SPEC §11.2):
//   职责: 编排 transcript → supervisor prompt → LLM 流消费 → JSON 解析 → 校验 → 写库
//   调用方: VoiceService.endSession 触发 BullMQ worker → SupervisorService.runReport
//   关键设计:
//     - runReport 是 Promise 方法 (跟 Visitor 异步生成器不同), 一次输入一次输出
//     - 内部消费 LlmService.streamChat, 拼接 rawText, 然后 JSON.parse 解析
//     - 解析失败 / schema 校验失败 → 写 status='parse_error' 占位行, 不抛异常
//     - 写库异常 → log error, 仍返回 report (不抛, 防 BullMQ 重试死循环)
//     - temperature=0.3 (督导报告要客观, 比 Visitor 0.7 保守)
//
//   反双胞胎:
//     - 不用 class 包装 LlmMessage — interface + readonly, 跟 Visitor 风格一致
//     - 不缓存 transcript — 督导报告生成完即终态, 不复用
//     - 不接 RAG — V0.x 跳过, prompt 留空 ragContext, V1.x 加 ragContext 实参
//     - 不接 errorPatterns 写回 RAG — V0.x 留占位说明, V1.x 任务
//     - 不做并发控制 — BullMQ worker 串行消费, service 不需锁
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 正常 transcript → status=completed, 6 维度 0-100, annotations 非空
//     3. LLM 输出非 JSON → status=parse_error, rawResponse 存原文
//     4. 缺字段 → status=parse_error, rawResponse 存原文
//     5. 写库异常 → log error, runReport 仍 resolve 不抛
//     6. 0 轮对话 → status=completed (空 transcript 也能生成, 维度=0)

import { Inject, Injectable, Logger } from '@nestjs/common';

import { renderSystemPrompt } from './supervisor.prompts';
import type {
  RunReportInput,
  RunReportResult,
  SupervisionAnnotation,
  SupervisionDimensions,
  SupervisionReportRow,
} from './supervisor.types';
import { LlmService } from '../llm/llm.service';
import type { LlmError, LlmMessage } from '../llm/llm.types';
import { SUPERVISION_REPORT_REPOSITORY, type SupervisionReportRepository } from './domain/repositories/supervision-report.repository';

/** LLM 采样温度 — 督导报告要客观, 比 Visitor 0.7 保守. */
const SUPERVISOR_TEMPERATURE = 0.3;
/** LLM 输出上限 — 督导报告结构 + 标注列表, 2500 足够. */
const SUPERVISOR_MAX_TOKENS = 2500;
/** rawResponse 字段落库截断上限 — 防异常大响应撑爆内存. */
const RAW_RESPONSE_TRUNCATE = 10_000;
/** 六维分数合法区间. */
const SCORE_MIN = 0;
const SCORE_MAX = 100;

@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(
    private readonly llm: LlmService,
    @Inject(SUPERVISION_REPORT_REPOSITORY) private readonly repos: SupervisionReportRepository,
  ) {}

  /**
   * 生成督导报告 — 一次输入一次输出.
   * @param input 完整 transcript + persona snapshot + 情绪时序
   * @returns 督导报告行 (含 status / rawResponse / createdAt), 业务消费方 (BullMQ worker) 拿这个就够
   * @throws 理论上不抛 — 解析失败/写库异常都被兜底转成 status=parse_error 行
   */
  async runReport(input: RunReportInput): Promise<RunReportResult> {
    const startMs = Date.now();

    // 1. 拼 LlmMessage[] (system + 单 user 含 transcript 摘要 — V0.x 不做多轮, 督导单次)
    const messages = this.buildLlmMessages(input);

    // 2. 调 LLM, 消费 stream 拼 rawText
    const { rawText, error: llmError, usage } = await this.collectStream(messages, input);

    // 3. 解析 + 校验
    const row = llmError ? makeParseErrorRow(input, rawText, `llm_error: ${llmError.code}`) : this.parseAndValidate(input, rawText);

    // 4. 写库 (异常也吞, log error, 不让 BullMQ 重试死循环)
    let saved: SupervisionReportRow;
    try {
      saved = await this.repos.save(row);
    } catch (err) {
      this.logger.error(
        `[save_failed] session=${row.sessionId} status=${row.status} ` + `err=${err instanceof Error ? err.message : String(err)}`,
      );
      // V2026-10-09 治本: 写库失败仍返回 row, 让 BullMQ worker 拿 status 决定后续 (V1.x 加重试告警)
      saved = row;
    }

    const totalMs = Date.now() - startMs;
    this.logger.log(
      `[runReport] session=${input.sessionId} status=${saved.status} ` +
        `score=${saved.overallScore} annotations=${saved.annotations.length} ` +
        `total_ms=${totalMs} ` +
        `llm_prompt_tokens=${usage?.promptTokens ?? 0} ` +
        `llm_completion_tokens=${usage?.completionTokens ?? 0}`,
    );
    return saved;
  }

  // ── private ────────────────────────────────────────────────────

  private buildLlmMessages(input: RunReportInput): readonly LlmMessage[] {
    const systemPrompt = renderSystemPrompt(input);
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: '请基于上述训练 transcript 生成结构化督导报告. ' + '严格输出 JSON, 不要任何额外说明文字.',
      },
    ];
  }

  /**
   * 消费 LlmService.streamChat, 拼接 rawText + 提取 usage + 错误.
   * 监督报告一次输出, 不分多轮, 直接累加 content chunk.
   */
  private async collectStream(
    messages: readonly LlmMessage[],
    input: RunReportInput,
  ): Promise<{
    readonly rawText: string;
    readonly error: LlmError | null;
    readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number } | null;
  }> {
    let rawText = '';
    let usage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number } | null = null;

    for await (const chunk of this.llm.streamChat(messages, {
      tenantId: input.tenantId,
      userId: input.userId,
      traceId: input.traceId,
      temperature: SUPERVISOR_TEMPERATURE,
      maxTokens: SUPERVISOR_MAX_TOKENS,
    })) {
      // V2026-10-09 治本: switch + continue 避免 if/else if 链, error chunk 显式 return 跳出函数
      switch (chunk.type) {
        case 'content':
          rawText += chunk.content;
          continue;
        case 'error':
          return { rawText, error: chunk.error, usage };
        case 'done':
          usage = chunk.usage;
          continue;
      }
    }
    return { rawText, error: null, usage };
  }

  /**
   * JSON.parse + 字段校验. 失败 → 返回 status=parse_error 占位行.
   * 校验范围 (V0.x 强约束):
   *   - overallScore: number, 0-100 整数
   *   - dimensions: 6 维, 每维 number 0-100
   *   - annotations: array, 至少 1 元素, 每元素含 timestamp/number, type/good|warn|error, category/string, message/string
   *   - errorPatterns / growthSuggestions: array of string
   */
  private parseAndValidate(input: RunReportInput, rawText: string): SupervisionReportRow {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
      return makeParseErrorRow(input, rawText, `json_parse_failed: ${reason}`);
    }
    if (!parsed || typeof parsed !== 'object') {
      return makeParseErrorRow(input, rawText, 'json_not_object');
    }
    const candidate = parsed as Record<string, unknown>;
    const validation = validateReportShape(candidate);
    if (!validation.ok) {
      return makeParseErrorRow(input, rawText, validation.error);
    }
    return makeCompletedRow(input, rawText, candidate);
  }
}

// ── 工厂 + 校验函数 ─────────────────────────────────────────────

/** 构造 status=parse_error 的占位行. */
function makeParseErrorRow(input: RunReportInput, rawText: string, reason: string): SupervisionReportRow {
  return {
    sessionId: input.sessionId,
    overallScore: 0,
    dimensions: zeroDimensions(),
    annotations: [
      {
        timestamp: Date.now(),
        type: 'error',
        category: 'parse_error',
        message: `督导报告解析失败: ${reason}`,
        suggestion: '查看 rawResponse 字段, V1.x 强化 schema 约束 (response_format)',
      },
    ],
    errorPatterns: [],
    growthSuggestions: [],
    status: 'parse_error',
    tenantId: input.tenantId,
    userId: input.userId,
    personaId: input.persona.id,
    personaName: input.persona.name,
    difficulty: input.persona.difficulty,
    rawResponse: rawText.slice(0, RAW_RESPONSE_TRUNCATE),
    createdAt: Date.now(),
  };
}

/** 构造 status=completed 的标准行. */
function makeCompletedRow(input: RunReportInput, rawText: string, candidate: Record<string, unknown>): SupervisionReportRow {
  // V2026-10-09 治本: Record<string, unknown> 走 bracket access 才能通过 noPropertyAccessFromIndexSignature
  return {
    sessionId: input.sessionId,
    overallScore: candidate['overallScore'] as number,
    dimensions: candidate['dimensions'] as SupervisionDimensions,
    annotations: candidate['annotations'] as readonly SupervisionAnnotation[],
    errorPatterns: asStringArray(candidate['errorPatterns']),
    growthSuggestions: asStringArray(candidate['growthSuggestions']),
    status: 'completed',
    tenantId: input.tenantId,
    userId: input.userId,
    personaId: input.persona.id,
    personaName: input.persona.name,
    difficulty: input.persona.difficulty,
    rawResponse: rawText.slice(0, RAW_RESPONSE_TRUNCATE),
    createdAt: Date.now(),
  };
}

/** 全 0 维度占位. */
function zeroDimensions(): SupervisionDimensions {
  return {
    empathy: 0,
    activeListening: 0,
    questioning: 0,
    boundary: 0,
    response: 0,
    professionalism: 0,
  };
}

/** 容错: 字段不是 string[] 时降级为 []. */
function asStringArray(field: unknown): readonly string[] {
  if (!Array.isArray(field)) return [];
  return field.filter((x): x is string => typeof x === 'string');
}

/**
 * 字段 shape 校验 — 拆 4 个 check 函数 ?? 链串联, 避免单函数 complexity 爆表.
 * 严格: 6 维 0-100 整数, overallScore 0-100, annotations 数组必填.
 * @returns ok=true 时 candidate 已通过校验, false 时带 error 描述
 */
function validateReportShape(candidate: Record<string, unknown>): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const err = checkOverallScore(candidate) ?? checkDimensions(candidate) ?? checkAnnotations(candidate) ?? checkOptionalArrays(candidate);
  return err ?? { ok: true };
}

function checkOverallScore(candidate: Record<string, unknown>): { readonly ok: false; readonly error: string } | null {
  const overall = candidate['overallScore'];
  if (typeof overall !== 'number' || !Number.isInteger(overall) || overall < SCORE_MIN || overall > SCORE_MAX) {
    return { ok: false, error: `overallScore not in [${SCORE_MIN},${SCORE_MAX}] integer: ${String(overall)}` };
  }
  return null;
}

function checkDimensions(candidate: Record<string, unknown>): { readonly ok: false; readonly error: string } | null {
  const dims = candidate['dimensions'];
  if (!dims || typeof dims !== 'object') {
    return { ok: false, error: 'dimensions missing or not object' };
  }
  const dimsObj = dims as Record<string, unknown>;
  const dimKeys: readonly (keyof SupervisionDimensions)[] = [
    'empathy',
    'activeListening',
    'questioning',
    'boundary',
    'response',
    'professionalism',
  ];
  for (const key of dimKeys) {
    const v = dimsObj[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < SCORE_MIN || v > SCORE_MAX) {
      return { ok: false, error: `dimension.${key} not in [${SCORE_MIN},${SCORE_MAX}] integer: ${String(v)}` };
    }
  }
  return null;
}

function checkAnnotations(candidate: Record<string, unknown>): { readonly ok: false; readonly error: string } | null {
  const annotations = candidate['annotations'];
  if (!Array.isArray(annotations) || annotations.length < 1) {
    return { ok: false, error: 'annotations must be non-empty array' };
  }
  for (let i = 0; i < annotations.length; i += 1) {
    const err = checkOneAnnotation(annotations[i], i);
    if (err) return err;
  }
  return null;
}

function checkOneAnnotation(a: unknown, i: number): { readonly ok: false; readonly error: string } | null {
  if (!a || typeof a !== 'object') {
    return { ok: false, error: `annotations[${i}] not object` };
  }
  const obj = a as Record<string, unknown>;
  const ts = obj['timestamp'];
  if (typeof ts !== 'number' || ts < 0 || !Number.isFinite(ts)) {
    return { ok: false, error: `annotations[${i}].timestamp not non-negative number: ${String(ts)}` };
  }
  const type = obj['type'];
  if (type !== 'good' && type !== 'warn' && type !== 'error') {
    return { ok: false, error: `annotations[${i}].type not good|warn|error: ${String(type)}` };
  }
  const category = obj['category'];
  if (typeof category !== 'string' || category.length === 0) {
    return { ok: false, error: `annotations[${i}].category empty or not string` };
  }
  const message = obj['message'];
  if (typeof message !== 'string' || message.length === 0) {
    return { ok: false, error: `annotations[${i}].message empty or not string` };
  }
  const suggestion = obj['suggestion'];
  if (suggestion !== undefined && typeof suggestion !== 'string') {
    return { ok: false, error: `annotations[${i}].suggestion not string when present` };
  }
  return null;
}

function checkOptionalArrays(candidate: Record<string, unknown>): { readonly ok: false; readonly error: string } | null {
  const errorPatterns = candidate['errorPatterns'];
  if (errorPatterns !== undefined && !Array.isArray(errorPatterns)) {
    return { ok: false, error: 'errorPatterns not array when present' };
  }
  const growthSuggestions = candidate['growthSuggestions'];
  if (growthSuggestions !== undefined && !Array.isArray(growthSuggestions)) {
    return { ok: false, error: 'growthSuggestions not array when present' };
  }
  return null;
}
