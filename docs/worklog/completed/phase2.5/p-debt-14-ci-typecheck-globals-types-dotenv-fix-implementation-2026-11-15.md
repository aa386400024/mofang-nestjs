# P-DEBT-14 · CI Typecheck 修复（vitest 全局类型注入 + bin dotenv 幽灵依赖转正）— 交付记录

- **状态**：✅ 已交付（2026-11-15，本机闸门全绿；CI 结果待 push 后 Actions 复核）
- **基线 HEAD**：`404cbe6`（P-DEBT-13 第三轮复核后，与 `origin/integrate` 一致）
- **债务条目**：P-DEBT-14（技术债台账 §9）
- **提交方式**：单 commit（tsconfig 类型 + dotenv 声明 + 台账 / 交付记录同批）

---

## 一、本单做了什么（一句话）

修掉 CI `Lint + Typecheck` job 的 Typecheck 步骤失败：① 根 `tsconfig.json` 的 `types` 注入 `vitest/globals`，为 spec 全局符号（`describe` / `it` / `expect` / `vi` / 生命周期钩子）补上类型，消除 TS2304 / TS2593 / TS7006；② 9 个 bin 脚本直接 `import 'dotenv'` 却未在 package.json 声明，归 devDependencies 显式转正 `dotenv@18.0.3`（复用 `@nestjs/config` 既有传递副本，版本零变化），消除 CI 的 9 条 TS2307。正式闸门 `tsc -b tsconfig.check.json` 全程不受影响；engine-core / migration / boundary.spec / test 零改动。

---

## 二、改动文件清单

### 2.1 修改（3 个 tracked 文件）

