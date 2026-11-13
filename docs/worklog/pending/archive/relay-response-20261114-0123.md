# TD-11 · CI 工具链收尾 + typeorm 类型导入收窄 —— 已交付

**交付记录**：`docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md`（含 §一~§七 + T-B 48 文件逐文件复核表）
**任务单**：`docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md`（已归档，状态行改 ✅ 并链交付记录）

## 一句话总结

一次性收尾五项遗留工具链 / 类型层债：T-A 删 npm 锁实现**锁文件单轨**（并把被删锁打断的 4 处 `npm ci` 活路径改口为 pnpm）；T-B 把附录 A 的 **48 个** service / controller 的 `Repository` 值导入改成 `import type`；T-C CI audit 加 `--ignore-registry-errors`（registry 故障放行、真实 high+ 漏洞仍阻断）；T-D 接通 coverage 采集（v8 + text/lcov，CI 采集、本地不插桩、**不设阈值**）；T-E 落地 CI **2 片 matrix**（`--shard`，仅 unit，e2e 不进矩阵）。业务行为、测试期望、用例数、mock 语义、隔离语义逐字未变。

## 五个子项的落地

| 子项                     | 落地                                                                                                                                                                                                                                                                             | 关键实测                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **T-A** 锁文件单轨       | 删根目录 `package-lock.json`（659 714 B / 18 516 行）；`deploy-tested.cjs` 上传清单 + 文件头、`README.md` scp 清单同步 `pnpm-lock.yaml`；被删锁打断的 4 处 `npm ci` 活路径一并改口 `pnpm install --frozen-lockfile`（经你拍板）；`docker-deploy.md` 5 处锁文件行**只标注不改写** | 已核实无任何安装路径读 npm 锁（`Dockerfile` / `Dockerfile.prod` 只 COPY `pnpm-lock.yaml`）                       |
| **T-B** typeorm 类型收窄 | 附录 A **48 文件全部**改 `import type { Repository } from 'typeorm'`；`InjectRepository` / entity 装饰器 / module 装配未动                                                                                                                                                       | 逐文件复核：**0** 值位置使用、**0** 个需保留原样                                                                 |
| **T-C** audit 容错       | `pnpm audit --audit-level=high --prod --ignore-registry-errors`                                                                                                                                                                                                                  | registry 网络 / 服务故障放行；**真实 high 及以上 advisory 仍阻断**                                               |
| **T-D** coverage 采集    | `vitest.config.mts` 补 `provider: 'v8'` / `reporter: ['text','lcov']` / `reportsDirectory: './coverage'`；CI 新增**独立 `coverage` job**；本地 `pnpm test` 不插桩                                                                                                                | 首轮全量报告 **46.92% stmts / 45.66% branch / 42.48% funcs / 46.68% lines**（26 408 stmts）；**未设 thresholds** |
| **T-E** 分片矩阵         | `ci.yml` matrix **2 片**（`pnpm run test -- --shard=N/2`），仅 unit；e2e 独立 job；`build` 的 `needs` 改 `[unit, e2e]`                                                                                                                                                           | 实跑两片 **97 + 97 = 194 文件、1608 + 1644 = 3252 例**，与基线**逐字一致**，两片 exit 0                          |

## 闸门真实数字（本机实测，全部 pnpm，禁裸 npx 已遵守）

| 闸门               | 命令                                                                    | exit  | 数字                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置           | `pnpm doctor:fs`                                                        | 0     | 合格（均值 **0.14 ms/文件**、slow=0）                                                                                                                |
| 根类型             | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0     | **0 error**                                                                                                                                          |
| 构建类型           | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0     | **0 error**                                                                                                                                          |
| Lint（权威）       | `pnpm lint`                                                             | 0     | **0 error / 1 warning**                                                                                                                              |
| oxlint fast / deep | `pnpm lint:fast` / `pnpm lint:deep`                                     | 0 / 0 | **0 warning / 0 error**                                                                                                                              |
| 测试               | `pnpm test`                                                             | 0     | **194 文件（193 passed + 1 skipped）/ 3252 例（3248 passed + 4 skipped）**，与基线逐字一致；Duration **94.86 s**                                     |
| engine-core        | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空**                                                                                                                                               |
| 生产 src           | `git diff --name-only HEAD -- src`                                      | 0     | **48 个文件**（全部属 T-B 清单，+48 / −48）                                                                                                          |
| 测试目录           | `git diff --name-only HEAD -- test`                                     | 0     | **0 个文件**（断言 / 用例 / mock 语义冻结）                                                                                                          |
| 边界               | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0     | **12 passed**                                                                                                                                        |
| CI yml 自检        | `yaml.parse` + 脚本名比对                                               | 0     | **YAML_PARSE_OK**；6 个 job；package.json 脚本引用 `lint` / `migration:run` / `test` / `test:e2e` **4/4 存在**；8 处 cache 的 path 里**无 coverage** |

