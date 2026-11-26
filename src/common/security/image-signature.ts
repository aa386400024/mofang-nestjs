/* eslint-disable prettier/prettier -- 文件头魔数用大写十六进制更易读 */

/**
 * 图片魔数识别（AF-547）。
 *
 * 上传安全不能只信 `Content-Type` 或文件名后缀：两者都由客户端控制。
 * 这里只读取文件头判断真实容器格式，返回落盘应使用的后缀；无法识别返回 null。
 */
export type SupportedImageExtension = '.jpg' | '.png' | '.webp';

export function detectImageExtension(buffer: Buffer): SupportedImageExtension | null {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return '.jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return '.png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp';
  }
  return null;
}
