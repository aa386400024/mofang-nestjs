# WP44 交付记录 — 成长档案体系（对练数据入雷达 + 总览接口）

> 状态: ✅ 已交付
> 任务单: [wp44-growth-archive-basic-2026-11-06.md](wp44-growth-archive-basic-2026-11-06.md)
> 日期: 2026-11-06
> 红线: **engine-core 零改动**（git diff --stat HEAD -- src/engine-core = 空）
> 大炮拍板: ① 端点路径 → /counselor/growth/archive-overview + /counselor/growth/trend；② 重叠子指标 → **统一聚合器**（两边共用，含刷题 + 对练信号）

---

## 1. 开工前核实清单（任务单 §一・五，五条全部核实）

| # | 任务单要求 | 核实结果 | 证据 |
|---|---|---|---|
| 1 | ability_scores 只有 MCQ 刷题在写 | ✅ **确认** | 全仓 upsertScore 调用点只有两处：ability.service.ts（手动 upsert 端点）+ practice-ability-sync.service.ts（MCQ 回写）。**没有任何地方从对练写入** —— 雷达图是半成品的原因确认 |
| 2 | session_evaluations 有 empathy / openProbe / boundaryCross | ✅ **确认** | WP43 的 TechnicalScores = 9 维 + average，三项都在。⚠️ 但 boundaryCross 的**方向**要小心（见 §2.3） |
| 3 | supervision_reports 六维都在 SupervisionDimensions | ✅ **确认** | {empathy, activeListening, questioning, boundary, response, professionalism}，0-100；表列 dimensions 是 JSON 列，status 取 completed / parse_error |
| 4 | ability_dimensions 有那 5 个 code | ✅ **确认** | src/counselor/config/ability-dimension-presets.ts：skill_listening_accuracy / skill_empathy_precision / skill_questioning_openness / skill_boundary_awareness（基础技能）+ knowledge_ethics_mastery（专业知识） |
| 5 | engine-core 零改动 | ✅ **确认** | 开工前基线即 0 文件（WP43 已交付并提交）；收尾仍为 0 文件 / 0 行 |

**核实过程中撞出 2 个既有边界问题**（已按大炮拍板处理，见 §2.1 / §2.2）。

---

## 2. 关键设计决策

### 2.1 端点路径：任务单的 /counselor/profile/overview **已被占用** → 落到 /counselor/growth/

任务单 §2.4 写的 GET /counselor/profile/overview 在本仓**已存在**：CounselorProfileController.getOverview（我的 Tab：训练偏好 + 会员状态，Flutter 客户端在用）。同名不同义 = 两个端点抢一条路径 = 迟早漂。

按大炮拍板落到成长语义下：

| 任务单 §2.4 | 最终落地 |
|---|---|
| GET /counselor/profile/overview | **GET /counselor/growth/archive-overview** |
| GET /counselor/profile/trend | **GET /counselor/growth/trend** |

既有的 GET /counselor/growth/overview（成长 Tab 4 区块）**一字未动**，三个端点并存不冲突。

### 2.2 重叠子指标会**互相覆盖** → 统一聚合器（这是本单最关键的一处）

ability_scores 的唯一键是 (user_id, dimension_id) —— **物理上只有一行**。而：

- MCQ 刷题（practice-ability-sync）写 skill_empathy_precision / skill_listening_accuracy / skill_questioning_openness / skill_boundary_awareness
- 对练（本单）写**同样这 4 个** + knowledge_ethics_mastery

若两路各算各的均值再覆盖写，最终值取决于"**谁最后写**" → 用户刷新一次页面就可能变一次分（最不可信的一类 bug）。

**按大炮拍板**：抽出 ability-aggregate.service.ts 作为**唯一聚合器**，口径 = 该用户在某子指标上的**全部**信号合并取均值：

    刷题 attempt 信号 (practice_attempts.ability_signal)
      + 快评 信号 (session_evaluations 技术/伦理维度分)
      + 督导 信号 (supervision_reports 六维分)
      ────────────────────────────────────────────
      → 均值 0-100 → upsert ability_scores (覆盖写)

