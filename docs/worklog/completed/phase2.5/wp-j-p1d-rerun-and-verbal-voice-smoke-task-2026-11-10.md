# WP-J P1d-R2 · verbal_voice 落库后的动态验收 + P1d 正式 16 场重跑（纯验证）

> 状态：✅ 已完成（2026-11-10 夜间）｜阶段 A PASS、阶段 B 16 场跑完、判读 **FAIL**（根因是探索门槛与基线冲突，非接线）
> 执行方：MiniMax Code 启动 → 会话停滞 → 主 Agent 接手完成
> 交付记录：`docs/worklog/completed/phase2.5/wp-j-p1d-rerun-and-verbal-voice-smoke-implementation-2026-11-10.md`
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD **`d72c68e`**
> 唯一事实源：`docs/worklog/pending/phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md`（§2.2 冒烟 / §3.1 批次配置 / §3.4 对比表 / §3.5 判定）+ `docs/worklog/pending/phase2.5-verbal-voice-drafts-2026-11-10.md`
> 任务性质：**纯验证，不写业务代码**——跑批次 + 只读取证 + 出对比数字。发现 bug 只报告，不许顺手修。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

> 执行者：**先读完这些再动手**。这是固定链路，每次任务都从这里进，不要直接改文件。

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（engine-core 分层、16 条硬约束）
4. 阶段入口：`docs/worklog/README.md` → `docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. **本任务唯一事实源**：`docs/worklog/pending/phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md`
   —— §2.2（动态冒烟怎么做）、§3.1（批次配置表）、§3.4（三方对比表）、§3.5（PASS/FAIL 判据）、§五（归档纪律）
6. 上一轮同类任务的交付记录（**照它的格式写，但注意本单取证对象不同**）：
   `docs/worklog/completed/phase2.5/wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md`
7. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

### 1.1 现在是什么状态

- `d72c68e`（2026-11-10）刚把 **8 角色 `verbal_voice` 台词指纹落库**：文案作为唯一真相源写进 `CHARACTER_BASELINE_CALIBRATION`，
  A 类 4 角色经 `baselineOf()` 装配进 seed 规格、B 类 4 个随基线校准那条幂等 UPDATE 一起写。
  **已连真库核对：8 行逐字一致 8/8**，seed 连跑两次幂等。
- 但**"落库成功" ≠ "prompt 里真的有这句话"**。P1c 的教训就是"静态看着接了、跑出来根本没进 prompt"。
  所以本轮第一件事不是继续加东西，而是**用一场真实对练证明文案真的进了 prompt**。
- 同一场还能顺手把 P1d 遗留的**依恋行为块动态冒烟**一起做掉（方案 §2.2 写了但一直是"未执行"）。

### 1.2 为什么这两件事合成一张单

阶段 A（1 场冒烟）和阶段 B（16 场重跑）共用同一套前置：build 新 dist、起 3100 临时实例、入队、取证、归档。
分成两张单会重复踩一遍环境。**但阶段 B 有硬前置：阶段 A 三项取证必须全 >0，否则阶段 B 不许开跑。**

### 1.3 关键现状（已核对，别当新问题）

| 事实 | 证据 |
|---|---|
| 服务入口是 `dist/app.js` | `package.json` `main`/`start` 都是 `dist/app.js` |
| auto-practice worker **随 API 进程内启动** | `practice-queue.service.ts:127-143` `onModuleInit()` 里 `new Worker(...)` → 起 3100 就会消费队列 |
| 并发由 env 控制、夹在 1~5 | 同上 `:119-123`，`AUTO_PRACTICE_WORKER_CONCURRENCY` |
| 逐字稿落在 `data/debug-sessions/{sessionId}.json` | `debug-session-store.ts:158` `DEFAULT_DEBUG_SESSION_DIR` |
| **逐字稿里带 prompt 全文** | `debug-session.service.ts:282-288` `renderSpec.promptFull`；已实测 JSON 结构 `traces[].renderSpec.{taskKind,promptPreview,promptFull,...}` |
| 文案渲染前缀是 `你说话的味道：` | `turn-render-orchestrator.ts:1930` |
| 依恋行为块文案含 `反复确认 / 怕自己添麻烦 / 抢先说` | 方案 §2.2 给的 grep 词（`ATTACHMENT_BEHAVIOR_INSTRUCTION`） |
| 批量入队脚本已存在（直投 BullMQ） | `scripts/ops/quality/enqueue-p4-batch.ts`（可复制改常量，**但不许直接改它**） |
| 8 角色 slug | `vpt_general_secure_l1` / `vpt_intimate_avoidance_l1` / `vpt_self_worth_intellectualization_l1` / `vpt_social_anxious_l1` / `vpt_depression_avoidant_l1` / `vpt_grief_avoidance_l1` / `vpt_workplace_intellectualization_l1` / `vpt_trauma_disorganized_l1` |

---

## 2. 范围（严格遵守，不越权）

**在范围内：**
1. `pnpm build` + 确认新代码进了 `dist/`
2. 起 3100 临时实例（不动 3000）
3. 阶段 A：入队 **1 场** anxious 角色（`vpt_social_anxious_l1`，cold，maxTurns=4），只读 grep 三项取证 + DB 落库校验
4. 阶段 B：阶段 A 通过后，入队 **16 场**（8 角色 × {cold,expert}，maxTurns=12，并发 1）
5. audit 出数 + 三方对比表 + PASS/FAIL 判读
6. 归档逐字稿、关临时实例、写交付记录、回写清单

**明确不在范围内（禁止顺手做）：**
- **不改任何业务代码**。发现接线断了/bug，写进交付记录，**不要修**（修了会让"这批数据对应哪个 commit"说不清）。
- 不在 `engine-core/` 里加任何副作用；`boundary.spec.ts` 不许改。
- 不改表结构 / 不加 migration / 不加列。
- 不改 `scripts/ops/quality/enqueue-p4-batch.ts`（它是 P4 生产入口）——要改 batch_id/场数就**另存一份 `bin/tmp-*.ts`**，用完删。
- 不碰任何角色的 `enabled` / `audit_status` / `version` / 内容字段。
- 不改 admin-dashboard、不改前端（Flutter）。
- 不自动 git commit / push（写完给一行 commit 草稿，等用户指令）。

---

## 3. 执行步骤（严格按顺序，阶段 A 不过不许进阶段 B）

### 阶段 A · 1 场动态冒烟（这是本单最重要的交付）

#### A-1 确认代码 + build（最关键，跑旧 dist 会让整批数据作废）

```powershell
Set-Location E:\Work\Project\backend\mofang-nestjs
git log --oneline -1        # 必须 d72c68e 或更新
git status --short          # 期望只有未跟踪的 .tmp-annotations.json
pnpm build
```

**硬证据（别只看 build exit 0）**：确认 `d72c68e` 引入的常量真的进了编译产物：

```powershell
Get-ChildItem -Recurse -Path dist -Filter "character-baseline-calibration.js" | Select-Object -First 1 -ExpandProperty FullName
# 拿到路径后:
Select-String -Path "<上面那个路径>" -Pattern "MAX_VERBAL_VOICE_LENGTH"
```

**预期**：能搜到。搜不到 = dist 是旧的，回调 A-1 重 build。

#### A-2 起 3100 临时实例（不碰 3000）

```powershell
# 1) 先确认 3100 空
Test-NetConnection -ComputerName 127.0.0.1 -Port 3100   # 期望 TcpTestSucceeded=False

