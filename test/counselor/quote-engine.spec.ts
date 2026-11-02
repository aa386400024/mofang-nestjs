// V2026-10-22 治本 (首页金句 · 每日一句 — 纯函数单测):
//   原因: 金句模块有两类"不靠运行就能测、但一旦错了后果很大"的不变量:
//     ① **内容库不变量** —— id 唯一 / id 日期前缀与 publishedAt 一致 / 署名真实可考.
//        内容是**会持续编辑**的 (运营改文案、加条目、换背景图), 靠人工核对迟早漏;
//        而内容错了会直接变成线上用户看到的坏素材 —— 最坏的情况是「把一句没人
//        说过的话挂在某个心理学家名下」, 那是**伪造名言归属**, 属于合规事故
//        (spec §4 硬红线), 不是文案问题.
//     ② **零压红线不变量** —— 出参 DTO 里不得出现任何计数字段.
//        这条是"结构性保证": 契约里没有 likeCount, 客户端就不可能渲染出"42 人收藏";
//        一旦有人为了"做个排行榜"加上这个字段, 情绪陪伴位会立刻变成攀比位.
//        靠 code review 拦这种改动不可靠 —— 这里用测试锁死.
//     这两类都是**纯函数 / 纯结构**, 无 DI / 无 DB, 因此不需要起应用就能测.
//
//   范围说明: 带 DI 的 service (DB 读写) 不在本文件覆盖范围 ——
//     那些依赖真实环境, 按项目惯例走人工 curl 验证 (见交付文档).
//
//   验证:
//     1. npx jest test/counselor/quote-engine.spec.ts 全绿
//     2. 故意把某条 id 改成重复 → 第 2 组用例变红
//     3. 故意给真实作者去掉出处 → 第 3 组用例变红
//
//   时间戳: 2026-10-22
import { QUOTE_SEEDS, quoteDayIndexOf, validateQuoteSeeds, type QuoteSeed } from '../../src/counselor/config/quote-seeds';
import { QuoteDto } from '../../src/counselor/dto/quote.dto';

describe('首页金句内容库自检', () => {
  it('随库内容通过自检 (16 条 / id 唯一 / 署名真实可考)', () => {
    const error = validateQuoteSeeds(QUOTE_SEEDS);

    expect(error).toBeNull();
    expect(QUOTE_SEEDS).toHaveLength(16);
  });

  it('id 全局唯一 (id 是游标 + 收藏路径参数, 撞号会让分页漏条/重条)', () => {
    const ids = QUOTE_SEEDS.map((seed) => seed.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id 日期前缀与 publishedAt 一致 (否则游标语义与"发布日"脱节)', () => {
    for (const seed of QUOTE_SEEDS) {
      const matched = /^q_(\d{8})_/.exec(seed.id);
      expect(matched).not.toBeNull();
      expect(matched?.[1]).toBe(seed.publishedAt.replaceAll('-', ''));
    }
  });

  it('publishedAt 连续覆盖 16 天 (feed 排序 + 今日轮换的候选池不空档)', () => {
    const dates = QUOTE_SEEDS.map((seed) => seed.publishedAt).toSorted((a, b) => a.localeCompare(b));
    const uniqueDates = new Set(dates);

    expect(uniqueDates.size).toBe(16);
    for (let index = 1; index < dates.length; index += 1) {
      const previous = dates[index - 1];
      const current = dates[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (!previous || !current) {
        continue;
      }
      const gapDays = (Date.parse(`${current}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / 86_400_000;
      expect(gapDays).toBe(1);
    }
  });

  it('能抓出重复 id (幂等 upsert 会互相覆盖, 丢内容)', () => {
    const first = QUOTE_SEEDS[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    const duplicated: QuoteSeed = { ...first };
    const error = validateQuoteSeeds([...QUOTE_SEEDS, duplicated]);

    expect(error).toContain('重复');
  });

  it('能抓出 id 日期前缀与 publishedAt 不一致', () => {
    const first = QUOTE_SEEDS[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    // V2026-10-24 治本: broken 样本沿用原 id → validateQuoteSeeds 的**首个**错误
    //   是「id 重复」, 断言的「日期前缀」永远轮不到. 给样本一个**唯一但仍合法**的 id:
    //   格式仍是 q_<YYYYMMDD>_<slug> (前缀不变 → 只保留「日期前缀与 publishedAt 不一致」这一处缺陷).
    const broken: QuoteSeed = { ...first, id: `${first.id}_probe_prefix`, publishedAt: '2026-01-01' };
    const error = validateQuoteSeeds([...QUOTE_SEEDS, broken]);

    expect(error).toContain('日期前缀');
  });

  it('能抓出真实作者缺出处 (spec §4 署名须真实可考)', () => {
    const first = QUOTE_SEEDS.find((seed) => seed.author !== '心塑');
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    // V2026-10-24 治本: 同上 —— broken 样本必须唯一, 否则「id 重复」先触发.
    const broken: QuoteSeed = { ...first, id: `${first.id}_probe_source`, sourceWork: null };
    const error = validateQuoteSeeds([...QUOTE_SEEDS, broken]);

    expect(error).toContain('出处');
  });

  it('能抓出署名落空 (不能既没有作者也没有出处)', () => {
    const first = QUOTE_SEEDS[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    // V2026-10-24 治本: 同上 —— broken 样本必须唯一, 否则「id 重复」先触发.
    const broken: QuoteSeed = { ...first, id: `${first.id}_probe_author`, author: ' '.repeat(3) };
    const error = validateQuoteSeeds([...QUOTE_SEEDS, broken]);

    expect(error).toContain('署名');
  });
});

describe('今日金句轮换定位键', () => {
  it('同一天内恒定 (用户刷新不能换一句)', () => {
    const morning = new Date(2026, 9, 22, 8, 0, 0);
    const evening = new Date(2026, 9, 22, 23, 59, 59);

    expect(quoteDayIndexOf(morning)).toBe(quoteDayIndexOf(evening));
  });

  it('跨天递增 1 (元旦不重置 —— 用本地自然日序号, 不用"距当年 1 月 1 日")', () => {
    const lastDayOfYear = new Date(2026, 11, 31, 12, 0, 0);
    const firstDayOfNextYear = new Date(2027, 0, 1, 12, 0, 0);

    expect(quoteDayIndexOf(firstDayOfNextYear) - quoteDayIndexOf(lastDayOfYear)).toBe(1);
  });

  it('本地午夜前后仍算同一天 (按用户所在时区的日历天, 不按 UTC)', () => {
    const justBeforeMidnight = new Date(2026, 9, 22, 23, 59, 59);
    const justAfterMidnight = new Date(2026, 9, 23, 0, 0, 0);

    expect(quoteDayIndexOf(justAfterMidnight) - quoteDayIndexOf(justBeforeMidnight)).toBe(1);
  });
});

describe('零压红线 (spec §2.3 + §4: 不下发、不展示全站 likeCount)', () => {
  it('出参 DTO 不含任何计数字段', () => {
    const fields = Object.keys(new QuoteDto());

    for (const forbidden of ['likeCount', 'favoriteCount', 'viewCount', 'shareCount', 'commentCount', 'rank']) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it('出参 DTO 只下发"本人是否收藏", 不下发任何他人信息', () => {
    const fields = Object.keys(new QuoteDto());

    expect(fields).toContain('favorited');
    expect(fields).not.toContain('favoritedBy');
    expect(fields).not.toContain('favoritedUsers');
  });
});
