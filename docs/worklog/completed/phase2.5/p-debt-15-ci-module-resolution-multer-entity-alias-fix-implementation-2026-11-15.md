# P-DEBT-15 · CI 测试模块解析修复（multer 依赖转正 + `#entity` 测试期别名）— 交付记录

- **状态**：✅ 模块解析债已交付（2026-11-15，本机闸门全绿；CI run #43667471844 复核：Audit ✅ / Lint+Typecheck ✅ / Unit 两片 ✅；Coverage / E2E 残留失败定性为另案 P-DEBT-16 / P-DEBT-17）
- **基线 HEAD**：`545222d`（P-DEBT-14 文档回填后，与 `origin/integrate` 一致）
- **债务条目**：P-DEBT-15（技术债台账 §9）
- **提交方式**：代码单 commit `de2da10`（multer 声明 + lockfile + alias，已推送 `origin/integrate`）；文档（台账 + 本记录）随 docs 分组提交

---

## 一、本单做了什么（一句话）

修掉 CI 测试 job 首次运行暴露的两类模块解析失败（`ERR_MODULE_NOT_FOUND`，**收集阶段 0 test**，非断言失败）：① `multer` 幽灵依赖转正 —— `package.json` dependencies 显式声明 `multer@2.5.0`（profile service / controller 运行时直接 `import 'multer'`，对齐 cron 先例；`@types/multer` 保留 devDeps 提供类型）；② `#entity/*` 测试期显式别名 —— `vitest.config.mts` 为 `/^#entity\//` 补 `src/entity/` 的 vite `resolve.alias`，消除测试期对生产 `dist/entity` 产物的依赖。`package.json` `imports` 生产运行时映射保持不动；engine-core / migration / boundary.spec / test / src 业务代码零改动。

---

## 二、改动文件清单

### 2.1 修改（3 个 tracked 文件，代码 commit `de2da10`）

| 文件                                                   | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                         | dependencies 新增 `"multer": "2.5.0"`（字母序 `mysql2` 前、`nanoid` 前；`mu` < `my`）。`src/profile/providers/profile.service.ts` / `src/profile/controllers/profile.controller.ts` 运行时直接 `import 'multer'`（副作用加载 namespace，供 `Express.Multer.File` 类型空间使用），归 dependencies，对齐仓内 `cron`（dependencies）/ `@nestjs/platform-express` 先例；`@types/multer`（devDeps `^2.2.0`，CI 解析副本 2.3.0）保留提供类型。 |
| `pnpm-lock.yaml`                                       | root importer `dependencies` 补 `multer: 2.5.0` 三行（specifier `2.5.0` / version `2.5.0`）；复用既有 snapshot `multer@2.5.0`（树内已存在副本块，未新增包副本、无版本 / 包增删）。未跑 `pnpm install --lockfile-only`（避免 YAML 空格重排噪声，沿用 P-DEBT-13 / 14 教训）。                                                                                                                                                              |
| `vitest.config.mts`                                    | 顶部新增 `import { fileURLToPath, URL } from 'node:url'`；`resolve.alias` 补正则项 `{ find: /^#entity\//, replacement: fileURLToPath(new URL('./src/entity/', import.meta.url)) }`。`test/vitest.e2e.mts` 与 `vitest.fast.config.mts` 均 `mergeConfig` 继承主 config，自动覆盖。                                                                                                                                                         |
| `docs/team/gate-performance-remediation-2026-11-11.md` | P-DEBT-15 状态 🟠 → ✅ 已处置（补修复手段、闸门数字与 CI 复核结论）；新增 P-DEBT-16 / P-DEBT-17 另案行；§更新记录追加本单落地条目。                                                                                                                                                                                                                                                                                                      |

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`test/engine-core/boundary.spec.ts`、整个 `test/` 目录、`src/**/*.ts` 业务代码 —— 零 diff
- `tsconfig.json` / `tsconfig.build.json` / `tsconfig.check.json` / `tsconfig.scripts.json` / `test/tsconfig.e2e.json`、`test/vitest.graphql-plugin.mjs`、CI workflow、Dockerfile、前端 / Flutter —— 零改动
- 未引入新第三方包：`multer@2.5.0` 为已在依赖树内的 `@nestjs/platform-express@12.3.2` 传递副本转正为直接 dependency，版本与现有 snapshot 逐字一致；`node:url` 为 Node 内置模块，无新增包
- `package.json` `imports` 映射 `#entity/* → ./dist/entity/*` **保持不动**：生产运行时（nest build dist）仍按 `imports` 解析 dist 产物；别名只作用于 vitest 测试期

