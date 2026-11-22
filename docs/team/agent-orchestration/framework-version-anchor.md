# 框架版本锚点（Adapter ↔ agent-collaboration-framework）

> 本文件是 mofang-nestjs 适配层引用框架版本的**唯一锚点**。`README.md`、任务单模板、交付记录只引用本文件，不各自抄写版本号。

## 1. 仓与发行标识

| 项 | 值 |
| --- | --- |
| 框架仓 | `D:\work\Project\agent-collaboration-framework`（本地独立 git 仓，无包管理器分发） |
| 发行 tag | `v2.0.0`（annotated tag） |
| tag 对象 SHA | `c50718856aa752bac3d87e44b3f309b16fbcb051` |
| tag 指向 commit | `67d329054f12ead1a1072d4edbbbfbe924ed1c79` |
| releasedAt | `2026-11-16` |
| 当前 `main` HEAD | `7395748f3a95d4af32f356fce30629e7ce678909`（**未发版**） |
| 适配层版本范围 | `>=2.0.0 <3.0.0` |

**引用规则**：说「发行版」写 tag `v2.0.0`；需要代码身份时写 commit `67d3290`；不得把 annotated tag object `c507188` 当成 commit 引用。tag 之后 `main` 的提交只在本地一致性校验中使用，不构成对下游的发行承诺。

## 2. tag 之后的未发版提交（2026-11-17 / 11-18）

| commit | 主题 | 影响适配层的点 |
| --- | --- | --- |
| `53c2b2b` | 非失败事实分类、熔断 half-open 迁移口径、receipt 可选 commits 字段 | 通道旁路 / 熔断口径 |
| `1b1e581` | 规范正文条款锚点校验，条款漂移即失败 | conformance 条款锚点 |
| `26d30bc` | push 到 main 也过 CHANGELOG 闸门 | 框架仓 CI，不在本仓生效 |
| `bde9343` | 派发后释放交互控制权，回执走文件 + 定时轮询 | GUI relay 控制权边界 |
| `b23e968` | 按任务动态轮询，不留常驻扫描 | relay 轮询策略 |
| `7395748` | relay 回收改为事件优先与有界兜底 | relay supervisor 行为 |

这些提交已进入本地 `main`，但**尚未打新 tag / 发新 release**。适配层本轮只做文档锚定与行为对齐，不擅自发布框架版本；L4 冻结动作（tag / release / master / 部署）仍归 Human 批准。

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

_Last verified: 2026-11-18（tag object `c507188` → commit `67d3290`，main HEAD `7395748`）_