- **唯一 warning** 是 `test/e2e/v2-user-flow.spec.ts:1` 的既有 unused eslint-disable（基线既有、e2e 范围外，**未修**）。
- **机器状态：不干净** —— 5 个 node 长驻进程在跑（`pnpm start:dev` / `nest start --watch` 198.7 s CPU 785 MB / `pnpm dev` / admin-dashboard vite dev / `node dist/app`）。因此 94.86 s 与 TD-10 的 61.80 s **不可直接比较**（本单不以墙钟为验收指标）。

## 三个必须让你知道的技术结论

**① T-B 对测试侧加载图的收益实测为 0（诚实结论）** —— 用 TD-10 的 import 图分析器对改前（HEAD `1696e59`）与改后各跑一次：本地模块 **7986 → 7986**、包引用 **673 → 673**、触达重型 SDK 的 spec **58 → 58**、**逐 spec 差异 0**。原因：每个被改的 service / controller 几乎都同时 import 同域 **entity**，而 `@Entity` / `@Column` 装饰器必须运行时求值，typeorm 仍由 entity 边进入 spec 闭包。这与任务单「本单不承诺测试侧 typeorm 触达 spec 数下降」的预判一致。T-B 的真实收益在**源码层**：48 个文件对 typeorm 的顶层值导入边被消除，类型依赖与运行时依赖就此分离，是 L-1b 的前置清理。

**② 附录 A 之外另有 23 个混合形态文件，本单有意不动** —— `import { Between, Repository } from 'typeorm'` 这类形态里 `Between` / `IsNull` / `In` 是运行时值符号，typeorm 模块**仍被值导入求值**，改 inline `type Repository` **零运行时收益**（仓内已有 10 个文件是这个写法）。附录 A 的 48 个恰是「typeorm 是该文件唯一符号」的子集 = 能彻底摘掉 typeorm 运行时边的全集。另：全量普查后 src 内**已无**单符号 `import { Repository } from 'typeorm'`（0 残留）。

**③ pnpm 传参形态踩坑（已写进 CI 注释）** —— `pnpm test -- --shard=1/2` 会被 **pnpm 自己**拦下报 `ERROR Unknown option: 'shard'`，只有 `pnpm run test -- --shard=1/2` 才透传。`--coverage` 同理。CI 里已按后者写。

## 与任务单的偏差（8 条，交付记录 §二 逐条写清）

| 编号 | 实际 vs 任务单                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **删 npm 锁会打断 4 处 `npm ci` 活路径** → 已就此发问卷，你拍板「**一并改口为 pnpm**」，本单据此改了 §2 清单外的 `bin/dev-up.ps1` / `bin/check-dev-env.sh` / `docs/runbooks/local-setup.md` |
| D-2  | README **两段快速开始 + 生产部署段**的 npm 命令一并改口（同一代码块口径一致），超出 §2「只改 scp 清单」措辞                                                                                 |
| D-3  | T-B 48 文件**全部**通过复核，**0 个保留原样**（任务单预期可能有值位置使用）                                                                                                                 |
| D-4  | 附录 A 外的 23 个混合形态文件**有意不动**（理由见上）                                                                                                                                       |
| D-5  | **不新增 `test:coverage` 脚本**（§2 改动范围不含 package.json），改用 `pnpm run test -- --coverage`                                                                                         |
| D-6  | coverage 采集放**独立 job**（单进程全量），不在 unit 分片里采 —— 分片报告不完整，阈值（另案）不能建在分片报告上；代价 CI job run 净增 2                                                     |
| D-7  | CI 一律 `pnpm run <script> -- <args>` 形态（见上）                                                                                                                                          |
| D-8  | unit / e2e / coverage 三 job 各自完整复制 services + env + 安装步骤，**不用 YAML anchors**（不依赖新特性；yml 226 → 422 行）                                                                |

## §7 回写清单：9 / 9 已做

