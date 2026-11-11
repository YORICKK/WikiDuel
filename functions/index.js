// WikiDuel — fonction serveur des parties classées.
// À la fin d'une manche classée : vérifie le chemin de chaque joueur arrivé
// auprès de Wikipédia, puis met à jour les Elo. Les joueurs ne peuvent pas écrire leur Elo eux-mêmes.
'use strict';

const { onValueWritten, onValueCreated } = require('firebase-functions/v2/database');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
  // En classé, le chemin de chaque joueur est privé (paths/<code>/<uid>) : le salon ne montre que le nombre de clics.
  pair.forEach(p => { players[p.uid] = { name: String(p.name || 'Joueur').slice(0, 16), joinedAt: now, online: false, clicks: 0 }; });
  const updates = {};
  updates['rooms/' + code] = {
    hostId: 'server', ranked: true, status: 'playing', round: 1, start, target,
    startedAt: now + COUNTDOWN, createdAt: now, players
  };
  pair.forEach(p => { updates['matches/' + p.uid] = { code, at: now }; });
  await db.ref().update(updates);
  logger.info('Partie classée créée', { code, players: pair.map(p => p.uid + ':' + (p.elo || ELO_START)) });
});

/* ===================== Fin de manche : notation + historique ===================== */

const HISTORY_MAX = 200; // parties gardées par joueur

// Archive la manche dans history/<uid> pour chaque participant (lisible seulement par les comptes premium).
async function archiveRound(code, room, entries, extra) {
  const now = Date.now();
  const updates = {};
  entries.forEach(p => {
    const others = entries.filter(o => o.uid !== p.uid).map(o => String(o.name || 'Joueur').slice(0, 16));
    const ch = extra.changes && extra.changes[p.uid];
    const key = db.ref('history/' + p.uid).push().key;
    updates['history/' + p.uid + '/' + key] = {
      at: now, mode: room.ranked ? 'classée' : 'amis', code, round: room.round,
      start: room.start, target: room.target,
      won: extra.winnerId === p.uid, finished: !!p.finishedAt, gaveUp: !!p.gaveUp,
      clicks: Math.max(0, p.path.length - 1),
      time: p.finishedAt ? Math.max(0, p.finishedAt - room.startedAt) : null,
      path: p.path.slice(0, MAX_STEPS), opponents: others,
      verdict: (extra.verdicts && extra.verdicts[p.uid]) || null,
      eloDelta: ch ? ch.delta : null, eloAfter: ch ? ch.after : null
    };
  });
  await db.ref().update(updates);
  await Promise.all(entries.map(p => pruneHistory(p.uid)));
}

// Ne garde que les HISTORY_MAX parties les plus récentes d'un joueur.
async function pruneHistory(uid) {
  const snap = await db.ref('history/' + uid).orderByChild('at').once('value');
  const n = snap.numChildren();
  if (n <= HISTORY_MAX) return;
  const drop = {};
  let i = 0;
  snap.forEach(c => { if (i++ < n - HISTORY_MAX) drop[c.key] = null; });
  await db.ref('history/' + uid).update(drop);
}

// Les parties solo sont écrites par le téléphone : on applique la même limite de 200.
exports.pruneSoloHistory = onValueCreated(Object.assign({ ref: '/history/{uid}/{key}' }, DB_OPTS), async event => {
  if (!db) db = admin.database();
  const v = event.data.val();
  if (!v || v.mode !== 'solo') return;
  await pruneHistory(event.params.uid);
});