### 2.3 显式排除的未跟踪产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 备忘，零 src 改动，另一条并行线）
- `docs/worklog/pending/archive/relay-response-20261114-1524.md`、`-1719.md`、`-1818.md`、`-20261115-0227.md`、`-20261115-0346.md`（既往 relay 回执，口径不入库）

---

## 三、根因与修复手段

### 3.1 multer 幽灵依赖（`Cannot find package 'multer'`）

**现象**：CI e2e **5 failed / 1 passed**（全 `profile.controller.ts`）；unit / coverage 4 文件收集失败，报错 `Cannot find package 'multer'`（ERR_MODULE_NOT_FOUND）。

**取证**：

- 三处副作用 `import 'multer'`：`src/profile/providers/profile.service.ts:3`、`src/profile/controllers/profile.controller.ts:15`、`src/counselor/controllers/practice.controller.ts:74`（注释：加载 namespace，让 `Express.Multer.File` 全局可用）。三处均**无运行时值使用**（无 `multer()` / `diskStorage` 调用），类型走 `Express.Multer.File`。
- `package.json` 未声明 multer；仅 `@types/multer@^2.2.0` 在 devDeps。`multer@2.5.0` 由 `@nestjs/platform-express@12.3.2` 传递依赖带入。multer 2.5.0 包**无自带类型**（package.json `types` / `typings` 为空），类型全靠 devDeps 的 `@types/multer`。
- pnpm isolated + `moduleResolution: nodenext` 下，CI fresh `pnpm install --frozen-lockfile`（Linux，顶层 `node_modules` 仅直接依赖符号链接）解析不到未声明的传递依赖 → `Cannot find package 'multer'`。本机 Windows 历史实体 `node_modules` 平铺掩盖，本机全量 **3356 passed** 复现不出（与 P-DEBT-13 cron、P-DEBT-14 dotenv 同类幽灵依赖现象）。

**修复**：dependencies 显式声明 `multer@2.5.0`（版本与 `@nestjs/platform-express` 传递副本逐字一致，复用既有 snapshot，无新包副本）。归类 dependencies：profile 上传链路运行时经 `FileInterceptor` / `MulterModule` 使用 multer 类型空间，与 `cron`（dependencies）同型；`@types/multer` 留 devDeps（类型期依赖，运行时不需要）。

**备选方案（未采用）**：删除三处副作用 `import 'multer'`。类型 namespace 引入机制有风险 —— tsconfig `types` 为显式数组（`["node", "vitest/globals"]`），禁用了 `@types` 自动包含，删除 import 后 `Express.Multer.File` 的类型空间来源不明确；显式声明依赖对运行时与类型两侧都更稳。

### 3.2 `#entity/*` 运行期别名依赖 dist 产物（`Cannot find module '#entity/sampledb1/index.js'`）

**现象**：unit / coverage 3 文件收集失败，报错 `Cannot find module '#entity/sampledb1/index.js'`。

**取证**：

- 三处走 `#entity/sampledb1/index.js`：`src/sample/providers/crud.service.ts:5`、`src/shared/foobar/foobar.module.ts:4`、`src/sample/providers/crud.service.spec.ts:7`。
- `package.json` `imports` 映射 `#entity/* → ./dist/entity/*`（生产构建产物路径）；`tsconfig.json` paths 映射 `#entity/* → ./src/entity/*`；`vitest.config.mts` 仅开 `resolve.tsconfigPaths: true`（读取 tsconfig paths），未配显式 vite alias。
- 本机存在历史 `dist/entity/`（12 文件）产物掩盖：运行期按 `imports` 解析到真实 `.js`；CI fresh install 无 dist，`.js` 后缀在 src 侧解析不到对应 `.ts`（`src/entity/sampledb1/index.ts` 为 `export * from './sampletable1.entity.js'`，无独立 `.js`）→ 解析失败。

