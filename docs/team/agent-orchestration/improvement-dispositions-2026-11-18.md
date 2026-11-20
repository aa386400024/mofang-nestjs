# 改进台账处置记录 · AF-080（2026-11-18）

> 执行任务为 **AF-080**。AF-079 登记时把生产清单放在 `docs/team/` 根下，超出 orchestrator Agent Card 资源域（仅授权 `docs/team/agent-orchestration/`）；登记后 scope 无原地修订入口，按「不绕过门禁」原则取消 AF-079、将清单移入授权目录后以 AF-080 重登记执行。AF-079 保留为取消归档记录，不声称完成。

本记录对应 `docs/team/agent-orchestration/improvement-log.json` 中 AF-078 后仍活跃的 5 项。
处置原则：能代码化的代码化，能文档化的文档化，受架构约束的做**显式风险接受**，不留「含糊挂着」。

## IM-046 · 跨仓提交声明

- **处置**：实现。
- **改动**：回执 `changedFiles.externalCommits` 接受 `[{"repo":"owner/repo","commits":["7–40 位小写十六进制"]}]`。校验器只做形状校验，不拿外部 SHA 去本仓对象库解析；本仓 `commits` 仍只写本仓 SHA，V7 本仓 commit 比对口径不变。
- **证据**：`scripts/orchestration/handover-contract.mjs`；单测 `IM-046：跨仓提交走 externalCommits...`；编排 README §5.5。
- **边界**：外部仓 commit 是否包含 scope 外文件，仍由该仓自己的 CI/评审负责；本仓不跨库取证。

## IM-047 · 生产收口清单

- **处置**：实现（清单落地）。
- **产物**：`docs/team/agent-orchestration/production-readiness-checklist-2026-11-18.md`，覆盖部署 / secrets / 迁移 / 监控告警 / 回滚五类，每类给出放行证据与当前状态。
- **边界**：清单落地不等于已完成生产演练；五类「放行证据」未齐前不得宣称生产就绪。
- **排期口径**：Phase 2.5 灰度验证结束后、Phase 3 开发启动前完成演练；演练结果另立任务单，不在本单伪造。

## IM-053 · GUI relay 三单长跑与 stale-ack

- **处置**：实现（自动化回归）。
- **改动**：新增三单序列用例：逐单写 ack → `autoConfirmDeliveries` → `delivery.state=delivered`；第三单重派后，早于本轮 `preparedAt` 的旧 ack 必须被拒，状态留 `pending` 等新 ack 或租约回滚；新 ack 到达后恢复确认。
- **证据**：`scripts/orchestration/__tests__/orchestration.spec.mjs` 的 `IM-053：三单连续 send→ack→auto-confirm 不串单；重派后旧 ack 被拒`。
- **边界**：自动化覆盖的是状态机与时间隔离；真实 MiniMax 窗口的端到端延迟仍由 relay supervisor 在后续真实批次记录，不影响本项状态机验收。

## IM-044 · HTTP / MCP transport

- **处置**：**暂不实施（wontfix，可重启）**。
- **理由**：
  1. 当前 `Transport` 接口的 `submitTask/submitReceipt/...` 是同步返回 `handoverRef`，调度层 `claimReadyTasks` 也是同步循环；HTTP 客户端本质异步，直接塞进去会引入「调用返回了但请求没落地」的第二套真相源。
  2. 当前生产路径是单机 `file` transport + `gui-relay` 桌面通道；没有跨机 executor，也没有常驻远程调度器，HTTP 没有真实消费方。
  3. 要做对，需要把 `run-once` 调度层异步化、给 `submitTask` 加幂等键与重试预算、补远端回执拉取与鉴权；这是一次框架级重构，不是补一个函数。
- **补偿控制**：`transport.type` 仍只允许 `file` 实际启用；`mcp/http` 在 `createTransport` 明确抛「尚未实现」，不会静默降级。
- **重启条件**：出现跨主机 executor、远程常驻调度、或需要多编排者共享任务队列时，单独立项做异步 transport 重构，并先补幂等与重试契约测试。

## IM-052 · executor 状态面越权

- **处置**：**暂不实施（wontfix，可重启）**。
- **理由**：
  1. 当前编排者与 executor 运行在同一 Windows 用户、同一文件系统下；CLI 没有可信调用者身份，任何「角色校验」都只是环境变量自证，挡不住有意或误触的写命令。
  2. 真正的隔离需要独立 OS 账号 / 容器 / 远程执行服务，属于运行环境改造，不是 CLI 加一行判断。
  3. 现有补偿控制已生效：executor brief 明确禁止 `task / run-once / archive / improvements transition` 等写子命令；投递送达后编排者立即 `channel confirm` 清租约；状态迁移与归档只由编排者执行。
- **残余风险**：同用户进程仍可绕过 brief 直接调 CLI。该风险由编排者验收时核对事件链与回执来源兜底；一旦出现实际越权，按事故复盘升级。
- **重启条件**：引入多用户 / 远程 executor / 独立服务账号时，改为「执行端只读挂载 + 编排端独占写入口」，并在 CLI 层做 token 校验。

## 处置后状态

| 项 | 状态 | 依据 |
| --- | --- | --- |
| IM-046 | done | 本轮代码 + 单测 |
| IM-047 | done | 生产 checklist 文档 |
| IM-053 | done | 三单 + stale-ack 自动化回归 |
| IM-044 | wontfix | 同步 transport 架构约束；重启条件已写 |
| IM-052 | wontfix | 同用户进程无法可信隔离；补偿控制已写 |

> 两项 `wontfix` 是**架构性暂缓**，不是「无问题」；重启条件与残余风险已显式登记。
