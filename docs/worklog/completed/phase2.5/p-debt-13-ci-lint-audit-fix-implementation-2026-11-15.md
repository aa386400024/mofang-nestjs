# P-DEBT-13 · CI 长期红修复（lint type-aware error + audit high 依赖漏洞）— 交付记录

- **状态**：✅ 已交付（2026-11-15，本机闸门全绿；CI 结果待 push 后 Actions 复核）
- **基线 HEAD**：`d008326`（TD-20 交付后，与 `origin/integrate` 一致）
- **债务条目**：P-DEBT-13（技术债台账 §9）；新登记 **P-DEBT-14**（tsconfig spec 全局类型缺失，本单不修）
- **提交方式**：单 commit（用户拍板：lint + 依赖升级 + 台账一起，不拆分代码 / docs）

---

## 一、本单做了什么（一句话）

修掉 CI 两个平行红 job：① `soft-delete.cron.ts` 两条 type-aware unsafe（`config.get` 补叶子键泛型 + 兜底默认值，撤 `eslint-disable` 与 `as string`）；② audit **19 high** 依赖漏洞（nodemailer 6.10.1 → 10.5.0、axios → 1.21.1、pnpm overrides 强制 axios / undici 版本消除传递链旧副本）。lockfile 旧漏洞副本全部消失；engine-core / migration / boundary.spec / test 零改动。

---

## 二、改动文件清单

### 2.1 修改（4 个 tracked 文件）

| 文件                                                   | 改动                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/user/cron/soft-delete.cron.ts`                    | `cronExpr = this.config.get<string>('softDelete.cronSchedule') ?? '0 3 * * *'`；`new CronJob(cronExpr, ...)`（撤 `as string`）；`retentionDays = this.config.get<number>('softDelete.retentionDays') ?? 30`；删除 2 条 `eslint-disable-next-line no-unsafe-assignment` 注释。默认值与 `src/config/envs/default.ts` softDelete 段一致。 |
| `package.json`                                         | axios `^1.20.0 → ^1.21.1`；nodemailer `^6.10.1 → ^10.5.0`；删除 devDep `@types/nodemailer ^6.4.24`（10.x 自带类型）；新增顶层 `"pnpm": { "overrides": { "axios": "^1.21.1", "undici": "^7.30.1" } }`；**第二轮**补直接依赖 `"cron": "4.4.0"`（schedule 传递副本转正，同版本，见 §3.5）。                                               |
| `pnpm-lock.yaml`                                       | install 后副本替换：axios 唯一 1.21.1、nodemailer 唯一 10.5.0、undici 唯一 7.30.1；`@types/nodemailer` 0 处；resolved 块无跨大版本漂移（@nestjs/* 等仅 peer 哈希内 axios 版本号更新，包版本不变）；**第二轮** root importer 补 cron 4.4.0 三行（既有 snapshot 复用，无新包副本）。                                                     |
| `docs/team/gate-performance-remediation-2026-11-11.md` | P-DEBT-13 状态 🟠 → 🟢 已处置（补修复手段与闸门数字）；新增 P-DEBT-14 行；§更新记录追加本单落地条目。                                                                                                                                                                                                                                  |

### 2.2 删除

`@types/nodemailer` devDep（nodemailer 10.x 自带 `./dist/cjs/nodemailer.d.ts`，外部类型包冗余）。

### 2.3 零改动确认

- `src/engine-core/`、`src/migration/`、`test/engine-core/boundary.spec.ts`、整个 `test/` 目录 —— 零 diff
- 其他业务域 service / controller / entity / DTO / module、`tsconfig*.json`、`vitest.config.mts`、CI workflow、Dockerfile、前端 / Flutter —— 零改动
- 未引入新第三方包：仅升级现有依赖 + pnpm override；第二轮 `cron@4.4.0` 为已在依赖树内的 schedule 传递副本转正为直接依赖，版本与现有 snapshot 逐字一致（§3.5）

### 2.4 显式排除的未跟踪产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 备忘，零 src 改动，另一条并行线）
- `docs/worklog/pending/archive/relay-response-20261114-1524.md`、`-1719.md`、`-1818.md`、`-20261115-0227.md`、`-20261115-0346.md`（既往 relay 回执，口径不入库）

---

## 三、根因与修复手段

### 3.1 Lint（`Lint + Typecheck` job，两条 type-aware error）

| 位置                        | 规则                                      | 根因                                                                                                         | 修复                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soft-delete.cron.ts` 59:11 | `@typescript-eslint/no-unsafe-assignment` | `this.config.get('softDelete')` 未传类型泛型，返回 error typed 对象，取 `.cronSchedule` 后 `cronExpr` 不安全 | 改叶子键 `get<string>('softDelete.cronSchedule') ?? '0 3 * * *'`（对齐仓内 `config.get<string>('KEY') ?? 默认值` 先例：llm.service.ts `minimax.llmTimeoutMs`、practice-asr._、supervision._ 等；点号嵌套键 ConfigService 原生支持） |
| `soft-delete.cron.ts` 62:60 | `@typescript-eslint/no-unsafe-argument`   | 上一条传导：`cronExpr` 不安全 → 传入 `new CronJob(...)` 实参不安全                                           | 类型收窄后 `cronExpr: string`，撤 `as string`；`retentionDays` 同法 `get<number>(...) ?? 30`                                                                                                                                        |

