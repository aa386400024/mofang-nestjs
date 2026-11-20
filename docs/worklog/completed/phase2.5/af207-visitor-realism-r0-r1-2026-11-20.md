# AF-207 · 来访者真人度 R0/R1 交付记录

- 任务：AF-207「来访者真人度 R0/R1：度量口径纠偏、输出闸门、分层 prompt 与话轮形态」（由 AF-204/205/206 scope 与资源域纠偏重签发，内容同前）
- 前序：AF-204（`scope.files` 漏登 `.env.example`）→ AF-205（执行侧资源域未含 `.env.example`）→ AF-206（Agent Card 自身不在执行侧资源域）
- 分支：`task/AF-207-visitor-realism-r0-r1`
- 基线：`f8bb141d4015cc8537c40afcc0d2a7dd268a3b37`
- 日期：2026-11-20
- 协作：主控（R1 + 场景默认 + 最终闸门/交付）+ MiniMax Code（R0 并行支线）
- 结论：R0/R1 已实现并通过全量闸门；R2—R5（生成侧能力、场景矩阵扩展、临床规则、度量与双盲验收）不在本任务范围。

## 1. 问题与根因

1. **repair 指标虚高**：旧口径用 `indexOf` 子串匹配「不是」，把「是不是」「我不是本地人」这类疑问/否定判断计成自我修正，`repair_per_turn` 系统性偏高。
2. **坏输出进逐字稿**：历史导出里出现整段 prompt 复述、字段化结构输出、JSON 摘要、未闭合推理、无标签英文推理残片；原闸门主要靠 prompt marker，覆盖面不够。
3. **场景默认不是咨询室**：未显式登记 `encounter` 时，来访者 prompt 只有「像真实的人聊天」这类泛化文案，没有面对面的场景约束；批量/旧调用路径因此容易滑向线上聊天。
4. **真人度只有目标、没有可执行层**：原 prompt 有口语化、话量、情绪、表达风格，但没有「这一轮用什么话轮形态、允许多少不流利、角色声音如何压过通用规则」的确定性分层。

## 2. 实施方案

### 2.1 R0（MiniMax 并行支线）

**repair 严格口径**

- `REPAIR_TRIGGERS` 原样保留为历史遗留宽松口径；新增严格规则集与 `countStrictRepairs` / `countLooseRepairs`。
- 只有真正的改口/重述才计：`应该是`、`换个说法`、子句开头的 `不对` / `算了`、带纠正线索的 `等等`、改口上下文里的 `不是 A 而是 B`。
- 明确不计：疑问「是不是」、否定判断「我不是本地人」、普通否定「这其实不是什么大事」、评价「你说得不对」。
- `counts.repair` / `aggregateDisfluency().typeCounts.repair` / `repair_per_turn` 统一走严格口径；历史快照不回溯、不重算。

**输出完整性闸门**

- 新增 `json_object` / `json_array` / `structured_output` / `unclosed_reasoning` / `english_reasoning` 五类 reason。
- 覆盖 JSON 对象/数组摘要、字段化结构输出、未闭合推理、无标签英文推理残片；保留原有 prompt marker、推理前缀、角色标签、外语脚本检测。
- `safeOutputFallback` 文案不变，补四个场景档案的中立性回归，避免「刚兜底又被拦一次」。

### 2.2 R1（主控）

**场景默认与显式通道**

- 来访者 prompt 的 `encounter` 缺省统一归一化为 `{ mode: 'in_person' }`：默认就是咨询室里面对面。
- 线上语音/视频/文字必须显式登记；`video` 与 `voice` 共用同步语音口径；`text` 才走文字咨询口径。
- 「说话方式」不再有「像真实的人聊天」这种无场景泛化文案；场景契约块与反 prompt 复述硬规则同时生效。

**真人度 profile（纯函数）**

- 新目录 `src/shared/realism/`，不读 env、不写日志、不落库、不新增 LLM 调用。
- 7 类角色声音：`restrained` / `emotional` / `intellectualizing` / `passive_aggressive` / `anxious_seeker` / `guarded_withdrawn` / `chaotic_disorganized`，由依恋底色、叙事风格、语态倾向确定性映射。
- 3 类场景：`in_person` / `online_voice` / `online_text`；4 个状态带：`steady` / `guarded` / `flooded` / `risk`。
- 话轮形态选择器：12 种形态（短答即停、半句停住、具体细节、问回一次、句中改口、戒备挡回、碎裂、情绪细节、含蓄带刺、落地短句、文字短句、文字碎裂），同输入永远同输出。
- 配额全部是上限，不是必须发生；风险轮六类配额归零，安全信息优先。
- prompt 优先级写死：安全 > 场景 > 角色声音 > 话轮形态 > 不流利配额。
- 允许一次短促偏移/试探性反问，但不得展开成对咨询师私人经历的盘问，消解 trauma 换话题与 intimate 问回咨询师的硬规则冲突。
- 咨询师边界档位（专家 / 家常 / 胡言乱语）不改变角色声音与场景；prompt 明确「不要模仿对方措辞、不要替对方解释、不要跟着跑题」。

**灰度与审计**

- `RENDER_REALISM_MODE` 三档：`off`（缺省，不计算不注入，与改动前逐字一致）、`audit`（计算并打审计日志，不注入 prompt）、`active`（注入 prompt，验收批次用）。
- dev 日志只打 `mode/scene/role/state/shape/maxEvents/injected`，不打印任何台词原文。
- `.env.example` 已登记 `RENDER_REALISM_MODE=off`，部署契约测试通过。

## 3. 改动文件

