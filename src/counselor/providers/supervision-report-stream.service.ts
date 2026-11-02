// V2026-10-29 治本 (WP21 — 报告生成 SSE 推送 service):
//   原因: 报告是**异步**生成的 (BullMQ + LLM, 实测主报告 ~32s, 4 流派反馈更久).
//     前端此前用固定 3s 轮询等报告, 30s 窗口刚好卡在边界 —— 轻则白等一轮, 重则页面
//     在报告刚生成时又退回"生成中", 用户反复刷新.
//     改成 SSE: 服务端在报告到达终态时**主动推一条**, 推完即关流, 不再靠前端反复问.
//
//   修法: 新增本 service, 负责"等报告 → 推一条 → 关流"这条时间线:
//     1. 装载一次报告事实集 (归属校验在此, 跨用户/不存在 → NotFoundException → HTTP 404)
//     2. 已终态 (completed / parse_error / no_content) → 立即推一份完整报告并关流
//     3. pending → 每 2s 轮询一次, **每轮重新装载 + 重新派生** (与 GET 端点同一份实现);
//        到终态即推完整报告; 超过 120s → 推 `{"status":"timeout"}` 并关流
//
//   反双胞胎:
//     - 不用手写 setInterval + req.on('close'): RxJS 的 `timer` 在**取消订阅**时自动停,
//       而 Nest 的 SSE 通道在客户端断开时会取消订阅 —— 天然不泄漏, 不用自己记 timer.
//       (手写那套的经典 bug: 客户端在两次轮询之间断开, clearInterval 没跑到, 定时器
//        永远挂着 —— 每次打开报告页漏一个, 进程跑一天就是几十万个僵尸定时器)
//     - 不在推送端点里重写一份报告拼装: 装载与拼装都走 `SupervisionService` 的
//       `loadReportContext` / `buildReportDto`, 与 GET 端点**逐字段一致** ——
//       否则用户会看到"轮询出来的报告"和"推送收到的报告"两份不一样的东西
//     - **轮询的判据也不另立一套**: 第一版用"探针"(只看报告行落库了没)省查询,
//       真机实测发现它漏掉「空局 no_content」「墙钟兜底 parse_error」两类
//       **不由报告行决定**的终态 —— 空局会话会干等 120s 才推 timeout, 而不是
//       立即推终态 (违反任务单 §4.3). 终态判定只能有**一个口径** → 每轮重新派生.
//     - 不把"超时"混进报告四态: 超时是**通道**的状态, 报告本身没有超时态 (见
//       domain/session-core/report-stream.ts)
//     - 不在 service 里读墙钟做状态判定: 判定收在 domain 纯函数, 时钟由本 service 传入
//
//   验证:
//     1. tsc 0 错
//     2. 单测: 终态立即推 / pending 轮询命中 / 空局类终态也能推到 / 超时推 timeout /
//        取消订阅后不再装载 / 轮询期 DB 抖动不打断流
//     3. 真机: curl -N 观察 `data: {...}` 帧与流关闭; 404 / 首帧延迟 / GET-SSE 载荷一致
//
//   时间戳: 2026-10-29

import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, from, of, timer } from 'rxjs';
import { concatMap, filter, map, take } from 'rxjs/operators';

import { SupervisionService } from './supervision.service';
import { SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS, SUPERVISION_REPORT_STREAM_TIMEOUT_MS } from '../config/supervision.config';
import {
  buildReportStreamTimeoutPayload,
  decideReportStreamAction,
  type ReportStreamTimeoutPayload,
} from '../domain/session-core/report-stream';
import { type SessionReportDto } from '../dto/supervision.dto';

/**
 * 一轮轮询的结果.
 *
 * `keep_waiting` = 继续等 (不推任何东西); 另外两种 = 本轮就该推出去并关流.
 */
type ReportStreamTick =
  | { readonly action: 'keep_waiting' }
  | { readonly action: 'emit_report'; readonly payload: SessionReportDto }
  | { readonly action: 'emit_timeout'; readonly payload: ReportStreamTimeoutPayload };

/** 会推出去的那两种结果 (`keep_waiting` 在管道里被滤掉). */
type ReportStreamEmitTick = Extract<ReportStreamTick, { readonly action: 'emit_report' | 'emit_timeout' }>;

