import { CONTINUE_TAG } from './close-discipline.js';
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
