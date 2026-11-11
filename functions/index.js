// WikiDuel — fonction serveur des parties classées.
// À la fin d'une manche classée : vérifie le chemin de chaque joueur arrivé
// auprès de Wikipédia, puis met à jour les Elo. Les joueurs ne peuvent pas écrire leur Elo eux-mêmes.
'use strict';

const { onValueWritten, onValueCreated } = require('firebase-functions/v2/database');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
let db = null; // connecté au premier appel (l'adresse de la base est fournie par le cloud)

const WIKI = 'https://fr.wikipedia.org/w/api.php';
const UA = 'WikiDuel/1.0 (https://wikiduel.ch)';
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

/* ===================== File d'attente classée ===================== */

const DB_OPTS = { region: 'europe-west1', instance: 'wikiduel-default-rtdb' };
const QUEUE_MAX_AGE = 15 * 60 * 1000; // une attente plus vieille est ignorée
const COUNTDOWN = 6000;               // délai avant le départ, pour lire la cible

// Articles de secours si la liste des « articles vitaux » est inaccessible.
const FALLBACK = [
  'Tour Eiffel', 'Napoléon Ier', 'Chat', 'Pizza', 'Lune', 'Football', 'Japon', 'Volcan', 'Chocolat',
  'Égypte antique', 'Jazz', 'Révolution française', 'Soleil', 'Requin', 'Internet', 'Léonard de Vinci',
  'Jeux olympiques', 'Fromage', 'Brésil', 'Café', 'Vin', 'Tennis', 'Antarctique', 'Albert Einstein',
  'Cheval', 'Rome', 'Abeille', 'Train', 'Tomate', 'Guitare', 'Charles de Gaulle', 'Everest',
  'Cinéma', 'Pablo Picasso', 'Australie', 'Électricité', 'Moyen Âge', 'Pharaon', 'Opéra', 'Mexique',
  'Lion', 'Bouddhisme', 'Jules César', 'Titanic', 'Robot', 'Pétrole', 'Inde', 'Islande', 'Paris', 'Échecs'
];

// Même réserve que le téléphone : les ~1000 articles vitaux de Wikipédia FR (gardée 24 h).
let pool = null;
async function getPool() {
  if (pool && pool.t > Date.now() - 864e5) return pool.list;
  const list = [];
  try {
    let cont = {};
    for (let i = 0; i < 10; i++) {
      const j = await wiki(Object.assign({ action: 'query', prop: 'links', plnamespace: '0', pllimit: 'max', titles: 'Wikipédia:Articles vitaux' }, cont));
      ((j.query.pages[0] && j.query.pages[0].links) || []).forEach(l => list.push(l.title));
      if (!j.continue) break;
      cont = j.continue;
    }
  } catch (e) { logger.warn('Réserve d’articles indisponible', { error: e.message }); }
  pool = { t: Date.now(), list: list.length > 200 ? Array.from(new Set(list.concat(FALLBACK))) : FALLBACK };
  return pool.list;
}

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = ''; for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c;
}

// Un joueur entre dans la file : on l'apparie avec l'adversaire d'Elo le plus proche.
exports.matchmake = onValueCreated(Object.assign({ ref: '/queue/{uid}' }, DB_OPTS), async event => {
  if (!db) db = admin.database();
  const me = event.params.uid;

  // Elo officiel (lu côté serveur, le téléphone ne peut pas le choisir).
  const myElo = (await db.ref('users/' + me + '/elo').once('value')).val() || ELO_START;
  // (renvoyer null sur un cache vide force la relecture du serveur, sans recréer l'entrée)
  await db.ref('queue/' + me).transaction(cur => cur === null ? null : Object.assign(cur, { elo: myElo }));

  const now = Date.now();
  let pair = null;
  const res = await db.ref('queue').transaction(q => {
    pair = null;
    if (q === null) return null; // cache vide : on force une relecture du serveur
    if (!q[me]) return;          // déjà apparié ou parti
    const others = Object.keys(q).filter(id => id !== me && q[id] && now - (q[id].at || 0) < QUEUE_MAX_AGE);
    if (!others.length) return;  // personne : on attend le prochain joueur
    others.sort((a, b) => Math.abs((q[a].elo || ELO_START) - myElo) - Math.abs((q[b].elo || ELO_START) - myElo) || (q[a].at || 0) - (q[b].at || 0));
    const opp = others[0];
    pair = [Object.assign({ uid: me }, q[me]), Object.assign({ uid: opp }, q[opp])];
    delete q[me]; delete q[opp];
    return q;
  });
  if (!res.committed || !pair) return;

  // Le serveur tire les pages et crée le salon : aucun joueur n'est hôte.
  const list = await getPool();
  const start = list[Math.floor(Math.random() * list.length)];
  let target; do { target = list[Math.floor(Math.random() * list.length)]; } while (target === start);

  let code = null;
  for (let i = 0; i < 8 && !code; i++) {
    const c = makeCode();
    const r = await db.ref('rooms/' + c).transaction(cur => cur ? undefined : { hostId: 'server' });
    if (r.committed) code = c;
  }
  if (!code) { logger.error('Aucun code de salon libre'); return; }

  const players = {};
  pair.forEach(p => { players[p.uid] = { name: String(p.name || 'Joueur').slice(0, 16), joinedAt: now, online: false, path: [start] }; });
  const updates = {};
  updates['rooms/' + code] = {
    hostId: 'server', ranked: true, status: 'playing', round: 1, start, target,
    startedAt: now + COUNTDOWN, createdAt: now, players
  };
  pair.forEach(p => { updates['matches/' + p.uid] = { code, at: now }; });
  await db.ref().update(updates);
  logger.info('Partie classée créée', { code, players: pair.map(p => p.uid + ':' + (p.elo || ELO_START)) });
});

/* ===================== Notation des manches ===================== */

exports.rateRound = onValueWritten(
  { ref: '/rooms/{code}/status', region: 'europe-west1', instance: 'wikiduel-default-rtdb' },
  async event => {
    if (event.data.after.val() !== 'done' || event.data.before.val() !== 'playing') return;
    if (!db) db = admin.database();
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
