// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · admin 端点):
//   职责: 暴露 admin 端点 —— 列表 / 详情 / 保存 / 双盲揭示 / 一致性报告 / 批次清单.
//   边界: 只做入参解析与身份提取; 业务在 service; 出参形状在 view.
//
//   端点 (与前端 `admin-dashboard/src/api/client.ts` 的 `api.qualityAnnotation` 严格 1:1):
//     GET  /admin/api/quality/annotations?status=pending|done|all[&batchId=]
//     GET  /admin/api/quality/annotations/:ref
//     PUT  /admin/api/quality/annotations/:ref
//     GET  /admin/api/quality/annotations/:ref/reveal
//     GET  /admin/api/quality/annotations/:ref/auto
//     GET  /admin/api/quality/consistency[?batchId=]
//     GET  /admin/api/quality/batches[?includeInvalid=1]      ← V2026-11-11 WP-N 新增
//
//   ⚠️ **路径是 `/admin/api/quality/*`**, 不是任务单写的 `/admin/quality/*` ——
//     前端 `client.ts` 的 BASE 是 `/admin/api`, 且后台代理只转发 `/admin/api`.
//
//   ⚠️ **`:ref` 是"标注行 id 或 debug_session_id"** (V2026-11-11 WP-N):
//     URL 形状与旧的 `:id` 完全一样, 只是参数语义放宽 —— 老前端不用改.
//
//   鉴权: 中间件 `AdminBasicAuthMiddleware` (身份) + class 级 `AdminRoleGuard` (角色).

import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { isValidBatchId } from './quality-annotation-batch.js';
import { ANNOTATION_STATUS, type AnnotationStatus } from './quality-annotation.constants.js';
import { QualityAnnotationService } from './quality-annotation.service.js';
import type {
  AnnotationBatchListResponse,
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
 * 质量标注台端点 (列表 / 详情 / 保存 / 双盲揭示 / 一致性报告 / 批次清单).
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
   * ⚠️ **不传 batchId → 全局口径** (已落库行 + 场次表派生未标注场次, done/total 全局);
   *   **传 batchId → 批次口径** (按批派生, 未建行 id=null).
   *
   * @param status 筛选 (pending | done | all; 缺省 pending)
   * @param batchId 批次 id (省略 = 全局口径)
   * @returns 列表 + 进度
   */
  @Get('annotations')
  async list(@Query('status') status?: string, @Query('batchId') batchId?: string): Promise<AnnotationListResponse> {
    return this.service.list(parseStatus(status), parseBatchId(batchId));
  }

  /**
   * 可标注批次清单 (V2026-11-11 WP-N).
   *
   * @param includeInvalid 是否把无效批次也返回 (1 / true)
   * @returns 批次清单 + 告警
   */
  @Get('batches')
  async batches(@Query('includeInvalid') includeInvalid?: string): Promise<AnnotationBatchListResponse> {
    return this.service.batches(parseIncludeInvalid(includeInvalid));
  }

  /**
   * 单条详情 = 标注行 + 该场逐字稿 (只双方台词).
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 详情
   */
  @Get('annotations/:ref')
  async detail(@Param('ref') ref: string): Promise<AnnotationDetail> {
    return this.service.detail(ref);
  }

  /**
   * 保存人工标注.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @param body 标注内容
   * @param req 请求 (取标注人身份)
   * @returns 保存后的行
   */
  @Put('annotations/:ref')
  async save(@Param('ref') ref: string, @Body() body: QualityAnnotationSaveDto, @Req() req: AdminDebugRequest): Promise<AnnotationRowView> {
    return this.service.save(ref, body, resolveAnnotator(req));
  }

  /**
   * 双盲揭示: 本场自动判定结果 (保存人工标注后才可调).
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 自动判定结果
   */
  @Get('annotations/:ref/reveal')
  async reveal(@Param('ref') ref: string): Promise<AnnotationReveal> {
    return this.service.reveal(ref);
  }

  /**
   * 双盲辅助: 随时可调用的自动判定 (不要求先保存).
   *
   * 与 reveal 的区别: 不校验人工标注是否已保存, 只返回规则引擎本身的判定.
   * 给标注员「拿不准时主动问 AI」用.
   *
   * @param ref 标注行 id 或 debug_session_id
   * @returns 自动判定结果
   */
  @Get('annotations/:ref/auto')
  async auto(@Param('ref') ref: string): Promise<AnnotationReveal> {
    return this.service.auto(ref);
  }

  /**
   * 一致性报告: 人工标注 vs 自动判定.
   *
   * @param batchId 批次 id (省略 = 全量口径)
   * @returns 一致性报告
   */
  @Get('consistency')
  async consistency(@Query('batchId') batchId?: string): Promise<AnnotationConsistency> {
    return this.service.consistency(parseBatchId(batchId));
  }
}

/**
 * 解析列表筛选参数 (非法 → 400).
 *
 * ⚠️ **非法值不静默兜底**: `status=xxx` 被当成"全部"的话, 标注员以为自己
 * 在看"待标", 实际看到的是全部 —— 那比报错危险得多.
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
 * 解析批次 id (省略 / 空 → null = 历史口径; 非法 → 400).
 *
 * ⚠️ **非法值必须报错**: 批次 id 会被拼进文件路径 (冻结副本目录),
 *   静默兜底成"全量"的话, 标注员会以为在看某批, 实际看的是全部.
 *
 * @param raw 原始参数
 * @returns 批次 id 或 null
 */
function parseBatchId(raw: string | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text.length === 0) return null;
  if (!isValidBatchId(text)) {
    throw new BizException(BizCode.InvalidParameter, `batchId 参数不合法: "${text}"`);
  }
  return text;
}

/**
 * 解析 includeInvalid 开关 (非法 → 400).
 *
 * @param raw 原始参数
 * @returns 是否包含无效批次
 */
function parseIncludeInvalid(raw: string | undefined): boolean {
  const text = (raw ?? '').trim();
  if (text.length === 0) return false;
  if (text === '1' || text === 'true') return true;
  if (text === '0' || text === 'false') return false;
  throw new BizException(BizCode.InvalidParameter, `includeInvalid 参数不合法: "${text}" (要 1 / 0)`);
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
