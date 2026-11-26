// AF-526 单测: runner 启动清理与会话租约入口.
//   覆盖: 有租约的 running 跳过 / 无租约的孤儿标记 failed / 未注入租约跳过 / 租约探测失败不误标 /
//         抢不到租约时不落 running 行.
//   全替身: 不起 Nest 容器, 不连 DB / Redis.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';

vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

type CounselorGenerateSignature = (
  mode: CounselorMode,
  history: readonly CounselorHistoryTurn[],
  options?: CounselorGenerateOptions,
) => Promise<CounselorReply>;

function makeMode(): CounselorMode {
  const mode = new CounselorMode();
  mode.id = 'expert';
  mode.name = '专家';
  mode.systemPrompt = '你是专家';
  mode.description = '';
  mode.enabled = 1;
  mode.sortOrder = 1;
  return mode;
}

function makeRepo() {
  const saved: Record<string, unknown>[] = [];
  return {
    saved,
    create: (fields: unknown) => fields,
    save: vi.fn(async (row: Record<string, unknown>) => {
      saved.push(row);
      return row;
    }),
    update: vi.fn(async (_criteria: unknown, _fields: unknown) => {}),
    find: vi.fn(async () => [] as { id: string }[]),
  };
}

function makeRunner(
  repo: ReturnType<typeof makeRepo>,
  lease?: { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; hasActiveLease: ReturnType<typeof vi.fn> },
) {
  const engine = { open: vi.fn(async () => ({ debugSessionId: 'debug-a' })), turn: vi.fn(), close: vi.fn() };
  const counselor = { generate: vi.fn<CounselorGenerateSignature>() };
  const fingerprint = {
    build: vi.fn(async () => ({
      model: 'MiniMax-M3.1-Flash',
      characterSlug: 'vpt_test',
      characterVersion: '1.0.0',
      counselorModeId: 'expert',
      deliberationMode: 'rule_only',
      scenarioType: 'full_simulation',
      engineVersion: 'test',
      sessionSeed: 'single/test',
    })),
    resolvePromptVersionOnly: vi.fn(() => 'test-prompt'),
  };
  const runner = new PracticeRunnerService(
    engine,
    counselor as never,
    fingerprint as never,
    repo as never,
    undefined,
    undefined,
    undefined,
    undefined,
    lease as never,
  );
  return { runner, engine, fingerprint };
}

describe('PracticeRunnerService 启动清理 (AF-526)', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('只标记无租约的孤儿 running, 有租约的场次不动', async () => {
    repo.find.mockResolvedValue([{ id: 'active' }, { id: 'orphan' }]);
    const lease = {
      acquire: vi.fn(),
      release: vi.fn(),
      hasActiveLease: vi.fn(async (id: string) => id === 'active'),
    };
    const { runner } = makeRunner(repo, lease);

    await runner.onModuleInit();

    expect(repo.update).toHaveBeenCalledTimes(1);
    const criteria = repo.update.mock.calls[0]?.[0] as { id: { value: string[] } };
    expect(criteria.id.value).toEqual(['orphan']);
  });

  it('未注入租约服务时跳过清理, 不退回全表标记', async () => {
    repo.find.mockResolvedValue([{ id: 'running-a' }]);
    const { runner } = makeRunner(repo);

    await runner.onModuleInit();

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('租约探测失败时跳过本轮, 不误标任何 running', async () => {
    repo.find.mockResolvedValue([{ id: 'running-a' }]);
    const lease = {
      acquire: vi.fn(),
      release: vi.fn(),
      hasActiveLease: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const { runner } = makeRunner(repo, lease);

    await runner.onModuleInit();

    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('PracticeRunnerService 租约入口 (AF-526)', () => {
  it('抢不到租约时不落 running 行, 直接 failed/lease_unavailable', async () => {
    const repo = makeRepo();
    const lease = {
      acquire: vi.fn(async () => false),
      release: vi.fn(async () => {}),
      hasActiveLease: vi.fn(),
    };
    const { runner, engine } = makeRunner(repo, lease);

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 1,
      practiceSessionId: 'session-a',
    });

    expect(result.status).toBe('failed');
    expect(result.exitReason).toBe('lease_unavailable');
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]?.['status']).toBe('failed');
    expect(repo.saved[0]?.['status']).not.toBe('running');
    expect(engine.close).toHaveBeenCalledWith('debug-a');
  });
});
