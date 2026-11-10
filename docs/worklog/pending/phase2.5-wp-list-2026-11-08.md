# Phase2.5 灰度验证期 · WP 登记表

> **路径**：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
> **总览**：[§Phase2.5 总览](phase2.5-overview-2026-11-08.md)
> **状态**：✅ Phase2.5 WP-A/C/D/E/F/G/H 已交付（H 三波全）· 🚧 WP-B 部分完成（engine_version + prompt_version 均已落库，考核场景纯规则待核实）· WP 清单（8 条）见下表 · 独立单 8 条（闸门 trace · 标注工具前后端 · P1b 危机指标 · P2 来访者质量 v1 基线 · 路线1 三处结构修复 · P1c 路线1 效果验证 · P1d 接线修复已交付 · verbal_voice 文案待审）
> **最近核对**：2026-11-10 17:20（代码与数据库实查，不采信历史状态行）
> **创建日期**：2026-11-08

---

## 一、WP 清单（7 条）

| WP | 名称 | 优先级 | 一句话描述 | 状态 |
|---|---|---|---|---|
| **WP-A** | 审议输入最小化（合规 + 成本双解决） | 🔴 P0 | 审议不传对话原文，只传结构化事件分类 + 状态对比 + 角色简述；高风险轮次永远走本地规则 | ✅ 已交付 → [`交付记录`](../completed/phase2.5/phase2.5-wp-a-deliberation-input-minimization-implementation-2026-11-08.md) |
| **WP-B** | 可复现控制 + 版本锁定 | 🔴 P0 | 考核场景永远走纯规则模式；模型版本 / prompt 版本记录到 trace 里，为效果对比和问题追溯服务 | 🚧 **部分完成**：`engine_version`（`git describe --dirty`）与 **`prompt_version`（关键 prompt 模板文件 sha256 前 16 位）均已落库**到 `ap_practice_batches` / `ap_practice_sessions`，并出现在批次详情 API 与逐字稿索引里 → [交付记录](../completed/phase2.5/wp-j-wp-b-prompt-version-and-test-cleanup-implementation-2026-11-10.md)；**考核场景纯规则待核实**（本单未动） |
| **WP-C** | 触发式审议闸门 | 🟡 P1 | 状态变化幅度大才跑审议，平静时不跑；高风险永远不跑；预期成本降 90% | ✅ 已交付 → [`交付记录`](../completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate-implementation-2026-11-09.md)；[任务单](../completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate.md) |
| **WP-D** | 模拟咨询师 AI + 自动对练 | 🟡 P1 | 用一万份个案逐字稿（附督导解析）训练模拟咨询师 AI；自动跑几千场对练，积累数据集 | ✅ 已交付 → [`交付记录`](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-08-implementation.md)；2026-11-09 全量实测 → [`测试报告`](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-09-test-report.md) · [`修复任务单`](phase2.5-wp-d-auto-practice-2026-11-09-fix-list.md) |
| **WP-E** | 自动评测 + 参数调优 | 🟡 P1 | 用督导解析当 ground truth，自动评测审议建议准确率；调到 ≥80% 达标 | ✅ 已交付 → [`交付记录`](../completed/phase2.5/phase2.5-wp-e-auto-evaluation-implementation-2026-11-09.md)；[任务单](../completed/phase2.5/phase2.5-wp-e-auto-evaluation-tuning.md) |
| **WP-F** | 成本看板合并数据源（正式训练 + 自动对练） | 🟡 P1 | 自动对练的 token / 成本落库（人民币元，同一张定价表）；成本看板合并两张表，按来源区分 | ✅ 已交付 → [`交付记录`](../completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources-implementation-2026-11-09.md)；[任务单](../completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources.md) |
| **WP-G** | 自动对练对话质量修复 | 🟡 P1 | 咨询师兜底话术池（去单句复读）+ 咨询师复读检测 + 语义近重复判定（调低停滞漏判）+ 危机应对协议 + 渲染层 prompt 硬约束（禁止重复句式 / 细化 resistance 标签） | ✅ 已交付 → [`交付记录`](../completed/phase2.5/phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md)；[任务单](../completed/phase2.5/wp-g-dialogue-quality-fix-task.md) |
| **WP-H** | 渲染可用性与指标可信度修复 | 🔴 P0 | **第一波（改动 1~4）**：候选序列 ≥2 校验 + 冷却 300s→60s + 半开探测 + 显式退避重试层（关掉 LangChain 隐式 6 次）+ 超时即中止 + 批量并发 3→2；**第二波（改动 5~7）**：`degraded_turns` 拆双计数器（counselor/visitor）+ `render_fallback_*` 降级率指标 + `prompt_tokens` 归约；**第三波（改动 8~9）**：`engine_version` 走 `git describe --dirty` + 批次有效性门禁（`valid` / `validity_flags` / `counter_consistent`） | ✅ **三波全部交付**（2026-11-10）→ [第一波交付](../completed/phase2.5/phase2.5-wp-h-wave1-render-availability-implementation-2026-11-09.md) · [第二三波交付](../completed/phase2.5/phase2.5-wp-h-wave2-3-implementation-2026-11-10.md) |
---

