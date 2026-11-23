# AF-414 只读代码评审 + A′ 人工标注分层抽样方案

> **性质**：只读评审。本文件**不含任何代码改动**；评审期间未改代码 / 未提交 / 未写仓库文件（除本文件），未跑 git 写操作，未碰 `src/engine-core`，未改编排状态文件。
> **对象**：AF-414「调试会话原子写 Windows 瞬时占用重试」（提交 `343745f3`，PR #203）。
> **评审范围**：`src/admin-debug/debug-session-store.ts`、`test/admin-debug/af414-atomic-write-retry.spec.ts`；另读 `scripts/ops/quality/af409-presence-narrowing.mjs`、`af412-presence-false-positive-impact.mjs`（第二件事）。
> **实跑证据**：AF-414 定向单测 **2 文件 / 33 用例全绿（3.20s）**（我本次复跑确认）；AF-409 / AF-412 只读脚本已实跑取数。
> **日期**：2026-11-24。

---

## 0. 评审结论摘要

**AF-414 的实现本身是干净的**：可重试码白名单收窄、非瞬时错误立即抛、退避公式正确、依赖可注入因而单测不碰真实文件系统、队列不因失败卡死。**没有发现阻断级缺陷。**

但有 **3 条必须在合入前登记** 的问题，其中 1 条是**文档数字与代码不符**、1 条是**根因未被证实**、1 条是**跨进程 tmp 覆盖风险**：

| #      | 问题                                                                                                                                             | 级别                         | 证据                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| **P1** | **交付记录「70ms 总量」与代码实为 30ms 不符**；任务单又写「10/20/40ms」—— 三处口径三个数                                                         | 文档缺陷（阻塞交付记录核对） | 代码 `debug-session-store.ts:105-114`；交付记录 §3.2/§3.3；任务单 §目标 |
| **P2** | **flaky 的根因未证实**：交付记录用「可能」措辞描述 EPERM，但**全程没有捕获到一次 EPERM**；「fire-and-forget + 10s 轮询竞态」这一并存解释未被排除 | 根因风险（重试可能只是掩盖） | 交付记录 §一（原文「可能」）；`debug-session.service.ts:671-675`        |
| **P3** | **临时文件名固定 `${target}.tmp`**：跨进程（双实例 / 后端 + 本地脚本）会互相覆盖 tmp，rename 后落盘可能是**别人的半截内容**                      | 数据正确性                   | `debug-session-store.ts:546`                                            |

另有 8 条改进项（writeFile 未纳入重试、退避无 jitter、参数未走 env 端口、无熔断、`get()` 读带写副作用、缺可观测计数、clamp 分支零覆盖、混合错误序列未覆盖），详见 §1。

**第二件事（A′ 标注抽样）**：AF-409 的 A′ 在本地语料上命中 **117/157 = 74.5%** 的中性轮，AF-412 投影出**整批 safety +0.4660 / bond +0.2320**；这个量级说明**必须先测精确率再谈开关**。§5 给出基于现有 `d1-event-classifier-evidence` 工具扩展的、**双盲 + 分层 + Neyman 分配**的抽样方案，含 6 个分层维度、配额表、样本量推导与验收线。

---

## 一、遗漏的坑

### 1.1 P1 · 交付记录 / 任务单 / 代码三处数字对不上（最该先修的一条）

| 来源                                  | 表述                                                        | 实际对应                            |
| ------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| 任务单 §目标                          | 「3 次，**10/20/40ms**」                                    | 3 次 sleep → 对应 **4 次尝试**      |
| 代码 `debug-session-store.ts:101-112` | `attempts=3`；`sleepFn(baseDelayMs * 2 ** attempt)`         | 2 次 sleep = **10ms + 20ms = 30ms** |
| 交付记录 §2.1                         | 「默认 3 次尝试、基础退避 10ms、指数退避（**10 / 20ms**）」 | ✅ 与代码一致                       |
| 交付记录 §3.2 / §3.3                  | 「退避上限 **70ms 总量**」「最坏延迟可控在 **70ms**」       | ❌ **与代码不符**（实为 30ms）      |

`70ms` 正是任务单那版「10/20/40」的和（10+20+40）。也就是说：**交付记录的风险分析用了未实现的参数**，而实现用了另一个参数。风险方向上是保守的（把最坏延迟说大了 2.3 倍），但按 `AGENTS.md` §6「闸门数字以当次输出为准」，交付记录里的每个数字都应可复核。

**建议**：交付记录 §3.2/§3.3 改成「退避 sleep 总量 **30ms**（3 次尝试 → 2 次 sleep：10ms + 20ms）+ 3 次 rename 自身耗时」；任务单的「10/20/40ms」要么改描述，要么把 `attempts` 提到 4。**二选一，别留三套数。**

### 1.2 P2 · flaky 根因未被证实，重试可能只是「掩盖」而非「修复」

交付记录 §一 的因果链是：_「rename **可能**命中目标文件被临时占用…写失败被 `.catch` 吞掉，状态永远停在 `active`」_。注意用词是「可能」——**全程没有捕获到一次 EPERM**（无日志、无计数、无复现脚本）。并存且未被排除的解释：

1. **`markCompleted` 是 fire-and-forget**（`debug-session.service.ts:671-675`：`void this.store.markCompleted(...).catch(...)`）。关闭接口同步返回，落盘是异步的；测试用 `waitFor` 轮询 10s（`debug-session-persistence.spec.ts:64-71`，每 10ms 轮询一次）。
2. **316 worker 并行下的事件循环饥饿**：`waitFor` 的轮询靠 `setTimeout(10)`，高负载下定时器与 fs 回调的调度延迟可以远超 30ms。**「写成功了但轮询窗口内没观察到」** 与 「写失败了」 在测试里的表现**完全一样**（都是 10s 超时）。
3. **写成功但写的是旧内容**（见 §1.6 的 `get()` 写回竞态）。

**结论**：AF-414 只覆盖了「解释 2」中的第 1 支（rename 抛错）。如果真实原因是 2 或 3，**AF-414 不解决根因**，且交付记录 §六「重试显著降低丢失概率」的说法缺少可核对的证据。

**建议（不改本单实现，只补证据与登记）**：

