const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let track;
let cars = [];
let ais = [];
let playerCar;
let gameState = 'menu'; // 'menu', 'countdown', 'playing', 'gameover'
let lastTime = 0;
let TOTAL_LAPS = 10;
let countdownTimer = 0;
let lightState = 0;
let goDelay = 0;
let raceStartTime = 0;
let leaderFinished = false;
let leaderRaceTime = 0;
let raceFinished = false;
let isFalseStartResetting = false;

// Championship State
let isChampionship = false;
let championshipState = null;
// UI Elements
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const gameOverScreen = document.getElementById('game-over');
const startBtn = document.getElementById('start-btn');
const champBtn = document.getElementById('champ-btn');
const restartBtn = document.getElementById('restart-btn');
const nextRoundBtn = document.getElementById('next-round-btn');
const champFinalScreen = document.getElementById('championship-final');
const champStatsBody = document.getElementById('champ-stats-body');
const champRestartBtn = document.getElementById('champ-restart-btn');
const champRecapSection = document.getElementById('champ-recap-section');
const champRecapBody = document.getElementById('champ-recap-body');
const lapCounter = document.getElementById('lap-counter');
const posCounter = document.getElementById('position-counter');
const speedometer = document.getElementById('speedometer');
const quitBtn = document.getElementById('quitBtn');
const resultMessage = document.getElementById('result-message');
const winnerAnnouncement = document.getElementById('winner-announcement');
const winnerText = document.getElementById('winner-text');
const statsBody = document.getElementById('stats-body');

const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};

window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = true;
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = false;
        e.preventDefault();
    }
});

startBtn.addEventListener('click', () => {
    isChampionship = false;
    startGame();
});

champBtn.addEventListener('click', () => {
    isChampionship = true;
    startChampionship();
});

restartBtn.addEventListener('click', () => {
    gameOverScreen.style.display = 'none';
    menu.style.display = 'block';
});

nextRoundBtn.addEventListener('click', () => {
    gameOverScreen.style.display = 'none';
    nextChampionshipRound();
});

champRestartBtn.addEventListener('click', () => {
    champFinalScreen.style.display = 'none';
    menu.style.display = 'block';
});

quitBtn.addEventListener('click', () => {
    gameState = 'menu';
    hud.style.display = 'none';
    if (isMobile) mobileControls.style.display = 'none';
    menu.style.display = 'block';
    if (typeof stopAudio === 'function') stopAudio();
    isChampionship = false;
});

// Mobile Controls detection and mapping
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const mobileControls = document.getElementById('mobile-controls');

if (isMobile) {
    const btnUp = document.getElementById('btnUp');
    const btnDown = document.getElementById('btnDown');
    const btnLeft = document.getElementById('btnLeft');
    const btnRight = document.getElementById('btnRight');
    
    const bindTouch = (btn, keyName) => {
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[keyName] = true; });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); keys[keyName] = false; });
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); keys[keyName] = false; });
    };
    
    bindTouch(btnUp, 'ArrowUp');
    bindTouch(btnDown, 'ArrowDown');
    bindTouch(btnLeft, 'ArrowLeft');
    bindTouch(btnRight, 'ArrowRight');
}