**修复**：`vitest.config.mts` `resolve.alias` 补正则别名 `/^#entity\// → src/entity/`（`fileURLToPath(new URL('./src/entity/', import.meta.url))`）。vitest 经 vite 解析模块，显式 alias 优先级高于 tsconfigPaths 与 `imports`，测试期稳定指向 src 源码。e2e config 与 fast config 经 `mergeConfig` 继承主 config，自动覆盖，无需逐文件改 import。

**隔离验证**：本机临时把 `dist/entity` 改名为 `entity.bak-p15`，重跑 3 个 sample spec → **9 passed** EXIT 0，随后恢复 `dist/entity`；确证 alias 指向 `src/entity`，CI fresh install 无 dist 也能解析。

### 3.3 错误文件范围复核

首现 run #43665067314：unit 1/2、unit 2/2、coverage 各 4 文件收集失败（**195 passed / 1 skipped**，200 文件）；e2e **5 failed / 1 passed**（6 文件，全 multer）。4 个失败 unit spec：`test/base/wp25-security-hardening.spec.ts`、`src/sample/providers/crud.service.spec.ts`、`src/sample/controllers/crud.controller.spec.ts`、`src/sample/controllers/sample.controller.spec.ts`。本单未改动任何 spec / 业务源码，仅补依赖声明与测试期别名。

---

## 四、闸门表（真实数字，exit code 实测）

**机器常驻进程状态**：后端 `nest start --watch` 已停；前端 vite 保留未动。全量墙钟可比性以**用例数 / 文件数**为准。

| 闸门                    | 命令                                                    | exit  | 实测数字                                                                                                                                          |
| ----------------------- | ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式类型检查            | `pnpm typecheck`（`tsc -b tsconfig.check.json`）        | **0** | **0 error**（仓内正式 typecheck 闸门，composite 项目引用，仅查 src 非 spec）                                                                      |
| 全量根类型（CI 同口径） | `tsc --noEmit -p tsconfig.json`                         | **0** | **0 行 / 0 错误**，EXIT 0                                                                                                                         |
| Lint（权威）            | `pnpm lint`                                             | **0** | **0 error / 1 warning**（既有 `test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，范围外未修）                                               |
| oxlint fast             | `pnpm lint:fast`                                        | **0** | **0 warning / 0 error**，1347 文件                                                                                                                |
| 定向失败 spec           | 4 个首现失败 spec（wp25-security-hardening + 3 sample） | **0** | **4 文件 / 25 passed**（日志 `ER_DUP_ENTRY` 为 spec 内故意触发的 catch 分支断言，非失败）                                                         |
| 无 dist 隔离复跑        | 3 个 sample spec（临时改名 `dist/entity`）              | **0** | **9 passed**，EXIT 0；确证 alias 指向 `src/entity`、不依赖 dist 产物；跑完已恢复 `dist/entity`                                                    |
| engine-core             | `git diff --stat HEAD -- src/engine-core`               | 0     | **空**（零 diff）                                                                                                                                 |
| migration               | `git diff --stat HEAD -- src/migration/`                | 0     | **空**（零 diff）                                                                                                                                 |
| 范围隔离                | `git status --short` + `git ls-files --others`          | 0     | tracked 改动仅 3 文件（§2.1 前三个），**13 insertions**（package.json 1 / pnpm-lock.yaml 3 / vitest.config.mts 9）；未跟踪 6 产物（§2.3）显式排除 |
| 边界                    | `test/engine-core/boundary.spec.ts`                     | 0     | 零改动，12 绿（沿用基线）                                                                                                                         |

**全量测试口径**：本轮改动为 dependencies 声明 + vitest 测试期别名，不改变 spec 集合 / 断言 / 用例数；定向 4 spec 25 passed + 无 dist 隔离 9 passed 已确认运行时无回归。沿用 P-DEBT-14 先例，**未重跑全量测试**，基线 **3356 passed + 4 skipped（3360 例 / 200 文件）**不变；本单未新增 spec。

---

## 五、边界确认

- **engine-core / migration / boundary.spec / test / src 业务代码**：零 diff；未碰禁动边界。
- **依赖范围**：multer 仅转正既有传递副本；不新增第三方包、不升级版本。openai / langsmith / typeorm / @nestjs/typeorm patch 升级、37 moderate + 2 low audit 漏洞、`email.service.ts` 两处无泛型 `config.get('email')` 等既往另案沿用台账登记，本单不动。
- **未顺手清理**：三处副作用 `import 'multer'` 的写法（类型 namespace 加载）本单不收敛；TD-12 另案 A–F、TD-13 ~ TD-20 另案 G–P 与各观察项、Judge Layer 并行线均沿用既有登记。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增第三方依赖。
- **提交边界**：代码单 commit `de2da10` 已推送；文档随 docs 分组提交；未使用 `--no-verify`。

---

## 六、偏差与遗留登记

### 6.1 本单遗留（不阻断）

- **CI fresh install 口径已复核（run #43667471844）**：Unit 两片 success，multer 声明与 `#entity` alias 在 CI fresh install 成立；§3.1 / §3.2 的本机掩盖现象已在 CI 口径下归零确认。
- **观察（flake，沿用 P-DEBT-13）**：`debug-session-persistence.spec.ts` ⑥ waitFor 在全量 isolate 模式下偶发超时（隔离重跑 26 passed）；文件持久化 + Redis，IO 竞争敏感；观察项，不阻断。

