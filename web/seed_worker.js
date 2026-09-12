'use strict';

const UINT32_SPACE = 0x100000000;

function xorshift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

function buildChoiceTrie(choiceVariants) {
  const root = { n: null, children: new Map(), terminal: false };
  for (const choices of choiceVariants) {
    let node = root;
    for (const choice of choices ?? []) {
      if (node.n === null) node.n = Number(choice.n);
      if (node.n !== Number(choice.n)) throw new Error('choice variants have inconsistent depth');
      const j = Number(choice.j);
      if (!node.children.has(j)) node.children.set(j, { n: null, children: new Map(), terminal: false });
      node = node.children.get(j);
    }
    node.terminal = true;
  }
  return root;
}

function matchesChoiceTrie(seed, trie) {
  let state = Number(seed) >>> 0;
  let node = trie;
  while (node) {
    if (node.terminal) return true;
    if (node.n === null) return false;
    const mapped = Math.floor((state * node.n) / UINT32_SPACE);
    node = node.children.get(mapped);
    if (!node) return false;
    state = xorshift32(state);
  }
  return false;
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== 'scan') return;
  const variants = Array.isArray(message.choiceVariants) && message.choiceVariants.length
    ? message.choiceVariants
    : [Array.isArray(message.choices) ? message.choices : []];
  const trie = buildChoiceTrie(variants);
  const start = Math.max(0, Math.trunc(Number(message.start ?? 0)));
  const end = Math.min(UINT32_SPACE, Math.trunc(Number(message.end ?? UINT32_SPACE)));
  const maxMatches = Math.max(1, Math.trunc(Number(message.maxMatches ?? 32)));
  const found = [];
  let scanned = 0;
  for (let candidate = start; candidate < end; candidate += 1) {
    scanned += 1;
    if (matchesChoiceTrie(candidate, trie)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({ type: 'done', taskId: message.taskId, start, end, scanned, found });
};
