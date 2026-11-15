// Construit themes.json : les articles vitaux de Wikipédia FR rangés par thème
// (pour les salons entre amis des hôtes WikiDuel+).
//   node tools/make-themes.js
'use strict';
const fs = require('fs'), path = require('path');
const UA = { headers: { 'User-Agent': 'WikiDuelBuilder/1.0 (https://wikiduel.ch)' } };
const PAGE = 'Wikipédia:Articles vitaux';

// Thème -> titres des grandes sections de la page (niveau 2) qui le composent.
const THEMES = [
  { id: 'personnalites', name: 'Personnalités', emoji: '👤', sections: ['Personnalités'] },
  { id: 'histoire', name: 'Histoire', emoji: '🏛️', sections: ['Histoire'] },
  { id: 'geographie', name: 'Géographie', emoji: '🌍', sections: ['Géographie'] },
  { id: 'arts', name: 'Arts et culture', emoji: '🎨', sections: ['Arts et culture'] },
  { id: 'vie', name: 'Vie quotidienne', emoji: '🍕', sections: ['Vie quotidienne'] },
  { id: 'societe', name: 'Société et religions', emoji: '⚖️', sections: ['Société et sciences sociales', 'Philosophie et religion'] },
  { id: 'sciences', name: 'Sciences et santé', emoji: '🔬', sections: ['Science', 'Santé et médecine', 'Mathématiques'] },
  { id: 'technologie', name: 'Technologie', emoji: '⚙️', sections: ['Technologie'] }
];

const get = async url => (await fetch(url, UA)).json();
(async () => {
  const sec = (await get('https://fr.wikipedia.org/w/api.php?action=parse&format=json&prop=sections&page=' + encodeURIComponent(PAGE))).parse.sections;
  const top = sec.filter(s => s.level === '2').map(s => ({ index: s.index, title: s.line.replace(/\s*\(.*\)\s*$/, '') }));
  const out = { v: 1, themes: [] };
  for (const t of THEMES) {
    const titles = new Set();
    for (const name of t.sections) {
      const s = top.find(x => x.title === name);
      if (!s) { console.warn('  section introuvable : ' + name); continue; }
      const j = await get('https://fr.wikipedia.org/w/api.php?action=parse&format=json&prop=links&page=' + encodeURIComponent(PAGE) + '&section=' + s.index);
      (j.parse.links || []).filter(l => l.ns === 0 && l.exists !== undefined).forEach(l => titles.add(l['*']));
    }
    out.themes.push({ id: t.id, name: t.name, emoji: t.emoji, pages: [...titles].sort((a, b) => a.localeCompare(b, 'fr')) });
    console.log(t.name + ' : ' + titles.size + ' articles');
  }
  fs.writeFileSync(path.join(__dirname, '..', 'themes.json'), JSON.stringify(out));
})();
