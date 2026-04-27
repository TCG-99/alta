let peer = null;
let conn = null;
let hostConnections = [];
let isHost = false;

let myId = "";
let myName = "";
let myAssignments = [];
let myAnswers = {};
let myAnswersSubmitted = false;

let serverState = {
    players: [],
    unusedPrompts: [],
    prompts: [],
    assignments: {},
    answers: {},
    votes: {},
    currentVoteIndex: 0,
    currentRound: 1,
    maxRounds: 3,
    timerTimeout: null,
    phase: 'LOBBY',
    readyPlayers: new Set()
};

const fallbackQuestions = [
    { id: 1, prompt: "El peor sabor de helado sería crema del cielo y..." },
    { id: 2, prompt: "Si mi perro hablara, lo primero que diría es:" },
    { id: 3, prompt: "La verdadera razón por la que los aliens no nos visitan es:" },
    { id: 4, prompt: "Un nombre terrible para un perfume de hombre:" },
    { id: 5, prompt: "Lo peor que podés decir en una primera cita:" },
    { id: 6, prompt: "Una excusa malísima para llegar tarde al trabajo:" }
];
let gameQuestions = [...fallbackQuestions];

// ── Utilities ─────────────────────────────────────────────────────────────────

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(screenId);
    el.classList.add('active');
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({length: 4}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function getNickname() {
    let name = document.getElementById('player-name').value.trim();
    if (!name) { showToast('¡Tenés que poner un nombre sí o sí, fiera! 😤'); return null; }
    return name;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = '', duration = 2800) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast${type ? ' ' + type : ''}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 320);
    }, duration);
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function launchConfetti(count = 48) {
    const wrap = document.createElement('div');
    wrap.className = 'confetti-wrap';
    document.body.appendChild(wrap);
    const colors = ['#f1c40f','#e74c3c','#3498db','#27ae60','#9b59b6','#e67e22','#ecf0f1'];
    for (let i = 0; i < count; i++) {
        const cp = document.createElement('div');
        cp.className = 'cp';
        cp.style.left   = Math.random() * 100 + 'vw';
        cp.style.background = colors[Math.floor(Math.random() * colors.length)];
        const dur = 1.8 + Math.random() * 1.6;
        cp.style.animationDuration = dur + 's';
        cp.style.animationDelay   = Math.random() * 0.6 + 's';
        wrap.appendChild(cp);
    }
    setTimeout(() => wrap.remove(), 4000);
}

// ── Animated SVG Timer ────────────────────────────────────────────────────────

const TIMER_R = 31;
const TIMER_CIRC = 2 * Math.PI * TIMER_R; // ~194.78

let visualTimer;
let localTimerRemaining = 0;
let timerTotal = 60;

function startLocalTimer(seconds) {
    timerTotal = seconds;
    let t = seconds;
    localTimerRemaining = t;

    const container = document.getElementById('timer-container');
    const arc       = document.getElementById('timer-arc');
    const numEl     = document.getElementById('timer-number');
    const wrap      = document.querySelector('.timer-svg-wrap');

    // Setup arc
    arc.style.strokeDasharray  = TIMER_CIRC;
    arc.style.strokeDashoffset = 0;

    container.style.display = 'block';
    numEl.innerText = t;
    wrap.classList.remove('timer-urgent');

    clearInterval(visualTimer);

    function tick() {
        t--;
        localTimerRemaining = t;
        if (t < 0) { clearInterval(visualTimer); return; }

        numEl.innerText = t;

        // Arc: shrink from full (0 offset) to empty (CIRC offset)
        const fraction = t / timerTotal;
        arc.style.strokeDashoffset = TIMER_CIRC * (1 - fraction);

        // Urgent mode at 10s
        if (t <= 10) {
            wrap.classList.add('timer-urgent');
        }
    }

    visualTimer = setInterval(tick, 1000);
}

