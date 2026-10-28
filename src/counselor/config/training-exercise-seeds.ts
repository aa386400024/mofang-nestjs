// V2026-10-20 治本 (专项技能训练中心改版 — 10 训练项 seed 基线, 1:1 PRD v1.0 §5.2):
//   原因: training_exercises 表现为空表 (entity 注释自述「Phase 2 seed 后填数据」),
//     改版后详情页首屏要渲染 10 个 mode 行, 无 seed 则整个页面空 — 属于阻塞级缺口.
//     同时原 mock 用「正确 80 + 随机 0-20」评分, 是凑活式实现, 必须由 server 侧
//     可解释的确定性评分取代.
//   修复: 定义 10 条基线 (1 mode = 1 题, 1:1 TRAINING_EXERCISE_MODE_META),
//         服务端启动时幂等 upsert (按 type+mode 唯一), 评分改为确定性 rubric 派生.
//   反双胞胎:
//     - 不在 migration 里 INSERT (内容迭代不该改 schema; seed 走应用层幂等 upsert)
//     - 不保留随机分 (同一份答案每次得分不同 = 无法复盘, 违反「可解释反馈」)
//   验证:
//     1. 服务启动后 SELECT type, mode, difficulty FROM training_exercises → 10 行
//     2. 重复启动不产生重复行 (upsert 幂等)
//     3. 同一 selectedOptionIndex 连续提交两次, score 完全一致 (确定性)
//   时间戳: 2026-10-20
import type { TrainingExerciseRubric } from '../entities/training-exercise.entity';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingExerciseMode } from '../enums/training-exercise-mode.enum';
import { TrainingExerciseType } from '../enums/training-exercise-type.enum';

/**
 * 训练题 seed 数据形状.
 *
 * V2026-10-20 修正 (tsc TS2353 ×10):
 *   原写 `extends TrainingExerciseRubric`, 语义是把 rubric 的 4 个字段
 *   (dimensions/keywords/errorPatterns/improvementHints) **摊平**到 seed 顶层.
 *   但实际数据形态是 **rubric 嵌套对象** —— TrainingExercise 实体上只有一个
 *   `rubric` 列, 不是四个平铺列. 于是 10 条 seed 里的 `rubric: {...}` 全被
 *   判为「未知属性」, 连带 seeds 模块读 seed.rubric 也报 TS2339.
 *   修复: 改为声明 `rubric: TrainingExerciseRubric` 属性, 与实体结构一致.
 *   反双胞胎: 不用 extends 摊平 (会诱导 seed 数据写成平铺形态, 与实体不匹配)
 * 时间戳: 2026-10-20
 */
export interface TrainingExerciseSeed {
  /** 评分标准 (与 TrainingExercise.rubric 列 1:1) */
  rubric: TrainingExerciseRubric;
  type: TrainingExerciseType;
  mode: TrainingExerciseMode;
  difficulty: TrainingDifficulty;
  scenarioContext: string;
  options: string[];
  correctOptionIndex: number;
  expertFeedback: string;
  durationMinutes: number;
  personaName: string;
  personaBackground: string;
  realTimeCorrectionEnabled?: boolean;
}

/**
 * 10 项训练题基线 — 1 mode = 1 题, 覆盖 PRD v1.0 §5.2.1 (3) + §5.2.2 (4) + §5.2.3 (3).
 *
 * 内容规范 (经专业评审口径, 对齐 PRD §10.4):
 *   - scenarioContext 为虚构来访者陈述, 禁止高危议题 (自杀自伤/性创伤/重度精神障碍/人格障碍, PRD §10.3)
 *   - 4 个选项中仅 1 个为专业示范, 其余为新手高频错误
 *   - rubric.dimensions 描述「技术维度」, 不评价来访者, 不评判用户人格 (PRD §8.3 无评判)
 */
