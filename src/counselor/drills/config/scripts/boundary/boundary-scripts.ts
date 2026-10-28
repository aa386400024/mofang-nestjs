// V2026-10-27 治本 (情景演练 · boundary 赛道剧本 — 5 个确定性脚本):
//   原因: 任务单 §2.1 拍板 boundary 赛道先做 5 个脚本, 每个对应一个**突破点**
//     (私下加联系方式 / 超时拖延 / 非工作时间刷屏 / 要求免费加时 / 索要直接建议·送礼).
//     §2.2 要求三档判定"写成纯函数可单测", 意味着**判定锚点必须随脚本一起定版**:
//     关键词命中什么 → 判成哪一档, 必须在剧本里写死, 否则"改档位语义"会变成
//     改若干处散落的字符串, 谁也不知道哪条规则在生效.
//   修法: 本文件是 boundary 赛道的**内容基线** (静态 TS, 不落库 / 不进 migration),
//     与 visitor-pool-seed.ts / practice-scenario-seeds.ts 同范式:
//       剧本内容 (人设 / 来访者原话 / 锚点关键词 / 参考回应 / 常见偏差) 全部在这里定版,
//       判定引擎 (drill-judge.ts) 只认**锚点 key**, 不认具体字符串.
//     每个脚本的 requiredPoints 固定三锚点 (顺序固定):
//       ① namesEmotion     —— 接住对方的感受 (共情)
//       ② holdsBoundary    —— 守住设置 (含"松口"反向词 → over_compromise)
//       ③ offersAlternative —— 给出可行替代路径
//
//   ── 内容纪律 (与危机赛道的差别, 别混) ──
//   - boundary 场景是**设置压力**, 不是危机场景: 谈的是"加微信 / 延长时间 / 免费加时",
//     属专业边界范畴, 不涉及风险信号.
//   - 关键词不写"具体机构名 / 号码 / 地址": 替代路径只写**动作** (工作时间内回复 / 预约 / 机构渠道),
//     由运营按当地规范另行告知具体资源.
//   - 措辞零压: 脚本文案里不出现"得分 / 及格 / 失败 / 优秀"等评价性词, 批注由引擎生成.
//
//   ── 反双胞胎 ──
//   - **不在 service 里写死关键词**: 关键词只在本文件; service 只负责取剧本 + 调引擎.
//   - **不给每个脚本单独造一套锚点 key**: 三个锚点 key 全赛道统一 (见 drill.types.ts),
//     否则引擎要按脚本名分支 → 每个新脚本都要改引擎.
//   - **不把"松口"反向词放在情绪锚点上**: 反向词只表达"边界被放开"; 情绪锚点的反向词
//     表达"评判式回应", 两类语义必须分开, 否则三档判定会被情绪词带偏.
//
//   验证:
//     1. tsc 0 错
//     2. npx jest test/counselor/drill-judge.spec.ts 全绿 (三档各正例/反例命中正确档位)
//     3. 每个脚本的锚点 key 集合一致 (validateDrillScripts 自检)
//   时间戳: 2026-10-27 19:55 GMT+8

import { PracticeDifficulty } from '../../../../enums/practice-difficulty.enum';
import { DRILL_BOUNDARY_ANCHOR_KEYS, type DrillScript } from '../../../domain/drill.types';

/**
 * boundary 赛道通用边界声明.
 *
 * 任务单 §1.2: "boundary 可空用通用声明" —— 逐场景没有专属声明时用这一条,
 * 保证前端隔离壳永远拿得到"这是技术演练, 不是对人的评估"这句边界.
 */
export const DRILL_GENERIC_BOUNDARY_NOTICE = '本模块练习的是会谈设置与边界的表达方式，属技术演练，不构成对真实来访者的评估。';

/**
 * boundary 赛道剧本集 (5 个).
 */