function stopLocalTimer() {
    clearInterval(visualTimer);
    localTimerRemaining = 0;
    const c = document.getElementById('timer-container');
    if (c) c.style.display = 'none';
    const wrap = document.querySelector('.timer-svg-wrap');
    if (wrap) wrap.classList.remove('timer-urgent');
}

// ── Two-step home screen ──────────────────────────────────────────────────────

function goToStepAction() {
    const name = document.getElementById('player-name').value.trim();
    if (!name) {
        showToast('¡Ponete un nombre primero! 😤');
        document.getElementById('player-name').focus();
        return;
    }
    try { localStorage.setItem('sarasa_nickname', name); } catch(e) {}
    document.getElementById('step-name').classList.add('step-hidden');
    const stepAction = document.getElementById('step-action');
    stepAction.classList.remove('step-hidden');
    document.getElementById('greeting-display').innerText = `¡Hola, ${name}! 🧉`;
    setTimeout(() => document.getElementById('join-code').focus(), 50);
}

function goBackToName() {
    document.getElementById('step-action').classList.add('step-hidden');
    document.getElementById('step-name').classList.remove('step-hidden');
    setTimeout(() => document.getElementById('player-name').focus(), 50);
}

// On load: restore saved nickname and skip to step-action
(function restoreNickname() {
    try {
        const saved = localStorage.getItem('sarasa_nickname');
        if (saved) {
            document.getElementById('player-name').value = saved;
            document.getElementById('step-name').classList.add('step-hidden');
            document.getElementById('step-action').classList.remove('step-hidden');
            document.getElementById('greeting-display').innerText = `¡Hola, ${saved}! 🧉`;
            setTimeout(() => document.getElementById('join-code').focus(), 80);
        }
    } catch(e) {}
})();

// ── Ready Tracker ─────────────────────────────────────────────────────────────

// Tracks who has submitted: key = playerId, value = bool
let readyStatus = {};

function initReadyTracker(players) {
    readyStatus = {};
    players.forEach(p => readyStatus[p.id] = false);
    renderReadyTracker(players);
}

function renderReadyTracker(players) {
    const list = document.getElementById('ready-list');
    if (!list) return;
    list.innerHTML = '';
    players.forEach(p => {
        const done = readyStatus[p.id] || false;
        const row = document.createElement('div');
        row.className = 'ready-player-row';
        row.id = `ready-row-${p.id}`;
        row.innerHTML = `
            <span class="ready-icon">${done ? '✅' : '✍️'}</span>
            <span class="ready-name">${p.name}${p.id === myId ? ' (vos)' : ''}</span>
            <span class="ready-status ${done ? 'done' : 'wait'}">${done ? '¡Listo!' : 'escribiendo...'}</span>
        `;
        list.appendChild(row);
    });
}

function markPlayerReady(playerId, players) {
    if (readyStatus[playerId]) return; // already marked
    readyStatus[playerId] = true;

    const row = document.getElementById(`ready-row-${playerId}`);
    if (row) {
        const icon   = row.querySelector('.ready-icon');
        const status = row.querySelector('.ready-status');
        icon.innerText = '✅';
        icon.classList.add('just-ready');
        status.className = 'ready-status done';
        status.innerText = '¡Listo!';
        setTimeout(() => icon.classList.remove('just-ready'), 600);
    }

    // Toast when someone other than me finishes
    const p = players.find(pl => pl.id === playerId);
    if (p && playerId !== myId) {
        showToast(`${p.name} ya mandó su sarasa ✅`, 'success', 2000);
    }

    // Check if all done
    const allDone = players.every(pl => readyStatus[pl.id]);
    if (allDone) showToast('¡Todos listos! 🚀', 'accent', 2000);
}

// ── Card renderer helpers ─────────────────────────────────────────────────────

function makeAnswerCard(ans, mode) {
    const el = document.createElement(mode === 'votable' ? 'button' : 'div');
    el.className = `answer-card${mode === 'votable' ? ' votable' : ''}`;
    el.id = `card-${ans.authorId}`;
    el.innerHTML = `"${ans.text}"`;
    if (mode === 'votable') {
        el.onclick = () => castVote(ans.authorId, el);
    }
    return el;
}

