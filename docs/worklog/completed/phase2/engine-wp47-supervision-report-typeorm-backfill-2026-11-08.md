# WP47 · supervisor 督导报告切真 DB —— **补登记录**

> **路径**：`docs/worklog/completed/phase2/engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md`
> **状态**：✅ 已交付（**补登**）
> **交付日期**：2026-11-08
> **补登说明**：⚠️ **本单工于 2026-10-26，本记录 2026-11-08 回填，非当期交付。**
>   起因：Phase2 封版收口任务单（`phase2-freeze-closeout-2026-11-08.md`）§三 B 发现 ——
>   母版 `phase2-wp-list-2026-11-03.md:55` 标着 ✅，但 `docs/worklog` 全树**零 WP47 记录**
>   （文件名按 `47` / `supervision` / `wp47` 匹配零命中），是母版里唯一一个"**标 ✅ 但零证据**"的 WP。
>   本记录按任务单 §3.2 **路径一**补齐证据链。
> **考古命令**（可复现）：

```powershell
# ① 命中提交 (类型ORM仓储 + migration 同一次落地)
git log --all --oneline -S 'SupervisionReportRepositoryTypeorm' -- src
# → a9ca450 feat(counselor): 落地 vpt 会话桥接与督导报告落库查询, 修复 marks 列映射致报告 500, ...

# ② migration 的新增提交
git log --all --oneline --diff-filter=A -- src/migration/1714900000020-AddSupervisionReports.ts
# → a9ca450 (同上)

# ③ entity 的新增提交 (Supervisor Agent 接入, 早于本单)
git log --all --oneline --diff-filter=A -- src/agent/supervisor/domain/entities/supervision-report.entity.ts
# → 7a77586 feat(agent): 接入 Supervisor Agent (SupervisionReport + LLM JSON 解析 + 6 维度校验 + parse_error 兜底 ...)
```

---

## 一、提交证据

| 项 | WP47 本单 | 前置（Supervisor Agent 接入） |
|---|---|---|
| commit | **`a9ca450`** | `7a77586` |
| 日期 | **2026-10-26 17:35:01 +0800** | 2026-10-09 18:03:29 +0800 |
| 作者 | aa386400024 | aa386400024 |
| 标题 | feat(counselor): 落地 vpt 会话桥接与督导报告落库查询，修复 marks 列映射致报告 500，补 4 流派幂等种子并将永久失败与可重试故障分流 | feat(agent): 接入 Supervisor Agent (SupervisionReport + LLM JSON 解析 + 6 维度校验 + parse_error 兜底 + LlmModule inline disable 治 ESLint 误报, 7 新建 + 2 改) |

> ℹ️ `a9ca450` 是**一次混合提交**（vpt 会话桥接 + 督导报告落库 + 种子 + voice 侧改造共 47 个文件），
> **不是**纯 WP47 提交 —— 这一点在本记录里说清楚，免得后人按"一个 WP 一个 commit"去找而找不到。

---

## 二、改动文件清单（WP47 相关部分）

**`a9ca450` 内与督导报告落库直接相关的**：

| 文件 | 改动 |
|---|---|
| `src/agent/supervisor/data/supervision-report.repository.typeorm.ts` | **新建**（+146）：真库仓储实现 |
| `src/migration/1714900000020-AddSupervisionReports.ts` | **新建**（+66）：手写 DDL 建表 |
| `src/migration/index.ts` | **改**（+9）：migration 注册 |
| `bin/ormconfig.ts` | **改**（+15）：migration 真注册点（仓库硬约束：真注册点在 `bin/ormconfig.ts`） |
| `src/agent/supervisor/supervisor.module.ts` | **改**（+26/-12）：仓储 **内存 → 真库** 接线 + 导出接口 token + 引入 `TypeOrmModule.forFeature` |
| `src/agent/supervisor/supervisor.types.ts` | **改**（+8） |
| `src/agent/supervisor/domain/entities/supervision-report.entity.ts` | **改**（+6/-…）：列映射修正（同一提交修的 `marks` 列映射 500） |
| `src/config/envs/default.ts` | **改**（+11）：相关 env |

**`7a77586`（前置，Supervisor Agent 接入）**：

| 文件 | 改动 |
|---|---|
| `src/agent/supervisor/data/supervision-report.repository.memory.ts` | **新建**（+77）：内存实现（**保留给单测替换**，不删） |
| `src/agent/supervisor/domain/entities/supervision-report.entity.ts` | **新建**（+81） |
| `src/agent/supervisor/domain/repositories/supervision-report.repository.ts` | **新建**（+55）：仓储**接口** + 注入 token |
| `src/agent/supervisor/supervisor.module.ts` / `supervisor.service.ts` / `supervisor.prompts.ts` / `supervisor.types.ts` | 新建 / 改 |
| `src/agent/agent.module.ts` | 改（+7/-…） |

