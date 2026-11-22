# TD-11 · CI 工具链收尾 + typeorm 类型导入收窄 交付记录

| 项               | 值                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单           | `docs/worklog/pending/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md`（交付后归档至 `docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md`） |
| 事实源           | `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-5 / P-DEBT-6 遗留段 + TD-8 交付记录 §3.3 / §遗留 + TD-10 交付记录 §七 L-1                                                     |
| 基线 HEAD        | `1696e59`（分支 `integrate`）                                                                                                                                                                  |
| 执行             | MiniMax Code，2026-11-14                                                                                                                                                                       |
| 闸门             | 全绿；用例数与基线逐字一致（3248 passed + 4 skipped / 3252 例 / 194 文件）                                                                                                                     |
| engine-core diff | **空**                                                                                                                                                                                         |
| 生产 `src/` 改动 | **仅 48 个文件的类型导入形态**，无运行时装配变化                                                                                                                                               |

---

## 一、本单做了什么

一次性收尾五项遗留工具链 / 类型层债：T-A 删 npm 锁实现**锁文件单轨**（并把被删锁打断的 4 处 `npm ci` 活路径改口为 pnpm）；T-B 把附录 A 的 **48 个** service / controller 的 `Repository` 值导入改成 `import type`；T-C 给 CI audit 加 `--ignore-registry-errors`（registry 故障放行、真实 high+ 漏洞仍阻断）；T-D 接通 coverage 采集（v8 + text/lcov，CI 采集、本地不插桩、**不设阈值**）；T-E 落地 CI **2 片 matrix**（`--shard`，仅 unit，e2e 不进矩阵）。业务行为、测试期望、用例数、mock 语义、隔离语义逐字未变。

---

## 二、方案设计：实际实现 vs 任务单方案（偏差登记，conventions §2.5）

| 编号 | 任务单原方案                                                              | 实际方案                                                                                          | 理由                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1  | T-A 改动范围只列 `scripts/deploy-tested.cjs` / `README.md` / runbook 标注 | **额外改** `bin/dev-up.ps1` / `bin/check-dev-env.sh` / `docs/runbooks/local-setup.md` 的 `npm ci` | 删掉 `package-lock.json` 后这 3 个文件里的 `npm ci` 会**当场失败**（npm ci 必须有 npm 锁），README 快速开始同理；已就此向主控发问卷并获拍板「**一并改口为 pnpm**」，本单按拍板执行                                                                                                                                                                     |
| D-2  | T-A 第 3 条：「同步 README.md 部署命令段 scp 清单」                       | README **两段快速开始 + 生产部署段**的 npm 命令一并改口 pnpm                                      | 同一代码块内混用 npm / pnpm 口径不一致、易被照抄；改的全是 `npm run <script>` / `npm ci` 这类**同口径命令**，不涉及任何行为变更                                                                                                                                                                                                                        |
| D-3  | T-B 第 2 条：「若发现值位置使用则保持原样并登记」                         | 48 个文件**全部**通过复核，**0 个保留原样**                                                       | 逐文件扫描全部 `Repository` 出现点：全部是泛型类型标注（`Repository<X>`），无 `Repository.<静态>` / `instanceof` / `new` / 值传递                                                                                                                                                                                                                      |
| D-4  | T-B 只处理附录 A 的 48 个文件                                             | **保持 48 个不动**，另登记附录 A 之外的 23 个混合形态文件                                         | 附录 A 之外的 23 个文件是 `import { Between, Repository } from 'typeorm'` 这类**混合形态**（`Between` / `IsNull` / `In` 是运行时值符号）→ typeorm 模块仍被值导入求值，改成 inline `type Repository` **零运行时收益**；另有 10 个文件已用 inline `type` 形态。附录 A 的 48 个恰是「typeorm 是该文件唯一符号」的子集 = 能彻底摘掉 typeorm 运行时边的全集 |
| D-5  | T-D 第 2 条：「CI 加 `--coverage`」或「新增 `test:coverage` 脚本」二选一  | **不新增脚本**，CI 用 `pnpm run test -- --coverage`                                               | §2 改动范围不含 `package.json`；且本地实测 `pnpm test -- --coverage` 会失败（见 D-7），必须走 `pnpm run` 形态                                                                                                                                                                                                                                          |
| D-6  | T-D 第 2 条：CI 接通采集                                                  | 采集放在**独立的 `coverage` job**（单进程全量跑 unit），不在 unit 分片里采                        | `--shard` 切的是「哪些 spec 归本片跑」，每片覆盖率只反映本片 —— **分片报告不是全量口径**；而阈值门禁（另案）必须建立在完整报告上。代价：CI 多 1 个 job run（+1 次全量 unit），已写进 §七供主控评估                                                                                                                                                     |
| D-7  | 任务单未提 pnpm 传参形态                                                  | CI 一律用 `pnpm run <script> -- <args>`                                                           | 实测 pnpm 的**简写** `pnpm <script> -- <args>` 会把 `--shard` / `--coverage` 当成 pnpm 自己的未知选项直接报错（`ERROR Unknown option: 'shard'`），只有 `pnpm run test -- --shard=1/2` 才透传。该结论已写进 CI 注释，避免后人踩坑                                                                                                                       |
| D-8  | 任务单未规定 YAML 写法                                                    | unit / e2e / coverage 三个 job **各自完整复制** services + env + 安装步骤，不用 YAML anchors      | GitHub Actions 的 anchors 虽已 GA，但本仓 CI 是关键路径且只能在主控 push 后于 Actions 复核 —— 不引入依赖新特性的写法；显式重复的代价是 yml 从 226 行涨到 422 行                                                                                                                                                                                        |

---

## 三、改动文件清单

### 3.1 删除（1 个）

- `package-lock.json`（659 714 B / 18 516 行）—— 版本控制只保留 `pnpm-lock.yaml` 一份锁文件真相源。**已核实无任何安装路径读它**：`Dockerfile` / `Dockerfile.prod` 都只 `COPY package.json pnpm-lock.yaml ./` + `pnpm install --frozen-lockfile`，CI 三个 job 走 `pnpm install --frozen-lockfile`。

### 3.2 修改（60 个文件，+294 / −84 行；不含被删的 npm 锁）

| 文件                                                                                                                                                                                                                        | 用途                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/**`（**48 个**）                                                                                                                                                                                                       | T-B：`import { Repository } from 'typeorm'` → `import type { Repository } from 'typeorm'`（逐文件一句用途见 §五 复核表）                 |
| `.github/workflows/ci.yml`                                                                                                                                                                                                  | T-C audit 加容错 flag；T-D 新增 `coverage` job；T-E 原 `test` job 拆成 `unit`（matrix 2 片）+ `e2e`，`build` 的 `needs` 改 `[unit, e2e]` |
| `vitest.config.mts`                                                                                                                                                                                                         | T-D：`coverage` 段补 `provider: 'v8'` / `reporter: ['text','lcov']` / `reportsDirectory: './coverage'`（include / exclude 沿用既有口径） |
| `scripts/deploy-tested.cjs`                                                                                                                                                                                                 | T-A：上传清单 `package-lock.json` → `pnpm-lock.yaml`；文件头注释（scp 清单 / npm ci / npm run 口径）改 pnpm                              |
| `README.md`                                                                                                                                                                                                                 | T-A：scp 清单 → `pnpm-lock.yaml`；两段快速开始 + 生产部署段 npm 命令 → pnpm                                                              |
| `bin/dev-up.ps1`                                                                                                                                                                                                            | T-A：`npm ci` → `pnpm install --frozen-lockfile`（含提示与错误文案）                                                                     |
| `bin/check-dev-env.sh`                                                                                                                                                                                                      | T-A：修复提示 `npm ci` → `pnpm install --frozen-lockfile`                                                                                |
| `docs/runbooks/local-setup.md`                                                                                                                                                                                              | T-A：3 处 `npm ci` → pnpm（含 `--production` → `--prod --frozen-lockfile`）                                                              |
| `docs/runbooks/docker-deploy.md`                                                                                                                                                                                            | T-A：**只标注不改写** —— 5 处锁文件相关行加「npm 时代口径 / 待另案」提示（§2 第 4 条）                                                   |
| `docs/team/gate-performance-remediation-2026-11-11.md`、`docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`、`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` | §七 四处索引回写（其中前三份的 TD-11 登记行是主控本轮未提交的既有改动，本单在其同一行上回填结论）                                        |

