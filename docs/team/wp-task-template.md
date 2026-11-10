# 后端任务单模板（WP-J / MiniMax Code 派单用）

> **用途**：给后端 AI（尤其是 MiniMax Code）派任务时，一律按本模板写任务单，不要每次自由发挥。
> **为什么有这个文件**：之前任务单结构不一、读完不知从何下手、做完忘回写索引。本模板固化三件事——
> ① 开头固定「必读入口」，每次从同一条链路进；② 中间结构固定；③ 结尾有「交付回写清单」，做完逐项勾选，不许跳。
> **怎么用**：复制本文件 → 另存为 `docs/worklog/pending/<wp-id>-<slug>-YYYY-MM-DD.md` → 填掉所有 `{{双花括号}}` 占位 → 红字提示保留在任务单里提醒执行者。

---

## 头部（每条任务必填）

```
# {{WP-ID}} · {{任务一句话名}}（{{企业级 / 修复 / 验证}}）

> 状态：📋 待执行（{{YYYY-MM-DD}}）
> 执行方：{{MiniMax Code / 自做}}
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 {{integrate}}
> 唯一事实源：{{相关研究文档 / spec 路径，没有就写"无"}}
> 任务性质：{{新功能 / 数值标定落地 / bug 修复 / 纯验证 / 文档}}
```

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

> 执行者：**先读完这些再写一行代码**。这是固定链路，每次任务都从这里进，不要直接改文件。

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航（它会告诉你接任务单该看哪）
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（**engine-core 分层归属边界、16 条硬约束全在这里**）
4. 阶段工作入口：`E:\Work\Project\backend\mofang-nestjs\docs\worklog\README.md` → 当前阶段子入口（Phase2.5 任务读 `docs/worklog/pending/phase2.5-README.md` 和 `phase2.5-wp-list-2026-11-08.md`）
5. 本任务唯一事实源：`{{研究文档 / spec / 上一份交付记录路径}}`
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

{{两三段说清：现在是什么状态、为什么要做、之前踩过什么坑。不写背景直接上方案 = 方向错。}}

### 关键现状（已核对，别当新问题）

- {{已经存在什么、哪条链已经通了、哪些列/函数/表已经有了}}
- {{本任务消费数据的真实路径：谁读、经哪个函数、别改这条链}}

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- {{1}}
- {{2}}

**明确不在范围内（禁止顺手做）：**

- 不在 `engine-core/` 里加任何副作用（NestJS / DB / Redis / HTTP / prompt / 模型名 / process.env / console 心理原文）；`boundary.spec.ts` 不许改。
  - 反过来：**如果正确做法就是在内核里加一个纯函数/纯计算/新出口，就放在 `engine-core/`，不要为了"避开内核"把它堆到适配层**——纯计算归内核、IO 归 adapters，这才是对的分层。
- 不改表结构 / 不加 migration / 不加列（除非本任务明确写了要加）。
- 不改映射函数、resolver、module 装配（除非本任务明确要求）。
- 不碰任何角色的 `enabled` / `audit_status` / `version` / 内容字段。
- 不改 admin-dashboard、不改前端仓库（Flutter）。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 3. 目标架构 / 交付物

> 按任务类型写。**设计原则固定四条**：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 幂等。

- **交付物 1：{{名字}}** —— {{路径、导出什么、什么类型、纯函数还是 Nest provider}}
- **交付物 2：{{名字}}** —— {{路径与行为}}
- **交付物 3：测试** —— {{覆盖哪些路径、含哪些负向用例、端到端断言到什么程度}}

---

## 4. 红线（违反即返工）

- **分层归属（不是"不许碰内核"）**：纯决策计算 / 纯出口字段 / 纯类型该进 `engine-core/` 就进；`engine-core/` 里**禁止**任何 NestJS / IO / 网络 / prompt / 模型名 / 心理原文 console；`boundary.spec.ts` 是机器护栏，不许自己改。详见 `conventions.md` §1.1。
- 心理对话原文禁止进日志 / console / crash report（只出码和计数）。
- {{任务特有红线，如：数值单一真相源、只 UPDATE 不 INSERT、不碰内容列}}
- schema / migration / 映射函数按 §2 范围处理；不越权加需求外功能。
- 不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

> 全量 tsc/eslint/vitest 在本仓库约 11~30 分钟（实测瓶颈是 import 重依赖，占 97%，不是断言执行），**不要每个小改动都全量**。按下面两层走，把**实际命令、exit code、结果数字**写进交付记录。跑不起来就写明报错原因，**不许 silently skip、不许写"待用户执行"、不许用 `--no-verify`**。

### 5.0 命令规范（强制，禁止裸 npx）

- 本仓库 `packageManager=pnpm`，**一律用 pnpm 跑脚本/二进制，不要用裸 `npx`**（裸 npx 启动慢，且会绕过 eslint 缓存）。
- 跑 package.json 脚本用 `pnpm <script>`（如 `pnpm lint`）；直接跑二进制用 `pnpm exec <bin> <args>`（如 `pnpm exec tsc ...`）。

### 5.1 日常内循环（高频，定向，秒~分钟级）

- 单个测试文件：`pnpm exec vitest run <file.spec.ts>`；或开 `pnpm vitest` watch 常驻，改完自动只重跑受影响用例。
- 只跑本次改动影响的测试：`pnpm test:changed`（按 git 变更收敛）或 `pnpm test:related -- <src/xxx.ts>`（按 import 依赖图）。
- Lint 走缓存：`pnpm lint`（已带 `--cache`，只查变更文件），**不要用 `pnpm exec eslint` 不带 `--cache` 裸跑**。

### 5.2 收尾全量闸门（每个任务只跑一次，交付前后台执行，可同时做别的事）

| 闸门        | 命令                                            | 要求                   |
| ----------- | ----------------------------------------------- | ---------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0 error                |
| Lint        | `pnpm lint`                                     | 0 error，记 warning 数 |
| 测试        | `pnpm test`                                     | 全绿，记用例总数       |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | 空（或写明例外批准）   |
| 任务特有    | {{如 seed 连跑两次幂等、边界 spec、连库抽查}}   | {{要求}}               |

---

## 6. 交付记录（完成后写，路径固定）

写完到：`docs/worklog/completed/{{阶段}}/{{wp-id}}-{{slug}}-implementation-{{YYYY-MM-DD}}.md`

内容必须含：

1. 本单做了什么（一句话总结）
2. 方案设计：实际实现 vs 任务单方案，有偏差就写清原方案/实际方案/为什么（conventions §2.5）
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例数）
5. 任务特有结果（如 8 角色落库数值、`{updated,unchanged,missing}`、两次运行对比）
6. 风险与回归：哪些既有测试被改、为什么；确认未碰 engine-core / schema / 内容 / 状态字段
7. 遗留项与建议人工复核（`git diff --stat`、连库 `SELECT ...` 抽查）

---

## 7. 【交付回写清单】做完逐项勾选（之前总忘，这次不许跳）

> 这是硬清单，不是建议。交付记录写完后，**逐条确认都做了**，再在对话里收尾。

- [ ] 交付记录已写到 §6 的固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/{{阶段}}/`，顶部状态行从 `📋 待执行` 改成 `✅` 并链接交付记录
- [ ] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 里本任务那行状态改成完成、补交付记录链接
- [ ] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3「当前有什么活」表里挪走/改成本任务已完成
- [ ] 回写 backlog（若任务单 §2 指定了母版）
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 给一行 commit message 草稿（**不自己 commit/push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附该文件路径，不用重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不要把代码 diff 全文贴进对话，让用户自己 `git diff`。