> 📌 **当前工作区实存**（2026-11-08 清点，`src/agent/supervisor/` 全量）：
> `supervisor-llm.config.ts` · `supervisor.controller.ts` · `supervisor.module.ts` · `supervisor.processor.ts` ·
> `supervisor.prompts.ts` · `supervisor.service.ts` · `supervisor.types.ts` ·
> `data/supervision-report.repository.memory.ts` · `data/supervision-report.repository.typeorm.ts` ·
> `domain/entities/supervision-report.entity.ts` · `domain/repositories/supervision-report.repository.ts` —— 共 11 个文件。

---

## 三、表结构要点（实测自 migration 源码）

| 项 | 值 |
|---|---|
| 表名 | `supervision_reports`（**不新建** vpt 专用表 —— 督导报告跨场景共用同一结构，反双胞胎） |
| 列数 | **16 列**：id / tenant_id / session_id / user_id / persona_id / persona_name / difficulty / status / overall_score / dimensions / annotations / error_patterns / growth_suggestions / raw_response / created_at |
| 索引 | **3 个**：PRIMARY（id） + **UNIQUE** idx_supervision_tenant_session(tenant_id, session_id) + idx_supervision_status_created(status, created_at) |
| 唯一键 | **UNIQUE (tenant_id, session_id)** |
| 软删列 | **不落**（督导报告写完即终态，不可改写；跟 entity 声明一致） |
| 建表方式 | **手写 DDL migration**，禁用 `synchronize: true`（ADR-0003） |
| 回滚 | `down()` → `DROP TABLE IF EXISTS supervision_reports;` |

---

## 四、不变量与边界

| # | 不变量 | 落地方式 |
|---|---|---|
| 1 | **一场会话一份报告** | 结构级保证 = **UNIQUE (tenant_id, session_id)**。内存实现靠 Map 覆盖，真库实现靠唯一键 |
| 2 | **BullMQ 重试不堆多份报告** | 靠上面的唯一键兜住。没有它，重试（attempts: 3）会在同一 session 下堆出多份，查询只能"排序取最新" —— 那等于把"覆盖"降级成"挑一份"，语义漂移 |
| 3 | **内存实现保留给单测** | `supervisor.module.ts` 的 provider 从 `useClass: SupervisionReportRepositoryMemory` 换成 `useClass: SupervisionReportRepositoryTypeorm`，但 **memory 实现文件保留在 `data/` 目录**，单测可 override 注入 |
| 4 | **跨模块边界不破** | 导出的是**接口 token**（`SUPERVISION_REPORT_REPOSITORY`），消费方（counselor 侧查询出口）拿不到 entity / Repository —— 避免 counselor 另写一套查询口径 |
| 5 | **不落 DB 级 FK 到 training_sessions** | 跟仓库其余表一致（软删兼容，应用层校验） |

---

## 五、engine-core 改动情况（实测）

```powershell
git show --stat --format='' a9ca450 -- src/engine-core   # 空
git show --stat --format='' 7a77586 -- src/engine-core   # 空
```

✅ **两次提交的 engine-core 改动面均为空** —— WP47 是**纯业务层 / 基础设施层**改动，不碰内核纯层。

---

## 六、当时的闸门数字

❌ **记录缺失，未留存。**

- 本单工于 **2026-10-26**，早于本仓库「每个任务单都写交付记录 + 闸门数字」的工作流成型；
- `docs/worklog` 全树**没有任何** WP47 的任务单 / 交付记录，git 里也没有对应的记录文件；
- 按任务单要求：**不编数字**。此处如实留空。

> ⚠️ 这正是本单要修的那类缺口 ——「做了、代码在、但账上没有」。补登之后母版不再是"✅ 但零证据"。

---

## 七、当前状态复核（2026-11-08）

| 复核项 | 结果 |
|---|---|
| 代码是否在 | ✅ `src/agent/supervisor/` 11 个文件 + `src/migration/1714900000020-AddSupervisionReports.ts` 均在 |
| migration 是否真注册 | ✅ `src/migration/index.ts` + `bin/ormconfig.ts` 均有登记（仓库硬约束：真注册点是 `bin/ormconfig.ts`） |
| 内存实现是否还在 | ✅ `supervisor-report.repository.memory.ts` 在（单测用） |
| engine-core 是否被碰过 | ✅ 两个 commit 的 engine-core diff 均为空 |
| 母版第 55 行 | ✅ 已改为指向本补登记录 |

---

_补登记录 —— 工于 2026-10-26（commit `a9ca450`），2026-11-08 回填。_
_本记录不改动任何代码，只补齐母版缺失的证据链。_
