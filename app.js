const app = {
    state: {
        activeSession: null,
        timerInterval: null,
        history: JSON.parse(localStorage.getItem('gymfit_history')) || []
    },

    init() {
        this.updateStats();
        this.renderRecentSessions();
        
        // If there's an active session from a previous reload, restore it
        const savedSession = JSON.parse(localStorage.getItem('gymfit_active_session'));
        if (savedSession) {
            this.state.activeSession = savedSession;
            this.startTimer();
            this.renderCurrentExercises();
            this.toggleActiveSessionUI(true);
        }
    },

    saveHistory() {
        localStorage.setItem('gymfit_history', JSON.stringify(this.state.history));
    },

    saveSessionState() {
        if (this.state.activeSession) {
            localStorage.setItem('gymfit_active_session', JSON.stringify(this.state.activeSession));
        } else {
            localStorage.removeItem('gymfit_active_session');
        }
    },

    navigate(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        
        document.getElementById(`view-${viewId}`).classList.add('active');
        document.getElementById(`nav-${viewId}`).classList.add('active');

        if (viewId === 'stats') {
            this.updateStats();
        }
    },

    startSession() {
        const now = new Date();
        this.state.activeSession = {
            id: Date.now(),
            startTime: now.getTime(),
            exercises: []
        };
        
        document.getElementById('session-start-time').textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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
        this.state.activeSession.endTime = now.getTime();
        this.state.activeSession.durationMinutes = Math.round(durationMs / 60000);

        // Save to history
        this.state.history.unshift(this.state.activeSession);
        this.saveHistory();

        // Clear active session
        this.state.activeSession = null;
        this.saveSessionState();

        this.toggleActiveSessionUI(false);
        this.updateStats();
        this.renderRecentSessions();
        alert('トレーニングお疲れ様でした！記録を保存しました。');
    },

    toggleActiveSessionUI(isActive) {
        const btnStart = document.getElementById('btn-start-session');
        const btnEnd = document.getElementById('btn-end-session');
        const activeArea = document.getElementById('active-session-area');
        const statusText = document.getElementById('current-status-text');

        if (isActive) {
            btnStart.classList.add('hidden');
            btnEnd.classList.remove('hidden');
            activeArea.classList.remove('hidden');
            statusText.textContent = '現在トレーニング中です！';
        } else {
            btnStart.classList.remove('hidden');
            btnEnd.classList.add('hidden');
            activeArea.classList.add('hidden');
            statusText.textContent = '現在トレーニングは行っていません';
            
            // clear inputs
            document.getElementById('input-machine-no').value = '';
            document.getElementById('input-machine-name').value = '';
            for(let i=1; i<=3; i++) {
                document.getElementById(`input-load-${i}`).value = '';
                document.getElementById(`input-reps-${i}`).value = '';
            }
            document.getElementById('current-exercises-list').innerHTML = '';
        }
    },

    startTimer() {
        if (this.state.timerInterval) clearInterval(this.state.timerInterval);
        
        const timerEl = document.getElementById('session-timer');
        
        this.state.timerInterval = setInterval(() => {
            if(!this.state.activeSession) return;
            const diff = Date.now() - this.state.activeSession.startTime;
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            timerEl.textContent = `${h}:${m}:${s}`;
        }, 1000);
    },

    addExercise() {
        const mNo = document.getElementById('input-machine-no').value.trim();
        const mName = document.getElementById('input-machine-name').value.trim();

        if (!mNo || !mName) {
            alert('マシン番号とマシン名を入力してください。');
            return;
        }

        const sets = [];
        for(let i=1; i<=3; i++) {
            const load = document.getElementById(`input-load-${i}`).value;
            const reps = document.getElementById(`input-reps-${i}`).value;
            sets.push({
                set: i,
                load: load ? parseFloat(load) : 0,
                reps: reps ? parseInt(reps) : 0
            });
        }

        this.state.activeSession.exercises.push({
            machineNo: mNo,
            machineName: mName,
            sets: sets
        });

        this.saveSessionState();
        this.renderCurrentExercises();

        // Clear for next
        document.getElementById('input-machine-no').value = '';
        document.getElementById('input-machine-name').value = '';
        document.getElementById('history-hint').textContent = '';
        for(let i=1; i<=3; i++) {
            document.getElementById(`input-load-${i}`).value = '';
            document.getElementById(`input-reps-${i}`).value = '';
        }
    },

    renderCurrentExercises() {
        const list = document.getElementById('current-exercises-list');
        list.innerHTML = '';

        if(!this.state.activeSession) return;

        this.state.activeSession.exercises.forEach((ex, idx) => {
            let setsHtml = ex.sets.map(s => `
                <div class="set-result">
                    <span>Set ${s.set}</span>
                    <span>${s.load}kg x ${s.reps}回</span>
                </div>
            `).join('');

            list.innerHTML += `
                <div class="exercise-item">
                    <div class="exercise-header">
                        <span class="exercise-title">${ex.machineNo}: ${ex.machineName}</span>
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

        // Search history for this machine
        for (let session of this.state.history) {
            for (let ex of session.exercises) {
                if (ex.machineNo.toLowerCase() === mNo) {
                    hintEl.textContent = `過去の名称: ${ex.machineName} (最高負荷: ${Math.max(...ex.sets.map(s=>s.load))}kg) ※前回の記録を自動入力`;
                    // Optional: auto-fill name if empty
                    if (!nameInput.value) {
                        nameInput.value = ex.machineName;
                    }
                    
                    // Auto-fill sets
                    if (this.state.autofilledMachine !== mNo) {
                        ex.sets.forEach((s, index) => {
                            if (index < 3) {
                                const i = index + 1;
                                document.getElementById(`input-load-${i}`).value = s.load;
                                document.getElementById(`input-reps-${i}`).value = s.reps;
                            }
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
                    hits.push({ date: session.startTime, ex: ex });
                }
            });
        });

        if (hits.length === 0) {
            resultsEl.innerHTML = '<p>過去の記録が見つかりませんでした。</p>';
            return;
        }

        hits.forEach(hit => {
            const dateStr = new Date(hit.date).toLocaleDateString('ja-JP', {year: 'numeric', month: 'long', day: 'numeric'});
            let setsHtml = hit.ex.sets.map(s => `
                <div style="font-size: 0.9rem; margin-top: 0.2rem;">
                    Set ${s.set}: ${s.load}kg × ${s.reps}回
                </div>
            `).join('');

            resultsEl.innerHTML += `
                <div class="history-item">
                    <div class="history-date">${dateStr}</div>
                    <div class="exercise-title" style="margin-bottom:0.5rem">${hit.ex.machineNo}: ${hit.ex.machineName}</div>
                    ${setsHtml}
                </div>
            `;
        });
    },

    updateStats() {
        const now = new Date();
        // start of this week (Monday)
        const day = now.getDay();
        const diff = now.getDate() - day + (day == 0 ? -6 : 1);
        const startOfWeek = new Date(now.setDate(diff));
        startOfWeek.setHours(0,0,0,0);

        let weeklyMins = 0;
        let weeklyCount = 0;

        this.state.history.forEach(s => {
            if (s.startTime >= startOfWeek.getTime()) {
                weeklyMins += (s.durationMinutes || 0);
                weeklyCount++;
            }
        });

        const hrs = Math.floor(weeklyMins / 60);
        const mins = weeklyMins % 60;

        document.getElementById('stat-weekly-time').textContent = `${hrs}時間 ${mins}分`;
        document.getElementById('stat-weekly-count').textContent = `${weeklyCount}回`;
    },

    renderRecentSessions() {
        const list = document.getElementById('recent-sessions-list');
        list.innerHTML = '';
        
        if (this.state.history.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted)">まだ記録がありません。</p>';
            return;
        }

        const recent = this.state.history.slice(0, 3);
        recent.forEach(s => {
            const dateStr = new Date(s.startTime).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
            list.innerHTML += `
                <div style="border-bottom: 1px solid var(--glass-border); padding: 0.8rem 0;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem">
                        <span style="font-weight:600">日付: ${dateStr}</span>
                    </div>
                    <div style="font-size:0.9rem; color:var(--text-muted); display:flex; gap: 1rem;">
                        <span>種目数: ${s.exercises.length}</span>
                        <span style="color:var(--accent-primary)">トレーニング時間: ${s.durationMinutes || 0}分</span>
                    </div>
                </div>
            `;
        });
    }
};

window.onload = () => {
    app.init();
};
