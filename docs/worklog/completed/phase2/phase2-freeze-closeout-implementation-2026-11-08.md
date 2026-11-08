# Phase2 封版收口 · 交付记录

> **路径**：`docs/worklog/completed/phase2/phase2-freeze-closeout-implementation-2026-11-08.md`
> **任务单**：`docs/worklog/completed/phase2/phase2-freeze-closeout-2026-11-08.md`（已从 `pending/` 移入）
> **状态**：✅ 已交付
> **日期**：2026-11-08
> **性质**：**文档 + 测试夹具** 单 —— 零 `src/` 改动、零测试断言弱化、**engine-core 零改动**（§A2 未触发「真实缺陷」分支，未碰 `src/`）
> **封版凭证**：[§Phase2 封版记录](phase2-freeze-2026-11-08.md)（八节）

---

## 一、结论速览

| # | 收尾项 | 结果 |
|---|---|---|
| **A1** | 日期夹具 3 条确定性红 | ✅ 修完 —— 单文件 **42/42 绿**；**时钟无关证明**：默认日期临时改成 `2026-01-01T00:00:00.000Z` 仍 **42/42 绿** |
| **A2** | WP38 并行 flake 1 条 | ✅ 修完 —— 加诊断 + 该调用点 30s 上限；**单文件连跑 10 次全绿**（每次 10 例） |
| **A 整体** | 闸门 | ✅ tsc **0 error**（20.3s）· 全量 **142 文件 / 2338 例 / 0 failed / 19 skip**，**连续 2 次全绿**（84.35s + 70.99s）· eslint **0** · boundary **12 用例全绿** · engine-core diff **空** |
| **B** | WP47 账实对齐 | ✅ **路径一** —— 考古命中 `a9ca450`，已写[补登记录](engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md)；母版第 55 行已改口径 + 挂链接 |
| **C** | Phase4 承接清单 | ✅ 已建 `pending/phase4-backlog-2026-11-08.md`（5 条 + 依赖链 + 每条可判定解除条件）；母版已加交叉链接 |
| **D** | 封版记录 | ✅ 已建 §Phase2 封版记录（八节） |

---

## 二、A ｜ 测试闸门

### 2.1 A1 · 日期夹具（3 条确定性红）

**根因**（任务单已定位，本单复核属实）：夹具 `buildRecord()` 的默认 timestamp 写死 `'2026-11-07T00:00:00.000Z'`，而断言取 `todayKey()`（墙上时钟）→ 交付当天恰好相等所以绿，**跨过零点后永久红**。

**改动**（文件：`test/admin-debug/deliberation-stats.spec.ts`，**只动测试**）：

| # | 位置 | 改前 | 改后 |
|---|---|---|---|
| 1 | 夹具默认 timestamp（:221） | `timestamp: '2026-11-07T00:00:00.000Z'` | `timestamp: new Date().toISOString()`（附根因注释） |
| 2 | 用例 ②「全局 key 与当日日 key 同时累加」（:474） | 日 key 用 `todayKey()` | 日 key 用 `resolveDeliberationStatsDay(record.timestamp)`（**从记录自己的时间戳推导**） |
| 3 | 用例 ②「日 key 的 TTL = 90 天」（:489） | 同上 | 同上 |
| 4 | 用例 ⑤「days=7 → 聚合最近 7 天的日 key」（:785） | "昨天"取 `buildDeliberationStatsDateKeys(2, new Date())[0]`（墙上时钟）→ 撞上夹具那一天会把夹具自己写的 1 覆盖成 5 | 记录时刻显式取 `now`；"昨天" = **相对该记录日期的前一天**；并加一条断言 `expect(yesterday).not.toBe(recordDay)`（两天必须不同，防覆盖问题复活） |

**验收三条（全做）**：

| 验收项 | 命令 | 结果 |
|---|---|---|
| ① 单文件全绿 | `npx vitest run test/admin-debug/deliberation-stats.spec.ts --reporter=dot` | ✅ **Test Files 1 passed / Tests 42 passed**（3.04s） |
| ② 时钟无关证明 | 临时把默认改成 `'2026-01-01T00:00:00.000Z'` 再跑同一文件 | ✅ **仍 42/42 绿**（2.63s）→ 证明完**已改回** `new Date().toISOString()` |
| ③ 硬编码日期 grep | 见下 | ✅ 只剩**刻意用例** |