function makeResultCard(res, isJinx) {
    const card = document.createElement('div');
    card.className = `result-card${res.quiplash ? ' is-winner' : ''}${isJinx ? ' is-jinx' : ''}`;

    const nobodyBadge = res.votes === 0
        ? `<span class="badge badge-nobody">💀 Nadie votó</span>` : '';

    const voterLine = res.voterNames.length > 0
        ? `<div class="result-voters">Votado por: ${res.voterNames.join(', ')}</div>` : '';

    const sarasaBadge = res.quiplash
        ? `<span class="badge badge-sarasa">🔥 ¡ALTA SARASA!</span>` : '';

    card.innerHTML = `
        <div class="result-badges">
            <span class="badge badge-author">✍️ ${res.authorName}</span>
            ${res.votes > 0
                ? `<span class="badge badge-votes">👍 ${res.votes} voto${res.votes !== 1 ? 's' : ''}</span>`
                : nobodyBadge}
            ${!isJinx ? `<span class="badge badge-points">+${res.pointsAdded} pts</span>` : ''}
            ${sarasaBadge}
        </div>
        <div class="result-answer-text">"${res.text}"</div>
        ${voterLine}
    `;
    return card;
}

// ── Client-side game state handler ────────────────────────────────────────────

// Keep a snapshot of current players for ready tracker
let currentPlayers = [];

