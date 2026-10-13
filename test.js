const { makeDraw, validate } = require('./draw');
for (let n = 3; n <= 15; n++) {
  const ids = Array.from({ length: n }, (_, i) => 'p' + i);
  for (let t = 0; t < 2000; t++) validate(ids, makeDraw(ids));
}
let threw = false; try { makeDraw(['a', 'b']); } catch { threw = true; }
if (!threw) throw new Error('should reject < 3 people');
console.log('All draw tests passed (3-15 people, 2000 draws each).');
