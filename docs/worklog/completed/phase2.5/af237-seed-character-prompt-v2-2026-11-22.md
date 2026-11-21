# AF-237 · Seed Character prompt V2 协作度压制 12 packet 对照

- 任务：`AF-237`（`phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-237-seed-character-prompt-v2`
- 日期：2026-11-22
- 数据：`data/phase25-exit/af237-seed-v2/`

## 结论

`seed-v2` 方向成立：在保留 seed-v1 全部硬门槛的同时，把合作指数从 `0.243056` 压到 `0.097222`，与 MiniMax 基线 A 的 `0.104167` 持平；提问率从 `0.243056` 降到 `0.097222`，与 A 完全相同。盲评均分 `3.875` 高于 C 的 `3.833333`，跨评分员绝对差从 C 的 `1` 降到 `0.583333`，4 分占比 `0.708333`（C `0.5`，A `0.5`）。

E 的 verdict 仍是 `conditional`：硬门槛 10/10 全过，软门槛只差 `cross-rater-kappa`、`mean-abs-delta`、`four-rate`。前两项是 R1/R2 系统性分数偏移（R1 均值约 `4.08`、R2 约 `3.58`），不是 E 的生成质量问题；`four-rate` 仅超线 `0.008333`。相对 C 的实质性失败项 `cooperation-vs-baseline`，E 已完成修复。

结论：**E 优于 C，可作为 prompt V2 候选进入小样本真人对照或稳定性复跑，但不直接接生产。**

## 三臂对照

| 指标 | A（MiniMax/shared） | C（Seed/seed-v1） | E（Seed/seed-v2） |
| --- | --- | --- | --- |
| 场次 / 轮次 | 12 / 144 | 12 / 144 | 12 / 144 |
| 合作指数 | 0.104167 | 0.243056 | 0.097222 |
| 提问率 | 0.097222 | 0.243056 | 0.097222 |
| 回避率 | 0.1875 | 0.319444 | 0.423611 |
| L3 短答率 | 0.270833 | 0.520833 | 0.5625 |
| 平均可见字数 | 23.45 | 18.26 | 16.37 |
| P95 首 token | 3048ms | 975ms | 1073ms |
| 原始括号动作 | 0 | 1 | 0 |
| 标记错误率 | 0 | 0 | 0 |
| 盲评均分 | 3.583333 | 3.833333 | 3.875 |
| 分数 std | 0.571305 | 0.687184 | 0.525397 |
| 4 分占比 | 0.5 | 0.5 | 0.708333 |
| 跨评分员 κ | 0.032258 | -0.107692 | 0 |
| 绝对差 | 0.833333 | 1 | 0.583333 |

## 按难度观察

- E 在 L1 的盲评均分为 `4`（A `3.375`、C `3.75`），但回避率 `0.395833` 明显高于 A 的 `0.0625`；L1 的“焦虑开放”基线被压得偏冷，是 V2 的已知副作用。
- E 在 L2 合作指数 `0.083333`、均分 `3.875`，优于 C 的 `0.3125` / `3.875`。
- E 在 L3 合作指数 `0.020833`、均分 `3.625`，低于 C 与 A 的 `4`；L3 可能被压得过于沉默。V3 或生产候选应按难度分档：L1 放松合作预算，L3 保留强防御。

## 改动

| 文件 | 改动 |
| --- | --- |
| `bin/visitor-sim-prompts.ts` | 新增 `SEED_V2_VISITOR_CONSTRAINTS` 与 `buildSeedV2VisitorPrompt`；`buildVisitorPrompt` 支持 `seed-v2` |
| `bin/visitor-sim-analysis.ts` | `SimPromptVariant` 增加 `seed-v2` |
| `bin/visitor-sim-runtime.ts` | 新增 arm E `Seed-Character/seed-v2`，A/C/D 原样保留 |
| `bin/visitor-sim-shadow.ts` | 读写支持 `seed-v2`；报告标题去掉固定 AF-232 编号 |
| `test/auto-practice/af232-visitor-shadow.spec.ts` | 新增 seed-v2 分离与压制条款测试；共 17 例 |

`seed-v2` 的核心条款：不向咨询师提问（包括反问，废止 V1 的反问额度）、不顺着咨询师措辞/假设/总结、不主动提供新事实、新回忆、新细节、每 3 轮最多 1 轮直接回答核心问题、不突然领悟、不自我总结心理机制。

## 运行与闸门

- 生成：`--mode generate --arms C,E`，24/24 场、288 轮，0 截断、0 失败。
- 基线 A：复用 AF-232 同内容 12 场，避免 MiniMax 生成侧 429；评分阶段三臂统一重评。
- 评分：`--mode score --arms A,C,E --max-packets 36 --concurrency 2`，36/36 场、72 份评分，0 failure；评分员 MiniMax-M3.1-Flash + 豆包 Seed 2.1 Lite。
- `pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts`：17/17 通过。
- `pnpm lint`：0 error / 0 warning。
- `pnpm typecheck`：exit 0。
- `pnpm test`：252 文件通过 + 1 skipped；4213 tests 通过 + 4 skipped。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差

- 首次 `--mode all` 在 MiniMax 生成阶段遇到 429（Token Plan 速率限制），无法按原计划现场生成 A 臂；改为复用 AF-232 的 A 臂 12 场同内容会话，评分阶段三臂统一重评，保证评分口径一致。
- 首次运行因 PowerShell 未加载 `.env` 报缺少 `MINIMAX_API_KEY`；改为在命令内解析 `.env` 注入环境变量，未打印任何密钥。
- `max-packets=36` 实际覆盖 36 场，而非任务单里“12 packet × 3 臂”的另一种拆法；12 场是每臂全部 4 persona × 3 难度组合，已覆盖全矩阵。

## 限制

- 12 场只够判断方向，不足以做稳定性结论；同一 packet 单次生成，没有重复采样。
- 评分员是 AI，不是真人督导师；不能替代临床验收。
- A 臂沿用 AF-232 生成内容，但本轮重新评分，分数与 AF-232 有轻微差异，属评分模型非确定性。
- 不接生产，不改 `src/agent/visitor/` 与生产 LLM 路由。