### 3.3 新建（0 个）

---

## 四、闸门表（真实命令 / exit code / 真实数字）

| 闸门            | 命令                                                                    | exit | 真实数字                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置        | `pnpm doctor:fs`                                                        | 0    | 合格（per-file 均值 **0.14 ms/文件**、slow=0、walk 35 ms）                                                                                                                                                                                                                                                                                |
| 根类型          | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | **0 error**                                                                                                                                                                                                                                                                                                                               |
| 构建类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0    | **0 error**                                                                                                                                                                                                                                                                                                                               |
| Lint（权威）    | `pnpm lint`                                                             | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，基线既有、e2e 范围外，**未修**）                                                                                                                                                                                                                        |
| oxlint fast     | `pnpm lint:fast`                                                        | 0    | **0 warning / 0 error**                                                                                                                                                                                                                                                                                                                   |
| oxlint deep     | `pnpm lint:deep`                                                        | 0    | **0 warning / 0 error**                                                                                                                                                                                                                                                                                                                   |
| 测试            | `pnpm test`                                                             | 0    | **194 文件（193 passed + 1 skipped）/ 3252 例（3248 passed + 4 skipped）**，与基线逐字一致；Duration **94.86 s**（import 66% / transform 19% / tests 14% / worker 1%）                                                                                                                                                                    |
| engine-core     | `git diff --stat HEAD -- src/engine-core`                               | 0    | **空**（0 行）                                                                                                                                                                                                                                                                                                                            |
| 生产 src 范围   | `git diff --name-only HEAD -- src`                                      | 0    | **48 个文件**（全部属 T-B 清单，+48 / −48）                                                                                                                                                                                                                                                                                               |
| 测试目录        | `git diff --name-only HEAD -- test`                                     | 0    | **0 个文件**（断言 / 用例 / mock 语义冻结）                                                                                                                                                                                                                                                                                               |
| 边界            | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | **12 passed**                                                                                                                                                                                                                                                                                                                             |
| CI yml 静态自检 | `yaml.parse` + 脚本名比对                                               | 0    | **YAML_PARSE_OK**；jobs = `lint-and-typecheck(9 steps)` / `unit(9, matrix shard=[1,2] count=[2])` / `e2e(8)` / `coverage(10)` / `build(4, needs=[unit,e2e])` / `security-audit(8)`；package.json 脚本引用 `lint` / `migration:run` / `test` / `test:e2e` **4/4 存在**；8 处 `actions/cache` 的 path 里**无 coverage**（运行产物不入缓存） |

