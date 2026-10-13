// Builds the gift assignments.
// Rules: each person gives to exactly 2 different people (never themselves),
// and each person receives from exactly 2 people, so the spread is perfectly even.
const crypto = require('crypto');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Random permutation p of indices 0..n-1 where p[i] is not in forbidden[i].
function randomPermutation(n, forbidden) {
  for (let attempt = 0; attempt < 100000; attempt++) {
    const p = shuffle([...Array(n).keys()]);
    if (p.every((v, i) => !forbidden[i].has(v))) return p;
  }
  return null;
}

function makeDraw(ids) {
  const n = ids.length;
  if (n < 3) throw new Error('You need at least 3 people so everyone can draw 2 different names.');
  for (let attempt = 0; attempt < 1000; attempt++) {
    const first = randomPermutation(n, ids.map((_, i) => new Set([i])));
    if (!first) continue;
    const second = randomPermutation(n, ids.map((_, i) => new Set([i, first[i]])));
    if (!second) continue;
    const result = {};
    ids.forEach((id, i) => { result[id] = shuffle([ids[first[i]], ids[second[i]]]); });
    validate(ids, result);
    return result;
  }
  throw new Error('Could not build a draw. Please try again.');
}

function validate(ids, result) {
  const received = Object.fromEntries(ids.map(id => [id, 0]));
  for (const id of ids) {
    const [a, b] = result[id];
    if (a === id || b === id || a === b) throw new Error('Invalid draw');
    received[a]++; received[b]++;
  }
  if (!ids.every(id => received[id] === 2)) throw new Error('Uneven draw');
}

module.exports = { makeDraw, validate };
