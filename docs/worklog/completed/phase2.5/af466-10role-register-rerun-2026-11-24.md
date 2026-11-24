# AF-466 来访者语域指纹机制稳定性评测（AI 盲评）

- 运行 ID：`af466-2026-11-24-10roles`
- 代码基线：`28aa06c1dbfe9f35acda47fb62c18c0c25a08f01`
- 固定脚本哈希：`310fb539541f55dd67cde2727cc43dccf0e74a0d0c2fb70293faa27b415f0860`
- 规模：10 个可用标定角色 × base/active × 30 轮，共 20 场
- 覆盖：10/10；未覆盖 无
- active 注入：10/10；未注入 无
- 评委：Doubao Seed 2.1 Pro（`doubao-seed-2-1-pro-260915`） / MiniMax M3（`MiniMax-M3`）
- 协议：`register-v1-paired`；状态：`ai_proxy_candidate`

> 本报告是 AI 代理盲评，不是真人语言学/督导师验收；只评“用词是否贴合社会语域”，不评诊断与疗效。

## 结论

**跨角色方向一致，但证据仍有限**

判定口径是预注册的：跨 10 个标定角色看方向一致性，实际覆盖 10 个；同时检查刻板化、跨轮稳定、BDI 护栏、助手腔/术语/建议式回归和成本；不以平均句长作主指标。

## 门槛

| 门         | 结果 | 关键数字                                                                                                                                         |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 角色覆盖   | ✅   | 10/10 已标定角色；缺 0                                                                                                                           |
| 注入正确   | ✅   | active 10 场全覆盖 / base 0 场命中                                                                                                               |
| 跨角色方向 | ✅   | 9 角色占优（阈值 8），中位 Δ 1.75                                                                                                                |
| 刻板安全   | ✅   | 10 角色 ≥4（阈值 9），下降 0                                                                                                                     |
| 跨轮稳定   | ✅   | 10 角色 ≥4（阈值 8），漂移达标 10                                                                                                                |
| BDI 护栏   | ✅   | 0 轮不一致                                                                                                                                       |
| 不回归     | ❌   | 越界 2 项：`vpt_workplace_intellectualization_l1` abstractTermRate 0.00→0.51；`vpt_self_worth_intellectualization_l1` abstractTermRate 0.00→0.15 |
| 成本       | ❌   | prompt 12.8%，p95 32.1%                                                                                                                          |

## 注入覆盖拆分

- 可注入：10 个角色；active 占优 9/10；可注入集合的中位 `register_fit` Δ 1.75。
- 未注入：无；全部角色 active 都带语域块，active 与 base 的差异可以计入机制证据。

## 逐角色