**③ 硬编码日期 grep 结果**（改后）：

```
spec:221  // ⚠️ **不写死任何日期** (V2026-11-08 治本): 原来写死 '2026-11-07T00:00:00.000Z',   ← 注释里提到旧值, 不是活代码
spec:513  // 2026-11-07T16:30Z = 上海 2026-11-08 00:30 → 落进 11-08
spec:514  expect(resolveDeliberationStatsDay('2026-11-07T16:30:00.000Z')).toBe('2026-11-08');
spec:515  // 2026-11-07T15:59Z = 上海 2026-11-07 23:59 → 落进 11-07
spec:516  expect(resolveDeliberationStatsDay('2026-11-07T15:59:59.000Z')).toBe('2026-11-07');
spec:522  const record = buildRecord({ timestamp: '2026-11-07T16:10:00.000Z' });
spec:739  const now = new Date('2026-11-08T03:00:00.000Z'); // 上海 2026-11-08 11:00
spec:742  expect(dateKeys).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
spec:751  expect(buildDeliberationStatsDateKeysBetween('2026-11-01', '2026-11-03')).toEqual([...]);
spec:770-777  parseDeliberationStatsWindow 的参数校验 (days=-1 / from 单独传 / 13 月 / 02-30 / from 晚于 to / 超 90 天)
spec:854  await expect(controller.deliberationStats(undefined, '2026-11-01')).rejects.toThrow(BizException);
spec:856  await expect(controller.deliberationStats(undefined, '2026-01-01', '2026-11-05')).rejects.toThrow(BizException);
```

**逐条为什么保留**：

| 位置 | 为什么保留 |
|---|---|
| :513-516 | 断 **Asia/Shanghai 日界**（UTC 15:59 / 16:30 两点）的**纯函数**口径用例 —— 输入是显式字面量，**不读墙上时钟**，保留它就是保留这条口径的回归网 |
| :522 | 断「跨天会话按**结束时间**归天」（23:50 → 次日 00:10）的口径用例 —— 同上，显式输入 |
| :739-742 | 断 `buildDeliberationStatsDateKeys` 「含今天、升序、上海日界」的**纯函数**用例（自己喂 `now`）—— 它测的是"给定 now 怎么算"，不是"现在几点" |
| :751 | 自定义区间的**闭区间升序**口径用例（显式 from/to） |
| :770-777 / :854 / :856 | 窗口参数的**校验**用例（非法值必须 400 / 抛错）—— 日期是**被校验的输入**，不是"今天" |

> ✅ 结论：**改完之后，本文件再无任何"断言读墙上时钟、而被测数据用别的日期"的错配**。剩下的固定日期全部是"显式输入 → 显式期望"的纯函数 / 校验用例，与时钟无关。

### 2.2 A2 · WP38 并行 flake

**改动**（文件：`test/admin-debug/wp38-debug-session-resume.spec.ts`，**只动测试**）：

1. **加诊断**（任务单 §2.2 第 1 步）：在触发标题生成**之前**装上 `vi.spyOn(Logger.prototype, 'warn')` 捕获告警；等待超时时的错误信息带出 **现场**：
   `session=… fileExists=… title=… titleSource=… warns=… cause=…`
   —— **只带字段名 / 状态值 / 错误名，绝不打印对话正文或 prompt**（心理内容红线）。
   为什么要捕获告警：标题生成在 service 里是 `void this.generateTitle(...)`，**catch 里只 warn**（`debug-session.service.ts:912-914`）→ "写失败"与"还没写完"在测试侧**长得一模一样**，不捕获告警就永远分不出是哪种。
2. **等待上限**：该调用点 `waitFor(..., 30_000)`（**只改这一处**；`waitFor` 的默认 10s 留给其它调用点）。
3. **不弱化断言**：没有 skip、没有删用例、没有把 `toBe` 降级；断言失败时**原样抛**（只有"等待超时"才补现场信息）。

