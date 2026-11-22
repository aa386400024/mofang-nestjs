# AF-314 · 自动对练场次卡片展示对练时间与来访者/咨询师模型

- 日期：2026-11-22
- 分支：`task/AF-314-practice-session-model-display`
- 基线：`137bbe28de4600b168a721f83c5ec05f56d21549`
- 实现提交：`72a2ee81e71d5c2d9b4ce7f5fbd5286a5675e7fc`
- 交付结论：已完成。对练时间、时长、模型与实际使用口径已落地，远程 MySQL 迁移已执行，端到端接口与前端构建均通过。

## 一、为什么不能直接用 `modelVersion`

`PracticeSession.modelVersion` 来自 `InferenceFingerprint.model`，实际取 `MINIMAX_LLM_MODEL`（当前 `MiniMax-M3`），语义是“推理环境指纹的全局 LLM 模型”，用于批次版本对比。

自动对练里来访者渲染由 `VISITOR_LLM_PROVIDER` 与候选链决定；本机 `VISITOR_LLM_PROVIDER=doubao`、`VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`。若直接把 `modelVersion` 标成“应用的模型”，会把 MiniMax 引擎模型误读成整场来访者模型，历史追溯会失真。

所以本次没有只改前端，而是把“来访者主候选 provider/model”和“咨询师生成模型”作为独立可观测字段落库。

## 二、改动清单

### 后端

- `src/engine-adapters/wiring/render-config.factory.ts`
  - 新增只读出口 `primaryVisitorRoute()`：返回渲染候选链第 0 位的 provider 与 chat 模型，不触发凭据校验/告警，避免会话级取样重复启动校验。
- `src/engine-adapters/wiring/engine.module.ts`
  - 导出 `RenderConfigFactory`，只读给自动对练可观测层使用。
- `src/auto-practice/auto-practice.module.ts`
  - 引入 `EngineWiringModule`，拿到真实渲染主候选。
- `src/auto-practice/counselor-agent.service.ts`
  - 新增 `modelId` getter，暴露构造期已解析的咨询师模型。
- `src/auto-practice/practice-runner.service.ts`
  - 会话启动时解析并写入 `visitorModelProvider`、`visitorModel`、`counselorModel`；解析失败只告警并写 NULL，不阻断对练。
- `src/auto-practice/entities/practice-session.entity.ts`
  - 三列：`visitor_model_provider` / `visitor_model` / `counselor_model`，全部 nullable。
- `src/migration/1714900000050-AddPracticeSessionModelColumns.ts`
  - 逐列 `hasColumn` 幂等添加；历史行保持 NULL，不回填、不伪造历史模型。
- `src/migration/index.ts`、`bin/ormconfig.ts`
  - 迁移双注册，避免静默不建列。
- `test/auto-practice/practice-runner.spec.ts`
  - 覆盖启动时三列落库。

### 管理台

- `admin-dashboard/src/api/types.ts`
  - `PracticeSession` 增加三列可选字段。
- `admin-dashboard/src/views/AutoPractice.vue`
  - 卡片新增两行：`对练 11-22 22:34 · 3秒 · ¥...`、`模型 来访 豆包 Seed Character · 咨询 MiniMax M3`。
  - 运行中场次时长按当前时刻计算；结束后固定为 `finishedAt - startedAt`。
  - 历史行无分列时降级为 `引擎 MiniMax M3`，不冒充来访者模型。
  - 悬浮提示展示完整模型 ID、开始/结束时间、退出原因、成本、批次、种子。
  - 常见模型 ID 映射为紧凑显示名，未知模型保留完整 ID。
  - 退出原因映射抽成 `exitReasonText()`，卡片与详情共用，消除两套文案漂移。

## 三、闸门结果

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm exec vitest run test/auto-practice/practice-runner.spec.ts test/auto-practice/practice-runner-cost.spec.ts test/engine-adapters/wp8-wiring.spec.ts` | 通过 | 3 files / 58 tests passed |
| `pnpm typecheck` | 通过 | `tsc -b tsconfig.check.json` exit 0 |
| `pnpm lint` | 通过 | 0 error / 0 warning |
| `pnpm --dir admin-dashboard type-check` | 通过 | `vue-tsc --build` exit 0 |
| `pnpm --dir admin-dashboard build-only` | 通过 | 4718 modules transformed，`AutoPractice` chunk 构建成功 |
| `pnpm test` | 通过 | 283 files passed + 1 skipped；4400 tests passed + 4 skipped；26.11s |
| `git diff --stat HEAD -- src/engine-core` | 通过 | 输出为空，engine-core 零改动 |
| `pnpm migration:show` | 通过 | `[X] 89 AddPracticeSessionModelColumns1714900000050` |
| `GET /admin/api/auto-practice/sessions` | 通过 | 新场次 `1oG3rptwt70tSHJJOhwuA` 返回 `provider=doubao`、`visitor=doubao-seed-character-260628`、`counselor=MiniMax-M3` |

## 四、运行态与端到端验证

- 远程开发库已执行 `pnpm migration:run`，`ap_practice_sessions` 三列成功新增，`migration:show` 显示 `[X] 89`。
- 后端从 `af281r` 重新构建 `dist` 并以 `node dist/app.js` 启动在 3000；前端从 `af281r/admin-dashboard` 启动在 5174，替换了原先指向 `mofang-nestjs` 工作树的旧 Vite 进程。
- 新跑 1 轮会话 `1oG3rptwt70tSHJJOhwuA`（`vpt_general_secure_l1` / `expert` / `maxTurns=1`）已在接口返回三列正确值。
- 首次验证会话 `sdO-UM0ZxBD0Vbjkq7hIb` 跑在“类型导入修复”之前，`visitorModelProvider` 与 `visitorModel` 为 NULL；该场次保留为反向证据，不做回填。修复后新场次写入正确。
- 历史场次三列为 NULL，前端显示“引擎 MiniMax M3”，悬浮提示明确“来访者模型：未记录”。

## 五、与任务单的偏差

1. 任务单只要求 UI 展示，本次额外增加了三列持久化与 migration。
   - 原因：`modelVersion` 与真实来访者模型在灰度期不一致，仅前端展示会产生语义错误；会话结束后配置漂移也无法追溯。
2. 任务单写“成本可见”，本次成本仅在 `totalCost` 有值时显示。
   - 原因：现有新场次 `totalCost` 仍为 NULL，成本结算链路不在本任务范围；不伪造 0，也不把空值渲染成 `¥0`。
3. 任务单的“其他有帮助字段”以悬浮提示承载，不额外增加卡片行。
   - 原因：卡片已有轮次、模式、接触方式、危机结论，继续堆可见字段会挤压列表；完整模型 ID、退出原因、批次、种子、成本放提示层，信息可得且不牺牲密度。

## 六、遗留与开放问题

- 无新增技术债条目。
- 开放问题：当前只记录会话启动时的来访者主候选，未记录逐轮 fallback 后的实际模型。若后续要做严格的逐轮模型审计，需要把 `render.model` 写入 `debug_turn_traces` 并做会话级模型变更聚合；本轮不做，避免扩大改动面。

## 七、提交

- 实现提交：`72a2ee81` `feat(af314): 自动对练场次落库并展示来访者与咨询师模型`
- 建议 commit message（后续归档提交）：`docs(af314): 补齐交付记录与回执`
