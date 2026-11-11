// Prépare les défis du jour : vérifie les articles sur Wikipédia FR, puis écrit daily-seed.json
// (à importer avec : firebase database:update /daily tools/daily-seed.json).
// Usage : node tools/make-daily.js 2026-11-11
'use strict';
const fs = require('fs');
const path = require('path');

const first = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(first || '')) { console.error('Date de début attendue : AAAA-MM-JJ'); process.exit(1); }
const pairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-pairs.json'), 'utf8'));

// Minuit à Zurich, en millisecondes UTC (gère heure d'été / d'hiver).
function zurichMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
  const h = +parts.find(p => p.type === 'hour').value; // heure de Zurich à 00:00 UTC
  return guess - h * 3600 * 1000;
}

async function canonical(titles) {
  const map = {}, missing = new Set();
  for (let i = 0; i < titles.length; i += 50) { // l'API accepte 50 titres par requête
    const url = 'https://fr.wikipedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1', titles: titles.slice(i, i + 50).join('|')
    });
    const j = await (await fetch(url, { headers: { 'User-Agent': 'WikiDuel/1.0 (https://wikiduel.ch)' } })).json();
    if (!j.query) throw new Error('Réponse Wikipédia inattendue : ' + JSON.stringify(j).slice(0, 200));
    (j.query.normalized || []).forEach(n => { map[n.from] = n.to; });
    (j.query.redirects || []).forEach(r => { map[r.from] = r.to; });
    (j.query.pages || []).filter(p => p.missing).forEach(p => missing.add(p.title));
  }
  return t => { const c = map[map[t] || t] || map[t] || t; return missing.has(c) ? null : c; };
}

(async () => {
  const all = Array.from(new Set(pairs.flat()));
  const resolve = await canonical(all);
  const [y, m, d] = first.split('-').map(Number);
  const seed = {};
  let errors = 0;
  pairs.forEach(([a, b], i) => {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    const key = day.toISOString().slice(0, 10);
    const start = resolve(a), target = resolve(b);
    if (!start || !target) { console.error('Article introuvable :', !start ? a : b); errors++; return; }
    if (start !== a || target !== b) console.log('Redirection :', a, '→', start, '|', b, '→', target);
    const opensAt = zurichMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    const next = new Date(day.getTime() + 864e5);
    const closesAt = zurichMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
    seed[key] = { start, target, opensAt, closesAt, n: i + 1 };
  });
  if (errors) process.exit(1);
  fs.writeFileSync(path.join(__dirname, 'daily-seed.json'), JSON.stringify(seed, null, 2));
  const keys = Object.keys(seed);
  console.log(keys.length + ' défis, du ' + keys[0] + ' au ' + keys[keys.length - 1]);
  console.log('Exemple :', keys[0], seed[keys[0]]);
})();