# 2) 起实例（后台、日志落文件）
$env:PORT = "3100"
$env:AUTO_PRACTICE_WORKER_CONCURRENCY = "1"
Start-Process -FilePath "node" -ArgumentList "dist/app.js" `
  -RedirectStandardOutput ".tmp-verify-3100.out" -RedirectStandardError ".tmp-verify-3100.err" -WindowStyle Hidden
```

等 10 秒，确认起来了（任选其一）：

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 3100   # 期望 TcpTestSucceeded=True
Get-Content -LiteralPath ".tmp-verify-3100.out" -Tail 20 # 期望看到 [auto_practice] queue started concurrency=1
```

**`concurrency=1` 这行必须看到**。看到 `concurrency=3` = env 没传进去，重起。

#### A-3 入队 1 场 anxious

**新建** `bin/tmp-enqueue-verify-smoke.ts`（复制 `scripts/ops/quality/enqueue-p4-batch.ts`，只改配置区）：

| 常量 | 改成 |
|---|---|
| `BATCH_ID` | `verify-verbal-voice-smoke-2026-11-10` |
| `CHARACTER_SLUGS` | 只留 `vpt_social_anxious_l1` |
| `COUNSELOR_MODE_IDS` | 只留 `cold` |
| `REPEATS_PER_COMBO` | `1` |
| `MAX_TURNS` | `4` |

```powershell
npx tsx bin/tmp-enqueue-verify-smoke.ts
```

#### A-4 等这场跑完

maxTurns=4、单场、并发 1，预计 2~5 分钟。轮询方式（任选）：

```powershell
# 看日志有没有跑完痕迹
Get-Content -LiteralPath ".tmp-verify-3100.out" -Tail 30
# 或直接查 DB
npx tsx -e "…"   # 你若不想写脚本，用 A-6 那条 SQL 的 mysql2 版本轮询 status
```

#### A-5 只读取证（本单核心，**只记计数、不许打印文本**）

取最新那场逐字稿（或按 A-6 的 `debug_session_id` 精确定位）：

```powershell
$f = Get-ChildItem -LiteralPath "data\debug-sessions" -Filter "*.json" -File |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
$c = [IO.File]::ReadAllText($f.FullName)

