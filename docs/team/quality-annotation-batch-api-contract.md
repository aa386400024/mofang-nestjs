# 质量标注台 · 批次化 API 契约 (WP-N)

> 状态: ✅ 已交付 (2026-11-11) · 配套任务单 `docs/worklog/completed/phase2.5/wp-n-annotation-batch-scope-task-2026-11-11.md`
> 本文件是**契约**: 只写请求/响应形状与语义, **不写前端实现**.
> 后端实现: `src/quality/**` · migration `1714900000047`

---

## 一、总览

标注台从「只能标一份写死的 30 场锚点」升级为「**按批派生队列**」:
给定一个批次, 标注台能列出该批全部可标场次; 未标的就是队列.
标注结论带 `batch_id` 与当时那批的引擎/prompt 版本, 日后能复算「这条结论对应哪版规则」.

### 1.1 端点清单 (7 个 HTTP 路由 + 1 个 CLI)

| #   | 方法 | 路径                                                     | 用途                            |
| --- | ---- | -------------------------------------------------------- | ------------------------------- |
| 1   | GET  | `/admin/api/quality/batches`                             | 可标注批次清单                  |
| 2   | GET  | `/admin/api/quality/annotations`                         | 标注列表 (全局口径 / 批次口径)  |
| 3   | GET  | `/admin/api/quality/annotations/:ref`                    | 单条详情 (行 + 逐字稿)          |
| 4   | PUT  | `/admin/api/quality/annotations/:ref`                    | 保存人工标注                    |
| 5   | GET  | `/admin/api/quality/annotations/:ref/reveal`             | 双盲揭示 (须先保存人工标签)     |
| 6   | GET  | `/admin/api/quality/annotations/:ref/auto`               | 自动判定 (随时可调, 不破坏双盲) |
| 7   | GET  | `/admin/api/quality/consistency`                         | 一致性报告 (含可比性口径)       |
| CLI | —    | `pnpm exec tsx bin/quality-freeze-batch.ts --batch <id>` | 逐字稿批量预冻结 (非 HTTP)      |

> ⚠️ 任务单 §D7 / §D8 写的是「6 + 2 = 8 个端点」, 但同一份任务单 §D2 / §D3 / §D4 逐条列出来的
> HTTP 路由只有 **7 个** (新增的是 `batches` 一个; `annotations` 与 `consistency` 是**加查询参数**, 不是新路由).
> 本契约按任务单自己枚举的 7 条落地, 第 8 项以 CLI 形式交付 (见 §四). **没有为了凑数造端点**.

### 1.2 `:ref` 的语义

`GET/PUT /annotations/:ref` 的 `:ref` 接受**两种**标识 (解析顺序: 先按标注行 id, 再按 debug_session_id):

- **标注行 id** —— `quality_annotation.id` (UUID, char(36));
- **debug_session_id** —— 逐字稿会话 id (如 `debug_tLyV8twfqNdwbdsApRhB5`).

若两者都未命中, 后端会再去 `ap_practice_sessions` 反查一次 (该场次存在但还没落标注行时命中),
命中即返回**派生视图** (`id: null`); 仍不命中 → **404**.

> URL 形状与改造前的 `:id` 完全一致, **老前端不改也能跑**.

---

## 二、端点契约

### 2.1 GET /admin/api/quality/batches

可标注批次清单. **默认只返回 `valid === true` 的批次** (无效批次被隐藏, 但会报出隐藏了多少个).

**Query**

| 参数             | 类型                              | 缺省 | 说明                                          |
| ---------------- | --------------------------------- | ---- | --------------------------------------------- |
| `includeInvalid` | `"1" \| "0" \| "true" \| "false"` | `0`  | `1` = 全部返回 (含无效批次). 非法值 → **400** |

**Response 200**

```json
{
  "data": [
    {
      "batchId": "p1d-r3-intake-2026-11-11",
      "createdAt": "2026-11-10T23:11:36.000Z",
      "sessions": 16,
      "completedSessions": 16,
      "annotatableSessions": 16,
      "annotatedSessions": 0,
      "transcriptAvailableSessions": 16,
      "valid": true,
      "validityFlags": [],
      "engineVersion": "e3b0680-dirty",
      "promptVersion": "f1fdb4f90a5e622a",
      "configFingerprint": "64fb2a967e401b5b"
    }
  ],
  "meta": { "generatedAt": "2026-11-11T05:40:00.000Z", "total": 6 },
  "warnings": ["INVALID_BATCHES_HIDDEN:12"]
}
```

