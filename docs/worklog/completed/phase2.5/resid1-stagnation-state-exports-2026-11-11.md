# RESID-1 · runner 状态接口类型导出，清 stagnation-calibration.ts 残留 TS2459（交付记录）

> **状态**：✅ 已交付 · **日期**：2026-11-11 · **分支**：integrate · **执行方**：MiniMax Code
> **任务单**：[phase2.5-resid1-stagnation-state-exports-2026-11-11.md](../../pending/phase2.5-resid1-stagnation-state-exports-2026-11-11.md)
> **任务性质**：bug 修复（类型可见性）· **运行时行为变化**：**零**

---

## 一、本单做了什么

给 `src/auto-practice/practice-runner.service.ts` 的两个状态接口（`CrisisWindowState` / `StagnationState`）加上 `export`，清掉 `scripts/ops/calibration/stagnation-calibration.ts` 导入这两个类型时的 **2 个 TS2459**；并在既有 runner spec 里补一条**类型投影护栏**，让"导出"这件事本身可测。接口字段与 `decideTurn` 判定逻辑**逐字未改**。

---

## 二、实际改动 vs 任务单方案

### 2.1 偏差 1 · 脚本侧类型检查命令需加 `--ignoreConfig`

- **任务单 §5.2 给的命令**：`pnpm exec tsc --noEmit --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 --strict scripts/ops/calibration/stagnation-calibration.ts`
- **实测**：该命令在 **TypeScript 6.0**（本仓 `typescript: ~6.0.0`）下**直接失败**，报：

  ```text
  error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline.
  Use '--ignoreConfig' to skip this error.
  ```

  exit 1 —— **一条类型错误都没跑到**，无法作为闸门。

- **处置**：命令补上 `--ignoreConfig`（TS 6.0 对"命令行直接给文件"的强制要求）。**这是命令形式修正，不是检查口径变更** —— 其余 flag 与任务单逐字相同。

### 2.2 偏差 2 · 该命令会带出 112 个**与本单无关**的既有错误

补 `--ignoreConfig` 后，命令能跑了，但除了目标 2 个 TS2459，还会带出 **112 个既有错误**（总量 114）。它们全部是"用命令行 flag 单跑一个文件"与项目 tsconfig 不一致造成的**工具性产物**，逐类如下（**单列记录，不计入本单回归**）：

| 类别               | 典型错误码      | 根因                                                          | 条数                                                 |
| ------------------ | --------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| NestJS 装饰器      | TS1206 / TS1240 | 命令行未开 `experimentalDecorators` + `emitDecoratorMetadata` | ~95（实体类 / service 的 `@Column` / `@Injectable`） |
| `toSorted` 不存在  | TS2550          | 命令行 `--target ES2022` → lib 未含 es2023                    | ~8                                                   |
| 隐式 any           | TS7006          | 上一条的连带（回调参数类型退化成 any）                        | ~9                                                   |
| 小计（非本单引入） | —               | —                                                             | **112**                                              |

> **口径说明**：这 112 条**改动前后完全一致**（114 → 112，减少的 2 条正是本单目标）→ 本单**未引入任何新错误**。M-4 决策（scripts 不进任何 tsconfig，维持现状）依然有效，本单**不为此新增 tsconfig**。

---

## 三、改动文件清单

| 文件                                           | 改动                                                                                                                                                    | 行数                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `src/auto-practice/practice-runner.service.ts` | `interface CrisisWindowState` → `export interface CrisisWindowState`（:165）；`interface StagnationState` → `export interface StagnationState`（:1070） | **2 行**（各加 1 个 `export` 关键字） |
| `test/auto-practice/practice-runner.spec.ts`   | import 增加 `decideTurn` + 两个类型；文件尾新增 `describe('RESID-1 · runner 状态接口类型导出')` **2 个用例**                                            | +25 行                                |

> **接口字段逐字未改**：`CrisisWindowState` 与 `StagnationState` 的字段、类型、可空性一字未动；`decideTurn`（:1129）的签名与判定逻辑一字未动。

---

## 四、闸门表（真实数字）

### 4.1 日常内循环

