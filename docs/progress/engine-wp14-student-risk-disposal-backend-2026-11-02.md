# WP14 · 学员心理风险处置层（三档分流 + 审计表 + 兜底修复）

> 日期：2026-11-02 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 性质：Phase1 合规硬底线——检测层已具备，本单补"检测到了之后怎么办"
> 状态：📋 待开工 ｜ 前置：WP11（PsyGUARD 服务）已交付；WP19-R（留痕链）在途不阻塞本单
> 🔴 **本单不改 `src/engine-core/**`**：内核只判定不拦截（边界已在），处置动作全在 adapter/wiring 层加。

---

## 0. 为什么有这条（现状实锤）

学员在 App 里扮演咨询师，对着 AI 来访做演练。实训中学员代入自身创伤、流露自伤意念是高频场景，平台有安全保障义务。但现状是：

| 审计点 | 现状 |
|---|---|
| 检测层 | ✅ 已具备。学员输入走 `assessSafety({ side: 'counselor_input' })`，探测器（LocalCrisisProbe / HttpPsyGuardProbe）两侧同判，11 类危机标签 + 本地词典已就位 |
| 处置层 | ❌ **整条缺失**。内核只把 verdict 交给 adapter，不拦截、不推学员、不记审计；`publishCrisisHint()` 只推督导 `supervision_hint` 帧，学员本人收不到任何东西 |
| PsyGUARD 兜底 | ❌ **D12 bug**。`createRiskProbe` 配了 baseUrl 就丢弃 fallback，服务挂掉时回落内核规则层——而 `COUNSELOR_RULES` 7 条全是专业越界、一条危机词都没有 → 学员危机检测能力归零 |

**关键边界（必须守住）**：
- `side=counselor_input`（学员输入）命中危机 → **学员侧处置**（toast / modal + 审计）
- `side=visitor_output`（AI 来访输出）命中危机 → **只推督导 `supervision_hint`**（WP9-C 已做，不动），不弹学员、不打断演练。因为学员练自杀危机干预剧本时，AI 来访会主动说"我不想活了"，这是演练内容，不能阻断。

---

## 1. 范围

### 1.1 三档处置层接线（本单核心）

在 adapter 层（`engine-stream-backend.adapter.ts` 或 turn-render 编排处）拿到 `SafetyVerdict` 后，按 `side` + `level` 分流：

| side | level | 动作 | WS 帧 |
|---|---|---|---|
| `counselor_input` | `pass` | 无感知，正常渲染 AI 回复 | 无 |
| `counselor_input` | `warn`（被动意念/自杀探索/自伤意念/自我攻击） | **不阻断**，AI 正常回复；同时推学员一条 toast | `{ type: 'crisis_toast', level: 'medium', category }` |
| `counselor_input` | `block`（主动意念/计划/准备/自伤行为/攻击他人） | **阻断本轮 AI 回复**（不调 RenderPort.render，不发 llm/tts 帧）；推学员全屏 modal | `{ type: 'crisis_modal', level: 'high', category, hotline: '12356', emergency: '120' }` |
| `visitor_output` | 任意 | 只推督导 `supervision_hint`（已做），学员侧无动作 | 无学员帧 |

**阻断逻辑细则（high）**：
- 本轮不渲染 AI 来访文本，不发流式 token、不发 TTS 帧
- 会话**不销毁**、不关闭；学员可后续恢复
- 会话状态记 `monitored=true`（本场后续每轮强制走 PsyGUARD，即使本地词典未命中）
- 写一条 `student_risk_events`（见 §1.2）

**toast 逻辑细则（medium）**：
- 不阻断渲染，AI 来访正常回复
- toast 是轻提示，前端 3 秒自动消失，不阻塞输入
- 写一条 `student_risk_events`，`action_taken='toast'`

### 1.2 `student_risk_events` 审计表（新建，append-only）