**字段语义**

| 字段                          | 类型         | 可空   | 语义                                                              |
| ----------------------------- | ------------ | ------ | ----------------------------------------------------------------- |
| `batchId`                     | string       | 否     | 真批次 id (非合成值)                                              |
| `createdAt`                   | string (ISO) | **是** | 批次首场 `started_at` 的最小值                                    |
| `sessions`                    | number       | 否     | 该批场次数                                                        |
| `completedSessions`           | number       | 否     | `status = 'completed'` 的场次数                                   |
| `annotatableSessions`         | number       | 否     | 可进队列的场次数 (见 §二.1.1 判定)                                |
| `annotatedSessions`           | number       | 否     | 已有人工标签 (`dominant_label` 非 NULL) 的场次数                  |
| `transcriptAvailableSessions` | number       | 否     | 逐字稿仍在 (冻结副本或活文件任一可取) 的场次数                    |
| `valid`                       | boolean      | **是** | `ap_practice_batches.valid`; **没有批次行 → `null`** (不是 false) |
| `validityFlags`               | string[]     | 否     | 不达标原因码 (逗号串拆开); 无 → `[]`                              |
| `engineVersion`               | string       | **是** | 该批引擎版本 (`git describe --dirty`)                             |
| `promptVersion`               | string       | **是** | 该批 prompt 模板指纹 (16 位 hex)                                  |
| `configFingerprint`           | string       | **是** | 该批配置指纹                                                      |

#### 2.1.1 可标注判定 (后端纯函数, 前端可据此解释计数)

```
annotatable = status === 'completed'
           AND turn_count > 0
           AND debug_session_id 非空
           AND 逐字稿可获取 (冻结副本 或 活文件)
```

**`warnings` 的告警码**

| 码                           | 含义                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `INVALID_BATCHES_HIDDEN:<n>` | 本次隐藏了 n 个无效批次 (`valid !== true`, 含没有批次行的旧批次) |

> ⚠️ **不允许静默隐藏**: 默认过滤掉无效批次时, **必须**报出 `INVALID_BATCHES_HIDDEN:<n>`,
> 让操作者知道"还有 n 个批次被藏起来了"并能主动打开看.

**排序**: `createdAt DESC`, `batchId ASC` 兜底 (确定性).

---

### 2.2 GET /admin/api/quality/annotations

**Query**

| 参数      | 类型                           | 缺省      | 说明                                         |
| --------- | ------------------------------ | --------- | -------------------------------------------- |
| `status`  | `"pending" \| "done" \| "all"` | `pending` | 非法值 → **400** (不静默兜底成 all)          |
| `batchId` | string                         | **省略**  | 批次 id; 非法形状 → **400**. 省略 = 全局口径 |

**两种口径 (互不混用)**

|                  | 不传 `batchId` (全局口径)                                                                     | 传 `batchId` (批次口径)                                                 |
| ---------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 返回集合         | 全部可标注场次 LEFT JOIN 标注行: 已落库行保留在前, 未标注的可标注场次补 **`id: null`** 派生行 | 该批**全部可标注场次** (`sessions LEFT JOIN annotation`)                |
| `id`             | 已落行的非空; 未落行的为 **`null`**                                                           | 已落行的非空; 未落行的为 **`null`**                                     |
| `done` / `total` | **全量口径** (不随 `status` 过滤变化; `total` = 已落库行数 + 派生场次数)                      | **该批口径**                                                            |
| 排序             | 已落库行按锚点清单顺序 (`anchor_order`, 再按 id) 在前; 派生场次按全局确定性顺序               | `character_slug → counselor_mode_id → started_at → practice_session_id` |

> ⚠️ **不传 `batchId` 同样走派生队列** (2026-11-11 后续补丁放宽): 全局队列同时列出已标与待标场次; 行视图**只增字段** (旧字段语义一字未改), 新增字段见 §三.

**Response 200**

