// V2026-10-27 治本 (情景演练 · crisis 赛道剧本 — 3 个会内突发脚本):
//   原因: 任务单 §3.2 拍板 crisis 赛道本期做 2-3 个"会内突发"脚本 ——
//     标准对话进行中, 来访者某一轮冒出风险表达 (对应现有 7 类信号里的告别主题 /
//     无支撑感 / 状态骤变), 练习的是**识别信号 + 开放式探问 + 平稳引导求助**.
//     §3.1 同时把合规红线定到最高优先级: 不训练干预/治疗技术、不做恶化推演、
//     不给风险量化、不出现任何具体热线号码 / 机构名 / 地址、化名、不写完整病史.
//
//   修法: 本文件是 crisis 赛道的**内容基线** (静态 TS, 不落库 / 不进 migration),
//     与 boundary 赛道**分目录存放** (任务单 §5.5 的物理隔离要求之一):
//       config/scripts/boundary/  —— 设置压力测试
//       config/scripts/crisis/    —— 危机识别会内突发
//     每个脚本的 requiredPoints 固定三锚点 (顺序固定):
//       ① openProbe       —— 用开放式探问 (而不是评判式追问 / 急着给建议)
//       ② nonJudgmental  —— 保持不评判 (不否定、不淡化)
//       ③ guideToSupport  —— 平稳引导到专业求助路径 (通用引导, 不含号码/机构名)
//
//   ── 内容纪律 (危机赛道专属, 越界即返工) ──
//   - **不写具体风险词**: 本文件全文不出现任何"危机内容词表"里的字样
//     (由 test/counselor/drill-isolation.spec.ts 物理锁死). 风险表达只用**间接的
//     行为线索**描述 (交代后事、清点身边物品、谁都不想说、突然的平静),
//     跟 crisis-practice.config.ts 的既有口径一致 —— 练的是"看见信号", 不是复述风险方式.
//   - **不出现任何 3 位以上连续数字**: 全文 (含年龄/编号) 不得出现号码形态, 同样由隔离测试锁死.
//   - **不写干预技术**: referenceResponse 只到"开放式探问 + 通用求助引导"为止,
//     不含任何安全计划、风险评估、干预步骤; commonPitfalls 里明确写"不要做"什么.
//   - **不写具体求助渠道**: 只写"专业支持 / 心理援助 / 专业机构"这类**类别词**,
//     具体号码与机构名由运营按当地规范另行告知 (与既有 crisis-practice.config.ts 同款口径).
//   - **中性化名 + 不写病史**: 人设只到"称呼 / 年龄 / 性别 / 职业 / 一句背景", 背景不涉创伤细节.
//
//   ── 反双胞胎 ──
//   - **不在 boundary 目录里混放 crisis 脚本**: 两个赛道分目录, 隔离测试按目录核对.
//   - **不新建一套 crisis 锚点 key**: 三个锚点 key 全赛道统一 (见 drill.types.ts).
//   - **不复用 crisis-practice.config.ts 的分级文案**: 那边是"教学元数据壳",
//     这边是"会内突发的可练剧本", 两者用途不同; 但**信号口径保持一致** (同一套 7 类信号).
//
//   验证:
//     1. tsc 0 错
//     2. npx jest test/counselor/drill-isolation.spec.ts 全绿 (6 条不变量)
//     3. npx jest test/counselor/drill-judge.spec.ts 全绿 (crisis 只出覆盖清单, verdict 恒 null)
//   时间戳: 2026-10-27 20:05 GMT+8

import { PracticeDifficulty } from '../../../../enums/practice-difficulty.enum';
import { DRILL_CRISIS_ANCHOR_KEYS, type DrillScript } from '../../../domain/drill.types';

/**
 * crisis 赛道通用边界声明 (非临床口径).
 *
 * 任务单 §3.1: crisis 必填边界声明, 沿用非临床口径.
 * 与 crisis-practice.config.ts 的既有声明同款措辞, 但**独立声明** (不同模块的
 * 边界文案各自独立, 避免一处改动牵动另一处).
 */