function handleGameState(data) {
    switch (data.type) {

        case 'LOBBY_UPDATE': {
            document.getElementById('lobby-code-big').innerText = data.code;
            const list = document.getElementById('player-list');
            list.innerHTML = '';
            data.players.forEach(p => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${p.name}${p.id === myId ? ' <em style="color:#7f8c8d;font-weight:400">(vos)</em>' : ''}</span><span style="color:var(--green);font-size:0.8rem;">● online</span>`;
                list.appendChild(li);
            });
            currentPlayers = data.players;
            showScreen('screen-lobby');
            break;
        }

        case 'PHASE_ANSWERING': {
            myAssignments    = data.assignments;
            myAnswers        = {};
            myAnswersSubmitted = false;
            currentPlayers   = data.players || currentPlayers;

            document.getElementById('answering-title').innerText =
                data.round === 3 ? 'RONDA FINAL: Completá la frase' : `RONDA ${data.round}: Completá la frase`;

            const promptsEl = document.getElementById('prompts-container');
            promptsEl.innerHTML = '';
            myAssignments.forEach(q => {
                const card = document.createElement('div');
                card.className = 'prompt-card';
                card.id = `prompt-card-${q.id}`;
                card.innerHTML = `
                    <div class="prompt-text">${q.prompt}</div>
                    <input type="text" id="answer-${q.id}" placeholder="Tirá tu mejor chamuyo..." autocomplete="off" maxlength="80">
                `;
                promptsEl.appendChild(card);

                // Live feedback: mark card as "answered" while typing
                const inp = card.querySelector('input');
                inp.addEventListener('input', () => {
                    if (inp.value.trim().length > 0) card.classList.add('answered');
                    else card.classList.remove('answered');
                });
            });

            document.getElementById('btn-submit-answers').disabled = false;
            document.getElementById('btn-submit-answers').innerText = 'Enviar Sarasa 🧉';
            document.getElementById('btn-submit-answers').style.display = 'inline-block';
            document.getElementById('btn-retract-answers').style.display = 'none';

            // Init ready tracker with current players
            initReadyTracker(currentPlayers);

            startLocalTimer(data.time);
            showScreen('screen-answering');
            break;
        }

        case 'PLAYER_READY': {
            // A player submitted their answers — update tracker
            markPlayerReady(data.playerId, currentPlayers);
            break;
        }

        case 'PHASE_VOTING': {
            document.getElementById('vote-wait-msg').style.display = 'none';
            document.getElementById('voting-title').innerText =
                data.round === 3 ? 'Votación Final' : '¡A votar!';
            document.getElementById('vote-prompt-text').innerText = data.prompt.prompt;

            const cardsEl = document.getElementById('voting-cards');
            cardsEl.innerHTML = '';

            const isMyPrompt = data.answers.some(a => a.authorId === myId);

            if (data.round !== 3 && isMyPrompt) {
                const note = document.createElement('p');
                note.style.cssText = 'color:var(--accent);font-weight:800;margin-bottom:12px;';
                note.innerText = 'Le toca votar a los demás.';
                cardsEl.appendChild(note);
                data.answers.forEach(ans => cardsEl.appendChild(makeAnswerCard(ans, 'preview')));
            } else {
                data.answers.forEach(ans => {
                    const canVoteThis = data.round === 3 ? ans.authorId !== myId : true;
                    cardsEl.appendChild(makeAnswerCard(ans, canVoteThis ? 'votable' : 'preview'));
                });
            }

            startLocalTimer(data.time);
            showScreen('screen-voting');
            break;
        }

        case 'VOTE_RESULT': {
            stopLocalTimer();

            document.getElementById('result-round-header').style.display = 'none';
            document.getElementById('result-round-scores').style.display = 'none';
            document.getElementById('result-prompt-text').style.display  = 'block';
            document.getElementById('result-details').style.display      = 'block';
            document.getElementById('vote-result-title').innerText = 'Resultados';

            document.getElementById('result-prompt-text').innerText = data.prompt.prompt;

            const resEl = document.getElementById('result-details');
            resEl.innerHTML = '';

            if (data.isJinx) {
                const jinxCard = document.createElement('div');
                jinxCard.className = 'result-card is-jinx';
                jinxCard.innerHTML = `
                    <div class="result-badges"><span class="badge badge-sarasa">☠️ CICUTA</span></div>
                    <div class="result-answer-text">Escribieron lo mismo. 0 puntos para todos.</div>
                `;
                resEl.appendChild(jinxCard);
                data.results.forEach(res => resEl.appendChild(makeResultCard(res, true)));
                showToast('¡CICUTA! Mismas respuestas 💀', '', 3000);
            } else {
                const sorted = [...data.results].sort((a, b) => b.votes - a.votes);
                sorted.forEach(res => resEl.appendChild(makeResultCard(res, false)));

                // Juice: confetti if someone got ¡Alta Sarasa!
                const hasQuiplash = sorted.some(r => r.quiplash);
                if (hasQuiplash) {
                    launchConfetti(60);
                    showToast('🔥 ¡ALTA SARASA!', 'accent', 3500);
                }

                // Toast for the winner of this round
                if (sorted[0] && sorted[0].votes > 0) {
                    showToast(`👑 Mejor sarasa: ${sorted[0].authorName}`, 'success', 2500);
                }
            }

            showScreen('screen-vote-result');
            break;
        }

        case 'ROUND_SCORES': {
            stopLocalTimer();
            document.getElementById('result-prompt-text').style.display = 'none';
            document.getElementById('result-details').style.display     = 'none';
            document.getElementById('vote-result-title').innerText = '';

            const rHeader = document.getElementById('result-round-header');
            const rScores = document.getElementById('result-round-scores');
            rHeader.innerText = `⏱ Fin de Ronda ${data.round} — Posiciones`;
            rHeader.style.display = 'block';
            rScores.innerHTML = '';
            data.players.sort((a, b) => b.score - a.score).forEach((p, i) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${i === 0 ? '👑 ' : ''}${p.name}</span><span>${p.score} pts</span>`;
                rScores.appendChild(li);
            });
            rScores.style.display = 'block';
            showScreen('screen-vote-result');

            // Leader toast
            const leader = data.players[0];
            if (leader) showToast(`👑 Va primero ${leader.name} con ${leader.score} pts`, 'accent', 3500);
            break;
        }

        case 'PHASE_SCORES': {
            stopLocalTimer();
            const scoreList = document.getElementById('final-scores');
            scoreList.innerHTML = '';
            const sorted = [...data.players].sort((a, b) => b.score - a.score);
            sorted.forEach((p, i) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${i === 0 ? '👑 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${p.name}</span><span>${p.score} pts</span>`;
                scoreList.appendChild(li);
            });
            const restartBtn = document.getElementById('host-restart');
            if (restartBtn) restartBtn.style.display = isHost ? 'block' : 'none';
            showScreen('screen-scores');

            // Celebrate!
            launchConfetti(80);
            if (sorted[0]) showToast(`🏆 ¡Ganó ${sorted[0].name}! 🧉`, 'accent', 5000);
            break;
        }
    }
}

