// Test automatique de WikiDuel, lancé avant chaque publication (firebase.json > hosting > predeploy).
// Il ouvre le jeu dans Chrome (ou Edge) sans fenêtre, en taille téléphone, et vérifie :
//   1. que la page démarre sans erreur JavaScript ;
//   2. qu'une partie solo se lance et charge un article Wikipédia ;
//   3. qu'un salon entre amis se crée ;
//   4. que l'écran « Mes parties et stats » s'ouvre ;
//   5. que les pages légales sont servies.
// Si un point échoue, la commande renvoie une erreur et Firebase annule la publication.
// Usage manuel : node tools/smoke-test.js   (SMOKE_ROOT=<dossier> pour tester une autre copie)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(process.env.SMOKE_ROOT || path.join(__dirname, '..'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

// Petit serveur local qui sert la copie à tester (comme Firebase Hosting, avec /cgv -> cgv.html).
function serve(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    let file = path.join(root, p);
    if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Introuvable'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

const steps = [];
function step(name, ok, detail) {
  steps.push({ name, ok, detail });
  console.log((ok ? '  OK    ' : '  ÉCHEC ') + name + (detail ? ' (' + detail + ')' : ''));
  if (!ok) throw new Error(name + (detail ? ' : ' + detail : ''));
}

(async () => {
  const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) { console.error('Test annulé : aucun Chrome ni Edge trouvé (CHROME_PATH pour en indiquer un).'); process.exit(1); }
  const server = await serve(ROOT);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  const errors = [];
  let failed = null;
  console.log('Test WikiDuel : ' + ROOT);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    page.on('pageerror', e => errors.push('Erreur JavaScript : ' + e.message));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Failed to load resource/.test(t)) return; // ressources externes (icône, etc.)
      errors.push('Console : ' + t);
    });

    // 1. Démarrage
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof uid !== 'undefined' && !!uid, { timeout: 30000 }).catch(() => {});
    const boot = await page.evaluate(() => ({
      uid: typeof uid !== 'undefined' && !!uid,
      // Ces boutons sont branchés à la toute fin du script : s'ils le sont, tout le script a tourné.
      wired: ['solo', 'create', 'join', 'premiumBtn', 'pmBuy', 'chGo', 'dPlay', 'againBtn', 'delAccBtn', 'delConfirm'].every(id => typeof document.getElementById(id).onclick === 'function'),
      home: !document.getElementById('home').hidden
    }));
    step('La page démarre', boot.home && boot.wired && errors.length === 0, errors[0] || (!boot.wired ? 'boutons non branchés : le script s’est arrêté' : ''));
    step('Connexion Firebase', boot.uid, boot.uid ? '' : 'pas de compte anonyme');

    // 2. Partie solo
    await page.evaluate(() => { document.getElementById('name').value = 'Test auto'; document.getElementById('solo').click(); });
    await page.waitForFunction(() => !document.getElementById('race').hidden && document.querySelectorAll('#artBody a.wl').length > 10, { timeout: 30000 }).catch(() => {});
    const solo = await page.evaluate(() => ({ race: !document.getElementById('race').hidden, title: document.getElementById('artTitle').textContent, links: document.querySelectorAll('#artBody a.wl').length }));
    step('Partie solo', solo.race && solo.links > 10, solo.title ? solo.title + ', ' + solo.links + ' liens' : 'article non chargé');
    await page.evaluate(() => { S.solo = null; S.me = null; S.room = null; stopTick(); show('home'); });

    // 3. Salon entre amis (créé puis fermé)
    await page.evaluate(() => document.getElementById('create').click());
    await page.waitForFunction(() => !document.getElementById('lobby').hidden, { timeout: 20000 }).catch(() => {});
    const room = await page.evaluate(async () => { const ok = !document.getElementById('lobby').hidden; const code = S.me && S.me.code; if (S.me) await leave(); return { ok, code }; });
    step('Salon entre amis', room.ok, room.code ? 'salon ' + room.code + ' créé puis fermé' : 'salon non créé');

    // 4. Écran WikiDuel+
    await page.evaluate(() => document.getElementById('premiumBtn').click());
    await page.waitForFunction(() => !document.getElementById('pmLocked').hidden || !document.getElementById('pmContent').hidden, { timeout: 15000 }).catch(() => {});
    const pm = await page.evaluate(() => !document.getElementById('pmLocked').hidden || !document.getElementById('pmContent').hidden);
    step('Écran Mes parties et stats', pm);

    // 5. Fenêtre de suppression du compte (ouverte puis fermée, rien n'est supprimé)
    const del = await page.evaluate(() => {
      document.getElementById('delAccBtn').click();
      const open = !document.getElementById('delSheet').hidden;
      const lockedBefore = document.getElementById('delConfirm').disabled;
      const inp = document.getElementById('delInput');
      inp.value = 'supprimer'; inp.dispatchEvent(new Event('input'));
      const unlocked = !document.getElementById('delConfirm').disabled;
      document.getElementById('delCancel').click();
      return { open, lockedBefore, unlocked, closed: document.getElementById('delSheet').hidden };
    });
    step('Fenêtre Supprimer mon compte', del.open && del.lockedBefore && del.unlocked && del.closed, 'bouton bloqué tant que SUPPRIMER n’est pas tapé');

    // 6. Classements : Elo, Solo, défi du jour (aujourd'hui et hier)
    const boards = [];
    for (const [label, open, tab] of [['Elo', 'showGeneralBoard("elo")', null], ['Solo', 'showGeneralBoard("solo")', null], ['Défi du jour', 'showDailyBoard(zurichDate(serverNow()))', null], ['Défi d’hier', 'showDailyBoard(zurichDate(serverNow() - 864e5))', null]]) {
      await page.evaluate(open);
      await page.waitForFunction(() => !/Chargement/.test(document.getElementById('lbList').innerText), { timeout: 15000 }).catch(() => {});
      const txt = await page.evaluate(() => document.getElementById('lbList').innerText);
      boards.push(label + (/indisponible|Chargement/.test(txt) ? ' KO' : ''));
    }
    await page.evaluate(() => show('home'));
    step('Classements Elo, Solo, du jour et d’hier', !boards.some(b => / KO$/.test(b)), boards.join(', '));

    // 7. Pages légales
    for (const p of ['/cgv', '/confidentialite', '/comment-jouer', '/wikirace']) {
      const r = await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const txt = await page.content();
      step('Page ' + p, r.status() === 200 && (txt.includes('contact@wikiduel.ch') || txt.includes('wikiduel.ch/')), 'HTTP ' + r.status());
    }
    step('Aucune erreur pendant le test', errors.length === 0, errors.join(' | '));
  } catch (e) {
    failed = e;
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) {
    console.error('\nPUBLICATION BLOQUÉE : ' + failed.message);
    process.exit(1);
  }
  console.log('\nTout est bon (' + steps.length + ' vérifications).');
})().catch(e => { console.error('\nPUBLICATION BLOQUÉE : test impossible : ' + e.message); process.exit(1); });
