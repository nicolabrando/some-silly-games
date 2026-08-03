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
let finishCounter = 0;   // order in which cars actually took the flag
let firstFinisherTime = null;
let leaderRaceTime = 0;
let dnfWindowMs = 20000;   // set from the leader's pace when they finish
let raceMode = 'race';     // 'race' | 'championship' | 'practice'
// --- Virtual Safety Car -------------------------------------------------
// While a wreck is being recovered every car runs on reduced power. car.js
// reads vscPowerFactor, ai.js caps its target speed with it.
let vscActive = false;
let vscPowerFactor = 1;
const VSC_POWER = 0.28;    // engine power while the VSC is out
let recoveries = [];       // { car, phase, t, from, to, crane }
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
const practiceBtn = document.getElementById('practice-btn');
const logBtn = document.getElementById('log-btn');
const logScreen = document.getElementById('log-screen');
const logBody = document.getElementById('log-body');
const stopSessionBtn = document.getElementById('stopSessionBtn');
const vscBanner = document.getElementById('vsc-banner');
const timingTower = document.getElementById('timing-tower');

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
    raceMode = 'race';
    startGame();
});

champBtn.addEventListener('click', () => {
    isChampionship = true;
    raceMode = 'championship';
    startChampionship();
});

practiceBtn.addEventListener('click', () => {
    isChampionship = false;
    raceMode = 'practice';
    startGame();
});

logBtn.addEventListener('click', () => {
    logBody.textContent = RaceLog.text(false);
    logScreen.style.display = 'block';
    logBody.scrollTop = logBody.scrollHeight;
});

document.getElementById('log-close-btn').addEventListener('click', () => {
    logScreen.style.display = 'none';
});

document.getElementById('log-download-btn').addEventListener('click', () => {
    RaceLog.download();
});

