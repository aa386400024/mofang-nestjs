// V2026-10-29 治本 (WP21 · 报告生成 SSE 推送端点):
//   覆盖任务单 §2 行为表在**服务端**的可测行为:
//     ① 决策表 (domain 纯函数): 终态 → 推报告; pending 且未到点 → 继续等;
//        pending 且到点 → 推 timeout; **终态优先于超时** (报告已经能看了就别再报超时);
//     ② 已是终态 → 立即推一条完整报告并关流 (且**不进入轮询** —— 每次开流都白查一次库);
//     ③ pending → 轮询 → 报告落库 → 重新装载 → 推完整报告并关流;
//     ④ 一直不落库 → 到点推 `{"status":"timeout"}` 并关流 (不是静默断连);
//     ⑤ 会话不存在 / 不属于当前用户 → 抛 NotFoundException (Nest 的 SSE 通道据此写 HTTP 404);
//     ⑥ 客户端断开 (取消订阅) → **不再轮询** (定时器随订阅销毁, 不泄漏).
//
//   全 mock: 只喂 SupervisionService 的假实现, 不连库、不连上游.
//   验证: npx jest test/counselor/wp21-report-stream.spec.ts
//   时间戳: 2026-10-29 GMT+8

import { NotFoundException, type MessageEvent } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

import { buildReportStreamTimeoutPayload, decideReportStreamAction } from '../../src/counselor/domain/session-core/report-stream';
import type { SessionReportStatus } from '../../src/counselor/domain/session-core/session-core.types';
import type { SessionReportDto } from '../../src/counselor/dto/supervision.dto';
import { SessionType } from '../../src/counselor/enums/session-type.enum';
import { TrainingSessionStatus } from '../../src/counselor/enums/training-session-status.enum';
import { SupervisionReportStreamService } from '../../src/counselor/providers/supervision-report-stream.service';
import type { SessionReportContext, SupervisionService } from '../../src/counselor/providers/supervision.service';

/** 固定"当前时刻", 免得测试随系统时间漂移. */
const NOW = 1_800_000_000_000;

/** 测试用的报告事实集 (service 只把它当不透明载荷往下传). */
const FAKE_CONTEXT = {
  row: {
    id: 'session-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    transcript: [],
    techStats: null,
    startedAt: null,
    endedAt: null,
    status: TrainingSessionStatus.FINISHED,
    supervisionReportId: null,
  },
  sessionType: SessionType.VPT_VOICE,
  report: null,
  marks: [],
  feedbackBySchool: {},
  schoolFeedbackState: null,
  material: { effectiveTurns: 3, effectiveChars: 120 },
  endedAtMs: NOW - 1000,
  sessionStatus: TrainingSessionStatus.FINISHED,
  nowMs: NOW,
} as unknown as SessionReportContext;

/** 造一份报告 DTO (只关心 status). */
function fakeReport(status: SessionReportStatus): SessionReportDto {
  return {
    sessionId: 'session-1',
    sessionType: SessionType.VPT_VOICE,
    status,
    overallScore: status === 'completed' ? 72 : null,
    failureCode: null,
    retryable: false,
    dimensions: null,
    annotations: [],
    errorPatterns: [],
    growthSuggestions: [],
    techStats: null,
    marks: [],
    feedbackBySchool: {},
    startedAt: null,
    endedAt: null,
    turnCount: 3,
    createdAt: null,
  };
}

/**
 * SupervisionService 替身.
 *
 * 记录调用次数 (验证"终态不进入轮询" / "轮询次数" / "断开后不再轮询"),
 * 状态按 `statusByBuildCall` 逐次给出 (模拟"首次 pending → 落库后 completed").
 */
class StubSupervision {
  /** 装载次数 (归属校验 + 取事实). */
  loadCalls = 0;
  /** 拼 DTO 次数. */
  buildCalls = 0;
  /** 每次拼 DTO 返回的状态 (超出长度取最后一个). */
  statusByBuildCall: SessionReportStatus[] = ['pending'];
  /** 从第 N 次装载起抛错 (模拟 DB 抖动); null = 不抛. */
  loadFailFromCall: number | null = null;
  /** 装载抛错 (模拟 404). */
  loadError: Error | null = null;

