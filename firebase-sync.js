// ================================================================
// Firebase 設定
// 下記の値を Firebase Console から取得して入力してください
// ================================================================
const FIREBASE_CONFIG = {
    apiKey:            "",   // ← 入力してください
    authDomain:        "",
    projectId:         "",
    storageBucket:     "",
    messagingSenderId: "",
    appId:             ""
};
// ================================================================

const firebaseSync = {
    db: null,
    isReady: false,

    init() {
        // 設定が未入力の場合はスキップ（オフラインモードで動作）
        if (!FIREBASE_CONFIG.apiKey) {
            console.info('GymFit: Firebase未設定 — ローカルのみで動作します');
            return;
        }
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            this.db = firebase.firestore();
            this.isReady = true;
        } catch (e) {
            console.warn('Firebase初期化エラー:', e);
        }
    },

    // 同期コードを取得（なければ自動生成）
    getSyncCode() {
        let code = localStorage.getItem('gymfit_sync_code');
        if (!code) {
            const part = () => Math.random().toString(36).substr(2, 4).toUpperCase();
            code = part() + '-' + part();
            localStorage.setItem('gymfit_sync_code', code);
        }
        return code;
    },

    // 同期コードを変更（機種変更時に旧コードを入力）
    setSyncCode(code) {
        const cleaned = code.toUpperCase().trim();
        localStorage.setItem('gymfit_sync_code', cleaned);
        return cleaned;
    },

    // Firestoreにデータを保存
    async push(history) {
        if (!this.isReady) return;
        const code = this.getSyncCode();
        try {
            await this.db.collection('users').doc(code).set({
                history,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.showStatus('同期済み ✓', false);
        } catch (e) {
            console.warn('同期（送信）エラー:', e);
            this.showStatus('同期失敗', true);
        }
    },

    // Firestoreからデータを取得
    async pull() {
        if (!this.isReady) return null;
        const code = this.getSyncCode();
        try {
            const doc = await this.db.collection('users').doc(code).get();
            if (doc.exists) return doc.data().history || [];
        } catch (e) {
            console.warn('同期（受信）エラー:', e);
        }
        return null;
    },

    // ローカルとリモートをマージ（IDで重複排除）
    async mergeWithLocal(localHistory) {
        this.showStatus('同期中...', false);
        const remote = await this.pull();
        if (!remote) {
            this.showStatus(this.isReady ? '同期済み ✓' : '', false);
            return localHistory;
        }
        const localIds = new Set(localHistory.map(s => s.id));
        const merged = [...localHistory, ...remote.filter(s => !localIds.has(s.id))]
            .sort((a, b) => b.startTime - a.startTime);
        this.showStatus('同期済み ✓', false);
        return merged;
    },

    showStatus(msg, isError) {
        const el = document.getElementById('sync-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'sync-status' + (isError ? ' sync-error' : '');
    }
};