stopSessionBtn.addEventListener('click', () => {
    if (raceMode === 'practice') endPracticeSession();
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
    timingTower.style.display = 'none';
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
    
    document.getElementById('dnf-timer').style.visibility = 'hidden';
    
    const forceWetRace = document.getElementById('wet-race-checkbox').checked;
    // In Championship mode, ignore the toggle and rely on 20% random chance
    isRaining = (forceWetRace && !isChampionship) ? true : (Math.random() < 0.20);
    
    // UI for weather.
    // A normal flex child of the HUD, not an absolutely positioned overlay:
    // pinned at right:150px it sat exactly where the DNF timer lands once the
    // lap timer is in the row, and the two texts overlapped.
    let weatherIndicator = document.getElementById('weather-indicator');
    if (!weatherIndicator) {
        weatherIndicator = document.createElement('div');
        weatherIndicator.id = 'weather-indicator';
        hud.insertBefore(weatherIndicator, quitBtn);
    }
    weatherIndicator.innerText = isRaining ? "Wet 🌧️" : "Dry ☀️";
    
    const isPractice = raceMode === 'practice';
    stopSessionBtn.style.display = isPractice ? 'inline-block' : 'none';
    timingTower.style.display = isPractice ? 'none' : 'block';
    timingTower.innerHTML = '';

    // Free practice: unlimited running, no opponents, no flag.
    TOTAL_LAPS = isPractice ? 9999 : parseInt(document.getElementById('laps-select').value, 10);

    vscActive = false;
    vscPowerFactor = 1;
    recoveries = [];
    vscBanner.style.display = 'none';
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
    
    const numCars = isPractice ? 1
        : (isChampionship ? championshipState.participants.length : numOpponents + 1);
    
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
    
    if (isPractice) {
        currentParticipants.push({ isPlayer: true, color: color === 'spectator' ? 'red' : color, skillVariation: 1, driverName: 'You' });
    } else if (isChampionship) {
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
    
    // 3. Qualifying.
    // The grid used to be a straight shuffle, which meant all the pace and
    // personality baked into the AI had no bearing on where anyone started.
    // Each AI now sets a notional flying lap (pace + the variance a single lap
    // really has) and the grid is the qualifying order. The player is slotted
    // mid-grid: they didn't drive a lap, so they neither get nor lose one.
    if (!isPractice) {
        const aiDifficulty = isChampionship ? championshipState.difficulty : difficulty;
        const qualified = currentParticipants
            .filter(p => !p.isPlayer)
            .map(p => ({
                p: p,
                lap: AI.qualifyingPace(p.driverName, aiDifficulty, p.skillVariation, isRaining)
            }))
            .sort((a, b) => a.lap - b.lap)
            .map(x => x.p);

        const player = currentParticipants.find(p => p.isPlayer);
        if (player) {
            qualified.splice(Math.floor(qualified.length / 2), 0, player);
        }
        currentParticipants = qualified;
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
    
    // Health is now nearly flat rather than proportional to race length.
    // With quadratic damage a light rub costs almost nothing, so a long race
    // no longer needs a huge pool to survive; a big shunt has to be able to
    // end a race whatever the distance.
    cars.forEach(car => {
        car.maxHealth = 255 + 10 * Math.max(0, Math.min(TOTAL_LAPS, 40) - 5);
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
    
    // ---- open the log for this session ----------------------------------
    RaceLog.start({
        mode: isPractice ? 'Free Practice' : (isChampionship ? 'Championship round' : 'Single race'),
        track: trackType,
        laps: isPractice ? null : TOTAL_LAPS,
        difficulty: isPractice ? null : (isChampionship ? championshipState.difficulty : difficulty),
        weather: isRaining ? 'wet' : 'dry',
        grid: cars.map(c => c.driverName || c.color)
    });

    gameState = 'countdown';
    countdownTimer = 0;
    lightState = 0;
    goDelay = 2.5 + 0.1 + Math.random() * 3.9; // Wait between 0.1 and 4 seconds before GO
    leaderFinished = false;
    finishCounter = 0;
    dnfWindowMs = 20000;
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

    // remember lap counts so completed laps can be logged below
    cars.forEach(c => { c._prevLap = c.lap; c._prevBlue = c.blueFlag; });
    
    // Update all cars
    cars.forEach(car => car.update(dt, track));

    // --- log: completed laps ------------------------------------------
    cars.forEach(c => {
        if (c.lap > c._prevLap) {
            if (!c.lapTimes) c.lapTimes = [];
            if (c.lastLapTime) c.lapTimes.push(c.lastLapTime);
            const isBest = c.lastLapTime && c.lastLapTime === c.bestLapTime;
            RaceLog.event('LAP', `${c.driverName || c.color} lap ${c.lap}` +
                (c.lastLapTime ? ` — ${RaceLog.fmt(c.lastLapTime)}${isBest ? '  (best)' : ''}` : ' (out lap)'));
        }
    });
    
    // --- Slipstreaming (Drafting) Check ---
    cars.forEach(car => {
        car.isDrafting = false; // Reset drafting state
        car.draftStrength = 0;
    });

    // Handle 20s DNF timer
    if (firstFinisherTime && (Date.now() - firstFinisherTime > dnfWindowMs)) {
        cars.forEach(c => {
            if (!c.finished && !c.isBroken) {
                c.isBroken = true;
                c.health = 0;
                c.status = 'DNF (Time Limit)';
                RaceLog.event('DNF', `${c.driverName || c.color} — outside the time limit`);
            }
        });
    }

    // Process slipstreaming.
    // Continuous rather than binary: the tow builds smoothly as you close in
    // and fades as you drift off line, instead of snapping fully on the
    // instant you enter a cone and fully off the instant you leave it.
    cars.forEach(car => {
        let best = 0;

        for (const otherCar of cars) {
            if (car === otherCar || otherCar.isBroken) continue;

            const dx = otherCar.x - car.x;
            const dy = otherCar.y - car.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 20 || dist >= 190) continue;

            // How well are we lined up behind them?
            const angleToOther = Math.atan2(dy, dx);
            let angleDiff = Math.abs(car.angle - angleToOther);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            let headingDiff = Math.abs(car.angle - otherCar.angle);
            if (headingDiff > Math.PI) headingDiff = 2 * Math.PI - headingDiff;

            if (angleDiff > 0.40 || headingDiff > 0.7) continue;

            // Three independent falloffs, multiplied together.
            const distFactor = 1 - Math.max(0, (dist - 45) / 145);   // full strength up to 45px
            const coneFactor = 1 - (angleDiff / 0.40);
            const alignFactor = 1 - (headingDiff / 0.7);

            const strength = Math.max(0, Math.min(1, distFactor * coneFactor * alignFactor));
            if (strength > best) best = strength;
        }

        car.draftStrength = best;
        car.isDrafting = best > 0.05;   // kept for the AI and the HUD

        if (car.isDrafting && Math.random() < 0.2 * best) {
            globalParticles.push({
                x: car.x + (Math.random() - 0.5) * 10,
                y: car.y + (Math.random() - 0.5) * 10,
                vx: Math.cos(car.angle) * 50,
                vy: Math.sin(car.angle) * 50,
                life: 0.3,
                type: 'wind'
            });
        }
    });
    
    // --- Wrecks, Virtual Safety Car and recovery --------------------------
    updateRecovery(dt);

    // --- Blue flags -------------------------------------------------------
    // Shown to a car that is about to be lapped: a quicker car on a higher lap
    // is closing from behind. The AI reads car.blueFlag in ai.js and pulls off
    // the racing line; the player just gets the warning.
    cars.forEach(c => {
        c.blueFlagTimer = Math.max(0, (c.blueFlagTimer || 0) - dt);
    });

    // car.trackProgress is a monotone odometer in track pixels (see car.js).
    // Comparing c.lap directly is wrong - the lap counter ticks over at the
    // finish line, so two cars either side of it look a whole lap apart - and
    // so is recomputing progress from the current waypoint, which wraps early.
    const wpTotal = track.getRacingLine ? track.getRacingLine('standard').length : 1;
    const raceProgress = (c) => c.trackProgress || 0;

    for (const c of cars) {
        if (c.finished || c.isBroken) continue;

        const hx = Math.cos(c.angle);
        const hy = Math.sin(c.angle);
        const myProgress = raceProgress(c);
        let best = null;
        let bestFwd = -Infinity;

        for (const other of cars) {
            if (other === c || other.isBroken || other.finished) continue;
            // Genuinely more than half a lap up the road, not just one tick of
            // the lap counter ahead.
            if (raceProgress(other) < myProgress + wpTotal * 0.55) continue;

            const dx = other.x - c.x;
            const dy = other.y - c.y;
            if (dx * dx + dy * dy > 215 * 215) continue;

            const fwd = dx * hx + dy * hy;               // behind us => negative
            const side = -dx * hy + dy * hx;
            if (fwd > 45 || fwd < -205) continue;        // not closing on us
            if (Math.abs(side) > 95) continue;           // on another part of the track

            // Must be running the same way. On a circuit whose two straights
            // nearly touch (Circus Maximus), a car coming the other way down
            // the far side is within a few pixels and half a lap apart in
            // progress - which reads exactly like being lapped, and isn't.
            let head = other.angle - c.angle;
            while (head > Math.PI) head -= Math.PI * 2;
            while (head < -Math.PI) head += Math.PI * 2;
            if (Math.abs(head) > 1.0) continue;

            if (fwd > bestFwd) { bestFwd = fwd; best = other; }
        }

        if (best) {
            c.blueFlagTimer = 0.8;                        // hold, so it can't flicker
            c.blueFlagFrom = best;
        }
    }

    cars.forEach(c => {
        c.blueFlag = c.blueFlagTimer > 0 && !c.finished && !c.isBroken;
        if (!c.blueFlag) c.blueFlagFrom = null;
        if (c.blueFlag && !c._prevBlue && c.blueFlagFrom) {
            RaceLog.event('BLUE', `${c.driverName || c.color} shown blue flags for ` +
                `${c.blueFlagFrom.driverName || c.blueFlagFrom.color}`);
        }
    });

    // Simple Circle Collision between cars
    for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
            const c1 = cars[i];
            const c2 = cars[j];
            // A wreck is being craned away, or already is off the circuit: it
            // must not act as a barrier in the middle of the racing line.
            if (c1.isBroken || c2.isBroken) continue;
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

                // --- Damage, proportional to the actual impact -------------
                // The old rule charged a flat 2 HP *per frame* of contact:
                // 120 HP/s, identical whether you brushed someone at 30 px/s
                // or speared them at 300. Now only a genuine closing impact
                // hurts, scaled by the closing speed, and a short per-pair
                // cooldown stops one shunt being billed sixty times a second.
                if (velAlongNormal < 0) {
                    const now = performance.now();
                    if (!c1.lastHitAt) c1.lastHitAt = {};
                    if (!c2.lastHitAt) c2.lastHitAt = {};

                    if (now - (c1.lastHitAt[c2.uid] || 0) > 250) {
                        c1.lastHitAt[c2.uid] = now;
                        c2.lastHitAt[c1.uid] = now;

                        // Damage grows with the SQUARE of the closing speed,
                        // like the energy of the impact really does. Linear
                        // damage meant a race was a long series of cheap rubs
                        // that nobody ever failed to survive; quadratic keeps
                        // light contact almost free while making a genuine
                        // shunt able to end a race on its own.
                        //
                        // Racing contact is free; only a real impact hurts.
                        //
                        // The damage curve starts at a FREE THRESHOLD rather
                        // than at zero, so bumper-to-bumper running - nudging
                        // the car ahead into a corner, banging wheels at the
                        // start - costs nothing at all. Past that it climbs
                        // with the square of the excess, so a genuine shunt is
                        // still able to end a race.
                        //
                        // The free threshold is set from measurement, not
                        // taste: across 1117 AI-to-AI contacts the closing
                        // speed had a median of 4 px/s, a 97th percentile of
                        // 63 and a maximum of 102. Almost all racing contact
                        // is gentle rubbing, and billing it was what made the
                        // race feel unforgiving and overtaking impossible.
                        //
                        // Against a 255 hp car:
                        //    <65 px/s ->   0 hp           side by side, free
                        //   100 px/s ->  39 hp  ( 15%)    firm nudge
                        //   120 px/s ->  97 hp  ( 38%)    you felt that
                        //   150 px/s -> 230 hp  ( 90%)    nearly terminal
                        //   170 px/s -> 353 hp  (>100%)   race over
                        const closing = -velAlongNormal;      // px/s, always > 0 here
                        const FREE = 65;
                        const dmg = closing <= FREE ? 0
                            : 320 * Math.pow((closing - FREE) / 100, 2);
                        if (dmg > 0) {
                            c1.takeDamage(dmg);
                            c2.takeDamage(dmg);
                            if (dmg > 15) {
                                RaceLog.event('CONTACT', `${c1.driverName || c1.color} / ` +
                                    `${c2.driverName || c2.color} — ${dmg.toFixed(0)} damage each ` +
                                    `(closing ${closing.toFixed(0)} px/s)`);
                            }
                            if (dmg > 12) {
                                for (let k = 0; k < Math.min(14, dmg); k++) {
                                    globalParticles.push({
                                        x: (c1.x + c2.x) / 2,
                                        y: (c1.y + c2.y) / 2,
                                        vx: (Math.random() - 0.5) * 160,
                                        vy: (Math.random() - 0.5) * 160,
                                        life: 0.5,
                                        type: 'spark'
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// =========================================================================
//  WRECK RECOVERY  +  VIRTUAL SAFETY CAR
//  A destroyed car must not be left sitting in the racing line as an
//  obstacle. It is taken off by a crane; while that happens every car runs
//  on reduced power and the yellow VSC banner is up.
// =========================================================================
function startRecovery(car) {
    // Where to drag it to: out past the barrier, into somewhere that is
    // genuinely off the circuit.
    //
    // Pushing blindly along the outward normal is not enough: where two parts
    // of the layout run close together (Circus Maximus, the Comb) that vector
    // can cross the run-off, clear the far barrier and drop the wreck back on
    // the racing surface. So candidates are scored and the first one that is
    // clear of *every* segment wins.
    const proj = track.getClosestPoint(car.x, car.y);
    let nx = car.x - proj.projX;
    let ny = car.y - proj.projY;
    let len = Math.hypot(nx, ny);

    if (len < 1e-3) {
        // The car died sitting exactly on the centre line - the single most
        // likely place to be destroyed - and "away from the track" has no
        // direction there. Fall back to the track's own normal at the nearest
        // racing-line node. Without this the wreck was simply never moved.
        let bn = null, bd = Infinity;
        if (typeof track.getRacingLine === 'function') {
            const line = track.getRacingLine('standard');
            for (const nd of line.nodes) {
                const d = (car.x - nd.cx) ** 2 + (car.y - nd.cy) ** 2;
                if (d < bd) { bd = d; bn = nd; }
            }
        }
        if (bn) { nx = bn.nx; ny = bn.ny; }
        else { nx = 1; ny = 0; }
        len = 1;
    }
    nx /= len; ny /= len;

    const clearance = track.grassWidth + 30;
    const stands = (typeof track.getStands === 'function') ? track.getStands() : [];
    const onStand = (px, py) => {
        for (const st of stands) {
            const dx = px - st.x, dy = py - st.y;
            const ca = Math.cos(-st.angle), sa = Math.sin(-st.angle);
            const u = dx * ca - dy * sa;
            const v = dx * sa + dy * ca;
            if (Math.abs(u) < st.len / 2 + 18 && Math.abs(v) < st.depth / 2 + 18) return true;
        }
        return false;
    };
    // Score every candidate rather than taking the first that passes: on an
    // enclosed layout (the Comb, Thunder) there may be no perfect spot, and
    // "first acceptable or else give up" dumped the wreck back on the racing
    // surface. Best-available always beats a bad fallback.
    let tx = null, ty = null, bestScore = -Infinity;

    for (let a = 0; a < 24; a++) {
        const spin = (a % 2 === 0 ? 1 : -1) * Math.floor(a / 2) * (Math.PI / 12);
        const ca = Math.cos(spin), sa = Math.sin(spin);
        const vx = nx * ca - ny * sa;
        const vy = nx * sa + ny * ca;

        for (const dist of [track.grassWidth + 42, track.grassWidth + 60,
                            track.grassWidth + 82, track.grassWidth + 110]) {
            const px = proj.projX + vx * dist;
            const py = proj.projY + vy * dist;
            if (px < 22 || px > 978 || py < 22 || py > 678) continue;

            const clear = track.getClosestPoint(px, py).dist;
            // how far past the barrier we are, capped so absurdly remote spots
            // are not preferred over a tidy one just behind the wall
            let score = Math.min(clear - track.grassWidth, 70);
            if (onStand(px, py)) score -= 260;            // never into the crowd
            score -= Math.abs(spin) * 6;                  // prefer straight out
            score -= dist * 0.05;                         // prefer the short tow

            if (score > bestScore) { bestScore = score; tx = px; ty = py; }
        }
    }

    if (tx === null) {           // literally nowhere on canvas: clamp and accept
        tx = Math.max(22, Math.min(978, proj.projX + nx * (track.grassWidth + 42)));
        ty = Math.max(22, Math.min(678, proj.projY + ny * (track.grassWidth + 42)));
    }

    // Geometry of the recovery. The crane always keeps a tow length between
    // itself and the wreck - it must never end up drawn on the same pixel,
    // or all you see is a car sliding along on its own.
    const ux = (tx - car.x), uy = (ty - car.y);
    const ul = Math.hypot(ux, uy) || 1;
    const dirx = ux / ul, diry = uy / ul;

    const TOW = 34;                               // crane-to-hook distance
    const rec = {
        car: car,
        phase: 'approach',
        t: 0,
        from: { x: car.x, y: car.y },
        to: { x: tx, y: ty },
        tow: TOW,
        // where the crane comes from, and where it stands to pick the car up:
        home: { x: tx + dirx * 90, y: ty + diry * 90 },
        pick: { x: car.x + dirx * TOW, y: car.y + diry * TOW },
        crane: { x: tx + dirx * 90, y: ty + diry * 90 }
    };
    recoveries.push(rec);

    car.recovering = true;
    car.velocity.x = 0;
    car.velocity.y = 0;

    RaceLog.event('WRECK', `${car.driverName || car.color} destroyed at ` +
        `(${Math.round(car.x)}, ${Math.round(car.y)}) — recovery started`);
}

function updateRecovery(dt) {
    // 1. spot new wrecks (damage only; a time-limit DNF is not a wreck)
    for (const c of cars) {
        if (c.isBroken && !c.recovering && !c.recovered && c.status !== 'DNF (Time Limit)') {
            startRecovery(c);
        }
    }

    // 2. advance each recovery
    for (let i = recoveries.length - 1; i >= 0; i--) {
        const r = recoveries[i];
        r.t += dt;

        const smooth = (k) => k * k * (3 - 2 * k);

        if (r.phase === 'approach') {
            // crane drives in from off the circuit and pulls up alongside
            const e = smooth(Math.min(1, r.t / 2.6));
            r.crane.x = r.home.x + (r.pick.x - r.home.x) * e;
            r.crane.y = r.home.y + (r.pick.y - r.home.y) * e;
            if (r.t >= 2.6) { r.phase = 'lift'; r.t = 0; }

        } else if (r.phase === 'lift') {
            // hooks on and lifts; crane stationary, cable clearly visible
            r.car.liftAmount = Math.min(1, r.t / 1.6);
            if (r.t >= 1.6) { r.phase = 'haul'; r.t = 0; }

        } else if (r.phase === 'haul') {
            // crane leads, wreck trails one tow length behind it
            const e = smooth(Math.min(1, r.t / 3.4));
            const cx = r.pick.x + (r.to.x + (r.pick.x - r.from.x) - r.pick.x) * e;
            const cy = r.pick.y + (r.to.y + (r.pick.y - r.from.y) - r.pick.y) * e;
            r.crane.x = cx;
            r.crane.y = cy;
            r.car.x = r.from.x + (r.to.x - r.from.x) * e;
            r.car.y = r.from.y + (r.to.y - r.from.y) * e;
            if (r.t >= 3.4) { r.phase = 'drop'; r.t = 0; }

        } else if (r.phase === 'drop') {
            r.car.liftAmount = Math.max(0, 1 - r.t / 1.2);
            if (r.t >= 1.2) { r.phase = 'clear'; r.t = 0; }

        } else if (r.phase === 'clear') {
            // crane withdraws; the VSC stays out until it is gone
            const e = smooth(Math.min(1, r.t / 1.8));
            const from = { x: r.crane.x, y: r.crane.y };
            if (!r.clearFrom) r.clearFrom = from;
            r.crane.x = r.clearFrom.x + (r.home.x - r.clearFrom.x) * e;
            r.crane.y = r.clearFrom.y + (r.home.y - r.clearFrom.y) * e;
            if (r.t >= 1.8) { r.phase = 'done'; r.t = 0; }

        } else {
            r.car.recovering = false;
            r.car.recovered = true;                 // parked, out of the way
            r.car.liftAmount = 0;
            recoveries.splice(i, 1);
            RaceLog.event('RECOVERY', `${r.car.driverName || r.car.color} removed from the circuit`);
        }
    }

    // 3. VSC follows the recoveries
    const wanted = recoveries.length > 0;
    if (wanted !== vscActive) {
        vscActive = wanted;
        vscPowerFactor = vscActive ? VSC_POWER : 1;
        vscBanner.style.display = vscActive ? 'block' : 'none';
        RaceLog.event('VSC', vscActive
            ? `deployed — engine power limited to ${Math.round(VSC_POWER * 100)}%`
            : 'withdrawn — track clear, full power');
    }
}

function drawCranes(ctx) {
    for (const r of recoveries) {
        const c = r.crane;
        const on = Math.floor(Date.now() / 200) % 2 === 0;

        // --- cable to the wreck, drawn first so the crane sits on top ----
        if (r.phase === 'lift' || r.phase === 'haul' || r.phase === 'drop') {
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(r.car.x, r.car.y);
            ctx.stroke();

            // hook
            ctx.fillStyle = '#eceff1';
            ctx.beginPath();
            ctx.arc(r.car.x, r.car.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.save();
        ctx.translate(c.x, c.y);

        // While towing, the crane leads and the wreck trails, so it faces its
        // direction of travel with the boom out the back - not backwards at
        // the car, which read as the recovery truck reversing up the circuit.
        const towing = (r.phase === 'haul' || r.phase === 'drop');
        const toCar = Math.atan2(r.car.y - c.y, r.car.x - c.x);
        const ang = towing ? toCar + Math.PI : toCar;
        ctx.rotate(isFinite(ang) ? ang : 0);
        const boom = towing ? -1 : 1;

        // amber warning glow
        if (on) {
            ctx.fillStyle = 'rgba(255,214,0,0.22)';
            ctx.beginPath();
            ctx.arc(0, 0, 34, 0, Math.PI * 2);
            ctx.fill();
        }

        // --- jib (the arm reaching towards the car) ---------------------
        ctx.strokeStyle = '#ef6c00';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(boom * 4, 0);
        ctx.lineTo(boom * 32, 0);
        ctx.stroke();
        ctx.strokeStyle = '#ffb74d';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(boom * 6, 0);
        ctx.lineTo(boom * 30, 0);
        ctx.stroke();
        // pulley at the tip
        ctx.fillStyle = '#37474f';
        ctx.beginPath();
        ctx.arc(boom * 32, 0, 4, 0, Math.PI * 2);
        ctx.fill();

        // --- body -------------------------------------------------------
        ctx.fillStyle = '#455a64';
        ctx.fillRect(-19, -13, 38, 26);              // chassis shadow
        ctx.fillStyle = '#f9a825';
        ctx.fillRect(-17, -11, 34, 22);              // yellow body
        ctx.fillStyle = '#e65100';
        ctx.fillRect(-17, -11, 34, 4);               // stripe
        ctx.fillRect(-17, 7, 34, 4);

        // tracks / wheels
        ctx.fillStyle = '#212121';
        ctx.fillRect(-19, -15, 38, 4);
        ctx.fillRect(-19, 11, 38, 4);

        // cab
        ctx.fillStyle = '#263238';
        ctx.fillRect(-9, -7, 13, 14);
        ctx.fillStyle = '#90a4ae';
        ctx.fillRect(-7, -5, 9, 10);

        // roof beacon
        ctx.fillStyle = on ? '#fff176' : '#8d6e00';
        ctx.fillRect(-3, -17, 6, 5);

        ctx.restore();

        // --- label ------------------------------------------------------
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = on ? '#ffd600' : '#c8a600';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3;
        ctx.strokeText('RECOVERY', c.x, c.y - 24);
        ctx.fillText('RECOVERY', c.x, c.y - 24);
        ctx.textAlign = 'left';
    }
}

// =========================================================================
//  FREE PRACTICE
// =========================================================================
function endPracticeSession() {
    if (gameState === 'gameover') return;
    gameState = 'gameover';
    raceFinished = true;
    hud.style.display = 'none';
    timingTower.style.display = 'none';
    stopSessionBtn.style.display = 'none';
    if (isMobile) mobileControls.style.display = 'none';
    if (typeof stopAudio === 'function') stopAudio();

    const laps = (playerCar && playerCar.lapTimes) ? playerCar.lapTimes : [];
    const best = laps.length ? Math.min(...laps) : null;

    RaceLog.event('SESSION', `practice stopped after ${laps.length} timed laps` +
        (best ? `, best ${(best / 1000).toFixed(3)}` : ''));
    RaceLog.end(laps.map((ms, i) => ({
        name: `Lap ${i + 1}`, laps: 1,
        time: (ms / 1000).toFixed(3),
        best: ms === best ? 'BEST' : '',
        note: ''
    })));

    document.getElementById('result-message').innerText = 'Practice Session';
    resultMessage.style.color = '#26a69a';

    restartBtn.style.display = 'inline-block';
    nextRoundBtn.style.display = 'none';
    gameOverScreen.style.display = 'block';

    statsBody.innerHTML = '';
    if (!laps.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" style="padding: 14px; opacity: 0.7;">No completed laps.</td>`;
        statsBody.appendChild(tr);
        return;
    }

    laps.forEach((ms, i) => {
        const isBest = ms === best;
        const delta = i === 0 ? '-' : `${ms - best === 0 ? '' : '+'}${((ms - best) / 1000).toFixed(3)}`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td style="font-weight: bold; color: ${isBest ? '#4CAF50' : '#fff'};">Lap ${i + 1}${isBest ? ' ★' : ''}</td>
            <td>-</td>
            <td style="color: ${isBest ? '#4CAF50' : '#fff'};">${(ms / 1000).toFixed(3)}</td>
            <td style="color: #4CAF50;">${(best / 1000).toFixed(3)}</td>
            <td>${isBest ? '-' : delta}</td>
            <td>-</td>
        `;
        statsBody.appendChild(tr);
    });
}

function updateHUD() {
    const dnfTimerDiv = document.getElementById('dnf-timer');
    if (firstFinisherTime && !raceFinished) {
        const timeLeft = Math.max(0, dnfWindowMs / 1000 - (Date.now() - firstFinisherTime) / 1000);
        dnfTimerDiv.style.visibility = 'visible';
        dnfTimerDiv.innerText = `Time left: ${timeLeft.toFixed(1)}s`;
    } else {
        dnfTimerDiv.style.visibility = 'hidden';
    }

    if (!playerCar) {
        document.getElementById('lap-counter').innerText = "Spectator Mode";
        document.getElementById('speedometer').innerText = "";
        const lt = document.getElementById('lap-timer');
        if (lt) lt.innerHTML = "";
        document.getElementById('position-counter').innerText = "";
        // Don't return here so spectator can still update standings
    }

    // Lap
    if (playerCar) {
        if (raceMode === 'practice') {
            lapCounter.innerText = `Practice — lap ${playerCar.lap + 1}`;
        } else {
            let currentLap = playerCar.lap + 1;
            if (currentLap > TOTAL_LAPS) currentLap = TOTAL_LAPS;
            lapCounter.innerText = `Lap: ${currentLap}/${TOTAL_LAPS}`;
        }
        
        // Speed
        const speed = Math.sqrt(playerCar.velocity.x**2 + playerCar.velocity.y**2);
        // Convert to arbitrary km/h (1 unit = ~0.5 km/h for nice numbers)
        speedometer.innerText = `${Math.floor(speed * 0.5)} km/h`;

        // --- Live lap timer --------------------------------------------
        // Best lap used to be visible only on the results screen, which meant
        // there was no way to tell whether the lap you were driving was any
        // good until the race was over.
        const lapTimerDiv = document.getElementById('lap-timer');
        if (lapTimerDiv) {
            const fmt = (ms) => {
                if (ms === null || ms === undefined || !isFinite(ms)) return '--.---';
                return (ms / 1000).toFixed(3);
            };
            const nowMs = typeof track.currentRaceTime === 'number' ? track.currentRaceTime : 0;
            const current = playerCar.finished ? (playerCar.lastLapTime || 0) : Math.max(0, nowMs - playerCar.lapStartTime);

            // Green while we are up on our best, red once we have lost it.
            let colour = '#fff';
            if (playerCar.bestLapTime) {
                colour = current > playerCar.bestLapTime ? '#ff8a80' : '#69f0ae';
            }

            const lastStr = playerCar.lastLapTime
                ? `${fmt(playerCar.lastLapTime)}${playerCar.lastLapTime === playerCar.bestLapTime ? ' ★' : ''}`
                : '--.---';

            lapTimerDiv.innerHTML =
                `<span style="color:${colour};">${fmt(current)}</span>` +
                `<span style="opacity:0.6;font-size:0.72em;"> L ${lastStr}` +
                ` B ${fmt(playerCar.bestLapTime)}</span>`;
        }
    }
    
    // Record the finishing order as it actually happens. Deriving "who won"
    // from a sort every frame is fragile: a single stray lap increment can
    // promote a car above the real winner for one frame, which is exactly
    // when the "Finished First" banner fires.
    cars.forEach(c => {
        if (c.finished && c.finishIndex === undefined) {
            c.finishIndex = finishCounter++;
            RaceLog.event('FINISH', `P${c.finishIndex + 1} ${c.driverName || c.color} — ` +
                `${RaceLog.fmt(c.raceTime)} after ${c.lap} laps` +
                (c.jumpStartPenalty ? ' (incl. 5s jump-start penalty)' : ''));
        }
    });

    // Position Calculation
    const lapsOf = (c) => Math.min(c.lap, TOTAL_LAPS); // guard against stray increments
    const sortedCars = [...cars].sort((a, b) => {
        // If both finished, sort by lap first (lapped cars have fewer laps), then finish time
        if (a.finished && b.finished) {
            if (lapsOf(a) !== lapsOf(b)) return lapsOf(b) - lapsOf(a);
            return a.raceTime - b.raceTime;
        }
        // If only one finished, it's ahead
        if (a.finished) return -1;
        if (b.finished) return 1;
        
        // Otherwise, sort by race progress
        if (lapsOf(a) !== lapsOf(b)) return lapsOf(b) - lapsOf(a);
        // Same lap, who has passed more waypoints?
        if (a.waypointProgress !== b.waypointProgress) return b.waypointProgress - a.waypointProgress;
        // Same waypoint target, who is closer to it?
        const wp = track.waypoints[a.nextWaypoint];
        const distA = (a.x - wp.x)**2 + (a.y - wp.y)**2;
        const distB = (b.x - wp.x)**2 + (b.y - wp.y)**2;
        return distA - distB; 
    });
    
    // ---- live timing tower ------------------------------------------
    // Gap to the car in front, in seconds. trackProgress is real distance
    // round the circuit, so the gap is that distance divided by the pace of
    // the car behind. A car more than a lap down is shown as laps, not time -
    // a time gap to someone you have already lapped is meaningless.
    if (raceMode !== 'practice' && timingTower.style.display !== 'none') {
        const lapLen = track.getRacingLine ? track.getRacingLine('standard').length : 1;
        const rows = [];

        for (let i = 0; i < sortedCars.length; i++) {
            const c = sortedCars[i];

            // smoothed pace, so the gap doesn't jitter under braking
            const sp = Math.hypot(c.velocity.x, c.velocity.y);
            c._paceAvg = c._paceAvg === undefined ? sp : c._paceAvg + (sp - c._paceAvg) * 0.02;

            let gap;
            if (c.isBroken && !c.finished) {
                gap = c.recovered || c.recovering ? 'OUT' : 'DNF';
            } else if (i === 0) {
                gap = c.finished ? 'FIN' : 'LEADER';
            } else {
                const ahead = sortedCars[i - 1];
                const behind = Math.max(0, (ahead.trackProgress || 0) - (c.trackProgress || 0));
                const lapsDown = Math.floor(behind / lapLen);
                if (lapsDown >= 1) {
                    gap = `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
                } else {
                    const pace = Math.max(60, c._paceAvg || 60);
                    gap = `+${(behind / pace).toFixed(3)}`;
                }
            }

            const name = c.isPlayer ? 'YOU' : (c.driverName || c.color).toUpperCase().slice(0, 11);
            rows.push(
                `<div class="tt-row${c.isPlayer ? ' me' : ''}">` +
                `<span class="tt-pos">${i + 1}</span>` +
                `<span class="tt-chip" style="background:${c.color};"></span>` +
                `<span class="tt-name"${(c.isBroken && !c.finished) ? ' style="opacity:.45;"' : ''}>${name}</span>` +
                `<span class="tt-gap">${gap}</span>` +
                `</div>`);
        }
        timingTower.innerHTML = rows.join('');
    }

    const pos = playerCar ? sortedCars.indexOf(playerCar) + 1 : "-";
    if (playerCar) {
        posCounter.innerText = raceMode === 'practice' ? '' : `Pos: ${pos}/${cars.length}`;
    }
    
    // Check win condition for the leader.
    // Use the recorded first finisher, never sortedCars[0].
    const firstFinisher = cars.find(c => c.finishIndex === 0);
    if (!leaderFinished && firstFinisher) {
        leaderFinished = true;
        firstFinisherTime = Date.now();
        leaderRaceTime = firstFinisher.raceTime;

        // The old rule gave everyone a flat 20 s after the leader. On Pettine
        // (24 s laps at easy) that is half a lap; on the Oval (10 s laps) it is
        // two full laps - the same rule, wildly different severity. Scale it to
        // the leader's own pace instead.
        const refLap = firstFinisher.bestLapTime
            || (firstFinisher.raceTime && TOTAL_LAPS ? firstFinisher.raceTime / TOTAL_LAPS : null)
            || 13000;
        dnfWindowMs = Math.max(8000, Math.min(45000, refLap * 2.0));

        // Show temporary winner announcement
        winnerAnnouncement.style.display = 'block';
        winnerAnnouncement.style.backgroundColor = 'rgba(0,0,0,0.8)';
        if (firstFinisher === playerCar) {
            winnerText.innerHTML = "You Finished First!";
            winnerText.style.color = "#4CAF50";
        } else {
            const nameDisplay = firstFinisher.driverName ? `${firstFinisher.driverName} (${firstFinisher.color})` : firstFinisher.color.toUpperCase();
            winnerText.innerHTML = `${nameDisplay} Finished First!`;
            winnerText.style.color = '#fff';
        }

        setTimeout(() => {
            winnerAnnouncement.style.display = 'none';
        }, 4000);
    }
    
    if (playerCar && playerCar.isBroken && !playerCar.notifiedBroken) {
        playerCar.notifiedBroken = true;
        winnerAnnouncement.style.display = 'block';
        winnerAnnouncement.style.backgroundColor = 'rgba(0,0,0,0.8)';
        winnerText.innerHTML = "Car Destroyed!";
        winnerText.style.color = "#F44336";
        setTimeout(() => {
            winnerAnnouncement.style.display = 'none';
        }, 4000);
    }
    
    // Handle 20s DNF timer
    let timeIsUp = false;
    if (firstFinisherTime && (Date.now() - firstFinisherTime > dnfWindowMs)) {
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
        
        RaceLog.end(sortedCars.map(c => ({
            name: c.driverName || c.color,
            laps: `${Math.min(c.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`,
            time: (c.isBroken && !c.finished) ? 'DNF' : RaceLog.fmt(c.raceTime),
            best: RaceLog.fmt(c.bestLapTime),
            note: (c.isBroken && !c.finished) ? (c.status || 'retired') : ''
        })));

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
            
            // A lapped car is flagged the first time it crosses the line after
            // the leader, so its "Time" is the moment it took the flag having
            // covered LESS distance. Shown next to the winner's full-distance
            // time it reads as if the table were mis-sorted, so lapped and DNF
            // times are dimmed and the lap count is spelled out.
            const isDNF = c.isBroken && !c.finished;
            const isLapped = !isDNF && c.lap < TOTAL_LAPS;

            let timeStr = formatTime(c.raceTime);
            let gapStr = "-";

            if (isDNF) {
                timeStr = c.status || "DNF";
                gapStr = c.status || "DNF";
            } else if (index > 0) {
                if (isLapped) {
                    const lapsBehind = TOTAL_LAPS - c.lap;
                    gapStr = `+${lapsBehind} lap${lapsBehind > 1 ? 's' : ''}`;
                } else {
                    const gapMs = c.raceTime - leaderRaceTime;
                    gapStr = `+${(gapMs / 1000).toFixed(3)}s`;
                }
            }

            const dim = (isDNF || isLapped) ? ' style="opacity: 0.55;"' : '';
            const lapsStr = `${Math.min(c.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;

            const reactStr = c.reactionTime ? `${c.reactionTime.toFixed(3)}s` : '-';
            const bestLapStr = (c.bestLapTime !== null && c.bestLapTime !== undefined && c.bestLapTime < Infinity)
                ? formatTime(c.bestLapTime) : '-';

            const nameDisplay = c.driverName ? `${c.driverName} (${c.color})` : `${c.color} ${c.isPlayer ? '(You)' : ''}`;

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td style="color: ${c.color}; font-weight: bold; text-transform: capitalize;">${nameDisplay} ${isChampionship && ptsEarned > 0 ? `[+${ptsEarned} pts]` : ''}</td>
                <td${isLapped || isDNF ? ' style="opacity: 0.55;"' : ''}>${lapsStr}</td>
                <td${dim}>${timeStr}</td>
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
                // A jumped start is a twitch off the line, not a launch: the
                // throttle is brushed for a few hundredths of a second and
                // drag does the rest, so the car rolls about one car length.
                // (Braking afterwards is not an option - below walking pace
                // "down" is reverse in this car model, and the offender
                // trundled 200px backwards down the grid.)
                const since = car.aiJumpTime === null ? -1 : countdownTimer - car.aiJumpTime;
                car.inputs.up = car.aiJumpTime !== null && lightState < 6 &&
                                since >= 0 && since < 0.05;
                car.inputs.down = false;
            }
            
            const hasMoved = Math.abs(car.velocity.x) > 0.1 || Math.abs(car.velocity.y) > 0.1;
            
            // Every offence counts. The old guard was "!car.jumpStartPenalty",
            // so once a car had been penalised it could jump every subsequent
            // restart completely free of charge.
            if ((car.inputs.up || hasMoved) && lightState < 6 && !isFalseStartResetting) {
                car.jumpStartPenalties = (car.jumpStartPenalties || 0) + 1;
                car.jumpStartPenalty = true;
                isFalseStartResetting = true;
                RaceLog.event('PENALTY', `${car.driverName || car.color} jumped the start ` +
                    `(offence #${car.jumpStartPenalties}) — +${car.jumpStartPenalties * 5}s total, grid reset`);
                // Show banner.
                // Always dark background + white body text; the offender's name
                // is the only coloured element and carries a dark outline, so
                // white / yellow / cyan cars stay readable.
                winnerAnnouncement.style.display = 'block';
                winnerAnnouncement.style.backgroundColor = 'rgba(20,0,0,0.92)';

                const whoName = car.isPlayer
                    ? 'YOU'
                    : (car.driverName ? car.driverName.toUpperCase() : car.color.toUpperCase());
                const whoCar = car.driverName ? ` &ndash; ${car.color} car` : '';

                winnerText.style.color = '#fff';
                winnerText.innerHTML = `
                    <div style="font-size: 30px; font-weight: 900; letter-spacing: 3px; color: #ff5252; margin-bottom: 6px;">
                        FALSE START
                    </div>
                    <div style="font-size: 22px; color: #fff; margin-bottom: 10px;">
                        <span style="color: ${car.color}; font-weight: 900;
                                     text-shadow: 0 0 2px #000, 1px 1px 0 #000, -1px -1px 0 #000,
                                                  1px -1px 0 #000, -1px 1px 0 #000;">${whoName}</span>${whoCar}
                    </div>
                    <div style="font-size: 19px; color: #ffd54f; font-weight: bold;">
                        +${car.jumpStartPenalties * 5} second penalty${car.jumpStartPenalties > 1
                            ? ` &nbsp;(offence #${car.jumpStartPenalties})` : ''}
                    </div>
                    <div style="font-size: 15px; color: #bbb; margin-top: 8px;">
                        Cars back to the grid &mdash; restarting&hellip;
                    </div>`;
                
                // Back under way quickly - a false start should cost a moment,
                // not the best part of ten seconds.
                setTimeout(() => {
                    winnerAnnouncement.style.display = 'none';
                    isFalseStartResetting = false;
                    countdownTimer = 0;
                    lightState = 0;
                    // shorter build-up on a restart than on the first start
                    goDelay = 2.5 + 0.1 + Math.random() * 1.6;
                    
                    cars.forEach(c => {
                        c.x = c.startX;
                        c.y = c.startY;
                        c.angle = c.startAngle;
                        c.velocity = {x: 0, y: 0};

                        // The race is starting over: wipe every scrap of race
                        // progress too, or a car that rolled over the line
                        // during the aborted start keeps that state.
                        c.lap = 0;
                        c.halfwayMarkerCrossed = false;
                        c.waypointProgress = 0;
                        c.trackProgress = 0;
                        c.lapStartProgress = 0;
                        c._lastS = undefined;
                        c._nodeIdx = undefined;
                        c.finished = false;
                        c.finishIndex = undefined;
                        c.raceTime = null;
                        c.lapStartTime = 0;
                        c.lastLapTime = null;
                        c.bestLapTime = null;
                        c.blueFlag = false;
                        c.blueFlagTimer = 0;
                        c.blueFlagFrom = null;

                        // Re-roll the AI jump chance. An AI that has already
                        // been caught is not sent out to do it again, but the
                        // detection itself stays armed for everyone.
                        if (!c.isPlayer) {
                            c.aiJumpTime = (!c.jumpStartPenalty && Math.random() < 0.05)
                                ? 1.0 + Math.random() * 2.0 : null;
                        }
                    });
                    
                    globalSkidMarks = [];
                    globalParticles = [];
                }, 1200);
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
        drawCranes(ctx);
        
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

        // Recovery vehicles, on top of everything on track.
        drawCranes(ctx);

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
