import { registerDecorator, type ValidationOptions } from 'class-validator';

import { BizCode } from '../exceptions/biz-code.enum';
import { BizException } from '../exceptions/biz.exception';

/**
 * 中国大陆手机号校验 (大厂安全标准).
 *
 * 规则:
 *   - 11 位数字
 *   - 开头 1
 *   - 第二位 3-9 (排除 10/11/12 等无效号段)
 *   - 运营商号段: 13x/14x/15x/16x/17x/18x/19x (V1 不区分具体运营商, 仅校验格式)
 *
 * 用法:
 *   @IsChinesePhone()
 *   phone: string;
 *
 * 抛错策略 (大厂做法):
 *   - class-validator 装饰器只返回 ValidationError (默认 400)
 *   - 业务层检测手机号格式失败时, throw BizException(InvalidPhone)
 *   - 这里是装饰器层, 只做格式校验, 不 throw BizException
 */
export function isChinesePhone(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isChinesePhone',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && /^[1][3-9]\d{9}$/.test(value);
        },
        defaultMessage(): string {
          return '手机号格式不正确 (11 位, 1[3-9]xxxxxxxxx)';
        },
      },
    });
  };
}

/**
 * 业务层手动校验 (抛 BizException).
 *
 * 用法:
 *   assertChinesePhone(phone);
 */
export function assertChinesePhone(phone: string): void {
  if (!/^[1][3-9]\d{9}$/.test(phone)) {
    throw new BizException(BizCode.InvalidPhone);
  }
}
