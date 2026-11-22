# 边界压力测试 + 危机识别会内突发 · 后端任务单（2026-10-27）

> 配套：蓝图《全真执业升级定稿版》第一层新增模块 8（危机干预）/ 9（设置压力测试）；
> 产品整合版 v2.0 §16.1（边界应对 / 危机识别赛道）。
> 现有出声闭环与 vpt 语音会话**一字不动**，本单是独立的「情景演练（scenario drill）」轻量模块。
>
> **本期定位（务必先读）**：蓝图把这两块放在**第二阶段（1-2 年）**完整版；本期一次性交付两层，不分期：
> - **形态 2 · 独立专项拆解**（任务 C / A）：纯文本单事件、确定性判定、零压无分，脱离麦克风可独立完成与单测；
> - **形态 1 · vpt 内置危机剧情场**（任务 D）：在全真语音会话里显式安排一场危机信号场，复用已有 suicide_cue 实时提示与报告链路。
>
> 两层关系：专项拆解是"知道该问什么"，内置剧情场是"完整对话里临场捕捉"，共用同一套探问维度标准。
> 形态 1 的**代码与链路本期先打通**；语音实机效果受麦克风测试条件限制，待有设备后联调，不在代码层分期。
> 仍遵守：确定性判定为主、零压无分、不做危机恶化、不发号码、不教干预、危机内容物理隔离。

---

## 0. 现状基线（已有，勿重造）

| 已有能力 | 落点 | 本单关系 |
|---|---|---|
| 危机静态教学元数据（分级标签/信号类别/开放问句/边界声明） | `config/crisis-practice.config.ts` + `GET /counselor/crisis-practice/meta` | **保留不动**，本单危机剧本在其下游，前置壳仍用它 |
| 普通池物理隔离（拒收词表 + 隔离测试） | `config/visitor-pool.config.ts`、`test/counselor/crisis-practice-isolation.spec.ts` | 本单 crisis 剧本**必须**纳入同一隔离不变量 |
| practice 一次性作答 + 零压批注（无分、LLM 不可用降级关键词） | `practice-evaluator.service.ts` | **评判思路参考，但不复用其表/路由**（见 §2 决策） |
| ASR 一次性转写代理 | `POST /counselor/practice/asr` | 前端可先录音→拿到 text→再调本单 respond，服务端不自建转写 |

**为什么不复用 `practice_scenarios` / `practice_attempts`**：
- `exercise_mode` 锁死 10 档 `TrainingExerciseMode`，V1.3 约定"不新增 mode、不加 mode 列"，边界/危机不在 10 档内；
- `practice_attempts` 是"提交即评判完成"的同步无分记录，本单本期**连历史都不落**，挂进去只会制造空转外键；
- 危机内容需要比普通题库更硬的物理隔离，独立目录/独立端点隔离性最强。

---

## 1. 总体设计：通用「情景演练」骨架（为后期扩展而建）

新建一个与 practice 平行的轻量模块 `counselor/drills/`（目录名后端自定，下文用 `drills` 指代）。
**先抽象通用骨架，本期只填两个 track**，二期新增 track（深夜消息、伦理两难、反移情等）只加数据，不改骨架。

### 1.1 track 枚举（应用层字符串，不落 DB ENUM）

```ts
type DrillTrack = 'boundary' | 'crisis';
// 二期预留: 'after_hours_message' | 'ethical_dilemma' | 'counter_transference' …
```

### 1.2 剧本静态模型（TS 常量，走 config，不落库、不进 migration）

> 为什么静态 TS：剧本是**教学大纲**，不随用户/租户变，不高频运营变更；要改改代码发版，审计链完整，
> 且物理上进不了普通池 seed。与 `crisis-practice.config.ts` 同思路。

