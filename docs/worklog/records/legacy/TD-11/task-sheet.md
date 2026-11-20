# TD-11 · CI 工具链收尾 + typeorm 类型导入收窄专项（锁文件双轨 · audit 容错 · coverage 采集 · CI 分片 · Repository type-only）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ [交付记录](td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`（基线 HEAD `1696e59`）
> 唯一事实源：[闸门性能 remediation](../../../team/gate-performance-remediation-2026-11-11.md) §9 P-DEBT-5 / P-DEBT-6 遗留段 + [TD-8 交付记录](td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md) §3.3 / §遗留 + [TD-10 交付记录](td10-test-structure-debt-reduction-implementation-2026-11-13.md) §七 L-1；主控 2026-11-14 现场扫描备查 `data/quality/td11-survey-1~10.txt`（gitignore 不入库）
> 任务性质：CI / 脚本 / 类型层卫生债收尾；**不改变生产业务行为、不改测试期望数值、不增减用例**；src 侧改动仅限类型导入形态（T-B），无运行时装配变化。
> 改动范围：`.github/workflows/ci.yml`、`scripts/deploy-tested.cjs`、`README.md`、`src/**`（仅 T-B 类型导入）、`vitest.config.mts`（仅 T-D 采集配置）、本单交付文档；`engine-core/` 零改动。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层边界、§1.3 pnpm 命令规范）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `phase2.5-wp-list-2026-11-08.md`
5. 本任务唯一事实源：TD-8 交付记录 §3.3（D-b 前置条件）与 §遗留（D-a / 分片）、TD-10 交付记录 §七（L-1 typeorm 根因与边界）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-8（CI pnpm 对齐 + 缓存）、TD-9（隔离残留 + lint 卫生）、TD-10（测试结构减重）已闭环并 push（HEAD `1696e59`）。三单共登记五项遗留决策/工程项，本单一次性收尾其中**前置条件已具备、风险可控**的部分；前置不足或属大重构的项显式登记另案，不在本单硬做。

### 关键现状（主控已核对，别当新问题）

- **锁文件双轨**：`package-lock.json`（659 714 B）与 `pnpm-lock.yaml`（416 855 B）均被 git 跟踪。Dockerfile 三段式只 `COPY package.json pnpm-lock.yaml ./`、CI 三个 job 走 `pnpm install --frozen-lockfile`；**没有任何安装路径读取 npm 锁**。`packageManager: pnpm@9.15.0`，无 `.npmrc`。
- **audit 现状**：CI `security-audit` job 跑 `pnpm audit --audit-level=high --prod`；未带 registry 容错。`pnpm audit` 提供 `--ignore-registry-errors`（registry 响应错误时 exit 0；真实 high+ advisory 仍按阈值阻断）。
- **coverage 现状**：`vitest.config.mts` 的 `coverage` 段只有 `include: ['src/**/*.ts']` / `exclude: ['src/entity/**']`，无 provider / reporter / reportsDirectory / thresholds；`@vitest/coverage-v8@^5.0.5` 已在 devDeps。`pnpm test` 脚本不带 `--coverage`，日常本地闸门不插桩。
- **分片现状**：vitest 5.0.5 支持 `--shard <index>/<count>`；CI `test` job 单进程跑 unit（`pnpm test`，排除 e2e）+ 独立步骤跑 e2e（`pnpm test:e2e`，独立 config）。unit 与 e2e 拓扑已分离；TD-9 已清跨文件 env / mock 单例泄漏，`isolate: true` 每文件独立 fork。
- **typeorm 现状（L-1）**：src 中 **48 个** service / controller 以值导入 `import { Repository } from 'typeorm'`；主控逐文件扫描确认 **0 个**在运行时值位置使用（无 `Repository.静态方法`、无 `instanceof Repository`、无 `new Repository`），全部是构造函数参数类型标注（`repo: Repository<X>`）。另有 11 个文件已是 `import type`。`@nestjs/typeorm` 导入 157 文件（module 装配 `TypeOrmModule.forFeature`，运行时必需）；entity 装饰器文件约 99 个（装饰器是运行时求值，无法 type-only）。
- **测试侧口径（TD-10 模块图分析器）**：183 个非 e2e spec 中 45 个触达 typeorm、43 个触达 `@nestjs/typeorm`。