"file=" + $f.Name
"turn_count=" + (($c | ConvertFrom-Json).traces.Count)

# ① 台词指纹渲染前缀 —— 本轮落库的验收点
"vv_prefix_hits=" + [regex]::Matches($c, '你说话的味道：').Count
# ② 语桐那段文案的首句（逐字，只数次数）
"vv_text_hits="   + [regex]::Matches($c, '说话前会犹豫').Count
# ③ P1d 依恋行为块
"anxious_hits="   + [regex]::Matches($c, '反复确认|怕自己添麻烦|抢先说').Count
```

| 项 | 含义 | 预期 | 为 0 意味着 |
|---|---|---|---|
| `vv_prefix_hits` | `你说话的味道：` 出现次数 | **≥1**（每轮一次，4 轮应约 4） | **文案没进 prompt** → 阶段 A 直接 FAIL，**停，不许跑阶段 B** |
| `vv_text_hits` | 语桐文案正文进 prompt | **≥1** | 同上（前缀在但正文空？说明取值路径有问题） |
| `anxious_hits` | 依恋行为指引块 | **≥1** | 文案进了、依恋块没进 → 报告，阶段 B 也先别跑（方案 §2.2 说"没命中 = 接线还是断的，停下来修"） |

> **注意**：`你说话的味道：` 里是全角冒号`：`，别写成半角，否则数出来 0。
> **注意**：如果 `vv_prefix_hits` 为 0 但你确认 DB 里该角色 `verbal_voice` 非 NULL，**不要自己改代码**——
> 把"A 类 seed 写的行 vs 这场实际用的行"列清楚（`SELECT template_id, verbal_voice, audit_status, enabled, deleted_at`），写进报告让用户判。

#### A-6 DB 落库校验（P1d 的 P1 接线同场验证）

```sql
SELECT session_id, batch_id, max_turns, llm_call_turns, render_fallback_turns, degraded_turns, status
FROM ap_practice_sessions
WHERE batch_id = 'verify-verbal-voice-smoke-2026-11-10'
ORDER BY id DESC;
```

**预期**：`llm_call_turns` 与 `render_fallback_turns` 是数字（**不是 NULL**）。为 NULL = P1 落库没接上（P1d 遗留）。

#### A-7 阶段 A 判定

- 三项取证全 `>0` 且 A-6 非 NULL → **PASS，进阶段 B**
- 任一项为 0 → **FAIL，停在这里**，写清是哪一项、给证据（计数 + 相关行取值），不要跑阶段 B

---

### 阶段 B · P1d 正式 16 场重跑（阶段 A PASS 才做）

#### B-1 改临时脚本（复用同一个 `bin/tmp-enqueue-verify-smoke.ts`，或另存一份）

| 常量 | 值 |
|---|---|
| `BATCH_ID` | `verify-route1-p1d-2026-11-10` |
| `CHARACTER_SLUGS` | 全部 8 个 |
| `COUNSELOR_MODE_IDS` | `cold` + `expert` |
| `REPEATS_PER_COMBO` | `1` → 共 **16 场** |
| `MAX_TURNS` | `12` |

配置依据：方案 §3.1（场数/模式/maxTurns/并发/端口）。**不要改 `maxTurns`** —— 30 会触发上游 429，12 是与基线可比的口径。

#### B-2 入队 + 等待

```powershell
npx tsx bin/tmp-enqueue-verify-smoke.ts
```

16 场 × 单场约 3 分钟 × 并发 1 ≈ **50 分钟**。用 `.tmp-verify-3100.out` 日志 + DB `status` 轮询。

**中断条件**：连续失败 ≥4 场（1/4）或大量 429 → **停下报告**，别硬跑（烧的是真金）。剩下的场次记为"未执行"，不要伪造数字。

#### B-3 degraded 门禁（先看数据可不可信）

```sql
SELECT COUNT(*) AS total,
       SUM(degraded_turns > 0) AS degraded_sessions,
       SUM(llm_call_turns) AS llm_turns,
       SUM(render_fallback_turns) AS fallback_turns