  async loadReportContext(): Promise<SessionReportContext> {
    this.loadCalls += 1;
    if (this.loadError) {
      throw this.loadError;
    }
    if (this.loadFailFromCall !== null && this.loadCalls >= this.loadFailFromCall) {
      throw new Error('db connection reset');
    }
    return FAKE_CONTEXT;
  }

  buildReportDto(): SessionReportDto {
    const index = Math.min(this.buildCalls, this.statusByBuildCall.length - 1);
    this.buildCalls += 1;
    return fakeReport(this.statusByBuildCall[index] ?? 'pending');
  }
}

/** ConfigService 替身 (只认点号路径的两个键). */
class StubConfig {
  constructor(private readonly values: Record<string, number>) {}

  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

/** 收集一条流的所有帧 + 结束原因. */
function collect(stream: Observable<MessageEvent>): Promise<{
  readonly frames: MessageEvent[];
  readonly error: unknown;
  readonly completed: boolean;
}> {
  return new Promise((resolve) => {
    const frames: MessageEvent[] = [];
    let error: unknown = null;
    let completed = false;
    stream.subscribe({
      next: (frame) => frames.push(frame),
      error: (err: unknown) => {
        error = err;
        resolve({ frames, error, completed });
      },
      complete: () => {
        completed = true;
        resolve({ frames, error, completed });
      },
    });
  });
}

/** 造一个 service (轮询 10ms / 超时 60ms —— 测试里不用真等 2 分钟). */
function buildService(
  stub: StubSupervision,
  options: { readonly intervalMs?: number; readonly timeoutMs?: number } = {},
): SupervisionReportStreamService {
  const config = new StubConfig({
    'supervision.reportStreamPollIntervalMs': options.intervalMs ?? 10,
    'supervision.reportStreamTimeoutMs': options.timeoutMs ?? 60,
  });
  return new SupervisionReportStreamService(stub as unknown as SupervisionService, config as unknown as ConfigService);
}

/** 等一小会儿 (给轮询留出时间). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('WP21 · 报告推送决策表 (domain 纯函数)', () => {
  it('completed → 推报告', () => {
    expect(decideReportStreamAction({ status: 'completed', nowMs: NOW, deadlineMs: NOW + 1000 })).toBe('emit_report');
  });

  it('parse_error → 推报告 (失败终态也要推, 前端据此给重试出口)', () => {
    expect(decideReportStreamAction({ status: 'parse_error', nowMs: NOW, deadlineMs: NOW + 1000 })).toBe('emit_report');
  });

  it('no_content → 推报告 (空局是终态, 报告永远不会来)', () => {
    expect(decideReportStreamAction({ status: 'no_content', nowMs: NOW, deadlineMs: NOW + 1000 })).toBe('emit_report');
  });

  it('pending 且未到截止 → 继续等', () => {
    expect(decideReportStreamAction({ status: 'pending', nowMs: NOW, deadlineMs: NOW + 1000 })).toBe('keep_waiting');
  });

  it('pending 且刚好到截止 → 推超时 (边界用 >=)', () => {
    expect(decideReportStreamAction({ status: 'pending', nowMs: NOW + 1000, deadlineMs: NOW + 1000 })).toBe('emit_timeout');
  });

  it('pending 且超过截止 → 推超时', () => {
    expect(decideReportStreamAction({ status: 'pending', nowMs: NOW + 2000, deadlineMs: NOW + 1000 })).toBe('emit_timeout');
  });

  it('终态优先于超时 (报告已经能看了, 别再报超时)', () => {
    expect(decideReportStreamAction({ status: 'completed', nowMs: NOW + 9999, deadlineMs: NOW + 1000 })).toBe('emit_report');
  });

  it('超时负载只带 status=timeout (不给空字段, 免得前端渲染成空报告)', () => {
    expect(buildReportStreamTimeoutPayload()).toEqual({ status: 'timeout' });
  });
});

describe('WP21 · 报告 SSE 推送 service', () => {
  it('已是终态 → 立即推一条完整报告并关流, 且不进入轮询', async () => {
    const stub = new StubSupervision();
    stub.statusByBuildCall = ['completed'];

    const result = await collect(await buildService(stub).streamSessionReport('user-1', 'session-1'));

    expect(result.error).toBeNull();
    expect(result.completed).toBe(true);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.data).toMatchObject({ status: 'completed', overallScore: 72 });
    // 终态不该再查库 —— 白查一次就是白给 DB 加压
    expect(stub.loadCalls).toBe(1);
  });

  it('pending → 轮询到落库 → 重新装载 → 推完整报告并关流', async () => {
    const stub = new StubSupervision();
    // 首次装载 pending; 下一轮装载 (报告落库后) → completed
    stub.statusByBuildCall = ['pending', 'completed'];

    const result = await collect(await buildService(stub).streamSessionReport('user-1', 'session-1'));

    expect(result.error).toBeNull();
    expect(result.completed).toBe(true);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.data).toMatchObject({ status: 'completed' });
    // 装载两次: 首次 + 轮询重新装载
    expect(stub.loadCalls).toBe(2);
  });

  it('终态由"会话结束 + 素材不足"决定 (空局) → 轮询必须能推到, 而不是干等到超时', async () => {
    // 回归用例: 第一版用"探针"(只看报告行落没落)轮询, 于是**报告永远不会来**的
    //   空局会话被判成"还没到" → 一直等到 120s 才推 timeout (任务单 §4.3 要求立即推 no_content).
    //   现在轮询与 GET 走**同一份**装载+派生 → 空局这类终态一个不漏.
    const stub = new StubSupervision();
    stub.statusByBuildCall = ['pending', 'no_content'];

    const result = await collect(await buildService(stub).streamSessionReport('user-1', 'session-1'));

    expect(result.error).toBeNull();
    expect(result.completed).toBe(true);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.data).toMatchObject({ status: 'no_content' });
    expect(stub.loadCalls).toBe(2);
  });

  it('一直不落库 → 到点推 {"status":"timeout"} 并关流 (不是静默断连)', async () => {
    const stub = new StubSupervision();
    stub.statusByBuildCall = ['pending'];

    const result = await collect(await buildService(stub, { intervalMs: 10, timeoutMs: 60 }).streamSessionReport('user-1', 'session-1'));

    expect(result.error).toBeNull();
    expect(result.completed).toBe(true);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.data).toEqual({ status: 'timeout' });
  });

  it('会话不存在 / 不属于当前用户 → 在返回 Observable 之前就抛 NotFoundException', async () => {
    const stub = new StubSupervision();
    stub.loadError = new NotFoundException('训练会话 session-1 不存在或不属于当前用户');

    // 关键: 归属校验必须在**返回 Observable 之前**完成 ——
    //   只有这样, 错误才是 handler 的 promise 拒绝, Nest 的 SSE 通道才会写 HTTP 404;
    //   若推迟到订阅后 (Observable 内), 响应头已提交 → 只能降级成 `200 + event: error`.
    await expect(buildService(stub).streamSessionReport('user-1', 'session-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('客户端断开 (取消订阅) → 不再轮询 (定时器随订阅销毁, 不泄漏)', async () => {
    const stub = new StubSupervision();
    stub.statusByBuildCall = ['pending'];

    const stream = await buildService(stub, { intervalMs: 10, timeoutMs: 5000 }).streamSessionReport('user-1', 'session-1');
    const subscription = stream.subscribe();
    await delay(45);
    const loadsBeforeUnsubscribe = stub.loadCalls;
    expect(loadsBeforeUnsubscribe).toBeGreaterThan(1);

    subscription.unsubscribe();
    await delay(60);

    // 断开后不再装载 —— 否则每开一次报告页就漏一个定时器
    expect(stub.loadCalls).toBe(loadsBeforeUnsubscribe);
  });

  it('轮询期取数失败 (DB 抖动) → 跳过本轮继续等, 不把流打断', async () => {
    const stub = new StubSupervision();
    stub.statusByBuildCall = ['pending'];
    // 第 2 次装载起失败 (即首次装载成功、进入轮询后开始失败)
    stub.loadFailFromCall = 2;

    const result = await collect(await buildService(stub, { intervalMs: 10, timeoutMs: 60 }).streamSessionReport('user-1', 'session-1'));

    // 一直失败 → 一直"继续等" → 到点推 timeout (而不是抛错断流)
    expect(result.error).toBeNull();
    expect(result.completed).toBe(true);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.data).toEqual({ status: 'timeout' });
  });
});
