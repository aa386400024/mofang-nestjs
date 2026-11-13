// V2026-11-05 治本 (Admin Dashboard 调试会话持久化 · 单测):
//   覆盖任务单 §五 的验收:
//     ① 建档 / 每轮追加 / 改标题 / 标完成 / 列表 / 详情 / 删除 —— 真落 JSON 文件
//     ② 保留最近 50 个会话 (超出的自动删)
//     ③ 跑满 3 轮后自动用 LLM 生成标题; 失败兜底 "未命名会话 - {时间戳}"
//     ④ 人工改过的标题不会被自动命名覆盖
//     ⑤ 中途崩溃不丢数据 (每轮都写 → 读回来就有那一轮)
//
//   真文件 + 真目录 (临时目录, 用完即删):
//     持久化这一层的价值全在"文件真的写对了" —— 用内存替身测它, 等于没测.
//     临时目录用 `mkdtemp` 建在系统临时目录下, **不碰**仓库的 `data/`.
//
//   全 mock 的只有 LLM (标题生成): 路由器用替身, 其余全是真的.
//
//   验证: npx vitest run test/admin-debug/debug-session-persistence.spec.ts
//   时间戳: 2026-11-05 GMT+8
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

import {
  DebugSessionStore,
  MAX_DEBUG_SESSIONS,
  resolveStoreDir,
  type DebugSessionRecord,
} from '../../src/admin-debug/debug-session-store.js';
import {
  buildFallbackTitle,
  formatShanghaiMinute,
  MAX_DEBUG_SESSION_TITLE_LENGTH,
  parseDebugSessionTitle,
} from '../../src/admin-debug/debug-session-title.generator.js';
import { DebugSessionService, projectDebugSessionDetail } from '../../src/admin-debug/debug-session.service.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import type { ResolvedCharacter } from '../../src/engine-adapters/wiring/character/character-profile.resolver.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 已知角色代号 (解析器只认它). */
const KNOWN_SLUG = 'vpt_intimate_avoidance_l1';

/**
 * 轮询直到条件成立 (超时抛错).
 *
 * ⚠️ 为什么不能"等固定几拍" (`await new Promise(r => setTimeout(r, 1))` × N):
 *   落盘走的是 `node:fs/promises` —— **事件循环**上的 I/O, 不是微任务. 全量回归时
 *   111 个测试文件并行抢 CPU, 固定拍数**等不起** —— 会出 "单跑绿 / 全量红" 的 flaky.
 *   正确姿势是**轮询到条件成立**: 只跟"事情做完了"有关, 跟机器快慢无关.
 *
 * 用于"**应该**发生"的断言: 等的是**事实**, 不是时间.
 * 条件可以是异步的 (比如去磁盘上读一次记录).
 *
 * @param condition 条件判定 (返回 true 即视为已完成)
 * @param timeoutMs 超时上限 (默认 10s —— 正常是毫秒级, 这是余量不是预期)
 */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`waitFor 超时: 条件在 ${timeoutMs}ms 内没成立`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 等一小段时间, 确认"**不该**发生"的事确实没发生.
 *
 * 用于否定断言 (如"不到 3 轮就不该起标题"): 给异步链路留出跑完的余量, 再断言它没动过.
 * 不这么做的话, 一旦实现写错 (触发条件提前), 断言会在链路跑完**之前**执行 → **假绿**.
 *
 * 余量取 200ms: 生成链是 3 次本地文件 I/O, 正常量级是**毫秒**级 —— 200ms 已是
 * 两个数量级的余量, 不会再因机器慢而 flaky.
 */
async function settleAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/**
 * 造一份可控的 BDI 快照.
 */
function makeSnapshot(): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return { ...base, trust: 0.5, safety: 0.4, bond: 0.1 };
}

/**
 * 造一份门面结算结果.
 */
