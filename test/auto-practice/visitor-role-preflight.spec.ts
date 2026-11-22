// V2026-11-18 (AF-103): 批次入队前来访者角色存在性校验.
//
// 目的: 把「角色不存在」从 runner 内的运行期失败，前移到入口的整体拒绝。
// 本单测只钉入口行为：合法全部入队 / 全缺失零入队 / 部分缺失整体拒绝且列出缺失 slug。

import { describe, expect, it, vi } from 'vitest';

import { AutoPracticeController } from '../../src/auto-practice/auto-practice.controller.js';
import type { CharacterProfileResolver } from '../../src/engine-adapters/wiring/character/character-profile.resolver.js';

interface Fakes {
  readonly controller: AutoPracticeController;
  readonly queueEnqueue: ReturnType<typeof vi.fn>;
  readonly runnerRun: ReturnType<typeof vi.fn>;
}

function makeController(resolvable: ReadonlySet<string>): Fakes {
  const queueEnqueue = vi.fn(async () => {});
  const runnerRun = vi.fn(async () => {});
  const run = vi.fn(async () => {});
  const resolver: CharacterProfileResolver = {
    resolve: async (request) => {
      const templateId = request.templateId ?? '';
      if (!resolvable.has(templateId)) return null;
      return {
        characterProfile: { displayName: templateId } as never,
        displayName: templateId,
      };
    },
  };

  const controller = new AutoPracticeController(
    { run: runnerRun } as never,
    { enqueue: queueEnqueue, run } as never,
    {} as never,
    { findOne: async () => ({ id: 'expert', enabled: 1 }) } as never,
    {} as never,
    {} as never,
    resolver,
  );

  return { controller, queueEnqueue, runnerRun };
}

describe('AF-103 批次入队前角色存在性校验', () => {
  it('全部角色可解析时按组合入队', async () => {
    const fakes = makeController(new Set(['vpt_a', 'vpt_b']));
    const result = (await fakes.controller.enqueueBatch({
      characterSlugs: ['vpt_a', 'vpt_b'],
      counselorModeIds: ['expert'],
      repeats: 1,
    })) as { error?: string; enqueued?: number };

    expect(result.error).toBeUndefined();
    expect(result.enqueued).toBe(2);
    expect(fakes.queueEnqueue).toHaveBeenCalledTimes(2);
  });

  it('全部缺失时整体拒绝，队列零新增', async () => {
    const fakes = makeController(new Set());
    const result = (await fakes.controller.enqueueBatch({
      characterSlugs: ['vpt_missing_a', 'vpt_missing_b'],
      counselorModeIds: ['expert'],
      repeats: 1,
    })) as { error?: string; enqueued?: number };

    expect(result.error).toContain('vpt_missing_a');
    expect(result.error).toContain('vpt_missing_b');
    expect(fakes.queueEnqueue).not.toHaveBeenCalled();
  });

  it('部分缺失时整体拒绝，并只列出缺失角色', async () => {
    const fakes = makeController(new Set(['vpt_ok']));
    const result = (await fakes.controller.enqueueBatch({
      characterSlugs: ['vpt_ok', 'vpt_missing'],
      counselorModeIds: ['expert'],
      repeats: 1,
    })) as { error?: string; enqueued?: number };

    expect(result.error).toContain('vpt_missing');
    expect(result.error).not.toContain('vpt_ok');
    expect(fakes.queueEnqueue).not.toHaveBeenCalled();
  });

  it('单场启动同口径拒绝缺失角色', async () => {
    const fakes = makeController(new Set());
    const result = (await fakes.controller.startSession({
      characterSlug: 'vpt_missing',
      counselorModeId: 'expert',
    })) as { error?: string };

    expect(result.error).toContain('vpt_missing');
    expect(fakes.runnerRun).not.toHaveBeenCalled();
  });
});
