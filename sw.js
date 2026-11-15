// Service worker de WikiDuel : rend le site installable et affiche le rappel du défi du jour.
// Aucune mise en cache : le jeu est toujours chargé à jour depuis le réseau.
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Pages seulement : si le réseau est coupé, une petite page « hors ligne » au lieu d'une erreur.
const OFFLINE = '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>WikiDuel</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#14213d;color:#f6f7fb;font:600 18px system-ui;text-align:center;padding:24px">' +
  '<div><div style="font:800 44px system-ui">Wiki<span style="color:#ff5a36">Duel</span></div><p>Pas de connexion internet.<br>WikiDuel a besoin de Wikipédia pour jouer.</p>' +
  '<button onclick="location.reload()" style="font:800 17px system-ui;padding:14px 22px;border-radius:14px;border:0;background:#ff5a36;color:#fff">Réessayer</button></div></body></html>';
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

// Rappel envoyé par le serveur (voir dailyReminder dans functions/index.js).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'WikiDuel', {
    body: d.body || 'Le défi du jour est en ligne.',
    icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'wikiduel-daily', renotify: true,
    data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin));
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
