// V2026-11-06 治本 (WP69 · 调试面板小改进 · 单测):
//   两件事, 各有各的坑:
//
//   ① 会话列表加 `active` (WP69 §2.4) —— 落盘的 `status` 与运行时的"还活着"**不是一回事**:
//      进程重启后, 文件里 status 仍是 'active', 但内存里已经没有这场会话了 (内核句柄没了).
//      前端刷新页面后据此区分"可继续聊"与"只读历史" —— 判错 = 一场活着的会话被误判成只读.
//
//   ② consent 路径修复 (WP69 §2.3) —— 原先读的是**平铺键** 'consentCurrentVersion',
//      而 default.ts 里它在 config.consent 命名空间下 → 读出来恒 undefined → 配了不生效.
//      本单修成 'consent' 命名空间, 并让**两个** consent service 同一口径.
//
//   边界: 全 mock, 不起 Nest 容器, 不连 DB, 不发网络.
//
//   验证: npx vitest run test/admin-debug/wp69-debug-panel-improvements.spec.ts

import { describe, expect, it, vi } from 'vitest';

import type { DebugSessionSummary } from '../../src/admin-debug/debug-session-store.js';
import { DebugSessionService } from '../../src/admin-debug/debug-session.service.js';
import { ConsentService as SharedConsentService } from '../../src/consent/providers/consent.service.js';
import { ConsentService as ProfileConsentService } from '../../src/profile/providers/consent.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 已知角色代号 (解析器替身只认它). */
const KNOWN_SLUG = 'vpt_intimate_avoidance_l1';

/**
 * 假配置服务 (按 key 返回值; 支持嵌套对象形态).
 *
 * @param values 配置字典 (键即 config.get 收到的 path)
 * @returns 配置服务替身
 */
function stubConfig(values: Record<string, unknown>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}

/**
 * 造一条落盘会话摘要.
 *
 * @param id 会话 id
 * @param status 落盘状态
 * @returns 摘要
 */
function makeSummary(id: string, status: DebugSessionSummary['status'] = 'active'): DebugSessionSummary {
  return {
    id,
    title: `会话 ${id}`,
    characterSlug: KNOWN_SLUG,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    turnCount: 1,
    status,
    resumable: true,
  };
}

/**
 * 造一套调试服务 (替身全注入).
 *
 * @param summaries 落盘列表 (可变: 建完会话后可以往里塞同 id 的摘要)
 * @returns 服务实例
 */
function buildService(summaries: DebugSessionSummary[]): DebugSessionService {
  const engine = {
    open: (input: { readonly sessionId: string }) => ({
      handleId: `handle-${input.sessionId}`,
      sessionId: input.sessionId,
    }),
    close: () => {},
    turnStream: async () => {
      throw new Error('本用例不跑引擎');
    },
  };
  const resolver = {
    resolve: async () => ({
      characterProfile: { coreBeliefs: [], attachmentStyle: 'avoidant' as const },
      displayName: '亲密回避型 L1',
    }),
  };
  const redis = { get: async () => null };
  const store = {
    list: async () => summaries,
    create: async (record: unknown) => record,
    appendTurn: async () => null,
    updateTitle: async () => null,
    markCompleted: async () => null,
    get: async () => null,
    remove: async () => true,
  };
  const titleGenerator = { generate: async () => '兜底标题' };
  return new DebugSessionService(
    engine as unknown as ConstructorParameters<typeof DebugSessionService>[0],
    resolver as unknown as ConstructorParameters<typeof DebugSessionService>[1],
    redis as unknown as ConstructorParameters<typeof DebugSessionService>[2],
    stubConfig({ ENGINE_DEBUG_CHAT_ENABLED: 'true' }) as unknown as ConstructorParameters<typeof DebugSessionService>[3],
    store as unknown as ConstructorParameters<typeof DebugSessionService>[4],
    titleGenerator,
    {
      restoreBdiState: async () => 'restored' as const,
      restoreMemories: async () => 0,
    } as unknown as ConstructorParameters<typeof DebugSessionService>[6],
  );
}