// ── Voting ────────────────────────────────────────────────────────────────────

function castVote(votedForAuthorId, clickedCard) {
    document.querySelectorAll('#voting-cards .answer-card').forEach(c => {
        if (c.id === `card-${votedForAuthorId}`) {
            c.classList.remove('votable');
            c.classList.add('voted-chosen');
            c.disabled = true;
        } else {
            c.classList.add('voted-other');
            c.disabled = true;
        }
    });

    document.getElementById('vote-wait-msg').style.display = 'block';
    // No toast here — the visual feedback (highlighted card + wait msg) is sufficient

    const payload = { type: 'CMD_VOTE', authorId: votedForAuthorId, voterId: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// ── Answer submission ─────────────────────────────────────────────────────────

function submitAnswers() {
    let allAnswered = true;
    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        const val   = input ? input.value.trim() : '';
        if (!val) allAnswered = false;
        myAnswers[q.id] = val || 'Me quedé en blanco...';
    });

    if (!allAnswered && !confirm('¿Dejaste alguna vacía, seguro querés mandar igual?')) return;

    myAnswersSubmitted = true;
    document.getElementById('btn-submit-answers').style.display  = 'none';
    document.getElementById('btn-retract-answers').style.display = 'inline-block';
    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        if (input) input.disabled = true;
    });

    // Mark self as ready locally
    markPlayerReady(myId, currentPlayers);
    showToast('¡Sarasa enviada! Esperando a los demás... ✅', 'success', 2500);

    const payload = { type: 'CMD_SUBMIT_ANSWERS', answers: myAnswers, id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

function retractAnswers() {
    if (localTimerRemaining <= 0) {
        showToast('¡Se acabó el tiempo, no podés cambiar tu respuesta! ⏰');
        return;
    }
    myAnswersSubmitted = false;
    myAnswers = {};

    document.getElementById('btn-submit-answers').disabled     = false;
    document.getElementById('btn-submit-answers').innerText    = 'Enviar Sarasa 🧉';
    document.getElementById('btn-submit-answers').style.display  = 'inline-block';
    document.getElementById('btn-retract-answers').style.display = 'none';

    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        if (input) { input.disabled = false; }
        const card = document.getElementById(`prompt-card-${q.id}`);
        if (card) card.classList.remove('answered');
    });

    // Unmark self
    readyStatus[myId] = false;
    renderReadyTracker(currentPlayers);

    const payload = { type: 'CMD_RETRACT_ANSWERS', id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// ── Join / Create ─────────────────────────────────────────────────────────────

function joinGame() {
    myName = document.getElementById('player-name').value.trim() || '';
    if (!myName) { showToast('¡Falta el nombre! 😤'); return; }
    try { localStorage.setItem('sarasa_nickname', myName); } catch(e) {}
    const code = document.getElementById('join-code').value.toUpperCase();
    if (!code) { showToast('Poné un código de sala'); return; }

    const joinBtn = document.querySelector('#screen-home .btn-secondary');
    if (joinBtn) { joinBtn.disabled = true; joinBtn.innerText = 'Conectando...'; }

    peer = new Peer();

    peer.on('error', err => {
        console.error('Peer error:', err);
        showToast(`Error de conexión: ${err.type}. Verificá el código.`);
        if (joinBtn) { joinBtn.disabled = false; joinBtn.innerText = 'Unirse a Partida'; }
        peer.destroy(); peer = null;
    });

    peer.on('open', id => {
        myId = id;
        conn = peer.connect('sarasa-' + code);

        conn.on('error', err => {
            console.error('Connection error:', err);
            showToast('No se pudo conectar. ¿El código es correcto?');
            if (joinBtn) { joinBtn.disabled = false; joinBtn.innerText = 'Unirse a Partida'; }
        });

        conn.on('open', () => {
            if (joinBtn) { joinBtn.disabled = false; joinBtn.innerText = 'Unirse a Partida'; }
            conn.send({ type: 'CMD_JOIN', name: myName, id: myId });
            showToast(`¡Conectado! Bienvenido ${myName} 🧉`, 'accent', 2500);
        });

        conn.on('data', data => handleGameState(data));
    });
}

async function createGame() {
    myName = document.getElementById('player-name').value.trim() || '';
    if (!myName) { showToast('¡Falta el nombre! 😤'); return; }
    try { localStorage.setItem('sarasa_nickname', myName); } catch(e) {}

    isHost = true;
    const code   = generateRoomCode();
    myId         = 'HOST';
    const peerId = 'sarasa-' + code;

    const createBtn = document.querySelector('#step-action button:not(.btn-secondary):not(.btn-back)');
    if (createBtn) { createBtn.disabled = true; createBtn.innerText = 'Creando sala...'; }

    try {
        const res = await fetch('preguntas.json');
        if (res.ok) gameQuestions = await res.json();
    } catch (e) { console.warn('Usando preguntas de respaldo.'); }

    serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());
    peer = new Peer(peerId);

    peer.on('error', err => {
        console.error('Host peer error:', err);
        isHost = false;
        if (createBtn) { createBtn.disabled = false; createBtn.innerText = 'Crear Nueva Sala 🏠'; }
        showToast(err.type === 'unavailable-id'
            ? 'Ese código ya está en uso, intentá de nuevo.'
            : `Error al crear la sala: ${err.type}`);
        peer.destroy(); peer = null;
    });

    peer.on('open', () => {
        serverState.roomCode = code;
        serverState.players.push({ id: myId, name: myName, score: 0 });

        document.getElementById('host-controls').style.display    = 'block';
        document.getElementById('room-display-tag').innerText     = `SALA: ${code}`;
        document.getElementById('room-display-tag').style.display = 'block';
        document.getElementById('lobby-code-big').innerText       = code;

        if (createBtn) { createBtn.disabled = false; createBtn.innerText = 'Crear Nueva Sala 🏠'; }

        showScreen('screen-lobby');
        broadcast({ type: 'LOBBY_UPDATE', players: serverState.players, code, phase: serverState.phase });
        showToast(`¡Sala ${code} creada! Compartí el código 🏠`, 'accent', 3000);
    });

    peer.on('connection', connection => {
        hostConnections.push(connection);
        connection.on('data', data => handleCommandFromClient(data));
        connection.on('close', () => {
            hostConnections = hostConnections.filter(c => c !== connection);
            if (serverState.phase === 'LOBBY') {
                serverState.players = serverState.players.filter(p => p.id !== connection.peer);
                broadcast({
                    type: 'LOBBY_UPDATE',
                    players: serverState.players,
                    code: serverState.roomCode,
                    phase: serverState.phase
                });
            }
        });
    });
}

