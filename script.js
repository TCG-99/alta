let peer = null;
let conn = null; // Cliente conectado al Host
let hostConnections = []; // Host conectado a clientes
let isHost = false;

// Datos del jugador local
let myId = "";
let myName = "";
let myAssignments = []; // Preguntas a responder
let myAnswers = {}; // Mis respuestas redactadas

// Estado del Servidor (Solo manejado por el Host)
let serverState = {
    players: [], // {id, name, score}
    prompts: [], // Preguntas seleccionadas para la ronda
    assignments: {}, // idJugador -> [idPregunta1, idPregunta2]
    answers: {}, // idPregunta -> [{authorId, text}]
    votes: {}, // idPregunta -> [votedForAuthorId]
    currentVoteIndex: 0,
    timerTimeout: null
};

// Preguntas de respaldo si no hay JSON
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
        const adjs = ['Pibe', 'Gato', 'Capo', 'Fiera', 'Loco', 'Crack'];
        const nouns = ['Místico', 'Cósmico', 'Rancio', 'Picante', 'Basado'];
        name = `${adjs[Math.floor(Math.random()*adjs.length)]} ${nouns[Math.floor(Math.random()*nouns.length)]}`;
    }
    return name;
}

// Temporizador Visual (Se ejecuta en Host y Clientes)
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
    document.getElementById('timer-container').style.display = 'none';
}