### 6.2 未纳入本单（范围隔离）· 另案 P-DEBT-16 / P-DEBT-17

CI 复核（run #43667471844）暴露两个**非模块解析**的既有 CI 配置 / 运行时环境债，既往 CI 对应 job 一直 skipped、从未真正跑过，故首次暴露；**与本单改动无关**（本单仅改 multer 声明、lockfile、vitest alias；失败栈不涉及上述改动文件）：

1. **P-DEBT-16 · Coverage v8 采集未启用、产物空目录**：`coverage` job 测试全过（**199 文件 / 3352 passed + 8 skipped（3360）**），但上传步骤报 `No files were found with the provided path: coverage/`。日志无 `Coverage enabled with v8` 行、无覆盖率表格、无阈值 ERROR → 采集未启用；`--coverage` 经 `pnpm run test -- --coverage` 透传后落在字面 `--` 之后，被 vitest 当位置参数（spec filter）而非 coverage flag。本机直跑 `vitest run <spec> --coverage` 与 `pnpm run test -- <spec> --coverage` 均正常生成 lcov（1391 文件）。方向：`package.json` 新增独立 `test:coverage` 脚本（内嵌 `--coverage`），workflow 改调该脚本；启用采集后需复核全量四指标在 CI Node 24 下仍过 TD-12 阈值（本机 TD-12 实测 46.92 / 45.67 / 42.48 / 46.69，缓冲 +2.48 ~ +2.92 pp）。
2. **P-DEBT-17 · E2E 缺 LLM provider env stub**：失败 suite `test/e2e/v2-user-flow.spec.ts` 装配真实 AppModule → `LlmService` 构造期 `configMust` 校验 `MINIMAX_BASE_URL` / `MINIMAX_API_KEY` / `MINIMAX_LLM_MODEL`，CI e2e job `env` 段未注入任一 → `Missing required env var: MINIMAX_BASE_URL`（`llm.service.ts:117:25` / `:400:13`）。全仓构造期 env 硬校验仅此三处（grep `configMust` 0 其他命中）；本机 `.env` 提供故复现不出。模块解析错误在 e2e 已消除（安装日志 `+ multer 2.5.0`，无 `ERR_MODULE_NOT_FOUND`）。方向：e2e job `env` 段补三个 stub（`MINIMAX_BASE_URL=http://127.0.0.1:1` / `MINIMAX_API_KEY=stub-test-key` / `MINIMAX_LLM_MODEL=stub-model`；构造仅存字段、不发起网络调用），或在 e2e 测试层替身替换 LlmService；需在 CI 复核是否还有其他 env / 外部服务缺口。

