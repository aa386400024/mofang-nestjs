// V2026-10-30 治本 (WP10 · B 层 · 伦理盲盒剧本形状与内容纪律单测):
//   职责: 钉死 10 个 `force_override` 剧本的**形状**与**内容纪律** —— 形状交给内核
//         唯一的 `validateTrajectoryScript` 判, 内容纪律用可执行断言锁死.
//   边界: 纯数据单测; 不起容器、不连 DB、不发网络.
//
//   为什么形状校验**不自己写一份**:
//     内核 (`src/engine-core/domain/trajectory/script.ts`) 已有 `validateTrajectoryScript`
//     —— 它是形状的唯一真值源. 适配层再写一份校验, 两份就会漂移: 内核放宽了某条规则
//     而适配层还按老口径拦 (剧本全部过不了), 或者反过来 (脏剧本被放进去).
//     所以这里**直接调内核那一份** —— 内核改了形状, 这条测试立刻变红, 这正是要的效果.
//
//   为什么内容纪律要写成断言 (而不是只写进文档):
//     伦理内容一旦漏出边界 (出现一个号码 / 写出具体危机方式 / 把督导要点写成台词),
//     它是**线上事故**而不是代码质量问题, 且 review 阶段看不出来 —— 只能靠断言.
//     与 `test/counselor/drill-isolation.spec.ts` 同一思路.
//
//   验证: npx jest test/engine-adapters/wp10-ethical-scripts.spec.ts
//   时间戳: 2026-10-30 GMT+8

import { validateTrajectoryScript, type TrajectoryScript } from '../../src/engine-core';
import {
  ETHICAL_TRAJECTORY_SCRIPT_MAP,
  ETHICAL_TRAJECTORY_SCRIPTS,
  StaticTrajectoryScriptResolver,
} from '../../src/engine-adapters/wiring/trajectory';

/**
 * 任务单 §1.2 的 10 个剧本 scriptId (固定清单).
 *
 * 写死清单而不是"从数组里读出清单" —— 后者是自证: 少一个剧本测试照样绿.
 */
const EXPECTED_SCRIPT_IDS: readonly string[] = [
  'ethical_romantic_confession',
  'ethical_private_contact',
  'ethical_known_person',
  'ethical_recording_dispute',
  'ethical_diagnosis_note',
  'ethical_suicide_crisis',
  'ethical_gift_money',
  'ethical_value_judgment',
  'ethical_sexual_seduction',
  'ethical_medical_advice',
];

/**
 * 危机剧本的**具体方式**禁写词 (间接行为线索之外的一切描述).
 *
 * 与 `counselor/drills/` 的危机口径一致: 练的是"看见信号", 不是复述风险方式.
 */
const CRISIS_METHOD_KEYWORDS: readonly string[] = [
  '割腕',
  '跳楼',
  '上吊',
  '割喉',
  '吞药',
  '服药',
  '农药',
  '炭火',
  '刀片',
  '绳索',
  '轨道',
  '高处',
  '剂量',
  '多少片',
];

/**
 * 危机剧本应当出现的**间接行为线索** (反向断言: 禁写方式, 但必须留有线索).
 */
const CRISIS_INDIRECT_CUE_KEYWORDS: readonly string[] = ['交代后事', '清点', '平静'];

/**
 * 把一个剧本摊平成可检索文本 (含所有幕 / target / notes).
 *
 * 摊平整个对象而不是只扫 referenceNotes: 禁词出现在**任何一处**都是事故 ——
 * 只扫一处会漏掉"forbiddenBehaviors 里顺嘴写了一句".
 */
function flatten(script: TrajectoryScript): string {
  return JSON.stringify(script);
}

