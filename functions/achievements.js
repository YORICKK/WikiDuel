// Succès : classement des badges par catégorie (via Wikidata) et définition des succès.
// Utilisé par le serveur (functions/index.js) ; la liste ACH est recopiée dans l'appli pour l'affichage.
'use strict';
const UA = 'WikiDuel/1.0 (https://wikiduel.ch)';

// Succès : catégorie de badges + paliers (nombre de badges différents) ; récompense en Liens par palier.
const ACH = [
  { id: 'collection', cat: null, emoji: '🏅', name: 'Collectionneur', what: 'badges différents', tiers: [10, 50, 100, 250] },
  { id: 'pays', cat: 'pays', emoji: '🌍', name: 'Globe-trotter', what: 'pays', tiers: [3, 10, 25] },
  { id: 'ville', cat: 'ville', emoji: '🏙️', name: 'Citadin', what: 'villes', tiers: [3, 10, 25] },
  { id: 'jeuvideo', cat: 'jeuvideo', emoji: '🎮', name: 'Gamer', what: 'consoles ou jeux vidéo', tiers: [2, 4, 8] },
  { id: 'personnalite', cat: 'personnalite', emoji: '👤', name: 'Carnet d’adresses', what: 'personnalités', tiers: [5, 15, 30] },
  { id: 'artiste', cat: 'artiste', emoji: '🎭', name: 'Fan d’artistes', what: 'artistes (peintres, musiciens, écrivains…)', tiers: [3, 8, 15] },
  { id: 'sport', cat: 'sport', emoji: '⚽', name: 'Sportif', what: 'sports, clubs ou sportifs', tiers: [3, 8, 15] },
  { id: 'vivant', cat: 'vivant', emoji: '🐾', name: 'Naturaliste', what: 'animaux ou plantes', tiers: [3, 10, 25] },
  { id: 'nature', cat: 'nature', emoji: '🏔️', name: 'Explorateur', what: 'montagnes, fleuves, lacs, îles…', tiers: [3, 8, 15] },
  { id: 'espace', cat: 'espace', emoji: '🪐', name: 'Astronaute', what: 'astres (planètes, étoiles, lunes…)', tiers: [2, 5, 8] },
  { id: 'oeuvre', cat: 'oeuvre', emoji: '🎨', name: 'Mécène', what: 'œuvres (tableaux, films, livres, chansons…)', tiers: [2, 5, 10] },
  { id: 'histoire', cat: 'histoire', emoji: '🏛️', name: 'Historien', what: 'pages d’histoire', tiers: [3, 10, 20] },
  { id: 'sciences', cat: 'sciences', emoji: '🔬', name: 'Savant', what: 'pages de sciences', tiers: [3, 10, 20] }
];
const REWARDS = [10, 25, 50, 100]; // Liens par palier atteint

