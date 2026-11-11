// Génère og.png (1200×630), l'image d'aperçu des liens WikiDuel (WhatsApp, Messenger, etc.).
// Usage : node tools/make-og.js <dossier contenant node_modules/@resvg/resvg-js> <sortie.png>
'use strict';
const fs = require('fs');
const path = require('path');
const [modDir, out] = process.argv.slice(2);
const { Resvg } = require(path.join(modDir, 'node_modules', '@resvg', 'resvg-js'));

const INK = '#14213d', PAPER = '#f6f7fb', FLAG = '#ff5a36', MUTED = '#9aa6c9', CHIP = '#1f2d50';
const MONO = 'Consolas', DISPLAY = 'Segoe UI', SERIF = 'Georgia';

// Chips du parcours d'exemple, largeur estimée d'après la police à chasse fixe.
const route = ['Pizza', 'Italie', 'Rome', 'Jules César'];
const fs32 = 32, cw = fs32 * 0.55, pad = 22, gap = 54;
let x = 80; const y = 410;
let chips = '';
route.forEach((t, i) => {
  const w = Math.round(t.length * cw + pad * 2);
  const end = i === 0 || i === route.length - 1;
  chips += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="64" rx="14" fill="' + (end ? PAPER : CHIP) + '"/>' +
    '<text x="' + (x + pad) + '" y="' + (y + 43) + '" font-family="' + MONO + '" font-size="' + fs32 + '" font-weight="700" fill="' + (end ? INK : PAPER) + '">' + t + '</text>';
  x += w;
  if (i < route.length - 1) {
    chips += '<text x="' + (x + gap / 2) + '" y="' + (y + 44) + '" text-anchor="middle" font-family="' + DISPLAY + '" font-size="34" font-weight="700" fill="' + FLAG + '">→</text>';
    x += gap;
  }
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${INK}"/>
  <!-- trame de liens en fond, très discrète -->
  <g stroke="#22325a" stroke-width="2" fill="none">
    <path d="M760 520 C 900 420, 980 600, 1130 470"/>
    <path d="M820 600 C 940 520, 1040 640, 1180 560"/>
  </g>
  <!-- drapeau d'arrivée -->
  <rect x="1000" y="70" width="120" height="120" rx="28" fill="${FLAG}"/>
  <path d="M1035 95 v70 M1035 100 h52 l-12 17 12 17 h-52" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="80" y="110" font-family="${MONO}" font-size="26" font-weight="700" letter-spacing="5" fill="${MUTED}">LA COURSE SUR WIKIPÉDIA</text>
  <text x="74" y="265" font-family="${DISPLAY}" font-size="176" font-weight="900" letter-spacing="-6">
    <tspan fill="${PAPER}">Wiki</tspan><tspan fill="${FLAG}">Duel</tspan>
  </text>
  <text x="80" y="345" font-family="${SERIF}" font-size="40" fill="#dfe5f5">Même départ, même cible. Seuls les liens comptent.</text>
  ${chips}
  <text x="80" y="565" font-family="${MONO}" font-size="34" font-weight="700" fill="${FLAG}">wikiduel.ch</text>
  <text x="1120" y="565" text-anchor="end" font-family="${DISPLAY}" font-size="28" font-weight="600" fill="${MUTED}">Défi du jour · Classé · Entre amis</text>
</svg>`;

const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: DISPLAY }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
fs.writeFileSync(out, png);
console.log('Image écrite :', out, Math.round(png.length / 1024) + ' Ko');
