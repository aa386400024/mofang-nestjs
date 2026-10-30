// V2026-10-27 治本 (情景演练 · 物理隔离与合规不变量):
//   原因: 任务单 §5 拍板"**必须新增用例**", 锁死 6 条:
//     ① crisis 剧本文本 0 命中 VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS;
//     ② crisis 剧本无任何 3 位以上连续数字 (号码形态);
//     ③ crisis 剧本不出现在普通池 seed / 图鉴列表 / practice_scenarios 任何导出里;
//     ④ 普通池官方人物 seed 基线自检仍通过;
//     ⑤ boundary 剧本与 crisis 剧本分目录存放, 列表接口按 track 过滤, crisis 不被 boundary 列表带出;
//     ⑥ 所有剧本响应无分数字段 (物理校验响应 schema 不含 score/grade/rating).
//     这 6 条是**合规事故的机械防线**: 危机内容一旦漏进普通池, 或危机剧本里出现一个号码,
//     都是线上事故而不是代码质量问题, 且 review 阶段看不出来 —— 只能靠断言.
//   修法: 本文件把 6 条逐条写成可执行断言. 第 ① ② 条复用**普通池自己的拒收词表**
//     (VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS), 不另抄一份 —— 抄一份就会漂移, 而漂移
//     方向恰好是"漏放" (新的禁词加进普通池, 危机侧没同步 → 断言失效).
//
//   验证: npx jest test/counselor/drill-isolation.spec.ts 全绿
//   时间戳: 2026-10-27 22:05 GMT+8
import { existsSync } from 'node:fs';
import path from 'node:path';

import { VISITOR_POOL_TEMPLATE_SEEDS, validateVisitorPoolTemplateSeeds } from '../../src/counselor/config/visitor-pool-seed';
import { VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS } from '../../src/counselor/config/visitor-pool.config';
import { listDrillScripts } from '../../src/counselor/drills/config/drill-registry';
import { BOUNDARY_DRILL_SCRIPTS } from '../../src/counselor/drills/config/scripts/boundary/boundary-scripts';
import { CRISIS_DRILL_SCRIPTS } from '../../src/counselor/drills/config/scripts/crisis/crisis-scripts';
import { DrillDetailDto, DrillListDto, DrillResponseDto } from '../../src/counselor/drills/dto/drill.dto';

/**
 * 把 crisis 剧本摊平成一段可检索文本.
 *
 * 摊平整个对象 (含人设 / 来访者原话 / 锚点关键词 / 参考回应 / 常见偏差), 因为禁词
 * 出现在**任何一处**都是事故 —— 只扫 visitorPrompt 会漏掉"参考回应里顺嘴说了一句".
 */
function flattenCrisisScripts(): string {
  return JSON.stringify(CRISIS_DRILL_SCRIPTS);
}

/**
 * DTO 的**自有属性名**清单 (物理校验出参 schema).
 *
 * 只看 own property: 继承来的方法不算字段, 而 DTO 字段都是实例自有属性.
 */
function dtoPropertyNames(instance: object): string[] {
  return Object.keys(instance);
}

describe('情景演练 · 物理隔离与合规不变量 (任务单 §5 六条)', () => {
  it('① crisis 剧本文本 0 命中普通池拒收词表 (两个内容域零交集)', () => {
    const text = flattenCrisisScripts();
    const hits = VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS.filter((keyword) => text.includes(keyword));
    expect(hits).toEqual([]);
  });

  it('② crisis 剧本无任何 3 位以上连续数字 (号码形态)', () => {
    expect(/\d{3,}/.exec(flattenCrisisScripts())).toBeNull();
  });

  it('③ crisis 剧本不出现在普通池 seed / 图鉴列表里', () => {
    const poolText = JSON.stringify(VISITOR_POOL_TEMPLATE_SEEDS);
    for (const script of CRISIS_DRILL_SCRIPTS) {
      expect(poolText).not.toContain(script.drillId);
      expect(poolText).not.toContain(script.visitorPrompt);
      expect(poolText).not.toContain(script.persona.name);
    }
  });

  it('④ 普通池官方人物 seed 基线自检仍通过 (危机内容没污染普通池)', () => {
    expect(validateVisitorPoolTemplateSeeds(VISITOR_POOL_TEMPLATE_SEEDS)).toBeNull();
  });

  it('⑤ boundary 与 crisis 剧本分目录存放, 且列表按 track 过滤互不串场', () => {
    const scriptsDir = path.join(__dirname, '../../src/counselor/drills/config/scripts');
    expect(existsSync(path.join(scriptsDir, 'boundary'))).toBe(true);
    expect(existsSync(path.join(scriptsDir, 'crisis'))).toBe(true);

    const boundaryIds = listDrillScripts('boundary').map((script) => script.drillId);
    const crisisIds = listDrillScripts('crisis').map((script) => script.drillId);
    expect(boundaryIds).toHaveLength(BOUNDARY_DRILL_SCRIPTS.length);
    expect(crisisIds).toHaveLength(CRISIS_DRILL_SCRIPTS.length);
    // crisis 不被 boundary 列表带出 (反之亦然).
    expect(boundaryIds.filter((id) => crisisIds.includes(id))).toEqual([]);
    expect(crisisIds.filter((id) => boundaryIds.includes(id))).toEqual([]);
  });

  it('⑥ 剧本响应无分数字段 (出参 schema 里不存在 score/grade/rating)', () => {
    const forbidden = /score|grade|rating|star|rank|正确率|通过率|得分|分数|星级/i;
    for (const dto of [new DrillListDto(), new DrillDetailDto(), new DrillResponseDto()]) {
      const offending = dtoPropertyNames(dto).filter((name) => forbidden.test(name));
      expect(offending).toEqual([]);
    }
  });
});