### 基线闸门（HEAD `1696e59`，本单不得退化）

根 tsc 0 error；build tsc 0 error；`pnpm lint` 0 error / **1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，范围外未修）；`pnpm lint:fast` 0 warning / 0 error；`pnpm typecheck` exit 0；boundary.spec **12 passed**；全量 **3248 passed + 4 skipped（3252 例 / 194 文件）**；`git diff --stat HEAD -- src/engine-core` 为空。

---

## 2. 范围（严格遵守，不越权）

### 在范围内（五个子项）

**T-A · D-a 锁文件双轨清理**

1. 删除根目录 `package-lock.json`（版本控制只保留 `pnpm-lock.yaml` 一份锁文件真相源）。
2. 同步 `scripts/deploy-tested.cjs`：上传清单移除 `package-lock.json`、改 `pnpm-lock.yaml`；文件头注释里「npm ci / package-lock」表述同步为 pnpm 口径（脚本其余部署流程、安全机制不动）。
3. 同步 `README.md` 部署命令段（L138–139 附近）scp 清单：`package-lock.json` → `pnpm-lock.yaml`。
4. `docs/runbooks/docker-deploy.md` 为 npm 时代历史口径（含 `npm ci`、`Dockerfile.prod` 等现状已不存在的引用），**本单不逐段改写**；在交付记录 §遗留登记为「部署文档历史债，另案重写」，只把与锁文件直接相关的行（L251 / L329 / L405 / L458 / L625 清单名）标注口径待另案更新。
5. `admin-dashboard/.vscode/settings.json` 的文件排除模式列表属前端编辑器配置、非安装路径，**不动**（前端目录边界）。

**T-B · L-1a Repository 类型导入收窄（src 侧唯一代码改动）**

1. 附录 A 列出的 **48 个文件**，把 `import { Repository } from 'typeorm'` 改为 `import type { Repository } from 'typeorm'`。
2. 逐文件复核：确认 `Repository` 仅作类型标注（构造函数参数 / 字段类型 / 返回类型 / 泛型约束）；**若发现任何值位置使用**（`Repository.<静态>`、`instanceof Repository`、`new Repository`、值传递给运行时 API），该文件**保持原样**并在交付记录偏差表登记，不强行改 type-only。
3. `@nestjs/typeorm` 的 `InjectRepository` 是运行时装饰器，**值导入保留不动**；entity 文件的 `@Entity` / `@Column` 装饰器导入不动；module 装配（`TypeOrmModule.forFeature([...])`）不动。
4. 收益边界（如实写进交付记录）：type-only 只消除 service / controller 文件对 `typeorm` 包的顶层求值边；entity 装饰器运行时依赖与 module 装配仍在；**本单不承诺测试侧 typeorm 触达 spec 数下降**（spec 经 TestingModule 装配真实 forFeature 带入，需仓储端口替身，属另案 L-1b）。

**T-C · audit registry 容错开关**

1. CI `security-audit` job 的 audit 命令加 `--ignore-registry-errors`：`pnpm audit --audit-level=high --prod --ignore-registry-errors`。
2. 语义边界写进交付记录：该 flag 仅在 registry 网络 / 服务故障（registry 响应错误）时 exit 0 不阻断；**high 及以上真实 advisory 仍按 `--audit-level=high` 阻断**，不得把容错扩大成「漏洞也放行」。
3. 不改 Trivy 步骤；不改 audit 阈值；不新增依赖。

**T-D · D-b coverage 采集接通（阈值门禁另案）**

