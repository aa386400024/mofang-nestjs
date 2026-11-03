# WP28 · WP11 临时值回改正式生产值 · 后端交付记录

> 任务单: [`wp28-psyguard-production-values-2026-11-03.md`](./wp28-psyguard-production-values-2026-11-03.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 兄弟仓: `E:\Work\Project\backend\mofang-psyguard`
> 日期: 2026-11-03 ｜ 性质: Phase2 第一个 WP —— **不是写新功能，是把 WP11 的临时值改回生产值**

---

## 0. 一句话结论

**11 处回改全部落地**：PsyGUARD 探测超时 `500ms → 150ms`、服务侧 token 窗口 `256 → 28`，两侧口径自洽。

**但任务单 §4「不改 `src/engine-core/**`（本 WP 不需要碰内核）」是一句事实错误** —— `DEFAULT_PROBE_TIMEOUT_MS = 500` 这个内核硬上限**恰恰就住在** `src/engine-core/cognition/safety/assess-safety.ts:75`，而咨询师输入面（`in-memory-engine-session.ts:274` 调 `assessSafety` 时**不传** `timeoutMs`）走的正是这个默认值。**不改它，150ms 在主输入面就不生效**。已就此与用户当面确认并取得授权（改内核常量 + 登记例外；兄弟仓一并改），例外登记见 §5.1。

**闸门**：eslint **0 error 0 warning** / tsc **0 错** / vitest **1296 例全绿（1281 passed + 15 skipped，89 个文件）** / 兄弟仓 Python **37 例全绿** / `git diff --stat HEAD -- src/engine-core` = **1 个文件**（= A1，用户授权的例外）。

---

## 1. 任务单与代码现状的出入（先说这个，因为它改变了改动面）

### 1.1 任务单 §3.1 与 §4 自相矛盾

| 任务单原文 | 事实 |
|---|---|
| §3.1「超时：`500ms` → `150ms`；token 窗口：`256` → `28`」 | ✅ 方向正确（正式口径就是 150ms / 28） |
| §4「❌ 不改 `src/engine-core/**`（**本 WP 不需要碰内核**）」 | ❌ **事实错误**：500ms 常量就在 engine-core，且是主输入面的实际生效值 |
| §5 闸门「`git diff --stat HEAD -- src/engine-core` → 空」 | ⚠️ 改 A1 后必然是 1 个文件 → 需登记例外，不能装作空 |

**权威依据不在 WP28，在 WP25**：Phase1 封版审查报告 §1.4 已经把这件事写清楚了 —— 任务单原文「测试期 150ms / token 28 是放宽值，内测前要回改生产值（500ms / 256 token）」**方向写反了**（WP25 已修正为 150/28 才是生产值），并附了 **11 处回改 checklist**（本仓 8 + 兄弟仓 3）。WP28 任务单是照着那个方向写的，只是**漏了"这个值住在内核"这件事**。

### 1.2 运行时到底有几条超时路径（为什么 A1 是"地基"）

实测装配层 `engine.module.ts` 有 **4 条**超时路径，**没有一条**在代码里硬编码 500：

| # | 路径 | 超时来源 | 改 A1 后 |
|---|---|---|---|
| ① | 咨询师输入面 `in-memory-engine-session.ts:274` → `assessSafety({ text, side:'counselor_input', probe })` | **不传 `timeoutMs` → 内核默认 `DEFAULT_PROBE_TIMEOUT_MS`** | **跟着变 150**（这就是 A1 必须改的原因） |
| ② | `engine.module.ts:132` `RISK_PROBE` 工厂 | `resolvePsyGuardTimeoutMs(env)` → env 未设时回落内核常量 | 跟着变 150 |
| ③ | `engine.module.ts:189` 输出侧 `createVisitorOutputProbe` | 同上 | 跟着变 150 |
| ④ | `engine.module.ts:235` 学员侧闸门 `createStudentRiskGate` | 同上 | 跟着变 150 |

**所以 A1 改了，②③④ 自动跟着变**（env 未设时它们回落常量）；但 ① 只能靠 A1 —— 这就是「不改内核则 150 不生效」的精确机制。

> ⚠️ WP25 清单把 A2–A4 写成「env `500` → env `150`」，容易被读成"代码里写着 500 要改"。**实际含义是 env 的取值**（`.env.example` A5 + 生产机 `.env`），代码里三处都只是 `resolvePsyGuardTimeoutMs(config.get('PSYGUARD_TIMEOUT_MS'))`，**一个字都不用动**。本轮已核实并写进交付记录，免得下一个人去 `engine.module.ts` 里找不存在的 500。

### 1.3 用户拍板（开工前确认）

| 决策点 | 用户选择 |
|---|---|
| 内核红线 | **改内核常量 + 登记例外**（A1 已由 WP25 清单 A1 授权；常量文件头本就自带回改清单） |
| 兄弟仓 token 窗口 | **一并改，交付记录单列**（WP25 清单 B1–B3） |

---

## 2. 改动清单 —— 本仓 `mofang-nestjs`（6 个文件）

| WP25 编号 | 文件 | 改动 |
|---|---|---|
| **A1** | `src/engine-core/cognition/safety/assess-safety.ts` | `DEFAULT_PROBE_TIMEOUT_MS` **500 → 150**（唯一的行为改动）；文件头的「回改清单」重写为「回改历史 + 三侧必须一致」；`AssessSafetyInput.timeoutMs` 的 JSDoc 由「当前 500，内测前回改」改为「缺省 = 150ms」 |
| **A5** | `.env.example` | `PSYGUARD_TIMEOUT_MS=500` → **数值删除，留空继承内核常量**（⚠️ 同日**后续清理单**改的，见 §10；本单初版先改成了 `150`） |
| **A6** | `test/engine-core/wp4-safety.spec.ts` | 断言 `expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(500)` → **`.toBe(150)`**；注释改为「把正式探测预算钉死」 |
| **A7** | `src/engine-adapters/wiring/risk/http-psyguard.probe.ts` | 文件头超时说明 + `HttpPsyGuardProbeOptions.timeoutMs` 的 JSDoc：口径改 150 |
| **A8** | `src/engine-adapters/wiring/risk/psyguard-health.checker.ts` | 口径提醒注释：改 150 |
| **额外** | `src/engine-adapters/wiring/engine.providers.ts` | **修正一处会误导人的注释**：原注释写「超时：**不显式传** —— 让它继承内核常量 …… 只有一个回改点」，但装配层 `engine.module.ts:189` **恰恰是显式传** `resolvePsyGuardTimeoutMs(env)` 的（WP25 审查 D34 实锤）。这条注释不改，下一个人会以为"只改内核常量就够了" → 正好踩中 WP25 §1.4 要防的那个坑 |

> **A2–A4（`engine.module.ts` 三处）代码零改动** —— 见 §1.2：三处都不含字面量 500。

## 3. 改动清单 —— 兄弟仓 `mofang-psyguard`（5 个文件）

| WP25 编号 | 文件 | 改动 |
|---|---|---|
| **B2** | `classifier.py` | `DEFAULT_MAX_LENGTH` **256 → 28**；常量注释重写为「✅ 正式口径 = 28」+「为什么当时放宽、又为什么必须改回」+「三侧必须一致」+ 回改历史；模块 docstring 第 3 节与 `:param max_length:` 同步 |
| **B1** | `docker-compose.yml` | `PSYG_MAX_LENGTH: "256"` → **`"28"`**；注释改为正式口径说明 |
| **B3** | `tests/test_classifier.py` | 默认窗口断言 `256` → **`28`**；用例改名 `test_default_window_is_the_temporary_test_phase_value` → **`test_default_window_is_the_production_value`**；docstring 改写 |
| **额外** | `README.md` | 口径同步 5 处：特性表「窗口默认 256」→ 28、标题「窗口：正式口径是 28，测试阶段临时放宽到 256」→ 「窗口：正式口径是 28」、窗口章节整段重写（含 256 窗口实测表标注为「已回改，留档」）、回改清单 → 回改记录、`/health` 示例 `"max_length": 256` → **`28`** |
| **额外** | `main.py` | `/health` docstring 的 `max_length` 口径说明同步 |

> **`tests/test_api.py` 里的 `self.max_length = 256` 刻意不动** —— 该文件已自带说明「桩值：/health 直接回显这个数，与 `classifier.DEFAULT_MAX_LENGTH` 无关（不受测试期临时窗口值影响，改回 28 时这里**不需要**跟着改）」。

> **`scripts/` 里的 256 不动** —— `exp_truncation.py` / `exp_window_caps.py` / `bench_latency.py` 的 256 是**「不截断」对照组与基准扫描档位**，是当初选 28 的实验依据本身，改了就把实验记录毁了。

---

## 4. 关键设计决策

### 4.1 决策一：改内核常量，但**只改值 + 改注释**，不改任何结构

`assess-safety.ts` 的改动是 **1 行常量 + 注释**，`git diff` 显示 36+/28−，其中 34 行是注释。**没有新增/删除任何导出、没有改函数签名、没有改 `withTimeout` 的语义、没有碰 `boundary.spec.ts` 的 11 条断言**（内核仍然是纯函数、零 `process.env`、零 NestJS）。

**为什么不把 150 抽成注入端口**（像 WP26 P2-14 的 `DeltaCapConfig` 那样）：那个模式是为了让**env 走适配层**、内核零 `process.env`。而这里是**改一个常量值**，不是引入新的配置维度 —— 引入端口反而多一处回改点，而 WP25 §1.4 的口径恰恰是「三侧必须一致，越少真相源越好」。**保持 A1 是唯一的内核真相源**，env 只是它的可选覆盖。

### 4.2 决策二：注释要写「**为什么**」，不只写「现在是多少」

原注释的病是**会骗人**（WP25 P2-9 / P2-10 抓的就是这个：一个文件里同时写着 150 和 500，排查的人会照着错的那个改）。本轮每处注释都统一成同一个句式：

> ✅ 正式口径 = 150ms（WP28 已回改；测试期临时值 500 已作废） → 为什么 150 是**真机标定**出来的（9.9ms + 3.34ms/token，28 token 稳在 ~104ms）→ 为什么当时放宽、又为什么必须改回 → **三侧必须一致**（本常量 / env / 兄弟仓 token 窗口）→ **回改历史**（150→500→150）

**回改历史特意留着**：这样下一个再看到 150 的人，能查到它是怎么变成 500 的、为什么又要变回来 —— 而不是把这次回改当成"历史包袱"再改一次。

### 4.3 决策三：`.env.example` 的 `PSYGUARD_TIMEOUT_MS` —— **键留着，数值删掉**（初版写的是 150，同日后续清理单改掉）

WP25 清单 C 段给的是二选一：「`PSYGUARD_TIMEOUT_MS` 500 → 150」**或**「删该行 → 继承内核常量」。

- **本单初版**：选了「改成 150」，理由是显式值 > 隐式回落，排查时一眼看得到数字；
- **后续清理单（同日晚，用户发起）**：改成**留空**（数值删除）—— 理由是模板里写死一份，就多一份**会漂移的真相源**：内核常量改了而模板没改时，env 的显式值会**盖掉**新常量（env 优先于代码缺省），于是出现「内核等 150ms、HTTP 还在等 500ms」这种自相矛盾的口径。**真相源只留内核常量一个，模板不重复它。**

**为什么是「留空」而不是「整行删掉」**：`test/config/wp25-env-example-coverage.spec.ts` 的断言① 要求「代码里读的每个 env 键，模板里都必须有**生效行**」（装配层 `engine.module.ts` 三处都在读 `PSYGUARD_TIMEOUT_MS`）。整行删掉会让那条机器守卫变红 —— 等于为了"模板干净"去削弱部署契约的守卫，得不偿失。

留空与删行**运行时完全一致**（`resolvePsyGuardTimeoutMs('')` → 回落到 `DEFAULT_PROBE_TIMEOUT_MS`），但键仍然可见、仍可覆盖、契约不破。

> 真正"整行删掉"只有两条路，**都需要用户拍板**（见 §10.2）：① 改代码不再读这个 env；
> ② 给机器守卫加豁免名单（承认"读得到但不该出现在生效区"这一类键）。
> **本轮没做** —— 两者都超出「清理模板」的范围，且都会改变部署契约或运行时可配性。

### 4.4 决策四：兄弟仓的 256 窗口实测数据**留档，不删**

README 里那张「256 窗口 / 2.0 核 / 900M，n=100 端到端」实测表**保留了**，只是改了标题标注为「测试期 256 窗口的实测（已回改，留档）」，并在下面补了一句它**为什么重要**：

> **这组数就是「放宽窗口并不免费」的证据**：256 窗口下连 ≈200 字的长句 p50 都到 585ms，**装不进 150ms 的预算**；而当时配套放大的 500ms 上限，恰恰是「每轮多等 500ms」的来源。

**删掉它，下次有人又想放宽窗口时，就只剩下"28 是拐点"这个结论而没有"放宽的代价有多大"的数据。**

### 4.5 决策五：把「1.3pp 准确率」**如实写进两侧注释**，不当成没这回事

28 窗口相对不截断的准确率代价是 **0.9304 → 0.9174（−1.3pp）**，长文本结尾的危机表达分数也更低（0.9813 vs 0.9823、0.8730 vs 0.9208）。本轮在 `classifier.py`、`assess-safety.ts`、兄弟仓 README 三处都**明写了这个代价**，并说明为什么仍然选它：**每轮 ~104ms vs ~585ms，且 585ms 那档连 150ms 的预算都装不进** —— 装不进去的准确率是零。

---

## 5. 红线核对

### 5.1 engine-core 红线：**1 个文件，用户已授权的例外**

```
$ git diff --stat HEAD -- src/engine-core
 src/engine-core/cognition/safety/assess-safety.ts | 64 +++++++++++++----------
 1 file changed, 36 insertions(+), 28 deletions(-)
```

**授权链**（不是"我判断可以破"，是本来就有据）：

1. **WP25 审查任务单 §1.4 的回改 checklist A1** —— 第 1 项就是「`assess-safety.ts:75` `DEFAULT_PROBE_TIMEOUT_MS` 500 → 150」，标注为「**内核硬上限，整条链路的地基**」；
2. **常量文件头自带回改清单** —— 原 `assess-safety.ts:65-74` 就写着「**回改清单（M3 内测前，一次性做完，跨两个仓库 6 处）**：- 本常量: 500 → 150」，这是 WP11 当初留下的**自授权**；
3. **用户 2026-11-03 当面拍板**：「改内核常量 + 登记例外」。

**与 WP11 / WP26 的先例一致**：WP11 审核后为 1 个文件（用户决策 #4 要求改探测超时常量）、WP26 P2-14 为内核加 env 注入端口 —— **两次都是用户明确拍板后改的内核**，且都要求在交付记录里标注。本单是第三次，标注方式与前两次一致。

**`boundary.spec.ts` 的 11 条断言全部通过**（见 §6）。

### 5.2 其余红线

| 红线 | 核对结果 |
|---|---|
| 不碰 `admin-dashboard/` / Flutter | ✅ **零改动**（发现 `PsyGuardMonitor.vue:106` 有 `p90Ms > 500` 的前端告警阈值 + i18n 文案「超过 500ms 会触发内核超时」已过时 → **前端红线，本单不碰**，登记给前端 AI，见 §7） |
| 不跑前端命令 | ✅ 只跑了 `npx eslint` / `npx tsc` / `npx vitest`（+ WSL 里的 `python3 -m unittest`） |
| 不改 voice WS 协议 | ✅ 零改动 |
| 不改内核函数结构/签名/语义 | ✅ 仅 1 行常量值 + 注释 |
| 不自动 commit / push | ✅ **本轮不提交**，commit 文案见 §8 |

---

## 6. 闸门数字（2026-11-03 实测）

### 6.1 本仓 `mofang-nestjs`

```
npx eslint "src/**/*.ts"                        → exit 0（0 error 0 warning）
npx tsc -p tsconfig.build.json --noEmit         → exit 0（0 错）
npx vitest run                                  → 85 文件 passed | 4 skipped (89)
                                                 1281 例 passed | 15 skipped (1296)  ✅ 全绿
git diff --stat HEAD -- src/engine-core         → 1 个文件（A1，用户授权的例外，见 §5.1）
```

**定向复跑**（红线 + PsyGUARD 相关）：

```
npx vitest run test/engine-core/boundary.spec.ts \
                  test/engine-core/wp4-safety.spec.ts \
                  test/engine-adapters/wp11-psyguard-probe.spec.ts
                                                 → 3 文件 passed / 78 例 passed ✅
```

> **关于第一次全量跑出现的 2 例失败**（`test/counselor/wp21-report-stream.spec.ts`，`status: 'timeout'` vs `'completed'/'no_content'`）：**已核实为既有的时序 flake，不是本单引入**。证据三条：
> ① 单独重跑该文件 → **15/15 全绿**；
> ② `git stash` 掉本单全部改动后在 HEAD 基线上复跑全量 → **1281 passed / 0 failed**；
> ③ 带本单改动复跑全量 → **1281 passed / 0 failed**（与基线逐例一致）。
> 失败那次全量耗时 **89.88s**（vs 复跑的 55.02s），是冷启动 + 89 worker 并行抢 CPU 导致该用例的轮询 deadline 过期 —— 该用例的断言本身就依赖毫秒级时序。本单与报告 SSE 轮询链路**零交集**（本单只改安全探测超时常量与注释）。
> **按 Phase1「既有债不擅自修」的纪律处理**：不在本单改 `src/counselor/**`，登记给 WP29/审查单（见 §7）。

### 6.2 兄弟仓 `mofang-psyguard`

```
python3 -m unittest discover -s tests -t .      → Ran 37 tests ... OK  ✅ 37/37 全绿
```

- 与 WP11 基线**同口径**（WP11 交付记录 §8.4 记的就是「37 例全绿」）；
- 日志实证新默认值生效：`PsyGUARD 模型加载完成: /nonexistent (max_length=28, threshold=0.5, threads=2)`；
- **运行环境说明（可复现）**：本机 Windows **没有可用的 Python**（`WindowsApps\python.exe` 只是 Microsoft Store 占位），改用 **WSL Ubuntu 22.04 的 Python 3.10.12** 跑；测试需要 `numpy` / `onnxruntime` / `tokenizers` / `fastapi` / `httpx` 五个导入依赖，已 `pip install --user` 装进 WSL 用户目录（**仅本机测试环境，不改仓库任何依赖文件**）。生产镜像的依赖仍以 `requirements.txt` 为准（`onnxruntime==1.20.1` / `numpy==1.26.4` / `tokenizers==0.19.1` 等）。

---

## 7. 未做 / 留给别人的事（必须如实看）

| # | 事项 | 为什么本单不做 | 归属 |
|---|---|---|---|
| 1 | **生产机 `/opt/mofang-nestjs/.env` 的 `PSYGUARD_TIMEOUT_MS`** | 不在本仓；且这是**真机配置变更**，不是代码交付 | **上线前必须做**：**删掉该行**（不设 = 继承内核常量 150，最省心）或改成 `150`。⚠️ **若线上还留着旧的 `500`，它会盖掉内核常量 —— 线上实际仍是 500ms**，模板改了不等于线上改了 |
| 2 | **生产机 `mofang-psyguard` 容器的 `PSYG_MAX_LENGTH`** | 兄弟仓的 compose 文件改了，**线上容器还跑着 256** | **上线前必须做**：重建/重启该容器（`PSYG_MAX_LENGTH` 是环境变量，不重启不生效） |
| 3 | **`admin-dashboard/src/views/PsyGuardMonitor.vue:106`** 的 `p90Ms > 500` 告警阈值 + `i18n/locales/{zh-CN,en}.ts` 的「超过 500ms 会触发内核超时」文案 | **前端红线**（前端另一个 AI 管） | 交给前端 AI：阈值改 150、文案改「超过 150ms 会触发内核超时」 |
| 4 | **`test/counselor/wp21-report-stream.spec.ts` 的时序 flake** | 既有债，且**不在本单改动面**内 | 建议 WP29 或下一次封版审查处理（收紧轮询 deadline 或加容差） |
| 5 | **真机延迟复测** | 本单无真机访问权限 | 内测前用真机复测：28 窗口端到端 p50 应落在 ~104ms 量级（WP11 口径） |

---

## 8. commit 文案（**本轮不提交，等用户指令**）

**`mofang-nestjs`**：

```text
fix(psyguard): WP28 把 WP11 测试期临时值回改正式生产值 —— 探测超时 500ms→150ms（内核 DEFAULT_PROBE_TIMEOUT_MS + .env.example + 断言，engine-core 1 文件为用户授权例外）+ 适配层与内核注释口径统一 + 修正 engine.providers.ts「只有一个回改点」的误导注释
```

**`mofang-psyguard`**（兄弟仓）：

```text
fix(psyguard): WP28 token 窗口 256→28 回改正式值 —— classifier.DEFAULT_MAX_LENGTH + compose PSYG_MAX_LENGTH + 单测断言 + README/main.py 口径同步
```

---

## 9. 出处

| 内容 | 出处 |
|---|---|
| 11 处回改 checklist（A1–A8 + B1–B3） | `docs/worklog/completed/phase1/wp14-wp24-augment/engine-wp25-phase1-audit-backend-2026-11-03.md` §1.4 |
| 回改方向的事实纠正（150/28 才是生产值） | `docs/worklog/audits/wp25-phase1-audit-report-2026-11-03.md` §1.4 |
| "装配层显式传 env，不跟内核常量走"（D34） | `docs/worklog/audits/code-vs-blueprint-audit-2026-10-30.md` D34 |
| 真机延迟成本曲线与 28 的准确率横评 | WP11 交付记录 §8.3（`completed/phase1/wp6-wp12-wiring/engine-wp11-psyguard-python-service-backend-implementation-2026-10-30.md`） |
| 兄弟仓口径（窗口 / 延迟预算） | `E:\Work\Project\backend\mofang-psyguard\README.md`「窗口：正式口径是 28」 |

---

## 10. 后续清理单（同日晚 · `.env.example` 模板清理）

用户在本单交付后发起：「清理 `.env.example` —— 模板只是模板，不该重复代码里的真相源」。**改动只落在 `.env.example`，没碰任何 `src/` 代码**（模板本身不参与编译，eslint / tsc 只是走一遍确认无副作用）。

### 10.1 改了什么（6 处）

| 位置 | 改动 | 为什么 |
|---|---|---|
| PsyGUARD 段 | `PSYGUARD_TIMEOUT_MS=150` → **留空**（数值删除） | 模板里写死一份 = 多一份会漂移的真相源（内核常量改了、模板没改 → env 显式值**盖掉**新常量） |
| 文件头「值的三种写法」 | 补两条：**故意不等代码缺省**的要写清差在哪；**可选覆盖类**键留空 = 继承代码默认值 | 原来的写法规则已经覆盖不了本文件里的实际情况 |
| `LLM_DEFAULT_EMBEDDING_PROVIDER` | 注释原写「缺省 embedding = qwen」，模板却钉 openai | 代码缺省是 qwen（`llm-router.service.ts:71-72`），知识库路径另有独立缺省 openai（`knowledge.service.ts:377`）；模板钉 openai 是为了配 `EMBEDDING_MODEL=text-embedding-3-small`，注释得写清这个差别 |
| `MINIMAX_LLM_MODEL` / `_TIMEOUT_MS` / `_MAX_RETRIES` | 注释把「模板值」说成「缺省」 | 代码缺省是 MiniMax-M3 / 30s / 2 次重试，模板显式钉 M3.1-Flash / 60s（有据）；另「重试上限 3 次」实为 **2 次重试 = 3 次尝试**（`llm.service.ts:151` 的 `attempt <= maxRetries`） |
| `QDRANT_COLLECTION` | 注释原写「engine-adapters 的记忆仓储默认用它」—— **假的** | 记忆仓储用的是代码常量 `visitor_long_memory`（`qdrant-memory.store.ts:211`，与知识库刻意隔离）；这个键读进 config 命名空间后**无人消费** → 改成写清真相 +「配了不影响运行时」 |
| `QDRANT_KB_COLLECTION` | 注释原写「与上面是两个集合」，但两个值都是 `knowledge_chunks` | 自相矛盾；真正在用的只有这一个 |
| `ENGINE_CAP_*` 段 | 注释原写「这些键在 src/engine-core 内核里读取（内核唯一一处 env 依赖）」 | **WP26 P2-14 后已不成立**：内核零 env 读取（有机器断言守着），由适配层 `delta-cap.config.ts` 读、经端口注入。同时保留「仍是进程级配置、回放不可跨环境对拍」这条要点 |

### 10.2 第二轮（结构改造 · 用户拍板后做）

用户拍板三件事，本轮全部落地：

| # | 决定 | 落法 |
|---|---|---|
| 1 | `PSYGUARD_TIMEOUT_MS` —— **保留键、留空、不删**；内核常量是真相源，env 只是运维应急旋钮 | 保持第一轮的结果（数值删除、键保留），并把注释改成写明「env 只是应急旋钮 + 生产机若留着旧值会盖掉内核常量」 |
| 2 | `QDRANT_COLLECTION` / `VOICE_SESSION_IDLE_TIMEOUT_MS` —— **移到文件底部单独一个「预留键（当前未消费，配了不生效）」区** | 两个键从各自的生效段落**移出**，落到文件底部新开的区；各带注释说明为什么留着（将来功能预留）与各自的具体口径 |
| 3 | 守卫盲区**记进 backlog**，下次审查处理 | 新开 **WP48**（P2 技术债）：`wp25-env-example-coverage.spec.ts` 分不出「读进 config」与「真被消费」；Phase2 清单与总览的 P2 计数同步（3→4 条、21→22 条） |

**结构改造的关键约束**：这两个键**代码确实读得到**（`default.ts:268` / `default.ts:229`），所以守卫断言①要求它们在模板里必须是**生效行**。直接注释掉会让守卫变红 —— 等于为了"看起来干净"去削弱部署契约。

所以它们的形态是：**仍是生效行，但挪到文件底部一个明确标注"配了不生效"的区**，并在文件头补上第三类语义（生效行 / 注释行 / 「读得到但未消费」区）。**位置即语义**：照抄它们不会改变任何行为（`qdrant.collection` 与 `voice.sessionIdleTimeoutMs` 都无消费点，已逐个核实），而顶部的生效区从此只留"配了真的生效"的键。

- `QDRANT_COLLECTION=` —— **值留空是有意的**：旧值 `knowledge_chunks` 是**知识库**的集合名，谁将来把它接到记忆仓储上，就会把来访者私有长时记忆写进公共知识库集合（正是 `qdrant-memory.store.ts` 注释里警告的"互相污染召回且带来隐私面"）。留空 = 不预设一个会踩雷的值。
- `VOICE_SESSION_IDLE_TIMEOUT_MS=600000` —— 保留值：它**等于代码缺省**（`?? 600_000`），照抄 = 与不配一致；注释写明真正生效的是 MINUTES 版，将来接线时别两个同时生效（单位打架）。

### 10.3 没有做的一件事（需要拍板）

**彻底删掉 `PSYGUARD_TIMEOUT_MS` 这一行**（而不是留空）：两条路 —— ① 改代码不再读 env（内核常量成为唯一运行时真相源，但运维失去"不改代码就能调超时"的旋钮）；② 给守卫加豁免名单（承认"读得到但不该出现在生效区"这一类键）。

**本轮没做** —— 两者都会改变部署契约或运行时可配性，不该顺手决定。用户已明确「保留键、留空」，所以按此执行。

> 守卫盲区本身已按用户指示记进 backlog（WP48），不在本轮修：修法是让守卫顺着 `process.env.X` → `config.get('命名空间.x')` 追一层消费点，把「读得到但无人消费」单列成一类。

### 10.4 闸门（2026-11-03 实测）

```
npx eslint "src/**/*.ts"                        → exit 0（0 error 0 warning）
npx tsc -p tsconfig.build.json --noEmit         → exit 0（0 错）
npx vitest run                                  → 85 文件 passed | 4 skipped (89)
                                                 1281 例 passed | 15 skipped (1296)  ✅ 全绿
npx vitest run test/config/wp25-env-example-coverage.spec.ts
                                                 → 5/5 ✅（生效行集合未变：175 → 175，契约未破）
git diff --stat HEAD -- src/engine-core         → 仍为 1 个文件（A1，§5.1）—— 两轮清理均未新增内核改动
```

---

_创建：2026-11-03_（§10 后续清理单同日补入，含两轮：模板精简 + 结构改造）
