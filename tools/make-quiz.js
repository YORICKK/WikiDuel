// Construit la banque de questions de WikiDuel Quiz.
//   node tools/make-quiz.js
// Sortie : quiz-data/questions.json + quiz-data/img/<hash>.jpg (images hébergées chez nous,
// sous un nom neutre : le nom du fichier Commons ne trahit pas la réponse).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const OUT = path.join(__dirname, '..', 'quiz-data'), IMG = path.join(OUT, 'img');
const UA = { 'User-Agent': 'WikiDuelQuizBuilder/1.0 (https://wikiduel.ch)' };
const WIDTH = 330;

// Catégories : soit une requête Wikidata (les plus connus d'abord), soit une liste d'articles choisis.
const CATS = {
  fleuve: { name: 'Fleuves et rivières', one: 'fleuve', sparql: '?item wdt:P31 wd:Q4022; wdt:P18 ?img.', min: 40, n: 45 },
  montagne: { name: 'Montagnes', one: 'montagne', sparql: '?item wdt:P31 wd:Q8502; wdt:P18 ?img.', min: 30, n: 40, skip: ['Mont Rushmore', 'Mont Athos'] },
  drapeau: { name: 'Drapeaux', one: 'drapeau', sparql: '?item wdt:P31 wd:Q6256; wdt:P41 ?img.', min: 0, n: 80, flag: true },
  capitale: { name: 'Capitales', one: 'capitale', sparql: '?c wdt:P31 wd:Q6256; wdt:P36 ?item. ?item wdt:P18 ?img.', min: 60, n: 50, skip: ['Jérusalem'] },
  instrument: { name: 'Instruments de musique', one: 'instrument', sparql: '?item wdt:P279/wdt:P279* wd:Q34379; wdt:P18 ?img.', min: 30, n: 36,
    skip: ['Microphone', 'Cloche', 'Sifflet', 'Haut-parleur', 'Corne de brume', 'Instrument de musique électronique', 'Toupie', 'Instrument à cordes', 'Instrument de percussion', 'Instrument à vent', 'Phonographe'] },
  animal: { name: 'Animaux', one: 'animal', titles: [
    'Lion', 'Tigre', 'Loup gris', 'Léopard', 'Guépard', 'Jaguar', 'Panda géant', 'Ours blanc', 'Ours brun', 'Girafe', 'Zèbre des plaines',
    'Hippopotame amphibie', 'Rhinocéros blanc', 'Éléphant de savane d\'Afrique', 'Chameau de Bactriane', 'Dromadaire', 'Kangourou roux',
    'Koala', 'Paresseux', 'Fourmilier géant', 'Ornithorynque', 'Castor européen', 'Hérisson d\'Europe', 'Renard roux', 'Blaireau européen',
    'Lynx boréal', 'Gorille', 'Chimpanzé commun', 'Orang-outan', 'Suricate', 'Raton laveur', 'Loutre d\'Europe', 'Morse (animal)', 'Phoque veau-marin',
    'Dauphin commun', 'Orque', 'Baleine à bosse', 'Requin blanc', 'Raie manta', 'Pieuvre', 'Méduse (animal)', 'Hippocampe (poisson)', 'Tortue verte',
    'Crocodile du Nil', 'Caméléon', 'Iguane vert', 'Cobra royal', 'Grenouille rousse', 'Axolotl', 'Manchot empereur', 'Flamant rose',
    'Paon bleu', 'Autruche d\'Afrique', 'Pygargue à tête blanche', 'Toucan toco', 'Chouette effraie', 'Colibri', 'Pélican blanc',
    'Abeille domestique', 'Coccinelle à sept points', 'Monarque (papillon)', 'Mante religieuse', 'Fourmi', 'Scorpion', 'Escargot',
    'Bouquetin des Alpes', 'Chamois', 'Marmotte des Alpes', 'Cerf élaphe', 'Élan', 'Bison d\'Amérique du Nord', 'Yack', 'Lama (animal)', 'Alpaga' ] },
  monument: { name: 'Monuments', one: 'monument', titles: [
    'Tour Eiffel', 'Statue de la Liberté', 'Colisée', 'Taj Mahal', 'Grande Muraille', 'Machu Picchu', 'Pyramide de Khéops', 'Sphinx de Gizeh',
    'Stonehenge', 'Acropole d\'Athènes', 'Parthénon', 'Sagrada Família', 'Big Ben', 'Tower Bridge', 'Burj Khalifa', 'Opéra de Sydney',
    'Tour de Pise', 'Cathédrale Notre-Dame de Paris', 'Mont-Saint-Michel', 'Arc de triomphe de l\'Étoile', 'Château de Versailles',
    'Kremlin de Moscou', 'Cathédrale Saint-Basile-le-Bienheureux', 'Cité interdite', 'Petra', 'Angkor Vat', 'Chichén Itzá', 'Alhambra (Grenade)',
    'Château de Neuschwanstein', 'Porte de Brandebourg', 'Golden Gate Bridge', 'Empire State Building', 'Mont Rushmore', 'Basilique Saint-Pierre',
    'Fontaine de Trevi', 'Basilique Sainte-Sophie', 'Atomium', 'Château de Chillon', 'Jet d\'eau de Genève', 'Kapellbrücke', 'Pont du Gard',
    'Tours Petronas', 'Space Needle', 'Moaï', 'Temple d\'Or', 'Mosquée Cheikh Zayed', 'Pagode Shwedagon', 'Pont Charles', 'Pyramide du Louvre' ] },
  peinture: { name: 'Tableaux célèbres', one: 'tableau', titles: [
    // Seulement des tableaux du domaine public : les œuvres encore protégées (Dalí, Picasso, Warhol, Magritte…) sont exclues.
    'La Joconde', 'La Nuit étoilée (Van Gogh)', 'La Jeune Fille à la perle', 'Le Cri', 'La Naissance de Vénus (Botticelli)',
    'La Grande Vague de Kanagawa', 'Les Ménines', 'La Cène (Léonard de Vinci)', 'Le Baiser (Klimt)', 'American Gothic',
    'La Liberté guidant le peuple', 'Impression, soleil levant', 'Le Radeau de La Méduse', 'Les Tournesols', 'La Création d\'Adam',
    'Le Jardin des délices', 'La Ronde de nuit', 'Le Déjeuner sur l\'herbe', 'Olympia (Manet)', 'Nighthawks',
    'Le Voyageur contemplant une mer de nuages', 'Le Tres de mayo', 'L\'École d\'Athènes', 'Les Glaneuses',
    'Un dimanche après-midi à l\'Île de la Grande Jatte', 'Bal du moulin de la Galette', 'La Laitière (Vermeer)', 'Les Nymphéas',
    'Le Sacre de Napoléon', 'La Dame à l\'hermine', 'Les Époux Arnolfini', 'Chasseurs dans la neige', 'La Tour de Babel (Bruegel)',
    'Composition en rouge, jaune, bleu et noir', 'Les Raboteurs de parquet' ] }, // « Le Pont japonais » retiré : son image Wikipédia est une photo, pas le tableau
  personne: { name: 'Personnalités', one: 'personnalité', titles: [
    'Albert Einstein', 'Marie Curie', 'Isaac Newton', 'Charles Darwin', 'Léonard de Vinci', 'Napoléon Ier', 'Jules César', 'Cléopâtre VII',
    'Abraham Lincoln', 'Winston Churchill', 'Charles de Gaulle', 'Nelson Mandela', 'Gandhi', 'Martin Luther King', 'Barack Obama',
    'Élisabeth II', 'Louis XIV', 'Victor Hugo', 'William Shakespeare', 'Molière', 'Wolfgang Amadeus Mozart', 'Ludwig van Beethoven',
    'Pablo Picasso', 'Vincent van Gogh', 'Frida Kahlo', 'Claude Monet', 'Charlie Chaplin', 'Marilyn Monroe', 'Elvis Presley',
    'Michael Jackson', 'Freddie Mercury', 'John Lennon', 'Bob Marley', 'Roger Federer', 'Lionel Messi', 'Cristiano Ronaldo', 'Pelé',
    'Zinédine Zidane', 'Serena Williams', 'Usain Bolt', 'Michael Jordan', 'Mohamed Ali', 'Neil Armstrong', 'Youri Gagarine', 'Thomas Edison',
    'Nikola Tesla', 'Sigmund Freud', 'Galilée (savant)', 'Christophe Colomb', 'Jeanne d\'Arc', 'Steve Jobs', 'Bill Gates', 'Walt Disney',
    'Coco Chanel', 'Audrey Hepburn', 'Che Guevara', 'Karl Marx', 'Jean-Jacques Rousseau', 'Henri Dunant', 'Alfred Nobel' ] },
  // Ajoutées le 15.11.2026 ; « since » : absentes des quiz du jour d'avant cette date (pour ne pas les changer).
  // Jeux vidéo : seules les images libres de Commons sont gardées (consoles surtout ; la plupart des jaquettes ne sont pas libres).
  jeuvideo: { name: 'Jeux vidéo', one: 'jeu vidéo ou console', since: '2026-11-16', titles: [
    'Nintendo Switch', 'PlayStation 5', 'PlayStation 4', 'PlayStation 2', 'PlayStation', 'PlayStation Portable', 'Xbox 360', 'Xbox One', 'Xbox',
    'Xbox Series', 'Nintendo Entertainment System', 'Super Nintendo', 'Nintendo 64', 'GameCube', 'Wii', 'Wii U', 'Game Boy', 'Game Boy Color',
    'Game Boy Advance', 'Nintendo DS', 'Nintendo 3DS', 'Mega Drive', 'Master System', 'Dreamcast', 'Game Gear', 'Atari 2600',
    'Virtual Boy', 'Neo-Geo AES', 'Borne d\'arcade', 'Manette de jeu', 'Joystick', 'Oculus Rift',
    'Clair Obscur: Expedition 33', 'Portal (jeu vidéo)', 'Pong', 'Pac-Man', 'Minecraft', 'Super Mario Bros.', 'Fortnite', '0 A.D.',
    'Pokémon Rouge et Bleu', 'Counter-Strike' ] },
  // Retirés après contrôle visuel : Rocket League, Tetris, League of Legends, SuperTuxKart, The Legend of Zelda, Space Invaders
  // (leur image est un logo ou une affiche qui écrit le nom = réponse donnée), Steam Deck (image noire), Casque de réalité virtuelle (doublon).
  sport: { name: 'Sport', one: 'sport', since: '2026-11-16', titles: [
    'Football', 'Basket-ball', 'Tennis', 'Rugby à XV', 'Handball', 'Volley-ball', 'Beach-volley', 'Natation', 'Water-polo', 'Plongeon',
    'Athlétisme', 'Saut à la perche', 'Lancer du javelot', 'Marathon (sport)', 'Cyclisme sur route', 'VTT', 'BMX', 'Ski alpin', 'Saut à ski',
    'Ski de fond', 'Biathlon', 'Snowboard', 'Hockey sur glace', 'Patinage artistique', 'Curling', 'Bobsleigh', 'Golf', 'Boxe anglaise',
    'Judo', 'Karaté', 'Escrime', 'Lutte', 'Sumo', 'Formule 1', 'Badminton', 'Tennis de table', 'Baseball', 'Football américain', 'Cricket',
    'Hockey sur gazon', 'Escalade', 'Surf', 'Skateboard', 'Équitation', 'Gymnastique artistique', 'Haltérophilie', 'Aviron', 'Canoë-kayak',
    'Voile (sport)', 'Tir à l\'arc', 'Polo', 'Pétanque', 'Bowling', 'Fléchettes', 'Lutte suisse' ] },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i >= tries) throw e; await sleep(2000 * (i + 1)); }
  }
}
const fileOf = u => decodeURIComponent(String(u).split('/').pop()).replace(/_/g, ' ');
const strip = h => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const clean = t => t.replace(/\s*\([^)]*\)\s*$/, '');

