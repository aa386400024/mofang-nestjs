// V2026-10-26 治本 (vpt 业务配置 — 风险标签映射单测):
//   原因: 风险标签是**跨模块契约**的一部分 (公共人物剧本的 selfReportedRisk → 前端展示标签),
//     两处语义错了都不会报错, 只会让咨询师看到错误的提示:
//       - low 档给了"无风险"这类标签 → 前端渲染"无风险", 像在提示"这里没有风险" (误导)
//       - high 档漏了标签 → 咨询师以为这场没有风险关注点, 不盯危机识别
//   本文件锁死两件事:
//     ① 三档风险的标签映射 (含 low → 空数组)
//     ② `VPT_SCENARIO_ID` 是**唯一**的 vpt 场景标识 (写方与读方共用, 不各写一份字面量)
//
//   验证:
//     1. npx jest test/counselor/vpt-config.spec.ts 全绿
//     2. 故意把 low 档改成 ['无风险'] → "low 档不产出标签"用例变红
//
//   时间戳: 2026-10-26
import { RISK_TAGS_BY_SELF_REPORTED_RISK, VPT_SCENARIO_ID, riskTagsForSelfReportedRisk } from '../../src/counselor/config/vpt.config';

describe('自述风险等级 → 展示标签', () => {
  it('low 档**不产出任何标签** (前端据此不渲染风险区)', () => {
    expect(riskTagsForSelfReportedRisk('low')).toEqual([]);
  });

  it('medium 档产出关注提示', () => {
    expect(riskTagsForSelfReportedRisk('medium')).toEqual(['需关注情绪风险']);
  });

  it('high 档产出危机识别提示', () => {
    expect(riskTagsForSelfReportedRisk('high')).toEqual(['涉及危机需识别转介']);
  });

  it('concealed 档提示"风险可能被隐瞒"', () => {
    expect(riskTagsForSelfReportedRisk('concealed')).toEqual(['风险可能被隐瞒, 需留意躯体化信号']);
  });

  it('风险等级缺失 → 空数组 (不编造标签)', () => {
    expect(riskTagsForSelfReportedRisk()).toEqual([]);
  });

  it('返回的是**拷贝** (改返回值不影响映射表)', () => {
    const tags = riskTagsForSelfReportedRisk('high');
    tags.push('额外标签');

    expect(RISK_TAGS_BY_SELF_REPORTED_RISK.high).toHaveLength(1);
  });

  it('标签只**标记不展开** —— 不含风险具体内容', () => {
    for (const tags of Object.values(RISK_TAGS_BY_SELF_REPORTED_RISK)) {
      for (const tag of tags) {
        expect(tag.length).toBeLessThanOrEqual(30);
      }
    }
  });
});

describe('vpt 场景标识', () => {
  it('是稳定的字面量 (写方落库 / 读方判类型共用同一份)', () => {
    expect(VPT_SCENARIO_ID).toBe('vpt_voice');
  });
});
