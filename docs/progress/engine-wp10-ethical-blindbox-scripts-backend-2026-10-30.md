# WP10 · 10 个伦理盲盒强覆盖剧本资产 · 后端任务单

> 类型: 后端任务单（行为化，不含 src 实现）
> 前置: WP3（TrajectoryScript schema 纯层已交付）；WP8-B（新引擎语音链路已通）；WP9-A（角色注入链路已通）
> 日期: 2026-10-30
> 红线: **不改 `src/engine-core/**` 纯层**（TrajectoryScript / validateTrajectoryScript / 游标推进全部已交付，本单只写数据 + 适配层注入）；不加 DB schema（本期内置静态 TS，不落 MySQL）；不重写现有 drills（`src/counselor/drills/` 的 boundary/crisis 单次训练体系不动）。

---

## 0. 为什么有这条

WP3 交付了轨迹控制三模式纯层（强覆盖/修正/触发），`TrajectoryScript` schema 已定型，`validateTrajectoryScript()` 能校验形状。但**引擎从交付到现在没有一份真实剧本注入过**——`OpenEngineSessionInput.trajectory` 字段一直是 undefined，强覆盖模式空转。

蓝图 §5.2 要求：伦理盲盒场景采用**强覆盖模式**，来访严格按剧本推进，保证每次演练的触发点、行为表现、风险点完全一致，实训效果可衡量。蓝图 §240 列了 6 个方向（表白、索要私人联系方式、熟人咨询、录音纠纷、诊断证明诉求、自杀危机），本单收敛到 10 个。

**与现有 drills 的关系**：`src/counselor/drills/` 的 boundary(5) + crisis(3) 是**旧链路单次训练**（HTTP 一次性、固定 visitorPrompt、关键词三锚点判定）。本单做的是**新引擎语音对练中的多轮轨迹盲盒**——BDI 自由运行若干轮后，触发条件满足时强制激活剧本节点，来访行为目标被剧本覆盖。两者不冲突、不重写、不合并。

---

## 1. 做什么

### 1.1 建剧本资产目录（静态 TS，不落库）

位置：`src/engine-adapters/wiring/trajectory/`

```
src/engine-adapters/wiring/trajectory/
  ethical-scripts.ts          ← 10 个 TrajectoryScript 对象（本单主体）
  script-resolver.ts          ← TrajectoryScriptResolver 端口 + 静态实现
  index.ts                    ← 导出
```

**为什么静态 TS 不落 MySQL**：本期 10 个是平台内置资产，和 `boundary-scripts.ts` / `crisis-scripts.ts` 同范式。backlog 明确不做 UGC 提交流；剧本落库 + 审核流是 Phase2。静态常量的好处：类型安全、git diff 可审、不需要 migration。

### 1.2 写 10 个 `TrajectoryScript` 对象

全部 `mode: 'force_override'`（强覆盖——伦理盲盒的专用模式）。

每个剧本必须有**至少 3 幕**：

| 幕位 | 作用 | trigger 设计 |
|---|---|---|
| 幕 0（自由运行） | 正常咨询开场，BDI 自由跑 | `afterTurns: 0`（开场即激活，target 不设或设中性） |
| 幕 1（伦理事件触发） | 咨询师行为满足条件时，来访强制说出伦理事件 | `onEvents` 命中目标事件类型 **或** `onKeywords` 命中特定词，**且** `afterTurns >= 3`（不能第一轮就爆） |
| 幕 2（事件展开） | 来访按剧本目标展开（强覆盖情绪/阻抗/移情偏移） | `afterTurns` 或咨询师上一轮回应方向 |
| completion | 咨询师正确应对（共情 + 边界 + 替代路径）→ 落 completed | `onEvents: [empathy]` **且** `onEvents: [boundary_holds]`（需内核有这些事件类型，没有就用关键词组合） |
| abort（可选但推荐） | 咨询师严重越界（评判/说教/立刻给建议/答应私加微信）→ 落 aborted | `onEvents: [judgment]` 或关键词命中"好我加你微信"/"没问题"等松口词 |

