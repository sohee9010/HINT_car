// Leaderboard backend for 날아라 슈퍼카.
//  - online: Firebase (Firestore + anonymous sign-in), when config.js has a firebaseConfig.
//            Everyone shares one live board; each player has one document holding their best run.
//  - local:  this browser only (localStorage), so the game works before Firebase is set up or offline.
// The game talks only to window.Leaderboard: start(onChange), submit(nick, score) and .me.
(function () {
  const cfg = (window.SUPERCAR_CONFIG || {}).firebase || {};
  const online = !!(cfg.apiKey && cfg.projectId);
  const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const COLLECTION = 'scores';
  const BOARD_SIZE = 50;

  // rows: [{ id, nick, score, at }] sorted best first, one per player
  const byScore = (a, b) => b.score - a.score || a.at - b.at;

  // ---------- local (this browser) ----------
  // Several people may share one device, so each nickname keeps its own best.
  const LOCAL_KEY = 'supercar-local-board';
  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { return []; }
  };
  const local = {
    async start(onChange) {
      onChange(readLocal().sort(byScore).slice(0, BOARD_SIZE), 'ready');
    },
    async submit(nick, score, onChange) {
      const list = readLocal();
      const mine = list.find(r => r.id === nick);
      const prev = mine ? mine.score : -1;
      if (score <= prev) return { best: false, myBest: prev };
      const next = list.filter(r => r.id !== nick).concat({ id: nick, nick, score, at: Date.now() });
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch (e) { throw new Error('storage'); }
      onChange(next.sort(byScore).slice(0, BOARD_SIZE), 'ready');
      return { best: true, myBest: score };
    },
  };

  // ---------- online (Firebase) ----------
  // Anonymous sign-in gives each browser a stable uid without any account screen;
  // the Firestore rules let a player write only scores/<their uid>.
  let fs = null, uid = null, rows = [];
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script'));
      document.head.appendChild(s);
    });
  }
  const toRow = d => {
    const v = d.data() || {};
    return { id: d.id, nick: String(v.nick || ''), score: Number(v.score) || 0, at: v.at && v.at.toMillis ? v.at.toMillis() : 0 };
  };

  const remote = {
    async start(onChange) {
      onChange([], 'loading');
      try {
        for (const file of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) {
          await loadScript(FIREBASE_SDK + file);
        }
        firebase.initializeApp(cfg);
        fs = firebase.firestore();
      } catch (e) {
        onChange(rows, 'error');
        return;
      }
      // Reading the board needs no sign-in; posting does. If anonymous sign-in is off in the
      // Firebase console, the board still shows and only submit() fails.
      firebase.auth().signInAnonymously()
        .then(cred => { uid = cred.user.uid; })
        .catch(e => console.warn('Leaderboard: anonymous sign-in failed (enable it under Authentication → Sign-in method).', e.code));
      // Live: Firestore pushes every change to the top of the board
      fs.collection(COLLECTION).orderBy('score', 'desc').limit(BOARD_SIZE).onSnapshot(
        snap => { rows = snap.docs.map(toRow); onChange(rows, 'ready'); },
        () => onChange(rows, 'error'),
      );
    },
    async submit(nick, score) {
      if (!fs || !uid) throw new Error('offline');
      const ref = fs.collection(COLLECTION).doc(uid);
      const snap = await ref.get();
      const prev = snap.exists ? Number(snap.data().score) || 0 : -1;
      if (score > prev) {
        await ref.set({ nick, score, at: firebase.firestore.FieldValue.serverTimestamp() });
        return { best: true, myBest: score };
      }
      if (snap.data().nick !== nick) await ref.update({ nick });   // keep the board's name current
      return { best: false, myBest: prev };
    },
  };

  const backend = online ? remote : local;
  let notify = () => {};
  window.Leaderboard = {
    mode: online ? 'online' : 'local',
    /** This player's id on the online board (null until signed in, and in local mode). */
    get me() { return online ? uid : null; },
    /** Begin loading; onChange(rows, state) fires with state 'loading' | 'ready' | 'error'. */
    start(onChange) {
      notify = onChange;
      return backend.start(onChange);
    },
    /** Record a run if it beats this player's best. Resolves { best, myBest }. */
    submit(nick, score) {
      return backend.submit(nick, score, notify);
    },
  };
})();
