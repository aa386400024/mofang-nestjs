# AF-222 子项 02 交付记录 · 记录包字节完整性与密钥卫生

- 任务：AF-222（批次子项 02，`phase3-orchestration-hardening`，orchestrator）
- 基线：`df4c772`（AF-217 归档状态面）
- 角色：orchestrator（资源域：`.prettierignore` + `scripts/` + `docs/security/` + `package.json` + `docs/worklog/`）
- 交付日期：2026-11-21

## 1. 问题与根因

| 缺口                   | 现场表现                                                                          | 根因                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 记录包字节被格式化改写 | AF-212 交付时 `manifest.receipts[].sha256` 与 `worklog verify` 失配，只能手工重算 | `lint-staged` 的 `*.{json,md,yml,yaml}` 对暂存的 `docs/worklog/records/**` 跑 `prettier --write` |
| 密钥分发无规程         | 豆包 key 只在本机 `.env`，另一台靠人工记忆填；「配没配」没有可验证现场            | 无体检工具、无交接回执                                                                           |
| `.env` 入库风险无门禁  | `.gitignore` 已忽略，但没有交付前主动确认                                         | 缺一条 `env:doctor` 命令                                                                         |

## 2. 改动文件

新增：

- `scripts/security/env-doctor.mjs` — 环境变量体检（解析 / 差集 / 判定为纯函数，值永不输出）
- `scripts/security/__tests__/env-doctor.spec.mjs`（17 例）
- `docs/security/secret-handoff.md` — 跨机密钥交接规程（三方案对比、六步流程、回执模板、轮换/吊销）

修改：

- `.prettierignore` — 新增 `docs/worklog/records/`（记录包是审计制品，字节即证据）
- `package.json` — 新增 `env:doctor` 入口

## 3. 关键设计决策

1. **格式化隔离放在 `.prettierignore`，不改 lint-staged 配置**：一个漂移点比两个好；prettier 对显式传入但被 ignore 的路径同样跳过，pre-commit 链路自然生效。
2. **「误报治理」是 env-doctor 的核心设计**：只用键名正则会把 `REDIS_KEY_PREFIX`、`APPLE_KEY_ID`、`PASSWORD_TTL_MIN`、`ENGINE_SUPERVISION_MAX_TOKENS` 全部误判成密钥（现场首跑 13 个 error 全是误报）。最终规则是**键名语义 + 值形态双判**：
   - 键名必须命中密钥语义（`SECRET` / `API_KEY` / `ACCESS_KEY` / `PRIVATE_KEY` / `CLIENT_SECRET` …），且不命中数值/标识后缀（`_TTL`、`_MAX_`、`_KEY_ID`、`_PREFIX` …）；
   - 值若分类为 `number` / `bool`，无论键名多像都不判泄漏。
3. **模板里的明确占位值只记 info**：`JWT_SECRET=xin-su-dev-secret-change-in-production-…` 是设计上的开发占位，判定为 `ENV_EXAMPLE_PLACEHOLDER_VALUE`（info），只有非占位值才报 `error`。
4. **批量 finding 默认折叠**：本机 `.env` 实配 104 键、模板 278 键，逐条打印会产生 200 行噪声。缺键 / 多余键 / 空值三类默认只打一行计数 + 5 个样例，`--verbose` 展开；结构性告警（跟踪、模板缺失、模板泄漏）永远逐条打印。
5. **交接验收用 `--keys` 关键键子集**：`--keys A,B` 命中的键缺失或留空一律 error（不受 `--strict` 影响），这是「另一台机器配没配这一把」的可验证口径，也是交接回执的校验命令。
6. **值永不进入任何输出**：findings 只允许 `code / severity / key / detail` 四个字段，detail 只写「留空 / 缺键 / 模板泄漏」，单测专门断言输出不含测试值。

## 4. 闸门数字（真实执行）

| 闸门                                                   | 结果                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `pnpm exec vitest run scripts/security/__tests__/`     | 1 file / 17 tests passed                                        |
| `pnpm typecheck`                                       | exit=0                                                          |
| `pnpm lint`                                            | exit=0                                                          |
| `pnpm test`（收尾一次）                                | 238 files passed + 1 skipped，4083 passed + 7 skipped（93.21s） |
| `git diff --stat HEAD -- src/engine-core`              | 空                                                              |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` | 全 PASS                                                         |
| `pnpm orchestration:worklog:verify`                    | PASS（提交后复核）                                              |

## 5. 现场取证

1. **prettier 不再改写 records**：对 `docs/worklog/records/**` 全部 578 个文件逐个跑 `prettier --write`，前后 SHA-256 比对 **字节变化 = 0**。
2. **env-doctor 本机实跑**：模板 278 键 / 实配 104 键；`error=0`；缺键 183（折叠为一行）、空值 11（其中密钥键 5）、模板占位值 2（info）。
3. **交接关键键验收**：`pnpm env:doctor --keys LLM_DOUBAO_API_KEY,ENGINE_RENDER_FALLBACK_PROVIDERS` → PASS（键存在、值非空、`.env` 未被跟踪）。
4. **`.env` 跟踪状态**：`ENV_FILE_TRACKED` 未出现，`ENV_FILE_NOT_IGNORED` 未出现。

## 6. 已知边界

- 体检只验证「键在、值非空、未被跟踪」，不验证值有效性（有效性靠一次真实调用探测，规程 §6）。
- 缺键 183 条是真实状态（本机 `.env` 大量键走默认值），不是缺陷；后续按需补齐，不在本单范围。
- 交接方式 B 的传输通道安全依赖操作者判断，无密码学保证（规程 §8 已写明）。

## 7. 后续（不在本单）

- AF-219：`.env.example` 补 `LLM_DOUBAO_API_KEY` / `ENGINE_RENDER_FALLBACK_PROVIDERS` 生效行与注释，并跑 `test/config/wp25-env-example-coverage.spec.ts` 双向守卫。

commit message：`feat(AF-218): 记录包字节隔离与 env-doctor 密钥体检`