**连续验证**：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 单文件 ×10 | `npx vitest run test/admin-debug/wp38-debug-session-resume.spec.ts --reporter=dot`（连跑 10 次） | ✅ **10/10 次全绿**，每次 **Test Files 1 passed / Tests 10 passed** |
| 全量 ×2 | `npx vitest run --reporter=dot`（连续两次） | ✅ 第 1 次 **137 passed / 5 skipped (142)**、**2319 passed / 19 skipped (2338)**、**0 failed**（84.35s）；第 2 次**同数**（70.99s） |

> ℹ️ **30s 上限仍红 → 按真实缺陷处理**那条分支**没有触发**（10 次单跑 + 2 次全量都没再红），因此**本单没有碰 `src/`**，也没有改「等待异步副作用」之外的任何机制。
> 📌 **诚实的遗留**：**根因没有被实证**（没有一次失败现场可抓）。本单交付的是「①诊断已就位（下次再红会直接告诉你是哪种）+ ②等待上限提到 30s」；若将来仍红，诊断信息会直接指向是 enqueue 排队饿死还是 rename 被 catch 吞了 —— **那条路径不需要再从头查**。
> ⚠️ 顺带记录一条**未处理的真实隐患**（**不属本单范围，未修**）：`debug-session-store.ts:416-422` 的写入是「临时文件 + rename」，而 Windows 上 rename 覆盖**正在被读**的目标文件可能失败；失败被 `generateTitle` 的 catch 吞掉只留 warn。这与观测到的症状一致（"写失败"与"未写完"同形），但**本单没有复现到它**，所以**只登记、不下结论、不改代码**。

### 2.3 A 的完成定义（闸门实测）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **exit 0，0 error**（20.3s；任务单基线 ~47s，本机更快） |
| 全量 #1 | `npx vitest run --reporter=dot` | ✅ **Test Files 137 passed | 5 skipped (142)**；**Tests 2319 passed | 19 skipped (2338)**；**0 failed**（84.35s） |
| 全量 #2 | 同上（紧接着再跑一次） | ✅ **同上**（70.99s） |
| skip 数 | — | ✅ **19**（= 基线 19，未增未减） |
| eslint | `npx eslint test/admin-debug/deliberation-stats.spec.ts test/admin-debug/wp38-debug-session-resume.spec.ts` | ✅ **0 error / 0 warning**（首轮报 4 条 prettier 格式错 —— 本单新写的多行调用；已 `--fix` 重排，重跑 0） |
| 边界 | `npx vitest run test/engine-core/boundary.spec.ts --reporter=dot` | ✅ **12 个用例全绿**（详见 §二.4） |
| engine-core | `git diff --stat HEAD -- src/engine-core` | ✅ **空** |
| 定点回归（eslint --fix 后） | 两个改过的 spec 一起跑 | ✅ **2 files / 52 tests 全绿** |

### 2.4 boundary 断言条数（**实测口径，不抄陈旧值**）

| 口径 | 值 | 说明 |
|---|---|---|
| **实测用例数** | **12** | 11 条不变量 ①–⑪ + **1 条"扫描自检"**（防止扫描逻辑本身写错而空转） |
| **实测 expect() 数** | **18** | `Select-String 'expect('` 计数 |
| 「README §2」原写 | 11 条 | ❌ 陈旧 —— 11 是**不变量**数，漏了那条扫描自检 |
| 审计报告原写 | 13 条 | ❌ 也不准 —— 实测只有 12 个用例 |

→ **两个陈旧口径都不照抄**，封版记录与 README 一律写**实测 12 个用例（18 个 expect）**。

---

## 三、B ｜ WP47 账实对齐（**路径一：补登**）

**考古命令与结果**（可复现）：

```powershell
git log --all --oneline -S 'SupervisionReportRepositoryTypeorm' -- src
# → a9ca450 feat(counselor): 落地 vpt 会话桥接与督导报告落库查询, 修复 marks 列映射致报告 500, ...

git log --all --oneline --diff-filter=A -- src/migration/1714900000020-AddSupervisionReports.ts
# → a9ca450 (同上)

git log --all --oneline --diff-filter=A -- src/agent/supervisor/domain/entities/supervision-report.entity.ts
# → 7a77586 feat(agent): 接入 Supervisor Agent (... SupervisorReport + LLM JSON 解析 + 6 维度校验 + parse_error 兜底 ...)
```

