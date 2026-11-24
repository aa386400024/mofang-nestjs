# AF-471 交付记录：语域块 p95 归因与重复方差初估

- 任务：AF-471（`phase2.5-visitor-register-eval`）
- 分支：`task/AF-471-register-latency-attribution`
- 基线：`3d0b4399ef3f7f82b815d7a9ff2f25c8f38fdc53`
- 日期：2026-11-24

## 改动文件

| 文件                                                                               | 说明                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scripts/eval/visitor-register-stability/latency-attribution.mjs`                  | 纯函数：分位数/分布、块长度与位置提取、回归、bootstrap、尾部集中度、角色聚合          |
| `scripts/eval/visitor-register-stability/analyze-latency.mjs`                      | 只读 CLI：读 AF-466 sessions/manifest，输出聚合 `latency-attribution.json` 与终端摘要 |
| `scripts/eval/visitor-register-stability/__tests__/latency-attribution.spec.mjs`   | 8 条单测，不读真实评测目录、不发网络                                                  |
| `scripts/eval/visitor-register-stability/README.md`                                | 增加延迟归因命令与边界                                                                |
| `docs/worklog/completed/phase2.5/af471-register-latency-attribution-2026-11-24.md` | 报告：结论、证据、机制假设、重复方差、最小实验矩阵、限制                              |
| `docs/worklog/records/phase2.5-visitor-register-eval/AF-471/`                      | 任务单与后续机读回执                                                                  |

## 关键设计决策

- **只读既有产物**：全部数字来自 `sessions/<role>/<mode>.json` 的 `wallMs`、`llmUsage.promptTokens/completionTokens/ttftMs`、`promptFull.length` 与语域块位置；不新增模型调用，不读取/输出心理原文。
- **块长度用行边界，不用全文后缀**：块从「你说话的样子（只影响用词…）」行开始，到下一个空行结束；避免把后续 V5 段算进块长度。
- **p95 与 p50 分开**：报告同时给 pooled p95 和 10 角色 p95 比值中位，避免把两种口径混用；成本门仍按原预注册口径（角色比值中位）。
- **归因不把相关性写成因果**：prompt token 回归系数只作为边际成本下界；另外给“按 prompt 比例线性放大”的上界，两者都不到 p95 缺口的一半，才判 prompt 单因素不成立。
- **重复方差用三层近似**：30 轮内部 bootstrap、10 角色中位比值 bootstrap/留一、同脚本无块历史 base 对照；明确说明没有真正的第二场，不能宣称方差已测。
- **不修改生产实现**：未改 `src/engine-core`、未改生产 prompt、未放宽 15% 成本门或 noHarm 阈值。

## 关键结果

- pooled wall p50：1761 → 2059ms（+16.9%）；p95：2888.7 → 3917ms（+35.6%）。
- 10 角色 p95 比值中位：1.321（+32.1%）；bootstrap 95% 区间 `[1.144, 1.510]`；9/10 角色 active 更高。
- prompt 字符中位 +12.8%；prompt token 中位 +17.3%；按回归边际成本只解释 p95 缺口的 6.8%，按比例线性放大也只解释 36%。
- TTFT p95 +6.3%，post-TTFT p95 +43.7%；每 completion token 的 post 时间 +34.9%。
- 配对轮差：1–5 轮 +2ms；6–10 轮 +210ms；11–20 轮 +358ms；21–30 轮 +723ms。
- active 超过 base p95 的轮次 75/300（25%）；top5% 慢轮只占超基线时间 20.8%，不是少数离群点。
- 同脚本、base 无块的历史 run：本次/历史 base p95 中位 1.622（范围 0.853–1.752），prompt token 只差 1.028 倍；绝对 p95 的 run 间波动 >60%。

## 闸门

| 闸门             | 命令                                                                                                  | 结果                |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| 延迟归因单测     | `pnpm exec vitest run scripts/eval/visitor-register-stability/__tests__/latency-attribution.spec.mjs` | 8 passed / 0 failed |
| 归因脚本语法     | `node --check scripts/eval/visitor-register-stability/analyze-latency.mjs`                            | exit 0              |
| Lint             | `pnpm lint`                                                                                           | 0 error             |
| Typecheck        | `pnpm typecheck`                                                                                      | 0 error             |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core`                                                             | 空                  |

## 偏差与遗留

- 任务单要求的“重复运行方差”只能做近似估计，没有实际第二场；报告中已把它标为“初估”，并给出 2–3 场重复的最低配置。
- 现有产物没有服务端逐 chunk 时间戳、队列等待、prompt cache 命中，因此 post-TTFT 不能继续拆分；这是定向实验要补的观测项。
- 编排执行备注：本轮 `run-once` 抢远端锁时 `git push` 长时间挂起，恢复后任务已进入 `submitted`；该远端锁问题与 AF-471 代码无关，建议另立基础设施任务处理，不在本任务 scope 内顺手改。