| 文件                                                   | 改动                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`                                        | `compilerOptions.types` 由 `["node"]` 改为 `["node", "vitest/globals"]`（L18）。根 config 的 `include` 含 `test/**/*` / `src/**/*` / `bin/**/*`，spec 运行在 `test.globals: true` 模式下使用全局测试符号，类型入口此前未引入。                                        |
| `package.json`                                         | devDependencies 新增 `"dotenv": "18.0.3"`（字母序 `cross-env` 后、`esbuild` 前）。src/ 无任何直接 `import 'dotenv'`（应用侧经 `@nestjs/config` 间接使用）；仅 9 个 bin 运维脚本直接 import，归 devDependencies，对齐仓内 bin 工具依赖 `prompts` / `rimraf` 归类先例。 |
| `pnpm-lock.yaml`                                       | root importer `devDependencies` 补 `dotenv: 18.0.3` 三行（specifier `18.0.3` / version `18.0.3`）；复用既有 snapshot `dotenv@18.0.3`（L8736 块已存在，未新增包副本、无版本 / 包增删）。                                                                               |
| `docs/team/gate-performance-remediation-2026-11-11.md` | P-DEBT-14 状态 🟠 → ✅ 已处置（补修复手段与闸门数字）；§更新记录追加本单落地条目。                                                                                                                                                                                    |

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`test/engine-core/boundary.spec.ts`、整个 `test/` 目录、`src/**/*.ts` 业务代码 —— 零 diff
- 其他业务域 service / controller / entity / DTO / module、`tsconfig.build.json` / `tsconfig.check.json` / `tsconfig.scripts.json` / `test/tsconfig.e2e.json`、`vitest.config.mts`、CI workflow、Dockerfile、前端 / Flutter —— 零改动
- 未引入新第三方包：`dotenv@18.0.3` 为已在依赖树内的 `@nestjs/config` 传递副本转正为直接 devDependency，版本与现有 snapshot 逐字一致；`vitest/globals` 类型入口由已在 devDeps 的 `vitest@5.0.5` 自带，无新增包

### 2.3 显式排除的未跟踪产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 备忘，零 src 改动，另一条并行线）
- `docs/worklog/pending/archive/relay-response-20261114-1524.md`、`-1719.md`、`-1818.md`、`-20261115-0227.md`、`-20261115-0346.md`（既往 relay 回执，口径不入库）

---

## 三、根因与修复手段

### 3.1 Vitest 全局类型缺失（TS2304 / TS2593 / TS7006）

**现象**：CI Typecheck 步骤 `tsc --noEmit -p tsconfig.json` 报 **7406** 条（run #43662569044，`9b08dc1`）；本机基线复现 **7397** 条（本机实体 `node_modules` 掩盖 dotenv，故少 9 条 TS2307，见 §3.2）。错误分布：

| 错误码 | CI 条数 | 含义                | 根因                                                                                |
| ------ | ------- | ------------------- | ----------------------------------------------------------------------------------- |
| TS2304 | 4829    | 找不到标识符        | `describe` / `it` / `expect` / `vi` 等全局测试符号无类型声明                        |
| TS2593 | 2556    | `this` 隐式 any     | 全局钩子回调（`beforeEach` / `afterEach` 等）签名未解析，回调 `this` / 参数类型退化 |
| TS7006 | 12      | 参数隐式 any        | 同上，回调参数无类型推断                                                            |
| TS2307 | 9       | 找不到模块 `dotenv` | bin 脚本幽灵依赖（§3.2）                                                            |

**取证**：

- `vitest.config.mts` 设 `test.globals: true`，spec 直接使用全局 `describe / it / expect / vi / beforeEach / afterEach / beforeAll / afterAll / test`；根 `tsconfig.json` `types: ["node"]`，未引入 vitest 全局类型。
- spec 为**混合模式**：**135** 个 spec 显式 `import { ... } from 'vitest'`（导入符号计数：`vi` 100 / `expect` 90 / `describe` 83 / `it` 83 / `beforeEach` 17 / `afterAll` 8 / `afterEach` 7 / `beforeAll` 7 / `test` 7 / `Mock` 1 / `Mocked` 1），**71** 个 spec 不显式 import、纯靠全局。注入 globals 类型对两种写法都兼容：显式 import 在模块局部遮蔽全局类型，不冲突。
- `vitest@5.0.5` 自带 `./globals` export 与 `node_modules/vitest/globals.d.ts`，`declare global` 声明 `suite / test / chai / describe / it / expectTypeOf / assertType / expect / assert / vitest / vi / beforeAll / afterAll / beforeEach / afterEach / aroundEach / aroundAll / onTestFailed / onTestFinished`，与仓内使用集合匹配。

**修复（方案 A）**：`types` 数组追加 `"vitest/globals"`。类型注入为 ambient 全局声明，未被 src 业务代码使用；`tsconfig.build.json` / `tsconfig.check.json` extends 根但 exclude spec / test / bin，src 非 spec 文件不受影响（正式闸门已实测 0 error）。`tsconfig.scripts.json`（bin 专用）与 `test/tsconfig.e2e.json`（e2e）同样 extends 根，一并获得 globals 类型，正向无冲突。

**备选方案（未采用）**：

- **方案 C**：把 `test/**/*` / `bin/**/*` 排除出根 tsconfig —— 治标，等于放弃 spec / bin 在该 tsc 步骤的类型检查覆盖，与类型检查意图冲突。
- **方案 D**：为 test 段建独立 tsconfig（含 globals types）并改 CI workflow —— 改动面大，且 CI Typecheck 只跑根 tsconfig，需同步改 workflow。

### 3.2 bin dotenv 幽灵依赖（TS2307 × 9）

**现象**：9 个 bin 脚本统一 `import { config as loadEnvFile } from 'dotenv'`；`package.json` 未声明 dotenv。pnpm isolated + `moduleResolution: nodenext` 下，CI fresh `pnpm install --frozen-lockfile`（Linux，顶层 `node_modules` 仅直接依赖符号链接）解析不到未声明的传递依赖 → TS2307。本机 Windows 历史实体 `node_modules/dotenv` 掩盖，本机 tsc 复现不出这 9 条（与 P-DEBT-13 cron 同类现象）。

**版本选定**：树内三副本 ——

| 副本版本   | 来源                                                            | 处置         |
| ---------- | --------------------------------------------------------------- | ------------ |
| **18.0.3** | `@nestjs/config@12.0.1` 传递 dependencies（应用运行时同源副本） | **选定转正** |
| 17.4.2     | `@sentry/bundler-plugins@11.10.0`（构建工具）                   | 不动         |
| 8.6.0      | `typeorm-model-generator`（devDep）                             | 不动         |

选 18.0.3：与应用运行时经 `@nestjs/config` 加载的 dotenv 同源；复用既有 snapshot，版本零变化、无新包副本（与 P-DEBT-13 cron 转正同思路）。dotenv 18.0.3 自带类型 `dist/index.d.ts`（package.json `types` 指向），声明后不会另报 TS7016。

**归类**：devDependencies。`src/` 全仓 grep `from 'dotenv'` / `require('dotenv')` = **0** 命中；dotenv 仅被 9 个 bin 运维脚本直接 import（bin 经 tsx transpile-only 运行，不进 nest build dist）。仓内 bin 工具依赖 `prompts` / `rimraf` 先例即在 devDependencies；prod 运行时 dotenv 仍由 `@nestjs/config` 传递依赖提供，prod 依赖树不因本单新增直接运行时依赖。

### 3.3 错误文件范围复核

CI / 本机错误文件全部为 `test/**/*.spec.ts` + `src/**/*.spec.ts` + `bin/*.ts`；**src 非 spec 业务代码 0 错误**。本单未改动任何 spec / bin 源码，仅补类型入口与依赖声明。

---

## 四、闸门表（真实数字，exit code 实测）

**机器常驻进程状态**：后端 `nest start --watch` 已停；前端 vite PID 7860（admin-dashboard）保留未动。全量墙钟可比性以**用例数 / 文件数**为准。

| 闸门                    | 命令                                                              | exit  | 实测数字                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式类型检查            | `pnpm typecheck`（`tsc -b tsconfig.check.json`）                  | **0** | **0 error**（仓内正式 typecheck 闸门，composite 项目引用，仅查 src 非 spec）                                                                                                                                                      |
| 全量根类型（CI 同口径） | `tsc --noEmit -p tsconfig.json`                                   | **0** | **改前本机基线 7397** 条（TS2304 4829 / TS2593 2556 / TS7006 12；本机缺 TS2307，见 §3.2）；**改后 0 行 / 0 错误**，EXIT 0。CI 口径 7406 = 本机 7397 + TS2307 9（dotenv），声明后同口径应归零。                                    |
| Lint（权威）            | `pnpm lint`                                                       | **0** | **0 error / 1 warning**（既有 `test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，范围外未修）                                                                                                                               |
| oxlint fast             | `pnpm lint:fast`                                                  | **0** | **0 warning / 0 error**，1347 文件（93 rules / 8 threads）                                                                                                                                                                        |
| 定向 spec               | `pnpm exec vitest run test/base`                                  | **0** | **2 文件 / 32 passed**（auth-reset-password + wp25-security-hardening；日志 ERROR 为 spec 内故意触发的异常分支断言，非失败）                                                                                                      |
| Lockfile 一致性         | `pnpm install --frozen-lockfile --lockfile-only`                  | **0** | EXIT 0（lockfile 与 package.json 一致、dotenv snapshot 齐全）。注：该命令会对 lockfile 做 YAML 空格规范化重排（无包 / 版本增删）；为保持最小 diff，已 `git checkout -- pnpm-lock.yaml` 回退后手工补 dotenv 三行，未再跑 install。 |
| engine-core             | `git diff --stat HEAD -- src/engine-core`                         | 0     | **空**（零 diff）                                                                                                                                                                                                                 |
| migration               | `git diff --stat HEAD -- src/migration/`                          | 0     | **空**（零 diff）                                                                                                                                                                                                                 |
| 范围隔离                | `git status --short` + `git ls-files --others --exclude-standard` | 0     | tracked 改动仅 3 文件（§2.1 前三个）；未跟踪 6 产物（§2.3）显式排除                                                                                                                                                               |
| 边界                    | `test/engine-core/boundary.spec.ts`                               | 0     | 零改动，12 绿（沿用基线）                                                                                                                                                                                                         |

**全量测试口径**：本轮改动为 tsconfig 类型入口 + devDependency 声明，均不进入 vitest 运行时（vitest 经自身 loader 独立解析模块，不消费 tsc `types` 全局声明）；定向 `test/base` 32 passed 已确认运行时无回归。沿用 P-DEBT-13 第二轮先例，**未重跑全量测试**，基线 **3356 passed + 4 skipped（3360 例 / 200 文件）**（TD-20 `d008326`，P-DEBT-13 修正 flake 后口径）不变；本单未新增 spec。

---

## 五、边界确认

- **engine-core / migration / boundary.spec / test / src 业务代码**：零 diff；未碰禁动边界。
- **依赖范围**：dotenv 仅转正既有传递副本；不新增第三方包、不升级版本。openai / langsmith / typeorm / @nestjs/typeorm patch 升级、37 moderate + 2 low audit 漏洞、`email.service.ts` 两处无泛型 `config.get('email')` 等既往另案沿用台账登记，本单不动。
- **未顺手清理**：spec 混合 import 形态（135 显式 / 71 全局）本单不收敛；TD-12 另案 A–F（分层 / 逐文件阈值等）、TD-18/19/20 观察项、Judge Layer 并行线均沿用既有登记。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增第三方依赖。
- **提交边界**：单 commit；未自动 push（push 由用户指令触发）。

---

## 六、偏差与遗留登记

### 6.1 本单遗留（不阻断）

- **CI fresh install 口径待复核**：本机实体 `node_modules` 掩盖传递依赖，TS2307（dotenv）与 P-DEBT-13 cron 同现象；dotenv 类型解析在 CI fresh install 是否成立，最终以推送后 CI Typecheck 步骤为准。
- **观察（flake，沿用 P-DEBT-13）**：`debug-session-persistence.spec.ts` ⑥ waitFor 在全量 isolate 模式下偶发超时（隔离重跑 26 passed）；文件持久化 + Redis，IO 竞争敏感；观察项，不阻断。

### 6.2 未纳入本单（范围隔离）

- 37 moderate + 2 low audit 漏洞（CI `--audit-level=high` 不阻断）
- openai / langsmith / typeorm / @nestjs/typeorm patch 升级（advisory 未命中）
- `email.service.ts` 两处 `config.get('email')` 无泛型（CI 未报 unsafe）
- `test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable warning（warning 不阻断）
- TD-12 另案 A–F、TD-13 ~ TD-20 另案 G–P 与各观察项、Judge Layer 并行线（六条待决策项用户未拍板、第二家 provider key 待采购）

---

## 七、Actions 复核结论（待 push 后回填）

| Job / 步骤                              | 结论   | 证据                                                                                                                       |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `Lint + Typecheck` · **Typecheck** 步骤 | 待复核 | 预期：`tsc --noEmit -p tsconfig.json` EXIT 0（globals 类型 + dotenv 声明后，7406 条错误归零）                              |
| `Lint + Typecheck` · **Lint** 步骤      | 待复核 | 预期：沿用 P-DEBT-13 已确认的 success（本单未改 lint 规则与源码）                                                          |
| `unit`（2 分片）/ `e2e` / `coverage`    | 待复核 | Typecheck 转绿后，三个 `needs: lint-and-typecheck` job 将**首次在 CI 真正跑起来**（既往自 TD-11 分片改造起一直被 skipped） |
| `build`（needs `[unit, e2e]`）          | 待复核 | 依赖 unit / e2e 真正跑完后触发                                                                                             |
| `security-audit`                        | 待复核 | 预期：沿用 P-DEBT-13 已确认的 success（19 high 清零）                                                                      |

**目标达成判定（待 CI 复核后回填）**：Typecheck 步骤转绿 → 下游 unit / e2e / coverage / build 解除 skipped；P-DEBT-14 闭合。

---

## 八、commit message 草稿

```
fix(ci): P-DEBT-14 补 vitest 全局类型与 dotenv 直接依赖，修复 CI Typecheck

- tsconfig: types 注入 vitest/globals，消除 spec 全局符号 TS2304/TS2593/TS7006
- devDeps: dotenv 18.0.3 显式声明（@nestjs/config 传递副本转正，复用既有 snapshot），
  消除 9 个 bin 脚本 TS2307；src 无直接 dotenv import，归 devDependencies
- 台账: P-DEBT-14 已处置；本机根 tsc 7397 → 0 error，check.json / lint / oxlint / 定向测试全绿
```

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `404cbe6` · 未自动提交 / push_
