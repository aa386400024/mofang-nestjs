---
taskId: AF-611
contextId: phase3-judge-layer
title: Judge Layer P0：评审端口、首个现有厂商 Provider、Rubric 版本化与 Shadow 落库骨架
type: implementation
status: backlog
riskClass: R1
baselineRef: 4fab586b3753b8a7969cb1998ae43e96651279a5
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T23:50:41+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/pending/phase3-judge-layer-af611-review-port-shadow-skeleton-2026-11-28.md
    - docs/worklog/records/phase3-judge-layer/AF-611/
    - docs/worklog/completed/phase3-judge-layer/af611-review-port-shadow-skeleton-2026-11-28.md
    - src/engine-adapters/judge/
    - src/engine-adapters/eval/eval.service.ts
    - src/engine-adapters/eval/eval.types.ts
    - src/auto-practice/metrics/metric-dictionary.ts
    - src/auto-practice/metrics/batch-metrics.schema.ts
    - test/engine-adapters/judge/
  modules:
    - engine-adapters/judge
    - auto-practice/metrics
  interfaces:
    - ReviewJudgePort
    - JudgeReviewResult
    - JudgeReviewLineage
    - JudgeRedactionInput
artifacts:
  - name: AF-611 Judge Layer P0 骨架交付记录
    path: docs/worklog/completed/phase3-judge-layer/af611-review-port-shadow-skeleton-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 后端事件链、哈希链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-judge-layer/AF-611/task-sheet.md
    check: AF-611 任务单契约校验通过；历史 AF-600 / AF-601 / AF-602 schema 缺口不计入本单新增失败
    threshold: AF-611 任务单元 PASS
  - command: pnpm lint
    check: Judge 新模块、指标字典与快照 schema 相关文件 lint 通过，沿用缓存口径
    threshold: PASS
  - command: pnpm typecheck
    check: Judge 端口、Provider 适配、类型与快照守卫 TypeScript 编译通过
    threshold: PASS
  - command: pnpm exec vitest run test/engine-adapters/judge
    check: Judge 端口替身、Provider 校验回落、脱敏纯函数、Rubric 血缘与可选快照段单测全绿
    threshold: 目标 Judge 规格全绿
  - command: pnpm orchestration:preflight
    check: 暂存文件唯一归属 AF-611，不含状态面生成物、legacy migrate 遗留或冻结期 PsyGuard 改动
    threshold: PASS
successCriteria:
  - 定义 ReviewJudgePort 与 JudgeReviewResult：场次级输入携带 L0 指标、L1 事件标签、脱敏片段与场次血缘；输出三维度 0/1/2 主评、理由、证据引用、信心度与调用血缘；该 0/1/2 评级独立于 drills 模块现有 boundary 语义标签，不复用也不覆盖 DrillVerdict
  - 首个 Judge Provider 复用后端既有 LLM 路由与结构化 JSON 出口，不新增第三方 SDK 或运行时依赖；ProviderId 与模型由配置显式记录，默认沿用现有已连通厂商；DeepSeek 明确排除，不登记 Provider 枚举、配置或适配实现
  - Rubric 配置版本化：维度集合、0/1/2 分档锚点、Prompt 模板、rubricVersion 与 promptVersion 集中在 Judge 配置；Rubric 或 Prompt 变更进入血缘指纹，批次之间版本不一致不得直接纵向比较
  - Shadow 模式闭环：批次跑批在 L0/L1 结果就绪后旁路调用 Judge；评审单与 providerId、模型名、Rubric 版本、Prompt 版本、输入快照指纹等血缘落库或写入既有评测报告/快照路径；Judge 失败、超时、响应越界或校验非法时，Judge 段记 null，批次继续执行，不阻断跑批
  - 快照 Schema 保持 v1，Judge 段作为可选字段接入；旧快照缺省 Judge 段仍通过守卫；合法可选段必须包含评级、理由、证据引用、信心度与血缘；非法评级、缺理由、缺血缘或证据引用缺失必须被守卫拒绝
  - 指标字典新增 judge.* 指标段；Judge 指标方向标记为 neutral，仅观测与留痕，不进入现有回归好坏判定；Regression evaluator 的四态 verdict、五条 incomparable 条件与中性维度纪律保持不变
  - Judge 专用脱敏层先落纯函数骨架：PII 正则复用既有 pii-redactor；语义去标识将人名、地名、单位、家庭关系泛化为角色类别；自伤、创伤细节降级为类别标签，不送原文；危机或自伤相邻轮次在进入外部请求前被规则排除，只保留本地规则结论与引用
  - Judge 输出与报告显式标注机器代理评审属性；本层不得产出临床效度证据、咨询师执业认定或真人专家替代结论
  - 单测覆盖端口替身、Provider 输入校验与失败回落、脱敏典型案例、Rubric/Prompt 版本血缘、可选 Judge 段快照守卫；测试只跑 AF-611 目标规格，不全量回归
