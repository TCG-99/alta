let peer = null;
let conn = null; 
let hostConnections = []; 
let isHost = false;

let myId = "";
let myName = "";
let myAssignments = []; 
let myAnswers = {}; 

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
function startLocalTimer(seconds) {
    let t = seconds;
    const container = document.getElementById('timer-container');
    const display = document.getElementById('global-timer');
    container.style.display = 'block';
    display.innerText = t;
    
    clearInterval(visualTimer);
    visualTimer = setInterval(() => {
        t--;
        if(t >= 0) display.innerText = t;
        if(t <= 0) clearInterval(visualTimer);
    }, 1000);
}

function stopLocalTimer() {
    clearInterval(visualTimer);
    if(document.getElementById('timer-container')) {
        document.getElementById('timer-container').style.display = 'none';
    }
}

// --- LÓGICA DE CLIENTE ---

function handleGameState(data) {
    switch(data.type) {
        case 'LOBBY_UPDATE':
            document.getElementById('display-room-code').innerText = data.code;
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
            document.getElementById('btn-submit-answers').disabled = false;
            document.getElementById('btn-submit-answers').innerText = "Enviar Sarasa";
            startLocalTimer(data.time);
            showScreen('screen-answering');
            break;

        case 'PHASE_VOTING':
            document.getElementById('vote-wait-msg').style.display = 'none';
            let voteRoundText = data.round === 3 ? "Votación Final" : "¡A votar!";
            document.getElementById('voting-title').innerText = voteRoundText;
            document.getElementById('vote-prompt-text').innerText = data.prompt.prompt;
            
            const btnContainer = document.getElementById('voting-buttons');
            btnContainer.innerHTML = '';
            
            const isMyPrompt = data.answers.some(a => a.authorId === myId);
            
            data.answers.forEach((ans) => {
                // En ronda 3 votan todos a todos (menos a uno mismo)
                // En rondas 1-2, si es tu prompt, no votás.
                if (data.round === 3) {
                    if (ans.authorId !== myId) {
                        btnContainer.innerHTML += `<button class="vote-btn" onclick="sendVote('${ans.authorId}')">"${ans.text}"</button>`;
                    }
                } else {
                    if (isMyPrompt) {
                        btnContainer.innerHTML = `<p style="color:var(--accent); font-weight:bold;">Le toca votar a los demás.</p>`;
                    } else {
                        btnContainer.innerHTML += `<button class="vote-btn" onclick="sendVote('${ans.authorId}')">"${ans.text}"</button>`;
                    }
                }
            });
            
            startLocalTimer(data.time);
            showScreen('screen-voting');
            break;

        case 'VOTE_RESULT':
            stopLocalTimer();
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

        case 'PHASE_SCORES':
            stopLocalTimer();
            const scoreList = document.getElementById('final-scores');
            scoreList.innerHTML = '';
            data.players.sort((a,b) => b.score - a.score).forEach((p, i) => {
                scoreList.innerHTML += `<li><span>${i===0?'👑 ':''}${p.name}</span> <span>${p.score} pts</span></li>`;
            });
            if(isHost) document.getElementById('host-restart').style.display = 'block';
            showScreen('screen-scores');
            break;
    }
}

function joinGame() {
    myName = getNickname();
    if (!myName) return;

    const code = document.getElementById('join-code').value.toUpperCase();
    if (!code) return alert("Poné un código.");
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        myId = id;
        conn = peer.connect('sarasa-' + code);
        
        conn.on('open', () => {
            document.getElementById('client-wait').style.display = 'block';
            conn.send({ type: 'CMD_JOIN', name: myName, id: myId });
        });
        
        conn.on('data', (data) => handleGameState(data));
    });
}

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

    document.getElementById('btn-submit-answers').disabled = true;
    document.getElementById('btn-submit-answers').innerText = "Esperando al resto...";
    
    const payload = { type: 'CMD_SUBMIT_ANSWERS', answers: myAnswers, id: myId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

function sendVote(votedForAuthorId) {
    document.getElementById('voting-buttons').innerHTML = '';
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

    try {
        const res = await fetch('preguntas.json');
        if(res.ok) gameQuestions = await res.json();
    } catch (e) { console.warn("Usando preguntas de respaldo."); }

    serverState.unusedPrompts = [...gameQuestions].sort(() => 0.5 - Math.random());

    peer = new Peer(peerId);

    peer.on('open', (id) => {
        serverState.roomCode = code;
        serverState.players.push({ id: myId, name: myName, score: 0 });
        
        // UI Updates del Host
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('room-display-tag').innerText = `SALA: ${code}`;
        document.getElementById('room-display-tag').style.display = 'block';
        document.getElementById('lobby-code-big').innerText = code;

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
    });
}

function broadcast(data) {
    handleGameState(data);
    hostConnections.forEach(c => c.send(data));
}

function handleCommandFromClient(data) {
    if (data.type === 'CMD_JOIN') {
        // ANTI-FANTASMAS
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
            serverState.answers[qId].push({ authorId: pId, text: text });
        }
        
        let expectedAnswersPerPlayer = serverState.currentRound <= 2 ? 2 : 1;
        let totalExpected = serverState.players.length * expectedAnswersPerPlayer;
        let totalReceived = Object.values(serverState.answers).flat().length;
        
        if (totalReceived >= totalExpected && serverState.phase === 'ANSWERING') {
            clearTimeout(serverState.timerTimeout);
            startVotingPhase();
        }
    }
    else if (data.type === 'CMD_VOTE') {
        const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
        if (!serverState.votes[currentPrompt.id]) serverState.votes[currentPrompt.id] = [];
        serverState.votes[currentPrompt.id].push({voterId: data.voterId, votedFor: data.authorId});
        
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
        // Ronda Final igual para todos
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
            startRound();
        }
        return;
    }

    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    let promptAnswers = serverState.answers[currentPrompt.id] || [];

    // REUTILIZAR RESPUESTA (Caso de jugador sin pareja o respuesta vacía)
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
