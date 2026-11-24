# AF-465 来访者语域指纹机制稳定性评测（AI 盲评）

- 运行 ID：`af465-2026-11-24-8roles`
- 代码基线：`65a7f00f951ee24906347bfb9e26b6eb696db293`
- 固定脚本哈希：`310fb539541f55dd67cde2727cc43dccf0e74a0d0c2fb70293faa27b415f0860`
- 规模：8 个可用标定角色 × base/active × 30 轮，共 16 场
- 覆盖：8/10；未覆盖 vpt_parenting_projection_l1、vpt_social_anxiety_avoidance_l1
- active 注入：4/8；未注入 vpt_general_secure_l1、vpt_social_anxious_l1、vpt_depression_avoidant_l1、vpt_trauma_disorganized_l1
- 评委：Doubao Seed 2.1 Pro（`doubao-seed-2-1-pro-260915`） / MiniMax M3（`MiniMax-M3`）
- 协议：`register-v1-paired`；状态：`ai_proxy_candidate`

> 本报告是 AI 代理盲评，不是真人语言学/督导师验收；只评“用词是否贴合社会语域”，不评诊断与疗效。

## 结论

**机制在可注入角色上方向一致；注入覆盖不足，不能判机制稳定**

判定口径是预注册的：跨 10 个标定角色看方向一致性，实际覆盖 8 个；同时检查刻板化、跨轮稳定、BDI 护栏、助手腔/术语/建议式回归和成本；不以平均句长作主指标。

## 门槛

| 门         | 结果 | 关键数字                                                                     |
| ---------- | ---- | ---------------------------------------------------------------------------- |
| 角色覆盖   | ✅   | 8/10 已标定角色；缺 2                                                        |
| 注入正确   | ❌   | active 4 场全覆盖 / base 0 场命中                                            |
| 跨角色方向 | ❌   | 5 角色占优（阈值 7），中位 Δ 0.75                                            |
| 刻板安全   | ✅   | 8 角色 ≥4（阈值 8），下降 0                                                  |
| 跨轮稳定   | ❌   | 8 角色 ≥4（阈值 7），漂移达标 6                                              |
| BDI 护栏   | ✅   | 0 轮不一致                                                                   |
| 不回归     | ❌   | 越界 1 项：`vpt_workplace_intellectualization_l1` abstractTermRate 0.00→0.28 |
| 成本       | ✅   | prompt 6.3%，p95 1.2%                                                        |

## 注入覆盖拆分

- 可注入：4 个角色；active 占优 4/4；可注入集合的中位 `register_fit` Δ 1.75。
- 未注入：`vpt_general_secure_l1`、`vpt_social_anxious_l1`、`vpt_depression_avoidant_l1`、`vpt_trauma_disorganized_l1`。这些角色在 active 模式下没有语域块，active 实质等同 base，不能计入机制证据。

## 逐角色

| 角色                                    | 方向   | active/base/tie | 语域贴合 base→active (Δ) | 刻板安全 | 跨轮稳定 | 具体度 | 标志词命中 base→active | 锚点密度 base→active | prompt 字符 base→active | BDI 不一致轮 |
| --------------------------------------- | ------ | --------------- | ------------------------ | -------- | -------- | ------ | ---------------------- | -------------------- | ----------------------- | ------------ |
| `vpt_intimate_avoidance_l1`             | active | 2/0/0           | 3.00 → 4.50 (1.5)        | 4.50     | 5.00     | 5.00   | 0.0% → 0.0%            | 0.13 → 0.96          | 2466 → 2869             | 0            |
| `vpt_workplace_intellectualization_l1`  | active | 2/0/0           | 2.50 → 3.50 (1.0)        | 4.50     | 4.50     | 3.50   | 0.0% → 0.0%            | 0.00 → 0.61          | 2247 → 2468             | 0            |
| `vpt_grief_avoidance_l1`                | active | 2/0/0           | 2.00 → 5.00 (3.0)        | 4.50     | 5.00     | 4.50   | 0.0% → 0.1%            | 0.00 → 1.20          | 2693 → 2903             | 0            |
| `vpt_self_worth_intellectualization_l1` | active | 2/0/0           | 2.50 → 4.50 (2.0)        | 5.00     | 5.00     | 5.00   | 0.0% → 0.1%            | 0.00 → 1.35          | 2525 → 3241             | 0            |
| `vpt_general_secure_l1`                 | base   | 0/2/0           | 4.50 → 4.00 (-0.5)       | 5.00     | 5.00     | 4.50   | 0.0% → 0.0%            | 0.16 → 0.00          | 2425 → 2382             | 0            |
| `vpt_social_anxious_l1`                 | base   | 0/2/0           | 4.50 → 4.00 (-0.5)       | 5.00     | 4.50     | 4.50   | 0.1% → 0.0%            | 0.48 → 0.65          | 2767 → 2328             | 0            |
| `vpt_depression_avoidant_l1`            | tie    | 1/1/0           | 3.00 → 3.00 (0.0)        | 5.00     | 5.00     | 3.00   | 0.1% → 0.1%            | 0.00 → 0.00          | 2195 → 1937             | 0            |
| `vpt_trauma_disorganized_l1`            | active | 2/0/0           | 3.50 → 4.00 (0.5)        | 4.50     | 4.50     | 4.00   | 0.0% → 0.0%            | 0.00 → 0.00          | 2345 → 2457             | 0            |