function makeTurnResult(turnIndex: number): TurnRenderResult {
  const snapshot = makeSnapshot();
  return {
    reply: '（回应）',
    snapshot,
    turnIndex,
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 120, totalTokens: 300, promptTokens: 180, reasoningTokens: 60 },
      model: 'MiniMax-M3.1-Flash',
      spec: { taskKind: 'chat', promptPreview: '你是一个来访者…', maxCompletionTokens: 1500, reasoningEffort: 'medium' },
      finishReason: 'stop',
      ttftMs: 420,
      promptFull: '你是一个来访者……(完整 system prompt)',
    },
  };
}

/**
 * 引擎门面替身.
 */
class StubEngine {
  readonly queue: TurnRenderResult[] = [];

  open(input: { readonly sessionId: string }): { handleId: string; sessionId: string } {
    return { handleId: `handle-${input.sessionId}`, sessionId: input.sessionId };
  }

  async turnStream(
    _handleId: string,
    _input: { readonly userText: string },
    _handlers: unknown,
    _options?: unknown,
  ): Promise<TurnRenderResult> {
    const next = this.queue.shift();
    if (!next) throw new Error('测试未预置结算结果');
    return next;
  }

  close(_handleId: string): void {
    /* noop */
  }
}

/**
 * 角色解析端口替身.
 */
class StubResolver {
  async resolve(request: { readonly templateId?: string }): Promise<ResolvedCharacter | null> {
    if (request.templateId !== KNOWN_SLUG) return null;
    return {
      characterProfile: { coreBeliefs: [], attachmentStyle: 'avoidant', personalityTraits: { agreeableness: 0.4 } },
      seed: 42,
      displayName: '亲密回避型 L1',
    } as unknown as ResolvedCharacter;
  }
}

/**
 * Redis 替身 (只回 get).
 */
class StubRedis {
  async get(_key: string): Promise<string | null> {
    return null;
  }
}

/**
 * 标题生成器替身 (可设失败).
 */
class StubTitleGenerator {
  readonly calls: unknown[] = [];
  failWith: Error | undefined;

  async generate(input: unknown): Promise<string> {
    this.calls.push(input);
    if (this.failWith) throw this.failWith;
    return '悲伤回避型来访者 - 初始访谈';
  }
}

/**
 * 内核状态回灌器替身 (V2026-11-06 · WP38 补做 · 调试会话恢复).
 */
class StubRestorer {
  async restoreBdiState(): Promise<'restored' | 'kept'> {
    return 'restored';
  }

  async restoreMemories(): Promise<number> {
    return 0;
  }
}

/**
 * 装一套调试服务 (真文件存储 + 替身引擎/LLM).
 */
function buildService(dir: string): {
  readonly service: DebugSessionService;
  readonly engine: StubEngine;
  readonly titleGenerator: StubTitleGenerator;
} {
  const engine = new StubEngine();
  const titleGenerator = new StubTitleGenerator();
  const store = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never);
  const service = new DebugSessionService(
    engine as never,
    new StubResolver(),
    new StubRedis() as never,
    stubConfig({}) as never,
    store,
    titleGenerator,
    new StubRestorer() as never,
  );
  return { service, engine, titleGenerator };
}

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * 造一条落盘记录.
 */
function buildRecord(id: string, overrides: Partial<DebugSessionRecord> = {}): DebugSessionRecord {
  const createdAt = overrides.createdAt ?? '2026-11-05T12:00:00.000Z';
  return {
    id,
    title: buildFallbackTitle(createdAt),
    titleSource: 'fallback',
    characterSlug: 'vpt_x',
    characterLabel: '晚晴',
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    turnCount: 0,
    messages: [],
    traces: [],
    kernelState: null,
    ...overrides,
  };
}