```json
{
  "items": [
    {
      "id": null,
      "debugSessionId": "debug_tLyV8twfqNdwbdsApRhB5",
      "characterSlug": "vpt_general_secure_l1",
      "attachmentStyle": "secure",
      "firstExplorationTurn": null,
      "dominantLabel": null,
      "crisisPeakLevel": 0,
      "crisisFirstTurn": null,
      "shouldEndTurn": null,
      "needsReview": false,
      "durationMs": 0,
      "notes": null,
      "updatedAt": null,
      "batchId": "p1d-r3-intake-2026-11-11",
      "counselorModeId": "expert",
      "turnCount": 12,
      "engineVersion": "e3b0680-dirty",
      "promptVersion": "f1fdb4f90a5e622a",
      "characterVersion": "1.0.0",
      "firstBadTurn": null,
      "badTurns": null,
      "turnNote": null,
      "transcriptSource": "live",
      "warnings": []
    }
  ],
  "done": 1,
  "total": 16
}
```

**行视图字段 (只增不改)**

| 字段                   | 类型         | 可空   | 说明                                                                        |
| ---------------------- | ------------ | ------ | --------------------------------------------------------------------------- |
| `id`                   | string       | **是** | 标注行 id; **`null` = 尚未落行** (首次 PUT 才建)                            |
| `debugSessionId`       | string       | 否     | 逐字稿会话 id —— **`id` 为 null 时用它当主键**                              |
| `characterSlug`        | string       | 否     | 角色代号                                                                    |
| `attachmentStyle`      | string       | 否     | 依恋风格; 由 `character_profiles` 反查, **取不到 → `'unknown'`** (不是空串) |
| `firstExplorationTurn` | number       | 是     | 人工: 探索开始轮次                                                          |
| `dominantLabel`        | enum         | 是     | 人工: 主导标签; `null` = 待标                                               |
| `crisisPeakLevel`      | number       | 否     | 人工: 危机峰值档位 0~3                                                      |
| `crisisFirstTurn`      | number       | 是     | 人工: 危机首次出现轮次                                                      |
| `shouldEndTurn`        | number       | 是     | 人工: 该断轮次                                                              |
| `needsReview`          | boolean      | 否     | 存疑 / 待复审                                                               |
| `durationMs`           | number       | 否     | 标注耗时 (毫秒)                                                             |
| `notes`                | string       | 是     | 人工备注 (≤2000 字)                                                         |
| `updatedAt`            | string (ISO) | **是** | 最后保存时刻; 派生行 = `null` (还没保存过)                                  |
| `batchId`              | string       | 是     | 归属批次; `null` = 无法归属的历史单场                                       |
| `counselorModeId`      | string       | 是     | 该场咨询师模式                                                              |
| `turnCount`            | number       | 是     | 该场轮数快照                                                                |
| `engineVersion`        | string       | 是     | 该场引擎版本 (结论对应哪版引擎)                                             |
| `promptVersion`        | string       | 是     | 该场 prompt 指纹                                                            |
| `characterVersion`     | string       | 是     | 该场角色版本                                                                |
| `firstBadTurn`         | number       | 是     | 轮级: 从第几轮开始"不对" (`1..turnCount`)                                   |
| `badTurns`             | string       | 是     | 轮级: 有问题的轮次清单 (逗号分隔, ≤10, 去重升序)                            |
| `turnNote`             | string       | 是     | 轮级说明 (≤2000 字, **只允许事实描述**)                                     |
| `transcriptSource`     | enum         | 否     | `frozen` / `live` / `missing`                                               |
| `warnings`             | string[]     | 否     | 本行告警码 (空数组 = 无告警)                                                |

`dominantLabel` 取值域: `recounting` / `resistance` / `simple_response` / `affective` / `cognitive_exploration`.

---

### 2.3 GET /admin/api/quality/annotations/:ref

**Response 200**

```json
{
  "row": { "id": null, "debugSessionId": "debug_...", "...": "同 §2.2 行视图" },
  "characterLabel": "晚晴",
  "messages": [
    { "role": "counselor", "text": "...", "turnIndex": 1 },
    { "role": "visitor", "text": "...", "turnIndex": 1 }
  ],
  "transcriptSource": "frozen",
  "warnings": []
}
```

| 字段               | 类型     | 可空 | 说明                                           |
| ------------------ | -------- | ---- | ---------------------------------------------- |
| `row`              | object   | 否   | 标注行 / 派生视图                              |
| `characterLabel`   | string   | 是   | 来访者展示名                                   |
| `messages`         | array    | 否   | 逐字稿台词 (**只双方台词**; 缺失 → 空数组)     |
| `transcriptSource` | enum     | 否   | `frozen` / `live` / `missing`                  |
| `warnings`         | string[] | 否   | 告警码 (逐字稿缺失 → `["TRANSCRIPT_MISSING"]`) |

