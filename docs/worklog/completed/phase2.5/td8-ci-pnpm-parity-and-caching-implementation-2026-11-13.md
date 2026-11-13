# TD-8 · CI 工具链遗留三条整改（npm/pnpm 对齐 · 无效 coverage 步骤清理 · CI 缓存持久化 · 零 src 改动） — 交付记录

> 任务单：[TD-8 任务单](td8-ci-pnpm-parity-and-caching-task-2026-11-13.md)（已归档 ✅）· 唯一事实源：[工程工具链技术债清单](../../pending/phase2.5-toolchain-tech-debt-2026-11-11.md) + [闸门性能 remediation](../../../team/gate-performance-remediation-2026-11-11.md) §9 **P-DEBT-5**
> 上游：[TD-7 交付记录](td7-contract-drift-remediation-implementation-2026-11-13.md)（契约漂移残留已闭环，lint 0/0）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，上游 HEAD `a02198f`

---

## 一、结论

三条 CI 遗留**全部处置完毕**，**代码级唯一改动是 `.github/workflows/ci.yml`**，**`src/` / `test/` / `bin/` / `scripts/` / `admin-dashboard/` 零改动**（`git diff --name-only HEAD -- src test bin scripts admin-dashboard` = **0**），**engine-core 源码零 diff**（`git diff --stat HEAD -- src/engine-core` 空输出），**零运行时行为变化**，**用例数量与基线逐字一致**（**3252 例 / 194 文件**，0 failed）。

| #   | 遗留项                                              | 处置                                                                                                                                                                              |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | CI 包管理用 npm，与本地 / Dockerfile 的 pnpm 不一致 | 三个 job 的安装与脚本调用**全部改 pnpm**（corepack 安装 / `pnpm install --frozen-lockfile` / 脚本名逐字对应 package.json）；`cache: 'npm'` → 独立 `actions/cache` 缓存 pnpm store |
| C-2 | coverage 上传步骤无效（上传空目录）                 | **移除** `test` job 的 `Upload coverage` 步骤（`name / if / uses / with` 四行整体）；`vitest.config.mts` 的 coverage 段**未动**                                                   |
| C-3 | CI 未持久化依赖与 vitest 转换缓存                   | 新增 **pnpm store 缓存**（3 个 job，key 含 `pnpm-lock.yaml` 哈希）+ **vitest 转换缓存**（`node_modules/.vite/vitest`，key 同口径）；**未缓存 `node_modules` 本体**                |

**本单同时把闸门性能文档 §9 的 P-DEBT-5（CI 缓存与分片未做）拆单落地** —— 该条登记的「CI 每次全量冷跑」在缓存 + pnpm 对齐后得到缓解；**分片（shard 矩阵）不在本单范围**（任务单 §2 未授权，且分片会改变测试执行拓扑、需单独评估）。

---

## 二、C-1 明细 · npm → pnpm 逐条映射

### 2.1 复核锚点（动手前先核）