```ts
/** 单条判定锚点（确定性关键词兜底用；LLM 仅做润色，不做事实判定）。 */
interface DrillPoint {
  /** 稳定 key（如 namesEmotion / holdsBoundary）。 */
  key: string;
  /** 中文名（前端覆盖清单直接展示）。 */
  label: string;
  /** 命中即视为做到的正向关键词/短语。 */
  positiveKeywords: string[];
  /** 命中即提示越位的反向关键词/短语。 */
  antiKeywords: string[];
}

/**
 * 情景剧本。本期单节点单轮；nodes/branches 字段先占位（空数组），
 * 二期做多轮分支时填充，响应与前端协议不变。
 */
interface DrillScript {
  /** 稳定 slug（发布后即对外契约，不改名）。 */
  drillId: string;
  track: DrillTrack;
  /** 难度 1/2/3（沿用 PracticeDifficulty 口径，仅排序/展示）。 */
  difficulty: 1 | 2 | 3;
  /** 表层人设（称呼/年龄/性别/职业/一句背景；危机剧本用中性化名，不写真实病史）。 */
  persona: { name: string; age: number; gender: string; occupation: string; background: string };
  /** 场景一句话说明（给用户看的任务背景）。 */
  setting: string;
  /** 来访者抛出的那句话（首条气泡直接展示）。 */
  visitorPrompt: string;
  /** 本场景要求覆盖的技术点（boundary=三档判定锚点；crisis=探问/引导维度）。 */
  requiredPoints: DrillPoint[];
  /** 参考回应（"可以参考这样回应"，只给方向，boundary 给温和坚定范例，crisis 给开放探问范例）。 */
  referenceResponse: string;
  /** 常见偏差（批注卡"留意避免"）。 */
  commonPitfalls: string[];
  /** 本场景专属边界声明（crisis 必填，沿用非临床口径；boundary 可空用通用声明）。 */
  boundaryNotice?: string;

  // ── 二期预留（本期恒为 [] / null，勿实现逻辑）──
  /** 多轮节点（二期）。 */
  nodes: DrillNode[];
  /** 分支走向（二期）。 */
  branches: DrillBranch[];
}

interface DrillNode { nodeId: string; speaker: 'visitor' | 'counselor'; text: string; next?: string }
interface DrillBranch { fromNode: string; condition: string; toNode: string; label: string }
```

### 1.3 判定结果通用结构（响应出参）

```ts
interface DrillResponse {
  drillId: string;
  track: DrillTrack;
  /**
   * 仅 boundary 有值：三档技术形态标签（不是分数、不是对错）。
   * crisis 恒为 null。
   */
  verdict: 'over_compromise' | 'steady_firm' | 'abrupt_refusal' | null;
  /** 已覆盖的技术点 key 清单。 */
  coveredPointKeys: string[];
  /** 未覆盖的技术点 key 清单。 */
  missedPointKeys: string[];
  /** 3-5 条零压技术批注（positive/warning/info 三态，只描述技术，不评价人）。 */
  items: { tone: 'positive' | 'warning' | 'info'; pointKey: string; text: string }[];
  referenceResponse: string;
  commonPitfalls: string[];
  /** 产出来源：keyword（确定性兜底）/ llm（模型润色）。 */
  source: 'keyword' | 'llm';
}
```

---

## 2. 任务 C · 设置压力测试（boundary，本期重点，5 个确定性脚本）

### 2.1 脚本清单（先做 5 个，静态 TS 录入）

| drillId（建议） | 突破点 | 来访者抛出（visitorPrompt，示例口径，文案由后端按专业口径润色） |
|---|---|---|
| `boundary_wechat_contact` | 私下加联系方式 | 结束时"老师能不能加个微信，平时有急事能找到你" |
| `boundary_overtime` | 超时拖延 | 到点"再讲十分钟，我马上就说完了" |
| `boundary_after_hours_chat` | 非工作时间刷屏 | 深夜连续发多条长消息，期待即时回应 |
| `boundary_free_extra` | 要求免费加时 | "这次能不能多送我半小时，我预算不够" |
| `boundary_advice_gift` | 索要直接建议 / 送礼 | "你直接告诉我该怎么办就行" / "给你带了点东西" |

