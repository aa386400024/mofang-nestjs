// V2026-10-26 治本 (官方音色目录 — 只读代理端点, spec §任务 2):
//   契约:
//     GET /counselor/voices?type=system
//     Authorization: Bearer <jwt>   (复用 JwtAuthGuard)
//     响应: { voices: [{ voiceId, name, description }] }
//   原因: 前端**不直连** MiniMax —— API key 只在后端 (spec 红线「MiniMax API key
//     永不下发前端」). 本端点是音色选择器唯一的取数入口.
//   错误口径 (spec §任务 2):
//     上游 1004 鉴权失败 / 1008 余额不足 → 502 + 可读 message (前端隐藏或置灰选择器, 不崩溃);
//     **不回传上游原始 key / 原始 message**.
//   反双胞胎:
//     - 不在 controller 里调上游: HTTP 面只做出入参转交, 业务全在 service
//     - 不下发上游 base_resp / created_time: 那是上游协议细节, 不该出现在公共出参里
//     - 不做试听: `get_voice` 的 system 条目**不含**试听音频, 试听是 P1 可选增强 (独立端点)
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/voices 可见
//     3. 无 token 访问 → 401
//     4. curl -H "Authorization: Bearer ***" "http://localhost:3000/counselor/voices?type=system" → 精简列表
//   时间戳: 2026-10-26

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { VoicesListDto } from '../dto/voices.dto';
import { VoicesService } from '../providers/voices.service';

@ApiTags('counselor-voices')
@Controller('counselor/voices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorVoicesController {
  /**
   * @param voices 音色目录服务
   */
  constructor(private readonly voices: VoicesService) {}

  /**
   * GET /counselor/voices?type=system
   *
   * 返回账号可用的**系统音色**精简列表 (前端准备页的音色选择器取数入口).
   *
   * @param type 音色类型 (本期只接受 `system`; 传其他值或缺省按 `system` 处理)
   * @returns 音色列表
   */
  @Get()
  @ApiOperation({
    summary: '账号可用的官方系统音色列表 (音色选择器取数入口)',
    description:
      '服务端代理 MiniMax `POST /v1/get_voice` (前端不直连, API key 永不下发). ' +
      '本期只开放系统音色 (`type=system`), 传其他值或缺省按 `system` 处理. ' +
      '上游鉴权失败 / 余额不足 → 502 + 可读 message (前端应隐藏或置灰选择器, 不要崩溃). ' +
      '返回项只含 `voiceId` / `name` / `description` 三个字段.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['system'],
    description: '音色类型. 本期只支持 `system` (克隆 / 文生音色后期才开).',
  })
  list(@Query('type') type?: string): Promise<VoicesListDto> {
    return this.voices.listVoices(type);
  }
}