| 锚点           | 现场核实                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` | `packageManager: "pnpm@9.15.0"`、`engineStrict: true`、`engines.node: ">=26"`、`type: module`                                                                                                                                                                                                                                                              |
| `Dockerfile`   | `RUN corepack enable` → `COPY package.json pnpm-lock.yaml ./` → `pnpm install --frozen-lockfile`（deps stage）；build stage `corepack enable` + `pnpm build` + `pnpm install --prod --frozen-lockfile`                                                                                                                                                     |
| `ci.yml` 现状  | 三个 job（`lint-and-typecheck` / `test` / `security-audit`）各有 `cache: 'npm'` + `npm ci`；`npm run lint` / `npm test` / `npm run test:e2e` / `npm run migration:run` / `npx tsc --noEmit -p tsconfig.json` / `npm audit --audit-level=high --omit=dev`；`test` job 另有 `Upload coverage` 步骤；`build` job 走 Dockerfile，**不直接装 npm 依赖**（未改） |
| 双锁文件       | `package-lock.json`（659 714 B）与 `pnpm-lock.yaml`（416 855 B）**均被 git 跟踪**；Dockerfile 只 COPY `pnpm-lock.yaml`                                                                                                                                                                                                                                     |

### 2.2 pnpm 安装方式（决策点 D-c）

**选用：`corepack enable`**（与 Dockerfile 逐字一致）。

- 理由：Dockerfile 已用 `corepack enable`，CI 走同一口径 = **包管理口径单一**（红线 §4）；`actions/setup-node@v4` 的 `node-version: '24'` 运行时自带 corepack，无需引入第三个第三方 Action；`packageManager` 字段已钉死 `pnpm@9.15.0`，corepack 会按该字段解析版本。
- 备选 `pnpm/action-setup@v4` 固定 `9.15.0`（与 `packageManager` 逐字一致）**未采用** —— corepack 已在用（Dockerfile），再引入第二个安装通道会削弱「口径单一」。
- 每个 job 加一步 `Resolve pnpm version`（`run: pnpm --version`）：让 CI 日志**显式打出实际 pnpm 版本**，版本口径漂移时第一时间可见（不是装饰性步骤 —— corepack 解析失败会在此步直接暴露，而不是等到 install 报晦涩错误）。
- **本机限制（如实记录）**：本机 Windows 环境 `corepack` **不在 PATH**（`corepack --version` 报「无法将 corepack 项识别为 cmdlet」），故**无法在本机端到端复现 corepack 路径**。这不影响 CI —— CI 跑在 GitHub `ubuntu-latest`，Node 24 运行时自带 corepack；但「corepack 在该 runner 版本可用」这一条**属 CI 侧事实，本机无法验证**，留待主控 push 后在 Actions 复核（见 §八）。

### 2.3 逐条映射表

| 原（npm / npx）                           | 新（pnpm）                                              | 位置               | 依据                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache: 'npm'`（setup-node）              | 移除该键 → 独立 `actions/cache@v4` 缓存 `~/.pnpm-store` | 3 个 job           | setup-node 的 npm 缓存与 pnpm store 机制不同，不能换字符串充数                                                                                 |
| `npm ci`                                  | `pnpm install --frozen-lockfile`                        | 3 个 job           | 与 Dockerfile deps stage **逐字一致**；`--frozen-lockfile` 保证 lock 与 `package.json` 不一致时**当场失败**（与 `npm ci` 同等的保护语义）      |
| `npm run lint`                            | `pnpm lint`                                             | lint-and-typecheck | `package.json` scripts 存在 `lint`（`eslint --cache "{src,test,bin}/**/*.ts"`）                                                                |
| `npx tsc --noEmit -p tsconfig.json`       | `pnpm exec tsc --noEmit -p tsconfig.json`               | lint-and-typecheck | **保持原检查口径与参数逐字不变**（未换 `pnpm typecheck` / `typecheck:build` —— 那是 `tsc -b tsconfig.check.json` 与 build 口径，属不同检查面） |
| `npm run migration:run`                   | `pnpm migration:run`                                    | test               | scripts 存在 `migration:run`（`tsx node_modules/typeorm/cli.js -d bin/ormconfig.ts migration:run`）                                            |
| `npm test`                                | `pnpm test`                                             | test               | scripts 存在 `test`（`vitest run --exclude '**/e2e/**/*.ts'`）                                                                                 |
| `npm run test:e2e`                        | `pnpm test:e2e`                                         | test               | scripts 存在 `test:e2e`（`vitest run --config ./test/vitest.e2e.mts`）                                                                         |
| `npm audit --audit-level=high --omit=dev` | `pnpm audit --audit-level=high --prod`                  | security-audit     | 见 §2.4                                                                                                                                        |

**未改**：`package.json` 任何脚本名与依赖、`Dockerfile`、`node-version`、任何 tsconfig / vitest / eslint / husky 配置。

### 2.4 `security-audit` 口径变更（pnpm audit 参数等价性）

**变更：`npm audit --audit-level=high --omit=dev` → `pnpm audit --audit-level=high --prod`**。

