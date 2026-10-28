// V2026-10-23 治本 (语音微训练 STT — 出参契约 DTO, spec §2.2):
//   原因: `POST /counselor/practice/asr` 的响应是**前后端唯一契约面**. 前端
//     (xin_su_app) 已按 `{ text, duration, trace_id }` 写好 Dart model
//     (voice_transcription.dart), 字段改名会同时打断客户端与服务端.
//   修法: 一份 DTO 覆盖出参, 字段名与 spec §2.2 逐字对齐, 全部标 swagger 注解.
//   反双胞胎:
//     - 字段名保持**下划线** (`trace_id`): 上游是 snake_case, 客户端按 snake_case 解析;
//       强行改成 camelCase 只会逼客户端做一次无意义的映射转换. 项目内已有同风格先例
//       (practice/dto/growth.dto.ts 的 `stage_index` / `link_route`).
//     - **不新增**任何"友好度"字段 (如 `isEmpty` / `confidence`): 客户端的
//       `VoiceTranscription.isEmpty` 已经能从 text 推导, 再下发一份就是两份事实源.
//     - 不下发音频时长之外的"计费信息": 计费以 duration 为准, 多给字段会诱导客户端
//       自己算钱 (spec §2.2 明确 duration 就是计费依据).
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/practice/asr 的字段与 spec §2.2 逐字段对齐
//     3. 全仓 grep 'traceId' 于本文件 → 0 命中 (契约面只有一个拼写)
//   时间戳: 2026-10-23
import { ApiProperty } from '@nestjs/swagger';

export class PracticeAsrResultDto {
  @ApiProperty({
    description:
      '完整转写文本. 未识别到内容时为空串 "" —— 前端据此走「未识别只出技术提示」分支, ' + '服务端**不会**伪造文本兜底 (spec §2.2).',
    example: '听起来你这阵子是真的很累，脑子一直转停不下来。',
  })
  text!: string;

  @ApiProperty({
    description: '音频时长 (秒, 上游计费依据). 可作为 §3.3 recordSeconds 的校准值; 上游未返回时为 null.',
    nullable: true,
    example: 12.744,
  })
  duration!: number | null;

  @ApiProperty({
    description: '上游追踪 ID, 落日志便于排查 (spec §2.2). 上游未返回时为空串.',
    example: '021785229015510a2c883cf675b9804d',
  })
  trace_id!: string;
}
