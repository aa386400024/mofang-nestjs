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
//   V2026-11-05 扩展 (调试会话持久化) —— 四个**历史**端点:
//     GET    /admin/api/debug/sessions           —— 列出历史会话
//     GET    /admin/api/debug/sessions/:id       —— 读一个会话的完整 messages + traces
//     PATCH  /admin/api/debug/sessions/:id       —— 改标题
//     DELETE /admin/api/debug/sessions/:id       —— 删掉这个会话 (连文件一起删)
//
//   ⚠️ **`/debug/session/:id` 与 `/debug/sessions/:id` 是两件事** (只差一个 s):
//     · `DELETE /debug/session/:id`  = **关会话** —— 释放内核句柄 + 标记文件为已完成,
//       历史**还在** (列表里能看见);
//     · `DELETE /debug/sessions/:id` = **删会话** —— 文件删掉, 这条历史彻底没了.
//     两条路由的字面路径不同 (session vs sessions), 不会互相命中; 但读代码的人
//     容易看串 —— 所以这里把区别写在文件头与端点注释里.
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

import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import {
  DebugSessionService,
  type DebugSessionCreated,
  type DebugSessionDetail,
  type DebugSessionListItem,
  type DebugSessionResumed,
  type DebugTurnTrace,
} from './debug-session.service.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import type { TurnDeltaAuditTurnView } from '../engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.js';
import { TurnDeltaAuditService } from '../engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.js';

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
 * 改会话标题的入参.
 */
interface UpdateDebugSessionTitleBody {
  /** 新标题 (空 / 缺省 → 400). */
  readonly title?: string;
}

/**
 * delta 审计读端点的返回体.
 *
 * ⚠️ 为什么**只有这一个**端点带 { code, data } 外壳, 而同控制器的其它端点直接返回业务对象:
 *   仓库的成功响应没有统一外壳 (全局只统一了错误体 { code, message, data: null }).
 *   但本端点的契约由任务单 §5.1 钉死成 { code: 0, data: {...} } —— code=0 正是
 *   BizCode.Success 的口径, 与错误体同族. 前端对接时**只有这一个**端点要取 .data,
 *   别把这层外壳套到别的端点上 (admin-dashboard/src/api/client.ts 是直接透传 json 的).
 */
interface TurnDeltaAuditResponse {
  readonly code: number;
  readonly data: {
    readonly sessionId: string;
    readonly turns: readonly TurnDeltaAuditTurnView[];
  };
}

/**
 * 引擎调试会话接口 (admin 内部能力).
 */
@Controller('admin/api/debug')
// 角色校验 (WP26 同款): 非 admin 角色 → 403 (BizCode.Forbidden).
@UseGuards(AdminRoleGuard)
export class DebugSessionController {
  constructor(
    private readonly service: DebugSessionService,
    /** 事件 + delta 审计观测服务 (WP58 · 按会话查每一轮的事件与原始 delta). */
    private readonly audit: TurnDeltaAuditService,
  ) {}

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
   * 恢复调试会话 (后端重启后继续调试).
   *
   * V2026-11-06 (WP38 补做 · 调试会话恢复): 从持久化的内核状态快照重建内核句柄 ——
   *   恢复后可以接着聊, 而且**从最后一轮的状态继续** (不是从头开始).
   *
   * 前端对接 (归前端 AI):
   *   `active=false` 的会话显示「继续调试」按钮 → 调这个接口 →
   *   成功后该会话在 `GET /admin/api/debug/sessions` 里变成 `active=true`,
   *   就能继续发消息了 (不必刷新页面).
   *
   * @param id 调试会话 id
   * @returns 恢复结果 (含"恢复了什么")
   * @throws BizException 会话不存在 (404) / 没有可恢复的快照 (400)
   */
  @Post('session/:id/resume')
  async resumeSession(@Param('id') id: string): Promise<DebugSessionResumed> {
    return this.service.resumeSession(id);
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

  // ── 历史会话 (V2026-11-05 持久化) ──────────────────────────────────

  /**
   * 列出历史调试会话 (按创建时间倒序).
   *
   * ⚠️ 与 `DELETE /debug/session/:id` (关会话) **不是一回事**:
   *   这里列的是**落过盘**的会话, 包括进程重启前跑过的那些 ——
   *   那正是"刷新不丢数据"的兑现.
   *
   * V2026-11-06 (WP69): 每行带 `active` = 本进程内存里还有运行时状态
   *   (前端据此区分"可继续聊"与"只读历史").
   *
   * @returns 会话摘要列表
   */
  @Get('sessions')
  async listSessions(): Promise<DebugSessionListItem[]> {
    return this.service.listPersistedSessions();
  }

  /**
   * 读一个历史调试会话 (完整 messages + traces).
   *
   * @param id 调试会话 id
   * @returns 详情视图 (messages 里来访者那条自带 trace)
   * @throws BizException 会话不存在 (404)
   */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string): Promise<DebugSessionDetail> {
    return this.service.getPersistedSession(id);
  }

  /**
   * 改会话标题.
   *
   * @param id 调试会话 id
   * @param body 入参 (新标题)
   * @returns 更新后的标题
   * @throws BizException 标题为空 (400) / 会话不存在 (404)
   */
  @Patch('sessions/:id')
  async updateSessionTitle(
    @Param('id') id: string,
    @Body() body: UpdateDebugSessionTitleBody,
  ): Promise<{ readonly id: string; readonly title: string }> {
    const record = await this.service.updatePersistedTitle(id, body?.title ?? '');
    return { id: record.id, title: record.title };
  }

  /**
   * 本场会话每一轮的事件 + delta 审计 (WP58).
   *
   * 用途: 正式训练会话出了问题, 按 sessionId 查"这一轮触发了什么事件 / 原始 delta
   * 是多少" —— 以前只有 cap 砍幅的 warning 日志 (只在**被砍**时才有, 没被砍的
   * 轮次完全无痕) 与调试会话的内存 trace (只对调试会话有效), 两处都查不了.
   *
   * @param sessionId 业务会话 id
   * @returns 审计视图 (按轮次升序; 无数据 = 空数组, 不报错)
   */
  @Get('sessions/:sessionId/delta-audit')
  async sessionDeltaAudit(@Param('sessionId') sessionId: string): Promise<TurnDeltaAuditResponse> {
    const turns = await this.audit.listTurns(sessionId);
    return { code: 0, data: { sessionId, turns } };
  }

  /**
   * 删掉一个历史调试会话 (连文件一起删).
   *
   * ⚠️ 与 `DELETE /debug/session/:id` (关会话) **不是一回事**:
   *   这里是**真删** —— 这条历史彻底没了, 删了就找不回来.
   *
   * @param id 调试会话 id
   * @returns 删除确认
   */
  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string): Promise<{ readonly id: string; readonly deleted: boolean }> {
    const deleted = await this.service.deletePersistedSession(id);
    return { id, deleted };
  }
}