describe('WP69 · 调试面板小改进', () => {
  // ── ① 会话列表的 active 字段 ─────────────────────────────────────
  describe('① 会话列表加 active 字段', () => {
    it('内存里有运行时状态的会话 → active=true (刷新后仍能继续聊)', async () => {
      const summaries: DebugSessionSummary[] = [];
      const service = buildService(summaries);
      const created = await service.createSession(KNOWN_SLUG);
      summaries.push(makeSummary(created.sessionId));

      const listed = await service.listPersistedSessions();

      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(created.sessionId);
      expect(listed[0]?.active).toBe(true);
    });

    it('只在落盘文件里、内存里没有的会话 → active=false (只读历史)', async () => {
      const service = buildService([makeSummary('debug_old')]);

      const listed = await service.listPersistedSessions();

      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe('debug_old');
      expect(listed[0]?.active).toBe(false);
    });

    it('落盘 status=active 但内存里没有 → active=false (status 不等于活跃)', async () => {
      const service = buildService([makeSummary('debug_stale', 'active')]);

      const listed = await service.listPersistedSessions();

      // 进程重启后的典型状态: 文件里写着 active, 内存里已经空了.
      expect(listed[0]?.status).toBe('active');
      expect(listed[0]?.active).toBe(false);
    });

    it('关掉会话后 → active 变 false (内存句柄已释放)', async () => {
      const summaries: DebugSessionSummary[] = [];
      const service = buildService(summaries);
      const created = await service.createSession(KNOWN_SLUG);
      summaries.push(makeSummary(created.sessionId));

      expect((await service.listPersistedSessions())[0]?.active).toBe(true);

      service.closeSession(created.sessionId);

      expect((await service.listPersistedSessions())[0]?.active).toBe(false);
    });
  });

  // ── ② consent 路径修复 ──────────────────────────────────────────
  // V2026-11-14 (TD-17 · C2 第一批仓储端口化): consent service 的第一个构造参数由
  //   typeorm 仓储对象改为**仓储端口**, 替身形状随之改为 findLatestByDevice
  //   (checkStatus 走的端口方法) —— **断言逐字不变**, 只换替身的方法名.
  describe('② consent 路径修复', () => {
    it('心塑/魔方 consent service: 配 consent.currentVersion=v2.0 → 真生效', async () => {
      const service = new SharedConsentService(
        { findLatestByDevice: async () => null } as never,
        stubConfig({ consent: { currentVersion: 'v2.0' } }) as never,
      );

      const status = await service.checkStatus('device-1', 'terms', 'xin_su');
      expect(status.currentVersion).toBe('v2.0');
    });

    it('心塑/魔方 consent service: 旧的平铺键 consentCurrentVersion 不再生效', async () => {
      const service = new SharedConsentService(
        { findLatestByDevice: async () => null } as never,
        // 两个都配: 命名空间的是 v2.0, 平铺的是 v9.9 —— 只认命名空间那个.
        stubConfig({ consent: { currentVersion: 'v2.0' }, consentCurrentVersion: 'v9.9' }) as never,
      );

      const status = await service.checkStatus('device-1', 'terms', 'xin_su');
      expect(status.currentVersion).toBe('v2.0');
    });

    it('心塑/魔方 consent service: 没配时回落 v1.0', async () => {
      const service = new SharedConsentService({ findLatestByDevice: async () => null } as never, stubConfig({}) as never);

      const status = await service.checkStatus('device-1', 'terms', 'xin_su');
      expect(status.currentVersion).toBe('v1.0');
    });

    it('profile consent service: 文档版本跟着 config 走 (不再硬编码)', async () => {
      const service = new ProfileConsentService({} as never, stubConfig({ consent: { currentVersion: 'v2.0' } }) as never);

      const document = await service.getDocument();
      expect(document.version).toBe('v2.0');
    });

    it('profile consent service: 没配时仍是 v1.0', async () => {
      const service = new ProfileConsentService({} as never, stubConfig({}) as never);

      const document = await service.getDocument();
      expect(document.version).toBe('v1.0');
    });
  });
});
