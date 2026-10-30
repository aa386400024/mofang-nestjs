# WP10 · 伦理盲盒强覆盖剧本资产（10 个）+ 握手注入链路 · 后端交付记录

> 任务单: [`engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md`](./engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md)
> 前置: WP3（`TrajectoryScript` 纯层，已交付）/ [WP8-B](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md) / [WP9-A](./engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md) / [WP9-B](./engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-30

---

## 0. 一句话结论

**任务单 §1 的五小节全部落地**：10 个 `force_override` 伦理盲盒剧本作为**静态 TS 资产**落在 `src/engine-adapters/wiring/trajectory/`（不落 MySQL / 无 migration），`TrajectoryScriptResolver` 端口（Symbol token + `@Optional` + 查不到返回 undefined 不抛错）建成，窄接口加**可选** `trajectoryScriptId` 并从握手 query 一路透传到 `engine.open()` 的 `trajectory` 字段。

**这一轮真正的难点不是写数据，是把内核的 trigger 语义摸准**——任务单 §1.2 写的"幕 1 用 `onEvents` 命中目标事件类型**或** `onKeywords` 命中特定词"在 WP3 内核里**表达不出来**：`evaluateTrigger` 是**跨原子 AND、列表内部 OR**，两个原子并置就是 AND，会得到"既要命中事件又要命中关键词"的窄条件，剧本大面积停在等待幕里不推进。本单的解法是**每个 trigger 只用一种闸门原子**（幕 1 用事件，completion 用"共情类事件 × 边界类关键词"），方向与任务单 §6.5"不要发明内核不识别的事件名"完全一致 —— 内核没有 `boundary_holds`，就用关键词组合近似。

**红线全部守住**：`src/engine-core/` 整树零改动（`git diff --stat HEAD -- src/engine-core` **为空**）；`src/counselor/drills/` 零改动；无 migration / 无 entity 改动 / 未改 `.env`；引擎装配层仍零 SDK 直引。

**闸门**：`tsc -p tsconfig.build.json` **0 错** / eslint **0 error 0 warning** / `jest test/engine-adapters test/engine-core` **22 套件 410 例全绿** / `jest test/voice` **3 套件 88 例全绿** / 全量 `npm test` **820 例通过，仅剩任务单 §3.4 已声明的 `drill-judge` 既有债 2 例**。

---

## 1. §1.1 剧本资产目录（静态 TS，不落库）

```
src/engine-adapters/wiring/trajectory/
  ethical-scripts.ts    ← 10 个 TrajectoryScript 对象 + 按 scriptId 的内存表（本单主体）
  script-resolver.ts    ← TrajectoryScriptResolver 端口 + Symbol token + 静态实现
  index.ts              ← 单一出口（零 ORM / 零 SDK 依赖）
```

**为什么静态 TS 不落 MySQL**（任务单 §1.1）：本期 10 个是**平台内置资产**，与 `counselor/drills/` 的 boundary/crisis 剧本同范式。静态常量的收益是类型安全 / git diff 可审 / **不需要 migration** / 不需要审核状态字段。UGC 剧本提交 + 审核流属 Phase2。

**为什么不把数据表塞进 resolver 文件**：剧本数据（`ethical-scripts.ts`）与解析机制（`script-resolver.ts`）分开 —— 解析器换数据源时（Phase2 的 DB 剧本池）数据文件不动；数据文件增删剧本时解析机制不动。

**内存表怎么建的**：

```ts
export const ETHICAL_TRAJECTORY_SCRIPT_MAP: Readonly<Record<string, TrajectoryScript>> = Object.freeze(
  Object.fromEntries(ETHICAL_TRAJECTORY_SCRIPTS.map((script) => [script.scriptId, script])),
);
```

**为什么用 `Object.fromEntries` 而不是逐条手写映射**：手写映射会与数组各存一份 scriptId，改一处漏一处 = **查不到剧本且没有任何告警**。`Object.freeze` 挡住"运行期改剧本"这种静默失效。

---

## 2. §1.2 10 个 `force_override` 剧本

### 2.1 清单与幕结构（每个 4 幕，任务单要求"至少 3 幕"）

| # | scriptId | 标题 | 难度 | 幕数 | 幕 id（free → event → expand → settle） |
|---|---|---|---|---|---|
| 1 | `ethical_romantic_confession` | 来访者在会谈中表达情感依赖（移情边界） | L2 | 4 | `confession_free` → `confession_event` → `confession_expand` → `confession_settle` |
| 2 | `ethical_private_contact` | 来访在会谈结束时索要私人联系方式 | L1 | 4 | `contact_free` → `contact_event` → `contact_expand` → `contact_settle` |
| 3 | `ethical_known_person` | 来访透露与咨询师存在熟人 / 介绍关系（双重关系） | L2 | 4 | `knownperson_free` → `knownperson_event` → `knownperson_expand` → `knownperson_settle` |
| 4 | `ethical_recording_dispute` | 来访声称自己在录音 / 录像（保密与记录管理） | L2 | 4 | `recording_free` → `recording_event` → `recording_expand` → `recording_settle` |
| 5 | `ethical_diagnosis_note` | 来访索要诊断证明 / 病假条（专业边界） | L2 | 4 | `diagnosis_free` → `diagnosis_event` → `diagnosis_expand` → `diagnosis_settle` |
| 6 | `ethical_suicide_crisis` | 会谈中段出现危机信号（识别与开放式探问） | L3 | 4 | `crisis_free` → `crisis_signal` → `crisis_expand` → `crisis_settle` |
| 7 | `ethical_gift_money` | 来访提出送礼 / 发红包 / 请客（馈赠与双重关系） | L1 | 4 | `gift_free` → `gift_event` → `gift_expand` → `gift_settle` |
| 8 | `ethical_value_judgment` | 来访在价值 / 道德 / 性取向上要求咨询师表态 | L3 | 4 | `value_free` → `value_event` → `value_expand` → `value_settle` |
| 9 | `ethical_sexual_seduction` | 来访以调情或性暗示试探边界（性边界） | L3 | 4 | `seduction_free` → `seduction_event` → `seduction_expand` → `seduction_settle` |
| 10 | `ethical_medical_advice` | 来访要求开药 / 调药 / 医学检查建议（跨专业边界） | L2 | 4 | `medical_free` → `medical_event` → `medical_expand` → `medical_settle` |

四幕的职责：

| 幕位 | 作用 | trigger | delta |
|---|---|---|---|
| 0 `<prefix>_free` | 自由运行：BDI 自由规划，来访按一般主诉叙述 | `{ afterTurns: 0 }`（开场即激活） | **无**（否则开场就把信任/阻抗滚一遍） |
| 1 `<prefix>_event` | 伦理事件：来访强制提出该伦理诉求 | `{ afterTurns: ≥3, onEvents: COUNSELING_MOVE_EVENTS }` | 情绪下移 + 阻抗上升 + 移情依赖上升（**一次性**叠加） |
| 2 `<prefix>_expand` | 事件展开：来访加压 / 试探边界是否松动 | `{ afterTurns: ≥4 }` | 阻抗深度上升 / 移情依赖再升 |
| 3 `<prefix>_settle` | 收束：来访退到可被引导的位置，等咨询师给边界与替代路径 | `{ afterTurns: ≥5 }` | 无（delta 只写"相对基线的一步"，不写绝对值） |

### 2.2 触发设计（全部用内核**真实识别**的事件名）

三个共享闸门常量（写在 `ethical-scripts.ts` 顶部，语义只在这里定义一次）：

| 常量 | 事件集 | 用途 |
|---|---|---|
| `COUNSELING_MOVE_EVENTS` | `empathy` / `acceptance` / `normalization` / `open_probe` / `affirmation` | 幕 1 闸门：**咨询师做出了一个被规则词典识别的专业动作** |
| `ATTUNED_COUNSELOR_EVENTS` | `empathy` / `acceptance` / `normalization` | completion 的共情侧 |
| `BOUNDARY_VIOLATION_EVENTS` | `judgment` / `preaching` / `boundary_cross` | abort 的越界侧 |

**为什么幕 1 的闸门里没有 `neutral`**：`neutral` 是内核分类器"未命中任何规则"的兜底，**每轮至少产出一条**。把它放进闸门 = 闸门恒开，"咨询师行为满足条件"这件事就失去意义了。

**completion**（按剧本各不相同，形状统一）：

```ts
completion: {
  when: { afterTurns: 6, onEvents: ATTUNED_COUNSELOR_EVENTS, onKeywords: ['边界', '专业关系', '咨询关系', '约定'] },
  outcome: 'completed',
}
```

**abort**：

```ts
abort: { afterTurns: 4, onEvents: BOUNDARY_VIOLATION_EVENTS },
```

两个剧本另配（语义不同，不共用）：价值中立 `#8` = `judgment / preaching`（评判与说教就是价值中立场景的典型失败）；危机 `#6` = `minimizing / preaching / judgment`（**忽略信号** / 立刻给建议 / 评判来访 = 危机场景的三种典型失败）。

### 2.3 为什么 abort 只用事件原子、completion 才用关键词

**abort 只能用事件**：关键词分不清"讨论"与"答应" —— 咨询师**正确**解释保密时同样会说出"录音"，用关键词做 abort 会把正确应对误判成越界。宁可漏判，不可误伤。

**completion 用关键词**：内核没有"咨询师正确应对"这号事件（`CounselorEventKind` 只有 `empathy` / `acceptance` / `normalization` / `open_probe` / `affirmation` / `judgment` / `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch` / `neutral`），没有 `boundary_holds`。于是用"一个被识别的共情/接纳类事件 × 一组边界/求助类关键词"近似（任务单 §6.5 明确允许）。

### 2.4 三个内核语义约束（写剧本前必须知道，否则剧本会静默不推进）

1. **completion / abort 是全局单轮判定，与游标无关** —— 内核每轮都判一次。所以两者都必须带 `afterTurns` 下限，否则咨询师第 1 轮说句带"边界"的话就可能直接落 completed（伦理事件根本没发生）。本单统一 `completion.afterTurns = 幕 1 afterTurns + 3`、`abort.afterTurns = 幕 1 afterTurns + 1`。
2. **force_override 的"等待轮"也会施加 target 基调** —— 幕 1 的 trigger 没满足时，来访的行为目标**已经被替换**（只是不叠 delta）。所以幕 1 的 target 必须写成"朝向该伦理事件的倾向"，不能写成"事件已发生"。
3. **不用 `state` 谓词**：信任/阻抗基线随角色种子变化，写死阈值会让同一剧本在不同角色下行为漂移 —— 与蓝图 §5.2"每次演练完全一致可衡量"相反。

### 2.5 内容纪律（与 `counselor/drills/` 的 crisis 剧本同款，越界即返工）

| 纪律 | 本轮落实 |
|---|---|
| 不写具体机构名 / 电话 / 地址 / 热线号码 | 求助路径只写"专业支持 / 心理援助 / 专业机构 / 医疗机构"类别词；全 10 个剧本无 3 位以上连续数字 |
| 危机剧本不写自伤方式与计划细节 | 只用间接行为线索（交代后事 / 清点身边物品 / 突然平静 / 觉得谁都不会知道） |
| 不写干预技术步骤 | 剧本只到"来访表达信号 + 咨询师需开放式探问"；`referenceNotes` 里明确写"评估工具与干预流程不在剧本范围内" |
| 人设只到称呼/年龄/性别/职业/一句背景 | 剧本层**不写人设**（人设由角色种子提供） |
| 不写完整口语台词 | 台词由 LLM 按 `target` + `forbiddenBehaviors` 渲染；剧本只给状态目标与禁止行为 |
| `referenceNotes` 写督导要点，不写"标准答案台词" | 每幕 2–4 条要点，**不含问号 / 感叹号**（台词的形态特征），单测钉死 |

**全部 10 个剧本标注** `// TODO(专业复核): 待心理咨询专业口径校验`（督导要点 / 阈值 / 求助路径类别词均待专业口径校验）。该标记按任务单原文保留中文；eslint 的 `sonarjs/todo-tag` 只认 ASCII 标签，故就地 `eslint-disable-next-line sonarjs/todo-tag` 放行 —— 没有擅自把标记改成英文。

---

## 3. §1.3 `TrajectoryScriptResolver` 端口

```ts
export const TRAJECTORY_SCRIPT_RESOLVER = Symbol('TRAJECTORY_SCRIPT_RESOLVER');

export interface TrajectoryScriptResolver {
  resolve(scriptId: string | undefined): TrajectoryScript | undefined;
}
```

**结构照抄 `CharacterProfileResolver`**（WP9-A）：Symbol token（不是 interface 当 token —— interface 编译后没有运行时值，字符串 token 撞名时 Nest 不报错而是静默注入错东西）+ 端口只说"给我一个 key，你给我一个内核剧本"，不声明"怎么查"。

**三处与角色解析的差异，以及为什么**：

| 点 | 角色解析（WP9-A） | 剧本解析（本单） | 理由 |
|---|---|---|---|
| 返回类型 | `Promise<ResolvedCharacter \| null>` | `TrajectoryScript \| undefined`（**同步**） | 剧本是进程内常量，查表零 IO —— 用 Promise 会凭空多一轮 microtask，还让调用点以为自己要等一个外部系统 |
| 空值语义 | `null` | `undefined` | 与端口声明一致（`undefined` = "本场无剧本"），不引入第二套空值口径 |
| 查不到时 | 角色池未接时的常态 | 资产不存在时的常态 | 两者都是"可选增强"，不是硬依赖 |

**为什么不回退到"随便挑一个剧本"**：那会让一场没指定剧本的会话被**悄悄**套上强覆盖 —— 来访者突然按别人设计的剧情走，而督导侧毫无线索。宁可不约束。

**Phase2 换数据源时注入点零改动**：加一个 `DbTrajectoryScriptResolver` 实现 + 改 `engine.module.ts` 里那一处绑定，`EngineStreamBackend` 一行不动（与 WP9-B 的角色池同款承诺）。

---

## 4. §1.4 打通注入链路

### 4.1 四段链路

```
① 握手 query  ?scriptId=ethical_private_contact
      ↓ parseVoiceHandshake()          src/voice/voice-handshake.ts
② SocketData.trajectoryScriptId → VoiceSessionMeta.trajectoryScriptId
      ↓ VoiceGateway → VoiceService.startSession
③ VoiceTurnBackendOpenOptions.trajectoryScriptId
      ↓ EngineStreamBackend.openSession()
④ resolver.resolve(scriptId) → engine.open({ ..., trajectory: script })
```

### 4.2 逐段落点

| 段 | 文件 | 落点 |
|---|---|---|
| ① 解析 | `voice-handshake.ts` | `readScriptId(params.get('scriptId'))` —— 去控制字符 + 长度封顶 64 |
| ② 透传 | `voice.gateway.ts` / `voice.types.ts` / `voice.service.ts` | `handshake.scriptId` → `SocketData` → `VoiceSessionMeta` → `openSession(opts)` |
| ③ 窄接口 | `voice-turn-backend.port.ts` | `readonly trajectoryScriptId?: string`（**可选**） |
| ④ 注入 | `engine-stream-backend.adapter.ts` | `resolveTrajectoryScript()` → `engine.open({ ...(script ? { trajectory: script } : {}) })` |

### 4.3 三个"反双胞胎"纪律（任务单 §1.4 逐条落地）

- **不在 voice 层判断"有没有剧本"** —— 它只透传 scriptId 字符串。voice 层若自己解析剧本，就得知道剧本语义，灰度一关就全是死代码。
- **不在 EngineStreamBackend 里写剧本内容** —— 只调 resolver，拿到什么注入什么。
- **旧 VisitorService 不实现这个字段** —— 它不接新引擎剧本，天然 undefined，一行都不用改。

### 4.4 窄接口为什么只增**可选**字段

`VoiceTurnBackendOpenOptions` 的必填字段会让旧实现（`VisitorService`）再也塞不进这个契约，WP8-B 建立的"并存可回退"当场破产。可选字段的缺省语义 = "本场无剧本 → BDI 自由运行"，与现状行为**逐字一致**。

### 4.5 握手 `scriptId` 为什么**不做白名单**

与 `skillCode` 不同：`skillCode` 是**枚举**（拼错了 = 客户端 bug，丢弃即可）；`scriptId` 是**资产 key**，集合会随 Phase2 的剧本池增长 —— 握手期钉死白名单 = 每加一个剧本就要改 voice 层，违反"换数据源不该改注入点"。查不到交给运行时 warn + 回退自由运行。

### 4.6 解析不到剧本的三种口径（统一收敛到"回退自由运行"，都不抛错）

1. 本场没带 scriptId（普通 voice session）→ 连 warn 都不打（常态）；
2. 剧本解析器未装配（`@Optional` 缺省）→ warn；
3. scriptId 查不到（资产不存在 / Phase2 数据源未接）/ 解析过程抛错 → warn。

**为什么必须 warn 而不是抛错**：剧本是**可选增强**，抛错会把"客户端传了个不认识的剧本 id"升级成"会话开不起来" —— 那是一个可选能力不该有的失败半径（与 WP9-A 角色解析同款语义）。

---

## 5. §1.5 剧本校验

**形状校验只有一份**：内核 `validateTrajectoryScript`（`src/engine-core/domain/trajectory/script.ts`）。适配层**不抄第二份** —— 抄了就会漂移：内核放宽某条规则而适配层还按老口径拦（剧本全部过不了），或者反过来（脏剧本被放进去）。

单测直接调内核那一份：**内核改了形状，这条测试立刻变红** —— 这正是要的效果。

启动时自检没有另写一份：`InMemoryEngineSession.openSession` 在**开场**就 `validateTrajectoryScript(script)` —— 一条非法剧本不该拖到第 5 轮才炸，开场失败意味着"这场根本不该开始"，比中途炸更干净（内核既有行为，本单白拿）。

### 5.1 单测锁了什么（31 例）

**`test/engine-adapters/wp10-ethical-scripts.spec.ts`（17 例）**

| 组 | 断言 |
|---|---|
| 形状（8 例） | 10 个剧本全部过内核校验 / scriptId 与任务单清单逐字一致且不重复 / 全部 `force_override` / 至少 3 幕且有效 order 唯一且幕 0 = `afterTurns: 0` 无 delta / 每幕都有 completion 且都有 abort / 危机剧本 abort 含 `minimizing`+`preaching`+`judgment` / 每幕都有督导要点且不含台词标点 / 幕 1 带 delta 而幕 0 不带 |
| 内容纪律（5 例） | 全 10 个剧本无 3 位以上连续数字 / 危机剧本不出现任何具体方式词（14 词禁表）/ 危机剧本仍留有间接行为线索 / 全 10 个剧本无机构名/电话/地址/URL 形态 / 全 10 个剧本无台词标点 |
| 解析端口（4 例） | 查得到返回本体 / 查不到返回 undefined 且不抛 / 缺省与空白返回 undefined 且前后空格归一 / 内存表与数组是**同一份对象**（无第二份真相） |

**`test/engine-adapters/wp10-trajectory-injection.spec.ts`（14 例）**

| 组 | 断言 |
|---|---|
| 注入链路（9 例） | 握手解析 scriptId / 不传 → undefined / 控制字符清洗 + 超长截断 / voice 层原样透传给后端 / 解析到 → `engine.open` 收到 trajectory / 查不到 → 不传 trajectory 且不抛 / 解析器未装配 → 不抛 / 解析器抛错 → 回退 / **不传时入参键集合逐字一致**（`['sessionId','tenantId','visitorId']`，且 `'trajectory' in input === false`，且解析器一次都没被碰） |
| 装配绑定（1 例） | `engine.module.ts` 必须 `provide: TRAJECTORY_SCRIPT_RESOLVER` 且装进后端工厂（`optional: true`） |
| 真实内核（4 例） | 每轮出参都带 `trajectoryTrace` / 四幕全部走过且 outcome=completed / 闸门未到时停在事件幕不推进（不会第一轮就爆）/ **同剧本同开场跑两次 → 初始快照与推进轨迹完全一致**（可复现）/ 不带剧本 → 无 trajectoryTrace（内核零行为差异） |

---

## 6. 与任务单的差异（显式说明）

| # | 任务单原文 | 本轮落法 | 理由 |
|---|---|---|---|
| 1 | §1.2 幕 1「`onEvents` 命中目标事件类型**或** `onKeywords` 命中特定词，**且** `afterTurns >= 3`」 | **每个 trigger 只用一种闸门原子**：幕 1 用 `onEvents`（+ `afterTurns`），completion 用 `onEvents` × `onKeywords`（+ `afterTurns`） | 内核 `evaluateTrigger` 是**跨原子 AND、列表内 OR** —— "或"无法跨原子表达；两个原子并置 = 窄条件，剧本大面积停在等待幕。与 §6.5 同向（不发明内核不识别的事件名） |
| 2 | §1.2 幕 0「`afterTurns: 0`（开场即激活，target 不设或设中性）」 | 幕 0 **完全不设 target**（只设 trigger + referenceNotes） | 设了中性 target 也要手写一遍 BDI 的中性值 —— 与内核"缺省即透传 BDI"的语义重复，且多一份真相 |
| 3 | §1.2 completion「`onEvents: [empathy]` **且** `onEvents: [boundary_holds]`」 | 共情侧用 `empathy / acceptance / normalization` 三选一 × 边界类关键词 | 内核没有 `boundary_holds`（§6.5 已预判）；共情侧只押 `empathy` 一个事件会让完成判定对措辞过于敏感（换一个共情说法就永远落不了 completed） |
| 4 | §1.4「`EngineStreamBackend.openSession()`：读 `opts.trajectoryScriptId` → 调 `this.scriptResolver?.resolve(scriptId)`」 | 照做，但解析失败分三种口径分别处理（未装配 / 查不到 / 抛错）并各自 warn | 任务单只写"查不到不抛错"，本轮把三种失败路径都显式化，避免"未装配"静默无痕 |
| 5 | §5「所有剧本标注 `// TODO(专业复核): …`」 | 保留中文原文 + 就地 `eslint-disable-next-line sonarjs/todo-tag` | `sonarjs/todo-tag` 只认 ASCII 标签；为过 lint 擅自把标记改英文 = 悄悄改掉任务单的显式要求 |

---

## 7. 闸门实测结果

```
npx tsc -p tsconfig.build.json --noEmit              → 0 错
npm run lint                                          → exit 0（eslint 0 error 0 warning）
npx jest test/engine-adapters test/engine-core        → 22 套件 / 410 例全绿
npx jest test/voice                                   → 3 套件 / 88 例全绿
npx jest test/engine-adapters/wp10-*.spec.ts          → 2 套件 / 31 例全绿
npm test -- wp8-wiring                                → PASS（WP8-A §8-9 护栏未改未破）
npm test（全量）                                       → 53 套件 / 820 例通过；1 套件 2 例失败（见 §7.1）
git diff --stat HEAD -- src/engine-core               → 空（内核整树零改动）
git status --porcelain -- src/counselor/drills src/migration src/entity
                                                     → 空（drills / migration / entity 零改动）
```

### 7.1 全量 jest 唯一的失败：`test/counselor/drill-judge.spec.ts` 2 例 = **任务单 §3.4 已声明的既有债**

```
● boundary 三档判定 › 否定守卫: 命中词前有否定字时该次命中不计入, 但同词后面的未否定出现仍计入
    Expected: "我加你"   Received: null
● crisis 判定 › 评判式回应 → 不评判锚点未覆盖, 且给"这里可以多问一句"方向提示
    Expected substring: "多问一句"   Received: "出现了「别想太多」这类措辞 —— …"
```

该套件**只 import `src/counselor/drills/**`**（`boundary-scripts` / `crisis-scripts` / `drill-registry` / `drill-judge`），与本单改动的 `src/voice/**` + `src/engine-adapters/wiring/**` **零交集**；本轮**一行未碰** `src/counselor/drills/**`。按任务单"既有债不擅自修"处理。

### 7.2 `npx tsc -p tsconfig.json --noEmit`（含 `test/`）的报错 = **仓库既有债**

```
test/e2e/knowledge-search.e2e-spec.ts   13 个（TS2307 模块不存在: ../src/... 相对路径从 test/e2e/ 解析不到）
test/good-state-diary.e2e-spec.ts       28 个（TS4111 / TS2352 / TS2349 supertest 类型）
```

两个文件引用了**不存在的模块**，是早于本轮的失效 e2e。本轮未碰这两个文件，也没为了消报错去动它们。生产构建口径 `tsconfig.build.json` **0 错**；本单新增的两个 spec 文件在全量 `tsconfig.json` 口径下**零报错**。

---

## 8. 改动面清单

### 8.1 新增文件（5）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/trajectory/ethical-scripts.ts` | 10 个 `TrajectoryScript` 静态资产 + 三个共享闸门常量 + 按 scriptId 的冻结内存表 |
| `src/engine-adapters/wiring/trajectory/script-resolver.ts` | `TrajectoryScriptResolver` 端口 + `TRAJECTORY_SCRIPT_RESOLVER` Symbol token + `StaticTrajectoryScriptResolver` |
| `src/engine-adapters/wiring/trajectory/index.ts` | barrel 单一出口（零 ORM / 零 SDK 依赖） |
| `test/engine-adapters/wp10-ethical-scripts.spec.ts` | 形状 + 内容纪律 + 解析端口（17 例） |
| `test/engine-adapters/wp10-trajectory-injection.spec.ts` | 注入链路四段 + 装配绑定 + 真实内核轨迹行为（14 例） |

### 8.2 修改文件（8）

**voice 层（4）**：`voice-turn-backend.port.ts`（窄接口加可选 `trajectoryScriptId` + 契约注释）/ `voice-handshake.ts`（query 解析 + 清洗 + 封顶）/ `voice.gateway.ts`（透传 + 连接日志补 `script=`）/ `voice.service.ts`（透传给后端）/ `voice.types.ts`（`VoiceSessionMeta` 加可选字段）。

**引擎装配层（4）**：`engine-stream-backend.adapter.ts`（`@Optional` 解析器 + `resolveTrajectoryScript()` + 注入 `trajectory`）/ `engine.providers.ts`（工厂 deps 加 `scriptResolver`）/ `engine.module.ts`（绑定端口 + 工厂 inject）。

### 8.3 红线核对

| 红线 | 核对结果 |
|---|---|
| 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` 为空 |
| 不落 MySQL / 不加 migration | ✅ 静态 TS 资产；零 migration、零 entity 改动 |
| 不重写 `src/counselor/drills/**` | ✅ 零改动（旧链路单次训练不动） |
| 不写完整口语台词 | ✅ 剧本只给 `target` + `forbiddenBehaviors`；台词由 LLM 渲染 |
| 不改 engine-core 纯层 | ✅ 内核 `TrajectoryScript` / `validateTrajectoryScript` / 游标推进全部未动 |
| 不给旧 VisitorService 加剧本支持 | ✅ 未改一行（天然 undefined） |
| 不新增 env 开关 | ✅ 剧本是否启用由握手 `scriptId` 控制 |
| 不发明内核不识别的事件名 | ✅ 全部 `onEvents` 取自 `EVENT_LEXICON` / `CounselorEventKind` 真实值 |
| wiring 顶层不直引 SDK | ✅ `wp8-wiring.spec.ts` 护栏 PASS；新目录零 `@nestjs/typeorm` / 零网络 |
| 不自动 commit / push | ✅ 本轮**不提交**，commit 文案见 §9 |

---

## 9. commit 文案

```text
feat(engine): WP10 伦理盲盒 10 个强覆盖剧本 + 握手 scriptId 注入链路

- 新增 src/engine-adapters/wiring/trajectory/: 10 个 force_override 伦理盲盒剧本
  (静态 TS 资产, 不落库) + TrajectoryScriptResolver 端口 (Symbol token) + 静态实现
  + barrel 出口 (零 ORM / 零 SDK 依赖)
- 窄接口 VoiceTurnBackendOpenOptions 加可选 trajectoryScriptId; 握手 query 透传
  scriptId (gateway → VoiceSessionMeta → openSession); 不传时行为与现状逐字一致
- EngineStreamBackend 加 @Optional 剧本解析器: 解析到才传 engine.open().trajectory,
  查不到 / 未装配 / 抛错一律 warn + 回退自由运行 (剧本是可选增强, 不是会话前置条件)
- engine.module.ts 绑定 TRAJECTORY_SCRIPT_RESOLVER; 引擎装配层仍零 SDK 依赖
- 新增 31 例单测: 10 个剧本形状 (内核 validateTrajectoryScript 为唯一真值源) +
  内容纪律 (无号码 / 无危机方式 / 督导要点非台词) + 注入链路四段 + 零回归 + 轨迹可复现
- 零改动: src/engine-core/** / src/counselor/drills/** / 无 migration / 未改 .env
```

---

## 10. 用户验收

### 10.1 前端需要配合的（**后端已就绪，前端可以先不改**）

1. **握手 query 增加可选 `scriptId` 参数**（与 `templateId` / `skillCode` 同款）：

   ```text
   wss://host/voice/training?sessionId=<uuid>&token=<jwt>&scriptId=ethical_private_contact
   ```

2. **Flutter 侧 `vpt_session_start.dart` 的握手白名单补 `scriptId` 字段**（当前只放行 `templateId` / `skillCode` / `voiceId` 等）。等本单交付后由前端侧排期。
3. **不传 = 与现状完全一致**（BDI 自由运行），前端不改也能上线；传了才启用伦理盲盒剧本。
4. **传不存在的 scriptId 不会断连** —— 后端 warn + 回退自由运行（与 `templateId` 查不到就断连的处理**刻意不同**：剧本是可选增强）。

### 10.2 验收对照任务单 §3

| # | 项 | 本轮状态 |
|---|---|---|
| 1 | 10 个剧本全部通过 `validateTrajectoryScript`，单测锁死 | ✅ 25 例形状+纪律用例 |
| 2 | 每个剧本 `mode === 'force_override'` | ✅ |
| 3 | 每个剧本至少 3 幕（自由运行 → 伦理事件 → 应对/完成） | ✅ 各 4 幕 |
| 4 | 每个剧本有 completion（正确应对后落 completed） | ✅ 真实内核跑通 outcome=completed |
| 5 | crisis 剧本有 abort（严重越界/忽略信号时落 aborted） | ✅ `minimizing`+`preaching`+`judgment` |
| 6 | 所有 referenceNotes 不含台词，只含督导要点 | ✅ 单测锁死（含问号/感叹号即红） |
| 7 | 握手传 `scriptId=ethical_private_contact` → openSession 后引擎会话携带 trajectory | ✅ 注入链路用例 |
| 8 | 不传 scriptId → 行为与现状逐字一致（零回归） | ✅ 断言入参**键集合**逐字一致 |
| 9 | 传不存在的 scriptId → warn 日志 + 回退自由运行 | ✅ 三种失败口径各有用例 |
| 10 | scriptId 透传链路：gateway query → openSession opts → resolver → engine.open().trajectory | ✅ 四段逐段有用例 |
| 11 | 同一剧本同一角色开场两次，BDI 初始快照一致 | ✅ 真实内核两次跑出**逐字相等**的快照 |
| 12 | 同一触发条件在两次会话中激活同一幕 | ✅ 两次 `trajectoryTrace` 逐字相等 |
| 13 | `trajectoryTrace` 在每轮出参中可见 | ✅ 每轮都带（走 kernel → `TurnRenderResult` 透传） |

### 10.3 已知边界 / 后续项（必须如实看）

- **`referenceNotes` 目前没有消费方**：内核 `TrajectoryNode.referenceNotes` 的契约是"只保留给督导/WP5 的结构化参考要点，**不是台词，不渲染**"，而 `RenderSpec.trajectoryNote` 这条渲染缝在 `turn-render-orchestrator.ts` 里**至今没人填**。即：**本单的剧本现在只控 `target` / `delta`（即时行为），督导要点既没进渲染 prompt，也没进督导报告**。本轮交付的是资产与消费口径，督导侧展示属 Phase2。
- **completion 是单轮判定**（内核语义限制）："开放式探问"与"引导求助"必须出现在**同一轮**才落 completed，跨轮累计内核不支持 —— 探问质量要看逐轮 `trajectoryTrace`，不能只看 `outcome`。
- **幕 1 的闸门依赖咨询师行为**：若学员连续几轮没做出任何被词典识别的专业动作，伦理事件不会激活（会话停在等待幕，BDI 自由运行）。这是任务单 §1.2 的原意（"咨询师行为满足条件时"），但意味着**触发点不是恒定的** —— 可衡量性靠"同一段咨询师输入 → 同一幕"来保证，不靠"第 N 轮必爆"。
- **`ethical_private_contact` 的事件幕在第 5 轮**（收尾阶段才索要联系方式），其余 9 个在第 3 轮。
- **UGC 剧本池 / 审核流 / 版本管理**属 Phase2；本轮 10 个是平台内置资产。
- **4 流派伦理复盘报告**属 Phase2 评估引擎；本轮不做。
- **`drill-judge` 既有债 2 例**未修（任务单明确"不擅自修"）。
