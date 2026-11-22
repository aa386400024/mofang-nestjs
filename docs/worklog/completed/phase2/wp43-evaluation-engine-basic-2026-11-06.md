# WP43 · 评估引擎基础版（规则引擎快速评分）

> 状态: ✅ 已交付（2026-11-06）→ [`engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md`](engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md)
> 日期：2026-11-06
> 范围：旁路异步消费 BDI 快照 + 对话 + 伦理标签，输出基础技术维度评分 + 伦理维度评分
> 边界：engine-core **零改动**（纯消费内核出参，不碰内核）

---

## 一、背景

### 1.1 现状

现在咨询师训练完，要等 supervisor 督导报告（LLM 生成，30-120s）才能看到评分。问题：

- **慢**：用户训练完要等半分钟到两分钟才能看到反馈
- **贵**：LLM 调用成本高
- **基础维度缺失**：没有"快速版"评分——比如"你这一场说了几次共情、几次评判、有没有越界"这些基础数据，现在完全没有

### 1.2 目标

做一套**规则引擎评估器**：
- **快速**：毫秒级，会话结束后立刻出分
- **便宜**：不用 LLM，纯规则计算
- **基础**：技术维度（共情/评判/边界/提问方式等）+ 伦理维度（crisis 检测/安全标签）
- **互补**：和 supervisor 督导报告互补——WP43 是基础快速版，supervisor 是深度版（LLM 督导）

---

## 一·五、开工前核实清单（必须先 grep 确认，再写代码）

**动手前先扫一遍代码，确认下面这些边界，别造双胞胎：**

1. **核实 techStats 技术统计**（`training_sessions.tech_stats` 列）
   - 它是"技术手法分类"（reflection / paraphrase / summary / confrontation 等）—— 中性描述
   - WP43 的 eventTags 是"行为效果分类"（empathy / judgment / boundary_cross 等）—— 带评价
   - **确认：两者维度不一样，不重复造轮子**

2. **核实 supervisor 六维评分**（`src/agent/supervisor/`）
   - 它是 LLM 综合打分（0-100，考虑语境）—— 深度版，慢（30-120s）
   - WP43 的 eventTags 统计是规则计数（只数次数）—— 快速版，毫秒级
   - **确认：两者粒度不一样，是互补关系，不是替代**

3. **核实数据来源**
   - WP43 的输入是**内核出参**（每轮 `EngineTurnOutput.snapshot` / `events` / `safety`）
   - **不是** `turn_debug_trace` 留痕快照 —— 留痕是调试能力（`ENGINE_DEBUG_TRACE_ENABLED`，prod 缺省关）
   - **确认：WP43 不依赖留痕开关，prod 必须能跑**

4. **核实 engine-core 零改动**
   - WP43 纯消费内核出参，不碰内核
   - **确认：`git diff --stat HEAD -- src/engine-core` 应该是 0 文件**

5. **核实 crisis 检测数据**
   - 内核每轮输出 `EngineTurnOutput.safety`（SafetyVerdict）
   - **确认：crisis 触发次数从 safety 判定里统计，不是另写一套检测**

---

## 二、要做的事

### 2.1 评估引擎核心

**输入（来源：内核出参，不依赖留痕开关）：**
- BDI 快照（每轮 `EngineTurnOutput.snapshot`：信任/安全感/纽带/情绪/阻抗等）
- 内核事件分类（每轮 `EngineTurnOutput.events`：empathy / judgment / boundary_cross 等）
- 安全判定（每轮 `EngineTurnOutput.safety`：crisis 检测结果、安全标签）

**⚠️ 重要边界：**
- 数据来源是**内核出参**（每轮都在算），不是 `turn_debug_trace` 留痕快照
- **不依赖 `ENGINE_DEBUG_TRACE_ENABLED` 开关**——留痕是调试能力（prod 缺省关），WP43 是业务能力（prod 必须开）
- 会话结束时，直接从内存里的内核状态取这些数据，然后算评分落库

**输出：**