function startGame(forceTrackType = null) {
    menu.style.display = 'none';
    hud.style.display = 'flex';
    if (isMobile) mobileControls.style.display = 'flex';
    
    TOTAL_LAPS = parseInt(document.getElementById('laps-select').value, 10);
    const trackType = forceTrackType || document.getElementById('track-select').value;
    const color = document.getElementById('color-select').value;
    const difficulty = document.getElementById('difficulty-select').value;
    const numOpponents = parseInt(document.getElementById('opponents-select').value, 10);
    
    if (trackType === 'f1') {
        track = new F1Track();
    } else if (trackType === 'peanut') {
        track = new PeanutTrack();
    } else if (trackType === 'circomassimo') {
        track = new CircoMassimoTrack();
    } else {
        track = new OvalTrack();
    }
    
    cars = [];
    ais = [];
    
    const numCars = isChampionship ? championshipState.participants.length : (numOpponents + 1);
    const startX = track.startX;
    let baseY = track.startY;
    
    // Create an array of spawn positions (x, y)
    const gridPositions = [];
    for(let i=0; i<numCars; i++) {
        // Staggered by 30px backward each position.
        // Alternate side: +20px and -20px from center.
        const xPos = startX - (i * 30);
        const yPos = baseY + (i % 2 === 0 ? 20 : -20);
        gridPositions.push({x: xPos, y: yPos});
    }
    
    let currentParticipants = [];
    
    if (isChampionship) {
        // Use championship participants (persists skill variations)
        currentParticipants = [...championshipState.participants];
    } else {
        // 1. Add Player
        currentParticipants.push({ isPlayer: true, color: color, skillVariation: 1 });
        // 2. Add AI Opponents
        const possibleColors = ['red', 'blue', 'yellow', 'purple', 'orange', 'white', 'green', 'cyan', 'pink', 'gray', 'lime', 'black'];
        const aiColors = possibleColors.filter(c => c !== color);
        for (let i = 0; i < numOpponents; i++) {
            currentParticipants.push({ isPlayer: false, color: aiColors[i % aiColors.length], skillVariation: null });
        }
    }
    
    // 3. Shuffle participants for a random starting grid
    for (let i = currentParticipants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentParticipants[i], currentParticipants[j]] = [currentParticipants[j], currentParticipants[i]];
    }
    
    // 4. Instantiate cars at their assigned grid positions
    for (let i = 0; i < currentParticipants.length; i++) {
        const gridPos = gridPositions[i];
        const p = currentParticipants[i];
        
        const car = new Car(gridPos.x, gridPos.y, p.color, p.isPlayer);
        car.startX = gridPos.x;
        car.startY = gridPos.y;
        car.startAngle = 0;
        cars.push(car);
        
        if (p.isPlayer) {
            playerCar = car;
        } else {
            ais.push(new AI(car, isChampionship ? championshipState.difficulty : difficulty, p.skillVariation));
        }
    }
    
    // Generous health proportional to laps
    cars.forEach(car => {
        car.maxHealth = 100 * Math.max(1, TOTAL_LAPS);
        car.health = car.maxHealth;
    });
    
    // Assign correct initial waypoint and jump start states
    cars.forEach(car => {
        car.jumpStartPenalty = false;
        
        // AI random jump start chance (5%)
        if (!car.isPlayer) {
            if (Math.random() < 0.05) {
                // Determine when they will jump (between 0.5 and goDelay)
                car.aiJumpTime = 1.0 + Math.random() * 2.0;
            } else {
                car.aiJumpTime = null;
            }
        }
        
        let minDist = Infinity;
        let closestIdx = 0;
        for (let i = 0; i < track.waypoints.length; i++) {
            const wp = track.waypoints[i];
            const dist = Math.hypot(car.x - wp.x, car.y - wp.y);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }
        car.nextWaypoint = (closestIdx + 1) % track.waypoints.length;
    });
    
    gameState = 'countdown';
    countdownTimer = 0;
    lightState = 0;
    goDelay = 2.5 + 0.1 + Math.random() * 3.9; // Wait between 0.1 and 4 seconds before GO
    leaderFinished = false;
    raceFinished = false;
    isFalseStartResetting = false;
    winnerAnnouncement.style.display = 'none';
    
    // Initialize Web Audio API
    if (typeof initAudio === 'function') {
        initAudio();
    }
    
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function updatePhysics(dt) {
    if (dt > 0.05) dt = 0.05; // cap dt for physics stability (min 20fps logic)
    
    // Player input
    playerCar.inputs.up = keys.ArrowUp;
    playerCar.inputs.down = keys.ArrowDown;
    playerCar.inputs.left = keys.ArrowLeft;
    playerCar.inputs.right = keys.ArrowRight;
    
    // AI input
    ais.forEach(ai => ai.update(track, dt));
    
    // Update all cars
    cars.forEach(car => car.update(dt, track));
    
    // Simple Circle Collision between cars
    for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
            const c1 = cars[i];
            const c2 = cars[j];
            const dx = c2.x - c1.x;
            const dy = c2.y - c1.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const minDist = 22; // approx car bounding circle
            
            if (dist < minDist) {
                // push apart
                const overlap = minDist - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                const pushX = nx * overlap * 0.5;
                const pushY = ny * overlap * 0.5;
                c1.x -= pushX;
                c1.y -= pushY;
                c2.x += pushX;
                c2.y += pushY;
                
                // Bounce velocities along the normal
                const relVx = c2.velocity.x - c1.velocity.x;
                const relVy = c2.velocity.y - c1.velocity.y;
                const velAlongNormal = relVx * nx + relVy * ny;
                
                if (velAlongNormal < 0) {
                    const restitution = 0.5; // Bounciness
                    const impulse = -(1 + restitution) * velAlongNormal / 2;
                    c1.velocity.x -= impulse * nx;
                    c1.velocity.y -= impulse * ny;
                    c2.velocity.x += impulse * nx;
                    c2.velocity.y += impulse * ny;
                }
                
                // Apply damage
                c1.takeDamage(2.0);
                c2.takeDamage(2.0);
            }
        }
    }
}

