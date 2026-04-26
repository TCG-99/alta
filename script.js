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
    phase: 'LOBBY'
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

// --- UTILIDADES ---

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({length: 4}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function getNickname() {
    let name = document.getElementById('player-name').value.trim();
    if (!name) { alert("¡Tenés que poner un nombre sí o sí, fiera!"); return null; }
    return name;
}

function toggleHostView() {
    const setup = document.getElementById('host-setup');
    setup.style.display = setup.style.display === 'none' ? 'block' : 'none';
}

let visualTimer;
let localTimerRemaining = 0;

function startLocalTimer(seconds) {
    let t = seconds;
    localTimerRemaining = t;
    const container = document.getElementById('timer-container');
    const display   = document.getElementById('global-timer');
    container.style.display = 'block';
    display.innerText = t;
    clearInterval(visualTimer);
    visualTimer = setInterval(() => {
        t--;
        localTimerRemaining = t;
        if (t >= 0) display.innerText = t;
        if (t <= 0) clearInterval(visualTimer);
    }, 1000);
}

function stopLocalTimer() {
    clearInterval(visualTimer);
    localTimerRemaining = 0;
    const c = document.getElementById('timer-container');
    if (c) c.style.display = 'none';
}

// ── Card renderer helpers ────────────────────────────────────────────────────

/**
 * Build a single answer card element.
 *  mode: 'votable'  → green, acts as a button, calls sendVote on click
 *        'preview'  → neutral, read-only (player can't vote this round)
 */
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

/**
 * Build a result card for the post-vote reveal screen.
 * Shows badges for author / votes / points and an optional ¡Alta Sarasa! badge.
 */
function makeResultCard(res, isJinx) {
    const card = document.createElement('div');
    card.className = `result-card${res.quiplash ? ' is-winner' : ''}${isJinx ? ' is-jinx' : ''}`;

    const nobodyBadge = res.votes === 0
        ? `<span class="badge badge-nobody">💀 Nadie votó</span>`
        : '';

    const voterLine = res.voterNames.length > 0
        ? `<div class="result-voters">Votado por: ${res.voterNames.join(', ')}</div>`
        : '';

    const sarasaBadge = res.quiplash
        ? `<span class="badge badge-sarasa">🔥 ¡ALTA SARASA!</span>`
        : '';

    card.innerHTML = `
        <div class="result-badges">
            <span class="badge badge-author">✍️ ${res.authorName}</span>
            ${res.votes > 0 ? `<span class="badge badge-votes">👍 ${res.votes} voto${res.votes !== 1 ? 's' : ''}</span>` : nobodyBadge}
            ${!isJinx ? `<span class="badge badge-points">+${res.pointsAdded} pts</span>` : ''}
            ${sarasaBadge}
        </div>
        <div class="result-answer-text">"${res.text}"</div>
        ${voterLine}
    `;
    return card;
}

// ── Client-side game state handler ──────────────────────────────────────────

function handleGameState(data) {
    switch (data.type) {

        case 'LOBBY_UPDATE':
            document.getElementById('lobby-code-big').innerText = data.code;
            const list = document.getElementById('player-list');
            list.innerHTML = '';
            data.players.forEach(p => {
                const li = document.createElement('li');
                li.innerText = `${p.name}${p.id === myId ? ' (Vos)' : ''}`;
                list.appendChild(li);
            });
            showScreen('screen-lobby');
            break;

        case 'PHASE_ANSWERING':
            myAssignments    = data.assignments;
            myAnswers        = {};
            myAnswersSubmitted = false;

            document.getElementById('answering-title').innerText =
                `${data.round === 3 ? 'RONDA FINAL' : `RONDA ${data.round}`}: Completá la frase`;

            const promptsEl = document.getElementById('prompts-container');
            promptsEl.innerHTML = '';
            myAssignments.forEach(q => {
                promptsEl.innerHTML += `
                    <div class="prompt-card">
                        <div class="prompt-text">${q.prompt}</div>
                        <input type="text" id="answer-${q.id}" placeholder="Tirá tu mejor chamuyo..." autocomplete="off">
                    </div>`;
            });

            document.getElementById('btn-submit-answers').disabled = false;
            document.getElementById('btn-submit-answers').innerText = 'Enviar Sarasa';
            document.getElementById('btn-submit-answers').style.display = 'inline-block';
            document.getElementById('btn-retract-answers').style.display = 'none';

            startLocalTimer(data.time);
            showScreen('screen-answering');
            break;

        case 'PHASE_VOTING': {
            document.getElementById('vote-wait-msg').style.display = 'none';
            document.getElementById('voting-title').innerText =
                data.round === 3 ? 'Votación Final' : '¡A votar!';
            document.getElementById('vote-prompt-text').innerText = data.prompt.prompt;

            const cardsEl    = document.getElementById('voting-cards');
            cardsEl.innerHTML = '';

            const isMyPrompt = data.answers.some(a => a.authorId === myId);

            // ── FIX 1: never show answers twice ──────────────────────────
            // If the player CAN vote → render votable cards only (they serve
            //   as both the "see the answers" view and the vote mechanism).
            // If the player CANNOT vote → render read-only preview cards only.

            if (data.round !== 3 && isMyPrompt) {
                // It's the player's own prompt — they watch, not vote
                const note = document.createElement('p');
                note.style.cssText = 'color:var(--accent);font-weight:bold;margin-bottom:12px;';
                note.innerText = 'Le toca votar a los demás.';
                cardsEl.appendChild(note);

                // Show answers as read-only preview cards
                data.answers.forEach(ans => cardsEl.appendChild(makeAnswerCard(ans, 'preview')));

            } else {
                // Player can vote — render interactive cards (no separate preview)
                data.answers.forEach(ans => {
                    // In round 3 you can't vote for your own answer
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

            // Reset any between-round leaderboard state
            document.getElementById('result-round-header').style.display = 'none';
            document.getElementById('result-round-scores').style.display = 'none';
            document.getElementById('result-prompt-text').style.display = 'block';
            document.getElementById('result-details').style.display    = 'block';
            document.getElementById('vote-result-title').innerText = 'Resultados';

            document.getElementById('result-prompt-text').innerText = data.prompt.prompt;

            const resEl = document.getElementById('result-details');
            resEl.innerHTML = '';

            if (data.isJinx) {
                const jinxCard = document.createElement('div');
                jinxCard.className = 'result-card is-jinx';
                jinxCard.innerHTML = `
                    <div class="result-badges">
                        <span class="badge badge-sarasa">☠️ CICUTA</span>
                    </div>
                    <div class="result-answer-text">Escribieron lo mismo. 0 puntos para todos.</div>
                `;
                resEl.appendChild(jinxCard);
                // Still show both answers so players can laugh
                data.results.forEach(res => resEl.appendChild(makeResultCard(res, true)));
            } else {
                data.results.sort((a, b) => b.votes - a.votes)
                            .forEach(res => resEl.appendChild(makeResultCard(res, false)));
            }

            showScreen('screen-vote-result');
            break;
        }

        case 'ROUND_SCORES':
            stopLocalTimer();
            document.getElementById('result-prompt-text').style.display = 'none';
            document.getElementById('result-details').style.display    = 'none';
            document.getElementById('vote-result-title').innerText = '';

            const rHeader = document.getElementById('result-round-header');
            const rScores = document.getElementById('result-round-scores');
            rHeader.innerText = `⏱ Fin de Ronda ${data.round} — Posiciones`;
            rHeader.style.display = 'block';
            rScores.innerHTML = '';
            data.players.sort((a, b) => b.score - a.score).forEach((p, i) => {
                rScores.innerHTML += `<li><span>${i === 0 ? '👑 ' : ''}${p.name}</span><span>${p.score} pts</span></li>`;
            });
            rScores.style.display = 'block';
            showScreen('screen-vote-result');
            break;

        case 'PHASE_SCORES':
            stopLocalTimer();
            const scoreList = document.getElementById('final-scores');
            scoreList.innerHTML = '';
            data.players.sort((a, b) => b.score - a.score).forEach((p, i) => {
                scoreList.innerHTML += `<li><span>${i === 0 ? '👑 ' : ''}${p.name}</span><span>${p.score} pts</span></li>`;
            });
            const restartBtn = document.getElementById('host-restart');
            if (restartBtn) restartBtn.style.display = isHost ? 'block' : 'none';
            showScreen('screen-scores');
            break;
    }
}

// ── Voting ───────────────────────────────────────────────────────────────────

// Called when a player taps a votable card
function castVote(votedForAuthorId, clickedCard) {
    // Style all cards: dim others, highlight chosen
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

    const payload = { type: 'CMD_SUBMIT_ANSWERS', answers: myAnswers, id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

function retractAnswers() {
    if (localTimerRemaining <= 0) {
        alert('¡Se acabó el tiempo, no podés cambiar tu respuesta!');
        return;
    }
    myAnswersSubmitted = false;
    myAnswers = {};

    document.getElementById('btn-submit-answers').disabled     = false;
    document.getElementById('btn-submit-answers').innerText    = 'Enviar Sarasa';
    document.getElementById('btn-submit-answers').style.display  = 'inline-block';
    document.getElementById('btn-retract-answers').style.display = 'none';

    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        if (input) input.disabled = false;
    });

    const payload = { type: 'CMD_RETRACT_ANSWERS', id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// ── Join / Create ─────────────────────────────────────────────────────────────

function joinGame() {
    myName = getNickname();
    if (!myName) return;
    const code = document.getElementById('join-code').value.toUpperCase();
    if (!code) return alert('Poné un código.');

    const joinBtn = document.querySelector('#screen-home .btn-secondary');
    if (joinBtn) { joinBtn.disabled = true; joinBtn.innerText = 'Conectando...'; }

    peer = new Peer();

    peer.on('error', err => {
        console.error('Peer error:', err);
        alert(`Error de conexión: ${err.type}. Verificá el código e intentá de nuevo.`);
        if (joinBtn) { joinBtn.disabled = false; joinBtn.innerText = 'Unirse a Partida'; }
        peer.destroy(); peer = null;
    });

    peer.on('open', id => {
        myId = id;
        conn = peer.connect('sarasa-' + code);

        conn.on('error', err => {
            console.error('Connection error:', err);
            alert('No se pudo conectar a la sala. ¿El código es correcto?');
            if (joinBtn) { joinBtn.disabled = false; joinBtn.innerText = 'Unirse a Partida'; }
        });

        conn.on('open', () => {
            if (joinBtn) { joinBtn.disabled = false; joinBtn.innerText = 'Unirse a Partida'; }
            conn.send({ type: 'CMD_JOIN', name: myName, id: myId });
        });

        conn.on('data', data => handleGameState(data));
    });
}

async function createGame() {
    myName = getNickname();
    if (!myName) return;

    isHost = true;
    const code   = generateRoomCode();
    myId         = 'HOST';
    const peerId = 'sarasa-' + code;

    const createBtn = document.querySelector('#host-setup button');
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
        if (createBtn) { createBtn.disabled = false; createBtn.innerText = 'Crear Nueva Sala'; }
        alert(err.type === 'unavailable-id'
            ? 'Ese código de sala ya está en uso, intentá de nuevo.'
            : `Error al crear la sala: ${err.type}`);
        peer.destroy(); peer = null;
    });

    peer.on('open', () => {
        serverState.roomCode = code;
        serverState.players.push({ id: myId, name: myName, score: 0 });

        document.getElementById('host-controls').style.display   = 'block';
        document.getElementById('room-display-tag').innerText    = `SALA: ${code}`;
        document.getElementById('room-display-tag').style.display = 'block';
        document.getElementById('lobby-code-big').innerText      = code;

        if (createBtn) { createBtn.disabled = false; createBtn.innerText = 'Crear Nueva Sala'; }

        showScreen('screen-lobby');
        broadcast({ type: 'LOBBY_UPDATE', players: serverState.players, code, phase: serverState.phase });
    });

    peer.on('connection', connection => {
        hostConnections.push(connection);
        connection.on('data', data => handleCommandFromClient(data));
        connection.on('close', () => {
            hostConnections = hostConnections.filter(c => c !== connection);
            if (serverState.phase === 'LOBBY') {
                serverState.players = serverState.players.filter(p => p.id !== connection.peer);
                broadcast({ type: 'LOBBY_UPDATE', players: serverState.players, code: serverState.roomCode, phase: serverState.phase });
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
        broadcast({ type: 'LOBBY_UPDATE', players: serverState.players, code: serverState.roomCode, phase: serverState.phase });
    }

    else if (data.type === 'CMD_SUBMIT_ANSWERS') {
        const pId = data.id;
        for (const [qId, text] of Object.entries(data.answers)) {
            if (!serverState.answers[qId]) serverState.answers[qId] = [];
            if (!serverState.answers[qId].some(a => a.authorId === pId)) {
                serverState.answers[qId].push({ authorId: pId, text });
            }
        }
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
    if (serverState.players.length < 3) { alert('Se necesitan al menos 3 jugadores.'); return; }
    serverState.currentRound = 1;
    serverState.players.forEach(p => p.score = 0);
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
    hostConnections.forEach(c => c.send({
        type: 'PHASE_ANSWERING',
        round: serverState.currentRound,
        assignments: serverState.assignments[c.peer],
        time: 60
    }));
    handleGameState({
        type: 'PHASE_ANSWERING',
        round: serverState.currentRound,
        assignments: serverState.assignments[myId],
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
            broadcast({ type: 'ROUND_SCORES', round: serverState.currentRound - 1, players: serverState.players });
            setTimeout(() => startRound(), 5000);
        }
        return;
    }

    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    let promptAnswers   = serverState.answers[currentPrompt.id] || [];

    if (serverState.currentRound <= 2 && promptAnswers.length < 2) {
        const safety = findReplacementAnswer(currentPrompt.id);
        promptAnswers.push({ authorId: 'DUMMY', authorName: safety.authorName || 'El Sistema', text: safety.text + ' (Reciclada)' });
    }

    promptAnswers = [...promptAnswers].sort(() => 0.5 - Math.random());

    broadcast({ type: 'PHASE_VOTING', round: serverState.currentRound, prompt: currentPrompt, answers: promptAnswers, time: 20 });
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