- 在 `renameWithRetry` 的耗尽分支加一条**计数/告警**（见 §1.5）→ 下次 flaky 出现时能直接判定「到底是不是 EPERM」。
- 交付记录 §六补一条：**未捕获到 EPERM 实证**，本次属于「基于 Windows 语义的预防性加固」，不是「已验证的根因修复」。
- 若要真正闭环，方向是**让关闭接口可等待**：给 `closeSession` 加一个可选的「等待落盘完成」通道（返回 promise 或事件），把 fire-and-forget 的不确定性从接口层去掉。交付记录已把它登记为遗留 ✅，本评审认为**它才是真修复**。

### 1.3 P3 · 临时文件名固定 → 跨进程覆盖，AF-414 的重试会放大这个窗口

```ts
// debug-session-store.ts:546-548
const temp = `${target}.tmp`;
await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
await renameWithRetry(temp, target);
```

- **单进程内**同 session 的写由 `enqueue` 串行（`:492-506`）→ 不会撞。✅
- **跨进程**（两个后端实例共用同一 `ADMIN_DEBUG_SESSION_DIR`、后端 + 本地脚本、CI 并行任务）→ 双方写**同一个** `.tmp` → 内容互相覆盖 → `rename` 后落盘的是**对方的内容**，且如果对方正在写一半，**可能落盘半截 JSON**（正好是文件头注释第 19-22 行要防的那种损坏）。
- **AF-414 让窗口变宽**：第一次 rename 失败 → 等 10ms / 20ms → 期间对方完全可能又写了一遍 `.tmp` → 第二次 rename 落的是**对方写的内容**。重试把「一次可能错」变成「两次都可能错，且错得更晚」。

**建议**：tmp 名唯一化 —— `${target}.${process.pid}.${randomUUID().slice(0,8)}.tmp`，并用 `writeFile(temp, data, { flag: 'wx' })` 保证不覆盖既有文件；rename 成功后清理自己的 tmp（失败路径的残留也要能被别人识别/清理）。注意 `listFiles()` 只认 `.json`（`:554-562`）→ 现有 `.tmp` 残留不会被列出，只会静默堆积。

### 1.4 `writeFile` 没有纳入同一套重试（上游失败照样抛）

AF-414 只保护了 `rename`。但**同一个 `.tmp` 路径上的 `writeFile` 在 Windows 上一样会 EPERM/EBUSY**（另一个进程正持有该 tmp）。当前 `writeRecord` 的第一步 `writeFile` 抛错 → 整轮写失败 → 与 AF-414 想解决的症状同源。**重试只覆盖了两步里的一步。**

**建议**：把 `writeFile` 也包进同一个 `withRetry` 工具（同一个错误码白名单即可）。

### 1.5 重试耗尽后没有降级路径，`.tmp` 静默残留

- 耗尽 → 抛 → `writeRecord` 抛 → `enqueue` 的 task 抛 → `markCompleted` 的 `.catch` 记一条 warn → **状态停在 `active`**。
- 重试只提高成功率，**不改变后果**（交付记录 §六 已诚实登记 ✅）。
- 但缺两件事：
  1. **降级补偿**：耗尽时 tmp 里**已经是新内容**（`writeFile` 成功过）→ 完全可以在耗尽分支排一次**延迟补偿**（例如 1s 后再试一次 rename），把「本轮丢失」变成「本轮延迟落盘」。
  2. **可观测**：没有计数器，运维**无法知道**今天发生了多少次重试/耗尽。仓库已有 Prometheus 设施（`src/infra/`）→ 建议加 `debug_store_rename_retry_total{result=success|exhausted}` 与 `..._attempts_total`。这也是 §1.2 那个「下一次 flaky 能不能判定是不是 EPERM」的前提。

### 1.6 `get()` 是「读操作带写副作用」，且绕过写队列（生产态竞态，测试覆盖不到）

```ts
// debug-session-store.ts:393-403
async get(id: string): Promise<DebugSessionRecord | null> {
  if (this.mirror !== null) {
    const remote = await this.mirror.get(id);
    if (remote !== null) {
      this.knownRemoteIds.add(id);
      await this.writeRecord(remote);   // ← 读路径触发一次完整写（writeFile + rename）
      return remote;
    }
  }
  return this.readRecord(id);
}
```

- **写放大**：远端镜像开启时（`ADMIN_DEBUG_SESSION_REMOTE` 缺省 **on**，`:620-627`），**每读一次会话详情就全量重写一遍 JSON 文件**（逐字稿 200KB+）。调试面板的详情页 / `waitFor` 轮询都会触发。
- **绕过写队列**：`writeRecord(remote)` 直接调用，**不在 `enqueue` 里** → 与同 session 的排队写（`appendTurn` / `markCompleted`）**并发** → **后写者胜**，可能把较旧的快照写回去。
- **测试覆盖不到**：测试里 `new DebugSessionStore(stubConfig({...}) as never)` **没有 DataSource** → `mirror === null` → `get()` 是纯读。**生产默认路径（mirror 开启）与被测路径不是同一条。**
- 附带效应：在生产里，`get()` 的写回会**自愈**「rename 失败导致文件停在 active」—— 下一次读会把 DB 的新状态写回文件。**这恰恰解释了为什么这个 flaky 只在测试（mirror=null）里出现**，也解释了为什么它可能长期没被生产发现。

**建议**：把 `get()` 的写回改为「仅在本地文件缺失或明显过期时回填」，或至少**把它纳入 `enqueue`**（与同 session 的写串行）。并在测试里补一条 mirror 开启的用例。

### 1.7 退避没有 jitter，3 次窗口（30ms）大概率短于 Windows 杀软扫描窗口

- 10ms / 20ms 的总窗口是 **30ms**；Windows Defender / 备份软件对「刚被写过的文件」的扫描占用通常在**几十到几百毫秒**量级。
- 没有 jitter → 多个进程同时失败会**同步重试**（惊群）。
- **权衡**：延长窗口会线性拉长队列尾延迟（§4.2）。建议 `attempts=5, base=20ms, ±50% jitter` → 期望总 sleep ≈ 20+40+80+160 = 300ms，最坏 ≈ 600ms。相对一轮咨询（秒级）可接受。

