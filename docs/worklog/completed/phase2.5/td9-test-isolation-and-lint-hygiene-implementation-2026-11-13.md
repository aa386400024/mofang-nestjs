# TD-9 · 测试隔离残留清理 · lint 告警清零 · ESLint 缓存稳定性 · git 环境前置 —— 交付记录

> 状态：✅ 已交付（2026-11-13，MiniMax Code）
> 任务单：[td9-test-isolation-and-lint-hygiene-task-2026-11-13.md](td9-test-isolation-and-lint-hygiene-task-2026-11-13.md)
> 分支：integrate · 起点 HEAD `4424092`（TD-8 交付）· 改动未提交（本单不自动 commit/push）
> 事实源：[工程工具链技术债清单](../../pending/phase2.5-toolchain-tech-debt-2026-11-11.md) · [闸门性能 remediation](../../../team/gate-performance-remediation-2026-11-11.md) §9 P-DEBT-1 / 2 / 3 / 9

---

## 一、结论

四条遗留全部处置，**零生产业务行为变化**，**engine-core 零 diff**：

| 项                  | 处置                                                                          | 量化结果                                                                            |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **T-1**（P-DEBT-1） | 4 个非 e2e spec 补统一重置钩子，重复复位逻辑抽共享 helper                     | 4 文件复位钩子齐全；断言期望与用例数量**逐字未变**                                  |
| **T-2**（P-DEBT-2） | ESLint 缓存失效变量定位（本机对照实验）+ 本机/CI key 口径统一 + CI 加缓存步骤 | 冷跑 **183.6 s** → 命中 **5.8 s**（31.8×）；**额外修掉 TD-8 遗留的 4 个失效缓存键** |
| **T-3**（P-DEBT-3） | 57 条 oxlint 告警逐条定性并处置                                               | oxlint fast **4 → 0**、deep **57 → 0**（0 error / 0 warning）                       |
| **T-4**（P-DEBT-9） | git 可用性探测 + `GIT_BIN` 注入 + 不可用 skip                                 | 三处 git 调用统一走解析后的路径；不可用时该用例 skip（不误判回归）                  |

闸门终态：根 tsc **0 error**、build tsc **0 error**、ESLint **0 error / 0 warning**、oxlint fast **0/0**、oxlint deep **0/0**、boundary **12 绿**、全量 **3248 passed + 4 skipped（3252 例，194 文件）**（与基线逐字一致）、`git diff --stat HEAD -- src/engine-core` **空**。

---

## 二、T-1 · spec 间 mock / env / 单例残留清理（P-DEBT-1）

### 2.1 四文件残留定性表

| 文件                                                             | 残留类型                                 | 现场定性（复核后）                                                                                                                                                                                                                                                     | 复位方式（改后）                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts`  | ① mock 实现未还原 ② spy 复位点散在用例内 | `beforeEach` 只 `mockClear` 六个 bull 替身；`vi.restoreAllMocks()` 写在 ②-3 用例**体内**（用例中途失败即泄漏给后序用例）；`bull.add.mockRejectedValueOnce` 这类**一次性实现**不会被 `mockClear` 清掉                                                                   | 顶层 `beforeEach` 改走 `resetTestDoubles(bull)`：还原 spy + `mockReset` 把替身复位回 `vi.fn` 工厂默认实现 |
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` | ① mock 实现未还原                        | 原 `beforeEach` 有 `mockClear` + `vi.restoreAllMocks()`，但同样缺一次性实现复位                                                                                                                                                                                        | 同上，与 wp65 **同一份**共享 helper（不各抄一份）                                                         |
| `test/engine-adapters/wp12-memory-closeout.spec.ts`              | 模块级 stub 状态跨用例累积               | 无 `vi.mock`、无任何生命周期钩子；模块级只有不可变常量（TENANT / USER / PERSONA / CLOCK）；**唯一**跨用例可变状态 = 两个 describe 共用的 `const embedder = { embed: vi.fn(...) }` 计数器；其余替身（FakeEngineTurnService / StubQdrant / FakeSink…）全部用例内局部 new | 顶层 `beforeEach` `clearMockCalls()` 清零计数器；**复核结论：无模块级可变残留**                           |
| `test/engine-core/i12-session-alliance-config.spec.ts`           | mock 计数未清 + 复位点散在用例内         | `vi.mock` planner；`vi.mocked(planIntention).mockClear()` 写在两个用例**体内**，用例中途失败即把调用计数漏给下一个用例                                                                                                                                                 | 顶层 `beforeEach` `resetTestDoubles({ planIntention })`（还原实现 + 清计数），删掉两处用例内 `mockClear`  |

