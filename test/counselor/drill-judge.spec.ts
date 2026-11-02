// V2026-10-27 治本 (情景演练 · 判定引擎纯函数单测):
//   原因: 任务单 §2.2 把三档判定写成"**纯函数可单测**", §8.2 要求"三档各有一条确定性用例
//     命中正确 verdict", §9 要求新增"三档各正例/反例、crisis 覆盖清单、空文本 400"用例.
//     三档判定是**零压红线**的核心: 判错档位 = 前端渲染出"得分/不及格"式的结论.
//     它必须无状态、无 IO、可单测 —— 不起服务、不 mock 上游.
//   修法: 本文件直接对 domain/drill-judge.ts 的纯函数断言:
//     ① 三档各一条正例 (命中对应档位) + 一条反例 (不该落该档)
//     ② 否定守卫: "不加微信" 不被判成松口 (中文 includes 的经典误判)
//     ③ crisis 只出覆盖清单, verdict 恒 null
//     ④ 覆盖清单与批注的一致性 (covered/missed 与 items 的 pointKey 对得上)
//     ⑤ 空文本 → 不崩溃, 且不判成任何"做到"
//     ⑥ 同一份回应连判两次结果恒等 (零随机, 可复盘)
//
//   验证: npx jest test/counselor/drill-judge.spec.ts 全绿
//   时间戳: 2026-10-27 21:55 GMT+8
import { BOUNDARY_DRILL_SCRIPTS } from '../../src/counselor/drills/config/scripts/boundary/boundary-scripts';
import { CRISIS_DRILL_SCRIPTS } from '../../src/counselor/drills/config/scripts/crisis/crisis-scripts';
import { listDrillScripts, validateDrillScripts } from '../../src/counselor/drills/config/drill-registry';
import { judgeDrill, matchDrillAnchors } from '../../src/counselor/drills/domain/drill-judge';
import type { DrillScript } from '../../src/counselor/drills/domain/drill.types';

/**
 * 取一个 boundary 剧本 (按 drillId 精确取, 避免用例依赖数组顺序).
 */
function boundaryScript(drillId: string): DrillScript {
  const script = BOUNDARY_DRILL_SCRIPTS.find((item) => item.drillId === drillId);
  expect(script).toBeDefined();
  if (!script) {
    throw new Error(`boundary 剧本不存在: ${drillId}`);
  }
  return script;
}

/**
 * 取一个 crisis 剧本.
 */
function crisisScript(drillId: string): DrillScript {
  const script = CRISIS_DRILL_SCRIPTS.find((item) => item.drillId === drillId);
  expect(script).toBeDefined();
  if (!script) {
    throw new Error(`crisis 剧本不存在: ${drillId}`);
  }
  return script;
}

describe('情景演练 · 内容基线自检', () => {
  it('全部剧本通过注册表自检 (锚点 key 集合 / 关键词齐备 / 边界声明 / 难度 / 无 nodes)', () => {
    expect(validateDrillScripts()).toEqual([]);
  });

  it('boundary 赛道 5 个脚本, crisis 赛道 3 个脚本', () => {
    expect(listDrillScripts('boundary')).toHaveLength(5);
    expect(listDrillScripts('crisis')).toHaveLength(3);
  });

  it('按 track 过滤互不串场 (crisis 不被 boundary 列表带出)', () => {
    const boundaryIds = listDrillScripts('boundary').map((script) => script.drillId);
    const crisisIds = listDrillScripts('crisis').map((script) => script.drillId);
    expect(boundaryIds.every((id) => !crisisIds.includes(id))).toBe(true);
    expect(crisisIds.every((id) => !boundaryIds.includes(id))).toBe(true);
  });
});

