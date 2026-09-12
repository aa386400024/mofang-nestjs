/**
 * 漂流瓶统计 DTO — 顶部 hero card 用.
 *
 * 4 个 counter: 海面 / 我投的 / 我捞的 / 我回的.
 *
 * 反双胞胎:
 *   - 不复用 assessment/entities 的 stats DTO (无关)
 */
export class DriftBottleStatsDto {
  /** 海面飘着的瓶数 (别人投的, drift 状态). */
  seaCount!: number;

  /** 我投出的总数 (drift + picked + responded 全算). */
  myPostedCount!: number;

  /** 我捞起来读过的数. */
  myPickedCount!: number;

  /** 我给作者写过回信的数. */
  myRespondedCount!: number;

  static readonly EMPTY: DriftBottleStatsDto = {
    seaCount: 0,
    myPostedCount: 0,
    myPickedCount: 0,
    myRespondedCount: 0,
  };
}