| 角色                                    | 方向   | active/base/tie | 语域贴合 base→active (Δ) | 刻板安全 | 跨轮稳定 | 具体度 | 标志词命中 base→active | 锚点密度 base→active | prompt 字符 base→active | BDI 不一致轮 |
| --------------------------------------- | ------ | --------------- | ------------------------ | -------- | -------- | ------ | ---------------------- | -------------------- | ----------------------- | ------------ |
| `vpt_intimate_avoidance_l1`             | active | 2/0/0           | 3.00 → 4.50 (1.5)        | 5.00     | 5.00     | 4.00   | 0.0% → 0.0%            | 0.00 → 1.28          | 2417 → 2906             | 0            |
| `vpt_workplace_intellectualization_l1`  | active | 2/0/0           | 3.50 → 4.00 (0.5)        | 5.00     | 4.50     | 4.00   | 0.0% → 0.0%            | 0.00 → 0.37          | 2376 → 2626             | 0            |
| `vpt_parenting_projection_l1`           | active | 2/0/0           | 2.00 → 4.00 (2.0)        | 5.00     | 4.50     | 5.00   | 0.1% → 0.0%            | 0.00 → 0.48          | 2591 → 2982             | 0            |
| `vpt_grief_avoidance_l1`                | active | 2/0/0           | 2.50 → 5.00 (2.5)        | 5.00     | 5.00     | 5.00   | 0.0% → 0.1%            | 0.00 → 1.34          | 2042 → 2909             | 0            |
| `vpt_self_worth_intellectualization_l1` | active | 2/0/0           | 2.50 → 4.00 (1.5)        | 5.00     | 5.00     | 5.00   | 0.1% → 0.1%            | 0.00 → 1.41          | 2792 → 2858             | 0            |
| `vpt_social_anxiety_avoidance_l1`       | active | 2/0/0           | 2.00 → 4.50 (2.5)        | 5.00     | 5.00     | 4.50   | 0.2% → 0.2%            | 0.00 → 1.99          | 2817 → 2429             | 0            |
| `vpt_general_secure_l1`                 | active | 2/0/0           | 3.50 → 4.50 (1.0)        | 5.00     | 4.50     | 4.50   | 0.0% → 0.1%            | 0.43 → 0.76          | 2752 → 3085             | 0            |
| `vpt_social_anxious_l1`                 | tie    | 1/1/0           | 4.50 → 4.50 (0.0)        | 5.00     | 4.50     | 5.00   | 0.0% → 0.1%            | 0.83 → 1.10          | 2703 → 2803             | 0            |
| `vpt_depression_avoidant_l1`            | active | 2/0/0           | 2.00 → 5.00 (3.0)        | 5.00     | 5.00     | 4.50   | 0.1% → 0.1%            | 0.00 → 1.24          | 2404 → 2931             | 0            |
| `vpt_trauma_disorganized_l1`            | active | 2/0/0           | 2.50 → 4.50 (2.0)        | 4.50     | 5.00     | 4.00   | 0.0% → 0.0%            | 0.00 → 0.57          | 2527 → 2871             | 0            |

## 摘要

- 方向：9/10 个角色 active 优于 base；语域贴合中位 Δ = 1.75。
- 刻板安全：10/10 个角色 active 的 `stereotype_risk` 均值 ≥ 4；下降超过 0.5 的角色 0 个。
- 跨轮稳定：10/10 个角色 active 的 `cross_turn_stability` 均值 ≥ 4；后 10 轮标志词命中达标 10/10。
- 护栏：BDI 不一致 0 轮；crisis 与事件分类按场记录在 `analysis.json`。
- 成本：prompt 字符中位 12.8%；p95 延迟中位 32.1%。

## 限制

- 只做 AI 盲评，未做真人语言学/督导师验收；status=ai_proxy_candidate。
- 评委中的 MiniMax 与来访者渲染模型同族，存在自偏好风险；主判为不同厂商的 Doubao。
- 库内只有 10 个 approved character_profiles 可开调试会话；未覆盖角色：无。
- active 注入覆盖全部参评角色。
- 每个角色每个模式只跑 1 场，跨角色方向可看，重复性方差未测。
- 只覆盖已标定角色，不外推到未标定角色。
- 只测文本，不测 TTS/ASR 听感。

## 判定

方向可继续投入，但不能对外称机制稳定；先定位未过门的角色/维度，再补重复或长会话。

## 与 AF-465 的差异

- 覆盖从 8/10 提到 10/10：`vpt_parenting_projection_l1`、`vpt_social_anxiety_avoidance_l1` 已建 profile 行。
- 注入从 4/8 提到 10/10：4 个 B 类角色的 `speech_register` 已随内容 seed 落库，两个新角色随 A 类 seed 落库。
- 方向从 5/8 提到 9/10，中位 `register_fit` Δ 从 0.75 提到 1.75；`vpt_general_secure_l1` 从 AF-465 的 base 占优变为 active 2/0。
- 刻板与稳定仍满：10/10 角色 `stereotype_risk` ≥ 4、0 下降；10/10 角色 `cross_turn_stability` ≥ 4、后 10 轮标志词达标 10/10。
- 新暴露两处未过门：`abstractTermRate` 在 2 个理智化角色上升；p95 延迟中位 +32.1%。

## 两处未过门怎么读

**1. abstractTermRate 只在两个理智化角色上升。** `vpt_workplace_intellectualization_l1` 0.00→0.51、`vpt_self_worth_intellectualization_l1` 0.00→0.15；助手腔、建议式、标签化、术语四项全部为 0，没有其他回归。这两个角色的语域标定本身允许较高抽象预算（`abstractTermBudget` 0.62 / 0.58），active 后更像“用分析和自评语言讲感受”的人。这是**角色像不像**与**noHarm 绝对阈值**的冲突，不是渲染块把来访者写成咨询师。是否给理智化角色单列抽象预算，属于产品口径决策；本任务不改门槛、不擅自放宽。

