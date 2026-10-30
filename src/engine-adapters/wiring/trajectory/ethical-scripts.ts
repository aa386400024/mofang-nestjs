// V2026-10-30 治本 (WP10 · B 层 · 伦理盲盒强覆盖剧本资产):
//   职责: 提供 10 个 `force_override` 模式的伦理盲盒剧本 (静态 TS 资产, **不落 MySQL**),
//         以及按 scriptId 索引它们的内存表 —— 供 `TrajectoryScriptResolver` 静态实现查询.
//   边界: 纯数据 + 纯常量; 零 @nestjs/* / 零 typeorm / 零 IO. 内核 (src/engine-core)
//         **不感知**本文件存在 —— 它只消费注入进来的纯对象 (WP3 的 TrajectoryScript).
//
//   为什么静态 TS 不落库 (任务单 §1.1):
//     本期 10 个是**平台内置资产**, 与 `counselor/drills/` 的 boundary/crisis 剧本同范式.
//     静态常量的收益: 类型安全 / git diff 可审 / 不需要 migration / 不需要审核状态字段.
//     UGC 剧本提交 + 审核流是 Phase2 —— 那时才需要表、版本与审核态.
//
//   ── 幕结构 (每个剧本 4 幕, 任务单要求"至少 3 幕") ──
//     order 0 `<prefix>_free`    自由运行: BDI 自由规划, 来访按一般主诉叙述.
//     order 1 `<prefix>_event`   伦理事件: 咨询师做出被词典识别的专业动作后, 来访强制提出该伦理诉求.
//     order 2 `<prefix>_expand`  事件展开: 来访加压 / 试探边界是否松动.
//     order 3 `<prefix>_settle`  收束: 来访退到可以被引导的位置, 等咨询师给出边界与替代路径.
//
//   ── 触发条件的写法纪律 (照内核真实语义, 不发明) ──
//     内核 `evaluateTrigger` 是**跨原子 AND** (事件 / 关键词 / 轮次 / 快照谓词),
//     列表内部才是 OR. 因此:
//       ① 每个 trigger **只用一种闸门原子** (要么事件、要么关键词) —— 两个并置会变成
//          "既要…又要…"的窄条件, 剧本会大面积停在等待幕里不推进.
//       ② 幕 1 的闸门 = "咨询师做出了被规则词典识别的专业动作" (COUNSELING_MOVE_EVENTS)
//          × afterTurns≥3 —— 满足任务单"咨询师行为满足条件时来访强制说出伦理事件,
//          且不能第一轮就爆"的口径.
//       ③ completion = "一个被识别的共情/接纳类事件" × "边界/求助类关键词" × afterTurns.
//          内核**没有** `boundary_holds` 这类事件, 于是用关键词组合近似 (任务单 §6.5).
//          代价: 内核 trigger 是**单轮**语义, 无法跨轮累计 —— 探问质量要看逐轮 trace, 不能只看 outcome.
//       ④ abort **只用事件原子**: 关键词分不清"讨论"与"答应" —— 咨询师正确解释保密时
//          同样会说出"录音", 用关键词做 abort 会把正确应对误判成越界. 宁可漏判, 不可误伤.
//       ⑤ 不用 `state` 谓词: 信任/阻抗基线随角色种子变化, 写死阈值会让同一剧本在不同角色
//          下行为漂移, 与"每次演练完全一致可衡量"的蓝图口径相反.
//
//   ── 状态偏移 (delta) 的写法纪律 ──
//     内核只在"进入新幕那一轮"叠加一次 delta, 等待轮不叠. 所以 delta 写的是
//     **相对基线的一步**, 不是绝对值. target 里的 emotion 只给双轴 (valence/arousal),
//     **不手填 label** —— label 由内核 `resolveEmotionLabel` 重算 (适配层不造第二份真相).
//
//   ── 内容纪律 (与 `counselor/drills/` 的 crisis 剧本同款, 越界即返工) ──
//     - 不写具体机构名 / 电话 / 地址 / 热线号码; 求助路径只写"专业支持 / 医疗机构"类别词.
//     - 危机剧本不写自伤方式与计划细节, 只用间接行为线索 (交代后事 / 清点物品 / 突然平静).
//     - 不写干预技术步骤 (风险评估表 / 安全计划): 剧本只到"来访表达信号 + 咨询师需开放式探问".
//     - **不写完整口语台词**: 台词由 LLM 按 target + forbiddenBehaviors 渲染;
//       本文件只控状态目标与禁止行为. referenceNotes 是给**督导**看的结构化要点, 不是台词.
//     - 人设只到称呼 / 年龄 / 性别 / 职业 / 一句背景, 不写创伤细节.
//
//   ── 反双胞胎 ──
//     - 不在 voice 层判断"有没有剧本": voice 只透传 scriptId 字符串 (剧本语义归本层).
//     - 不在引擎适配层写剧本内容: 适配层只调 resolver, 拿到什么注入什么.
//     - 不在这里写 `validateTrajectoryScript` 的副本逻辑: 校验只有内核那一份
//       (`src/engine-core/domain/trajectory/script.ts`), 单测直接调它.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. npx jest test/engine-adapters/wp10-ethical-scripts.spec.ts 全绿 (10 个剧本形状 + 解析)
//     3. npx jest test/engine-adapters/wp10-trajectory-injection.spec.ts 全绿 (注入链路 + 零回归)
//     4. git diff --stat HEAD -- src/engine-core 为空 (本单零内核改动)
//
//   eslint-disable-next-line sonarjs/todo-tag -- 复核标记按任务单固定用中文"专业复核"; 规则只认 ASCII 标签, 故就地放行.
//   TODO(专业复核): 待心理咨询专业口径校验 —— 全部 10 个剧本的督导要点、阈值与求助路径类别词.
import type { CounselorEventKind, TrajectoryScript } from '../../../engine-core';

