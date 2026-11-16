# P-DEBT-16 / 17 / 18 · CI 闸门闭环修复（coverage v8 采集 + e2e env stub + Docker corepack）— 交付记录

- **状态**：✅ CI 闸门已闭环（2026-11-15；run #43671158211 `b4c8bcc` 全 Job ✅：Audit / Lint+Typecheck / Unit×2 / E2E / Coverage / Build (Docker)）
- **基线 HEAD**：`b4c8bcc`（与 `origin/integrate` 一致）
- **债务条目**：P-DEBT-16（coverage v8 采集未启用）、P-DEBT-17（e2e 装配期 env 硬校验）、P-DEBT-18（Docker build 缺 corepack），台账 §9
- **提交方式**：代码 / 配置分三个原子 commit 已推送 —— `d269151`（P-DEBT-16 脚本 + P-DEBT-17 三 stub）、`beae58e`（P-DEBT-17 第四 stub）、`b4c8bcc`（P-DEBT-18 Dockerfile）；`95d64d1` 为 P-DEBT-16/17 台账回填 docs；本记录 + 台账最终回填随 docs 分组提交

---

## 一、本单做了什么（一句话）

沿 P-DEBT-13 → 15 已闭环路径，逐个消除 CI 闸门在解除 skipped 后新暴露的三类失败面：① **P-DEBT-16** —— `--coverage` 经 pnpm `--` 透传后被 vitest 当位置参数，v8 采集未启用、`coverage/` 空目录导致上传步骤失败；新增独立 `test:coverage` 脚本（内嵌 `--coverage`），workflow 改调该脚本。② **P-DEBT-17** —— e2e 装配真实 AppModule 触发构造期 env 硬校验；第一轮补 LlmService 三个 stub，CI 复核推进到下一 provider AsrTokenService，第二轮补第四 stub；全仓穷举确认其余构造期校验无阻断。③ **P-DEBT-18** —— e2e 转绿后 Build 首次真正触发 Docker build，Node v25+ 基础镜像不再捆绑 corepack，`corepack enable` exit 127；Dockerfile / Dockerfile.prod 改经 npm 独立安装 corepack。本批无 `src/**/*.ts` 业务代码改动，engine-core / migration / boundary.spec / test 零 diff。

---

## 二、改动文件清单

### 2.1 修改（tracked 文件，按 commit 分组）

| 文件                                                   | commit    | 改动                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                         | `d269151` | 新增 `test:coverage` 脚本：`vitest run --coverage --exclude '**/e2e/**/*.ts'`；原 `test` 脚本（无 `--coverage`）保持不动。                                                                                                                                                                           |
| `.github/workflows/ci.yml`                             | `d269151` | Coverage job 步骤由 `pnpm run test -- --coverage` 改调 `pnpm run test:coverage`（`--coverage` 不经 `--` 透传）；E2E job `env` 段补三个 stub：`MINIMAX_BASE_URL=http://127.0.0.1:1`、`MINIMAX_API_KEY=stub-test-key`、`MINIMAX_LLM_MODEL=stub-model`（注释标注：stub 仅过非空校验、不发起网络调用）。 |
| `.github/workflows/ci.yml`                             | `beae58e` | E2E job `env` 段补第四 stub `MINIMAX_ASR_TOKEN_SECRET=stub-asr-token-secret`（覆盖 AsrTokenService 构造期校验）。                                                                                                                                                                                    |
| `Dockerfile`                                           | `b4c8bcc` | deps、build 两阶段 `RUN corepack enable` 改 `RUN npm install -g corepack && corepack enable`（3 处镜像基线 `node:26-alpine` 不动）。                                                                                                                                                                 |
| `Dockerfile.prod`                                      | `b4c8bcc` | 单阶段同行改 `RUN npm install -g corepack && corepack enable`（生产瘦身后，CI 未引用、预防同类债）。                                                                                                                                                                                                 |
| `docs/team/gate-performance-remediation-2026-11-11.md` | docs 组   | P-DEBT-16 / 17 行状态回填 CI 复核结论；新增 P-DEBT-18 行；§更新记录追加闭环条目。                                                                                                                                                                                                                    |

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`test/engine-core/boundary.spec.ts`、整个 `test/` 目录、`src/**/*.ts` 业务代码 —— 零 diff
- `tsconfig*.json`、vitest 各 config、`pnpm-lock.yaml`、lint / typecheck 配置 —— 零改动
- 未引入新第三方依赖；`npm install -g corepack` 为 Node 镜像内 npm 包管理操作，corepack 仅生成 pnpm shim；`packageManager: pnpm@9.15.0` 仍是包管理器版本真相源
- Dockerfile 基础镜像保持 `node:26-alpine`：`package.json` engines 要求 `node >=26` + `engineStrict: true`，不降级 v24 镜像

