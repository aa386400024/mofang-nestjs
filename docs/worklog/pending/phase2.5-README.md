# Phase2.5 灰度验证期 · 工作入口

> **路径**：`docs/worklog/pending/phase2.5-README.md`
> **状态**：✅ Phase2.5 五个 WP 全部交付（WP-A + WP-B + WP-C + WP-D + WP-E）
> **创建日期**：2026-11-08
> **总入口**：[§worklog/README.md](../README.md)

---

## 0. 这是什么阶段（先读这段）

**Phase2.5 不是功能开发阶段，是验证阶段。**

| 阶段 | 干什么 | 类比 |
|---|---|---|
| Phase2 | 造出引擎（规则算子 / 同盟三维 / 记忆 / 审议层 PoC） | 造出一辆车 |
| **Phase2.5** | **把车开上路试一圈——小范围验证质量，确认没问题再正式上路** | **试车场** |
| Phase3 | 正式上路商业化（全量切 + 收费） | 正式运营 |

**一句话：Phase2.5 的目标不是"做新功能"，而是"用自动化数据验证引擎质量达标，决定要不要全量切"。**

---

## 1. 出口条件（做完的标志）

| # | 出口条件 | 可判定标准 |
|---|---|---|
| ① **合规过线** | 审议不传心理原文，只传结构化数据；高风险轮次永远走本地规则 | 合规口径过关 |
| ② **考核公平** | 考核场景永远走纯规则模式，LLM 审议只用于非考核场景 | 同一场考核两次跑结果一致 |
| ③ **成本可控** | 触发式闸门——只有状态变化大才跑审议，平静时不跑 | 单场（50 分钟）审议成本 ≤ 1 元 |
| ④ **质量达标** | 审议建议准确率 ≥ 80%（用督导解析当 ground truth 自动评测） | 自动评测报告达标 |
| ⑤ **数据积累** | 1000+ 场自动对练数据（用模拟咨询师 AI 自动跑） | 数据集齐备 |

---

## 2. WP 清单与进度

| WP | 名称 | 优先级 | 状态 | 任务单 / 交付记录 |
|---|---|---|---|---|
| **WP-A** | 审议输入最小化（合规 + 成本双解决） | 🔴 P0 | ✅ 已完成 | [任务单](phase2.5-wp-a-deliberation-input-minimization-2026-11-08.md) / [交付记录](../completed/phase2.5/phase2.5-wp-a-deliberation-input-minimization-implementation-2026-11-08.md) |
| **WP-B** | 可复现控制 + 版本锁定 | 🔴 P0 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-b-reproducibility-version-locking.md) |
| **WP-C** | 触发式审议闸门 | 🟡 P1 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate.md) / [交付记录](../completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate-implementation-2026-11-09.md) |
| **WP-D** | 模拟咨询师 AI + 自动对练 | 🟡 P1 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-08.md) / [交付记录](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-08-implementation.md) |
| **WP-E** | 自动评测 + 参数调优 | 🟡 P1 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-e-auto-evaluation-tuning.md) / [交付记录](../completed/phase2.5/phase2.5-wp-e-auto-evaluation-implementation-2026-11-09.md) |
| **WP-F** | 成本看板多源合并 | 🟢 P2 | ✅ 已完成 | [任务单](../completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources.md) / [交付记录](../completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources-implementation-2026-11-09.md) |
| **WP-G** | 对话质量修复（来访话术 / 咨询师兜底 / 停滞检测 / 危机应对） | 🔴 P0 | ✅ 已交付（**验收推迟，见下**） | [任务单](../completed/phase2.5/wp-g-dialogue-quality-fix-task.md) / [交付记录](../completed/phase2.5/phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md) |
| **WP-H** | 渲染可用性与指标可信度修复 | 🔴 **P0** | 🚧 **待开工（当前唯一在办任务单）** | [任务单](wp-h-render-availability-fix-task.md) |

**依赖关系：**
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

---

## 3. 当前有什么活

**唯一在办任务单：WP-H「渲染可用性与指标可信度修复」** → [wp-h-render-availability-fix-task.md](wp-h-render-availability-fix-task.md)

### 3.1 必须先知道的转折（2026-11-09 晚）

三批自动对练（合计 1034 场）跑完后，对归档逐字稿做全量复算，发现一个**推翻既有结论**的事实：

- 报告里来访者「TOP4 话术」逐字等于 `render-adapter.config.ts:150` 的 `DEFAULT_RENDER_FALLBACK_UTTERANCES`（4 句兜底池）
- 归档 500 份逐字稿中，来访者消息 17,585 条，兜底池 4 句命中 **16,143 条 = 91.8%**，四句各自 4031/4033/4039/4040（确定性轮转特征）
- 1,031 个有轮次场次中 **926 场（89.8%）整场 `total_tokens = 0`**；`prompt_tokens` 全库最大值 0

**结论：这三批数据不是「质量差的对练」，是「LLM 基本没被调用」。** 根因是渲染候选序列只有 1 个 provider（`ENGINE_RENDER_FALLBACK_PROVIDERS` 未配置）+ `failureThreshold=3` + `cooldownMaxMs=300s` 的单例熔断 —— 批量并发下上游限流即导致长时间全损降级。

**因此：**
- **不能拿这三批数据调参**。95.9% 重复率、停滞率、cold/nonsense 模式对比等结论全部建立在这批无效数据上，作废
- **WP-G 的 3 项渲染层 prompt 改动保留代码，验收推迟** —— LLM 不说话时，角色 prompt 里写多少句都无意义
- 第④②出口条件的「质量达标」判定，必须等 WP-H 过了门禁重跑才算数