describe('V2026-11-05 · 调试会话持久化', () => {
  let dir = '';
  let store: DebugSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'debug-sessions-'));
    store = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never);
  });

  afterEach(async () => {
    // maxRetries/retryDelay: Windows 上递归删目录会偶发 ENOTEMPTY
    //   (Node 的 fs.rm 默认 maxRetries=0, 不重试; 高负载全量跑时目录项可能还在落盘).
    //   口径与 test/admin-debug/wp38-debug-session-resume.spec.ts 一致.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // ── ① 文件存储 ───────────────────────────────────────────────────────────
  describe('① 文件存储', () => {
    it('建档 → 目录里出现 {id}.json, 内容含 id / 标题 / 角色 / 创建时刻', async () => {
      const record = buildRecord('debug_a');
      await store.create(record);

      const files = await readdir(dir);
      expect(files).toEqual(['debug_a.json']);
      const raw = JSON.parse(await readFile(join(dir, 'debug_a.json'), 'utf8')) as Record<string, unknown>;
      expect(raw['id']).toBe('debug_a');
      expect(raw['titleSource']).toBe('fallback');
      expect(raw['characterSlug']).toBe('vpt_x');
      expect(raw['createdAt']).toBe('2026-11-05T12:00:00.000Z');
      expect(raw['turnCount']).toBe(0);
    });

    it('追加一轮 → messages +2 (咨询师 / 来访者), traces +1, turnCount +1', async () => {
      await store.create(buildRecord('debug_a'));
      await store.appendTurn(
        'debug_a',
        { role: 'counselor', text: '最近怎么样？', turnIndex: 1, ts: '2026-11-05T12:00:01.000Z' },
        { role: 'visitor', text: '不太好。', turnIndex: 1, ts: '2026-11-05T12:00:02.000Z' },
        { turnIndex: 1, bdiSnapshot: { trust: 0.3 } },
      );

      const record = await store.get('debug_a');
      expect(record?.turnCount).toBe(1);
      expect(record?.messages).toHaveLength(2);
      expect(record?.messages[0]?.role).toBe('counselor');
      expect(record?.messages[1]?.role).toBe('visitor');
      expect(record?.traces).toHaveLength(1);
    });

    it('中途崩溃不丢数据 → 写完这一轮就能读回来 (不用等关会话)', async () => {
      await store.create(buildRecord('debug_a'));
      await store.appendTurn(
        'debug_a',
        { role: 'counselor', text: '第一句', turnIndex: 1, ts: '2026-11-05T12:00:01.000Z' },
        { role: 'visitor', text: '第一句回应', turnIndex: 1, ts: '2026-11-05T12:00:02.000Z' },
        { turnIndex: 1 },
      );

      // 模拟"进程崩了" → 只看文件, 不走任何内存态.
      const reopened = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never);
      const record = await reopened.get('debug_a');
      expect(record?.turnCount).toBe(1);
      expect(record?.messages[1]?.text).toBe('第一句回应');
    });

    it('原子写 → 目录里不残留 .tmp 文件', async () => {
      await store.create(buildRecord('debug_a'));
      const files = await readdir(dir);
      expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });

    it('人工改标题 → titleSource=manual; 之后的自动命名**盖不掉**它', async () => {
      await store.create(buildRecord('debug_a'));
      const updated = await store.updateTitle('debug_a', '我改的标题', 'manual');
      expect(updated?.title).toBe('我改的标题');
      expect(updated?.titleSource).toBe('manual');

      const afterLlm = await store.updateTitle('debug_a', 'LLM 起的标题', 'llm');
      expect(afterLlm?.title).toBe('我改的标题');
      expect(afterLlm?.titleSource).toBe('manual');
    });

    it('兜底标题 → 自动命名可以覆盖它 (来源变 llm)', async () => {
      await store.create(buildRecord('debug_a'));
      const updated = await store.updateTitle('debug_a', '悲伤回避型来访者', 'llm');
      expect(updated?.title).toBe('悲伤回避型来访者');
      expect(updated?.titleSource).toBe('llm');
    });

    it('标完成 → status=completed', async () => {
      await store.create(buildRecord('debug_a'));
      const record = await store.markCompleted('debug_a');
      expect(record?.status).toBe('completed');
    });

    it('列表 → 按创建时间倒序', async () => {
      await store.create(buildRecord('debug_a', { createdAt: '2026-11-05T10:00:00.000Z' }));
      await store.create(buildRecord('debug_b', { createdAt: '2026-11-05T12:00:00.000Z' }));

      const list = await store.list();
      expect(list.map((s) => s.id)).toEqual(['debug_b', 'debug_a']);
    });

    it('删除 → 文件没了, 再读是 null', async () => {
      await store.create(buildRecord('debug_a'));
      expect(await store.remove('debug_a')).toBe(true);
      expect(await store.get('debug_a')).toBeNull();
      expect(await readdir(dir)).toEqual([]);
    });

    it('坏文件跳过, 不让列表页 500', async () => {
      await store.create(buildRecord('debug_a'));
      await writeFile(join(dir, 'broken.json'), '{ 这不是 JSON', 'utf8');

      const list = await store.list();
      expect(list.map((s) => s.id)).toEqual(['debug_a']);
    });

    it('会话 id 走路径穿越 (../) → 直接拒绝 (不写到目录外面)', async () => {
      expect(await store.remove('../../etc/passwd')).toBe(false);
      expect(await store.get('../../etc/passwd')).toBeNull();
    });
  });

  // ── ② 保留上限 ───────────────────────────────────────────────────────────
  describe(`② 保留最近 ${MAX_DEBUG_SESSIONS} 个会话`, () => {
    it(`超出 ${MAX_DEBUG_SESSIONS} 个 → 最旧的被自动删掉`, async () => {
      // createdAt **严格递增** (每场 +1 秒) → 淘汰名单唯一确定.
      //
      // ⚠️ 为什么不能用 `12:${i % 60}` 那种写法:
      //   它只保证**前 60 场**的时间戳互不相同. MAX_DEBUG_SESSIONS 从 50 抬到 500
      //   (commit 1cd56ee, 为了批量实验不吃掉对比基线) 之后, 场次数超过 60,
      //   时间戳开始**每 60 场循环一次** → 同秒的场次并列 → prune 按 createdAt
      //   排序时"最旧的 3 个"具体是哪几个变得不确定 (取决于 readdir 顺序).
      //   这**不是生产逻辑的 bug** (prune 保留的是 createdAt 最新的 MAX 个, 语义正确),
      //   是**夹具造法**依赖了"场数 < 60"这个已经失效的前提 —— 断言因此随机红.
      const base = Date.parse('2026-11-05T12:00:00.000Z');
      for (let i = 0; i < MAX_DEBUG_SESSIONS + 3; i += 1) {
        await store.create(buildRecord(`debug_${String(i).padStart(3, '0')}`, { createdAt: new Date(base + i * 1000).toISOString() }));
      }

      const files = await readdir(dir);
      expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(MAX_DEBUG_SESSIONS);
      // 最旧的三个 (000 / 001 / 002) 没了, 最新的还在.
      expect(files).not.toContain('debug_000.json');
      expect(files).not.toContain('debug_001.json');
      expect(files).not.toContain('debug_002.json');
      expect(files).toContain(`debug_${String(MAX_DEBUG_SESSIONS + 2).padStart(3, '0')}.json`);
      // 单独给 120s 超时: 这条用例要建 503 个会话, 而 **每次 create 都会触发一次
      //   prune()** —— prune 是个平方级 IO (readdir + 逐个 readFile + JSON.parse
      //   全部会话文件, 上限 500) → 建 503 场约 12 万次文件读.
      //   单独跑约 7~9s, 但全量跑时 (174 个 worker 并行 + 同机其它任务) 会超过
      //   vitest 全局 30s 的 testTimeout → 随机红.
      //   ⚠️ 治本 (prune 改用内存索引, 不再每次读盘) 属**生产代码**改动, 不在
      //   本单范围 —— 这里只把超时放宽, 断言一个字没动.
    }, 120_000);
  });

  // ── ③ 标题生成 ───────────────────────────────────────────────────────────
  describe('③ 标题生成', () => {
    it('兜底标题 = "未命名会话 - {上海时间}"', () => {
      expect(buildFallbackTitle('2026-11-05T12:00:00.000Z')).toBe('未命名会话 - 2026-11-05 20:00');
      expect(formatShanghaiMinute('2026-11-05T12:00:00.000Z')).toBe('2026-11-05 20:00');
    });

    it('解析模型输出 → 剥引号 / 剥前缀 / 只取第一行 / 截断', () => {
      expect(parseDebugSessionTitle('  悲伤回避型来访者  ')).toBe('悲伤回避型来访者');
      expect(parseDebugSessionTitle('"悲伤回避型来访者"')).toBe('悲伤回避型来访者');
      expect(parseDebugSessionTitle('标题：初始访谈')).toBe('初始访谈');
      expect(parseDebugSessionTitle('第一行\n第二行解释')).toBe('第一行');
      expect(parseDebugSessionTitle('```\n悲伤回避型\n```')).toBe('悲伤回避型');
      expect(parseDebugSessionTitle('x'.repeat(80))).toHaveLength(MAX_DEBUG_SESSION_TITLE_LENGTH);
      // 模型没给出可用内容 → 空串 (**不编一个**).
      expect(parseDebugSessionTitle(' '.repeat(3))).toBe('');
    });

    it('详情视图 → trace 挂在**来访者**那条消息上 (与前端实时路径同款)', () => {
      const record = buildRecord('debug_a', {
        messages: [
          { role: 'counselor', text: '最近怎么样？', turnIndex: 1, ts: '2026-11-05T12:00:01.000Z' },
          { role: 'visitor', text: '不太好。', turnIndex: 1, ts: '2026-11-05T12:00:02.000Z' },
        ],
        traces: [{ turnIndex: 1, bdiSnapshot: { trust: 0.3 } }],
      });

      const detail = projectDebugSessionDetail(record);
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[0]?.trace).toBeNull();
      expect(detail.messages[1]?.trace).toMatchObject({ turnIndex: 1 });
      expect(detail.turnCount).toBe(0);
    });
  });

  // ── ④ 存储目录解析 ───────────────────────────────────────────────────────
  describe('④ 存储目录', () => {
    it('env 覆盖 → 用它; 没配 → 落到 data/debug-sessions', () => {
      expect(resolveStoreDir(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never)).toBe(dir);
      expect(resolveStoreDir(stubConfig({}) as never)).toMatch(/data[\\/]debug-sessions$/);
    });
  });

  // ── ⑤ 错误码 ─────────────────────────────────────────────────────────────
  describe('⑤ 边界', () => {
    it('读不存在的会话 → null (不是抛错)', async () => {
      expect(await store.get('debug_missing')).toBeNull();
    });

    it('BizCode 里资源不存在用的是 ResourceNotFound', () => {
      expect(BizCode.ResourceNotFound).toBe(1002);
    });
  });

  // ── ⑥ 服务编排 (建档 / 追加 / 自动命名 / 关闭) ──────────────────────────
  describe('⑥ 服务编排', () => {
    it('建会话 → 立刻建档 (兜底标题); 每轮 → 追加一条', async () => {
      const { service, engine } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);

      const createdRecord = await store.get(created.sessionId);
      expect(createdRecord?.titleSource).toBe('fallback');
      expect(createdRecord?.title).toContain('未命名会话');
      expect(createdRecord?.turnCount).toBe(0);

      engine.queue.push(makeTurnResult(1));
      await service.runTurn(created.sessionId, '第一句');

      const afterTurn = await store.get(created.sessionId);
      expect(afterTurn?.turnCount).toBe(1);
      expect(afterTurn?.messages).toHaveLength(2);
    });

    it('跑满 3 轮 → 自动生成标题 (覆盖兜底标题)', async () => {
      const { service, engine, titleGenerator } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);

      for (let i = 1; i <= 3; i += 1) {
        engine.queue.push(makeTurnResult(i));
        await service.runTurn(created.sessionId, `第 ${i} 句`);
      }
      await waitFor(async () => (await store.get(created.sessionId))?.titleSource === 'llm');

      expect(titleGenerator.calls).toHaveLength(1);
      const record = await store.get(created.sessionId);
      expect(record?.title).toBe('悲伤回避型来访者 - 初始访谈');
      expect(record?.titleSource).toBe('llm');
    });

    it('不到 3 轮 → 不生成标题 (1/2 轮看不出这场在聊什么)', async () => {
      const { service, engine, titleGenerator } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);

      for (let i = 1; i <= 2; i += 1) {
        engine.queue.push(makeTurnResult(i));
        await service.runTurn(created.sessionId, `第 ${i} 句`);
      }
      await settleAsync();

      expect(titleGenerator.calls).toHaveLength(0);
      expect((await store.get(created.sessionId))?.titleSource).toBe('fallback');
    });

    it('标题生成失败 → 保留兜底标题 (**不崩, 不留空标题**)', async () => {
      const { service, engine, titleGenerator } = buildService(dir);
      titleGenerator.failWith = new Error('LLM 挂了');
      const created = await service.createSession(KNOWN_SLUG);

      for (let i = 1; i <= 3; i += 1) {
        engine.queue.push(makeTurnResult(i));
        await service.runTurn(created.sessionId, `第 ${i} 句`);
      }
      // 等生成器**真的被调过** (它抛错了) —— 否则断言会在失败被 catch 之前执行 → 假绿.
      await waitFor(() => titleGenerator.calls.length === 1);
      await settleAsync();

      const record = await store.get(created.sessionId);
      expect(record?.titleSource).toBe('fallback');
      expect(record?.title).toContain('未命名会话');

      // ⚠️ "不崩"要真的验: 失败之后**下一轮照常跑** (第 4 轮不再触发生成).
      engine.queue.push(makeTurnResult(4));
      await service.runTurn(created.sessionId, '第 4 句');
      expect((await store.get(created.sessionId))?.turnCount).toBe(4);
      expect(titleGenerator.calls).toHaveLength(1);
    });

    it('人工改过的标题 → 自动命名**盖不掉**', async () => {
      const { service, engine, titleGenerator } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);
      await service.updatePersistedTitle(created.sessionId, '我改的标题');

      for (let i = 1; i <= 3; i += 1) {
        engine.queue.push(makeTurnResult(i));
        await service.runTurn(created.sessionId, `第 ${i} 句`);
      }
      await settleAsync();

      expect(titleGenerator.calls).toHaveLength(0);
      expect((await store.get(created.sessionId))?.title).toBe('我改的标题');
    });

    it('关会话 → 文件标 completed; 删会话 → 文件没了', async () => {
      const { service, engine } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(1));
      await service.runTurn(created.sessionId, '第一句');

      service.closeSession(created.sessionId);
      await waitFor(async () => (await store.get(created.sessionId))?.status === 'completed');
      expect((await store.get(created.sessionId))?.status).toBe('completed');

      expect(await service.deletePersistedSession(created.sessionId)).toBe(true);
      expect(await store.get(created.sessionId)).toBeNull();
    });

    it('读历史会话 → 详情视图 (messages 里来访者那条自带 trace)', async () => {
      const { service, engine } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(1));
      await service.runTurn(created.sessionId, '第一句');

      const detail = await service.getPersistedSession(created.sessionId);
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[1]?.trace).not.toBeNull();
      expect(detail.messages[0]?.trace).toBeNull();
    });

    it('读不存在的历史会话 → 404', async () => {
      const { service } = buildService(dir);
      await expect(service.getPersistedSession('debug_missing')).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });
});