### 2.3 显式排除的未跟踪产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 并行线备忘）
- `docs/worklog/pending/archive/relay-response-20261114-1524.md`、`-1719.md`、`-1818.md`、`-20261115-0227.md`、`-20261115-0346.md`（既往 relay 回执，口径不入库）
- `coverage/` 已在 `.gitignore`，不入库

---

## 三、根因与修复手段

### 3.1 P-DEBT-16 · Coverage v8 采集未启用（空目录上传失败）

**现象**：Coverage job 测试全过（199 文件 / 3352 passed + 8 skipped），但上传步骤 `if-no-files-found: error` 报 `No files were found with the provided path: coverage/`；日志无 `Coverage enabled with v8` 行、无覆盖率表格。

**取证**：workflow 原步骤 `pnpm run test -- --coverage`。`test` 脚本为 `vitest run --exclude '**/e2e/**/*.ts'`；经 pnpm `--` 透传后 `--coverage` 落在字面 `--` 之后，vitest 将其解析为位置参数（spec filter）而非采集 flag，v8 coverage reporter 未注册。本机直跑 `vitest run <spec> --coverage` 可正常生成 lcov，排除 vitest 配置本身问题。

**修复**：`package.json` 新增 `test:coverage` 脚本，`--coverage` 内嵌在脚本命令内；workflow coverage 步骤改调 `pnpm run test:coverage`，不经 `--` 透传。

**CI 复核证据**（run #43669815673，`95d64d1`；run #43671158211 `b4c8bcc` Coverage 保持 ✅）：

- 日志确认 `Coverage enabled with v8`
- Test Files **199 passed + 1 skipped（200）**；Tests **3352 passed + 8 skipped（3360）**；Duration 50.20s
- All files 覆盖率 **stmts 48.11 / branch 47.19 / funcs 44.1 / lines 47.88**，四指标全部达 TD-12 阈值（44 / 43 / 40 / 44），缓冲 **+4.11 / +4.19 / +4.10 / +3.88 pp**
- artifact `coverage-lcov` 上传成功（6,561,031 bytes，Artifact ID 14144230769；sha256 `9ebb68501788000bcd6c54f3190f1b3789b3e03b0210919f50c84940f181cd28`）

### 3.2 P-DEBT-17 · E2E 装配期 env 硬校验（两轮迭代）

**现象（第一轮）**：e2e suite `test/e2e/v2-user-flow.spec.ts` 装配真实 AppModule → `LlmService` 构造期 `configMust` 校验 `MINIMAX_BASE_URL` / `MINIMAX_API_KEY` / `MINIMAX_LLM_MODEL`，CI e2e job `env` 段未注入任一 → `Missing required env var: <key>`（`llm.service.ts:117`，`configMust` 空则 throw `llm.service.ts:400`）。

**修复（第一轮，`d269151`）**：e2e job `env` 段补三个 stub；LlmService 构造仅存字段、不发起网络调用，stub 仅通过非空校验。