| 项 | 值 |
|---|---|
| WP47 本单 commit | **`a9ca450`**（2026-10-26 17:35:01 +0800） |
| 前置 commit | `7a77586`（2026-10-09 18:03:29 +0800）—— Supervisor Agent 接入（entity + 内存仓储） |
| engine-core 改动 | ✅ **实测两个 commit 的 `git show --stat -- src/engine-core` 均为空** |
| 当时的闸门数字 | ❌ **记录缺失，未留存**（本单早于"每个任务单都写闸门数字"的工作流成型）—— **按任务单要求不编数字** |

**产出**：[§WP47 补登记录](engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md)（含 commit / 文件清单 / 16 列 3 索引 + UNIQUE(tenant_id, session_id) / 不变量 / engine-core 实测 / 闸门缺失声明）。

**母版回写**（`phase2-wp-list-2026-11-03.md:55`）：
- 「2026-10-26 完成，清单回写补登」→「2026-10-26 完成，commit `a9ca450`」；
- 追加 engine-core 实测说明 + **补登记录链接** + 「⚠️ 本 WP 工于 2026-10-26，早于 Phase2 工作流成型；这份交付记录是 2026-11-08 回填补登的」。

✅ **验收**：母版里现在**不存在任何"✅ 但既无记录、也无替代说明"的行**。

---

## 四、C ｜ Phase4 承接清单

**产出**：`docs/worklog/pending/phase4-backlog-2026-11-08.md`（新建，留在 `pending/` —— Phase4 开工时用）。

| 要求 | 落地 |
|---|---|
| 表头固定 8 列 | ✅ 编号 / 名称 / 优先级 / **原始内容** / 依赖 / **解除条件** / **范围与产出** / **为什么不在 Phase2 做** |
| 范围按母版原文抄，不许改写 | ✅ 「原始内容」列**逐字抄**母版登记表（含母版预估：中 / 中） |
| 依赖链 | ✅ **WP33←WP27，WP39←WP33，WP40←WP33**（与母版一致），另附 ASCII 依赖链图 |
| 每条可判定的解除条件 | ✅ WP27=商户号到手；WP29=留存年限书面拍板；WP33=会员档位定稿 + tier→model 表落地；WP39=映射表 + **真机听感校准**；WP40=标签注入 + **TTS 真发声**（无"待定"） |
| 开头定性 | ✅ 「这 5 条**不是**"以后有空再说"，是"**能收费运营**"的硬前置」+ 四条串一条链 + WP29 是合规底线 |
| 母版交叉链接 | ✅ wp-list「未完成 5 条」处加「📤 未完成 5 条的去向」块，指向本文件 |

**另附**（超出任务单最低要求，但同属"移交即不丢"）：外部输入清单（商户号 / 会员档位 / 留存年限 / 真机校准环境，各自找谁、卡住哪几条）+ **销账规则**（解除条件逐条核对，"写完映射表"不等于解除 WP39）。

---

## 五、D ｜ 封版记录

**产出**：`docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md`（八节固定结构）：
① 封版口径（38/43 + 5 条去向 + 9 条独立单不计入分母的口径）· ② 闸门实测（数字 + 命令 + 耗时 + boundary **实测 12 用例**）· ③ 交付覆盖核查（文件数 / implementation 数 / 独立单数 / **38 个 ✅ 各对应哪份交付记录**的脚本生成清单 / WP47 处理结论）· ④ 未提交清单 + 建议 commit message · ⑤ 封版后基线（测试总数 / boundary 条数 / engine-core 阶段性红线 / 三个开关缺省状态）· ⑥ **Phase2.5 的真实入口**（= 打开影子开关 + 跑真实场次 + 用统计面板看质量，**不是新开一批 WP**）· ⑦ Phase2.5 开工前置（心理原文出境 / 高风险零分流，**如实登记不掩盖**）· ⑧ 没封的东西（6 项 Phase3 阻塞 + 审计登记的非阻塞缺口，**不自行加码**）。

