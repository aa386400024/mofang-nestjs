# AF-466 交付记录 · 10 角色语域资产补齐与重跑

- 任务：`AF-466`（`contextId=phase2.5-visitor-register-eval`）
- 分支：`task/AF-466-register-assets`
- 基线：`28aa06c1dbfe9f35acda47fb62c18c0c25a08f01`
- 类型：`implementation`（资产补齐 + 评测重跑）
- 报告：`docs/worklog/completed/phase2.5/af466-10role-register-rerun-2026-11-24.md`

## 改了什么

### 1. 两个缺口角色进入 A 类内容 seed

`src/engine-adapters/wiring/character/character-profile.seed.ts`

- `CHARACTER_PROFILE_SEED_SPECS` 从 4 个扩到 6 个，新增：
  - `vpt_parenting_projection_l1`（阿禾）：anxious；核心信念从 `visitor-pool-seed.ts` 的 `script.innerWorkingModel.coreBeliefs` 抽取。
  - `vpt_social_anxiety_avoidance_l1`（小舟）：avoidant；同上。
- 五 Ps、愿望、禁止行为、敏感议题从来访池模板的剧本与 5Ps 语义转写；数值、台词指纹、语域指纹全部走 `baselineOf(templateId)` 装配，不复制第二份真相。
- 这两个角色此前只有来访池模板、没有 `character_profiles` 行，seed 不会建行，debug 接口直接 400。

### 2. 权威标定表从 8 行扩到 10 行

`src/engine-adapters/wiring/character/character-baseline-calibration.ts`

- 新增 `vpt_parenting_projection_l1`：trust 0.38、阻抗 0.50/0.45/0.40、emotion -0.42/0.68、safety 0.38、bond 0.45、`expectedLabel=anxious`。
- 新增 `vpt_social_anxiety_avoidance_l1`：trust 0.28、阻抗 0.60/0.35/0.30、emotion -0.38/0.44、safety 0.30、bond 0.25、`expectedLabel=guarded`。
- 两段 `verbalVoice` 只写句式 / 节奏 / 语气，不复述语域指纹里的身份与词汇。
- 数值是工程标定值，不是临床标定；已过既有的区间、情绪标签、可区分性、无维度塌缩四条自检。

### 3. B 类角色语域随内容 seed 落库

`src/engine-adapters/wiring/character/character-profile.db-only.seed.ts`

- `baselineOf` 的返回类型增加 `speechRegister`，从 `getVisitorSpeechRegister(templateId)` 装配；缺失即抛错。
- B 类 4 个角色（安然 / 语桐 / 沉舟 / 惊尘）没有来访池模板，内容 seed 是唯一能把语域写进库的路径；这次不改 `applyBaselineCalibration` 的写入列，避免破坏“基线校准只碰 8 个数值 + 台词指纹”的既有纪律。

### 4. 测试口径升级

- `test/engine-adapters/af106-character-pool.spec.ts`：B 类 4 + A 类 6 = 10 个 profile；新增 B 类 `speechRegister` 与权威语域表逐列相等断言。
- `test/engine-adapters/character-baseline-calibration.spec.ts`：10 行、10 角色；标签分布更新为 guarded 4 / sad 2 / anxious 2 / empty / hurt。
- `test/engine-adapters/wp9b-db-character-resolver.spec.ts`：首批 slug 从 4 个扩到 6 个。
- `test/engine-adapters/af357-character-desire-mapping.spec.ts`：真实角色从 8 个扩到 10 个，加 2 个内置种子共 12 个。
- `test/engine-adapters/character-baseline-seed-calibration.spec.ts` 与 `wp51-character-seed-alliance-baseline.spec.ts` 的载荷 / 基线断言未改，仍按 DB-only 4 个守住边界。

### 5. 评测 harness 小改（不动机器判定）

`scripts/eval/visitor-register-stability/`