async function fromSparql(c) {
  const q = `SELECT ?item ?title ?img ?sl WHERE { ${c.sparql} ?item wikibase:sitelinks ?sl. FILTER(?sl>${c.min})
    ?art schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?title. } ORDER BY DESC(?sl) LIMIT ${c.n * 3}`;
  const j = await getJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
  const seen = new Map();
  for (const b of j.results.bindings) {
    const t = b.title.value;
    if (seen.has(t) || (c.skip || []).includes(t)) continue;
    seen.set(t, { title: t, file: fileOf(b.img.value), sl: +b.sl.value });
  }
  return [...seen.values()].slice(0, c.n);
}
// Image choisie à la main quand celle de l'article ne montre pas bien le sujet.
const IMG_OVERRIDE = { 'Natation': 'Swimming.breaststroke.arp.750pix.jpg' }; // l'article montre un bébé sous l'eau
async function fromTitles(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const part = titles.slice(i, i + 40);
    const j = await getJSON('https://fr.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages|pageprops&piprop=name&ppprop=wikibase_item&titles=' + encodeURIComponent(part.join('|')));
    const pages = Object.values(j.query.pages || {});
    const byTitle = new Map(pages.map(p => [p.title, p]));
    const redir = new Map((j.query.redirects || []).concat(j.query.normalized || []).map(r => [r.from, r.to]));
    part.forEach((t, k) => {
      let tt = t; for (let n = 0; n < 3 && redir.has(tt); n++) tt = redir.get(tt);
      const p = byTitle.get(tt);
      if (!p || p.missing !== undefined || !p.pageimage) { console.warn('  ✗ ' + t); return; }
      out.push({ title: p.title, label: t, file: IMG_OVERRIDE[t] || p.pageimage.replace(/_/g, ' '), sl: 1000 - (i + k) });
    });
  }
  return out;
}
// Descriptions courtes (Wikidata) et infos d'image (Commons) pour une liste.
async function describe(list) {
  for (let i = 0; i < list.length; i += 40) {
    const part = list.slice(i, i + 40);
    const j = await getJSON('https://fr.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=description&titles=' + encodeURIComponent(part.map(x => x.title).join('|')));
    const d = new Map(Object.values(j.query.pages || {}).map(p => [p.title, p.description]));
    part.forEach(x => { x.desc = d.get(x.title) || ''; });
    const f = await getJSON('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=' + WIDTH + '&titles=' + encodeURIComponent(part.map(x => 'File:' + x.file).join('|')));
    const norm = new Map((f.query.normalized || []).map(r => [r.to, r.from]));
    const info = new Map();
    Object.values(f.query.pages || {}).forEach(p => { if (p.imageinfo) info.set((norm.get(p.title) || p.title).replace(/^File:|^Fichier:/, ''), p.imageinfo[0]); });
    part.forEach(x => {
      const ii = info.get(x.file) || info.get(x.file.replace(/_/g, ' '));
      if (!ii) { x.bad = true; return; }
      const m = ii.extmetadata || {};
      x.thumb = ii.thumburl; x.page = ii.descriptionurl; x.lu = strip(m.LicenseUrl && m.LicenseUrl.value).replace(/^http:/, 'https:'); // lien vers le texte de la licence
      x.credit = [strip(m.Artist && m.Artist.value).slice(0, 80) || 'Wikimedia Commons', strip(m.LicenseShortName && m.LicenseShortName.value)].filter(Boolean).join(' · ');
    });
    await sleep(300);
  }
  return list.filter(x => !x.bad && x.thumb);
}

