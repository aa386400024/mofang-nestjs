// V2026-10-26 治本 (官方音色目录 — 出参契约 DTO, spec §任务 2):
//   原因: `GET /counselor/voices?type=system` 的响应是**前后端唯一契约面**.
//     前端 (xin_su_app) 准备页要按它渲染音色选择器, 字段名改了会同时打断两端.
//   字段名取**驼峰** (`voiceId` / `name` / `description`): 前端规划 §6.2 拍板的就是
//     `{ voiceId, name, description }` 这三个键, 与上游的 snake_case (`voice_id` /
//     `voice_name`) 不同 —— 转换发生在服务端 (client 层), 不让客户端做无意义的映射.
//   反双胞胎:
//     - 不下发 `created_time`: 上游对系统音色恒为 `1970-01-01`, 是纯噪音; 一旦前端
//       依赖了它, 上游改口径就会静默错位 (spec §任务 2「剥掉前端不需要的字段」)
//     - 不下发试听音频地址: `get_voice` 的 system 条目**根本不含**试听音频,
//       造一个空字段等于骗前端"有试听" (试听是 P1 可选增强, 走独立端点)
//     - 不下发上游 `base_resp`: 那是上游协议细节, 不该出现在公共出参里
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/voices 的字段与 spec §任务 2 逐字段对齐
//   时间戳: 2026-10-26
import { ApiProperty } from '@nestjs/swagger';

/**
 * 单个系统音色.
 */
export class SystemVoiceDto {
  @ApiProperty({
    description:
      '音色 id (上游 `voice_id`). 这是**唯一有语义的字段** —— 选完它, 前端把它作为 ' +
      '`voiceId` 随 WS 握手 query 传回后端, 后端据此建连 TTS.',
    example: 'Chinese (Mandarin)_Lyrical_Voice',
  })
  voiceId!: string;

  @ApiProperty({
    description: '音色名称 (上游 `voice_name`). 上游未给时为空串.',
    example: '抒情女声',
  })
  name!: string;

  @ApiProperty({
    description: '音色描述 (上游 `description`, 字符串数组). 上游未给时为空数组.',
    example: ['一位温柔抒情的普通话女声……'],
    type: [String],
  })
  description!: string[];
}

/**
 * 音色列表响应.
 */
export class VoicesListDto {
  @ApiProperty({
    description: '账号可用的系统音色列表 (已按上游顺序, 未做二次排序).',
    type: [SystemVoiceDto],
  })
  voices!: SystemVoiceDto[];
}