outOfScope:
  - 不做 P1 双 Judge、跨模型族一致率统计、人工复核队列表与入队规则、AI / 真人一致性矩阵
  - 不做 P2：Judge 信号纳入回归判据、阈值表调整、基线回放校准或改变现有 Regression evaluator verdict
  - 不接入 DeepSeek，不新增海外或未登记厂商 Provider，不新增 LLM SDK、评分库或数据库驱动依赖
  - 不修改 Flutter 客户端、前端标注台、Admin 页面、评审报告 UI 或现有 HTTP 响应展示契约
  - 不重构 src/counselor/drills 判定引擎、润色服务或 DrillVerdict 枚举；Judge Layer 评级与 drills 演练反馈保持独立边界
  - 不合并 AF-604 PR #311，不创建后端台账合并 PR，不推送 Flutter XS-143 本地提交
  - 不清理 AF-600 / AF-601 / AF-602 回执 schema 缺口、VPT 哈希漂移、根目录临时脚本、AF-545 缺任务单或 legacy migrate 遗留改动
  - 不触碰冻结期 PsyGuard Python 服务代码、数据与环境
constraints:
  - 状态面只能经 NestJS CLI 写入；本单不手工编辑 task-state-index.json、journal.jsonl、快照或 Web 投影
  - 后端脚本优先 pnpm 口径；禁止裸 npx；lint 走 pnpm lint 缓存；测试按需运行，全量回归仅在任务收尾执行一次
  - 提交标题遵循 conventional commit；提交钩子正常运行，不使用 --no-verify、force push、直推 integrate 或删除 required checks
  - 工作区既有 legacy manifest 修改、回执删除件、未跟踪 legacy 记录包、状态投影与 Web data.js 不纳入 AF-611 提交
  - 若 P0 落库确需新表或 migration，仅做 Judge 评审单最小结构；表字段、血缘索引与只读查询范围须在交付记录中逐项登记，不扩展后台编辑能力
---

# AF-611 · Judge Layer P0：评审端口、首个现有厂商 Provider、Rubric 版本化与 Shadow 落库骨架

## 1. 背景