**2. p95 延迟中位 +32.1%。** prompt 字符只增加 12.8%，但 10 个角色里 9 个 active 的 p95 高于 base。语域块确实增加了 prompt 长度与生成长度，但增幅明显高于 prompt 增幅，不能只用“多了一段字”解释。需要单独做性能归因（缓存、流式首包、块长度、模型侧波动），不能靠放宽成本门掩盖。

## 机制结论

按预注册门槛，10 个角色上的结论是：

- **有效方向成立**：注入 10/10、方向 9/10、刻板 10/10、稳定 10/10、BDI 护栏 0 不一致；语域贴合中位 Δ 1.75。
- **不能判“机制稳定”**：不回归门因 2 个理智化角色的抽象词率上升而失败，成本门因 p95 延迟 +32.1% 而失败。
- 唯一方向未占优的是 `vpt_social_anxious_l1`（1/1 tie，Δ 0.00，base/active 均 4.50），属于高分天花板，不是 active 变差。
- 因此准确说法是“**10 角色覆盖与注入已补齐，方向与稳定性证据明显增强；但两项非方向性门槛未过，尚不能称机制稳定**”。

## 下一步建议

1. 先定 abstractTermRate 口径：理智化角色是否允许角色级抽象预算；若不允许，收窄这 2 个角色的 `vocabulary.abstractTermBudget` 或渲染约束。
2. 单独做 active 延迟归因；在未定位前不扩大灰度。
3. 对 10 角色补第二场重复，测方差；当前每角色每模式仍只有 1 场。
4. 保持 `VISITOR_REGISTER_MODE` 默认 off，按角色灰度，不因本次方向结果全局开启。

## 交付记录

- 任务：`AF-466`；分支 `task/AF-466-register-assets`；代码基线 `28aa06c1dbfe9f35acda47fb62c18c0c25a08f01`。
- 资产改动：
  - `character-profile.seed.ts`：A 类从 4 个扩到 6 个，新增阿禾 / 小舟的信念、愿望、约束、敏感议题与 5Ps。
  - `character-baseline-calibration.ts`：标定表从 8 行扩到 10 行，新增两行的数值、标签与台词指纹。
  - `character-profile.db-only.seed.ts`：B 类内容 seed 的 `baselineOf` 增加 `speechRegister` 装配。
  - `bin/seed-character-profiles.ts`：执行说明同步到 A 类 6 / B 类 4。
  - 角色资产相关单测从 8 角色口径升级到 10 角色口径，并新增 B 类语域装配断言。
- seed 证据：首次 `pnpm seed:character-profiles` → A 类新增 2 / 未变 4，B 类更新 4 / 未变 0，基线校准更新 0 / 未变 4 / 缺失 0；第二次全部 unchanged。只读查询确认 10 行全部 `approved + enabled + speech_register 非空`。
- 评测证据：`run-sessions` 20 场、600 轮、失败轮 0；`manifest.taskId=AF-466`，脚本哈希与 AF-465 相同；`judge-sessions` 双评委 20 次盲评，首次 Doubao 在 `vpt_social_anxious_l1` 连续超时，改用 `--reuse-raw` 复用已成功 raw 并延长超时到 240s 后完成，未丢失已评角色。
- 闸门：角色资产 7 个 spec 127 用例全绿；typecheck 0 error；lint 0 error；`pnpm test` 4924 passed / 1 failed / 4 skipped，唯一失败是既有 `af427-operator-delta-ledger` 本地 `data/debug-sessions` 语料漂移（断言 34/31，实际 45/42），与本任务改动无调用关系；`git diff --stat HEAD -- src/engine-core` 为空。
- 隐私：原始台词、prompt、judge 原始响应只在本地 `data/eval-reports/visitor-register-stability/af466-2026-11-24-10roles/`（gitignored），仓库只提交聚合报告。
