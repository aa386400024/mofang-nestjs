// V2026-11-06 治本 (WP46 · Sentry 通道脱敏 · 心理数据合规闭环 · e2e 出血测试):
//   单元测试证明"脱敏函数是对的"; 这个套件证明"**真实链路上真正发出去的东西**里没有心理原文".
//
//   为什么必须是 e2e (而不是单测):
//     Sentry v11 (实测 @sentry/node 11.10.0) 的 request body 是**自动采集**的 ——
//     dataCollection.httpBodies 默认含 'incomingRequest', SDK 会把**原始请求体字符串**
//     挂到 event.request.data. 单测测不到这条自动采集链路, 只有真跑一次 HTTP 才测得到.
//
//   本套件的三段:
//     ① 真实 HTTP 链路 + **采集口径被误开** (模拟"有人把 dataCollection 改宽了"):
//        真起 Nest 应用 (TestingModule + 动态 __test__ controller + 真实 BizExceptionFilter),
//        真跑 Sentry SDK (生产同款 beforeSend), 断言**真正发出去的 envelope 里没有心理原文**.
//     ② 生产严格口径 (STRICT_DATA_COLLECTION): 断言 body **根本不会被采集** —— 源头不采.
//     ③ request.data 为**对象形态**时的脱敏口径 (任务单 §4.2 的验收金标准):
//        body / title / password 被遮, userId 保留.
//
//   零网络保证: transport 换成空实现 (事件只进内存, 绝不离开本机).
//
//   两个必须知道的 SDK 行为 (实测踩出来的, 注释里都标了):
//     ① http integration 是**第一次请求时**才把 server 插桩的 —— 所以测试要先发一次"预热请求";
//     ② envelope 创建时 SDK 会 delete event.sdkProcessingMetadata —— 那份元数据**不会**发出去,
//        所以断言必须落在 envelope 上, 而不是 beforeSend 拿到的 event 上.
//
//   边界: 生产代码零痕迹 —— 临时 controller 只在本测试里注册.
//   验证: npx vitest run --config ./test/vitest.e2e.mts test/e2e/sentry-redaction.spec.ts
//   时间戳: 2026-11-06 GMT+8

