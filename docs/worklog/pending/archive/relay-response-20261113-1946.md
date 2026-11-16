TD-9 已闭环：四条工程卫生遗留全部落地，**engine-core 零 diff**、断言期望与用例数逐字未变（3252 例 / 194 文件，与基线一致）。

## 四项处置结果

**T-1 · spec 间 mock / env / 单例残留（P-DEBT-1）**

四个非 e2e spec 逐条定性后补统一重置钩子，重复逻辑抽共享 helper（`test/helpers/isolation.ts` + `git-probe.ts` + 出口）：

| 文件                        | 现场定性                                                                                                                                      | 复位方式                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| wp65-mutex-revision         | `beforeEach` 只 `mockClear`；`vi.restoreAllMocks()` 写在 ②-3 用例**体内**（用例中途失败即泄漏）；`mockRejectedValueOnce` 这类一次性实现清不掉 | 顶层 `beforeEach` → `resetTestDoubles(bull)`：还原 spy + `mockReset` 把替身复位回 `vi.fn` 工厂默认实现 |
| wp67-circuit-breaker        | 有 `mockClear` + restore，缺一次性实现复位                                                                                                    | 同上，同一份共享 helper                                                                                |
| wp12-memory-closeout        | 无钩子；模块级只有不可变常量，唯一跨用例可变状态 = 两个 describe 共用的 `embedder` 计数器                                                     | 顶层 `beforeEach` `clearMockCalls()`；其余替身均用例内局部 new，无残留                                 |
| i12-session-alliance-config | `mockClear` 写在两个用例体内，失败即把计数漏给下个用例                                                                                        | 顶层 `beforeEach` `resetTestDoubles({ planIntention })`，删掉两处用例内 `mockClear`                    |

- **env 审计**：4 个 spec **零** `process.env` 读写（`resolveMemoryConfig()` 走构造注入，不读 env）→ env 快照 helper 按任务单要求封装为可复用件，本单无调用点（不造调用点凑数）。
- **good-state-diary 复核**：旧台账所指的 service spec 已不在权威 `pnpm test` 集合（仅存被排除的 e2e 文件），无需清理。

**T-2 · ESLint 缓存失效定位与 key 统一（P-DEBT-2）**

对照实验（本机实测，配置文件改动已 `git checkout` 逐字还原）：

| 变量                           | 墙钟           | 判定                               |
| ------------------------------ | -------------- | ---------------------------------- |
| 删缓存（冷跑）                 | **183 639 ms** | 基线                               |
| 缓存命中（热跑）               | **5 769 ms**   | **31.8×**                          |
| `eslint.config.mjs` 只加注释   | **5 614 ms**   | 不失效（注释不改"解析后配置对象"） |
| `tsconfig.json` 只加注释       | **8 212 ms**   | **不失效**                         |
| `eslint.config.mjs` 改规则内容 | **189 876 ms** | **整体失效**                       |

结论：失效变量 = **解析后配置对象的内容** + ESLint/Node 版本 + 文件自身 mtime/size；**tsconfig 内容与插件版本都不在键里** → 改 tsconfig 后旧缓存会给出**过期的 type-aware 结论**。统一口径 `eslint-<os>-<hash(eslint 配置 + tsconfig 指纹)>`，**不带 restore-keys**（指纹不同宁可冷跑）。CI lint job 新增 ESLint 缓存步骤（冷 183.6 s → 热 5.8 s）；本机纪律：改 tsconfig 或升插件后必须删 `.eslintcache`。

**顺带修掉一个 TD-8 遗留的真实缺陷**：`git show 4424092:.github/workflows/ci.yml` 里 4 个缓存步骤的 key 写成了**单个 `$`**（`${ runner.os }`），而 GitHub Actions 只插值 `[object Object]` → 那些 key 是**恒定字面量**，lockfile 变更从不使缓存失效、vitest 转换缓存会在依赖变更后被继续复用。已全部改成标准写法（8 处）并在 yml 静态自检里逐条核对。