完整证据链见：[数据链路体检记录](phase2.5-data-pipeline-audit-2026-11-09.md)

### 3.2 出口条件当前状态

| 出口条件 | 状态 |
|---|---|
| ① 合规过线 | ✅ WP-A 交付（入参零原文 + 三道风险闸门） |
| ② 考核公平 | ✅ WP-B 交付（考核场景永远纯规则 + 版本锁定） |
| ③ 成本可控 | 🚧 WP-C 闸门已上线，**种子值待真实评测校准**；且 `prompt_tokens` 恒为 0 导致成本只算输出侧，修完 WP-H 改动 7 才可信 |
| ④ 质量达标 | 🔴 **不可判定** —— 现有数据 LLM 未真正调用，需 WP-H 修完重跑金丝雀才能重新评估 |
| ⑤ 数据积累 | 🚧 WP-D 自动对练已交付；**但 534/1034 场（51.6%）逐字稿已被 `MAX_DEBUG_SESSIONS=500` 淘汰**，幸存 500 场已归档到 `data/archives/debug-sessions-baseline-20261109/` |

### 3.3 下一步（严格按顺序）

1. **WP-H 第一波**（让 LLM 真的被调用）：候选序列 ≥2 + 冷却上限降到 60s + 半开探测 + 真退避 + 并发可配置
2. **跑金丝雀验证门禁**：20~30 场，并发 1~2，要求 `total_tokens>0` 场次 ≥90%、兜底句占比 <5%、`degraded_turns ≤ turn_count`
3. 门禁过了才允许跑大批；否则跑出来的数还是无效
4. `engine-core` 全程不动

---

## 4. 红线（Phase2.5 特有）

### 4.1 engine-core 纯层红线
- ❌ 不改 `src/engine-core/` 下任何文件
- ✅ 所有改动都在 `src/engine-adapters/` 下
- ✅ 审议在适配层，内核不知道 LLM 是什么

### 4.2 合规红线
- ❌ 审议 prompt 里永远不出现对话原文（咨询师说的话 / 来访者说的话）
- ❌ 高风险轮次永远不跑 LLM 审议，直接走规则
- ✅ 心理数据不出境——这是底线，没有商量余地

### 4.3 零回归红线
- ❌ 不改现有审议的输出格式（deltas + reason + operatorTags + intentionShift）
- ❌ 不改现有审议钩子的调用方式
- ✅ 只是改"传给 LLM 的输入是什么"，不改"LLM 输出什么"

---

## 5. 交付格式

### 5.1 交付记录放哪里

做完一个 WP，写一份交付记录，放：
```
docs/worklog/completed/phase2.5/
  └─ phase2.5-wp-x-implementation-2026-11-08.md
```

### 5.2 交付记录写什么

参照 Phase2 的格式：
1. 本单做了什么（一句话总结）
2. 方案设计（实际实现的方案，跟任务单的方案有什么差异）
3. 偏差说明（如果改了方案，为什么改，理由是什么）
4. 测试闸门（tsc / vitest / eslint / boundary.spec.ts 的数字）
5. 交付物清单（新增了哪些文件，改了哪些文件）
6. 回写清单（README / 总览 / 登记表 哪里更新了）

### 5.3 方案可以改，但要写偏差

如果开发期间发现更合理更专业的方案，可以按后端的来——但要在交付记录里写明：
- 原方案是什么
- 实际方案是什么
- 为什么改（理由要充分）

---

## 6. 文档导航

| 文档 | 内容 |
|---|---|
| 本文件（Phase2.5 README） | 工作入口：定位 / 出口条件 / WP 进度 / 红线 / 交付格式 |
| [§Phase2.5 总览](phase2.5-overview-2026-11-08.md) | 详细的定位 / 目标 / 范围 / 关键设计决策 |
| [§WP 登记表](phase2.5-wp-list-2026-11-08.md) | 逐 WP 一行的登记表（依赖关系 / 出口条件对照） |
| [§数据链路体检记录](phase2.5-data-pipeline-audit-2026-11-09.md) | **必读**：6 项待修发现，含「91.8% 发言是兜底句」的完整证据链与代码行号 |
| [§WP-H 任务单](wp-h-render-availability-fix-task.md) | **当前在办**：渲染可用性 + 指标可信度 + 批次门禁，9 项改动 + 验收门禁 |
| [§worklog/README.md](../README.md) | 整个项目的工作入口（Phase2 封版 / R9 / Phase2.5 状态） |

---

## 7. 术语澄清（2026-11-09 补）

| 术语 | 容易误解成 | 实际含义 |
|---|---|---|
| 「话术重复率」 | Prompt 写得不够多样 | 本次三批数据里，它的真实含义是**渲染降级兜底率** |
| 「渲染降级 / degraded」 | 内容质量不高 | **LLM 没被调用**，返回的是 `render-adapter.config.ts` 里的常量兜底句 |
| 「heavy_degraded」 | 一半以上轮次质量差 | 计数口径错：两侧各 +1，可 2×turn_count；阈值却按轮数算 |
| 「engine_version」 | 代码版本可追溯 | 实际全为 `"dev"`（`.env` 未配 `ENGINE_VERSION`），零区分度 |

这三批数据的**唯一**正确用法：拿来定位管道缺陷。**不能**拿来调 prompt、不能拿来比较模式优劣、不能拿来给出口条件④打分。