**每幕字段要求**：
- `nodeId`: 语义化（如 `confession_free` / `confession_event` / `confession_response`）
- `delta`: 进入幕 1 时一次性状态偏移（如伦理事件触发时 `emotion.valence -= 0.2`、`resistance.verbal += 0.15`），只在进入那一轮叠加一次
- `target`: 强覆盖模式下来访的行为目标（`strategy` / `emotion` / `resistance` / `forbiddenBehaviors`）
- `referenceNotes`: **给督导看的结构化要点**（不是台词！）——如"此幕来访表达情感依赖，咨询师需先共情感受再说明专业边界，不可直接拒绝造成羞耻"
- **不写完整口语台词**：台词由 LLM 按 target + forbiddenBehaviors 渲染；剧本只给状态目标和禁止行为

#### 10 个剧本清单

| # | scriptId | 标题 | 伦理议题 | 难度 |
|---|---|---|---|---|
| 1 | `ethical_romantic_confession` | 来访者在第 4-6 轮表白 | 情感移情边界 | L2 |
| 2 | `ethical_private_contact` | 结束时索要私人微信/电话 | 设置边界 | L1 |
| 3 | `ethical_known_person` | 来访者透露是朋友/同事介绍来的熟人 | 双重关系 | L2 |
| 4 | `ethical_recording_dispute` | 来访者说自己在录音/录像 | 保密与记录管理 | L2 |
| 5 | `ethical_diagnosis_note` | 索要诊断证明/病假条/医学建议书 | 专业边界（非诊疗关系） | L2 |
| 6 | `ethical_suicide_crisis` | 会谈中段冒出自杀意念信号 | 危机干预 | L3 |
| 7 | `ethical_gift_money` | 来访者要送礼物/发红包/请客 | 双重关系 / 馈赠 | L1 |
| 8 | `ethical_value_judgment` | 来访者在堕胎/宗教/性取向上逼咨询师表态 | 价值中立 | L3 |
| 9 | `ethical_sexual_seduction` | 来访者言语调情/性暗示（比表白更严重的性边界） | 性边界 | L3 |
| 10 | `ethical_medical_advice` | 来访者要求开药/调药/医学检查建议 | 跨专业边界 | L2 |

**内容纪律（与 crisis-scripts.ts 同款，越界即返工）**：
- 不写具体机构名/电话/地址/热线号码；求助路径只写"专业支持/医疗机构"类别词
- 危机剧本（#6）不写完整自杀方式/计划细节，只用间接行为线索（"交代后事""突然平静""清点物品"）
- 不写干预技术步骤（风险评估表/安全计划），剧本只到"来访表达信号 + 咨询师需开放式探问"为止
- 人设只到称呼/年龄/性别/职业/一句背景，不写创伤细节
- 所有剧本标注 `// TODO(专业复核): 待心理咨询专业口径校验`
- `referenceNotes` 写督导要点，不写"标准答案台词"

### 1.3 建 `TrajectoryScriptResolver`

仿 `CharacterProfileResolver` 端口模式：

```ts
// script-resolver.ts
export const TRAJECTORY_SCRIPT_RESOLVER = Symbol('TRAJECTORY_SCRIPT_RESOLVER');

export interface TrajectoryScriptResolver {
  resolve(scriptId: string | undefined): TrajectoryScript | undefined;
}
```

静态实现：内存查 `ethical-scripts.ts` 里的 Record<scriptId, TrajectoryScript>。查不到返回 undefined（不抛错——和角色解析同款"可选增强"语义）。

**为什么 @Optional**：和角色注入一样，剧本是可选增强。装配缺失或握手没传 scriptId 时，会话照常 BDI 自由运行，不能因为"没有剧本"开不了会话。

### 1.4 打通注入链路

**窄接口加可选字段**（`voice-turn-backend.port.ts`）：

```ts
export interface VoiceTurnBackendOpenOptions {
  // ...既有字段不动
  readonly trajectoryScriptId?: string;  // 新增可选
}
```