## 二、依赖关系

```
WP-A 审议输入最小化
  ↓
WP-C 触发式闸门
  ↓
WP-D 模拟咨询师 + 自动对练
  ↓
WP-E 自动评测 + 参数调优

WP-B 可复现控制 + 版本锁定
  （独立，与上面的链不互相依赖）
```

**说明：**
- WP-A → WP-C：先解决"传什么"，再解决"什么时候传"
- WP-C → WP-D：闸门逻辑定了，才能自动跑对练
- WP-D → WP-E：先有数据集，才能评测
- WP-B 独立：可复现控制是另一条线，不依赖上面的链

---

## 三、出口条件对照

| 出口条件 | 对应 WP | 达标标准 |
|---|---|---|
| ① 合规过线 | WP-A | 审议不传心理原文；高风险轮次永远走本地规则 —— ✅ **已达标**（WP-A 交付：入参类型层面零原文 + 三道风险闸门；`riskSkippedTurns` 可查合规证据） |
| ② 考核公平 | WP-B | 考核场景永远纯规则；同一场考核两次跑结果一致 —— 🚧 **部分达标**：`engine_version` + `prompt_version` 均已落库可追溯（批次对比时能区分"引擎变了"与"prompt 文案变了"）；考核场景纯规则待核实 |
| ③ 成本可控 | WP-C | 单场（50 分钟）审议成本 ≤ 1 元 —— 🚧 **闸门已交付**（冷却/配额/熔断 + 不确定性触发全走 env，种子值待 WP-E 实测校准） |
| ④ 质量达标 | WP-E | 审议建议准确率 ≥ 80% —— 🚧 **评测流水线已交付**（触发 P/R/F1 + 六维方向 macro F1 + 幅度 MAE + 纯规则基线对比 + 清洗门槛 + 跨版本对比；一条命令出报告），待**真实督导语料**接入后跑最终验收 |
| ⑤ 数据积累 | WP-D | 1000+ 场自动对练数据 |

---

## 四、独立单（非编号工作）

> Phase2 有 9 条独立单（切灰度前置安全网）。Phase2.5 现有 8 条独立单（另 2 行是"方案"，不计入）。

