# WP-D 模拟咨询师 AI + 自动对练

> **路径**：`docs/worklog/completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-08.md`
> **状态**：✅ 已交付（[交付记录](phase2.5-wp-d-auto-practice-2026-11-08-implementation.md)）
> **优先级**：🟡 P1
> **创建日期**：2026-11-08
> **交付日期**：2026-11-08
> **总览**：[§Phase2.5 总览](../pending/phase2.5-overview-2026-11-08.md)
> **登记表**：[§WP 登记表](../pending/phase2.5-wp-list-2026-11-08.md)
> **依赖**：WP-A ✅（审议输入最小化）；WP-C（触发式闸门）可并行，不阻塞本单

---

## 一、背景

### 1.1 现在是什么状态

admin-dashboard 的 DebugChat 页面已经能调试引擎：
- 人选一个来访者角色（AI 扮演）
- 人手动输入咨询师的话
- AI 来访者回应，右边实时看 BDI 状态、trace、审议详情

但这个模式有个根本限制：**必须有人一直盯着手动打字**。一场 20 轮的对练，人要输入 20 次，跑完要 10-20 分钟。想跑 30 场？不可能。

### 1.2 问题是什么

Phase2.5 的出口条件④（审议建议准确率≥80%）和⑤（1000+ 场自动对练数据）都需要**批量跑对练**。现在的手动调试模式跑不了批量。

具体来说：
- 没有 AI 自动当咨询师的能力——咨询师的话只能人输入
- 没有批量跑的机制——不能一次配 30 场让它自己跑
- 没有自动评测——跑完一场后，要人工看对话判断质量

### 1.3 为什么这个是最优解

咱们的场景是"验证引擎质量"，不是"训练一个好咨询师"。所以：
- AI 咨询师不需要是最好的——它需要**覆盖各种水平**（专家/新手/胡说八道），这样才能测试引擎在不同输入下的反应
- 自动对练跑出来的数据，直接喂给 WP-E 做自动评测
- 跑通管线后，后面扩角色、扩模式都是配置层面的事，不用改代码

---

## 二、目标

### 2.1 本单要做什么

**建一个自动对练模块：AI 咨询师 + AI 来访者自动跑完整场对练，支持单场实时看和批量跑。**

具体来说：
1. **CounselorMode 表**——7 种咨询师行为模式（专家/中级/新手/聊家常/冷漠/说教/胡说八道），存数据库，admin 可 CRUD
2. **counselor-agent.service**——按 CounselorMode 配置生成咨询师回应（LLM 调用）
3. **practice-runner.service**——对话循环：咨询师说一句 → 走引擎管道 → 来访者回应 → 走引擎管道 → 交替
4. **practice-queue.service**——BullMQ 批量队列，并发限 3
5. **auto-practice.gateway.ts**——WebSocket 实时推每轮对话到前端
6. **PracticeSession 表**——记录每场自动对练的元信息（角色/模式/轮数/状态/成本）
7. **visitors.jsonl 角色导入**——把 11 个案例角色（含危机/未成年/成瘾）导入来访者池
8. **前端 DebugChat 加自动对练入口**——选角色+选模式+点开始，实时看对话跑
9. **前端 AutoPractice 页面**——批量配置+进度+报告

### 2.2 本单不做什么（边界）

| 不做的 | 为什么 | 什么时候做 |
|---|---|---|
| 自动评测（rubric 断言评判） | WP-E 的事 | WP-E |
| 可复现性（版本锁定/seed） | WP-B 的事，本单预留字段即可 | WP-B |
| 触发式审议闸门 | WP-C 的事，本单先按现有审议逻辑跑 | WP-C |
| engine-core 改代码 | 自动对练是适配层能力，内核不动 | —— |
| 真实用户端（Flutter）的自动对练 | 这是 admin 内部工具，不面向真实用户 | —— |
| 危机场景的完整安全计划流程 | 本单先标记 crisis_ended，不做完整流程 | 后续按需 |

### 2.3 方案调整权