**机器状态（实测，§5.0 要求标注）**：**不干净** —— 5 个 node 长驻进程在跑：`pnpm start:dev`（PID 12992）、`nest start --watch`（PID 14612，198.7 s CPU / 785 MB）、`pnpm dev`（PID 20740）、`admin-dashboard` vite dev（PID 7860）、`node dist/app`（PID 21580）；本机 3306 / 6379 **未监听**、3000 被占。因此 94.86 s 与 TD-10 记录的 61.80 s **不可直接比较**（本单不以墙钟为验收指标）。

---

## 五、任务特有结果

### 5.1 T-B · 附录 A 48 文件逐文件复核表

复核口径：逐文件扫描 `Repository` 的**全部**出现点，判定是否落在值位置（`Repository.<静态>` / `instanceof Repository` / `new Repository` / 作为值传递给运行时 API）。**48 个文件全部通过，0 个需保留原样**；`InjectRepository`（`@nestjs/typeorm` 值导入）、entity 装饰器、module 装配一律未动。

| #   | 文件                                                               | `Repository` 使用点数 | 使用位置形态 | 值位置使用 | 结论              |
| --- | ------------------------------------------------------------------ | --------------------- | ------------ | ---------- | ----------------- |
| 1   | `src/admin-debug/trace-recorder.service.ts`                        | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 2   | `src/ai-companion/providers/ai-conversations.service.ts`           | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 3   | `src/ai-engine/providers/ai-effect.service.ts`                     | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 4   | `src/ai-engine/providers/ai-profile.service.ts`                    | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 5   | `src/ai-engine/providers/ai-unlock.service.ts`                     | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 6   | `src/ai-engine/providers/llm-orchestrator.service.ts`              | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 7   | `src/analytics/providers/analytics-event-tracker.service.ts`       | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 8   | `src/auto-practice/auto-practice.controller.ts`                    | 3                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 9   | `src/auto-practice/practice-batch-health.service.ts`               | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 10  | `src/auto-practice/practice-queue.service.ts`                      | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 11  | `src/auto-practice/practice-runner.service.ts`                     | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 12  | `src/auto-practice/metrics/batch-metrics.service.ts`               | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 13  | `src/auto-practice/semantic/semantic-turn.persister.ts`            | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 14  | `src/companion/companion-tree/providers/companion-tree.service.ts` | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 15  | `src/companion/providers/companion.service.ts`                     | 8                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 16  | `src/consent/providers/consent.service.ts`                         | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 17  | `src/counselor/providers/counselor-ui-preference.service.ts`       | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 18  | `src/embodied/providers/embodied.service.ts`                       | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 19  | `src/emergency/providers/emergency.service.ts`                     | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 20  | `src/good_state_diary/providers/good-state-diary.service.ts`       | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 21  | `src/gql/providers/simple.service.ts`                              | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 22  | `src/home/providers/home-companion.service.ts`                     | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 23  | `src/home/providers/home-micro-intervention-scenario.service.ts`   | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 24  | `src/home/providers/home-micro-intervention-stats.service.ts`      | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 25  | `src/home/providers/home-micro-intervention.service.ts`            | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 26  | `src/inner_world/providers/decorations.service.ts`                 | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 27  | `src/inner_world/providers/game-unlock.service.ts`                 | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 28  | `src/inner_world/providers/islands.service.ts`                     | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 29  | `src/inner_world/providers/reconciliation.service.ts`              | 3                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 30  | `src/knowledge-base/providers/knowledge.service.ts`                | 4                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 31  | `src/knowledge-base/providers/preview.service.ts`                  | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 32  | `src/knowledge-base/providers/scheduled-publish.processor.ts`      | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 33  | `src/knowledge-base/providers/scheduled-publish.service.ts`        | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 34  | `src/knowledge-base/providers/search.service.ts`                   | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 35  | `src/practice/providers/practice.service.ts`                       | 3                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 36  | `src/profile/providers/burnout-settings.service.ts`                | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 37  | `src/profile/providers/certification.service.ts`                   | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 38  | `src/profile/providers/companion-binding.service.ts`               | 2                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 39  | `src/profile/providers/companion-record.service.ts`                | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 40  | `src/profile/providers/consent.service.ts`                         | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 41  | `src/profile/providers/membership.service.ts`                      | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 42  | `src/profile/providers/notification-settings.service.ts`           | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 43  | `src/profile/providers/privacy-authorization.service.ts`           | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 44  | `src/profile/providers/profile.service.ts`                         | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 45  | `src/profile/providers/selfcare-record.service.ts`                 | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 46  | `src/shared/foobar/foobar.service.ts`                              | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 47  | `src/shared/infra/queue/audit-log.processor.ts`                    | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |
| 48  | `src/user/providers/password-history.service.ts`                   | 1                     | 泛型类型标注 | 无         | ✅ type-only 通过 |

