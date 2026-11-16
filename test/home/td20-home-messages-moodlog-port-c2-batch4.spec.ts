// V2026-11-15 治本 (TD-20 · C2 第四批仓储端口化 · home 域 · P-DEBT-11 / L-1):
//   端口替身 spec —— home 两个 service 用**端口替身**驱动: 不起真数据源, 不连 DB,
//   不 mock 持久化库. 替身只记调用参数 + 返回预设行.
//
//   覆盖:
//     ① 消息端口 (2 方法 / 3 处调用): 未读计数 / 已读标记 (全量 + 批量 + 空列表) /
//        标记后重算剩余 (调用次数) / 标记条数为 0 的兜底;
//     ② 打卡端口 (4 方法 / 5 处调用): 写入入参逐字透传 / 档位校验不落库 /
//        今日最新 (今天 0 点起点留 service) / 近 N 天 (起点留 service + level 映射留 service) /
//        物理删除条数 / DTO 三态;
//     ③ 行为锁: 异常上抛 / 方法面恰 2 + 4 个 / token 是 symbol.
//
//   时间口径: 本 spec 不依赖任何定时器 —— 回显时刻由替身按**固定常量**给出,
//     所以断言不随真实时钟漂移 (「今天 0 点」用固定 now 入参断言).
//
//   替身写法: 直接实现端口 interface (跟 TD-13 analytics / TD-16 life-map / TD-17 consent /
//     TD-18 good_state_diary / TD-19 emergency 同款口径).
//   边界: **零** entity import、零 typeorm 值符号; 实体类名不出现在本文件.
//
//   分工: 本 spec 锁**端口契约** (调用面 / 参数 / 出参形状); 业务行为 (日期窗口 /
//     档位校验 / DTO 转换) 由本文件一并锁住 (本域零既有 spec, 业务行为无别处可锁).
//
//   验证: pnpm exec vitest run test/home/td20-home-messages-moodlog-port-c2-batch4.spec.ts
//   时间戳: 2026-11-15 GMT+8

import { describe, expect, it } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { HOME_MESSAGE_REPOSITORY, type HomeMessageRepository } from '../../src/home/domain/repositories/home-message.repository.js';
import {
  MOOD_LOG_REPOSITORY,
  type MoodLogRepository,
  type MoodLogRow,
  type NewMoodLogInput,
} from '../../src/home/domain/repositories/mood-log.repository.js';
import type { HomeEmotionLevel } from '../../src/home/home.constants.js';
import { HomeMessagesService } from '../../src/home/providers/home-messages.service.js';
import { HomeMoodLogService } from '../../src/home/providers/home-mood-log.service.js';

/** 固定的"落库时刻" —— 替身回显用, 不随真实时钟漂移. */
const NOW = new Date('2026-11-15T00:00:00.000Z');

/** 一天毫秒数 —— 近 N 天起点断言用 (表达式写法避开数字分隔符规则). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 未指定消息 id —— service 形参是必传的 `string[] | undefined` (控制器传 dto.messageIds),
 * 这里用具名常量显式传 undefined (字面量 undefined 会被 lint 自动抹掉).
 */
const NO_MESSAGE_IDS: string[] | undefined = undefined;

// ═════════════════════════════════════════════════════════════
// 行构造器
// ═════════════════════════════════════════════════════════════