### 2.2 env 读写审计

4 个 spec **零 `process.env` 读写**（现场 grep 核实：`process.env` 命中 0）。任务单假设的"env 被改写未还原"在这 4 个文件里**不成立** —— `wp12` 里的 `resolveMemoryConfig()` 走的是**构造注入**（`env = {}` 默认值），不读 `process.env`。env 快照 helper 仍按任务单 §3.1.5 要求封装为**可复用件**（见 §2.3），本单无调用点。

### 2.3 共享工具（新建 `test/helpers/`）

| 文件                        | 导出                                                                                                                           | 性质                                          | 复用点                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------- |
| `test/helpers/isolation.ts` | `resetTestDoubles` / `resetMockDoubles` / `restoreSpies` / `clearMockCalls` / `snapshotEnv` / `restoreEnv` / `withEnvSnapshot` | 纯函数 + 无状态工具，**不持有模块级可变状态** | wp65 / wp67 / wp12 / i12 四个 spec      |
| `test/helpers/git-probe.ts` | `resolveGitBinary` / `probeGitBinary` / `probeGit` / `GIT_BIN_ENV` / `DEFAULT_GIT_BINARY`                                      | 纯函数（探测结果不缓存）                      | wpH（T-4），后续任何依赖外部命令的 spec |
| `test/helpers/index.ts`     | 集中出口                                                                                                                       | —                                             | —                                       |

**为什么用 `mockReset` 而不是 `mockClear`**：`mockClear` 只清调用记录，用例里 `mockRejectedValueOnce(...)` 这类一次性实现会留在替身上，后序用例没触发到就带着旧实现跑（跨用例污染）。Vitest 5 的 `vi.fn(impl).mockReset()` 会**还原成 `vi.fn` 工厂给的默认实现**（源码 `@vitest/spy` 的 `resetToMockImplementation: true`），既清计数也清一次性实现 —— 这正是"复位"要的口径。
**为什么 `vi.restoreAllMocks()` 单独用**：它只还原 `vi.spyOn` 的原始实现（源码 `MOCK_RESTORE` 集合），**不动** `vi.fn` 造的模块级替身 —— 两者职责不重叠，合并成一个 `resetTestDoubles` 入口。

### 2.4 good-state-diary 复核结论

旧台账所指的 `good-state-diary.service.spec` 在权威 `pnpm test` 集合（`--exclude '**/e2e/**/*.ts'`）内**已不存在**，仅存被排除的 `test/good-state-diary.e2e-spec.ts` → **无需清理**，本单未动。

### 2.5 断言与用例数量未变声明

4 个 spec 只做两件事：**增钩子** + **删两处用例内的 `mockClear`**（语义由顶层钩子承担）。**未改任何 `expect(...)` 的期望值、未增删任何用例**。全量用例数 **3252 例 / 194 文件** 与基线逐字一致（见 §五）。

---

## 三、T-2 · ESLint 缓存失效定位与 key 统一（P-DEBT-2）

### 3.1 缓存键构成（源码级）

`node_modules/eslint/lib/cli-engine/lint-result-cache.js`：

- `hashOfConfigFor(config) = hash(\`${pkg.version}_${nodeVersion}_${stringify(config)}\`)` —— **ESLint 版本 + Node 版本 + 解析后配置对象的稳定序列化**；
- 每个文件条目 = `fileDescriptor.changed`（默认 `metadata` 策略 = **mtime + size**）+ `meta.hashOfConfig` 一致。

⇒ **tsconfig 的内容、已安装插件的代码版本都不在键里**。

### 3.2 对照实验（本机实测，逐字数据）

| #   | 变量                                                       | 预期     | 实测墙钟       | 判定                                     |
| --- | ---------------------------------------------------------- | -------- | -------------- | ---------------------------------------- |
| A   | 删除 `.eslintcache`（冷跑）                                | 全量重跑 | **183 639 ms** | 基线                                     |
| B   | 缓存存在、内容未变（热跑）                                 | 命中     | **5 769 ms**   | 命中，**31.8×**                          |
| C   | `eslint.config.mjs` **只加一行注释**                       | ——       | **5 614 ms**   | **不失效**（注释不改变"解析后配置对象"） |
| D   | `tsconfig.json` **只加一行注释**                           | ——       | **8 212 ms**   | **不失效**（tsconfig 不在键里）          |
| C2  | `eslint.config.mjs` **改规则内容**（加 `no-console: off`） | 整体失效 | **189 876 ms** | **整体失效**（配置对象哈希变化）         |