合计 48 文件；值位置使用命中 0 个文件；type-only 通过 48 个。

### 5.2 T-E · 分片前置核查结论与收益边界

| 前置项                                          | 核查方法                                                                                                                                                                                                                                                                                                                           | 结论                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| ① 非 e2e spec 之间无文件顺序依赖 / 共享状态     | ① 全量 grep `test/` 下 `DataSource` / `createConnection` / `TypeOrmModule.forRoot` → **0 命中**（单测不连真实 MySQL）；② 端口占用：`createServer().listen(0, '127.0.0.1')`（`wp26-voice-gateway-hardening`）用 **0 号端口 = 随机空闲端口**，无固定端口冲突；③ TD-9 已清跨文件 env / mock 单例泄漏，`isolate: true` 每文件独立 fork | **满足**                               |
| ② 各 shard job 独立输出、无跨片合并断言         | 本机实跑两片，断言全在 spec 内部，无跨文件汇总断言                                                                                                                                                                                                                                                                                 | **满足**                               |
| ③ vitest 5.0.5 `--shard` 参数形态与 matrix 对齐 | 实测 `pnpm run test -- --shard=N/2` 可用；**`pnpm test -- --shard=N/2` 不可用**（pnpm 简写吞参数，报 `Unknown option: 'shard'`）                                                                                                                                                                                                   | **满足**（用 `pnpm run` 形态，见 D-7） |