### 1.8 可重试码表的边界：能区分不了「瞬时占用」与「永久拒绝」

- `EPERM` / `EACCES` 在 Windows 上**既可能**是瞬时占用（`ERROR_SHARING_VIOLATION` → EPERM、`ERROR_ACCESS_DENIED` → EACCES），**也可能**是永久性拒绝：目标文件被独占打开、ACL 拒绝、只读属性、**目标路径是一个目录**。**重试无法区分这两类。**
- 所以对「有限重试是否会掩盖真实故障」的准确回答是：**不会永久掩盖**（耗尽后仍抛原始错误，`code` 不变）**；但会把永久故障延迟 30ms，并让错误语义看起来像「瞬时占用」**。
- `ENOTEMPTY`：Node 的 `rename` 目标是非空**目录**时才报；本处目标恒为 `${id}.json`（文件）→ **该码在本路径不可能出现**。保留它属防御性，但放在白名单首位会误导读者（注释写「目标目录在替换瞬间非空」，而本路径没有目录替换）。
- 建议：**在耗尽时给错误附加非破坏性标记**（如 `error.attempts = n`、`error.retried = true`，**不改 `code`** → 现有单测的 `toMatchObject({ code: 'EBUSY' })` 仍然通过），让运维与上游能区分「试过」与「没试过」。
- 补码：`EAGAIN`（Node 内建重试白名单里有，本单没有）；`UNKNOWN`（Node/libuv 在 Windows 上偶尔把 Win32 错误映射成 UNKNOWN）建议**不补**（太宽，会把真故障拖进重试）。

### 1.9 跨轮计数与「同 session 多次失败」的放大效应

`enqueue` 是 per-session promise 链：**不同 session 互不阻塞** ✅；同一 session 排队 N 个写、每个都在失败时各付 30ms → 尾部延迟增量 ≈ N × 30ms。实测场景 N 通常 1~3（每轮一次写）→ 增量 < 100ms，**可接受**。但若目录被长时间锁住（备份软件全盘扫描），**每个写都失败且都付 30ms** → 队列持续堆积、持续失败，**没有熔断**。

仓库已有熔断范式（`ModelEventClassifier` 的 `circuitThreshold` / `circuitCooldownMs`）→ 建议对齐：连续 N 次耗尽后短路一段时间（期间直接跳过 rename / 改走补偿队列），避免「每个写都白等 30ms」。

### 1.10 其他遗漏边界（简表）

| #   | 问题                                                                                                                                                 | 位置           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| a   | `rename` 成功 ≠ 内容正确：跨进程时可能落盘**对方**的内容（§1.3）                                                                                     | `:546-548`     |
| b   | 无 fsync：`writeFile` 返回不代表落盘；rename 后未 fsync 目录（Windows 不支持目录 fsync）→ 断电可能丢。**真正的持久性无法保证**，建议在文件头如实写明 | `:547`         |
| c   | 每轮全量 `JSON.stringify(record, null, 2)` + 全量写盘 → 20 轮会话是 O(n²) 写放大（调试场景可接受，值得登记）                                         | `:547`         |
| d   | `attempts` / `baseDelayMs` 的 clamp 逻辑（`Math.max(1, Math.trunc(...))`、`Math.max(0, ...)`）**零测试覆盖**                                         | `:101-102`     |
| e   | 混合错误序列（第 1 次 EPERM → 第 2 次 ENOENT）**零覆盖**，而这正是「重试掩盖真实故障」的关键边界                                                     | spec `:86-110` |
| f   | 耗尽用例把 `sleepFn` 桩成 no-op → **不验证退避序列**（应断言 `[10, 20]`）                                                                            | spec `:86-95`  |
| g   | 失败路径的 `.tmp` 残留**无用例**（成功路径有：persistence spec `:313-317`）                                                                          | —              |
| h   | `enqueue` 的「前一次失败不连累后续」这一 AF-414 新增抛错路径后的关键不变式，**无用例**                                                               | `:492-506`     |

---

## 二、工程纪律对齐

### 2.1 🔴 禁裸 npx —— 同一文件内两套口径

```
src/admin-debug/debug-session-store.ts:33
-   验证: npx vitest run test/admin-debug/debug-session-persistence.spec.ts
```

而 AF-414 新增的 spec 文件头写的是 `pnpm exec vitest run ...` ✅。`AGENTS.md` 明令「Node/后端统一用 pnpm，禁止裸 npx」→ **同一文件里两套命令口径**。这是 AF-414 动过的文件，顺手改一行即可。

### 2.2 🔴 系数未走「env → 端口」注入 —— 与本文件既有范式不一致

`debug-session-store.ts` 里已有**三个** env 解析纯函数先例：`resolveStoreDir`（`:608`）、`resolveRemoteEnabled`（`:620`）、`resolveMaxSessions`（`:632`），全部形态一致（读 env → 校验 → 夹取 → 回落种子值）。

AF-414 的 `attempts` / `baseDelayMs` 却是**写死在函数默认参数里**（`:101-102`）→ 部署侧无法调整。交付记录 §六说「如线上出现，应结合告警计数再评估是否扩大窗口」—— 但扩大窗口**需要改代码发版**，这与仓库「部署形态的系数走配置」的纪律（cap / alliance / decay / timing 四族同款范式）冲突。

**建议**：加 `resolveRenameRetryOptions(config): { attempts, baseDelayMs }`，env 键沿用本文件命名风格（`ADMIN_DEBUG_RENAME_RETRY_ATTEMPTS` / `ADMIN_DEBUG_RENAME_RETRY_BASE_DELAY_MS`），非法值回落种子值并在装配期告警。

### 2.3 🟡 「一工具一文件」：重试原语混进了 660 行的存储类文件

`debug-session-store.ts` 已 660+ 行，职责是「会话存储」。`RENAME_RETRY_CODES` / `isRetryableRenameError` / `renameWithRetry` 是**独立可复用原语**，混进去让该文件继续变大，且**测试导入路径被迫指向业务文件**。

**建议**：拆到 `src/admin-debug/atomic-write.ts`（新文件在 `src/admin-debug/` 内，**不涉及 `src/engine-core`，不撞 boundary 断言**），store 只负责调用。这与 AF-408/409/412 在 `scripts/ops/quality/` 下「一工具一文件」的做法一致。

