import { CONTINUE_TAG } from './close-discipline.js';
import { targetTurnsBandText, type SessionProfile } from '../../../session-profile.js';
import type { PromptSection } from '../../dto/counselor-types.js';

/**
 * 危机后置练习窗的**阶段任务**.
 *
 * 为什么不能复用 CRISIS_PROTOCOL:
 *   ① 那段说的是"怎么回应一次危机", 没有说"危机之后这几轮练什么";
 *   ② 后置窗里的任务与常规轮不一样 —— 不推进新议题、不做解释性诠释.
 *
 * 注意: 这个 section 的 enabled 是动态的 (crisisMode=true 才启用),
 * 所以 builder 会在运行时根据参数决定要不要加这块.
 */
export function crisisStabilizationSection(crisisMode: boolean): PromptSection {
  return {
    id: 'crisis-stabilization',
    order: 50,
    enabled: crisisMode,
    content: [
      '',
      '## 当前阶段：危机已披露，进入稳定化',
      '来访者刚才表达了危机。接下来的几轮，你的任务只有三件，按顺序推进：',
      '① 安全确认 —— 直接、平静地确认他此刻是否安全：有没有实施伤害自己的打算、有没有具体计划、身边有没有人可以陪着；',
      '② 稳定化 —— 帮他回到当下：呼吸、身边能摸到看到的具体物件、此刻能联系上的人；',
      '③ 下一步 —— 明确今天/今晚的行动安排与求助渠道：可信任的人、心理援助热线、必要时就医。',
      '这一阶段**不**推进新议题、**不**深挖创伤细节、**不**做解释性诠释；没有完成安全确认之前不要收尾。',
      `每一轮仍然按上面的收尾纪律标注状态，但这一阶段通常应输出 ${CONTINUE_TAG}。`,
    ].join('\n'),
  };
}

/**
 * AF-133 · 风险收束块 (危机后置练习窗里的**五项**, 独立成块).
 *
 * ── 为什么必须是独立的一块 ────────────────────────────────────────────────
 *   AF-131 §2.2 / §2.3: 16 场里 6 场被危机窗计数器硬切, 停在**危机处置的中途**;
 *   结构审计里危机收束五组 (means / channel / contact / noAlone / commitment)
 *   覆盖率也最低. 原因不是模型不会说, 是它只被要求"做 grounding" ——
 *   共情 + 锚定当下 ≠ 风险收束. 五项必须**逐项落地**, 所以独立成块.
 *
 * ── 什么时候启用 ──────────────────────────────────────────────────────────
 *   ① 危机窗激活 (crisisMode=true) —— 整个危机窗里都要**逐步**把五项做出来;
 *   ② runner 判定"这一轮是风险收束轮" (closingRound=true) —— 那一轮五项必须齐全,
 *      齐全之后才允许输出 END.
 *   ⚠️ legacy 档关闭: legacy 的 prompt 必须逐字不变, 而且 15 轮短对练
 *      不存在"危机窗收束不可达"的问题 (AF-131 的 16 场全是 long 档).
 *
 * @param profile 会话档案 (判 legacy / 长会话档)
 * @param crisisMode 危机窗是否激活
 * @param closingRound 这一轮是不是风险收束轮
 * @returns prompt 纪律块 (legacy 档时 enabled=false)
 */
export function crisisRiskClosingSection(profile: SessionProfile, crisisMode: boolean, closingRound: boolean): PromptSection {
  const enabled = targetTurnsBandText(profile) !== null && (crisisMode || closingRound);
  const closingRoundLine = closingRound
    ? [
        '',
        '⚠️ **这一轮就是风险收束轮**：上面五项必须**齐全** —— 缺一项就不许输出 END，',
        '先把它补上（可以先确认安全、再逐项落地），五项齐了才收尾。',
      ].join('\n')
    : ['', '本阶段仍按上面的稳定化任务推进；**系统会在最后一轮明确告诉你那是风险收束轮**，', '那一轮五项必须齐全才允许 END。'].join('\n');
  const content = [
    '',
    '## 风险收束（五项 · 缺一不可）',
    '只做共情、只做 grounding（锚定当下、呼吸、回到此刻）**不算**风险收束。',
    '下面五件事**一项都不能少**，而且每项都要有**具体的动作和具体的对象**；',
    '用自然中文口语说出来，不要念编号，也不要把英文标签读给来访者听：',
    '',
    '1. **移除危险物 / 开放安全空间**：把可能用来伤害自己的东西**收起来 / 放远 / 拿走** ——',
    '   比如药物、剪刀、绳子、锐器**放到**他够不着的地方；或者把门打开，离开那个封闭的空间。',
    '2. **求助渠道**：给出**具体**的渠道和号码 —— **心理援助热线**、**120**、**急诊**、**110**，',
    '   并说清什么情况下打、现在能不能打通。',
    '3. **可联系的人**：指名**具体的人** —— 今晚**联系**一位**家人**、**朋友**、**邻居**或**同事**，',
    '   不是“想想有没有人”，而是“我现在帮你确认今晚谁能过来”。',
    '4. **不要独处**：明确说**不要一个人**待着、**不要独处**，今晚要有人**陪着**。',
    '5. **安全承诺 / 安全计划**：和来访者一起做一个**安全计划** —— 包括他答应你的部分',
    '   （**答应我**今晚不伤害自己）和你答应他的部分（我**保证**会一直在线、随时能联系到你）。',
    closingRoundLine,
    '⚠️ 来访者此刻还不安全时，优先做安全确认与稳定化，**不要为了凑齐五项而跳过安全评估**。',
  ].join('\n');

  return {
    id: 'crisis-risk-closing',
    order: 55,
    enabled,
    content,
  };
}