---

## 六、母版回写（本单动了哪几处）

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | ① WP47 行（:55）：commit + 补登记录链接 + engine-core 实测 + 回填补登说明；② 进度注记后新增「📤 未完成 5 条的去向」块 → 指向 Phase4 承接清单 |
| `docs/worklog/README.md` | ① §0 新增「**Phase2 封版（2026-11-08）**」状态行（口径 / 闸门 / 两份记录链接）；② §1 补「pending/ 里的三个文件都不是 Phase2/3 的活」口径（母版 ×2 + Phase4 清单 ×1）；③ §2 把 `boundary.spec.ts 11 条断言` 改成**实测 12 个用例（18 个 expect）**并注明 README 原值与审计值都是陈旧口径 |

---

## 七、未提交清单 + 建议 commit message

> ⚠️ **本单不 commit / 不打 tag / 不 push**（任务单 §7.3）。以下清单给项目主理人照单提交。

**开工时工作区已有的 9 个（上一单「文档收尾」留下的，本单未提交）**：

| # | 状态 | 文件 |
|---|---|---|
| 1 | M | `docs/README.md` |
| 2 | M | `docs/architecture/ai-engine-roadmap-v1.1.md` |
| 3 | M | `docs/worklog/README.md`（本单又改了 3 处） |
| 4 | M | `docs/worklog/pending/phase2-overview-2026-11-03.md` |
| 5 | M | `docs/worklog/pending/phase2-wp-list-2026-11-03.md`（本单又改了 2 处） |
| 6 | ?? | `docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md` |
| 7 | ?? | `docs/worklog/completed/phase2/phase2-code-vs-blueprint-audit-2026-11-08.md` |
| 8 | ?? | `docs/worklog/completed/phase2/phase2-docs-tidy-up-2026-11-08.md` |
| 9 | ?? | `docs/worklog/completed/phase2/phase2-docs-tidy-up-implementation-2026-11-08.md` |

**本单新增 / 改动（7 个）**：

| # | 状态 | 文件 | 说明 |
|---|---|---|---|
| 10 | M | `test/admin-debug/deliberation-stats.spec.ts` | A1：夹具 + 3 条期望值改时钟无关 |
| 11 | M | `test/admin-debug/wp38-debug-session-resume.spec.ts` | A2：诊断 + 30s 上限 |
| 12 | ?? | `docs/worklog/completed/phase2/engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md` | B：WP47 补登记录 |
| 13 | ?? | `docs/worklog/pending/phase4-backlog-2026-11-08.md` | C：Phase4 承接清单 |
| 14 | ?? | `docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md` | D：封版记录 |
| 15 | ?? | `docs/worklog/completed/phase2/phase2-freeze-closeout-2026-11-08.md` | 本任务单（已移入 completed/） |
| 16 | ?? | `docs/worklog/completed/phase2/phase2-freeze-closeout-implementation-2026-11-08.md` | 本交付记录 |

**建议 commit message**（两笔，边界更清楚）：

```text
docs(phase2): 文档收尾 —— 母版补 WP60/WP62 的 ✅ 与 WP65 枚举、进度统一 38/43、roadmap §9 过期数字修正、新增独立单清单（9 条）

test+docs(phase2): 封版收口 —— 修统计面板日期夹具 3 红与 WP38 并行 flake、WP47 补登、Phase4 承接清单、Phase2 封版记录（38/43，闸门全绿）
```

---

## 八、偏差说明

