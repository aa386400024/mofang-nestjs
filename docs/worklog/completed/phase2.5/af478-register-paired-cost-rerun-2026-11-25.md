# AF-478 · 10 角色 paired 600 轮 p95 成本门评测报告

- 运行时间：2026-11-25 00:51–01:05（UTC+8）
- 数据目录：`data/eval-reports/visitor-register-stability/af478-2026-11-25-10roles/`（gitignored，只含聚合指标与原始逐轮 trace，不把台词写进仓库）
- 跑法：单进程 3010，`run-sessions.mjs --paired --port 3010 --task-id AF-478`
- 规模：10 角色 × base/active × 30 轮 = 20 场 / 600 轮；全部 30/30 完整，0 失败轮；active 每场 `registerTurnCount=30`，base 每场 0，语域块确实注入。

## 一、结论

**预注册的成本门通过，但不是“所有角色都便宜”。**

- prompt 字符中位：`+16.9%`（门 ≤25%，通过）
- 逐角色 p95 比值中位：`1.125`，即 `+12.45%`（门 ≤15%，通过）
- pooled p95：`1957.8 → 2113.7ms`，比值 `1.080`；bootstrap 95% 区间 `[1.001, 1.207]`
- 缓存命中：base `56.0%`、active `60.2%`；600 轮累计 prompt token `512,643 → 599,600`（`+17.0%`），但扣掉缓存命中后的未缓存输入只 `225,371 → 238,425`（`+5.8%`）

门按“10 角色 p95 比值的中位”判，所以结论是 **pass**。但尾部分布不能忽略：8/10 角色 active p95 更高，3 个角色超过 15%（`workplace +32.4%`、`general_secure +28.4%`、`grief +16.6%`）。企业口径应写成：**中位成本可控，尾部仍存在角色级超标，不能把它当作全角色 SLA 已通过。**

## 二、逐角色 p95 与缓存

| 角色                                    | base p95 ms | active p95 ms |         Δ% | base 缓存 | active 缓存 | base prompt tok | active prompt tok |
| --------------------------------------- | ----------: | ------------: | ---------: | --------: | ----------: | --------------: | ----------------: |
| `vpt_intimate_avoidance_l1`             |      1974.6 |        1972.5 |      -0.1% |     52.3% |       59.8% |          52,540 |            62,874 |
| `vpt_workplace_intellectualization_l1`  |      1607.1 |        2127.1 | **+32.4%** |     58.7% |       63.8% |          47,333 |            55,657 |
| `vpt_parenting_projection_l1`           |      2430.7 |        2147.0 |     -11.7% |     51.3% |       59.8% |          58,032 |            62,039 |
| `vpt_grief_avoidance_l1`                |      1992.0 |        2322.7 | **+16.6%** |     56.2% |       60.3% |          52,181 |            59,336 |
| `vpt_self_worth_intellectualization_l1` |      2098.0 |        2099.8 |      +0.1% |     51.7% |       60.3% |          54,164 |            60,609 |
| `vpt_social_anxiety_avoidance_l1`       |      1569.4 |        1771.3 |     +12.9% |     53.4% |       59.8% |          46,159 |            57,296 |
| `vpt_general_secure_l1`                 |      1652.7 |        2121.8 | **+28.4%** |     59.1% |       57.2% |          49,802 |            60,652 |
| `vpt_social_anxious_l1`                 |      1704.6 |        1909.7 |     +12.0% |     57.5% |       59.9% |          55,559 |            62,703 |
| `vpt_depression_avoidant_l1`            |      1515.3 |        1751.1 |     +15.6% |     63.3% |       60.9% |          49,756 |            58,822 |
| `vpt_trauma_disorganized_l1`            |      1775.4 |        1865.7 |      +5.1% |     57.9% |       60.9% |          47,117 |            59,612 |

注：`depression_avoidant +15.6%` 四舍五入后刚过 15%，按中位门不影响 pass，但角色级仍应列入观察名单。

## 三、延迟构成

来自 `latency-attribution.json` 的可复算拆分：

