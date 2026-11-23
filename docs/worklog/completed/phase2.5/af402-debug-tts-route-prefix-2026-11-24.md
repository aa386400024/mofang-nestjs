# AF-402 调试页 TTS 路由前缀修复交付记录

日期：2026-11-24

## 结论

`DebugTtsController` 的路由前缀由 `debug/tts` 修正为 `admin/api/debug/tts`，与前端 `admin-dashboard/src/api/client.ts` 的 `BASE = '/admin/api'` 对齐。修复后真实调用 `POST /admin/api/debug/tts/render`，MiniMax HD、MiniMax Turbo、豆包 `doubao-seed-tts-2.0` 三模型全部返回音频；同一会话同一轮同一模型二次调用命中缓存。

## 改动文件

- `src/admin-debug/tts/debug-tts.controller.ts`：`@Controller('debug/tts')` → `@Controller('admin/api/debug/tts')`。
- `test/admin-debug/debug-tts.spec.ts`：新增路由元数据断言，锁定控制器前缀 `admin/api/debug/tts` 与方法路径 `render`，防止再次与前端 BASE 漂移。

## 根因

AF-398 合并的前端 `api.debugSession.tts` 使用 `post('/debug/tts/render')`，而 `request()` 统一拼 `BASE = '/admin/api'`，实际请求 `/admin/api/debug/tts/render`；后端控制器只声明 `debug/tts`，真实路由 `/debug/tts/render`，因此页面按钮必然 404。此前用 `/debug/tts/render` 手工试打成功，掩盖了前端路径不一致。

## 真实链路验证

后端 `pnpm build` 后以 `node --env-file=.env --enable-source-maps dist/app.js` 重启，PID 47384，监听 3000。使用已持久化调试会话 `debug_GJ_HGNcuo9Z9NoxjzMf8V` 第 1 轮来访文本：

| provider            | HTTP | cached             | voiceId                      | audioBase64 长度 | requestHash 前 12 位 |
| ------------------- | ---- | ------------------ | ---------------------------- | ---------------- | -------------------- |
| minimax-hd          | 200  | false              | Chinese (Mandarin)_Warm_Girl | 67056            | b857f0b98717         |
| minimax-turbo       | 200  | false              | Chinese (Mandarin)_Warm_Girl | 67568            | d33254eaee40         |
| doubao-seed-tts-2.0 | 200  | true（此前已生成） | zh_female_vv_uranus_bigtts   | 30268            | 89adbcc28749         |

再次调用 `minimax-hd`：`cached=true`，长度 67056，确认缓存跨请求命中。

## 闸门数字

- `pnpm exec vitest run test/admin-debug/debug-tts.spec.ts`：1 文件 / 5 用例全绿。
- `pnpm lint`：exit 0，0 error。
- `pnpm typecheck`：exit 0。
- `git diff --stat HEAD -- src/engine-core`：空。

## 提交链

任务分支 `task/AF-402-debug-tts-route-prefix`，自 `integrate` HEAD `f61680dd` 切出。实现提交包含任务单与本记录；回执经 `receipt freeze` 后归档。

## 偏差与遗留

- 任务单 `scope` 允许 `src/admin-debug/tts/` 与 `test/admin-debug/`，实际改动严格落在范围内。
- 未改前端调用路径，避免引入第二套 base 口径；以后端控制器对齐前端 `BASE` 为单一真相源。
- 页面实际播放依赖浏览器音频解码；服务端已验证返回合法 base64 MP3。
