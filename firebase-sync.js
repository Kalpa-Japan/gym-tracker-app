// ================================================================
// Firebase 設定
// 下記の値を Firebase Console から取得して入力してください
// ================================================================
const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyCrEzuIP2-foQV1gWFzydx24UyzIt49cdY",
    authDomain:        "kalpa-1cd0b.firebaseapp.com",
    projectId:         "kalpa-1cd0b",
    storageBucket:     "kalpa-1cd0b.firebasestorage.app",
    messagingSenderId: "644140276952",
    appId:             "1:644140276952:web:2541498c07162dc164cbad"
};
// ================================================================

const firebaseSync = {
    db: null,
    auth: null,
    isReady: false,
    currentUser: null,
    authReady: false,
    authReadyResolvers: [],
    onAuthChangeCallback: null,

    init() {
        if (!FIREBASE_CONFIG.apiKey) {
            console.info('GymFit: Firebase未設定 — ローカルのみで動作します');
            return;
        }
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            this.db = firebase.firestore();
            this.auth = firebase.auth();
            this.isReady = true;

            // セッションをブラウザに永続化（通常リロードで維持）
            this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e =>
                console.warn('Auth persistence設定失敗:', e)
            );

            // リダイレクト復帰（iOS Safari向け）
            this.auth.getRedirectResult().catch(e => {
                if (e && e.code) console.warn('getRedirectResult エラー:', e);
            });

            // 認証状態の変化を監視
            this.auth.onAuthStateChanged(user => {
                this.currentUser = user || null;
                if (!this.authReady) {
                    this.authReady = true;
                    this.authReadyResolvers.forEach(r => r());
                    this.authReadyResolvers = [];
                }
                if (typeof this.onAuthChangeCallback === 'function') {
                    this.onAuthChangeCallback(this.currentUser);
                }
            });
        } catch (e) {
            console.warn('Firebase初期化エラー:', e);
        }
    },

    // 認証状態が確定するまで待機
    waitForAuthReady() {
        if (!this.isReady) return Promise.resolve();
        if (this.authReady) return Promise.resolve();
        return new Promise(resolve => this.authReadyResolvers.push(resolve));
    },

    // ホーム画面に追加されたPWAとして起動しているかを判定
    // 通常のSafariブラウザでは false → popup方式のほうがiOSのITPを回避できる
    isStandalonePWA() {
        if (window.navigator.standalone === true) return true;
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
        return false;
    },

    // Googleログイン
    async loginWithGoogle() {
        if (!this.isReady) {
            alert('Firebaseが初期化されていません。');
            return;
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            // PWAスタンドアロン時はpopup動作が不安定なのでredirectを使う
            // 通常のブラウザ（iOS Safariブラウザも含む）はpopupでITPを回避
            if (this.isStandalonePWA()) {
                await this.auth.signInWithRedirect(provider);
                return null;
            }
            const result = await this.auth.signInWithPopup(provider);
            return result.user;
        } catch (e) {
            console.warn('Googleログインエラー:', e);
            const msg = this.formatAuthError(e);
            this.showStatus(msg, true);
            alert(msg);
            throw e;
        }
    },

    // Firebase Auth のエラーコードを日本語メッセージに変換
    formatAuthError(e) {
        const code = e && e.code ? e.code : '';
        const map = {
            'auth/operation-not-allowed': 'Googleログインが未有効です。Firebase ConsoleでGoogleプロバイダを有効化してください。',
            'auth/unauthorized-domain': 'このドメインは承認されていません。Firebase Consoleの承認済みドメインに追加してください。',
            'auth/popup-blocked': 'ポップアップがブロックされました。ブラウザの設定を確認してください。',
            'auth/popup-closed-by-user': 'ログイン画面が閉じられました。',
            'auth/cancelled-popup-request': 'ログインがキャンセルされました。',
            'auth/network-request-failed': 'ネットワークエラー。接続を確認してください。',
            'auth/internal-error': 'Firebase内部エラー。Consoleの設定を確認してください。'
        };
        if (map[code]) return `ログイン失敗: ${map[code]} (${code})`;
        if (code) return `ログイン失敗: ${code}`;
        return `ログイン失敗: ${e && e.message ? e.message : '不明なエラー'}`;
    },

    async logout() {
        if (!this.isReady) return;
        try {
            await this.auth.signOut();
            this.showStatus('ログアウトしました', false);
        } catch (e) {
            console.warn('ログアウトエラー:', e);
        }
    },

    // 同期コードを取得（なければ自動生成）— 未ログイン時のフォールバック
    getSyncCode() {
        let code = localStorage.getItem('gymfit_sync_code');
        if (!code) {
            const part = () => Math.random().toString(36).substr(2, 4).toUpperCase();
            code = part() + '-' + part();
            localStorage.setItem('gymfit_sync_code', code);
        }
        return code;
    },

    setSyncCode(code) {
        const cleaned = code.toUpperCase().trim();
        localStorage.setItem('gymfit_sync_code', cleaned);
        return cleaned;
    },

    // 現在アクティブなFirestoreドキュメント参照を返す
    // ログイン時 → users/{uid} / 未ログイン時 → users/{syncCode}
    getActiveDocRef() {
        if (!this.db) return null;
        if (this.currentUser) {
            return this.db.collection('users').doc(this.currentUser.uid);
        }
        return this.db.collection('users').doc(this.getSyncCode());
    },

    async push(history) {
        if (!this.isReady) return;
        const ref = this.getActiveDocRef();
        if (!ref) return;
        try {
            const payload = {
                history,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (this.currentUser) payload.ownerUid = this.currentUser.uid;
            await ref.set(payload, { merge: true });
            this.showStatus('同期済み ✓', false);
        } catch (e) {
            console.warn('同期（送信）エラー:', e);
            this.showStatus('同期失敗', true);
        }
    },

    async pull() {
        if (!this.isReady) return null;
        const ref = this.getActiveDocRef();
        if (!ref) return null;
        try {
            const doc = await ref.get();
            if (doc.exists) return doc.data().history || [];
        } catch (e) {
            console.warn('同期（受信）エラー:', e);
        }
        return null;
    },

    // UIDを指定して読み取る（移行処理用）
    async pullUid(uid) {
        if (!this.isReady || !uid) return null;
        try {
            const doc = await this.db.collection('users').doc(uid).get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.warn('UID読み取りエラー:', e);
        }
        return null;
    },

    // 同期コードを指定して読み取る（移行処理用）
    async pullSyncCode(code) {
        if (!this.isReady || !code) return null;
        try {
            const doc = await this.db.collection('users').doc(code).get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.warn('同期コード読み取りエラー:', e);
        }
        return null;
    },

    // 重複排除マージ（IDベース）
    mergeById(a, b) {
        const ids = new Set(a.map(s => s.id));
        return [...a, ...b.filter(s => !ids.has(s.id))].sort((x, y) => y.startTime - x.startTime);
    },

    // ローカルとリモートをマージ（現在のアクティブドキュメントに対して）
    async mergeWithLocal(localHistory) {
        this.showStatus('同期中...', false);
        const remote = await this.pull();
        if (!remote) {
            this.showStatus(this.isReady ? '同期済み ✓' : '', false);
            return localHistory;
        }
        const merged = this.mergeById(localHistory, remote);
        this.showStatus('同期済み ✓', false);
        return merged;
    },

    // 初回ログイン時の移行処理
    // users/{uid} が既存ならそれとマージ
    // 未存在ならローカル履歴＋旧syncCodeのデータをマージしてusers/{uid}へ保存
    async migrateOnFirstLogin(uid, localHistory) {
        if (!this.isReady) return localHistory;
        this.showStatus('同期中...', false);
        const uidData = await this.pullUid(uid);
        if (uidData) {
            // 既存UIDドキュメントとマージ
            const remote = uidData.history || [];
            const merged = this.mergeById(localHistory, remote);
            if (merged.length > remote.length) {
                await this.db.collection('users').doc(uid).set({
                    history: merged,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    ownerUid: uid
                }, { merge: true });
            }
            this.showStatus('同期済み ✓', false);
            return merged;
        }

        // 新規UID — 旧sync-codeのデータも取り込み
        const legacyCode = localStorage.getItem('gymfit_sync_code');
        let legacyHistory = [];
        if (legacyCode) {
            const legacyData = await this.pullSyncCode(legacyCode);
            if (legacyData && Array.isArray(legacyData.history)) {
                legacyHistory = legacyData.history;
            }
        }
        const merged = this.mergeById(this.mergeById(localHistory, legacyHistory), []);
        await this.db.collection('users').doc(uid).set({
            history: merged,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            ownerUid: uid,
            migratedFromSyncCode: legacyCode || null
        });
        this.showStatus('同期済み ✓', false);
        return merged;
    },

    showStatus(msg, isError) {
        const el = document.getElementById('sync-status');
        if (el) {
            el.textContent = msg;
            el.className = 'sync-status' + (isError ? ' sync-error' : '');
        }
        const authEl = document.getElementById('auth-status');
        if (authEl) {
            authEl.textContent = msg;
            authEl.className = 'sync-status' + (isError ? ' sync-error' : '');
        }
    }
};
