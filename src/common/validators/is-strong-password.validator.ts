import { registerDecorator, type ValidationOptions } from 'class-validator';

import { BizException } from '../exceptions/biz.exception';
import { BizCode } from '../exceptions/biz-code.enum';

/**
 * 强密码校验 (大厂安全标准).
 *
 * V1 规则 (NIST + 国内大厂标准):
 *   - 最少 8 位
 *   - 至少 1 个大写字母
 *   - 至少 1 个小写字母
 *   - 至少 1 个数字
 *   - (V2 加: 至少 1 个特殊字符)
 *
 * 不强制规则:
 *   - 不要求定期修改 (NIST 800-63B 已废弃此规则)
 *   - 不要求无重复字符
 *   - 不要求复杂度组合 (比如不能全是字母)
 *
 * 用法:
 *   @IsStrongPassword()
 *   password: string;
 */
export function isStrongPassword(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') {
            return false;
          }
          // 8+ 位 + 大写 + 小写 + 数字
          return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}$/.test(value);
        },
        defaultMessage(): string {
          return '密码至少 8 位, 包含大小写字母和数字';
        },
      },
    });
  };
}

/**
 * 业务层手动校验 (抛 BizException).
 */
export function assertStrongPassword(password: string): void {
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}$/.test(password)) {
    throw new BizException(BizCode.WeakPassword);
  }
}