exports.rateRound = onValueWritten(
  { ref: '/rooms/{code}/status', region: 'europe-west1', instance: 'wikiduel-default-rtdb' },
  async event => {
    if (event.data.after.val() !== 'done' || event.data.before.val() !== 'playing') return;
    if (!db) db = admin.database();
    const code = event.params.code;
    const room = (await db.ref('rooms/' + code).once('value')).val();
    if (!room || !room.round) return;
    const round = room.round;

    // Verrou : une manche n'est traitée qu'une seule fois.
    const lock = await db.ref('results/' + code + '/' + round + '/state').transaction(cur => cur ? undefined : 'calcul');
    if (!lock.committed) return;

    try {
      // Chemins : privés en classé (paths/), dans le salon entre amis.
      const privatePaths = room.ranked ? ((await db.ref('paths/' + code).once('value')).val() || {}) : {};
      const entries = Object.keys(room.players || {})
        .map(uid => {
          const p = room.players[uid];
          const path = room.ranked ? (Array.isArray(privatePaths[uid]) ? privatePaths[uid] : [room.start]) : p.path;
          return Object.assign({ uid }, p, { path });
        })
        // Participants : chemin de cette manche (il part du départ).
        .filter(p => Array.isArray(p.path) && norm(p.path[0]) === norm(room.start));

      if (!room.ranked) {
        await archiveRound(code, room, entries, { winnerId: room.winnerId });
        await db.ref('results/' + code + '/' + round).set({ state: 'archivée' });
        return;
      }

      const paths = {};
      entries.forEach(p => { paths[p.uid] = p.path; });
      const verdicts = {};
      for (const p of entries) {
        if (!p.finishedAt) { verdicts[p.uid] = p.gaveUp ? 'abandon' : 'pas arrivé'; continue; }
        const err = await checkPath(p.path, room.start, room.target);
        verdicts[p.uid] = err ? 'invalide : ' + err : 'ok';
      }

      const winners = entries.filter(p => verdicts[p.uid] === 'ok').sort((a, b) => a.finishedAt - b.finishedAt);
      if (entries.length < 2 || winners.length === 0) {
        await db.ref('results/' + code + '/' + round).set({ state: 'non classée', reason: entries.length < 2 ? 'moins de 2 joueurs' : 'personne n\'est arrivé', verdicts, paths });
        await archiveRound(code, room, entries, { winnerId: null, verdicts });
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
      // Les chemins sont révélés à la fin, via les résultats.
      updates['results/' + code + '/' + round] = { state: 'classée', changes, verdicts, paths, at: admin.database.ServerValue.TIMESTAMP };
      await db.ref().update(updates);
      logger.info('Manche notée', { code, round, changes });
      await archiveRound(code, room, entries, { winnerId: winners[0].uid, verdicts, changes });
    } catch (e) {
      logger.error('Échec de la notation', { code, round, error: e.message });
      await db.ref('results/' + code + '/' + round).set({ state: 'erreur', reason: e.message });
    }
  }
);

/* ===================== Défi du jour ===================== */
// Le temps est mesuré par le serveur (startedAt / finishedAt = horodatage Firebase),
// le chemin est vérifié auprès de Wikipédia, puis le score entre dans dailyScores/<date>.
const DAILY_COUNTDOWN = 3000; // le compte à rebours de 3 s n'est pas compté

exports.verifyDaily = onValueCreated(Object.assign({ ref: '/dailyRuns/{date}/{uid}/finishedAt' }, DB_OPTS), async event => {
  if (!db) db = admin.database();
  const { date, uid } = event.params;
  const [daySnap, runSnap, userSnap] = await Promise.all([
    db.ref('daily/' + date).once('value'), db.ref('dailyRuns/' + date + '/' + uid).once('value'), db.ref('users/' + uid).once('value')
  ]);
  const day = daySnap.val(), run = runSnap.val();
  if (!day || !run || !run.startedAt || !run.finishedAt) return;
  const path = Array.isArray(run.path) ? run.path : [];
  let err;
  try { err = await checkPath(path, day.start, day.target); }
  catch (e) { err = 'vérification impossible'; logger.error('Défi du jour : vérification échouée', { date, uid, error: e.message }); }
  const u = userSnap.val() || {};
  await db.ref('dailyScores/' + date + '/' + uid).set({
    name: String(run.name || u.name || 'Joueur').slice(0, 16),
    time: Math.max(0, run.finishedAt - run.startedAt - DAILY_COUNTDOWN),
    clicks: Math.max(0, path.length - 1),
    valid: !err, reason: err || null,
    premium: u.premium === true,
    at: run.finishedAt
  });
});

/* ===================== Aperçus de partage (WhatsApp, etc.) ===================== */
// WhatsApp ne lit pas le JavaScript : /defi et /jour renvoient une page avec les balises
// d'aperçu (titre, texte, image) puis redirigent aussitôt vers le jeu.
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(ms, hundredths) {
  ms = Math.max(0, Number(ms) || 0);
  const s = Math.floor(ms / 1000);
  const frac = hundredths ? String(Math.floor((ms % 1000) / 10)).padStart(2, '0') : String(Math.floor((ms % 1000) / 100));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ',' + frac;
}

exports.sharePage = onRequest({ region: 'europe-west1' }, (req, res) => {
  const q = req.query || {};
  const clip = (v, n) => String(v || '').slice(0, n);
  const name = clip(q.n, 16) || 'Un ami';
  const start = clip(q.d, 200), target = clip(q.a, 200);
  const clicks = parseInt(q.c, 10), time = parseInt(q.t, 10);
  const daily = req.path.indexOf('/jour') === 0;
  // Défi du jour : centièmes, comme au classement du jour.
  const score = clicks >= 0 && time >= 0 ? clicks + ' clic' + (clicks > 1 ? 's' : '') + ' et ' + fmtTime(time, daily) : '';

  let title, desc, target_url;
  if (daily) {
    title = 'Défi du jour WikiDuel' + (q.no ? ' n°' + clip(q.no, 4) : '');
    // Le parcours du jour reste secret : on ne montre que le score à battre.
    desc = score
      ? name + ' a réussi le défi du jour en ' + score + '. Parcours mystère, une seule tentative : à toi de jouer !'
      : 'Un parcours Wikipédia mystère par jour, le même pour tout le monde. À toi de jouer !';
    target_url = '/';
  } else {
    title = name + ' te défie sur WikiDuel';
    desc = start && target
      ? '« ' + start + ' » → « ' + target + ' »' + (score ? ' en ' + score : '') + ', uniquement avec les liens de Wikipédia. Tu fais mieux ?'
      : 'Relie deux pages Wikipédia en cliquant uniquement sur les liens. Tu fais mieux ?';
    const p = new URLSearchParams({ defi: '1', d: start, a: target, c: String(q.c || ''), t: String(q.t || ''), n: name });
    target_url = '/?' + p.toString();
  }
  const pageUrl = SITE + req.originalUrl;
  res.set('Cache-Control', 'public, max-age=300');
  res.status(200).send('<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escHtml(title) + '</title>' +
    '<meta name="description" content="' + escHtml(desc) + '">' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:site_name" content="WikiDuel">' +
    '<meta property="og:title" content="' + escHtml(title) + '">' +
    '<meta property="og:description" content="' + escHtml(desc) + '">' +
    '<meta property="og:url" content="' + escHtml(pageUrl) + '">' +
    '<meta property="og:image" content="' + SITE + '/og.png">' +
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
    '<meta property="og:image:alt" content="WikiDuel, la course sur Wikipédia">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta http-equiv="refresh" content="0;url=' + escHtml(target_url) + '">' +
    '<script>location.replace(' + JSON.stringify(target_url) + ')</script>' +
    '</head><body><p><a href="' + escHtml(target_url) + '">Ouvrir WikiDuel</a></p></body></html>');
});

/* ===================== Erreurs des joueurs ===================== */
// Chaque erreur envoyée par un téléphone (errors/<id>) est réécrite dans les journaux Google Cloud
// sous forme d'erreur : elle apparaît dans Error Reporting, qui peut envoyer une alerte par e-mail.
exports.logClientError = onValueCreated(Object.assign({ ref: '/errors/{id}' }, DB_OPTS), async event => {
  const e = event.data.val() || {};
  const err = new Error('[Joueur] ' + String(e.msg || 'Erreur inconnue'));
  err.stack = '[Joueur] ' + String(e.msg || '') + '\n' + (e.stack || ('    at ' + (e.src || 'page') + ':' + (e.line || 0) + ':' + (e.col || 0)));
  logger.error(err, { page: e.page, ecran: e.screen, navigateur: e.ua, uid: e.uid, id: event.params.id });
});

/* ===================== Suppression de compte ===================== */
// Demandée depuis le pied de page du jeu (confirmation « SUPPRIMER »). Efface toutes les données
// du joueur, sauf les justificatifs d'achat (10 ans, obligation légale), puis le compte de connexion.
exports.deleteAccount = onCall({ region: 'europe-west1' }, async req => {
  if (!db) db = admin.database();
  if (!req.auth) throw new HttpsError('unauthenticated', 'Aucun compte connecté.');
  if (!req.data || req.data.confirm !== 'SUPPRIMER') throw new HttpsError('invalid-argument', 'Confirmation manquante.');
  const uid = req.auth.uid;
  const upd = {
    ['users/' + uid]: null, ['history/' + uid]: null, ['queue/' + uid]: null, ['matches/' + uid]: null
  };
  // Défis du jour : tentatives et scores, tous les jours.
  const [runs, scores, rooms] = await Promise.all(['dailyRuns', 'dailyScores', 'rooms'].map(p => db.ref(p).once('value')));
  runs.forEach(d => { if (d.hasChild(uid)) upd['dailyRuns/' + d.key + '/' + uid] = null; });
  scores.forEach(d => { if (d.hasChild(uid)) upd['dailyScores/' + d.key + '/' + uid] = null; });
  // Salons : on retire le joueur ; un salon entre amis dont il est l'hôte est supprimé.
  rooms.forEach(r => {
    const v = r.val() || {};
    if (v.hostId === uid) { upd['rooms/' + r.key] = null; upd['results/' + r.key] = null; upd['paths/' + r.key] = null; }
    else if (v.players && v.players[uid]) { upd['rooms/' + r.key + '/players/' + uid] = null; upd['paths/' + r.key + '/' + uid] = null; }
  });
  await db.ref().update(upd);
  await admin.auth().deleteUser(uid).catch(e => { if (e.code !== 'auth/user-not-found') throw e; });
  logger.info('Compte supprimé à la demande du joueur', { uid, elements: Object.keys(upd).length });
  return { ok: true };
});

/* ===================== Nettoyage quotidien (politique de confidentialité) ===================== */
// Salons, résultats et chemins : supprimés après 30 jours. File d'attente et appariements : après 1 jour.
exports.cleanup = onSchedule({ schedule: 'every day 04:00', timeZone: 'Europe/Zurich', region: 'europe-west1' }, async () => {
  if (!db) db = admin.database();
  const now = Date.now();
  const roomCutoff = now - 30 * 864e5, dayCutoff = now - 864e5;
  const upd = {};
  const old = await db.ref('rooms').orderByChild('createdAt').endAt(roomCutoff).limitToFirst(2000).once('value');
  old.forEach(c => { upd['rooms/' + c.key] = null; upd['results/' + c.key] = null; upd['paths/' + c.key] = null; });
  // Résultats ou chemins dont le salon a déjà disparu.
  const [roomKeys, res, paths, queue, matches, errs] = await Promise.all(['rooms', 'results', 'paths', 'queue', 'matches', 'errors']
    .map(p => db.ref(p).once('value')));
  // Rapports d'erreurs : gardés 30 jours.
  errs.forEach(c => { if (((c.val() || {}).at || 0) < roomCutoff) upd['errors/' + c.key] = null; });
  const alive = new Set(); roomKeys.forEach(c => { if (!(('rooms/' + c.key) in upd)) alive.add(c.key); });
  res.forEach(c => { if (!alive.has(c.key)) upd['results/' + c.key] = null; });
  paths.forEach(c => { if (!alive.has(c.key)) upd['paths/' + c.key] = null; });
  queue.forEach(c => { if (((c.val() || {}).at || 0) < dayCutoff) upd['queue/' + c.key] = null; });
  matches.forEach(c => { if (((c.val() || {}).at || 0) < dayCutoff) upd['matches/' + c.key] = null; });
  const n = Object.keys(upd).length;
  if (n) await db.ref().update(upd);
  logger.info('Nettoyage quotidien', { suppressions: n });
});

/* ===================== WikiDuel+ : paiement Stripe ===================== */
// Les clés Stripe ne sont jamais dans le code : ce sont des secrets Firebase
// (firebase functions:secrets:set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const SITE = 'https://wikiduel.ch';
const PREMIUM_PRICE = 200;          // en centimes : 2,00 CHF, paiement unique
const PREMIUM_CURRENCY = 'chf';

// .trim() : un espace ou un retour à la ligne collé avec la clé suffit à tout faire échouer.
function stripeClient() { return require('stripe')(STRIPE_SECRET_KEY.value().trim()); }

// Appelée par le jeu : crée une page de paiement Stripe pour le joueur connecté avec Google.
exports.createCheckout = onCall({ region: 'europe-west1', secrets: [STRIPE_SECRET_KEY] }, async req => {
  if (!db) db = admin.database();
  const auth = req.auth;
  if (!auth || auth.token.firebase.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Connecte-toi avec Google pour acheter WikiDuel+.');
  }
  const uid = auth.uid;
  if ((await db.ref('users/' + uid + '/premium').once('value')).val() === true) {
    throw new HttpsError('already-exists', 'Ton compte est déjà WikiDuel+.');
  }
  const session = await stripeClient().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: PREMIUM_CURRENCY, unit_amount: PREMIUM_PRICE,
        product_data: { name: 'WikiDuel+', description: 'Historique, statistiques, diamant et animation de victoire. Paiement unique, à vie.' }
      }
    }],
    client_reference_id: uid,
    metadata: { uid },
    payment_intent_data: { metadata: { uid } }, // retrouve le joueur en cas de remboursement
    customer_email: auth.token.email || undefined,
    locale: 'fr',
    success_url: SITE + '/?premium=ok',
    cancel_url: SITE + '/?premium=annule'
  });
  return { url: session.url };
});

