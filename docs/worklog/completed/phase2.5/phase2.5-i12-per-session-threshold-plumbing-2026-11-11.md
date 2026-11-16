# I-12 · per-session 同盟门槛注入链路打通（适配层装配缝，数值冻结）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](i12-per-session-threshold-plumbing-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-12；`src/engine-core/cognition/alliance-config.ts`；`src/engine-adapters/wiring/alliance-config.ts`；`src/engine-adapters/wiring/engine.providers.ts:181-263`；`src/engine-adapters/wiring/engine.module.ts:350-369`
> 任务性质：装配重构（端口注入缝打通；**不调任何阈值数值**）
> 改动范围：后端 `src/engine-adapters/wiring/` 为主；如内核需新增纯端口类型才动 `src/engine-core/`（须按 §4 例外批准记录）；不含前端

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md`；2. `docs/README.md`；3. `docs/team/conventions.md`（§1.1 纯/副作用分层、灰度期默认不调子强度/阈值、§三 硬约束）
2. 阶段入口：`phase2.5-README.md` → `phase2.5-wp-list-2026-11-08.md`；事实源 p1d-known-issues I-12
3. 本任务单

---

## 1. 背景（先读，方向别错）

I-12 现状：同盟三维门槛（探索 `open`、抗拒 `resistanceTrust` / `resistanceSafety`）由模块级单例 `resolveAllianceConfig(config)` 在装配时读 env 组装一次，作为 `allianceConfig` 注进内核会话端口；同一会话端口实例内所有会话/角色共用这一份配置，没有「按会话或角色覆盖门槛」的链路。

### 关键现状（已核对，别当新问题）

- 内核端口 `AllianceConfig`（`engine-core/cognition/alliance-config.ts:78-83`）：`deltas` + `thresholds`；种子 `DEFAULT_ALLIANCE_CONFIG`（open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3，:91-98）；校验 `resolveAllianceThresholds`（:116-125）。
- 内核会话选项 `InMemoryEngineSessionOptions.allianceConfig?` 已存在（`in-memory-engine-session.ts:228, 302, 322`），构造注入、会话内恒定；`planIntention`（intention-planner.ts:48-51）与 `session-decay.ts` 都经 `resolveAllianceThresholds(alliance)` 取门槛。
- 适配层 `EngineSessionTuningDeps.allianceConfig?` 已透传（engine.providers.ts:197, 257）；模块工厂 `engine.module.ts:364` 传的是 env 单例，没有会话级覆盖来源。
- **灰度期纪律（conventions §1.1 分阶段要求）**：默认不调整子强度 / 阈值；本单只打通「注入缝」，种子值与 env 覆写值一律保持现状，不借本单做临床调参。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

1. **先审计**：画清 `allianceConfig` 从模块工厂 → tuning → 会话选项 → `planIntention` / `session-decay` 的完整路径；确认门槛是否在「内核会话实例」与「per-handle 运行时」两个层次上各是什么生命周期，定位实例级单例堵在哪一层。
2. **打通会话级覆盖缝**（按审计结论选最小方案）：
   - 若缺口只在适配层：让会话创建/上下文组装能带一份可选 `allianceConfig` 覆盖（来自会话上下文 / 角色档案），缺省回落模块 env 单例；内核已有选项则复用，不重复造端口。
   - 若内核侧必须新增纯类型 / 纯解析函数（例如 per-handle 门槛解析端口），放 `engine-core/`，保持零 env、零 IO、零随机；走 §4 例外批准记录。
3. **回落语义**：会话覆盖缺项 / 非法阈值 → 逐项回落内核种子值（复用 `resolveAllianceThresholds` 既有校验，不新写一套）。
4. 测试：适配层 spec 覆盖「会话覆盖优先 → 缺项回落单例 → 非法值回落种子」三条；内核纯函数测试覆盖新增解析（若有）。

**明确不在范围内（禁止顺手做）：**

- 不改任何门槛 / 系数数值；不调 open / resistanceTrust / resistanceSafety，不动 DELTA_TABLE。
- 不接「按角色档案自动算门槛」的临床逻辑（那是后续标定单的事）；本单缝上即使没有真实覆盖来源，也要保持缺省回落行为逐字不变。
- 不改 `AllianceConfig.deltas` 事件覆写表；不动人格调节算子。
- 不碰 DB / migration / prompt / LLM / 前端 / Flutter；`boundary.spec.ts` 不许改。
- 不自动 commit / push。

---

## 3. 目标架构 / 交付物

- **交付物 1：注入缝实现** —— 适配层 wiring（及必要的内核纯端口类型）；配置解析依赖方向固定 `env / 会话上下文 → 适配层 → AllianceConfig 端口 → 内核`，内核零 `process.env`。
- **交付物 2：测试** —— 适配层 spec（装配回落三条路径）+ 内核 spec（新增纯解析，如有）；标注形态（单元纯函数 / 静态投影校验，不起 Nest、不连 DB）。
- **交付物 3：设计说明** —— 交付记录里写清审计结论：实例级单例堵在哪一层、最终方案为什么放适配层或内核、per-handle 与 per-session 的口径区别。

> **口径真相源**：门槛数值唯一真相源 = 内核 `DEFAULT_ALLIANCE_CONFIG` + 适配层 env 解析；消费端只读取端口，不另抄阈值。

---

## 4. 红线（违反即返工）

- **分层归属**：纯决策计算 / 纯类型 / 纯解析归 `engine-core/`；NestJS / IO / env 读取留 `engine-adapters/`。本单若改 `src/engine-core/`，交付记录必须逐条写明「改哪个文件、改什么、为什么必须在内核而不是适配层能解决」（conventions §1.1 例外批准格式），且 `boundary.spec.ts` 11 条断言全过。
- **数值冻结**：交付记录须附证据证明种子值与既有 env 覆写值零变化（diff 中无数值字面量改动）。
- 心理原文不进日志；不引入第二套阈值真相源。
- 不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范：一律 pnpm，禁止裸 npx。

### 5.1 日常内循环

- `pnpm test:related -- src/engine-adapters/wiring`；定向 spec：`pnpm exec vitest run test/engine-adapters`；lint：`pnpm lint`（带缓存）。

### 5.2 收尾全量闸门

| 闸门        | 命令                                                                 | 要求                                                        |
| ----------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`                      | 0 error                                                     |
| Lint        | `pnpm lint`                                                          | 0 error，记 warning 数                                      |
| 测试        | `pnpm test`                                                          | 全绿，记用例总数（基线 2947：2942 passed + 4 skipped）      |
| engine-core | `git diff --stat HEAD -- src/engine-core`                            | 空；若有内核改动，按 §4 附例外批准说明且 boundary.spec 全绿 |
| 任务特有    | 门槛数值 diff 核对：grep 改动文件无 0.6 / 0.4 / 0.3 等阈值字面量变更 | 无数值改动                                                  |

---

## 6. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/i12-per-session-threshold-plumbing-2026-11-11.md`

1. 一句话总结；2. 审计结论 + 实际方案 vs 任务单方案偏差；3. 改动文件清单；4. 闸门表真实数字；5. 回落路径测试结果；6. 回归风险（确认数值未动、内核改动例外批准清单）；7. 遗留项（真实 per-session 覆盖来源待后续标定单接入）。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 路径
- [ ] 任务单移到 `completed/phase2.5/`，状态 `✅` 并链接记录
- [ ] 回写 wp-list 与 README 阶段表；回写 p1d-known-issues I-12 状态与结论指针
- [ ] `git diff --stat HEAD -- src/engine-core` 为空（或附例外批准说明）
- [ ] 提交分组核对：只含本单文件
- [ ] commit message 草稿（不自己 commit/push）

---

## 8. 回复输出约定

1. 「已写入交付记录」+ 路径；2. 闸门真实数字；3. §7 进度与遗留；4. 不贴 diff 全文。