| 维度类别 | 维度名 | 计算方式 |
|---|---|---|
| **技术维度** | 共情回应次数 | eventTags 里 `empathy` 的出现次数 |
| | 开放提问次数 | eventTags 里 `open_probe` 的出现次数 |
| | 评判次数 | eventTags 里 `judgment` 的出现次数（扣分） |
| | 说教次数 | eventTags 里 `preaching` 的出现次数（扣分） |
| | 淡化次数 | eventTags 里 `minimizing` 的出现次数（扣分） |
| | 边界越界次数 | eventTags 里 `boundary_cross` 的出现次数（严重扣分） |
| | 正常化回应次数 | eventTags 里 `normalization` 的出现次数 |
| | 接纳回应次数 | eventTags 里 `acceptance` 的出现次数 |
| | 肯定回应次数 | eventTags 里 `affirmation` 的出现次数 |
| **BDI 变化维度** | 信任提升幅度 | 最后一轮 trust - 第一轮 trust |
| | 安全感提升幅度 | 最后一轮 safety - 第一轮 safety |
| | 阻抗变化 | 最后一轮 resistance - 第一轮 resistance |
| | 情绪变化 | 最后一轮 valence - 第一轮 valence |
| **伦理维度** | crisis 触发次数 | 对话中 crisis 检测触发了几次 |
| | 安全标签 | 整体安全评级（safe / warning / danger） |

**评分公式：**
- 每个维度 0-100 分
- 正向维度（共情/开放提问/接纳/肯定）：次数越多分越高（上限封顶）
- 负向维度（评判/说教/淡化/边界越界）：次数越多分越低（0 次满分，出现就扣分）
- 总分 = 技术维度平均分 × 0.6 + BDI 变化维度平均分 × 0.2 + 伦理维度分 × 0.2

### 2.2 旁路异步执行

- 会话结束后（`closeSession` 或最后一轮），异步触发评估
- 不阻塞主流程——用户发完最后一条消息，立刻看到来访回复，评估在后台跑
- 评估结果落库（`session_evaluations` 新表）

### 2.3 数据模型

新表 `session_evaluations`：
- `id` / `session_id` / `user_id`
- `overall_score`（总分 0-100）
- `technical_scores`（JSON：技术维度各维度分）
- `bdi_delta_scores`（JSON：BDI 变化各维度分）
- `ethics_scores`（JSON：伦理维度各维度分）
- `raw_stats`（JSON：原始统计数据，供调试/回溯）
- `created_at`

### 2.4 接口

- `GET /counselor/sessions/:sessionId/evaluation` —— 查某场会话的评估结果
- `GET /counselor/users/me/evaluations` —— 查我的历史评估列表（分页）

---

## 三、设计决策

**Q：为什么不直接用 supervisor 督导报告？**
A：supervisor 是 LLM 生成的，深度但慢（30-120s）且贵。WP43 是规则引擎快速版——毫秒级、零成本、基础维度。两者互补：用户训练完立刻看到基础评分（WP43），深度督导报告稍后异步出来（supervisor）。

**Q：为什么是旁路异步？**
A：评估不能阻塞主流程——用户发完最后一条消息，要立刻看到来访回复。评估在后台跑，跑完落库，用户刷新就能看到。

**Q：engine-core 要改吗？**
A：零改动。评估引擎纯消费内核出参（BDI 快照 + eventTags + 对话记录），不碰内核。

---

## 四、闸门数字

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 0 文件（零改动）
```

---

## 五、待确认问题

1. **评分公式权重**：技术维度 0.6 + BDI 变化 0.2 + 伦理 0.2 —— 这个权重合理吗？还是伦理应该占更高权重？
2. **触发时机**：会话结束时自动触发？还是用户手动点"生成评估"？建议自动触发——用户无感。
3. **前端展示**：评估结果的前端展示归前端 AI，后端只出接口。

---

_任务单已交付（2026-11-06）。交付记录：[`engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md`](engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md)。_

_⚠️ 两处落地偏差（已在交付记录 §3.9 写明理由）：① 接口最终路径是 `GET /counselor/training-sessions/:sessionId/evaluation` + `GET /counselor/evaluations`（任务单写的 `/counselor/sessions/*` 与 `/counselor/users/me/*` 在本仓不存在范式）；② 任务单 §2.4 表格的"阻抗变化"方向反了，实现取反向口径（阻抗下降 = 分高）。_
