let peer = null;
let conn = null; 
let hostConnections = []; 
let isHost = false;

let myId = "";
let myName = "";
let myAssignments = []; 
let myAnswers = {}; 

// Track whether answers have been submitted (for the retract feature)
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
    if (!name) {
        alert("¡Tenés que poner un nombre sí o sí, fiera!");
        return null;
    }
    return name;
}

function toggleHostView() {
    const setup = document.getElementById('host-setup');
    setup.style.display = setup.style.display === 'none' ? 'block' : 'none';
}

let visualTimer;
// Track remaining seconds locally so retract can check if time is left
let localTimerRemaining = 0;

function startLocalTimer(seconds) {
    let t = seconds;
    localTimerRemaining = t;
    const container = document.getElementById('timer-container');
    const display = document.getElementById('global-timer');
    container.style.display = 'block';
    display.innerText = t;
    
    clearInterval(visualTimer);
    visualTimer = setInterval(() => {
        t--;
        localTimerRemaining = t;
        if(t >= 0) display.innerText = t;
        if(t <= 0) clearInterval(visualTimer);
    }, 1000);
}

function stopLocalTimer() {
    clearInterval(visualTimer);
    localTimerRemaining = 0;
    if(document.getElementById('timer-container')) {
        document.getElementById('timer-container').style.display = 'none';
    }
}

// --- LÓGICA DE CLIENTE ---