- `run-sessions.mjs` 增加 `--task-id`，manifest 与日志不再硬编码 AF-465。
- `judge-sessions.mjs` 从 manifest 读 `taskId`；`--reuse-raw` 复用已成功 raw，避免重复付费盲评；`JUDGE_TIMEOUT_MS` 120s→240s。
- `render-report.mjs` 增加 `--out`；报告标题取 `analysis.taskId`；未注入为 0 时不再输出“这些角色没有语域块”的错误句子。
- `README.md` 同步参数与报告路径说明。
- 30 轮脚本、脚本哈希、抽样轮、指标与门槛均未改。

## seed 结果

首次执行：

```text
内容 seed (A 类 6 个) → 新增 2 / 更新 0 / 未变 4
内容 seed (B 类 4 个) → 新增 0 / 更新 4 / 未变 0
基线校准 (B 类 4 个) → 更新 0 / 未变 4 / 缺失 0
```

第二次执行：

```text
内容 seed (A 类 6 个) → 新增 0 / 更新 0 / 未变 6
内容 seed (B 类 4 个) → 新增 0 / 更新 0 / 未变 4
基线校准 (B 类 4 个) → 更新 0 / 未变 4 / 缺失 0
```

只读查询：10 行全部 `approved + enabled + speech_register IS NOT NULL`。

## 评测结果

- 规模：10 角色 × base/active × 30 轮 = 20 场 / 600 轮，失败轮 0。
- 注入：active 10/10 场全覆盖，base 0/10 场命中。
- 方向：9/10 active 优于 base，中位 `register_fit` Δ 1.75；唯一 tie 是 `vpt_social_anxious_l1`（1/1，Δ 0.00，base/active 均 4.50，天花板）。
- 刻板：10/10 角色 ≥4，下降 0。
- 稳定：10/10 角色 ≥4，后 10 轮标志词达标 10/10。
- BDI 护栏：0 轮不一致。
- 不回归：失败，`abstractTermRate` 2 项（workplace 0→0.51、self_worth 0→0.15）；助手腔 / 建议式 / 标签化 / 术语均为 0。
- 成本：prompt 中位 +12.85%，p95 延迟中位 +32.06%；失败。
- 结论：`direction_consistent_but_limited`；覆盖与注入已补齐，方向与稳定性证据增强，但两项非方向性门槛未过，不能判机制稳定。

## 闸门

| 闸门                                      | 结果                               |
| ----------------------------------------- | ---------------------------------- |
| 角色资产 7 个 spec                        | 127 passed / 0 failed              |
| `pnpm typecheck`                          | 0 error                            |
| `pnpm lint`                               | 0 error                            |
| `pnpm test`                               | 4924 passed / 1 failed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空                                 |

`pnpm test` 唯一失败是既有 `scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs`：本地 `data/debug-sessions` 语料已漂到 `empathy | 45 | 42 | 3`，断言仍写 `34 | 31 | 3`；该文件为 gitignored，干净检出会跳过，与本任务改动无调用关系。

## 偏差

- 双 AI 盲评首次在 `vpt_social_anxious_l1` 的 Doubao 调用连续超时（120s），并非解析失败；改为 `--reuse-raw` 复用前 7 个角色已成功 raw，并把超时提到 240s，完成全部 10 角色。未删除、未伪造任何 raw。
- 任务单 gate 未列全量 `pnpm test`；实际跑了，记录真实失败，不以“除本地语料外全绿”替代退出码。
- 报告由 harness 渲染后追加“与 AF-465 差异 / 两处未过门怎么读 / 机制结论 / 下一步 / 交付记录”。

## 未做

- 未改 `src/engine-core`。
- 未改语域渲染算法、BDI 决策、灰度开关。
- 未提交任何原始心理台词、prompt 或 judge 原始响应。
- 未替 abstractTermRate 与延迟门槛做放宽；留作产品 / 性能任务决策。