### 2.4 🟡 反双胞胎：`PRESENCE_DELTAS` 是内核 delta 表的**第三份拷贝**，且无一致性断言

`scripts/ops/quality/af408-presence-calibration.mjs:10-37` 的 `PRESENCE_DELTAS` 自陈「与 state-transition.ts 保持同值的工程种子 delta」—— 但内核 `state-transition.ts:202-395` 的 `DELTA_TABLE` 才是真相源。仓库铁律（`delta-table-config.ts` 文件头）：**「两处各算一遍 = 两张会漂的定价表」**。目前**没有任何自动化断言**保证两者逐字相等 → 内核调了系数，AF-408/409/412 的投影会静默漂。

**可行的零内核改动的断言方式**：内核 barrel 已公开导出 `aggregateTurnDelta`（`engine-core/index.ts:175-176` 段）→

```ts
// 只读断言（不新增内核导出，不撞 boundary 断言⑥）
import { aggregateTurnDelta } from '../../src/engine-core/index.js';
import { PRESENCE_DELTAS } from '../../scripts/ops/quality/af408-presence-calibration.mjs';
expect(aggregateTurnDelta([{ kind: 'holding_present', matchedTerms: [], strength: 1 }])).toEqual(
  expect.objectContaining(PRESENCE_DELTAS.holding_present),
);
```

（`aggregateTurnDelta` 在无 `DeltaTableConfig` / `AllianceConfig` 时走基础表 → 正是要对比的那份。）**这条断言能把「第三份拷贝」变成「自动校验的镜像」。**

### 2.5 🟡 AF-412 的投影口径与真实内核**不同源**

`af412-presence-false-positive-impact.mjs:40-56` 的 `projectPresenceOnSnapshot` 是「**末轮单次加法**」（`last.safety + ΣΔ`），而真实内核是**逐轮** `transitionState`（含 clamp + cap + 人格调节，见 `in-memory-engine-session.ts:496/538-539/555`）。本量级下数值接近，但**不是同源**，不能把 AF-412 的数字当内核结论。

**建议**：AF-412 增加一条「逐轮真实内核重算」对照分支（用 `dist/engine-core` 的 `transitionState`，只读）。

### 2.6 🟡 AF-412 的 eligible 池继承了已知口径缺陷

`af412:132-135` 把 `tags.length === 0`（**eventTags 从未落盘**）也算作 neutral 轮 → 与 AF-404 刚建立的 `eventTagCounts: {}`（= 提取缺失）口径**冲突**。缺失轮应单列，不进 presence 判定池（否则「提取缺失」会被当成「分类器判中性」，再被 A′ 判成在场）。

### 2.7 🟡 AF-412 的误判敏感性模型假设「误判均匀分布」

`af412:156-163` 的 `scaleImpactByErrorRate` 用**统一**误判率缩放总增量。真实误判**不均匀**（集中在短句 / 对峙 / 模板句 / 疑问词子串命中这几层）→ 缩放结果会系统性低估高风险层的伤害。**§5 的分层抽样正是为了产出「按层的误判率」，把这里的均匀假设替换掉。**

### 2.8 🟡 交付记录数字来源需逐条标注

交付记录 §4 的「全量测试 | `pnpm test` | **316 passed / 1 skipped，4790 passed / 4 skipped**」—— **一条命令挂两个数字**，复核者无法判断各自来自哪条命令（`vitest.config.mts` 无 projects / shard 配置）。建议按仓库惯例逐条标注命令 + 回执字段。

### 2.9 ✅ 做对的地方（值得点名，避免被后续重构改掉）

- **可重试码收窄**：非瞬时错误（ENOENT / EXDEV）立即抛，不做无意义重试 ✅。
- **依赖可注入**（`renameFn` / `sleepFn`）→ 单测不碰真实文件系统，策略可断言 ✅。
- **`enqueue` 的 `previous.then(task, task)`**（`:494`）→ 前一次失败**不会连累**后续任务，AF-414 新增的抛错路径不会卡死队列 ✅。
- **错误原样抛出**（保留 `code`）→ 上游能按码分流 ✅。
- **交付记录 §六主动登记了 fire-and-forget 遗留与退避窗口不足** ✅ —— 这段诚实度值得保持。
- **范围隔离干净**：未碰 `src/engine-core`、未改存储格式、未改 API 语义 ✅（`git diff --stat HEAD -- src/engine-core` 为空可复核）。

---

## 三、更优雅实现

### 3.1 Windows rename 语义：问题不在「替换不原子」，而在「Windows 不许替换被打开的文件」

- Node 的 `fs.rename` 在 Windows 底层走 `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` → **替换语义本身已是原子的**（同卷内）。
- 真正的约束是 **Windows 禁止替换被其他进程以不共享方式打开的文件**（POSIX 允许 unlink 一个打开中的文件）→ 这正是 `EPERM` / `ERROR_SHARING_VIOLATION` 的来源。
- 所以「有没有更优雅的原子替换方案」的答案是：**原子性不是问题，占用才是**。

### 3.2 候选方案与取舍（按推荐度排序）