实验用的临时改动均由 `git checkout --` **逐字还原**，还原后 `git diff --stat HEAD -- eslint.config.mjs tsconfig.json` 为**空**（任务单 §2 禁止改 tsconfig，此处为 §3.2 明确授权的对照实验，已还原）。

### 3.3 定位结论

1. **触发整体失效的变量**：**解析后配置对象的内容**（改规则即失效）、ESLint 版本、Node 版本、被 lint 文件自身的 mtime/size。
2. **不触发失效**：eslint 配置文件的**注释**（解析后对象未变）、**tsconfig.json 内容**、已安装插件的代码版本、多工作树。
3. **`projectService` 程序重建不是独立失效变量**：缓存命中时 ESLint 直接跳过未变文件的 lint，**根本不建 TS 程序** —— 这正是热跑只有 5.8 s 的原因。
4. **真实隐患**：改了 tsconfig（类型收窄 / 规则开关）之后，旧的 `.eslintcache` 仍会命中，给出**过期的 type-aware 结论**；升级 eslint 插件同理。

### 3.4 本机 / CI 统一 key 口径

```
eslint-<os>-<hash(eslint.config.mjs, tsconfig.json, tsconfig.build.json, tsconfig.check.json)>
```

- **必须带 tsconfig 指纹**：ESLint 自身的键不含 tsconfig（见 §3.3.2），外层键不补就会把"旧类型配置 + 新代码"的缓存当成可用的。
- **不带 `restore-keys`**：指纹不同就宁可冷跑，也不拿旧类型配置的缓存充数（与 pnpm store / vitest 转换缓存不同 —— 那两者按 lockfile 哈希失效，不携带类型结论）。
- **本机纪律**（ESLint 自管缓存，无法从外部改键）：**改 tsconfig 或升 eslint / 插件版本后必须删 `.eslintcache`**，否则会读到过期结论。

### 3.5 CI 侧：加缓存步骤（结论：有收益）

本机实测冷跑 183.6 s vs 命中 5.8 s，CI 每次冷跑同样代价 → **加**。`lint-and-typecheck` job 新增一步：

```yaml
- name: Cache ESLint results
  uses: actions/cache@v4
  with:
    path: .eslintcache
    key: eslint-${ runner.os }}-${ hashFiles('eslint.config.mjs', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.check.json') }
```

（上面 `$` 为占位符，仓库里是标准 `[object Object]` 写法。）

### 3.6 额外发现：TD-8 遗留的 4 个**失效**缓存键（本单顺带修复）

现场核对 `git show 4424092:.github/workflows/ci.yml` 发现：TD-8 写进去的 4 个缓存步骤 key 是 **单个 `$`**（`${ runner.os }` / `${ hashFiles(...) }`），而 GitHub Actions 只插值 `[object Object]` → **这些 key 是恒定字面量**，`pnpm-lock.yaml` 变更从不使缓存失效、vitest 转换缓存会在依赖变更后被继续复用。同一文件里 `group:` / `docker build` 两处却是正确的 `[object Object]`，可见是写法疏漏而非约定。

本单已把 **8 处**（4 个 key + 4 个 restore-keys）全部改成标准 `[object Object]` 写法，并在 §五 yml 静态自检里逐条核对。

---

## 四、T-3 · oxlint 告警清理（P-DEBT-3）

### 4.1 逐条定性表（基线 deep 57 条 = fast 4 条 + type-aware 额外 53 条）

