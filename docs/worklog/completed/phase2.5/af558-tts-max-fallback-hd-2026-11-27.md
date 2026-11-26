# AF-558 TTS Max 回退 HD 交付记录

## 背景

AF-557 的档位决策层把 Max 映射到豆包 `doubao-seed-2.0`，但豆包未配置或运行期启动失败时统一回退 `minimax-turbo`。用户确认该策略不符合产品预期：Max 是 premium 档，失败时应只降一档到 `minimax-hd`，不应直接落到 standard 档的 Turbo。

本次只修正回退阶梯，不改档位主映射，不改 Pro HD 运行期不降档的语义。

## 改动

- `src/voice/tts/runtime/tts-profile.registry.ts`
  - 新增 `TTS_PREMIUM_FALLBACK_PROFILE = 'minimax-hd'`。
  - 保留 `TTS_FALLBACK_PROFILE = 'minimax-turbo'` 作为标准档最终兜底。
  - 新增 `resolveTtsFallbackProfile(profileId)`：`doubao-seed-2.0 → minimax-hd`，其余 → `minimax-turbo`，作为回退目标的唯一事实源。
- `src/voice/tts/runtime/tts-profile.resolver.ts`
  - 决策期 `buildFallback()` 与运行期 `fallbackProfile()` 都改为通过 `resolveTtsFallbackProfile()` 取目标，不再写死 Turbo。
  - 豆包失败仍保留 `fallbackFrom='doubao-seed-2.0'`、`requestedQuality='premium'`，`effectiveQuality` 变为 `hd`，`fallbackReason` 仍为 `doubao_unconfigured` 或 `doubao_start_failed`。
  - `fallbackProfile()` 的 non-premium 守卫不变，Pro HD 运行期失败仍原样返回，不会静默降档。
- `src/voice/voice.service.ts`
  - 仅同步回退说明注释，行为仍由 resolver 决定。
- `test/voice/tts-profile-resolver.spec.ts`
  - 更新 Max 缺 key、运行期豆包失败、只有 chat key 三处断言为 `minimax-hd` / `effectiveQuality=hd`。
  - Pro HD 启动失败不降档、Free/Plus 为 Turbo 的既有断言保持。

## 行为矩阵

| 场景 | 结果 |
| --- | --- |
| Free / Plus | `minimax-turbo`，不变 |
| Pro | `minimax-hd`，不变 |
| Pro HD 运行期失败 | 原样返回，不降 Turbo，不变 |
| Max 豆包未配置 | `minimax-hd`，`doubao_unconfigured` |
| Max 豆包运行期启动失败 | `minimax-hd`，`doubao_start_failed` |
| Max 只有普通方舟 chat key | `minimax-hd`，`doubao_unconfigured` |

## 闸门

- `pnpm exec vitest run test/voice/tts-profile-resolver.spec.ts test/voice/tts-membership-tier.adapter.spec.ts`：2 files / 14 tests passed，exit 0。
- `pnpm typecheck`：0 error，exit 0。
- `pnpm lint`：0 error 0 warning，exit 0。
- `pnpm test`：358 passed / 1 skipped files，5092 passed / 4 skipped tests，exit 0。
- `git diff --stat HEAD -- src/engine-core`：空，纯层零改动。
- 本地 `pnpm start:dev` watch 已重启，`/health` 返回 200，database / redis up。

## 偏差与遗留

- 无功能偏差。
- `src/voice/tts/runtime/tts-config.doctor.ts` 的文件头注释仍写“回退 Turbo”；该文件不在本任务 scope，未改，不影响运行逻辑，留待后续文档清理。
- 未改变 Pro HD 决策期不可用时的最终兜底（仍为 Turbo）；本次用户只确认 Max → HD，未扩大 Pro 语义。

## 提交建议

`fix(af558): Max TTS 回退目标改为 minimax-hd`
