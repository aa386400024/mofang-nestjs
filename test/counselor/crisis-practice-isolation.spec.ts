// V2026-10-27 治本 (危机识别专区 — 物理隔离不变量, spec 任务 B3):
//   原因: 危机内容一旦漏进普通池, 就是**合规事故** (公共图鉴是所有学员可见的内容面).
//     仓库既有防线是"词表 + 校验"双保险 (普通池拒收闸门), 但那只管**普通池的写入口**;
//     危机元数据是**另一条链路** (独立 config + 独立端点), 它的隔离性必须单独锁死.
//   修法: 本文件锁死 4 条不变量 (任一被破坏即红):
//     ① 危机元数据文本 **0 命中** 普通池的拒收词表 (两个内容域零交集)
//     ② 危机元数据里 **没有**任何号码形态 (3 位以上连续数字 = 热线/电话)
//     ③ 危机元数据里 **没有**人物剧本字段 (它只出"分级/信号类别/话术模板/边界声明")
//     ④ 普通池 6 位官方人物的 seed 基线 **仍然自检通过** (危机内容没污染普通池)
//   验证: npx jest test/counselor/crisis-practice-isolation.spec.ts 全绿
//   时间戳: 2026-10-27
import { buildCrisisPracticeMeta } from '../../src/counselor/config/crisis-practice.config';
import { VISITOR_POOL_TEMPLATE_SEEDS, validateVisitorPoolTemplateSeeds } from '../../src/counselor/config/visitor-pool-seed';
import { VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS } from '../../src/counselor/config/visitor-pool.config';

/** 把危机元数据摊平成一段可检索文本. */
function flattenMeta(): string {
  const meta = buildCrisisPracticeMeta();
  return JSON.stringify(meta);
}

describe('危机元数据 · 物理隔离 (任务单 B3)', () => {
  it('① 0 命中普通池拒收词表 (两个内容域零交集)', () => {
    const text = flattenMeta();
    const hits = VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS.filter((keyword) => text.includes(keyword));
    expect(hits).toEqual([]);
  });

  it('② 不含任何号码形态 (3 位以上连续数字)', () => {
    const text = flattenMeta();
    expect(/\d{3,}/.exec(text)).toBeNull();
  });

  it('③ 不含人物剧本字段 (只出分级/信号类别/话术模板/边界声明)', () => {
    const meta = buildCrisisPracticeMeta();
    expect(Object.keys(meta).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'boundaryNotice',
      'referralScripts',
      'riskLevels',
      'signalCategories',
    ]);
    // 逐项再查一遍: 任何一项里都不该出现"剧本/人物档案"这类内容层字段.
    for (const level of meta.riskLevels) {
      expect(Object.keys(level).toSorted((a, b) => a.localeCompare(b))).toEqual(['label', 'level', 'signalCategoryIds', 'teachingNote']);
    }
    for (const category of meta.signalCategories) {
      expect(Object.keys(category).toSorted((a, b) => a.localeCompare(b))).toEqual(['description', 'examples', 'id', 'label']);
    }
    for (const script of meta.referralScripts) {
      expect(Object.keys(script).toSorted((a, b) => a.localeCompare(b))).toEqual([
        'id',
        'levels',
        'openQuestions',
        'resourceGuidance',
        'title',
      ]);
    }
  });

  it('④ 普通池 6 位官方人物 seed 基线仍然自检通过 (危机内容没污染普通池)', () => {
    expect(validateVisitorPoolTemplateSeeds(VISITOR_POOL_TEMPLATE_SEEDS)).toBeNull();
  });

  it('⑤ 普通池 seed 里不含任何危机元数据 (id / 文案都不沾)', () => {
    const meta = buildCrisisPracticeMeta();
    const crisisIds = new Set<string>([...meta.signalCategories.map((c) => c.id), ...meta.referralScripts.map((s) => s.id)]);
    for (const seed of VISITOR_POOL_TEMPLATE_SEEDS) {
      expect(crisisIds.has(seed.id)).toBe(false);
      const seedText = JSON.stringify(seed);
      for (const crisisId of crisisIds) {
        expect(seedText.includes(crisisId)).toBe(false);
      }
    }
  });
});