| 规则                                       | 条数   | 目录分布         | 定性                                                                                                                                                                                      | 处置                                                                                                     |
| ------------------------------------------ | ------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `typescript/no-misused-spread`             | 22     | src 19 / test 3  | **误报**：22 处逐条核实为 DTO / row **字段拷贝**（把类实例字段摊成普通对象，刻意不带原型方法；摊平后的对象从不调原型方法）                                                                | **规则层豁免**（`.oxlintrc.json`，带理由注释）                                                           |
| `typescript/unbound-method`                | 17     | test 17          | **误报**：测试侧标准写法 —— 取路由元数据（`Reflect.getMetadata(PATH_METADATA, Controller.prototype.handler)`）或给原型方法挂 spy（`Logger.prototype.error`），只引用不调用、不依赖 `this` | **规则层豁免**（`.oxlintrc.json` overrides：`test/**` + `bin/**`），不逐处 disable                       |
| `typescript/no-base-to-string`             | 10     | src 9 / test 1   | **真问题**：`unknown` 直接 `String()` 在对象分支退化成 `'[object Object]'`                                                                                                                | 9 处走新 `safeString`（src）/ 1 处走新 `toUtf8Text`（ws 帧，test 侧复用同一工具）                        |
| `typescript/await-thenable`                | 3      | test 3           | **真问题**：多余 `await`（同步方法 / 同步 void 替身）                                                                                                                                     | 去多余 `await`（3 处），断言口径不动                                                                     |
| `typescript/restrict-template-expressions` | 1      | test 1           | **真问题**：`any` 值进模板串                                                                                                                                                              | `String(accessToken)` 窄化（1 处）                                                                       |
| `eslint/no-unsafe-optional-chaining`       | 2      | test 2           | **真问题**：可选链短路成 `undefined` 后**仍在链外取属性** → TypeError                                                                                                                     | 补 `?.`（2 处）                                                                                          |
| `oxc/erasing-op`                           | 2      | test 2           | **真问题**：`0.4 * 0` 恒等零项                                                                                                                                                            | 化简为 `0`（2 处）                                                                                       |
| **合计**                                   | **57** | src 28 / test 29 | ——                                                                                                                                                                                        | 规则层豁免 2 条规则（覆盖 39 条）/ 真问题修正 18 处 / 新增局部 disable 0 条（反而移除 3 条失效 disable） |

### 4.2 真问题修正 18 处逐条

| #     | 文件:行                                                             | 原写法                                          | 改后                                                          | 说明                                                                                           |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1-6   | `src/admin-debug/admin-debug.controller.ts` 305/306/307/333/334/335 | `String(body['x'] ?? '').trim()`                | `safeString(body['x']).trim()`                                | null/undefined → `''`、number/boolean 逐字一致；对象分支由 `'[object Object]'` 改为 JSON       |
| 7     | `src/counselor/providers/vpt-session-bridge.service.ts` 389         | `new Error(String(failure))`                    | `new Error(safeString(failure, 'unknown error'))`             | 非 Error 抛出物（字符串）逐字一致；对象改为 JSON（原来丢内容）                                 |
| 8     | `src/knowledge-base/providers/search.service.ts` 95                 | `String(h.payload['item_id'] ?? '')`            | `safeString(h.payload['item_id'])`                            | 字符串载荷逐字一致                                                                             |
| 9     | `src/voice/tts/tts-bidi-client.ts` 358                              | `data.toString('utf8')`                         | `toUtf8Text(data)`                                            | 见 §4.4                                                                                        |
| 10    | `test/voice/wp26-voice-gateway-hardening.spec.ts` 640               | `String(raw).startsWith('0')`                   | `toUtf8Text(raw).startsWith('0')`                             | 与第 9 条同一工具，不重复内联判断                                                              |
| 11    | `test/admin-debug/admin-insights.spec.ts` 431                       | `await controller.psyguardTrend()`              | 去掉 `await`                                                  | `psyguardTrend()` 是同步方法（返 `buildPsyGuardTrend(...)`）                                   |
| 12-13 | `test/e2e/knowledge-search.e2e-spec.ts` 293/336                     | `await qdrant.setPoint(...)`                    | 去掉 `await`                                                  | `MockQdrantService.setPoint(...): void` 是同步 void（内部 `upsert().catch()` fire-and-forget） |
| 14    | `test/e2e/v2-user-flow.spec.ts` 223                                 | `\`Bearer ${accessToken}\``                     | `\`Bearer ${String(accessToken)}\``                           | `any` 窄化                                                                                     |
| 15    | `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts` 284 | `(x as {targetStrategy:string}).targetStrategy` | `(x as {targetStrategy:string} \| undefined)?.targetStrategy` | 可选链短路后仍在链外取属性 → TypeError                                                         |
| 16    | `test/engine-adapters/wp64-deliberation-shadow.spec.ts` 623         | 同上（`dimension`）                             | 同上                                                          | 同上                                                                                           |
| 17-18 | `test/engine-core/wp3-trajectory.spec.ts` 242/244                   | `0.6 * -0.5 + 0.4 * 0`                          | `0.6 * -0.5 + 0`                                              | IEEE 下 `0.4 * 0 === 0` 逐字相同，期望值未变                                                   |

### 4.3 新增共享工具（src 侧，纯函数、无 DI、无装配）

