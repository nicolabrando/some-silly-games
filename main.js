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
let firstFinisherTime = null;
let leaderRaceTime = 0;
let raceFinished = false;
let isFalseStartResetting = false;
// v7 Globals
let globalSkidMarks = [];
let globalParticles = [];
let isRaining = false;

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
    
    // Reset effects
    globalSkidMarks = [];
    globalParticles = [];
    
    document.getElementById('dnf-timer').style.display = 'none';
    
    const forceWetRace = document.getElementById('wet-race-checkbox').checked;
    // In Championship mode, ignore the toggle and rely on 20% random chance
    isRaining = (forceWetRace && !isChampionship) ? true : (Math.random() < 0.20);
    
    // UI for weather
    let weatherIndicator = document.getElementById('weather-indicator');
    if (!weatherIndicator) {
        weatherIndicator = document.createElement('div');
        weatherIndicator.id = 'weather-indicator';
        weatherIndicator.style.position = 'absolute';
        weatherIndicator.style.top = '10px';
        weatherIndicator.style.right = '150px';
        weatherIndicator.style.color = 'white';
        weatherIndicator.style.fontFamily = 'monospace';
        weatherIndicator.style.fontSize = '18px';
        hud.appendChild(weatherIndicator);
    }
    weatherIndicator.innerText = isRaining ? "Wet 🌧️" : "Dry ☀️";
    
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
    } else if (trackType === 'circle') {
        track = new CircleTrack();
    } else if (trackType === 'serpent') {
        track = new SerpentTrack();
    } else if (trackType === 'quadrato') {
        track = new QuadratoTrack();
    } else if (trackType === 'triangle') {
        track = new TriangleTrack();
    } else if (trackType === 'pettine') {
        track = new PettineTrack();
    } else if (trackType === 'thunder') {
        track = new ThunderTrack();
    } else {
        track = new OvalTrack();
    }

    // Pre-compute the AI racing line here (a few ms) so the very first racing
    // frame doesn't stutter while building it lazily.
    if (typeof track.getRacingLine === 'function') track.getRacingLine();

    cars = [];
    ais = [];
    playerCar = null; // Reset playerCar
    
    const numCars = isChampionship ? championshipState.participants.length : (color === 'spectator' ? numOpponents + 1 : numOpponents + 1);
    
    // Find closest waypoint to start line
    let startIdx = 0;
    let minDist = Infinity;
    track.waypoints.forEach((wp, idx) => {
        const d = Math.hypot(wp.x - track.startX, wp.y - track.startY);
        if (d < minDist) { minDist = d; startIdx = idx; }
    });
    
    const getGridPos = (distBackward, lateralOffset) => {
        let traveled = 0;
        let currIdx = startIdx;
        let prevWP = track.waypoints[currIdx];
        
        // Edge case: if we want distance 0
        if (distBackward === 0) {
            let nextIdx = (currIdx - 1 + track.waypoints.length) % track.waypoints.length;
            let nextWP = track.waypoints[nextIdx];
            let dx = prevWP.x - nextWP.x;
            let dy = prevWP.y - nextWP.y;
            let len = Math.hypot(dx, dy);
            let nx = dy / len;
            let ny = -dx / len;
            return { x: prevWP.x + nx * lateralOffset, y: prevWP.y + ny * lateralOffset, angle: Math.atan2(dy, dx) };
        }
        
        while(traveled < distBackward) {
            let nextIdx = (currIdx - 1 + track.waypoints.length) % track.waypoints.length;
            let nextWP = track.waypoints[nextIdx];
            let segmentDist = Math.hypot(nextWP.x - prevWP.x, nextWP.y - prevWP.y);
            
            if (traveled + segmentDist >= distBackward) {
                let t = (distBackward - traveled) / segmentDist;
                if (segmentDist === 0) t = 0;
                let px = prevWP.x + (nextWP.x - prevWP.x) * t;
                let py = prevWP.y + (nextWP.y - prevWP.y) * t;
                
                let dx = prevWP.x - nextWP.x;
                let dy = prevWP.y - nextWP.y;
                let len = Math.hypot(dx, dy);
                let nx = dy / len;
                let ny = -dx / len;
                
                let angle = Math.atan2(dy, dx);
                
                return { x: px + nx * lateralOffset, y: py + ny * lateralOffset, angle: angle };
            }
            
            traveled += segmentDist;
            currIdx = nextIdx;
            prevWP = nextWP;
        }
        return { x: prevWP.x, y: prevWP.y, angle: 0 };
    };
    
    // Create an array of spawn positions (x, y, angle)
    const gridPositions = [];
    for(let i=0; i<numCars; i++) {
        // Staggered by 30px backward each position.
        // Alternate side: +20px and -20px from center.
        const distBackward = 35 + i * 30; // 35px base offset to ensure pole position is behind the start line
        const lateralOffset = (i % 2 === 0 ? 20 : -20);
        gridPositions.push(getGridPos(distBackward, lateralOffset));
    }
    
    let currentParticipants = [];
    
    if (isChampionship) {
        // Use championship participants (persists skill variations)
        currentParticipants = [...championshipState.participants];
    } else {
        const possibleColors = ['red', 'blue', 'yellow', 'purple', 'orange', 'white', 'green', 'cyan', 'pink', 'gray', 'lime', 'black'];
        let aiColors = [...possibleColors];
        
        // 1. Add Player or Extra AI for Spectator
        if (color === 'spectator') {
            // Generate extra AI later
        } else {
            currentParticipants.push({ isPlayer: true, color: color, skillVariation: 1, driverName: 'You' });
            aiColors = aiColors.filter(c => c !== color);
        }
        
        // 2. Add AI Opponents
        // Shuffle drivers for single race
        const legendaryDrivers = ['Ayrton Senna', 'Michael Schumacher', 'Lewis Hamilton', 'Juan Manuel Fangio', 'Alain Prost', 'Jim Clark', 'Max Verstappen', 'Niki Lauda', 'Fernando Alonso', 'Sebastian Vettel'];
        const randomDrivers = [...legendaryDrivers].sort(() => Math.random() - 0.5);
        
        const totalAIsToSpawn = color === 'spectator' ? numOpponents + 1 : numOpponents;
        
        for (let i = 0; i < totalAIsToSpawn; i++) {
            currentParticipants.push({ 
                isPlayer: false, 
                color: aiColors[i % aiColors.length], 
                skillVariation: null,
                driverName: randomDrivers[i % randomDrivers.length]
            });
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
        car.driverName = p.driverName;
        car.startX = gridPos.x;
        car.startY = gridPos.y;
        car.startAngle = gridPos.angle; // New property to store the grid angle
        car.angle = gridPos.angle;      // Set initial angle
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
        
        // 5. Initialize closest waypoint for all cars
        let closestWp = 0;
        let minDist = Infinity;
        for (let j=0; j<track.waypoints.length; j++) {
            const wp = track.waypoints[j];
            // Check if waypoint is ahead (using dot product)
            const dx = wp.x - car.x;
            const dy = wp.y - car.y;
            const dist = Math.hypot(dx, dy);
            const angleToWp = Math.atan2(dy, dx);
            let angleDiff = Math.abs(car.angle - angleToWp);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            if (angleDiff < Math.PI / 2 && dist < minDist) {
                minDist = dist;
                closestWp = j;
            }
        }
        car.nextWaypoint = closestWp;
    });
    
    gameState = 'countdown';
    countdownTimer = 0;
    lightState = 0;
    goDelay = 2.5 + 0.1 + Math.random() * 3.9; // Wait between 0.1 and 4 seconds before GO
    leaderFinished = false;
    firstFinisherTime = null;
    raceFinished = false;
    isFalseStartResetting = false;
    winnerAnnouncement.style.display = 'none';
    
    // Initialize Audio
    if (typeof initAudio === 'function') {
        initAudio(!playerCar); // Pass true if spectator mode
    }
    
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function updatePhysics(dt) {
    if (dt > 0.05) dt = 0.05; // cap dt for physics stability (min 20fps logic)
    
    // Player input
    if (playerCar) {
        playerCar.inputs.up = keys.ArrowUp;
        playerCar.inputs.down = keys.ArrowDown;
        playerCar.inputs.left = keys.ArrowLeft;
        playerCar.inputs.right = keys.ArrowRight;
    }
    
    // AI input
    ais.forEach(ai => ai.update(track, dt));
    
    // Update all cars
    cars.forEach(car => car.update(dt, track));
    
    // --- Slipstreaming (Drafting) Check ---
    cars.forEach(car => {
        car.isDrafting = false; // Reset drafting state
    });

    // Handle 20s DNF timer
    if (firstFinisherTime && (Date.now() - firstFinisherTime > 20000)) {
        cars.forEach(c => {
            if (!c.finished && !c.isBroken) {
                c.isBroken = true;
                c.health = 0;
                c.status = 'DNF (Time Limit)';
            }
        });
    }

    // Process slipstreaming
    cars.forEach(car => {
        for (const otherCar of cars) {
            if (car === otherCar || otherCar.isBroken) continue;
            
            // Check if 'car' is directly behind 'otherCar'
            const dx = otherCar.x - car.x;
            const dy = otherCar.y - car.y;
            const dist = Math.hypot(dx, dy);
            
            // Drafting distance between 30 and 180 pixels
            if (dist > 30 && dist < 180) {
                // Check if the angle to the other car aligns with our heading
                const angleToOther = Math.atan2(dy, dx);
                let angleDiff = Math.abs(car.angle - angleToOther);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                
                // Also check if the other car is moving in roughly the same direction
                let headingDiff = Math.abs(car.angle - otherCar.angle);
                if (headingDiff > Math.PI) headingDiff = 2 * Math.PI - headingDiff;
                
                // If within a narrow cone (15 degrees)
                if (angleDiff < 0.25 && headingDiff < 0.5) {
                    car.isDrafting = true;
                    // Draw a subtle wind line for feedback
                    if (Math.random() < 0.2) {
                        globalParticles.push({
                            x: car.x + (Math.random()-0.5)*10,
                            y: car.y + (Math.random()-0.5)*10,
                            vx: Math.cos(car.angle)*50,
                            vy: Math.sin(car.angle)*50,
                            life: 0.3,
                            type: 'wind'
                        });
                    }
                    break; // Only draft off one car at a time
                }
            }
        }
    });
    
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
    const dnfTimerDiv = document.getElementById('dnf-timer');
    if (firstFinisherTime && !raceFinished) {
        const timeLeft = Math.max(0, 20 - (Date.now() - firstFinisherTime) / 1000);
        dnfTimerDiv.style.display = 'block';
        dnfTimerDiv.innerText = `Time Remaining: ${timeLeft.toFixed(1)}s`;
    } else {
        dnfTimerDiv.style.display = 'none';
    }

    if (!playerCar) {
        document.getElementById('lap-counter').innerText = "Spectator Mode";
        document.getElementById('speedometer').innerText = "";
        document.getElementById('position-counter').innerText = "";
        // Don't return here so spectator can still update standings
    }

    // Lap
    if (playerCar) {
        let currentLap = playerCar.lap + 1;
        if (currentLap > TOTAL_LAPS) currentLap = TOTAL_LAPS;
        lapCounter.innerText = `Lap: ${currentLap}/${TOTAL_LAPS}`;
        
        // Speed
        const speed = Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2);
        // Convert to arbitrary km/h (1 unit = ~0.5 km/h for nice numbers)
        speedometer.innerText = `${Math.floor(speed * 0.5)} km/h`;
    }
    
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
        // Same lap, who has passed more waypoints?
        if (a.waypointProgress !== b.waypointProgress) return b.waypointProgress - a.waypointProgress;
        // Same waypoint target, who is closer to it?
        const wp = track.waypoints[a.nextWaypoint];
        const distA = (a.x - wp.x)**2 + (a.y - wp.y)**2;
        const distB = (b.x - wp.x)**2 + (b.y - wp.y)**2;
        return distA - distB; 
    });
    
    const pos = playerCar ? sortedCars.indexOf(playerCar) + 1 : "-";
    if (playerCar) {
        posCounter.innerText = `Pos: ${pos}/${cars.length}`;
    }
    
    // Check win condition for the leader
    if (!leaderFinished && sortedCars[0].finished) {
        leaderFinished = true;
        firstFinisherTime = Date.now();
        leaderRaceTime = sortedCars[0].raceTime;
        
        // Show temporary winner announcement
        winnerAnnouncement.style.display = 'block';
        if (sortedCars[0] === playerCar) {
            winnerText.innerText = "You Finished First!";
            winnerText.style.color = "#4CAF50";
        } else {
            const nameDisplay = sortedCars[0].driverName ? `${sortedCars[0].driverName} (${sortedCars[0].color})` : sortedCars[0].color.toUpperCase();
            winnerText.innerText = `${nameDisplay} Finished First!`;
            winnerText.style.color = sortedCars[0].color;
        }
        
        setTimeout(() => {
            winnerAnnouncement.style.display = 'none';
        }, 4000);
    }
    
    if (playerCar && playerCar.isBroken && !playerCar.notifiedBroken) {
        playerCar.notifiedBroken = true;
        winnerAnnouncement.style.display = 'block';
        winnerText.innerText = "Car Destroyed!";
        winnerText.style.color = "#F44336";
        setTimeout(() => {
            winnerAnnouncement.style.display = 'none';
        }, 4000);
    }
    
    // Handle 20s DNF timer
    let timeIsUp = false;
    if (firstFinisherTime && (Date.now() - firstFinisherTime > 20000)) {
        timeIsUp = true;
        cars.forEach(c => {
            if (!c.finished && !c.isBroken) {
                c.isBroken = true; // Mark as DNF
                c.raceTime = Infinity;
            }
        });
    }
    
    // Check if ALL cars have finished or broken.
    // To ensure the 20s timer is always respected and visible even in spectator mode,
    // we only end the race early if ALL cars are finished AND it's not a spectator race, 
    // or if the 20s timer has expired.
    const allFinished = cars.every(c => c.finished || c.isBroken);
    const shouldEndRace = timeIsUp || (allFinished && playerCar);
    
    if (shouldEndRace && !raceFinished) {
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
        
        let headerText = "Race Finished!";
        if (playerCar) {
            if (sortedCars[0] === playerCar) {
                headerText = "You Won!";
            } else {
                headerText = `You finished ${pos}`;
            }
        } else {
            const nameDisplay = sortedCars[0].driverName ? `${sortedCars[0].driverName} (${sortedCars[0].color})` : sortedCars[0].color.toUpperCase();
            headerText = `${nameDisplay} Won!`;
        }
        document.getElementById('result-message').innerText = headerText;

        if (sortedCars[0].finished) {
            if (sortedCars[0] === playerCar) {
                resultMessage.innerText = "You Won!";
                resultMessage.style.color = "#4CAF50";
            } else {
                if (!playerCar) {
                     const nameDisplay = sortedCars[0].driverName ? `${sortedCars[0].driverName} (${sortedCars[0].color})` : sortedCars[0].color.toUpperCase();
                     resultMessage.innerText = `${nameDisplay} Wins!`;
                } else {
                     resultMessage.innerText = "Race Finished";
                }
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
                timeStr = c.status || "DNF";
                gapStr = c.status || "DNF";
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
            const bestLapStr = c.bestLapTime < Infinity ? formatTime(c.bestLapTime) : '-';
            
            const nameDisplay = c.driverName ? `${c.driverName} (${c.color})` : `${c.color} ${c.isPlayer ? '(You)' : ''}`;
            
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td style="color: ${c.color}; font-weight: bold; text-transform: capitalize;">${nameDisplay} ${isChampionship && ptsEarned > 0 ? `[+${ptsEarned} pts]` : ''}</td>
                <td>${timeStr}</td>
                <td style="color: #4CAF50;">${bestLapStr}</td>
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
                
                const participant = championshipState.participants.find(p => p.color === col);
                const nameDisplay = participant && participant.driverName ? `${participant.driverName} (${col})` : col;
                
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td style="color: ${col}; font-weight: bold;">${nameDisplay}</td>
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

function drawRain(ctx) {
    if (!isRaining) return;
    ctx.fillStyle = 'rgba(100, 120, 150, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Fast rain streaks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 50; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 5, y + 25);
    }
    ctx.stroke();
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
        if (playerCar) {
            playerCar.inputs.up = keys.ArrowUp;
            playerCar.inputs.down = keys.ArrowDown;
            playerCar.inputs.left = keys.ArrowLeft;
            playerCar.inputs.right = keys.ArrowRight;
        }
        
        cars.forEach(car => {
            if (!car.isPlayer) {
                if (car.aiJumpTime !== null && countdownTimer >= car.aiJumpTime && lightState < 6) {
                    car.inputs.up = true;
                } else {
                    car.inputs.up = false;
                }
            }
            
            const hasMoved = Math.abs(car.velocity.x) > 0.1 || Math.abs(car.velocity.y) > 0.1;
            
            if ((car.inputs.up || hasMoved) && lightState < 6 && !car.jumpStartPenalty && !isFalseStartResetting) {
                car.jumpStartPenalty = true;
                isFalseStartResetting = true;
                // Show banner
                winnerAnnouncement.style.display = 'block';
                const nameDisplay = car.driverName ? `${car.driverName} (${car.color})` : car.color.toUpperCase();
                winnerText.innerText = `${nameDisplay} False Start! +5s Penalty`;
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
                    
                    globalSkidMarks = [];
                    globalParticles = [];
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
        
        drawRain(ctx); // Draw rain during countdown

        if (gameState !== 'gameover') {
            drawLights(ctx);
        }
        
        if (typeof updateEngineSound === 'function') {
            const speed = playerCar ? Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2) : 0;
            updateEngineSound(speed, playerCar ? playerCar.inputs.up : false);
        }
        
        requestAnimationFrame(gameLoop);
        return;
    }
    
    if (gameState === 'playing') {
        countdownTimer += dt;
        
        // Track player reaction time on first input
        if (playerCar && !playerCar.inputRecorded && (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight)) {
            playerCar.reactionTime = (performance.now() - raceStartTime) / 1000;
            playerCar.inputRecorded = true;
        }
        
        track.leaderFinished = leaderFinished;
        track.currentRaceTime = performance.now() - raceStartTime;
        
        updatePhysics(dt);
        
        // If spectator, we don't need to update a camera because it's a fixed-screen game
        
        updateHUD();
        
        // Draw Track
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#388E3C';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        track.draw(ctx);
        
        // --- Draw Skid Marks ---
        for (let i = globalSkidMarks.length - 1; i >= 0; i--) {
            const mark = globalSkidMarks[i];
            const age = (Date.now() - mark.time) / 1000;
            
            // Fade out after 3 seconds
            if (age > 3) {
                mark.opacity -= 0.02; // Slower fade
            }
            if (mark.opacity <= 0) {
                globalSkidMarks.splice(i, 1);
                continue;
            }
            
            ctx.save();
            ctx.translate(mark.x, mark.y);
            ctx.rotate(mark.angle);
            ctx.fillStyle = `rgba(0, 0, 0, ${mark.opacity * 0.3})`;
            ctx.fillRect(-mark.width/2, -5, mark.width, 10);
            ctx.restore();
        }
        
        // Draw Cars
        // Draw broken/finished cars first so active ones draw on top
        const renderSorted = [...cars].sort((a, b) => {
            if (a.isBroken !== b.isBroken) return a.isBroken ? -1 : 1;
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            return 0;
        });
        
        renderSorted.forEach(car => car.draw(ctx));
        
        // --- Draw Particles ---
        for (let i = globalParticles.length - 1; i >= 0; i--) {
            const p = globalParticles[i];
            p.life -= dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            
            if (p.life <= 0) {
                globalParticles.splice(i, 1);
                continue;
            }
            
            ctx.save();
            if (p.type === 'mud') {
                ctx.fillStyle = `rgba(101, 67, 33, ${p.life})`;
                ctx.fillRect(p.x, p.y, 4, 4);
            } else if (p.type === 'spray') {
                ctx.fillStyle = `rgba(200, 200, 220, ${p.life * 0.5})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
                ctx.fill();
            } else if (p.type === 'wind') {
                ctx.strokeStyle = `rgba(255, 255, 255, ${p.life})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx*0.1, p.y - p.vy*0.1);
                ctx.stroke();
            }
            ctx.restore();
        }
        
        // --- Draw Rain overlay ---
        drawRain(ctx);
        
        // Hide lights after 1.5s of GO
        if (countdownTimer < goDelay + 1.5) {
            drawLights(ctx);
        }
        
        if (typeof updateEngineSound === 'function') {
            const speed = playerCar ? Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2) : 0;
            updateEngineSound(speed, playerCar ? playerCar.inputs.up : false);
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
        tracks: ['oval', 'peanut', 'f1', 'circomassimo', 'circle', 'serpent', 'quadrato', 'triangle', 'pettine', 'thunder'],
        currentTrackIndex: 0,
        points: {},
        participants: [],
        difficulty: difficulty
    };
    
    // Famous names list
    let availableNames = ['Ayrton Senna', 'Michael Schumacher', 'Lewis Hamilton', 'Juan Manuel Fangio', 'Alain Prost', 'Jim Clark', 'Max Verstappen', 'Niki Lauda', 'Fernando Alonso', 'Sebastian Vettel'];
    // Shuffle names
    availableNames.sort(() => Math.random() - 0.5);
    
    // Initialize points and persistent AI modifiers
    if (color === 'spectator') {
        const totalAIsToSpawn = numOpponents + 1;
        for (let i = 0; i < totalAIsToSpawn; i++) {
            let aiCol = possibleColors[i % possibleColors.length];
            let name = availableNames[i % availableNames.length];
            championshipState.participants.push({ isPlayer: false, color: aiCol, skillVariation: 0.8 + (Math.random() * 0.3), driverName: name });
            championshipState.points[aiCol] = 0;
        }
    } else {
        championshipState.participants.push({ isPlayer: true, color: color, skillVariation: 1, driverName: "You" });
        championshipState.points[color] = 0;
        
        for (let i = 0; i < numOpponents; i++) {
            let aiCol = aiColors[i % aiColors.length];
            let name = availableNames[i % availableNames.length];
            championshipState.participants.push({ isPlayer: false, color: aiCol, skillVariation: 0.8 + (Math.random() * 0.3), driverName: name });
            championshipState.points[aiCol] = 0;
        }
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
        
        const participant = championshipState.participants.find(p => p.color === color);
        const nameDisplay = participant && participant.driverName ? `${participant.driverName} (${color})` : color;
        
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td style="color: ${color}; font-weight: bold;">${nameDisplay}</td>
            <td>${championshipState.points[color]} pts</td>
        `;
        champStatsBody.appendChild(tr);
    });
}
