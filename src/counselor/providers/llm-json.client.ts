// V2026-10-21 治本 (V1.2 VS-A — counselor 结构化输出 LLM client):
//   原因: v1.2 有 6 个功能依赖 LLM 的**结构化 JSON 输出** (督导反馈 / 知情同意 4 要素判定 /
//     实时轻提示 classifier / techStats 统计 / 档案抽取 / 全量人设生成). 项目现有两套 LLM 栈
//     都不支持 provider 级 response_format (全仓 grep response_format|json_object|json_schema
//     只命中 1 处, 且是 src/agent/supervisor/supervisor.service.ts:192 的 parse_error
//     suggestion 文案里的一句建议, 不是任何待办标记), 唯一跑通的范式是
//     agent/supervisor/supervisor.service.ts:102-175 那套:
//     prompt 写死 schema → 收流累加 rawText → JSON.parse → 手写 shape 校验 → 失败不抛.
//     若每个功能各写一遍这套, 必然漂移 (剥 think 标签、截 ```json 围栏、错误码各写各的).
//   修法: 抽本 client 作为 counselor 端**唯一的结构化输出出口**:
//     - 统一收流 + 剥 <think> + 剥 ```json 围栏 + 取首个 {..} 块 + JSON.parse + 业务校验
//     - 统一错误码 (llm_error / json_not_found / json_parse_failed / schema_validation_failed)
//     - 统一返回结构 (ok / data / rawText / errorCode / errorMessage / usage), **不 throw**
//       (错误当数据返回, 调用方决定重试还是降级; 跟 LlmStreamChunk "错误作为数据" 风格一致)
//   反双胞胎:
//     - 不装 json-schema / zod 校验库: 大炮红线禁自动装依赖; 手写校验函数跟 supervisor 范式一致
//     - 不新增 LlmService.chatJson(): LlmService 保持 dumb 传输层, 结构化语义放业务层 client
//     - 不在 client 里吞异常: 失败必须让调用方看见 errorCode, 静默降级会拿假数据当督导结论
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 curl 生成督导反馈 → 返真 LLM 评分 (非 mock 的 70-85 伪随机)
//     3. 故意把 MINIMAX_COUNSELOR_LLM_MODEL 设成不存在的模型 → 返 errorCode=llm_error, 不 500 崩
//   时间戳: 2026-10-21

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LlmService } from '../../agent/llm/llm.service';
import type { LlmMessage, LlmReasoningEffort } from '../../agent/llm/llm.types';

import {
  COUNSELOR_LLM_DEFAULT_MODEL,
  COUNSELOR_LLM_MODEL_ENV_KEY,
  stripThinkingTags,
  supportsReasoningEffort,
} from '../config/counselor-llm.config';

/** 结构化输出请求入参. */
export interface CounselorLlmJsonRequest<T> {
  /** system prompt (角色 + 任务 + 输出契约). */
  readonly systemPrompt: string;
  /** user prompt (本次要分析的业务数据). */
  readonly userPrompt: string;
  /** 输出 JSON 的字段契约描述, 拼到 system prompt 尾部 (强约束模型只吐 JSON). */
  readonly schemaDescription: string;
  /** 业务校验: 合法返回反序列化后的对象, 非法返回 null. */
  readonly validate: (raw: unknown) => T | null;
  /** 生成长度上限 (thinking token 也计入, 调用方要留够余量). */
  readonly maxCompletionTokens: number;
  /** 思考深度 (仅 M3.1-Flash 生效, 其他模型自动不下发). */
  readonly reasoningEffort?: LlmReasoningEffort;
  /** 单次请求超时 (ms). */
  readonly timeoutMs: number;
  /** 必传, 强 tenant 隔离. */
  readonly tenantId: string;
  /** 必传, 计费 + 审计. */
  readonly userId: string;
  /** 外部 trace id, 关联到日志. */
  readonly traceId?: string;
}

/** token 用量. */
export interface CounselorLlmJsonUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** 结构化输出结果 (错误当数据, 不 throw). */
export interface CounselorLlmJsonResult<T> {
  readonly ok: boolean;
  readonly data: T | null;
  /** 原始响应文本 (失败时也保留, 便于事后排查 / 人工修数据). */
  readonly rawText: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly usage: CounselorLlmJsonUsage | null;
}

/**
 * 从原始响应里抠出 JSON 对象文本.
 *
 * 依次处理 3 种脏数据:
 *   1. ```json ... ``` 围栏 (模型爱加)
 *   2. 前后废话说明 ("以下是督导报告: {...}")
 *   3. M3 系列内联的 <think>...</think> 思考块
 */
