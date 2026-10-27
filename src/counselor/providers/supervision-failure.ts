// V2026-10-26 治本 (督导失败分类 — 永久性 vs 可重试, spec 任务 C):
//   原因: 4 流派反馈是**异步** BullMQ job, 失败默认按 `attempts: 3` 指数退避重试.
//     但有一类失败是**重试也不会变好**的:
//       · 流派缺种子 (supervision_schools 表空 / 该 code 未播种) → 重试 3 次还是找不到
//       · 会话不存在 / 不属于该用户 → 重试 3 次还是不存在
//       · 会话没有对话记录 (空 transcript) → 重试 3 次还是空的
//     这类失败重试的代价是: 刷 3 遍错误日志 + 拖 3 次退避 (秒级~十秒级) + 队列里堆失败 job.
//     而"流派缺种子"是**本轮真实发生过**的 (表建了没播种) —— 它把日志刷成了噪音,
//     反而让真正的故障更难被发现.
//   修法: 把失败分成两类:
//     - **永久性** (重试无意义) → 记一条 warn, 优雅结束 job (该流派反馈留空)
//     - **瞬时性** (重试有意义, 如 LLM 上游不可用 / 网络抖动) → 照旧抛出去, 交给 BullMQ 退避重试
//   反双胞胎:
//     - 不把**所有**异常都吞掉: LLM 上游不可用正是重试最有价值的场景, 吞掉就等于放弃可用性
//     - 不用 error 级别记永久性失败: 它不是故障, 是"这一份流派反馈没有" —— warn 即可
//     - 不在 processor 里散落 if 判断: 分类口径集中在这一个纯函数, 可单测 (retriable 判错
//       的代价是"该重试的不重试"或"不该重试的刷日志")
//   验证:
//     1. tsc 0 错
//     2. 流派缺种子 → 1 条 warn, job completed, 无重试
//     3. LLM 上游不可用 → 仍抛出去, BullMQ 重试 3 次
//   时间戳: 2026-10-26
//
// ─────────────────────────────────────────────────────────────────────────────
// V2026-10-27 治本 (第二轮 — 失败原因码 + 终态落库, spec 任务 D):
//   原因: 上一轮只分了"永久 / 可重试"两档, 但**没有把失败落到任何记录里** ——
//     BullMQ 重试 3 次用尽后 job 直接失败, 库里一行不留, 列表只能靠墙钟猜
//     (15 分钟兜底) 才能从"生成中"翻成"生成失败". 学员盯着转圈转 15 分钟.
//     而且"该重试的重试完了 / 不该重试的压根不该重试"这两种失败对前端**长得一模一样**,
//     前端没法决定要不要给"重试"按钮.
//   修法:
//     - 失败携带**原因码** (SupervisionFailureCode): 上游不可用 / 限流 / 解析失败 / 超时 /
//       素材不足 / 流派缺种子, 每个码自带"可重试"语义
//     - 异常类型保留 HTTP 语义 (400 / 404 / 503), 不让 controller 的既有行为漂移
//     - 分类口径集中在本文件的纯函数 `classifySupervisionFailure`, processor 只做编排
//   反双胞胎:
//     - 不用一个通用 Error 装所有失败: 那会丢掉"素材不足 = 400 / 上游挂了 = 503"的 HTTP 语义
//     - 不把失败原因塞进 message 字符串再正则解析: 字符串不是契约, 改文案就断链
//   验证: npx jest test/counselor/supervision-failure.spec.ts 全绿
//   时间戳: 2026-10-27 13:45 GMT+8

import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { SupervisionFailureCode } from '../enums/supervision-failure-code.enum';

/**
 * 素材不足 (空局) — 400, **不可重试**.
 *
 * 400 而不是 503: 这是**调用方数据**的问题 (这场会谈压根没有可分析的素材),
 * 重试多少次都是空; 客户端拿到 400 应该提示"这场没有足够的对话内容", 而不是重试.
 */
export class SupervisionEmptyMaterialException extends BadRequestException {
  /** 失败原因码 (落库 + 出参). */
  readonly failureCode: SupervisionFailureCode = SupervisionFailureCode.EMPTY_MATERIAL;

  /**
   * @param message 人类可读原因
   */
  constructor(message: string) {
    super(message);
  }
}

/**
 * 流派缺种子 — 404, **不可重试**.
 *
 * 404 而不是 503: 流派没播种是**部署 / 运营**问题 (数据缺失), 不是上游临时故障,
 * 退避重试只会把同一份缺失重复 3 遍.
 */
export class SupervisionSchoolMissingException extends NotFoundException {
  /** 失败原因码 (落库 + 出参). */
  readonly failureCode: SupervisionFailureCode = SupervisionFailureCode.SCHOOL_MISSING;

  /**
   * @param message 人类可读原因
   */
  constructor(message: string) {
    super(message);
  }
}

/**
 * 上游故障 (不可用 / 限流 / 解析失败 / 超时) — 503, **可重试**.
 *
 * 统一 503: 这几种对客户端是同一件事 ("服务端暂时出不来, 稍后重试"),
 * 具体是哪一种由 `failureCode` 承载 (落库 + 出参), 不靠 HTTP 状态码细分 ——
 * HTTP 状态码表达的是传输层语义, 前端要的是**业务语义** (能不能重试).
 */