// Types Wikidata (P31 « nature de l'élément ») → catégorie.
const P31 = {
  pays: ['Q6256', 'Q3624078', 'Q7275', 'Q112099'],
  ville: ['Q515', 'Q1549591', 'Q1637706', 'Q5119', 'Q200250', 'Q484170', 'Q70208', 'Q747074', 'Q1093829', 'Q2264924', 'Q15284', 'Q486972', 'Q7930989', 'Q1066984'],
  jeuvideo: ['Q8076', 'Q17589470', 'Q941818', 'Q7889', 'Q7058673', 'Q210167', 'Q1137109', 'Q865493'],
  sport: ['Q31629', 'Q349', 'Q13406554', 'Q500834', 'Q476028', 'Q847017', 'Q18536342', 'Q16510064', 'Q27020041', 'Q1344963', 'Q5389', 'Q159821', 'Q46190676'],
  vivant: ['Q16521', 'Q55983715', 'Q7432'],
  nature: ['Q4022', 'Q8502', 'Q23397', 'Q165', 'Q9430', 'Q8072', 'Q35666', 'Q23442', 'Q8514', 'Q4421', 'Q46831', 'Q34763', 'Q355304', 'Q1437299', 'Q39594', 'Q34038', 'Q12284', 'Q40080', 'Q185113'],
  espace: ['Q634', 'Q3504248', 'Q30014', 'Q523', 'Q2537', 'Q1055', 'Q5864', 'Q318', 'Q3863', 'Q3559', 'Q1022867', 'Q11173', 'Q13890', 'Q6999', 'Q40435', 'Q1086783', 'Q85793519', 'Q109645860'],
  oeuvre: ['Q3305213', 'Q838948', 'Q11424', 'Q7725634', 'Q482994', 'Q7366', 'Q571', 'Q860861', 'Q4502142', 'Q47461344', 'Q1259759', 'Q5398426', 'Q8261', 'Q134556', 'Q25379'],
  histoire: ['Q198', 'Q178561', 'Q103495', 'Q11514315', 'Q3024240', 'Q48349', 'Q10931', 'Q1190554', 'Q13418847', 'Q645883', 'Q17524420', 'Q350604']
};
// Métiers (P106) des personnes → artiste ou sportif.
const P106 = {
  artiste: ['Q1028181', 'Q483501', 'Q1281618', 'Q639669', 'Q177220', 'Q36834', 'Q33999', 'Q2526255', 'Q36180', 'Q49757', 'Q42973', 'Q10800557', 'Q753110', 'Q2252262', 'Q488205', 'Q2259451', 'Q10798782'],
  sport: ['Q2066131', 'Q937857', 'Q10833314', 'Q3665646', 'Q10843402', 'Q11513337', 'Q19204627', 'Q11338576', 'Q2309784', 'Q10349745', 'Q13141064', 'Q11774891', 'Q12840545', 'Q4144610', 'Q13381376', 'Q15117302', 'Q16004471', 'Q11607585', 'Q18515558']
};

async function sparql(q) {
  const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
  if (!r.ok) throw new Error('Wikidata ' + r.status);
  return (await r.json()).results.bindings;
}
let THEMES = null;
async function themeSets() {
  if (THEMES) return THEMES;
  try {
    const j = await (await fetch('https://wikiduel.ch/themes.json', { headers: { 'User-Agent': UA } })).json();
    const get = id => new Set(((j.themes.find(t => t.id === id) || {}).pages || []).map(t => t.toLowerCase()));
    THEMES = { histoire: get('histoire'), sciences: get('sciences'), sport: get('sport'), jeuvideo: get('jeuxvideo') };
  } catch (e) { THEMES = { histoire: new Set(), sciences: new Set(), sport: new Set(), jeuvideo: new Set() }; }
  return THEMES;
}
// Classe une liste de titres d'articles (Wikipédia FR) : { titre: [catégories] }.
async function classifyTitles(titles) {
  const out = {}, themes = await themeSets();
  titles.forEach(t => { out[t] = new Set(); });
  for (let i = 0; i < titles.length; i += 40) {
    const part = titles.slice(i, i + 40);
    const values = part.map(t => JSON.stringify(t) + '@fr').join(' ');
    const rows = await sparql('SELECT ?title ?p31 ?p106 ?cap WHERE { VALUES ?title { ' + values + ' } ' +
      '?art schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?title. ' +
      'OPTIONAL { ?item wdt:P31 ?p31 } OPTIONAL { ?item wdt:P106 ?p106 } OPTIONAL { ?item wdt:P1376 ?cap } }');
    rows.forEach(r => {
      const t = r.title.value, set = out[t]; if (!set) return;
      const p31 = r.p31 && r.p31.value.split('/').pop(), p106 = r.p106 && r.p106.value.split('/').pop();
      if (p31) Object.keys(P31).forEach(c => { if (P31[c].includes(p31)) set.add(c); });
      if (p31 === 'Q5') set.add('personnalite');
      if (p106) Object.keys(P106).forEach(c => { if (P106[c].includes(p106)) set.add(c); });
      if (r.cap) set.add('ville');
    });
  }
  titles.forEach(t => {
    const k = t.toLowerCase();
    ['histoire', 'sciences', 'sport', 'jeuvideo'].forEach(c => { if (themes[c].has(k)) out[t].add(c); });
    out[t] = [...out[t]].sort();
  });
  return out;
}
module.exports = { ACH, REWARDS, classifyTitles };
