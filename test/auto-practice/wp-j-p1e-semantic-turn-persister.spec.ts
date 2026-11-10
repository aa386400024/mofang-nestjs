// V2026-11-10 建立 (WP-J P1e Phase2 — 来访者语义落库 · 单测):
//   覆盖交付记录 §验收:
//     ① **三级降级路径**: Level 0 / 1 / 2 各自落到 visitor_semantic_level;
//     ② **5 列一条 SQL**: upsert 只调一次, 冲突键 = (practiceSessionId, turnIndex);
//     ③ **三份拆解**: displayText (无标记) / ttsText (MiniMax 标记) / semanticJson (语义 IR);
//     ④ **失败不吞**: DB 报错时异常抛给调用方 (由 runner 兜住, 不炸整批对练);
//     ⑤ **隐私**: 日志里只有 sessionId / turnIndex / 计数, 没有对话原文.
//
//   全 mock: repo 是替身, **不连 MySQL**; 解析与适配跑真代码 (那才是被测对象).
//
//   验证: npx vitest run test/auto-practice/wp-j-p1e-semantic-turn-persister.spec.ts
//   时间戳: 2026-11-10

import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SEMANTIC_VERSION, SemanticTurnPersister } from '../../src/auto-practice/semantic/semantic-turn.persister.js';

/**
 * 假 repo: 记录 upsert 调用.
 *
 * @returns 替身 repo
 */
function stubRepo() {
  // ⚠️ 必须给 mock 显式参数签名 —— 无参 mock 的 calls 是空元组, 断言里取 call[0] 会报 TS2493.
  const upsert = vi.fn(async (_row: Record<string, unknown>, _conflictPaths?: string[]) => ({
    identifiers: [],
    generatedMaps: [],
    raw: [],
  }));
  return { upsert };
}

/**
 * 取最后一次 upsert 的落库字段.
 *
 * @param repo 假 repo
 * @returns 落库字段
 */
function written(repo: ReturnType<typeof stubRepo>): Record<string, unknown> {
  const call = repo.upsert.mock.calls.at(-1);
  if (!call) throw new Error('upsert 没被调用');
  return call[0] ?? {};
}