> 本期每个脚本**单轮**：用户回应一次即出判定。不演"来访者继续纠缠"的多轮拉扯（二期 nodes 实现）。

### 2.2 三档判定（核心，确定性为主）

对每个脚本的 `requiredPoints` 配置正向/反向关键词，命中规则后落三档之一：

| verdict | 形态 | 反馈口径（零压，不羞辱） |
|---|---|---|
| `over_compromise` 过度妥协 | 答应加联系方式 / 无限延时 / 承诺秒回 / 免费加时 / 直接给诊断式建议 | 先肯定善意与顾及来访，再指出边界松动点，给"温和坚定"的替代说法 |
| `steady_firm` 温和坚定 | 共情感受 + 明确守住设置 + 给出可行替代（如"工作时间内我会回复/预约下次"） | 肯定技术动作（共情到位、边界清晰、有替代路径） |
| `abrupt_refusal` 生硬拒绝 | 冷漠驳回 / 直接说"不行" / 让来访感到被推开 | 肯定守住了边界，指出表达方式可更共情，给软化范例 |

**判定优先级**：先看是否命中"答应/同意"类反向词 → `over_compromise`；再看是否有共情表达且守住设置 → `steady_firm`；否则（拒绝但生硬）→ `abrupt_refusal`。规则写成**纯函数可单测**，LLM 只在关键词不足时做形态润色，**不得由 LLM 直接改判档位**。

### 2.3 零压口径（硬约束）
- **不出分数、不出星级、不排名、不判对错**；`verdict` 只是技术形态标签，前端文案不得出现"得分/及格/失败"。
- 三档都给建设性反馈，`abrupt_refusal` 与 `over_compromise` 同样先肯定可取之处。

---

## 3. 任务 A · 危机识别会内突发（crisis，2-3 个脚本，只识别 + 转介探问）

### 3.1 合规红线（最高优先级，违反即返工）
- **只练"识别信号 + 开放式探问 + 平稳引导求助"，不训练干预/治疗技术**；
- **不做"干预失误 → 模拟危机恶化/危险升级"推演**（避免被认定为公域高危心理诊疗，踩红线 5）；
- 不给风险量化阈值/评分公式/临床诊断；**不出现任何具体热线号码、机构名、地址**（各地不同，归运营）；
- 危机剧本用中性化名，不写完整病史/创伤细节，不诱导追问；
- 物理隔离：crisis 剧本**不得**进入普通池/图鉴列表/任何公开题库，纳入 §5 隔离测试。

### 3.2 本期范围（最小闭环）
- 2-3 个**会内突发**脚本：标准对话进行中，来访者某一轮冒出风险表达（对应现有 7 类信号里的告别主题/无支撑感/状态骤变等）。
- 用户回应后，系统对照 `requiredPoints` 给出**覆盖清单**（不判档、不出 verdict）：
  - 是否用了**开放式探问**（而非评判式/急着给建议）；
  - 是否**保持不评判**、没有否定或淡化；
  - 是否**平稳引导到专业求助路径**（通用引导，不含号码）；
  - 遗漏点给"这里可以多问一句"的方向提示。
- **深夜间歇期危机消息后置**（依赖长程卷宗，本期不做，预留 track `after_hours_message`）。

### 3.3 与现有静态元数据的关系
- 前置教学壳（分级标签/信号类别/开放问句模板）继续读 `/counselor/crisis-practice/meta`；
- 本单 crisis 剧本是"在对话里实际练一次"，两者前后衔接，不重复造分级文案。

---

## 3.5 任务 D · vpt 内置危机剧情场（形态 1，临场检验）

> 与任务 A 的关系：任务 A 是脱离实时压力的单事件拆解；任务 D 是把同一套"识别 + 开放探问 + 平稳引导"
> 放进一场完整 vpt 语音会谈里，检验学员能否在对话流中**自己先捕捉到信号**。被动监测（普通会话
> 碰巧提到 → `suicide_cue` 红提示）已上线，本任务只补"**显式安排一场危机信号场**"。