// ── Host broadcast & command handling ────────────────────────────────────────

function broadcast(data) {
    handleGameState(data);
    hostConnections.forEach(c => c.send(data));
}

function handleCommandFromClient(data) {

    if (data.type === 'CMD_JOIN') {
        const idx = serverState.players.findIndex(p => p.id === data.id);
        if (idx !== -1) serverState.players[idx].name = data.name;
        else serverState.players.push({ id: data.id, name: data.name, score: 0 });
        broadcast({
            type: 'LOBBY_UPDATE',
            players: serverState.players,
            code: serverState.roomCode,
            phase: serverState.phase
        });
    }

    else if (data.type === 'CMD_SUBMIT_ANSWERS') {
        const pId = data.id;
        for (const [qId, text] of Object.entries(data.answers)) {
            if (!serverState.answers[qId]) serverState.answers[qId] = [];
            if (!serverState.answers[qId].some(a => a.authorId === pId)) {
                serverState.answers[qId].push({ authorId: pId, text });
            }
        }

        // Broadcast PLAYER_READY so all clients update their tracker
        broadcast({ type: 'PLAYER_READY', playerId: pId });

        const expectedPerPlayer = serverState.currentRound <= 2 ? 2 : 1;
        const totalExpected     = serverState.players.length * expectedPerPlayer;
        const totalReceived     = Object.values(serverState.answers).flat().length;
        if (totalReceived >= totalExpected && serverState.phase === 'ANSWERING') {
            clearTimeout(serverState.timerTimeout);
            startVotingPhase();
        }
    }

    else if (data.type === 'CMD_RETRACT_ANSWERS') {
        const pId = data.id;
        for (const qId of Object.keys(serverState.answers)) {
            serverState.answers[qId] = serverState.answers[qId].filter(a => a.authorId !== pId);
        }
        // Note: No re-broadcast of ready status needed; client handles locally
    }

    else if (data.type === 'CMD_VOTE') {
        const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
        if (!serverState.votes[currentPrompt.id]) serverState.votes[currentPrompt.id] = [];
        if (!serverState.votes[currentPrompt.id].some(v => v.voterId === data.voterId)) {
            serverState.votes[currentPrompt.id].push({ voterId: data.voterId, votedFor: data.authorId });
        }
        const expectedVotes = serverState.currentRound <= 2
            ? serverState.players.length - 2
            : serverState.players.length;
        if (serverState.votes[currentPrompt.id].length >= expectedVotes) {
            clearTimeout(serverState.timerTimeout);
            processVotingResults();
        }
    }
}

