// V2026-10-28 治本 (WP8-A · B 层 · 引擎聚合调试端点):
//   职责: 提供 open / turn / close 三个**聚合**(非流式)路由, 用 curl 就能验证
//         "咨询师发一句 → 来访回一句真实文本 → BDI 快照变化可见".
//   边界: 仅联调用途; 不挂到前端正式 vpt 路径; 不做 SSE / WS / chunk 增量.
//
//   为什么路由名带 debug:
//     这是**新引擎的联调口**, 不是产品功能. 新引擎在 WP8-B 接进语音链路之前,
//     需要一个"能单独验证内核 + 渲染 + 记忆是否真的跑通"的入口. 路由名带 debug
//     是为了让任何人一眼看出它不是正式路径 —— 将来要下线它, 删一个模块即可,
//     不牵动正式链路.
//
//   出参纪律:
//     · 只回 `TurnRenderResult` 既有字段 (reply / snapshot / turnIndex / intention
//       / render{fallbackUsed,providerHint,usage} / trajectoryTrace / safety /
//       openingContext);
//     · **不回** apiKey、厂商私有原始响应、系统 prompt 全文 —— 系统 prompt 是
//       适配层模板, 泄露等于把来访者画像约束摊开;
//     · `openingContext` 是**本租户本来访者**自己的记忆命中, 属回显本人数据.
//
//   反双胞胎:
//     - 不在本层做引擎错误归一之外的加工: 内核错误 (ABORTED / INVALID_INPUT /
//       SESSION_NOT_FOUND / STATE_CONFLICT / SESSION_ALREADY_OPEN) 按 code 映射到
//       对应 HTTP 状态, **不吞** —— 吞掉会把"参数错"伪装成一次正常对练.
//     - 不在 controller 里读 env / 造对象: 那是装配层的事, controller 只做
//       "HTTP ↔ 门面" 的翻译.
//     - 不把角色内核当自由 JSON 直传内核: 形状非法时**忽略并回中性基线**
//       (内核会直接遍历 coreBeliefs / activationTags, 传脏数据会让整轮 500).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. curl POST /engine/debug/open → /engine/debug/turn → /engine/debug/close
//     3. test/engine-adapters/wp8-wiring.spec.ts 覆盖 DTO 归一与错误映射

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

import { EngineTurnService } from './engine-turn.service';
import { JwtAuthGuard } from '../../auth/guards';
import { TenantId } from '../../common/decorators';
import { EngineCoreError, EngineErrorCode, type AttachmentStyle, type CharacterProfile, type CoreBelief } from '../../engine-core';
import type { TurnRenderResult } from '../rendering/turn-render-orchestrator';

/**
 * 开场入参.
 */
export class EngineOpenDto {
  @ApiProperty({ description: '业务会话 id (同租户内唯一; 重复 open 返回 409)' })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty({ description: '来访者 id (角色标识; WP9 角色资产池接入后由后端解析)' })
  @IsString()
  @IsNotEmpty()
  visitorId!: string;

  @ApiProperty({ description: '可复现性种子 (可选; 同种子 + 同行为序列 = 同状态)', required: false })
  @IsOptional()
  @IsInt()
  seed?: number;

  @ApiProperty({ description: '跨会话接续来源 sessionId (可选)', required: false })
  @IsOptional()
  @IsString()
  resumeFromSessionId?: string;

  @ApiProperty({ description: '角色内核基线 (可选; 形状非法时忽略并回中性基线)', required: false, type: Object })
  @IsOptional()
  @IsObject()
  characterProfile?: Record<string, unknown>;
}

/**
 * 单轮入参.
 */
export class EngineTurnDto {
  @ApiProperty({ description: '会话句柄 id (open 返回)' })
  @IsString()
  @IsNotEmpty()
  handleId!: string;

  @ApiProperty({ description: '咨询师本轮文本 (ASR final)' })
  @IsString()
  @IsNotEmpty()
  userText!: string;

  @ApiProperty({ description: '链路 trace id (可选; 仅观测)', required: false })
  @IsOptional()
  @IsString()
  traceId?: string;
}

/**
 * 关闭入参.
 */
export class EngineCloseDto {
  @ApiProperty({ description: '会话句柄 id' })
  @IsString()
  @IsNotEmpty()
  handleId!: string;
}

/**
 * 引擎聚合调试端点 (JWT 保护).
 */
@Controller('engine/debug')
@UseGuards(JwtAuthGuard)
export class EngineWiringController {
  constructor(private readonly engine: EngineTurnService) {}

  /**
   * POST /engine/debug/open
   *
   * @param tenantId 租户 (取自 JWT)
   * @param body 开场入参
   * @returns 会话句柄 id + 业务会话 id
   */
  @Post('open')
  open(@TenantId() tenantId: string, @Body() body: EngineOpenDto): { readonly handleId: string; readonly sessionId: string } {
    try {
      const characterProfile = sanitizeCharacterProfile(body.characterProfile);
      return this.engine.open({
        sessionId: body.sessionId,
        tenantId,
        visitorId: body.visitorId,
        ...(body.seed === undefined ? {} : { seed: body.seed }),
        ...(body.resumeFromSessionId === undefined ? {} : { resumeFromSessionId: body.resumeFromSessionId }),
        ...(characterProfile ? { characterProfile } : {}),
      });
    } catch (error) {
      throw mapKernelError(error);
    }
  }