手写 migration（禁 synchronize），表结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | bigint PK auto_increment | |
| `session_id` | varchar(64) index | 关联训练会话 |
| `user_id` | bigint index | 学员 id（握手时已有） |
| `turn_index` | int | 触发轮次（从 1 起） |
| `level` | enum('low','medium','high') | 内测期实际只写 medium/high |
| `category` | varchar(64) | 命中类别（`passive_ideation` / `active_ideation` / …） |
| `snippet` | varchar(200) | 命中片段截断 200 字，不存全文 |
| `source` | enum('rule','psyguard','local_dict') | 判定来源 |
| `action_taken` | enum('silent','toast','modal') | 对用户采取的动作 |
| `user_choice` | enum(null,'phone','continue','dismissed') | 学员点 modal 后的选择（toast 事件为 null） |
| `monitored_after` | tinyint(1) | 本场后续是否进入重点监测 |
| `reviewed_by` | bigint null | 督导/admin 复核人 id（null=未复核） |
| `created_at` | datetime | 只此一个时间字段 |

**硬约束**：
- **不加 `updated_at`、不加 `deleted_at`**——审计表 append-only，只增不改不删
- **不暴露给学员 API**：学员端任何接口都不返回这张表的数据；只读端点只给 admin/督导（WP19-R 的 basic auth 口径）
- `snippet` 截断 200 字，不存完整对话原文（隐私最小化）

### 1.3 学员选择回写（crisis_resume 帧）

前端收到 `crisis_modal` 后，用户点两个按钮之一：
- "拨打 12356" → 前端自行 `tel:12356`，发 `{ type: 'crisis_resume', choice: 'phone' }`
- "我没事，继续练习" → 发 `{ type: 'crisis_resume', choice: 'continue' }`

后端收到后：
- 更新对应 `student_risk_events.user_choice`（注意：审计表只增不改——这里改成**新插一行 patch 记录**，还是允许 update？）
  - **拍板口径**：允许这一个字段 update（`user_choice`），其余字段永不改。在 entity 上标注 `@UpdateDateColumn` 不加，但 `user_choice` 是例外——因为它是用户主动反馈，不是审计篡改。
- 会话恢复（如果当时被阻断），`monitored_after=true` 已在首条事件写入
- 不重置 monitored 标志——本场后续一直重点监测

### 1.4 PsyGUARD 挂掉兜底修复（D12 bug）

**现状**（`engine.providers.ts:267-275`）：
```ts
const fallback = deps.fallback ?? new LocalCrisisProbe();
if (baseUrl) return new HttpPsyGuardProbe(...);  // fallback 被丢弃
```

**要修**：`HttpPsyGuardProbe` 内部在超时/异常时，**委托 LocalCrisisProbe 二次探测**，而不是让内核 catch 后回落规则层。
- 落点：`HttpPsyGuardProbe` 持有一个 `fallback: RiskProbePort`（LocalCrisisProbe 实例），probe() catch 后调 `this.fallback.probe(text, side)`
- `createRiskProbe` 工厂改成：配了 baseUrl 也把 fallback 传进 HttpPsyGuardProbe，不丢弃
- 修完后：PsyGUARD 服务停掉 → 学员输入"我想死"仍命中本地词典 block，不是静默归零

### 1.5 本地词典补词

在 `local-crisis.probe.ts` 的 `SUPPLEMENTARY_PATTERNS` 补 5–8 个**职业倦怠/耗竭**相关表达，全部进 `passive_ideation`（warn 级，只弹 toast 不阻断）：

```
'我怀疑自己适不适合干这行',
'做咨询越久越觉得没意义',
'我最近总是失眠，提不起劲',
'我好像耗竭了',
'有时候觉得熬不下去',
```

**不补 block 级词**——现有 block 级词（"我想死""我准备了安眠药""我割腕了"）表达本身就少且硬，已够。词典原则：**block 级全兜，warn 级能兜多少兜多少，不追求覆盖率**（宁漏勿误，误报代价是把正常训练判成危机轮）。

### 1.6 monitored_after 后续轮次收紧

high 事件后本场 `monitored=true`：
- 后续每轮强制走 PsyGUARD（即使本地词典未命中也发一次 HTTP 探测）
- **不调阈值**（内测期 PSYGUARD_LEVEL_MAP 不动）
- 不做"后续每轮都弹 toast"——只在新命中 warn/block 时才推帧
- 会话结束时把 monitored 标志写进报告 annotations

### 1.7 会后报告关联

WP18 报告 worker 生成报告时，查 `student_risk_events where session_id=?`：
- 有 high 事件 → 报告 annotations 加一条 `{ type: 'crisis_intervention', level: 'high', turnIndex, category }`
- 有 medium 事件但无 high → 报告 annotations 加一条 `{ type: 'crisis_toast', level: 'medium', turnIndex }`
- 报告不自动作废成绩，只标注，督导人工判断