### D1 · 握手新增可选剧情场标识 `drillTag`
- 在 `voice-handshake.ts` 纯函数解析里，参照现有 `skillCode` 同款模式新增可选 query `drillTag`：
  - 白名单本期仅 `'crisis_brief'`（预留扩展位，非法值**直接忽略、不断连、不报错**）；
  - 归一为小写后白名单匹配，未提供 = 普通场（现有行为零变化）；
  - 纯函数补单测：合法值透传 / 非法值丢弃 / 缺省 undefined。
- **客户端只传标识，不传任何剧本内容**（人设与 beat 全部服务端静态持有，对齐现有"前端不传剧本"红线）。

### D2 · 静态危机剧情场 config（隔离，不进普通池）
- 新建独立静态 config（与 `crisis-practice.config.ts` 同思路），1 个起步 `crisis_brief`：
  - 普通会谈底色（中性议题，避免一上来就是危机）；
  - **预埋 beat 表**：在约第 N 轮由来访者**自然流露**一类风险信号（告别主题 / 无支撑感 / 状态骤变等，引用现有 7 类信号类别，不自造诊断）；
  - 应对走向：咨询师**平稳开放探问 / 不评判 / 引导求助** → 来访缓和下来；咨询师**回避 / 淡化 / 急给建议** → 信号保持，**但不渲染危险升级、不出现具体自伤方式/计划细节/威胁**（合规硬约束）。
- 该 config 纳入 §5 隔离测试：0 命中普通池拒收词表、无号码形态、不进图鉴/普通池 seed。

### D3 · 注入与复用（不新造检测）
- 按 `drillTag=crisis_brief` 把 beat 指引合并进 persona system prompt（自然、不突兀、不照背台词）；
- **实时提示直接复用已有 `suicide_cue`**（每轮 turn-analysis 已检测），不新增规则类别；
- 结束报告在现有 `annotations` 里增一条"危机信号应对"覆盖点评：是否开放探问、是否未评判淡化、是否平稳引导到专业求助（通用引导，不含号码）；并入现有报告生成链路，不新造报告端点。

### D4 · 硬边界
- **只有用户显式选择危机信号场才注入**，绝不随机触发、绝不混进普通随机池；
- 不演恶化/危险升级、不写自伤方式与计划、不给风险阈值、不发号码、不教干预技术；
- 非临床口径，全程"识别与转介沟通"，边界声明沿用 crisis 元数据。

---

## 4. 接口契约（REST，复用 JwtAuthGuard，一人一租户校验归属）

> 路径前缀后端可与既有风格统一；下列为建议。全部向后新增，不改旧端点。

### 4.1 列表（带 track 过滤，只给元信息，不给全文）
```
GET /counselor/drills?track=boundary|crisis
Authorization: Bearer <jwt>
```
响应：
```jsonc
{
  "drills": [
    {
      "drillId": "boundary_wechat_contact",
      "track": "boundary",
      "difficulty": 1,
      "title": "结束时提出加微信",
      "setting": "会谈结束阶段，来访提出私下联系",
      "boundaryNotice": "…（crisis 才有非临床声明；boundary 可空）"
    }
  ]
}
```

### 4.2 取剧本开练
```
GET /counselor/drills/:drillId
```
响应：persona / setting / visitorPrompt / requiredPoints（只给 point 的 key+label，**不给关键词表**，防背答案）/ referenceResponse 不下发（开练前不展示）/ commonPitfalls 不下发。
- 找不到 / 不属于可练范围 → 404；无 token → 401。

### 4.3 提交回应并出判定
```
POST /counselor/drills/:drillId/respond
Body: { "submittedText": "…", "recordSeconds": 12 }
```
- `submittedText` 必填非空（空串 → 400，不伪造判定）；`recordSeconds` 可选（语音转写场景透传，不参与判定）。
- 响应即 §1.3 `DrillResponse`。
- **LLM 不可用/超时** → 走关键词确定性兜底，`source='keyword'`，照样返回完整结构，不报错、不伪造润色。

---

## 5. 物理隔离与合规测试（必须新增用例）

