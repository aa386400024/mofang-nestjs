// AF-225 · 按 packetId 精确筛选盲评包：
// 只服务失败 packet 恢复探针，不改变盲评包的抽样与去身份逻辑。

import type { RealismBlindPacket } from './visitor-realism-rating.js';

export interface PacketFilterResult {
  readonly selected: readonly RealismBlindPacket[];
  readonly missing: readonly string[];
}

export function filterPacketsByIds(packets: readonly RealismBlindPacket[], packetIds: readonly string[]): PacketFilterResult {
  const requested = new Set(packetIds.map((id) => id.trim()).filter((id) => id.length > 0));
  const selected = packets.filter((packet) => requested.has(packet.packetId));
  const found = new Set(selected.map((packet) => packet.packetId));
  const missing = [...requested].filter((id) => !found.has(id));
  return { selected, missing };
}