FROM ap_practice_sessions
WHERE batch_id = 'verify-route1-p1d-2026-11-10';
```

- degraded 场次占比 **>40%** → **这批数据不可信，停下报告"渲染层有问题，数据作废"**，不继续 audit（方案 §2.2 的口径）
- ≤40% 才继续

#### B-4 audit 出数（**必须按 batch 隔离**）

```powershell
# 1) 基线复现（应仍是 57 份口径附近，记录真实份数）
npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions

# 2) 本批隔离：按 batch_id 从 DB 取 debug_session_id → 拷到独立目录
#    （脚本参数以实际 --help 为准，先看它支持不支持 batch 过滤）
npx tsx scripts/ops/quality/visitor-quality-audit.ts --help

# 3) 把 16 场的 json 拷到 .tmp-p1d-verify\ 再跑
npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir .tmp-p1d-verify
```

**禁止把"混在一起的数字"当结果报**——那会把旧基线拉进来，看不出变化。

#### B-5 出对比表 + 判读

按方案 §3.4 的表格填（v1 基线 / P1c r2 / 本批），并按 §3.5 判 PASS/FAIL：

**PASS**：anxious 三角色至少 1 个破 0% 阻抗或 0% 探索 + anxious 文本通道有命中 + 探索率 ≥15% + recounting ≤60% + degraded ≤25%
**FAIL**：anxious 仍 0%/0%，或探索率 <10%，或 recounting >75%

#### B-6 归档 + 收尾

- 16 场逐字稿拷到 `data/archives/debug-sessions-verify-route1-p1d-2026-11-10/`
- `data/debug-sessions/` 恢复成跑之前的基线份数（**先记下跑之前的份数**，别猜）
- kill 3100 的 node 进程，确认 `Test-NetConnection 127.0.0.1 3100` = False
- 删 `bin/tmp-enqueue-verify-smoke.ts`、`.tmp-p1d-verify/`、`.tmp-verify-3100.*`

---

## 4. 红线（违反即返工）

- **心理内容不进任何交付物**：本次取证对象就是 prompt 全文，**绝对不许把 `promptFull` / 逐字稿原文 / 角色 5Ps / 核心信念贴进交付记录、对话、日志、console**。只报**命中计数**与**布尔**。
- **不改业务代码**（本单是验证单）。发现断线只报告。
- 不碰 `engine-core/`；`boundary.spec.ts` 不许改。
- 不动 3000 端口的用户实例；不杀它的进程。
- 不碰用户正在标注的 30 场：`batch_id` 严格用 `verify-verbal-voice-smoke-2026-11-10` 和 `verify-route1-p1d-2026-11-10`，不复用任何旧 batch。
- 不改 `scripts/ops/quality/enqueue-p4-batch.ts`。
- 不跑 flutter / dart；不改前端仓库。
- 不自动 commit / push。

---

## 5. 边界防坑（容易踩的，逐条看）

| 坑 | 怎么防 |
|---|---|
| **跑了旧 dist** | A-1 两步：`pnpm build` + grep dist 里的 `MAX_VERBAL_VOICE_LENGTH` |
| **3100 起了但 worker 并发不是 1** | 日志里必须看到 `queue started concurrency=1`；看到 3 就重起（env 没继承进去） |
| **3000 与 3100 共用同一个 Redis 队列，会抢任务** | 起 3100 前先 `Test-NetConnection 127.0.0.1 3000` 看 3000 是否在跑。**两个 worker 会共同消费同一队列**，并发实际翻倍 → 429 风险。① 若 3000 在跑：在交付记录里明确写"实际并发=2"，并盯着失败率；② **绝不擅自杀 3000 进程**；③ 失败率异常就先停，报告用户 |
| **`你说话的味道：` 数成 0** | 全角冒号；另确认 grep 的是 `Raw` 全文（`[IO.File]::ReadAllText`），不是逐行数组 |
| **把 prompt 贴进报告"证明一下"** | 只贴计数。想加证据就贴"命中行号"的数量，不贴内容 |
| **逐字稿混批导致 audit 数字虚高** | B-4 强制按 batch_id 取 session_id 再拷独立目录 |
| **16 场跑一半 429 断了** | 失败 ≥4 场就停；剩余记"未执行"，不补数、不伪造 |
| **`verbal_voice` 为 0 就自己改代码去修** | 禁止。报告 + 列出该角色行取值，让用户判 |
| **跑完忘关 3100** | B-6 硬检查 `Test-NetConnection 127.0.0.1 3100` = False |
| **`data/debug-sessions` 份数没恢复** | 跑之前先 `(Get-ChildItem data\debug-sessions -Filter *.json).Count` 记下，归档后恢复到这个数 |

---

## 6. 闸门（本单不写代码，闸门简化但不许留空）

| 闸门 | 命令 | 要求 |
|---|---|---|
| build | `pnpm build` | exit 0 |
| 新代码进 dist | grep `MAX_VERBAL_VOICE_LENGTH` | 命中 |
| 未改业务代码 | `git diff --stat HEAD` | 只允许 `data/`、`.tmp-*`、`bin/tmp-*` 之类；`src/` `test/` `bin/` 已有文件 diff 必须为空 |
| engine-core | `git diff --stat HEAD -- src/engine-core` | 空 |
| 任务特有 | A-5 三项计数 + A-6 两列非 NULL | 全 >0 / 非 NULL |
| 任务特有 | B-3 degraded 场次占比 | ≤40% |

> tsc / eslint / vitest **不需要跑**（没改代码）。但如果你不小心改了，就得跑并说明为什么改。

---

## 7. 交付记录（完成后写，路径固定）

写到：`docs/worklog/completed/phase2.5/wp-j-p1d-rerun-and-verbal-voice-smoke-implementation-2026-11-10.md`

必须含：
1. **一句话结论**：文案到底进没进 prompt；P1d 16 场方向对不对
2. 阶段 A：三项计数（`vv_prefix_hits` / `vv_text_hits` / `anxious_hits`）+ A-6 的 SQL 结果（数值，不含台词）
3. 阶段 B：16 场实际完成/失败场数、batch_id、degraded 场次占比
4. **三方对比表**（v1 基线 36 场 / P1c r2 15 有效 / 本批），逐项填真实数字，填不出的写"未取到"并说明原因
5. PASS/FAIL 判读（按 §3.5 逐条对照）
6. 改动文件清单：应当只有临时脚本（且已删）——若 `src/` 有任何 diff，说明为什么
7. 风险与遗留：429 情况、并发实际值（是否两实例抢队列）、归档情况
8. 建议下一步（够不够格开 P4 100 场 / 还差什么）

---

## 8. 【交付回写清单】做完逐项勾选（之前总忘，这次不许跳）

- [ ] 交付记录已写到 §7 的固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改成 `✅` 并链交付记录
- [ ] 回写 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 里本任务相关行（P1d 重跑那行 + verbal_voice 那行补"动态验收"）
- [ ] 回写 `docs/worklog/pending/phase2.5-README.md` §3 表格对应行
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] `git diff --stat HEAD` 里没有 `src/` / `test/` 的既有文件改动
- [ ] 3100 实例已关（`Test-NetConnection 127.0.0.1 3100` = False）
- [ ] `data/debug-sessions/` 份数已恢复到跑之前
- [ ] 临时脚本 / 临时目录已删
- [ ] 给一行 commit message 草稿（**不自己 commit/push**，等用户指令）

---

## 9. 回复输出约定

完成后在对话里：
1. 说"已写入交付记录"+ 文件路径，不重复贴全文
2. 报三个计数（**只报数字，不报文本**）：`vv_prefix_hits` / `vv_text_hits` / `anxious_hits`
3. 报阶段 A 判定 + 阶段 B 的 PASS/FAIL
4. 报 §8 清单哪几项已做、有没有遗留
5. **不要**把 prompt 片段、逐字稿台词、SQL 返回的心理内容贴出来

---

## 10. 给 MiniMax 的一句话总结

> 我刚把 8 个角色的 `verbal_voice` 台词指纹落库了（commit `d72c68e`，真库 8/8 逐字一致），但还没证明它真的进了 prompt。请你先 build 干净 dist（`dist/app.js`），用 3100 起临时实例（`AUTO_PRACTICE_WORKER_CONCURRENCY=1`，**不要碰 3000**），入队 1 场 `vpt_social_anxious_l1`（cold，maxTurns=4，batch_id=`verify-verbal-voice-smoke-2026-11-10`），然后打开这场在 `data/debug-sessions/` 的逐字稿，在 `traces[].renderSpec.promptFull` 里分别数三种命中：`你说话的味道：`、`说话前会犹豫`、`反复确认|怕自己添麻烦|抢先说`——**三项都大于 0 才算通过，只报计数、不要把 prompt 或台词贴到任何地方**（那是心理内容）。通过后再按 `phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md` §3.1 跑 16 场（8 角色 × cold/expert，maxTurns=12，并发 1，batch_id=`verify-route1-p1d-2026-11-10`），出 §3.4 三方对比表和 §3.5 PASS/FAIL。全程不改业务代码，发现接线断了停下来报告。
