# AF-034 交付记录：配置归一保留 dispatch 段

- 任务单：`docs/worklog/pending/af034-dispatch-config-normalization-task-2026-11-17.md`
- 角色：orchestrator
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。GUI 通道「配了等于没配」的静默丢段问题堵住，IM-028 才能真正按配置决策。

## 1. 缺陷（AF-033 演练实测暴露）

`state-store.mjs#validateConfig()` 只返回它显式列出的字段，`dispatch` 段不在返回结构里：

```
node -e "loadConfig().dispatch" → undefined
node -e "config.json.dispatch"  → {channel:'gui-relay', fallbackToFile:true, deliveryLeaseMinutes:5}
```

后果是 `executor` 任务的 `resolveChannelSelection` 读到 `undefined` → 收敛成 `file` → 任务永远走文件通道，GUI relay 从未真正由调度层触发；而 `dispatch-decision` 记录的 `configuredChannel` 也是 `file`，看起来「正常」，实际是把配置吃掉后自说自话。

这是 IM-028 的残留入口：AF-032 把决策链接进运行时，但决策读的配置被归一层丢了。

## 2. 修法

### 2.1 配置归一保留 `dispatch` 并校验（`state-store.mjs`）

```js
const dispatchChannel = raw.dispatch?.channel ?? 'file';
const dispatchChannels = ['file', 'gui-relay', 'gui-file-fallback', 'mcp', 'http'];
if (!dispatchChannels.includes(dispatchChannel)) errors.push(...);
const fallbackToFile = raw.dispatch?.fallbackToFile !== false;
const deliveryLeaseMinutes = Number(raw.dispatch?.deliveryLeaseMinutes ?? 5);
```

非法通道、非正数租约显式报错而不是静默回落；正常值原样返回进 `loadConfig()`。

### 2.2 登记不再用任务单时间当事件时间（`task-intake.mjs` + `event-store.mjs`）

`registerTaskFromSheet` / `registerTaskFromHandover` 原先把 `task.createdAt` 传成 `at`，任务单写成未来整点就会让 created 事件排到 promoted 之后。两处调用改为只传 actor，由 `createTask` 取写入时刻。

## 3. 验证

| 项                      | 实测                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadConfig().dispatch` | `{"channel":"gui-relay","fallbackToFile":true,"deliveryLeaseMinutes":5}`                                                                                                                                                                    |
| AF-034 领单决策         | `{"channel":"file","targetRole":"orchestrator","reason":"orchestrator-self-dispatch","configuredChannel":"gui-relay"}`                                                                                                                      |
| `gateResults`           | `pnpm exec vitest run ...` → exit 0，**168 passed / 0 failed**（1.05s）；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → exit 0，**27 PASS / 0 FAIL**；`node scripts/orchestration/cli.mjs events verify` → exit 0，**129 条**一致 |
| `scopeCheck`            | `in-scope`：`state-store.mjs`、`task-intake.mjs`、单测、README §5.1、本单文档                                                                                                                                                               |
| `contractChecks`        | taskId 一致 ✅；状态只经 `commitIndex` ✅；配置非法值显式报错 ✅；索引 schema PASS ✅；事件链 PASS ✅                                                                                                                                       |
| `backlogItems`          | 无                                                                                                                                                                                                                                          |
| `deviationTable`        | 见 §4                                                                                                                                                                                                                                       |

新增单测 1 条（配置保留 + 默认值 + 通道非法 + 租约非法）。

## 4. 过程事故与处置

| 事故                                                                                      | 处置                                                                                                                             |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 首次登记 AF-034 时 `task-intake` 仍把 `createdAt` 当 `at`，created 事件排在 promoted 之后 | 改两处调用后，用 `events rechain --from EV-0123` 重算 7 条；同一批里 AF-033 的 created 事件也一并校正，最终 129 条 `verify` PASS |
| 一次 `rechain --from EV-0129` 漏掉真正被改的 EV-0128                                      | 切点必须取「被改写的那条事件」本身；`verify` 报 hash 不匹配即为提示，重算后消失                                                  |

## 5. 对 AF-032 的勘误

AF-032 回执声明 `IM-028` 关闭，但只关了「决策链未被调用」这一半；「决策读到的配置被归一层丢弃」这一半在本单补齐。AF-032 的交付记录已在 §4 追加勘误行。

## 6. 回写清单

- `scripts/orchestration/state-store.mjs`（dispatch 段归一与校验）
- `scripts/orchestration/task-intake.mjs`（登记事件时间取写入时刻）
- `scripts/orchestration/__tests__/orchestration.spec.mjs`（+1 用例，168 passed）
- `docs/team/agent-orchestration/README.md` §5.1（配置归一说明）
- 运行态：`task-state-index.json`、`orchestration-state.json`、`orchestration-snapshot.json`、`state/journal.jsonl`（129 条）、`web/orchestration/data.js`