function updateHUD() {
    // Lap
    let currentLap = playerCar.lap + 1;
    if (currentLap > TOTAL_LAPS) currentLap = TOTAL_LAPS;
    lapCounter.innerText = `Lap: ${currentLap}/${TOTAL_LAPS}`;
    
    // Speed
    const speed = Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2);
    // Convert to arbitrary km/h (1 unit = ~0.5 km/h for nice numbers)
    speedometer.innerText = `${Math.floor(speed * 0.5)} km/h`;
    
    // Position Calculation
    const sortedCars = [...cars].sort((a, b) => {
        // If both finished, sort by lap first (lapped cars have fewer laps), then finish time
        if (a.finished && b.finished) {
            if (a.lap !== b.lap) return b.lap - a.lap;
            return a.raceTime - b.raceTime;
        }
        // If only one finished, it's ahead
        if (a.finished) return -1;
        if (b.finished) return 1;
        
        // Otherwise, sort by race progress
        if (a.lap !== b.lap) return b.lap - a.lap;
        // Same lap, who is further along?
        if (a.nextWaypoint !== b.nextWaypoint) return b.nextWaypoint - a.nextWaypoint;
        // Same waypoint target, who is closer to it?
        const wp = track.waypoints[a.nextWaypoint];
        const distA = (a.x - wp.x)**2 + (a.y - wp.y)**2;
        const distB = (b.x - wp.x)**2 + (b.y - wp.y)**2;
        return distA - distB; 
    });
    
    const pos = sortedCars.indexOf(playerCar) + 1;
    posCounter.innerText = `Pos: ${pos}/${cars.length}`;
    
    // Check win condition for the leader
    if (!leaderFinished && sortedCars[0].finished) {
        leaderFinished = true;
        leaderRaceTime = sortedCars[0].raceTime;
        
        // Show temporary winner announcement
        winnerAnnouncement.style.display = 'block';
        if (sortedCars[0] === playerCar) {
            winnerText.innerText = "You Won!";
            winnerText.style.color = "#4CAF50";
        } else {
            winnerText.innerText = `${sortedCars[0].color.toUpperCase()} Won!`;
            winnerText.style.color = sortedCars[0].color;
        }
        
        setTimeout(() => {
            winnerAnnouncement.style.display = 'none';
        }, 4000);
    }
    
    if (playerCar.isBroken && !playerCar.notifiedBroken) {
        playerCar.notifiedBroken = true;
        winnerAnnouncement.style.display = 'block';
        winnerText.innerText = "Car Destroyed!";
        winnerText.style.color = "#F44336";
        setTimeout(() => {
            winnerAnnouncement.style.display = 'none';
        }, 4000);
    }
    
    // Check if ALL cars have finished or broken
    if (cars.every(c => c.finished || c.isBroken) && !raceFinished) {
        raceFinished = true;
        gameState = 'gameover';
        hud.style.display = 'none';
        winnerAnnouncement.style.display = 'none';
        if (isMobile) mobileControls.style.display = 'none';
        if (isChampionship) {
            restartBtn.style.display = 'none';
            nextRoundBtn.style.display = 'inline-block';
        } else {
            restartBtn.style.display = 'inline-block';
            nextRoundBtn.style.display = 'none';
        }
        gameOverScreen.style.display = 'block';
        
        if (typeof stopAudio === 'function') {
            stopAudio();
        }
        
        if (sortedCars[0].finished) {
            if (sortedCars[0] === playerCar) {
                resultMessage.innerText = "You Won!";
                resultMessage.style.color = "#4CAF50";
            } else {
                resultMessage.innerText = "Race Finished";
                resultMessage.style.color = "#fff";
            }
        } else {
            resultMessage.innerText = "No one finished!";
            resultMessage.style.color = "#F44336";
        }
        
        // F1 Points System (top 10)
        const f1Points = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
        
        // Populate stats table
        statsBody.innerHTML = '';
        sortedCars.forEach((c, index) => {
            const tr = document.createElement('tr');
            
            // Assign Championship Points
            let ptsEarned = 0;
            if (isChampionship && c.finished) {
                ptsEarned = f1Points[index] || 0;
                championshipState.points[c.color] += ptsEarned;
            }
            
            // Format time
            const formatTime = (ms) => {
                const totalSeconds = ms / 1000;
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = (totalSeconds % 60).toFixed(3);
                return `${minutes}:${seconds.padStart(6, '0')}`;
            };
            
            let timeStr = formatTime(c.raceTime);
            let gapStr = "-";
            
            if (c.isBroken && !c.finished) {
                timeStr = "DNF";
                gapStr = "DNF";
            } else if (index > 0) {
                if (c.lap < TOTAL_LAPS) {
                    // Lapped car
                    const lapsBehind = TOTAL_LAPS - c.lap;
                    gapStr = `+${lapsBehind} lap${lapsBehind > 1 ? 's' : ''}`;
                } else {
                    const gapMs = c.raceTime - leaderRaceTime;
                    gapStr = `+${(gapMs / 1000).toFixed(3)}s`;
                }
            }
            
            const reactStr = c.reactionTime ? `${c.reactionTime.toFixed(3)}s` : '-';
            
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td style="color: ${c.color}; text-transform: capitalize;">${c.color} ${c.isPlayer ? '(You)' : ''} ${isChampionship && ptsEarned > 0 ? `[+${ptsEarned} pts]` : ''}</td>
                <td>${timeStr}</td>
                <td>${gapStr}</td>
                <td>${reactStr}</td>
            `;
            statsBody.appendChild(tr);
        });
        
        if (isChampionship) {
            championshipState.currentTrackIndex++;
            champRecapSection.style.display = 'block';
            champRecapBody.innerHTML = '';
            
            // Sort by current points
            const sortedColors = Object.keys(championshipState.points).sort((a, b) => championshipState.points[b] - championshipState.points[a]);
            sortedColors.forEach((col, idx) => {
                const tr = document.createElement('tr');
                if (idx === 0) tr.style.color = 'gold';
                else if (idx === 1) tr.style.color = 'silver';
                else if (idx === 2) tr.style.color = '#cd7f32';
                
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td style="color: ${col}; text-transform: capitalize; font-weight: bold;">${col}</td>
                    <td>${championshipState.points[col]} pts</td>
                `;
                champRecapBody.appendChild(tr);
            });
            
        } else {
            champRecapSection.style.display = 'none';
        }
    }
}

