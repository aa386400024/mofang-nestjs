// V2026-10-29 治本 (WP21 · 报告 SSE 端点 · HTTP 层契约):
//   锁住三件"只在 HTTP 层才暴露"的事 (service 单测看不到):
//     ① 跨用户 / 不存在的会话 → **真正的 HTTP 404** (不是 200 + 空流):
//        Nest 11 的 SSE 通道把 handler 抛出的异常交给异常过滤器, 而 SSE 的响应头
//        是**延迟提交**的 (第一次推送才提交) —— 所以异常发生时头还没发出去,
//        过滤器仍能写出完整的 404 JSON. 这条链路一旦退化 (变成 200 空流),
//        前端会把"没有权限/不存在"当成"还在生成", 一直转圈.
//     ② 响应 Content-Type = text/event-stream, 帧格式 `data: {JSON}` (前端手写解析器只认这个)
//     ③ 等待超时推的是 `data: {"status":"timeout"}` —— 客户端拿到**一条明确的事件**
//        而不是"连接莫名断了" (前端据此给出"稍后重试"出口).
//
//   用真实 controller + 真实 stream service, 只把 SupervisionService (取库) 打桩.
//   验证: npx jest test/counselor/wp21-report-sse-endpoint.spec.ts
//   时间戳: 2026-10-29 GMT+8

import { NotFoundException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerErrorInterceptor } from 'nestjs-pino';
import type { Server } from 'node:http';
import supertest from 'supertest';

import { CounselorSupervisionController } from '../../src/counselor/controllers/supervision.controller';
import type { SessionReportDto } from '../../src/counselor/dto/supervision.dto';
import { SessionType } from '../../src/counselor/enums/session-type.enum';
import { TrainingSessionStatus } from '../../src/counselor/enums/training-session-status.enum';
import { SupervisionReportGuard } from '../../src/counselor/guards/supervision-report.guard';
import { SupervisionReportStreamService } from '../../src/counselor/providers/supervision-report-stream.service';
import { SupervisionService, type SessionReportContext } from '../../src/counselor/providers/supervision.service';
import { JwtAuthGuard } from '../../src/user/guards/jwt-auth.guard';

/** 固定"当前时刻". */
const NOW = 1_800_000_000_000;

/** 报告事实集替身. */
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

/** 报告 DTO 替身. */
function fakeReport(status: 'completed' | 'pending'): SessionReportDto {
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

/** SupervisionService 替身 (只实现归属校验 / 报告装载 / 拼 DTO 三件事). */
class StubSupervision {
  /** 归属校验是否通过 (false = 会话不存在 / 跨用户). */
  owned = true;
  /** 装载时抛错 → 模拟"装载期故障". */
  loadError: Error | null = null;
  /** 报告状态. */
  status: 'completed' | 'pending' = 'completed';

  async assertSessionOwned(): Promise<void> {
    if (!this.owned) {
      throw new NotFoundException('训练会话 session-1 不存在或不属于当前用户');
    }
  }

  async loadReportContext(): Promise<SessionReportContext> {
    // ⚠️ 必须**异步**抛错 (真机上是 DB 查询失败, 必然晚于一个宏任务):
    //   SSE 响应头是在 `setTimeout(0)` 里提交的, 同步抛错会"抢在"提交之前到达,
    //   于是**错误地**拿到 404 —— 掩盖真机上的 `200 + event: error`.
    //   这里先让出一个事件循环, 复现真实时序, 让测试真正守住这条.
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    if (this.loadError) {
      throw this.loadError;
    }
    return FAKE_CONTEXT;
  }

  buildReportDto(): SessionReportDto {
    return fakeReport(this.status);
  }
}

/** ConfigService 替身 (只认点号路径的两个键; 阈值调小, 测试不用真等 2 分钟). */
const configStub = {
  get: (key: string): number | undefined => {
    if (key === 'supervision.reportStreamPollIntervalMs') {
      return 10;
    }
    if (key === 'supervision.reportStreamTimeoutMs') {
      return 60;
    }
    return undefined;
  },
};

describe('WP21 · 报告 SSE 端点 (HTTP 层契约)', () => {
  let stub: StubSupervision;
  let app: INestApplication;
  let server: Server;

  beforeEach(async () => {
    stub = new StubSupervision();
    const moduleRef = await Test.createTestingModule({
      controllers: [CounselorSupervisionController],
      providers: [
        { provide: SupervisionService, useValue: stub },
        { provide: ConfigService, useValue: configStub },
        SupervisionReportStreamService,
        // guard 必须显式注册 —— Nest 的 `@UseGuards(类)` 是从模块的 injectables 里取的
        SupervisionReportGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext): boolean => {
          const request = context.switchToHttp().getRequest<{ user?: unknown }>();
          request.user = { userId: 'user-1', username: 'tester', roles: [] };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // ⚠️ 必须挂上**全局** LoggerErrorInterceptor (与 src/app.ts 一致):
    //   它会让 handler 的 promise 被包成 Observable —— 于是 handler 里抛的错只能
    //   "在订阅之后"浮现, 那时 SSE 响应头已提交 → 只能降级成 `200 + event: error`.
    //   不挂这个 interceptor 的测试**测不到生产行为** (本轮真机就是这么踩到的).
    app.useGlobalInterceptors(new LoggerErrorInterceptor());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('会话不存在 / 跨用户 → 真正的 HTTP 404 (JSON body), 不是 200 空流', async () => {
    stub.owned = false;

    const res = await supertest(server).get('/counselor/supervision/report/session-1/stream');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404 });
    // 关键: 不能退化成 SSE 错误帧 (那种情况下客户端拿不到状态码)
    expect(res.headers['content-type']).not.toContain('text/event-stream');
  });

  it('报告已终态 → 200 + text/event-stream + data: {完整报告}', async () => {
    stub.status = 'completed';

    const res = await supertest(server).get('/counselor/supervision/report/session-1/stream');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // 帧格式: data: {JSON} —— 前端手写解析器只认 data: 前缀行
    expect(res.text).toContain('data: {');
    expect(res.text).toContain('"status":"completed"');
    expect(res.text).toContain('"overallScore":72');
  });

  it('等待超时 → 推一条 data: {"status":"timeout"} (客户端拿到明确事件, 不是断连)', async () => {
    stub.status = 'pending';

    const res = await supertest(server).get('/counselor/supervision/report/session-1/stream');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: {"status":"timeout"}');
  });
});
