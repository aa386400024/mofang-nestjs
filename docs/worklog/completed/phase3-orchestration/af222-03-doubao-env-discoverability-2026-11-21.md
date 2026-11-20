---
taskId: AF-222
contextId: phase3-orchestration-hardening
type: documentation
agentRole: executor
baselineRef: f32b62b
completedAt: 2026-11-21T02:25:00+08:00
commitMessage: 'feat(af221): 跨机编排硬化批次（子项 03）'
---

> **批次说明**：本记录是 **AF-222 批次**的子项 03（豆包 provider 可发现性）。迁移前编号为 AF-219；该号因与另一台机器的 AF-213/AF-214 撞号、且并发 claim 被调度器闭合为 rejected，内容以 AF-222 单任务重放。文内出现的旧编号与旧提交 SHA 均属迁移前历史，实际实现以本批次提交为准。

# AF-222 子项 03 交付记录：豆包 provider 在部署契约里的可发现性

## 1. 为什么做这一单

AF-210 把豆包接成引擎的第二个 provider，AF-218 建了跨机密钥交接规程。但两件事在实际交接时都没有落点：

- 新人/另一台机器打开 `.env.example`，只看到 `LLM_DOUBAO_API_KEY=` 一行空键，不知道 endpoint、哪些模型 ID 现在有效、哪些旧别名已经 404；
- `ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>` 这层按档位覆盖模型的能力，代码里有、模板里一个字都没有，等于隐形能力；
- 交接时"另一台机器知道本机已经配了"的唯一可核验路径（`pnpm env:doctor --keys ...` + `docs/security/secret-handoff.md`）没有在部署契约里被指出来。

本单只补可发现性，不动任何键与默认值。

## 2. 改动

| 文件           | 改动                                                                                                                              | 性质   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `.env.example` | 在 `LLM_DOUBAO_API_KEY=` 后新增 8 行豆包口径注释（endpoint / 现行有效模型 ID / 已下线 404 别名 / 跨机交接指向与验收命令）         | 纯注释 |
| `.env.example` | 在 `ENGINE_RENDER_FALLBACK_PROVIDERS=` 后新增 6 行 `ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>` 说明（用法、枚举、为什么不写成生效行） | 纯注释 |

`git diff --stat`：1 file changed, 15 insertions(+), 0 deletions(-)，全部为 `#` 注释行。

生效键集合零变化，取证：

```
node -e "…parseEnvKeys(HEAD:.env.example) vs parseEnvKeys(worktree:.env.example)…"
before 278  after 278
missing []  extra []
```

## 3. 关键设计决策

### 3.1 覆盖键只能写注释，不能写生效行

`ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>` 在代码里是模板字符串拼出来的键（`this.text(...)` / `\`ENGINE_RENDER_${kind}_MODEL_${provider}\``）。wp25 守卫（`test/config/wp25-env-example-coverage.spec.ts`）用 AST 反查"模板里的生效行必须有读取点"，字面量抽取拿不到模板字符串，写成生效行就会被判成 orphan（"配了不生效"），守卫会红。

所以两者只能二选一：要么把读取点改成 `export const` 常量让 AST 能看见（动代码，超出本单 scope 且属结构性改动），要么在模板里只写注释。本单选后者，并把"为什么不是生效行"写进注释本身，避免下一个人好心把它改成生效行再踩一次。

### 3.2 注释里写死已下线别名

`doubao-lite` / `doubao-pro-32k` / `doubao-pro-128k` / `doubao-seed-2-1-lite-260628` / 裸名 `doubao-seed-2-1-lite` 在方舟侧已下线，实测运行期 404。这些名字在旧文档、旧截图、甚至模型自述里仍大量存在，写进模板是让下一个人在配 key 的同一步就看到，而不是等 404 再回来查。

### 3.3 交接口令与规程一起挂到键上

注释里直接给出两条可执行线索：`docs/security/secret-handoff.md`（六步流程 + 回执模板）和 `pnpm env:doctor --keys LLM_DOUBAO_API_KEY,ENGINE_RENDER_FALLBACK_PROVIDERS`（AF-218 的关键键子集校验，缺失/留空一律 error）。这样"另一台机器是否已配"从口头确认变成一条可复现命令输出。

## 4. 闸门

| 闸门         | 命令                                                                 | 结果                                                                               |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 部署契约守卫 | `pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts` | 1 file / 11 tests passed                                                           |
| 键集零漂移   | `parseEnvKeys` 对比 HEAD 与工作区                                    | 278 → 278，missing=[] extra=[]                                                     |
| lint         | `pnpm lint`                                                          | exit 0，0 error                                                                    |
| typecheck    | `pnpm typecheck`                                                     | exit 0，0 error                                                                    |
| 全量测试     | `pnpm test`                                                          | 238 passed + 1 skipped（239 files）／4083 passed + 7 skipped（4090 tests），81.41s |
| 纯层红线     | `git diff --stat HEAD -- src/engine-core`                            | 空                                                                                 |
| 编排契约     | `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`               | PASS                                                                               |

机器：DESKTOP-6U804B0 / Windows / PowerShell 7.6.4 / node v26.13.0 / pnpm 9.15.0。

## 5. 与任务单的偏差

任务单原始前提是"`.env.example` 未补新 env 键 `LLM_DOUBAO_API_KEY` / `ENGINE_RENDER_FALLBACK_PROVIDERS`"。核实后该前提不成立：两键的生效行早已在模板里（约 L182 / L838，属 AF-210 一并落地的部分）。真实缺口只在注释层，因此本单范围收敛为"补注释"，不新增任何键、不改默认值。AF-218 回执里的 `BL-AF214-02`（"模板未声明 doubao 两键"）属误判，应在 backlog 侧按"已核实为不成立"关闭，而不是留在台账里重复触发后续任务。

## 6. 提交

本子项随 AF-222 批次单次提交进入 `integrate`。