**EngineStreamBackend.openSession()**：
- 读 `opts.trajectoryScriptId`
- 如果有值，调 `this.scriptResolver?.resolve(scriptId)`
- 解析到剧本 → 传入 `engine.open()` 的 `trajectory` 字段
- 解析不到 / 没传 → 不传 trajectory（与现状逐字一致）
- @Optional 注入 resolver

**voice.gateway.ts 握手 query**：
- 加 `scriptId` query 参数（与 `templateId/skillCode` 同款白名单透传）
- 透传到 `openSession(opts)`
- 不传时 behavior 不变

**反双胞胎**：
- 不在 voice 层判断"有没有剧本"——它只透传 scriptId 字符串
- 不在 EngineStreamBackend 里写剧本内容——只调 resolver
- 旧 VisitorService 不实现这个字段（它不接新引擎剧本，天然 undefined）

### 1.5 校验每个剧本

每个剧本写完后必须过 `validateTrajectoryScript(script)`：
- scriptId 非空
- mode 合法（全是 force_override）
- nodes 数组非空（至少 3 幕）
- 每幕 nodeId 非空
- 有效 order 唯一
- completion.when 存在

在 `ethical-scripts.ts` 底部加一个启动时自检（或单测里跑）：10 个剧本全部 validate 通过，任一抛错则测试红。

---

## 2. 不做

- ❌ 不改 `src/engine-core/**`（TrajectoryScript schema / validate / 游标 / 推进纯函数全部已交付）
- ❌ 不把剧本落 MySQL / 不做 migration / 不做审核状态字段（Phase2 UGC）
- ❌ 不重写 `src/counselor/drills/` 的 boundary/crisis 剧本（旧链路单次训练，不动）
- ❌ 不写完整口语台词（剧本给状态目标，台词由 LLM 渲染）
- ❌ 不做剧本编辑器 / 在线修改 / 版本管理
- ❌ 不做 4 流派伦理复盘报告（Phase2 评估引擎）
- ❌ 不做强覆盖模式下的 BDI 状态记录调整（force_override 已有纯层逻辑，不碰）
- ❌ 不给旧 VisitorService 加剧本支持（旧链路退役后再说）
- ❌ 不新增 env 开关（剧本是否启用由握手 scriptId 控制，不需要全局开关）

---

## 3. 验收标准

### 3.1 形状验收

- [ ] 10 个剧本全部通过 `validateTrajectoryScript()`，单测锁死
- [ ] 每个剧本 `mode === 'force_override'`
- [ ] 每个剧本至少 3 幕（自由运行 → 伦理事件 → 应对/完成）
- [ ] 每个剧本有 completion（正确应对后落 completed）
- [ ] crisis 剧本（#6）有 abort（咨询师严重越界/忽略信号时落 aborted）
- [ ] 所有 referenceNotes 不含台词，只含督导要点

### 3.2 注入验收

- [ ] 握手传 `scriptId=ethical_private_contact` → openSession 后引擎会话携带 trajectory
- [ ] 不传 scriptId → 行为与现状逐字一致（零回归）
- [ ] 传一个不存在的 scriptId → warn 日志 + 回退自由运行（不抛错、不开不了会）
- [ ] scriptId 透传链路：gateway query → openSession opts → resolver → engine.open().trajectory

### 3.3 复现验收

- [ ] 同一剧本同一角色开场两次，BDI 初始快照一致（force_override 的确定性）
- [ ] 同一触发条件在两次会话中激活同一幕（游标推进可复现）
- [ ] `trajectoryTrace` 在每轮出参中可见（走到第几幕/visitedNodeIds/outcome）

### 3.4 红线验收

- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 无新增 migration / 无 entity 改动
- [ ] `src/counselor/drills/` 零改动
- [ ] tsc 0 错 / eslint 0 error 0 warning / jest 全绿（既有 1 套件 2 例失败 = drill-judge 既有债，不擅自修）

---

