# P-DEBT-20 · 废弃 typeorm-model-generator 工具链移除 — 交付记录

- **状态**：✅ dev 工具链已移除（2026-11-15，本机闸门全绿；台账 **IM-002** accepted，待提交归档转 done）
- **基线 HEAD**：`8d62a48`（与 `origin/integrate` 一致）
- **债务条目**：P-DEBT-20（技术债台账 §9）；改进台账 **IM-002**
- **提交方式**：工作区改动待分组提交（代码 / 依赖一组，台账 + 文档 + 快照一组）；按仓库 §2.4 纪律本单不自动 commit / push

---

## 一、本单做了什么（一句话）

移除事实废弃的 `typeorm-model-generator` DB→装饰器反向生成工具链：devDep、`bin/entity.ts`、`bin/NamingStrategy.cjs`、`entity:load` 脚本；lockfile 同步移除生成器专属传递快照。主依赖 specifier **零版本浮动**。样品 entity 与孤儿辅助依赖保留，留 V3 上线清理清单。

---

## 二、改动文件清单

### 2.1 修改 / 删除

| 文件                                                        | 改动                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                              | devDependencies 删除 `typeorm-model-generator: ^0.4.6-no-engines`；scripts 删除 `entity:load`（`tsx bin/entity.ts`）                                                                                                                  |
| `bin/entity.ts`                                             | **删除**（84 行；`spawnSync` 调生成器，`prompts` 收集库名、`rimrafSync` 清产物目录）                                                                                                                                                  |
| `bin/NamingStrategy.cjs`                                    | **删除**（19 行；`require('typeorm-model-generator/dist/src/NamingStrategy')` 并重写 `entityName` / `fileName`）                                                                                                                      |
| `pnpm-lock.yaml`                                            | 移除生成器链专属 snapshot（老 typeorm 0.2.45 / mysql2 2.3.3 / sqlite3 5.1.7 / tar 6 / tmp 0.0.33 / xml2js / inquirer 链）；specifier 差异 `+0 / -1`，唯一删除 `^0.4.6-no-engines`；其余为 pnpm 序列化空格重排，integrity 哈希逐字一致 |
| `README.md`                                                 | 上线清理清单：`bin/entity.ts` 与 `typeorm-model-generator` 标记已移除（2026-11-15，P-DEBT-20）；`passport-*` / `express-session` / `@nestjs/passport` / `passport` 属 demo 链路，留 V3                                                |
| `docs/team/agent-orchestration/improvement-log.json`        | IM-002 流转 `candidate → queued → accepted`，history 两条留痕（by / note 齐全）                                                                                                                                                       |
| `docs/team/agent-orchestration/orchestration-snapshot.json` | 快照刷新：total 3 / active 3；candidate 1 / queued 1 / accepted 1 / done 0                                                                                                                                                            |
| `web/orchestration/data.js`                                 | 快照前端数据同步刷新（与 snapshot 同批生成）                                                                                                                                                                                          |
| `docs/team/gate-performance-remediation-2026-11-11.md`      | P-DEBT-20 状态 🟠 → ✅ 已处置（补移除范围、保留项、闸门数字）；§更新记录追加本单落地条目                                                                                                                                              |

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、整个 `test/` 目录、`src/**/*.ts` 业务代码 —— **零 diff**
- **未引入新第三方包**；**未升级任何主依赖版本**（typeorm / @sentry / rimraf / mysql2 等版本号逐字未变）
- **保留**：
  - 样品 entity `src/entity/sampledb1/`、`src/entity/sampledb2/` —— 仍被 demo 代码 `src/sample`、`src/shared/foobar` 经 `#entity/sampledb1/index.js` 引用，属 README V3 上线清理清单，跨本债范围
  - 辅助依赖 `prompts` / `rimraf` / `@types/prompts` —— 仅服务已删脚本，本身不在 critical / high 告警面；留 V3 清单一并清理，避免本单扩大 diff

### 2.3 显式排除的未跟踪产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 备忘，并行线产物，零 src 改动）

---

## 三、根因与处置

### 3.1 链路现状

`typeorm-model-generator@0.4.6-no-engines` 上游停更，拖入老 `typeorm@0.2.45` / `mysql2@2.3.3` / `sqlite3@5.1.7` / `tar@6` / `tmp@0.0.33` / `xml2js@0.4.23` / `inquirer@7.3.3`；本机全量 audit **32 条**（4 critical / 12 high / 14 moderate / 2 low）中 critical 与多数 high / moderate 挂此链。该链路仅开发期 `bin/entity.ts` 做 DB→装饰器 entity 反向生成，**不进 prod 依赖树**；CI audit `--prod` 不计入。TD-14 评估备忘定性：链路事实废弃，与 EntitySchema 持久化路径不兼容。

### 3.2 处置边界

- **移除**：生成器本体 + 两个 bin 脚本 + `entity:load` 入口；lockfile 专属传递快照。
- **不移除**：样品 entity（demo 引用，V3 清单）；`prompts` / `rimraf` 辅助依赖（孤儿但无安全告警，V3 清单）。

### 3.3 未采用方案

- **连带删除 `src/sample`、`foobar`、样品 entity 与 passport 链路**：属 README V3 demo 清理清单，跨本债范围，本单不顺手清理。
- **替换为其他生成器**：上游无维护替代，且该反向生成能力已废弃；移除优于替换。

---

## 四、闸门证据

| 命令                                                                     | 退出码 | 结果                           |
| ------------------------------------------------------------------------ | ------ | ------------------------------ |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                         | 0      | 0 error                        |
| `pnpm lint`（`eslint --cache`）                                          | 0      | 0 warning / 0 error            |
| `pnpm lint:fast`（`oxlint src test bin`）                                | 0      | 0 warning / 0 error，1350 文件 |
| `pnpm vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 21 passed                      |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线 **3381 例 / 201 文件（4 skipped）**。
- **lockfile 核对**：specifier `+0 / -1`（唯一删除 `^0.4.6-no-engines`）；无主依赖版本浮动；被移除快照均为生成器链专属，当前 typeorm 1.1.2 的 mysql2 / pg / ioredis 方言快照保留。

---

## 五、遗留与未决

- **P-DEBT-21 / IM-003**：prod **5 moderate** 传递依赖（`uuid@8.3.2` / `glob@13.0.6` / `minimatch@10.2.6`）随主依赖升级治理；受 P-DEBT-4 约束（版本变动须附全量绿跑 + 墙钟数字），本单不实施，维持 candidate。
- **V3 上线清理清单**：`prompts` / `rimraf` / `@types/prompts` 孤儿辅助依赖 + `src/sample` / `foobar` / 样品 entity / passport demo 链路。
- **IM-002 终态 `done`**：待本单交付记录归档 + 提交后，由编排者闸门流转。