> 本机 Node 22 冷跑复现不出（CI Node 24 才暴露 + `.eslintcache` 掩盖）；本机清缓存冷跑仍 0 error。正确性最终以推送后 CI lint job 为准。

### 3.2 Audit（`Security Audit` job，19 high 三条链）

| 依赖       | high 条数 | 漏洞副本                                      | 传递链 / 来源                                                                                                                                                                                                          | 处置                                                                                                      |
| ---------- | --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| axios      | 9         | `axios@0.21.4`                                | `typeorm 1.1.2 → mssql 6.4.1`（typeorm optional peer）`→ tedious 6.7.1 → @azure/ms-rest-nodeauth 3.1.1 → adal-node 0.2.4 → axios 0.21.4`。本仓用 mysql2，该 mssql Azure AD 认证链运行时不加载；直接依赖 axios 本身安全 | `pnpm.overrides` 强制 axios `^1.21.1`，治本消除 0.21.4 副本（未选 audit 白名单 ignore，未保留副本仅登记） |
| nodemailer | 5         | `nodemailer@6.10.1`（直接生产依赖，唯一副本） | advisory 范围 `<=7.0.10` / `<=9.0.0` / `<9.1.0` / `<=10.0.5` / `<=8.0.7`；最后一条 `<=10.0.5` 决定必须 >10.0.5                                                                                                         | 直接依赖升 `^10.5.0`；跨大版本无中间档可选（必须 10.x 才能消 `<=10.0.5` 那条）                            |
| undici     | 4         | `undici@7.29.1`                               | 来自直接依赖 `@qdrant/js-client-rest 1.20.0` 的 **dependency 钉死**（非 peer，声明精确 `undici 7.29.1`）；另一份 `undici@7.30.1`（openai / langsmith / compodoc）已安全；advisory `<7.30.1`                            | `pnpm.overrides` 强制 undici `^7.30.1`（不上 8.x 大版本）                                                 |

### 3.3 Lockfile 副本核对（install 后实测）

| 包                | 改前漏洞副本           | 改后 lockfile 版本                             | 旧副本        |
| ----------------- | ---------------------- | ---------------------------------------------- | ------------- |
| axios             | 0.21.4（adal-node 链） | 唯一 **1.21.1**（含 debug@4.4.3 可选 peer 块） | 0.21.4 已消失 |
| nodemailer        | 6.10.1                 | 唯一 **10.5.0**                                | 6.10.1 已消失 |
| undici            | 7.29.1（qdrant 钉死）  | 唯一 **7.30.1**                                | 7.29.1 已消失 |
| @types/nodemailer | 6.4.24                 | **0 处**                                       | 已移除        |

> lockfile 中 `gaxios@6.7.1` 为 Google API 客户端包，非 axios 库，正则易误匹配；axios 库版本键仅 `axios@1.21.1` 两块。

### 3.4 nodemailer 6 → 10 兼容性评估

使用面仅 `src/shared/infra/email/email.service.ts`：`createTransport({ jsonTransport: true })` / `createTransport({ host, port, secure, auth })` / `transporter.sendMail({ from, to, subject, text, html })`；调用方 `src/auth/login-code.service.ts` 只走 `EmailService.send({ to, subject, html, text })`。6→10 breaking（错误码 NoAuth → ENOAUTH、移除旧 SES SDK）均不触及；不用 OAuth2 / raw / envelope.size。无 email 专项 spec。