  /**
   * POST /engine/debug/turn
   *
   * 一次性返回完整 `TurnRenderResult` (非 SSE / 非 chunk).
   *
   * @param body 单轮入参
   * @returns 本轮来访口语 + 内核出参 + 渲染元信息
   */
  @Post('turn')
  async turn(@Body() body: EngineTurnDto): Promise<TurnRenderResult> {
    try {
      return await this.engine.turn(body.handleId, {
        userText: body.userText,
        ...(body.traceId === undefined ? {} : { traceId: body.traceId }),
      });
    } catch (error) {
      throw mapKernelError(error);
    }
  }

  /**
   * POST /engine/debug/close
   *
   * @param body 关闭入参
   * @returns 固定 ok
   */
  @Post('close')
  close(@Body() body: EngineCloseDto): { readonly ok: true } {
    try {
      this.engine.close(body.handleId);
      return { ok: true };
    } catch (error) {
      throw mapKernelError(error);
    }
  }
}

/**
 * 内核错误 → HTTP 异常.
 *
 * 只映射**可识别**的内核错误; 其它异常原样上抛, 交给全局 BizExceptionFilter 兜底
 * (它会把未识别异常归一成 500 + 统一响应体).
 *
 * @param error 抛出的异常
 * @returns HTTP 异常 (或原异常)
 */
function mapKernelError(error: unknown): unknown {
  if (!(error instanceof EngineCoreError)) return error;
  switch (error.code) {
    case EngineErrorCode.INVALID_INPUT:
    case EngineErrorCode.UNSUPPORTED:
      return new BadRequestException(error.message);
    case EngineErrorCode.SESSION_NOT_FOUND:
      return new NotFoundException(error.message);
    case EngineErrorCode.SESSION_ALREADY_OPEN:
    case EngineErrorCode.STATE_CONFLICT:
    case EngineErrorCode.ABORTED:
      return new ConflictException(error.message);
    default:
      return new InternalServerErrorException('引擎内部错误');
  }
}

/**
 * 角色内核入参净化: 形状合法才用, 否则整体丢弃 (回中性基线).
 *
 * 为什么必须净化: 内核装配初始快照时**直接遍历** `coreBeliefs` 并展开
 * `activationTags` —— 传一个 `coreBeliefs: "abc"` 或缺 `activationTags` 的信念,
 * 会在**开场那一刻**抛 TypeError, 整场会话直接 500. 调试端点不该有这号威力.
 *
 * @param raw 原始入参
 * @returns 合法角色内核; 形状不合法 → undefined
 */
function sanitizeCharacterProfile(raw: unknown): CharacterProfile | undefined {
  if (!isRecord(raw)) return undefined;
  // 说明: 本仓 tsconfig 开了 noPropertyAccessFromIndexSignature —— 索引签名属性
  // 必须走方括号访问, 否则 TS4111 编译错.
  const coreBeliefs = toCoreBeliefs(raw['coreBeliefs']);
  const forbiddenBehaviors = toStringArray(raw['forbiddenBehaviors']);
  const sensitiveTopics = toStringArray(raw['sensitiveTopics']);
  if (!coreBeliefs || !forbiddenBehaviors || !sensitiveTopics) return undefined;

  const attachmentStyle = toAttachmentStyle(raw['attachmentStyle']);
  return {
    coreBeliefs,
    forbiddenBehaviors,
    sensitiveTopics,
    ...(attachmentStyle ? { attachmentStyle } : {}),
  };
}

/**
 * 核心信念数组净化.
 *
 * @param raw 原始值
 * @returns 合法信念数组; 形状不合法 → undefined
 */
function toCoreBeliefs(raw: unknown): CoreBelief[] | undefined {
  if (!isUnknownArray(raw)) return undefined;
  const beliefs: CoreBelief[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return undefined;
    const activationTags = toStringArray(item['activationTags']);
    if (typeof item['theme'] !== 'string' || typeof item['statement'] !== 'string' || !activationTags) return undefined;
    beliefs.push({ theme: item['theme'], statement: item['statement'], activationTags });
  }
  return beliefs;
}

/**
 * 字符串数组净化 (非数组 → undefined).
 *
 * @param raw 原始值
 * @returns 字符串数组; 形状不合法 → undefined
 */
function toStringArray(raw: unknown): string[] | undefined {
  if (!isUnknownArray(raw)) return undefined;
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return undefined;
    values.push(item);
  }
  return values;
}

/**
 * 依恋风格净化.
 *
 * @param raw 原始值
 * @returns 合法依恋风格; 不合法 → undefined
 */
function toAttachmentStyle(raw: unknown): AttachmentStyle | undefined {
  if (raw === 'secure' || raw === 'anxious' || raw === 'avoidant' || raw === 'disorganized') return raw;
  return undefined;
}

/**
 * 是否为普通对象 (排除 null / 数组).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 是否为数组 (自有守卫: Array.isArray 会把链路收窄成 any[]).
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