| #     | 方案                                                                                | 评价                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **①** | **Node 内建重试选项**：`fsPromises.rename(old, new, { maxAge, retry, retryDelay })` | ✅ **本机 Node v26 实测可用**（我刚用系统临时目录验证：带这三个选项的 rename 正常完成，仓库未触碰）。**但**：内建白名单（EAGAIN/EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM 一类）**不含 EACCES** → AF-414 手写补上的正是 EACCES（Windows 上 `ERROR_ACCESS_DENIED` 的常见映射）→ **手写有正当理由，但必须在注释里写明**，否则会被当成「重复造轮子」。<br>最佳形态：**保留 `renameWithRetry` 的可注入外壳**（可断言 attempts、可观测），把默认 `renameFn` 换成带内建选项的封装，或至少注释说明「为何不直接用内建 retry」。<br>⚠️ 内建白名单是否覆盖 EACCES 请在落地前用一条强制 EPERM/EACCES 的一次性脚本实测确认（本评审未构造该场景，不下断言）。 |
| **②** | **把 `writeFile` 纳入同一重试**                                                     | ✅ 必做（同 §1.4），且与 ① 是同一把尺子                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **③** | **tmp 名唯一化 + `flag:'wx'`**                                                      | ✅ 必做（同 §1.3）：`${target}.${pid}.${rand}.tmp`，写用 `wx` 避免覆盖，rename 成功后清理自己的 tmp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **④** | **退避加 jitter + 参数走 env 端口 + 熔断**                                          | ✅ 建议（§1.7 / §1.9 / §2.2），对齐仓库既有四族系数范式与 `ModelEventClassifier` 熔断范式                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **⑤** | **不可变分片 + 指针文件**（每轮一个文件 + `latest` 指针）                           | ❌ 能彻底消灭「替换被打开的文件」，但对调试面板**过度设计**，且会改变落盘格式（越过本单「不改存储格式」边界）→ 不建议                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **⑥** | **`rm(target)` + `rename`**                                                         | ❌ **更差**：出现「文件不存在」的窗口，反而破坏「要么旧文件要么完整新文件」的原子性                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **⑦** | **直接 `writeFile` 到目标**                                                         | ❌ 放弃原子性 → 半截 JSON，正是文件头要防的                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **⑧** | **fsync（`fh.sync()` + 目录 fsync）**                                               | ⚠️ 真正持久性需要它，但 Windows 不支持目录 fsync；**建议只在文件头如实写明「原子替换 ≠ 断电持久」**，不建议本单做                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 3.3 一条更优雅的整体形态（把四个建议合成一次改动）

```
atomic-write.ts（新文件 · 适配层 · 不碰 engine-core）
  ├─ RENAME_RETRY_CODES / isRetryableRenameError      （从 store 搬来）
  ├─ renameWithRetry(temp, target, opts)               （保留注入式外壳）
  │     └─ 默认 renameFn = (a,b) => rename(a, b, { maxAge, retry, retryDelay })  ← 内建兜底
  ├─ writeFileWithRetry(temp, data, opts)               ← 新增：与 rename 共用白名单
  ├─ uniqueTempPath(target)                             ← 新增：pid + 随机
  └─ attempts/baseDelay 由 resolveRenameRetryOptions(config) 注入（§2.2）

debug-session-store.ts
  ├─ writeRecord: uniqueTemp → writeFileWithRetry('wx') → renameWithRetry → 失败降级补偿 + 计数
  └─ get(): 写回纳入 enqueue，或改为「仅本地缺失时回填」（§1.6）
```

---

## 四、五个待评审点的直接回答

### ① 有限重试是否会掩盖真实故障？

**会延迟、不会永久掩盖。** 耗尽后仍抛原始错误（`code` 不变），所以故障不会被吞；但 (a) 永久性拒绝（独占打开 / ACL / 只读 / 目标是目录）会被误当成「瞬时占用」多等 30ms；(b) **交付记录宣称的「根因」没有被任何实证支撑**（§1.2），若真实原因是 fire-and-forget 竞态或事件循环饥饿，重试**不解决根因**；(c) 缺计数器 → 下次再发生时依然无法判定。**建议：加计数 + 登记「未捕获 EPERM 实证」。**

### ② 会话级串行写队列叠加退避的最坏延迟？

- 单次写最坏：**30ms sleep**（3 尝试 → 2 次 sleep：10+20）+ 3 次 rename 自身耗时；**不是交付记录写的 70ms**。
- 队列是 **per-session** 的 → **不同 session 互不阻塞** ✅；同 session 排队 N 个写，尾部延迟增量 ≈ N × 30ms（实测 N 通常 1~3 → < 100ms）。
- **没有上界**：若目录被长期锁住，每个写都付 30ms 且都失败 → 队列堆积且持续失败，**无熔断**。建议对齐 `ModelEventClassifier` 的熔断范式。

### ③ 单测是否真正覆盖重试耗尽与非瞬时错误？

**覆盖了主路径，但有 6 处缺口。**

| 路径                                   | 状态                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 可重试码识别（含无 code / null）       | ✅ 已覆盖                                                                                             |
| 首次成功只 rename 一次、不 sleep       | ✅ 已覆盖                                                                                             |
| 两次 EPERM 后成功、退避 10/20ms        | ✅ 已覆盖                                                                                             |
| 重试耗尽 → 抛最后一次错误              | ⚠️ **覆盖了，但没有断言退避序列**（`sleepFn` 被桩成 no-op → 不验证「中间也 sleep 了、sleep 了多久」） |
| 非瞬时错误（ENOENT）→ 立即抛、不 sleep | ✅ 已覆盖                                                                                             |

**缺口**：① 耗尽用例应断言 `delays === [10, 20]`；② **混合错误序列**（EPERM → ENOENT → 立即放弃）未测，而这正是「重试掩盖真实故障」的关键边界；③ `attempts` / `baseDelayMs` 的 **clamp 分支零覆盖**（`attempts: 0` → 1、`attempts: 1` → 不重试、`baseDelayMs: 0` → 不 sleep、浮点截断）；④ 退避公式边界（`attempts: 5` → `[10,20,40,80]`）未测；⑤ 非字符串 `code`（如 `{code: 123}`）未测；⑥ **集成层未测** —— 「rename 耗尽 → `appendTurn` 抛 → `enqueue` 链继续 → 后续写仍成功」这条 AF-414 新增抛错路径后的关键不变式没有断言。**⑥ 最值得补。**

### ④ Windows rename 语义是否有更优雅的原子替换方案？

**原子性不是问题，占用才是。** 替换语义已由 `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` 保证；Windows 的限制是不许替换被打开的文件 → EPERM 来源。

**更优雅的答案是三条组合**：(a) 用 Node 内建的 `{ maxAge, retry, retryDelay }` 做兜底（**本机 Node v26 实测可用**；本仓已有先例：`debug-session-persistence.spec.ts:261` 的 `rm(dir, { maxRetries: 5, retryDelay: 50 })`），**同时保留手写外壳以覆盖内建没有的 EACCES 并保证可测**；(b) tmp 名唯一化 + `wx`；(c) `writeFile` 同享重试。**不建议**改成「删旧再改名」或「直接写目标」——那两个更差（见 §3.2 表）。

### ⑤ 遗漏的边界

