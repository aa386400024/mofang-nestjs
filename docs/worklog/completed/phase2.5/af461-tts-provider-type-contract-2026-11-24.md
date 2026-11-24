# AF-461 · 修复三模型 TTS provider 参数类型契约

- 任务单：`docs/worklog/records/phase2.5-voice-delivery/AF-461/task-sheet.md`
- 基线：`c239b8a7cbd33b3d8ff0579baaac1bdb1bd75b5a`（AF-460 squash 合并后的 integrate）
- 类型：fix

## 1. 问题与根因

用户在调试引擎页对自动对练第 29 轮点击语音 icon，三家 provider 全部 503。逐个复现请求体后确认是两处厂商强类型契约被绕过，不是上游宕机：

| provider                       | 上游错误                                                                                              | 根因                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `minimax-hd` / `minimax-turbo` | `2013 invalid params, Mismatch type int64`                                                            | `voice_setting.pitch=-0.7`。MiniMax 要求 `pitch` 为 integer；`speed/vol` 才是 float。 |
| `doubao-seed-tts-2.0`          | `json: cannot unmarshal object into Go struct field TTSReqParams.req_params.additions of type string` | `req_params.additions` 传了对象。官方要求 JSON 序列化后的字符串。                     |

TypeScript 的 `number` 不区分 int/float，现有测试只断言数值、没有断言类型，所以单测全绿但上游拒绝。生产 MiniMax WebSocket 握手复用同一份 `voice_setting` 数值，同样会中招。

## 2. 改动

### 2.1 MiniMax 类型收口

- `voice-delivery.render.ts` 新增 `toMiniMaxVoiceSettingValues()`：
  - `pitch` 先做有限性检查，再 `Math.round`，夹到 `[-12,12]`；
  - `speed` 夹到 `[0.5,2]`，`vol` 夹到 `(0,10]`，非法值回落默认；
  - 非法 `emotion` 不下发。
- `toMiniMaxVoiceSetting(profile)` 改为委托该函数，保留原调用方 API。
- `tts-bidi-client.ts` 的 `task_start` 改用同一函数，调试同步合成与生产 WebSocket 不再各写一套数值逻辑。
- `voice-delivery.profile.ts` 在源头把 `pitch` 量化为整数半音（`-4..4`），调试预览显示值就是实际下发值。

### 2.2 豆包 additions 契约

- `debug-tts.providers.ts` 把 `additions` 改为 `JSON.stringify(...)`。
- 按官方语义修正字段值：
  - `max_length_to_filter_parenthesis: 100`：过滤长度 ≤100 字符的括号注释（原实现写 0，实际是“不过滤”）；
  - `disable_markdown_filter: true`、`disable_emoji_filter: true`：解析并过滤 Markdown/Emoji；
  - `silence_duration` 仍仅在 `>0` 时写入，只承接文本末尾长沉默。

### 2.3 测试与文档

- `test/admin-debug/debug-tts.spec.ts`
  - 新增 MiniMax 小数 `pitch=-0.7` 请求体断言：实际下发 `-1` 且 `Number.isInteger`；
  - 豆包断言从“对象”改为“字符串 + `JSON.parse` 后的字段类型/值”。
- `test/shared/voice-delivery/voice-delivery.spec.ts`
  - 断言 profile `pitch` 为整数；
  - 新增 MiniMax 类型契约、非法数值回落、非法 emotion 不下发三组用例。
- `docs/runbooks/voice-prosody-pipeline.md` §6.1 补充参数类型契约与 `additions` 字符串口径。

## 3. 验证

### 3.1 真实上游复现与修复后复测

复现请求：`POST /admin/api/debug/tts/render`，`sessionId=aCCe-PwwKFBGigWmIyH5h`、`turnIndex=29`。

修复前：

- `minimax-hd` / `minimax-turbo`：503 + `Mismatch type int64`（`pitch=-0.7`）
- `doubao-seed-tts-2.0`：503 + `additions` 类型错误

修复后同一请求：

| provider              | 结果 | pitch | 预计时长 | 音频字节 |
| --------------------- | ---- | ----- | -------- | -------- |
| `minimax-hd`          | OK   | `-1`  | 6213ms   | 129520   |
| `minimax-turbo`       | OK   | `-1`  | 6213ms   | 138224   |
| `doubao-seed-tts-2.0` | OK   | `-1`  | 6213ms   | 62780    |

三家均返回真实音频，未再出现 503。

### 3.2 闸门

| 命令                                                                     | 结果                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `pnpm vitest run test/shared/voice-delivery test/voice test/admin-debug` | 28 passed / 1 skipped（29 文件），494 passed / 4 skipped（498 用例），5.98s                            |
| `pnpm typecheck`                                                         | 0 error                                                                                                |
| `pnpm lint`                                                              | 0 error 0 warning                                                                                      |
| `git diff --stat HEAD -- src/engine-core`                                | 空输出                                                                                                 |
| `pnpm test`                                                              | 326 passed / 1 failed / 1 skipped（328 文件），4900 passed / 1 failed / 4 skipped（4905 用例），30.59s |

**全量测试的唯一失败与本任务无关**：`scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs > ④` 依赖本地 `data/debug-sessions` 真实语料；用户本轮跑自动对练后语料 empathy 命中从 34 增至 39，硬编码断言失配。该目录被 gitignore，CI 无本地语料会 `skip`，不影响远端门禁；本地留作 backlog，不修改语料也不改断言凑绿。

## 4. 范围与偏差

- 改动全部落在任务单授权目录：`src/shared/voice-delivery/`、`src/voice/tts/`、`src/admin-debug/tts/`、对应测试与 runbook。
- 未改 `src/engine-core`。
- 偏差：任务原本只要求 `additions` 序列化为字符串；实现同时按官方语义把 `max_length_to_filter_parenthesis` 从 0 改为 100、`disable_*_filter` 从 false 改为 true。原因是原值会导致括号注释被朗读、Markdown/Emoji 不被过滤，属于同一个 `additions` 契约内的顺手纠偏，已在此记录。

## 5. 遗留

| ID       | 内容                                                                                                             | 层级    |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| AF461-B1 | `af427-operator-delta-ledger` 对本地真实语料硬编码计数，语料增长即红；应改为结构断言或 CI 同口径 skip            | test    |
| AF461-B2 | 调试页上游参数错误统一映射 503，语义上更像 400/422；错误分类可后续细化，避免把“请求参数不合法”误报成“服务不可用” | adapter |

## 6. 结论

`reviewVerdict = passed`。三家 provider 的真实请求已恢复，类型契约由共享函数收口，调试与生产不再漂移；定向测试、类型、lint 全绿。全量测试的 1 例失败为本地语料漂移导致的既有测试脆性，与本任务改动无关，已登记遗留。