/**
 * V2026-10-29 (WP21 — 报告 SSE 推送):
 *   等报告 → 推一条 → 关流. 决策表在 domain/session-core/report-stream.ts.
 */
@Injectable()
export class SupervisionReportStreamService {
  private readonly logger = new Logger(SupervisionReportStreamService.name);

  constructor(
    private readonly supervision: SupervisionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 订阅本场会谈的复盘报告推送流.
   *
   * 生命周期:
   *   - 会话不存在 / 不属于当前用户 → 抛 `NotFoundException`
   *   - 报告已终态 → 推一条完整报告, 流随即关闭
   *   - 报告 pending → 每 2s 轮询, 到终态推报告 / 到 120s 推 timeout, 两者都关流
   *   - 客户端断开 → 订阅被取消, 轮询定时器随之停止 (不泄漏)
   *
   * ⚠️ 为什么归属校验在**返回 Observable 之前**做 (V2026-10-29 实测踩坑):
   *   Nest 11 的 SSE 通道对错误的处理有两条完全不同的路:
   *     · handler 的 **promise 拒绝** → 响应还没接管 → 异常过滤器写出**真正的 HTTP 404**
   *     · Observable 在**订阅后**报错 → 此时 SSE 响应头**已经提交** → Nest 只能降级成
   *       `200 + event: error` 帧 (客户端拿不到状态码)
   *   而 SSE 响应头是在 `setTimeout(0)` 里提交的 —— 一次**真实的 DB 查询**(异步 I/O)
   *   必然晚于这个宏任务. 所以: 装载若放进 Observable (订阅后才发生), 404 就永远拿不到;
   *   放进 handler 的 async 体内 (返回 Observable 之前就完成), 才是真正的 404.
   *   本轮真机实测确认过这条差别 (见交付记录 §2.1).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @returns SSE 消息流 (data = 完整报告 DTO, 或 `{"status":"timeout"}`)
   */
  async streamSessionReport(userId: string, sessionId: string): Promise<Observable<MessageEvent>> {
    // 截止时刻从**收到请求**起算 (不是从首次查询完成起算): 否则慢查询会把
    // 整条连接的生命周期拖长, 前端的 120s 兜底先到期, 双方各等各的.
    const deadlineMs = Date.now() + this.timeoutMs();
    this.logger.log(`[report_stream_start] sessionId=${sessionId}`);
    // 归属校验 + 首次装载 —— 失败即 404 (见上面的说明)
    const context = await this.supervision.loadReportContext(userId, sessionId);
    const report = this.supervision.buildReportDto(context);
    const action = decideReportStreamAction({ status: report.status, nowMs: Date.now(), deadlineMs });
    if (action === 'emit_report') {
      this.logger.log(`[report_stream_push] sessionId=${sessionId} status=${report.status}`);
      return of<MessageEvent>({ data: report });
    }
    return this.pollUntilTerminal(userId, sessionId, deadlineMs);
  }

  /**
   * 轮询直到终态 (或超时).
   *
   * 为什么用 `timer` 而不是 `setInterval`: `timer` 的定时器随订阅取消而销毁 ——
   * Nest 的 SSE 通道在客户端断开时会取消订阅, 于是"客户端断开 → 轮询停止"是
   * **框架保证**的, 不依赖我们自己记得清理 (这是本文件最关键的一条).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param deadlineMs 等待截止时刻 (ms)
   * @returns 推送流 (只推一条)
   */
  private pollUntilTerminal(userId: string, sessionId: string, deadlineMs: number): Observable<MessageEvent> {
    const intervalMs = this.pollIntervalMs();
    return timer(intervalMs, intervalMs).pipe(
      // concatMap: 串行执行轮询 —— 上一轮没跑完不叠加下一轮 (否则慢查询会堆积)
      concatMap(() => from(this.pollTick(userId, sessionId, deadlineMs))),
      // 只保留"该推了"的结果; keep_waiting 被滤掉
      filter((tick): tick is ReportStreamEmitTick => tick.action !== 'keep_waiting'),
      // 推完即关流 (本端点只推一条)
      take(1),
      map((tick) => ({ data: tick.payload })),
    );
  }

  /**
   * 一轮轮询.
   *
   * ⚠️ 为什么每轮都**完整装载 + 重新派生** (V2026-10-29 真机实测踩出来的):
   *   第一版用"探针"省查询: 只问「报告行落库了没」, 落了就完整装载一次.
   *   真机实测发现: **报告行永远不会来**的会话 (空局 —— 素材不足, 任务单 §4.3 要求
   *   立即推 `no_content`) 会被探针判成"还没到" → 一直等到 120s 才推 `timeout`.
   *   也就是说: 探针只覆盖了「终态由报告行决定」这一类, 漏掉了
   *   「会话结束 + 素材不足 → no_content」「墙钟陈旧兜底 → parse_error」
   *   这两类**不由报告行决定**的终态 —— 于是"该推的终态"推不出去.
   *   教训: **终态判定不能有第二个口径**. 现在轮询直接复用 GET 端点的
   *   `loadReportContext` + `buildReportDto` (同一份装载、同一份派生),
   *   所有终态一个不漏, 且与 GET 端点**零漂移**.
   *
   * 代价: 每轮 ≈ 一次 GET 的查询量 (5 条索引查询, 实测 ~280ms), 间隔 2s ——
   *   与"报告通常 30s+ 才生成"相比可以接受; 而省下的那点查询量, 换来的是
   *   "漏推终态"这种只在线上暴露、且用户只能靠等超时才发现的问题, 不划算.
   *
   * 顺序 (有意为之):
   *   1. 先看超时 —— 已经等够了就别再查库了, 直接收口
   *   2. 重新装载 + 重新派生 → 状态由**同一份**派生逻辑决定
   *   3. 状态是终态 → 推完整报告 (载荷直接用这一轮的装载结果, 不用再查一次)
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param deadlineMs 等待截止时刻 (ms)
   * @returns 本轮结果
   */
  private async pollTick(userId: string, sessionId: string, deadlineMs: number): Promise<ReportStreamTick> {
    if (Date.now() >= deadlineMs) {
      this.logger.warn(`[report_stream_timeout] sessionId=${sessionId}`);
      return { action: 'emit_timeout', payload: buildReportStreamTimeoutPayload() };
    }
    // 轮询期的取数失败 (DB 抖动) **不能毁掉整条推送**:
    //   抛出去 → Observable 在**订阅后**报错 → SSE 响应头此时已提交 → 客户端只拿到
    //   `event: error` 帧 (前端解析器忽略非 JSON 行) → 表现为"流莫名断了、转圈没尽头".
    //   所以这里吞掉异常: 本轮跳过, 下一轮继续; 真的不行就走到超时分支推 timeout.
    let report: SessionReportDto;
    try {
      const fresh = await this.supervision.loadReportContext(userId, sessionId);
      report = this.supervision.buildReportDto(fresh);
    } catch (err) {
      this.logger.warn(`[report_stream_reload_failed] sessionId=${sessionId} err=${err instanceof Error ? err.message : String(err)}`);
      return { action: 'keep_waiting' };
    }
    const action = decideReportStreamAction({ status: report.status, nowMs: Date.now(), deadlineMs });
    if (action === 'emit_report') {
      this.logger.log(`[report_stream_push] sessionId=${sessionId} status=${report.status}`);
      return { action: 'emit_report', payload: report };
    }
    if (action === 'emit_timeout') {
      this.logger.warn(`[report_stream_timeout] sessionId=${sessionId}`);
      return { action: 'emit_timeout', payload: buildReportStreamTimeoutPayload() };
    }
    // 还是 pending → 继续等, 不推半成品.
    return { action: 'keep_waiting' };
  }

  /**
   * 轮询间隔 (ms).
   *
   * 配置缺失 / 非法 (非正数) → 回落默认: 0 或负数会让 `timer` 变成**空转**,
   * 把 DB 打成筛子 —— 这种"看起来能跑"的坏配置比直接报错危险得多.
   *
   * @returns 轮询间隔
   */
  private pollIntervalMs(): number {
    const configured = this.config.get<number>('supervision.reportStreamPollIntervalMs');
    return typeof configured === 'number' && configured > 0 ? configured : SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS;
  }

  /**
   * 等待超时 (ms).
   *
   * @returns 超时时长
   */
  private timeoutMs(): number {
    const configured = this.config.get<number>('supervision.reportStreamTimeoutMs');
    return typeof configured === 'number' && configured > 0 ? configured : SUPERVISION_REPORT_STREAM_TIMEOUT_MS;
  }
}