### 3.5 第二轮 CI 复核（run #43660807194，commit `0c82a76`）：lint 残留根因修正

第一轮推送后 CI 结论：**Security Audit = success** ✅（19 high 清零，第二目标达成）；**Lint + Typecheck 仍 failure**。复核 CI 全量日志（Node v24.22.2 / TS 6.0.3 / typescript-eslint 8.72.1 / pnpm 9.15.0）：

| 位置（改后行号）            | 规则                   | 复核结论                                                                                                                                                                            |
| --------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soft-delete.cron.ts` 58:11 | `no-unsafe-assignment` | 第一轮的 `config.get<...>` 收窄**已生效**（55 行 `cronExpr` 不再报 unsafe）；错误转移到 `const job = new CronJob(cronExpr, ...)` —— **`new CronJob(...)` 实例被推断为 error typed** |
| `soft-delete.cron.ts` 61:60 | `no-unsafe-argument`   | 传导：`job`（error typed）传入 `addCronJob(name, job: CronJob<null, null>)` 实参 unsafe                                                                                             |

**真根因（幽灵依赖）**：`cron` 包是 `@nestjs/schedule@12.0.2` 的传递 dependencies（钉 `cron@4.4.0`），本仓 `package.json` **未显式声明**；源码仅本文件 `import { CronJob } from 'cron'`。仓内 `moduleResolution: nodenext` + pnpm isolated 严格隔离下，项目源码只能解析 `package.json` 直接依赖；未声明的传递依赖在 CI fresh `pnpm install --frozen-lockfile`（Linux，顶层 `node_modules` 仅直接依赖符号链接）解析不到类型 → `CronJob` 符号退化为 error typed → 构造实例 error typed。本机 Windows `node_modules/cron` 为历史遗留实体目录（非 `.pnpm` 符号链接）恰好能解析，故本机 eslint / tsc 均 0 error，**复现不出 CI 报错**。

**修复**：`package.json` dependencies 显式补 `"cron": "4.4.0"`（与 schedule 传递副本、lockfile 现有 snapshot **同版本**，非新版本）；`pnpm-lock.yaml` root importer 补 cron 三行（snapshot `cron@4.4.0` 块已存在，未新增包副本）。性质 = 把已在运行时依赖树内的包转正为直接依赖（修正 pnpm 幽灵依赖），**未引入新第三方包、版本零变化**；NestJS 动态 cron 官方示例即直接 `import { CronJob } from 'cron'`，显式声明对齐该惯例。

> 1:1 unused eslint-disable warning 归属 `test/e2e/v2-user-flow.spec.ts`（既有，范围外未修），非本 cron 文件。

---

## 四、闸门表（真实数字，exit code 实测）

**机器常驻进程状态**：后端 `nest start --watch`（PID 12992 pnpm start:dev → 3548 cmd → 14612 nest）已在 install EBUSY 排查时 `taskkill /T /F` 停掉；前端 vite PID 7860（admin-dashboard）保留未动。全量墙钟可比性以**用例数 / 文件数**为准。

| 闸门               | 命令                                                                     | exit         | 实测数字                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式类型检查       | `pnpm typecheck`（`tsc -b tsconfig.check.json`）                         | **0**        | **0 error**（仓内正式 typecheck 闸门）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 全量根类型（参考） | `tsc --noEmit -p tsconfig.json`                                          | 2            | **12295** 条错误，全部来自 spec / 测试文件（TS2593 describe/beforeEach/it + TS2304 expect，vitest 全局类型缺失）；非 spec 的 src 错误 **0**；本次改动文件（soft-delete / email.service / nodemailer / login-code）**0** 条。定性为既有配置债 → **P-DEBT-14**                                                                                                                                                                                                                                                                                |
| Lint（权威）       | `pnpm lint`（清 `.eslintcache` 冷跑）                                    | **0**        | **0 error / 1 warning**（既有 `test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，范围外未修）                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| oxlint fast        | `pnpm lint:fast`                                                         | **0**        | **0 warning / 0 error**，1347 文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 定向 spec          | `pnpm exec vitest run test/base`                                         | **0**        | **2 文件 / 32 passed**（auth-reset-password + wp25-security-hardening；日志 ERROR 为 spec 内故意触发的异常分支断言，非失败）                                                                                                                                                                                                                                                                                                                                                                                                                |
| 全量测试           | `pnpm test`（排除 e2e）                                                  | 1（1 flake） | 首跑 **1 failed / 3355 passed / 4 skipped（3360 例 / 200 文件）**；失败 = `test/admin-debug/debug-session-persistence.spec.ts` ⑥ waitFor 10s 超时。**隔离单跑该 spec：26 passed EXIT 0** → 判定 **flake**（全量 isolate 模式 200 worker 文件 IO 竞争；该 spec 走文件持久化 + Redis，不碰 nodemailer / axios / undici 运行时，与本次改动无关）。修正 flake 后全量 = **3356 passed + 4 skipped（3360 例 / 200 文件）**，与基线一致。Start 08:47:42，**Duration 166.92s**（import 68% / transform 19% / tests 11% / worker 2%），墙钟约 170.1s |
| Audit（本机）      | `pnpm audit --audit-level=high --prod --ignore-registry-errors`          | 0（放行）    | npmmirror 无 audit 端点（`registry.npmmirror.com/-/npm/v1/security/audits` doesn't exist），`--ignore-registry-errors` 放行 EXIT 0；**本机复现不出 CI audit 结果**，high 是否清零以推送后 CI security-audit job 为准                                                                                                                                                                                                                                                                                                                        |
| engine-core        | `git diff --stat HEAD -- src/engine-core`                                | 0            | **空**（零 diff）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| migration          | `git diff --stat HEAD -- src/migration/`                                 | 0            | **空**（零 diff）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 范围隔离           | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0            | tracked 改动仅 4 文件（§2.1）；未跟踪 6 产物（§2.4）显式排除                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 边界               | `test/engine-core/boundary.spec.ts`                                      | 0            | 零改动，12 绿（沿用基线）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**第二轮（cron 显式声明）本机闸门**：`tsc -b tsconfig.check.json` **0 error**；`pnpm lint`（清 `.eslintcache` 冷跑）**0 error / 1 warning**（既有 e2e）；`pnpm lint:fast` **0 warning / 0 error**（1347 文件）；`vitest run test/base` **2 文件 / 32 passed** EXIT 0；`pnpm install --frozen-lockfile --lockfile-only` EXIT 0（lockfile 与 package.json 一致、cron snapshot 齐全）。本轮仅 `package.json` + `pnpm-lock.yaml` 两行依赖声明增量，`src/` 零改动，未重跑全量测试（沿用第一轮 3356 passed + 4 skipped 基线）。