export const TRAINING_EXERCISE_SEEDS: TrainingExerciseSeed[] = [
  // ─────────── 倾听共情 §5.2.1 (3) ───────────
  {
    type: TrainingExerciseType.LISTENING,
    mode: TrainingExerciseMode.EMOTION_REFLECTION,
    difficulty: TrainingDifficulty.L1,
    scenarioContext:
      '来访者(小林, 28 岁产品经理)说:「我也不知道怎么了, 反正最近一到周日晚上就开始心慌, 躺在床上睡不着, 爬起来刷手机刷到三四点。」',
    options: [
      '听起来一到周日晚上, 你的心慌就会变得特别明显。',
      '你可以试试冥想 App, 我同事用了效果还不错。',
      '你是不是最近工作压力太大了?',
      '那你一般周日晚上几点开始心慌的?',
    ],
    correctOptionIndex: 0,
    rubric: {
      dimensions: [
        { name: '情绪反射准确度', weight: 0.4 },
        { name: '未夹带建议', weight: 0.3 },
        { name: '聚焦当下情绪', weight: 0.3 },
      ],
      keywords: ['心慌', '周日晚上', '听起来', '感觉'],
      errorPatterns: ['直接给建议', '过早归因压力', '立即转事实追问'],
      improvementHints: ['先命名情绪, 再确认强度, 最后才是事实探索。', '把来访者的话原样取一个情绪词回给他, 比换新词更准。'],
    },
    expertFeedback:
      '情绪反射的技术内核是「用来访者自己的词, 说出他此刻的感受」。本例你取了他自己的「心慌」和「周日晚上」, 并用「听起来」降低断言强度, 让来访者有机会修正。切忌在此刻给建议或做归因 —— 那是倾听阶段最常见的越位。',
    durationMinutes: 5,
    personaName: '小林',
    personaBackground: '28 岁产品经理, 周期性焦虑, 对自我觉察有抵触',
  },
  {
    type: TrainingExerciseType.LISTENING,
    mode: TrainingExerciseMode.FACT_FEELING_SEPARATION,
    difficulty: TrainingDifficulty.L2,
    scenarioContext: '来访者(李女士, 34 岁)说:「我老公根本就是甩手掌柜, 我每天累死累活地带孩子, 他回来就往沙发上一躺刷手机。」',
    options: [
      '你说「甩手掌柜」这个词的时候, 感觉挺愤怒的。',
      '你刚提到他回来就躺在沙发上刷手机, 这是你看到的事实; 而「甩手掌柜」是你给出的评价 —— 这两层可以分开看。',
      '其实很多爸爸都这样的, 你不要太计较。',
      '那你有没有直接跟他说过这个问题?',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '事实与评判的区分', weight: 0.45 },
        { name: '中性立场', weight: 0.3 },
        { name: '未站队评判', weight: 0.25 },
      ],
      keywords: ['事实', '评价', '分开', '看到'],
      errorPatterns: ['直接放大来访者标签', '替来访者开脱', '立刻转行动建议'],
      improvementHints: [
        '把评判词原样还给来访者, 但标明这是「你的感受」而非「事实」。',
        '区分不是否定来访者的感受, 是帮他把感受拿到面前看清。',
      ],
    },
    expertFeedback:
      '这是婚姻咨询里最高频的沟通卡点。来访者用「甩手掌柜」概括对方, 随即进入论证战。你把可观察行为(躺沙发刷手机)和主观评价(甩手掌柜)并列, 既没有否定她的愤怒, 也没有替丈夫辩护, 为后续处理留出了空间。',
    durationMinutes: 6,
    personaName: '李女士',
    personaBackground: '34 岁, 双职工家庭, 长期感到付出失衡, 惯用标签化表达',
  },
  {
    type: TrainingExerciseType.LISTENING,
    mode: TrainingExerciseMode.NO_ADVICE_CHALLENGE,
    difficulty: TrainingDifficulty.L3,
    scenarioContext: '来访者(陈先生, 41 岁)带着明显的期待问:「张老师, 你觉得我是应该跟我先生提离婚? 你接触的案例多, 你怎么看?」',
    options: [
      '从你的描述看, 问题主要集中在分工和情感忽视上, 离婚确实是一个需要认真考虑的方向。',
      '你问这个问题的时候, 感觉你心里可能已经有一个答案了 —— 能说说是什么吗?',
      '先别急着做决定, 你可以再观察一段时间。',
      '这个问题我不太方便回答, 我们换个话题。',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '拒绝决策者角色', weight: 0.4 },
        { name: '把决定权归还来访者', weight: 0.35 },
        { name: '未制造依赖感', weight: 0.25 },
      ],
      keywords: ['你', '感觉', '你自己', '答案'],
      errorPatterns: ['给出离婚建议', '替来访者延迟决定', '以回避回避求助'],
      improvementHints: ['被要求做决定时, 正确动作是把决定权归还, 不是提供更好的决定。', '回避型拒答会让来访者感到被抛弃, 反而强化依赖。'],
    },
    expertFeedback:
      '这是新手最容易被击穿的一题。求助者希望被授权, 一旦你给出倾向性建议, 决策责任就从来访者转移到了你身上, 后续无论结果如何都要由你承担。技术动作是: 承认被问到, 再把球传回去。',
    durationMinutes: 8,
    personaName: '陈先生',
    personaBackground: '41 岁, 高功能表现下长期婚姻困扰, 习惯向权威索取结论',
  },

  // ─────────── 提问技术 §5.2.2 (4) ───────────
  {
    type: TrainingExerciseType.QUESTIONING,
    mode: TrainingExerciseMode.CLOSED_TO_OPEN,
    difficulty: TrainingDifficulty.L1,
    scenarioContext: '你在初始访谈中问来访者「你最近睡眠怎么样?」, 来访者回答:「还行吧。」',
    options: ['那你是几点睡的呢?', '「还行」是怎么个还行法? 能跟我描述一下吗?', '你有没有试过数羊?', '睡得好还是不好?'],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '问题开放度', weight: 0.45 },
        { name: '承接原始回答', weight: 0.3 },
        { name: '无诱导倾向', weight: 0.25 },
      ],
      keywords: ['描述', '怎么', '展开', '什么样'],
      errorPatterns: ['继续用封闭问句', '换话题', '暗示正确答案'],
      improvementHints: ['来访者给出模糊回答时, 先请他定义, 而不是替他定义。', '开放不等于冗长, 「能描述一下」已足够。'],
    },
    expertFeedback:
      '「还行吧」是典型的封闭问句造成的回答缺失。修复动作要接在来访者的原话上 —— 重复「还行」再请求展开, 比重问一个全新问题更自然, 也更少触发防御。',
    durationMinutes: 5,
    personaName: '来访者 A',
    personaBackground: '初始访谈阶段, 表达习惯性精简, 需要被邀请展开',
  },
  {
    type: TrainingExerciseType.QUESTIONING,
    mode: TrainingExerciseMode.ONE_AT_A_TIME,
    difficulty: TrainingDifficulty.L2,
    scenarioContext: '首次会谈刚开始, 你需要了解来访者的主要困扰。此时你手上有 5 个想确认的方向。',
    options: [
      '你的工作、家庭、婚姻、亲子关系, 最近有没有遇到什么困扰?',
      '今天来, 你最希望我们先处理哪方面的困扰?',
      '先说说你最困扰的事, 然后我们聊聊工作压力, 最后再看看睡眠情况。',
      '你有没有什么想跟我说的?',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '单点聚焦', weight: 0.4 },
        { name: '尊重来访者优先级', weight: 0.35 },
        { name: '未造成压迫感', weight: 0.25 },
      ],
      keywords: ['最希望', '先', '哪方面', '最重要'],
      errorPatterns: ['连续追问多个方向', '替来访者排定议题顺序', '过宽导致沉默'],
      improvementHints: ['一次一问是节奏控制, 也是在替来访者做减法。', '让来访者自己选议题, 你得到的信息比预设清单更可用。'],
    },
    expertFeedback:
      '新手常把「全面」等同于「专业」, 结果是一口气抛出 5 个方向, 来访者无从下手而沉默。正确动作是收窄到一点, 并把优先级交给来访者 —— 你能拿到的信息量反而更大, 因为它是他的真实排序而不是你的假设。',
    durationMinutes: 6,
    personaName: '来访者 B',
    personaBackground: '首次会谈, 多议题并存, 需要被协助做议题排序',
  },
  {
    type: TrainingExerciseType.QUESTIONING,
    mode: TrainingExerciseMode.AVOID_INTERROGATION,
    difficulty: TrainingDifficulty.L3,
    scenarioContext: '访谈进行到一半, 来访者沉默了很久, 眼神游移, 明显在回避。',
    options: [
      '你为什么不愿意说?',
      '是我问的这些问题让你不舒服了, 还是你有别的原因?',
      '这里可以先停一下。刚才具体是哪一段, 让你不太想往下说?',
      '这部分你必须回答, 我们才能继续。',
    ],
    correctOptionIndex: 2,
    rubric: {
      dimensions: [
        { name: '无指责预设', weight: 0.4 },
        { name: '把沉默还给来访者', weight: 0.35 },
        { name: '邀请而非施压', weight: 0.25 },
      ],
      keywords: ['停一下', '哪一段', '你想', '可以不'],
      errorPatterns: ['质问「为什么」', '预设对方在抗拒', '要求必须回答'],
      improvementHints: [
        '「为什么」开头的问题会让来访者为行为辩解, 而不是回到内容。',
        '允许暂停本身就是在传递「你有控制权」, 这恰恰减少回避。',
      ],
    },
    expertFeedback:
      '沉默在咨询里通常是阻抗的载体, 而质问式提问是催它出来。「为什么」隐含着「你这样不对」, 会让来访者转入辩解。正确动作是三步: 命名暂停、允许暂停、把话语权交回。',
    durationMinutes: 8,
    personaName: '来访者 C',
    personaBackground: '回避型依恋, 面对追问会进一步退缩, 对指责极度敏感',
  },
  {
    type: TrainingExerciseType.QUESTIONING,
    mode: TrainingExerciseMode.FOCUS_TOPIC,
    difficulty: TrainingDifficulty.L2,
    scenarioContext: '来访者从工作压力讲到星座、父母星座、最近热播的剧、剧情细节, 兜了一大圈之后才绕回最开始的工作问题。',
    options: [
      '你刚才提到电视剧里那个角色处境挺像你, 我们接着聊聊他。',
      '我们先回到你最开始说的工作压力。你提到最近项目推进很卡, 具体是卡在什么地方?',
      '你好像有点偏题了。',
      '好, 那我们聊聊你最近在追的那部剧。',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '聚焦主议题', weight: 0.4 },
        { name: '不打断的处理', weight: 0.3 },
        { name: '自然过渡', weight: 0.3 },
      ],
      keywords: ['回到', '最开始', '先', '继续'],
      errorPatterns: ['直接指出跑题', '顺着岔路走', '粗暴打断'],
      improvementHints: [
        '跑题常是阻抗的委婉形式, 指出「你偏题了」等于当众揭穿。',
        '用「回到你最开始说的…」把控制权交回自己, 不需要指认对方。',
      ],
    },
    expertFeedback:
      '绕 talk 表面是话题漂移, 底层多是在测试「你会不会嫌我啰嗦」。生硬拉回会破坏关系, 顺流而下则丢失主线。成熟的做法是: 不评价过程, 直接用「回到你最开始说的」重新锚定, 来访者通常会自然跟上。',
    durationMinutes: 6,
    personaName: '来访者 D',
    personaBackground: '焦虑型依恋, 通过发散确认关注, 对批评高度敏感',
  },

  // ─────────── 语音微训练 §5.2.3 (3) ───────────
  {
    type: TrainingExerciseType.VOICE_MICRO,
    mode: TrainingExerciseMode.SPEECH_RATE,
    difficulty: TrainingDifficulty.L1,
    scenarioContext:
      '语音专项微训练 · 语速控制。本次练习中, 你的平均语速为 165 字/分钟 (专业区间 120-140), 在回答「请描述一下你的睡眠情况」这一段达到 180 字/分钟。此时来访者在画外说:「嗯……我、我也不知道怎么回事。」',
    options: [
      '保持当前语速, 连续追问细节以加快信息收集。',
      '主动降速到约 130 字/分钟, 用简短回应留出空间:「听起来你在犹豫要不要说下去。」',
      '完全模仿来访者的语速和结巴, 以建立同步感。',
      '停止说话, 等来访者主动开口。',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '语速回归专业区间', weight: 0.45 },
        { name: '识别来访者犹豫信号', weight: 0.3 },
        { name: '留出表达空间', weight: 0.25 },
      ],
      keywords: ['降速', '130', '简短', '留出'],
      errorPatterns: ['继续加速追问', '完全模仿结巴', '长时间静默'],
      improvementHints: [
        '语速是咨询师的状态指标, 不只是节奏偏好 —— 过快通常伴随回避和紧张。',
        '模仿对方的结巴会让你也被拖进焦虑, 同步应该发生在语速而非症状上。',
      ],
    },
    expertFeedback:
      '本项训练的核心不是「说慢一点」, 而是「听见自己的状态」。165 → 130 的降速动作背后, 是识别出来访者的犹豫并主动降载。完全静默同样错误 —— 那会把压力全部留给来访者。',
    durationMinutes: 5,
    personaName: '语音陪练',
    personaBackground: '语速自评 165 字/分, 易在紧张时加速',
  },
  {
    type: TrainingExerciseType.VOICE_MICRO,
    mode: TrainingExerciseMode.TONE_STABILITY,
    difficulty: TrainingDifficulty.L2,
    scenarioContext:
      '语音专项微训练 · 语气平稳。来访者突然提高音量说:「你根本不懂! 你懂什么叫被亲妈扔在福利院门口吗?!」你在本次练习中的语调基频波动范围是 210-320 (专业稳定区间 180-240)。',
    options: [
      '提高音量以匹配来访者, 避免被压制感。',
      '语调稳定在 200-220 基频, 语速略降, 回应:「被最亲的人抛下, 那种感觉一定很难承受。」',
      '语调上扬表示疑问:「你是说我不懂你的经历吗?」',
      '保持沉默, 等来访者自己冷静下来。',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '基频波动收敛', weight: 0.45 },
        { name: '不随来访者波动', weight: 0.3 },
        { name: '内容承接情绪', weight: 0.25 },
      ],
      keywords: ['稳定', '基频', '平稳', '承接'],
      errorPatterns: ['音量对冲', '语调上扬反问', '完全失语'],
      improvementHints: ['语调上扬的疑问句在冲突场景会被读成质疑。', '你被愤怒推着走是正常的, 关键是事前练到能自动回落。'],
    },
    expertFeedback:
      '语调是最难伪造也最难伪装的沟通信号。来访者推高音量时, 咨询师若跟涨, 等于宣告「你的情绪会淹没我」。守住 200-220 的窄带, 同时用内容承接, 是本项唯一的专业解。',
    durationMinutes: 7,
    personaName: '语音陪练',
    personaBackground: '易被高唤醒来访者带动, 基频波动 110 Hz',
  },
  {
    type: TrainingExerciseType.VOICE_MICRO,
    mode: TrainingExerciseMode.ICE_BREAKING,
    difficulty: TrainingDifficulty.L3,
    scenarioContext: '首次会谈开始, 来访者坐在沙发边缘, 双手交叉抱胸, 沉默了 20 秒。这是你们之间的第一句话。',
    options: [
      '你看起来不太想说话, 没关系的, 我们可以先聊聊天气。',
      '我注意到你进来之后一直很安静。我们不用急着开始, 你可以先花一点时间想想从哪儿说起, 我在这里听。',
      '你为什么看起来这么紧张?',
      '请跟我说说你今天来的原因。',
    ],
    correctOptionIndex: 1,
    rubric: {
      dimensions: [
        { name: '容纳沉默', weight: 0.4 },
        { name: '低压力开场', weight: 0.35 },
        { name: '传递在场感', weight: 0.25 },
      ],
      keywords: ['注意到', '不着急', '我在', '你可以'],
      errorPatterns: ['立即填满沉默', '质问紧张原因', '直接指令开场'],
      improvementHints: ['开场白不是收集信息, 是传递「这里安全」。', '命名你观察到的东西, 比装作没看到更能建立信任。'],
    },
    expertFeedback:
      '破冰的技术目标不是让来访者开口, 是让他知道「沉默不会带来后果」。选项 1 用闲聊回避, 选项 3 是质问, 选项 4 是指令。唯有选项 2 同时完成: 命名现状、解除时限、给出在场承诺。',
    durationMinutes: 8,
    personaName: '语音陪练',
    personaBackground: '高防御首次来访, 沉默是主要沟通方式',
  },
];