共 12 条，按优先级：**P1 数字三处不一致** → **P2 根因未证实** → **P3 tmp 名固定（跨进程覆盖，且重试放大窗口）** → `writeFile` 未纳入重试 → 耗尽无降级 + `.tmp` 残留 → `get()` 读带写副作用且绕过队列（**测试覆盖的是 mirror=null 分支，生产默认分支没被测**）→ 无 jitter / 窗口偏短 → 无熔断 → 无计数器 → 无 fsync（应写明而非假装有）→ O(n²) 全量写 → clamp 与混合错误零覆盖。

---

## 五、第二件事：A′ 精确率人工标注的分层抽样方案（只给方案，不执行）

### 5.1 先看清现在的数字（我实跑 AF-409 / AF-412 得到）

| 指标                               | 值                                                                                                               | 来源                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------- |
| 落盘 neutral-only 轮（13 场）      | **157**                                                                                                          | AF-409 / AF-412 输出 |
| A′（narrow）判 holding_present     | **117**（74.5%）                                                                                                 | AF-409 `narrow` 行   |
| A′ 判 cold_absent                  | **1**                                                                                                            | 同上                 |
| A′ 后仍 neutral                    | 39（neutralRate 0.2484）                                                                                         | 同上                 |
| 对照：宽疑问 A（≤40 字）           | holding=16，neutralRate **0.8981**                                                                               | 同上                 |
| 对照：严格疑问 AS                  | holding=135，neutralRate 0.1401                                                                                  | 同上                 |
| 对照：结构化 ST（疑问 ∧ 结构标记） | holding=5                                                                                                        | 同上                 |
| cold 场 14 轮                      | holding=11 / cold=0 / neutral=3 → trust 0.2500，safety 0.2940                                                    | AF-409 `cold14` 行   |
| 批次影响（AF-412）                 | zero_motion 3 → 2（翻转 1 场）；受影响 11/13 场；**整批 safety +0.4660 / bond +0.2320**；单场最大 safety +0.0560 | AF-412 输出          |
| 敏感性（均匀误判率假设）           | 25% → safety +0.1165 / bond +0.0580；50% → +0.2330 / +0.1160                                                     | AF-412 敏感性表      |

**三条必须写进方案前提的判断**：

1. **A′ 的覆盖极广（74.5%）**，意味着它近乎把「带问句或带内容词的中性轮」整体划归「在场」→ **这是一个系统性重标，不是细粒度修补**；精确率若不达标，伤害面是**整批**而不是个别场。
2. **AF-412 的 safety +0.4660 是「全命中」上界**；AF-409 的合成样例已经暴露两类问题：结构化**陈述**（如「我们分三步来：…」）被判 neutral（**漏判**），带承接开头的中短句（如「嗯，我明白你的意思。」）被判 neutral（**漏判**）→ **A′ 同时有精确率问题和召回率问题**，抽样必须同时测两者。
3. **`cold` 场 11/14 轮被判 holding_present** → 若 precision 不达标，cold persona 的会话会被系统性地改写成「稳定在场的有效中性」——**正是把 cold 拉向 neutral 的方向**（与我前两轮审计的结论方向相反）。

### 5.2 目标量（先定义清楚，再谈抽样）

| 量                 | 定义                                                                                      | 用途                      |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------- |
| **P_hold**         | 在 A′ 判 `holding_present` 的轮里，人工确认「确实是在场且非对峙/非敷衍/非机械复述」的比例 | 开关准入的**主指标**      |
| **P_cold**         | 在 A′ 判 `cold_absent` 的轮里，人工确认「确实是敷衍/缺席」的比例                          | 防止把正常短承接判成缺席  |
| **R_hold（代理）** | 在 A′ 判 `neutral` 的轮里，人工判定「其实是在场」的比例（漏判率）                         | 决定 A′ 是否**过窄**      |
| **误判方向矩阵**   | 对峙 → 在场的轮数 / 最小应答 → 在场的轮数 / 温暖短句 → 缺席的轮数                         | 对应我前一轮的 7 条验收线 |

**关键口径纪律**：

- 分母必须是**全量命中池**（不是抽样池）；层内比例按 **Wilson 区间**（小样本不用正态近似）。
- 合成总体比例 = **Σ W_h × P_h**（`W_h` = 该层在**全量语料**中的占比），**不是**层比例的简单平均。
- AF-412 的 `scaleImpactByErrorRate` 应由**按层误判率**替换均匀误判率（§2.7）。

### 5.3 抽样框与分层维度（关键：不能只抽命中轮）

**两个抽样框**：

| 框                                                   | 用途                              | 抽样量占比建议 |
| ---------------------------------------------------- | --------------------------------- | -------------- |
| **框 1：A′ 命中轮**（holding 117 + cold 1）          | 估 P_hold / P_cold / 误判方向矩阵 | **约 70%**     |
| **框 2：A′ 未命中轮**（neutral 39 + 非 eligible 轮） | 估 R_hold（漏判）                 | **约 30%**     |

> 只抽框 1 只能估精确率；**框 2 不可省** —— AF-409 的合成样例已经显示漏判存在，而漏判会让「A′ 让 cold 场 neutral 降下来」这个卖点失真。

**分层维度（每轮打多层标签，用**交叉分层**或**主层 + 次层**）**：

| 层     | 维度                      | 取值                                                                                                                                                                    | 为什么必须是层                                                                                                                                            |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | **A′ 判定路径**           | `A′-question`（疑问 ∧ 结构/内容）/ `B′-mediumAck`（5–12 字承接带内容）/ `B′-minimalAck→cold_absent` / `C′`（≤4 字无疑问）/ `GREETING` / `confrontation-guard`（被拦下） | 6 条路径的错误模式完全不同，混在一起估精确率没有意义                                                                                                      |
| **L2** | **问句语法**              | 真问句（句末 ？/吗/呢） vs **疑问词子串命中**（无问号、无句末语气词）                                                                                                   | 我上一轮实测：A′/A 系里「靠疑问词子串命中而非问句语法」占 2/14 ≈ 14%，且 `QUESTION_WORD` 含 `几`/`哪`（会命中「几乎」「几天」「哪里」）→ **必须单独成层** |
| **L3** | **发言长度**              | ≤4 / 5–12 / 13–40 / >40                                                                                                                                                 | 已有 `charBucket`（D-1 现成），且 C′/B′ 的长度门槛全在这一维                                                                                              |
| **L4** | **咨询师模式（persona）** | `cold` / `expert` / `novice` / `preachy` / `chatty` / `nonsense` / 未知                                                                                                 | **cold 与非 cold 的 A′ 精确率大概率不同** → D-1 的 `stratifiedSample` 已把 `cold` 富集排在最前，但**前提是 `counselorModeId` 有值**（见 §5.6）            |
| **L5** | **对抗守卫命中**          | 是 / 否                                                                                                                                                                 | 我上一轮实测本地对峙样本 = 0 → **守卫这一层本地无样本，必须合成补样**                                                                                     |
| **L6** | **轮次段**                | 首轮 / 中段 / 尾轮（收束）                                                                                                                                              | D-1 已有 `segment`；尾轮是总结/收束句式，与中段的精确率不同                                                                                               |

