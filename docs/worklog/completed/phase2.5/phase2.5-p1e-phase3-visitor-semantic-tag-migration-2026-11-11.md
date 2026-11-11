# P1e-3 · visitor prompt 语义标记迁移（厂商标记 → 语义标记；离线灰度先行）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](p1e3-visitor-semantic-tag-migration-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/phase2.5-visitor-semantic-tag-migration-snippet.md`（§二替换文本 / §三停顿纪律 / §四情绪纪律 / §五五条纪律 / §七迁移纪律）；`src/agent/visitor/visitor.prompts.ts:84-99`；`src/auto-practice/utils/semantic-tag-parser.ts`；`docs/reference/minimax-t2a-api.md`
> 任务性质：prompt 文案迁移（适配层业务代码；不改解析器 / TTS 适配器逻辑）
> 改动范围：后端 `src/agent/visitor/visitor.prompts.ts`（+ 必要的离线对比脚本 / 运行说明）；不含前端；解析器与适配器保持现状

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md`；2. `docs/README.md`；3. `docs/team/conventions.md`（§1.1 边界、§三 硬约束、零压红线）
2. 阶段入口：`phase2.5-README.md`；事实源：迁移 snippet 全文 + P1e Phase2 交付记录（`docs/worklog/completed/phase2.5/wp-j-p1e-semantic-wiring-offline-2026-11-10.md`）
3. 本任务单

---

## 1. 背景（先读，方向别错）

P1e Phase2 已落地语义标记解析链：LLM 输出语义标记 `[sigh] [pause:0.5] [emotion:sad]`，由 `SemanticTagParser` 统一解析（模糊纠正 + 归一化 + 三级降级），再由 TTS 适配器映射回厂商格式；解析降级级别已落库（`visitor_semantic_level`）。

**待迁移的最后一块**：visitor prompt 里 `DIFFICULTY_TAG_FREQ` 仍让 LLM 直接输出厂商标记 `(sighs) (breath) (laughs) (sniffs) (humming) (chuckle) (emm)`（visitor.prompts.ts:84-99）。本单按 snippet §二把它换成语义标记形态，并补停顿 / 情绪标记纪律。

### 关键现状（已核对，别当新问题）

- 解析器：`src/auto-practice/utils/semantic-tag-parser.ts`（语义层目前认 5 个情绪值 sad / calm / fearful / angry / happy；`disgusted` / `surprised` 官方白名单内但语义层暂不表达，会被丢弃并记 warning —— 口径见 snippet §四注）。
- 合法语义标记白名单：`[sigh] [breath] [inhale] [emm] [laugh] [pause:x] [emotion:x]`；情绪合法值 7 个：happy / sad / angry / fearful / disgusted / surprised / calm；`neutral` 非法（snippet §五）。
- 两套标记不可混用：混用会让「标记来源」在 `semanticJson` 里不可观测（snippet §七）。
- **灰度纪律**：这是在线对练的生产 prompt，改动会影响所有真实会话的来访者语气；必须先在离线批量对练上对比降级率与 `[pause]` 命中率，确认无损再切在线（snippet §七）。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

1. 按 snippet §二逐字替换 `DIFFICULTY_TAG_FREQ` 三档文本（L1 / L2 / L3）：厂商标记 → 语义标记；**频率纪律与难度分层一字不动**。
2. 在 visitor prompt 组装输出中补入 snippet §三（`[pause:x]` 停顿纪律）与 §四（`[emotion:xxx]` 情绪纪律）两段规则文本；位置与既有 tag 频率段同级，措辞以 snippet 为准。
3. 按 snippet §五五条纪律核对 prompt 全文：不出现厂商格式 `(sighs)` / `<#0.5#>` 教学；情绪值白名单 7 个；停顿句中、每轮最多一个；标记闭合；一轮一个情绪。
4. **离线灰度对比**：提供可执行的离线批量对比方式（脚本或运行说明）——跑一批离线对练，对比新旧两套 prompt 的解析降级率（`visitor_semantic_level` 分布）与 `[pause]` 命中率；指标口径写进交付记录。若仓库已有离线批次入口则复用，不新造 LLM 调用链。
5. 核对解析器对新标记形态的覆盖：确认 snippet 白名单内每个标记 parser 都能认领；parser 不支持的标记列清单进遗留项（不在本单改 parser）。

