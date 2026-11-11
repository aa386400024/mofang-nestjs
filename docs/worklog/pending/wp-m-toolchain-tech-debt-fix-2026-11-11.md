# WP-M · 工程工具链技术债治本修复（修复）

> 状态：📋 待执行（2026-11-11）
> 执行方：MiniMax Code
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`（技术债清单 TD-1 / TD-2 / TD-3）
> 任务性质：工具链 / 性能修复（**不碰业务代码，不碰 engine-core**）

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（**命令规范 §1.3 / §2.1：优先 pnpm、禁止裸 npx**）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md`
5. **本任务唯一事实源：`docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`**
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

WP-K / WP-L 收尾提交（commit `401a5a2`）时被 husky 的 lint-staged 拦了一次，排查出工具链条上有四处技术债。当时只做了**治标**：

- 给 `eslint.config.mjs` 的 `scripts/**/*.ts` 加了 `disableTypeChecked` override，解决 `was not found by the project service` 解析错误；
- 顺手把 `enqueue-p4-batch.ts` 的 `process.exit(1)` 改成 `process.exitCode = 1`。

**治本还没做。** 本任务就是把剩下的四处一次性收干净。

### 1.1 关键新发现（本次核查实测，务必看）

`.husky/commit-msg` 里有一句：

```sh
npx --no -- commitlint --edit "$1" 2>/dev/null || { ... 打印格式提示 ... }
```

两个问题叠加：

1. **`@commitlint/cli` 根本没装**（`node_modules/@commitlint/cli` 不存在，`package.json` 里也没有该依赖）。所以这句**每次都必然失败**，只能走 `||` 后面的 fallback 打印提示 —— 也就是说，格式校验从未真正生效，只打印了提示。
2. **这句用的是裸 `npx`，每次 commit 白等约 13 秒**。实测三次（本机，PowerShell 计时）：

   | 次数              | 耗时          |
   | ----------------- | ------------- |
   | 第 1 次（冷启动） | **19 630 ms** |
   | 第 2 次           | **13 487 ms** |
   | 第 3 次           | **13 376 ms** |

   稳定开销约 **13.4 秒/次提交**。也就是说，现在每敲一次 `git commit`，都会在真正开始 lint-staged 之前先空转 13 秒去等一个注定失败的 `npx` 调用。而 lint-staged 本身要跑几十秒到几分钟 —— 这 13 秒是纯浪费，且和用户「被速度逼疯」的诉求直接冲突。

   > 这既是**性能问题**，也是**规范问题**（项目已三处固化「优先 pnpm、禁止裸 npx」：个人偏好 `p1_AQDtTEYD5vM`、`wp-task-template.md` §5.0、`conventions.md` §1.3/§2.1），还是**功能问题**（格式校验形同虚设）。

### 1.2 关键现状（已核对，别当新问题）

- husky 实装 `9.1.7`；lint-staged 实装 `15.5.2`。
- `package.json` 的 `lint` 脚本范围是 `"{src,test,bin}/**/*.ts"` —— **不含 `scripts/`**。所以 `pnpm lint` 不会查 scripts，只有 lint-staged 对**暂存的** .ts 跑 `eslint --fix` 时才会碰到。
- `scripts/` 下 5 个历史文件当前是 clean 的（未改动 → 不进 lint-staged → 不阻塞）。**但一旦改动其中任一文件并提交，就会被这 67 个存量问题拦住**（WP-K/WP-L 时的拦截就是这么触发的）。
- `scripts/ops/quality/visitor-quality-lexicon.ts` 被 `test/quality/p1d-visitor-quality-lexicon.spec.ts` import，经 test 拉进根 tsconfig project；其余 4 个是纯独立脚本（tsx 直跑，不进 build）。
- `tsconfig.build.json` 的 `rootDir=src` 且显式 `exclude: ["bin/**/*"]` —— **不要把 scripts 塞进 build**，那会破坏产物边界。

---

## 2. 范围（严格遵守，不越权）

**在范围内 —— 四处，逐条闭合：**

- **M-1 · 清理 `.husky/commit-msg` 的 husky 旧格式两行**
  删除文件顶部：

  ```sh
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"
  ```

  husky 9.1.7 已废弃该写法，v10 会直接失败。删除后确认钩子仍能正常触发（见 §5.3 验证方法）。

