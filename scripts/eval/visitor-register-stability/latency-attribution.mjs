// AF-471 · 延迟归因纯函数：只接收已落盘的逐轮聚合字段，不读原文、不发网络。
// 目标是让 AF-466 的 p95 增量可复算，并把「长度/位置/尾部/运行波动」拆开。

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function median(values) {
  return percentile(values, 0.5);
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export function describeDistribution(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length === 0) {
    return { n: 0, mean: 0, sd: 0, min: 0, p50: 0, p90: 0, p95: 0, max: 0 };
  }
  const avg = mean(valid);
  const variance = mean(valid.map((value) => (value - avg) ** 2));
  return {
    n: valid.length,
    mean: round(avg, 1),
    sd: round(Math.sqrt(variance), 1),
    min: round(Math.min(...valid), 1),
    p50: round(percentile(valid, 0.5), 1),
    p90: round(percentile(valid, 0.9), 1),
    p95: round(percentile(valid, 0.95), 1),
    max: round(Math.max(...valid), 1),
  };
}

/**
 * 从 promptFull 里量出语域块的长度与位置，不返回块内容。
 * 块以「你说话的样子（只影响用词…）」行开始，到下一个空行为止。
 */
export function extractSpeechRegisterBlock(promptFull) {
  const text = String(promptFull ?? '');
  const lines = text.split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('你说话的样子（只影响用词')) {
      offset += lines[index].length + 1;
      continue;
    }
    let end = offset;
    let cursor = index;
    while (cursor < lines.length && lines[cursor].trim() !== '') {
      end += lines[cursor].length + 1;
      cursor += 1;
    }
    return {
      chars: round(end - offset, 0),
      startChar: offset,
      startLine: index,
      position: text.length === 0 ? null : round(offset / text.length, 3),
    };
  }
  return { chars: 0, startChar: null, startLine: null, position: null };
}

export function pearson(x, y) {
  if (x.length !== y.length || x.length < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;
  for (let index = 0; index < x.length; index += 1) {
    const dx = x[index] - mx;
    const dy = y[index] - my;
    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }
  if (denominatorX === 0 || denominatorY === 0) return 0;
  return numerator / Math.sqrt(denominatorX * denominatorY);
}

/** 最小二乘回归；columns 不含截距，返回系数、R²、RMSE。 */
export function linearRegression(columns, target, names) {
  if (columns.length !== target.length || columns.length === 0) throw new Error('回归输入长度不一致');
  const width = columns[0].length;
  const design = columns.map((row) => [1, ...row]);
  const matrix = Array.from({ length: width + 1 }, (_, row) => [
    ...Array.from({ length: width + 1 }, (_, column) => mean(design.map((item) => item[row] * item[column]))),
    mean(design.map((item, index) => item[row] * target[index])),
  ]);

  for (let pivot = 0; pivot <= width; pivot += 1) {
    let best = pivot;
    for (let row = pivot; row <= width; row += 1) {
      if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[best][pivot])) best = row;
    }
    if (Math.abs(matrix[best][pivot]) < 1e-12) throw new Error('回归矩阵奇异');
    [matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]];
    const divisor = matrix[pivot][pivot];
    for (let column = pivot; column <= width + 1; column += 1) matrix[pivot][column] /= divisor;
    for (let row = 0; row <= width; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row][pivot];
      for (let column = pivot; column <= width + 1; column += 1) {
        matrix[row][column] -= factor * matrix[pivot][column];
      }
    }
  }

  const coefficients = Object.fromEntries([
    ['intercept', matrix[0][width + 1]],
    ...names.map((name, index) => [name, matrix[index + 1][width + 1]]),
  ]);
  const predictions = design.map((row) => row.reduce((sum, value, index) => sum + value * matrix[index][width + 1], 0));
  const targetMean = mean(target);
  const sse = target.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  const sst = target.reduce((sum, value) => sum + (value - targetMean) ** 2, 0);
  return {
    n: target.length,
    coefficients: Object.fromEntries(Object.entries(coefficients).map(([key, value]) => [key, round(value, 3)])),
    r2: round(sst === 0 ? 0 : 1 - sse / sst, 3),
    rmse: round(Math.sqrt(sse / target.length), 1),
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 对分位数做 bootstrap；用于说明 30 轮样本本身能有多大波动。 */
export function bootstrapQuantile(values, p, options = {}) {
  const reps = options.reps ?? 2000;
  const seed = options.seed ?? 1;
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length === 0) return { mean: 0, low: 0, high: 0, cv: 0, reps };
  const random = mulberry32(seed);
  const draws = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const sample = [];
    for (let index = 0; index < valid.length; index += 1) {
      sample.push(valid[Math.floor(random() * valid.length)]);
    }
    draws.push(percentile(sample, p));
  }
  const average = mean(draws);
  const sd = Math.sqrt(mean(draws.map((value) => (value - average) ** 2)));
  return {
    mean: round(average, 1),
    low: round(percentile(draws, 0.025), 1),
    high: round(percentile(draws, 0.975), 1),
    cv: round(average === 0 ? 0 : sd / average, 3),
    reps,
  };
}

