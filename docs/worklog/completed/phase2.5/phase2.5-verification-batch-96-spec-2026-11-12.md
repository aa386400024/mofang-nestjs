# Phase2.5 · 百场级验证批次规格（96 场 · 已执行）

- 文档日期：2026-11-12
- 状态：**✅ 已执行**（2026-11-12 12:20~12:58 跑批，批次 `g3ONzlqSGMVJqkFMF9Lwh`：门禁 3/3 全过、覆盖 96/96 skipped=0、0 失败；intake-v1 8 条 6/8；审议调用 0 次）→ 交付记录：[phase2.5-verification-batch-96-implementation-2026-11-12.md](phase2.5-verification-batch-96-implementation-2026-11-12.md)
- 关联阶段：Phase2.5 出口条件 ③成本、④质量达标、⑤数据积累 的真实对练批次取证
- 关联代码：
  - 批次端点 `src/auto-practice/auto-practice.controller.ts`（`POST /admin/api/auto-practice/batch`、`GET /admin/api/auto-practice/batches/:id`）
  - 队列并发 `src/auto-practice/practice-queue.service.ts`（env `AUTO_PRACTICE_WORKER_CONCURRENCY`，缺省 2，区间 1–5）
  - 验收判据 `src/auto-practice/metrics/acceptance-thresholds.ts`（intake-v1，12 轮档 8 条）
  - 角色标定 `src/engine-adapters/wiring/character/character-baseline-calibration.ts`（`templateId` 为唯一真相源）
  - 渲染候选装配 `src/engine-adapters/wiring/render-config.factory.ts`
- 历史基线：`data/batch-reports/p1d-r3-intake-2026-11-11.json`（16/16 场、188 轮、intake PASS、指纹 `0591af6a068e5e7e`）；金丝雀 24 场记录 `docs/worklog/completed/phase2.5/phase2.5-wp-h-wave1-canary-verification-2026-11-09.md`

---

## 1. 背景与本轮边界

WP-H 三波已交付、金丝雀门禁已过（24/24 场 `total_tokens>0`、兜底句 0.0%、`degraded_turns=0`）。本批次是金丝雀之后的第一场真实规模对练，目标是在百场量级上为出口条件 ③④⑤ 取证。

**本轮已完成的只是前置核实与规格定稿**：入口、配置口径、provider 冗余现状、环境依赖、样本可用性、历史基线均已取证；尚未调用入队端点，未产生新批次数据，未修改任何代码或配置。

## 2. 拍板规格（选项 A · 两端对照）

| 项                      | 取值                                              | 依据                                                            |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| 角色 `characterSlugs`   | 下列 8 个 slug（全集）                            | 已由 p1d-r3 的 16 场实跑背书，库内可解析                        |
| 模式 `counselorModeIds` | `expert`、`cold`                                  | 两端对照，对齐金丝雀口径；两模式均有历史实跑记录                |
| 重复 `repeats`          | 6                                                 | 8 × 2 × 6 = **96 场**                                           |
| 单场上限 `maxTurns`     | 12                                                | 对齐 intake 12 轮档判据、金丝雀与 p1d-r3；**不采用端点缺省 15** |
| 队列并发                | 2                                                 | env 未配即缺省 2（区间 1–5）；当前运行进程已是缺省值，无需重启  |
| Provider                | **单 `minimax` 起跑**（用户拍板，不补第二家 key） | 靠半开探测 + 显式退避重试兜底                                   |

### 2.1 角色 slug 清单（顺序对应标定表）

| #   | slug                                    | 角色 / 标签                  |
| --- | --------------------------------------- | ---------------------------- |
| 1   | `vpt_general_secure_l1`                 | 安然 · 安全（guarded）       |
| 2   | `vpt_intimate_avoidance_l1`             | 晚晴 · 亲密回避（guarded）   |
| 3   | `vpt_self_worth_intellectualization_l1` | 小满 · 自尊理智化（guarded） |
| 4   | `vpt_social_anxious_l1`                 | 语桐 · 焦虑（anxious）       |
| 5   | `vpt_depression_avoidant_l1`            | 沉舟 · 抑郁回避（empty）     |
| 6   | `vpt_grief_avoidance_l1`                | 念安 · 哀伤回避（sad）       |
| 7   | `vpt_workplace_intellectualization_l1`  | 亦舟 · 职场理智化（sad）     |
| 8   | `vpt_trauma_disorganized_l1`            | 惊尘 · 创伤紊乱（hurt）      |

