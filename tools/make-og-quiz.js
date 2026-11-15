// Génère og-quiz.png (1200×630), l'aperçu des liens wikiduel.ch/quiz (WhatsApp, réseaux sociaux).
// Quatre vraies photos de la banque du quiz, une seule « bonne » (bordure verte).
//   node tools/make-og-quiz.js
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');
const ROOT = path.join(__dirname, '..');
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'quiz-data', 'questions.json'), 'utf8'));
const pick = (c, l) => bank.items.find(i => i.c === c && i.l === l);
const tiles = [pick('fleuve', 'Rhin'), pick('fleuve', 'Danube'), pick('fleuve', 'Volga'), pick('fleuve', 'Nil')];
const GOOD = 1;
const img = it => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'quiz-data', 'img', it.id + '.jpg')).toString('base64');
const BROWSERS = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=JetBrains+Mono:wght@700&display=swap">
<style>
html,body{margin:0;width:1200px;height:630px;background:#14213d;overflow:hidden}
.w{display:grid;grid-template-columns:1fr 470px;gap:50px;height:100%;padding:60px 64px;box-sizing:border-box;align-items:center}
.k{font:700 22px 'JetBrains Mono',monospace;letter-spacing:5px;color:#9aa6c9}
.l{font:800 132px/.9 'Bricolage Grotesque',sans-serif;letter-spacing:-5px;color:#f6f7fb;margin:18px 0 0}
.l span{color:#ff5a36}.l em{display:block;font-style:normal;color:#a98bff;font-size:96px;letter-spacing:-3px;margin-top:6px}
.q{font:800 40px/1.2 'Bricolage Grotesque',sans-serif;color:#dfe5f5;margin-top:30px}.q b{color:#ff5a36}
.u{font:700 30px 'JetBrains Mono',monospace;color:#ff5a36;margin-top:26px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.t{position:relative;aspect-ratio:1;border-radius:24px;overflow:hidden;border:6px solid #2a3557;background:#1d2b52}
.t img{width:100%;height:100%;object-fit:cover;display:block}
.t.ok{border-color:#3fcf8e}.t.ok::after{content:'✓';position:absolute;top:10px;right:10px;width:46px;height:46px;border-radius:50%;background:#3fcf8e;color:#fff;font:800 28px/46px sans-serif;text-align:center}
</style></head><body><div class="w"><div>
<div class="k">LE QUIZ EN IMAGES</div>
<div class="l">Wiki<span>Duel</span><em>Quiz</em></div>
<div class="q">Lequel est le <b>Danube</b> ?<br>10 secondes. 4 photos.</div>
<div class="u">wikiduel.ch/quiz</div>
</div><div class="g">${tiles.map((t, i) => '<div class="t' + (i === GOOD ? ' ok' : '') + '"><img src="' + img(t) + '"></div>').join('')}</div></div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)), headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(ROOT, 'og-quiz.png');
  await page.screenshot({ path: out, type: 'png' });
  await browser.close();
  console.log('Image écrite : og-quiz.png', Math.round(fs.statSync(out).size / 1024) + ' Ko');
})();
