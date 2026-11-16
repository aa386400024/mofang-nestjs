// V2026-11-10 治本 (Phase2.5 WP-J · 改动 A): 停滞判定口径单测.
//
// 这个文件从 WP-G 的 `isNearDuplicate` 用例改过来, **改动方向是收敛, 不是放宽**:
//
//   WP-G 的口径: 一条 `isNearDuplicate` 同时承担"字面复读"与"语义相邻"两件事,
//                语义层(第④层)算作重复 → 判停滞.
//   WP-J 的口径: 拆成三条, 各管一件事 ——
//                ① 字面复读 `isLiteralRepeat`     (参与终止)
//                ② 无推进   `probeStagnation`     (参与终止)
//                ③ 语义相邻 `isSemanticEcho`      (**只记指标**, 永不终止)
//
//   为什么必须拆 (金丝雀 24 场给出的证据):
//     5 场被判 stagnant 的场次**全部**由咨询师侧触发, 而触发它们的相邻两轮
//     字符 3-gram Jaccard 只有 0.00~0.04 (阈值 0.6, 差两个数量级) ——
//     真正命中的是语义层. 语义相邻是反映式复述的**正常形态**, 拿它终止对话
//     等于"把正确的技术动作判成错误". 真人咨询师比 AI 更容易踩, 属产品级 bug.
//
//   但语义层**不能删**: "我不太想现在讲清楚" 与 "最近确实有点难说出口" 零字符重叠,
//   在临床上确实说的是同一件事 —— 它现在作为**指标**保留下来, 用来度量
//   "这个咨询师是不是一直在同一议题上打转", 而不是拿来掐断对话.
//
//   验证: npx vitest run test/auto-practice/dialogue-quality.spec.ts

import { describe, expect, it, vi } from 'vitest';

import {
  crisisLevelOf,
  isLiteralRepeat,
  isSemanticEcho,
  maxCharNgramSimilarity,
  NO_PROGRESS_SIMILARITY_THRESHOLD,
  probeStagnation,
} from '../../src/auto-practice/practice-runner.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

describe('isLiteralRepeat · 字面复读 (A-①, 参与终止)', () => {
  it('完全相同 → 复读', () => {
    expect(isLiteralRepeat('嗯', '嗯')).toBe(true);
    expect(isLiteralRepeat('我最近有点累', '我最近有点累')).toBe(true);
  });

  it('长文: 前 15 字相同且长度接近 → 复读 (原有口径保留)', () => {
    expect(isLiteralRepeat('我最近一直睡不好，晚上老是在想事情', '我最近一直睡不好，晚上老是在想事儿')).toBe(true);
  });

  it('字符级 3-gram: 短句只差一两个字也算复读', () => {
    expect(isLiteralRepeat('最近确实有点难说出口', '最近确实有点难说出口了')).toBe(true);
  });

  it('完全无关 → 不算复读', () => {
    expect(isLiteralRepeat('今天天气不错', '我最近总是睡不着')).toBe(false);
  });

  it('首轮 (上一轮为空) → 不算复读', () => {
    expect(isLiteralRepeat('随便一句', '')).toBe(false);
  });

  // ★ 这条是 WP-J 的核心行为变更, 不是"放松阈值":
  //   两句语义相同但零字符重叠 → **不再**算字面复读 (它属于指标层, 不属于终止层).
  it('语义相同但零字符重叠 → 不算字面复读 (与 WP-G 相反)', () => {
    expect(isLiteralRepeat('我不太想现在讲清楚', '最近确实有点难说出口')).toBe(false);
  });

  it('话题不同 → 不算复读 (同一种状态, 不是同一句话)', () => {
    expect(isLiteralRepeat('我不想说我爸妈的事', '我不想说工作的事')).toBe(false);
  });
});

describe('isSemanticEcho · 语义相邻 (A-③, 只记指标)', () => {
  it('验收对: 零字符重叠但语义相同 → 语义相邻 (保留 WP-G 的发现, 降级为指标)', () => {
    expect(isSemanticEcho('我不太想现在讲清楚', '最近确实有点难说出口')).toBe(true);
  });

  it('对称性: 前后换序结论一致', () => {
    expect(isSemanticEcho('最近确实有点难说出口', '我不太想现在讲清楚')).toBe(true);
  });

  it('话题冲突 → 不判语义相邻', () => {
    expect(isSemanticEcho('我不想说工作的事', '我不想说我爸妈的事')).toBe(false);
  });

  it('太短的应答不参与 (避免"嗯"/"哦"互判)', () => {
    expect(isSemanticEcho('嗯', '哦')).toBe(false);
  });
});