function handleGameState(data) {
    switch(data.type) {
        case 'LOBBY_UPDATE':
            document.getElementById('lobby-code-big').innerText = data.code;
            const list = document.getElementById('player-list');
            list.innerHTML = '';
            data.players.forEach(p => {
                const li = document.createElement('li');
                li.innerText = `${p.name} ${p.id === myId ? '(Vos)' : ''}`;
                list.appendChild(li);
            });
            showScreen('screen-lobby');
            break;
            
        case 'PHASE_ANSWERING':
            myAssignments = data.assignments;
            myAnswers = {};
            myAnswersSubmitted = false;
            
            let roundText = data.round === 3 ? "RONDA FINAL" : `RONDA ${data.round}`;
            document.getElementById('answering-title').innerText = `${roundText}: Completá la frase`;
            
            const container = document.getElementById('prompts-container');
            container.innerHTML = '';
            myAssignments.forEach((q) => {
                container.innerHTML += `
                    <div class="prompt-card">
                        <div class="prompt-text">${q.prompt}</div>
                        <input type="text" id="answer-${q.id}" placeholder="Tirá tu mejor chamuyo..." autocomplete="off">
                    </div>
                `;
            });

            // Reset submit/retract button state
            const submitBtn = document.getElementById('btn-submit-answers');
            const retractBtn = document.getElementById('btn-retract-answers');
            submitBtn.disabled = false;
            submitBtn.innerText = "Enviar Sarasa";
            submitBtn.style.display = 'inline-block';
            retractBtn.style.display = 'none';

            startLocalTimer(data.time);
            showScreen('screen-answering');
            break;

        case 'PHASE_VOTING': {
            document.getElementById('vote-wait-msg').style.display = 'none';
            let voteRoundText = data.round === 3 ? "Votación Final" : "¡A votar!";
            document.getElementById('voting-title').innerText = voteRoundText;
            document.getElementById('vote-prompt-text').innerText = data.prompt.prompt;
            
            const btnContainer = document.getElementById('voting-buttons');
            const answersPreview = document.getElementById('voting-answers-preview');
            btnContainer.innerHTML = '';
            answersPreview.innerHTML = '';
            
            const isMyPrompt = data.answers.some(a => a.authorId === myId);

            // FEATURE 2: show all answers as readable preview cards (always visible)
            data.answers.forEach((ans) => {
                answersPreview.innerHTML += `
                    <div class="vote-answer-card" id="preview-${ans.authorId}">
                        <span class="vote-answer-text">"${ans.text}"</span>
                    </div>
                `;
            });

            if (data.round !== 3 && isMyPrompt) {
                btnContainer.innerHTML = `<p style="color:var(--accent); font-weight:bold;">Le toca votar a los demás.</p>`;
            } else {
                data.answers.forEach((ans) => {
                    const canVote = data.round === 3 ? ans.authorId !== myId : true;
                    if (canVote) {
                        btnContainer.innerHTML += `<button class="vote-btn" onclick="sendVote('${ans.authorId}', this)">"${ans.text}"</button>`;
                    }
                });
            }
            
            startLocalTimer(data.time);
            showScreen('screen-voting');
            break;
        }

        case 'VOTE_RESULT':
            stopLocalTimer();
            // Reset the view (it may have been showing a round-scores panel)
            document.getElementById('result-round-header').style.display = 'none';
            document.getElementById('result-round-scores').style.display = 'none';
            document.getElementById('result-prompt-text').style.display = 'block';
            document.getElementById('result-details').style.display = 'block';

            document.getElementById('result-prompt-text').innerText = data.prompt.prompt;
            const resContainer = document.getElementById('result-details');
            resContainer.innerHTML = '';
            
            if (data.isJinx) {
                resContainer.innerHTML = `<h3 style="color:#e74c3c;">¡CICUTA! Escribieron lo mismo. 0 Puntos.</h3>`;
            } else {
                data.results.sort((a,b) => b.votes - a.votes).forEach(res => {
                    let votersText = res.voterNames.length > 0 ? `Votado por: ${res.voterNames.join(', ')}` : 'Nadie lo votó 💀';
                    resContainer.innerHTML += `
                        <div style="background: rgba(0,0,0,0.2); padding: 10px; margin: 5px; border-radius: 5px;">
                            <strong>${res.authorName}</strong> escribió: "${res.text}" <br>
                            Votos: ${res.votes} (+${res.pointsAdded} pts) ${res.quiplash ? '🔥 ¡ALTA SARASA!' : ''}
                            <div class="voter-names">${votersText}</div>
                        </div>
                    `;
                });
            }
            showScreen('screen-vote-result');
            break;

        // FEATURE 3: between-round leaderboard — reuses screen-vote-result with alternate content
        case 'ROUND_SCORES':
            stopLocalTimer();
            document.getElementById('result-prompt-text').style.display = 'none';
            document.getElementById('result-details').style.display = 'none';

            const roundHeader = document.getElementById('result-round-header');
            const roundScores = document.getElementById('result-round-scores');
            roundHeader.innerText = `⏱ Fin de Ronda ${data.round} — Posiciones`;
            roundHeader.style.display = 'block';
            roundScores.innerHTML = '';
            data.players.sort((a,b) => b.score - a.score).forEach((p, i) => {
                roundScores.innerHTML += `<li><span>${i===0?'👑 ':''}${p.name}</span><span>${p.score} pts</span></li>`;
            });
            roundScores.style.display = 'block';
            showScreen('screen-vote-result');
            break;

        case 'PHASE_SCORES':
            stopLocalTimer();
            const scoreList = document.getElementById('final-scores');
            scoreList.innerHTML = '';
            data.players.sort((a,b) => b.score - a.score).forEach((p, i) => {
                scoreList.innerHTML += `<li><span>${i===0?'👑 ':''}${p.name}</span> <span>${p.score} pts</span></li>`;
            });
            const restartBtn = document.getElementById('host-restart');
            if (restartBtn) restartBtn.style.display = isHost ? 'block' : 'none';
            showScreen('screen-scores');
            break;
    }
}

function joinGame() {
    myName = getNickname();
    if (!myName) return;

    const code = document.getElementById('join-code').value.toUpperCase();
    if (!code) return alert("Poné un código.");

    const joinBtn = document.querySelector('#screen-home .btn-secondary');
    if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.innerText = "Conectando...";
    }
    
    peer = new Peer();
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        alert(`Error de conexión: ${err.type}. Verificá el código e intentá de nuevo.`);
        if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.innerText = "Unirse a Partida";
        }
        peer.destroy();
        peer = null;
    });

    peer.on('open', (id) => {
        myId = id;
        conn = peer.connect('sarasa-' + code);
        
        conn.on('error', (err) => {
            console.error('Connection error:', err);
            alert('No se pudo conectar a la sala. ¿El código es correcto?');
            if (joinBtn) {
                joinBtn.disabled = false;
                joinBtn.innerText = "Unirse a Partida";
            }
        });

        conn.on('open', () => {
            if (joinBtn) {
                joinBtn.disabled = false;
                joinBtn.innerText = "Unirse a Partida";
            }
            conn.send({ type: 'CMD_JOIN', name: myName, id: myId });
        });
        
        conn.on('data', (data) => handleGameState(data));
    });
}