## 4. 闸门命令（后端自跑，Windows PowerShell）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npx jest test/engine-adapters test/engine-core
npm test -- wp8-wiring
git diff --stat HEAD -- src/engine-core
```

---

## 5. 交付后回写

> 完整交付记录另见: [`engine-wp10-ethical-blindbox-scripts-backend-implementation-2026-10-30.md`](./engine-wp10-ethical-blindbox-scripts-backend-implementation-2026-10-30.md)（本文档末尾 §7 是它的摘要版）

完成后在本文件末尾追加交付记录（仿 WP21 格式）：
- 实际写了哪些剧本（scriptId 清单 + 各自幕数）
- 注入链路改动面（新增文件 / 修改文件清单）
- 踩了什么坑
- commit 文案
- 前端需要配合什么（握手 query 加 scriptId 参数——前端 Flutter 的 `vpt_session_start.dart` 握手白名单需要补 `scriptId` 字段，等本单交付后由前端侧排期）

---

## 6. 给后端的提示

1. **先看 `src/engine-core/domain/trajectory/script.ts` 和 `test/engine-core/wp3-trajectory.spec.ts`**——schema 和校验规则都在那里，别猜字段。
2. **再看 `src/engine-core/cognition/trajectory/` 下的 trigger-evaluate / act-cursor / trajectory-applier**——理解 trigger 怎么评估、幕怎么推进、delta 怎么叠加。写剧本时 trigger 条件要和内核实际评估的事件类型对得上（看 `session-event.ts` 里 `CounselorEventKind` 有哪些值）。
3. **参考 `CharacterProfileResolver` 的 @Optional 模式**（`wiring/character/`）——剧本 resolver 照抄这个结构，保持装配层风格一致。
4. **剧本内容先写骨架（scriptId/title/nodes 结构/delta 数值/trigger 条件），referenceNotes 写督导要点**。不要一上来写大段台词——台词是 LLM 的事，剧本只控状态。
5. **trigger 的 onEvents 值取决于内核 `CounselorEventKind` 实际有哪些事件**——如果内核目前没有 `boundary_holds` 这类"咨询师正确应对"事件，completion 就用 `afterTurns` + 关键词组合（如咨询师文本里出现"设置/边界/我们的约定"+"理解/感受"），不要发明内核不识别的事件名。

---

## 7. 交付记录（2026-10-30 · WP10 后端）

### 7.1 实际写了哪些剧本（10 个，全部 `force_override`，各 4 幕）

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

**幕结构统一为 4 幕**（任务单要求"至少 3 幕"）：幕 0 自由运行（`afterTurns: 0`，不带 delta）→ 幕 1 伦理事件（带 delta：情绪下移 + 阻抗上升 + 移情依赖上升）→ 幕 2 事件展开（加压试探，阻抗深度上升）→ 幕 3 收束（等咨询师给边界与替代路径）。

**触发设计**（全部用内核**真实识别**的事件名，未发明 `boundary_holds`）：

- 幕 1 闸门 = `afterTurns ≥ 3` **AND** 「咨询师做出一个被规则词典识别的专业动作」（`empathy / acceptance / normalization / open_probe / affirmation` 任一）→ 满足即强制激活伦理事件。
- completion = `afterTurns ≥ 6` **AND** 一个被识别的共情 / 接纳类事件 **AND** 一组边界 / 求助类关键词（按剧本各不相同）。
- abort = `afterTurns ≥ 4` **AND** `judgment / preaching / boundary_cross`（价值中立与危机两个剧本另配：价值中立 = `judgment / preaching`；危机 = `minimizing / preaching / judgment`，即"忽略信号 / 说教 / 评判"都落 aborted）。

**内容纪律**：10 个剧本全文无 3 位以上连续数字、无机构名 / 电话 / 地址；危机剧本只写间接行为线索（交代后事 / 清点物品 / 突然平静），不写任何自伤方式与计划细节；`referenceNotes` 只写督导要点（不含问号 / 感叹号 → 不是台词）；无一处完整口语台词（台词由 LLM 按 `target` + `forbiddenBehaviors` 渲染）。

### 7.2 注入链路改动面

**新增（5 个）**

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/trajectory/ethical-scripts.ts` | 10 个 `TrajectoryScript` 静态资产 + 按 scriptId 的内存表（`Object.freeze`） |
| `src/engine-adapters/wiring/trajectory/script-resolver.ts` | `TrajectoryScriptResolver` 端口 + `TRAJECTORY_SCRIPT_RESOLVER` Symbol token + `StaticTrajectoryScriptResolver`（同步查表，查不到返回 undefined） |
| `src/engine-adapters/wiring/trajectory/index.ts` | barrel 出口（零 ORM / 零 SDK 依赖） |
| `test/engine-adapters/wp10-ethical-scripts.spec.ts` | 形状（16 例）+ 内容纪律（5 例）+ 解析端口（4 例）—— 形状**直接调内核 `validateTrajectoryScript`**，不抄第二份 |
| `test/engine-adapters/wp10-trajectory-injection.spec.ts` | 注入链路四段（9 例）+ 装配绑定（1 例）+ 真实内核轨迹行为（4 例） |