export class SupervisionUpstreamException extends ServiceUnavailableException {
  /** 失败原因码 (落库 + 出参). */
  readonly failureCode: SupervisionFailureCode;

  /**
   * @param failureCode 失败原因码
   * @param message 人类可读原因
   */
  constructor(failureCode: SupervisionFailureCode, message: string) {
    super(message);
    this.failureCode = failureCode;
  }
}

/**
 * 失败分类结果.
 */
export interface SupervisionFailureClassification {
  /** 失败原因码. */
  readonly failureCode: SupervisionFailureCode;
  /** 是否永久性 (true = 重试无意义). */
  readonly permanent: boolean;
}

/**
 * LLM client 的 errorCode → 督导失败原因码.
 *
 * LLM client (llm-json.client.ts) 的 errorCode 词表:
 *   - 上游 chunk 错误: `http_401` / `http_429` / `http_500` / `no_body` / `parse_error` / `fetch_error`
 *   - client 自身:     `llm_error` / `json_not_found` / `json_parse_failed` / `schema_validation_failed`
 *
 * 映射口径:
 *   - 429            → rate_limited (退避后重试有意义)
 *   - 超时相关        → timeout
 *   - JSON / schema  → parse_failed (换个采样可能成, 仍算可重试)
 *   - 其余 (5xx / 连接失败 / 空响应 / 未知) → upstream_unavailable
 *
 * @param errorCode LLM client 的错误码 (可空)
 * @returns 督导失败原因码
 */
export function mapLlmErrorCodeToFailureCode(errorCode: string | null | undefined): SupervisionFailureCode {
  const code = (errorCode ?? '').trim().toLowerCase();
  if (code.length === 0) {
    return SupervisionFailureCode.UPSTREAM_UNAVAILABLE;
  }
  if (code === 'http_429' || code === 'rate_limited' || code.includes('429')) {
    return SupervisionFailureCode.RATE_LIMITED;
  }
  if (code.includes('timeout') || code.includes('timed_out')) {
    return SupervisionFailureCode.TIMEOUT;
  }
  if (code === 'json_not_found' || code === 'json_parse_failed' || code === 'schema_validation_failed' || code === 'parse_error') {
    return SupervisionFailureCode.PARSE_FAILED;
  }
  return SupervisionFailureCode.UPSTREAM_UNAVAILABLE;
}

/**
 * 是否是本仓的督导失败异常 (携带 failureCode).
 *
 * @param err 捕获到的异常
 * @returns true = 携带失败原因码
 */
function hasFailureCode(err: unknown): err is { readonly failureCode: SupervisionFailureCode } {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { readonly failureCode?: unknown }).failureCode;
  return typeof code === 'string' && Object.values(SupervisionFailureCode).includes(code as SupervisionFailureCode);
}

/**
 * 失败分类 (纯函数, 可单测).
 *
 * 判据优先级:
 *   1. 异常自带 failureCode → 直接采信 (最具体)
 *   2. NotFoundException     → school_missing (永久)
 *   3. BadRequestException   → empty_material (永久)
 *   4. ServiceUnavailable / 其它 → upstream_unavailable (可重试)
 *
 * 未知异常一律按**可重试**处理: 未知多半是偶发故障, 吞掉就等于放弃可用性;
 * 反过来, 把已知永久性失败误判成可重试, 代价只是多刷两条日志.
 *
 * @param err 捕获到的异常
 * @returns 失败分类
 */
export function classifySupervisionFailure(err: unknown): SupervisionFailureClassification {
  if (hasFailureCode(err)) {
    const failureCode = err.failureCode;
    return {
      failureCode,
      permanent: failureCode === SupervisionFailureCode.EMPTY_MATERIAL || failureCode === SupervisionFailureCode.SCHOOL_MISSING,
    };
  }
  if (err instanceof NotFoundException) {
    return { failureCode: SupervisionFailureCode.SCHOOL_MISSING, permanent: true };
  }
  if (err instanceof BadRequestException) {
    return { failureCode: SupervisionFailureCode.EMPTY_MATERIAL, permanent: true };
  }
  return { failureCode: SupervisionFailureCode.UPSTREAM_UNAVAILABLE, permanent: false };
}

/**
 * 判断督导反馈失败是不是**永久性**的 (重试也不会变好).
 *
 * 永久性的两种 (与 `SupervisionService.generateFeedback` 的抛错点 1:1):
 * - `NotFoundException`   流派缺种子 / 会话不存在
 * - `BadRequestException` 素材不足 / 参数不合法
 *
 * **不包括** `ServiceUnavailableException` (LLM 上游不可用) —— 那是瞬时故障, 重试有意义.
 *
 * @param err 捕获到的异常
 * @returns true = 永久性失败 (不该重试)
 */
export function isPermanentSupervisionFailure(err: unknown): boolean {
  return classifySupervisionFailure(err).permanent;
}
