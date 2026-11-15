// Filme une partie de WikiDuel Quiz en format TikTok (1080×1920) et l'assemble en MP4.
// 5 questions choisies (dont une ratée exprès, pour le suspense), puis le score et une carte de fin.
// Usage : node tools/make-quiz-video.js <dossier contenant node_modules/ffmpeg-static> <sortie.mp4> [scénario] [url du quiz]
// Scénarios : danube (TikTok), retro (Instagram : consoles, sport, Suisse).
// Le jeu doit tourner (node dev-server.js). Sans musique : on l'ajoute dans l'appli (sons tendance).
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [ffDir, OUT, SC_ARG, URL_ARG] = process.argv.slice(2);
const GAME = URL_ARG || 'http://localhost:3000/quiz.html';
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));
const ffmpeg = require(path.join(ffDir, 'node_modules', 'ffmpeg-static'));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Les 5 questions : [catégorie, bonne réponse, 3 leurres], dans l'ordre d'affichage des 4 images.
const SCRIPT = [
  { cat: 'fleuve', opts: ['Volga', 'Danube', 'Nil', 'Rhin'], ans: 'Danube', pick: 'Danube', wait: 1300,
    before: null, after: 'Facile 😎' },
  { cat: 'drapeau', opts: ['Lettonie', 'Arménie', 'Estonie', 'Lituanie'], ans: 'Lituanie', pick: 'Lituanie', wait: 3600,
    before: 'Euh… 🤔', after: 'Validé ✅' },
  { cat: 'monument', opts: ['Château de Neuschwanstein', 'Alhambra', 'Château de Chillon', 'Château de Versailles'], ans: 'Château de Chillon', pick: 'Château de Chillon', wait: 1800,
    before: null, after: 'Chillon, au bord du Léman 🏰' },
  { cat: 'peinture', opts: ['Les Nymphéas', 'Impression, soleil levant', 'Le Déjeuner sur l\'herbe', 'Un dimanche après-midi à l\'Île de la Grande Jatte'], ans: 'Impression, soleil levant', pick: 'Les Nymphéas', wait: 4200,
    before: 'Que des Monet… 😵', after: 'RATÉ 😭' },
  { cat: 'personne', opts: ['Karl Marx', 'Alfred Nobel', 'Charles Darwin', 'Henri Dunant'], ans: 'Henri Dunant', pick: 'Henri Dunant', wait: 5200,
    before: 'Que des barbes 🧔', after: 'Ouf ! Le fondateur de la Croix-Rouge ⛑️' }
];
const SCENARIOS = {
  danube: {
    q: SCRIPT,
    title: '<div><div class="emo">🌊🏔️<br>🦁🚗</div><div class="big">4 photos.<br>Une seule est<br>le <span>Danube</span>.</div><div class="sub">10 secondes pour la trouver.<br>Tu ferais mieux que moi ?</div></div>',
    endCap: '8 sur 10 🔥<small>Et toi, tu fais combien ?</small>',
    end: '<div><div class="big">Wiki<span>Duel</span> <em>Quiz</em></div><div class="sub">Le quiz du jour, le même pour tous.<br>Défie tes amis en direct.</div><div class="url">👉 wikiduel.ch/quiz</div><div class="chips">Gratuit · sur téléphone · photos Wikipédia</div></div>'
  },
  retro: {
    q: [
      { cat: 'jeuvideo', opts: ['GameCube', 'Dreamcast', 'Nintendo 64', 'PlayStation'], ans: 'Nintendo 64', pick: 'Nintendo 64', wait: 1200,
        before: null, after: 'Mon enfance 😍' },
      { cat: 'sport', opts: ['Sumo', 'Lutte suisse', 'Judo', 'Lutte'], ans: 'Lutte suisse', pick: 'Lutte suisse', wait: 2600,
        before: 'La sciure… 👀', after: 'Le Schwingen, évidemment 💪' },
      { cat: 'monument', opts: ['Pont Charles', 'Tower Bridge', 'Kapellbrücke', 'Pont du Gard'], ans: 'Kapellbrücke', pick: 'Kapellbrücke', wait: 3300,
        before: 'Euh… Lucerne ? 🤔', after: 'Le pont de la Chapelle ✅' },
      { cat: 'animal', opts: ['Bouquetin des Alpes', 'Chamois', 'Cerf élaphe', 'Marmotte des Alpes'], ans: 'Chamois', pick: 'Bouquetin des Alpes', wait: 3900,
        before: 'Bouquetin ou chamois ?! 😵', after: 'RATÉ 😭' },
      { cat: 'jeuvideo', opts: ['Game Boy', 'Nintendo DS', 'Game Boy Advance', 'Game Boy Color'], ans: 'Game Boy Color', pick: 'Game Boy Color', wait: 5100,
        before: 'Elles se ressemblent toutes 😅', after: 'Ouf ! La Game Boy Color 🎮' }
    ],
    title: '<div><div class="emo">🎮⚽<br>🏔️🐐</div><div class="big">Consoles, sport<br>et <span>Suisse</span>.</div><div class="sub">4 photos, une seule bonne.<br>10 secondes. Tu fais mieux que moi ?</div></div>',
    endCap: '8 sur 10 🔥<small>Bouquetin ou chamois, sois honnête 👇</small>',
    end: '<div><div class="big">Wiki<span>Duel</span> <em>Quiz</em></div><div class="sub">Nouveau : <b>Sport</b> et <b>Jeux vidéo</b>.<br>Le quiz du jour, le même pour tous.</div><div class="url">👉 wikiduel.ch/quiz</div><div class="chips">Gratuit · sans inscription · photos Wikipédia</div></div>'
  }
};
const SC = SCENARIOS[SC_ARG || 'danube'];
if (!SC) { console.error('Scénario inconnu : ' + SC_ARG); process.exit(1); }