**T-3 · oxlint 告警清零（P-DEBT-3）**

基线 fast **4** / deep **57** → 终态 **0 / 0**（0 error / 0 warning）。逐条定性：

| 规则                            | 条数 | 定性                                                         | 处置                                         |
| ------------------------------- | ---- | ------------------------------------------------------------ | -------------------------------------------- |
| `no-misused-spread`             | 22   | 误报（22 处逐条核实为 DTO/row 字段拷贝，摊平后不调原型方法） | 规则层豁免（带理由）                         |
| `unbound-method`                | 17   | 误报（取路由元数据 / 挂原型方法 spy 的标准写法）             | `.oxlintrc.json` 的 test+bin 段豁免          |
| `no-base-to-string`             | 10   | 真问题（`unknown` 直接 `String()` → `'[object Object]'`）    | 9 处走新 `safeString`、1 处走新 `toUtf8Text` |
| `await-thenable`                | 3    | 真问题                                                       | 去多余 `await`（3 处）                       |
| `restrict-template-expressions` | 1    | 真问题                                                       | `String(accessToken)` 窄化                   |
| `no-unsafe-optional-chaining`   | 2    | 真问题（链外取属性 → TypeError）                             | 补 `?.`（2 处）                              |
| `oxc/erasing-op`                | 2    | 真问题（`0.4 * 0` 恒等零项）                                 | 化简为 `0`（2 处）                           |

新增共享纯函数 `src/shared/infra/string-utils/`：`safeString(value, fallback?)`、`toUtf8Text(payload)`（src + test 共用，无 DI、无装配）。src 28 条 / test 29 条分开记账，规则层豁免 2 条规则（覆盖 39 条告警）、真问题修正 18 处、新增局部 disable 0 条（反而移除 3 条失效 disable）。

**T-4 · git 依赖 spec 环境前置（P-DEBT-9）**

新增共享探测 `test/helpers/git-probe.ts`（`GIT_BIN` 注入优先 → 回退 PATH 的 `git` → 跑 `--version`）；三处 `execFileSync('git', ...)` 统一走解析后的路径；不可用时该用例 `it.skipIf` 跳过。跳过条件取"注入路径与 PATH **同时**可用"——因为 src 侧 `gitDescribeDirty()` 硬编码走 PATH 的 `git`，只满足一边时那条断言测到的是 `unknown` 回落而非 dirty 语义。

## 闸门（终态实跑）