// FEATURE 1: Submit answers — hides submit, shows retract, locks inputs
function submitAnswers() {
    let allAnswered = true;
    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        const val = input ? input.value.trim() : "";
        if (!val) allAnswered = false;
        myAnswers[q.id] = val || "Me quedé en blanco..."; 
    });

    if (!allAnswered && !confirm("¿Dejaste alguna vacía, seguro querés mandar igual?")) {
        return;
    }

    myAnswersSubmitted = true;

    const submitBtn = document.getElementById('btn-submit-answers');
    const retractBtn = document.getElementById('btn-retract-answers');
    submitBtn.style.display = 'none';
    retractBtn.style.display = 'inline-block';

    // Lock inputs visually so player can see what they sent
    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        if (input) input.disabled = true;
    });
    
    const payload = { type: 'CMD_SUBMIT_ANSWERS', answers: myAnswers, id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// FEATURE 1: Retract answers while the timer is still running
function retractAnswers() {
    if (localTimerRemaining <= 0) {
        alert("¡Se acabó el tiempo, no podés cambiar tu respuesta!");
        return;
    }

    myAnswersSubmitted = false;
    myAnswers = {};

    const submitBtn = document.getElementById('btn-submit-answers');
    const retractBtn = document.getElementById('btn-retract-answers');
    submitBtn.disabled = false;
    submitBtn.innerText = "Enviar Sarasa";
    submitBtn.style.display = 'inline-block';
    retractBtn.style.display = 'none';

    // Re-enable inputs
    myAssignments.forEach(q => {
        const input = document.getElementById(`answer-${q.id}`);
        if (input) input.disabled = false;
    });

    // Tell the host to remove our answers so they're not counted
    const payload = { type: 'CMD_RETRACT_ANSWERS', id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// FEATURE 2: after voting, highlight chosen card and dim vote buttons
function sendVote(votedForAuthorId, clickedBtn) {
    // Dim all vote buttons, highlight the chosen one
    document.querySelectorAll('.vote-btn').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.35';
    });
    if (clickedBtn) {
        clickedBtn.style.opacity = '1';
        clickedBtn.style.outline = '3px solid var(--accent)';
    }

    // Highlight the matching preview card
    const chosen = document.getElementById(`preview-${votedForAuthorId}`);
    if (chosen) chosen.classList.add('voted-highlight');

    document.getElementById('vote-wait-msg').style.display = 'block';
    
    const payload = { type: 'CMD_VOTE', authorId: votedForAuthorId, voterId: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// --- LÓGICA DEL HOST (SERVIDOR) ---

async function createGame() {
    myName = getNickname();
    if (!myName) return;

    isHost = true;
    const code = generateRoomCode();
    myId = 'HOST';
    const peerId = 'sarasa-' + code;

    const createBtn = document.querySelector('#host-setup button');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerText = "Creando sala...";
    }

    try {
        const res = await fetch('preguntas.json');
        if(res.ok) gameQuestions = await res.json();
    } catch (e) { console.warn("Usando preguntas de respaldo."); }

    serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());

    peer = new Peer(peerId);

    peer.on('error', (err) => {
        console.error('Host peer error:', err);
        isHost = false;
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerText = "Crear Nueva Sala";
        }
        if (err.type === 'unavailable-id') {
            alert('Ese código de sala ya está en uso, intentá de nuevo.');
        } else {
            alert(`Error al crear la sala: ${err.type}`);
        }
        peer.destroy();
        peer = null;
    });

    peer.on('open', (id) => {
        serverState.roomCode = code;
        serverState.players.push({ id: myId, name: myName, score: 0 });
        
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('room-display-tag').innerText = `SALA: ${code}`;
        document.getElementById('room-display-tag').style.display = 'block';
        document.getElementById('lobby-code-big').innerText = code;

        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerText = "Crear Nueva Sala";
        }

        showScreen('screen-lobby');

        broadcast({ 
            type: 'LOBBY_UPDATE', 
            players: serverState.players, 
            code: serverState.roomCode,
            phase: serverState.phase 
        });
    });

    peer.on('connection', (connection) => {
        hostConnections.push(connection);
        connection.on('data', (data) => handleCommandFromClient(data));

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

function broadcast(data) {
    handleGameState(data);
    hostConnections.forEach(c => c.send(data));
}

function handleCommandFromClient(data) {
    if (data.type === 'CMD_JOIN') {
        const existingIdx = serverState.players.findIndex(p => p.id === data.id);
        if (existingIdx !== -1) {
            serverState.players[existingIdx].name = data.name;
        } else {
            serverState.players.push({ id: data.id, name: data.name, score: 0 });
        }
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
            const alreadyAnswered = serverState.answers[qId].some(a => a.authorId === pId);
            if (!alreadyAnswered) {
                serverState.answers[qId].push({ authorId: pId, text: text });
            }
        }
        
        let expectedAnswersPerPlayer = serverState.currentRound <= 2 ? 2 : 1;
        let totalExpected = serverState.players.length * expectedAnswersPerPlayer;
        let totalReceived = Object.values(serverState.answers).flat().length;
        
        if (totalReceived >= totalExpected && serverState.phase === 'ANSWERING') {
            clearTimeout(serverState.timerTimeout);
            startVotingPhase();
        }
    }
    // FEATURE 1: remove this player's answers from the current round so they can re-submit
    else if (data.type === 'CMD_RETRACT_ANSWERS') {
        const pId = data.id;
        for (const qId of Object.keys(serverState.answers)) {
            serverState.answers[qId] = serverState.answers[qId].filter(a => a.authorId !== pId);
        }
        // No broadcast needed — silently un-count them
    }
    else if (data.type === 'CMD_VOTE') {
        const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
        if (!serverState.votes[currentPrompt.id]) serverState.votes[currentPrompt.id] = [];

        const alreadyVoted = serverState.votes[currentPrompt.id].some(v => v.voterId === data.voterId);
        if (!alreadyVoted) {
            serverState.votes[currentPrompt.id].push({voterId: data.voterId, votedFor: data.authorId});
        }
        
        let expectedVotes = serverState.currentRound <= 2 ? serverState.players.length - 2 : serverState.players.length;
        if (serverState.votes[currentPrompt.id].length >= expectedVotes) {
            clearTimeout(serverState.timerTimeout);
            processVotingResults();
        }
    }
}

function startGame() {
    if (serverState.players.length < 3) {
        alert("Se necesitan al menos 3 jugadores."); return;
    }
    serverState.currentRound = 1;
    serverState.players.forEach(p => p.score = 0);
    startRound();
}

function startRound() {
    serverState.phase = 'ANSWERING';
    serverState.answers = {};
    serverState.votes = {};
    serverState.currentVoteIndex = 0;
    
    const players = serverState.players;
    const N = players.length;
    
    if (serverState.currentRound <= 2) {
        if (serverState.unusedPrompts.length < N) {
            serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());
        }
        serverState.prompts = serverState.unusedPrompts.splice(0, N);
        
        for (let i = 0; i < N; i++) {
            let pId = players[i].id;
            serverState.assignments[pId] = [
                serverState.prompts[i],
                serverState.prompts[(i + 1) % N]
            ];
        }
    } else {
        if (serverState.unusedPrompts.length < 1) {
            serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());
        }
        let finalPrompt = serverState.unusedPrompts.splice(0, 1)[0];
        serverState.prompts = [finalPrompt];
        players.forEach(p => serverState.assignments[p.id] = [finalPrompt]);
    }

    broadcastAnsweringPhase();
}

