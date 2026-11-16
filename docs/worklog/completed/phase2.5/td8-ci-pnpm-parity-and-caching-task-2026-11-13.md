# TD-8 · CI 工具链遗留三条整改（npm/pnpm 对齐 · 无效 coverage 步骤清理 · CI 缓存持久化 · 零 src 改动）

> 状态：✅ **已交付**（2026-11-13，MiniMax Code）→ [交付记录](td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md)
> 执行方：MiniMax Code（主控派单 · 纯 CI 配置与文档回写，范围小、边界清晰）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：[工程工具链技术债清单](../../pending/phase2.5-toolchain-tech-debt-2026-11-11.md) + [闸门性能 remediation](../../../team/gate-performance-remediation-2026-11-11.md) §9 P-DEBT 登记 + 主控 2026-11-13 HEAD `a02198f` 现场复核（扫描备查 `data/quality/td8-*.txt`，gitignore 不入库）
> 任务性质：既有工具链债清理（CI 配置对齐 + 无效步骤清理 + 缓存持久化），**零运行时行为变化、零生产代码改动**；改动仅落在 `.github/workflows/ci.yml` 与 docs 索引回写。
> 上一单：[TD-7 交付记录](td7-contract-drift-remediation-implementation-2026-11-13.md)（契约漂移残留已闭环，lint 0/0）。
> 收尾结论：C-1 / C-2 / C-3 **三条全部处置完毕**，**代码级唯一改动 `.github/workflows/ci.yml`**、`src` / `test` / `bin` / `scripts` / `admin-dashboard` 零改动、engine-core 零 diff，全量 3252 例与基线逐字一致 → [交付记录](td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md)

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式（§命令边界：`packageManager=pnpm`，禁止裸 npx）
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\wp-task-template.md` —— 任务单结构与交付回写清单
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 工程工具链技术债 与 `phase2.5-wp-list-2026-11-08.md` §四 TD-8 行
5. CI 现状：`.github/workflows/ci.yml`（本单唯一代码级改动文件）；`package.json`（scripts / `packageManager` / devDeps）；`Dockerfile`（生产构建 pnpm 口径参照）；`vitest.config.mts`（coverage / 缓存现状）
6. 本任务单（你在读的这份）

---

## 1. 背景（方向别错）

### 1.1 来源

WP-M 治本修复（husky / scripts lint / commitlint 选型 / 指纹口径）已全部闭环（见工具链清单 §2）。2026-11-13 主控全量技术债盘点后，复核出 **3 条仍未处理的 CI 侧工具链遗留**（登记于闸门性能文档 §9 与既往盘点）；其余 core 结构债、Phase3 台账、Phase4 阻塞项均卡在批次样本 / 人工拍板 / 外部资质 / core 红线例外，**不在本单范围**（§2 已逐条列明排除理由）。

### 1.2 主控现场复核结论（2026-11-13，HEAD `a02198f`；行号以现场 Grep 为准，可能漂移）

| #   | 遗留项                                              | 现状（已核实）                                                                                                                                                                                                                                                                                                                                                                                                        | 处置归类                                                                                            | 边界归属             |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| C-1 | CI 包管理用 npm，与本地 / Dockerfile 的 pnpm 不一致 | `ci.yml` 三个安装/脚本 job 全用 `npm ci`、`npm run lint/test/migration:run/test:e2e`、`npx tsc --noEmit -p tsconfig.json`、`cache: 'npm'`；仓 `packageManager=pnpm@9.15.0`、`engineStrict: true`；`Dockerfile` 用 corepack + `pnpm install --frozen-lockfile` + `pnpm-lock.yaml`；根目录**双锁并存**（`package-lock.json` 659 714 B 与 `pnpm-lock.yaml` 416 855 B，均被 git 跟踪；Dockerfile 只 COPY pnpm-lock.yaml） | CI 安装与脚本映射改 pnpm，缓存改 pnpm store；双锁文件去留列为决策点（默认不删）                     | CI yml；**非 src**   |
| C-2 | coverage 上传步骤无效（空目录上传）                 | `package.json` 的 `test` 脚本 = `vitest run --exclude '**/e2e/**/*.ts'`，**无 `--coverage`**；`vitest.config.mts` 仅配 `coverage.include/exclude`，无 `enabled / provider / reporter / reportsDirectory`；CI `Upload coverage` 步骤无条件上传 `coverage/` 目录，实际不会生成 → 上传空目录                                                                                                                             | **默认方案**：移除无效的 Upload coverage 步骤；是否开启覆盖率采集为决策点，本单不启用               | CI yml；不改测试配置 |
| C-3 | CI 未持久化依赖与 vitest 转换缓存                   | 仅 `actions/setup-node` 的 `cache: 'npm'`；无 pnpm store / vitest transform 缓存步骤；每次 CI 全量重装依赖 + 全量模块转换                                                                                                                                                                                                                                                                                             | 增加 pnpm store 缓存（key 含 lockfile 哈希）；vitest 转换缓存目录一并缓存；不缓存 node_modules 本体 | CI yml；不改测试配置 |

### 1.3 改动面预判（执行时以实际 diff 为准）

- **生产 `src/`：0 改动**；`src/engine-core/**` diff 为空；`test/`、`bin/`、`scripts/` 0 改动。
- **代码级唯一改动**：`.github/workflows/ci.yml`。
- **docs**：交付记录、任务单归档、wp-list §四 与 README §3.0 索引回写；工具链清单 / 闸门性能文档对应遗留项状态回写。
- 不改 `package.json` 脚本与依赖、不改 `Dockerfile`、不改 tsconfig / vitest / eslint 配置。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- C-1：`.github/workflows/ci.yml` 的依赖安装与脚本调用从 npm/npx 改为 pnpm，安装锁文件口径与 `Dockerfile` 一致（`pnpm install --frozen-lockfile`）；缓存类型由 npm 改 pnpm。
- C-2：移除无效的 `Upload coverage` 步骤（默认方案）；保留 `vitest.config.mts` 既有 include/exclude 配置不动。
- C-3：为 CI 增加 pnpm store 持久化缓存；vitest 转换缓存目录纳入缓存（目录位置以 vitest 5.0.5 默认行为为准，配置未显式设 `cacheDir`）。
- docs 回写：交付记录、任务单归档、wp-list §四 与 README §3.0；工具链清单 / 闸门性能文档对应遗留项标注处置结论。

**明确不在范围内（禁止顺手做）：**

- **core 结构债一律不碰**：`src/engine-core/**` diff 必须为空；`test/engine-core/` 与 `boundary.spec.ts` 一行不许动。I-01~I-24 各项的批次复验、幅度标定、结构改造、门槛/阈值拍板均不在本单。
- **Phase3 台账不碰**：L-2~L-6 / P1-N1/N2（待批次样本）、P1-N3~N7（待拍板）、L-7 / L-8 / L-9（下一阶段 P2/P3，L-9 含实体列与 migration）均不在本单。
- **Phase4 五条不碰**：WP27 / WP29 / WP33 / WP39 / WP40 卡外部商户号 / 档位定稿 / 留存年限 / 真机校准，与本单无关。
- **P-DEBT-1 不碰**：spec 间 `process.env` 泄漏清理已被证伪（`isolate:false` 更慢且 27 例跨文件污染，见闸门性能文档 §1.5.3，降 P2 搁置）；不改 `vitest.fast.config.mts`、不动 `test.isolate`、不追求 `test:fast` 提速。
- **覆盖率采集与阈值门禁不启用**：本单只清理无效上传步骤；不新增 coverage provider / reporter / 输出目录配置，不加覆盖率阈值，不改 `test` 脚本。
- **不改包管理决策**：不删除 `package-lock.json`（决策点 D-a，默认保留文件，仅在交付记录登记建议移除，待主控拍板）；不调整 `engines.node`、CI `node-version` 或 `.nvmrc`（版本口径属独立事项，既往 §248 明确不在提速方案处理）。
- **不改 `package.json` 脚本、依赖、`Dockerfile`、任何 tsconfig / vitest / eslint / husky 配置**；不新增第三方 GitHub Action 依赖版本之外的工具链（pnpm 安装优先 corepack，与 Dockerfile 一致）。
- 不改 e2e 之外的测试逻辑、断言、mock、用例数量；不跑 e2e（依赖 DB / Qdrant，不在默认全量内）。
- 提交分组隔离：工作区若有并行进程未提交产物，只暂存本单文件，不混入并行产物。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 3. 逐项处置（先复核定性，再最小改动）

> 通用纪律：每项动手前先读 `ci.yml` 对应 job 与 `package.json` scripts 现状；CI 运行于 GitHub ubuntu，本机无法复跑 CI，闸门以本地 pnpm 对应脚本全绿 + yml 静态自检为准，不得声称"CI 已通过"。

### 3.1 C-1 · CI 包管理 npm → pnpm 对齐

**复核点（动手前先核）**：

1. `package.json` `packageManager` 字段（`pnpm@9.15.0`）与 devDeps 实际锁；`Dockerfile` 的 corepack / pnpm 安装口径。
2. `ci.yml` 四个 job（`lint-and-typecheck` / `test` / `security-audit`；`build` job 走 Dockerfile，不直接装 npm 依赖）当前的 `npm ci`、`npm run <script>`、`npx tsc`、`cache: 'npm'` 位置逐条列出。

**处置**：

1. **pnpm 安装方式（决策点 D-c，默认方案）**：优先 `corepack enable`（Node 24 runner 自带 corepack，与 `Dockerfile` 口径一致）；若 corepack 在该 runner 版本不可用，备选 `pnpm/action-setup@v4` 固定版本 `9.15.0`（与 `packageManager` 逐字一致）。二选一，在交付记录写明选用哪种及理由。
2. **依赖安装**：`npm ci` → `pnpm install --frozen-lockfile`（与 Dockerfile 一致；锁文件口径 = `pnpm-lock.yaml`）。
3. **脚本映射**（脚本名必须逐字对应 `package.json` scripts，不新造脚本）：
   - `npm run lint` → `pnpm lint`
   - `npm test`（unit）→ `pnpm test`
   - `npm run test:e2e` → `pnpm test:e2e`
   - `npm run migration:run` → `pnpm migration:run`
   - `npm run typecheck` 类：现状为 `npx tsc --noEmit -p tsconfig.json` → 改为 `pnpm exec tsc --noEmit -p tsconfig.json`（**保持原检查口径与参数**，不擅自换成 `pnpm typecheck` / `typecheck:build`）。
4. **缓存**：`actions/setup-node` 的 `cache: 'npm'` → pnpm 口径（`cache: 'pnpm'`，需 pnpm 已在 PATH；或独立 `actions/cache` 缓存 pnpm store，路径与 key 按所选安装方式确定）。
5. **`security-audit` job**：现状 `npm audit --omit=dev`。改为 pnpm 对应审计口径（`pnpm audit --prod` 或与现状 `--omit=dev` 等价的 pnpm 参数）；若 pnpm audit 无等价参数或行为差异无法对齐，**保留该 job 现状并在交付记录写明**，不在本单改动审计语义。
6. **双锁文件（决策点 D-a，默认不删）**：`package-lock.json` 保留在版本控制中不动；交付记录 §遗留写明"双锁并存，建议主控拍板移除 npm 锁，仅保留 pnpm-lock.yaml"及理由。CI 与 Dockerfile 统一走 pnpm 后，npm 锁不再被任何安装路径读取。

**不改** `package.json` 任何脚本名；不改 `Dockerfile`；不调整 `node-version`。

### 3.2 C-2 · 清理无效 coverage 上传步骤

**复核点（先读证据）**：

1. `package.json` `test` 脚本是否带 `--coverage`（现状不带）；`vitest.config.mts` `coverage` 段是否含 `enabled / provider / reporter`（现状仅 include/exclude）。
2. `ci.yml` `test` job 的 `Upload coverage` 步骤（`actions/upload-artifact@v4`，`path: coverage/`，`if: always()`）。

**处置（默认方案：移除步骤）**：

1. 删除 `test` job 中无效的 Upload coverage 步骤（含其 `name / if / uses / with` 四行整体）。
2. `vitest.config.mts` 的 `coverage.include/exclude` **保留不动**（后续若开启采集，该口径可复用）。
3. **决策点 D-b（本单不执行，仅登记建议）**：是否在 CI 开启覆盖率采集——需补 coverage provider（`@vitest/coverage-v8` 已在 devDeps）、reporter、输出目录与采集步骤，并定义阈值门禁；属独立决策，交付记录列建议项与前置条件。
4. 若复核发现 `coverage/` 目录实际由某脚本生成（与上述现状不符），停手登记 backlog，不删除步骤。

### 3.3 C-3 · CI 依赖与转换缓存持久化

**复核点**：vitest 5.0.5 默认转换缓存位置（配置未显式设 `cacheDir`）；pnpm store 在 ubuntu runner 的默认路径。

**处置**：

1. **pnpm store 缓存**：按 C-1 所选安装方式配缓存，cache key 含 `pnpm-lock.yaml` 哈希（锁变即失效）；恢复路径指向 pnpm store。
2. **vitest 转换缓存**：将 vitest 默认转换缓存目录纳入 `actions/cache`（或 setup-node 缓存覆盖范围）；key 同样含 lockfile / 依赖哈希；缓存目录与 `coverage/`、`node_modules/.cache` 等区分清楚，不把运行产物当缓存。
3. **不缓存 `node_modules` 本体**：pnpm 以 store + 硬链复用，缓存 store 即可；缓存 node_modules 跨 CI 易产生路径 / 符号链接抖动。
4. 缓存未命中时 CI 行为必须与现状等价（全量重装 + 全量转换），不引入条件分支改变测试结果。

### 3.4 静态自检（CI yml，本机可做）

1. 通读改后 `ci.yml`：每个 `run:` 调用的脚本名在 `package.json` `scripts` 中存在；`pnpm exec` 二进制调用合法；缩进 / 键名 / `with:` 映射无 YAML 语法错误。
2. 核对四个 job 的 `needs` 依赖、env 段、service（mysql / redis）配置未被误删。
3. 核对未新增对 `admin-dashboard/` 或 Flutter 的引用。

---

## 4. 红线（违反即返工）

1. **零生产改动**：diff 只允许 CI yml 与 docs 回写；`src/`、`test/`、`bin/`、`scripts/`、`admin-dashboard/` 零改动；mock / 断言 / 用例数量前后一致。
2. **engine-core 边界**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 禁止动。
3. **配置不放宽**：不改 tsconfig / vitest / eslint / husky / package.json / Dockerfile；不删断言、不注释报错行消错；不启用覆盖率采集与阈值。
4. **包管理口径单一**：CI 与 Dockerfile 统一 pnpm；不引入第二个包管理器安装路径；不擅自删 npm 锁文件。
5. **命令规范**：本地复核一律 pnpm，禁止裸 npx；跑闸门前确认无 `nest start --watch` / `vite dev` 长驻进程；Windows 本机 git 在 `D:\Apps\Git\cmd`，依赖 git 的 spec 先补 PATH。
6. **既有债与新增分开**：交付记录写清本单改动文件清单；其余工具链 / core / Phase3 / Phase4 遗留不混入本单；复核中若发现新的 CI 缺陷，另开 backlog 登记。
7. **事实纪律**：本机跑不了 GitHub CI，交付记录不得写"CI 已通过"；CI 侧结果留待主控 push 后在 Actions 复核。

---

## 5. 闸门（真实命令 / exit code / 数字写进交付记录）

| #   | 命令                                                                    | 通过标准                                                                                                    |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0 error、exit 0**（TD-7 后基线 0，本单不得回退）                                                          |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 保持 0 error（生产口径不退化）                                                                              |
| 3   | `pnpm lint`                                                             | 0 error / 0 warning（TD-7 后基线 0/0，本单不得回退）                                                        |
| 4   | `pnpm exec vitest run test/engine-core`                                 | boundary 12 例全绿（本单无 src 改动，作形式核对）                                                           |
| 5   | 收尾 `pnpm test` 一次（仅交付前；`pnpm test:fast` 冒烟不作证据）        | 0 failed；记录测试文件数 / 用例数 / skipped / 墙钟与机器状态（Node 版本、长驻进程、盘读取状态），数字可复现 |
| 6   | `git diff --stat HEAD -- src/engine-core`                               | 为空                                                                                                        |
| 7   | `git diff --name-only HEAD`                                             | 逐条对照 §2 范围：仅 `.github/workflows/ci.yml` + docs 回写；无 src/test/bin/scripts 文件、无并行产物       |
| 8   | CI yml 静态自检（§3.4）                                                 | 脚本名均可在 package.json 找到；YAML 键 / 缩进合法；job 依赖与 env/service 未误删                           |

既有基准（HEAD `a02198f`，TD-7 回执口径）：根 tsc 0 error、build tsc 0 error、lint 0 error / 0 warning、boundary 12 绿；全量 **3248 passed + 4 skipped（3252 例，194 文件）**。本单不改测试与用例数量。

---

## 6. 交付物与固定路径

1. 交付记录：`docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md`，含：
   - C-1：选用的 pnpm 安装方式（corepack / action-setup）、逐条 npm→pnpm 映射表、缓存类型变更；双锁文件现状与 D-a 建议；
   - C-2：被移除的 coverage 步骤原文、证据（test 脚本无 --coverage、config 无 provider/reporter）；D-b 开启采集的前置条件建议；
   - C-3：pnpm store 与 vitest 转换缓存的路径、key 构成、未缓存 node_modules 的理由；
   - 改动文件清单（区分新增 / 修改 / 删除）；
   - 闸门表：实际命令、exit code、error / warning 数、测试文件 / 用例数、墙钟与机器状态；
   - 回归说明：未改测试逻辑 / 断言 / mock，全量结果与基准一致；CI 未在本机复跑的事实声明；
   - 遗留项：D-a npm 锁去留、D-b 覆盖率采集决策、CI Actions 结果待主控 push 后复核。
2. 任务单归档：验收通过后本单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链接交付记录。
3. 索引回写：
   - `phase2.5-wp-list-2026-11-08.md` §四 TD-8 行（待开工 → 完成态 + 交付记录链接，3 列形态）；
   - `phase2.5-README.md` §3.0 工具链段同步完成态；
   - 工具链清单 `phase2.5-toolchain-tech-debt-2026-11-11.md` 与闸门性能文档 §9：三条 CI 遗留标注处置结论与遗留决策点。
4. commit 草稿（一个提交一个意图；不跳过 `--no-verify`）：
   - `ci(workflow): TD-8 CI 包管理对齐 pnpm · 清理无效 coverage 步骤 · 持久化依赖与 vitest 缓存（零 src 改动）`
   - `docs(worklog): TD-8 任务单 / 交付记录与索引回写`

---

## 7. DoD 核对清单

- [x] C-1：CI yml 安装与脚本调用全部走 pnpm，锁文件口径对齐 Dockerfile；脚本名与 package.json 逐字对应；缓存类型改 pnpm；`security-audit` 口径变更或保留理由已写明
- [x] C-2：无效 Upload coverage 步骤已移除；vitest.config coverage 段未改；D-b 采集决策已登记为建议项
- [x] C-3：pnpm store 缓存（key 含 lockfile 哈希）+ vitest 转换缓存已配；未缓存 node_modules 本体；未命中时行为与现状等价
- [x] 根 tsc 0 error；build tsc 0 error；lint 0/0；boundary 12 绿；`pnpm test` 全绿；engine-core diff 为空
- [x] `git diff --name-only HEAD` 仅含 §2 范围文件；生产 src / test / bin / scripts 零改动；无并行产物混入
- [x] 未新增 / 删除测试用例；未改断言期望与 mock 语义；全量用例数与基准一致（3252 例 / 194 文件）
- [x] 交付记录、任务单归档、wp-list / README / 工具链清单索引一致，无断链；决策点 D-a / D-b / D-c 选择与遗留已写明

---

## 附录 A · 锚点清单（主控扫描备查，行号现场复核）

| #    | 锚点                                                                                                                                                                                 | 说明                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| C-1  | `.github/workflows/ci.yml`（lint-and-typecheck / test / security-audit 三 job；build job 走 Dockerfile）；`package.json` `packageManager` / scripts；`Dockerfile` deps / build stage | npm→pnpm 映射与缓存口径 |
| C-2  | `ci.yml` test job `Upload coverage` 步骤；`package.json` `test` 脚本；`vitest.config.mts` `coverage` 段                                                                              | 无效步骤证据            |
| C-3  | vitest 5.0.5 默认转换缓存目录；pnpm store 默认路径（ubuntu runner）                                                                                                                  | 缓存路径与 key          |
| 排除 | `src/engine-core/**`；`test/engine-adapters/**`；Phase3 台账 `phase3-disfluency-backlog-2026-11-13.md`；Phase4 `phase4-backlog-2026-11-08.md`；`vitest.fast.config.mts`              | §2 排除项，本单不碰     |

## 附录 B · 既有基准数字（HEAD `a02198f`）

- 根 tsc：0 error；build tsc：0 error；lint：0 error / 0 warning；boundary：12 绿；全量：3248 passed + 4 skipped（3252 例，194 文件）。
- 闸门命令与复跑方式见 §5；机器状态（Node 版本、长驻进程、盘读取）须在交付记录闸门表注明。