**逐字稿读路径 (冻结优先)**

```
冻结副本存在 → 读冻结 ('frozen')
否则读活文件   → ('live')
两者都没有     → 'missing' (台词空数组 + TRANSCRIPT_MISSING 告警, **不报错**)
```

> ⚠️ 逐字稿活文件受 `MAX_DEBUG_SESSIONS=500` 约束会被淘汰; 冻结副本 (
> `data/quality/transcripts/<batchId>/<debugSessionId>.json`) 是标注结论的**唯一**回看依据.

---

### 2.4 PUT /admin/api/quality/annotations/:ref

**Request Body** (全部可空; 字段语义见 §2.2 行视图)

```json
{
  "firstExplorationTurn": 3,
  "dominantLabel": "recounting",
  "crisisPeakLevel": 2,
  "crisisFirstTurn": 4,
  "shouldEndTurn": 7,
  "needsReview": false,
  "durationMs": 12345,
  "notes": "存疑: 第 4 轮语气突变",
  "firstBadTurn": 4,
  "badTurns": "4,7",
  "turnNote": "第 4 轮来访者换了话题, 咨询师没有接住"
}
```

**行为**

- **保存即覆盖**: 一场会话一行, 重标覆盖旧值 (不堆历史);
- **未落行 → 幂等 upsert**: 先从 `ap_practice_sessions` 取 `batch_id / counselor_mode_id / turn_count /
engine_version / prompt_version / character_version` 落新行 (同时补 `character_slug` / `attachment_style` / `anchor_order`),
  再写人工列. **唯一键仍是 `debug_session_id`** —— 重复 PUT 不产生第二行, 第二次只改人工列, **不改归属列**;
- **保存成功后自动冻结**一份逐字稿 (失败只加 `FREEZE_FAILED` 告警, **不阻断保存**).

**Response 200**: 同 §2.2 的行视图 (`warnings` 含 `FREEZE_FAILED` 时非空).

**400 的两种情形 (不静默丢弃)**

| 情形                                                       | 消息                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `badTurns` 非法 (非正整数 / 超过 `turnCount` / 超过 10 个) | `轮次不是正整数: "x"` 等                              |
| `firstBadTurn` 超出本场轮数                                | `firstBadTurn 超出本场轮数 12`                        |
| `turnNote` 含评分 / 等级 / 对错语义                        | `turnNote 不允许评分 / 等级 / 对错语义 (命中 "评分")` |

> ⚠️ **零压红线**: 轮级三列只允许**事实描述**. 禁用词: 评分 / 得分 / 分数 / 等级 / 评级 / 总分 / 对错 / 正确率.
> `turn_note` 也不接受任何评分含义的字段 (本表新增列里没有分数列, 也没有等级列).

**轮级三列不参与 `done` 判定** —— `done` 仍只认 `dominant_label`, 进度条合同不变.

---

### 2.5 GET /admin/api/quality/annotations/:ref/reveal

**Response 200**

```json
{
  "auto": { "explorationTurn": null, "dominantLabel": "recounting", "crisisLevel": 0 }
}
```

**400**: 本场还没保存人工标注 (`dominant_label` 为空) → 双盲闸门, 不返回自动答案.

---

### 2.6 GET /admin/api/quality/annotations/:ref/auto

与 `reveal` 同形状, **但不设双盲闸门** —— 随时可调的规则引擎判定, 给标注员"拿不准时主动问"用.

---

### 2.7 GET /admin/api/quality/consistency

**Query**

| 参数      | 类型   | 缺省     | 说明                                                |
| --------- | ------ | -------- | --------------------------------------------------- |
| `batchId` | string | **省略** | 批次 id; 非法 → **400**. 省略 = 全量口径 (向后兼容) |

**Response 200**

```json
{
  "labeled": 1,
  "total": 16,
  "labelAgreement": 0,
  "crisisAgreement": 1,
  "explorationTurnMae": null,
  "scope": {
    "batchId": "p1d-r3-intake-2026-11-11",
    "sessions": 16,
    "engineVersions": ["e3b0680-dirty"],
    "promptVersions": ["f1fdb4f90a5e622a"],
    "comparable": true,
    "incomparableReasons": [],
    "warnings": ["SMALL_SAMPLE", "ENGINE_VERSION_DIRTY"]
  }
}
```

**口径 (给了 `batchId` → 该批; 不给 → 全量)**

