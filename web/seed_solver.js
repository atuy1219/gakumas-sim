import { UINT32_SPACE, seedMatchesChoices, xorshift32 } from "./simulation.js";

// Each high bit of XorShift^step(seed) is a linear equation in the seed's
// 32 bits over GF(2). A five-bit prefix covers a superset of an exact
// Fisher-Yates interval; the final integer check removes boundary extras.
const PREFIX_BITS = 5;
const PREFIX_WIDTH = 2 ** (32 - PREFIX_BITS);
const ENUMERATE_RANK = 28; // At most 16 assignments remain at each leaf.
const rowsByStep = [];
let columns = Uint32Array.from({ length: 32 }, (_, bit) => 2 ** bit);

function getRows(step) {
  while (rowsByStep.length <= step) {
    const rows = new Uint32Array(PREFIX_BITS);
    for (let high = 0; high < PREFIX_BITS; high += 1) {
      for (let bit = 0; bit < 32; bit += 1) {
        rows[high] |= ((columns[bit] >>> (31 - high)) & 1) << bit;
      }
    }
    rowsByStep.push(rows);
    columns = columns.map(xorshift32);
  }
  return rowsByStep[step];
}

function parity(value) {
  let x = value;
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  return (0x6996 >>> (x & 15)) & 1;
}

/**
 * Enumerate every matching seed in [start,end), or explicitly report a limit.
 * Prefix buckets partition the state space, so each assignment is visited once
 * per variant. No probabilistic pruning or solver dependency is involved.
 */
export function solveSeedVariants(variants, {
  start = 0,
  end = UINT32_SPACE,
  maxMatches = 100,
  accept = () => true,
} = {}) {
  const lo = Math.max(0, Math.trunc(Number(start)));
  const hi = Math.min(UINT32_SPACE, Math.trunc(Number(end)));
  const limit = Math.max(1, Math.trunc(Number(maxMatches)));
  const found = new Set();
  const stats = { branches: 0, candidates: 0, variants: 0 };
  let complete = true;

  for (const choices of variants) {
    if (hi <= lo) break;
    const rows = choices.map((_, step) => getRows(step));
    const basis = new Uint32Array(32);
    const values = new Uint8Array(32);
    const pivots = [];

    function addEquation(maskInput, valueInput) {
      let mask = maskInput >>> 0;
      let value = valueInput;
      while (mask) {
        const bit = 31 - Math.clz32(mask);
        if (basis[bit]) {
          mask = (mask ^ basis[bit]) >>> 0;
          value ^= values[bit];
        } else {
          basis[bit] = mask;
          values[bit] = value;
          pivots.push(bit);
          return true;
        }
      }
      return value === 0;
    }

    function undo(mark) {
      while (pivots.length > mark) basis[pivots.pop()] = 0;
    }

    function enumerateAssignments() {
      const free = [];
      for (let bit = 0; bit < 32; bit += 1) if (!basis[bit]) free.push(bit);
      function assign(index, seed) {
        if (!complete) return;
        if (index < free.length) {
          assign(index + 1, seed);
          assign(index + 1, (seed ^ (1 << free[index])) >>> 0);
          return;
        }
        let candidate = seed;
        // Every pivot is the highest bit of its row: solve from low to high.
        for (let bit = 0; bit < 32; bit += 1) {
          if (basis[bit] && (parity(basis[bit] & candidate) ^ values[bit])) {
            candidate = (candidate ^ (1 << bit)) >>> 0;
          }
        }
        if (candidate < lo || candidate >= hi) return;
        stats.candidates += 1;
        if (!seedMatchesChoices(candidate, choices) || found.has(candidate) || !accept(candidate)) return;
        found.add(candidate);
        if (found.size >= limit) complete = false;
      }
      assign(0, 0);
    }

    function search(step) {
      if (!complete) return;
      stats.branches += 1;
      if (pivots.length >= ENUMERATE_RANK || step === choices.length) {
        enumerateAssignments();
        return;
      }
      const { n, j } = choices[step];
      const lower = Math.max(step === 0 ? lo : 0, Math.ceil(j * UINT32_SPACE / n));
      const upper = Math.min(step === 0 ? hi : UINT32_SPACE, Math.ceil((j + 1) * UINT32_SPACE / n));
      if (upper <= lower) return;
      const lastPrefix = Math.floor((upper - 1) / PREFIX_WIDTH);
      for (let prefix = Math.floor(lower / PREFIX_WIDTH); prefix <= lastPrefix && complete; prefix += 1) {
        const mark = pivots.length;
        let consistent = true;
        for (let high = 0; high < PREFIX_BITS; high += 1) {
          if (!addEquation(rows[step][high], (prefix >>> (PREFIX_BITS - high - 1)) & 1)) {
            consistent = false;
            break;
          }
        }
        if (consistent) search(step + 1);
        undo(mark);
      }
    }

    // Exact dyadic blocks also constrain the seed itself. Besides preserving
    // [start,end) semantics, this avoids enumerating assignments outside a
    // small requested range when there are only one or two shuffle choices.
    for (let lower = lo; lower < hi && complete;) {
      let size = lower === 0 ? UINT32_SPACE : (lower & -lower) >>> 0;
      while (size > hi - lower) size /= 2;
      const freeBits = Math.log2(size);
      for (let bit = 31; bit >= freeBits; bit -= 1) {
        addEquation((2 ** bit) >>> 0, (lower >>> bit) & 1);
      }
      search(0);
      undo(0);
      lower += size;
    }
    stats.variants += 1;
    if (!complete) break;
  }
  return { found: [...found].sort((a, b) => a - b), complete, stats };
}