**现象（第二轮，run #43669815673 复核）**：LlmService 三 key 已过，装配链推进到下一 provider，暴露第二处构造期硬校验 —— `AsrTokenService: missing env MINIMAX_ASR_TOKEN_SECRET`（`asr-token.service.ts:51`，`config.get('minimax.asrTokenSecret')` 空则 throw；`minimax.baseUrl` 复用既有 `MINIMAX_BASE_URL` stub）。

**修复（第二轮，`beae58e`）**：e2e job `env` 段补第四 stub `MINIMAX_ASR_TOKEN_SECRET=stub-asr-token-secret`。

**构造期 env 硬校验穷举结论**（四类检索：`throw new Error` / `getOrThrow` / `configMust` / `process.env`）：

| 服务                    | 构造期校验                                                                           | CI 覆盖情况                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `llm.service.ts`        | 三 key：`minimax.baseUrl` / `apiKey` / `llmModel`                                    | 三个 stub 覆盖 ✅                                                                       |
| `asr-token.service.ts`  | `minimax.asrTokenSecret`（throw）；`minimax.baseUrl`（`getOrThrow`）                 | secret 第四 stub；baseUrl 复用 `MINIMAX_BASE_URL` ✅                                    |
| `auth.service.ts`       | `jwtRefreshSecret` 非空且 ≠ `jwtSecret`                                              | CI 已注 `JWT_SECRET` / `JWT_REFRESH_SECRET`（不同值）✅                                 |
| `tts-bidi-client.ts`    | `getOrThrow` baseUrl / apiKey                                                        | 复用既有 stub ✅；`MINIMAX_TTS_VOICE_ID` throw 在运行期会话方法内，非构造期，装配不触发 |
| `rsa-key.service.ts`    | `onModuleInit` 生命周期钩子（非构造函数），`envPub && envPriv` 容错，无 key 不 throw | 容错，无需 stub ✅                                                                      |
| `sentry.service.ts`     | 读 `SENTRY_DSN`，容错不 throw                                                        | 容错 ✅                                                                                 |
| `llm-router.service.ts` | 构造期默认值兜底无 throw；L120/124/163/168/182/186 均为方法内 throw                  | 不触发装配 ✅                                                                           |

env 映射口径：`@nestjs/config` 点号驼峰 ↔ 大写下划线（`minimax.baseUrl` ↔ `MINIMAX_BASE_URL`）。stub 仅通过非空校验、不联网；生产 env 由部署环境注入。

**CI 复核证据**：run #43670525595（`beae58e`）E2E job ✅ success；run #43671158211（`b4c8bcc`）E2E 保持 ✅。

### 3.3 P-DEBT-18 · Docker build 缺 corepack（Node 25+ 不再捆绑）

**现象**：e2e 转绿后 Build job 解除 skipped、首次真正触发 Docker build；deps / build 阶段 `RUN corepack enable` 报 exit 127（`/bin/sh: corepack: not found`，buildx #12）。

**取证**：corepack.org FAQ 与 Node v26 文档口径一致 —— **Node v25 起 corepack 不再随 Node 分发**，v24 及之前内置；`node:26-alpine` 基础镜像只带 npm。Dockerfile 原注释"Node 26 自带 corepack"与现实不符。

**选型排除**：降级镜像到 `node:24-alpine` 不可取 —— `package.json` engines 要求 `node: ">=26"` 且 `engineStrict: true`，降级会违反 engines。按 Node v25+ 官方建议，走 npm 独立安装 corepack。

**修复**：`Dockerfile` deps / build 两阶段 + `Dockerfile.prod` 一处，`RUN corepack enable` 改 `RUN npm install -g corepack && corepack enable`。npm 在 Node 镜像中始终自带，不依赖 corepack；安装后 corepack 生成 pnpm shim，`packageManager: pnpm@9.15.0` 版本真相源不变。

