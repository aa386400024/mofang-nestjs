TD-8 已闭环：三条 CI 工具链遗留全部落地，代码级唯一改动是 `.github/workflows/ci.yml`，生产面零改动、engine-core diff 空。

## 整改结果

**C-1 · CI 包管理 npm/npx → pnpm 对齐**

三个 job（`lint-and-typecheck` / `test` / `security-audit`）统一改为 corepack 装 pnpm（与 Dockerfile 逐字一致）+ `pnpm install --frozen-lockfile`：

| 原写法                                    | 改为                                                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| `npm ci`                                  | `pnpm install --frozen-lockfile`                            |
| `npm run lint`                            | `pnpm lint`                                                 |
| `npx tsc --noEmit -p tsconfig.json`       | `pnpm exec tsc --noEmit -p tsconfig.json`（原参数逐字保留） |
| `npm run migration:run`                   | `pnpm migration:run`                                        |
| `npm test`                                | `pnpm test`                                                 |
| `npm run test:e2e`                        | `pnpm test:e2e`                                             |
| `npm audit --audit-level=high --omit=dev` | `pnpm audit --audit-level=high --prod`                      |
| `cache: 'npm'`（setup-node 内置）         | 移除 → 独立 `actions/cache@v4` 缓存 `~/.pnpm-store`         |

- tsc 未换成 `pnpm typecheck`（那是 `tsc -b tsconfig.check.json`，属不同检查面），保持原参数逐字不变。
- `pnpm audit` 侧本机实测 pnpm **无 `--omit=dev` 参数**（照抄会报未知选项使 job 失败），`--prod` 是语义等价项（只审 dependencies + optionalDependencies），`--audit-level=high` 两边同名同义、逐字保留。
- 每个 job 新增 `Resolve pnpm version`（`pnpm --version`）步骤。

**C-2 · 移除无效 coverage 上传步骤**

删掉 `test` job 的 `Upload coverage` 步骤（`if: always()` + `actions/upload-artifact@v4` + `name`/`path` 四行整体）。依据：`test` 脚本无 `--coverage`、`vitest.config.mts` coverage 段只有 include/exclude 无 provider/reporter → `coverage/` 根本不生成。**vitest.config.mts 未动**。

**C-3 · 持久化 pnpm store 与 vitest 转换缓存**

- pnpm store：3 个 job，path `~/.pnpm-store`，key `pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`，restore-keys 前缀回落。
- vitest 转换缓存：**仅 `test` job**（另两个 job 不跑 vitest），path `node_modules/.vite/vitest`，key `vitest-transform-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`。
- 不缓存 `node_modules` 本体；`coverage/`、`.eslintcache` 等运行产物不入缓存。缓存 key 以 `pnpm-lock.yaml` 哈希为真相源，锁变即必然失效，不存在「key 未变但内容过期」。

## 闸门（实跑）

| 命令                                                                    | exit | 结果                                                                   |
| ----------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | 0 error                                                                |
| `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0    | 0 error                                                                |
| `pnpm lint`                                                             | 0    | 0 error / 0 warning                                                    |
| `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | 12 passed / 12                                                         |
| `pnpm exec vitest run test/engine-core`                                 | 0    | 23 文件 / 461 例全绿                                                   |
| `pnpm test`（全量）                                                     | 0    | 193 passed / 1 skipped（194 文件）；3248 passed / 4 skipped（3252 例） |
| `pnpm doctor:fs`                                                        | 0    | 均值 0.12 ms/文件，warm slow=0                                         |

全量墙钟：首跑 84.4s（跑闸门期间机器上有用户侧 `pnpm start:dev` / `nest start --watch` / vite 并行进程，本单全程未启动任何 dev/watch 命令），终态复跑 **76.7s** 回到基线量级。

yml 静态自检：`yaml.parse` 通过 → jobs = lint-and-typecheck(8 steps) / test(10) / build(4) / security-audit(8)；`needs`、`env:`(14 项)、`services:`(mysql + redis)、Trivy、Docker 步骤全部保留；4 个脚本名 4/4 存在于 package.json；npm / npx / `cache: 'npm'` / `Upload coverage` 残留 **0 命中**。

红线核验：`git diff --stat HEAD -- src/engine-core` → 空；`git diff --name-only HEAD -- src test bin scripts admin-dashboard` → 0 个文件。

## 改动清单

- `.github/workflows/ci.yml` —— 唯一代码级改动，CRLF 行尾保持
- `docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md` —— 新建交付记录（10 章）
- `docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-task-2026-11-13.md` —— 任务单归档（✅ / DoD 7/7 全勾）
- `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` —— §四 TD-8 行 → 完成态
- `docs/worklog/pending/phase2.5-README.md` —— §3.0 TD-8 行 → 完成态
- `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md` —— 新增「TD-8 · CI 侧工具链遗留三条」小节
- `docs/team/gate-performance-remediation-2026-11-11.md` —— §9 P-DEBT-5 改为 🟡 部分落地（缓存 + CI 侧 pnpm 统一已交付，分片另案）

工作区：`git diff --stat HEAD` = **5 files changed, +83 −23**，另有 2 个新增未跟踪文档；6 个文档共 210 条相对链接全部可达、零断链。

## 遗留（已登记，等你拍板）

1. **D-a 双锁去留**：`package-lock.json` 按任务单默认保留未删，仅登记「建议移除 npm 锁」。
2. **D-b coverage 采集**：是否补 provider/reporter/阈值门禁 → 登记为后续建议。
3. **CI 侧待复核**：本机跑不了 GitHub Actions，交付记录**未写「CI 已通过」**，CI 结果留待 push 后在 Actions 复核；另本机 `corepack` 不在 PATH，corepack 路径无法本地端到端复现。
4. `pnpm audit` 依赖 registry 可用性，CI 上可能出现网络抖动。
5. **P-DEBT-5 分片（shard 矩阵）不在本单范围**（未授权且会改变测试执行拓扑），另案处理。
6. 全量闸门未发现新缺陷。

## commit 草稿

```
ci(workflow): TD-8 CI 包管理对齐 pnpm · 清理无效 coverage 步骤 · 持久化依赖与 vitest 缓存（零 src 改动）
docs(worklog): TD-8 任务单 / 交付记录与索引回写
```

未执行 commit / push，等你手动提交。

已写入文件
