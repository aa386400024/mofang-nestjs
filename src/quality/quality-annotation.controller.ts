// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · admin 端点):
//   职责: 暴露五个 admin 端点 —— 列表 / 详情 / 保存 / 双盲揭示 / 一致性报告.
//   边界: 只做入参解析与身份提取; 业务在 service; 出参形状在 view.
//
//   端点 (与前端 `admin-dashboard/src/api/client.ts` 的 `api.qualityAnnotation` 严格 1:1):
//     GET  /admin/api/quality/annotations?status=pending|done|all
//     GET  /admin/api/quality/annotations/:id
//     PUT  /admin/api/quality/annotations/:id
//     GET  /admin/api/quality/annotations/:id/reveal
//     GET  /admin/api/quality/consistency
//
//   ⚠️ **路径是 `/admin/api/quality/*`**, 不是任务单写的 `/admin/quality/*` ——
//     前端 `client.ts` 的 BASE 是 `/admin/api`, 且后台代理只转发 `/admin/api`;
//     按任务单字面写会让主 Agent 的前端 404 (见交付记录偏差 B2).
//
//   鉴权: 中间件 `AdminBasicAuthMiddleware` (身份) + class 级 `AdminRoleGuard` (角色).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/quality/quality-annotation-contract.spec.ts (路由清单 + guard 继承 + 出参形状)
//
//   时间戳: 2026-11-10 GMT+8

import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { ANNOTATION_STATUS, type AnnotationStatus } from './quality-annotation.constants.js';
import { QualityAnnotationService } from './quality-annotation.service.js';
import type {
  AnnotationConsistency,
  AnnotationDetail,
  AnnotationListResponse,
  AnnotationReveal,
  AnnotationRowView,
} from './quality-annotation.view.js';
import type { AdminDebugRequest } from '../admin-debug/admin-basic-auth.middleware.js';
import { extractBasicCredentials } from '../admin-debug/admin-basic-auth.middleware.js';
import { QualityAnnotationSaveDto } from './dto/quality-annotation.dto.js';
import { AdminRoleGuard } from '../admin-debug/guards/admin-role.guard.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';

/**
 * 质量标注台端点 (列表 / 详情 / 保存 / 双盲揭示 / 一致性报告).
 */
@Controller('admin/api/quality')
// 角色校验 (WP26 同款): 非 admin 角色 → 403.
@UseGuards(AdminRoleGuard)
export class QualityAnnotationController {
  /**
   * @param service 标注台服务
   */
  constructor(private readonly service: QualityAnnotationService) {}

  /**
   * 列表 + 标注进度.
   *
   * @param status 筛选 (pending | done | all; 缺省 pending)
   * @returns 列表 + 进度
   */
  @Get('annotations')
  async list(@Query('status') status?: string): Promise<AnnotationListResponse> {
    return this.service.list(parseStatus(status));
  }

  /**
   * 单条详情 = 标注行 + 该场逐字稿 (只双方台词).
   *
   * @param id 标注记录 id
   * @returns 详情
   */
  @Get('annotations/:id')
  async detail(@Param('id') id: string): Promise<AnnotationDetail> {
    return this.service.detail(id);
  }

  /**
   * 保存人工标注.
   *
   * @param id 标注记录 id
   * @param body 标注内容
   * @param req 请求 (取标注人身份)
   * @returns 保存后的行
   */
  @Put('annotations/:id')
  async save(@Param('id') id: string, @Body() body: QualityAnnotationSaveDto, @Req() req: AdminDebugRequest): Promise<AnnotationRowView> {
    return this.service.save(id, body, resolveAnnotator(req));
  }

  /**
   * 双盲揭示: 本场自动判定结果 (保存人工标注后才可调).
   *
   * @param id 标注记录 id
   * @returns 自动判定结果
   */
  @Get('annotations/:id/reveal')
  async reveal(@Param('id') id: string): Promise<AnnotationReveal> {
    return this.service.reveal(id);
  }

  /**
   * 双盲辅助: 随时可调用的自动判定 (不要求先保存).
   *
   * 与 reveal 的区别: 不校验人工标注是否已保存, 只返回规则引擎本身的判定.
   * 给标注员「拿不准时主动问 AI」用.
   */
  @Get('annotations/:id/auto')
  async auto(@Param('id') id: string): Promise<AnnotationReveal> {
    return this.service.auto(id);
  }

  /**
   * 一致性报告: 人工标注 vs 自动判定.
   *
   * @returns 一致性报告
   */
  @Get('consistency')
  async consistency(): Promise<AnnotationConsistency> {
    return this.service.consistency();
  }
}

/**
 * 解析列表筛选参数 (非法 → 400).
 *
 * ⚠️ **非法值不静默兜底**: `status=xxx` 被当成"全部"的话, 标注员以为自己
 *   在看"待标", 实际看到的是全部 —— 那比报错危险得多.
 *
 * @param raw 原始参数
 * @returns 筛选状态
 */
function parseStatus(raw: string | undefined): AnnotationStatus {
  const text = (raw ?? '').trim();
  if (text.length === 0) return ANNOTATION_STATUS.Pending;
  if (text === ANNOTATION_STATUS.Pending || text === ANNOTATION_STATUS.Done || text === ANNOTATION_STATUS.All) return text;
  throw new BizException(BizCode.InvalidParameter, `status 参数不合法: "${text}" (要 pending / done / all)`);
}

/**
 * 取标注人标识 (写进 `annotator` 列, 便于复盘"谁标的").
 *
 * @param req 请求
 * @returns 标注人标识; 取不到 → null
 */
function resolveAnnotator(req: AdminDebugRequest): string | null {
  if (req.adminBasicAuth === true) return extractBasicCredentials(req as unknown as Request)?.user ?? 'admin';
  return req.user?.username ?? req.user?.userId ?? null;
}