| 字段                 | 类型   | 说明                                                                                  |
| -------------------- | ------ | ------------------------------------------------------------------------------------- |
| `labeled`            | number | 已标注场次数                                                                          |
| `total`              | number | 分母: 给批次 = 该批场次数; 不给 = 全量**已标注**行数 (未标注派生场次不计入一致性分母) |
| `labelAgreement`     | number | 主导标签一致率 0~1; 无可比场次 → `null`                                               |
| `crisisAgreement`    | number | 危机档位一致率 0~1; 无可比场次 → `null`                                               |
| `explorationTurnMae` | number | 探索轮次平均绝对误差; 无可比场次 → `null`                                             |

**`scope` (可比性口径)**

| 字段                  | 类型     | 说明                                         |
| --------------------- | -------- | -------------------------------------------- |
| `batchId`             | string   | **是**                                       | `null` = 全量口径 |
| `sessions`            | number   | 该口径覆盖的场次数                           |
| `engineVersions`      | string[] | 去重后的引擎版本; `null` → `'<unknown>'`     |
| `promptVersions`      | string[] | 去重后的 prompt 版本; `null` → `'<unknown>'` |
| `comparable`          | boolean  | 是否可比                                     |
| `incomparableReasons` | enum[]   | 不可比原因码 (空 = 可比)                     |
| `warnings`            | enum[]   | 只告警的码 (**不影响** `comparable`)         |

**不可比原因码 (`incomparableReasons`)** —— 任一命中 → `comparable: false`

| 码                           | 条件                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `MIXED_ENGINE_VERSION`       | 该批 `engine_version` 去重 > 1                           |
| `MIXED_PROMPT_VERSION`       | 该批 `prompt_version` 去重 > 1                           |
| `NO_LABELED_SESSION`         | 该批 `labeled = 0`                                       |
| `TRANSCRIPT_MISSING_PARTIAL` | 该批存在 `transcriptSource === 'missing'` 的**已标**场次 |

**只告警码 (`warnings`)** —— **不进** `incomparableReasons`, **不影响** `comparable`

| 码                     | 条件                                            |
| ---------------------- | ----------------------------------------------- |
| `SMALL_SAMPLE`         | `labeled < 5`                                   |
| `ENGINE_VERSION_DIRTY` | `engine_version` 含 `-dirty` (基线来自脏工作区) |

> ⚠️ **数字在 `comparable: false` 时仍然返回** —— 后端不替前端决定遮不遮,
> 但**前端必须挂横幅**遮住 `labelAgreement` / `crisisAgreement` / `explorationTurnMae`.
> 理由: 跨引擎版本的标签一致率没有解释力 (WP-K 的教训: 没有 incomparable 的工具会给出**自信的错结论**).

> ⚠️ **样本少不是"不可比"**: `SMALL_SAMPLE` 只是"解释力有限", 判成不可比会让工具在
> 还能给数的时候拒绝给数. 两者必须分开.

---

## 三、前端必须处理的三种态

| #   | 态                            | 触发条件                                                   | 前端必须做什么                                                                                                             |
| --- | ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ①   | `id: null` (未落行)           | 批次口径队列里, 还没保存过标注的场次                       | **用 `debugSessionId` 当主键** (`PUT /annotations/:ref` 也传它); 列表 key 不能用 `row.id` (会撞 key)                       |
| ②   | `transcriptSource: 'missing'` | 逐字稿已被 `MAX_DEBUG_SESSIONS=500` 淘汰, 且没有冻结副本   | 显示"逐字稿已不可回看"提示; **不要**当成"这场没聊过" (0 轮); 详情 `messages` 是空数组 + `warnings` 含 `TRANSCRIPT_MISSING` |
| ③   | `scope.comparable: false`     | 该批混了引擎/prompt 版本 / 一场没标 / 已标场次有逐字稿缺失 | 挂横幅**遮住**三个一致性数字, 并把 `incomparableReasons` 的码翻译成人话                                                    |

补充: `attachmentStyle` 取不到时是 `'unknown'` (不是空串); `valid` 在没有批次行时是 `null` (不是 false).
两者都**不要**在前端兜底成"正常值" —— 那等于替数据编了个结论.

---

## 四、批次下拉的取数方式

```
GET /admin/api/quality/batches            # 默认只给有效批次
GET /admin/api/quality/batches?includeInvalid=1   # 要看被藏起来的批次时
```