两路写出来的是**同一个数**，谁先谁后都一样 → 幂等、可重算。

practice-ability-sync 因此改为调用统一聚合器（删掉自己的 aggregateSignal / upsertScore）。**这是本单唯一一处改到既有成熟路径的地方**，行为差异见 §2.4。

### 2.3 ⚠️ boundaryCross 的方向：字段名带"越界"，值却是**越高越好**

任务单表格写 technicalScores.boundaryCross → skill_boundary_awareness，第一反应是"越界次数要翻转成 100 - 次数"。**但那会把方向搞反**：

WP43 的刻度是 boundaryScore(hits) = 100 - hits × 50 —— 0 次越界 = **100 分**，2 次越界 = 0 分。**这个字段的值本来就是"边界意识得分"（越高越好）**，不需要翻转。

再翻一次会变成"0 次越界记 0 分、越界 2 次记 100 分" —— 正好反过来。

> 这条是**写测试时自己逮到的**（第一版实现按直觉加了翻转，测试断言"越界 0 次 → 100 分"直接变红）。
> 教训：**字段名带"坏事件"不代表值是坏方向** —— 方向要看刻度，不能看名字。
> （与 WP43 的"阻抗方向"是同一类错误，同一条防线。）

### 2.4 practice-ability-sync 的行为差异（统一聚合器的直接后果）

| 项 | 改前 | 改后 |
|---|---|---|
| 聚合口径 | 只算**刷题**信号 | **刷题 + 快评 + 督导**三来源合并 |
| evidence | 往旧值后面**追加** attemptId | **全量替换**为该子指标当前全部来源 id（去重 + 最近 20 条） |
| 子指标不存在 | 提前 return，**不写** attempt 行 | 先写 attempt 行（记账），聚合时返回 synced: false |

第三行是唯一的行为差异，且是**更正确**的：信号是"这次作答在这个技能上的强度"，属不属于雷达是**雷达表**的事，不该让记账跟着雷达表缺失而丢。

### 2.5 督导报告取数：仓储**刻意没有** by-user 出口 → 走既有范式

SupervisionReportRepository 的接口注释明确写着"不给仓储加按 userId 查的新方法：报告行的归属靠 tenant 隔离 + sessionId 白名单"。本单因此**不改 agent 侧仓储**，改走既有范式（跟 training-session.service.ts 的列表聚合同款）：

    training_sessions (按 user_id) → 拿 id + tenantId → reportRepo.findBySessionIds(tenantId, ids) (分片 200)

单人产品阶段量级是"几十场"，一次批量查完。**真到了千场级再补仓储出口**（登记在 §6）。

### 2.6 数值防御：督导六维是 **LLM 解析出来的**

supervision_reports.dimensions 是 JSON 列，内容来自 LLM 输出解析 —— 字段可能缺、可能不是数字。直接解引用参与均值 → NaN 污染整条雷达线，且 **NaN 会静默传播**（最难查的一类 bug）。

所以映射表里每处取值都过一道 scoreOrNull（有限数校验），缺项当"**没有这项信号**"（不是 0 分）。另外 parse_error 状态的报告整行跳过。

### 2.7 趋势按**本地日期**分组

created_at 是 DATETIME 列，库里存的就是服务器本地时间；转成 UTC 再取日期会让"今天练的"落到昨天 —— 趋势图上最容易被用户发现的小错。取日期用本地年月日。

### 2.8 "没有数据"返 null，不返 0

总分 0 和"一场都没练过"是两件事。用 0 表达"没数据"等于凭空造一个"我练了 0 分"的结论（同 WP43 空场次口径）。

---

## 3. 实际改了哪些文件

### 3.1 新增（6）