- **M-2 · 干掉 commit-msg 里的裸 npx，并让格式校验真正生效（核心提速项）**
  目标：**不再用裸 npx，且每次 commit 不再白等 13 秒**。
  推荐做法（**零新增依赖、微秒级**）：把那句 `npx --no -- commitlint ...` 整段换成**纯 shell 正则校验** conventional commit 前缀，例如用 `grep -Eq` 匹配 `^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\(.+\))?: .+`，不匹配则打印现有那套提示并 `exit 1`（或在确认采取「只提示不阻断」策略时 `exit 0` 并打印提示 —— **二选一，在交付记录里写明并说明理由**）。
  约束：不得引入 `@commitlint/cli` 除非你评估后认为必须（若引入，必须走 `pnpm exec`，并在交付记录里给出引入理由与每次提交的实测耗时增量）。

- **M-3 · 清理 `scripts/` 下 5 个文件的 67 个存量 lint 问题**
  涉及文件与当前问题数（实测 `pnpm exec eslint "scripts/**/*.ts"` → 65 error + 2 warning，其中 41 可自动修复）：

  | 文件                                                                                                                                                                                                                                                     | 主要问题                                                                                                                                                                                                                                                      |
  | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `scripts/eval-runner.ts`                                                                                                                                                                                                                                 | `unicorn/import-style`、`unicorn/no-exports-in-scripts`×3、`unicorn/no-array-sort`、`sonarjs/no-nested-conditional`                                                                                                                                           |
  | `scripts/ops/calibration/stagnation-calibration.ts`                                                                                                                                                                                                      | `import/order`(w)、`prettier/prettier`                                                                                                                                                                                                                        |
  | `scripts/ops/quality/seed-verbal-voice.ts`                                                                                                                                                                                                               | `prettier/prettier`×多、`sonarjs/no-hardcoded-ip`、`@typescript-eslint/array-type`×2、`unicorn/no-process-exit`                                                                                                                                               |
  | `scripts/ops/quality/visitor-quality-audit.ts`                                                                                                                                                                                                           | `complexity` 49/53（上限 20）、`sonarjs/cognitive-complexity` 37/91（上限 25）、`prettier/prettier`×多、`array-type`×3、`unicorn/prefer-set-has`×2、`unicorn/no-array-sort`×5、`unicorn/no-negated-condition`×2、`unicorn/consistent-existence-index-check`×3 |
  | `scripts/ops/quality/visitor-quality-lexicon.ts`                                                                                                                                                                                                         | `max-len`×5、`prettier/prettier`×5                                                                                                                                                                                                                            |
  | 做法：先 `pnpm exec eslint --fix "scripts/**/*.ts"` 吃掉可自动修复的 41 个；剩余手工修。**复杂度超标的两个函数（`auditSession`、`main`）需要拆分，属本项主要工作量** —— 拆分时保持行为不变、不改变输出口径（这些脚本产出的是审计报告，数值口径不能变）。 |
  | **红线：`visitor-quality-lexicon.ts` 的词表内容一个字符都不许改**（它是被单测消费的单一真相源，改内容会连带 test 失败）；只允许改格式/换行。                                                                                                             |

- **M-4 · 把「scripts 不在任何 tsconfig」这件事交代清楚（可不做，二选一写进交付记录）**
  当前用 `eslint.config.mjs` 的 `disableTypeChecked` 兜住了。可选：新增一个 `scripts/tsconfig.json`（只给编辑器/IDE 用，不参与 build、不被 eslint project service 读取 —— 注意 project service **只认名为 `tsconfig.json` 的文件**，见官方文档），或维持现状。**维持现状也是合理选择，但必须在交付记录里明确说明「已知并接受」**。

**明确不在范围内（禁止顺手做）：**

- 不动 `engine-core/` 任何文件（`boundary.spec.ts` 不许改）。
- 不动业务代码（`src/`）、不动测试断言、不动数据库 / migration。
- 不升级 husky / lint-staged 大版本（仅删旧格式两行 + 改钩子内命令）。
- 不改 `package.json` 的 `lint` 脚本范围去把 `scripts` 纳入（会把 67 个存量问题带进日常 lint，反而更慢）。
- 不改 admin-dashboard、不改 Flutter 前端仓库。
- 不自动 `git commit` / `push`（写完给 commit 草稿，等大炮指令）。

---

## 3. 交付物

