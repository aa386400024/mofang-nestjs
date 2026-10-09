// V2026-10-09 治本 (Supervisor 子模块类型 — SPEC §11.2):
//   范围: 督导报告主输出 (SupervisionReport) + runReport 入参 + report 状态机
//   复用: Persona snapshot 走 visitor 模块的 VisitorPersonaSnapshot 形状, 不重复定义
//
//   反双胞胎:
//     - 不内嵌 persona 完整字段 — 督导报告只需要名字/难度/difficulty 展示, V1.x 接 DB 关联
//     - 不存"原始 transcript"在本类型 — 那是 VisitorService / V1.x SessionMemory 的事
//     - status 走 enum 字面量 (Completed/ParseError) 而非 string — 强制 type 收窄
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. SupervisionReport 字段跟 SPEC §11.2 1:1 对齐
//     3. SupervisorReportStatus 枚举值写库时落 supervision_reports.status 字符串
//     4. parseErrorPlaceholder 工厂函数返回 status=parse_error 的占位报告

import type { LlmStream, LlmStreamChunk } from '../llm/llm.types';
import type { VisitorPersonaSnapshot } from '../visitor/visitor.types';

/** 报告状态机 — V0.x 两态, V1.x 扩 retry/timeout. */
export type SupervisorReportStatus = 'completed' | 'parse_error';

/** 督导报告标注类型. */
export type SupervisionAnnotationType = 'good' | 'warn' | 'error';

/** 单条标注 — 对应 transcript 一个时间戳点. */
export interface SupervisionAnnotation {
  readonly timestamp: number;
  readonly type: SupervisionAnnotationType;
  readonly category: string;
  readonly message: string;
  readonly suggestion?: string;
}

/** 评分维度 — SPEC §11.2 六维固定. */
export interface SupervisionDimensions {
  readonly empathy: number;
  readonly activeListening: number;
  readonly questioning: number;
  readonly boundary: number;
  readonly response: number;
  readonly professionalism: number;
}

/** 督导报告主输出. SPEC §11.2 1:1. */
export interface SupervisionReport {
  readonly sessionId: string;
  readonly overallScore: number;
  readonly dimensions: SupervisionDimensions;
  readonly annotations: readonly SupervisionAnnotation[];
  readonly errorPatterns: readonly string[];
  readonly growthSuggestions: readonly string[];
}

/** 督导报告持久化行 (entity shape, V0.x 内存 mock 字段一致). */
export interface SupervisionReportRow extends SupervisionReport {
  readonly status: SupervisorReportStatus;
  readonly tenantId: string;
  readonly userId: string;
  /** persona snapshot id, 督导报告写库时锁定. */
  readonly personaId: string;
  /** persona snapshot 名字, 展示用, 跟 personaId 冗余防 V1.x persona 重命名. */
  readonly personaName: string;
  /** persona 难度, 展示用. */
  readonly difficulty: string;
  /** LLM 原始 JSON 文本, parse 失败时存原文便于 V1.x debug + re-parse. */
  readonly rawResponse: string;
  readonly createdAt: number;
}

/** 情绪时序点 — V0.x 留空数组, V1.x 接 ASR 情绪识别. */
export interface EmotionTimelinePoint {
  readonly timestamp: number;
  readonly emotion: string;
}

/** runReport 入参. */
export interface RunReportInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  /** persona snapshot — openSession 阶段锁定, 整个督导报告生命周期不变. */
  readonly persona: VisitorPersonaSnapshot;
  /** 完整 transcript, 顺序 userText / assistantText 交替. */
  readonly transcript: readonly TranscriptTurn[];
  /** 情绪时序 — V0.x 永远空数组, V1.x 接 ASR 情绪模型. */
  readonly emotionTimeline: readonly EmotionTimelinePoint[];
  /** 链路 trace id, 透传给 LlmService. */
  readonly traceId?: string;
}

/** 单轮 transcript. role 由数组顺序隐含, 这里只存文本 + 时戳. */
export interface TranscriptTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly at: number;
}

/** runReport 返回. 跟 supervision_reports 表行一致, 业务消费方 (BullMQ worker) 拿到这个就能写日志. */
export type RunReportResult = SupervisionReportRow;

/** 内部流包装结果 — VoiceService 不消费, 仅供单元测试. */
export interface RunReportStream {
  readonly stream: LlmStream;
  /** 完成时 resolve, 含最终行 (含 status 字段). */
  readonly result: Promise<RunReportResult>;
}

/** 内部 re-export, 方便消费方不用 import 两个文件. */
export type { LlmStream, LlmStreamChunk };