| 独立单 | 一句话描述 | 状态 |
|---|---|---|
| 闸门 trace 查询接口 | 闸门决策落 MySQL 真相源（`gate_decisions`）+ Redis 热缓存与写时按天计数；admin 三个只读端点（列表 / 详情 / 按天统计），sessionId 双口径 | ✅ 已交付（2026-11-09）→ [任务单](../completed/phase2.5/phase2.5-gate-decisions-trace-api.md) · [交付记录](../completed/phase2.5/phase2.5-gate-decisions-trace-api-implementation-2026-11-09.md) |
| WP-J P2 专业级标注工具 | 30 场锚点人工标注台（admin-dashboard 内嵌）：`quality_annotation` 表（含 crisis_first_turn / needs_review / duration_ms）+ 6 个 admin 端点（列表 / 详情 / 保存 / 双盲 reveal / 一致性 / 无门禁 auto）+ seed 幂等导入 + 前端三栏暗色标注台 | ✅ **前后端均已交付**（2026-11-10）→ [任务单](../completed/phase2.5/wp-j-p2-annotation-calibration-task-2026-11-10.md) · [交付记录](../completed/phase2.5/wp-j-p2-annotation-calibration-implementation-2026-11-10.md)。人工标注进行中 |
| WP-J P1b 危机指标落库 | P1a 的危机后置练习窗指标只活在内存里 —— `ap_practice_sessions` 加 6 列（crisis_practiced / crisis_first_turn / crisis_post_turns / crisis_peak_level / crisis_category / crisis_escalated）+ runner 结算落库 + WS payload 补全 + admin 列表 `?include=crisis` / 详情带出 | ✅ 已交付（2026-11-10）→ [任务单](../completed/phase2.5/wp-j-p1b-crisis-metrics-persist-task-2026-11-10.md) · [交付记录](../completed/phase2.5/wp-j-p1b-crisis-metrics-persist-implementation-2026-11-10.md) |
| P2 来访者质量评测 v1 基线 | 离线脚本 `scripts/ops/quality/visitor-quality-audit.ts`，6 维度量来访者 AI 质量（披露轨迹 / 依恋一致性 / 角色可分辨度 / 口癖重复 / 危机分布 / 人工锚），先测随机基线 | ✅ **v1 基线已出**（2026-11-10）：36 场有效，探索率 11.1%，表层停留 88.9%，可分辨度 22.2%（基线 12.5%）→ [报告](../completed/phase2.5/phase2.5-wp-j-p2-visitor-quality-v1-2026-11-10.md) |
| 路线1 三处结构修复 | P2 v1 报告 §5 点名的三件事：anxious 行为通道（讨好/求证/怕被抛弃）+ 信息增量指令（停滞判据改判来访者）+ 台词指纹穿线（`character_profiles.verbal_voice` 列） | ✅ **代码已交付并 push**（commit 3e9646f，2026-11-10）；❌ **效果已验证：目标未达成**（详见 P1c 行）—— anxious 行为通道**未接上线**（装配层不登记 `attachmentStyle`，指引块从未进 prompt）、信息增量指令生效但把"停滞"换成了"复述"（探索率 11.1%→6.7%）、台词指纹接线正确但 8 角色 `verbal_voice` 全 NULL；**8 角色文案初稿已写**（待审）→ [文案草稿](phase2.5-verbal-voice-drafts-2026-11-10.md) |
| WP-J P1c 路线1 效果验证 | 跑新对练 + 跑 audit 脚本 + 与基线对比，判定路线1 三处修复"方向对不对"（纯验证任务，不写业务代码） | ✅ **已交付**（2026-11-10）→ [任务单](../completed/phase2.5/wp-j-p1c-route1-effect-verification-task-2026-11-10.md) · [交付记录](../completed/phase2.5/wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md)。有效批 16 场（`verify-route1-2026-11-10-r2`，degraded 25%），另有 16 场因上游 429 限流作废。**遗留 P0**：`attachmentStyle` 未接线；**P1**：`llm_call_turns`/`render_fallback_turns` 无人写入致批次门禁永久失效 |
| WP-J P1d 路线1 接线修复 | P1c 遗留 6 项：① attachmentStyle 三处装配点接线（P0）② llm_call_turns/render_fallback_turns 落库（P1）③ audit 补 anxious 词表（P1）④ degraded 口径对齐（P2）⑤ admin 日志脱敏 Authorization（P1，安全）⑥ 信息增量判据补"深度"约束（P2） | ✅ **已交付**（2026-11-10）→ [任务单](../completed/phase2.5/wp-j-p1d-route1-wiring-fixes-task-2026-11-10.md) · [交付记录](../completed/phase2.5/wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md)。**①接线**：5 处（点名的 3 处 + 自动对练/调试面板与语音两条生产路径）→ 构建前 57 份逐字稿 0 命中，新代码 4 份 anxious 各 8 次命中、avoidant 对照 0 命中；**②落库**：门禁相关 4 列（`llm_call_turns`/`render_fallback_turns` + **同族的 `render_fallback_ratio`/两侧降级拆分列**）→ 实测批次 `valid=1`（修前 `LLM_CALL_RATIO_LOW,FALLBACK_RATIO_UNKNOWN`）；**③词表**：覆盖率 5.7%→45.0%、并集 46.3%；**④口径**：audit 改读 DB；**⑤脱敏**：pino redact，实例日志实测 `authorization=[REDACTED]`；**⑥深度约束**：只改外层 prompt。闸门 tsc/eslint 0 错 + 43 例新单测绿 + 全量 vitest 回到 4 failed 基线。**遗留**：主导标签命中率 47.2%<70% 门禁、`counterConsistent` 判据待大炮确认后改 |
| 8 角色 verbal_voice 文案 | P1c 发现台词指纹接线正确但 8 角色文案全 NULL，导致"角色可分辨度 13.3% 贴着随机基线 12.5%"。基于每个角色的主诉/依恋风格/信任阻抗数值，写 80-120 字的"说话的味道" | 📝 **初稿已写待审**（2026-11-10）→ [文案草稿](phase2.5-verbal-voice-drafts-2026-11-10.md)。审完走 seed 幂等落库，不碰 engine-core |
| P1d 验收 + 重跑方案 | P1d 交付后照此执行：先静态 grep 确认接线 → 1 场烟雾验证 prompt 里有 anxious 指引 → 再 16 场正式跑 → 三方对比（v1 基线 / P1c r2 / P1d）。P1c 教训是"没接线就跑了一批作废" | 📋 **方案已写**（2026-11-10）→ [验收+重跑方案](phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md) |
| 30 场锚点标定方案 | 标注完成后要算什么：三个一致率数字（标签/危机/探索MAE）→ 逐维度偏差分析 → 阈值标定 → P4 100 场开跑条件（5 条全绿才开） | 📋 **方案已写**（2026-11-10）→ [锚点标定方案](phase2.5-anchor-calibration-plan-2026-11-10.md) |

---

## 五、与 Phase2 遗留的关系

Phase2 封版记录里列了 6 项 Phase3 阻塞，本阶段处理其中 4 项：

| 阻塞项 | Phase2.5 怎么处理 | 对应 WP |
|---|---|---|
| R4 可复现控制 | 考核场景永远纯规则 + 版本锁定 | WP-B |
| R6 心理数据合规 | 审议不传原文 + 高风险本地分流 | WP-A ✅ **已解决** |
| R7 考核公平性 | 考核场景永远纯规则 + 版本记录 | WP-B |
| R8 上下文与成本 | 审议输入最小化 + 触发式闸门 | WP-A ✅（每轮载荷 −47.7%）/ WP-C（待办） |
| R9 灰度切换开关 | ✅ 已完成（Phase2 收尾） | —— |
| R12 随机抽检 / 人工审核流 | 本阶段用自动评测，不需要人工抽检 | Phase3 再做 |

---

_本登记表为 Phase2.5 的任务清单：7 个 WP，按依赖顺序开工。_
