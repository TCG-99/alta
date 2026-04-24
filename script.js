let peer = null;
let conn = null; // Para clientes: conexión al host
let hostConnections = []; // Para host: array de conexiones de clientes
let players = [];
let isHost = false;
let myName = "";
let currentPromptId = null;

// Preguntas cargadas desde el JSON
let gameQuestions = [];

// Función utilitaria para cambiar pantallas
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// Genera un código de 4 letras al azar para la sala
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ---------------- HOST LOGIC ----------------
async function createGame() {
    isHost = true;
    const code = generateRoomCode();
    const peerId = 'sarasa-' + code; // Prefijo para evitar colisiones en la red pública de PeerJS

    peer = new Peer(peerId);

    peer.on('open', (id) => {
        document.getElementById('display-room-code').innerText = code;
        showScreen('screen-lobby-host');
        loadQuestions(); // Cargar el JSON mientras se unen
    });

    peer.on('connection', (connection) => {
        connection.on('data', (data) => handleDataFromClient(connection, data));
        hostConnections.push(connection);
    });
}

async function loadQuestions() {
    try {
        const response = await fetch('preguntas.json');
        gameQuestions = await response.json();
    } catch (error) {
        console.error("Error cargando preguntas:", error);
    }
}

function handleDataFromClient(connection, data) {
    if (data.type === 'JOIN') {
        players.push({ id: connection.peer, name: data.name, score: 0 });
        updatePlayerList();
        // Avisarle al cliente que entró bien
        connection.send({ type: 'ROOM_JOINED' });
    } else if (data.type === 'ANSWER') {
        console.log(`${data.name} respondió: ${data.answer}`);
        // Acá iría la lógica para guardar las respuestas y pasar a la votación
        // cuando todos hayan contestado.
    }
}

function updatePlayerList() {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name;
        list.appendChild(li);
    });
}

function startGame() {
    if (players.length < 3) {
        alert("¡Mínimo 3 jugadores para que tenga gracia!");
        // return; // Comentado para que puedas probarlo solo o de a 2
    }
    
    // Asignar una pregunta al azar de prueba (En el juego real se asignan 2 por jugador cruzadas)
    const randomQuestion = gameQuestions[Math.floor(Math.random() * gameQuestions.length)];
    
    // Broadcast a todos los clientes para que vayan a la pantalla de preguntas
    hostConnections.forEach(conn => {
        conn.send({ 
            type: 'STATE_PROMPT', 
            question: randomQuestion.prompt,
            questionId: randomQuestion.id
        });
    });

    // El host también cambia su pantalla si está jugando desde el mismo dispositivo
    // (Opcional: el host podría ser solo un tablero)
}


// ---------------- CLIENT LOGIC ----------------
function joinGame() {
    const code = document.getElementById('join-code').value.toUpperCase();
    myName = document.getElementById('player-name').value;

    if (!code || !myName) {
        alert("Poné un código y un nombre, no seas botón.");
        return;
    }

    peer = new Peer(); // ID dinámico para el cliente
    
    peer.on('open', (id) => {
        // Conectar al host
        conn = peer.connect('sarasa-' + code);

        conn.on('open', () => {
            // Enviar info del jugador
            conn.send({ type: 'JOIN', name: myName });
        });

        conn.on('data', handleDataFromHost);
    });
}

function handleDataFromHost(data) {
    if (data.type === 'ROOM_JOINED') {
        showScreen('screen-lobby-client');
    } else if (data.type === 'STATE_PROMPT') {
        currentPromptId = data.questionId;
        document.getElementById('prompt-text').innerText = data.question;
        document.getElementById('answer-input').value = '';
        showScreen('screen-prompt');
    }
}

function submitAnswer() {
    const answer = document.getElementById('answer-input').value;
    if (!answer) return;

    // Enviar respuesta al host
    conn.send({
        type: 'ANSWER',
        questionId: currentPromptId,
        name: myName,
        answer: answer
    });

    showScreen('screen-waiting');
}