1. `vitest.config.mts` 的 `coverage` 段补齐：`provider: 'v8'`、`reporter: ['text', 'lcov']`、`reportsDirectory: './coverage'`；沿用现有 `include` / `exclude`，不改动其口径。
2. CI `test` job 接通采集：以 CI 专用方式跑 unit 并带 `--coverage`（可在 CI workflow 加 `pnpm test -- --coverage` 或新增 `test:coverage` 脚本；本地 `pnpm test` 脚本**不带** coverage，日常本地闸门不插桩）。
3. **本单不设 `coverage.thresholds`**：阈值数值必须先跑一轮真实覆盖率报告再拍板（TD-8 §3.3 前置条件 4）；阈值门禁登记为另案，待首轮报告产出后主控拍板。
4. coverage 产物 `coverage/` 不纳入 CI 缓存（沿用 TD-8 口径：运行产物不当缓存缓存）；不把覆盖率反向绑到练习评分 / 零压红线口径。

**T-E · P-DEBT-5 CI 分片矩阵**

1. CI `test` job 改 GitHub Actions matrix（起步 **2 片**），unit 测试按 vitest `--shard=<index>/<count>` 拆分；e2e 步骤**不进**分片（独立 config、独立步骤）。
2. 落地前核查前置：① 非 e2e spec 之间无文件顺序依赖、无共享文件 / 端口 / 数据库行的跨文件假设（TD-9 隔离清理后 `isolate: true` 每文件独立 fork，预期满足；逐条复核 deliberation / queue / mutex 相关 spec）；② 各 shard job 独立输出测试报告，无跨片合并断言；③ vitest 5.0.5 `--shard` 参数形态与 matrix 传参对齐。
3. 收益边界如实写：shard 面向多 runner / 高核场景；CI ubuntu runner 核数有限，2 片主要缩短 CI wall-clock，不承诺本机提速；若核查发现拓扑前置不足（顺序依赖 / 汇总不可行），**降级为另案登记**，保留单进程现状，不硬上矩阵。
4. 分片不改变测试集合、断言与用例数；不引入跨 worker 共享状态。

### 明确不在范围内（禁止顺手做）

- **L-1b 仓储端口抽象（另案）**：引入仓储接口 / 端口注入、消除 entity 装饰器运行时依赖、spec 层 typeorm 替身 —— 属 src 侧较大重构，本单只做 T-B 类型导入收窄。
- **覆盖率阈值门禁**（另案，待首轮真实报告）。
- `engine-core/` 一行不动；`boundary.spec.ts` 不许改。
- 不改表结构 / 不加 migration / 不加列；不改映射函数、resolver、module 装配；不碰角色 `enabled` / `audit_status` / `version` / 内容字段。
- 不重构 `docs/runbooks/docker-deploy.md` 整体部署流程；不补建 `Dockerfile.prod`（现状根 Dockerfile 三段式为准）。
- 不碰 `admin-dashboard/` 与 Flutter；不调整 `engines.node`、CI `node-version`、`.nvmrc`。
- 不改既有 3 个保留真 SDK 的 spec（TD-10 L-2）；不清 e2e 既有 lint warning（TD-10 L-3）。
- 并行进程产物不混入；不自动 `git commit` / `git push`（写完给 commit 草稿，等用户指令）。

---

## 3. 目标架构 / 交付物

设计原则固定四条：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 幂等。

- **交付物 1：锁文件单轨** —— 根目录仅 `pnpm-lock.yaml`；`deploy-tested.cjs` 与 README 部署清单口径同步；无残留 npm 锁引用活路径。
- **交付物 2：Repository type-only 收窄** —— 附录 A 48 文件（复核通过的部分）`Repository` 改 `import type`；`InjectRepository` / entity 装饰器 / module 装配保持值导入。
- **交付物 3：audit 容错** —— CI audit 命令带 `--ignore-registry-errors`，容错语义在交付记录写明。
- **交付物 4：coverage 采集接通** —— config provider / reporter / 输出目录齐备；CI 采集、本地不插桩；无 thresholds。
- **交付物 5：CI 分片矩阵** —— 2 片 matrix + `--shard`；前置核查结论与收益 / 回退路径写入交付记录。
- **测试**：不新增 spec；既有断言期望、用例数、mock 语义、隔离语义冻结。T-B 属纯类型层改动，以 `pnpm typecheck` + 受影响路径定向 spec 复跑验证；T-C / T-D / T-E 属 CI 层，以 yml 静态自检 + 脚本名存在性 + 全量闸门验证。

