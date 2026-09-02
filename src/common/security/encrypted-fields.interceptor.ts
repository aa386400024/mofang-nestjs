import { BadRequestException, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

import { RsaKeyService } from './rsa-key.service';

/**
 * 敏感字段加密拦截器 — V1.1 enterprise.
 *
 * 用途: 拦截 `/auth/send-code` / `/auth/verify-code` / `/auth/set-password` 等
 * 含 *Enc 字段的请求, 在 controller 之前用 RsaKeyService 自动解密.
 *
 * 用法 (controller 端):
 *   @UseInterceptors(EncryptedFieldsInterceptor)
 *   @Post('set-password')
 *   async setPassword(@Body() body: { email: string; password: string }) { ... }
 *
 * 客户端请求格式:
 *   { "email": "x@y.com", "passwordEnc": "base64-rsa-encrypted-blob" }
 *   拦截后:
 *   { "email": "x@y.com", "password": "0126zhang" }
 *
 * 字段映射 (可扩展):
 *   - emailEnc   → email
 *   - passwordEnc → password
 *   - codeEnc    → code
 *   - newPasswordEnc → newPassword
 *   - oldPasswordEnc → oldPassword
 *
 * 防御层:
 *   - 解密失败 → 抛 BadRequestException (400), 跟大厂统一错误格式
 *   - 不存在 *Enc 字段 → 不处理 (兼容老客户端走明文)
 *
 * 大厂 standard: 拦截器只做"协议转换", 业务逻辑放 controller.
 */
@Injectable()
export class EncryptedFieldsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EncryptedFieldsInterceptor.name);

  /** 字段映射: 客户端 *Enc 字段 → 服务端明文字段 */
  private static readonly FIELD_MAP: Readonly<Record<string, string>> = {
    emailEnc: 'email',
    passwordEnc: 'password',
    codeEnc: 'code',
    newPasswordEnc: 'newPassword',
    oldPasswordEnc: 'oldPassword',
  };

  constructor(private readonly rsaKeyService: RsaKeyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    // V1.1.2: 强类型 Record<string, unknown> 替代 any (治本 @typescript-eslint/no-unsafe-assignment)
    const body = req.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== 'object') {
      return next.handle();
    }

    for (const [encField, plainField] of Object.entries(EncryptedFieldsInterceptor.FIELD_MAP)) {
      const ciphertext: unknown = body[encField];
      if (typeof ciphertext === 'string' && ciphertext.length > 0) {
        try {
          const plaintext = this.rsaKeyService.decrypt(ciphertext);
          body[plainField] = plaintext;
          // 删除 *Enc 字段, 避免下游误用
          delete body[encField];
          this.logger.debug(`Decrypted field ${encField} (${ciphertext.length} → ${plaintext.length} bytes)`);
        } catch (e) {
          this.logger.warn(`Failed to decrypt ${encField}: ${(e as Error).message}`);
          throw new BadRequestException(`Field "${encField}" decryption failed (likely wrong public key)`);
        }
      }
    }

    return next.handle();
  }
}