| 命令                                                              | exit code | 真实数字                                                       |
| ----------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `pnpm exec vitest run test/auto-practice/practice-runner.spec.ts` | **0**     | **1 文件 / 13 用例全绿**（改动前 11 例 + 本单新增 2 例）       |
| `pnpm lint`（`--cache`）                                          | **0**     | **0 error / 2 warning**（既有 `import/order`，本单未碰该文件） |
| `pnpm exec tsc -p tsconfig.build.json --noEmit`                   | **0**     | **0 error**                                                    |

### 4.2 任务特有闸门 · 脚本侧类型检查（TS2459 消除证据）

命令（见 §2.1 的偏差说明）：

```text
pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 --strict scripts/ops/calibration/stagnation-calibration.ts
```

| 指标                                                          | 改动前 | 改动后 | 判定                                                            |
| ------------------------------------------------------------- | ------ | ------ | --------------------------------------------------------------- |
| **指向 `CrisisWindowState` / `StagnationState` 的 TS2459 数** | **2**  | **0**  | ✅ **任务单要求 = 0，达到**                                     |
| 错误总数                                                      | 114    | 112    | ✅ 差值 **= -2**（恰好是本单目标的 2 条）→ **未引入任何新错误** |
| 与本单无关的既有错误                                          | 112    | 112    | ✅ 单列记录，不计入本单回归（§2.2）                             |

**改动前的两条原始报错**（留证）：

```text
scripts/ops/calibration/stagnation-calibration.ts(25,27): error TS2459: Module '"../../../src/auto-practice/practice-runner.service.js"' declares 'CrisisWindowState' locally, but it is not exported.
scripts/ops/calibration/stagnation-calibration.ts(25,51): error TS2459: Module '"../../../src/auto-practice/practice-runner.service.js"' declares 'StagnationState' locally, but it is not exported.
```

> **前后对比方法**：把两个 `export` 临时还原 → 跑同一条命令 → 计数 → 再改回来 → 复跑 → 计数。两次计数均记录在案（114/2 与 112/0），**不是靠推断**。

### 4.3 收尾全量闸门

| 闸门        | 命令                                            | exit code | 真实数字                                                      |
| ----------- | ----------------------------------------------- | --------- | ------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **0**     | **0 error**                                                   |
| Lint        | `pnpm lint`（`--cache`）                        | **0**     | **0 error / 2 warning**（既有）                               |
| 测试        | `pnpm test`                                     | **0**     | **181 文件 / 2949 例**：**2945 passed + 4 skipped，0 failed** |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | **0**     | **空**                                                        |

---

## 五、零行为变化证据

1. **改动性质**：只在两个 `interface` 前加 `export` 关键字。TypeScript 的 `export` 是**纯编译期可见性修饰符** —— 不产生任何运行时符号、不改变类的形状、不影响装饰器元数据、不改变 `decideTurn` 的任何分支。
2. **既有 spec 数字**：runner spec 改动前 **11 例**全绿 → 改动后 **13 例**全绿（新增 2 例是纯类型投影断言，**不产生新的运行时路径**）。
3. **全量套件**：0 failed，用例总数只因本单新增 2 例而 +2。
4. **脚本侧类型检查**：错误总数只减 2（正是本单目标），其余 112 条逐条不变。

---

## 六、回归风险

- ✅ **未碰 engine-core**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 未改、未跑（本单无内核改动）。
- ✅ **未碰 schema / migration / DB**：无 DDL、无写库操作。
- ✅ **未碰阈值 / 判定逻辑**：`decideTurn`、停滞与危机阈值一字未动。
- ✅ **未碰内容字段**：无任何字段增删改。
- ✅ **未碰 prompt / 前端 / Flutter**。
- ✅ **心理对话原文零外泄**：本记录无任何会话内容。
- ✅ **未自动 commit / push**。

---

## 七、遗留项

1. **scripts tsconfig（M-4 维持现状）**：本单**不改变**该决策 —— scripts 仍不进任何 tsconfig，因此那 112 条工具性错误在项目正式闸门里**不会**出现（它们只在本单这条"单文件直跑"的临时命令下出现）。**已知并接受**，沿用 WP-M 结论。
2. **既有前端 51 条 vue-tsc 类型债**：与本单无关，不在本单清理（沿用 WP-N-FE §遗留 #4）。

---

## 八、commit message 草稿（**不自动提交**）

```
fix(auto-practice): 导出 CrisisWindowState / StagnationState，清 stagnation-calibration 的 2 个 TS2459
```