### 2.2 未纳入本批的模式

`intermediate`、`novice`、`chatty`、`preachy`、`nonsense` 历史批次无实跑记录；其中 `preachy` / `nonsense` 属负面对练样本。本批不纳入，留待后续批次在两端口径稳定后再扩。

## 3. 环境与依赖核实结果（2026-11-12 取证）

### 3.1 运行态

- 服务监听：3000（Nest）、5174（vite）；远程 MySQL / Redis env 键齐备（值不落地进文档）。
- 工作树干净，分支 `integrate`；`src/engine-core` 零 diff；定时任务 0 个。
- 逐字稿存量：`data/debug-sessions/` 下本次核实为 106 个文件（发起时以实际计数为准），距 `MAX_DEBUG_SESSIONS=500` 硬编码上限余量充裕。

### 3.2 认证

批次端点为 class 级 `AdminRoleGuard`。`ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASS` 已配，basic 凭据旁路直接放行；发起可用 basic auth，无需另签 admin JWT。

### 3.3 Provider 冗余现状（明确缺口，已拍板暂不补）

- 当前渲染候选仅 `minimax` 一个；`ENGINE_RENDER_FALLBACK_PROVIDERS` 未配，`ENGINE_RENDER_REQUIRE_FAILOVER` 未配（缺省 false，单候选只告警、不拦启动）。
- `deepseek` / `doubao` / `qwen` provider 代码已注册；第二家上线需补对应 `LLM_<ID>_API_KEY` 并在 fallback 键声明 provider id。
- 该缺口仍登记为运维债（见 §8），不阻断本批发起。

## 4. 发起与取证步骤（待指令执行）

### 4.1 跑批前前置

1. 归档当前 `data/debug-sessions/` 存量 106 个逐字稿到 `data/archives/` 隔离目录，避免 500 滑动淘汰影响本批审计留存。
2. 健康检查：确认 3000 / 5174 在监听；启动日志无 DB / Redis / provider 注册异常。
3. 复核 `src/engine-core` 零 diff、工作树干净。
4. 不重启服务（并发已为缺省 2；仅当要调整并发时才需重启并改 `AUTO_PRACTICE_WORKER_CONCURRENCY`）。

### 4.2 入队

- 端点：`POST /admin/api/auto-practice/batch`（basic auth）
- 请求体：

```json
{
  "characterSlugs": [
    "vpt_general_secure_l1",
    "vpt_intimate_avoidance_l1",
    "vpt_self_worth_intellectualization_l1",
    "vpt_social_anxious_l1",
    "vpt_depression_avoidant_l1",
    "vpt_grief_avoidance_l1",
    "vpt_workplace_intellectualization_l1",
    "vpt_trauma_disorganized_l1"
  ],
  "counselorModeIds": ["expert", "cold"],
  "maxTurns": 12,
  "repeats": 6
}
```

- 响应：`{ "batchId": "<nanoid>", "enqueued": 96 }`；入队立即返回，不等跑完。

### 4.3 进度与门禁轮询

- `GET /admin/api/auto-practice/batches/:id`：返回聚合 metrics、`batchHealth.valid`、不合格时 `warning` 与逐场清单。
- 场次清单：`GET /admin/api/auto-practice/sessions?batchId=<id>`。

### 4.4 报告与快照

- 批次指标快照由批次收尾链路固化入库（WP-K）；离线报告 CLI：

```
pnpm exec tsx bin/batch-report.ts --batch <batchId> [--baseline <前一批id>]
```