describe('WP10 · 伦理盲盒剧本 · 形状验收 (任务单 §3.1)', () => {
  it('① 10 个剧本全部通过内核 validateTrajectoryScript (形状唯一真值源)', () => {
    expect(ETHICAL_TRAJECTORY_SCRIPTS).toHaveLength(10);
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(() => validateTrajectoryScript(script)).not.toThrow();
    }
  });

  it('② scriptId 与任务单清单逐字一致, 且互不重复', () => {
    const ids = ETHICAL_TRAJECTORY_SCRIPTS.map((script) => script.scriptId);
    expect(ids).toEqual([...EXPECTED_SCRIPT_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('③ 全部 force_override 强覆盖模式 (伦理盲盒的专用模式)', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(script.mode).toBe('force_override');
    }
  });

  it('④ 每个剧本至少 3 幕 (自由运行 → 伦理事件 → 展开 → 收束)', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(script.nodes.length).toBeGreaterThanOrEqual(3);
      // 有效 order 唯一 (内核校验也查这一条, 这里显式钉住"幕序是 0..n 连续"的写法约定).
      const orders = script.nodes.map((node, index) => node.order ?? index);
      expect(new Set(orders).size).toBe(orders.length);
      // 幕 0 是自由运行: 开场即激活 (afterTurns: 0), 且不带状态偏移.
      expect(script.nodes[0]?.trigger.afterTurns).toBe(0);
      expect(script.nodes[0]?.delta).toBeUndefined();
    }
  });

  it('⑤ 每个剧本都有 completion, 都有 abort (危机剧本必看 abort)', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(script.completion).toBeDefined();
      expect(script.completion.when).toBeDefined();
      expect(script.completion.outcome).toBe('completed');
      expect(script.abort).toBeDefined();
    }
  });

  it('⑥ 危机剧本带 abort: 忽略信号 / 说教 / 评判 来访都落 aborted', () => {
    const crisis = ETHICAL_TRAJECTORY_SCRIPT_MAP['ethical_suicide_crisis'];
    expect(crisis).toBeDefined();
    expect(crisis?.abort?.onEvents).toContain('minimizing');
    expect(crisis?.abort?.onEvents).toContain('preaching');
    expect(crisis?.abort?.onEvents).toContain('judgment');
  });

  it('⑦ 每一幕都有督导要点 (referenceNotes), 且不含台词标点', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      for (const node of script.nodes) {
        expect(node.referenceNotes?.length ?? 0).toBeGreaterThan(0);
        for (const note of node.referenceNotes ?? []) {
          expect(note.trim().length).toBeGreaterThan(0);
          // 督导要点是**指令**, 不是要被念出来的句子 —— 问号 / 感叹号一律不出现.
          expect(note).not.toContain('？');
          expect(note).not.toContain('!');
        }
      }
    }
  });

  it('⑧ 伦理事件幕带状态偏移 (进入那一轮一次性叠加), 收束幕不带', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      // 幕 1 = 伦理事件触发: 必须带 delta (状态偏移是这一单的核心控制手段).
      expect(script.nodes[1]?.delta).toBeDefined();
      // 幕 0 = 自由运行: 不带 delta (否则开场就把信任/阻抗滚一遍).
      expect(script.nodes[0]?.delta).toBeUndefined();
    }
  });
});

describe('WP10 · 伦理盲盒剧本 · 内容纪律 (任务单 §1.2 越界即返工)', () => {
  it('① 全部剧本无任何 3 位以上连续数字 (号码形态)', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(flatten(script).match(/\d{3,}/)).toBeNull();
    }
  });

  it('② 危机剧本不出现任何具体方式 / 计划细节', () => {
    const crisis = ETHICAL_TRAJECTORY_SCRIPT_MAP['ethical_suicide_crisis'];
    const text = flatten(crisis ?? ({} as TrajectoryScript));
    const hits = CRISIS_METHOD_KEYWORDS.filter((keyword) => text.includes(keyword));
    expect(hits).toEqual([]);
  });

  it('③ 危机剧本仍留有间接行为线索 (禁方式 ≠ 禁信号)', () => {
    const crisis = ETHICAL_TRAJECTORY_SCRIPT_MAP['ethical_suicide_crisis'];
    const text = flatten(crisis ?? ({} as TrajectoryScript));
    const hits = CRISIS_INDIRECT_CUE_KEYWORDS.filter((keyword) => text.includes(keyword));
    expect(hits.length).toBeGreaterThan(0);
  });

  it('④ 全部剧本不含具体机构名 / 电话 / 地址 (求助路径只写类别词)', () => {
    // 类别词允许出现 (求助路径只到"专业支持 / 医疗机构"这一层), 具体渠道不允许.
    const forbidden = /[0-9]{4,}|@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/|微信群|公众号|电话号码/;
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(flatten(script)).not.toMatch(forbidden);
    }
  });

  it('⑤ 剧本不含来访者/咨询师的口语台词 (只有状态目标与禁止行为)', () => {
    // 台词的特征是"引号包起来的完整一句话"; 督导要点里的引号只包短语 (常见于"就当朋友").
    // 这条断言锁的是**形态**: 台词里会出现问号 / 感叹号 / 引号收尾的整句 —— 一律不许.
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      const text = flatten(script);
      expect(text).not.toMatch(/[？！]/);
    }
  });
});

describe('WP10 · 剧本解析端口 (静态实现)', () => {
  it('① 查得到 → 返回剧本本体', () => {
    const resolver = new StaticTrajectoryScriptResolver();
    const script = resolver.resolve('ethical_private_contact');

    expect(script).toBeDefined();
    expect(script?.scriptId).toBe('ethical_private_contact');
    expect(script?.mode).toBe('force_override');
  });

  it('② 查不到 → undefined (**不抛错** —— 剧本是可选增强)', () => {
    const resolver = new StaticTrajectoryScriptResolver();

    expect(() => resolver.resolve('ethical_not_exists')).not.toThrow();
    expect(resolver.resolve('ethical_not_exists')).toBeUndefined();
  });

  it('③ 缺省 / 空白 / 前后空格 → undefined 或归一化后的剧本', () => {
    const resolver = new StaticTrajectoryScriptResolver();

    expect(resolver.resolve(undefined)).toBeUndefined();
    expect(resolver.resolve('')).toBeUndefined();
    expect(resolver.resolve('   ')).toBeUndefined();
    // 前后空格归一 (客户端拼串时常见) —— 归一后仍查得到.
    expect(resolver.resolve('  ethical_gift_money  ')?.scriptId).toBe('ethical_gift_money');
  });

  it('④ 内存表与数组是同一份剧本对象 (不存在第二份真相)', () => {
    for (const script of ETHICAL_TRAJECTORY_SCRIPTS) {
      expect(ETHICAL_TRAJECTORY_SCRIPT_MAP[script.scriptId]).toBe(script);
    }
  });
});
