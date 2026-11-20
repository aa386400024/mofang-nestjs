# AF-024 独立评审：GUI 派发通道接入

- **评审对象**：`scripts/orchestration/gui-dispatch.mjs`（新增）、`cli.mjs` 的 `channel` 子命令、`dispatch.mjs` 派发记录、`scheduler.mjs` 通道选路、`config.json` 的 `dispatch` 段、`docs/team/agent-orchestration/README.md` §5.1（新增口径）
- **基线**：`04f6524`；评审时工作树为未提交改动（`git status`：`M` × 10、`??` × 2）
- **评审方式**：只读核对 + 一次性 Node 探针实测（未改动 `scripts/orchestration/` 任何文件）
- **评审时间**：2026-11-17 10:25–10:40
- **总判定**：**需修**（7 项需修 / 9 项通过，其中 2 项需修为阻塞级）

---

## 0. 闸门实测数字（本人亲自执行）

| 闸门   | 命令                                                                          | 结果                                                                                                                                                                                                   | 判定                           |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 闸门 1 | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | exit 0，`Test Files 1 passed (1)`、`Tests 159 passed (159)`、failed=0（连跑 3 次一致）                                                                                                                 | **通过**                       |
| 闸门 2 | `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | **第 1 次 exit 1**（1 FAIL：`Review 交接件 AF-024-review.json` → `/resolution must be object`、`/producedBy must be string`、`/producedAt must be string`）；**第 2、3 次 exit 0**（17 PASS / 0 FAIL） | **需修**（不稳定，见第 21 条） |

> 闸门 2 之所以先红后绿：编排者的评审交接件在 `transport/reviews/AF-024-review.json` 与 `transport/briefs/AF-024-review-request.json` 之间移动，且内容本身违反它自己声明的 `review-handover:1.1.0`（三字段为 `null`）。闸门 fail=0 依赖 gitignore 运行态目录的瞬时内容，不可复现。

---

## 1. 三条验收口径逐条核对

### 1.1 口径一「dispatch-channel 不再是纯规则函数：GUI 承载方可被真实拉起、定位输入会话、投递任务单并回写 dispatch 记录」 — **需修（部分落地）**

1. **通过** — 「真实投递 + 回写 dispatch 记录」成立，有可指认证据：`docs/team/agent-orchestration/orchestration-state.json` 中 AF-024 的 `dispatch.delivery` 为 `state=delivered` / `sessionPath=new-task` / `locateLayer=paste-verify` / `evidenceRef=docs/team/agent-orchestration/transport/briefs/AF-024.sent.png` / `deliveredAt=2026-11-17T02:25:57.792Z`，证据文件在盘（358 KB，10:25:48）；投递件 `transport/briefs/AF-024.brief.md` 在盘（10:20:45）。
2. **需修（阻塞）** — 「真实拉起、定位输入会话」发生在**仓外**：由编排者自己的桌面技能（`computer_use_tool` + `seed_computer_use`）执行，仓内代码一行未做。规则链 `resolveDispatchDecision`（进程拉起 / 窗口重启 / 四层定位 / 会话降级链 / 指数退避）**仍只被单测引用**：`scripts/orchestration/dispatch-channel.mjs:122`，全仓命中仅 `scripts/orchestration/__tests__/orchestration.spec.mjs:1841-1990`，运行时零接线。这正是 IM-028 登记的欠账（「派发决策链运行时接线」，`improvement-log.json` / `orchestration-snapshot.json`），**AF-024 未闭合**。
3. **需修** — 任务单 §2 目标「执行器可注入（桌面自动化 / 文件 Transport）」**未落成任何注入点**：`scripts/orchestration/gui-dispatch.mjs` 全文件为纯函数，无 executor port / 依赖注入参数；`scripts/orchestration/cli.mjs:547-589` 的 `channel dispatch` 只做「读交接件 → 写投递件 → 置 pending → 打印指引」，文件末 `cli.mjs:523` 明写「本命令不驱动桌面……避免 CLI 冒充 GUI 能力」。结论：**通道执行器不可替换、不可注入**，任务单 §2 的核心目标未落地。

### 1.2 口径二「投递失败有明确失败原因与回滚，不把「已粘贴」当成「已送达」」 — **需修**

4. **通过** — 「已粘贴 ≠ 已送达」这一条**真的成立**：投递状态机三态分离（`gui-dispatch.mjs:21`），`confirmDelivery` 强制三要素齐备（`gui-dispatch.mjs:138-140`），且实测时间序自洽：`AF-024.paste.png` 10:25:32 → `AF-024.sent.png` 10:25:48 → `deliveredAt` 02:25:57Z（粘贴与确认是两个独立动作，未合并）。
5. **需修** — 失败原因与回滚**不驱动状态机**：全仓 grep `delivery`，`scheduler.mjs` 零命中（仅 `scheduler.mjs:366` 的 `deliveryRef` 是回执验收、`scheduler.mjs:490` 的 `deliveryPacks` 是看板字段）。降级后任务仍是 `submitted`、租约继续跑，没有任何一处读 `delivery.state`；`fallbackDelivery` 只改记录不改状态（`gui-dispatch.mjs:170-196`）。口径要求的「回滚」在仓内**没有实现**。
6. **需修** — 重派丢留痕（探针实测）：`dispatch.mjs:94` 的 `attempt = Number(opts.attempt ?? entry.dispatch?.attempt ?? 1)` 在重派时继承旧记录的 attempt，**恒为 1，永不递增**；`dispatch.mjs:103` 用新 record 整体覆盖 `entry.dispatch`，上一轮 `delivery.failureReason` / `classification` **被清空**。实测：首派 `attempt=1` → 重派 `attempt=1`、`state` 回到 `pending`、`failureReason=undefined`。AF-015 D-3「逐次留痕」在 GUI 通道上失效。

### 1.3 口径三「桌面自动化不可用时降级到文件 Transport，并在 dispatch 记录标注 channel=gui-file-fallback」 — **需修**

7. **通过** — 降级动作**可执行**且落点正确：`gui-dispatch.mjs:185` 写 `channel=CHANNEL_GUI_FALLBACK`（`'gui-file-fallback'`，`gui-dispatch.mjs:27`），`handoverRef` 经 `...record` 展开**保留**，交接件文件不删；单测已覆盖「缺原因 / 缺文件交接件 / 定性非法都拒」（`__tests__/orchestration.spec.mjs:2490-2500`）。
8. **需修** — 降级标注**不可信**（探针实测）：`fallbackDelivery` 不校验原通道，`channel='file'`（从未走过 GUI）的记录也能被标成 `gui-file-fallback`（实测 `valid=true`）。这会让「本轮真的走过桌面并失败」与「压根没走桌面」在记录里不可区分。
9. **需修** — 「任务不丢」只成立到**指针层**：`gui-dispatch.mjs:176` 只校验 `record.handoverRef` 非空，**不校验文件真实存在**。实测 `handoverRef='不存在的.json'` 仍 `valid=true`、`channel=gui-file-fallback` → 记录声称已降级到文件 Transport，但文件 Transport 侧实际无件。
10. **需修（建议级）** — 枚举与事实脱节：`dispatch.mjs:16` 的 `DISPATCH_CHANNELS = ['file','gui-relay','mcp','http']` **不含** `gui-file-fallback`；`dispatch.mjs:18-20` 的 `normalizeChannel` 会把该值静默归一为 `'file'`。降级事实无法通过通道枚举校验。

---

## 2. `confirmDelivery` / `fallbackDelivery` 校验漏口（评审要求 2）

以下 5 条均为探针**实测复现**，非纸面推断：

11. **需修（阻塞）** — `gui-dispatch.mjs:136-137` 的状态合法性判断存在**表达式漏洞**：`!DELIVERY_STATES.includes(record?.delivery?.state) && record?.delivery?.state !== undefined`。当记录**根本没有 `delivery` 段**（file 通道，`dispatch.mjs:44-53` 只给 gui-relay 加该段）时，`state` 为 `undefined` → 第二项为 `false` → 整条不报错 → `confirmDelivery` 照样返回 `valid=true`，**凭空造出 `state=delivered`**。实测：`{channel:'file'}` + 三要素齐备 → `valid=true`。后果：一次纯文件派发可以被伪装成 GUI 已送达。
12. **需修** — `gui-dispatch.mjs:138-140` 只判「非空」，**不校验枚举与文件存在**：`sessionPath` / `locateLayer` 不比对 `SESSION_PATHS` / `LOCATE_LAYERS`（`dispatch-channel.mjs:24` / `:27`），`evidenceRef` 不检查文件是否真实存在。实测 `sessionPath='瞎写'`、`locateLayer='瞎写'`、`evidenceRef='不存在.png'` → `valid=true`。这正是编排者自认的「证据口径靠人填、可能被填成形式化字符串」，目前**在代码层无任何拦截**。
13. **需修（阻塞）** — `gui-dispatch.mjs:157-158` 在 confirm 时显式写 `failureReason: null, classification: null`。降级后再 confirm 会**把失败痕迹清空**：实测 `fallback(classification='deterministic')` → `confirm` → `state=delivered`、`failureReason=null`、`classification=null`。失败定性（deterministic / flaky / legacy-debt）被证据覆盖，事后无法审计「这条曾经失败过」。
14. **需修** — `gui-dispatch.mjs:133-162` **没有状态迁移守卫**：不要求 `record.delivery.state === 'pending'`，因此 `failed` → `delivered` 的回退路径畅通（见第 13 条实测）；也不要求 `record.channel === 'gui-relay'`。
15. **需修** — `fallbackDelivery`（`gui-dispatch.mjs:170-196`）**不校验原通道**，见第 8 条实测；且**不清除** `delivery` 里上一轮残留的 `sessionPath` / `locateLayer` / `evidenceRef`（`gui-dispatch.mjs:186-194` 用 `...record.delivery` 展开），失败记录会带上上一次的定位痕迹，审计上会误读为「本次也定位到了」。
16. **需修（建议级）** — 定性默认值偏软：`gui-dispatch.mjs:191` 与 `cli.mjs:613` 在缺省时一律填 `'flaky'`。桌面自动化不可用通常是**确定性环境缺陷**（CDP 未连、窗口不存在），默认归为「偶发波动」会让统计口径失真。

---

## 3. `scheduler.mjs` 选路与单任务队列（评审要求 3）

17. **通过** — **不会死锁，租约释放确实兜得住**。三段链路完整且互相咬合：
    - `scheduler.mjs:152-174` `releaseExpiredLeases`：对 `submitted` / `working` 判租约过期（`state-store.mjs:182-185`）→ 迁移回 `ready` + `heldForHuman=true`；
    - `scheduler.mjs:203-206`：`claimReadyTasks` 跳过 `heldForHuman` 任务（符合 reliability §3「超时不自动重派」）；
    - `cli.mjs:689-710` `task resume`：解除持单，允许重新领取。
    - `README.md:167` 的口径描述与实现**一致**，无「文档承诺但命令不存在」问题。
18. **需修** — **CLI 硬写通道，覆盖角色选路**：`cli.mjs:569` 无条件 `entry.dispatch.channel = 'gui-relay'`，无视 `config.dispatch.channel`，也无视 `scheduler.mjs:230-234` 的「编排者走 file」判定。实测证据：AF-024 自身 `targetRole='orchestrator'`，记录里却是 `channel='gui-relay'` —— 说明其 `channel` 来自 CLI 而非选路函数。`README.md:150-157` 声称选路在 scheduler 处判定，但**唯一真相源被 CLI 旁路了**。
19. **需修** — **一条 pending GUI 投递会占满唯一队列槽位直到租约到期**：`config.json:8` `maxConcurrentTasks=1`，`scheduler.mjs:180-184` 按 `submitted`/`working` 计占用，一条未 confirm 的 GUI 投递即占满全队列。AF-024 当前 `leaseDeadline=2026-11-17T02:50:22.300Z`（= 10:50:22 +08:00），即整个评审期间队列被本任务独占。编排者附言已自认此风险，判断正确，但**缓解手段只有「等 30 分钟」**——建议 GUI 投递用更短的投递租约（如 5 分钟）单独计时，而非复用 30 分钟任务租约。
20. **需修（建议级）** — **scheduler 走 gui-relay 时不生成投递件**：`dispatch.mjs:44-53` 只置 `state='pending'` + `briefRef=null`，投递件要靠人工另跑 `channel dispatch` 才生成（`cli.mjs:568`）。而 `gui-dispatch.mjs:11` 与 `README.md:163` 都把 `pending` 定义为「**投递件已生成**，尚未确认送达」——语义与实际不符（此时一件都没生成）。若人工忘了跑 `channel dispatch`，任务会空等满租约。建议 `pending` 拆为「未准备 / 已备待确认」两态，或由 scheduler 直接生成投递件。
21. **需修** — **闸门 2 不可复现**（见 §0）：闸门扫描 gitignore 的运行态目录 `transport/reviews/`（`cli.mjs:789-795`），而该目录内容正被编排者的评审派发流程并发改动；首次运行的 FAIL（`AF-024-review.json` 三字段非法）与 `transport/briefs/AF-024-review-request.json` 的 `producedBy/producedAt/resolution` 全为 `null` 完全对应。建议：要么按 `review-handover:1.1.0` 填齐三字段，要么不声明 `schemaRef`；另外评审交接件不该与闸门扫描目录同址。

---

## 4. 其余核对项

22. **通过** — 口径文档已写：`docs/team/agent-orchestration/README.md` §5.1（146-184 行）是本轮**新增**（HEAD 版无 §5.1，`git status` 显示 `M`），通道选路 / 状态机 / 命令表 / 红线四段齐全，与实现基本对得上。
23. **需修** — 交付链未闭合（编排者待办，非代码缺陷）：交付记录 `docs/worklog/completed/phase2.5/af024-gui-dispatch-implementation-2026-11-17.md` **未创建**；回执 `docs/team/agent-orchestration/transport/receipts/AF-024.json` **未创建**（`receipts/` 下只有 AF-026/027/028、DR-001）；任务单 frontmatter 仍是 `status: backlog`，状态行未改 `✅`。按任务单 §5 与 `AGENTS.md` §6，这三项不补不算交付。
24. **通过** — 引擎红线未破：`git diff --stat HEAD -- src/engine-core` 为空；改动面限于 `scripts/orchestration/` 与 `docs/team/agent-orchestration/`（+ `web/orchestration/data.js` 看板快照，属既有双写机制）。未跟踪的 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` mtime 为 2026-11-16 19:35，**早于本任务开工**（基线 `04f6524`），**不计入本任务残留**。
25. **需修（建议级）** — 投递记录里路径约定自相矛盾：`handoverRef` 是**绝对路径**（`transport.mjs:46` 返回 `join(dir, fileName)` → `dispatch.mjs:42` 原样存入），`briefRef` / `evidenceRef` 却是仓内相对路径（`cli.mjs:649` 的 `pathToPosix`）。同一份投递记录两套约定，且绝对路径已随快照进仓（`docs/team/agent-orchestration/orchestration-snapshot.json:46`、`web/orchestration/data.js`），泄露本机目录布局。根因在 AF-010，但 AF-024 在自己定义的投递记录里混用了两套约定，建议统一为仓内相对路径。
26. **需修（建议级）** — 投递件丢失交付记录指针：`gui-dispatch.mjs:62` 只读 `task.artifacts?.deliveryRecord`，缺省时写「(见任务单 plannedArtifacts)」；而索引里该指针本就在 `task.plannedArtifacts[0].path`（= `docs/worklog/completed/phase2.5/af024-gui-dispatch-implementation-2026-11-17.md`）。实测生成的 `AF-024.brief.md` 第 1 节只能写「交付记录落点：(见任务单 plannedArtifacts)」，执行代理拿不到确切路径。`buildGuiBrief` 应回落到 `plannedArtifacts[0].path`。

