// WikiDuel — fonction serveur des parties classées.
// À la fin d'une manche classée : vérifie le chemin de chaque joueur arrivé
// auprès de Wikipédia, puis met à jour les Elo. Les joueurs ne peuvent pas écrire leur Elo eux-mêmes.
'use strict';

const { onValueWritten } = require('firebase-functions/v2/database');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();

const WIKI = 'https://fr.wikipedia.org/w/api.php';
const UA = 'WikiDuel/1.0 (https://yorickk.github.io/WikiDuel/)';
const ELO_START = 1200;
const MAX_STEPS = 60;

const norm = t => String(t || '').replace(/_/g, ' ').trim().toLowerCase();

async function wiki(params) {
  const url = WIKI + '?' + new URLSearchParams(Object.assign({ format: 'json', formatversion: '2' }, params));
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Wikipédia a répondu ' + res.status);
  return res.json();
}

// Titre canonique d'une page (suit les redirections).
async function canonical(title) {
  const j = await wiki({ action: 'query', titles: title, redirects: '1' });
  const p = j.query && j.query.pages && j.query.pages[0];
  return p && !p.missing ? p.title : null;
}

// Ensemble des articles (titres canoniques) vers lesquels pointe une page.
const linkCache = new Map();
async function linksOf(title) {
  if (linkCache.has(title)) return linkCache.get(title);
  const out = new Set();
  let cont = {};
  for (let i = 0; i < 20; i++) {
    const j = await wiki(Object.assign({
      action: 'query', titles: title, redirects: '1',
      generator: 'links', gplnamespace: '0', gpllimit: 'max'
    }, cont));
    ((j.query && j.query.pages) || []).forEach(p => { if (!p.missing) out.add(norm(p.title)); });
    if (!j.continue) break;
    cont = j.continue;
  }
  linkCache.set(title, out);
  return out;
}

// Vérifie qu'un chemin part du départ, suit uniquement des liens et finit sur la cible.
async function checkPath(path, start, target) {
  if (!Array.isArray(path) || path.length < 2) return 'chemin vide';
  if (path.length > MAX_STEPS) return 'chemin trop long';
  if (norm(path[0]) !== norm(start)) return 'mauvaise page de départ';
  const targetCanon = await canonical(target);
  if (norm(path[path.length - 1]) !== norm(targetCanon || target)) return "n'arrive pas sur la cible";
  for (let i = 0; i < path.length - 1; i++) {
    const links = await linksOf(path[i]);
    if (!links.has(norm(path[i + 1]))) return 'lien « ' + path[i + 1] + ' » absent de « ' + path[i] + ' »';
  }
  return null;
}

// Elo multijoueur : chaque paire de joueurs compte comme un duel, pondéré par 1/(n-1).
function eloDeltas(players) {
  const n = players.length;
  const deltas = {};
  players.forEach(a => {
    const k = a.games < 10 ? 40 : 20; // plus rapide pendant les 10 premières parties
    let d = 0;
    players.forEach(b => {
      if (a === b) return;
      const expected = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
      const score = a.rank < b.rank ? 1 : a.rank > b.rank ? 0 : 0.5;
      d += k * (score - expected);
    });
    deltas[a.uid] = Math.round(d / (n - 1));
  });
  return deltas;
}

exports.rateRound = onValueWritten(
  { ref: '/rooms/{code}/status', region: 'europe-west1', instance: 'wikiduel-default-rtdb' },
  async event => {
    if (event.data.after.val() !== 'done' || event.data.before.val() !== 'playing') return;
    const code = event.params.code;
    const room = (await db.ref('rooms/' + code).once('value')).val();
    if (!room || room.ranked !== true || !room.round) return;
    const round = room.round;

    // Verrou : une manche n'est notée qu'une seule fois.
    const lock = await db.ref('results/' + code + '/' + round + '/state').transaction(cur => cur ? undefined : 'calcul');
    if (!lock.committed) return;

    try {
      // Participants : joueurs dont le chemin de cette manche part bien du départ.
      const entries = Object.keys(room.players || {})
        .map(uid => Object.assign({ uid }, room.players[uid]))
        .filter(p => Array.isArray(p.path) && norm(p.path[0]) === norm(room.start));

      const verdicts = {};
      for (const p of entries) {
        if (!p.finishedAt) { verdicts[p.uid] = p.gaveUp ? 'abandon' : 'pas arrivé'; continue; }
        const err = await checkPath(p.path, room.start, room.target);
        verdicts[p.uid] = err ? 'invalide : ' + err : 'ok';
      }

      const winners = entries.filter(p => verdicts[p.uid] === 'ok').sort((a, b) => a.finishedAt - b.finishedAt);
      if (entries.length < 2 || winners.length === 0) {
        await db.ref('results/' + code + '/' + round).set({ state: 'non classée', reason: entries.length < 2 ? 'moins de 2 joueurs' : 'personne n\'est arrivé', verdicts });
        return;
      }

      // Rang : arrivés valides dans l'ordre d'arrivée, puis tous les autres à égalité.
      const ranks = {};
      winners.forEach((p, i) => { ranks[p.uid] = i + 1; });
      const userSnaps = await Promise.all(entries.map(p => db.ref('users/' + p.uid).once('value')));
      const rated = entries.map((p, i) => {
        const u = userSnaps[i].val() || {};
        return { uid: p.uid, name: u.name || p.name, elo: u.elo || ELO_START, games: u.games || 0, wins: u.wins || 0, rank: ranks[p.uid] || winners.length + 1 };
      });
      const deltas = eloDeltas(rated);

      const updates = {};
      const changes = {};
      rated.forEach(p => {
        const after = Math.max(100, p.elo + deltas[p.uid]);
        updates['users/' + p.uid + '/elo'] = after;
        updates['users/' + p.uid + '/games'] = p.games + 1;
        updates['users/' + p.uid + '/wins'] = p.wins + (p.rank === 1 ? 1 : 0);
        if (!userSnaps[rated.indexOf(p)].child('name').exists()) updates['users/' + p.uid + '/name'] = String(p.name || 'Joueur').slice(0, 16);
        changes[p.uid] = { before: p.elo, after, delta: after - p.elo, rank: p.rank };
      });
      updates['results/' + code + '/' + round] = { state: 'classée', changes, verdicts, at: admin.database.ServerValue.TIMESTAMP };
      await db.ref().update(updates);
      logger.info('Manche notée', { code, round, changes });
    } catch (e) {
      logger.error('Échec de la notation', { code, round, error: e.message });
      await db.ref('results/' + code + '/' + round).set({ state: 'erreur', reason: e.message });
    }
  }
);
