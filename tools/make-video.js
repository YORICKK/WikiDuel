// Filme une vraie partie de WikiDuel en format TikTok (1080×1920) et l'assemble en MP4.
// Parcours : Pizza → États-Unis → Lune (défi du jour n°1, terminé).
// Usage : node tools/make-video.js <dossier contenant node_modules/ffmpeg-static> <sortie.mp4> [url du jeu]
// Le jeu doit tourner (node dev-server.js). Sans musique : on l'ajoute dans TikTok (sons tendance).
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [ffDir, OUT, URL_ARG] = process.argv.slice(2);
const GAME = URL_ARG || 'http://localhost:3000/';
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));
const ffmpeg = require(path.join(ffDir, 'node_modules', 'ffmpeg-static'));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Habillage injecté dans la page pendant le tournage : légendes, cartes titre/fin, « doigt » qui tape.
const CSS = `
#vcard { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; text-align: center; padding: 40px 28px;
  background: #14213d; color: #f6f7fb; font-family: "Bricolage Grotesque", system-ui, sans-serif; transition: opacity .35s; }
#vcard.off { opacity: 0; pointer-events: none; }
#vcard .big { font-weight: 800; font-size: 46px; line-height: 1.05; letter-spacing: -1px; }
#vcard .big span { color: #ff5a36; }
#vcard .emo { font-size: 70px; margin-bottom: 14px; }
#vcard .sub { font: 600 21px/1.35 "Bricolage Grotesque", system-ui, sans-serif; color: #c7cfe6; margin-top: 18px; }
#vcard .url { margin-top: 26px; font: 700 30px "JetBrains Mono", monospace; color: #ff5a36; }
#vcard .chips { margin-top: 20px; font: 600 16px "Bricolage Grotesque", sans-serif; color: #9aa6c9; }
#vcap { position: fixed; left: 50%; top: 27%; transform: translateX(-50%) scale(.9); z-index: 9998; width: 84%; text-align: center;
  font: 800 30px/1.15 "Bricolage Grotesque", system-ui, sans-serif; color: #fff; padding: 14px 16px; border-radius: 18px;
  background: rgba(20,33,61,.88); box-shadow: 0 10px 40px rgba(0,0,0,.35); opacity: 0; transition: opacity .25s, transform .25s; }
#vcap.on { opacity: 1; transform: translateX(-50%) scale(1); }
#vcap small { display: block; font: 600 17px "Bricolage Grotesque", sans-serif; color: #c7cfe6; margin-top: 6px; }
a.wl.vhl { background: #ff5a36 !important; color: #fff !important; box-shadow: 0 0 0 6px rgba(255,90,54,.35) !important; border-radius: 6px; }
#vtap { position: fixed; z-index: 9997; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  background: rgba(255,255,255,.55); border: 3px solid #fff; pointer-events: none; opacity: 0; }
#vtap.go { animation: vtap .55s ease-out; }
@keyframes vtap { 0% { opacity: 0; transform: scale(1.6); } 40% { opacity: 1; transform: scale(.8); } 100% { opacity: 0; transform: scale(1.3); } }
`;
const PAGE_HELPERS = () => {
  window.V = {
    card(html) { const c = document.getElementById('vcard'); c.innerHTML = html; c.classList.remove('off'); },
    hideCard() { document.getElementById('vcard').classList.add('off'); },
    cap(html, low) { const c = document.getElementById('vcap'); c.innerHTML = html; c.style.top = low ? '68%' : '27%'; c.classList.add('on'); },
    noCap() { document.getElementById('vcap').classList.remove('on'); },
    link(match) { return [...document.querySelectorAll('#artBody a.wl')].find(a => norm(a.dataset.to) === norm(match)); },
    open(el) { const d = el.closest('details'); if (d) d.open = true; },
    scrollTo(el, ms) {
      return new Promise(res => {
        const y0 = scrollY, y1 = y0 + el.getBoundingClientRect().top - innerHeight * 0.52, t0 = performance.now();
        (function step(t) {
          const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          scrollTo(0, y0 + (y1 - y0) * e);
          if (k < 1) requestAnimationFrame(step); else res();
        })(t0);
      });
    },
    tap(el) {
      const r = el.getBoundingClientRect(), t = document.getElementById('vtap');
      t.style.left = (r.left + r.width / 2) + 'px'; t.style.top = (r.top + r.height / 2) + 'px';
      t.classList.remove('go'); void t.offsetWidth; t.classList.add('go');
    }
  };
  const mk = (id) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
  mk('vcard').classList.add('off'); mk('vcap'); mk('vtap');
};