**修改（8 个）**

| 文件 | 改动 |
|---|---|
| `src/voice/voice-turn-backend.port.ts` | 窄接口 `VoiceTurnBackendOpenOptions` 加**可选** `trajectoryScriptId`（旧实现天然 undefined，"并存可回退"不破） |
| `src/voice/voice-handshake.ts` | 握手 query 解析 `scriptId`（去控制字符 + 长度封顶 64；**不做存在性校验**） |
| `src/voice/voice.gateway.ts` | `handshake.scriptId` → `SocketData` → `voice.startSession` meta 原样透传；连接日志补 `script=` 字段 |
| `src/voice/voice.service.ts` | `meta.trajectoryScriptId` → 后端 `openSession`（voice 层不判断剧本存在性） |
| `src/voice/voice.types.ts` | `VoiceSessionMeta` 加可选 `trajectoryScriptId` |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `@Optional` 剧本解析器 → `resolveTrajectoryScript()`（查不到 / 未装配 / 抛错一律 warn + 回退自由运行）→ 解析到才往 `engine.open()` 传 `trajectory` |
| `src/engine-adapters/wiring/engine.providers.ts` | 工厂 `createEngineStreamBackend` deps 加 `scriptResolver`（构造逻辑仍归工厂，@Module 只声明映射） |
| `src/engine-adapters/wiring/engine.module.ts` | 绑定 `TRAJECTORY_SCRIPT_RESOLVER` → `StaticTrajectoryScriptResolver`；后端工厂 inject 带上该端口（`optional: true`） |

**红线核查**

- `git diff --stat HEAD -- src/engine-core` → **空**（内核零改动）
- `src/counselor/drills/**` → **零改动**（旧链路单次训练不动）
- 无新增 migration / 无 entity 改动 / 未改 `.env`
- `src/engine-core` 零新增 `@nestjs/` / typeorm / 网络；引擎装配层仍**零 SDK 包名**
- 旧 `VisitorService` 未接剧本字段（天然 undefined）

### 7.3 踩了什么坑

