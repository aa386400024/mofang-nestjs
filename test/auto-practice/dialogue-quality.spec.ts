// V2026-11-09 治本 (Phase2.5 WP-G · 对话质量修复 · 停滞检测口径单测):
//   覆盖任务单 §改动 4 的验收口径 —— isNearDuplicate 的四层判定:
//     ① 完全相同 → 复读;
//     ② 长文: 都 >= 15 字 + 长度差 < 10% + 前 15 字相同 → 复读 (原有口径, 保留);
//     ③ 字符级 3-gram Jaccard >= 0.6 → 近似重复;
//     ④ 语义近似: 表达状态簇重叠 + 话题不冲突.
//
//   为什么第 ④ 层必须存在 (这组用例就是理由):
//     验收对 "我不太想现在讲清楚" / "最近确实有点难说出口" **零字符重叠** ——
//     纯字符 n-gram 的 Jaccard 恒为 0, 判不出近似, 而它们在临床上就是同一句话.
//
//   验证: npx vitest run test/auto-practice/dialogue-quality.spec.ts

import { describe, expect, it } from 'vitest';

import { isNearDuplicate } from '../../src/auto-practice/practice-runner.service.js';

describe('isNearDuplicate · 停滞检测口径 (Phase2.5 WP-G 改动 4)', () => {
  it('验收对: "我不太想现在讲清楚" 与 "最近确实有点难说出口" 判为近似重复', () => {
    expect(isNearDuplicate('我不太想现在讲清楚', '最近确实有点难说出口')).toBe(true);
  });

  it('完全相同 → 复读', () => {
    expect(isNearDuplicate('嗯', '嗯')).toBe(true);
    expect(isNearDuplicate('我最近有点累', '我最近有点累')).toBe(true);
  });

  it('长文: 前 15 字相同且长度接近 → 复读 (原有口径保留)', () => {
    expect(isNearDuplicate('我最近一直睡不好，晚上老是在想事情', '我最近一直睡不好，晚上老是在想事儿')).toBe(true);
  });

  it('字符级 3-gram: 短句只差一两个字也算近似重复', () => {
    expect(isNearDuplicate('最近确实有点难说出口', '最近确实有点难说出口了')).toBe(true);
  });

  it('话题不同 → 不算重复 (同一种状态, 不是同一句话)', () => {
    expect(isNearDuplicate('我不想说我爸妈的事', '我不想说工作的事')).toBe(false);
  });

  it('完全无关 → 不算重复', () => {
    expect(isNearDuplicate('今天天气不错', '我最近总是睡不着')).toBe(false);
  });

  it('首轮 (上一轮为空) → 不算重复', () => {
    expect(isNearDuplicate('随便一句', '')).toBe(false);
  });

  it('对称性: 前后换序结论一致', () => {
    expect(isNearDuplicate('最近确实有点难说出口', '我不太想现在讲清楚')).toBe(true);
    expect(isNearDuplicate('我不想说工作的事', '我不想说我爸妈的事')).toBe(false);
  });
});
