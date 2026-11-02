# WP21 · 报告生成 SSE 推送端点

> 前置: WP18（报告链路已通）
> 日期: 2026-10-29
> 后端实现，前端配合改造

---

## 0. 背景

WP18 交付后，前端用固定 3s 轮询等报告生成。实测主报告 ~32s、techStats 更久，轮询窗口 30s 刚好卡边界。
改为 SSE：后端在报告到达终态时主动推一条事件，毫秒级响应，不浪费请求。

---

## 1. 端点

```
GET /counselor/supervision/report/:id/stream
Authorization: Bearer <token>
Accept: text/event-stream
```

**鉴权**：复用现有 `JwtAuthGuard`，与 `GET /counselor/supervision/report/:id` 同一守卫。

**响应**：`text/event-stream`，SSE 格式。

---

## 2. 行为

```
1. 查一次报告状态（复用 getSessionReport）
2. 如果已经是终态（completed / parse_error / no_content）：
   - 立即推一条 data: { report json }
   - 关闭流
3. 如果是 pending：
   - 启动 interval（2s）轮询 DB
   - 状态变终态时推 data: { report json } 并关闭
   - 超时 120s：推 data: { "status": "timeout" } 并关闭
4. 客户端断开（req.on('close')）：清理 interval
```

**SSE 帧格式**：
```
data: {"status":"completed","overallScore":72,...}\n\n
```

不用自定义 event name，默认 `message` 事件，前端统一监听。

---

## 3. NestJS 实现要点

```ts
import { Sse, MessageBody, ConnectedSocket, WebSocketGateway } from ...
// 实际上 NestJS SSE 用 @Sse() 装饰器，不是 WebSocketGateway

@Sse('counselor/supervision/report/:id/stream')
reportStream(@Param('id') id: string, @Res() res: Response) {
  // 用 res 直接写 SSE，不用 Observable（因为是一次性推送）
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // 先查一次
  const report = await this.reportService.getSessionReport(id);
  if (report.status !== 'pending') {
    res.write(`data: ${JSON.stringify(report)}\n\n`);
    res.end();
    return;
  }
  
  // pending：轮询
  const timer = setInterval(async () => {
    const r = await this.reportService.getSessionReport(id);
    if (r.status !== 'pending') {
      clearInterval(timer);
      res.write(`data: ${JSON.stringify(r)}\n\n`);
      res.end();
    }
  }, 2000);
  
  // 超时
  setTimeout(() => {
    clearInterval(timer);
    if (!res.writableEnded) {
      res.write(`data: {"status":"timeout"}\n\n`);
      res.end();
    }
  }, 120000);
  
  // 客户端断开
  res.req.on('close', () => clearInterval(timer));
}
```

---

## 4. 验收

1. 正常会话结束后，前端开 SSE，~32s 后收到 completed 事件
2. 报告已生成时（重复进报告页），SSE 立即推一条并关闭
3. 空局 → 立即推 no_content
4. 120s 超时 → 推 timeout
5. 客户端关闭页面 → interval 被清理（不泄漏）
6. `npx tsc -p tsconfig.build.json --noEmit` 0 错

---

## 5. 红线

- 不改 `src/engine-core/**`
- 不改报告生成逻辑本身（WP18 已交付）
- 不加 DB schema 变更
- 不做报告重跑端点

---

## 6. 回写（2026-10-29 后端已交付）

> 交付记录：[engine-wp21-report-sse-stream-implementation-2026-10-29.md](engine-wp21-report-sse-stream-implementation-2026-10-29.md)

### 6.1 §2 行为表 → 实现映射（逐条已实现）

| §2 行为 | 实现 |
|---|---|
| 查一次报告状态（复用 `getSessionReport`） | `SupervisionService.loadReportContext()` + `buildReportDto()`（GET 与 SSE **共用同一份**，逐字段一致，真机实测 `JSON.stringify` 相等） |
| 已终态 → 立即推一条并关流 | 首次装载即判定终态 → `of({ data: report })` → 流随即关闭（首帧 ~290ms） |
| pending → interval 2s 轮询 → 变终态推报告并关流 | `timer(2000, 2000)` + `concatMap` 串行轮询；**每轮重新装载 + 重新派生**（与 GET 同一份实现 → 空局/墙钟兜底这类终态也不漏）；`take(1)` 关流 |
| 超时 120s → 推 `{"status":"timeout"}` 并关流 | 每轮先查截止时刻；到点推超时负载并关流 |
| 客户端断开 → 清理 interval | **不手写 `setInterval`/`req.on('close')`**：RxJS `timer` 的定时器随**取消订阅**销毁，Nest 的 SSE 通道在断开时取消订阅 → 框架级保证，不泄漏 |

