// --- Audio System (Web Audio API) ---
let audioCtx = null;
const frequencies = {
    green: 329.63, // E4
    red: 261.63,   // C4
    yellow: 277.18,// C#4
    blue: 415.30,  // G#4
    error: 150     // Basso
};

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playSound(color, duration = 300) {
    if (!audioCtx) return;
    
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = color === 'error' ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(frequencies[color], audioCtx.currentTime);
    
    // Envelope for a smooth pop sound
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (duration / 1000));
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + (duration / 1000) + 0.1);
}

// --- Game Logic ---
const colors = ['green', 'red', 'yellow', 'blue'];
let sequence = [];
let playerSequence = [];
let score = 0;
let highScore = localStorage.getItem('simonHighScore') || 0;
let isPlayerTurn = false;

// Difficulty Settings
let baseLightDuration = 500;
let baseGapDuration = 250;
const MIN_LIGHT_DURATION = 200;
const MIN_GAP_DURATION = 100;

// DOM Elements
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const gameOverModal = document.getElementById('game-over-modal');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart-btn');
const simonBtns = document.querySelectorAll('.simon-btn');

// Initialize UI
highScoreEl.textContent = highScore;

// Event Listeners
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', resetGame);

simonBtns.forEach(btn => {
    // Utilizziamo 'pointerdown' per una risposta più immediata su mobile
    btn.addEventListener('pointerdown', handlePlayerInput);
});

function startGame() {
    initAudio();
    score = 0;
    sequence = [];
    playerSequence = [];
    baseLightDuration = 500; // Reset difficulty
    baseGapDuration = 250;
    
    updateScore();
    startBtn.classList.add('hidden');
    statusText.classList.remove('hidden');
    
    setTimeout(nextRound, 500);
}

function nextRound() {
    playerSequence = [];
    score = sequence.length;
    updateScore();
    
    // Aumenta la difficoltà (diminuisce i tempi del 5% ad ogni round)
    if (score > 0) {
        baseLightDuration = Math.max(MIN_LIGHT_DURATION, baseLightDuration * 0.95);
        baseGapDuration = Math.max(MIN_GAP_DURATION, baseGapDuration * 0.95);
    }
    
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    sequence.push(randomColor);
    
    playSequence();
}

async function playSequence() {
    isPlayerTurn = false;
    disableButtons();
    statusText.textContent = "GUARDA";
    
    // Attendi un attimo prima di mostrare la sequenza
    await new Promise(resolve => setTimeout(resolve, 800));
    
    for (let i = 0; i < sequence.length; i++) {
        const color = sequence[i];
        await activateButton(color, baseLightDuration);
        await new Promise(resolve => setTimeout(resolve, baseGapDuration));
    }
    
    isPlayerTurn = true;
    enableButtons();
    statusText.textContent = "TOCCA A TE";
}

function activateButton(color, duration) {
    return new Promise(resolve => {
        const btn = document.getElementById(color);
        btn.classList.add('active');
        playSound(color, duration);
        
        setTimeout(() => {
            btn.classList.remove('active');
            resolve();
        }, duration);
    });
}

function handlePlayerInput(e) {
    if (!isPlayerTurn) return;
    
    // Audio Context might need user interaction to unlock completely on some iOS devices
    initAudio(); 
    
    const color = e.target.dataset.color;
    playerSequence.push(color);
    
    const btn = document.getElementById(color);
    btn.classList.add('active');
    playSound(color, 250); // Feedback immediato
    
    setTimeout(() => {
        btn.classList.remove('active');
    }, 200);
    
    checkSequence(playerSequence.length - 1);
}

function checkSequence(currentLevel) {
    if (playerSequence[currentLevel] === sequence[currentLevel]) {
        // Se ha finito la sequenza corretta
        if (playerSequence.length === sequence.length) {
            isPlayerTurn = false;
            statusText.textContent = "ESATTO!";
            setTimeout(nextRound, 1000);
        }
    } else {
        // Errore
        gameOver();
    }
}

function gameOver() {
    isPlayerTurn = false;
    playSound('error', 800);
    
    document.body.style.backgroundColor = "var(--color-red-glow)";
    setTimeout(() => {
        document.body.style.backgroundColor = "";
    }, 200);

    if (score > highScore) {
        highScore = score;
        localStorage.setItem('simonHighScore', highScore);
        highScoreEl.textContent = highScore;
    }
    
    finalScoreEl.textContent = score;
    gameOverModal.classList.remove('hidden');
    statusText.classList.add('hidden');
}

function resetGame() {
    gameOverModal.classList.add('hidden');
    startBtn.classList.remove('hidden');
    score = 0;
    updateScore();
}

function updateScore() {
    scoreEl.textContent = score;
}

function disableButtons() {
    simonBtns.forEach(btn => btn.classList.add('unclickable'));
}

function enableButtons() {
    simonBtns.forEach(btn => btn.classList.remove('unclickable'));
}