| 文件 | 改了什么 |
|---|---|
| src/counselor/config/session-ability-mapping.ts | **映射表**（纯常量 + 纯函数）：5 个子指标 × {快评来源, 督导来源}；含 scoreOrNull 数值防御 |
| src/counselor/providers/ability-aggregate.service.ts | **统一聚合器**：一次装载三来源信号 → 按子指标取均值 → upsert ability_scores（覆盖写，幂等） |
| src/counselor/providers/session-ability-sync.service.ts | 对练回写入口：5 个可喂养子指标逐个同步；失败只记 warn 不抛 |
| src/counselor/providers/growth-archive.service.ts | 读取侧：总览卡片 + 趋势曲线（按天分组）+ 打开页时触发同步 |
| src/counselor/dto/growth-archive.dto.ts | 出参契约 + 趋势查询入参（days 默认 30 / 上限 365） |
| test/counselor/wp44-growth-archive.spec.ts | **18 例**（映射口径 4 / 统一聚合 5 / 回写入口 2 / 读取侧 4 / 端点契约 3） |

### 3.2 改动（3）

| 文件 | 改了什么 |
|---|---|
| src/counselor/controllers/counselor-growth.controller.ts | 加 2 个端点（archive-overview / trend）；既有 overview 一字未动 |
| src/counselor/providers/practice-ability-sync.service.ts | 改走**统一聚合器**（删掉自己的聚合与 upsert，行为差异见 §2.4） |
| src/counselor/counselor.module.ts | providers 加 3 个（聚合器 / 对练回写 / 档案读取） |

### 3.3 迁移

**无**。本单**不加表不加列** —— 能力信号全部从既有 JSON 列（session_evaluations.technical_scores / ethics_scores / supervision_reports.dimensions / practice_attempts.ability_signal）现读现算（任务单 §2.1）。

---

## 4. 闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | npx eslint "{src,test,bin}/**/*.ts" | **0 problem**（0 error / 0 warning） |
| 类型 | npx tsc -p tsconfig.build.json --noEmit | **0 error** |
| 单测 | npx vitest run test/counselor/wp44-growth-archive.spec.ts | **18 例全绿** |
| 全量 | npx vitest run --exclude "**/e2e/**/*.ts" | **122 文件 / 2062 例全绿** |
| 内核红线 | git diff --stat HEAD -- src/engine-core | **空（0 文件 / 0 行）** |

---

## 5. 前端对接契约（最终路径）

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| /counselor/growth/archive-overview | GET | JWT | 成长档案总览卡片；**会顺带把对练数据同步进能力雷达**（幂等） |
| /counselor/growth/trend?days=30 | GET | JWT | 趋势曲线（按天）；days 默认 30、上限 365 |

总览响应体字段：totalSessions / avgOverallScore / latestScore / highestScore / averageByCategory {technical, bdiDelta, ethics} / crisisCount。

趋势响应体：points 数组，元素为 {date, overall, technical, bdiDelta, ethics}。

**没有数据的日期不出点**（不补 0）；没有评估时总览的分数字段返 null。

雷达图本身仍走既有的 GET /counselor/ability/profile（读 ability_scores）—— 本单把它的**数据源**接上了，没动它的接口。

---

## 6. 未做 / 后续

1. **只有 5 个子指标接了数据** —— 26 个里的语音 4 / 习惯 4 / 错误 3 / 备考 4 / 游戏化 3 没有对练信号，硬映射就是造噪声（任务单 §三已拍板）。
2. **千场级要补仓储出口** —— 现在督导报告走 training_sessions + findBySessionIds 分片查；到千场要改成直接按 user 查（§2.5）。
3. **快评信号有"天花板"** —— technicalScores.empathy 是"次数 × 25 封顶 100"，所以一场里共情 4 次就满分；跨场合并均值时这是**偏置**（共情多的场次贡献更大）。要更准的"共情占比"口径需要快评侧再加一列计数 —— 归 WP45 类的技术债，本单不动。
4. **趋势按天**（任务单 §五 建议）；按周聚合留给前端按需处理。
5. **同步在读取时触发**（任务单 §三 拍板）—— 不是后台定时。所以"用户从不打开档案页 → 雷达永远不更新"。这是有意的（被动、零额外成本），但要知道这个前提。
