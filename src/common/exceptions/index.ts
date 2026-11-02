/**
 * V2026-09-14 治本: exceptions 模块 barrel 导出.
 *
 * 反双胞胎:
 *   - 不在每个 service 文件单独 import biz-code.enum + biz.exception 两行
 *     (统一从 barrel 导入, 加新异常类型只需扩这里)
 *   - 不导出具体实现 (mapBizCodeToHttpStatus / getBizCodeDefaultMessage),
 *     它们是内部实现, 只 export class + enum 给 service 用.
 *
 * 用法:
 *   import { BizCode, BizException } from '../../common/exceptions';
 *
 *   throw new BizException(BizCode.GrowthDailyToolsEmpty, '今日推荐工具为空');
 */

export { BizCode } from './biz-code.enum';
export { BizException } from './biz.exception';