// node tools/make-quiz.js               → reconstruit toute la banque
// node tools/make-quiz.js sport jeuvideo → ne (re)construit que ces catégories, le reste est gardé tel quel
(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const only = process.argv.slice(2);
  let items = [], cats = {};
  if (only.length) {
    const old = JSON.parse(fs.readFileSync(path.join(OUT, 'questions.json'), 'utf8'));
    cats = old.cats; items = old.items.filter(i => !only.includes(i.c));
  }
  for (const [key, c] of Object.entries(CATS)) {
    if (only.length && !only.includes(key)) continue;
    process.stdout.write(key + '… ');
    let list = c.sparql ? await fromSparql(c) : await fromTitles(c.titles);
    list = await describe(list);
    cats[key] = { name: c.name, one: c.one, flag: !!c.flag };
    if (c.since) cats[key].since = c.since;
    for (const x of list) {
      const id = crypto.createHash('sha256').update(key + '|' + x.title).digest('hex').slice(0, 10);
      const file = path.join(IMG, id + '.jpg');
      if (!fs.existsSync(file)) {
        try {
          const r = await fetch(x.thumb, { headers: UA });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
          await sleep(150);
        } catch (e) { console.warn('  ✗ image ' + x.title + ' : ' + e.message); continue; }
      }
      items.push({ id, c: key, l: clean(x.label || x.title).replace(/^Ville de /, ''), t: x.title, d: x.desc, r: x.sl, cr: x.credit, src: x.page, ...(x.lu ? { lu: x.lu } : {}) });
    }
    console.log(items.filter(i => i.c === key).length);
  }
  // Rang de notoriété dans la catégorie (0 = le plus connu) : sert à doser la difficulté.
  for (const key of Object.keys(cats)) {
    if (only.length && !only.includes(key)) continue; // catégories gardées : rang déjà calculé
    items.filter(i => i.c === key).sort((a, b) => b.r - a.r).forEach((it, k) => { it.r = k; });
  }
  fs.writeFileSync(path.join(OUT, 'questions.json'), JSON.stringify({ v: 1, cats, items }));
  console.log('Total :', items.length, 'éléments');
})();