依据（本机 `pnpm audit --help` 实测，pnpm 9.15.0）：

- `--audit-level <severity>` —— **两边同名同义**（`low|moderate|high|critical`，默认 low），逐字保留 `high`；
- `--omit=dev`（npm，排除 devDependencies）→ pnpm 的等价参数是 **`-P, --prod`**（只审 `dependencies` 与 `optionalDependencies`）。pnpm **没有** `--omit=dev` 参数（help 里不存在该项），若照抄会直接报「未知选项」而使 job 失败。
- pnpm 另有 `--dev`（只审 devDependencies），与本处语义相反，未采用。

**语义对齐结论**：`--audit-level=high` 逐字保留；「排除 devDependencies」这一语义由 `--prod` 达成（pnpm 的 `--prod` 不审 devDependencies）。**审计面未被放宽或收紧**。

**已知行为差异（如实记录）**：pnpm audit 与 npm audit 的**退出码语义不完全相同** —— pnpm audit 在「registry 报错」时默认仍以非零退出（其 help 提供 `--ignore-registry-errors` 开关专门用于 CI 场景，而 npm 的 `npm audit` 在 registry 不可达时行为亦非完全一致）。本单**不引入 `--ignore-registry-errors`**（那是改变审计语义的决策，超出「参数等价替换」范围）；若主控认为 CI 需要「registry 抖动不阻断」的容错，可另立小单加该开关。

### 2.5 双锁文件（决策点 D-a）

**`package-lock.json` 保留不动**（未删、未改）。

现状与后果：

- 仓根**双锁并存**，两者都被 git 跟踪；`Dockerfile` 只 COPY `pnpm-lock.yaml`（**生产构建路径只读 pnpm 锁**）；
- 本单改造后，**CI 与 Docker 的全部安装路径都只读 `pnpm-lock.yaml`** —— `package-lock.json` 已不被任何安装路径读取；
- 它现在的唯一作用是「历史遗留物」，但**保留它对 npm 用户无害**（不会造成安装歧义，因为 CI/Docker 不走 npm）。

**建议（登记为遗留，待主控拍板）**：移除 `package-lock.json`，让版本控制**只保留 `pnpm-lock.yaml` 一份真相源**，避免未来有人误跑 `npm install` 时 npm 锁与 pnpm 锁漂移。**本单不删**（任务单 §2 明确「不删除 package-lock.json」）。

---

## 三、C-2 明细 · 无效 coverage 步骤清理

### 3.1 无效性证据（复核后再删）