Phase3 Judge Layer 预研备忘位于 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`。P0 目标是先用机器打通批次跑批、结构化评审单、血缘留痕与 Shadow 观测链路；Judge 结论只旁路记录，不进入回归 verdict，不替代真人专家。

已拍板口径：主评采用三档编号 0 / 1 / 2；v1 快照走可选 Judge 字段，不升级 schema v2；首个 Judge Provider 使用后端现有已连通厂商；DeepSeek 不接入。本单只授权 P0 骨架，P1 双 Judge、人工队列与 P2 判据接入另行登记任务单。

## 2. 执行方式

【执行方式：请转发至 NestJS 豆包会话执行；scope 明确的编码切片可接力 MiniMax Code；回执回流后小豆只做台账回收与元数据核对，不复跑后端业务闸门】

分流依据：本单是 NestJS 后端引擎与指标快照契约开发，涉及 Judge 端口、Provider 适配、脱敏纯函数、指标字典与 schema 守卫；不属于 Flutter 客户端、Framework 通用规范件或小豆可直接交付的轻量任务。

## 3. 改动清单

| 编号 | 仓库 / 位置 | 文件或模块 | 动作 |
| --- | --- | --- | --- |
| J1-1 | mofang-nestjs | `src/engine-adapters/judge/` | 新增 Judge 端口、结果类型、Rubric 版本配置、脱敏纯函数、首个 Provider 适配与 Shadow 编排服务 |
| J1-2 | mofang-nestjs | `src/engine-adapters/eval/eval.service.ts`、`eval.types.ts` | 在既有批次评测链路接入旁路 Judge 调用；失败时 Judge 段为空，批次主流程不被阻断 |
| J1-3 | mofang-nestjs | `src/auto-practice/metrics/metric-dictionary.ts` | 新增 `judge.*` 观测指标段；方向标记 neutral，不参与好坏判定 |
| J1-4 | mofang-nestjs | `src/auto-practice/metrics/batch-metrics.schema.ts` | v1 快照新增可选 Judge 段守卫；旧快照无 Judge 段兼容通过 |
| J1-5 | mofang-nestjs | `test/engine-adapters/judge/` | 端口替身、Provider 校验回落、脱敏案例、Rubric 血缘、可选快照段守卫单测 |
| J1-6 | mofang-nestjs | `docs/worklog/records/phase3-judge-layer/AF-611/` 与完成态交付记录 | 任务记录包、冻结回执副本、验收清单、scope 隔离、backlog 与结论 |

## 4. 产品与工程边界

### 4.1 P0 必须保留

- 场次级调用，Judge 不逐轮打分；轮级证据由既有 L0 / L1 规则产出，Judge 只引用证据片段。
- 危机、自伤相关轮次不走外部 Judge；本地规则结论保留在评审输入与记录中。
- Judge 输入先脱敏；外部请求不可见原始 PII、语义身份线索或创伤细节原文。
- 评审血缘记录 Provider、模型、Rubric 版本、Prompt 版本与输入快照指纹。
- Shadow 结果不得改变现有批次通过、回归、中性指标或不可比判定。

### 4.2 明确不做

- 不做真人评审队列、标注台、专家校准样本与前端页面。
- 不把 Judge 0/1/2 评级解释为分数、及格线、等级排名或临床诊断。
- 不绕过既有 LLM 结构化出口另建 SSE、HTTP 拼装或响应格式通道。
- 不在本单修复既有演练 drills 判定规则；两者评级语义分属不同模块。

## 5. 闸门口径

1. `events verify`：事件链、哈希链与任务索引投影一致。
2. 任务单 `validate`：AF-611 schema 与字段契约通过；AF-600 / AF-601 / AF-602 历史回执缺口作为既有债，不计入本单新增失败。
3. `pnpm lint`：Judge 新模块、指标字典、快照守卫与测试文件通过 lint 缓存检查。
4. `pnpm typecheck`：端口、Provider、类型与守卫编译通过。
5. 目标 Vitest 规格：Judge 端口、Provider 失败回落、脱敏纯函数、版本血缘与可选快照段全绿。
6. `orchestration:preflight`：暂存范围只覆盖 AF-611 scope；状态面生成物、legacy migrate 遗留与 PsyGuard 改动不得混入。

## 6. 回执回收要点

执行方回执需写明：Judge 端口与 Provider 实现文件、Rubric 配置位置、可选快照段字段、血缘字段、脱敏规则覆盖案例、Shadow 失败回落路径、目标测试命令与结果、未纳入 P1 / P2 的遗留项。小豆回收时只核对回执工件路径、字段完整性、scope 引用、依赖与台账状态；测试、lint、typecheck 等业务闸门结论以执行方回执与原始日志为准。