开发过程中，如果后端发现更合理、更专业的实现方案，可以按后端的来，不用死磕任务单。但要在交付记录里写明偏差和理由——不是闷头改，是改了要说明为什么、改了什么、效果有什么不同。

---

## 三、方案设计

### 3.1 核心思路：复用现有引擎管道，只加"AI 咨询师"这一层

**⚠️ 先明确：项目里有两套并行对话系统，自动对练走新版引擎链路。**

| | 旧版链路（voice） | 新版链路（engine） |
|---|---|---|
| **入口** | `VoiceService.onUserText()` | `DebugSessionService.turn()` |
| **来访者生成** | `agent/visitor/visitor.service.ts` | `EngineTurnService` → engine-core + engine-adapters |
| **状态管理** | 只有 emotionBaseline | 完整 BDI（信念/欲望/意图/同盟三维/情绪） |
| **用在哪** | Flutter App 真实用户语音对练 | admin 调试面板 |
| **自动对练走哪套** | ❌ 不走 | ✅ 走这套 |

**为什么走新版：** WP-D 的目的是测试 BDI 引擎质量（状态变化是否合理、审议是否准确），旧版链路没有 BDI 状态，跑出来的数据对调试引擎没帮助。

---

**现在的手动调试管道：**
```
人输入咨询师的话
  → debug-session.service 处理（BDI 更新 + 审议 + PsyGUARD）
  → EngineTurnService 生成 AI 来访者回应（走完整 BDI 引擎）
  → 前端显示
```

**自动对练管道：**
```
counselor-agent 生成咨询师的话
  → debug-session.service 处理（跟手动输入走同一个管道）
  → EngineTurnService 生成 AI 来访者回应（跟手动调试用同一个 service）
  → WebSocket 推前端
  → 循环
```

**关键：不新写一套对话循环。** 自动对练只是把"人输入咨询师的话"换成"counselor-agent 生成咨询师的话"，后面的引擎处理完全复用现有逻辑。这样引擎行为跟真实场景一致。

### 3.2 CounselorMode 设计

7 种模式，存数据库表：

| mode | system prompt 要点 | 技术倾向 |
|---|---|---|
| `expert` | 你是成熟咨询师，稳定中立，用开放式提问和反映感受，不评判不给建议 | empathy / open_probe 为主 |
| `intermediate` | 你是有几十小时经验的咨询师，基本中立但偶尔跑偏 | open_probe 为主，偶尔 preaching |
| `novice` | 你是刚入行的新手，容易评判来访者，喜欢给建议，共情少 | judgment / preaching 为主 |
| `chatty` | 你像朋友一样聊天，不给咨询框架，聊生活聊家常 | 无技术倾向，自然对话 |
| `cold` | 你很简短冷淡，每次就两三个字回应，不展开 | 无技术倾向，极简回应 |
| `preachy` | 你喜欢长篇大论讲道理，灌心理学知识 | preaching 为主 |
| `nonsense` | 你回应跟来访者说的不相关，或者乱扯别的话题 | 无技术倾向，跑题 |

**为什么存数据库而不是写死在代码里：**
- 后面加新模式（比如"醉汉型""杠精型"）不用改代码
- admin 后台可以调 system prompt，不用发版
- 跟 visitor_pool_templates 的内容治理范式一致

### 3.3 对话循环（practice-runner.service）

```
启动一场自动对练：
  1. 选来访者角色（从 visitor_pool_templates）
  2. 选咨询师模式（从 counselor_modes）
  3. 初始化 session（跟手动调试的 session 同格式）
  4. 循环：
     a. counselor-agent 生成咨询师回应（按 mode 的 system prompt）
     b. 把咨询师回应喂给 debug-session.service（走完整引擎管道：BDI 更新 + 审议 + PsyGUARD）
     c. EngineTurnService 生成来访者回应（跟手动调试用同一个引擎）
     d. WebSocket 推每轮对话 + BDI 状态到前端
     e. 检查结束条件
  5. 结束后标记 session 状态
```