import { Controller, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';
import { json } from 'express';
import supertest from 'supertest';

import { BizExceptionFilter } from '../../src/common/filters/biz-exception.filter.js';
import {
  buildSentryInitOptions,
  STRICT_DATA_COLLECTION,
  SentryService,
  type SentryDataCollection,
} from '../../src/shared/infra/observability/index.js';

/**
 * 临时测试端点 —— 只在本测试里注册, 生产代码零痕迹.
 *
 * 刻意**不把 body 拼进 Error.message**:
 *   Error.message 里的心理原文识别不归 Sentry 脱敏层 (任务单 §五.1 明确"不做 NLP 级识别"),
 *   本测试验证的是 beforeSend 对 event.request.data 的处理.
 */
@Controller('__test__')
class TestThrowController {
  /** 自增序号 —— 每次抛**不同**的错误, 否则 Sentry 的 dedupe 会把后续事件当重复丢弃. */
  private static seq = 0;

  @Post('throw5xx')
  throw5xx(): void {
    TestThrowController.seq += 1;
    throw new Error(`test 5xx internal error #${TestThrowController.seq}`);
  }
}

/**
 * 真实 SentryService, 但**不自己 init SDK**.
 *
 * 原因: 测试要在 beforeAll 里自己 Sentry.init (生产同款 beforeSend + 空 transport),
 *   如果让 service 自己 init, 它会用默认 transport 覆盖掉, 事件就真发出去了.
 */
class TestSentryService extends SentryService {
  override async onModuleInit(): Promise<void> {
    // 只把开关打开, SDK 由测试统一控制 (initialized 是 private, 运行时可写).
    (this as unknown as { initialized: boolean }).initialized = true;
  }
}

/**
 * "采集口径被误开"的档位 —— 模拟有人把 dataCollection 改宽.
 *
 * httpBodies 含 'incomingRequest' → SDK 会把**原始请求体字符串**挂进 event.request.data.
 * 这正是 WP46 要堵的洞: 万一这行被改宽, beforeSend 仍必须把内容遮干净.
 */
const PERMISSIVE_DATA_COLLECTION: SentryDataCollection = {
  ...STRICT_DATA_COLLECTION,
  httpBodies: ['incomingRequest'],
  userInfo: true,
  cookies: true,
};

/** 心理原文 —— 整个套件里它一个字都不许出现在发出去的东西里. */
const PSYCH_TEXT = '我想自杀，日记原文';
/** 凭据 —— 同样不许出现. */
const SECRET_TEXT = 'abc123';
/** 业务 id —— 必须保留 (调试必需). */
const USER_ID = 'u123';

const PAYLOAD = {
  body: PSYCH_TEXT,
  title: '求助',
  password: SECRET_TEXT,
  userId: USER_ID,
};

/** beforeSend 拿到的 (脱敏后) 事件. */
const capturedEvents: Record<string, unknown>[] = [];
/** 真正交给 transport 的 envelope —— 这才是"会发到 Sentry 的东西". */
const capturedEnvelopes: unknown[] = [];

/**
 * 把 envelope 摊平成字符串 —— 断言"真正发出去的内容"时用它.
 *
 * @param envelope envelope
 * @returns 序列化后的内容
 */
function envelopeToString(envelope: unknown): string {
  // Sentry 的 envelope 是**普通元组**: [headers, items], 每个 item 是 [itemHeaders, payload].
  // payload 就是真正发出去的事件 (createEventEnvelope 已 delete 掉 sdkProcessingMetadata).
  const env = envelope as [unknown, [unknown, unknown][]];
  const items = Array.isArray(env) ? (env[1] ?? []) : [];
  return JSON.stringify(items.map((item) => (Array.isArray(item) ? item[1] : item)));
}

/**
 * 初始化 Sentry SDK: 生产同款 beforeSend + 空 transport (零网络).
 *
 * @param dataCollection 采集口径
 */
function initSentry(dataCollection: SentryDataCollection): void {
  const options = buildSentryInitOptions({
    dsn: 'https://publickey@localhost/1',
    environment: 'test',
    tracesSampleRate: 0,
    profileSessionSampleRate: 0,
    profilingIntegration: null,
    dataCollection,
    sendClientReports: false,
  });

  // 只留**必要**的 integration, 换来确定性:
  //   · requestDataIntegration —— 把 request.data 挂到事件上 (要验证的正是它);
  //   · httpIntegration        —— 采集请求体 (v11 默认开, 这正是要堵的洞);
  //   关掉默认集的原因: Console 会把 console 输出变成 breadcrumb (测试自己的输出会污染断言),
  //   Dedupe 会把重复错误当重复事件丢掉.
  options.defaultIntegrations = false;
  options.integrations = [...(options.integrations ?? []), Sentry.requestDataIntegration()];

  // 空 transport —— 事件只进内存, 绝不离开本机.
  options.transport = (() => ({
    send: (envelope: unknown) => {
      capturedEnvelopes.push(envelope);
      return { status: 'success' as const };
    },
    flush: () => Promise.resolve(true),
  })) as unknown as NonNullable<NodeOptions['transport']>;

  // 包住**生产同款** beforeSend: 记录脱敏后的 event.
  const realBeforeSend = options.beforeSend as unknown as (event: unknown, hint: unknown) => Record<string, unknown> | null;
  options.beforeSend = ((event: unknown, hint: unknown) => {
    const redacted = realBeforeSend(event, hint);
    if (redacted) {
      capturedEvents.push(redacted);
    }
    // 注意: 这里**返回**脱敏后的事件 (不是 null) —— 这样 envelope 才真的被造出来,
    // 测试才能断言"真正发出去的东西"长什么样. 空 transport 保证它不会离开本机.
    return redacted;
  }) as unknown as typeof options.beforeSend;

  Sentry.init(options);
}

/**
 * 等 Sentry 事件被捕获.
 *
 * 为什么需要等: Sentry 的事件处理是**异步**的 (captureException 只是入队,
 *   beforeSend / envelope 都在之后的微任务里跑) —— HTTP 响应返回时事件可能还没落地.
 *   这里轮询等待, 而不是靠 sleep 猜时间 (猜时间 = flaky).
 *
 * @param timeoutMs 超时毫秒
 * @returns 捕获到的事件
 */
async function waitForCapturedEvent(timeoutMs = 3000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (capturedEvents.length === 0) {
    if (Date.now() > deadline) {
      throw new Error('Sentry 事件未在超时内被捕获 (beforeSend 没被调用?)');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  return capturedEvents.at(-1)!;
}

describe('WP46 · Sentry 通道脱敏 (e2e 出血测试)', () => {
  let app: INestApplication;
  let sentryService: TestSentryService;

  beforeAll(async () => {
    sentryService = new TestSentryService();

    const moduleRef = await Test.createTestingModule({
      controllers: [TestThrowController],
      providers: [{ provide: SentryService, useValue: sentryService }],
    }).compile();

    app = moduleRef.createNestApplication();
    // body parser 必须读掉请求流, SDK 的 body 采集才会被触发 —— 这正是要验证的那条链路.
    app.use(json());
    app.useGlobalFilters(new BizExceptionFilter(sentryService));
    await app.init();

    initSentry(PERMISSIVE_DATA_COLLECTION);

    // 预热: http integration 是**第一次请求时**才把 server 插桩的 ——
    //   第一次请求拿不到 body 采集, 所以先发一发, 把 server 插好.
    await supertest(app.getHttpServer()).post('/__test__/throw5xx').send(PAYLOAD).expect(500);
    await waitForCapturedEvent();
    capturedEvents.length = 0;
    capturedEnvelopes.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('① 真实 HTTP 链路 · 采集口径被误开 (出血场景)', () => {
    beforeAll(() => {
      initSentry(PERMISSIVE_DATA_COLLECTION);
    });

    it('真正发出去的 envelope 里没有心理原文 / 凭据', async () => {
      capturedEvents.length = 0;
      capturedEnvelopes.length = 0;

      await supertest(app.getHttpServer()).post('/__test__/throw5xx').send(PAYLOAD).expect(500);

      await waitForCapturedEvent();
      expect(capturedEnvelopes.length).toBeGreaterThan(0);

      const sent = capturedEnvelopes.map((envelope) => envelopeToString(envelope)).join('');
      // 核心断言: 心理原文 / 凭据 一个字都没进真正发出去的东西.
      expect(sent).not.toContain(PSYCH_TEXT);
      expect(sent).not.toContain(SECRET_TEXT);
      // 脱敏不能把排查信息一起抹掉: 路由 + 遮蔽占位符都要在.
      expect(sent).toContain('/__test__/throw5xx');
      expect(sent).toContain('[REDACTED body]');
    });

    it('request.data 被整体遮蔽 (原始 body 字符串形态)', async () => {
      capturedEvents.length = 0;
      capturedEnvelopes.length = 0;

      await supertest(app.getHttpServer()).post('/__test__/throw5xx').send(PAYLOAD).expect(500);

      const event = await waitForCapturedEvent();
      const request = event.request as Record<string, unknown>;
      expect(request.data).toBe('[REDACTED body]');
    });

    it('异常本身照常上报 (脱敏不能把事件整个吞掉)', async () => {
      capturedEvents.length = 0;
      capturedEnvelopes.length = 0;

      await supertest(app.getHttpServer()).post('/__test__/throw5xx').send(PAYLOAD).expect(500);

      const event = await waitForCapturedEvent();
      expect(event.exception).toBeDefined();
      const values = (event.exception as Record<string, unknown>).values as Record<string, unknown>[];
      expect(String(values[0].value)).toContain('test 5xx internal error');
    });
  });

  describe('② 生产严格口径 —— 源头就不采 body', () => {
    beforeAll(() => {
      initSentry(STRICT_DATA_COLLECTION);
    });

    it('严格档下 request.data 根本不存在 (SDK 压根没采)', async () => {
      capturedEvents.length = 0;
      capturedEnvelopes.length = 0;

      await supertest(app.getHttpServer()).post('/__test__/throw5xx').send(PAYLOAD).expect(500);

      const event = await waitForCapturedEvent();
      const request = event.request as Record<string, unknown>;
      expect(request.data).toBeUndefined();

      const sent = capturedEnvelopes.map((envelope) => envelopeToString(envelope)).join('');
      expect(sent).not.toContain(PSYCH_TEXT);
      expect(sent).not.toContain(SECRET_TEXT);
    });
  });

  describe('③ request.data 为对象形态时的脱敏口径 (任务单 §4.2 验收金标准)', () => {
    it('body / title / password 被遮, userId 保留', () => {
      const beforeSend = buildSentryInitOptions({
        dsn: 'https://publickey@localhost/1',
        environment: 'test',
        tracesSampleRate: 0,
        profileSessionSampleRate: 0,
        profilingIntegration: null,
      }).beforeSend as unknown as (event: unknown, hint: unknown) => Record<string, unknown> | null;

      const result = beforeSend(
        {
          request: {
            data: { body: PSYCH_TEXT, title: '求助', password: SECRET_TEXT, userId: USER_ID },
          },
        },
        {},
      );

      expect(result).not.toBeNull();
      const data = (result.request as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.body).toBe('[REDACTED]');
      expect(data.title).toBe('[REDACTED]');
      expect(data.password).toBe('[REDACTED]');
      expect(data.userId).toBe(USER_ID);
    });
  });
});
