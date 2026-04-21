// セッションの最大継続時間（分）— これを超えたら自動終了扱い
const MAX_SESSION_MINUTES = 120;

const app = {
    state: {
        activeSession: null,
        timerInterval: null,
        currentSets: 3,
        autofilledMachine: null,
        history: JSON.parse(localStorage.getItem('gymfit_history')) || []
    },

    async init() {
        firebaseSync.init();
        this.renderSetInputs();

        // 同期コードをまず即時表示（Firebaseの完了を待たない）
        this.updateSyncCodeDisplay();

        // 認証状態の変化を受けてUI更新・初回ログイン移行を実行
        let prevUid = undefined; // 初回コールバックで必ず UI を更新させるため undefined
        firebaseSync.onAuthChangeCallback = async (user) => {
            const newUid = user ? user.uid : null;
            this.renderAuthUI(user);
            // null → user の遷移でのみ移行フローを発火
            if (prevUid !== undefined && prevUid === null && newUid) {
                await this.onLoginTransition(user);
            }
            prevUid = newUid;
        };

        // 認証状態が確定するまで待つ（iOS でのリダイレクト復帰も考慮）
        await firebaseSync.waitForAuthReady();

        // 現在のアクティブドキュメント（UIDまたは同期コード）とマージ
        try {
            const merged = await firebaseSync.mergeWithLocal(this.state.history);
            if (merged.length !== this.state.history.length) {
                this.state.history = merged;
                localStorage.setItem('gymfit_history', JSON.stringify(merged));
            }
        } catch (e) {
            console.warn('Firebase merge error:', e);
        }

        this.updateStats();
        this.renderRecentSessions();
        this.renderAuthUI(firebaseSync.currentUser);

        // Restore active session from previous reload
        const savedSession = JSON.parse(localStorage.getItem('gymfit_active_session'));
        if (savedSession) {
            const elapsedMinutes = (Date.now() - savedSession.startTime) / 60000;
            if (elapsedMinutes > MAX_SESSION_MINUTES) {
                // 終了忘れと判断 — 2時間にキャップして自動的に履歴へ保存
                savedSession.durationMinutes = MAX_SESSION_MINUTES;
                savedSession.endTime = savedSession.startTime + MAX_SESSION_MINUTES * 60000;
                this.state.history.unshift(savedSession);
                localStorage.setItem('gymfit_history', JSON.stringify(this.state.history));
                localStorage.removeItem('gymfit_active_session');
                firebaseSync.push(this.state.history);
                this.updateStats();
                this.renderRecentSessions();
            } else {
                this.state.activeSession = savedSession;
                this.startTimer();
                this.renderCurrentExercises();
                this.toggleActiveSessionUI(true);
            }
        }
    },

    // --- Auth ---

    async onAuthClick() {
        if (firebaseSync.currentUser) {
            // ログイン中 → ログアウト確認
            if (confirm('ログアウトしますか？')) {
                await this.logout();
            }
        } else {
            // 未ログイン → Statsへ移動してログインCTAを目立たせる
            this.navigate('stats');
            const cta = document.getElementById('btn-google-login');
            if (cta) cta.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    async loginWithGoogle() {
        try {
            await firebaseSync.loginWithGoogle();
            // iOS はリダイレクトで戻ってくるので、ここで何もしない
            // popup の場合は onAuthStateChanged → onLoginTransition が発火
        } catch (e) {
            // エラーは firebase-sync 側で表示済み
        }
    },

    async logout() {
        await firebaseSync.logout();
        // ログアウト後は sync-code ベースに戻るので UI 更新
        this.renderAuthUI(null);
        try {
            const merged = await firebaseSync.mergeWithLocal(this.state.history);
            this.state.history = merged;
            localStorage.setItem('gymfit_history', JSON.stringify(merged));
            this.updateStats();
            this.renderRecentSessions();
        } catch (e) {
            console.warn('logout merge error:', e);
        }
    },

    // 初回ログイン成功時の移行 + マージ
    async onLoginTransition(user) {
        try {
            const merged = await firebaseSync.migrateOnFirstLogin(user.uid, this.state.history);
            this.state.history = merged;
            localStorage.setItem('gymfit_history', JSON.stringify(merged));
            this.updateStats();
            this.renderRecentSessions();
        } catch (e) {
            console.warn('login migration error:', e);
        }
    },

    renderAuthUI(user) {
        const btnAuth = document.getElementById('btn-auth');
        const loggedOut = document.getElementById('account-logged-out');
        const loggedIn = document.getElementById('account-logged-in');
        const emailEl = document.getElementById('account-email');

        if (user) {
            const initial = (user.email || user.displayName || '?').trim().charAt(0).toUpperCase();
            if (btnAuth) {
                btnAuth.innerHTML = `<span class="auth-avatar">${initial}</span>`;
                btnAuth.setAttribute('title', user.email || '');
            }
            if (loggedOut) loggedOut.classList.add('hidden');
            if (loggedIn) loggedIn.classList.remove('hidden');
            if (emailEl) emailEl.textContent = user.email || user.displayName || '(no email)';
        } else {
            if (btnAuth) {
                btnAuth.textContent = 'ログイン';
                btnAuth.removeAttribute('title');
            }
            if (loggedOut) loggedOut.classList.remove('hidden');
            if (loggedIn) loggedIn.classList.add('hidden');
            if (emailEl) emailEl.textContent = '-';
        }
    },

    saveHistory() {
        localStorage.setItem('gymfit_history', JSON.stringify(this.state.history));
        firebaseSync.push(this.state.history); // クラウドに自動同期
    },

    saveSessionState() {
        if (this.state.activeSession) {
            localStorage.setItem('gymfit_active_session', JSON.stringify(this.state.activeSession));
        } else {
            localStorage.removeItem('gymfit_active_session');
        }
    },

    navigate(viewId) {
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.remove('hidden'); // hidden + !important がactiveを上書きするのを防ぐ
        });
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

        document.getElementById(`view-${viewId}`).classList.add('active');
        document.getElementById(`nav-${viewId}`).classList.add('active');

        if (viewId === 'stats') {
            this.updateStats();
            this.updateSyncCodeDisplay();
        }
    },

    // --- Set management ---

    renderSetInputs() {
        const container = document.getElementById('sets-input-container');
        let html = '';
        for (let i = 1; i <= this.state.currentSets; i++) {
            // Set 1 inputs trigger auto-copy to other sets when no history
            const onSet1 = i === 1 ? 'onchange="app.onSet1Change()"' : '';
            html += `
                <div class="set-row">
                    <span>Set ${i}</span>
                    <input type="number" id="input-load-${i}" placeholder="負荷 (kg)" class="mini-input load-input" ${onSet1}>
                    <input type="number" id="input-reps-${i}" placeholder="回数" class="mini-input" ${onSet1}>
                </div>
            `;
        }
        container.innerHTML = html;
        document.getElementById('set-count-display').textContent = `${this.state.currentSets}`;
    },

    addSet() {
        if (this.state.currentSets >= 8) return;
        this.state.currentSets++;
        this.renderSetInputs();
    },

    removeSet() {
        if (this.state.currentSets <= 1) return;
        this.state.currentSets--;
        this.renderSetInputs();
    },

    // --- Session ---

    startSession() {
        const now = new Date();
        this.state.activeSession = {
            id: Date.now(),
            startTime: now.getTime(),
            exercises: []
        };

        this.startTimer();
        this.toggleActiveSessionUI(true);
        this.saveSessionState();
    },

    endSession() {
        if (!this.state.activeSession) return;
        if (!confirm('トレーニングを終了しますか？')) return;

        clearInterval(this.state.timerInterval);

        const now = new Date();
        const durationMs = now.getTime() - this.state.activeSession.startTime;
        let durationMinutes = Math.round(durationMs / 60000);
        // 上限を超えていたらキャップ（終了忘れの保険）
        if (durationMinutes > MAX_SESSION_MINUTES) durationMinutes = MAX_SESSION_MINUTES;
        this.state.activeSession.endTime = this.state.activeSession.startTime + durationMinutes * 60000;
        this.state.activeSession.durationMinutes = durationMinutes;

        this.state.history.unshift(this.state.activeSession);
        this.saveHistory();

        this.state.activeSession = null;
        this.saveSessionState();

        this.toggleActiveSessionUI(false);
        this.updateStats();
        this.renderRecentSessions();
        alert('トレーニングお疲れ様でした！記録を保存しました。');
    },

    toggleActiveSessionUI(isActive) {
        const btnStart = document.getElementById('btn-start-session');
        const activeArea = document.getElementById('active-session-area');
        const heroCard = document.getElementById('hero-card');

        if (isActive) {
            btnStart.classList.add('hidden');
            activeArea.classList.remove('hidden');
            heroCard.classList.add('hidden');
        } else {
            btnStart.classList.remove('hidden');
            activeArea.classList.add('hidden');
            heroCard.classList.remove('hidden');

            document.getElementById('input-machine-no').value = '';
            document.getElementById('input-machine-name').value = '';
            document.getElementById('history-hint').textContent = '';
            document.getElementById('current-exercises-list').innerHTML = '';
            this.state.currentSets = 3;
            this.state.autofilledMachine = null;
            this.renderSetInputs();
        }
    },

    startTimer() {
        if (this.state.timerInterval) clearInterval(this.state.timerInterval);

        const timerEl = document.getElementById('session-timer');
        this.state.timerInterval = setInterval(() => {
            if (!this.state.activeSession) return;
            const diff = Date.now() - this.state.activeSession.startTime;
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            timerEl.textContent = `${h}:${m}:${s}`;

            // 2時間を超えたら警告色に切り替え（終了忘れ防止）
            const overLimit = diff >= MAX_SESSION_MINUTES * 60000;
            timerEl.classList.toggle('timer-warning', overLimit);
        }, 1000);
    },

    // --- Exercise ---

    addExercise() {
        const mNo = document.getElementById('input-machine-no').value.trim();
        const mName = document.getElementById('input-machine-name').value.trim();

        if (!mNo && !mName) {
            alert('マシン番号か種目名を入力してください。');
            return;
        }

        const sets = [];
        for (let i = 1; i <= this.state.currentSets; i++) {
            const load = document.getElementById(`input-load-${i}`).value;
            const reps = document.getElementById(`input-reps-${i}`).value;
            sets.push({
                set: i,
                load: load ? parseFloat(load) : 0,
                reps: reps ? parseInt(reps) : 0
            });
        }

        this.state.activeSession.exercises.push({ machineNo: mNo, machineName: mName, sets });
        this.saveSessionState();
        this.renderCurrentExercises();

        // Reset inputs
        document.getElementById('input-machine-no').value = '';
        document.getElementById('input-machine-name').value = '';
        document.getElementById('history-hint').textContent = '';
        this.state.autofilledMachine = null;
        this.state.currentSets = 3;
        this.renderSetInputs();
    },

    removeExercise(idx) {
        if (!this.state.activeSession) return;
        this.state.activeSession.exercises.splice(idx, 1);
        this.saveSessionState();
        this.renderCurrentExercises();
    },

    renderCurrentExercises() {
        const list = document.getElementById('current-exercises-list');
        list.innerHTML = '';
        if (!this.state.activeSession) return;

        this.state.activeSession.exercises.forEach((ex, idx) => {
            const setsHtml = ex.sets.map(s => `
                <div class="set-result">
                    <span>Set ${s.set}</span>
                    <span>${s.load}kg × ${s.reps}回</span>
                </div>
            `).join('');

            list.innerHTML += `
                <div class="exercise-item">
                    <div class="exercise-header">
                        <span class="exercise-title">${ex.machineNo}: ${ex.machineName}</span>
                        <button class="delete-btn" onclick="app.removeExercise(${idx})">✕</button>
                    </div>
                    ${setsHtml}
                </div>
            `;
        });
    },

    checkForMachineHistory() {
        const mNo = document.getElementById('input-machine-no').value.trim().toLowerCase();
        const hintEl = document.getElementById('history-hint');
        const nameInput = document.getElementById('input-machine-name');

        if (mNo.length < 1) {
            hintEl.textContent = '';
            this.state.autofilledMachine = null;
            return;
        }

        for (let session of this.state.history) {
            for (let ex of session.exercises) {
                if (ex.machineNo.toLowerCase() === mNo) {
                    const maxLoad = Math.max(...ex.sets.map(s => s.load));
                    hintEl.textContent = `過去: ${ex.machineName}（最高負荷: ${maxLoad}kg）※前回の記録を自動入力`;

                    if (!nameInput.value) nameInput.value = ex.machineName;

                    if (this.state.autofilledMachine !== mNo) {
                        // Match set count to history entry
                        this.state.currentSets = ex.sets.length;
                        this.renderSetInputs();
                        ex.sets.forEach((s, i) => {
                            document.getElementById(`input-load-${i + 1}`).value = s.load;
                            document.getElementById(`input-reps-${i + 1}`).value = s.reps;
                        });
                        this.state.autofilledMachine = mNo;
                    }
                    return;
                }
            }
        }

        hintEl.textContent = '新規マシンです';
        this.state.autofilledMachine = null;
    },

    // 種目名で履歴を検索して自動入力
    checkForMachineHistoryByName() {
        const mName = document.getElementById('input-machine-name').value.trim().toLowerCase();
        const hintEl = document.getElementById('history-hint');
        const noInput = document.getElementById('input-machine-no');

        if (mName.length < 1) {
            hintEl.textContent = '';
            this.state.autofilledMachine = null;
            return;
        }

        for (let session of this.state.history) {
            for (let ex of session.exercises) {
                if (ex.machineName.toLowerCase().includes(mName)) {
                    const maxLoad = Math.max(...ex.sets.map(s => s.load));
                    hintEl.textContent = `過去: ${ex.machineNo}（最高負荷: ${maxLoad}kg）※前回の記録を自動入力`;

                    if (!noInput.value) noInput.value = ex.machineNo;

                    if (this.state.autofilledMachine !== mName) {
                        this.state.currentSets = ex.sets.length;
                        this.renderSetInputs();
                        ex.sets.forEach((s, i) => {
                            document.getElementById(`input-load-${i + 1}`).value = s.load;
                            document.getElementById(`input-reps-${i + 1}`).value = s.reps;
                        });
                        this.state.autofilledMachine = mName;
                    }
                    return;
                }
            }
        }
        hintEl.textContent = '新規マシンです';
        this.state.autofilledMachine = null;
    },

    // 過去データなしの場合、Set1の値をSet2以降にコピー
    onSet1Change() {
        if (this.state.autofilledMachine) return; // 履歴自動入力済みなら何もしない

        const load1 = document.getElementById('input-load-1')?.value;
        const reps1 = document.getElementById('input-reps-1')?.value;

        for (let i = 2; i <= this.state.currentSets; i++) {
            const loadEl = document.getElementById(`input-load-${i}`);
            const repsEl = document.getElementById(`input-reps-${i}`);
            if (loadEl && !loadEl.value && load1) loadEl.value = load1;
            if (repsEl && !repsEl.value && reps1) repsEl.value = reps1;
        }
    },

    // --- Search & Chart ---

    searchMachine() {
        const q = document.getElementById('search-machine-input').value.trim().toLowerCase();
        const resultsEl = document.getElementById('search-results');
        resultsEl.innerHTML = '';

        if (!q) {
            resultsEl.innerHTML = '<p>マシン番号を入力してください。</p>';
            return;
        }

        const hits = [];
        this.state.history.forEach(session => {
            session.exercises.forEach(ex => {
                if (ex.machineNo.toLowerCase().includes(q)) {
                    hits.push({ date: session.startTime, ex });
                }
            });
        });

        if (hits.length === 0) {
            resultsEl.innerHTML = '<p>過去の記録が見つかりませんでした。</p>';
            return;
        }

        // Chart (needs ≥2 data points)
        if (hits.length >= 2) {
            resultsEl.innerHTML = this.renderMachineChart(hits);
        }

        // History list
        hits.forEach(hit => {
            const dateStr = new Date(hit.date).toLocaleDateString('ja-JP',
                { year: 'numeric', month: 'long', day: 'numeric' });
            const setsHtml = hit.ex.sets.map(s =>
                `<div style="font-size:0.9rem;margin-top:0.2rem">Set ${s.set}: ${s.load}kg × ${s.reps}回</div>`
            ).join('');

            resultsEl.innerHTML += `
                <div class="history-item">
                    <div class="history-date">${dateStr}</div>
                    <div class="exercise-title" style="margin-bottom:0.5rem">
                        ${hit.ex.machineNo}: ${hit.ex.machineName}
                    </div>
                    ${setsHtml}
                </div>
            `;
        });
    },

    /**
     * Render an SVG line chart of max load per session for a machine.
     * @param {Array} hits - Array of { date, ex } objects
     * @returns {string} HTML string containing the chart
     */
    renderMachineChart(hits) {
        const W = 320, H = 160;
        const pad = { top: 20, right: 16, bottom: 32, left: 42 };
        const cW = W - pad.left - pad.right;
        const cH = H - pad.top - pad.bottom;

        // Sort by date, compute max load per session
        const sorted = [...hits]
            .sort((a, b) => a.date - b.date)
            .map(h => ({
                date: h.date,
                maxLoad: Math.max(...h.ex.sets.map(s => s.load))
            }));

        const loads = sorted.map(p => p.maxLoad);
        const maxL = Math.max(...loads);
        const minL = Math.min(...loads);
        const loadRange = maxL - minL || 1;

        const minD = sorted[0].date;
        const maxD = sorted[sorted.length - 1].date;
        const dateRange = maxD - minD || 1;

        const toX = d => pad.left + ((d - minD) / dateRange) * cW;
        const toY = l => pad.top + cH - ((l - minL) / loadRange) * cH;

        const pts = sorted.map(p => ({
            x: toX(p.date),
            y: toY(p.maxLoad),
            load: p.maxLoad,
            date: p.date
        }));
        const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

        // Y-axis: 3 ticks
        const yTicks = [minL, Math.round((minL + maxL) / 2), maxL];
        const yLabelsHtml = yTicks.map(l => {
            const y = toY(l);
            return `
                <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${(pad.left + cW).toFixed(1)}" y2="${y.toFixed(1)}"
                    stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                <text x="${(pad.left - 6).toFixed(1)}" y="${(y + 4).toFixed(1)}"
                    text-anchor="end" fill="#8E99A8" font-size="10">${l}kg</text>
            `;
        }).join('');

        // X-axis: up to 4 ticks
        const step = Math.max(1, Math.floor(sorted.length / 4));
        const xSamples = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);
        const xLabelsHtml = xSamples.map(p => {
            const x = toX(p.date);
            const label = new Date(p.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
            return `<text x="${x.toFixed(1)}" y="${(pad.top + cH + 18).toFixed(1)}"
                text-anchor="middle" fill="#8E99A8" font-size="10">${label}</text>`;
        }).join('');

        const dotsHtml = pts.map(p =>
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#00E676" stroke="#0B0E14" stroke-width="1.5"/>`
        ).join('');

        const areaPoints = `${pts[0].x.toFixed(1)},${(pad.top + cH).toFixed(1)} ${polyline} ${pts[pts.length - 1].x.toFixed(1)},${(pad.top + cH).toFixed(1)}`;

        return `
            <div class="chart-container">
                <p class="chart-title">最大負荷の推移</p>
                <svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="${areaPoints}" fill="rgba(0,230,118,0.08)"/>
                    <polyline points="${polyline}" fill="none" stroke="#00E676" stroke-width="2"
                        stroke-linejoin="round" stroke-linecap="round"/>
                    ${yLabelsHtml}
                    ${xLabelsHtml}
                    ${dotsHtml}
                </svg>
            </div>
        `;
    },

    // --- Stats ---

    updateStats() {
        const now = new Date();

        // 今週の開始
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const startOfWeek = new Date(now);
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);

        // 今月の開始
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        let weeklyMins = 0, weeklyCount = 0, monthlyCount = 0;

        this.state.history.forEach(s => {
            if (s.startTime >= startOfWeek.getTime()) {
                weeklyMins += (s.durationMinutes || 0);
                weeklyCount++;
            }
            if (s.startTime >= startOfMonth.getTime()) {
                monthlyCount++;
            }
        });

        const hrs = Math.floor(weeklyMins / 60);
        const mins = weeklyMins % 60;

        // 既存
        document.getElementById('stat-weekly-time').innerHTML  = `${hrs}<small>時間</small>${mins}<small>分</small>`;
        document.getElementById('stat-weekly-count').innerHTML = `${weeklyCount}<small>回</small>`;

        // 新規
        document.getElementById('stat-total-count').innerHTML   = `${this.state.history.length}<small>回</small>`;
        document.getElementById('stat-monthly-count').innerHTML = `${monthlyCount}<small>回</small>`;
        document.getElementById('stat-streak').innerHTML        = `${this.calculateStreak()}<small>日</small>`;

        this.renderWeeklyBarChart();
    },

    /**
     * 連続してトレーニングした日数を計算する。
     * 今日トレーニングがない場合は昨日から遡る。
     */
    calculateStreak() {
        if (this.state.history.length === 0) return 0;

        const dayKey = ts => {
            const d = new Date(ts);
            return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        };
        const trainedDays = new Set(this.state.history.map(s => dayKey(s.startTime)));

        const today = new Date();
        const todayKey = dayKey(today.getTime());

        // 今日トレーニングしていなければ昨日から数える
        const startOffset = trainedDays.has(todayKey) ? 0 : 1;
        let streak = 0;

        for (let i = startOffset; i < 365; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            if (trainedDays.has(dayKey(d.getTime()))) {
                streak++;
            } else {
                break;
            }
        }
        return streak;
    },

    /**
     * Render a bar chart of session counts for the past 6 weeks.
     */
    renderWeeklyBarChart() {
        const el = document.getElementById('weekly-bar-chart');
        if (!el) return;

        const now = new Date();
        const day = now.getDay();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
        weekStart.setHours(0, 0, 0, 0);

        const weeks = [];
        for (let i = 5; i >= 0; i--) {
            const start = new Date(weekStart.getTime() - i * 7 * 86400000);
            const end = new Date(start.getTime() + 7 * 86400000);
            const label = `${start.getMonth() + 1}/${start.getDate()}`;
            const count = this.state.history.filter(
                s => s.startTime >= start.getTime() && s.startTime < end.getTime()
            ).length;
            weeks.push({ label, count });
        }

        const maxCount = Math.max(...weeks.map(w => w.count), 1);
        const W = 320, H = 120;
        const pad = { top: 10, right: 10, bottom: 30, left: 28 };
        const cW = W - pad.left - pad.right;
        const cH = H - pad.top - pad.bottom;
        const barW = cW / weeks.length;
        const GAP = 6;

        const barsHtml = weeks.map((w, i) => {
            const barH = (w.count / maxCount) * cH;
            const x = pad.left + i * barW + GAP / 2;
            const y = pad.top + cH - barH;
            const labelX = x + (barW - GAP) / 2;
            return `
                <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}"
                    width="${(barW - GAP).toFixed(1)}" height="${Math.max(barH, 0).toFixed(1)}"
                    rx="4" fill="${w.count > 0 ? '#00E676' : 'rgba(255,255,255,0.08)'}"/>
                ${w.count > 0
                    ? `<text x="${labelX.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" fill="#00E676" font-size="10">${w.count}</text>`
                    : ''}
                <text x="${labelX.toFixed(1)}" y="${(pad.top + cH + 16).toFixed(1)}"
                    text-anchor="middle" fill="#8E99A8" font-size="10">${w.label}</text>
            `;
        }).join('');

        el.innerHTML = `
            <svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
                ${barsHtml}
                <text x="${(pad.left - 4).toFixed(1)}" y="${(pad.top + 4).toFixed(1)}"
                    text-anchor="end" fill="#8E99A8" font-size="10">${maxCount}</text>
                <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${(pad.top + cH).toFixed(1)}"
                    stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                <line x1="${pad.left}" y1="${(pad.top + cH).toFixed(1)}"
                    x2="${(pad.left + cW).toFixed(1)}" y2="${(pad.top + cH).toFixed(1)}"
                    stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
            </svg>
        `;
    },

    updateSyncCodeDisplay() {
        const el = document.getElementById('sync-code-value');
        if (el) el.textContent = firebaseSync.getSyncCode();
    },

    // --- Sync code management ---

    copySyncCode() {
        const code = firebaseSync.getSyncCode();
        navigator.clipboard.writeText(code).then(() => {
            firebaseSync.showStatus('コピーしました！', false);
            setTimeout(() => firebaseSync.showStatus('同期済み ✓', false), 2000);
        }).catch(() => {
            firebaseSync.showStatus(code, false);
        });
    },

    async applySyncCode() {
        if (firebaseSync.currentUser) {
            alert('既にログイン中です。ログアウトしてから同期コードを使用してください。');
            return;
        }
        const input = document.getElementById('sync-code-input');
        const newCode = input.value.trim().toUpperCase();
        if (!newCode || newCode.length < 4) {
            alert('有効な同期コードを入力してください。');
            return;
        }
        if (!confirm(`同期コードを「${newCode}」に変更します。このコードのクラウドデータと統合されます。よろしいですか？`)) return;

        firebaseSync.setSyncCode(newCode);
        document.getElementById('sync-code-value').textContent = newCode;
        input.value = '';

        // 新しいコードでデータを取得してマージ
        firebaseSync.showStatus('同期中...', false);
        const merged = await firebaseSync.mergeWithLocal(this.state.history);
        this.state.history = merged;
        this.saveHistory();
        this.updateStats();
        this.renderRecentSessions();
        alert('同期完了しました。');
    },

    // --- Data management ---

    exportData() {
        const data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            history: this.state.history
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gymfit-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data.history || !Array.isArray(data.history)) {
                        alert('無効なバックアップファイルです。');
                        return;
                    }
                    if (!confirm(`${data.history.length}件のセッションをインポートします。現在のデータと統合されます。よろしいですか？`)) return;

                    // Merge: IDが重複しないセッションのみ追加
                    const existingIds = new Set(this.state.history.map(s => s.id));
                    const newSessions = data.history.filter(s => !existingIds.has(s.id));
                    this.state.history = [...this.state.history, ...newSessions]
                        .sort((a, b) => b.startTime - a.startTime);

                    this.saveHistory();
                    this.updateStats();
                    this.renderRecentSessions();
                    alert(`インポート完了：${newSessions.length}件の新しいセッションを追加しました。`);
                } catch {
                    alert('ファイルの読み込みに失敗しました。正しいバックアップファイルか確認してください。');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    renderRecentSessions() {
        const list = document.getElementById('recent-sessions-list');
        list.innerHTML = '';

        if (this.state.history.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted)">まだ記録がありません。</p>';
            return;
        }

        this.state.history.slice(0, 3).forEach(s => {
            const dateStr = new Date(s.startTime).toLocaleDateString('ja-JP',
                { month: 'numeric', day: 'numeric' });
            list.innerHTML += `
                <div style="border-bottom:1px solid var(--glass-border);padding:0.8rem 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
                        <span style="font-weight:600">日付: ${dateStr}</span>
                        <button class="delete-btn" onclick="app.deleteHistorySession(${s.id})" aria-label="このセッションを削除">✕</button>
                    </div>
                    <div style="font-size:0.9rem;color:var(--text-muted);display:flex;gap:1rem;">
                        <span>種目数: ${s.exercises.length}</span>
                        <span style="color:var(--accent-primary)">時間: ${s.durationMinutes || 0}分</span>
                    </div>
                </div>
            `;
        });
    },

    // 履歴セッションを削除（確認あり）
    deleteHistorySession(id) {
        const idx = this.state.history.findIndex(s => s.id === id);
        if (idx < 0) return;
        const s = this.state.history[idx];
        const dateStr = new Date(s.startTime).toLocaleDateString('ja-JP',
            { month: 'numeric', day: 'numeric' });
        if (!confirm(`${dateStr} のセッション (種目${s.exercises.length}個, ${s.durationMinutes || 0}分) を削除しますか？`)) return;
        this.state.history.splice(idx, 1);
        this.saveHistory();
        this.updateStats();
        this.renderRecentSessions();
    }
};

window.onload = () => { app.init(); };