- **交付物 1：`.husky/commit-msg` 重写** —— 删旧格式两行；去掉裸 npx；改为纯 shell 格式校验（或明确说明为何保留 commitlint 且改用 pnpm exec）。
- **交付物 2：`scripts/` 5 个文件 lint 全绿** —— 目标 `pnpm exec eslint "scripts/**/*.ts"` → **0 error 0 warning**（若个别规则确需豁免，只允许**文件内 `eslint-disable-next-line` + 注释说明原因**，禁止改全局 eslint 配置放宽规则；`sonarjs/no-hardcoded-ip` 若是真实 dev 环境 IP，优先改为读 `process.env`）。
- **交付物 3：性能实测对比** —— 提交前 vs 提交后，`git commit` 从「hook 开始到 lint-staged 开始」的耗时对比（可用 `time` / PowerShell `Stopwatch` 测 commit-msg 钩子单独执行耗时）。
- **交付物 4：技术债清单回写** —— 更新 `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`，把 TD-1 / TD-2 / TD-3 标为已处理并注明 commit。

---

## 4. 红线（违反即返工）

- **命令一律走 pnpm，禁止裸 npx**（本次修复的核心动机之一，改完的钩子自己也不许留 npx）。
- 心理对话原文禁止进日志 / console / crash report（本轮基本不涉及，但若动 `visitor-quality-audit.ts` 的打印逻辑，只出计数与布尔）。
- **`visitor-quality-lexicon.ts` 的词表字符串内容零改动**。
- 审计脚本的输出口径（各百分比 / 命中率 / 计数）在重构后必须逐字一致，重构前后各跑一次对比。
- 不动 `engine-core/`、不改 schema、不加依赖（M-2 引入 commitlint 需先说明理由）。
- 不自动 commit / push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范（强制）

- 跑脚本用 `pnpm <script>`；跑二进制用 `pnpm exec <bin> <args>`。**禁止裸 npx。**

### 5.1 日常内循环（改一处验一处）

- 单文件 lint：`pnpm exec eslint "scripts/ops/quality/visitor-quality-audit.ts"`
- 全 scripts lint：`pnpm exec eslint "scripts/**/*.ts"`
- 词表单测（防止误改内容）：`pnpm exec vitest run test/quality/p1d-visitor-quality-lexicon.spec.ts`

### 5.2 收尾闸门（整单跑一次）

| 闸门         | 命令                                                                    | 要求                                               |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------- |
| scripts lint | `pnpm exec eslint "scripts/**/*.ts"`                                    | **0 error 0 warning**                              |
| 词表单测     | `pnpm exec vitest run test/quality/p1d-visitor-quality-lexicon.spec.ts` | 全绿（证明词表内容未被改）                         |
| 主 lint      | `pnpm lint`                                                             | 0 error（本单未改 src/test/bin，预期与改动前一致） |
| 类型         | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                            |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | **空**                                             |
| 钩子实测     | 真跑一次 `git commit`（可用一个空 commit 或 docs 小改动验证）           | 钩子正常触发、无 npx、无 13 秒空转                 |

### 5.3 钩子验证方法（避免踩坑）

- husky 9 的钩子由 `core.hooksPath` 指到 `.husky/_`，改完 `.husky/commit-msg` 后**不需要** `pnpm prepare` 重装，但要确认 `git config core.hooksPath` 输出为 `.husky/_`。
- 验证方式：造一个不影响仓库的小提交（例如临时追加一行到某 docs 文件后提交，再 `git reset --soft HEAD~1` 撤回），观察提交耗时与钩子行为；或直接单独执行 `sh .husky/commit-msg` 传一个测试消息文件。

---

## 6. 交付记录（完成后写，路径固定）

写完到：`docs/worklog/completed/phase2.5/wp-m-toolchain-tech-debt-fix-implementation-2026-11-11.md`

必须含：

1. 一句话总结；
2. 方案设计：实际实现 vs 本任务单方案，有偏差写清原方案 / 实际方案 / 为什么（conventions §2.5）；
3. 改动文件清单（逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字；
5. **性能实测对比**：commit-msg 钩子改造前（约 13.4s）vs 改造后真实耗时；
6. 风险与回归：确认 `visitor-quality-lexicon.ts` 词表零改动、审计输出口径逐字一致、未碰 engine-core；
7. 遗留项与建议人工复核。

---

## 7. 【交付回写清单】做完逐项勾选（不许跳）

- [ ] 交付记录已写到 §6 的固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改成 `✅` 并链接交付记录
- [ ] 回写 WP 登记表 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 本任务行状态
- [ ] 回写阶段入口 `docs/worklog/pending/phase2.5-README.md` §3.0
- [ ] **回写技术债清单 `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md`，TD-1/TD-2/TD-3 逐条标状态**
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 给一行 commit message 草稿（**不自己 commit/push**）

---

## 8. 回复输出约定

1. 说一句「已写入交付记录」并附路径，不重复贴全文；
2. 报告闸门真实数字（scripts lint / 词表单测 / tsc / 钩子实测耗时）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不要贴 diff 全文，让大炮自己 `git diff`。