**CI 复核证据**：run #43671158211（`b4c8bcc`）Build (Docker) job ✅ success；size check 输出 `Image size: 1.33GB`（该步骤仅 echo 展示、无阈值阻断，job success 即通过）；日志无 ERROR / 无非零退出。

---

## 四、闸门表（真实数字）

**机器常驻进程状态**：后端 `nest start --watch` 已停；前端 vite 保留未动。本批改动为 workflow YAML / package.json 脚本名 / Dockerfile，不进入 vitest 运行时，未改 spec 集合与断言。

| 闸门                                    | 命令 / 来源                                               | 结论       | 实测数字                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage（CI）                          | `pnpm run test:coverage`，run #43669815673                | ✅ exit 0  | 199 passed + 1 skipped（200 文件）；3352 passed + 8 skipped（3360）；50.20s；48.11 / 47.19 / 44.1 / 47.88；artifact 6.56 MB 上传      |
| E2E（CI）                               | workflow e2e job，run #43670525595 / #43671158211         | ✅ success | AppModule 装配通过；四轮 provider 构造期校验全部覆盖                                                                                  |
| Build Docker（CI）                      | `docker build -t mofang-nestjs:<sha> .`，run #43671158211 | ✅ success | 镜像构建完成，Image size 1.33GB，无 ERROR / 非零退出                                                                                  |
| Lint + Typecheck（CI）                  | run #43671158211 复用                                     | ✅ success | 本批未改 lint / 类型配置，沿用 P-DEBT-14/15 口径                                                                                      |
| Unit ×2（CI）                           | run #43671158211 复用                                     | ✅ success | 沿用 P-DEBT-15 基线，模块解析债已消除                                                                                                 |
| Audit（CI）                             | run #43671158211 复用                                     | ✅ success | 19 high 清零保持                                                                                                                      |
| 本机全量采集（P-DEBT-16 修复验证）      | `vitest run --coverage`（本机）                           | ✅         | 3355 passed + 4 skipped；1 文件 `wp38-debug-session-resume` isolate 全量模式偶发超时，隔离重跑 10 passed（IO 竞争敏感 flake，非回归） |
| engine-core / migration / boundary.spec | `git diff --stat`                                         | 0          | 零 diff                                                                                                                               |

**全量测试口径**：本批改动不改变 spec 集合 / 断言 / 用例数；CI Coverage 3352 passed + 8 skipped（3360）为最终权威基线。

---

## 五、边界确认

- **engine-core / migration / boundary.spec / test / src 业务代码**：零 diff；未碰禁动边界。
- **依赖范围**：未引入新第三方包、未升级版本；corepack 为 Node 镜像内 npm 全局安装的包管理器桥接，非项目运行时依赖。
- **镜像范围**：基础镜像 `node:26-alpine` 不降级；prod 瘦身路径在 `Dockerfile.prod`，与 CI 构建的 dev 三阶段镜像分离。
- **未顺手清理**：TD-12 另案 A–F、TD-13 ~ TD-20 另案与各观察项、Judge Layer 并行线均沿用既有登记，本单不动。
- **命令边界**：一律 `pnpm`，未用裸 `npx`；未跑 `pnpm install`（lockfile 零改动，无 YAML 重排风险）。
- **提交边界**：三个代码 / 配置 commit + 一个 docs commit 已推送；本记录与台账最终回填随 docs 分组提交；未使用 `--no-verify`。

---

## 六、偏差与遗留登记

### 6.1 本单遗留（不阻断）

- **dev 镜像 1.33GB**：该镜像为 dev 三阶段（含 devDependencies），CI 仅验证可构建；生产瘦身在 `Dockerfile.prod`（服务器部署路径）。镜像体积优化另案跟踪。
- **Trivy job 解耦**：Trivy 步骤静态扫 `node:24-alpine` 基线镜像，不引用本 Dockerfile，与 P-DEBT-18 改动无关。
- **flake 观察**：`wp38-debug-session-resume.spec.ts` isolate 全量模式偶发超时（文件持久化 + Redis，IO 竞争敏感），隔离重跑通过；观察项，不阻断。

