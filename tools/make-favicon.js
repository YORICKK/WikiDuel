// Génère les icônes du site à partir d'un seul dessin (un W blanc et le drapeau d'arrivée orange).
//   node tools/make-favicon.js
// Sortie à la racine : favicon.svg, favicon.ico (48 px, pour Google), apple-touch-icon.png (180 px),
// icon-192.png, icon-512.png.
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');
const ROOT = path.join(__dirname, '..');

// Dessin sur une grille de 64 : fond bleu encre arrondi, W blanc, petit drapeau orange sur la dernière pointe.
function svg(rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="#14213d"/>
  <path d="M10 22 L20 49 L32 27 L44 49 L52 22" fill="none" stroke="#ffffff" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M52 22 V8" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
  <path d="M52.5 7.5 L61 11 L52.5 14.5 Z" fill="#ff5a36"/>
</svg>
`;
}

const BROWSERS = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);

(async () => {
  fs.writeFileSync(path.join(ROOT, 'favicon.svg'), svg(true));
  const browser = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)), headless: true });
  const page = await browser.newPage();
  async function png(size, rounded) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:' + size + 'px;height:' + size + 'px}</style>' + svg(rounded));
    return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  // iOS arrondit lui-même l'icône : fond carré plein pour apple-touch-icon.
  fs.writeFileSync(path.join(ROOT, 'apple-touch-icon.png'), await png(180, false));
  fs.writeFileSync(path.join(ROOT, 'icon-192.png'), await png(192, true));
  fs.writeFileSync(path.join(ROOT, 'icon-512.png'), await png(512, true));
  // favicon.ico : conteneur ICO avec une image PNG de 48 px (taille conseillée par Google).
  const p48 = await png(48, true);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);      // ICO, 1 image
  head.writeUInt8(48, 6); head.writeUInt8(48, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);                              // plans, bits
  head.writeUInt32LE(p48.length, 14); head.writeUInt32LE(22, 18);                     // taille, position
  fs.writeFileSync(path.join(ROOT, 'favicon.ico'), Buffer.concat([head, p48]));
  await browser.close();
  console.log('Icônes générées : favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png');
})();