- 37 moderate + 2 low audit 漏洞（CI `--audit-level=high` 不阻断）
- openai / langsmith / typeorm / @nestjs/typeorm patch 升级（advisory 未命中）
- `email.service.ts` 两处 `config.get('email')` 无泛型（CI 未报 unsafe）
- `test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable warning（warning 不阻断）
- TD-12 另案 A–F、TD-13 ~ TD-20 另案 G–P 与各观察项、Judge Layer 并行线（六条待决策项用户未拍板、第二家 provider key 待采购）

---

## 七、Actions 复核结论（run #43667471844，`de2da10`，2026-11-15）

| Job / 步骤                              | 结论       | 证据                                                                                                                                                                                              |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Security Audit`                        | ✅ success | job 132669942542 success，19 high 清零保持                                                                                                                                                        |
| `Lint + Typecheck`                      | ✅ success | job 132669942721 success（本单未改 lint 规则 / 类型配置，沿用 P-DEBT-14 口径）                                                                                                                    |
| `Unit`（shard 1/2）                     | ✅ success | job 132670600071 success；模块解析债在 unit 消除                                                                                                                                                  |
| `Unit`（shard 2/2）                     | ✅ success | job 132670600083 success；模块解析债在 unit 消除                                                                                                                                                  |
| `Coverage`                              | ❌ failure | job 132670600112；测试 **199 文件 / 3352 passed + 8 skipped（3360）** 全过；失败在产物上传步骤找不到 `coverage/` 目录（采集未启用）→ 另案 **P-DEBT-16**                                           |
| `E2E`                                   | ❌ failure | job 132670600063；**1 failed / 1 passed / 4 skipped（6 文件）**，Tests **5 passed / 32 skipped（37）**；模块解析错误已消失；失败 suite `v2-user-flow.spec.ts` 缺 MINIMAX env → 另案 **P-DEBT-17** |
| `Build (Docker)`（needs `[unit, e2e]`） | ⏭ skipped  | job 132671030478；e2e failure 未满足 `needs` 触发条件（属下游测试债阻塞，非本单目标范围）                                                                                                         |

**目标达成判定**：P-DEBT-15 两项目标均达成 —— ① **两类模块解析债在 CI 消除**：Unit 两片 success（首现 run 中 unit / coverage 各 4 文件收集失败、e2e 5 文件 multer 失败，本轮全部解析通过）；② 依赖声明与别名在 CI fresh install 成立（安装日志 `+ multer 2.5.0`、`+ @types/multer 2.3.0`；无 `ERR_MODULE_NOT_FOUND` / `Cannot find package multer` / `Cannot find module '#entity/...'`）。Coverage / E2E 残留失败为**非模块解析的既有 CI 配置 / 运行时环境债首次暴露**，与本单改动无关（定性见 §6.2），另立 **P-DEBT-16 / P-DEBT-17** 跟踪；在其闭合前，`build` job 仍因 `needs: [unit, e2e]` e2e failure 保持 skipped。

---

## 八、commit message 草稿

```
fix(ci): P-DEBT-15 显式声明 multer 依赖并为 #entity 补测试期别名

- deps: multer 2.5.0 转正为直接 dependency（profile service/controller 运行时
  直接 import，对齐 cron 先例；@types/multer 保留 devDeps 提供类型），消除 CI
  fresh install 下 Cannot find package 'multer'
- vitest: resolve.alias 补 /^#entity// → src/entity/，消除测试期对生产
  dist/entity 产物的依赖（e2e / fast config 经 mergeConfig 继承）；package.json
  imports 生产 dist 映射保持不动
- 台账: P-DEBT-15 已处置；本机根 tsc / check.json / lint / oxlint / 定向 25 passed
  全绿；CI run #43667471844 Unit 两片 ✅；coverage 采集未启用 / e2e 缺 LLM env
  另案 P-DEBT-16 / P-DEBT-17
```

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `545222d` · 代码 commit `de2da10` 已推送 `origin/integrate`；CI 复核 run #43667471844_
