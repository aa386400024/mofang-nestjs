# 框架版本锚点（Adapter ↔ agent-collaboration-framework）

> 本文件是 mofang-nestjs 适配层引用框架版本的**唯一锚点**。`README.md`、任务单模板、交付记录只引用本文件，不各自抄写版本号。

## 1. 仓与发行标识

| 项 | 值 |
| --- | --- |
| 框架仓 | `D:\work\Project\agent-collaboration-framework`（本地独立 git 仓，无包管理器分发） |
| 发行状态 | `2.1.0` 候选发行提交，**尚未打 tag**（L4 tag 需 Human 批准） |
| 候选分支 | `feat/v2.1-operational-contracts` |
| 候选 commit | `e4124037b8e5da2ac92070bb13da75f921044f9d` |
| 上一发行 tag | `v2.0.0`（annotated tag object `c507188` → commit `67d3290`，releasedAt `2026-11-16`） |
| 适配层版本范围 | `>=2.0.0 <3.0.0` |

**引用规则**：说「2.1.0」写候选 commit `e412403`，不得声称已有 `v2.1.0` tag；`v2.0.0` 仍是最近一次正式发行。tag 对象 `c507188` 不能当 commit 引用。适配层消费 2.1.0 契约前必须完成双仓验证。

## 2. 2.1.0 候选提交内容（2026-11-23）

`feat/v2.1-operational-contracts@e412403` 包含：风险分级 `riskClass / riskRationale / gateProfile`、任务取代 `supersedes / supersededBy`、依赖转接 `dependencyResolutions`、周期时间 `timing`、执行器会话 `executor-session` 心跳，以及 INV-17～INV-21。框架侧 `conformance/run.py` 检查项 565、失败 0；单测 19 条全绿。

该提交**未推送、未打 tag、未发 release**，不得在适配层文档写成已发行。适配层使用 `contracts/agent-collaboration-framework/2.1.0/` 固化副本消费，来源哈希见该目录 `PROVENANCE.json`。

> 历史说明：`v2.0.0` 之后 `main` 上的 `53c2b2b`～`7395748` 是 v2.0.0 的补丁口径；2.1.0 候选把其中与生命周期相关的设计固化为契约，而不是逐条 cherry-pick。

## 3. 一致性校验

```powershell
# 框架仓自身：契约版本轴
Get-Content D:\work\Project\agent-collaboration-framework\schemas\versions.json

# 本仓：vendored 契约副本与来源哈希
pnpm orchestration:contracts

# 本仓：状态面 / 协议视图 / 事件链
pnpm orchestration:validate
pnpm orchestration:protocol
pnpm orchestration:events verify
```

校验失败时先修事实，不修数字；版本表、`PROVENANCE.json`、适配层 README 三处口径必须一致。

## 4. 变更纪律

1. 框架发新 tag 后，先更新本文件，再更新适配层 README 与 `contracts/agent-collaboration-framework/<version>/` 副本；顺序不能反。
2. 只增不删：既有字段、既有契约版本不因升级而删除；破坏性变更须单独任务单 + Human 批准。
3. 不在本仓伪造框架 commit / tag；跨仓提交只写 `artifactRefs.others`，不写 `changedFiles.commits`。
4. 版本锚点变更必须带证据：`git rev-parse` 输出、tag 类型、`versions.json` 摘要、`orchestration:contracts` 结果。

_Last verified: 2026-11-23（2.1.0 候选 commit `e412403`，未打 tag；最近正式发行仍为 `v2.0.0` → `67d3290`）_