**切分完整性实测**（本机全量跑两片）：

| 片    | 文件                            | 用例                                   | Duration |
| ----- | ------------------------------- | -------------------------------------- | -------- |
| `1/2` | **97 passed**                   | **1608 passed**                        | 43.92 s  |
| `2/2` | **96 passed + 1 skipped（97）** | **1640 passed + 4 skipped（1644）**    | 39.77 s  |
| 合计  | **194 文件**                    | **3252 例（3248 passed + 4 skipped）** | —        |

合计与基线（194 文件 / 3252 例）**逐字一致**，两片 exit 均为 0 → 分片不丢用例、不改断言、不改集合。

**收益边界（如实写）**：

- 分片面向**多 runner 并行**：本机单进程全量 94.86 s → 两片并行取 max ≈ 44 s（**CI 上是 2 个 runner 并行**，不是本机提速）。
- 本机是单进程两片串行跑，墙钟反而更长（43.92 + 39.77 = 83.69 s vs 全量 94.86 s）—— 分片收益只在 CI 多 runner 场景成立，**不承诺本机提速**。
- CI job run 数：原 4 个 job（含 1 个 test）→ 现 6 个 job（unit × 2 + e2e + coverage + build + audit + lint）= **净增 2 次 job run**（unit 分片 +1、coverage +1）。CI quota 消耗上升，已列入 §七供主控评估。
- e2e **不进矩阵**（独立 config `test/vitest.e2e.mts`、独立步骤、独立 job），符合任务单边界。
- `fail-fast: false`：一片挂了另一片照跑完，一次能看到完整失败面。

### 5.3 T-D · 首轮 coverage 报告（本地实跑，路径与数值）