| 文件                                             | 导出                                                           | 口径                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/infra/string-utils/safe-string.ts`   | `safeString(value, fallback?)`、`DEFAULT_SAFE_STRING_FALLBACK` | string 直返；number/bigint/boolean → `String()`；null/undefined → fallback；对象/数组 → `JSON.stringify`（失败 → fallback）；symbol/function → fallback |
| `src/shared/infra/string-utils/ws-frame-text.ts` | `toUtf8Text(payload)`、`WsFramePayload`                        | string 直返；Buffer → utf8；Buffer[] → 逐块 utf8 后按 `','` 拼接（与 `Array.prototype.toString` 逐字一致）；ArrayBuffer → utf8 解码                     |
| `src/shared/infra/string-utils/index.ts`         | 集中出口                                                       | —                                                                                                                                                       |

`src/shared/infra/index.ts` 增一行 `export * from './string-utils/index.js';`（**只加出口，不加 module 装配、不改既有服务类**）。

### 4.4 `toUtf8Text` 的 ArrayBuffer 分支说明

ws 的 `message` 载荷类型是 `RawData = Buffer | ArrayBuffer | Buffer[]`。旧写法 `data.toString('utf8')` 在 **ArrayBuffer** 分支返回 `'[object ArrayBuffer]'` → JSON 解析必失败、帧被静默丢弃。现场核实：本仓 `tts-bidi-client.ts` **未设置 `binaryType`**（ws 默认 `'nodebuffer'`）→ 该分支在现行配置下**不可达**，故改成 utf8 解码**不改变现行运行行为**，只是把一条死分支的语义修正。Buffer[] 分支的新旧结果逐字相同。

### 4.5 规则层豁免的理由与落点（与任务单的偏差，见 §七）

任务单写的是"在 `eslint.config.mjs` 的 test 段统一豁免"。现场核实：

- `eslint.config.mjs` 的 test 段**早已**有 `'@typescript-eslint/unbound-method': 'off'`（ESLint 侧本就豁免）→ 真正需要改的是 **oxlint 的独立配置** `.oxlintrc.json`（oxlint **不读** ESLint 配置）。
- 权威 ESLint 闸门用 `recommendedTypeChecked`，**不含** `no-misused-spread`（仓库权威口径本来就不要求这条规则）；oxlint 的 type-aware 规则集更宽 → **两套 linter 口径不一致**。本单按仓库权威口径对齐（豁免），而不是为迁就 oxlint 去改 22 处生产代码（那属"为消告警改业务代码"，与红线冲突）。

---

## 五、T-4 · git 依赖 spec 环境前置（P-DEBT-9）

### 5.1 实现

- 探测 helper（新建，共享）：`test/helpers/git-probe.ts`
  - `resolveGitBinary(env)`：**`GIT_BIN` 注入优先**，未设置回退 `'git'`（走 PATH）；
  - `probeGitBinary(binary)`：跑 `--version`，失败返回 false；
  - `probeGit(env)`：解析 + 探测，返回 `{ available, binary }`。
- `test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts`：
  - 三处 `execFileSync('git', ...)` → `execFileSync(gitBinary, ...)`（**统一走解析后的路径**）；
  - 目标用例改为 `it.skipIf(!gitUsable)(...)`。

### 5.2 跳过条件（为什么是"两个 git 都可用"）

```
gitProbe.available && probeGitBinary(DEFAULT_GIT_BINARY)
```

- 本文件的三处直接调用 → 走**解析后**的二进制（`GIT_BIN` 优先）；
- src 侧 `gitDescribeDirty()`（`src/auto-practice/inference-fingerprint.service.ts`）**硬编码走 PATH 的 `git`**（本单不改 src 语义）→ 若只有 `GIT_BIN` 可用而 PATH 无 git，该断言测到的是 `unknown` 回落而非 `dirty` 语义。

所以跳过条件取**两者同时可用**：宁可跳过，也不让用例在"环境不满足"时给出误导性结论。

### 5.3 连带处置

命令改成变量后，`sonarjs/no-os-command-from-path`（只拦字面量路径）不再触发 → 原先 3 条 `eslint-disable-next-line` **失效**，本单一并移除（ESLint 的 unused-directive 告警归零）。

### 5.4 复用点

`probeGit` / `probeGitBinary` 放在共享 `test/helpers/`，后续任何依赖外部命令（git / docker / gh …）的 spec 可直接复用同一口径，不再各写一份探测。

---

## 六、改动文件清单

### 新建

| 文件                                                                                               | 用途                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `src/shared/infra/string-utils/safe-string.ts`                                                     | 安全字符串纯函数（T-3 统一出口）                       |
| `src/shared/infra/string-utils/ws-frame-text.ts`                                                   | WebSocket 原始帧 → UTF-8 文本纯函数（src + test 共用） |
| `src/shared/infra/string-utils/index.ts`                                                           | string-utils 出口                                      |
| `test/helpers/isolation.ts`                                                                        | 替身复位 + env 快照共享工具（T-1）                     |
| `test/helpers/git-probe.ts`                                                                        | git 可用性探测共享工具（T-4）                          |
| `test/helpers/index.ts`                                                                            | test helpers 出口                                      |
| `docs/worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md` | 本交付记录                                             |

### 修改

| 文件                                                              | 用途                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                                        | ① 修 TD-8 遗留的 8 处失效缓存键（单 `$` → `[object Object]`）；② lint job 新增 ESLint 缓存步骤（T-2）          |
| `.oxlintrc.json`                                                  | 规则层豁免：`typescript/no-misused-spread`（全仓，带理由）+ `typescript/unbound-method`（test/bin 段，带理由） |
| `src/shared/infra/index.ts`                                       | 加一行 string-utils 出口                                                                                       |
| `src/admin-debug/admin-debug.controller.ts`                       | 6 处 `safeString`                                                                                              |
| `src/counselor/providers/vpt-session-bridge.service.ts`           | 1 处 `safeString`                                                                                              |
| `src/knowledge-base/providers/search.service.ts`                  | 1 处 `safeString`                                                                                              |
| `src/voice/tts/tts-bidi-client.ts`                                | 1 处 `toUtf8Text`                                                                                              |
| `test/engine-adapters/wp65-deliberation-mutex-revision.spec.ts`   | 统一重置钩子                                                                                                   |
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts`  | 统一重置钩子                                                                                                   |
| `test/engine-adapters/wp12-memory-closeout.spec.ts`               | 统一重置钩子                                                                                                   |
| `test/engine-core/i12-session-alliance-config.spec.ts`            | 统一重置钩子 + 删两处用例内 mockClear                                                                          |
| `test/engine-adapters/wp68-deliberation-intention-lock.spec.ts`   | 可选链修正                                                                                                     |
| `test/engine-adapters/wp64-deliberation-shadow.spec.ts`           | 可选链修正                                                                                                     |
| `test/engine-core/wp3-trajectory.spec.ts`                         | 2 处恒等零项化简                                                                                               |
| `test/voice/wp26-voice-gateway-hardening.spec.ts`                 | 1 处 `toUtf8Text`                                                                                              |
| `test/admin-debug/admin-insights.spec.ts`                         | 去多余 `await`                                                                                                 |
| `test/e2e/knowledge-search.e2e-spec.ts`                           | 2 处去多余 `await`                                                                                             |
| `test/e2e/v2-user-flow.spec.ts`                                   | 模板串类型窄化                                                                                                 |
| `test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts`     | git 探测 + skip + 三处走解析路径                                                                               |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`             | §四 TD-9 行 → 完成态                                                                                           |
| `docs/worklog/pending/phase2.5-README.md`                         | §3.0 TD-9 行 → 完成态                                                                                          |
| `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md` | 新增 TD-9 小节 + 处理状态行                                                                                    |
| `docs/team/gate-performance-remediation-2026-11-11.md`            | §9 P-DEBT-1 / 2 / 3 / 9 标注处置结论                                                                           |

### 未触碰（红线）

`src/engine-core/**`（diff 空）· `vitest.config.mts` · `vitest.fast.config.mts` · `package.json`（脚本与依赖）· `tsconfig*.json`（实验期临时改，已逐字还原）· `eslint.config.mjs`（实验期临时改，已逐字还原）· `Dockerfile` · `admin-dashboard/` · Flutter · `test/engine-core/boundary.spec.ts`。

---

## 七、与任务单的偏差（conventions §2.5）

| #   | 任务单写的                                              | 代码实际                                                                                                                                                                                                  | 本单怎么改的                                         | 为什么                                                           |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | T-1 假定 4 个 spec 有 env 读写残留                      | 4 个 spec **零** `process.env` 读写；`resolveMemoryConfig()` 走构造注入不读 env                                                                                                                           | env 快照 helper 仍按要求封装为可复用件，本单无调用点 | 不造调用点凑数，也不虚报残留                                     |
| 2   | unbound-method 豁免落在 `eslint.config.mjs` test 段     | 该段**早已**有 `'@typescript-eslint/unbound-method': 'off'`；oxlint 不读 ESLint 配置                                                                                                                      | 落到 `.oxlintrc.json` 的 overrides（test + bin）     | 改 ESLint 配置对 oxlint 无效，改了也不解决问题                   |
| 3   | no-misused-spread "走规则豁免或改显式字段列表"          | 权威 ESLint 闸门（`recommendedTypeChecked`）**本就不含**该规则                                                                                                                                            | 规则层豁免（带理由），不改 22 处生产代码             | 两套 linter 口径不一致；为迁就更严的 oxlint 改业务代码与红线冲突 |
| 4   | T-2 "CI 是否加缓存以对照实验结论为准"                   | 实验：冷 183.6 s / 热 5.8 s（31.8×）                                                                                                                                                                      | **加** ESLint 缓存步骤（精确键，不带 restore-keys）  | 有收益；且 tsconfig 不在 ESLint 自身键里，外层键必须补指纹       |
| 5   | T-3 e2e 三条 = await-thenable ×2 + restrict-template ×1 | 现场核实：await-thenable ×2 落在 `knowledge-search.e2e-spec.ts` 的 `await qdrant.setPoint(...)`（`setPoint` 是同步 void）；第 3 条 await-thenable 落在 `admin-insights.spec.ts`（`psyguardTrend()` 同步） | 三条一律去多余 `await`，断言口径不动                 | 任务单的"e2e 三条"归属与实际分布略有出入，取定性一致             |
| 6   | T-2 只提"统一 key 口径"                                 | TD-8 提交的 4 个缓存键是**单 `$`**，GitHub Actions 不插值 → key 恒定、失效逻辑形同虚设                                                                                                                    | 一并修成 `[object Object]`（8 处）                   | 落在 T-2"统一 CI 缓存 key 口径"范围内，且是真实缺陷              |

---

## 八、闸门（真实命令 / exit code / 数字）

**机器状态**：Windows 11 Home China（10.0.26300 build 26300）· Node v26.13.0 · pnpm 9.15.0 · PowerShell 5.1.26100.9818 · 8 逻辑核。
**读税体检**：`pnpm doctor:fs` → 均值 **0.11 ms/文件**、cold 26 ms / warm 22 ms、slow=0 → **合格**（读税未复发）。
**长驻进程**：跑闸门期间机器上有**用户侧并行开发进程** —— `pnpm start:dev`（PID 22492）+ `nest start --watch`（PID 18216）+ `pnpm dev`（PID 7660，admin-dashboard vite PID 19404）+ `dist/app`（PID 14208）。**本单全程未启动任何 dev / start / watch 命令**。这解释了 ESLint 冷跑 183.6 s 明显高于模板记录的 49.3 s（读税已归零，剩余是 CPU 争抢）。

| #   | 命令                                                                    | exit | 结果                                                                                                                                             |
| --- | ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | **0 error**                                                                                                                                      |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0    | **0 error**                                                                                                                                      |
| 3   | `pnpm lint`（ESLint type-aware，权威）                                  | 0    | **0 error / 0 warning**                                                                                                                          |
| 4   | `pnpm lint:fast`（oxlint）                                              | 0    | **0 error / 0 warning**（基线 4 warning）                                                                                                        |
| 5   | `pnpm lint:deep`（oxlint type-aware）                                   | 0    | **0 error / 0 warning**（基线 57 warning）                                                                                                       |
| 6   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | **12 passed / 12**                                                                                                                               |
| 7   | 定向 20 个受影响 spec                                                   | 0    | **20 文件 / 521 例全绿**                                                                                                                         |
| 8   | `pnpm test`（全量，收尾一次）                                           | 0    | **193 passed \| 1 skipped（194 文件）**；**3248 passed \| 4 skipped（3252 例）**；vitest Duration 92.80 s / 墙钟 95.95 s（与基线用例数逐字一致） |
| 9   | `git diff --stat HEAD -- src/engine-core`                               | ——   | **空**                                                                                                                                           |
| 10  | `git diff --name-only HEAD`                                             | ——   | 21 个已跟踪文件 + 2 个新增目录，全部在 §六 范围内；无 admin-dashboard / Flutter                                                                  |

**yml 静态自检**（`yaml.parse`）：**YAML_PARSE_OK**；jobs = `lint-and-typecheck(9 steps)` / `test(10)` / `build(4)` / `security-audit(8)`；`needs` = {test ← lint-and-typecheck, build ← test}；5 个 `actions/cache` 步骤的 path/key 逐条打印核对；`pnpm lint` / `pnpm test` / `pnpm test:e2e` / `pnpm migration:run` / `pnpm exec tsc --noEmit -p tsconfig.json` / `pnpm audit --audit-level=high --prod` / `pnpm install --frozen-lockfile` 共 7 个脚本名在 `package.json` **7/7 存在**。

**oxlint 告警前后对比**

| 口径             | 改前                                                                     | 改后                    |
| ---------------- | ------------------------------------------------------------------------ | ----------------------- |
| `pnpm lint:fast` | 4 warning / 0 error（2× no-unsafe-optional-chaining、2× oxc/erasing-op） | **0 warning / 0 error** |
| `pnpm lint:deep` | 57 warning / 0 error（src 28 / test 29）                                 | **0 warning / 0 error** |

---

## 九、风险与回归

- **被改的既有测试**：wp65 / wp67 / wp12 / i12（只加钩子）、wp68 / wp64（可选链补 `?.`）、wp3-trajectory（2 处恒等零项化简）、admin-insights / knowledge-search.e2e / v2-user-flow.e2e（去 await、模板串窄化）、wp26-voice-gateway-hardening（帧解码走共享工具）、wpH（git 前置）。
- **期望值零改动**：所有 `expect(...)` 的期望值逐字未动；用例数 **3252 / 194 文件**与基线一致（§五 第 8 行）。
- **行为差异（已逐条评估）**：
  1. `safeString` 在**对象分支**由 `'[object Object]'` 变为 JSON 文本（admin-debug 6 处、vpt 1 处、search 1 处）；null/undefined/number/boolean/string 分支**逐字一致**。
  2. `toUtf8Text` 的 ArrayBuffer 分支由 `'[object ArrayBuffer]'`（必解析失败）改为 utf8 解码 —— 该分支在现行 ws `binaryType` 配置下**不可达**，现行运行行为不变（§4.4）。
  3. i12 删除两处用例内 `mockClear` → 语义由顶层钩子承担（每个用例前清零），断言未变。
  4. wp3 两处 `0.4 * 0` → `0`：IEEE 下逐字相同。
  5. e2e 两个 `await qdrant.setPoint(...)` → 去 `await`：`setPoint` 本就是同步 void（内部 fire-and-forget），语义不变。
- **未碰**：engine-core（diff 空）、`boundary.spec.ts`、schema / migration、映射函数 / resolver / module 装配、角色 `enabled` / `audit_status` / `version` / 内容字段、`.env` 的 ASR/TTS 共用值、覆盖率采集与阈值。
- **CI 侧未在本机验证**：本机跑不了 GitHub Actions，交付记录**不写"CI 已通过"**；缓存步骤与 key 修正的 CI 侧效果留待主控 push 后在 Actions 复核。

---

## 十、遗留项

**不在本单（保持原状态）**：P-DEBT-5 分片矩阵 · P-DEBT-6 测试结构减重 · D-a 双锁去留 · D-b 覆盖率采集与阈值 · `pnpm audit` registry 容错开关 · core 结构债 I-01~24 · Phase3 台账 · Phase4 五条。

**本单新登记（backlog）**：

1. **ESLint 缓存键不含 tsconfig / 插件版本** —— 本机改 tsconfig 或升 eslint / 插件版本后必须删 `.eslintcache`（已写进 §3.4 与闸门性能 §9，但**未**做自动化；后续可考虑加 `lint:cache:reset` 脚本或 pre-commit 检查）。
2. **本机 ESLint 冷跑 183.6 s 远高于模板记录的 49.3 s** —— 归因于用户侧长驻进程并行（读税已归零，`doctor:fs` 0.11 ms/文件合格）；属环境状态，不是本单引入，也不由本单处置。
3. **TD-8 遗留的失效缓存键已在本单修复**（§3.6），登记备查。

**需更大重构才能根治的告警**：**0 条** —— 本单 57 条告警全部就地处置，无一条降级为"另案"。

---

## 十一、commit 草稿（不自动提交）

```
refactor(test): TD-9 清理 spec 间 mock/env/单例残留 · 补统一重置钩子（隔离语义不变）
chore(lint): TD-9 清零 oxlint 告警 · 统一 ESLint 缓存口径 · git 依赖 spec 环境前置
docs(worklog): TD-9 任务单 / 交付记录与索引回写
```