function drawLights(ctx) {
    const boxW = 250;
    const boxH = 50;
    const boxX = 400 - boxW / 2;
    const boxY = 10; // Top center, fits perfectly on the upper dark grass area
    
    ctx.fillStyle = '#111';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    
    const spacing = boxW / 5;
    for (let i = 0; i < 5; i++) {
        const cx = boxX + spacing * i + spacing / 2;
        const cy = boxY + boxH / 2;
        
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        
        if (lightState > i && lightState < 6) {
            ctx.fillStyle = '#ff0000'; // Red light on
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 15;
        } else {
            ctx.fillStyle = '#333'; // Light off
            ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0; // reset
    }
}

function gameLoop(timestamp) {
    if (gameState === 'menu') {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }
    
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    
    if (gameState === 'countdown') {
        if (!isFalseStartResetting) {
            countdownTimer += dt;
            
            if (countdownTimer < 0.5) lightState = 0;
            else if (countdownTimer < 1.0) lightState = 1;
            else if (countdownTimer < 1.5) lightState = 2;
            else if (countdownTimer < 2.0) lightState = 3;
            else if (countdownTimer < 2.5) lightState = 4;
            else if (countdownTimer < goDelay) lightState = 5;
            else {
                lightState = 6; // GO!
                gameState = 'playing';
                raceStartTime = performance.now();
                
                // Notify AI that race has started
                ais.forEach(ai => ai.startRace());
            }
        }
        
        // False start check & physics update for jumping cars
        playerCar.inputs.up = keys.ArrowUp;
        playerCar.inputs.down = keys.ArrowDown;
        playerCar.inputs.left = keys.ArrowLeft;
        playerCar.inputs.right = keys.ArrowRight;
        
        cars.forEach(car => {
            if (!car.isPlayer) {
                if (car.aiJumpTime !== null && countdownTimer >= car.aiJumpTime && lightState < 5) {
                    car.inputs.up = true;
                } else {
                    car.inputs.up = false;
                }
            }
            
            if (car.inputs.up && lightState < 5 && !car.jumpStartPenalty && !isFalseStartResetting) {
                car.jumpStartPenalty = true;
                isFalseStartResetting = true;
                // Show banner
                winnerAnnouncement.style.display = 'block';
                winnerText.innerText = `${car.color.toUpperCase()} False Start! +5s Penalty`;
                winnerText.style.color = car.color === 'white' || car.color === 'yellow' || car.color === 'lime' || car.color === 'cyan' ? '#000' : car.color;
                if (winnerText.style.color === '#000') {
                    winnerAnnouncement.style.backgroundColor = 'rgba(255,255,255,0.8)';
                } else {
                    winnerAnnouncement.style.backgroundColor = 'rgba(0,0,0,0.8)';
                }
                
                // Reset grid after 2 seconds
                setTimeout(() => {
                    winnerAnnouncement.style.display = 'none';
                    isFalseStartResetting = false;
                    countdownTimer = 0;
                    lightState = 0;
                    goDelay = 2.5 + 0.1 + Math.random() * 3.9;
                    
                    cars.forEach(c => {
                        c.x = c.startX;
                        c.y = c.startY;
                        c.angle = c.startAngle;
                        c.velocity = {x: 0, y: 0};
                        
                        // Re-roll AI jump time so they don't jump again immediately (unless unlucky)
                        if (!c.isPlayer && !c.jumpStartPenalty) {
                            if (Math.random() < 0.05) {
                                c.aiJumpTime = 1.0 + Math.random() * 2.0;
                            } else {
                                c.aiJumpTime = null;
                            }
                        } else if (!c.isPlayer) {
                            c.aiJumpTime = null; // No double penalty intended for AI
                        }
                    });
                }, 2000);
            }
            
            // Allow physics update if they jumped
            if (car.inputs.up || Math.abs(car.velocity.x) > 0 || Math.abs(car.velocity.y) > 0) {
                car.update(dt, track);
            }
        });
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#388E3C';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        track.draw(ctx);
        cars.forEach(car => car.draw(ctx));
        
        if (gameState !== 'gameover') {
            drawLights(ctx);
        }
        
        if (typeof updateEngineSound === 'function') {
            const speed = Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2);
            updateEngineSound(speed, keys.ArrowUp);
        }
        
        requestAnimationFrame(gameLoop);
        return;
    }
    
    if (gameState === 'playing') {
        countdownTimer += dt;
        
        // Track player reaction time on first input
        if (!playerCar.inputRecorded && (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight)) {
            playerCar.reactionTime = (performance.now() - raceStartTime) / 1000;
            playerCar.inputRecorded = true;
        }
        
        track.leaderFinished = leaderFinished;
        track.currentRaceTime = performance.now() - raceStartTime;
        
        updatePhysics(dt);
        updateHUD();
        
        // Draw Track
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#388E3C';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        track.draw(ctx);
        
        // Draw Cars
        cars.forEach(car => car.draw(ctx));
        
        // Hide lights after 1.5s of GO
        if (countdownTimer < goDelay + 1.5) {
            drawLights(ctx);
        }
        
        if (typeof updateEngineSound === 'function') {
            const speed = Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2);
            updateEngineSound(speed, playerCar.inputs.up);
        }
        
        requestAnimationFrame(gameLoop);
    }
}