## 摘要

- 方向：5/8 个角色 active 优于 base；语域贴合中位 Δ = 0.75。
- 刻板安全：8/8 个角色 active 的 `stereotype_risk` 均值 ≥ 4；下降超过 0.5 的角色 0 个。
- 跨轮稳定：8/8 个角色 active 的 `cross_turn_stability` 均值 ≥ 4；后 10 轮标志词命中达标 6/8。
- 护栏：BDI 不一致 0 轮；crisis 与事件分类按场记录在 `analysis.json`。
- 成本：prompt 字符中位 6.3%；p95 延迟中位 1.2%。

## 限制

- 只做 AI 盲评，未做真人语言学/督导师验收；status=ai_proxy_candidate。
- 评委中的 MiniMax 与来访者渲染模型同族，存在自偏好风险；主判为不同厂商的 Doubao。
- 库内只有 8 个 approved character_profiles 可开调试会话；未覆盖角色：vpt_parenting_projection_l1、vpt_social_anxiety_avoidance_l1。
- active 注入未覆盖：vpt_general_secure_l1、vpt_social_anxious_l1、vpt_depression_avoidant_l1、vpt_trauma_disorganized_l1（这些角色的 character_profiles 没有 speech_register，active 必然等同 base）。
- 每个角色每个模式只跑 1 场，跨角色方向可看，重复性方差未测。
- 只覆盖已标定角色，不外推到未标定角色。
- 只测文本，不测 TTS/ASR 听感。

## 判定

机制方向在可注入角色上成立，但当前不能判稳定；先补齐未注入角色的 speech_register 资产，再重跑 active/盲评，不扩大灰度。

## 交付记录

- 代码基线：`65a7f00f951ee24906347bfb9e26b6eb696db293`；分支 `task/AF-465-register-stability`。
- 新增：`scripts/eval/visitor-register-stability/` 下 30 轮脚本、指标纯函数、双模式跑场、双评委盲评、报告渲染、README、11 条单测。
- 成功标准偏差：任务单要求 10 个标定角色、20 场；库里只有 8 个 approved `character_profiles`，实际 8 角色、16 场、480 轮，失败轮 0。缺 `vpt_parenting_projection_l1`、`vpt_social_anxiety_avoidance_l1`。
- 注入覆盖偏差：8 个可用角色中只有 4 个的 `character_profiles.speech_register` 非空（intimate / workplace / grief / self_worth）；其余 4 个 active 必然等同 base，不能计入机制证据。
- 门槛口径：8 角色按同比例取方向 7/8、刻板 8/8、稳定 7/8；角色覆盖门按 ≥8 判“可评”，不替 10 角色覆盖背书。
- 任务单 gate 偏差：任务单写 `node --check run-eval.mjs`，实际拆为 `run-sessions.mjs` / `judge-sessions.mjs` / `render-report.mjs`，无 `run-eval.mjs`；三个入口 `node --check` 均 exit 0。
- 评委偏差：MiniMax M3 用 `thinking:{type:"disabled"}` 关闭思维链，否则 `reasoning_effort` 不降深度、JSON 易被思考截断；Doubao 仍用默认。
- 闸门：`pnpm lint` 0 error；`pnpm typecheck` 0 error；`pnpm test` 4924 passed / 1 failed / 4 skipped，失败为 `scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs` 的真实语料绝对数字，与本次脚本无调用关系；`pnpm test scripts/eval/.../metrics.spec.mjs` 11 passed；`git diff --stat HEAD -- src/engine-core` 为空。
- 数据卫生：原始台词与 judge-raw 只在本机 `data/eval-reports/visitor-register-stability/`（gitignored）；本次创建的 28 个评测调试会话已从 `data/debug-sessions` 清掉，避免污染 AF-427 本地语料台账。
- 结论：`injection_coverage_blocked`；可注入的 4 个角色 active 占优 4/4，中位 `register_fit` Δ 1.75；因 4/8 未注入，预注册机制门不成立。
- 后续：先补 4 个角色的 `speech_register` 与 2 个缺失角色 profile，再按 10 角色重跑 active/盲评；当前不扩大灰度。
