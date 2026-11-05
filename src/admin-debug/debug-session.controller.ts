// V2026-11-05 治本 (WP58 · 引擎调试面板 · 调试会话接口):
//   职责: 给 admin-dashboard 的 `/debug-chat` 页面提供**写操作**接口 ——
//         开一场调试会话 → 一轮一轮发对话 → 关掉调试会话.
//   边界: 只做入参转交与返回值包装; 业务在 `DebugSessionService`.
//
//   三个端点:
//     POST   /admin/api/debug/session            —— 创建调试会话
//     POST   /admin/api/debug/session/:id/turn   —— 发一轮对话 (返回完整调试 trace)
//     DELETE /admin/api/debug/session/:id        —— 关闭调试会话 (清内存)
//
//   为什么单独一个 controller (而不是塞进 `AdminDebugController`):
//     `AdminDebugModule` 被 `EngineWiringModule` import (为了 `TraceRecorder`),
//     而调试接口要用引擎门面 (`EngineTurnService`) —— 同一个模块里反向 import
//     引擎装配模块 = **模块循环依赖** (Nest 启动期就炸).
//     拆成 `AdminDebugChatModule` (import 引擎, 不被引擎 import) 后依赖是**单向**的.
//     见 `admin-debug-chat.module.ts` 的文件头.
//
//   鉴权 (与既有 admin 接口同款):
//     · 中间件 `AdminBasicAuthMiddleware` —— 判"这次请求是谁" (运维 basic / 学员 JWT);
//     · class 级 `@UseGuards(AdminRoleGuard)` —— 判"是不是管理员" (DB 真值 admin_role).
//     class 级挂一次 = 新增端点自动继承, 不会漏.
//
//   返回体形状 (与前端 `DebugChat.vue` 的注释契约对齐):
//     · 创建 → 顶层 `sessionId` (同时给 `debugSessionId` 别名, 同一个值);
//     · 发轮 → 顶层 `trace` (完整调试 trace) + `reply` / `turnIndex` 便于直接用.
//     ⚠️ **不为兼容任务单示例而把 trace 再摊一份到顶层** —— 那样就是两份形状.
//       前端读的是 `data.trace`, 以它为准 (交付记录里登记了这条偏差).
//
//   反双胞胎:
//     - 不自己解析鉴权: 身份由中间件解析, 角色由守卫判定, controller 只转交参数.
//     - 不吞异常: 业务错误一律抛 `BizException` (带 BizCode) → 全局过滤器统一成
//       `{ code, message, data: null }`; 不用裸 `HttpException`.
//
//   验证: test/admin-debug/wp58-debug-session.spec.ts

import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';

import { DebugSessionService, type DebugSessionCreated, type DebugTurnTrace } from './debug-session.service.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';

/**
 * 创建调试会话的入参.
 */
interface CreateDebugSessionBody {
  /** 角色代号 (从 `GET /admin/api/characters` 拿). */
  readonly characterSlug?: string;
}

/**
 * 发一轮对话的入参.
 *
 * ⚠️ `counselorText` 与 `userText` 是**同一个字段的两个名字**:
 *   前端 (`DebugChat.vue`) 发 `counselorText`; 任务单 §4.2 写的是 `userText`.
 *   两个都收, 取值口径一致 (先 `counselorText`, 没有再 `userText`).
 */
interface DebugTurnBody {
  readonly counselorText?: string;
  readonly userText?: string;
}

/**
 * 引擎调试会话接口 (admin 内部能力).
 */
@Controller('admin/api/debug')
// 角色校验 (WP26 同款): 非 admin 角色 → 403 (BizCode.Forbidden).
@UseGuards(AdminRoleGuard)
export class DebugSessionController {
  constructor(private readonly service: DebugSessionService) {}

  /**
   * 创建调试会话.
   *
   * @param body 入参 (角色代号)
   * @returns 调试会话信息 (顶层 `sessionId`)
   */
  @Post('session')
  async createSession(@Body() body: CreateDebugSessionBody): Promise<DebugSessionCreated> {
    return this.service.createSession(body?.characterSlug);
  }

  /**
   * 发一轮对话.
   *
   * @param id 调试会话 id
   * @param body 入参 (咨询师这一轮说的话)
   * @returns 本轮来访口语 + 完整调试 trace
   */
  @Post('session/:id/turn')
  async turn(
    @Param('id') id: string,
    @Body() body: DebugTurnBody,
  ): Promise<{ readonly turnIndex: number; readonly reply: string; readonly trace: DebugTurnTrace }> {
    const counselorText = body?.counselorText ?? body?.userText ?? '';
    const result = await this.service.runTurn(id, counselorText);
    return { turnIndex: result.trace.turnIndex, reply: result.reply, trace: result.trace };
  }

  /**
   * 关闭调试会话 (清内存 + 关内核句柄).
   *
   * @param id 调试会话 id
   * @returns 关闭确认
   */
  @Delete('session/:id')
  closeSession(@Param('id') id: string): { readonly sessionId: string; readonly closed: boolean } {
    this.service.closeSession(id);
    return { sessionId: id, closed: true };
  }
}