const CSS = `
#vcard { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; text-align: center; padding: 40px 28px;
  background: #14213d; color: #f6f7fb; font-family: "Bricolage Grotesque", system-ui, sans-serif; transition: opacity .35s; }
#vcard.off { opacity: 0; pointer-events: none; }
#vcard .big { font-weight: 800; font-size: 46px; line-height: 1.05; letter-spacing: -1px; }
#vcard .big span { color: #ff5a36; } #vcard .big em { font-style: normal; color: #a98bff; }
#vcard .emo { font-size: 64px; margin-bottom: 14px; letter-spacing: 6px; }
#vcard .sub { font: 600 21px/1.35 "Bricolage Grotesque", system-ui, sans-serif; color: #c7cfe6; margin-top: 18px; }
#vcard .url { margin-top: 26px; font: 700 28px "JetBrains Mono", monospace; color: #ff5a36; }
#vcard .chips { margin-top: 20px; font: 600 16px "Bricolage Grotesque", sans-serif; color: #9aa6c9; }
#vcap { position: fixed; left: 50%; top: 84%; transform: translateX(-50%) scale(.9); z-index: 9998; width: 86%; text-align: center;
  font: 800 27px/1.15 "Bricolage Grotesque", system-ui, sans-serif; color: #fff; padding: 12px 16px; border-radius: 18px;
  background: rgba(123,77,255,.94); box-shadow: 0 10px 40px rgba(0,0,0,.35); opacity: 0; transition: opacity .25s, transform .25s; }
#vcap.on { opacity: 1; transform: translateX(-50%) scale(1); }
#vcap.bad { background: rgba(214,59,47,.95); }
#vcap small { display: block; font: 600 16px "Bricolage Grotesque", sans-serif; color: #efeaff; margin-top: 4px; }
#vtap { position: fixed; z-index: 9997; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%;
  background: rgba(255,255,255,.55); border: 3px solid #fff; pointer-events: none; opacity: 0; }
#vtap.go { animation: vtap .55s ease-out; }
@keyframes vtap { 0% { opacity: 0; transform: scale(1.6); } 40% { opacity: 1; transform: scale(.8); } 100% { opacity: 0; transform: scale(1.3); } }
`;
const PAGE_HELPERS = () => {
  window.V = {
    card(html) { const c = document.getElementById('vcard'); c.innerHTML = html; c.classList.remove('off'); },
    hideCard() { document.getElementById('vcard').classList.add('off'); },
    cap(html, bad, top) { const c = document.getElementById('vcap'); c.innerHTML = html; c.classList.toggle('bad', !!bad); c.style.top = (top || 84) + '%'; c.classList.add('on'); },
    noCap() { document.getElementById('vcap').classList.remove('on'); },
    tap(el) {
      const r = el.getBoundingClientRect(), t = document.getElementById('vtap');
      t.style.left = (r.left + r.width / 2) + 'px'; t.style.top = (r.top + r.height / 2) + 'px';
      t.classList.remove('go'); void t.offsetWidth; t.classList.add('go');
    }
  };
  const mk = id => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
  mk('vcard').classList.add('off'); mk('vcap'); mk('vtap');
};