| # | 任务单怎么写的 | 本单实际做的 | 理由 |
|---|---|---|---|
| **B1** | A1 推荐用 `vi.setSystemTime(now)` 钉钟，**关掉最后一处时钟依赖** | **没用 fake timers**：改用「"昨天" = 相对 **record.timestamp** 的前一天」+ 用例开头显式取 `now` | ① 本文件**没有任何依赖 timer 的代码**，引入 fake timers 只会带来"await 等不到 setTimeout"的新风险；② 任务单自己点出的目标（断言不跟时钟走）用「从 record.timestamp 推导」**更彻底地达成** —— 连"今天"都不再从墙上时钟取；③ 用例 ③ 另加一条 `expect(yesterday).not.toBe(recordDay)`，把"两天不能撞同一天"变成**机器断言**，比钉钟更直接地堵住覆盖问题。**时钟无关证明仍按任务单要求做了**（默认日期临时改 `2026-01-01` → 仍 42/42 绿） |
| **B2** | A2 步骤 1：诊断「读到的 title / titleSource / 文件是否存在」 | 在此基础上**额外捕获 Logger.warn**（服务层失败只 warn 不抛，不捕获就分不出"写失败"与"未写完"） | 任务单 §2.2 已点明这个歧义；只报三个字段仍然无法定位。捕获内容**只有错误名与 sessionId**，不含任何心理内容 |
| **B3** | C 只要求"新建承接文件 + 母版交叉链接" | 额外加了**外部输入清单**与**销账规则**两节 | "移交即不丢"要成立，光有表不够 —— 要写清**卡住它的是谁**（商户号/定价/法务/真机）与**什么算解除**（避免 Phase4 写了代码就销账） |
| **B4** | D 第 2 节要求"boundary 写实际条数" | 实测 = **12 个用例（18 个 expect）**；并指出 README 的 11 与审计的 13 **都是陈旧口径** | 任务单只说"别抄 11"，实测发现审计的 13 也不对 —— 两个都不照抄，统一以实测为准（偏差被写进封版记录与 README） |
| **B5** | —— | README §2 的 `11 条断言` 一并改掉；README §1 补「pending/ 里三个文件都不是活」的口径 | 封版后 pending/ 里留着 Phase4 清单，下一个 AI 若按 §1「有文件就是活」去开 Phase4 的单就是误工 —— §1 必须同时改口径与说明 |
| **B6** | —— | **未碰 `src/`**（A2 的"真实缺陷"分支没触发） | 红线：默认不许改 src/；没有复现就没有改动的依据 |

---

## 九、外部阻塞（登记，不拍板）

1. **微信 / 支付宝商户号**（卡 WP27 → WP33 → WP39 / WP40）—— 主体资质，不在后端；
2. **会员档位最终方案**（卡 WP33 → WP39 / WP40）—— 产品定价决策；
3. **数据留存年限**（卡 WP29）—— 法务 / 等保口径；
4. **真机听感校准环境**（卡 WP39）—— 设备 + 督导真人。

→ 已写进 §Phase4 承接清单 的「Phase4 开工前要先拿到的外部输入」表。**本单不替这些拍板，也不为了绕开阻塞改任何口径。**

---

## 十、收尾自查（交付前最后一轮）

| # | 检查项 | 命令 / 方法 | 结果 |
|---|---|---|---|
| 1 | 占位符残留 | 用正则字符类 `[\u00AB\u00BB]` 全量扫 `docs/` + `test/` | ✅ **零命中**（早期用 U+00AB / U+00BB 作占位写长 markdown，曾残留 187 处，已全部替换为反引号并复扫） |
| 2 | 相对链接可达性 | 自写 node 脚本扫本单 14 份文档的 markdown 相对链接，逐一 `fs.existsSync` | ✅ **198 条相对链接 / 0 条失效**（首轮实测 2 条失效：`completed/phase2/phase2-code-vs-blueprint-audit-2026-11-08.md` 指向审计报告写成 `../audits/...`，少一级目录 → 已改为 `../../audits/...`，复跑 0 失效） |
| 3 | `src/` 零改动 | `git diff --stat -- src/` | ✅ **输出为空** |
| 4 | engine-core 零改动 | `git diff --stat HEAD -- src/engine-core` | ✅ **输出为空** |
| 5 | 工作区清单 | `git status --short` | ✅ **16 项**（7 M + 9 ??），与 §七 清单逐条一致；临时校验脚本已删除，工作区无残留 |

> 校验脚本为一次性产物，跑完即 `rm`（进 mavis-trash 可恢复），**未进工作区**，未列入提交清单。

---

_本单为文档 + 测试夹具单：零 src/ 改动、零测试断言弱化、engine-core 零改动。_
