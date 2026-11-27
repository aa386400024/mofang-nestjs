/** 导出格式 → 文件字节流 (JSON / 单文件 ZIP). */

/** 导出包内数据文件名（ZIP 内只有这一个成员）. */
export const EXPORT_ARCHIVE_ENTRY = 'xinsu-data.json';

/** 构建好的导出文件. */
export interface BuiltExportArchive {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

/**
 * 把导出载荷构建成下载文件.
 *
 * @param format json / zip
 * @param payload 导出载荷
 * @param now 文件名时间戳来源（测试可注入）
 * @returns 文件字节流 + content-type + 文件名
 */
export function buildExportArchive(format: 'json' | 'zip', payload: unknown, now: Date = new Date()): BuiltExportArchive {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const stamp = now.toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll(/\..+/g, '');
  if (format === 'zip') {
    return {
      buffer: buildSingleFileZip(EXPORT_ARCHIVE_ENTRY, Buffer.from(json, 'utf8')),
      contentType: 'application/zip',
      fileName: `xinsu-export-${stamp}.zip`,
    };
  }
  return {
    buffer: Buffer.from(json, 'utf8'),
    contentType: 'application/json; charset=utf-8',
    fileName: `xinsu-export-${stamp}.json`,
  };
}

/**
 * 生成单成员 ZIP（store 方法，不压缩）.
 *
 * 为什么不用第三方库: 导出包只有一个 JSON 成员，DEFLATE 收益有限；自己写
 * store 格式能少一个运行时依赖，也避免供应链审计面. 心理内容本身是文本，
 * 压缩比不是这条链路的瓶颈.
 *
 * @param entryName ZIP 内文件名（ASCII）
 * @param content 文件内容
 * @returns ZIP 字节流
 */
export function buildSingleFileZip(entryName: string, content: Buffer): Buffer {
  if (!/^[\u0020-\u007E]+$/.test(entryName)) throw new Error('ZIP 成员名必须是 ASCII');
  const name = Buffer.from(entryName, 'ascii');
  const crc = crc32(content);
  const dosTime = toDosTime(new Date());

  const local = Buffer.alloc(30);
  local.writeUInt32LE(67_324_752, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // method = store
  local.writeUInt16LE(dosTime.time, 10);
  local.writeUInt16LE(dosTime.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(33_639_248, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime.time, 12);
  central.writeUInt16LE(dosTime.date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30); // extra len
  central.writeUInt16LE(0, 32); // comment len
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(0, 42); // local header offset

  const centralOffset = local.length + name.length + content.length;
  const centralSize = name.length + central.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(101_010_256, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, name, content, central, name, end]);
}

/** CRC-32 (ZIP 用的反射多项式 0xEDB88320). */
export function crc32(input: Buffer): number {
  let crc = 4_294_967_295;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 3_988_292_384 : crc >>> 1;
    }
  }
  return (crc ^ 4_294_967_295) >>> 0;
}

/** 转 DOS 时间/日期（ZIP 头字段）. */
function toDosTime(now: Date): { time: number; date: number } {
  const year = Math.max(now.getFullYear(), 1980);
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  return { time, date };
}
