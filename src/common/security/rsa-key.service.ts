import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { constants, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, type KeyObject } from 'node:crypto';

/**
 * RSA-OAEP keypair service — V1.1 enterprise 字段加密.
 *
 * 设计要点 (大厂 standard):
 *   - RSA 2048 bits (NIST 推荐, 2030 年前安全)
 *   - OAEP padding + SHA-256 (匹配客户端 `encrypt` 5.0.3 + pointycastle 默认 hash)
 *   - 生产从 .env 加载固定 keypair; dev 每次启动生成 (启动 log 警告)
 *   - KeyProviderService 注入到 EncryptedFieldsInterceptor, 拦截敏感字段
 *
 * 安全边界:
 *   - 私钥绝不暴露到 client, 仅服务进程持有
 *   - 公钥可缓存 (Flutter app 启动时拉一次, 复用整个 session)
 *   - 用途: 仅 field-level 加密, 不替代 TLS (TLS 是 transport layer 主力)
 *
 * 性能:
 *   - 2048 bit RSA 单次加密 ~0.1ms; 敏感字段 (password/code) 几十字符够用
 *   - 客户端实测 RSA 加密 < 1ms (Flutter Dart isolate)
 *
 * V1.1 范围:
 *   - password (登录/注册/设密)
 *   - code (邮箱验证码)
 *   - email 不加密 (TLS 已保护, 业务上是 PII 但非 secret)
 */
@Injectable()
export class RsaKeyService implements OnModuleInit {
  private readonly logger = new Logger(RsaKeyService.name);

  /** SPKI PEM format (client 友好的标准) */
  private publicKeyPem = '';

  /** PKCS8 PEM format (server 私钥, 严格 server-only) */
  private privateKeyPem = '';

  /** 缓存公钥对象 (避免每次加密重新解析) */
  private publicKeyObj: KeyObject | null = null;

  onModuleInit(): void {
    const envPub = process.env['RSA_PUBLIC_KEY_PEM'];
    const envPriv = process.env['RSA_PRIVATE_KEY_PEM'];

    if (envPub && envPriv) {
      this.publicKeyPem = envPub;
      this.privateKeyPem = envPriv;
      this.logger.log('RSA keypair loaded from env (production mode)');
    } else {
      this.logger.warn(
        '⚠️ Generating ephemeral RSA keypair (DEV ONLY). ' +
          'Set RSA_PUBLIC_KEY_PEM + RSA_PRIVATE_KEY_PEM in .env for production. ' +
          'Ephemeral keys will invalidate all client-side cached public keys on restart.',
      );
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      this.publicKeyPem = publicKey;
      this.privateKeyPem = privateKey;
    }
    // 预解析 public key for performance
    this.publicKeyObj = createPublicKey(this.publicKeyPem);
  }

  /** 暴露公钥给 client (PEM 格式, base64 友好). */
  getPublicKeyPem(): string {
    return this.publicKeyPem;
  }

  /**
   * 服务端解密客户端 RSA-OAEP 加密的字段.
   * @param ciphertextB64 客户端用公钥 RSA-OAEP(SHA-256) 加密后的 base64 字符串
   * @returns 解密后的明文
   */
  decrypt(ciphertextB64: string): string {
    if (!ciphertextB64) {
      throw new Error('Empty ciphertext');
    }
    const buffer = Buffer.from(ciphertextB64, 'base64');
    const plaintext = privateDecrypt(
      {
        key: this.privateKeyPem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );
    return plaintext.toString('utf8');
  }

  /**
   * 测试 / 调试用: 服务端用公钥加密 (验证 keypair 配对).
   * 生产不会调用, 仅为单测使用.
   */
  encryptForTest(plaintext: string): string {
    if (!this.publicKeyObj) {
      throw new Error('publicKey not initialized');
    }
    const encrypted = publicEncrypt(
      {
        key: this.publicKeyObj,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(plaintext, 'utf8'),
    );
    return encrypted.toString('base64');
  }

  /** 强制重新生成 (测试用) */
  regenerate(): void {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.publicKeyPem = publicKey;
    this.privateKeyPem = privateKey;
    this.publicKeyObj = createPublicKey(this.publicKeyPem);
  }

  /** 健康检查用: 探测 keypair 是否已初始化 (某些单测需要) */
  isInitialized(): boolean {
    return this.publicKeyObj !== null;
  }
}