| 项                                                                                                                                                                         | 状态                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 交付记录写到 §6 固定路径                                                                                                                                                   | ✅                                                                                                             |
| 任务单 `pending/` → `completed/phase2.5/` + 状态行 ✅ + 链交付记录                                                                                                         | ✅                                                                                                             |
| `phase2.5-wp-list-2026-11-08.md` §四 TD-11 行改完成 + 补链接                                                                                                               | ✅                                                                                                             |
| `phase2.5-README.md` §3.0 TD-11 bullet 改完成态                                                                                                                            | ✅                                                                                                             |
| `gate-performance-remediation-2026-11-11.md` §9：P-DEBT-5 分片状态更新 + **P-DEBT-11**（T-B 已做 / L-1b 另案）+ **新增 P-DEBT-12**（D-a / D-b / audit 三项登记）+ 更新记录 | ✅                                                                                                             |
| `phase2.5-toolchain-tech-debt-2026-11-11.md` §TD-8 遗留段：D-a / D-b / audit / 分片四项关闭状态                                                                            | ✅                                                                                                             |
| `git diff --stat HEAD -- src/engine-core` 为空                                                                                                                             | ✅ 实测 0 行                                                                                                   |
| 提交分组核对                                                                                                                                                               | ✅ 本单文件与并行进程产物分开（`data/quality/td11-*.txt` 被 gitignore 排除）；**未 stage、未 commit、未 push** |
| commit message 草稿                                                                                                                                                        | ✅（见末）                                                                                                     |

回写后跑了链接核验：6 份文档共 **204 条相对链接全部可达，0 断链**。

## 遗留与另案（10 项，交付记录 §七）

- **L-1 coverage 阈值门禁**：另案。首轮报告已产出（46.92% stmts / 45.66% branch / 42.48% funcs / 46.68% lines），阈值数值请基于这轮拍板 —— **本单未设任何 thresholds**。
- **L-2 L-1b 仓储端口抽象 + entity 依赖消除 + spec typeorm 替身**：另案（较大 src 重构）。T-B 已清 48 个文件的值导入边，但**测试侧 typeorm 触达 spec 数 45 → 45 未变**。
- **L-3 附录 A 外的 23 个混合形态文件**：如需统一形态（可读性向）可另案批量改 inline `type`。
- **L-4 部署文档历史债**：`docker-deploy.md` 的 npm 时代口径（`npm ci` 排障段、`Dockerfile.prod COPY package-lock.json` 等）**只标注 5 处未逐段改写**，建议另案整篇重写。
- **L-5 `npm run` 口径残留**：`local-setup.md` 的 `npm run migration:*`、`bin/deploy-prod.sh` 注释里的 `npm ci` 等 —— 本单只改**因删锁而断裂**的 `npm ci`，其余随 L-4 另案。
- **L-6** 3 个真 SDK spec + e2e 既有 lint warning（沿用 TD-10 L-2 / L-3，未动）。
- **L-7** Nest DI 冒烟与纯单元用例分离（沿用 TD-10 L-6，未动）。
- **L-8 CI job run 净增 2**：unit 分片 +1、独立 coverage +1。若嫌 quota 成本高，可撤掉 coverage job，但那样就没有完整覆盖率报告，阈值门禁将失去依据。
- **L-9 Actions 侧待复核四项**：matrix shard 传参是否如期分片 / coverage artifact 是否上传成功 / audit 容错是否不影响真实 high+ 阻断 / `build` 的 `needs: [unit, e2e]` 是否等齐两片。**本机跑不了 GitHub Actions，交付记录不写「CI 已通过」**。
- **L-10 README 2 处既有断链**：`docs/architecture/V3_DOCKER_DEPLOY.md` / `V2_SETUP.md` 在 HEAD 即不存在（非本单引入），建议另案指向 `docs/runbooks/` 下现存 runbook。

## 改动面

- 修改 **60 个文件**（+294 / −84 行）：`src/**` 48（T-B）+ `.github/workflows/ci.yml`（T-C/D/E）+ `vitest.config.mts`（T-D）+ `scripts/deploy-tested.cjs` / `README.md` / `bin/dev-up.ps1` / `bin/check-dev-env.sh` / `docs/runbooks/local-setup.md` / `docs/runbooks/docker-deploy.md`（T-A）+ 4 份索引回写。
- 删除 **1 个**：`package-lock.json`。
- 新建 **0 个**；未新增第三方依赖；未改 `package.json` / tsconfig / Dockerfile / `engines.node` / CI `node-version` / `.nvmrc`；未碰 `admin-dashboard/` 与 Flutter。

## commit message 草稿（未 commit / 未 push，等你指令）

```
ci(td11): 锁文件单轨 · typeorm Repository type-only 收窄 · audit 容错 · coverage 采集接通 · CI 2 片分片
```

---

_说明：本回复的完成时钟时间为 2026-11-14 01:23，文件名前缀沿用任务单指定的 20261114，HHMM 取实际完成时间（24 小时制）。_