export function bootstrapMedian(values, options = {}) {
  const reps = options.reps ?? 4000;
  const random = mulberry32(options.seed ?? 7);
  const draws = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const sample = [];
    for (let index = 0; index < values.length; index += 1) sample.push(values[Math.floor(random() * values.length)]);
    draws.push(median(sample));
  }
  return { low: round(percentile(draws, 0.025), 3), high: round(percentile(draws, 0.975), 3), reps };
}

/** 奇偶轮切半，作为「同一场内部采样噪声」的低成本下界。 */
export function oddEvenP95RelativeDiff(values) {
  const odd = values.filter((_, index) => index % 2 === 0);
  const even = values.filter((_, index) => index % 2 === 1);
  const oddP95 = percentile(odd, 0.95);
  const evenP95 = percentile(even, 0.95);
  const larger = Math.max(oddP95, evenP95);
  return larger === 0 ? 0 : Math.abs(oddP95 - evenP95) / larger;
}

export function summarizeMode(turns) {
  const wall = describeDistribution(turns.map((turn) => turn.wallMs));
  const ttft = describeDistribution(turns.map((turn) => turn.ttftMs));
  const post = describeDistribution(turns.map((turn) => turn.postMs));
  const promptTokens = describeDistribution(turns.map((turn) => turn.promptTokens));
  const completionTokens = describeDistribution(turns.map((turn) => turn.completionTokens));
  const blockChars = turns.map((turn) => turn.block.chars).filter((value) => value > 0);
  const blockPositions = turns.map((turn) => turn.block.position).filter((value) => value !== null);
  return {
    n: turns.length,
    wall,
    ttft,
    post,
    promptTokens,
    completionTokens,
    promptChars: round(mean(turns.map((turn) => turn.promptChars)), 1),
    postPerCompletionToken: round(mean(turns.map((turn) => turn.postMs / Math.max(1, turn.completionTokens))), 1),
    blockChars: blockChars.length === 0 ? 0 : round(median(blockChars), 0),
    blockPosition: blockPositions.length === 0 ? null : round(median(blockPositions), 3),
    blockTurns: blockChars.length,
  };
}

export function pairedTurnDeltas(baseTurns, activeTurns) {
  const baseByTurn = new Map(baseTurns.map((turn) => [turn.turn, turn]));
  return activeTurns
    .map((turn) => {
      const base = baseByTurn.get(turn.turn);
      if (!base) return null;
      return {
        turn: turn.turn,
        deltaMs: round(turn.wallMs - base.wallMs, 1),
        ratio: round(turn.wallMs / Math.max(1, base.wallMs), 3),
      };
    })
    .filter(Boolean);
}

export function tailConcentration(values, baselineMedian, topShare) {
  const totalExcess = values.reduce((sum, value) => sum + Math.max(0, value - baselineMedian), 0);
  const ranked = [...values].sort((a, b) => b - a);
  const count = Math.max(1, Math.ceil(values.length * topShare));
  const topExcess = ranked.slice(0, count).reduce((sum, value) => sum + Math.max(0, value - baselineMedian), 0);
  return {
    totalExcessMs: round(totalExcess, 0),
    topExcessMs: round(topExcess, 0),
    topShare: round(totalExcess === 0 ? 0 : topExcess / totalExcess, 3),
  };
}

export function summarizeRolePair(role, baseTurns, activeTurns, order) {
  const base = summarizeMode(baseTurns);
  const active = summarizeMode(activeTurns);
  const deltas = pairedTurnDeltas(baseTurns, activeTurns);
  return {
    role,
    order,
    base,
    active,
    ratios: {
      p50: round(active.wall.p50 / Math.max(1, base.wall.p50), 3),
      p95: round(active.wall.p95 / Math.max(1, base.wall.p95), 3),
      ttftP95: round(active.ttft.p95 / Math.max(1, base.ttft.p95), 3),
      postP95: round(active.post.p95 / Math.max(1, base.post.p95), 3),
      promptTokensP50: round(active.promptTokens.p50 / Math.max(1, base.promptTokens.p50), 3),
      completionTokensP50: round(active.completionTokens.p50 / Math.max(1, base.completionTokens.p50), 3),
    },
    paired: {
      n: deltas.length,
      medianDeltaMs: round(median(deltas.map((item) => item.deltaMs)), 0),
      p90DeltaMs: round(
        percentile(
          deltas.map((item) => item.deltaMs),
          0.9,
        ),
        0,
      ),
      activeSlower: deltas.filter((item) => item.deltaMs > 0).length,
    },
  };
}