**结束条件（任一满足即停）：**
- 达到 maxTurns（默认 30，可配）
- 来访者主动说"今天就到这吧"（LLM 判断）
- PsyGUARD 触发高风险（标记 `crisis_ended`）
- 连续 3 轮 BDI 三维无变化（对话陷入僵局）

### 3.4 批量模式（practice-queue.service）

- 用 BullMQ 队列（项目已有）
- 并发限 3，不打爆 LLM rate limit
- 批量配置：选 N 个角色 × M 个模式 × 重复 K 次
- 后台跑，不阻塞前端
- 前端能看进度（已完成 X / 总数 Y）

### 3.5 前端设计

**DebugChat 页面改动：**
- 加一个"模式切换"：手动调试 / AI 自动对练
- 选"AI 自动对练"后：
  - 选来访者角色（下拉）
  - 选咨询师模式（下拉）
  - 点"开始自动对练"
  - 对话区域实时显示每轮对话（跟手动调试一样的渲染）
  - 右边 BDI 状态实时更新
  - 每轮之间显示"AI 咨询师正在思考..."loading

**AutoPractice 新页面：**
- 批量配置：选角色（多选）× 选模式（多选）× 重复次数
- 启动后显示进度条
- 跑完后显示统计：各模式通过率、BDI 曲线对比、成本

### 3.6 角色导入（visitors.jsonl → visitor_pool_templates）

把 `docs/reference/psych-dataset/dataset/visitors.jsonl` 的 11 个角色导入数据库：
- 每个角色的 demographics / chief_complaint / opening_line → 角色基本信息
- speech.register / fillers / avoidance / signature_quotes → 说话方式
- emotion_baseline → 情绪基线
- resistance_patterns → 阻抗模式
- risk_triggers / boundaries → 风险与边界

**注意：** 现有 6 个 vpt 角色保留不动，新角色追加进去。

### 3.7 解耦与微服务预留

现在不做微服务，但 auto-practice 模块的设计要考虑后期能整个拎出去当独立服务跑。

**设计原则：**
- **模块内部自成体系**：对话循环、队列、评测逻辑都在 `src/auto-practice/` 内部，不跟 admin-debug、visitor.service 紧耦合
- **外部依赖走接口/端口**：LLM 客户端、数据库、WebSocket 这些外部依赖，通过端口（Port）接口注入，不直接 import 具体实现
- **后期抽服务只换实现**：把 auto-practice 拆成独立服务时，只换外部依赖的实现（比如数据库连接、LLM 调用方式），模块内部代码一行不动

**具体做法：**
- counselor-agent.service 不直接调 LLM client，而是定义一个 `CounselorLlmPort` 接口，由外部注入实现
- practice-runner.service 不直接 import debug-session.service，而是定义一个 `TurnEnginePort` 接口，接收"咨询师说一句话 → 返回来访者回应"的能力
- 数据库表用独立前缀（`ap_` 开头），跟现有表物理隔离
- 配置项（maxTurns、并发数、队列名）都走 env / config service，不写死在代码里

---

## 四、交付物

| # | 交付物 | 说明 |
|---|---|---|
| 1 | `counselor-mode.entity.ts` | 咨询师模式表 entity |
| 2 | `practice-session.entity.ts` | 自动对练场次表 entity |
| 3 | `counselor-modes.seed.ts` | 7 种模式初始数据 seed |
| 4 | `counselor-agent.service.ts` | AI 咨询师生成服务 |
| 5 | `practice-runner.service.ts` | 对话循环核心 |
| 6 | `practice-queue.service.ts` | BullMQ 批量队列 |
| 7 | `auto-practice.controller.ts` | REST API（启动/查询/取消） |
| 8 | `auto-practice.gateway.ts` | WebSocket 实时推送 |
| 9 | `visitors-import.seed.ts` | visitors.jsonl 11 角色导入脚本 |
| 10 | DebugChat.vue 改动 | 加自动对练模式切换 |
| 11 | AutoPractice.vue 新页面 | 批量配置+进度+报告 |
| 12 | migration | 两张新表的 DDL |
| 13 | 交付记录 | 实现记录+偏差说明 |

