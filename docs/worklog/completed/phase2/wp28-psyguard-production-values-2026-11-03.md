# WP28：WP11 临时值回改正式生产值

> 状态: ✅ 已交付（2026-11-03）→ 交付记录: [`engine-wp28-psyguard-production-values-implementation-2026-11-03.md`](./engine-wp28-psyguard-production-values-implementation-2026-11-03.md)（同目录）
> 优先级: 🔴 P0（商业化根基）
> 预估: 小（半天内）
> 依赖: 无

> ⚠️ **交付时发现本单 §4 的一处事实错误（已与用户确认后处理）**：§4 写「不改 `src/engine-core/**`（本 WP 不需要碰内核）」，但 §3.1 要求的 `500ms → 150ms` 那个常量**就住在** `src/engine-core/cognition/safety/assess-safety.ts:75`，且是咨询师输入面的**实际生效值**（该路径调 `assessSafety` 时不传 `timeoutMs`）。不改它，150ms 在主输入面不生效。
> 权威依据：WP25 审查任务单 §1.4 的 11 处回改 checklist（A1–A8 + B1–B3）—— 本单即该 checklist 的执行单。
> 用户 2026-11-03 拍板：**改内核常量 + 登记例外**；**兄弟仓一并改**。详见交付记录 §1 / §5.1。

---

## 1. 背景

WP11 开发期间为了联调方便，把 PsyGUARD 的两个参数放宽了：
- 超时从生产值 150ms 放宽到 500ms
- token 窗口从生产值 28 放宽到 256

当时用户拍板"开发期间不用改回"。现在 Phase1 已封版，内测前必须改回生产值，否则用户等 500ms 体验太差。

---

## 2. 任务目标

把 WP11 临时放宽的两个参数改回正式生产值，并确认测试全绿。

---

## 3. 具体改动

### 3.1 PsyGUARD 超时

**找到当前值**：grep `PSYG_MAX_LENGTH` / `psyguard.*timeout` / `500` 在 PsyGUARD 相关配置里。

**改回**：
- 超时：`500ms` → `150ms`
- token 窗口：`256` → `28`

> ⚠️ 注意：如果超时是从环境变量读的（`PSYG_TIMEOUT_MS` 之类），改 `.env.example` 和文档里的默认值，不要硬编码到代码里。

### 3.2 确认影响面

改完后跑一遍 PsyGUARD 相关的测试，确认 150ms 超时不会导致正常请求超时。如果有些测试用例故意用长文本触发超时，要调整测试用例的 mock 延迟。

---

## 4. 红线检查

- ❌ 不改 `src/engine-core/**`（本 WP 不需要碰内核）
- ❌ 不碰前端代码
- ✅ 改的是 PsyGUARD 适配层配置 / 环境变量默认值

---

## 5. 交付闸门

```powershell
npx eslint "src/**/*.ts"                    # → 0 error
npx tsc -p tsconfig.build.json --noEmit     # → 0 error
npx vitest run                              # → 全绿（1252 例 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core     # → 空
```

---

## 6. 交付格式

按 `team/conventions.md` §2 写交付记录：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（跟任务单有出入的地方）
3. 闸门数字

完成后把本任务单 + 交付记录从 `pending/` 移到 `completed/phase2/`。

---

## 7. 回写

交付完更新 [`phase2-wp-list-2026-11-03.md`](phase2-wp-list-2026-11-03.md) 里 WP28 的状态。

---

_创建：2026-11-03_