1. **内核 trigger 是"跨原子 AND、列表内 OR"** —— 任务单 §1.2 写的"幕 1 用 `onEvents` **或** `onKeywords`"在内核里做不到：两个原子并置就是 AND，会变成"既要命中事件又要命中关键词"的窄条件，剧本大面积停在等待幕里不推进。**解法**：每个 trigger 只用**一种**闸门原子 —— 幕 1 用事件，completion 用"事件 × 关键词"。这是本单与任务单文字唯一的偏离，方向与任务单 §6.5 一致。
2. **completion 是全局单轮判定，与游标无关** —— 内核每轮都判 `completion.when`。若不给 `afterTurns` 下限，咨询师第 1 轮说句带"边界"的话就可能直接落 completed（伦理事件根本没发生）。本单统一 `completion.afterTurns = 幕 1 afterTurns + 3`。
3. **abort 是全局最先判定，与游标无关** —— 不给 `afterTurns` 下限的话，咨询师在开场第一轮说错话就整场 aborted（此时来访还没看到伦理事件，aborted 没有意义）。本单统一 `abort.afterTurns = 幕 1 afterTurns + 1`。
4. **force_override 的"等待轮"也会施加 target 基调** —— 幕 1 的 trigger 没满足时，来访的行为目标**已经被替换**（只是不叠 delta）。所以幕 1 的 target 必须写成"朝向该伦理事件的倾向"，不能写成"事件已发生"。
5. **abort 只能用事件原子，不能用关键词** —— 关键词分不清"讨论"与"答应"：咨询师**正确**解释保密时同样会说出"录音"，用关键词做 abort 会把正确应对误判成越界。宁可漏判，不可误伤。
6. **`eslint` 拦了任务单要求的 TODO 标记** —— `sonarjs/todo-tag` 只认 ASCII 标签，任务单的 `// TODO(专业复核): …` 被判错。**解法**：就地 `eslint-disable-next-line sonarjs/todo-tag` 放行，保留任务单原文（未擅自改成英文标签）。
7. **`unicorn/no-zero-fractions`** —— `valence: 0.0` 必须写 `valence: 0`（语义等价：`0` 与 `0.0` 在 `??` 与 clamp 下同值）。
8. **握手 `scriptId` 不做白名单** —— 与 `skillCode` 不同：`skillCode` 是枚举（拼错 = 客户端 bug，丢弃即可），`scriptId` 是**资产 key**（集合会随 Phase2 的剧本池增长）。握手期钉死白名单 = 每加一个剧本就要改 voice 层，违反"换数据源不该改注入点"。查不到交给运行时 warn + 回退自由运行。
9. **构造参数位置** —— 剧本解析器插在 `frames` 之后、`traceRecorder` 之前（`traceRecorder` 至今无装配入口），这样工厂能用位置参数装进来，不必在中间插 `undefined` 占位；既有单测按位置 `new EngineStreamBackend(engine, resolver)` 的写法不受影响。
10. **completion 只能单轮判定（内核语义限制）** —— "探问质量"与"引导求助"必须出现在**同一轮**才会落 completed；跨轮累计内核不支持。因此探问质量要看逐轮 `trajectoryTrace`，不能只看 `outcome`。这一点已写进交付说明与督导要点。

### 7.4 闸门结果

| 闸门命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npm run lint` | ✅ 0 error / 0 warning |
| `npx jest test/engine-adapters test/engine-core` | ✅ 22 套件 / 410 例全绿 |
| `npx jest test/voice` | ✅ 3 套件 / 88 例全绿 |
| `npm test -- wp8-wiring` | ✅ PASS |
| `npm test`（全量） | 53 套件 / 820 例通过；**仅** `test/counselor/drill-judge.spec.ts` 2 例失败 = 任务单 §3.4 已声明的**既有债**（该套件只 import `src/counselor/drills/**`，与本单零交集，未擅自修） |
| `git diff --stat HEAD -- src/engine-core` | ✅ 空 |

### 7.5 commit 文案

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

### 7.6 前端需要配合什么

1. **握手 query 增加可选 `scriptId` 参数**（与 `templateId` / `skillCode` 同款）：

   ```text
   wss://host/voice/training?sessionId=<uuid>&token=<jwt>&scriptId=ethical_private_contact
   ```

2. **Flutter 侧 `vpt_session_start.dart` 的握手白名单补 `scriptId` 字段**（当前只放行 `templateId` / `skillCode` / `voiceId` 等）。等本单交付后由前端侧排期。
3. **不传 = 与现状完全一致**（BDI 自由运行），前端可以先不改，后端已就绪；传了才启用伦理盲盒剧本。
4. **传不存在的 scriptId 不会断连** —— 后端 warn + 回退自由运行（与 `templateId` 查不到就断连的处理不同，这是刻意的：剧本是可选增强）。
5. **观测**：剧本会话的每轮出参都带 `trajectoryTrace`（`activeNodeId` / `visitedNodeIds` / `cursor` / `outcome`），可作为督导侧"走到第几幕"的展示数据源；本单未做前端展示，Phase2 再排。
