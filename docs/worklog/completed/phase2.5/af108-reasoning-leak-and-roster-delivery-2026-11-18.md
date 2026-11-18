# AF-108 交付记录：来访者推理块零泄漏与 8 角色池扩展

- 任务单：`docs/worklog/pending/af108-reasoning-leak-and-roster-task-2026-11-18.md`
- 基线：`dcd3ebd2345c504ee57e0ec8b69b362c09085115`（AF-107 合并 SHA）
- 类型：implementation
- 提交：`58cb1cb`（`feat(engine): AF-108 来访者推理块零泄漏与 8 角色池`）
- 快照：2026-11-18 22:52 CST

## 1. 问题

AF-104 的真实 long 批次审计显示：

- 来访者逐字稿 **102/173 轮 (59.0%)** 带 `<think>` 推理块；
- 推理块同时进入 `history.push({ role: 'visitor' })`，下一轮咨询师会读到模型内部推理；
- 库内只有 4 个 approved 角色，批次脚本的另外 4 个 slug 入队即被 AF-103 拦下。

## 2. 修复

### 2.1 推理清洗唯一真相

新增 `src/shared/llm/reasoning-text.ts`：

| 函数 | 用途 |
| --- | --- |
| `removeReasoningBlocks` | 删除闭合 / 未闭合 `<think>` 块，保留其余空白 |
| `stripReasoningBlocks` | 同上 + `trim`，用于可见台词 |
| `safeVisiblePrefix` | 流式安全前缀，扣住半截 `<think>` / 标签前缀 |

- `llm-json-payload.ts` 的 `stripThinkingTags` 委托同一实现；
- counselor `visible-output.ts` 改为 re-export，消除三份正则；
- 聚合渲染在**空内容判定与截断保护之前**剥离：只有推理块 = 没有可用输出，按失败切备；
- 流式渲染只在可见文本上做句边界缓冲：推理块、半截标签不下发 TTS / 字幕；
- 流结束只有推理块或截断后无完整句 → 候选失败切备，不静默成功。

### 2.2 8 角色池

新增 `character-profile.db-only.seed.ts`（B 类 4 位：安然 / 语桐 / 沉舟 / 惊尘）：

- 数值与台词指纹从 `character-baseline-calibration.ts` 装配，不复制第二份真相；
- 核心信念陈述随内容种子声明，`assembleCharacterProfileSeed` 与 A 类共用同一份字段映射；
- `bin/seed-character-profiles.ts` 在校准前先灌 B 类内容，再跑基线校准。

## 3. 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `corepack pnpm exec vitest run test/shared/af106-reasoning-text.spec.ts test/engine-adapters/af106-character-pool.spec.ts test/engine-adapters/wp6-llm-render.spec.ts test/engine-adapters/wp8b-stream-render.spec.ts` | exit 0；4 files / **49 tests passed**（749 ms） |
| 类型检查 | `corepack pnpm exec tsc --noEmit -p tsconfig.json` | exit 0；0 error |
| 定向 lint | `corepack pnpm exec eslint <11 个改动文件>` | exit 0；0 error / 0 warning（先 `--fix` 修格式） |
| 边界 | `git diff --stat HEAD -- src/engine-core` | 空输出，engine-core 零 diff |

## 4. 生产 seed 实跑

```text
corepack pnpm seed:character-profiles
[seed:character-profiles] 内容基线自检通过, 共 6 个公共模板可对齐
[seed:character-profiles] 基线标定自检通过, 共 8 个角色 (DB-only 4 个走数值校准)
[seed:character-profiles] 内容 seed (A 类 4 个) → 新增 0 / 更新 0 / 未变 4（合计 4）
[seed:character-profiles] 内容 seed (B 类 4 个) → 新增 4 / 更新 0 / 未变 0
[seed:character-profiles] 基线校准 (B 类 4 个) → 更新 0 / 未变 4 / 缺失 0
[seed:character-profiles] 基线校准缺失明细: (无)
```

DB 核对：`character_profiles` 按 `audit_status` 聚合 → **approved = 8**。

## 5. Scope

- 修改：`src/shared/llm/`、`src/auto-practice/counselor/policy/visible-output.ts`、
  `src/engine-adapters/rendering/llm-render.adapter.ts`、
  `src/engine-adapters/wiring/character/`、`bin/seed-character-profiles.ts`、`test/{shared,engine-adapters}/`
- 未改：`engine-core`、数据库 schema / migration、prompt、会话状态机
- 并行产物：`af094-*` 任务单与 `AF-095` 回执仍为未跟踪文件，未纳入本提交

## 6. 结论

推理块在聚合 / 流式两条出口都被剥离，只有推理块时按失败切备；8 个 approved 角色已入库。
真实 long 批次复测与出口④判定另由 AF-109 承接，不在本单伪造。