// Appelée par Stripe : seule source de vérité pour activer (ou retirer) WikiDuel+.
exports.stripeWebhook = onRequest({ region: 'europe-west1', secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  if (!db) db = admin.database();
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value().trim());
  } catch (e) {
    logger.warn('Webhook Stripe refusé (signature invalide)', { error: e.message });
    res.status(400).send('Signature invalide');
    return;
  }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      const uid = (s.metadata && s.metadata.uid) || s.client_reference_id;
      if (uid && s.payment_status === 'paid') {
        await db.ref().update({
          ['users/' + uid + '/premium']: true,
          ['purchases/' + uid + '/' + s.id]: {
            at: admin.database.ServerValue.TIMESTAMP, amount: s.amount_total, currency: s.currency,
            paymentIntent: s.payment_intent || null, livemode: !!event.livemode
          }
        });
        logger.info('WikiDuel+ activé', { uid, session: s.id, livemode: event.livemode });
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      if (charge.refunded && charge.payment_intent) {
        const pi = await stripeClient().paymentIntents.retrieve(charge.payment_intent);
        const uid = pi.metadata && pi.metadata.uid;
        if (uid) {
          await db.ref('users/' + uid + '/premium').remove();
          logger.info('WikiDuel+ retiré après remboursement', { uid });
        }
      }
    }
    res.json({ received: true });
  } catch (e) {
    logger.error('Erreur de traitement du webhook', { type: event.type, error: e.message });
    res.status(500).send('Erreur');
  }
});
