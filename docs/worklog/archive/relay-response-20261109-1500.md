# Phase2.5 WP-G · 自动对练对话质量修复 · 交付回复

> **交付日期**：2026-11-09 · **任务单**：[WP-G 对话质量修复任务单](wp-g-dialogue-quality-fix-task.md)
> **完整交付记录**：[phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md](../completed/phase2.5/phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md)

---

## 一、结论先行

8 项改动**全部落地**，三条闸门**实测全绿**，engine-core **零改动**。

但有一条比代码本身更重要的结论必须先说：**P0「来访者话术重复率 95.9%」的真正主因不是 prompt 措辞弱，
而是上游 429 → 渲染链整场降级**。396 场里 TOP4 来访者话术（合计 96.0%）**逐字等于**渲染层降级兜底池
（`render-adapter.config.ts:150-155` 的 4 句）。所以改动 6/7/8 只能改善「LLM 正常出话时」的句式多样性，
**覆盖不到降级态** —— 想让重复率真的降下来，必须同时接 WP-D 修复清单的 **P1-3（降级比例超阈值判 failed）**
+ 429 退避 + 批量限并发。这一条我写进了交付记录 §五 风险 1，也是本次最重要的建议。

---

## 二、改了什么

### 第一波 · 适配层（`src/auto-practice/`）

| # | 改动 | 文件 | 落地方式 |
|---|---|---|---|
| 1 | `FALLBACK_REPLY` 单句 → 5 句兜底池 | `counselor-agent.service.ts` | `FALLBACK_REPLIES` + `pickFallbackReply()`：随机取用 + **主动避开上一句**（保证相邻两次兜底必不同） |
| 2 | nonsense 模式 prompt 强化 | `seeds/counselor-modes.seed.ts` | 补 3 个「不在状态」跑题示例 + 明确「不要用被动倾听式回应」 |
| 3 | 咨询师复读检测 | `practice-runner.service.ts` | `lastCounselorText` + `counselorRepeatStreak`，与来访者**同一套** `isNearDuplicate` 口径，连续 3 轮复读判停滞 |
| 4 | 停滞检测阈值调低 | `practice-runner.service.ts` | `isNearDuplicate` 由 2 层扩到 **4 层**（完全相同 / 长文复读 / 字符 3-gram / 语义近似） |
| 5 | 咨询师危机应对协议 | `counselor-agent.service.ts` | 新增 `CRISIS_PROTOCOL`，拼在收尾纪律**之后**，含四要素 + 危机轮输出 `[[STATE:MORE]]` |

### 第二波 · 渲染层 prompt（`src/engine-adapters/rendering/turn-render-orchestrator.ts`）

| # | 改动 | 落地方式 |
|---|---|---|
| 6 | `VARIATION_INSTRUCTION` 升级为硬约束 | 「你可以有一点变化」→「**不要重复最近几轮用过的句式**：换个角度、换个措辞表达同一个意思」 |
| 7 | 硬规则加第 5 条 | `5. 不要重复你之前说过的句式和表达，根据当前对话内容灵活组织语言。`（追加在末尾，前 4 条逐字不动） |
| 8 | `STRATEGY_LABEL.resistance` 细化 | `回避与抵抗（话少、不愿深入、转移话题）`（其余 7 个标签**逐字不变**） |

### 测试

- **新增** `test/auto-practice/dialogue-quality.spec.ts`（8 例，含任务单验收对）
- **新增** `test/auto-practice/counselor-agent.spec.ts`（5 例：兜底多样性 + 危机协议）
- **新增** `test/engine-adapters/wp-g-render-prompt.spec.ts`（8 例：改动 6/7/8 + 零回归底线）
- **改** `test/auto-practice/practice-runner.spec.ts`（mock 改逐轮变化 + 新增「咨询师复读 → stagnant」用例）
- **同步** `test/engine-adapters/wp7-turn-render.spec.ts`（4 处钉死的旧 prompt 文本断言）

---

## 三、闸门结果（全部实跑，数字不是估的）