export const BOUNDARY_DRILL_SCRIPTS: readonly DrillScript[] = [
  {
    drillId: 'boundary_wechat_contact',
    track: 'boundary',
    difficulty: PracticeDifficulty.L1,
    title: '结束时提出加微信',
    persona: {
      name: '阿宁',
      age: 29,
      gender: '女',
      occupation: '客服主管',
      background: '工作节奏紧, 习惯把"随时能找到人"当作安全感来源',
    },
    setting: '会谈接近尾声, 来访提出私下留联系方式',
    visitorPrompt: '老师, 结束的时候能不能加个微信? 以后我这边临时有事也能随时找您。',
    requiredPoints: [
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY,
        label: '接住对方的感受',
        positiveKeywords: ['我理解', '听起来', '能感觉到', '我明白', '辛苦', '不容易', '这份担心'],
        antiKeywords: ['这有什么大不了', '别矫情', '想开点'],
        missedHint: '这一轮可以先接住对方"怕联系不上"的不安, 再谈设置 —— 共情在前, 边界才不显得冷。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY,
        label: '守住设置',
        positiveKeywords: ['按我们的设置', '按约定', '这个我不能', '按规定', '设置的边界', '不加私人联系方式', '不加微信'],
        antiKeywords: ['我同意加', '加我微信', '给你留微信', '随时可以找我', '那我加你', '行吧可以'],
        missedHint: '这一轮需要一句明确的"设置在这里", 让对方知道边界是可以被说出口的。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.OFFERS_ALTERNATIVE,
        label: '给出可行替代路径',
        positiveKeywords: ['工作时间内', '预约', '机构渠道', '留言', '下次会谈', '转给'],
        antiKeywords: ['你自己想办法', '别来找我', '那就这样吧'],
        missedHint: '守住设置之后给一条真正可走的路 (例如: 工作时间内通过机构渠道回复), 对方才有"被接住"的感觉。',
      },
    ],
    referenceResponse:
      '我理解你担心临时有事联系不上, 这份不安挺不容易的。我们的设置是不加私人联系方式, 但工作时间内你随时可以留言, 我看到会回复; 如果有特别急的事, 我们也可以在会谈里一起约一个更早的时间。',
    commonPitfalls: ['先答应加微信再解释', '只说"规定就是这样"把话堵死', '把设置说成对方"不够懂事"'],
    boundaryNotice: DRILL_GENERIC_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
  {
    drillId: 'boundary_overtime',
    track: 'boundary',
    difficulty: PracticeDifficulty.L1,
    title: '到点后请求延长时间',
    persona: {
      name: '沈越',
      age: 34,
      gender: '男',
      occupation: '独立开发',
      background: '习惯把没说完的话留到最后, 容易在收尾处超时',
    },
    setting: '会谈时长已到, 来访希望再讲十分钟',
    visitorPrompt: '老师, 我们再加十分钟吧, 我马上就讲完了, 这一段特别重要。',
    requiredPoints: [
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY,
        label: '接住对方的感受',
        positiveKeywords: ['我理解', '听起来', '能感觉到', '我明白', '舍不得', '还有话没说完', '想讲完'],
        antiKeywords: ['每次都这样', '你自己没规划好', '这有什么好急的'],
        missedHint: '这里可以先承认"这段话对对方很重要", 让对方感到被听见, 再收住时长。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY,
        label: '守住设置',
        positiveKeywords: ['按约定的时间', '五十分钟', '时间到了', '今天先到这里', '到点就该结束', '按我们的设置'],
        antiKeywords: ['再给你十分钟', '我们继续', '加十分钟', '再多讲', '那就不走了'],
        missedHint: '需要一句明确的收尾 ("今天我们先到这里"), 加上原因, 对方才知道这是设置而不是被嫌烦。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.OFFERS_ALTERNATIVE,
        label: '给出可行替代路径',
        positiveKeywords: ['下次会谈', '约下次', '下次接着说', '留到下次', '写在记录里'],
        antiKeywords: ['那你就憋着', '别想了', '我也没时间'],
        missedHint: '收尾之后接一句"下次从这一段接着讲", 超时这件事就变成了有出口的选择。',
      },
    ],
    referenceResponse:
      '我听到这一段对你很重要, 能感觉到你还想把它讲完。今天我们的时间是五十分钟, 我想按约定先到这里 —— 要不我们把它记下来, 下次会谈一开始就接着这一段讲, 你看行吗?',
    commonPitfalls: ['直接拒绝, 不给替代', '为了显得好说话就延长', '把超时归因为对方"不自觉"'],
    boundaryNotice: DRILL_GENERIC_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
  {
    drillId: 'boundary_after_hours_chat',
    track: 'boundary',
    difficulty: PracticeDifficulty.L2,
    title: '非工作时间连续发消息',
    persona: {
      name: '语桐',
      age: 26,
      gender: '女',
      occupation: '教培老师',
      background: '白天被学生和家长围着, 夜里才有自己的时间',
    },
    setting: '晚上十一点, 来访连发几条长消息, 期待即时回应',
    visitorPrompt: '老师, 已经十一点了。我今天特别想找您说说白天那些事, 一直压在心里, 您方便回我一下吗?',
    requiredPoints: [
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY,
        label: '接住对方的感受',
        positiveKeywords: ['我理解', '听起来', '能感觉到', '我明白', '压在心里', '想找您说说', '辛苦'],
        antiKeywords: ['你白天不是来过吗', '这么晚还', '别熬夜了'],
        missedHint: '可以先接住"一整天都没被接住"的感觉, 让对方知道这句话有人认真对待。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY,
        label: '守住设置',
        positiveKeywords: ['工作时间', '上班时间', '非工作时间', '按我们的设置', '我们约定的联系时间'],
        antiKeywords: ['我马上回您', '现在就可以聊', '我在线等您', '随时找我都行', '我手机不关机'],
        missedHint: '这一轮需要说清"非工作时间我不回消息"这个设置, 同时不让人觉得被拒绝。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.OFFERS_ALTERNATIVE,
        label: '给出可行替代路径',
        positiveKeywords: ['明天', '预约', '留言', '工作时间内回复', '写在纸上带来', '下次会谈'],
        antiKeywords: ['那你就等吧', '别找我了', '我也需要休息'],
        missedHint: '守住时间设置之后, 给一个具体的落点 (例如: 明天工作时间内我先回您), 对方才等得住。',
      },
    ],
    referenceResponse:
      '我听到你今天一整天都在撑着, 晚上才有空说出来, 这确实不容易。我们的设置是工作时间内联系, 所以现在我先不即时回您 —— 您先把想说的写下来, 明天工作时间内我会先看, 重的部分我们约个时间细聊。',
    commonPitfalls: ['被感动后直接秒回, 之后每晚都会被找', '只讲设置不讲替代', '让对方为"占用你的时间"道歉'],
    boundaryNotice: DRILL_GENERIC_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
  {
    drillId: 'boundary_free_extra',
    track: 'boundary',
    difficulty: PracticeDifficulty.L2,
    title: '要求免费加时',
    persona: {
      name: '一诺',
      age: 31,
      gender: '男',
      occupation: '销售',
      background: '收入浮动, 对"能不能便宜一点"很敏感, 怕开口显得计较',
    },
    setting: '会谈快结束, 来访小心地问能不能多给一些时间',
    visitorPrompt: '老师, 这次能不能多送我半小时? 我预算实在不够了, 不好意思开口...',
    requiredPoints: [
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY,
        label: '接住对方的感受',
        positiveKeywords: ['我理解', '能感觉到', '我明白', '不难为情', '为难', '预算', '不需要不好意思'],
        antiKeywords: ['谈钱多俗', '这是你的问题', '别人都付了'],
        missedHint: '可以先把"开口问预算"这件事从难堪里解出来, 让对方知道你不会因此看低他。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY,
        label: '守住设置',
        positiveKeywords: ['按设置', '时长是固定的', '服务时长', '我们约定的时长', '按原定的时长'],
        antiKeywords: ['免费送你', '那就免费', '破例给你', '算我请', '这次不收你钱'],
        missedHint: '这一轮需要明确"时长按设置来", 而且语气要稳 —— 破例一次, 后面每次都会更难谈。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.OFFERS_ALTERNATIVE,
        label: '给出可行替代路径',
        positiveKeywords: ['下次预约', '延长时段', '分两次', '机构优惠', '可以问问', '另外安排'],
        antiKeywords: ['那就这样吧', '我也帮不了', '你自己看着办'],
        missedHint: '把"能不能多给"翻译成"可以怎么安排", 例如分两次谈或另约更长时段, 对方才有选择感。',
      },
    ],
    referenceResponse:
      '我理解你的顾虑, 也谢谢你愿意直接问出来 —— 这完全不需要不好意思。我们的设置是按原定时长来, 这次不多加; 但如果你觉得时间不够用, 我们可以下次约一个更长的时段, 或者把这一段拆成两次谈, 看看哪种更合你的用法。',
    commonPitfalls: ['心软破例, 还把它说成"对你特别"', '用"我也没办法"含糊带过', '让对方因为钱感到羞耻'],
    boundaryNotice: DRILL_GENERIC_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
  {
    drillId: 'boundary_advice_gift',
    track: 'boundary',
    difficulty: PracticeDifficulty.L3,
    title: '索要直接建议并带礼物',
    persona: {
      name: '青禾',
      age: 38,
      gender: '女',
      occupation: '护士',
      background: '长期替别人做决定, 累了, 想从咨询师这里直接拿一个结论',
    },
    setting: '会谈中段, 来访直接索要结论, 同时把一个袋子放到了桌上',
    visitorPrompt: '老师, 您就直接告诉我该怎么办吧, 别让我自己选了。（说着把一个袋子放到桌上）',
    requiredPoints: [
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY,
        label: '接住对方的感受',
        positiveKeywords: ['我理解', '听起来', '能感觉到', '我明白', '想有人给个准话', '累', '不容易'],
        antiKeywords: ['你这样想是不对的', '别偷懒', '自己想清楚'],
        missedHint: '这里可以先接住"想被直接推一把"的疲惫, 再说明为什么不替你决定, 对方才听得进去。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY,
        label: '守住设置',
        positiveKeywords: ['我们一起找', '陪你一起梳理', '由你决定', '不替你决定', '这是你的选择', '你的决定'],
        antiKeywords: ['你听我的', '我直接告诉你', '我给你开', '我替你定', '我告诉你答案', '照我说的做'],
        missedHint: '这一轮需要明确"决定权在你这边", 同时不评价对方"想不出办法"这件事。',
      },
      {
        key: DRILL_BOUNDARY_ANCHOR_KEYS.OFFERS_ALTERNATIVE,
        label: '给出可行替代路径',
        positiveKeywords: ['一起探讨', '列几个可能', '一步一步', '下一步做什么', '我们可以先从', '整理一下'],
        antiKeywords: ['你自己想办法', '别来问我', '我给不了建议'],
        missedHint: '不给结论之后要接一条可走的路 (例如: 一起列出几个可能, 再挑一个往下走), 否则就只剩拒绝。',
      },
    ],
    referenceResponse:
      '我理解你是想让一个人替你把决定做了, 这几天一直替别人拿主意, 确实挺累的。我们的做法是不替你决定, 但我可以陪你一起把可能列出来, 一步一步挑; 至于这个袋子, 您的心意我收到了, 但我们之间不需要用礼物来换建议。',
    commonPitfalls: ['给出一句"你该怎么办"的结论', '收下礼物并顺势给建议', '把对方的疲惫说成"逃避"'],
    boundaryNotice: DRILL_GENERIC_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
];