### 6.2 未纳入本单（范围隔离，沿用既有登记）

- 37 moderate + 2 low audit 漏洞（CI `--audit-level=high` 不阻断）
- openai / langsmith / typeorm / @nestjs/typeorm patch 升级（advisory 未命中）
- `email.service.ts` 两处 `config.get('email')` 无泛型（CI 未报 unsafe）
- `test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable warning（warning 不阻断）
- TD-12 另案 A–F；TD-18 / TD-19 / TD-20 观察项；Judge Layer 并行线（六条待决策项用户未拍板、第二家 provider key 待采购）

---

## 七、Actions 复核结论（run #43671158211，`b4c8bcc`，2026-11-15）

| Job                 | 结论       | 证据                                                                                                 |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `Security Audit`    | ✅ success | 沿用既有 job；19 high 清零保持                                                                       |
| `Lint + Typecheck`  | ✅ success | 本批未改 lint / 类型配置                                                                             |
| `Unit`（shard 1/2） | ✅ success | 沿用 P-DEBT-15 模块解析修复基线                                                                      |
| `Unit`（shard 2/2） | ✅ success | 同上                                                                                                 |
| `Coverage`          | ✅ success | v8 enabled；199 文件 / 3352 passed + 8 skipped；48.11 / 47.19 / 44.1 / 47.88 达 TD-12；artifact 上传 |
| `E2E`               | ✅ success | 四轮 provider 构造期校验覆盖；AppModule 装配通过                                                     |
| `Build (Docker)`    | ✅ success | corepack 经 npm 安装；镜像构建完成 1.33GB；无 ERROR                                                  |

**迭代轨迹**：run #43669815673（`95d64d1`）— Audit / Lint / Unit×2 / Coverage ✅，E2E ❌（AsrTokenService secret），Build ⏭ skipped；run #43670525595（`beae58e`）— 测试与 E2E ✅，Build ❌（corepack exit 127）；run #43671158211（`b4c8bcc`）— **全 Job ✅，Phase2.5 CI 闸门闭环**：unit×2 / e2e / coverage 收集通过，build 解除 skipped 并构建成功。

**目标达成判定**：P-DEBT-16 / 17 / 18 三项目标均达成 —— ① coverage v8 采集启用、产物上传成功、四指标达 TD-12 阈值；② e2e AppModule 装配在 CI 成立，构造期 env 缺口穷举归零；③ Docker build 在 CI 可构建，corepack 缺失消除。

---

## 八、commit message 草稿

```
docs(ci): P-DEBT-16/17/18 台账回填与交付记录；CI 闸门全绿闭环

- 台账: P-DEBT-16 coverage v8 采集 CI 复核通过（48.11/47.19/44.1/47.88，
  TD-12 达标，artifact 6.56MB）；P-DEBT-17 两轮迭代回填（LlmService 三 stub
  → AsrTokenService 第四 stub，e2e ✅）；新增 P-DEBT-18 行（corepack 经 npm
  安装，Docker build ✅ 1.33GB）；更新记录追加闭环条目
- 交付记录: p-debt-16-17-18-ci-coverage-e2e-env-docker-corepack
  -implementation-2026-11-15.md
- CI run #43671158211 b4c8bcc: Audit / Lint+Typecheck / Unit×2 / E2E /
  Coverage / Build(Docker) 全 ✅；dev 镜像体积、audit 漏洞等观察项沿用另案登记
```

---

_记录时间：2026-11-15 GMT+8 · 基线 HEAD `b4c8bcc`（= `origin/integrate`）；代码 / 配置 commit `d269151` / `beae58e` / `b4c8bcc` 已推送；CI 复核 run #43671158211_