// Initial draw for menu background
ctx.fillStyle = '#222';
ctx.fillRect(0, 0, canvas.width, canvas.height);

function startChampionship() {
    const color = document.getElementById('color-select').value;
    const difficulty = document.getElementById('difficulty-select').value;
    const numOpponents = parseInt(document.getElementById('opponents-select').value, 10);
    
    const possibleColors = ['red', 'blue', 'yellow', 'purple', 'orange', 'white', 'green', 'cyan', 'pink', 'gray', 'lime', 'black'];
    const aiColors = possibleColors.filter(c => c !== color);
    
    championshipState = {
        tracks: ['oval', 'peanut', 'f1', 'circomassimo'],
        currentTrackIndex: 0,
        points: {},
        participants: [],
        difficulty: difficulty
    };
    
    // Initialize points and persistent AI modifiers
    championshipState.participants.push({ isPlayer: true, color: color, skillVariation: 1 });
    championshipState.points[color] = 0;
    
    for (let i = 0; i < numOpponents; i++) {
        let aiCol = aiColors[i % aiColors.length];
        championshipState.participants.push({ isPlayer: false, color: aiCol, skillVariation: 0.8 + (Math.random() * 0.3) });
        championshipState.points[aiCol] = 0;
    }
    
    nextChampionshipRound();
}

function nextChampionshipRound() {
    if (championshipState.currentTrackIndex >= championshipState.tracks.length) {
        showChampionshipFinal();
        return;
    }
    const trackType = championshipState.tracks[championshipState.currentTrackIndex];
    startGame(trackType);
}

function showChampionshipFinal() {
    hud.style.display = 'none';
    if (isMobile) mobileControls.style.display = 'none';
    champFinalScreen.style.display = 'block';
    
    const sortedColors = Object.keys(championshipState.points).sort((a, b) => championshipState.points[b] - championshipState.points[a]);
    
    champStatsBody.innerHTML = '';
    sortedColors.forEach((color, idx) => {
        const tr = document.createElement('tr');
        if (idx === 0) tr.style.color = 'gold';
        else if (idx === 1) tr.style.color = 'silver';
        else if (idx === 2) tr.style.color = '#cd7f32'; // bronze
        
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td style="color: ${color}; text-transform: capitalize; font-weight: bold;">${color}</td>
            <td>${championshipState.points[color]} pts</td>
        `;
        champStatsBody.appendChild(tr);
    });
}
