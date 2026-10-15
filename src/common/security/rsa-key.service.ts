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
      // V2026-10-15 治本 (VS-4 PKCS#8 PEM multiline 防御性 .env parse — literal \n → 真换行):
      //   原因: 9P mount cache / Windows CRLF / dotenv multiline 处理行为差异
      //     导致 process.env.RSA_PUBLIC_KEY_PEM 可能是 literal "\n" (2 字符: backslash + n)
      //     而不是真换行. Node 24 OpenSSL ERR_OSSL_UNSUPPORTED 拒解析, server 启动失败.
      //     WSL 端 dotenv 单独 / dotenv-expand / NestJS ConfigModule 3 种 parse 都能解析
      //     (.env multiline 修复后), 但 Windows 端仍 parse 出 literal "\n" (9P cache stale).
      //   修法: server 端 .replace(/\\n/g, '\n') 防御, 兼容所有 .env 格式 (literal \n + 真换行).
      //   反双胞胎:
      //     - 不依赖 dotenv multiline 处理 (over-engineering, 1 行 replace 治本),
      //     - 不改 .env 格式 (大炮已经 multiline 修复, 防御性兼容所有 .env),
      //     - 不引新依赖 (Node.js String.prototype.replace 内置).
      //   验证: 大炮跑 pnpm smoke:rag 验 6 步全过 (RsaKeyService.onModuleInit 解析 PEM OK + /health 200).
      //   时间戳: 2026-10-15.
      this.publicKeyPem = envPub
        // V2026-10-15 治本 (VS-4 PEM multiline 增强 — 兼容 4 种 .env 格式):
        //   顺序很重要: literal 优先, 再 actual, 避免 1 轮转 2 次 (e.g. \\r\n → \n 后续 \n 误判).
        //     1. literal \\r\\n (4 字符: backslash + r + backslash + n) → 真换行 (Windows 编辑器存 literal \r\n 场景)
        //     2. literal \\n (2 字符: backslash + n) → 真换行 (dotenv 单行解析, WSL 9P cache stale 场景)
        //     3. actual \r\n (CRLF, 0x0D+0x0A) → 真换行 (Windows 编辑器 multiline 保存, 自动 CRLF 场景)
        //     4. actual \r (rare, 0x0D) → 真换行 (Mac classic 场景, 保险)
        //   跟 9P mount cache V2026-10-08 治本 + V0.5 V2026-10-08 治本同 pattern, 治本不压错.
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      this.privateKeyPem = envPriv
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
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
