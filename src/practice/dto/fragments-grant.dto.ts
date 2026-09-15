/**
 * V2026-09-14 治本 (Stage C 后端契约): FragmentsGrant DTO.
 *
 * 跟前端 lib/features/growth/domain/entities/daily_growth_tool.dart DailyGrowthTool.fragmentsGrant
 * (Map<FragmentType, int>) 严格 1:1 对齐.
 *
 * 设计:
 *   - key 严格枚举 5 种 FragmentType (calm/thinking/starlight/warmth/courage)
 *   - value 必须 >= 1 (V1.0 上限 10)
 *   - 跟前端 Map<FragmentType, int> 1:1 对齐 (V2.1 不引入嵌套结构)
 *
 * V2026-09-14 治本 (Lint fix): 改用 5 个 optional 字段而不是 index signature,
 *   因为 NestJS class + @ApiProperty 不支持 [key: string]: number 这种索引签名,
 *   且 TS 5+ decorator 报错 "Decorators are not valid here". 反双胞胎: 5 个字段
 *   跟 FRAGMENT_TYPE_CODES 数组严格 1:1, 后端 schema 等价于 JSON object (前端 Map).
 *
 * 反双胞胎:
 *   - 不在 DTO 里维护平行 Map 类型 (5 个字段已跟 FRAGMENT_TYPE_CODES 1:1 对齐)
 *   - 不引入新碎片类型 (V1.0 严格 5 种)
 */

import { ApiProperty } from '@nestjs/swagger';

import { FRAGMENT_TYPE_CODES, FragmentTypeCode } from '../constants/fragment-type-code';

/**
 * FragmentsGrant DTO — 5 个 FragmentType code 跟数值的扁平结构.
 *
 * V2026-09-14 治本 (Lint fix): 改用 5 个 optional 字段而不是 index signature.
 *   - 优点: Swagger 能正确描述每个字段, NestJS class-validator 可挂装饰器,
 *           TS 严格模式下不报 lint (no-explicit-any / restrict-template-expressions)
 *   - 序列化层: JSON 序列化时 5 个 optional 字段自然就是 JSON object,
 *           跟前端 Map<FragmentType, int> 在 wire format 上完全等价
 *   - 反序列化: 5 个字段全 optional, JSON 缺字段就是 undefined,
 *           assertFragmentsGrantContract 兜底校验
 */
export class FragmentsGrantDto {
  // V2026-09-14 治本: 5 个字段顺序跟 FRAGMENT_TYPE_CODES 数组严格一致,
  //   改 enum 时必须同步改这里 (assertFragmentsGrantContract 把 keys 当作 wire value 校验).
  @ApiProperty({ description: '平静气泡产出数, [1, 10]', example: 3, minimum: 1, maximum: 10, required: false })
  calm?: number;

  @ApiProperty({ description: '思维镜片产出数, [1, 10]', example: 0, minimum: 1, maximum: 10, required: false })
  thinking?: number;

  @ApiProperty({ description: '星光粒子产出数, [1, 10]', example: 0, minimum: 1, maximum: 10, required: false })
  starlight?: number;

  @ApiProperty({ description: '温暖碎片产出数, [1, 10]', example: 1, minimum: 1, maximum: 10, required: false })
  warmth?: number;

  @ApiProperty({ description: '勇气结晶产出数, [1, 10]', example: 1, minimum: 1, maximum: 10, required: false })
  courage?: number;
}

/**
 * 静态校验: FragmentsGrantDto 的 key 必须严格枚举, value 在 [1, 10].
 *
 * V2026-09-14 治本: 输入改为 `unknown`, 5 个字段是 optional 时,
 * Object.entries 会过滤掉 undefined, 所以校验只需要看 defined 的字段.
 */
export function assertFragmentsGrantContract(grant: unknown): void {
  if (!grant || typeof grant !== 'object') {
    throw new Error('[contract] fragments_grant must be an object');
  }
  // V2026-09-14 治本 (Lint fix): 显式 String() 转换, 避免 restrict-template-expressions 错.
  for (const [key, value] of Object.entries(grant as Record<string, unknown>)) {
    if (!FRAGMENT_TYPE_CODES.includes(key as FragmentTypeCode)) {
      throw new Error(
        `[contract] fragments_grant key "${String(key)}" not in 5 enum. ` + `Must be one of: ${FRAGMENT_TYPE_CODES.join(', ')}`,
      );
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
      throw new Error(`[contract] fragments_grant["${String(key)}"] = ${String(value)} invalid, must be integer in [1, 10]`);
    }
  }
}