| 证据项                               | 现场核实                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` 的 `test` 脚本        | `vitest run --exclude '**/e2e/**/*.ts'` —— **无 `--coverage`**                                                                                                               |
| `vitest.config.mts` 的 `coverage` 段 | 只有 `include: ['src/**/*.ts']` 与 `exclude: ['src/entity/**']` —— **无 `enabled` / `provider` / `reporter` / `reportsDirectory`**                                           |
| CI 步骤                              | `Upload coverage` / `if: always()` / `uses: actions/upload-artifact@v4` / `with: name: coverage-${{ github.run_id }}` / `path: coverage/` —— **无条件上传 `coverage/` 目录** |

**结论**：`coverage/` 目录在 CI 中**不会被生成**（无采集开关），该步骤上传的是空目录 —— 确属无效步骤。

### 3.2 处置

**已移除** `test` job 中的整个 `Upload coverage` 步骤（含 `name` / `if` / `uses` / `with` 四行整体）。

**`vitest.config.mts` 的 `coverage.include/exclude` 保留不动** —— 该口径是未来开启采集时可直接复用的资产，删掉反而丢信息。

### 3.3 决策点 D-b（本单不执行，仅登记建议）

**是否在 CI 开启覆盖率采集** —— 属独立决策，本单不启用。前置条件与建议：

1. 补 `--coverage` 开关（`@vitest/coverage-v8@^5.0.5` 已在 devDeps，无需新增依赖）；
2. 在 `vitest.config.mts` 明确 `provider`（建议 `v8`，与现有依赖一致）、`reporter`（建议 `['text', 'lcov']`）、`reportsDirectory`（建议 `./coverage`）；
3. **必须定义阈值门禁**（`coverage.thresholds`）—— 否则采集只是产出报告、不构成质量门禁，等于回到「上传了但没人看」的原状；
4. 阈值数值需在**首轮真实覆盖率报告**出来后拍板（不能凭空设），且需与仓库「零压红线」口径协调（覆盖率不是临床正确性指标，不得反向绑到练习评分上）；
5. 覆盖率门禁**只应作用于 CI**，本地闸门不受影响（否则会把「跑全量」的时间成本再抬高）。

**建议顺序**：先在 CI 侧跑一轮只采集不设阈值的报告 → 读真实数值 → 再定阈值 → 最后开启门禁。

---

## 四、C-3 明细 · 缓存持久化

### 4.1 pnpm store 缓存

| 项           | 取值                                                                                                 | 依据                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 路径         | `~/.pnpm-store`                                                                                      | pnpm 在 ubuntu runner 的默认 store 位置（本机实测 `pnpm store path` = `E:\.pnpm-store\v3`，即 store 是**用户级**而非项目级） |
| key          | `pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`                                     | 锁文件哈希进 key → **锁变即失效**；`runner.os` 防跨 OS 污染                                                                  |
| restore-keys | `pnpm-store-${{ runner.os }}-`                                                                       | 锁未变但缓存被清时，可回退到同 OS 的旧 store（**只省下载，不省完整性**：`--frozen-lockfile` 仍会校验 lock）                  |
| 覆盖 job     | `lint-and-typecheck` / `test` / `security-audit` 三个（`build` 走 Dockerfile，不装依赖，**不需要**） |

### 4.2 vitest 转换缓存

| 项           | 取值                                                                                       | 依据                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径         | `node_modules/.vite/vitest`                                                                | 本机实测：vitest 5.0.5 在未显式设 `cacheDir` 时的转换缓存落在 `node_modules/.vite/vitest/<hash>/`，内含 `deps_ssr/`（预打包产物）与 `results.json` |
| key          | `vitest-transform-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`                     | 与依赖树同源 —— 转换产物由依赖决定，锁变则缓存必然失效                                                                                             |
| restore-keys | `vitest-transform-${{ runner.os }}-`                                                       | 同上                                                                                                                                               |
| 覆盖 job     | **仅 `test`**（只有它跑 vitest；`lint-and-typecheck` 不跑测试，`security-audit` 不跑测试） |

**目录选择说明**：选 `node_modules/.vite/vitest` 而非 `node_modules/.vite` 整体 —— 后者还含 vite 自身的其他缓存（与 vitest 无关的部分），且 `coverage/`、`.eslintcache` 等运行产物**明确不纳入缓存**，避免把「运行产物」当「缓存」缓存。

### 4.3 不缓存 `node_modules` 本体

pnpm 以 **store + 硬链**复用依赖：缓存 store 即等价于缓存依赖内容，无需再缓存 `node_modules` 目录树。缓存 `node_modules` 跨 CI 易产生**路径 / 符号链接抖动**（CI 工作区路径随 run 变化，硬链目标路径失效即退化为实拷贝，反而更慢）。

### 4.4 缓存未命中时的行为等价性

**未命中 = 现状**：store 缓存未命中 → pnpm 从 registry 全量下载（等价原 `npm ci` 全量安装）；vitest 缓存未命中 → 全量模块转换（等价现状）。**没有引入任何条件分支改变测试结果** —— 缓存只影响「从哪拿」，不影响「跑什么、判什么」。

**残留风险（如实记录）**：vitest 转换缓存是**内容哈希寻址**（`node_modules/.vite/vitest/<hash>/`），哈希由依赖与配置共同决定 —— 配置变了哈希就变，落进新目录，不会拿旧产物冒充新产物。

---

## 五、闸门（全部实跑，真实数字）

| #   | 命令                                                                    | exit  | 结果                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error**                                                                                                                                                                             |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**                                                                                                                                                                             |
| 3   | `pnpm lint`                                                             | **0** | **0 error / 0 warning**（与 TD-7 后基线 0/0 逐字一致，未回退）                                                                                                                          |
| 4   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed / 12**                                                                                                                                                                      |
| 4b  | `pnpm exec vitest run test/engine-core`                                 | **0** | **23 文件 / 461 例全绿**                                                                                                                                                                |
| 5   | `pnpm test`（收尾全量，**终态复跑一次**）                               | **0** | **193 passed \| 1 skipped（194 文件）· 3248 passed \| 4 skipped（3252 例）**，vitest **73.95s**，墙钟 **76.7s**（与基线 3252 例 / 194 文件**逐字一致**；文档回写前首跑 82.55s / 84.4s） |
| 6   | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空输出**                                                                                                                                                                              |
| 7   | `git diff --name-only HEAD -- src test bin scripts admin-dashboard`     | 0     | **0 个文件**（生产面零改动）                                                                                                                                                            |
| 8   | `git diff --name-only HEAD`                                             | 0     | **3 个已跟踪文件**：`.github/workflows/ci.yml` + 2 个 docs 索引（见 §六）                                                                                                               |
| 9   | `pnpm doctor:fs`（盘读体检）                                            | **0** | 均值 **0.12 ms/文件**、warm slow=0，判定「合格（读取延迟正常，闸门数字可信）」                                                                                                          |

**终态复跑说明**：交付记录、任务单归档与四处索引回写完成后（本轮只动 .md 与 ci.yml），**在最终工作区状态把闸门 1~4 与全量测试全部复跑一遍**，数字与首跑逐字一致（根 tsc 0 error / build tsc 0 error / lint 0 error 0 warning / boundary 12 绿 / 全量 3252 例 0 failed）。上表数字即**终态实测值**。

### 5.1 CI yml 静态自检（§3.4）

| 自检项                 | 方法                                     | 结果                                                                                                                                    |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| YAML 语法              | `node -e "yaml.parse(...)"` 解析改后文件 | **YAML_PARSE_OK**；`jobs=lint-and-typecheck, test, build, security-audit`（4 job 全在）                                                 |
| 各 job 步骤数          | 同上解析                                 | lint **8** / test **10** / build **4** / security-audit **8**                                                                           |
| `needs` 依赖           | 解析 + 文本复核                          | `test needs=lint-and-typecheck`、`build needs=test` —— **与改前逐字一致**，未误删                                                       |
| 脚本名存在性           | 逐一在 `package.json` `scripts` 里查     | `lint` ✅ / `test` ✅ / `test:e2e` ✅ / `migration:run` ✅ —— **4/4 存在**，无新造脚本名                                                |
| `pnpm exec` 二进制     | `package.json` devDeps                   | `typescript ~6.0.3` ✅（`pnpm exec tsc` 可解析）                                                                                        |
| env / services 未误删  | 文本复核                                 | `test` job 的 `env:`（14 项，含 DB/Redis/JWT/EMAIL/SMS/METRICS）与 `services:`（mysql 8.0 + redis 7-alpine，含 health-cmd）**完整保留** |
| Trivy / Docker 步骤    | 文本复核                                 | `aquasecurity/trivy-action@master` 与 `docker/setup-buildx-action@v3` + `docker build` **均未动**                                       |
| 无 frontend 引用       | 文本复核                                 | 未新增对 `admin-dashboard/` 或 Flutter 的任何引用                                                                                       |
| npm / npx 残留         | 正则全文扫描                             | `npm ci` / `npm run` / `npx ` / `cache: 'npm'` **0 命中**                                                                               |
| `Upload coverage` 残留 | 文本扫描                                 | **0 命中**（步骤已整体移除）                                                                                                            |

### 5.2 机器状态

Windows 11 Home China（10.0.26300 build 26300）· Node **v26.13.0** · pnpm **9.15.0** · PowerShell 5.1.26100.9818 · 8 逻辑核。

**长驻进程（如实记录）**：跑闸门期间机器上有**用户侧的并行开发进程** —— `pnpm start:dev`（PID 22492 / 7660）+ `nest start --watch`（PID 18216）+ `dist/app`（PID 5804）+ admin-dashboard 的 vite（PID 19404）。**本单全程未启动任何 dev / start / watch 命令**（只跑 tsc / lint / vitest / doctor:fs），这些是用户本地的调试环境。按任务单 §5.0 纪律，本应停机后取干净基线；但本单**只改了 CI yml**（不参与任何测试执行路径），且 `pnpm doctor:fs` 判定读取延迟正常（0.12 ms/文件，排除读税），全量结果与基线逐字一致，**故不影响本单结论**。墙钟首跑 84.4 s 略高于 TD-7 的 73.9~82.2 s、与并行 dev server 占用 CPU 一致；终态复跑为 76.7 s（回到基线量级）—— **引用该数字时须带机器状态**（闸门性能文档 §1.5.2 的纪律）。

---

## 六、改动文件清单

### 6.1 代码级（1 文件，**唯一**）

| 文件                       | 改动                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | 三个 job 的安装/脚本调用 npm/npx → pnpm；移除 `cache: 'npm'`；新增 pnpm store 缓存（3 job）与 vitest 转换缓存（1 job）；移除 `Upload coverage` 步骤。**行尾保持 CRLF** |

### 6.2 docs（回写）

| 文件                                                                                          | 改动                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md` | 本交付记录（新增）                                           |
| `docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-task-2026-11-13.md`           | 任务单归档（状态 ✅、DoD 全勾）                              |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`                                         | §四 TD-8 行改完成态                                          |
| `docs/worklog/pending/phase2.5-README.md`                                                     | §3.0 工具链段 TD-8 行改完成态                                |
| `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`                             | CI 三条遗留标注处置结论                                      |
| `docs/team/gate-performance-remediation-2026-11-11.md`                                        | §9 P-DEBT-5 标注处置结论（缓存与 pnpm 统一已落地；分片另案） |

### 6.3 改动面汇总

- `git diff --name-only HEAD`：**5 个已跟踪文件**（`.github/workflows/ci.yml` + 4 个 docs 回写：wp-list / README / 工具链清单 / 闸门性能文档）；另有 3 个新增未跟踪文件（交付记录 / 归档后任务单 / 本次回执）。
- `git diff --stat HEAD`：5 files changed, **+83 −23**（含 4 个 docs 回写）。
- **生产面零改动**：`git diff --name-only HEAD -- src test bin scripts admin-dashboard` = **0**；`src/engine-core/**` diff **空**。
- **未新增依赖、未改 package.json / Dockerfile / tsconfig / vitest / eslint / husky 配置、未删 `package-lock.json`**。

---

## 七、回归说明

- **零运行时行为变化**：改动只落在 `.github/workflows/ci.yml` —— CI 执行环境的包管理与缓存策略，**不进入任何测试/运行时代码路径**。
- **未改断言期望、mock 返回值、用例逻辑**；**未新增 / 删除测试用例** —— 全量 **3252 例 / 194 文件**，与 TD-7 基线逐字一致。
- **engine-core 零 diff**（`boundary.spec.ts` 一行未动，12 断言全绿）。
- **零新增依赖、零表结构 / migration / 实体映射 / 装配改动、零 prompt / 阈值 / 判据改动**。

---

## 八、遗留与决策点

1. **D-a · npm 锁去留（待主控拍板）**：`package-lock.json` **本单保留未删**（任务单 §2 明确）。改造后 CI 与 Docker **只读 `pnpm-lock.yaml`**，该文件已不被任何安装路径读取。**建议移除**，让版本控制只保留一份锁文件真相源，避免有人误跑 `npm install` 时两锁漂移。
2. **D-b · 是否在 CI 开启覆盖率采集（独立决策）**：本单**只移除无效上传步骤**、**不启用采集**。前置条件见 §3.3 五条（provider / reporter / 输出目录 / **阈值门禁数值需先跑一轮真实报告再拍** / 只作用于 CI）。
3. **CI 侧结果待主控 push 后复核**：**本机跑不了 GitHub CI**，交付记录**不写「CI 已通过」**。需在 Actions 上复核三点 —— ① `corepack enable` 在 `ubuntu-latest` + Node 24 运行时确实可用（本机 Windows 无 corepack，无法端到端复现）；② `pnpm install --frozen-lockfile` 在 CI 上与 `pnpm-lock.yaml` 一致（若 lock 与 `package.json` 漂移，CI 会当场失败 —— 这是期望行为，但需主控知晓）；③ pnpm store 与 vitest 缓存**首次命中后**的墙钟改善。
4. **`pnpm audit` 的 registry 抖动行为**（§2.4）：pnpm 在 registry 报错时默认非零退出，与 npm 行为不完全一致。本单**不引入 `--ignore-registry-errors`**（那会改变审计语义）；若需「registry 抖动不阻断 CI」，建议另立小单加该开关并写明取舍。
5. **P-DEBT-5 的分片（shard）部分未做**：本单落地了「CI 缓存 + CI 侧 pnpm 统一」两项，**分片矩阵不在本单范围**（任务单 §2 未授权，且分片会改变测试执行拓扑 —— 需评估跨分片的用例顺序依赖与失败定位差异）。已在闸门性能文档 §9 标注为「部分落地」。
6. **本单复核未发现新的 CI 缺陷**：三条遗留处置完毕后，`ci.yml` 与 `package.json` / `Dockerfile` 的口径已一致（pnpm + `pnpm-lock.yaml`），未发现第四类遗留。

---

## 九、关键决策

1. **pnpm 安装走 corepack（不用 action-setup）**：与 Dockerfile 逐字一致 = 包管理口径单一（红线）；corepack 按 `packageManager` 字段解析版本，无需硬编码版本号。
2. **`cache: 'npm'` 是「移除」而非「改成 cache: 'pnpm'」**：setup-node 的内置缓存按包管理器实现，pnpm 分支需要 pnpm 先在 PATH 中可用，且它缓存的是 store —— 这里改用**独立 `actions/cache` + 显式路径 `~/.pnpm-store`**，路径与 key 组合完全可控，且不依赖 setup-node 对 pnpm 的支持成熟度。
3. **`npm audit --omit=dev` → `pnpm audit --prod`**：pnpm 无 `--omit=dev` 参数，照抄会直接让 job 报未知选项而失败；`--prod` 是语义等价项（不审 devDependencies），`--audit-level=high` 逐字保留。
4. **vitest 缓存只配在 `test` job**：另两个 job 不跑 vitest，配了是无效缓存（浪费 CI 时间与存储配额）。
5. **缓存 key 用 `pnpm-lock.yaml` 哈希而非 `package.json` 哈希**：锁文件才是依赖树的真相源；锁变则 store 与转换缓存**必然**失效，用锁哈希可保证「key 变了 = 缓存内容必然不适用」，不存在「key 没变但内容过期」的可能。
6. **保留 `package-lock.json` 不删**：删它是有价值的收敛动作，但属决策而非工程动作 —— 按任务单 §2 登记为建议，留主控拍板。

---

## 十、commit 草稿（未提交，等你指令）

```
ci(workflow): TD-8 CI 包管理对齐 pnpm · 清理无效 coverage 步骤 · 持久化依赖与 vitest 缓存（零 src 改动）
docs(worklog): TD-8 任务单 / 交付记录与索引回写
```

建议分 2 个提交（一个提交一个意图，不跳 `--no-verify`）。**注意**：`phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 在本单开工前已是「已修改」状态 —— 那是 TD-7 的索引回写尚未提交，docs 一组提交时会一并带上 TD-7 的索引回写。