/**
 * 幕 1 的闸门事件集: "咨询师做出了一个被规则词典识别的专业动作".
 *
 * 取自内核 `EVENT_LEXICON` 里**真实存在**的事件种类 (empathy / acceptance / normalization /
 * open_probe / affirmation), 一条都不新造 —— 内核不识别的事件名会让 trigger 永远不满足.
 *
 * 为什么是这五个而不是全部: neutral 是"未命中任何规则"的兜底, 把它放进闸门等于闸门恒开
 * (每轮至少产出 neutral), 那样"咨询师行为满足条件"就失去意义了.
 */
const COUNSELING_MOVE_EVENTS: readonly CounselorEventKind[] = ['empathy', 'acceptance', 'normalization', 'open_probe', 'affirmation'];

/**
 * completion 的共情侧事件集: 咨询师接住了来访的感受.
 *
 * 三个事件的任一即可 (列表内是 OR) —— 内核词表是子串匹配, 单押一个事件会让完成判定
 * 对措辞过于敏感 (换一个共情说法就永远落不了 completed).
 */
const ATTUNED_COUNSELOR_EVENTS: readonly CounselorEventKind[] = ['empathy', 'acceptance', 'normalization'];

/**
 * abort 的越界事件集: 咨询师严重越界 (评判 / 说教 / 越过咨询关系边界).
 *
 * 全部取自内核 `EVENT_LEXICON` 的真实事件种类:
 *   judgment      —— "你不该…" / "你就是太敏感…"        (评判来访)
 *   preaching     —— "你应该…" / "听我的建议…"          (说教 / 立刻给方案)
 *   boundary_cross—— "加我微信" / "我们私下" / "我也有类似" (越过咨询关系边界)
 */
const BOUNDARY_VIOLATION_EVENTS: readonly CounselorEventKind[] = ['judgment', 'preaching', 'boundary_cross'];

/**
 * 全部伦理盲盒剧本 (10 个).
 *
 * 只读常量 —— 调用方**不得**修改 (修改会破坏"同一份基线"的单一真值源).
 */