export const DRILL_CRISIS_BOUNDARY_NOTICE =
  '本场景仅练习识别风险信号与开放式探问沟通, 非真实危机干预, 不替代专业帮助; 不含风险评估、干预技术或具体求助渠道。';

/**
 * crisis 赛道剧本集 (3 个).
 */
export const CRISIS_DRILL_SCRIPTS: readonly DrillScript[] = [
  {
    drillId: 'crisis_farewell_signal',
    track: 'crisis',
    difficulty: PracticeDifficulty.L2,
    title: '会中段冒出"交代后事"式表达',
    persona: {
      name: '阿澈',
      age: 34,
      gender: '女',
      occupation: '档案管理员',
      background: '最近一段时间睡眠紊乱, 白天靠咖啡撑着',
    },
    setting: '常规会谈进行到中段, 来访者的话头忽然转向"该交代的都交代了"',
    visitorPrompt: '其实我最近想通了一些事, 该交代的事情也都交代过了, 身边的东西也清点了一遍……现在反而挺平静的。',
    requiredPoints: [
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.OPEN_PROBE,
        label: '用开放式探问把话头接住',
        positiveKeywords: ['多讲讲', '具体说说', '能多说一点', '是怎么开始的', '什么让你', '多说说', '愿意讲讲'],
        antiKeywords: ['别想了', '这没什么', '你就是想太多'],
        missedHint: '这里可以多问一句 —— 让来访者自己展开这句话背后的时间线, 而不是由你替它下结论。',
      },
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.NON_JUDGMENTAL,
        label: '保持不评判、不否定也不淡化',
        positiveKeywords: ['我听到了', '听起来很难', '不着急', '谢谢你告诉我', '这很难', '我明白'],
        antiKeywords: ['别想太多', '别人比你惨', '你要坚强', '想开点'],
        missedHint: '先把这句话接住而不否定也不淡化, 来访者才愿意继续往下说。',
      },
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.GUIDE_TO_SUPPORT,
        label: '平稳引导到专业求助路径',
        positiveKeywords: ['专业支持', '专业帮助', '心理援助', '专业机构', '当地的心理援助', '可以联系'],
        antiKeywords: ['我自己能扛', '不用找别人', '我保证你不会有事', '交给我就好'],
        missedHint: '在谈开之后, 可以平稳地提一句"还有专业支持可以一起找", 而不是由你代替求助。',
      },
    ],
    referenceResponse:
      '我听到了, 这句话听起来不容易讲出口。你愿意的话, 可以多讲讲 —— 是什么让"交代"这件事在这段时间变得这么重要? 我不着急, 你按自己的节奏说就好。',
    commonPitfalls: ['急着追问细节或追问时间表', '当场给出评估结论或判断对方意图', '用安慰话术把这句话盖过去', '答应由自己负责到底'],
    boundaryNotice: DRILL_CRISIS_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
  {
    drillId: 'crisis_no_support_anchor',
    track: 'crisis',
    difficulty: PracticeDifficulty.L2,
    title: '会中段说出"没有人可以讲"',
    persona: {
      name: '砚舟',
      age: 41,
      gender: '男',
      occupation: '长途货运司机',
      background: '常年独自在外, 习惯把事情自己消化掉',
    },
    setting: '常规会谈中段, 来访者提到自己没有任何可以说话的人',
    visitorPrompt: '说出来也没什么用……我这边一个能说话的人都没有, 谁都靠不上, 讲出去只会让人更烦。',
    requiredPoints: [
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.OPEN_PROBE,
        label: '用开放式探问把话头接住',
        positiveKeywords: ['多讲讲', '具体说说', '能多说一点', '是怎么开始的', '什么让你', '多说说', '愿意讲讲'],
        antiKeywords: ['别想了', '这没什么', '你就是想太多'],
        missedHint: '这里可以多问一句 —— 探问"是什么让你觉得谁都靠不上", 而不是急着举出身边的好人。',
      },
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.NON_JUDGMENTAL,
        label: '保持不评判、不否定也不淡化',
        positiveKeywords: ['我听到了', '听起来很难', '不着急', '谢谢你告诉我', '这很难', '我明白'],
        antiKeywords: ['别想太多', '别人比你惨', '你要坚强', '想开点'],
        missedHint: '先把"说了也没用"这句话接住, 不否定也不淡化, 来访者才愿意继续说下去。',
      },
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.GUIDE_TO_SUPPORT,
        label: '平稳引导到专业求助路径',
        positiveKeywords: ['专业支持', '专业帮助', '心理援助', '专业机构', '当地的心理援助', '可以联系'],
        antiKeywords: ['我自己能扛', '不用找别人', '我保证你不会有事', '交给我就好'],
        missedHint: '这一层要做的是"并肩找资源", 而不是由你替代对方成为唯一的支持来源。',
      },
    ],
    referenceResponse:
      '谢谢你告诉我这些。我听到你说"讲了也没用" —— 能多说一点, 是什么让你觉得连说出去都没有用吗? 我们不着急下结论, 你按自己的节奏讲。',
    commonPitfalls: ['用"总会有人关心你"这类空话回应', '急着替对方盘点身边的关系', '把自己的支持说成唯一的出路'],
    boundaryNotice: DRILL_CRISIS_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
  {
    drillId: 'crisis_acute_state_shift',
    track: 'crisis',
    difficulty: PracticeDifficulty.L3,
    title: '会中段状态骤变、语气突然轻快',
    persona: {
      name: '青川',
      age: 28,
      gender: '女',
      occupation: '美甲师',
      background: '近期换了住处, 与原来的朋友断了联系',
    },
    setting: '常规会谈中段, 来访者的状态与前几次明显不同, 语气格外平静轻快',
    visitorPrompt: '其实最近挺好的, 什么都不觉得了, 也没什么牵挂的。之前那些事现在看都不算什么, 我整个人特别轻松。',
    requiredPoints: [
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.OPEN_PROBE,
        label: '用开放式探问把话头接住',
        positiveKeywords: ['多讲讲', '具体说说', '能多说一点', '是怎么开始的', '什么让你', '多说说', '愿意讲讲'],
        antiKeywords: ['别想了', '这没什么', '你就是想太多'],
        missedHint: '这里可以多问一句 —— 探问"是什么让这段时间变得这么不一样", 把突然的轻松接成可以展开的话头。',
      },
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.NON_JUDGMENTAL,
        label: '保持不评判、不否定也不淡化',
        positiveKeywords: ['我听到了', '听起来很难', '不着急', '谢谢你告诉我', '这很难', '我明白'],
        antiKeywords: ['别想太多', '别人比你惨', '你要坚强', '想开点'],
        missedHint: '对方突然变轻松时, 先接住这个状态而不评价它"是不是装的", 来访者才不会被推回去。',
      },
      {
        key: DRILL_CRISIS_ANCHOR_KEYS.GUIDE_TO_SUPPORT,
        label: '平稳引导到专业求助路径',
        positiveKeywords: ['专业支持', '专业帮助', '心理援助', '专业机构', '当地的心理援助', '可以联系'],
        antiKeywords: ['我自己能扛', '不用找别人', '我保证你不会有事', '交给我就好'],
        missedHint: '这一层要平稳地带一句"如果想有人一起看看, 还有专业支持可以联系", 而不是急着打断对方的轻松。',
      },
    ],
    referenceResponse:
      '我听到你说最近特别轻松。我想多问一句 —— 是什么让这段时间跟之前变得这么不一样? 你愿意的话可以多讲讲, 我这边不着急, 也没有别的安排。',
    commonPitfalls: ['把状态变化直接当成好消息', '马上打断去谈风险', '把"轻松"说成是想通了或放下了', '自己替对方下结论'],
    boundaryNotice: DRILL_CRISIS_BOUNDARY_NOTICE,
    nodes: [],
    branches: [],
  },
];