---

## 五、闸门（验收标准）

### 5.1 功能闸门

| # | 验收项 | 可判定标准 |
|---|---|---|
| 1 | 单场自动对练能跑通 | 选角色+选模式，点开始，能自动跑完 10 轮以上，对话正常 |
| 2 | WebSocket 实时推送 | 每轮对话出来后，前端 DebugChat 实时显示，不用刷新 |
| 3 | BDI 状态实时更新 | 每轮跑完后，右边 BDI 数值变化 |
| 4 | 批量队列能跑 | 配 5 场批量，后台自动跑完，进度正确 |
| 5 | 7 种模式都能选 | 每种模式生成的咨询师回应风格确实不同（专家共情多，新手评判多） |
| 6 | 结束条件正常 | 到 maxTurns 自动停；触发危机标记 crisis_ended |
| 7 | 手动调试不受影响 | 自动对练跑完后，切回手动调试模式，功能正常 |
| 8 | visitors.jsonl 角色导入成功 | 11 个新角色出现在角色选择列表里 |

### 5.2 工程闸门

| # | 验收项 | 标准 |
|---|---|---|
| 1 | tsc 零 error | `npx tsc --noEmit` 0 error |
| 2 | 全量测试全绿 | `npx vitest run` 0 failed |
| 3 | eslint 零 error | `npx eslint .` 0 error |
| 4 | boundary.spec.ts 全绿 | engine-core 边界断言全绿 |
| 5 | engine-core 零改动 | `git diff --stat HEAD -- src/engine-core` 为空 |

---

## 六、边界（红线）

### 6.1 engine-core 纯层红线
- ❌ 不改 `src/engine-core/` 下任何文件
- ✅ 所有改动都在 `src/auto-practice/` 和 `src/admin-debug/` 下
- ✅ 自动对练复用现有 turn 管道，不新写引擎逻辑

### 6.2 不干扰手动调试
- ❌ 不改现有 DebugChat 手动调试的逻辑
- ✅ 自动对练是新增模式，跟手动调试并列，不互相影响
- ✅ session 表加 `practice_type` 字段区分（manual / auto）

### 6.3 合规红线
- ❌ 自动对练的对话原文不进普通日志
- ✅ 心理数据不出境（LLM 调用走现有 MiniMax 国内通道）
- ✅ 危机角色触发高风险时，标记 crisis_ended，不继续跑

---

## 七、转述话术

> 复制下面这段，开新会话给后端：
>
> ---
>
> 现在做 Phase2.5 的 WP-D：**模拟咨询师 AI + 自动对练**。
>
> 任务单在 `docs/worklog/pending/phase2.5-wp-d-auto-practice-2026-11-08.md`，先读它。
>
> 背景：现在 DebugChat 是人手动当咨询师，AI 当来访者。要做 AI 自动当咨询师，两边都是 AI，自动跑完整场对练。这样才能批量跑 30+ 场，积累数据验证引擎质量。
>
> 核心思路：
> - 不新写对话循环，复用现有 debug-session 管道
> - AI 咨询师只是把"人输入"换成"LLM 生成"，后面的引擎处理完全一样
> - 7 种咨询师模式（专家/中级/新手/聊家常/冷漠/说教/胡说八道）存数据库，不写死
> - 支持单场实时看（WebSocket 推前端）+ 批量跑（BullMQ 队列）
> - visitors.jsonl 的 11 个角色导入来访者池
>
> 边界：
> - engine-core 纯层一行不动
> - 不干扰现有手动调试模式，自动对练是新增并列模式
> - 自动评测（rubric 断言）是 WP-E 的事，本单不做
> - 可复现性是 WP-B 的事，本单预留字段即可
>
> 做完写交付记录，放 `docs/worklog/completed/phase2.5/` 下。
>
> 如果开发期间发现更合理更专业的方案，可以按后端的来，但要在交付记录里写明偏差和理由。
>
> ---
