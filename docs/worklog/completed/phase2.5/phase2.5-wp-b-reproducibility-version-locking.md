# 📋 WP-B 可复现控制 + 版本锁定

> 状态：待开工
> 优先级：P0
> 前置：WP-A（审议输入最小化）已完成；WP-D（自动对练）已完成
> 依赖：独立，不阻塞其他 WP

## 背景

Phase2.5 出口条件 ②：**考核公平**——考核场景永远走纯规则模式，LLM 审议只用于非考核场景。

现状盘点：
- `ap_practice_sessions` 已有 `model_version` / `seed_value` 预留列，但 runner 从未写入，全是 null
- R9 灰度切换已有 `scenarioRoutes` 结构，但场景类型机制未接，总开关关着 = 全 rule_only
- 角色 semver 版本系统（WP38）已建好，但自动对练场次没记角色版本
- 模型名在渲染层（`result.render.model`）存在，但没透传落库

## 设计原则

1. **不追求逐字复现**——LLM 概率性做不到，专业做法是接受概率性，保证规则层确定性
2. **版本不是事后补记**，会话创建时注入完整推理环境指纹
3. **考核公平是硬约束**——场景类型参数化，exam 强制 rule_only，不依赖全局开关
4. **可追溯 > 可回放**——出问题能定位是哪个模型/角色/prompt 版本导致的

## 交付物

### 1. InferenceFingerprint 服务（适配层新建）

新建 `src/auto-practice/inference-fingerprint.service.ts`：

会话创建时生成完整指纹：

```ts
interface InferenceFingerprint {
  model: string;              // LLM 模型名（ConfigService 读 MINIMAX_LLM_MODEL）
  characterSlug: string;
  characterVersion: string;    // CharacterVersionService 查 semver（如 "1.0.0"）
  counselorModeId: string;
  deliberationMode: 'rule_only' | 'shadow' | 'llm_active';
  scenarioType: 'exam' | 'freeform' | 'full_simulation';
  engineVersion: string;      // git sha 或 build id（env 注入，缺省 "dev"）
  sessionSeed: string;        // 逻辑种子 = batchId + sessionId 的确定性 hash
}
```

职责：
- 从 ConfigService 读模型名
- 从 CharacterVersionService 查角色 semver
- 从 DeliberationModeConfig 读审议模式
- 生成逻辑种子（不是 LLM seed，是批次+会话的确定性标识）

### 2. ap_practice_sessions 加版本列

现有 `model_version` / `seed_value` 用起来，再加 3 列：

| 列名 | 类型 | 说明 |
|---|---|---|
| `character_version` | VARCHAR(32) | 角色 semver（如 "1.0.0"） |
| `deliberation_mode` | VARCHAR(16) | rule_only / shadow / llm_active |
| `engine_version` | VARCHAR(64) | 代码版本（git sha） |

Migration：`1714900000035-AddPracticeSessionVersionColumns.ts`

### 3. 场景类型硬隔离

`TurnEnginePort.open()` 签名加 `scenarioType` 参数：

```ts
open(characterSlug: string, scenarioType?: ScenarioType): Promise<{ debugSessionId: string }>
```

适配层（`DebugTurnEngineAdapter`）在 open 时：
- `scenarioType === 'exam'` → **强制 rule_only**，不管全局 `ENGINE_DELIBERATION_ENABLED` 开没开
- 这是写死的逻辑，不是配置项——考核场景永远不跑 LLM 审议

自动对练 runner 默认传 `full_simulation`，跟现状一致。

### 4. runner 落库版本信息

`practice-runner.service.ts` 在 `persistSession` 时把指纹字段写进去：
- `modelVersion` = fingerprint.model
- `characterVersion` = fingerprint.characterVersion
- `deliberationMode` = fingerprint.deliberationMode
- `engineVersion` = fingerprint.engineVersion
- `seedValue` = fingerprint.sessionSeed

### 5. Trace / session_start 带指纹

`AutoPracticeSessionStartPayload` 加 `fingerprint` 字段，session_start 事件带完整指纹。后续每轮 trace 只带 sessionId 引用，不冗余。

### 6. 确定性审计（grep 性质，不改代码）

跑一遍 grep 确认 engine-core 决策路径上没有 `Math.random()` / `Date.now()` 藏在决策逻辑里。如果有，记录到交付记录里，但不改（engine-core 红线）。

## 明确不做

| 不做 | 为什么 |
|---|---|
| LLM seed 参数 | MiniMax API 不保证 seed 生效，专业系统不靠这个 |
| 逐字回放 | 接受 LLM 概率性，规则层确定性才是重点 |
| 改 engine-core | 红线 |
| admin 面板 UI | WP-E / Phase3 的事，WP-B 只打数据底座 |
| Prompt 版本锁定 | counselor_modes 表已有 ID + 内容，改了就是新配置 |

## 闸门

- `npx tsc -p tsconfig.build.json --noEmit` 0 错误
- `npx vitest run test/auto-practice/` 全绿
- `git diff --stat HEAD -- src/engine-core` 为空
- migration 在远程 MySQL 执行成功
- 跑一场 POST /batch，DB 查新版本列都有值（不是 null）

## commit message

```
feat(wp-b): 推理环境指纹 + 场景硬隔离——版本落库, 考核场景强制rule_only
```