> **口径真相源**：锁文件真相源 = `pnpm-lock.yaml`；coverage 纳入范围 = `vitest.config.mts` 的 `coverage.include/exclude`；audit 阈值 = CI 命令 `--audit-level=high`；消费端只读取上述源，不另抄口径。

---

## 4. 红线（违反即返工）

- **分层归属**：纯决策计算 / 纯出口字段 / 纯类型归 `engine-core/`；`engine-core/` 内禁止任何 NestJS / IO / 网络 / prompt / 模型名 / 心理原文 console；`boundary.spec.ts` 是机器护栏，不许改。本单 src 改动仅限 T-B 类型导入形态，不新增任何内核逻辑。
- 心理对话原文禁止进日志 / console / crash report（只出码和计数）。
- T-B 只改导入形态，不改任何运行时装配、构造函数参数、依赖注入顺序；发现值位置使用即保留原样并登记，不强行 type-only。
- T-D 覆盖率不得成为临床正确性指标，不得反向绑到练习评分；阈值门禁不凭空设。
- T-E 分片不得引入跨文件 / 跨 worker 共享状态；不得改变测试集合与断言。
- schema / migration / 映射函数按 §2 范围处理；不越权加需求外功能。
- 不自动 commit / push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范（强制，禁止裸 npx）

- 一律 pnpm：脚本 `pnpm <script>`，二进制 `pnpm exec <bin> <args>`。
- 跑闸门前确认机器干净（无 `nest start --watch` / `vite dev` / `dist/app` 长驻）；先 `pnpm doctor:fs` 体检；取证会话补 PATH（git 在 `D:\Apps\Git\cmd`）。
- 墙钟数字必须标注机器状态；本单验收不以墙钟为指标。

### 5.1 内循环（高频定向）

| 目的             | 命令                                                            |
| ---------------- | --------------------------------------------------------------- |
| 语法 / 明显缺陷  | `pnpm lint:fast`                                                |
| 类型（增量缓存） | `pnpm typecheck`                                                |
| 受影响测试       | `pnpm test:related -- <触碰的 src 文件>` 或 `pnpm test:changed` |
| 单文件复跑       | `pnpm exec vitest run <file.spec.ts>`                           |

### 5.2 收尾全量闸门（交付前一次，真实命令 / exit / 数字写进交付记录）

| 闸门         | 命令                                                                                                           | 要求                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                        | 0 error                                                    |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                | 0 error                                                    |
| Lint（权威） | `pnpm lint`                                                                                                    | 0 error，记 warning 数（基线 1，不得新增）                 |
| oxlint       | `pnpm lint:fast` / `pnpm lint:deep`                                                                            | 0 warning / 0 error                                        |
| 测试         | `pnpm test`                                                                                                    | 全绿，记用例总数与墙钟 + 机器状态；基线 3252 例 / 194 文件 |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                                                      | 空                                                         |
| CI 静态自检  | yml 解析通过；引用的 package.json 脚本名逐一存在；matrix / shard 参数形态与 vitest 5.0.5 对齐                  | 0 断链 / 0 不存在脚本                                      |
| 任务特有     | T-B：附录 A 逐文件复核结论表（type-only 通过 / 保留原样 + 原因）；T-E：前置核查记录（顺序依赖 / 汇总方式结论） | 见交付记录 §任务特有结果                                   |

### 5.4 验收闸门（回收方：定向 + 范围核对，不重跑全量）

相关测试 / 关键路径抽跑 / `lint:fast` + `typecheck` 复查 / engine-core 边界核对 / `git diff --name-only HEAD` 对照本单 §2 授权范围；仅在闸门数字存疑、并行产物混入、确定性失败或里程碑节点时升级全量复跑。

---

## 6. 交付记录（完成后写到固定路径）

`docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话总结）；
2. 方案设计：实际实现 vs 任务单方案，偏差逐条写清（原方案 / 实际方案 / 为什么）；
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例数）；
5. 任务特有结果：T-B 48 文件复核表；T-E 前置核查结论与收益边界；T-D 首轮 coverage 报告路径与数值（若本单跑得出）；
6. 风险与回归：既有测试是否被改、为什么；确认未碰 engine-core / schema / 内容 / 状态字段；
7. 遗留项与建议人工复核：L-1b 仓储端口抽象、coverage 阈值门禁、部署文档历史债、3 个真 SDK spec、e2e 既有 warning、Nest DI 冒烟与纯单元用例分离（TD-10 L-6）。

---

## 7. 【交付回写清单】做完逐项勾选（不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 `✅` 并链接交付记录
- [x] 回写 `phase2.5-wp-list-2026-11-08.md` §四：TD-11 行状态改完成、补交付记录链接
- [x] 回写 `phase2.5-README.md` §3.0：TD-11 bullet 改完成态
- [x] 回写台账 `gate-performance-remediation-2026-11-11.md` §9：P-DEBT-5 分片状态更新；新增 / 更新 L-1 typeorm 结构债行（T-B 已做 + L-1b 另案）；D-a / D-b / audit 容错三项状态与结论登记
- [x] 回写 `phase2.5-toolchain-tech-debt-2026-11-11.md` §TD-8 遗留段：D-a / D-b / audit 容错 / 分片四项关闭状态
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit/push**，等用户指令）

---

## 附录 A · T-B 待复核文件清单（48，主控扫描 `data/quality/td11-survey-4.txt`）

> 路径相对仓库根；执行方逐文件确认 `Repository` 仅类型标注后改 `import type`。

```
src/admin-debug/trace-recorder.service.ts
src/ai-companion/providers/ai-conversations.service.ts
src/ai-engine/providers/ai-effect.service.ts
src/ai-engine/providers/ai-profile.service.ts
src/ai-engine/providers/ai-unlock.service.ts
src/ai-engine/providers/llm-orchestrator.service.ts
src/analytics/providers/analytics-event-tracker.service.ts
src/auto-practice/auto-practice.controller.ts
src/auto-practice/practice-batch-health.service.ts
src/auto-practice/practice-queue.service.ts
src/auto-practice/practice-runner.service.ts
src/auto-practice/metrics/batch-metrics.service.ts
src/auto-practice/semantic/semantic-turn.persister.ts
src/companion/companion-tree/providers/companion-tree.service.ts
src/companion/providers/companion.service.ts
src/consent/providers/consent.service.ts
src/counselor/providers/counselor-ui-preference.service.ts
src/embodied/providers/embodied.service.ts
src/emergency/providers/emergency.service.ts
src/good_state_diary/providers/good-state-diary.service.ts
src/gql/providers/simple.service.ts
src/home/providers/home-companion.service.ts
src/home/providers/home-micro-intervention-scenario.service.ts
src/home/providers/home-micro-intervention-stats.service.ts
src/home/providers/home-micro-intervention.service.ts
src/inner_world/providers/decorations.service.ts
src/inner_world/providers/game-unlock.service.ts
src/inner_world/providers/islands.service.ts
src/inner_world/providers/reconciliation.service.ts
src/knowledge-base/providers/knowledge.service.ts
src/knowledge-base/providers/preview.service.ts
src/knowledge-base/providers/scheduled-publish.processor.ts
src/knowledge-base/providers/scheduled-publish.service.ts
src/knowledge-base/providers/search.service.ts
src/practice/providers/practice.service.ts
src/profile/providers/burnout-settings.service.ts
src/profile/providers/certification.service.ts
src/profile/providers/companion-binding.service.ts
src/profile/providers/companion-record.service.ts
src/profile/providers/consent.service.ts
src/profile/providers/membership.service.ts
src/profile/providers/notification-settings.service.ts
src/profile/providers/privacy-authorization.service.ts
src/profile/providers/profile.service.ts
src/profile/providers/selfcare-record.service.ts
src/shared/foobar/foobar.service.ts
src/shared/infra/queue/audit-log.processor.ts
src/user/providers/password-history.service.ts
```