| 验收项 | 命令 | 期望 | **实际** |
|---|---|---|---|
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | 0 错 | ✅ **0 错**（exit 0，无输出） |
| ESLint | `npx eslint src/auto-practice src/engine-adapters/rendering` | 0 error | ✅ **0 error / 0 warning**（exit 0，无输出） |
| 任务单单测 | `npx vitest run test/auto-practice test/engine-adapters/wp7` | 全绿 | ✅ **5 文件 / 66 例全绿**（2.7s） |
| 渲染层回归面 | `npx vitest run test/engine-adapters` | 全绿 | ✅ **60 文件 / 1087 例全绿**（35s） |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core` | 空 | ✅ **空** |
| 全量回归 | `npx vitest run` | 全绿 | ⚠️ **4 failed / 2542 passed / 19 skipped**（158 文件） |

**关于全量那 4 处失败**：全部在 `test/admin-debug/`，**本次一行未碰**，且都指向大炮未提交的两个文件
（`admin-debug.controller.ts` / `debug-session-store.ts`）—— 分别是「路由表里 `characters` 出现两次」「某端点
method 不是 GET」「超过 500 个会话时最旧的没被删」。我**没有替大炮改这些文件**，只把现象列出来。

---

## 四、10 场实测

**口径**：临时脚本起 Nest 应用上下文直接调 `PracticeRunnerService.run()`（同一条业务链路）；**并发 1 + 场间 8s**
（沿用 WP-D 测试报告 §2.3 的方法学，避免上游 429 污染数据）；只挑**有 `character_profiles` 档案**的角色 slug。
脚本跑完即删，**没留在仓库里**。

| 指标 | **改动后实测** | 396 场基线 |
|---|---|---|
| 来访者消息 | 87 条 / 87 种唯一 → **重复率 0%** | 7687 条 / 314 种 → 95.9% |
| 咨询师消息 | 87 条 / 87 种唯一 → **重复率 0%** | 7687 条 / 2657 种 → 65.4% |
| 「我在听」出现 | **0 次（0%）** | 5018 次（65.3%） |
| 渲染降级兜底命中 | **0 次（0%）** | 占来访者消息 96.0% |
| 降级轮数 | **0 轮** | 49.7% 场次带 `_heavy_degraded` |
| 停滞率 | **0%**（无漏判也无误杀） | 18.7% |

**终态分布（15 场尝试）**：`completed/max_turns` 4 场 · `completed/natural_close` 1 场 · `crisis_ended/crisis` 4 场 ·
`failed/error`（角色不存在）6 场 · `running`（LLM 调用挂起）1 场。

**三条限制（必须一起看）**：

1. **样本小、角色少**：真正跑完只有 **8 场**，只覆盖 4 个角色（角色池 17 个模板里 **13 个缺**
   `character_profiles` 档案 → 引擎开不了场，直接「角色不存在」）。本轮数字只能当「没引入复读、没误杀停滞」的
   证据，**不能当效果基线**。
2. **基线与本轮不是同口径**：基线是**重度降级**数据，本轮是**零降级**数据。改动 6/7/8 只在 LLM 正常出话时
   生效 → 本轮证明「干净数据上句式确实打散了」，**不能证明消除了基线那 96% 的复读**（那是降级造成的）。
3. **危机占比不可外推**：8 场里 4 场危机（基线 9/396 = 2.3%）—— 样本只有 4 个临床高危个案，统计上说明不了
   什么；但**危机轮普遍 5-6 轮就收场**，方向上正是改动 5 想要的。

> 对话原文属心理内容，**不进版本库**；原始指标 JSON 落在 `data/archives/wp-g-metrics-2026-11-09.json`（已 gitignore）。

---

## 五、关键偏差（任务单 → 实际做法）

1. **改动 4 必须超出「字符级 3-gram」**：验收对「我不太想现在讲清楚」/「最近确实有点难说出口」的
   1/2/3-gram Jaccard **全部 = 0.0**（零共享字符）—— 任务单指定的方法**根本过不了自己的验收对**。
   实际做成双层：字符 3-gram（保留任务单口径）+ **语义簇**（12 个表达状态簇 + 8 个话题簇 + 话题冲突检查）。
   任务单原文写的是「**比如**字符级 3-gram 算」，留了空间；这是让验收对可判的最小扩展。
   **不用 embedding**：本仓 embedding provider 都要各自 env key 才注册，MiniMax 只提供 CHAT —— 走向量会让判定
   依赖未配置的上游且本机验不了；本地词表零网络开销、确定性可测。
2. **改动 1 不能只「随机」**：纯随机相邻两次仍可能撞同一句 = 等于没改 → 加「避开上一句」，把
   「连续 10 次失败不全相同」变成**结构保证**而不是概率。
3. **改动 3 沿用现有常量**：`STAGNANT_REPEAT_LIMIT = 2` 的现有语义就是「第 3 轮复读时停」= 连续 3 轮，与任务单一致，
   不新增阈值。
4. **改动 5 放在收尾纪律之后**，并显式要求危机轮输出 `[[STATE:MORE]]`（收尾纪律要求每轮表态，但危机情境下
   收尾是错的 —— 等于把来访者一个人留在危机里）。
5. **wp7 的 4 处旧断言同步**：prompt 文本是本次既定改动对象，断言必须跟着改。
6. **runner 单测的 mock 必须逐轮变化**：原来把咨询师 mock 成每轮同一句，新复读检测会让每场都在第 3 轮判停滞
   （那是新逻辑的**正确**行为，但不是那些用例想测的）→ 改 mock + 新增专门用例。
7. **`isNearDuplicate` 改为导出**（纯函数，行为不变），只为可单测。
8. **顺手修了一处 lint**：`practice-queue.service.ts` 的数字分隔符（`7 * 24 * 3600` → `7 * 24 * 3_600`），来自
   大炮未提交的改动 —— 它会让 `eslint src/auto-practice` 闸门红，语义不变、纯格式。

---

## 六、commit message 草稿

```
feat(wp-g): 自动对练对话质量修复 — 兜底话术池 / 咨询师复读检测 / 语义近重复判定 / 危机应对协议 / 渲染层 prompt 硬约束
```

> ⚠️ 提交时**只带本次的 4 个源文件 + 5 个测试文件 + 3 份文档**。工作区里还有大炮未提交的改动
> （`admin-dashboard/*`、`src/admin-debug/*`、`src/auto-practice/auto-practice.controller.ts`、
> `src/auto-practice/practice-queue.service.ts`、`.gitignore`、`docs/worklog/pending/phase2.5-README.md`），
> **不要混入本次 commit**。

---

## 七、已知风险与后续建议

### 🔴 1 · P0 的真正主因是渲染降级，本次改动不覆盖（最要紧）

96% 的来访者「复读」是上游 429 → 渲染链整场降级造成的，不是 prompt 措辞弱。建议按序：
① 接 WP-D 修复清单 **P1-3**：降级比例超阈值直接判 `failed`，别再标 `completed/max_turns`；
② 上游 429 退避 + 批量限并发（方法学结论：并发 1 + 场间 8s 才能跑出零降级数据）；
③ **渲染层降级兜底池本身也该多句轮转**（现在也是固定 4 句，是 96% 复读的直接来源）—— 本单没做
（属于「降级语义不动」红线），建议下一单专项。

### 🟡 2 · 语义词表是工程种子值，不是临床标定

12 个表达状态簇 + 8 个话题簇是手写的常见口语说法，阈值（字符层 0.6 / 语义层 0.5）是拍出来的，需要真实语料校准。
当前设计偏保守（要求「表达状态簇有交集 **且** 话题不冲突」），但仍可能误杀合法的「同状态不同话题」表达 ——
上线后盯一下 `stagnant` 率有没有异常上升。

### 🟡 3 · 咨询师复读检测与降级兜底耦合

上游连续失败时兜底句轮转，若轮转到语义近似的两句会被判停滞。当前 5 句兜底已按语义簇**互斥**设计规避了，
**以后新增兜底句必须保持互斥**。

### 🟡 4 · 危机应对目前只是 prompt 层约束

模型仍可能不遵守。建议后续在 runner 层加**危机轮的硬校验**（危机轮必须含四要素，否则重试或告警），
把它从「提示」升级成「验收」。

### 🟡 5 · nonsense prompt 必须重跑 seed 才生效

`seedCounselorModes` 按 id upsert，改 `systemPrompt` 不会自动落库。**本次已重跑**：
`npm run seed:counselor-modes` → 新增 0 / **更新 1** / 未变 6（nonsense 已生效）。

### 🟡 6 · 本机跑应用必须用编译产物（既有问题，非本次引入）

`npx tsx src/app.ts` 在 DI 阶段就炸：`Nest can't resolve dependencies of the AuditLogProcessor (?, AuditLogRepository)`
—— `shared/infra` 的 barrel 循环依赖在 tsx 的 ESM 求值顺序下暴露；编译后的 `dist` 启动正常。
**已用 `git stash` 把本次改动摘掉复跑验证过：改动前后同样报错。** 建议单独开一单修（参照 `redis.module.ts` 里
已有的「不要用 barrel」注释口径）。

### 🔵 7 · 顺手发现的两个既有风险

1. **LLM 调用没有超时**：`llm-router.service.ts` 里 grep 不到任何 timeout 配置，实测有一场在第 8 轮后
   **单次调用挂起 > 8 分钟**，整场卡在 `running` —— 批量跑会被单场拖死。建议加**超时 + 重试上限**，
   并让 runner 层对「单轮超时」降级而不是无限等。
2. **角色池与角色档案不匹配**：`visitor_pool_templates` 17 个模板 vs `character_profiles` 只有 4 条档案 ——
   批量跑目前只有 4/17 的角色能开局。建议单独开一单补齐角色档案（或让引擎按模板兜底建档）。

---

## 八、交付物清单

| 类型 | 路径 |
|---|---|
| 源文件 ×4 | `src/auto-practice/counselor-agent.service.ts` · `src/auto-practice/practice-runner.service.ts` · `src/auto-practice/seeds/counselor-modes.seed.ts` · `src/engine-adapters/rendering/turn-render-orchestrator.ts` |
| 测试 ×5 | `test/auto-practice/dialogue-quality.spec.ts`（新）· `test/auto-practice/counselor-agent.spec.ts`（新）· `test/engine-adapters/wp-g-render-prompt.spec.ts`（新）· `test/auto-practice/practice-runner.spec.ts`（改）· `test/engine-adapters/wp7-turn-render.spec.ts`（改） |
| 交付记录 | `docs/worklog/completed/phase2.5/phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md` |
| 任务单（已归档 + 状态行 ✅） | `docs/worklog/completed/phase2.5/wp-g-dialogue-quality-fix-task.md` |
| backlog 回写 | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`（WP 清单 6 → 7 条，新增 WP-G 行 + 状态行） |
| 实测原始指标（gitignore） | `data/archives/wp-g-metrics-2026-11-09.json` |

---

_本回复内容与交付记录同步；闸门数字与实测数据均为本地实跑结果。_
