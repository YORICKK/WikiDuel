// Bande-son des vidéos WikiDuel, entièrement synthétisée (aucun échantillon, aucune musique sous droits) :
// une boucle rétro type 8 bits + des bruitages calés sur les événements du tournage.
//   const { buildAudio } = require('./make-sound'); fs.writeFileSync('son.wav', buildAudio(durée, événements));
// Événements : { type, at } (at en secondes depuis le début de la vidéo). Types : title, count, question, tick,
// tap, ok, ko, results, end.
'use strict';
const SR = 44100;

function buildAudio(duration, events) {
  const n = Math.ceil((duration + 0.5) * SR);
  const music = new Float32Array(n), fx = new Float32Array(n);
  const midi = m => 440 * Math.pow(2, (m - 69) / 12);
  const sq = (p, duty) => ((p % 1) < (duty || 0.5) ? 1 : -1);
  const tri = p => 1 - 4 * Math.abs((p % 1) - 0.5);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  // Ajoute une note : forme d'onde, fréquence (ou fonction du temps), début, durée, volume, attaque, extinction.
  function note(buf, wave, f, t0, dur, vol, att = 0.005, rel = 0.08) {
    const s0 = Math.floor(t0 * SR), len = Math.floor((dur + rel) * SR);
    let ph = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      if (s0 + i < 0) continue;
      const t = i / SR, freq = typeof f === 'function' ? f(t) : f;
      ph += freq / SR;
      const env = t < att ? t / att : t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel);
      buf[s0 + i] += wave(ph) * env * vol;
    }
  }
  const noise = (buf, t0, dur, vol, hp) => {
    const s0 = Math.floor(t0 * SR), len = Math.floor(dur * SR); let prev = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const w = rnd(), v = hp ? w - prev : w; prev = w;
      buf[s0 + i] += v * vol * Math.pow(1 - i / len, 2);
    }
  };

  // ---- Musique : I–vi–IV–V en do majeur, 118 bpm, basse carrée + arpège triangle + batterie légère ----
  const bpm = 118, beat = 60 / bpm, bar = 4 * beat;
  const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]]; // C, Am, F, G
  const start = 0.15, end = duration - 0.6;
  for (let b = 0; start + b * bar < end; b++) {
    const t = start + b * bar, ch = chords[b % 4];
    for (let e = 0; e < 8; e++) {                                   // basse en croches
      const m = ch[0] - 12 + (e % 4 === 2 ? 12 : 0);
      note(music, p => sq(p, 0.5), midi(m), t + e * beat / 2, beat / 2 * 0.8, 0.10, 0.003, 0.03);
    }
    for (let s = 0; s < 16; s++) {                                  // arpège en doubles croches
      const m = ch[s % 3] + 12 + (s % 6 >= 3 ? 12 : 0);
      note(music, tri, midi(m), t + s * beat / 4, beat / 4 * 0.7, 0.055, 0.002, 0.02);
    }
    if (b % 2 === 1) {                                              // petite mélodie toutes les deux mesures
      const mel = [ch[2] + 24, ch[1] + 24, ch[0] + 24, ch[1] + 24];
      mel.forEach((m, k) => note(music, p => sq(p, 0.25), midi(m), t + k * beat, beat * 0.6, 0.045, 0.004, 0.06));
    }
    for (let k = 0; k < 4; k++) {                                   // grosse caisse et charleston
      if (k % 2 === 0) note(music, p => Math.sin(2 * Math.PI * p), tt => 120 * Math.exp(-tt * 25) + 45, t + k * beat, 0.12, 0.35, 0.001, 0.05);
      noise(music, t + k * beat + beat / 2, 0.04, 0.05, true);
      if (k % 2 === 1) noise(music, t + k * beat, 0.12, 0.08, false); // caisse claire
    }
  }
  // Fondu d'entrée et de sortie ; musique plus discrète pendant les questions.
  const qSpans = [];
  events.forEach((e, i) => { if (e.type === 'question') { const nxt = events.slice(i + 1).find(x => x.type === 'ok' || x.type === 'ko'); if (nxt) qSpans.push([e.at, nxt.at + 0.3]); } });
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let g = Math.min(1, t / 0.8, Math.max(0, (duration - t) / 1.2));
    if (qSpans.some(([a, z]) => t > a && t < z)) g *= 0.6;
    music[i] *= g;
  }

  // ---- Bruitages ----
  for (const e of events) {
    const t = e.at;
    switch (e.type) {
      case 'title': note(fx, tri, tt => 300 + 900 * tt / 0.35, t, 0.35, 0.25, 0.01, 0.1); break;          // « woosh » montant
      case 'count': note(fx, p => sq(p, 0.5), 660, t, 0.09, 0.22, 0.002, 0.04); break;                     // bip
      case 'question': note(fx, tri, tt => 500 + 700 * tt / 0.18, t, 0.18, 0.18, 0.005, 0.05); noise(fx, t, 0.12, 0.05, true); break;
      case 'tick': note(fx, p => sq(p, 0.5), 1500, t, 0.015, 0.10, 0.001, 0.015); break;                     // tic-tac
      case 'tap': noise(fx, t, 0.03, 0.35, true); note(fx, tri, 900, t, 0.03, 0.15, 0.001, 0.02); break;     // clic
      case 'ok': [76, 83, 88].forEach((m, k) => note(fx, p => sq(p, 0.25), midi(m), t + k * 0.07, 0.12, 0.2, 0.003, 0.12)); break; // ding
      case 'ko': note(fx, p => sq(p, 0.5), tt => 160 - 50 * tt / 0.45, t, 0.45, 0.24, 0.005, 0.08);
                 note(fx, p => sq(p, 0.5), tt => 168 - 50 * tt / 0.45, t, 0.45, 0.18, 0.005, 0.08); break;   // buzzer
      case 'results': [72, 76, 79, 84, 79, 84].forEach((m, k) => note(fx, p => sq(p, 0.25), midi(m), t + k * 0.11, k === 5 ? 0.5 : 0.09, 0.2, 0.003, 0.15)); break;
      case 'end': [60, 64, 67, 72].forEach(m => note(fx, tri, midi(m), t, 1.4, 0.12, 0.02, 0.8)); break;     // accord final
    }
  }

  // Mixage, limiteur doux, PCM 16 bits.
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.tanh((music[i] * 0.9 + fx[i]) * 1.1) * 0.9;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
module.exports = { buildAudio };