**明确不在范围内（禁止顺手做）：**

- 不改 `SemanticTagParser`、不改 TTS 适配器映射、不动 `visitor_semantic_level` 落库口径。
- 不调整难度分层、不改角色 systemPrompt 其他段落、不新增情绪 / 语气词枚举到解析层。
- 不碰 DB / migration / engine-core / 前端 / Flutter；`boundary.spec.ts` 不许改。
- 不在本单做在线切换决策；在线放量由用户看过离线对比指标后拍板。
- 不自动 commit / push。

---

## 3. 目标架构 / 交付物

- **交付物 1：prompt 文本迁移** —— `visitor.prompts.ts` 的 `DIFFICULTY_TAG_FREQ` + 停顿 / 情绪纪律段；纯文案常量，无运行时逻辑改动。
- **交付物 2：离线对比产物** —— 对比脚本或运行说明（批次入口、指标：降级率分布、`[pause]` 命中率、情绪标记命中率）；离线批次结果记录在交付记录（若本环境跑不了 LLM 批次，写明阻塞原因与用户执行步骤，不留「待用户执行」的闸门空项）。
- **交付物 3：测试** —— 既有 visitor / parser 定向 spec 保持绿；如 prompt 常量有快照 / 文本断言 spec，同步更新断言到新文本。

> **口径真相源**：标记白名单与情绪合法值唯一真相源 = snippet §四 / §五 + parser 实际认领清单；prompt 文案不得发明白名单外标记。

---

## 4. 红线（违反即返工）

- 只改 prompt 文案常量；不引入 env 读取、网络、DB 副作用到 visitor 模块内核部分；`git diff --stat HEAD -- src/engine-core` 为空。
- 两套标记不混用：新 prompt 文本中不得残留厂商格式教学；交付记录附全文 grep 证据（`(sighs)` `(laughs)` 等在 prompt 常量中已清零）。
- 不发明临床 / 情绪数值；情绪标记参数口径与 parser 现状一致，不扩解析层支持值。
- 心理对话原文不进日志；不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范：一律 pnpm，禁止裸 npx。

### 5.1 日常内循环

- `pnpm test:related -- src/agent/visitor`；parser 定向：`pnpm exec vitest run test/auto-practice`（按既有 parser spec 路径）；lint：`pnpm lint`。

### 5.2 收尾全量闸门

| 闸门        | 命令                                                                          | 要求                                                   |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`                               | 0 error                                                |
| Lint        | `pnpm lint`                                                                   | 0 error，记 warning 数                                 |
| 测试        | `pnpm test`                                                                   | 全绿，记用例总数（基线 2947：2942 passed + 4 skipped） |
| engine-core | `git diff --stat HEAD -- src/engine-core`                                     | 空                                                     |
| 任务特有    | prompt 常量残留厂商格式 grep：`(sighs) (laughs) (chuckle) (sniffs) (humming)` | 0 命中（新文本内）                                     |
| 任务特有    | 离线对比：降级率分布 + `[pause]` 命中率（或阻塞说明 + 用户执行步骤）          | 记录在案                                               |

---

## 6. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/p1e3-visitor-semantic-tag-migration-2026-11-11.md`

1. 一句话总结；2. 实际改动 vs snippet 方案偏差；3. 改动文件清单；4. 闸门表真实数字；5. 离线对比指标（或阻塞原因 + 步骤）；6. parser 覆盖核对清单 + 未支持标记遗留；7. 在线切换前置条件（用户复核离线指标）。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 路径
- [ ] 任务单移到 `completed/phase2.5/`，状态 `✅` 并链接记录
- [ ] 回写 wp-list / README 阶段表中 P1e Phase3 条目
- [ ] 回写 snippet 文档状态（标记「prompt 已迁移，在线切换待离线指标复核」）
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交分组核对：只含本单文件
- [ ] commit message 草稿（不自己 commit/push）

---

## 8. 回复输出约定

1. 「已写入交付记录」+ 路径；2. 闸门真实数字；3. §7 进度与遗留（含在线切换待办）；4. 不贴 diff 全文。