### 5.4 分配方式与样本量

- **分配**：**Neyman 分配**（层内方差越大分得越多）`n_h = n · N_h·S_h / Σ(N_h·S_h)`；**层内 `N_h < 8` 的层做全检（census），不做抽样**。
  - 先验方差来源（我上一轮实测）：L2「疑问词子串命中」层的疑似误判率最高（2/14）→ `S_h` 最大 → 该层应多抽；L1「confrontation-guard」层本地 `N_h = 0` → **必须合成补样**。
- **总量**：
  - 想让总体 P_hold 的 **95% CI 半宽 ≤ 0.08**（真实 p≈0.8）→ **n ≈ 96**（`z²p(1−p)/e²`）。
  - 只抽 **30** 轮 → 半宽 ≈ **0.143** → 只能区分「≥0.70」与「<0.60」，**不足以支撑开关准入**。
  - **建议：n = 100（框 1 = 70，框 2 = 30）**，并按 §5.6 先把语料补到能支撑这个量级。
- **置信区间方法**：**Wilson**（小样本稳定），不用正态近似。
- **确定性**：D-1 的 `stratifiedSample` 是**确定性无随机**的（可复算）→ 新增分层维度时沿用同一纪律（按层内 key 排序取前 N），**不要引入随机种子**，否则复算对不上。

### 5.5 标注规程（直接对齐既有 I-11 协议，不要另起一套）

- **协议**：仓库已有《出口④临床标注协议》与 I-11 复核记录（`docs/worklog/completed/phase2.5/i11-acceptance-rerun.md`），已定义 **双人盲标（匿名代号、不暴露 gold 锚点）+ 仲裁**、**κ ≥ 0.60**、**仲裁在原始标注上算 κ**、维度信号量门槛。**A′ 精确率标注直接沿用该协议与门槛。**
- **标注单位**：**轮**（一个咨询师发言 = 一个判定单位），与 AF-412「每轮一个标签」同口径。
- **标注类别（互斥单选）**：
  1. `在场-有效`（稳定在场、有温度或结构推进）
  2. `在场-中性`（在场但无情感反应，冷但在场） ← **A′ 把它与 1 合并，人工必须能分开**
  3. `结构推进/事实澄清`（结构化过渡、行动规划） ← **A′ 目前漏判这类，必须能分开**
  4. `敷衍/模板/最小应答`
  5. `对峙/施压`
  6. `机械复述/无动作`
  7. `无法判定`（进仲裁，不进分子分母）
  > 类别 1+2 合并为「在场」→ 分子；3 单列（它检验 A′ 的**漏判**）；4+5 合并为「不该算在场」→ 分母侧证据。
- **盲化（必须做）**：现成的 `buildAnnotationCsv`（`d1-event-classifier-evidence.lexicon.ts:673-695`）**把 `machine_candidate` 直接放进标注表** → 标注者会看到机器候选 → **锚定偏差**，精确率会被系统性高估。
  **方案**：产出**两份文件** —— ① 给标注者的盲表（**不含 `machine_candidate`**，只含 id / 轮号 / 长度桶 / 事件标签 / 文本 / 空白 `human_label`）；② 机器侧的 key 文件（`machine_candidate` + 分层标签），**标注者不可见**，标注结束后按 `debug_session_id#turn_index` 连接。
- **工具复用（不要另写采样器）**：扩展 `d1-event-classifier-evidence.lexicon.ts`：
  - `projectTranscript` 已支持外部注入 `counselorModeId`（`:277-281`）→ **用它接 batch lineage**（见 §5.6）；
  - 已有 `charBucket`（长度桶）、`neutralRunLength`（连续中性长度）、`segment`（轮次段）、`stratifiedSample`（模式×角色×段，cold 富集 + 尾段优先 + 剔降级轮）→ **新增的只是 L1/L2/L5 三个 A′ 专属维度**；
  - 新增维度进 `ProjectedTurn`（A′ 路径 / 问句语法 / 对抗守卫命中）→ `stratifiedSample` 的 stratum 串扩展为 `mode|character|segment|A′path|questionSyntax`。
- **隐私**：标注表含咨询师原话 → 必须落在 `data/quality/`（不进版本库）；控制台与统计只出 id / 计数 / 比例 / 标签。

### 5.6 必须先补的四项数据（否则精确率不可估）

| #   | 缺口                                         | 为什么                                                                                                                                                            | 怎么补                                                                                                                                             |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **对峙语料（本地 0 样本）**                  | 对抗守卫这一层本地无样本 → 守卫是否有效完全未知                                                                                                                   | 构造**合成**对峙样本集（只作标注集，不进生产语料、不进回归）                                                                                       |
| 2   | **敷衍 / 最小应答语料（本地 ≤4 字仅 1 轮）** | `B′-minimalAck` / `C′` 两层样本量 < 8 → 无法估 P_cold                                                                                                             | 同上，合成补样；或从更长的历史逐字稿里捞                                                                                                           |
| 3   | **48 场批次的 37 份缺失逐字稿**              | 现在只有 13 场本地逐字稿，命中池 117 轮但**几乎都来自非 cold 场**                                                                                                 | 补齐归档逐字稿（batch-metrics service 已支持 `data/archives/` 回退）                                                                               |
| 4   | **`counselorModeId` 注入**                   | D-1 的分层主键含 `counselorModeId`，而本地逐字稿**没有这个字段**（`encounter` 只有 `{mode, channel}`）→ 不注入时所有行都是 `unknown`，**cold 富集这一层静默失效** | 用 WP-K 批次快照的 `lineage`（含 `counselorModeId`）喂给 `d1-event-classifier-evidence.ts --lineage`；长期解法是让逐字稿落盘时带 `counselorModeId` |

