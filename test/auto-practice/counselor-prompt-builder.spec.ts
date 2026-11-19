import { describe, expect, it } from 'vitest';

import { CounselorPromptBuilder } from '../../src/auto-practice/counselor/builder/counselor-prompt-builder.js';
import {
  CLOSE_TAG,
  forcedCloseSection,
  sessionCloseDisciplineSection,
} from '../../src/auto-practice/counselor/builder/prompt-sections/close-discipline.js';
import { crisisRiskClosingSection } from '../../src/auto-practice/counselor/builder/prompt-sections/crisis-stabilization.js';
import { sessionOpeningFrameworkSection } from '../../src/auto-practice/counselor/builder/prompt-sections/opening-framework.js';
import type { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { PROMPT_TEMPLATE_FILES, computePromptVersion } from '../../src/auto-practice/prompt-fingerprint.js';
import { LEGACY_SESSION_PROFILE, LONG_SESSION_PROFILE, STANDARD_SESSION_PROFILE } from '../../src/auto-practice/session-profile.js';

const MODE = {
  id: 'expert',
  name: '专家咨询师',
  systemPrompt: '你是一位专家咨询师。',
  description: '',
  enabled: 1,
  sortOrder: 0,
} as CounselorMode;

const builder = new CounselorPromptBuilder();

/**
 * AF-133 · legacy 档 system prompt 的 **golden** (改动前逐字固化).
 *
 * ⚠️ 这两份字符串是 AF-133 改动**之前**的 legacy prompt 全文 —— 任何对
 *   输出纪律 / 一致性要求 / 收尾纪律 / 危机应对 / 危机稳定化块的改动都会让
 *   这条断言变红. 这就是"legacy 逐字不变"红线是可执行的守门.
 *
 * 固化方式: `mode.systemPrompt` + 四个静态纪律块 (legacy 档不挂任何动态块).
 */
const LEGACY_GOLDEN = `你是一位专家咨询师。

## 输出纪律
你只输出咨询师本人说的话，不要写旁白、括号注释、动作描写、心理活动或任何解释；
也不要使用 markdown 符号（**、#、>、- 列表等），这是当面说话，不是写文档。

## 一致性要求
你要记住自己之前说过的话和来访者提到的关键事实，不要前后矛盾。
- 如果来访者提到的细节跟你之前说的不一样，要指出来确认，而不是假装记得或重新编造；
- 不要主动编造来访者没提过的背景信息（比如他的工作、家庭、爱好）——除非他自己说了；
- 重复确认事实时要稳，不要每次都换一种说法。

## 收尾纪律
每一轮回复的**最后一行**都必须只写一个状态标记（正文与标记之间空一行）：
- [[STATE:MORE]] —— 议题还在展开，本轮结束后还要继续；
- [[STATE:END]] —— 本轮你说的话就是这次咨询的收尾：已经做了总结、给了方向或约定了下一步，
  来访者的主要议题已经落地，再来一轮就是没必要的拖长。
判断标准偏向"该收就收"：真人在这种情况会说"今天先到这里"，而不是继续追问细节。
标记只能出现在最后一行，正文里不要解释它、不要复述它。

## 危机应对
如果来访者提到自伤、自杀念头、伤害他人的想法或严重的心理危机，你必须按标准危机干预流程回应：
① 表达关心和重视 —— 让来访者感到你听到了、你在意他的安全，而不是在处理一件普通的事；
② 评估安全性 —— 直接、平静地询问他此刻有没有伤害自己的打算、有没有具体计划、身边有没有人；
③ 建议寻求专业帮助 —— 明确建议联系心理援助热线、寻求专业医疗帮助，或请可信赖的人陪着他；
④ 不要轻视或回避 —— 不评判、不说"想开点""别想太多"，也不因为对方提到危机就草草结束这次咨询。
出现危机时，这一轮输出 [[STATE:MORE]]（不要收尾）—— 你还要继续跟来访者在一起。`;

/** legacy + 危机窗的 golden (危机稳定化块在 legacy 危机窗里本来就生效). */
const LEGACY_CRISIS_GOLDEN = `你是一位专家咨询师。

## 输出纪律
你只输出咨询师本人说的话，不要写旁白、括号注释、动作描写、心理活动或任何解释；
也不要使用 markdown 符号（**、#、>、- 列表等），这是当面说话，不是写文档。

## 一致性要求
你要记住自己之前说过的话和来访者提到的关键事实，不要前后矛盾。
- 如果来访者提到的细节跟你之前说的不一样，要指出来确认，而不是假装记得或重新编造；
- 不要主动编造来访者没提过的背景信息（比如他的工作、家庭、爱好）——除非他自己说了；
- 重复确认事实时要稳，不要每次都换一种说法。

## 收尾纪律
每一轮回复的**最后一行**都必须只写一个状态标记（正文与标记之间空一行）：
- [[STATE:MORE]] —— 议题还在展开，本轮结束后还要继续；
- [[STATE:END]] —— 本轮你说的话就是这次咨询的收尾：已经做了总结、给了方向或约定了下一步，
  来访者的主要议题已经落地，再来一轮就是没必要的拖长。
判断标准偏向"该收就收"：真人在这种情况会说"今天先到这里"，而不是继续追问细节。
标记只能出现在最后一行，正文里不要解释它、不要复述它。

## 危机应对
如果来访者提到自伤、自杀念头、伤害他人的想法或严重的心理危机，你必须按标准危机干预流程回应：
① 表达关心和重视 —— 让来访者感到你听到了、你在意他的安全，而不是在处理一件普通的事；
② 评估安全性 —— 直接、平静地询问他此刻有没有伤害自己的打算、有没有具体计划、身边有没有人；
③ 建议寻求专业帮助 —— 明确建议联系心理援助热线、寻求专业医疗帮助，或请可信赖的人陪着他；
④ 不要轻视或回避 —— 不评判、不说"想开点""别想太多"，也不因为对方提到危机就草草结束这次咨询。
出现危机时，这一轮输出 [[STATE:MORE]]（不要收尾）—— 你还要继续跟来访者在一起。

## 当前阶段：危机已披露，进入稳定化
来访者刚才表达了危机。接下来的几轮，你的任务只有三件，按顺序推进：
① 安全确认 —— 直接、平静地确认他此刻是否安全：有没有实施伤害自己的打算、有没有具体计划、身边有没有人可以陪着；
② 稳定化 —— 帮他回到当下：呼吸、身边能摸到看到的具体物件、此刻能联系上的人；
③ 下一步 —— 明确今天/今晚的行动安排与求助渠道：可信任的人、心理援助热线、必要时就医。
这一阶段**不**推进新议题、**不**深挖创伤细节、**不**做解释性诠释；没有完成安全确认之前不要收尾。
每一轮仍然按上面的收尾纪律标注状态，但这一阶段通常应输出 [[STATE:MORE]]。`;

describe('AF-129 · 长会谈开场知情框架与结束收束纪律', () => {
  it('legacy 档不加开场框架，也不加长会话收尾纪律（逐字不变）', () => {
    const implicit = builder.build(MODE, false);
    const explicit = builder.build(MODE, false, LEGACY_SESSION_PROFILE, 3);
    expect(implicit).toBe(explicit);
    expect(implicit).not.toContain('## 开场知情框架');
    expect(implicit).not.toContain('## 长会话收尾纪律');
    expect(implicit).toContain('## 收尾纪律');
  });

  it('long 档启用开场知情框架，并覆盖五要素', () => {
    const prompt = builder.build(MODE, false, LONG_SESSION_PROFILE, 10);
    expect(prompt).toContain('## 开场知情框架');
    expect(prompt).toContain('保密');
    expect(prompt).toContain('例外');
    expect(prompt).toContain('约定');
    expect(prompt).toContain('边界');
    expect(prompt).toContain('分钟');
    expect(prompt).toContain('每周一次');
    expect(prompt).toContain('喊停');
    expect(prompt).toContain('可以拒绝');
    expect(prompt).toContain('录音');
    expect(prompt).toContain('同意');
  });

  it('standard 档同样启用开场知情框架', () => {
    const prompt = builder.build(MODE, false, STANDARD_SESSION_PROFILE, 5);
    expect(prompt).toContain('## 开场知情框架');
    expect(prompt).toContain('## 长会话收尾纪律');
  });

  it('长会话收尾纪律包含总结、带走、下一步三要素，且不早于 minTurnsBeforeClose', () => {
    const section = sessionCloseDisciplineSection(LONG_SESSION_PROFILE, 40);
    expect(section.enabled).toBe(true);
    expect(section.content).toContain('总结本次理解');
    expect(section.content).toContain('带走');
    expect(section.content).toContain('下一步安排');
    expect(section.content).toContain('第 35 轮之前不得输出');
    expect(section.content).toContain(CLOSE_TAG);
  });

  it('开场块只在长会话档案启用，legacy 档关闭', () => {
    expect(sessionOpeningFrameworkSection(LEGACY_SESSION_PROFILE).enabled).toBe(false);
    expect(sessionOpeningFrameworkSection(LONG_SESSION_PROFILE).enabled).toBe(true);
    expect(sessionOpeningFrameworkSection(STANDARD_SESSION_PROFILE).enabled).toBe(true);
  });

  it('开场块纳入 prompt_version 指纹，且真实仓库可算出非 unknown', () => {
    expect(PROMPT_TEMPLATE_FILES).toContain('counselor/builder/prompt-sections/opening-framework');
    expect(computePromptVersion()).not.toBe('unknown');
  });
});

describe('AF-133 · 开场五要素硬模板（结构审计可命中的原词）', () => {
  const content = sessionOpeningFrameworkSection(LONG_SESSION_PROFILE).content;

  it('保密与例外：命中 secrecy + exception 两组', () => {
    expect(content).toContain('保密');
    expect(content).toContain('不会告诉别人');
    expect(content).toContain('例外');
    expect(content).toContain('自伤');
    expect(content).toContain('自杀');
    expect(content).toContain('生命危险');
    expect(content).toContain('联系');
    expect(content).toContain('保护你');
  });

  it('设置边界：命中 setting（框架名词）+ limit（边界实质）两组', () => {
    expect(content).toContain('约定');
    expect(content).toContain('框架');
    expect(content).toContain('不评判');
    expect(content).toContain('不指责');
    expect(content).toContain('不能替你决定');
  });

  it('时长与频率：命中 length（50 分钟）+ cadence（每周一次）两组', () => {
    expect(content).toContain('50 分钟');
    expect(content).toContain('每周一次');
  });

  it('可暂停与可拒答：命中 pause + refuse 两组', () => {
    expect(content).toContain('随时可以喊停');
    expect(content).toContain('暂停');
    expect(content).toContain('可以拒绝');
    expect(content).toContain('可以跳过');
    expect(content).toContain('不必勉强');
  });

  it('录音与知情同意：命中 recording + consent 两组', () => {
    expect(content).toContain('录音');
    expect(content).toContain('不录音');
    expect(content).toContain('知情同意');
    expect(content).toContain('征求你的同意');
  });

  it('首轮硬模板 + 前 3 轮补检都在', () => {
    expect(content).toContain('五要素 · 硬模板');
    expect(content).toContain('前 3 轮补检');
    expect(content).toContain('前 3 轮内');
  });
});

describe('AF-133 · 常规收束三件套 + END 前自检三问', () => {
  const content = sessionCloseDisciplineSection(LONG_SESSION_PROFILE, 40).content;

  it('三件套各自带结构审计可命中的原词', () => {
    // summary: 动作词 + 理解复述词（必须同轮出现，所以放在同一句里）
    expect(content).toContain('回顾');
    expect(content).toContain('我听到');
    expect(content).toContain('我的理解');
    // takeaway
    expect(content).toContain('带走');
    expect(content).toContain('写下来');
    // nextStep
    expect(content).toContain('下次');
    expect(content).toContain('回去之后');
    expect(content).toContain('下一步');
  });

  it('END 前自检三问：三个问句 + "全是是才允许 END"的判据', () => {
    expect(content).toContain('输出 END 之前 · 自检三问');
    expect(content).toContain('①');
    expect(content).toContain('②');
    expect(content).toContain('③');
    expect(content).toContain('三问全是“是”才允许输出 END');
    expect(content).toContain('先把缺的那一项补进正文');
  });
});

describe('AF-133 · 强制收束 cue（runner 在 maxTurns 前 2 轮注入）', () => {
  it('cue 开启时产出强制收束块，legacy 档不产出', () => {
    const on = forcedCloseSection(LONG_SESSION_PROFILE, true, 2);
    expect(on.enabled).toBe(true);
    expect(on.content).toContain('## 本场即将结束（强制收束）');
    expect(on.content).toContain('本场还剩 **2 轮**（含本轮）');
    expect(on.content).toContain('收束三件套');
    expect(on.content).toContain('自检三问');
    expect(on.content).toContain(CLOSE_TAG);

    expect(forcedCloseSection(LONG_SESSION_PROFILE, false).enabled).toBe(false);
    expect(forcedCloseSection(LEGACY_SESSION_PROFILE, true).enabled).toBe(false);
  });

  it('prompt 组装：cue 只在 standard / long 生效', () => {
    const withCue = builder.build(MODE, false, LONG_SESSION_PROFILE, 49, { closingCue: 'forced' });
    expect(withCue).toContain('## 本场即将结束（强制收束）');

    const withoutCue = builder.build(MODE, false, LONG_SESSION_PROFILE, 49);
    expect(withoutCue).not.toContain('## 本场即将结束（强制收束）');

    const legacyWithCue = builder.build(MODE, false, LEGACY_SESSION_PROFILE, 14, { closingCue: 'forced' });
    expect(legacyWithCue).not.toContain('## 本场即将结束（强制收束）');
  });
});

describe('AF-133 · 危机收束五项（独立成块）', () => {
  const closingRound = crisisRiskClosingSection(LONG_SESSION_PROFILE, true, true);
  const windowOnly = crisisRiskClosingSection(LONG_SESSION_PROFILE, true, false);

  it('五项都在：移除危险物 / 求助渠道 / 可联系的人 / 不要独处 / 安全承诺', () => {
    expect(closingRound.enabled).toBe(true);
    expect(closingRound.content).toContain('## 风险收束（五项 · 缺一不可）');
    // means
    expect(closingRound.content).toContain('收起来');
    expect(closingRound.content).toContain('药物');
    expect(closingRound.content).toContain('放到');
    // channel
    expect(closingRound.content).toContain('心理援助热线');
    expect(closingRound.content).toContain('120');
    expect(closingRound.content).toContain('急诊');
    // contact
    expect(closingRound.content).toContain('联系');
    expect(closingRound.content).toContain('家人');
    // noAlone
    expect(closingRound.content).toContain('不要一个人');
    expect(closingRound.content).toContain('不要独处');
    // commitment
    expect(closingRound.content).toContain('安全计划');
    expect(closingRound.content).toContain('答应我');
    expect(closingRound.content).toContain('保证');
  });

  it('只有危机窗激活或收束轮才启用；平时不启用', () => {
    expect(windowOnly.enabled).toBe(true);
    expect(crisisRiskClosingSection(LONG_SESSION_PROFILE, false, false).enabled).toBe(false);
    // legacy 档永远关闭（prompt 逐字不变）
    expect(crisisRiskClosingSection(LEGACY_SESSION_PROFILE, true, true).enabled).toBe(false);
  });

  it('收束轮明确要求"五项齐全才允许 END"，非收束轮只做准备', () => {
    expect(closingRound.content).toContain('这一轮就是风险收束轮');
    expect(closingRound.content).toContain('缺一项就不许输出 END');
    expect(windowOnly.content).toContain('系统会在最后一轮明确告诉你那是风险收束轮');
  });

  it('prompt 组装：危机窗里带上五项块', () => {
    const windowPrompt = builder.build(MODE, true, LONG_SESSION_PROFILE, 12);
    expect(windowPrompt).toContain('## 风险收束（五项 · 缺一不可）');
    expect(windowPrompt).toContain('系统会在最后一轮明确告诉你那是风险收束轮');

    const closingPrompt = builder.build(MODE, true, LONG_SESSION_PROFILE, 13, { crisisClosing: true });
    expect(closingPrompt).toContain('这一轮就是风险收束轮');

    const notCrisis = builder.build(MODE, false, LONG_SESSION_PROFILE, 12);
    expect(notCrisis).not.toContain('## 风险收束（五项 · 缺一不可）');
  });
});

describe('AF-133 · legacy 档 system prompt 逐字不变（golden）', () => {
  it('legacy 档 system prompt 与改动前逐字一致', () => {
    expect(builder.build(MODE, false)).toBe(LEGACY_GOLDEN);
    expect(builder.build(MODE, false, LEGACY_SESSION_PROFILE, 7)).toBe(LEGACY_GOLDEN);
  });

  it('legacy 档 + 危机窗也与改动前逐字一致', () => {
    expect(builder.build(MODE, true)).toBe(LEGACY_CRISIS_GOLDEN);
    expect(builder.build(MODE, true, LEGACY_SESSION_PROFILE, 7)).toBe(LEGACY_CRISIS_GOLDEN);
  });

  it('legacy 档加上 AF-133 的两个 cue 也不变（cue 只对 standard / long 生效）', () => {
    expect(builder.build(MODE, false, LEGACY_SESSION_PROFILE, 14, { closingCue: 'forced', crisisClosing: true })).toBe(LEGACY_GOLDEN);
    expect(builder.build(MODE, true, LEGACY_SESSION_PROFILE, 14, { closingCue: 'forced', crisisClosing: true })).toBe(LEGACY_CRISIS_GOLDEN);
  });
});