- 退出码：0 全部 OK；1 检出回归（仅在带 `--fail-on-regression` 时置 1）；2 数据不可用或覆盖不足；3 参数错误。常用参数：`--batch`（可重复）、`--baseline`、`--all`、`--since`、`--out`、`--strict`、`--format json|md|both`。
- 跨批对比注意：本批配置指纹与 p1d-r3 不同（角色数、模式、重复均不同），WP-K 回归四态可能判 `incomparable`，属预期；本批首要看门禁与 intake 判据，跨版本回归对比需同指纹批次。

## 5. 验收口径

### 5.1 批次门禁三项（WP-H 改动 9）

1. `llm_call_ratio ≥ 0.9`：`llm_call_turns > 0`（有真实 LLM 调用）的场次占纳入场次之比（指标字典口径；**不是** `total_tokens` 列，`total_tokens` 属成本取证列）。
2. `render_fallback_ratio < 0.05`：渲染兜底率批次均值。
3. `counter_consistency = 100%`：全场 `degraded_turns ≤ turn_count`。

### 5.2 intake 12 轮档判据（intake-v1，8 条）

trust Δ 0.05–0.20；safety Δ 0.02–0.06；bond Δ −0.03–0.03；depth |Δ| ≤ 0.10；style |Δ| ≤ 0.05；verbal |Δ| ≤ 0.15；arousal ≥ −0.05；`zero_motion` 必须为 0；`exploration.rate` 属 40 轮档，本档不验。口径全文见 `phase2.5-intake-acceptance-criteria-2026-11-11.md`。

### 5.3 覆盖要求

`includedSessions / expectedSessions = 96 / 96`，`skippedSessions = 0`；任一场次解析失败落 `failed` 都会被 `batchHealth` 标 invalid，不静默出脏数据。

## 6. 出口条件映射（避免口径误读）

| 出口条件   | 本批可直接取证                                                                             | 仍需另走链路                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| ③ 成本可控 | 渲染链路 token 用量、触发式闸门审议调用频次；`prompt_tokens` 穿透已修，成本口径可升 `full` | 判据是「50 分钟长会审议成本 ≤ 1 元」；本批为 12 轮 intake 短会话，长会成本需外推或另跑长会话批次 |
| ④ 质量达标 | LLM 真实被调用、无整场降级、intake 九维状态判据达标（前置有效性证据）                      | 「审议建议准确率 ≥ 80%、督导 ground truth」仍走 WP-E 评测链路，本批不直接产出该分数              |
| ⑤ 数据积累 | 96 场逐字稿 + 批次指标快照入库留存，向 1000+ 场目标推进                                    | 后续多批次累计                                                                                   |

## 7. 风险与回退

- **单候选限流**：上游限流时由半开探测（冷却 60s / 半开 30s）+ 显式退避重试兜底；若门禁出现兜底占比超阈、或大量 `total_tokens=0` 场次，停批归因，不补跑脏数据。
- **留存滑动**：跑批期间不穿插其他调试会话；本批作为最新逐字稿不会被自身淘汰，但若窗口滑动挤占旧文件，以归档目录为准。
- **规格边界**：本批只覆盖 expert / cold 两端；中间档与负面对练模式的结论不在本批证据范围内。
- **成本口径偏差**：12 轮短会话 token 折算不等同 50 分钟长会成本，汇报 ③ 时必须标注口径。

## 8. 遗留运维债（不阻断本批）

1. 第二家 chat provider key 与 `ENGINE_RENDER_FALLBACK_PROVIDERS` 仍未配；冗余是百场以上批次的稳定性保障，建议在后续批次前补齐。
2. ④审议准确率评测仍走 WP-E 链路，待本批有效性证据齐备后另排。
3. 批次接口不暴露 `scenarioType`（WP-B 遗留），exam 场景无生产 HTTP 入口；本批走默认场景。

## 9. 红线

- `src/engine-core` 全程不动；交付时 `git diff --stat HEAD -- src/engine-core` 必须为空。
- 不自动 `git commit` / `git push`；完成后只给一行 commit message 草稿，由负责人手动提交。
- 心理对话原文、量表答案、心理画像、自伤输入不进普通日志与 crash report；本规格文档不落任何密钥值与对话原文。