扩展 `test/counselor/crisis-practice-isolation.spec.ts`（或新建 drill 隔离 spec），锁死：
1. crisis 剧本文本 **0 命中** `VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS`；
2. crisis 剧本**无任何 3 位以上连续数字**（号码形态）；
3. crisis 剧本不出现在普通池 seed / 图鉴列表 / practice_scenarios 任何导出里；
4. 普通池官方人物 seed 基线自检仍通过；
5. boundary 剧本与 crisis 剧本分目录存放，列表接口按 track 过滤，crisis 不被 boundary 列表带出；
6. 所有剧本响应**无分数字段**（物理校验响应 schema 不含 score/grade/rating）。

---

## 6. 本期不做（边界，勿回流）

- 危机剧情场**只在显式选择 `drillTag=crisis_brief` 时注入**；普通场 / 未传标识零变化，**不做随机触发**、不混进普通随机池；
- 多轮分支拉扯、来访继续纠缠、nodes/branches 逻辑（专项拆解层字段预留，不实现）；
- 危机恶化/危险升级模拟、安全计划、干预步骤、风险评分阈值、具体热线号码；
- 深夜间歇期消息、长程卷宗联动；
- 练习历史落库、次数统计、回灌五维/六维能力画像（二期再评估，见 §7）；
- 评分排名、对错判定、星级；
- LLM 自由生成危机人物/剧本（本期全部静态录入，内容审核责任在录入方）。

---

## 7. 二期扩展预留（本期只留口子，不实现）

| 二期能力 | 本期预留点 |
|---|---|
| 多轮分支拉扯（来访被拒后继续提要求） | `nodes[] / branches[]` 字段已在模型中，响应加 `nextNode` 即可 |
| 深夜间歇期危机消息 | 新增 track `after_hours_message`，复用同一骨架与判定结构 |
| 更多 vpt 剧情场（边界临场/伦理两难内置） | `drillTag` 白名单可扩展，复用握手注入与报告标注链路 |
| 练习记录与能力画像回灌 | 届时再评估落库（可参考 `practice_attempts` 的 `ability_signal` 内部记账，仍不出参分数） |
| 伦理两难 / 反移情赛道 | 新增 track + 静态剧本，骨架零改动 |

---

## 8. 验收判据

1. `GET /counselor/drills?track=boundary` 返回 5 个 boundary 脚本元信息；`?track=crisis` 返回 2-3 个 crisis 脚本；交叉过滤不带出对方内容。
2. `GET /:drillId` 不下发关键词表/参考回应；`POST /:drillId/respond` 对三档各有一条确定性用例命中正确 verdict（boundary），crisis 返回 covered/missed 且 `verdict=null`。
3. LLM 关闭时关键词兜底仍返回完整 `DrillResponse`，`source='keyword'`，无 500、无伪造润色。
4. 响应全局无分数字段；crisis 隔离测试 6 条全绿；普通池基线不受污染。
5. 任务 D：握手 `drillTag=crisis_brief` 被解析透传，非法值/缺省丢弃且不断连；普通场（无 drillTag）persona 零变化；注入场复用 suicide_cue 实时提示，报告含"危机信号应对"覆盖点评；不出现恶化/方式细节/号码。
6. 现有 practice / vpt / crisis-meta 链路回归不红；未知新接口对旧客户端无副作用。

## 9. 本地自跑（后端执行）

- `npm test`：新增判定纯函数单测（三档各正例/反例、crisis 覆盖清单、空文本 400、隔离不变量）；现有 `test/voice`、crisis-isolation 回归不红。
- `npm run build` / `npm run lint` 通过；新增类型集中在 domain/drills，env 键进 `ProcessEnv`（若引入）避免 TS4111。
- 不新增 migration、不新增表；剧本走静态 config。

---

_时间戳：2026-10-27。两层同批：形态 2 专项拆解（任务 C/A）+ 形态 1 vpt 危机剧情场（任务 D）；多轮/深夜/落库/画像见 §7 二期预留。_