export function extractJsonPayload(raw: string): string | null {
  const cleaned = stripThinkingTags(raw)
    .replaceAll(/```json/gi, '')
    .replaceAll('```', '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return cleaned.slice(start, end + 1);
}

/**
 * counselor 端结构化输出 LLM client.
 *
 * 唯一职责: 把 "prompt + schema" 变成 "已校验的结构化对象", 或一个带 errorCode 的失败结果.
 * 具体业务语义 (督导 / 判定 / 抽取) 由调用方的 validate 回调承担.
 */
@Injectable()
export class CounselorLlmJsonClient {
  private readonly logger = new Logger(CounselorLlmJsonClient.name);

  constructor(
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 发一次结构化输出请求.
   *
   * @returns 成功时 ok=true 且 data 非 null; 失败时 ok=false 且带 errorCode / rawText.
   *   **本方法不抛异常** (除调用方传入的 validate 自己抛错外).
   */
  async requestJson<T>(input: CounselorLlmJsonRequest<T>): Promise<CounselorLlmJsonResult<T>> {
    const model = this.resolveModel();
    const messages: readonly LlmMessage[] = [
      {
        role: 'system',
        content: `${input.systemPrompt}\n\n${input.schemaDescription}\n\n只输出一个 JSON 对象, 不要输出任何额外说明文字或 markdown 代码块.`,
      },
      { role: 'user', content: input.userPrompt },
    ];

    let rawText = '';
    let usage: CounselorLlmJsonUsage | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    for await (const chunk of this.llm.streamChat(messages, {
      model,
      tenantId: input.tenantId,
      userId: input.userId,
      traceId: input.traceId,
      maxCompletionTokens: input.maxCompletionTokens,
      timeoutMs: input.timeoutMs,
      // reasoning_effort 仅 M3.1-Flash 生效 → 非 M3.1 模型不下发, 避免上游 400.
      ...(supportsReasoningEffort(model) && input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    })) {
      if (chunk.type === 'content') {
        rawText += chunk.content;
        continue;
      }
      if (chunk.type === 'done') {
        usage = {
          promptTokens: chunk.usage.promptTokens,
          completionTokens: chunk.usage.completionTokens,
          totalTokens: chunk.usage.totalTokens,
        };
        continue;
      }
      errorCode = chunk.error.code;
      errorMessage = chunk.error.message;
      break;
    }

    if (errorCode !== null) {
      this.logger.error(
        `[llm_error] model=${model} code=${errorCode} tenant=${input.tenantId} ` +
          `user=${input.userId} msg=${(errorMessage ?? '').slice(0, 200)}`,
      );
      return { ok: false, data: null, rawText, errorCode, errorMessage, usage };
    }

    const payload = extractJsonPayload(rawText);
    if (payload === null) {
      this.logger.error(`[json_not_found] model=${model} tenant=${input.tenantId} user=${input.userId} ` + `raw=${rawText.slice(0, 200)}`);
      return {
        ok: false,
        data: null,
        rawText,
        errorCode: 'json_not_found',
        errorMessage: 'LLM 响应中未找到 JSON 对象',
        usage,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch (err) {
      this.logger.error(
        `[json_parse_failed] model=${model} tenant=${input.tenantId} user=${input.userId} ` +
          `err=${err instanceof Error ? err.message : String(err)} raw=${payload.slice(0, 200)}`,
      );
      return {
        ok: false,
        data: null,
        rawText,
        errorCode: 'json_parse_failed',
        errorMessage: err instanceof Error ? err.message : 'JSON.parse 失败',
        usage,
      };
    }

    const data = input.validate(parsed);
    if (data === null) {
      this.logger.error(
        `[schema_validation_failed] model=${model} tenant=${input.tenantId} user=${input.userId} ` + `raw=${payload.slice(0, 200)}`,
      );
      return {
        ok: false,
        data: null,
        rawText,
        errorCode: 'schema_validation_failed',
        errorMessage: 'LLM 输出未通过业务字段校验',
        usage,
      };
    }

    this.logger.log(
      `[llm_json_ok] model=${model} tenant=${input.tenantId} user=${input.userId} ` +
        `prompt_tokens=${usage?.promptTokens ?? 0} completion_tokens=${usage?.completionTokens ?? 0}`,
    );
    return { ok: true, data, rawText, errorCode: null, errorMessage: null, usage };
  }

  /**
   * 解析生效模型.
   * env MINIMAX_COUNSELOR_LLM_MODEL 优先 (未配则用 COUNSELOR_LLM_DEFAULT_MODEL = MiniMax-M3.1-Flash).
   */
  private resolveModel(): string {
    return this.config.get<string>(COUNSELOR_LLM_MODEL_ENV_KEY) ?? COUNSELOR_LLM_DEFAULT_MODEL;
  }
}