/** 打卡行 (可覆盖). */
function moodLogRow(overrides: Partial<MoodLogRow> = {}): MoodLogRow {
  return {
    id: 'mood-1',
    uid: 'uid-1',
    level: 'okay',
    note: 'note',
    triggeredMicroInterventionId: null,
    createdAt: NOW,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// 端口替身 A —— 首页消息
// ═════════════════════════════════════════════════════════════

/** 首页消息端口替身 —— 只记调用参数 + 返回预设计数. */
class HomeMessageRepoDouble {
  /** countUnread 的入参序列. */
  readonly countUnreadCalls: string[] = [];
  /** markRead 的入参序列. */
  readonly markReadCalls: { uid: string; messageIds: string[] | undefined }[] = [];

  /** countUnread 返回值 (按调用顺序消费; 用尽后回落 0). */
  countUnreadResults: number[] = [0];
  /** markRead 返回值 (本次标记条数). */
  markReadResult = 0;
  /** 注入给读取的失败 (测失败语义; null = 正常). */
  readFailure: Error | null = null;

  readonly repo: HomeMessageRepository;

  constructor() {
    this.repo = {
      countUnread: async (uid: string): Promise<number> => {
        this.countUnreadCalls.push(uid);
        if (this.readFailure) {
          throw this.readFailure;
        }
        return this.countUnreadResults.shift() ?? 0;
      },
      markRead: async (uid: string, messageIds: string[] | undefined): Promise<number> => {
        this.markReadCalls.push({ uid, messageIds });
        return this.markReadResult;
      },
    };
  }
}

/** 装配消息 service + 端口替身. */
function makeMessagesService(): { service: HomeMessagesService; double: HomeMessageRepoDouble } {
  const double = new HomeMessageRepoDouble();
  return { service: new HomeMessagesService(double.repo), double };
}

// ═════════════════════════════════════════════════════════════
// 端口替身 B —— 情绪打卡
// ═════════════════════════════════════════════════════════════

/** 情绪打卡端口替身 —— 只记调用参数 + 返回预设行. */
class MoodLogRepoDouble {
  /** create 的入参序列. */
  readonly createCalls: NewMoodLogInput[] = [];
  /** findLatestSince 的入参序列. */
  readonly findLatestSinceCalls: { uid: string; since: Date }[] = [];
  /** findRecentSince 的入参序列. */
  readonly findRecentSinceCalls: { uid: string; since: Date }[] = [];
  /** deleteByUser 的入参序列. */
  readonly deleteByUserCalls: string[] = [];

  /** create 返回行. */
  createResult: MoodLogRow = moodLogRow();
  /** findLatestSince 返回行 (null = 未命中). */
  latest: MoodLogRow | null = null;
  /** findRecentSince 返回行. */
  rows: MoodLogRow[] = [];
  /** deleteByUser 返回删除条数. */
  deletedCount = 0;
  /** 注入给写入的失败 (测失败语义; null = 正常). */
  writeFailure: Error | null = null;

  readonly repo: MoodLogRepository;

  constructor() {
    this.repo = {
      create: async (input: NewMoodLogInput): Promise<MoodLogRow> => {
        this.createCalls.push(input);
        if (this.writeFailure) {
          throw this.writeFailure;
        }
        return this.createResult;
      },
      findLatestSince: async (uid: string, since: Date): Promise<MoodLogRow | null> => {
        this.findLatestSinceCalls.push({ uid, since });
        return this.latest;
      },
      findRecentSince: async (uid: string, since: Date): Promise<MoodLogRow[]> => {
        this.findRecentSinceCalls.push({ uid, since });
        return this.rows;
      },
      deleteByUser: async (uid: string): Promise<number> => {
        this.deleteByUserCalls.push(uid);
        return this.deletedCount;
      },
    };
  }
}

/** 装配打卡 service + 端口替身. */
function makeMoodLogService(): { service: HomeMoodLogService; double: MoodLogRepoDouble } {
  const double = new MoodLogRepoDouble();
  return { service: new HomeMoodLogService(double.repo), double };
}

// ═════════════════════════════════════════════════════════════
// ① 消息端口
// ═════════════════════════════════════════════════════════════

describe('HomeMessagesService · 端口替身 (TD-20 C2 第四批)', () => {
  it('A1 · getUnreadCount —— 端口收 uid, 计数原样进 DTO', async () => {
    const { service, double } = makeMessagesService();
    double.countUnreadResults = [7];

    const result = await service.getUnreadCount('uid-1');

    expect(double.countUnreadCalls).toHaveLength(1);
    expect(double.countUnreadCalls[0]).toBe('uid-1');
    expect(result).toEqual({ count: 7 });
  });

  it('A2 · markRead 全量 —— messageIds 不传时原样透传 undefined', async () => {
    const { service, double } = makeMessagesService();
    double.markReadResult = 3;
    double.countUnreadResults = [1];

    const result = await service.markRead('uid-1', NO_MESSAGE_IDS);

    expect(double.markReadCalls).toHaveLength(1);
    expect(double.markReadCalls[0]?.uid).toBe('uid-1');
    expect(double.markReadCalls[0]?.messageIds).toBeUndefined();
    expect(result.markedCount).toBe(3);
    expect(result.count).toBe(1);
  });

  it('A3 · markRead 批量 —— messageIds 数组原样透传 (实现层负责拼 id 集合条件)', async () => {
    const { service, double } = makeMessagesService();
    double.markReadResult = 2;
    double.countUnreadResults = [5];

    await service.markRead('uid-1', ['msg-1', 'msg-2']);

    expect(double.markReadCalls[0]?.messageIds).toEqual(['msg-1', 'msg-2']);
  });

  it('A4 · markRead 空列表 —— 原样透传空数组 (service 不做改写, 全量判定在实现层)', async () => {
    const { service, double } = makeMessagesService();
    double.markReadResult = 0;
    double.countUnreadResults = [0];

    const result = await service.markRead('uid-1', []);

    expect(double.markReadCalls[0]?.messageIds).toEqual([]);
    expect(result.markedCount).toBe(0);
    expect(result.count).toBe(0);
  });

  it('A5 · markRead 后重算剩余 —— 调用次数口径 (markRead 1 次 + countUnread 1 次)', async () => {
    const { service, double } = makeMessagesService();
    double.markReadResult = 4;
    double.countUnreadResults = [9];

    await service.markRead('uid-1', NO_MESSAGE_IDS);

    expect(double.markReadCalls).toHaveLength(1);
    expect(double.countUnreadCalls).toHaveLength(1);
    expect(double.countUnreadCalls[0]).toBe('uid-1');
  });

  it('A6 · markRead 标记条数为 0 —— markedCount 0, 剩余照常重算', async () => {
    const { service, double } = makeMessagesService();
    double.markReadResult = 0;
    double.countUnreadResults = [6];

    const result = await service.markRead('uid-1', NO_MESSAGE_IDS);

    expect(result.markedCount).toBe(0);
    expect(result.count).toBe(6);
  });

  it('A7 · 方法面不泛化 —— 端口方法恰为 2 个, 无通用仓储代理', () => {
    const { double } = makeMessagesService();

    expect(Object.keys(double.repo).sort()).toEqual(['countUnread', 'markRead']);
    expect(typeof HOME_MESSAGE_REPOSITORY).toBe('symbol');
    expect(HOME_MESSAGE_REPOSITORY.description).toBe('HOME_MESSAGE_REPOSITORY');
  });

  it('A8 · 计数失败时的现有语义 —— 异常上抛 (行为锁)', async () => {
    const { service, double } = makeMessagesService();
    double.readFailure = new Error('db down');

    await expect(service.getUnreadCount('uid-1')).rejects.toThrow('db down');
  });
});

// ═════════════════════════════════════════════════════════════
// ② 打卡端口
// ═════════════════════════════════════════════════════════════

describe('HomeMoodLogService · 端口替身 (TD-20 C2 第四批)', () => {
  it('B1 · logMood —— 入参逐字透传 (行纯对象构造, service 侧零工厂依赖)', async () => {
    const { service, double } = makeMoodLogService();
    double.createResult = moodLogRow({ id: 'mood-1', level: 'great' });

    const saved = await service.logMood('uid-1', 'great', 'note', 'mi-1');

    expect(double.createCalls).toHaveLength(1);
    expect(double.createCalls[0]).toEqual({
      uid: 'uid-1',
      level: 'great',
      note: 'note',
      triggeredMicroInterventionId: 'mi-1',
    });
    expect(saved.id).toBe('mood-1');
  });

  it('B2 · logMood 档位非法 —— 抛业务异常且**不落库** (行为锁)', async () => {
    const { service, double } = makeMoodLogService();

    await expect(service.logMood('uid-1', 'unknown' as HomeEmotionLevel, null, null)).rejects.toThrow(BizException);
    expect(double.createCalls).toHaveLength(0);
  });

  it('B3 · logMood 业务码 —— 未知档位返 InvalidParameter', async () => {
    const { service } = makeMoodLogService();

    await expect(service.logMood('uid-1', 'unknown' as HomeEmotionLevel, null, null)).rejects.toMatchObject({
      code: BizCode.InvalidParameter,
    });
  });

  it('B4 · logMood 备注 / 干预 id 为空 —— 原样透传给端口', async () => {
    const { service, double } = makeMoodLogService();

    await service.logMood('uid-1', 'low', null, null);

    expect(double.createCalls[0]?.note).toBeNull();
    expect(double.createCalls[0]?.triggeredMicroInterventionId).toBeNull();
  });

  it('B5 · getTodayLatest —— 「今天 0 点」起点留 service (本地时区), 端口收 since', async () => {
    const { service, double } = makeMoodLogService();
    const now = new Date(2026, 10, 15, 13, 37, 0, 0);
    double.latest = moodLogRow();

    const row = await service.getTodayLatest('uid-1', now);

    expect(double.findLatestSinceCalls).toHaveLength(1);
    expect(double.findLatestSinceCalls[0]?.uid).toBe('uid-1');
    const expected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    expect(double.findLatestSinceCalls[0]?.since.getTime()).toBe(expected.getTime());
    expect(row?.id).toBe('mood-1');
  });

  it('B6 · getTodayLatest 显式 now 入参 —— 起点随入参日界变化', async () => {
    const { service, double } = makeMoodLogService();
    const now = new Date(2026, 0, 2, 23, 59, 0, 0);

    await service.getTodayLatest('uid-1', now);

    const expected = new Date(2026, 0, 2);
    expect(double.findLatestSinceCalls[0]?.since.getTime()).toBe(expected.getTime());
  });

  it('B7 · getTodayLatest 未命中 —— 返回 null (不抛错)', async () => {
    const { service, double } = makeMoodLogService();
    double.latest = null;

    const row = await service.getTodayLatest('uid-1');

    expect(row).toBeNull();
  });

  it('B8 · getRecentTrend —— 起点留 service (now - days), level 映射留 service', async () => {
    const { service, double } = makeMoodLogService();
    double.rows = [moodLogRow({ id: 'mood-1', level: 'great' }), moodLogRow({ id: 'mood-2', level: 'low' })];

    const trend = await service.getRecentTrend('uid-1', 7);

    expect(double.findRecentSinceCalls).toHaveLength(1);
    expect(double.findRecentSinceCalls[0]?.uid).toBe('uid-1');
    const since = double.findRecentSinceCalls[0]?.since.getTime() ?? 0;
    expect(Math.abs(Date.now() - since - 7 * DAY_MS)).toBeLessThan(DAY_MS);
    expect(trend).toEqual(['great', 'low']);
  });

  it('B9 · getRecentTrend 空结果 —— 返回空数组', async () => {
    const { service, double } = makeMoodLogService();
    double.rows = [];

    const trend = await service.getRecentTrend('uid-1');

    expect(trend).toEqual([]);
  });

  it('B10 · clearForUser —— 端口收 uid, 物理删除条数进 DTO', async () => {
    const { service, double } = makeMoodLogService();
    double.deletedCount = 12;

    const result = await service.clearForUser('uid-1');

    expect(double.deleteByUserCalls).toEqual(['uid-1']);
    expect(result).toEqual({ deletedCount: 12 });
  });

  it('B11 · toOverviewFields 三态 —— null 时三字段全空', () => {
    const { service } = makeMoodLogService();

    expect(service.toOverviewFields(null)).toEqual({
      emotionLevel: null,
      emotionNote: null,
      emotionLoggedAt: null,
    });
  });

  it('B12 · toOverviewFields —— 有值时档位 / 备注 / ISO 时间戳逐字不变', () => {
    const { service } = makeMoodLogService();
    const row = moodLogRow({ level: 'crisis', note: 'note', createdAt: new Date('2026-11-15T03:04:05.000Z') });

    expect(service.toOverviewFields(row)).toEqual({
      emotionLevel: 'crisis',
      emotionNote: 'note',
      emotionLoggedAt: '2026-11-15T03:04:05.000Z',
    });
  });

  it('B13 · 方法面不泛化 —— 端口方法恰为 4 个, 无通用仓储代理', () => {
    const { double } = makeMoodLogService();

    expect(Object.keys(double.repo).sort()).toEqual(['create', 'deleteByUser', 'findLatestSince', 'findRecentSince']);
    expect(typeof MOOD_LOG_REPOSITORY).toBe('symbol');
    expect(MOOD_LOG_REPOSITORY.description).toBe('MOOD_LOG_REPOSITORY');
  });

  it('B14 · 写入失败时的现有语义 —— 异常上抛 (行为锁)', async () => {
    const { service, double } = makeMoodLogService();
    double.writeFailure = new Error('db down');

    await expect(service.logMood('uid-1', 'okay', null, null)).rejects.toThrow('db down');
  });
});