---

## 5. 建议修复清单（按优先级）

| 优先级 | 条目                                                                         | 位置                                          |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------- |
| P0     | confirm 状态合法性判断的 `undefined` 漏洞（file 通道可伪造 delivered）       | `gui-dispatch.mjs:136-137`                    |
| P0     | confirm 清空 `failureReason` / `classification` + 缺状态迁移守卫             | `gui-dispatch.mjs:157-158`                    |
| P0     | `sessionPath` / `locateLayer` 枚举校验 + `evidenceRef` 文件存在性校验        | `gui-dispatch.mjs:138-140`                    |
| P1     | `fallbackDelivery` 校验原通道、校验 `handoverRef` 文件存在、清残留定位字段   | `gui-dispatch.mjs:170-196`                    |
| P1     | `delivery.state` 接入状态机（降级 → 回滚 / 转 held-ready），当前调度层零读取 | `scheduler.mjs`（全文件）                     |
| P1     | 重派时 attempt 递增 + 保留上一轮投递留痕                                     | `dispatch.mjs:94`、`dispatch.mjs:103`         |
| P1     | CLI 不硬写通道，尊重角色选路与 `config.dispatch.channel`                     | `cli.mjs:569`                                 |
| P2     | GUI 投递独立短租约，缓解单任务队列被 pending 占满                            | `scheduler.mjs:180-184` + `config.json`       |
| P2     | `pending` 拆为「未准备 / 已备待确认」或由 scheduler 生成投递件               | `dispatch.mjs:44-53`                          |
| P2     | 评审交接件按 schema 填齐三字段并移出闸门扫描目录                             | `transport/briefs/AF-024-review-request.json` |
| P2     | 统一投递记录路径约定为仓内相对路径                                           | `dispatch.mjs:42` / `cli.mjs:649`             |
| P2     | `buildGuiBrief` 回落 `plannedArtifacts[0].path`                              | `gui-dispatch.mjs:62`                         |
| P2     | `DISPATCH_CHANNELS` 补 `gui-file-fallback`                                   | `dispatch.mjs:16`                             |
| P3     | 补交付记录 + 回执 `AF-024.json` + 任务单状态行改 `✅`                        | 见第 23 条                                    |

---

## 6. 一句话结论

三条验收口径里，**「不把已粘贴当已送达」真正成立**（状态机分离 + 三要素强制 + 实测时间序自洽），**「降级到文件 Transport 并标注 channel=gui-file-fallback」动作可执行但标注不可信**（未走 GUI 也能标、文件不存在也放行），**「GUI 承载方可被真实拉起、定位输入会话」未在仓内落地**（真实动作发生在仓外桌面技能，规则链 `resolveDispatchDecision` 运行时零接线，IM-028 未闭合，「执行器可注入」没有注入点）。`confirmDelivery` / `fallbackDelivery` 共查出 5 处实测漏口，其中 3 处为阻塞级。选路**不会造成死锁**，租约释放 + `task resume` 闭环成立，但 CLI 旁路选路、pending 占满单槽位、重派丢留痕三项需修。