// ── Game flow ─────────────────────────────────────────────────────────────────

function startGame() {
    if (serverState.players.length < 3) {
        showToast('Se necesitan al menos 3 jugadores 😅');
        return;
    }
    serverState.currentRound = 1;
    serverState.players.forEach(p => p.score = 0);
    showToast('¡Empieza el juego! 🧉🔥', 'accent', 2500);
    startRound();
}

function startRound() {
    serverState.phase            = 'ANSWERING';
    serverState.answers          = {};
    serverState.votes            = {};
    serverState.currentVoteIndex = 0;

    const players = serverState.players;
    const N       = players.length;

    if (serverState.currentRound <= 2) {
        if (serverState.unusedPrompts.length < N)
            serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());
        serverState.prompts = serverState.unusedPrompts.splice(0, N);
        for (let i = 0; i < N; i++) {
            players[i].id && (serverState.assignments[players[i].id] = [
                serverState.prompts[i],
                serverState.prompts[(i + 1) % N]
            ]);
        }
    } else {
        if (serverState.unusedPrompts.length < 1)
            serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());
        const fp = serverState.unusedPrompts.splice(0, 1)[0];
        serverState.prompts = [fp];
        players.forEach(p => serverState.assignments[p.id] = [fp]);
    }

    broadcastAnsweringPhase();
}

function broadcastAnsweringPhase() {
    const players = serverState.players;

    hostConnections.forEach(c => c.send({
        type: 'PHASE_ANSWERING',
        round: serverState.currentRound,
        assignments: serverState.assignments[c.peer],
        players: players,
        time: 60
    }));

    handleGameState({
        type: 'PHASE_ANSWERING',
        round: serverState.currentRound,
        assignments: serverState.assignments[myId],
        players: players,
        time: 60
    });

    serverState.timerTimeout = setTimeout(() => {
        if (serverState.phase === 'ANSWERING') forceSubmitMissing();
    }, 60000);
}

