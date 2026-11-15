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
  { id: 'technologie', name: 'Technologie', emoji: '⚙️', sections: ['Technologie'] },
  // Thèmes choisis à la main (absents des articles vitaux) ; chaque titre est vérifié sur Wikipédia.
  { id: 'jeuxvideo', name: 'Jeux vidéo', emoji: '🎮', titles: [
    'Jeu vidéo', 'Console de jeux vidéo', 'Histoire du jeu vidéo', 'Jeu vidéo de rôle', 'Jeu de tir à la première personne', 'Jeu de plates-formes',
    'Jeu vidéo de course', 'Jeu de combat', 'Jeu de stratégie en temps réel', 'Battle royale (jeu vidéo)', 'Jeu en ligne massivement multijoueur',
    'Sport électronique', 'Speedrun', 'Jeu vidéo indépendant', 'Réalité virtuelle', 'Borne d\'arcade', 'Manette de jeu',
    'Nintendo', 'Sony Interactive Entertainment', 'Microsoft', 'Sega', 'Atari', 'Valve Corporation', 'Ubisoft', 'Electronic Arts', 'Epic Games',
    'Riot Games', 'Blizzard Entertainment', 'Rockstar Games', 'Bethesda Softworks', 'Square Enix', 'Capcom', 'Bandai Namco Entertainment',
    'PlayStation', 'PlayStation 2', 'PlayStation 4', 'PlayStation 5', 'Xbox', 'Xbox 360', 'Nintendo Switch', 'Wii', 'Nintendo 64', 'Game Boy',
    'Nintendo DS', 'Super Nintendo', 'Nintendo Entertainment System', 'Mega Drive', 'Atari 2600', 'Steam (logiciel)', 'Twitch',
    'Pong', 'Pac-Man', 'Space Invaders', 'Tetris', 'Super Mario Bros.', 'Mario (personnage)', 'Luigi', 'Donkey Kong (jeu vidéo)',
    'The Legend of Zelda', 'Link (The Legend of Zelda)', 'Pokémon', 'Pikachu', 'Sonic the Hedgehog (personnage)', 'Lara Croft', 'Kirby',
    'Minecraft', 'Fortnite', 'Rocket League', 'Clair Obscur: Expedition 33', 'Portal (jeu vidéo)', 'Portal 2', 'Half-Life (jeu vidéo)',
    'Counter-Strike', 'League of Legends', 'World of Warcraft', 'Overwatch', 'Valorant', 'Dota 2', 'Grand Theft Auto V', 'Red Dead Redemption 2',
    'The Witcher 3: Wild Hunt', 'The Elder Scrolls V: Skyrim', 'Elden Ring', 'Dark Souls', 'Final Fantasy VII', 'Street Fighter II',
    'Mortal Kombat', 'Call of Duty', 'Assassin\'s Creed', 'Les Sims', 'SimCity', 'Age of Empires', 'StarCraft', 'Diablo (jeu vidéo)',
    'Doom (jeu vidéo, 1993)', 'Resident Evil', 'Metal Gear Solid', 'Tomb Raider', 'Crash Bandicoot', 'Rayman', 'Animal Crossing',
    'Mario Kart', 'Super Smash Bros.', 'Among Us', 'Hollow Knight', 'Celeste (jeu vidéo)', 'Undertale', 'Stardew Valley', 'Hades (jeu vidéo)',
    'Baldur\'s Gate 3', 'Cyberpunk 2077', 'FIFA (série de jeux vidéo)', 'Gran Turismo (série)', 'Shigeru Miyamoto', 'Hideo Kojima',
    'Hidetaka Miyazaki', 'Michel Ancel', 'Gabe Newell'
  ] },
  { id: 'sport', name: 'Sport', emoji: '⚽', titles: [
    'Sport', 'Jeux olympiques', 'Jeux olympiques d\'été', 'Jeux olympiques d\'hiver', 'Jeux paralympiques', 'Football', 'Coupe du monde de football',
    'Ligue des champions de l\'UEFA', 'Championnat d\'Europe de football', 'Ballon d\'or', 'Basket-ball', 'National Basketball Association',
    'Tennis', 'Roland-Garros', 'Tournoi de Wimbledon', 'Grand Chelem de tennis', 'Coupe Davis', 'Rugby à XV', 'Coupe du monde de rugby à XV',
    'Tournoi des Six Nations', 'Handball', 'Volley-ball', 'Natation', 'Athlétisme', 'Marathon (sport)', '100 mètres', 'Saut à la perche',
    'Cyclisme sur route', 'Tour de France', 'Giro d\'Italia', 'Ski alpin', 'Coupe du monde de ski alpin', 'Hockey sur glace', 'National Hockey League',
    'Golf', 'Boxe anglaise', 'Judo', 'Escrime', 'Formule 1', 'Grand Prix automobile de Monaco', '24 Heures du Mans', 'Moto GP',
    'Badminton', 'Tennis de table', 'Baseball', 'Football américain', 'Super Bowl', 'Cricket', 'Escalade', 'Surf', 'Skateboard', 'Snowboard',
    'Patinage artistique', 'Curling', 'Équitation', 'Gymnastique', 'Haltérophilie', 'Aviron', 'Voile (sport)', 'Triathlon', 'Biathlon',
    'Arts martiaux mixtes', 'Ultimate Fighting Championship', 'Pétanque', 'Lutte suisse', 'Dopage (sport)', 'Fédération internationale de football association',
    'Comité international olympique', 'Stade de France', 'Stade Santiago-Bernabéu', 'Camp Nou', 'Wembley Stadium', 'Real Madrid Club de Fútbol',
    'Football Club de Barcelone', 'Paris Saint-Germain Football Club', 'Manchester United Football Club', 'Olympique de Marseille', 'Juventus FC',
    'Bayern Munich', 'Los Angeles Lakers', 'Chicago Bulls', 'Pelé', 'Diego Maradona', 'Zinédine Zidane', 'Lionel Messi', 'Cristiano Ronaldo',
    'Kylian Mbappé', 'Michael Jordan', 'LeBron James', 'Kobe Bryant', 'Roger Federer', 'Rafael Nadal', 'Novak Djokovic', 'Serena Williams',
    'Usain Bolt', 'Michael Phelps', 'Mohamed Ali', 'Tiger Woods', 'Ayrton Senna', 'Michael Schumacher', 'Lewis Hamilton', 'Teddy Riner',
    'Tony Parker', 'Eddy Merckx', 'Marie-José Pérec', 'Simone Biles', 'Nadia Comăneci', 'Wayne Gretzky', 'Martina Hingis', 'Lara Gut-Behrami'
  ] }
];

const get = async url => (await fetch(url, UA)).json();
(async () => {
  const sec = (await get('https://fr.wikipedia.org/w/api.php?action=parse&format=json&prop=sections&page=' + encodeURIComponent(PAGE))).parse.sections;
  const top = sec.filter(s => s.level === '2').map(s => ({ index: s.index, title: s.line.replace(/\s*\(.*\)\s*$/, '') }));
  const out = { v: 1, themes: [] };
  for (const t of THEMES) {
    const titles = new Set();
    if (t.titles) {
      // Liste choisie : on garde le titre exact de l'article (redirections suivies), on écarte les pages absentes.
      for (let i = 0; i < t.titles.length; i += 50) {
        const part = t.titles.slice(i, i + 50);
        const j = await get('https://fr.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=' + encodeURIComponent(part.join('|')));
        Object.values(j.query.pages || {}).forEach(p => { if (p.missing === undefined && p.ns === 0) titles.add(p.title); else console.warn('  ✗ ' + p.title); });
      }
    }
    for (const name of (t.sections || [])) {
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