| 文件 | 类型 | 归属 |
| --- | --- | --- |
| `src/auto-practice/metrics/disfluency-lexicon.ts` | 改 | R0 |
| `src/auto-practice/metrics/disfluency-analyzer.ts` | 改 | R0 |
| `src/shared/text/output-integrity.ts` | 改 | R0 |
| `test/auto-practice/metrics/disfluency-analyzer.spec.ts` | 补 | R0 |
| `test/auto-practice/af204-output-integrity-shape.spec.ts` | 新增 | R0 |
| `src/shared/realism/turn-shape-selector.ts` | 新增 | R1 |
| `src/shared/realism/visitor-realism-profile.ts` | 新增 | R1 |
| `src/shared/realism/index.ts` | 新增 | R1 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 改 | R1 |
| `test/auto-practice/af204-realism.spec.ts` | 新增 | R1 |
| `.env.example` | 改 | R1 部署契约 |
| `docs/team/agent-orchestration/agent-cards/executor.json` | 改 | 执行侧资源域补齐 `.env.example` |

未触碰：`src/engine-core/**`、`admin-dashboard/**`、Flutter 仓库。

## 4. 闸门（真实执行）

| 命令 | exit | 结果 |
| --- | --- | --- |
| `pnpm exec vitest run test/auto-practice/metrics/disfluency-analyzer.spec.ts test/auto-practice/af204-output-integrity-shape.spec.ts` | 0 | 2 files / 50 tests passed |
| `pnpm exec vitest run test/auto-practice/af204-realism.spec.ts` | 0 | 1 file / 10 tests passed |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm exec eslint --no-cache "{src,test}/**/*.ts"` | 0 | 0 error / 0 warning |
| `pnpm test` | 0 | 226 files passed / 1 skipped；3995 tests passed / 4 skipped；21.05s |
| `git diff --stat HEAD -- src/engine-core` | — | 空 |

机器状态：Node `v22.23.2`，pnpm `9.15.0`；项目声明 `node >=26`，pnpm 输出 Unsupported engine 警告，但命令均正常执行。全量测试期间无 `nest start --watch` / `vite dev` 长驻进程。

### 历史导出复核（两份用户提供文件）

用更新后的输出闸门、按默认面对面场景扫描来访者台词：

| 文件 | 来访者台词 | 命中 | 命中原因 |
| --- | --- | --- | --- |
| `auto-practice-FzkJ9Z15n10nNUed1hWv_.json` | 52 | 1 | `prompt_marker` + `structured_output` |
| `auto-practice-fJI3UtvAl6u1Ss34JViWq.json` | 17 | 0 | — |

说明：历史文件没有 `encounter` 字段，按产品新默认（面对面）扫描；命中样本是整段「关键事件/情绪转折点/你心里坚信」的 prompt 复述，新闸门会拦掉并走安全兜底。场景「像线上聊天」主要是 prompt 缺省无场景约束，不是媒介词泄漏，已由 R1 默认 `in_person` 修复。

## 5. 运行口径

- 默认：`RENDER_REALISM_MODE=off`，行为与改动前逐字一致；场景默认仍是面对面。
- 影子批次：`RENDER_REALISM_MODE=audit`，只算不注入，日志可核对 `role/state/shape/maxEvents`。
- 验收批次：`RENDER_REALISM_MODE=active`，才注入真人质感块。
- 线上场景：显式传 `encounter={ mode:'online', channel:'voice'|'video'|'text' }`；不传就是 `in_person`。
- 回滚：把 `RENDER_REALISM_MODE` 置回 `off` 即可，不需要回滚代码。

## 6. 残留与下一步

1. **R2—R5 未实施**：生成侧能力（真实口语事件注入/重试）、场景矩阵扩展、临床规则细化、度量与 AI 双盲验收仍在后续任务；本记录不宣称「临床有效性验收」，只到「临床代理门槛 + 工程闸门」。
2. **repair 口径断代**：`counts.repair` 语义收紧，新旧批次 `repair_per_turn` 不可直接对比；历史快照未回溯、未重算。
3. **`让我想想……` 取舍**：按任务书要求会被判 `unclosed_reasoning`；如果未来确认它是正常口头禅，需要单独放行「已说完」的句式，而不是放宽整类。
4. **R1 默认不注入**：`active` 需要显式开启；这是灰度纪律，不是漏接。验收批次必须确认 env 已切到 `active`，否则看到的仍是旧 prompt。
5. **历史文件无场景字段**：按新默认面对面扫描只能证明「闸门能拦住坏输出」，不能反推历史场次当时是线上还是线下；场景归因要看新批次显式 `encounter`。

## 7. MiniMax 回执

- 回复原文：`docs/worklog/pending/archive/relay-response-AF-204-20261120-2141.md`
- R0 自测：定向 50 tests passed；下游 88 tests passed；`pnpm typecheck` exit 0；R0 五文件 eslint exit 0。
- 主控已复核其改动并统一重跑全量闸门；R0/R1 合并后无冲突。

## 8. 机读交付字段

- gateResults：见 §4 表；全量 `pnpm test` 3995 passed / 4 skipped，lint/typecheck 均 exit 0。
- scopeCheck：in-scope。`.env.example` 是新增 env 键的部署契约，已纳入 AF-206 scope；执行侧 Agent Card 资源域同步补齐。
- contractChecks：taskId 贯穿任务单/回执/记录；状态面只经 CLI；回执六组齐全；engine-core 零 diff。
- backlogItems：R2—R5 生成侧能力、场景矩阵扩展、临床规则、度量与 AI 双盲验收未实施；repair 口径断代；`让我想想……` 误伤率待观察。
- deviationTable：AF-204/205 因 scope 与执行侧资源域漏项被取消，AF-206 重签发；代码内容不变，仅补授权与记录链。
- reviewVerdict：passed（机读护栏全绿，残留项已登记 backlog）。