// --- LÓGICA DEL JUEGO (UI LOCAL - TODOS) ---
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
            const container = document.getElementById('prompts-container');
            container.innerHTML = '';
            myAssignments.forEach((q, index) => {
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
            document.getElementById('vote-prompt-text').innerText = data.prompt.prompt;
            const btnContainer = document.getElementById('voting-buttons');
            btnContainer.innerHTML = '';
            
            // Si el jugador escribió una de las respuestas, no puede votar
            const isMyPrompt = data.answers.some(a => a.authorId === myId);
            
            if (isMyPrompt) {
                btnContainer.innerHTML = `<p style="color:var(--accent); font-weight:bold;">¡Estás en este duelo! Calladito la boca y esperá.</p>`;
            } else {
                data.answers.forEach((ans, idx) => {
                    btnContainer.innerHTML += `<button class="vote-btn" onclick="sendVote('${ans.authorId}')">"${ans.text}"</button>`;
                });
            }
            startLocalTimer(data.time);
            showScreen('screen-voting');
            break;

        case 'VOTE_RESULT':
            stopLocalTimer();
            document.getElementById('result-prompt-text').innerText = data.prompt.prompt;
            const resContainer = document.getElementById('result-details');
            resContainer.innerHTML = '';
            
            if (data.isJinx) {
                resContainer.innerHTML = `<h3 style="color:#e74c3c;">¡CICUTA! Escribieron lo mismo. 0 Puntos para los giles.</h3>`;
            } else {
                data.results.forEach(res => {
                    resContainer.innerHTML += `
                        <div style="background: rgba(0,0,0,0.2); padding: 10px; margin: 5px; border-radius: 5px;">
                            <strong>${res.authorName}</strong> escribió: "${res.text}" <br>
                            Votos: ${res.votes} (+${res.pointsAdded} pts) ${res.quiplash ? '🔥 ¡ALTA SARASA!' : ''}
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

// --- LÓGICA DEL CLIENTE (E INTERFAZ) ---
function joinGame() {
    const code = document.getElementById('join-code').value.toUpperCase();
    if (!code) return alert("Poné un código.");
    
    myName = getNickname();
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
        const val = document.getElementById(`answer-${q.id}`).value.trim();
        if (!val) allAnswered = false;
        myAnswers[q.id] = val || "Me quedé dormido..."; // Fallback si la dejan vacía
    });

    if (!allAnswered && confirm("¿Dejaste alguna vacía, seguro querés mandar igual?")) {
        // Enviar igual
    } else if (!allAnswered) {
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
    
    const payload = { type: 'CMD_VOTE', authorId: votedForAuthorId };
    if (isHost) handleCommandFromClient(payload);
    else conn.send(payload);
}

// --- LÓGICA DEL HOST (SERVIDOR) ---
async function createGame() {
    isHost = true;
    myName = getNickname();
    const code = generateRoomCode();
    myId = 'HOST';
    const peerId = 'sarasa-' + code;

    // Cargar Preguntas
    try {
        const res = await fetch('preguntas.json');
        if(res.ok) gameQuestions = await res.json();
    } catch (e) { console.warn("Usando preguntas de respaldo."); }

    peer = new Peer(peerId);

    peer.on('open', (id) => {
        serverState.roomCode = code;
        // El Host se agrega a sí mismo como jugador
        serverState.players.push({ id: myId, name: myName, score: 0 });
        
        document.getElementById('host-controls').style.display = 'block';
        broadcast({ type: 'LOBBY_UPDATE', players: serverState.players, code: serverState.roomCode });
    });

    peer.on('connection', (connection) => {
        hostConnections.push(connection);
        connection.on('data', (data) => handleCommandFromClient(data));
    });
}

function broadcast(data) {
    // 1. Actualiza la UI del Host local
    handleGameState(data);
    // 2. Envía a todos los clientes
    hostConnections.forEach(c => c.send(data));
}

function handleCommandFromClient(data) {
    if (data.type === 'CMD_JOIN') {
        serverState.players.push({ id: data.id, name: data.name, score: 0 });
        broadcast({ type: 'LOBBY_UPDATE', players: serverState.players, code: serverState.roomCode });
    } 
    else if (data.type === 'CMD_SUBMIT_ANSWERS') {
        const pId = data.id;
        for (const [qId, text] of Object.entries(data.answers)) {
            if (!serverState.answers[qId]) serverState.answers[qId] = [];
            serverState.answers[qId].push({ authorId: pId, text: text });
        }
        
        // Chequear si todos respondieron (cada jugador envía 2)
        let totalExpected = serverState.players.length * 2;
        let totalReceived = Object.values(serverState.answers).flat().length;
        if (totalReceived >= totalExpected && serverState.phase === 'ANSWERING') {
            clearTimeout(serverState.timerTimeout);
            startVotingPhase();
        }
    }
    else if (data.type === 'CMD_VOTE') {
        const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
        if (!serverState.votes[currentPrompt.id]) serverState.votes[currentPrompt.id] = [];
        serverState.votes[currentPrompt.id].push(data.authorId);
        
        // Esperamos votos de todos menos de los 2 que escribieron
        let expectedVotes = serverState.players.length - 2;
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
    
    serverState.phase = 'ANSWERING';
    const N = serverState.players.length;
    
    // Mezclar preguntas y elegir N
    let shuffledQ = [...gameQuestions].sort(() => 0.5 - Math.random());
    serverState.prompts = shuffledQ.slice(0, N);
    
    // Asignar 2 preguntas a cada jugador (Cada pregunta la ven exactamente 2 jugadores)
    for (let i = 0; i < N; i++) {
        let pId = serverState.players[i].id;
        serverState.assignments[pId] = [
            serverState.prompts[i],
            serverState.prompts[(i + 1) % N]
        ];
    }

    // Enviar estado personalizado a cada cliente (para que no vean las preguntas del resto)
    hostConnections.forEach(c => {
        c.send({ type: 'PHASE_ANSWERING', assignments: serverState.assignments[c.peer], time: 60 });
    });
    // Actualizar host local
    handleGameState({ type: 'PHASE_ANSWERING', assignments: serverState.assignments[myId], time: 60 });

    serverState.timerTimeout = setTimeout(() => {
        if(serverState.phase === 'ANSWERING') startVotingPhase();
    }, 60000);
}

function startVotingPhase() {
    serverState.phase = 'VOTING';
    if (serverState.currentVoteIndex >= serverState.prompts.length) {
        broadcast({ type: 'PHASE_SCORES', players: serverState.players });
        return;
    }

    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    let promptAnswers = serverState.answers[currentPrompt.id] || [];
    
    // Si alguien no respondió por timeout, generar relleno
    while(promptAnswers.length < 2) {
        promptAnswers.push({authorId: 'BOT', text: 'Zzz...'});
    }

    // Mezclar respuestas para que no sepan quién es A y B
    promptAnswers = promptAnswers.sort(() => 0.5 - Math.random());

    broadcast({ type: 'PHASE_VOTING', prompt: currentPrompt, answers: promptAnswers, time: 20 });

    serverState.timerTimeout = setTimeout(() => {
        processVotingResults();
    }, 20000);
}

function processVotingResults() {
    const currentPrompt = serverState.prompts[serverState.currentVoteIndex];
    const promptAnswers = serverState.answers[currentPrompt.id] || [];
    const votes = serverState.votes[currentPrompt.id] || [];
    
    let isJinx = false;
    let resultsData = [];

    // Validar Jinx (Textos idénticos ignorando mayúsculas)
    if (promptAnswers.length === 2 && promptAnswers[0].text.toLowerCase() === promptAnswers[1].text.toLowerCase()) {
        isJinx = true;
    }

    const totalVotes = votes.length;

    promptAnswers.forEach(ans => {
        let author = serverState.players.find(p => p.id === ans.authorId);
        let authorName = author ? author.name : 'Desconocido';
        let voteCount = votes.filter(v => v === ans.authorId).length;
        let pointsAdded = 0;
        let quiplash = false;

        if (!isJinx && totalVotes > 0) {
            pointsAdded = Math.floor((voteCount / totalVotes) * 1000); // Proporcional
            if (voteCount === totalVotes && totalVotes > 0) {
                pointsAdded += 500; // Bonus Alta Sarasa
                quiplash = true;
            }
        }

        if (author && !isJinx) author.score += pointsAdded;

        resultsData.push({ authorName, text: ans.text, votes: voteCount, pointsAdded, quiplash });
    });

    broadcast({ type: 'VOTE_RESULT', prompt: currentPrompt, isJinx, results: resultsData });

    // Esperar unos segundos viendo los resultados y pasar a la siguiente
    setTimeout(() => {
        serverState.currentVoteIndex++;
        startVotingPhase();
    }, 6000);
}
