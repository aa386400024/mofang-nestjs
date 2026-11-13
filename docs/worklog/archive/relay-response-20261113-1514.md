## TD-5 · 根 tsconfig 类型债清零 — 已交付

**结论：根 `tsconfig.json` 全量类型检查 401 条 / 87 文件 → 0 条 / 0 文件（exit 0）；零运行时变化、生产契约零改动、用例数量不变。**

### 闸门（全部实跑，真实数字）

| #   | 命令                                                                    | exit  | 结果                                                                                                                            |
| --- | ----------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error / 0 文件**（起点 401 / 87）                                                                                           |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**（生产口径不退化）                                                                                                   |
| 3   | `pnpm lint`                                                             | **0** | **0 error / 0 warning**（基线同为 0/0）                                                                                         |
| 4   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed / 12**（2.52s）                                                                                                     |
| 5   | `pnpm test`                                                             | **0** | **193 passed \| 1 skipped（194 文件）· 3248 passed \| 4 skipped（3252 例）**，vitest 119.17s，墙钟 **121.1s**（与基线逐字一致） |
| 6   | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空输出**                                                                                                                      |
| 7   | `git diff --name-only HEAD`                                             | 0     | **89 文件**：`test/` 80 · `bin/` 5 · `src/` 2（**均 spec**）· `docs/` 2 —— 无生产 src 非 spec 文件、无并行产物                  |

机器：Windows 11 Home China 10.0.26300 build 26300 · Node v26.13.0 · pnpm 9.15.0 · PS 5.1.26100.9818 · 8 逻辑核 · 无 `nest start --watch` / `vite dev` 长驻进程。

### 分批收敛（每批结束实跑根 tsc）

401/87 →（A）388/81 → 369/78 →（B）214/75 →（C）186/66 → 145/48 → 125/48 → 93/47 → 70/41 → 7/4 → **0/0（exit 0）**

- **A 基础设施根因（32 条）**：bin 6 条（TS2688 ×4 / TS7027 / TS2352）、`vi` 命名空间 TS2503 ×13（改 vitest 5 具名类型导入）、TS2307 ×10（e2e import 少一层目录）。
- **B TS4111 ×155**：一次性脚本按 tsc 的 (file, line, col, prop) 精确定位改方括号访问，155 处 0 跳过（脚本误改的可选链已修回）。
- **C 业务类型对齐（214 条）**：类型导入对齐真实导出 7、未使用标识符 23、调用参数对齐生产签名 44、夹具/断言形状 58、字段名对齐生产现字段 17、杂项 25、prompt content 收窄 34。

### 零运行时变化怎么保证

改动只有四类编译期行为：类型标注 / 泛型实参 / `import type`；`as` 与 `as unknown as` 断言；索引签名访问 `obj.x` → `obj['x']`（同属性同取值）；`undefined` → `void 0`（同一个值）。另有两处结构性改动同样等价：`eval.runner` 用 `Object.assign` 写 readonly 字段（同对象同字段）、`good-state-diary.e2e` 的 `params?.[k]`（调用点在 `Object.keys(params ?? {})` 循环内，params 必非空）。**未改任何断言期望、mock 返回值、用例逻辑；用例数量 3252 例 / 194 文件与基线逐字一致。**

### 与任务单的 3 处偏差（已写进交付记录 §三）

1. **TS2688 修法**：任务单写 `types=` → `path=`；实际**删掉那 4 行冗余引用** —— `path=` 会被 `@typescript-eslint/triple-slash-reference` 判 error，而根 tsconfig 的 `include` 本来就含 `typings/global.d.ts`（其余 bin 脚本从来也没这行）。
2. **TS7027**：`--help` 分支删 `break` 会落进 `default` 触发 `no-fallthrough` → 改 `return process.exit(0)`（`process.exit` 返回 `never`，既不落 default 也无不可达代码，运行时进程照样退出）。
3. **36 处 `undefined` 实参**：生产首参是必填的 `T | undefined`，TS 要求显式传参，但 `unicorn/no-useless-undefined` 只看"最后一个实参是不是 undefined 标识符"就判没用 —— 两个工具结论相反，改写成 `void 0`（编译期类型仍是 undefined、运行时同一个值）。另顺带删掉 `good-state-diary.e2e` 里 18 处已退化成"同类型断言"的 `as HttpResponse`（supertest 改 default import 后链式调用自带类型）。

### 保留条目：0 条

401 条全部在测试层收敛，**没有任何一条需要改生产契约**（`src/` 非 spec 生产文件零改动）。另有 **7 个生产契约演进点**建议生产侧后续核对（列在交付记录 §五，如 `DeliberationOutput` 新增必填 `intentionShift`、`VoiceTurnBackendTurnOptions.userId` 实为可选语义、`RiskProbeResult.categories` 口径只收来访侧类别、实体后加列导致夹具漂移），不阻塞本单交付。

### 交付物

- 交付记录：`docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md`
- 任务单已归档：`docs/worklog/completed/phase2.5/td5-type-debt-clearing-task-2026-11-13.md`（状态行 ✅、DoD 全勾）
- 索引回写：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` TD-5 行、`docs/worklog/pending/phase2.5-README.md` §2 TD-5 行（均已指向归档后的任务单 + 交付记录）
- 改动面：**89 文件 / +508 −452**，无新增仓库文件、无删除文件。

### commit 草稿（未提交，等你指令）

```
refactor(test): 清零根 tsconfig 既有类型债（spec/e2e/bin 类型对齐，零运行时变化）
docs(worklog): TD-5 类型债清零任务单 / 交付记录与索引回写
```

### 两点如实说明

- `pnpm test:e2e` **未跑**：需要 DB / 服务环境，本机不可达（e2e 文件也不在 `pnpm test` 执行集内）。e2e 相关改动全部是类型层，运行时逻辑一行未动 —— 不 silently skip，已如实登记在交付记录闸门 6。
- 全量 `pnpm test` 跑了 1 次（墙钟 121.1s），未重复刷基线；定向用例数未单列，沿用全量口径。