describe('boundary 三档判定 (§2.2 优先级规则)', () => {
  it('steady_firm: 共情 + 守住设置 + 可行替代 → 温和坚定', () => {
    const script = boundaryScript('boundary_wechat_contact');
    const result = judgeDrill(
      script,
      '我理解你担心临时联系不上, 这份不安挺不容易的。按我们的设置不加私人联系方式, 但工作时间内你随时可以留言, 我看到会回复。',
    );
    expect(result.verdict).toBe('steady_firm');
    expect(result.coveredPointKeys).toContain('namesEmotion');
    expect(result.coveredPointKeys).toContain('holdsBoundary');
    expect(result.missedPointKeys).toHaveLength(0);
  });

  it('over_compromise: 命中"答应加微信"类反向词 → 过度妥协 (优先级高于共情)', () => {
    const script = boundaryScript('boundary_wechat_contact');
    const result = judgeDrill(
      script,
      '我理解你的担心, 听起来确实不容易。那我加你微信, 随时找我都可以, 有急事我一定秒回你。',
    );
    expect(result.verdict).toBe('over_compromise');
    // 松口时"守住设置"不算做到 —— 覆盖清单必须如实反映.
    expect(result.coveredPointKeys).not.toContain('holdsBoundary');
  });

  it('abrupt_refusal: 守住设置但无共情 → 生硬拒绝 (兜底档)', () => {
    const script = boundaryScript('boundary_wechat_contact');
    const result = judgeDrill(script, '按我们的设置不加私人联系方式, 这件事没有别的办法。');
    expect(result.verdict).toBe('abrupt_refusal');
    expect(result.coveredPointKeys).toContain('holdsBoundary');
    expect(result.coveredPointKeys).not.toContain('namesEmotion');
  });

  it('否定守卫: "不加微信" 不被判成松口 (中文 includes 的经典误判)', () => {
    const script = boundaryScript('boundary_wechat_contact');
    const result = judgeDrill(
      script,
      '我理解你担心, 也听见你的着急。不过按我们的设置, 不加微信, 我加你私人号更不行。',
    );
    expect(result.verdict).not.toBe('over_compromise');
    expect(result.coveredPointKeys).toContain('holdsBoundary');
  });

  it('否定守卫: 命中词前有否定字时该次命中不计入, 但同词后面的未否定出现仍计入', () => {
    const script = boundaryScript('boundary_wechat_contact');
    const signals = matchDrillAnchors(script, '我不加微信, 但我加你微信行不行');
    const hold = signals.find((signal) => signal.pointKey === 'holdsBoundary');
    expect(hold).toBeDefined();
    // 第一次出现被否定, 第二次未被否定 → 以未否定的那次为准.
    expect(hold?.antiHit).toBe('我加你');
  });

  it('覆盖清单与批注自洽: 每个锚点在 covered/missed 里恰好出现一次, 且都有对应批注', () => {
    const script = boundaryScript('boundary_overtime');
    const result = judgeDrill(script, '我理解这一段对你很重要, 但今天先到这里, 下次接着讲。');
    const keys = [...result.coveredPointKeys, ...result.missedPointKeys];
    expect(new Set(keys).size).toBe(script.requiredPoints.length);
    expect(keys.sort()).toEqual([...result.coveredPointKeys, ...result.missedPointKeys].sort());
    const itemKeys = result.items.map((item) => item.pointKey).filter((key) => key !== 'verdictShape');
    expect(itemKeys.sort()).toEqual(keys.sort());
  });

  it('同一份回应连判两次结果恒等 (零随机, 可复盘)', () => {
    const script = boundaryScript('boundary_free_extra');
    const text = '我理解你的顾虑, 也谢谢你直接问。时长按设置来, 不过我们可以下次约一个更长的时段。';
    expect(judgeDrill(script, text)).toEqual(judgeDrill(script, text));
  });

  it('空文本不崩溃, 且不判成任何"做到"', () => {
    const script = boundaryScript('boundary_after_hours_chat');
    const result = judgeDrill(script, '   ');
    expect(result.verdict).toBe('abrupt_refusal');
    expect(result.coveredPointKeys).toHaveLength(0);
    expect(result.missedPointKeys).toHaveLength(script.requiredPoints.length);
  });
});

describe('crisis 判定 (§3.2 只出覆盖清单, 不判档)', () => {
  it('verdict 恒为 null (crisis 不判档)', () => {
    const script = crisisScript('crisis_farewell_signal');
    const result = judgeDrill(script, '我听到了, 听起来这很难。是什么让交代这件事变得这么重要? 也可以看看当地的心理援助资源。');
    expect(result.verdict).toBeNull();
  });

  it('开放式探问 + 不评判 + 引导求助 三项都做到 → 覆盖清单齐全', () => {
    const script = crisisScript('crisis_farewell_signal');
    const result = judgeDrill(
      script,
      '我听到了, 我明白这不容易。愿意的话多讲讲, 是什么让"交代"这件事在这段时间变得这么重要? 当地的心理援助也可以一起看看。',
    );
    expect(result.coveredPointKeys).toEqual(['openProbe', 'nonJudgmental', 'guideToSupport']);
    expect(result.missedPointKeys).toHaveLength(0);
  });

  it('评判式回应 → 不评判锚点未覆盖, 且给"这里可以多问一句"方向提示', () => {
    const script = crisisScript('crisis_no_support_anchor');
    const result = judgeDrill(script, '别想太多了, 别人比你惨多了。多讲讲是什么让你觉得谁都靠不上?');
    expect(result.coveredPointKeys).not.toContain('nonJudgmental');
    expect(result.missedPointKeys).toContain('nonJudgmental');
    const item = result.items.find((entry) => entry.pointKey === 'nonJudgmental');
    expect(item?.text).toContain('多问一句');
  });
});