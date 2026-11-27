# AF-584 交付记录：角色级不流利配置管道

- 任务：AF-584
- 上下文：phase2.5-quality-gates
- 类型：implementation
- 日期：2026-11-28
- 分支：task/AF-584-role-disfluency-config
- 基线：abf50ef7b3af594da72fc83059b46c9d516984fb

## 1. 问题与目标

Phase3 文字真人度计划 §5.4 要求角色级 `disfluency_level` / `disfluency_density`，但当前只有 AF-204 的 role/state 通用配额，角色库无法表达「这个角色天生更顺 / 更磕巴」。本单把配置从文档落成可透传、可测试、默认零回归的渲染侧管道。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/shared/realism/visitor-realism-profile.ts` | 新增 `DisfluencyLevel`（none/light/natural/heavy）与 `parseDisfluencyLevel`；`VisitorRealismContext` 增加两个可空字段；profile 增加 `disfluencyLevel`；新增 `applyDisfluencyConfig` / `resolveDensityShift`，档位与密度在 role/state 底色上叠加，风险轮仍强制归零 |
| `src/shared/realism/index.ts` | 导出档位类型与解析器 |
| `src/engine-adapters/rendering/render-risk.ts` | `AdaptiveRenderSpec` 增加 `disfluencyLevel` / `disfluencyDensity` 两个可选渲染侧字段，不进内核 `RenderSpec` |
| `src/engine-adapters/rendering/spec-assembler.ts` | `SpecAssemblyInput` 增加两字段；`disfluencyFields` 条件展开，缺省不带键 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `TurnSessionContext` 增加两字段；`disfluencySessionFields` 条件透传；审计日志补 `disfluency=` |
| `src/engine-adapters/rendering/visitor-realism-runtime.ts` | 从 spec 条件取两字段喂给 `VisitorRealismContext` |
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | `character_profiles` 新增 `disfluency_level` VARCHAR(16) NULL、`disfluency_density` FLOAT NULL |
| `src/engine-adapters/wiring/character/character-profile.resolver.ts` | `ResolvedCharacter` 增加两个侧通道字段 |
| `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` | 解析档位，合法才携带；密度非 NULL 才携带；非法档位静默忽略 |
| `src/engine-adapters/wiring/character/character-profile-version.entity.ts` | 快照增加两个可选字段，旧快照无需回填 |
| `src/engine-adapters/wiring/character/character-profile.admin.service.ts` | `toSnapshot` 写入两字段 |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `characterSideChannelOpenOptions` 合并台词指纹与不流利配置，避免 `openKernelSession` 复杂度越界 |
| `src/engine-adapters/wiring/engine-turn.service.ts` | `EngineTurnOpenOptions` 增加两字段；`sideChannelAttribution` 条件登记，避免 `buildRenderAttribution` 复杂度越界 |
| `src/migration/1714900000058-AddCharacterProfileDisfluencyConfig.ts` | 新增幂等加列 migration，up/down 都先查 `INFORMATION_SCHEMA` |
| `src/migration/index.ts`、`bin/ormconfig.ts` | 两处注册点同步登记 0058 |
| `test/auto-practice/af204-realism.spec.ts` | 新增 5 条：解析器；缺省与显式 natural/0.5 逐字一致；light/none/heavy；密度上下修正与 NaN；风险轮 heavy 归零 |
| `test/engine-adapters/wp9b-db-character-resolver.spec.ts` | 新增 2 条：NULL 不带键；显式档位/密度携带且非法档位不阻断解析 |
| `test/engine-adapters/character-profile-fixtures.ts` | 夹具补两列 NULL |

数据库口径：两列都可空、无默认值，存量行零影响；`disfluency_level` 用 VARCHAR 而非 ENUM，避免每加档位都要 ALTER；密度用 FLOAT 与既有 baseline 列一致。

## 3. 设计决策

1. **不进内核**：`CharacterProfile` / `RenderSpec` 一行未改；两字段走 `ResolvedCharacter → EngineTurnOpenOptions → TurnSessionContext → AdaptiveRenderSpec` 的渲染侧侧通道，与 `verbalVoice` / `speechRegister` 同构。
2. **NULL = 没表态**：档位 NULL 解析为 undefined，profile 内按 natural 处理；密度 NULL 修正量 0。缺省路径的配额、eventPlan、prompt 与 AF-204 逐字一致。
3. **档位只动上限**：none 全零；light 把合计上限压到 1；heavy 在非 guarded 状态加填充/停顿各 1 并把上限 +1，最高 4。guard 态不叠加 heavy，避免把「防御性少说」改成「硬塞痕迹」。
4. **密度用断点而非连续插值**：配额是整数上限，0.5 权重落不到半档；≤0.25 降一档、≥0.75 升一档、中间 50% 不修正，避免连续值抖动。NaN / 越界值在纯函数内被 clamp 或忽略。
5. **安全优先级最高**：`state === 'risk'` 在 `applyDisfluencyConfig` 入口直接返回全零，heavy + 1.0 密度也不能穿透。
6. **非法档位不阻断角色解析**：DB 里出现拼错值时只忽略该字段，角色其余基线照常返回；避免一个脏配置把整场打回中性。
7. **迁移幂等**：沿用既有 `existingColumns` 模式，up/down 都先查 `INFORMATION_SCHEMA`，重复执行不报错。
8. **快照只增不改**：两字段在 `CharacterProfileSnapshot` 上可选，旧快照读取时按「未标定」处理，不做数据回填。

## 4. 闸门

| 命令 | 退出码 | 数字 | 定性 |
| --- | --- | --- | --- |
| `pnpm exec vitest run test/auto-practice/af204-realism.spec.ts test/engine-adapters/wp9b-db-character-resolver.spec.ts` | 0 | 44 passed / 0 failed，42.72s | 定向全绿 |
| 12 个 realism / 角色渲染回归文件 | 0 | 136 passed / 0 failed，30.34s | 回归全绿 |
| `pnpm typecheck` | 0 | 0 error | PASS |
| `pnpm lint` | 0 | 0 error / 0 warning | PASS |
| `pnpm test` | 0 | 362 files passed + 1 skipped；5160 passed / 0 failed / 4 skipped；742.83s | 全量全绿 |
| `git diff --stat HEAD -- src/engine-core` | 0 | 输出为空 | engine-core 零 diff |
| `git diff --check` | 0 | 无空白错误 | PASS |
| `node scripts/orchestration/cli.mjs validate` | 0 | 全仓机读校验全 PASS | PASS |

## 5. 零回归证据

- off / audit prompt 逐字一致的单测仍在，且全绿。
- 缺省 vs 显式 `natural + 0.5` 的 quotas 与 prompt block 逐字相等。
- 新增字段全部条件展开；未标定角色不会在 `AdaptiveRenderSpec` / `TurnSessionContext` 上出现这两个键。
- DB resolver 的 NULL 行断言 `hasOwnProperty` 为 false，不是「带一个 undefined」。

## 6. 偏差

- 任务单写「admin 前端或新增角色管理接口字段」为非目标；本单也未改 admin DTO/Controller，角色数值暂由 seed / DB 直接维护。日后若要在管理后台编辑，另立任务补 DTO 与权限。
- 首版不标定任何角色具体数值，全部 NULL；档位阈值与角色分布需要真实批次标定后再填。
- 未在本机执行 `migration:run`（本单无本地 MySQL 运行态授权）；migration 以幂等 DDL + typecheck + 全量测试收口。

## 7. 遗留

- 角色级数值标定：需要至少一批 active 模式真实会话，按角色统计不流利密度后再回填，不在本单拍数字。
- admin 编辑入口：当前只能通过 DB / seed 配；如果产品要求在管理后台调，另立任务。
- 密度断点 0.25 / 0.75 是工程可解释初值，后续可用批次分布校准。
