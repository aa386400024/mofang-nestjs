# AF-001 回执 · 通用多 Agent 协作框架仓库从零成型

> 执行方：MiniMax Code ｜ 编排：主控 ｜ 任务单：`docs/worklog/pending/agent-framework-bootstrap-task-2026-11-15.md`
> 交付记录：`docs/worklog/completed/phase2.5/af001-framework-bootstrap-implementation-2026-11-15.md`

## 一句话

框架仓库已在 `E:\Work\Project\agent-collaboration-framework` 从零建成：18 个契约路径（10 篇 docs + 2 个 JSON Schema + 2 个模板 + adapter 规范 + 示例 + README + CHANGELOG）全部落盘，§7 六项闸门实跑全绿，本地 git 单条初始提交、未配远端、未 push；mofang-nestjs 本仓**一个既有文件未改**。

## 交付物（18 个 §3 路径 + 1 个辅助文件）

| 路径                       | 字节 | 路径                                   | 字节 |
| -------------------------- | ---- | -------------------------------------- | ---- |
| README.md                  | 6950 | docs/security-and-policy.md            | 4422 |
| CHANGELOG.md               | 3186 | docs/human-in-the-loop.md              | 4502 |
| docs/roles.md              | 9142 | docs/evolution.md                      | 5112 |
| docs/task-contract.md      | 7293 | schemas/task-sheet.schema.json         | 9534 |
| docs/state-machine.md      | 5521 | schemas/task-state-index.schema.json   | 8054 |
| docs/receipt-contract.md   | 5747 | templates/task-sheet.template.md       | 3316 |
| docs/acceptance.md         | 6018 | templates/receipt.template.md          | 3615 |
| docs/reliability.md        | 4952 | adapters/README.md                     | 5521 |
| docs/context-and-memory.md | 3632 | examples/example-task-state-index.json | 3659 |
| （辅助）.gitattributes     | 125  |                                        |      |

## §7 六项闸门实跑数字

| #   | 检查         | 退出码 | 实测                                                                                 |
| --- | ------------ | ------ | ------------------------------------------------------------------------------------ |
| 1   | 文件齐全非空 | 0      | **18/18** §3 路径存在且字节数 > 0；BAD_COUNT=0                                       |
| 2   | JSON 合法    | 0      | 3/3 解析通过；示例经 ajv 8.20.0（Draft 2020-12）校验 **EXAMPLE_VALID**               |
| 3   | 黑名单扫描   | 0      | **词边界口径 = 0**；原样子串（区分大小写）= 3、不区分 = 7；sha 扫描 = 0（口径见下）  |
| 4   | 编码         | 0      | 19/19 文件 NO_BOM + LF_ONLY + UTF8_OK；BAD_COUNT=0                                   |
| 5   | 模板一致性   | 0      | 任务单模板 **41 ↔ schema 41**、回执模板 **23 ↔ 契约清单 23**，双向差集均为空         |
| 6   | git          | 0      | 提交数 **1**（`a195318`）；受控文件 19；status 行数 0；remote 行数 0；全部 i/lf w/lf |

## 偏差（详见交付记录 §6）

| #   | 事项                                                                                                            | 处置                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D-1 | 任务单 §7/§8 写"17 个路径"，§3 逐文件清单实为 **18**                                                            | 全交 18/18，按 18 登记                                                                                                    |
| D-2 | 新增 `.gitattributes`（LF 固化）                                                                                | 本机全局 `core.autocrlf=true` 会把 LF 检出成 CRLF，与 §6.2 冲突；已并入同一条初始提交，仓库仍恰 1 条提交                  |
| D-3 | §4.1 强制字段 `artifactSchema` 含 "tSc"、真相源 §4.3 强制字段 `noOutscopeRefactor` 含 "tsc"（noOu-**tsc**-ope） | 原样子串口径必然 ≥3 命中，与"必填项不得删减"自相矛盾；闸门 3 采用**词边界口径 = 0**，7 处原样子串命中已逐条登记为子串误判 |
| D-4 | 仓级 AGENTS.md 要求任务单归档 + 回写母版                                                                        | 本单 §6.3 禁止改本仓既有文件，故任务单留在 `pending/`，归档动作留给大炮                                                   |
| D-5 | 回执字段名沿用真相源                                                                                            | 未改名规避扫描；备选 `noAdjacentRefactor` 待你拍板                                                                        |
| D-6 | 未加 LICENSE / .gitignore                                                                                       | 许可未定、纯文档无构建产物                                                                                                |

## 遗留

- backlog：框架层许可未声明；L1/L2/L3 只有规范未实现；任务单正文的机读校验待 L1 补；
- openQuestions：闸门 3 扫描口径待拍板；任务单"17 路径"表述是否回改；
- 人工复核：抽查回执字段表与模板对照、抽查索引 schema 必填项、在另一台机器 clone 验 LF。

## 待你拍板（1 件）

**闸门 3 的扫描口径**。词边界口径 = 0 命中（我采用的口径）；若你的脚本是"原样子串"口径，则两个**契约强制字段名**会被误判——处置选项：(a) 保持现状，接受子串误判记录在案；(b) 把 `noOutscopeRefactor` 改名（影响 3 处 + 契约文档，偏离真相源）；(c) 放行一个例外白名单。任务单说"待决策点：无"，故我按 (a) 交付并把选择权留给你。

## commit message 草稿（本仓手动提交）

```text
docs(af001): 归档 AF-001 通用多 agent 协作框架仓库交付记录与回执
```

> 框架仓已按 §6.3 完成本地初始提交：`chore: bootstrap agent-collaboration-framework v1.0.0`（`a195318`，分支 main，无远端）。
