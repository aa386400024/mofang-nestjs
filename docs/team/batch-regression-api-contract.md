# 批次回归追踪 API 契约

> 版本：v1（2026-11-11）。对应快照 `schemaVersion = 1`、判据 `intake-v1`。
> 本文件是**契约**，只描述接口与字段，不含前端实现。
> 所有端点挂在 class 级 `AdminRoleGuard` 下，路径前缀 `/admin/api/auto-practice`。

## 1. 统一响应包

```json
{
  "data": "...",
  "meta": { "generatedAt": "ISO8601", "schemaVersion": 1, "total": 0 },
  "warnings": []
}
```

- `warnings` 只放**枚举型**告警码，不放自由文本堆栈；
- 部分 id 非法 / 数据缺失时进 `warnings`，**不整单 500**（容错优先）。

## 2. 端点

### 2.1 `GET /batches` — 批次列表（轻量行）

查询参数：

| 参数          | 取值                                                                                                         | 默认      |
| ------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| `page`        | ≥1                                                                                                           | 1         |
| `pageSize`    | 1..100                                                                                                       | 20        |
| `sort`        | `createdAt` / `explorationRate` / `depthDeltaAvg` / `safetyDeltaAvg` / `positiveEventRate` / `totalSessions` | createdAt |
| `order`       | `asc` / `desc`                                                                                               | desc      |
| `valid`       | `0` / `1`                                                                                                    | 不过滤    |
| `since`       | `YYYY-MM-DD`                                                                                                 | 不过滤    |
| `fingerprint` | 完整指纹字符串                                                                                               | 不过滤    |

`data[]` 字段（**不返回** `metricsJson` / `configFingerprintJson`）：

| 字段                       | 类型        | 可空 | 说明             |
| -------------------------- | ----------- | ---- | ---------------- |
| batchId                    | string      | 否   | 主键             |
| totalSessions / totalTurns | number      | 否   | 规模             |
| valid                      | number(0/1) | 否   | 有效性门禁       |
| createdAt                  | string      | 否   | 首次判定时刻     |
| configFingerprint          | string      | 是   | combined 指纹    |
| explorationRate            | number      | 是   | 冗余标量         |
| depthDeltaAvg              | number      | 是   | 深度阻抗平均变化 |
| safetyDeltaAvg             | number      | 是   | 安全感平均变化   |
| positiveEventRate          | number      | 是   | 正事件率         |
| note                       | string      | 是   | 人工变更说明     |

### 2.2 `GET /batches/:id/metrics` — 单批完整快照

- 正常：`data` = 完整 `BatchMetricsV1`（见 §3），`legacy: false`；
- legacy（`metrics_json` 为 NULL）：`data = { batchId, metrics: null, legacy: true }`，
  `warnings: ["METRICS_NOT_COLLECTED"]`；
- 批次 `valid=0` 时 `warnings` 带门禁告警。

### 2.3 `GET /batches/compare?base=x&candidates=y,z` — 回归对比

- `candidates` 逗号分隔，**上限 10**；
- `data[]` 每个候选一项：

| 字段            | 说明                      |
| --------------- | ------------------------- |
| batchId         | 候选 id                   |
| verdict         | 四态，见 §4               |
| reasons         | incomparable 时的原因列表 |
| changedSegments | 配置指纹变化的段          |
| items           | 逐指标对比（可比时）      |

## 3. 快照结构 `BatchMetricsV1`

| 顶层字段             | 说明                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| schemaVersion        | 恒为 1                                                                      |
| computedAt           | 计算时刻 ISO                                                                |
| batchId              | 批次 id                                                                     |
| fingerprint          | 7 段 + combined（见 §5）                                                    |
| coverage             | expected / included / skipped / skipReasons / totalTurns / transcriptRoot   |
| lineage[]            | 每场：debugSessionId / characterSlug / counselorModeId / turns / fileSha256 |
| metrics              | 指标 id → number \| null（id 口径见指标字典）                               |
| byMode / byCharacter | 分组切片，结构同 metrics                                                    |

**合规约束**：快照内所有字符串值长度 ≤ 64（id / 枚举 / 哈希），不含任何对话文本或 prompt。

## 4. 四态语义（核心）

| Verdict        | 含义                                   |
| -------------- | -------------------------------------- |
| `improved`     | 有指标超出容差改善，且无回归项         |
| `neutral`      | 全部指标变化在容差内                   |
| `regressed`    | 任一指标超出容差变差（保守：回归优先） |
| `incomparable` | 两批不是同一类东西，**拒绝硬比**       |

必须判 `incomparable` 的条件（任一成立）：

1. 两批 `fingerprint.acceptance` 不同（判据变了）；
2. 任一批 `included / expected < 0.9`；
3. 两批 counselorModeId 集合不同；
4. 任一批 `fingerprint.combined === 'unknown'`。

## 5. 配置指纹分段

| 段               | 哈希对象                                   |
| ---------------- | ------------------------------------------ |
| stateTransition  | `state-transition.ts`（DELTA_TABLE + CAP） |
| alliance         | `alliance-config.ts`（门槛）               |
| deltaTableConfig | `delta-table-config.ts`                    |
| lexicon          | `event-lexicon.ts`                         |
| baselines        | `character-baseline-calibration.ts`        |
| prompts          | prompt 模板文件指纹                        |
| acceptance       | `acceptance-thresholds.ts`                 |
| combined         | 以上 7 段再哈希                            |

每段 16 位 hex，路径 + 内容入哈希；文件任何改动（含注释）都会改变该段（保守方向）。

## 6. 前端「批次回归页」要求（契约，不代实现）

1. **时间轴**：批次按时间排列，关键指标折线（可切指标）；
2. **差分表**：选中两批，逐指标列 base / candidate / delta / 方向标记；
3. **指纹变化提示**：`changedSegments` 以标签展示，hover 显示段名；
4. **incomparable 横幅**：verdict 为 incomparable 时顶部显式横幅 + 原因，
   **禁止**仍渲染成"变好/变坏"的红绿结论；
5. legacy 批次显式置灰并标注"未采集指标"，不与有效批同色对比。