function broadcastAnsweringPhase() {
    hostConnections.forEach(c => {
        c.send({ 
            type: 'PHASE_ANSWERING', 
            round: serverState.currentRound, 
            assignments: serverState.assignments[c.peer], 
            time: 60 
        });
    });
    handleGameState({ 
        type: 'PHASE_ANSWERING', 
        round: serverState.currentRound, 
        assignments: serverState.assignments[myId], 
        time: 60 
    });

    serverState.timerTimeout = setTimeout(() => {
        if(serverState.phase === 'ANSWERING') forceSubmitMissing();
    }, 60000);
}

function forceSubmitMissing() {
    for (const [pId, assignedPrompts] of Object.entries(serverState.assignments)) {
        assignedPrompts.forEach(q => {
            if (!serverState.answers[q.id]) serverState.answers[q.id] = [];
            const hasAnswered = serverState.answers[q.id].some(a => a.authorId === pId);
            if (!hasAnswered) {
                serverState.answers[q.id].push({ authorId: pId, text: "Me colgué mal..." });
            }
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
            // FEATURE 3: broadcast between-round leaderboard, then start next round after 5s
            broadcast({ type: 'ROUND_SCORES', round: serverState.currentRound - 1, players: serverState.players });
            setTimeout(() => startRound(), 5000);
        }
        return;
    }

    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    let promptAnswers = serverState.answers[currentPrompt.id] || [];

    if (serverState.currentRound <= 2 && promptAnswers.length < 2) {
        let safetyAnswer = findReplacementAnswer(currentPrompt.id);
        promptAnswers.push({ 
            authorId: 'DUMMY', 
            authorName: safetyAnswer.authorName || "El Sistema", 
            text: safetyAnswer.text + " (Reciclada)" 
        });
    }
    
    promptAnswers = promptAnswers.sort(() => 0.5 - Math.random());

    broadcast({ 
        type: 'PHASE_VOTING', 
        round: serverState.currentRound, 
        prompt: currentPrompt, 
        answers: promptAnswers, 
        time: 20 
    });

    serverState.timerTimeout = setTimeout(() => {
        processVotingResults();
    }, 20000);
}

function findReplacementAnswer(excludeQId) {
    let allHistory = [];
    Object.keys(serverState.answers).forEach(qId => {
        if(qId != excludeQId) allHistory.push(...serverState.answers[qId]);
    });

    if (allHistory.length > 0) {
        return allHistory[Math.floor(Math.random() * allHistory.length)];
    }
    return { authorName: "El Sistema", text: "¡Sarasa Cósmica!" };
}

function processVotingResults() {
    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    const promptAnswers = serverState.answers[currentPrompt.id] || [];
    const votes = serverState.votes[currentPrompt.id] || [];
    
    let isJinx = false;
    let resultsData = [];

    if (serverState.currentRound <= 2 && promptAnswers.length === 2 && promptAnswers[0].text.toLowerCase() === promptAnswers[1].text.toLowerCase()) {
        isJinx = true;
    }

    const totalVotes = votes.length;
    let roundMultiplier = serverState.currentRound === 2 ? 2 : (serverState.currentRound === 3 ? 3 : 1);

    promptAnswers.forEach(ans => {
        let author = serverState.players.find(p => p.id === ans.authorId);
        let authorName = ans.authorId === 'DUMMY' ? ans.authorName : (author ? author.name : 'Desconocido');
        
        let voterDetails = votes.filter(v => v.votedFor === ans.authorId).map(v => {
            let voterInfo = serverState.players.find(p => p.id === v.voterId);
            return voterInfo ? voterInfo.name : 'Alguien';
        });

        let voteCount = voterDetails.length;
        let pointsAdded = 0;
        let quiplash = false;

        if (!isJinx && totalVotes > 0) {
            pointsAdded = Math.floor((voteCount / totalVotes) * 1000) * roundMultiplier;
            if (serverState.currentRound <= 2 && voteCount === totalVotes && totalVotes > 0) {
                pointsAdded += (500 * roundMultiplier); 
                quiplash = true;
            }
        }

        if (author && !isJinx && ans.authorId !== 'DUMMY') author.score += pointsAdded;

        resultsData.push({ 
            authorName, 
            text: ans.text, 
            votes: voteCount, 
            voterNames: voterDetails, 
            pointsAdded, 
            quiplash 
        });
    });

    broadcast({ type: 'VOTE_RESULT', prompt: currentPrompt, isJinx, results: resultsData });

    setTimeout(() => {
        serverState.currentVoteIndex++;
        startVotingPhase();
    }, 8000);
}