(async () => {
  const work = fs.mkdtempSync(path.join(path.dirname(OUT), 'frames-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 432, height: 768, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(GAME, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => typeof uid !== 'undefined' && !!uid && !!S.bank, { timeout: 30000 });
  const uidRec = await page.evaluate(() => uid);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(PAGE_HELPERS);

  // Questions du tournage (+ 5 questions tirées au sort pour compléter l'écran de résultats).
  await page.evaluate(script => {
    const it = (c, l) => S.bank.items.find(i => i.c === c && i.l === l);
    const qs = script.map(s => { const opts = s.opts.map(l => it(s.cat, l)); return { cat: s.cat, ans: it(s.cat, s.ans), opts, good: s.opts.indexOf(s.ans) }; });
    window.__qs = qs.concat(buildQuiz('video-fin').filter(q => !script.some(s => s.cat === q.cat)).concat(buildQuiz('video-fin-2')).slice(0, 5));
  }, SC.q);
  // Images chargées d'avance (pas de trou noir à l'écran).
  await page.evaluate(() => preload(window.__qs));
  // Partie solo d'un compte connecté (le tournage ne dépend pas de la connexion Google).
  await page.evaluate(() => { S.google = true; S.profileName = 'Greg'; document.getElementById('name').value = 'Greg'; window.scrollTo(0, 0); });

  const frames = [];
  const cdp = await page.target().createCDPSession();
  cdp.on('Page.screencastFrame', async f => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:.01'; document.body.appendChild(d); let i = 0; setInterval(() => { d.style.background = (i++ % 2) ? '#000' : '#010101'; }, 33); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  // Instants clés (même horloge que les images) : servent à caler les bruitages de la bande-son.
  const EV = [];
  const ev = (type, dt) => EV.push({ type, t: Date.now() / 1000 + (dt || 0) });

  // 1. Carte titre
  await page.evaluate(html => V.card(html), SC.title);
  ev('title');
  await sleep(3200);
  // 2. Départ de la partie (compte à rebours du jeu : 3, 2, 1)
  await page.evaluate(() => { V.hideCard(); startGame({ mode: 'solo', qs: window.__qs }); });
  ev('count'); ev('count', 0.8); ev('count', 1.6);

  // 3. Les 5 questions
  for (let k = 0; k < SC.q.length; k++) {
    const s = SC.q[k];
    await page.waitForFunction(i => G && G.i === i && !G.locked, { timeout: 30000 }, k);
    ev('question');
    if (s.before) { await sleep(Math.min(1200, s.wait - 900)); await page.evaluate(t => V.cap(t), s.before); await sleep(s.wait - Math.min(1200, s.wait - 900) - 500); }
    else await sleep(s.wait - 500);
    const idx = s.opts.indexOf(s.pick);
    await page.evaluate(i => V.tap(document.querySelectorAll('#gGrid .tile')[i]), idx);
    ev('tap');
    await sleep(500);
    await page.evaluate(i => { V.noCap(); answer(i); }, idx);
    ev(s.pick === s.ans ? 'ok' : 'ko');
    await sleep(450);
    await page.evaluate((t, bad) => V.cap(t, bad), s.after, s.pick !== s.ans);
    await sleep(k === SC.q.length - 1 ? 1500 : 1950); // la dernière doit finir avant le passage auto (2,6 s)
    await page.evaluate(() => V.noCap());
  }
  // 4. Accélère : les 5 dernières questions sont comptées réussies (4) ou ratées (1), puis résultats.
  await page.evaluate(() => {
    const ts = [2400, 3100, 0, 1900, 4400];
    for (let i = 5; i < 10; i++) { const t = ts[i - 5]; const s = t ? points(t) : 0; G.res[i] = { p: s ? G.qs[i].good : (G.qs[i].good + 1) % 4, t: t || 10000, s }; G.score += s; }
    G.i = 9; finish();
  });
  ev('results');
  await sleep(400);
  await page.evaluate(html => V.cap(html, false, 70), SC.endCap);
  await sleep(3000);
  // 5. Carte de fin
  await page.evaluate(html => { V.noCap(); V.card(html); }, SC.end);
  ev('end');
  await sleep(3400);
  await cdp.send('Page.stopScreencast');
  await browser.close();

  let list = '';
  frames.forEach((f, i) => {
    const file = path.join(work, 'f' + String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - f.t) : 0.5;
    list += "file '" + file.replace(/\\/g, '/') + "'\nduration " + dur.toFixed(4) + '\n';
  });
  list += "file '" + path.join(work, 'f' + String(frames.length - 1).padStart(5, '0') + '.jpg').replace(/\\/g, '/') + "'\n";
  fs.writeFileSync(path.join(work, 'list.txt'), list);
  const secs = frames.length ? (frames[frames.length - 1].t - frames[0].t + 0.5) : 0;
  // Bande-son synthétisée (musique rétro + bruitages calés sur les instants clés). SANS_SON=1 pour une vidéo muette.
  const t0 = frames.length ? frames[0].t : 0;
  const events = EV.map(e => ({ type: e.type, at: e.t - t0 })).filter(e => e.at >= 0);
  events.filter(e => e.type === 'question').forEach(q => {          // tic-tac chaque seconde jusqu'au toucher
    const tap = events.find(e => e.type === 'tap' && e.at > q.at);
    for (let x = q.at + 1; tap && x < tap.at - 0.15; x += 1) events.push({ type: 'tick', at: x });
  });
  console.log('Calage : 1re image ' + t0.toFixed(2) + ' | 1er événement ' + (EV[0] ? EV[0].t.toFixed(2) : '-') + ' | événements : ' +
    events.filter(e => e.type !== 'tick').map(e => e.type + '@' + e.at.toFixed(2)).join(' '));
  const withSound = !process.env.SANS_SON;
  const wav = path.join(work, 'son.wav');
  if (withSound) fs.writeFileSync(wav, require('./make-sound').buildAudio(secs, events.sort((a, b) => a.at - b.at)));
  execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt')].concat(withSound ? ['-i', wav] : []).concat([
    '-vf', 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19'])
    .concat(withSound ? ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '160k', '-shortest'] : ['-an'])
    .concat(['-movflags', '+faststart', OUT]), { stdio: 'ignore' });
  fs.rmSync(work, { recursive: true, force: true });
  console.log('UID_ENREGISTREMENT=' + uidRec);
  console.log('Vidéo : ' + OUT + ' (' + frames.length + ' images, ' + secs.toFixed(1) + ' s, ' + Math.round(fs.statSync(OUT).size / 1024) + ' Ko)');
})().catch(e => { console.error('Échec du tournage : ' + e.message); process.exit(1); });