- pooled wall：p50 `1220.5 → 1277ms`，p95 `1957.8 → 2113.7ms`
- TTFT p95：`1138.3 → 1190.1ms`，比值 `1.046`
- post-TTFT p95：`963.1 → 1216.4ms`，比值 `1.263`；**增量主要发生在首字之后**
- 轮次分层 paired 中位差：1–5 轮 `-27ms`、6–10 轮 `+29ms`、11–20 轮 `+19ms`、21–30 轮 `+243ms`
- 8/10 角色 active p95 更高；p95 CV base `0.068` / active `0.077`

这说明 active 的主要代价不是“首字更慢”，而是**更长上下文进入后段解码/流式阶段后变慢，并随轮次累积**。prompt token 边际回归只解释 p95 缺口的 `49.5%`，按比例线性放大会超过 100%（`212.2%`），属于过拟合信号；不能把 p95 全部归因于 prompt 长度这一个变量。

## 四、缓存怎么解释成本

- provider 已真实上报缓存：本地探针与非流式/流式/LangChain 三条路径都取到 `cached_tokens`；本报告中的缓存值来自真实上游 usage，不是估算。
- 600 轮内 active 比 base 多 86,957 个 prompt token，其中多命中缓存 73,903 个；**新增 token 的 85% 被前缀缓存吸收**。
- 但缓存降低的是计费输入，不是解码时间：post-TTFT 仍 `+26.3%`，后 10 轮 paired 中位差 `+243ms`。因此“缓存命中高”不能拿来解释“延迟门一定过”，只能解释“输入侧计费压力比表面 token 增幅小”。
- 没有厂商 cache-read 单价，不能把 `cachedTokens` 直接折算成金额；本报告只给 token 结构与命中率，不给伪精确成本。

## 五、与 AF-466 / AF-471 的关系

AF-466 的 p95 中位是 `+32.06%`，AF-471 的 pooled p95 是 `+35.6%`。本次 paired 跑法得到中位 `+12.45%`、pooled `+8.0%`，但这**不能简单归因于“配对修复了 20 个百分点”**：

- 与 AF-466 的 base 绝对值对比，本次 base p95 中位只有上一轮的 `0.625`（范围 `0.505–0.911`），机器/上游状态已明显不同；跨 run 绝对 p95 不可直接比。
- 本次同进程逐轮配对确实消除了整场串行与双进程差异，paired 内比较更干净；但 p95 自身方差仍在，pooled bootstrap 下界 `1.001` 紧贴 1。
- 因而正确结论是：**在本次 paired 口径下成本门通过；历史失败不能直接判定为“测量假象”，只能判定为“旧口径混入了运行状态差异，无法分离”**。

## 六、决策与后续

1. 成本门按预注册中位口径记 **pass**，可在灰度决策中作为“不阻断”的证据。
2. 不宣称全角色 SLA 通过：`workplace`、`general_secure`、`grief` 三角色 p95 超 15%，`depression_avoidant` 处于边界；后续若做产品级 SLA，应按角色分档而不是只看中位。
3. 不改生产 prompt、不压语域块、不动 context budget；本轮已验证“缓存观测”可用，下一步若要把 p95 压到全角色 ≤15%，应做单变量实验：固定 base，逐项缩短 active 的后段上下文（历史轮数 / 语域块位置 / contextTokens），每次只动一个变量并复跑 paired 600 轮。
4. 保留 `cachedTokens` 为可选字段：上游没报时仍为 `null`，不拿 0 冒充；报告与看板必须区分“未上报”和“真 0 命中”。

## 七、可复现命令

```powershell
$env:PORT='3010'; $env:ENGINE_DEBUG_CHAT_ENABLED='true'; $env:VISITOR_REGISTER_MODE='active'
node dist/app.js
node scripts/eval/visitor-register-stability/run-sessions.mjs --run-id af478-2026-11-25-10roles --task-id AF-478 --paired --port 3010
node scripts/eval/visitor-register-stability/analyze-latency.mjs --run-id af478-2026-11-25-10roles --compare-run-id af466-2026-11-24-10roles
```