### 5.7 分析与验收口径

1. **按层报 P_hold / P_cold / 误判方向矩阵**（每层 Wilson 区间）。
2. **合成总体**：`P_overall = Σ W_h · P_h`，`W_h` 取自**全量语料**计数。
3. **回填 AF-412**：用**按层**误判率替换 `scaleImpactByErrorRate` 的均匀假设 → 得到「修正后的 safety/bond 增量」与「修正后的 zero_motion 翻转数」。
4. **准入判据（承接前两轮审计的 7 条验收线，改为可测形式）**：

| #   | 判据                  | 门槛                                                                            |
| --- | --------------------- | ------------------------------------------------------------------------------- |
| 1   | 对峙 → 在场的误判     | **= 0**（L5 层，合成 + 真实双证）                                               |
| 2   | 最小应答 → 在场的误判 | **= 0**（L1 `B′-minimalAck` 层）                                                |
| 3   | 总体 P_hold           | **≥ 0.85**（Wilson 下界 ≥ 0.80）                                                |
| 4   | R_hold（漏判）        | **≤ 0.15**，且「结构推进」类漏判 ≤ 0.10                                         |
| 5   | 投影 trust            | 全程 **不上升**（≤ 0.25 ± 0.01），确保不出现 0.95 型反向飙升                    |
| 6   | cold 场专项           | cold 子集的 P_hold **不低于**总体 P_hold − 0.05（防止「把 cold 拉向 neutral」） |
| 7   | 内核红线              | `git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 11 条全绿    |
| 8   | 开关                  | 适配层 env **缺省关**；关闭时分类输出与现状**逐字相同**                         |

### 5.8 建议的推进顺序

1. 补 §5.6 的 4 项数据（尤其 `counselorModeId` 注入 —— 它决定 D-1 的核心分层是否真的生效）。
2. 扩展 D-1：加 L1/L2/L5 三维 + **盲表拆分**（拆出 `machine_candidate`）。
3. 按 §5.4 配额抽 n=100，双人盲标 + 仲裁（κ ≥ 0.60），按 §5.7 出结论。
4. 用按层误判率回填 AF-412 → 得到修正后的影响数字。
5. 判据全过 → 才有资格讨论「适配层 feature flag（缺省关）」；**判据不过 → 不做**（明确结论：不做比做一个会刷高 safety 的开关更安全）。

---

## 六、可执行但只读的验证命令

> 全部只读；不写仓库、不提交、不改编排状态面。命令用 `pnpm`，禁裸 `npx`。

```powershell
# ── AF-414 定向单测（本评审已复跑：2 文件 / 33 用例全绿，3.20s）────────────────
pnpm exec vitest run test/admin-debug/af414-atomic-write-retry.spec.ts test/admin-debug/debug-session-persistence.spec.ts

# ── AF-414 相关闸门（只读校验；typecheck 会写 tsbuildinfo 缓存，可改用 --incremental false）──
pnpm lint
pnpm typecheck
git diff --stat HEAD -- src/engine-core        # 必须为空（内核红线）

# ── 只读复算 AF-414 的退避参数与实际 sleep 序列（与交付记录 §3.2 的 70ms 对账）──
node -e "const{renameWithRetry}=require('D:/work/Project/backend/mofang-nestjs-af281r/dist/admin-debug/debug-session-store.js');let d=[];renameWithRetry('a','b',{renameFn:async()=>{const e=new Error('x');e.code='EPERM';throw e},sleepFn:async ms=>d.push(ms)}).catch(()=>console.log('delays=',d,'total=',d.reduce((a,b)=>a+b,0),'ms'))"

# ── 在场信号两个只读审计脚本（无原文输出）────────────────────────────────────
node scripts/ops/quality/af409-presence-narrowing.mjs
node scripts/ops/quality/af412-presence-false-positive-impact.mjs --dir data/debug-sessions
node scripts/ops/quality/af408-presence-calibration.mjs --dir data/debug-sessions

# ── D-1 漏判率取证（出标注骨架 CSV；会写 data/quality/，属离线产物）─────────
pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts --dir data/debug-sessions

# ── 批次只读查询（需 .env 的 DB 配置；本评审未执行）──────────────────────────
node scripts/ops/canary/batch-metrics.mjs hRW4V44-t43yyty_EyLke

# ── 48 场批次的 counselorModeId 分布（§5.6 第 4 项缺口；需 DB）───────────────
#   建议从 WP-K 批次快照的 lineage 字段取（含 counselorModeId），喂给 D-1 的 --lineage

# ── 工作区是否干净（评审前后各跑一次，确认本次评审零写入）───────────────────
git status --short
```

---

## 七、评审过程说明

1. **只读**：未改任何代码 / 未提交 / 未写仓库文件（除本文件）/ 未跑 git 写操作 / 未碰 `src/engine-core` / 未改编排状态面。
2. **实跑**：AF-414 定向单测（2 文件 / 33 用例全绿）、AF-408/409/412 三个只读脚本、Node 内建 rename 重试选项的**系统临时目录**探针（探针目录已清理，仓库未触碰）。
3. **未验证的断言（明示）**：Node 内建 rename retry 的错误码白名单是否覆盖 `EACCES`（未构造强制 EPERM/EACCES 场景，§3.2 ① 已给出需实测的说明）；AF-412 逐场数字与我用真实内核 `transitionState` 逐轮重算的差异（口径不同源，见 §2.5）。
4. **本文全部结论为工程判断**，不含临床有效性主张；AF-414 属调试面板基础设施，不涉及心理内容。
5. **隐私**：本文件与评审过程只使用 id / 计数 / 比例 / 标签 / 参数 / 合成示例；未复制任何逐字稿原文。

---

_评审时间：2026-11-24 04:00–04:30 · 全程只读 · 本文件为唯一写入_
