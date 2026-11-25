// Rappel des défis du jour (notifications), partagé par la course (index.html) et le quiz (quiz.html).
// Proposé seulement après avoir joué un défi du jour ; envoyé à 18 h si on n'a pas encore joué (voir dailyReminder).
// WDRemind.init({ db: () => db, uid: () => uid, store, accent: 'var(--flag)' }) puis WDRemind.maybeAsk() / toggle().
'use strict';
window.WDRemind = (function () {
  const VAPID_PUBLIC = 'BJy6n4uraZoMR59gu3TDVYiHxa-PAtcEvqK17PPo0Mp0F24JvkN_7YAiJ8P-FSReOrIksnjCQ6B4JDIFycgPITo';
  const ASK_AGAIN = 14 * 864e5; // après « Non merci », on ne redemande pas avant 14 jours
  let D = null, sheet = null;

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const on = () => !!(D && D.store.get('wd-remind')) && 'Notification' in window && Notification.permission === 'granted';
  const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const swReady = () => navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);

  function css() {
    if (document.getElementById('wdrCss')) return;
    const s = document.createElement('style'); s.id = 'wdrCss';
    s.textContent = '.wdr{position:fixed;inset:0;z-index:40;display:grid;place-items:end center;padding:16px;background:rgba(8,14,32,.45)}' +
      '.wdr[hidden]{display:none}' +
      '.wdr-card{width:100%;max-width:420px;display:grid;gap:10px;padding:20px;border-radius:20px;background:var(--card);color:var(--ink);border:1px solid var(--line);box-shadow:0 20px 60px rgba(10,20,50,.3);animation:wdrUp .25s ease}' +
      '@keyframes wdrUp{from{transform:translateY(30px);opacity:0}}' +
      '@media (prefers-reduced-motion: reduce){.wdr-card{animation:none}}' +
      '.wdr-card b{font:800 20px/1.2 var(--display)}.wdr-card p{margin:0;color:var(--muted);font-size:15px;line-height:1.45}' +
      '.wdr-card .wdr-ic{font-size:34px;line-height:1}' +
      '.wdr-btns{display:grid;gap:8px;margin-top:4px}' +
      '.wdr-btns button{min-height:50px;border-radius:14px;border:0;font:800 17px var(--display);cursor:pointer}' +
      '.wdr-yes{background:' + (D.accent || 'var(--flag)') + ';color:#fff}.wdr-no{background:none;color:var(--muted);border:1px solid var(--line)!important}';
    document.head.appendChild(s);
  }
  function msg(icon, title, text, buttons) {
    css();
    if (!sheet) {
      sheet = document.createElement('div'); sheet.className = 'wdr'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
      sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = '<div class="wdr-card"><span class="wdr-ic" aria-hidden="true">' + icon + '</span><b>' + title + '</b><p>' + text + '</p>' +
      (buttons ? '<div class="wdr-btns">' + buttons + '</div>' : '') + '</div>';
    sheet.hidden = false;
    const first = sheet.querySelector('button'); if (first) first.focus();
  }
  function close() { if (sheet) sheet.hidden = true; }
  function done(icon, title, text) { msg(icon, title, text, '<button type="button" class="wdr-no">OK</button>'); sheet.querySelector('.wdr-no').onclick = close; }

  async function enable() {
    if (!supported()) return { ok: false, why: 'unsupported' };
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, why: 'denied' };
    try {
      const reg = await swReady();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
      const j = sub.toJSON();
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
      await D.db().ref('pushSubs/' + D.uid() + '/' + id).set({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, at: firebase.database.ServerValue.TIMESTAMP });
      D.store.set('wd-remind', id);
      return { ok: true };
    } catch (e) { return { ok: false, why: 'error', error: e.message || String(e) }; }
  }
  async function disable() {
    const id = D.store.get('wd-remind'); D.store.del('wd-remind');
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) {}
    try { if (id) await D.db().ref('pushSubs/' + D.uid() + '/' + id).remove(); } catch (e) {}
  }
  async function accept() {
    msg('⏳', 'Un instant…', 'Autorise les notifications quand ton navigateur le demande.');
    const r = await enable();
    if (r.ok) done('🔔', 'C’est noté !', 'Si tu n’as pas encore joué, on te fait signe à 18 h. Tu peux l’arrêter à tout moment depuis le menu ⚙️.');
    else if (r.why === 'denied') done('🔕', 'Notifications bloquées', 'Tu peux les autoriser plus tard dans les réglages de ton navigateur.');
    else done('😕', 'Rappel impossible', r.error ? 'Erreur : ' + r.error : 'Ton navigateur ne gère pas les notifications.');
  }

  return {
    init(deps) { D = deps; },
    supported, on, enable, disable,
    // Après un défi du jour : proposer le rappel (une fois ; pas avant 14 jours après un refus).
    maybeAsk(streak) {
      if (!D || !supported() || on() || Notification.permission === 'denied') return false;
      if (Date.now() - (+D.store.get('wd-remind-no') || 0) < ASK_AGAIN) return false;
      const keep = streak > 0 ? 'Garde ta série de ' + streak + ' jour' + (streak > 1 ? 's' : '') + ' 🔥 : ' : '';
      msg('🔔', 'On te le rappelle demain ?', keep + 'un nouveau défi et un nouveau quiz sortent chaque jour à minuit. Si tu n’as pas encore joué, on te fait signe à 18 h. Une seule notification par jour, au plus.',
        '<button type="button" class="wdr-yes">Oui, préviens-moi</button><button type="button" class="wdr-no">Non merci</button>');
      sheet.querySelector('.wdr-yes').onclick = accept;
      sheet.querySelector('.wdr-no').onclick = () => { D.store.set('wd-remind-no', Date.now()); close(); };
      return true;
    },
    // Menu : activer / arrêter. Renvoie un texte court pour un toast (ou rien si une fenêtre s'affiche).
    async toggle() {
      if (on()) { await disable(); return '🔕 Rappel arrêté'; }
      if (!supported()) {
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        done('📱', 'Rappel indisponible ici', ios ? 'Sur iPhone, installe d’abord WikiDuel : touche Partager, puis « Sur l’écran d’accueil », et active le rappel depuis l’appli.' : 'Ton navigateur ne gère pas les notifications.');
        return '';
      }
      await accept(); return '';
    }
  };
})();