export const ETHICAL_TRAJECTORY_SCRIPTS: readonly TrajectoryScript[] = [
  // ── 1. 表白 (情感移情边界) ────────────────────────────────────────────────
  {
    scriptId: 'ethical_romantic_confession',
    title: '来访者在会谈中表达情感依赖（移情边界）',
    mode: 'force_override',
    difficulty: 2,
    goal: '来访把咨询师当作情感依靠并表达超越咨询关系的感情时，咨询师能先接住感受、再说明专业边界，并指出在设置内继续获得支持的方向。',
    nodes: [
      {
        nodeId: 'confession_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访按一般主诉叙述，咨询师先建立工作同盟。',
          '督导关注：前几轮是在建立关系，还是已经在处理议题本身。',
        ],
      },
      {
        nodeId: 'confession_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.15, arousal: 0.15 },
          resistance: { verbal: 0.15 },
          transference: { dependency: 0.15 },
        },
        target: {
          strategy: 'affective_exploration',
          emotion: { valence: 0.2, arousal: 0.6 },
          resistance: { verbal: 0.35, depth: 0.25, style: 0.2 },
          transference: { positive: 0.3, dependency: 0.35 },
          forbiddenBehaviors: [
            '不得提出私人联系、见面或任何咨询室之外的安排',
            '不得以自己的情绪或经历反向要求来访回应',
            '不得评价来访表达感情这件事本身的对错',
          ],
        },
        referenceNotes: [
          '此幕来访表达情感依赖：它需要的是被接住，而不是被处理。',
          '咨询师需先共情其感受、再说明专业关系的边界 —— 顺序不可颠倒。',
          '直接拒绝而不接住感受容易造成羞耻与阻抗；直接迎合会强化移情。',
          '禁止：评价动机、承诺私人关系、做自我表露。',
        ],
      },
      {
        nodeId: 'confession_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: {
          resistance: { depth: 0.1, style: 0.05 },
          transference: { dependency: 0.1 },
        },
        target: {
          strategy: 'resistance',
          emotion: { valence: 0.05, arousal: 0.65 },
          resistance: { verbal: 0.4, depth: 0.35, style: 0.3 },
          transference: { positive: 0.3, dependency: 0.4 },
          forbiddenBehaviors: ['不得把请求升级为要挟（自伤暗示、道德绑架、退出威胁）', '不得索取咨询师的私人信息作为交换'],
        },
        referenceNotes: [
          '此幕来访加压试探边界是否松动，常见方式是把自己的脆弱当作理由。',
          '督导关注：咨询师是否保持一致，而不是反复解释；解释过度本身也会被体验为越界。',
        ],
      },
      {
        nodeId: 'confession_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: -0.05, arousal: 0.45 },
          resistance: { verbal: 0.35, depth: 0.3, style: 0.3 },
          transference: { positive: 0.2, dependency: 0.25 },
          forbiddenBehaviors: ['不得把边界问题转成对来访的道德评价', '不得继续索要或暗示私人联系'],
        },
        referenceNotes: [
          '此幕来访退到可以被引导的位置，等待咨询师给出设置内的方向。',
          '督导关注：是否给出了"在设置内如何继续获得支持"的方向，而不是一句拒绝。',
        ],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '专业关系', '咨询关系', '约定'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 2. 索要私人联系方式 (设置边界) ───────────────────────────────────────
  {
    scriptId: 'ethical_private_contact',
    title: '来访在会谈结束时索要私人联系方式',
    mode: 'force_override',
    difficulty: 1,
    goal: '来访在收尾阶段索要私人联系方式时，咨询师能说明设置边界的理由，并在设置内给出继续获得支持的方式。',
    nodes: [
      {
        nodeId: 'contact_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场与议题推进，伦理事件出现在会谈收尾阶段。',
          '督导关注：咨询师是否在进入收尾时仍保有设置意识（不因临近结束而放松标准）。',
        ],
      },
      {
        nodeId: 'contact_event',
        order: 1,
        trigger: { afterTurns: 5, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.1, arousal: 0.1 },
          resistance: { verbal: 0.1 },
        },
        target: {
          strategy: 'request',
          emotion: { valence: 0.05, arousal: 0.45 },
          resistance: { verbal: 0.3, depth: 0.3, style: 0.25 },
          transference: { positive: 0.2, dependency: 0.2 },
          forbiddenBehaviors: [
            '不得接受或提出咨询室之外的联络方式',
            '不得把交换联系方式当成继续会谈的条件',
            '不得暗示咨询关系可以在设置之外延续',
          ],
        },
        referenceNotes: [
          '此幕来访在收尾阶段提出私人联络诉求。',
          '督导关注：咨询师是否说明了"为什么"而不只是下了禁令 —— 只给禁令会让来访感到被推开。',
          '处理方向：接住意图 → 说明设置与理由 → 给出设置内继续获得支持的方式。',
        ],
      },
      {
        nodeId: 'contact_expand',
        order: 2,
        trigger: { afterTurns: 6 },
        delta: { resistance: { style: 0.05 } },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.05, arousal: 0.5 },
          resistance: { verbal: 0.35, depth: 0.3, style: 0.35 },
          transference: { positive: 0.2, dependency: 0.25 },
          forbiddenBehaviors: ['不得用"就这一次"式变体继续争取', '不得提出任何变通形式的私人联络'],
        },
        referenceNotes: [
          '此幕来访试探性地再推一步（常见于"就当朋友""就这一次"）。',
          '督导关注：边界是否一致；一旦出现例外，来访会把例外当规则。',
        ],
      },
      {
        nodeId: 'contact_settle',
        order: 3,
        trigger: { afterTurns: 7 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0, arousal: 0.35 },
          resistance: { verbal: 0.3, depth: 0.25, style: 0.25 },
          transference: { positive: 0.15 },
          forbiddenBehaviors: ['不得提出任何形式的私人联络作为补偿'],
        },
        referenceNotes: ['此幕来访退回可被引导的位置。', '督导关注：拒绝的表达是否清楚而不拖泥带水 —— 含糊会直接制造"再试一次"的空间。'],
      },
    ],
    completion: {
      when: { afterTurns: 8, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '设置', '咨询关系', '联系方式', '约定'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 6, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 3. 熟人 / 双重关系 ────────────────────────────────────────────────────
  {
    scriptId: 'ethical_known_person',
    title: '来访透露与咨询师存在熟人或介绍关系（双重关系）',
    mode: 'force_override',
    difficulty: 2,
    goal: '来访与咨询师存在熟人或介绍关系时，咨询师能识别双重关系、先评估其影响，再说明设置内可行的处理方式。',
    nodes: [
      {
        nodeId: 'knownperson_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未披露与咨询师的关系。',
          '督导关注：咨询师是否在得知关系事实后先评估影响，而不是立刻表态继续或中断。',
        ],
      },
      {
        nodeId: 'knownperson_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.1, arousal: 0.1 },
          resistance: { style: 0.1 },
        },
        target: {
          strategy: 'affective_exploration',
          emotion: { valence: 0, arousal: 0.45 },
          resistance: { verbal: 0.35, depth: 0.35, style: 0.4 },
          transference: { positive: 0.25, dependency: 0.2 },
          forbiddenBehaviors: [
            '不得以私人身份确认或展开与咨询师的既有关系',
            '不得要求咨询师在设置之外给予特殊照顾',
            '不得把这次会谈说成"按熟人方式处理就行"',
          ],
        },
        referenceNotes: [
          '此幕来访披露与咨询师的熟人关系。',
          '处理方向：先确认关系事实与来访的期待 → 说明专业设置的适用范围 → 说明在设置内可以继续工作的方式。',
          '督导关注：是否评估了利益冲突，而不是先安抚。',
        ],
      },
      {
        nodeId: 'knownperson_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: {
          resistance: { depth: 0.05 },
          transference: { negative: 0.05 },
        },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.05, arousal: 0.5 },
          resistance: { verbal: 0.4, depth: 0.4, style: 0.45 },
          transference: { positive: 0.25, negative: 0.1 },
          forbiddenBehaviors: ['不得用关系亲疏作为要求特殊处理的理由继续施压', '不得询问咨询师的私人经历或人际关系'],
        },
        referenceNotes: [
          '此幕来访把熟人关系当作要求特殊处理的依据（常见于"我们这么熟"）。',
          '督导关注：咨询师是否保持一致，同时不评价这段私人关系本身。',
        ],
      },
      {
        nodeId: 'knownperson_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0, arousal: 0.35 },
          resistance: { verbal: 0.35, depth: 0.3, style: 0.35 },
          transference: { positive: 0.2 },
          forbiddenBehaviors: ['不得把处理结果转成对来访的道德评价'],
        },
        referenceNotes: [
          '此幕来访退回到可以在设置内继续工作的位置。',
          '督导关注：是否给出了可行的安排方向（继续在设置内工作 / 转介 / 调整频率），而不是笼统拒绝。',
        ],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '双重关系', '设置', '专业关系', '转介'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 4. 录音 / 录像 (保密与记录管理) ───────────────────────────────────────
  {
    scriptId: 'ethical_recording_dispute',
    title: '来访声称自己在录音或录像（保密与记录管理）',
    mode: 'force_override',
    difficulty: 2,
    goal: '来访以自己在录音或录像的方式提出不信任时，咨询师能先处理情绪再说明保密与记录管理的边界。',
    nodes: [
      {
        nodeId: 'recording_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未提出记录相关诉求。',
          '督导关注：咨询师是否在来访说出记录诉求时先稳定关系，而不是立刻进入程序说明。',
        ],
      },
      {
        nodeId: 'recording_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.15, arousal: 0.2 },
          resistance: { style: 0.15 },
        },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.1, arousal: 0.55 },
          resistance: { verbal: 0.4, depth: 0.4, style: 0.5 },
          transference: { negative: 0.15 },
          forbiddenBehaviors: ['不得声称会谈会被公开或被他人审阅', '不得替第三方承诺记录内容的处置方式', '不得要求来访当场删除或交出记录'],
        },
        referenceNotes: [
          '此幕来访以"我在录音"的方式表达不信任或掌控。',
          '督导关注：咨询师是否先处理情绪再处理规则 —— 一上来讲程序会被体验为防御。',
          '禁止：把记录问题变成对来访诚信的道德审问。',
        ],
      },
      {
        nodeId: 'recording_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: { resistance: { verbal: 0.05 } },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.1, arousal: 0.5 },
          resistance: { verbal: 0.45, depth: 0.45, style: 0.5 },
          transference: { negative: 0.2 },
          forbiddenBehaviors: ['不得以"你再录下去我没法说"之类表述把责任推给来访', '不得要求来访先停止提问才继续工作'],
        },
        referenceNotes: [
          '此幕来访追问记录会被如何处理、使用或保存。',
          '督导关注：咨询师是否清楚区分"保密义务"与"记录管理"两件事（具体口径按所在机构与法律规范执行，剧本不写条款）。',
        ],
      },
      {
        nodeId: 'recording_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: -0.05, arousal: 0.4 },
          resistance: { verbal: 0.4, depth: 0.4, style: 0.45 },
          transference: { negative: 0.1 },
          forbiddenBehaviors: ['不得作任何超出机构权限的保密承诺', '不得对来访的记录行为继续表达指责'],
        },
        referenceNotes: [
          '此幕来访等待关于记录处理方式的明确说明。',
          '督导关注：是否留下了可核对的信息（去哪里问、问谁），而不是含糊承诺"我会保密"。',
        ],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['保密', '记录', '边界', '设置'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 5. 索要诊断证明 / 病假条 (专业边界 · 非诊疗关系) ─────────────────────
  {
    scriptId: 'ethical_diagnosis_note',
    title: '来访索要诊断证明或病假条（专业边界）',
    mode: 'force_override',
    difficulty: 2,
    goal: '来访索要诊断证明、病假条或医学建议时，咨询师能区分"支持性说明"与"出具证明"，并指向专业评估路径。',
    nodes: [
      {
        nodeId: 'diagnosis_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未提出证明类诉求。',
          '督导关注：咨询师是否先了解诉求背后的现实处境（要证明给谁看、解决什么问题），再谈能不能做。',
        ],
      },
      {
        nodeId: 'diagnosis_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.1, arousal: 0.1 },
          resistance: { verbal: 0.1 },
        },
        target: {
          strategy: 'request',
          emotion: { valence: 0, arousal: 0.45 },
          resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
          transference: { positive: 0.15, dependency: 0.2 },
          forbiddenBehaviors: [
            '不得要求咨询师提供任何证明材料或诊断性结论',
            '不得以工作单位名义要求作出医学判断',
            '不得提出用其他形式的材料替代证明',
          ],
        },
        referenceNotes: [
          '此幕来访提出行政性诉求（证明 / 病假条）。',
          '处理方向：先理解要证明给谁看、解决什么现实问题 → 说明咨询与医学评估的分工 → 指出专业评估路径。',
          '督导关注：是否把"不能出具"说成了"你不该去要"。',
        ],
      },
      {
        nodeId: 'diagnosis_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: { resistance: { depth: 0.05 } },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.05, arousal: 0.5 },
          resistance: { verbal: 0.35, depth: 0.35, style: 0.35 },
          transference: { positive: 0.15, dependency: 0.25 },
          forbiddenBehaviors: ['不得提出以其他形式绕开"不出具证明"这条边界的变通', '不得质疑来访所述困难的真实性'],
        },
        referenceNotes: [
          '此幕来访提出变通方案（常见于"只要口头说一句""你签个字就行"）。',
          '督导关注：边界是否守住，同时来访有没有被挡在门外 —— 守住边界与接住来访可以同时做到。',
        ],
      },
      {
        nodeId: 'diagnosis_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0, arousal: 0.4 },
          resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
          transference: { positive: 0.1, dependency: 0.2 },
          forbiddenBehaviors: ['不得承诺代为联系或代办任何证明流程'],
        },
        referenceNotes: [
          '此幕来访可被引导到"由专业机构做评估"的方向。',
          '督导关注：是否给出了类别化的求助路径（具体机构按当地规范另行告知，剧本不写）。',
        ],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '诊断', '评估', '医疗机构', '专业'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 6. 会谈中段冒出危机信号 (危机识别) ───────────────────────────────────
  {
    scriptId: 'ethical_suicide_crisis',
    title: '会谈中段出现危机信号（识别与开放式探问）',
    mode: 'force_override',
    difficulty: 3,
    goal: '会谈中段出现危机信号时，咨询师能识别信号的严重性、用开放式探问接住，并平稳引导到专业支持。',
    nodes: [
      {
        nodeId: 'crisis_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未出现危机信号。',
          '督导关注：咨询师在前段是否已建立足够的信任与结构 —— 信号能否被说出来，与此直接相关。',
        ],
      },
      {
        nodeId: 'crisis_signal',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.3, arousal: -0.05 },
          resistance: { depth: 0.1 },
        },
        target: {
          strategy: 'affective_exploration',
          emotion: { valence: -0.6, arousal: 0.15 },
          resistance: { verbal: 0.45, depth: 0.5, style: 0.4 },
          transference: { negative: 0.05, dependency: 0.15 },
          forbiddenBehaviors: [
            '不得描述任何自伤的方式、工具或计划细节',
            '不得给出时间表或任何可操作的信息',
            '不得出现具体机构名称、地址或号码',
            '不得替专业机构或第三方作出承诺',
          ],
        },
        referenceNotes: [
          '此幕来访给出间接的行为线索：交代后事、清点身边物品、话头突然转向平静、觉得谁都不会知道。',
          '督导关注：咨询师是否识别到信号的严重性，而不是把它当成一般的低落继续往下问。',
          '本幕只练"看见信号"；评估工具与干预流程不在剧本范围内，也不写方法与计划细节。',
        ],
      },
      {
        nodeId: 'crisis_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: {
          resistance: { depth: 0.05 },
          transference: { dependency: 0.1 },
        },
        target: {
          strategy: 'affective_exploration',
          emotion: { valence: -0.55, arousal: 0.2 },
          resistance: { verbal: 0.5, depth: 0.55, style: 0.45 },
          transference: { negative: 0.05, dependency: 0.25 },
          forbiddenBehaviors: ['不得描述任何自伤的方式、工具或计划细节', '不得要求咨询师保证"不会有事"或承诺独自负责'],
        },
        referenceNotes: [
          '此幕来访在探问下更靠近核心（常见于表达"没有支撑""没人在意"）。',
          '督导关注：是否持续用开放式探问，而不是急于给方案或下结论。',
          '禁止用安慰话术把信号盖过去；禁止当场作风险判断或作兜底承诺。',
        ],
      },
      {
        nodeId: 'crisis_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: -0.45, arousal: 0.25 },
          resistance: { verbal: 0.45, depth: 0.5, style: 0.4 },
          transference: { dependency: 0.2 },
          forbiddenBehaviors: ['不得把信号淡化成"只是情绪低落"', '不得作出"交给我就好"式的兜底承诺'],
        },
        referenceNotes: [
          '此幕来访停在等待被引导的位置。',
          '督导关注：是否在探问之后平稳地引向专业支持（类别化引导，具体渠道按当地规范另行告知）。',
        ],
      },
    ],
    completion: {
      when: {
        afterTurns: 6,
        onEvents: ['open_probe', 'empathy', 'acceptance'],
        onKeywords: ['专业支持', '专业帮助', '心理援助', '专业机构', '医疗机构'],
      },
      outcome: 'completed',
    },
    // 忽略信号 / 说教 / 评判来访 —— 这三种是危机场景里最典型的失败方式.
    abort: { afterTurns: 4, onEvents: ['minimizing', 'preaching', 'judgment'] },
  },

  // ── 7. 送礼 / 发红包 / 请客 (双重关系 · 馈赠) ─────────────────────────────
  {
    scriptId: 'ethical_gift_money',
    title: '来访提出送礼、发红包或请客（馈赠与双重关系）',
    mode: 'force_override',
    difficulty: 1,
    goal: '来访提出馈赠时，咨询师能自然地拒绝并说明理由，同时不伤害来访的好意与关系。',
    nodes: [
      {
        nodeId: 'gift_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未提出馈赠。',
          '督导关注：咨询师是否理解来访送礼背后的功能（感谢 / 接近 / 补偿），而不是只当作一个物品问题。',
        ],
      },
      {
        nodeId: 'gift_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: 0.1, arousal: 0.1 },
        },
        target: {
          strategy: 'request',
          emotion: { valence: 0.15, arousal: 0.45 },
          resistance: { verbal: 0.25, depth: 0.2, style: 0.2 },
          transference: { positive: 0.25 },
          forbiddenBehaviors: ['不得提出具体的馈赠方式、金额或时间安排', '不得暗示存在接受的可能', '不得贬低来访的好意'],
        },
        referenceNotes: [
          '此幕来访以送礼表达接近、感谢或补偿。',
          '处理方向：接住意图 → 说明不接受的理由与设置 → 说明在设置内可以如何表达感谢。',
          '督导关注：拒绝的同时有没有保住来访的善意 —— 这条比"拒绝得干脆"更难。',
        ],
      },
      {
        nodeId: 'gift_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: { resistance: { style: 0.05 } },
        target: {
          strategy: 'resistance',
          emotion: { valence: 0.1, arousal: 0.5 },
          resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
          transference: { positive: 0.25 },
          forbiddenBehaviors: ['不得改提其他形式的交换（帮忙做事 / 介绍人脉 / 代为传话）', '不得反复提出替代馈赠'],
        },
        referenceNotes: [
          '此幕来访提出变通（常见于"那请你吃饭""那我帮你别的忙"）。',
          '督导关注：边界是否覆盖的是"关系交换"这件事本身，而不是只覆盖某一种具体形式。',
        ],
      },
      {
        nodeId: 'gift_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0.05, arousal: 0.35 },
          resistance: { verbal: 0.25, depth: 0.2, style: 0.2 },
          transference: { positive: 0.2 },
          forbiddenBehaviors: ['不得把馈赠接受与否转成对来访的亲疏评价'],
        },
        referenceNotes: ['此幕来访接受或退让。', '督导关注：拒绝的表达是否清楚、不拖泥带水 —— 拖泥带水会直接制造"再试一次"的空间。'],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '礼物', '馈赠', '设置', '约定'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 8. 要求咨询师表态 (价值中立) ──────────────────────────────────────────
  {
    scriptId: 'ethical_value_judgment',
    title: '来访在价值、道德或性取向上要求咨询师表态',
    mode: 'force_override',
    difficulty: 3,
    goal: '来访要求咨询师评价其价值选择时，咨询师能保持价值中立，把判断权还给来访，同时不回避其处境压力。',
    nodes: [
      {
        nodeId: 'value_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未要求表态。',
          '督导关注：咨询师是否清楚自己的价值取向，并在被拉入评判之前先识别这种拉力。',
        ],
      },
      {
        nodeId: 'value_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.1, arousal: 0.15 },
          resistance: { style: 0.1 },
        },
        target: {
          strategy: 'request',
          emotion: { valence: 0, arousal: 0.5 },
          resistance: { verbal: 0.3, depth: 0.35, style: 0.45 },
          transference: { negative: 0.1 },
          forbiddenBehaviors: [
            '不得要求咨询师评价其道德选择',
            '不得把咨询师自身的价值取向当作评判标准',
            '不得以"正常人不会这样"一类说法施压',
          ],
        },
        referenceNotes: [
          '此幕来访要求咨询师给出立场（常见于道德、宗教或性取向相关）。',
          '处理方向：接住处境压力 → 说明角色位置 → 把判断权还给来访。',
          '注意：保持中立不等于回避；仍要共情其处境的难处。',
        ],
      },
      {
        nodeId: 'value_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: {
          resistance: { verbal: 0.05 },
          transference: { negative: 0.05 },
        },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.05, arousal: 0.55 },
          resistance: { verbal: 0.35, depth: 0.4, style: 0.5 },
          transference: { negative: 0.15 },
          forbiddenBehaviors: ['不得以"大家都觉得"或"正常人"作为施压依据', '不得把咨询变成价值辩论'],
        },
        referenceNotes: [
          '此幕来访以社会共识或从众压力施压（常见于"你也不认同吧""大家都这么觉得"）。',
          '督导关注：咨询师是否承受住这份压力而不被带走 —— 中立被拉走时，来访会把它读成"你也站在他们那边"。',
        ],
      },
      {
        nodeId: 'value_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0, arousal: 0.4 },
          resistance: { verbal: 0.3, depth: 0.35, style: 0.4 },
          transference: { negative: 0.05 },
          forbiddenBehaviors: ['不得在收束时补一句自己的价值判断'],
        },
        referenceNotes: ['此幕来访在未被评判后可以回到个人议题。', '督导关注：是否把议题带回来访自己的选择与代价，而不是变成辩论。'],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '中立', '你的选择', '尊重', '设置'] },
      outcome: 'completed',
    },
    // 价值中立场景里最严重的失败就是评判与说教 (内核 lexicon: judgment / preaching).
    abort: { afterTurns: 4, onEvents: ['judgment', 'preaching'] },
  },

  // ── 9. 言语调情 / 性暗示 (性边界) ─────────────────────────────────────────
  {
    scriptId: 'ethical_sexual_seduction',
    title: '来访以调情或性暗示试探边界（性边界）',
    mode: 'force_override',
    difficulty: 3,
    goal: '来访以调情或性暗示试探时，咨询师能明确而平静地划出边界并维持设置，同时不羞辱来访。',
    nodes: [
      {
        nodeId: 'seduction_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未做出试探。',
          '督导关注：咨询师是否清楚自己的角色位置，以及边界被触碰时的反应顺序（先设限，再处理情绪）。',
        ],
      },
      {
        nodeId: 'seduction_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: 0, arousal: 0.2 },
          resistance: { style: 0.15 },
        },
        target: {
          strategy: 'affective_exploration',
          emotion: { valence: 0.1, arousal: 0.6 },
          resistance: { verbal: 0.25, depth: 0.3, style: 0.45 },
          transference: { positive: 0.15 },
          forbiddenBehaviors: ['不得出现露骨的性描写或性邀约', '不得把话题引向身体细节', '不得以暧昧、玩笑或身体评价回应试探'],
        },
        referenceNotes: [
          '此幕来访以轻佻或暧昧的方式试探边界。',
          '督导关注：咨询师是否明确而平静地设限 —— 回避与过度反应都会被读成"可以继续"。',
          '禁止：羞辱、说教、把来访当威胁处理。',
        ],
      },
      {
        nodeId: 'seduction_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: { resistance: { style: 0.05 } },
        target: {
          strategy: 'resistance',
          emotion: { valence: 0.05, arousal: 0.55 },
          resistance: { verbal: 0.3, depth: 0.35, style: 0.5 },
          transference: { positive: 0.1 },
          forbiddenBehaviors: ['不得在来访说"只是开玩笑"时顺势放松边界', '不得提出任何性暗示作为反击或调侃'],
        },
        referenceNotes: [
          '此幕来访在未被设限后加码或改换形式（常见于"开玩笑而已"）。',
          '督导关注：边界是否保持一致且不带评价 —— 带着评价的设限会被体验为惩罚。',
        ],
      },
      {
        nodeId: 'seduction_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0, arousal: 0.4 },
          resistance: { verbal: 0.3, depth: 0.35, style: 0.4 },
          transference: { positive: 0.05 },
          forbiddenBehaviors: ['不得继续纠缠性话题', '不得要求来访为此道歉'],
        },
        referenceNotes: [
          '此幕来访退回到可继续工作的位置。',
          '督导关注：是否把话题安全地引回来访的困扰 —— 只停留在边界宣告上，来访会带着张力离开。',
        ],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '不舒服', '专业关系', '设置', '尊重'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },

  // ── 10. 索要开药 / 调药 / 医学检查建议 (跨专业边界) ────────────────────────
  {
    scriptId: 'ethical_medical_advice',
    title: '来访要求开药、调药或医学检查建议（跨专业边界）',
    mode: 'force_override',
    difficulty: 2,
    goal: '来访要求医学性建议时，咨询师能说明跨专业边界，并说明自己在咨询里可以提供什么支持。',
    nodes: [
      {
        nodeId: 'medical_free',
        order: 0,
        trigger: { afterTurns: 0 },
        referenceNotes: [
          '此幕为自由开场：来访尚未提出医学性请求。',
          '督导关注：咨询师是否先接住症状带来的真实痛苦 —— 跨专业边界不等于冷漠。',
        ],
      },
      {
        nodeId: 'medical_event',
        order: 1,
        trigger: { afterTurns: 3, onEvents: COUNSELING_MOVE_EVENTS },
        delta: {
          emotion: { valence: -0.1, arousal: 0.1 },
          resistance: { verbal: 0.1 },
        },
        target: {
          strategy: 'request',
          emotion: { valence: 0, arousal: 0.45 },
          resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
          transference: { positive: 0.1, dependency: 0.2 },
          forbiddenBehaviors: ['不得给出用药、剂量或检查项目的具体建议', '不得评价来访当前的用药是否合适', '不得以私人通道绕开专业评估'],
        },
        referenceNotes: [
          '此幕来访提出医学性请求（开药 / 调量 / 要检查单）。',
          '处理方向：先接住症状带来的真实痛苦 → 说明咨询与医学评估的分工 → 指向专业机构。',
          '督导关注：是否解释了"为什么这边不能给"，而不只是"这边不能给"。',
        ],
      },
      {
        nodeId: 'medical_expand',
        order: 2,
        trigger: { afterTurns: 4 },
        delta: { resistance: { depth: 0.05 } },
        target: {
          strategy: 'resistance',
          emotion: { valence: -0.05, arousal: 0.5 },
          resistance: { verbal: 0.35, depth: 0.35, style: 0.35 },
          transference: { positive: 0.1, dependency: 0.25 },
          forbiddenBehaviors: ['不得引用他人经验或听说来的方案作为建议', '不得承诺可以把某项检查安排下来'],
        },
        referenceNotes: [
          '此幕来访以"你既然懂这些"或"我朋友说可以加量"施压。',
          '督导关注：是否守住"不替代医学判断"这条线，同时不把来访推到"没人可问"的处境。',
        ],
      },
      {
        nodeId: 'medical_settle',
        order: 3,
        trigger: { afterTurns: 5 },
        target: {
          strategy: 'simple_response',
          emotion: { valence: 0, arousal: 0.4 },
          resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
          transference: { positive: 0.1, dependency: 0.15 },
          forbiddenBehaviors: ['不得把来访转介后就不再跟进', '不得就医学处置表达任何倾向性意见'],
        },
        referenceNotes: ['此幕来访可被引导到专业评估的方向。', '督导关注：是否说明了"在咨询里可以做什么" —— 转介不是把来访交出去就结束。'],
      },
    ],
    completion: {
      when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '医生', '评估', '医疗机构', '专业'] },
      outcome: 'completed',
    },
    abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
  },
];

/**
 * 剧本内存表 (scriptId → 剧本).
 *
 * 静态实现 (WP3 内核的剧本是**纯对象**, 由 adapter 解析后注入 —— 内核不关心它存哪).
 * 用 `Object.fromEntries` 建表而不是逐条手写映射: 手写映射会与数组各存一份 scriptId,
 * 改一处漏一处 = 查不到剧本且没有任何告警.
 *
 * 冻结: 映射本身可被外部改写 → 用 `Object.freeze` 挡住"运行期改剧本"这种静默失效.
 */
export const ETHICAL_TRAJECTORY_SCRIPT_MAP: Readonly<Record<string, TrajectoryScript>> = Object.freeze(
  Object.fromEntries(ETHICAL_TRAJECTORY_SCRIPTS.map((script) => [script.scriptId, script])),
);