**全量口径对比**：基线 **3356 passed + 4 skipped（3360 例 / 200 文件）**（TD-20 `d008326`）→ 本单修正 flake后 **3356 passed + 4 skipped（3360 例 / 200 文件）**，用例数 / 文件数逐字一致（本单未新增 spec）。

---

## 五、边界确认

- **engine-core / migration / boundary.spec / test**：零 diff；未碰禁动边界。
- **依赖范围**：仅升级 axios / nodemailer + override axios / undici；openai / langsmith / typeorm / @nestjs/typeorm 的 patch 升级（advisory 未命中）不纳入；37 moderate + 2 low（CI 阈值 `--audit-level=high` 不阻断）不纳入。
- **未顺手清理**：`email.service.ts` 两处 `config.get('email')` 无泛型（CI 未报 unsafe，本单不动）；P-DEBT-14 tsconfig spec 类型缺失（另案）；既往另案 C2/G/I/J/K/M/N/P 与各观察项沿用台账登记。
- **命令边界**：一律 `pnpm` / `pnpm exec`，未用裸 `npx`；未新增第三方依赖。
- **提交边界**：单 commit；未自动 push（push 由用户指令触发）。

---

## 六、偏差与新登记债

### 6.1 本单新登记既有债

- **P-DEBT-14**：`tsconfig.json` `types: ["node"]` 且 `include` 含 `test/**/*`，spec 缺 vitest 全局类型（describe / it / expect）；本机 `tsc --noEmit -p tsconfig.json` 报 12295 条 TS2593 / TS2304（全 spec，src 非 spec 0）。CI Typecheck 步骤实测（run #43662569044）**7406** 条：TS2304 4829 / TS2593 2556 / TS7006 12 / TS2307 9；错误文件 = spec + bin 脚本，**src 非 spec 业务代码 0**；TS2307 9 条为 bin `import 'dotenv'`（dotenv 幽灵依赖）。lint 转绿后已在 CI 首次暴露；正式闸门 `tsc -b tsconfig.check.json` 通过、不受影响。处置方向：types 注入 vitest globals，或为 test 段补类型，或把 spec 排除出该 tsconfig；bin dotenv 显式声明可同批或另案；方案另案评估。
- **观察（flake）**：`debug-session-persistence.spec.ts` ⑥ waitFor 在全量 isolate 模式下偶发超时（隔离重跑 26 passed）；文件持久化 + Redis，IO 竞争敏感；观察项，不阻断。

