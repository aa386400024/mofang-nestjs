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