(async () => {
  const work = fs.mkdtempSync(path.join(path.dirname(OUT), 'frames-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 432, height: 768, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(GAME, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => typeof uid !== 'undefined' && !!uid, { timeout: 30000 });
  const uidRec = await page.evaluate(() => uid);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(PAGE_HELPERS);
  await page.evaluate(() => { store.set('wd-name', 'Greg'); document.getElementById('name').value = 'Greg'; window.scrollTo(0, 0); });

  // Captation image par image (horodatée) via le protocole de Chrome.
  const frames = [];
  const cdp = await page.target().createCDPSession();
  cdp.on('Page.screencastFrame', async f => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  // Petite animation permanente : garantit des images régulières même quand rien ne bouge.
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:.01'; document.body.appendChild(d); let i = 0; setInterval(() => { d.style.background = (i++ % 2) ? '#000' : '#010101'; }, 33); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });

  // 1. Carte titre
  await page.evaluate(() => V.card('<div><div class="emo">🍕 → 🌙</div><div class="big">De la <span>Pizza</span><br>à la <span>Lune</span></div><div class="sub">en cliquant <b>seulement</b> sur des liens Wikipédia.<br>Combien de clics ?</div></div>'));
  await sleep(3300);
  // 2. Départ (compte à rebours avec la fiche de la cible)
  await page.evaluate(() => { V.hideCard(); S.solo = null; S.round = 0; startSolo({ start: 'Pizza', target: 'Lune' }); });
  await sleep(500);
  await page.evaluate(() => V.cap('Départ : 🍕 Pizza<small>Cible : 🌙 Lune</small>'));
  await sleep(2900);
  await page.evaluate(() => V.noCap());
  await page.waitForFunction(() => document.querySelectorAll('#artBody a.wl').length > 10 && document.getElementById('artTitle').textContent === 'Pizza', { timeout: 30000 });
  await sleep(900);
  // 3. Clic 1 : États-Unis
  await page.evaluate(() => V.cap('Je cherche un lien…<small>vers quelque chose de plus « grand »</small>'));
  await sleep(1300);
  await page.evaluate(async () => { const a = V.link('États-Unis'); V.open(a); await V.scrollTo(a, 1700); });
  await page.evaluate(() => { const a = V.link('États-Unis'); a.classList.add('vhl'); V.cap('Clic 1 : 🗽 États-Unis'); });
  await sleep(1100);
  await page.evaluate(() => V.tap(V.link('États-Unis')));
  await sleep(350);
  await page.evaluate(() => { V.noCap(); V.link('États-Unis').click(); });
  await page.waitForFunction(() => document.getElementById('artTitle').textContent === 'États-Unis' && document.querySelectorAll('#artBody a.wl').length > 10, { timeout: 30000 });
  await sleep(800);
  // 4. Clic 2 : Lune
  await page.evaluate(() => V.cap('Les États-Unis…<small>ils sont allés sur la Lune, non ? 🚀</small>'));
  await sleep(1500);
  await page.evaluate(async () => { const a = V.link('Lune'); V.open(a); await V.scrollTo(a, 2200); });
  await page.evaluate(() => { const a = V.link('Lune'); a.classList.add('vhl'); V.cap('Clic 2 : 🌙 Lune !'); });
  await sleep(1100);
  await page.evaluate(() => V.tap(V.link('Lune')));
  await sleep(350);
  await page.evaluate(() => { V.noCap(); V.link('Lune').click(); });
  // 5. Résultat
  await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 30000 });
  await sleep(500);
  await page.evaluate(() => V.cap('Arrivé en 2 clics ! 🏁<small>Tu fais mieux ?</small>', true));
  await sleep(2600);
  // 6. Carte de fin
  await page.evaluate(() => { V.noCap(); V.card('<div><div class="big">Wiki<span>Duel</span></div><div class="sub">Défie tes amis, joue le défi du jour<br>et grimpe au classement.</div><div class="url">👉 wikiduel.ch</div><div class="chips">Gratuit · sur téléphone · sans inscription</div></div>'); });
  await sleep(3200);
  await cdp.send('Page.stopScreencast');
  await browser.close();

  // Assemblage : chaque image dure jusqu'à la suivante (fréquence variable → 30 i/s constants).
  let list = '';
  frames.forEach((f, i) => {
    const file = path.join(work, 'f' + String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - f.t) : 0.5;
    list += "file '" + file.replace(/\\/g, '/') + "'\nduration " + dur.toFixed(4) + '\n';
  });
  list += "file '" + path.join(work, 'f' + String(frames.length - 1).padStart(5, '0') + '.jpg').replace(/\\/g, '/') + "'\n";
  fs.writeFileSync(path.join(work, 'list.txt'), list);
  execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'),
    '-vf', 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
    '-movflags', '+faststart', '-an', OUT], { stdio: 'ignore' });
  fs.rmSync(work, { recursive: true, force: true });
  const secs = frames.length ? (frames[frames.length - 1].t - frames[0].t + 0.5) : 0;
  console.log('Vidéo : ' + OUT + ' (' + frames.length + ' images, ' + secs.toFixed(1) + ' s, ' + Math.round(fs.statSync(OUT).size / 1024) + ' Ko)');
  console.log('UID_ENREGISTREMENT=' + uidRec);
})().catch(e => { console.error('Échec du tournage : ' + e.message); process.exit(1); });