- 采集命令：`pnpm run test -- --coverage`（exit 0）；**本地 `pnpm test` 脚本不带 `--coverage`**，日常闸门不插桩。
- 报告路径：`coverage/lcov.info`（774 316 B）+ `coverage/lcov-report/`（html）；`.gitignore` 第 33 行已含 `coverage`，不入库。
- **首轮全量数值（All files）**：Statements **46.92%**（12 391 / 26 408）· Branches **45.66%**（6 724 / 14 724）· Functions **42.48%**（2 149 / 5 058）· Lines **46.68%**（11 321 / 24 251）。
- 插桩全量跑 Duration **117.48 s**（vs 不插桩 94.86 s，插桩开销 ≈ +24%），用例数不变（194 文件 / 3252 例）。
- **本单不设 thresholds** —— 阈值必须由主控基于这轮首轮报告拍板（另案）。覆盖率**不反向绑到练习评分 / 零压红线**，也不作为临床正确性指标。
- CI 侧：`coverage` job 跑同一命令并上传 `coverage/` 为 artifact（`coverage-lcov`，保留 7 天）；`coverage/` **不入缓存**（8 处 `actions/cache` 的 path 里没有它）。

### 5.4 T-B 结构收益的诚实结论（实测）

用 TD-10 的 import 图分析器对**改前（HEAD `1696e59`）与改后**各跑一次，逐 spec 对比：

| 指标                                     | 改前 | 改后     |
| ---------------------------------------- | ---- | -------- |
| 本地模块加载总量（183 非 e2e spec 合计） | 7986 | **7986** |
| 包引用数                                 | 673  | **673**  |
| 触达重型 SDK 的 spec                     | 58   | **58**   |
| 触达 Nest 框架的 spec                    | 118  | **118**  |
| **逐 spec 有差异的 spec 数**             | —    | **0**    |

**T-B 对测试侧 import 加载图的收益为 0**。原因：每个被改的 service / controller 几乎都同时 import 同域 **entity**（`@Entity` / `@Column` 装饰器必须运行时求值），typeorm 仍由 entity 边进入 spec 闭包 —— 这与任务单「本单不承诺测试侧 typeorm 触达 spec 数下降」的预判一致。

T-B 的真实收益在**源码层**：48 个文件对 `typeorm` 的**顶层值导入边被消除**（编译期擦除），类型依赖与运行时依赖就此分离；这是 L-1b（仓储端口抽象 + entity 依赖消除 + spec typeorm 替身）的前置清理，不在本单。

---

## 六、风险与回归

1. **既有测试是否被改**：**一个都没改** —— `git diff --name-only HEAD -- test` = **0 个文件**；全量 **3252 例 / 194 文件**与基线逐字一致（3248 passed + 4 skipped），断言期望、用例数、mock 语义、隔离语义全部冻结。
2. **T-B 是纯类型层改动**：只改 import 语句形态（48 行 − / 48 行 +），不改构造函数参数、不改依赖注入顺序、不改 `@InjectRepository` 装饰器、不改 entity 装饰器、不改 module 装配；`InjectRepository` 仍是 `@nestjs/typeorm` 的运行时值导入。
3. **未碰 engine-core**：`git diff --stat HEAD -- src/engine-core` 空；`test/engine-core/boundary.spec.ts` 未改；boundary **12 绿**。
4. **未碰 schema / migration / 映射函数 / module 装配**：T-B 不涉及任何 entity 字段、列、迁移；`migration:generate` 扫描口径不变。
5. **未碰内容与状态字段**：角色 `enabled` / `audit_status` / `version` / 内容字段零改动。
6. **未新增第三方依赖**、未改 `package.json`（scripts 与依赖）、未改 tsconfig / Dockerfile / Dockerfile.prod / `.nvmrc` / `engines.node` / CI `node-version`。
7. **未碰 `admin-dashboard/` 与 Flutter**（其 `admin-dashboard/README.md` 里的 `npm install` 属前端独立工程，按边界不动）。
8. **未改 3 个保留真 SDK 的 spec**（TD-10 L-2）、**未清 e2e 既有 lint warning**（TD-10 L-3）。
9. **CI 侧结果待主控 push 后在 Actions 复核** —— 本机跑不了 GitHub Actions，交付记录**不写「CI 已通过」**。需在 Actions 上复核：① `pnpm run test -- --shard=1/2` 的 matrix 传参是否如期分片；② `coverage` job 是否产出 `coverage/lcov.info` 并上传成功；③ `pnpm audit --ignore-registry-errors` 在 registry 正常时是否仍按 `--audit-level=high` 阻断真实漏洞；④ `build` job 的 `needs: [unit, e2e]` 是否等齐两片。
10. **CI job run 数上升**（见 §5.2 收益边界）：净增 2 次 job run。若主控认为 quota 成本过高，可考虑把 `coverage` job 改为「每片各采 + 事后人工合并」或直接撤掉该 job —— 但那样就没有完整覆盖率报告，阈值门禁（另案）将失去依据。
11. **机器不干净**：5 个长驻进程在跑，墙钟数字仅供参考。