---

## 2. 不做（红线）

| 不做 | 理由 |
|---|---|
| 不改 `src/engine-core/**` | 内核只判定不拦截，处置全在 adapter 层；`git diff --stat HEAD -- src/engine-core` 必须为空 |
| 不做学员侧大模型风险分类 | 规则 + PsyGUARD 已够内测 |
| 不做实时情绪追踪模型 / "低风险情绪倾诉"检测 | 需要情绪分类模型，Phase2 |
| 不调 PsyGUARD 阈值 / PSYGUARD_LEVEL_MAP | 内测期不动，靠真实误报反馈调 |
| 不自动作废成绩 / 锁账号 | 产品不替临床做判断，督导人工复核 |
| 不暴露 student_risk_events 给学员 API | 审计表只给 admin/督导 |
| 不动 visitor_output 侧处置 | 只推督导 supervision_hint（已做），不弹学员 |
| 不做 B 端督导工作台批量看审计 | 那是 WP19-R 交付后 admin-dashboard 切真 API 的事 |
| 不删/不改历史 student_risk_events | 除 `user_choice` 一个字段外全 append-only |
| 不做"低风险静默监测"记录 | low = pass = 无命中，不写表 |

---

## 3. 验收

| # | 验收条 | 通过标准 |
|---|---|---|
| 1 | 学员侧 high 阻断 | 学员发"我想死"→ 本轮无 AI 回复帧、无 TTS 帧；前端收到 `crisis_modal`；DB 有 `student_risk_events` 行 level=high、action_taken=modal |
| 2 | 学员侧 medium 不阻断 | 学员发"活着没意思"→ AI 正常流式回复；前端同时收到 `crisis_toast`；DB 有行 level=medium、action_taken=toast |
| 3 | AI 来访侧不弹学员 | AI 来访角色说"我不想活了"（自杀剧本演练）→ 学员侧无 toast/modal；督导侧收到 supervision_hint |
| 4 | PsyGUARD 挂掉兜底 | 停掉 PsyGUARD 容器 → 学员发"我想死"仍命中 block 推 modal；DB source=local_dict |
| 5 | 用户选择回写 | modal 弹出后发 `crisis_resume choice=continue` → 对应行 user_choice=continue；会话恢复，后续 monitored=true |
| 6 | 审计表约束 | 表无 updated_at/deleted_at；学员端 API 查不到这张表；snippet ≤ 200 字 |
| 7 | 词典补词 | "我好像耗竭了"命中 passive_ideation → 弹 toast 不阻断 |
| 8 | 报告关联 | 有 high 事件的会话，报告 annotations 含 crisis_intervention 条目 |
| 9 | 旧链路零变化 | `ENGINE_VOICE_ENABLED=false` 会话行为与本单前一致 |
| 10 | 新增单测 | 覆盖：high 阻断不渲染 / medium 不阻断推 toast / visitor_output 不推学员 / PsyGUARD 挂掉回落本地词典 / monitored=true 后续强制探测 |

**复跑闸门**（交付时贴实测数字）：
- `npx eslint "src/**/*.ts"` → 0 error
- `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- 新增测试套件全绿，engine-adapters + engine-core + voice 既有套件零回归
- `git show --stat <commit> -- src/engine-core` 为 0 文件

---

## 4. commit 文案

```
feat(engine): WP14 学员心理风险处置层——counselor_input 侧 warn 推 crisis_toast / block 阻断推 crisis_modal 并落 student_risk_events 审计表，PsyGUARD 挂掉回落 LocalCrisisProbe，补职业倦怠 warn 级词典
```

---

## 5. 一句话给后端

> 学员对着 AI 来访练着练着代入创伤说出"我想死"，现在系统只告诉督导、学员本人啥也收不到。本单补处置：学员输入侧 warn 推 toast 不阻断、block 阻断本轮 AI 回复推 modal 让他打 12356，落一张 append-only 的 student_risk_events 审计表；顺手修 PsyGUARD 挂掉时回落本地词典的 bug（现在是回落无危机词的规则层，检测归零）。内核一行不动，全在 adapter 层加。AI 来访自己说"我不想活了"那是演练自杀剧本，别弹学员，只推督导 hint。
