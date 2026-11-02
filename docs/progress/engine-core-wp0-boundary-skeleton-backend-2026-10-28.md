# WP0 · 引擎内核边界骨架（engine-core 纯 TS 隔离）后端任务单

> **路径**：`mofang-nestjs/docs/progress/engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`
> **性质**：可直接派给后端的施工任务单（WP0，Phase1 第一张）。
> **上游母版**：[`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) 第 0 原则 + WP0；上游愿景原件 [`../reference/ai-simulation-blueprint-v1.1.md`](../reference/ai-simulation-blueprint-v1.1.md)。
> **日期**：2026-10-28 ｜ **状态**：🟡 **已交付，待大炮验收**（首轮 lint 通过；test 2 处失败已修待复跑；`pnpm build` 未跑） ｜ **规模**：小（只立边界，不写算法）。
> **交付记录**：[`./engine-core-wp0-implementation-2026-10-28.md`](./engine-core-wp0-implementation-2026-10-28.md) ｜ **落地代码**：`src/engine-core/` + `test/engine-core/`

---

## 1. 背景与为什么先做这个

引擎（BDI/记忆/轨迹/伦理/渲染）后期要**独立抽离成对外微服务**。如果一上来就把 BDI 逻辑写进 NestJS service、直连 TypeORM 实体，将来拆服务时内核会和框架缠死、搬不动。

WP0 只做一件事：**先把"纯 TS 内核"的物理边界和最小契约立起来**，不实现任何心理算法，不接现有会话链路。后面 WP1-WP5 都往这个骨架里填。

> 反双胞胎：本任务**不替换、不接线**现有 `src/agent/visitor/` 旧扮演链路；两者并列存在，旧链路本期继续服务线上，内核骨架先空跑。

## 2. 目标（Done 定义）

1. 新建纯 TS 内核目录 `src/engine-core/`，**零** `@nestjs/*`、`typeorm` 实体直连 import；
2. 定义最小领域模型 + 会话端口接口 + 两个内存仓储实现；
3. 内核可脱离 NestJS 容器直接 `new` 出来跑单测；
4. 不新增任何表/列/migration，不改现有 visitor/voice 行为。

## 3. 落地范围

### 3.1 目录结构（新建）

```
src/engine-core/
├── index.ts                      # 只导出公开端口与模型，内部实现不外露
├── domain/
│   ├── bdi-snapshot.ts           # BDI 状态快照类型（字段占位，不写算法）
│   ├── engine-session.types.ts   # 会话端口入参/出参纯 DTO（不沾 HTTP/WS 帧）
│   └── ports/
│       ├── bdi-state.repository.ts   # BDI 状态仓储接口
│       └── memory.store.ts            # 记忆仓储接口
├── runtime/
│   └── engine-session.port.ts    # 会话内核端口接口（open/turn/close 签名）
└── adapters/
    └── README.md                 # 约定：NestJS/WS/TypeORM 适配器放这里，内核不反向依赖
```

### 3.2 最小类型契约（只定义形状，不实现逻辑）

`domain/bdi-snapshot.ts`（字段先占位，WP1 再填算法）：

```ts
/** BDI 状态快照：内核内部状态，与持久化/传输解耦。WP0 仅定形状。 */
export interface BdiSnapshot {
  /** 信念层：核心(不可变)/短期(带置信度)/记忆信念 —— WP1 细化 */
  beliefs: unknown[];
  /** 愿望层：底层愿望 + 情境愿望(带权重/优先级) —— WP1 细化 */
  desires: unknown[];
  /** 意图层：行为策略/情绪/阻抗/移情/禁止行为 —— WP1 细化 */
  intention: unknown | null;
  /** 当前情绪状态（结构化，非自由字符串）—— WP1 细化 */
  emotion: unknown | null;
  /** 三维阻抗量化（话量/内容深度/表达风格）—— WP1 细化，本期留字段 */
  resistance: { verbal: number; depth: number; style: number } | null;
  /** 移情三态（正/负/依赖）—— WP1 细化，本期留字段 */
  transference: unknown | null;
}
```

`runtime/engine-session.port.ts`（会话内核端口，纯函数式，不依赖框架）：

```ts
export interface EngineSessionPort {
  openSession(input: OpenEngineSessionInput): EngineSessionHandle;
  turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput>;
  closeSession(handleId: string): void;
}
```

> WP0 的 `turn` 可以是**占位实现**（返回空/默认结构并 TODO 标注 WP1），重点是接口形状与可实例化，不是算法。

`domain/ports/bdi-state.repository.ts` / `memory.store.ts`：只定义接口方法签名（load/save snapshot、remember/recall），各给一个 `InMemory*` 实现放在 `domain/` 同级 `in-memory/` 下（Map 存储，带 TTL 占位注释）。

### 3.3 依赖红线（硬约束）

- `src/engine-core/` 内**禁止** import：`@nestjs/*`、`typeorm` 实体、现有的 `agent/visitor`、`voice`、HTTP DTO；
- 允许：纯 TS、`nanoid`（已在依赖里）、标准库；
- 持久化一律走 3.2 的接口，内核**不 new** 任何 MySQL/Qdrant 客户端；
- 不写 migration、不改 entity、不动 `.env`。

## 4. 明确不做（本期划掉，防止 scope 膨胀）

- ❌ 不实现 BDI 推理/事件算子/阻抗计算（WP1）；
- ❌ 不接 Qdrant、不写记忆召回（WP2）；
- ❌ 不接 WS/语音、不替换 `agent/visitor` 旧链路；
- ❌ 不引入 Mastra；
- ❌ 不做任何数据库 schema 变更。

## 5. 验收清单（后端自检 + 大炮复核）

- [ ] `grep -rE "@nestjs|typeorm" src/engine-core/` **零命中**（注释里提到不算，import 必须为 0）；
- [ ] `new` 一个内存实现的 `EngineSessionPort`，单测里 open→turn(占位)→close 可跑通，无需启动 NestJS 容器；
- [ ] `tsc` / `pnpm build` 0 错；现有 `agent/visitor`、`voice` 链路行为零变化；
- [ ] 无新增 migration、无 entity 改动；
- [ ] `engine-core/index.ts` 只导出公开端口与模型，内存实现不外露。

## 6. 接续入口

- WP1（BDI 认知引擎）在本骨架的 `BdiSnapshot` + `bdi-state.repository` 上填信念/愿望/意图与事件算子；
- WP2（记忆V1）实现 `memory.store` 的 Qdrant 版替换内存版（接口不变）；
- 将来拆微服务：把 `src/engine-core/` 整包搬走，只重写 `adapters/`。

## 7. 验证方式（大炮在 Windows 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
pnpm build            # 0 错
pnpm test engine-core # 内核单测通过（WP0 仅占位冒烟）
```

---

## 8. 交付状态（2026-10-28 回写）

**代码已交付**，落地范围与逐条对照见交付记录。验收清单的当前状态：

| 验收条目 | 状态 | 依据 |
|---|---|---|
| §5 ① `grep -rE "@nestjs\|typeorm" src/engine-core/` 零命中 | ✅ **lint 首轮已过**；机器断言已写（待复跑） | `test/engine-core/boundary.spec.ts` ①–⑤（AST 级扫描，含"零逃出目录"与"外部依赖白名单"两条加严项） |
| §5 ② `new` 内存 `EngineSessionPort`，open→turn→close 跑通，无需 NestJS 容器 | 🟡 首轮 **已跑通**（该用例组全绿）；断言已写待复跑 | `test/engine-core/engine-core.spec.ts`；`InMemoryEngineSession` 无任何 NestJS 装饰器 |
| §5 ③ `tsc` / `pnpm build` 0 错 | ⬜ **未跑**（首轮未执行；ts-jest 已对 engine-core 子树做过类型诊断，通过） | — |
| §5 ④ 无新增 migration、无 entity 改动 | ✅ 已满足 | 本轮 `git status` 无 entity / migration 变更；`app.module.ts` 未动 |
| §5 ⑤ `index.ts` 只导出公开端口与模型，内存实现不外露 | ✅ 已满足（断言 ⑥ 已改为 AST 级 + 公开面白名单） | `src/engine-core/index.ts` + 断言 ⑥ |

> 首轮 `npm test engine-core` 的 2 处失败**均为测试侧问题**（测试台时钟未对齐 / 断言误用文本 grep 匹配注释），内核逻辑零改动已修 —— 详见交付记录 §5.2。

> §4「明确不做」全部未做：BDI 推理、Qdrant 记忆召回、WS/语音接线、Mastra、数据库 schema 变更，一概没碰。
> 旧 `src/agent/visitor/` 与 `src/voice/` 链路行为零变化，两条链路并列存在。