### 6.2 两处与任务单示例不同的地方（**按仓库实际实现，不照抄示例**）

1. **示例混用 `@Sse()` 与 `@Res()`**：`@Sse` 期望 handler 返回 `Observable`，手写 `res.write` 是另一套范式。本轮沿用仓库既有 SSE 范式（`live-hint.controller.ts`：`@Sse()` + `Observable<MessageEvent>`），帧格式 / header / 断开取消订阅全部交给框架。
2. **示例缺 `userId`**：实际 `getSessionReport(userId, sessionId)` 是两参，归属校验必须带上当前用户（否则就是越权洞）。

### 6.3 端点契约（前端按这个接）

```
GET /counselor/supervision/report/:sessionId/stream
Authorization: Bearer <token>
```

- 路径参数用 `:sessionId`（与同前缀 `GET report/:sessionId` 同名；槽位位置与任务单写的 `:id` 相同，前端 URL 拼接无差异）
- 成功：200 + `text/event-stream`，帧格式 `data: {报告 JSON}`（默认 `message` 事件，前端统一监听 `data:` 行）
- 推送的 `status` 共 **4 个**：`completed` / `parse_error` / `no_content` / **`timeout`**（超时是**通道状态**，不是报告四态之一）
- 错误：会话不存在 / 跨用户 → **404**（与 GET 端点同口径，不泄露存在性）；缺 token → 401

### 6.4 ⚠️ 需要前端补一个分支：`timeout` 的处理

前端 `vpt_session_report.dart` 的 `_statusFromWire` 把**未知状态兜底成 `pending`**，而 `_applyTerminal` 会把 pending 当成 `completed` → 若后端推的 `{"status":"timeout"}` 先于前端自己的 120s 定时器到达，页面会渲染一张**空报告卡片**。

建议在 `vpt_session_report_page.dart` 的 SSE 回调里加：

```dart
if (status == 'timeout') {
  unawaited(_sseSub?.cancel());
  _timeoutTimer?.cancel();
  if (mounted) setState(() => _sseTimedOut = true);   // 留在 pending 态 + 给重试出口
  return;
}
```

（后端不绕开：任务单 §2.4 要求推 `timeout`；而且前端 `onDone` 会取消自己的超时定时器，若后端静默关流，前端会永远停在转圈且没有重试出口。）

### 6.5 闸门

eslint **0 error 0 warning** / tsc **0 错**（build + scripts）/ jest **2 新套件 18 例全绿**（决策表 8 + service 7 + HTTP 层 3）/ 全量 jest **52 套件 / 791 例：51 套件 789 例通过**（1 套件 2 例失败 = `drill-judge.spec.ts` 既有债，与 WP18 轮一致）/ wp8-wiring 护栏 34 例全绿 / 服务真起（路由已 mapped）/ `git diff --stat HEAD -- src/engine-core` **为空**。

真机实测：404 / 401 / 已终态立即推（首帧 **291ms**）/ 空局与墙钟兜底**立即推真实终态**（不干等 120s）/ 120s 超时推 `timeout` / **GET 与 SSE 载荷逐字段一致** —— 全部通过。

### 6.6 真机实测踩出的 3 个坑（已修，记录在此以免重犯）

1. **SSE 通道接管响应后就写不出 404**：本仓 `src/app.ts` 注册了**全局** `LoggerErrorInterceptor` → handler 的 promise 被包成 Observable → 在 handler 里抛错只能降级成 `200 + event: error`。归属校验必须放 **guard**（guard 在 interceptor / SSE 通道之前跑）。
2. **单测桩"同步抛错"会假通过**：真机的错误来自 DB 查询（异步 I/O），必然晚于 SSE 响应头的 `setTimeout(0)` 提交。桩必须**异步抛错** + 挂上**全局 interceptor**，测试才等于生产行为。
3. **"探针式"轮询会漏终态**：只看"报告行落库了没"会漏掉「空局（no_content）」与「墙钟兜底（parse_error）」——它们由**会话行**决定，不由报告行决定 → 会话干等 120s 才推 `timeout`，而不是立即推真实终态。**终态判定只能有一个口径**：轮询必须与 GET 走同一份装载 + 派生。

### 6.6 红线核对

| 红线 | 核对 |
|---|---|
| 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` 为空 |
| 不改报告生成逻辑本身 | ✅ 只读侧新增；agent/supervisor 与两个 BullMQ worker 零改动 |
| 不加 DB schema 变更 | ✅ 零 migration、零 entity 改动；只有两个 env + 既有表的只读查询 |
| 不做报告重跑端点 | ✅ 无任何写/重跑端点 |