describe('maxCharNgramSimilarity · 与历史全部文本比 (A-②)', () => {
  it('无历史 → 0', () => {
    expect(maxCharNgramSimilarity('随便一句', [])).toBe(0);
  });

  it('与历史中任一条高度相似 → 取最大值 (不是只看上一条)', () => {
    const history = ['我们聊点别的吧', '我最近一直睡不好，晚上老是在想工作的事'];
    const current = '我最近一直睡不好，晚上老是在想工作的事情';
    expect(maxCharNgramSimilarity(current, history)).toBeGreaterThanOrEqual(NO_PROGRESS_SIMILARITY_THRESHOLD);
  });

  it('带来新信息 → 低于阈值', () => {
    const history = ['我最近一直睡不好，晚上老是在想工作的事'];
    expect(maxCharNgramSimilarity('上周我妈打电话来，我们吵了一架', history)).toBeLessThan(NO_PROGRESS_SIMILARITY_THRESHOLD);
  });
});

describe('probeStagnation · 单轮探测组合口径', () => {
  it('首轮: 没有历史 → 三条都不触发', () => {
    const probe = probeStagnation({ visitorText: '我不太想说起这件事', visitorHistory: [], counselorText: '嗯', lastCounselorText: '' });
    expect(probe.literalRepeat).toBe(false);
    expect(probe.noProgress).toBe(false);
    expect(probe.counselorSemanticEcho).toBe(false);
  });

  // ⚠️ 口径重叠 (设计事实, 不是 bug):
  //   "无推进"阈值 0.8 与"字面复读"阈值 0.6 建立在**同一个**字符 3-gram 度量上,
  //   所以"与上一条 ≥0.8"必然同时命中字面层 —— 相邻高相似本来就是复读.
  //   无推进层的**独有价值**在"跨轮回头打转": A→B→A′→B′ 这种相邻都不同、
  //   但总绕回老话题的形态, 才是只跟上一轮比的旧口径漏掉的那类停滞
  //   (见 practice-runner.spec.ts 的"来访者来回打转"用例).
  it('来访者原地打转 (换个说法) → noProgress 命中 (相邻高相似同时属字面层)', () => {
    const probe = probeStagnation({
      visitorText: '我最近一直睡不好，晚上老是在想工作的事情',
      visitorHistory: ['我最近一直睡不好，晚上老是在想工作的事'],
      counselorText: '你睡不好这件事，我们慢慢说。',
      lastCounselorText: '我听到你说睡不好的事。',
    });
    expect(probe.noProgress).toBe(true);
    // 这两个阈值同源 (0.8 > 0.6), 相邻高相似必然同时算字面复读 —— 行为上不冲突:
    // 两者都指向终止, 只是"跨轮"形态只有 noProgress 能抓到.
    expect(probe.literalRepeat).toBe(true);
  });

  it('来访者带来新信息 + 咨询师语义相邻 → 只有指标命中, 不构成停滞', () => {
    const probe = probeStagnation({
      visitorText: '上周我妈打电话来，我们吵了一架，她一直在说我。',
      visitorHistory: ['我最近一直睡不好，晚上老是在想工作的事'],
      counselorText: '你妈妈那通电话，让你一直很难受。',
      lastCounselorText: '你一直睡不好，脑子停不下来，确实很难受。',
    });
    expect(probe.noProgress).toBe(false);
    expect(probe.literalRepeat).toBe(false);
    // 咨询师连续两轮都在谈"难受"这类状态 → 计数 +1, 但对话继续.
    expect(probe.counselorSemanticEcho).toBe(true);
  });
});

describe('crisisLevelOf · 危机强度档位映射', () => {
  it('内核类别映射成 0~3 档', () => {
    expect(crisisLevelOf(null)).toBe(0);
    expect(crisisLevelOf('suicide_exploration')).toBe(0);
    expect(crisisLevelOf('passive_ideation')).toBe(1);
    expect(crisisLevelOf('active_ideation')).toBe(2);
    expect(crisisLevelOf('self_harm_ideation')).toBe(2);
    expect(crisisLevelOf('suicide_plan')).toBe(3);
    expect(crisisLevelOf('suicide_attempt')).toBe(3);
  });

  it('未知类别按 1 处理 (承认已判出危机, 但不冒充最严重档位)', () => {
    expect(crisisLevelOf('some_unknown_category')).toBe(1);
  });
});