---

## 七、遗留项与建议人工复核

| 编号 | 遗留                                                        | 状态 / 建议                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1  | **coverage 阈值门禁**                                       | 另案。首轮报告已产出（46.92% stmts / 45.66% branch / 42.48% funcs / 46.68% lines），阈值数值请主控基于该轮拍板；本单**未设任何 thresholds**                                                                                                                                                                       |
| L-2  | **L-1b 仓储端口抽象 + entity 依赖消除 + spec typeorm 替身** | 另案（较大 src 重构）。T-B 已把 48 个文件的值导入边清掉，但 entity 装饰器的运行时依赖仍在 → 测试侧 typeorm 触达 spec 数 **45 → 45 未变**（§5.4 实测）                                                                                                                                                             |
| L-3  | **附录 A 之外的 23 个混合形态 `Repository` 值导入**         | 本单有意不动（D-4）：混合形态下 typeorm 模块仍被值导入求值，改 inline `type` 零运行时收益。若主控要统一形态（可读性向），可另案批量改成 `import { Between, type Repository } from 'typeorm'` —— 仓内已有 10 个文件是这个写法                                                                                      |
| L-4  | **部署文档历史债**                                          | `docs/runbooks/docker-deploy.md` 为 npm 时代口径（含 `npm ci` 排障段 L401-L503、`Dockerfile.prod COPY package-lock.json` 等）。本单按任务单只标注 5 处锁文件相关行，**未逐段改写**；建议另案整篇重写（现状 Dockerfile.prod 实为 `COPY package.json pnpm-lock.yaml ./` + `pnpm install --prod --frozen-lockfile`） |
| L-5  | **`npm run` 口径残留**                                      | `docs/runbooks/local-setup.md` 的 `npm run migration:*` / `npm run start:dev`、`bin/deploy-prod.sh` 注释里的 `npm ci`、`docs/runbooks/local-setup.md` 外的 npm 时代叙述仍存在。本单只改**因删锁而断裂**的 `npm ci`；其余属 npm 口径统一清理，随 L-4 另案                                                          |
| L-6  | **3 个真 SDK spec + e2e 既有 lint warning**                 | 沿用 TD-10 L-2 / L-3，本单未动                                                                                                                                                                                                                                                                                    |
| L-7  | **Nest DI 冒烟与纯单元用例分离**                            | 沿用 TD-10 L-6，本单未动                                                                                                                                                                                                                                                                                          |
| L-8  | **CI job run 数净增 2**                                     | 见 §六 第 10 条；主控可评估是否保留独立 `coverage` job                                                                                                                                                                                                                                                            |
| L-9  | **Actions 侧复核**                                          | 见 §六 第 9 条 —— 四项待复核点                                                                                                                                                                                                                                                                                    |
| L-10 | **README 2 处既有断链**                                     | `README.md` 指向 `docs/architecture/V3_DOCKER_DEPLOY.md` 与 `docs/architecture/V2_SETUP.md`，两文件**在 HEAD 即不存在**（本单未触碰这两行，非本单引入）→ 建议另案把链接指向现存 runbook（`docs/runbooks/docker-deploy.md` / `docs/runbooks/local-setup.md`）                                                      |

---

_本单无新增第三方依赖；无 schema / migration 变更；未自动 commit / push。_