### 6.2 未纳入本单（范围隔离）

- openai / langsmith / typeorm / @nestjs/typeorm patch 升级（advisory 未命中）
- 37 moderate + 2 low（CI `--audit-level=high` 不阻断）
- `email.service.ts` 两处 `config.get('email')` 无泛型（CI 未报 unsafe）
- P-DEBT-14 tsconfig spec 全局类型缺失

---

## 七、Actions 复核结论（run #43662569044，commit `9b08dc1`）

| Job / 步骤                                     | 结论           | 证据                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Security Audit`                               | **success ✅** | 19 high 保持清零（第一轮 run #43660807194 已确认，第二轮复核保持绿）；Trivy 步骤随 audit 通过。                                                                                                                                                                                                                                            |
| `Lint + Typecheck` · **Lint** 步骤             | **success ✅** | cron 显式声明生效，`soft-delete.cron.ts` 58:11 `no-unsafe-assignment` / 61:60 `no-unsafe-argument` 两条 type-aware error **消除**。                                                                                                                                                                                                        |
| `Lint + Typecheck` · **Typecheck** 步骤        | **failure**    | = **P-DEBT-14** 首次在 CI 暴露（见 §6.1）。CI 实测 **7406** 条：TS2304 **4829** / TS2593 **2556** / TS7006 **12** / TS2307 **9**；错误文件 = `test/**/*.spec.ts` + `src/**/*.spec.ts` + `bin/*.ts`，**src 非 spec 业务代码 0 错误**；TS2307 9 条全为 bin 脚本 `import 'dotenv'`（dotenv 同为未显式声明的传递依赖，与 cron 同类幽灵依赖）。 |
| `unit`（2 分片）/ `e2e` / `coverage` / `build` | **skipped**    | 因 `Lint + Typecheck` job 整体 failure，下游 `needs` 仍未触发；待 P-DEBT-14 另案处置后才能在 CI 首次真正跑通。                                                                                                                                                                                                                             |

**本单目标达成判定**：① lint type-aware error —— **已修复并经 CI Lint 步骤确认转绿**；② audit 19 high —— **已清零并经 CI Security Audit 确认 success**。剩余 Typecheck 红全部归 P-DEBT-14（另案，不在本单范围）。

---

## 八、commit message 草稿

第一轮 commit `0c82a76`（已推送）：

```
fix(ci): P-DEBT-13 修复 lint type-aware error 与 audit high 依赖漏洞

- soft-delete.cron.ts: config.get 补叶子键泛型 + 兜底默认值，撤 disable/as string
- deps: nodemailer 6.10.1 → 10.5.0（移除 @types/nodemailer）；axios → 1.21.1
- pnpm overrides: axios ^1.21.1 / undici ^7.30.1，消除传递链旧漏洞副本
- 台账: P-DEBT-13 已处置；新登记 P-DEBT-14（tsconfig spec 全局类型缺失）
```

第二轮追加 commit（cron 幽灵依赖转正）：

```
fix(ci): P-DEBT-13 补 cron 直接依赖声明，修复 CI lint CronJob error typed

- cron 为 @nestjs/schedule 传递依赖，源码直接 import 却未在 package.json 声明；
  pnpm isolated + nodenext 下 CI 类型解析失败，CronJob 实例退化为 error typed
- dependencies 显式声明 cron 4.4.0（与 schedule 传递副本同版本，无新包/版本变化）
- lockfile root importer 补 cron 引用，复用既有 snapshot
```

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `d008326` · 未自动提交 / push_