| 命令                                                                    | exit | 结果                            |
| ----------------------------------------------------------------------- | ---- | ------------------------------- |
| `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | 0 error                         |
| `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0    | 0 error                         |
| `pnpm lint`（ESLint type-aware，权威）                                  | 0    | **0 error / 0 warning**         |
| `pnpm lint:fast`（oxlint）                                              | 0    | **0/0**（基线 4 warning）       |
| `pnpm lint:deep`（oxlint type-aware）                                   | 0    | **0/0**（基线 57 warning）      |
| `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | 12 passed                       |
| 定向 20 个受影响 spec                                                   | 0    | 20 文件 / 521 例全绿            |
| `pnpm test`（全量）                                                     | 0    | **193 passed                    | 1 skipped（194 文件）**；**3248 passed | 4 skipped（3252 例）**，vitest 92.80 s / 墙钟 95.95 s |
| `pnpm doctor:fs`                                                        | 0    | 均值 0.11 ms/文件，slow=0，合格 |
| `git diff --stat HEAD -- src/engine-core`                               | ——   | **空**                          |

yml 静态自检：`yaml.parse` → **YAML_PARSE_OK**；jobs = lint-and-typecheck(9 steps) / test(10) / build(4) / security-audit(8)；needs / services / Trivy / Docker 步骤未动；5 个缓存步骤的 path+key 逐条打印核对；7 个 `run:` 脚本名在 package.json **7/7 存在**。

机器状态：Windows 11 Home China 10.0.26300 · Node v26.13.0 · pnpm 9.15.0 · PS 5.1.26100.9818 · 8 逻辑核；跑闸门期间有**用户侧并行开发进程**（`pnpm start:dev` / `nest start --watch` / admin vite / `dist/app`），本单全程未启动任何 dev/watch —— ESLint 冷跑 183.6 s 明显高于模板记录的 49.3 s 即由此而来（读税已归零，doctor:fs 合格）。

## 与任务单的偏差（已 grep 核实）

1. **unbound-method 豁免落点**：任务单写 `eslint.config.mjs`，但该段**早已**有 `'@typescript-eslint/unbound-method': 'off'`；真正要改的是 **oxlint 的独立配置** `.oxlintrc.json`（oxlint 不读 ESLint 配置）。
2. **no-misused-spread 处置**：权威 ESLint 闸门用 `recommendedTypeChecked`（**本就不含**该规则），是 oxlint 的 type-aware 规则集更宽 → 按仓库权威口径豁免，而不是为迁就 oxlint 改 22 处生产代码。
3. **env 残留不成立**：4 个 spec 零 env 读写（见 T-1）。
4. **e2e 三条归属**：await-thenable ×2 实际落在 `knowledge-search.e2e-spec.ts` 的 `await qdrant.setPoint(...)`（`setPoint` 是同步 void），第 3 条落在 `admin-insights.spec.ts`（`psyguardTrend()` 同步）→ 一律去多余 await，断言口径未动。
5. **额外发现**：TD-8 的 4 个缓存键失效（T-2 节）——落在 T-2"统一 CI 缓存 key 口径"范围内，一并修。

## 改动面

- 新建 7 个：`src/shared/infra/string-utils/`（3）+ `test/helpers/`（3）+ 交付记录
- 修改：`.github/workflows/ci.yml`（缓存键修正 + ESLint 缓存步骤）、`.oxlintrc.json`、`src/shared/infra/index.ts`、4 个 src 告警点、9 个 test 文件、4 份台账/索引
- 归档：任务单已移到 `completed/phase2.5/`，状态行 ✅，DoD **8/8** 全勾
- 工作区：23 个已跟踪文件（+144 −57）+ 4 个新增路径；6 份文档 **218 条相对链接全部可达、零断链**
- 未触碰：`src/engine-core/**`、`vitest.config.mts`、`vitest.fast.config.mts`、`package.json`、`Dockerfile`、`admin-dashboard/`、Flutter、`boundary.spec.ts`

## 遗留（已登记，等你拍板）

- 不在本单：P-DEBT-5 分片矩阵、P-DEBT-6 结构减重、D-a 双锁去留、D-b 覆盖率采集、audit 容错开关、core / Phase3 / Phase4 遗留
- 新登记 3 条：① **ESLint 缓存键不含 tsconfig / 插件版本** → 本机改 tsconfig 或升插件后必须删 `.eslintcache`（只写纪律，未自动化）；② 本机 ESLint 冷跑 183.6 s 远高于模板 49.3 s → 归因用户侧长驻进程，非本单引入；③ TD-8 失效缓存键已在本单修复（备查）
- **需更大重构才能根治的告警：0 条** —— 57 条全部就地处置，无一条降级另案

## commit 草稿（未执行 commit / push）

```
refactor(test): TD-9 清理 spec 间 mock/env/单例残留 · 补统一重置钩子（隔离语义不变）
chore(lint): TD-9 清零 oxlint 告警 · 统一 ESLint 缓存口径 · git 依赖 spec 环境前置
docs(worklog): TD-9 任务单 / 交付记录与索引回写
```

CI 侧结果本机无法验证，交付记录**未写「CI 已通过」**，留待你 push 后在 Actions 复核（重点看新增的 ESLint 缓存步骤与修正后的 4 个缓存键）。

已写入文件