function forceSubmitMissing() {
    for (const [pId, assignedPrompts] of Object.entries(serverState.assignments)) {
        assignedPrompts.forEach(q => {
            if (!serverState.answers[q.id]) serverState.answers[q.id] = [];
            if (!serverState.answers[q.id].some(a => a.authorId === pId))
                serverState.answers[q.id].push({ authorId: pId, text: 'Me colgué mal...' });
        });
    }
    startVotingPhase();
}

function startVotingPhase() {
    serverState.phase = 'VOTING';

    if (serverState.currentVoteIndex >= serverState.prompts.length) {
        serverState.currentRound++;
        if (serverState.currentRound > serverState.maxRounds) {
            broadcast({ type: 'PHASE_SCORES', players: serverState.players });
        } else {
            broadcast({
                type: 'ROUND_SCORES',
                round: serverState.currentRound - 1,
                players: serverState.players
            });
            setTimeout(() => startRound(), 5000);
        }
        return;
    }

    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    let promptAnswers   = serverState.answers[currentPrompt.id] || [];

    if (serverState.currentRound <= 2 && promptAnswers.length < 2) {
        const safety = findReplacementAnswer(currentPrompt.id);
        promptAnswers.push({
            authorId: 'DUMMY',
            authorName: safety.authorName || 'El Sistema',
            text: safety.text + ' (Reciclada)'
        });
    }

    promptAnswers = [...promptAnswers].sort(() => 0.5 - Math.random());

    broadcast({
        type: 'PHASE_VOTING',
        round: serverState.currentRound,
        prompt: currentPrompt,
        answers: promptAnswers,
        time: 20
    });

    serverState.timerTimeout = setTimeout(() => processVotingResults(), 20000);
}

function findReplacementAnswer(excludeQId) {
    const allHistory = [];
    Object.keys(serverState.answers).forEach(qId => {
        if (qId != excludeQId) allHistory.push(...serverState.answers[qId]);
    });
    return allHistory.length > 0
        ? allHistory[Math.floor(Math.random() * allHistory.length)]
        : { authorName: 'El Sistema', text: '¡Sarasa Cósmica!' };
}

function processVotingResults() {
    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    const promptAnswers = serverState.answers[currentPrompt.id] || [];
    const votes         = serverState.votes[currentPrompt.id]   || [];

    let isJinx = serverState.currentRound <= 2
        && promptAnswers.length === 2
        && promptAnswers[0].text.toLowerCase() === promptAnswers[1].text.toLowerCase();

    const totalVotes       = votes.length;
    const roundMultiplier  = serverState.currentRound === 2 ? 2 : serverState.currentRound === 3 ? 3 : 1;

    const resultsData = promptAnswers.map(ans => {
        const author     = serverState.players.find(p => p.id === ans.authorId);
        const authorName = ans.authorId === 'DUMMY' ? ans.authorName : (author ? author.name : 'Desconocido');
        const voterDetails = votes
            .filter(v => v.votedFor === ans.authorId)
            .map(v => { const vi = serverState.players.find(p => p.id === v.voterId); return vi ? vi.name : 'Alguien'; });

        const voteCount = voterDetails.length;
        let pointsAdded = 0, quiplash = false;

        if (!isJinx && totalVotes > 0) {
            pointsAdded = Math.floor((voteCount / totalVotes) * 1000) * roundMultiplier;
            if (serverState.currentRound <= 2 && voteCount === totalVotes) {
                pointsAdded += 500 * roundMultiplier;
                quiplash = true;
            }
        }

        if (author && !isJinx && ans.authorId !== 'DUMMY') author.score += pointsAdded;

        return { authorName, text: ans.text, votes: voteCount, voterNames: voterDetails, pointsAdded, quiplash };
    });

    broadcast({ type: 'VOTE_RESULT', prompt: currentPrompt, isJinx, results: resultsData });

    setTimeout(() => {
        serverState.currentVoteIndex++;
        startVotingPhase();
    }, 8000);
}