describe('WP-J P1e Phase2 · 来访者语义落库', () => {
  it('① Level 0: 干净文本 → 5 列落库, 语义级别 0', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 3,
      rawVisitorText: '我最近状态还算稳。',
    });

    const row = written(repo);
    expect(row['practiceSessionId']).toBe('sess_1');
    expect(row['turnIndex']).toBe(3);
    expect(row['visitorDisplayText']).toBe('我最近状态还算稳。');
    expect(row['visitorTtsText']).toBe('我最近状态还算稳。');
    expect(row['visitorSemanticLevel']).toBe(0);
    expect(row['visitorSemanticVersion']).toBe(SEMANTIC_VERSION);
    expect(row['visitorSemanticVersion']).toBe('semantic-v1');
  });

  it('② 三份拆解: displayText 去标记, ttsText 带 MiniMax 标记', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 1,
      rawVisitorText: '[sigh]我最近有点累[pause:0.5]。',
    });

    const row = written(repo);
    expect(row['visitorDisplayText']).toBe('我最近有点累。');
    expect(row['visitorTtsText']).toBe('(sighs)我最近有点累<#0.5#>。');
  });

  it('③ Level 1: 标记被纠正 → 级别落 1, 语义仍然可用', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 2,
      rawVisitorText: '[sighs]你好',
    });

    const row = written(repo);
    expect(row['visitorSemanticLevel']).toBe(1);
    expect(row['visitorTtsText']).toBe('(sighs)你好');
  });

  it('④ Level 2: 非法字符超阈值 → 级别落 2, 语义字段作废但正文仍在', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 4,
      rawVisitorText: '[aaaaaa][bbbbbb][cccccc]' + 'x'.repeat(60),
    });

    const row = written(repo);
    expect(row['visitorSemanticLevel']).toBe(2);
    expect(String(row['visitorDisplayText'])).toContain('x'.repeat(60));
  });

  it('⑤ 5 列一条 SQL: upsert 只调一次, 冲突键是 (场次, 轮次)', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 7,
      rawVisitorText: '你好',
    });

    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.upsert.mock.calls[0]?.[1]).toEqual(['practiceSessionId', 'turnIndex']);
  });

  it('⑥ semanticJson 序列化的是完整语义 IR (字段恒存在)', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 1,
      rawVisitorText: '[sigh]你好[emotion:sad]',
    });

    const row = written(repo);
    const parsed = JSON.parse(String(row['visitorSemanticJson'])) as Record<string, unknown>;
    expect(Object.keys(parsed).toSorted()).toEqual(['controlTags', 'emotion', 'pauses', 'preSpeech', 'text', 'unknownTags'].toSorted());
    expect(parsed['text']).toBe('你好');
    expect(parsed['preSpeech']).toBe('sigh');
    expect(parsed['emotion']).toBe('sad');
  });

  it('⑦ 情绪进 semanticJson, 不进 ttsText (情绪走 voice_setting 参数)', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 1,
      rawVisitorText: '你好[emotion:sad]',
    });

    const row = written(repo);
    expect(String(row['visitorTtsText'])).not.toContain('sad');
    expect(String(row['visitorSemanticJson'])).toContain('sad');
  });

  it('⑧ 控制标记进 semanticJson, 不进 displayText', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 1,
      rawVisitorText: '谢谢你。[[STATE:END]]',
    });

    const row = written(repo);
    expect(row['visitorDisplayText']).toBe('谢谢你。');
    expect(String(row['visitorSemanticJson'])).toContain('END');
    expect(String(row['visitorTtsText'])).not.toContain('STATE');
  });

  it('⑨ DB 失败 → 异常抛给调用方 (不吞: 吞了就没人知道这轮语义丢了)', async () => {
    const repo = stubRepo();
    repo.upsert.mockRejectedValueOnce(new Error('db down'));
    const persister = new SemanticTurnPersister(repo as never);

    await expect(
      persister.persistVisitorTurn({
        practiceSessionId: 'sess_1',
        turnIndex: 1,
        rawVisitorText: '你好',
      }),
    ).rejects.toThrow('db down');
  });

  it('⑩ 隐私: 日志里只有 sessionId / turnIndex / 计数, 没有对话原文', async () => {
    const spy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    try {
      const repo = stubRepo();
      const persister = new SemanticTurnPersister(repo as never);
      await persister.persistVisitorTurn({
        practiceSessionId: 'sess_1',
        turnIndex: 5,
        rawVisitorText: '我想死',
      });
      const dumped = JSON.stringify(spy.mock.calls);
      expect(dumped).not.toContain('我想死');
      expect(dumped).toContain('sess_1');
    } finally {
      spy.mockRestore();
    }
  });

  it('⑪ 厂商标记 (LLM 直接吐 MiniMax 标记) 也能拆成三份', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 1,
      rawVisitorText: '(sighs)我最近不太好。',
    });

    const row = written(repo);
    expect(row['visitorDisplayText']).toBe('我最近不太好。');
    expect(row['visitorTtsText']).toBe('(sighs)我最近不太好。');
  });

  it('⑫ 同一 (场次, 轮次) 再落一次 → 仍走同一冲突键 (幂等由 DB 保证)', async () => {
    const repo = stubRepo();
    const persister = new SemanticTurnPersister(repo as never);

    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 2,
      rawVisitorText: '你好',
    });
    await persister.persistVisitorTurn({
      practiceSessionId: 'sess_1',
      turnIndex: 2,
      rawVisitorText: '你好',
    });

    expect(repo.upsert).toHaveBeenCalledTimes(2);
    for (const call of repo.upsert.mock.calls) {
      expect(call[1]).toEqual(['practiceSessionId', 'turnIndex']);
    }
  });
});