- 下拉选项取 `data[].batchId` 与 `data[].createdAt`;
- **必须读 `warnings`**: 出现 `INVALID_BATCHES_HIDDEN:<n>` 时, 在下拉旁提示"另有 n 个批次未通过有效性门禁,
  可勾选"显示无效批次"查看" —— 不许静默忽略;
- `data[].annotatableSessions` 是"这一批还能标多少场"; `data[].annotatedSessions` 是"已经标了多少场";
  两者相减 = 该批剩余工作量.

### 4.1 逐字稿预冻结 (CLI)

```bash
pnpm exec tsx bin/quality-freeze-batch.ts --batch <batchId> [--dry-run]
```

- 输出 (单行 JSON): `{"frozen":N,"alreadyFrozen":N,"missing":N}`;
- 退出码: **0** = 全部成功 · **1** = 有 `missing` (逐字稿在冻结前就已淘汰) · **2** = 参数错误;
- 冻结副本落在 `data/quality/transcripts/<batchId>/<debugSessionId>.json`.

> `PUT` 保存标注时**已经会自动冻结**一份; 这个 CLI 是给"还没开始标就想先把整批留档"用的.

---

## 五、明确: 前端**不需要**也不**许**把 `batchId` 做成默认值

```
不传 batchId  → 看全局全量 (已落库行 + 未标注场次派生队列)
传 batchId    → 看某一批 (按批派生队列)
```

**两种口径不能混.** 具体理由:

1. **分母不同**: 全局口径的 `done/total` 覆盖全部可标注场次; 批次口径是该批场次数 (如 16).
   前端进度条若用同一套口径算, 会把"这一批标了 3 场"显示成"总共标了 3/全局总数".
2. **旧 30 场是 debug 期数据**, 已判定不具校准价值; 它们作为**历史标注记录**保留在全局队列前部, 不进批次可标队列.
   把它们混进批次视图, 就是在拿旧引擎的数据凑新批次的分母.
3. **一致性报告跨批混算没有解释力** —— 这正是 `scope.comparable` 存在的原因.

> 因此: 批次下拉的**初始态应该是"不选批次"** (看全局), 由操作者显式选一个批次才切到批次口径.
> **不许**把最近一次用过的批次 id 存成默认值自动带上 —— 那等于让用户在看哪一批都不确定.

---

## 六、错误码

| 情形                                            | HTTP | 说明                      |
| ----------------------------------------------- | ---- | ------------------------- |
| `status` 参数非法                               | 400  | 不静默兜底成 all          |
| `batchId` 参数非法 (含路径分隔符 / 空格 / 超长) | 400  | 不静默兜底成全量          |
| `includeInvalid` 参数非法                       | 400  | —                         |
| `badTurns` / `firstBadTurn` 非法                | 400  | 不静默丢弃轮次            |
| `turnNote` 含评分 / 等级语义                    | 400  | 零压红线                  |
| `:ref` 两处都查不到                             | 404  | —                         |
| `reveal` 时本场还没保存人工标注                 | 400  | 双盲闸门                  |
| 非 admin 角色                                   | 403  | class 级 `AdminRoleGuard` |

---

## 七、附: 本次新增的落库列 (`quality_annotation`)

| 列                  | 类型             | 语义                                             |
| ------------------- | ---------------- | ------------------------------------------------ |
| `batch_id`          | varchar(64) NULL | 归属批次; NULL = 无法归属的历史单场 (**不编造**) |
| `counselor_mode_id` | varchar(32) NULL | 该场咨询师模式                                   |
| `turn_count`        | int NULL         | 该场轮数快照                                     |
| `engine_version`    | varchar(64) NULL | 该场引擎版本                                     |
| `prompt_version`    | varchar(64) NULL | 该场 prompt 指纹                                 |
| `character_version` | varchar(32) NULL | 该场角色版本                                     |
| `first_bad_turn`    | int NULL         | 轮级: 从第几轮开始不对                           |
| `bad_turns`         | varchar(64) NULL | 轮级: 有问题的轮次清单                           |
| `turn_note`         | text NULL        | 轮级说明 (事实描述)                              |

索引: `idx_quality_annotation_batch (batch_id)`; 既有唯一索引 `debug_session_id` 保留不动 (一场一行).

存量 30 行按 `ap_practice_sessions` 反查回填 `batch_id` (查不到的保持 NULL): **23 行命中 (20 + 3), 7 行保持 NULL**.
