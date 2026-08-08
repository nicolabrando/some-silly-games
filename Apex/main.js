const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let track;
let cars = [];
let ais = [];
let playerCar;
// Seat two, occupied only in two-player mode. playerCar is always seat one, so
// every existing single-player path keeps working untouched.
let player2Car = null;
let twoPlayer = false;
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
// Once the track is clear the VSC runs 3 more seconds, counted down on the
// banner in tenths, so the restart is never a surprise.
const VSC_ENDING_MS = 3000;
let vscEndsAt = null;      // wall-clock (raceNow) moment the VSC will end
let recoveries = [];       // { car, phase, t, from, to, crane }
// A crane is a machine parked on the circuit, not a decal: cars bounce off it,
// and two of them never occupy the same patch of ground.
const CRANE_RADIUS = 20;      // solid body a car has to go round
const CRANE_CLEARANCE = 54;   // how far apart two cranes are kept
let raceFinished = false;
let isFalseStartResetting = false;
// v7 Globals
let globalSkidMarks = [];
let globalParticles = [];
let isRaining = false;

// Championship State
let isChampionship = false;
let championshipState = null;

// --- Qualifying ---------------------------------------------------------
// The player drives a real session; the opponents' laps are simulated
// headlessly with the same physics (see simulateQualifyingLap) one driver
// per frame, so the cost is hidden behind the player's own out lap.
let qualiQueue = [];        // AI participants still waiting for a lap
let qualiTimes = [];        // { p, lap } once simulated
let qualiTrack = null;      // the track object the session is running on
let qualiTrackType = null;
let pendingGrid = null;     // participant order handed to the next startGame
let pendingWeather = null;  // weather chosen at qualifying, reused for the race
let racePoleColor = null;   // who started P1 in the race now running
// Who crossed the line first on each lap. The last piece of a Grand Chelem:
// pole + win + fastest lap + led every single lap.
let lapLeaders = [];

// --- Tyres ---------------------------------------------------------------
// The compound the player has chosen for the session about to start. Picked
// separately for qualifying and for the race, so a soft-tyre banzai lap and a
// hard-tyre race stint are a legitimate plan.
let playerTyre = 'medium';
let playerTyre2 = 'medium';     // seat two, two-player mode
let pendingTyreSeat = 1;        // which seat the tyre screen is currently asking

// --- Places-gained bonus -------------------------------------------------
// One championship point per position recovered from the grid, up to five.
const PLACES_BONUS_PER = 1;
const PLACES_BONUS_CAP = 5;
let pendingTyreCb = null;

// --- Timing tower display order -----------------------------------------
// Sorting by distance covered is correct but still strobes when two cars are
// genuinely wheel to wheel: they trade the position every few frames and the
// names jump. The tower therefore keeps its own order and only lets a car
// take a place once it is clearly ahead - a car's length of daylight - so a
// swap on screen means a real change on track.
let towerOrder = [];
const TOWER_MARGIN = 22;    // px of track progress needed to take a position

// Single monotone score: finishers are locked in their finishing order and
// always ahead of anyone still running.
function towerScore(c) {
    // Finishers: DISTANCE first, then race time - exactly what the results
    // sheet does. Time alone is wrong, and this is what put lapped cars near
    // the top of the tower. Once the leader has taken the flag everyone else
    // is classified the next time they cross the line, whether or not that
    // crossing completed a lap; a car being lapped crosses the line SOONER
    // than the cars still on the lead lap, so it was credited a quicker race
    // time - Vettel classified at 42.466 over Senna's 45.374 while a whole lap
    // behind - and the tower duly ranked it second.
    //
    // Time still has to be the tie-break rather than the order cars crossed
    // the line: a car that takes the flag fifth with a five-second jump-start
    // penalty is classified lower, and ranking by crossing order left the live
    // order and the results sheet three places apart.
    if (c.finished) {
        const laps = Math.min(c.lap, TOTAL_LAPS);
        // Two cars can take the flag on the same frame and record the same
        // time to the millisecond. The one that physically crossed first is
        // ahead; the nudge is far smaller than a frame, so it only ever
        // decides a dead heat.
        return 1e12 + laps * 1e9 - (isFinite(c.raceTime) ? c.raceTime : 0)
               - (c.finishIndex || 0) * 1e-3;
    }
    // A retired car is ranked by the distance it covered, exactly as the
    // classification does. Sinking it to the bottom of the tower looked tidier
    // but meant the live order and the final results sheet disagreed - by up
    // to three places at the flag.
    return c.trackProgress || 0;
}

// One settling pass towards the true order, with hysteresis on each swap.
function stableTowerOrder(sorted) {
    // rebuild if the field changed (new race, different car count)
    if (towerOrder.length !== sorted.length ||
        towerOrder.some(c => sorted.indexOf(c) === -1)) {
        towerOrder = sorted.slice();
        return towerOrder;
    }
    // The hysteresis is there to stop two cars running side by side from
    // trading places every frame. It has no business slowing down a car that
    // is a whole lap out of position: that is not a close call, and made a
    // freshly lapped car climb the tower one place per frame.
    const lapLen = (track && typeof track.getRacingLine === 'function')
        ? track.getRacingLine('standard').length : Infinity;
    // No hysteresis where the order is a fact rather than a judgement call:
    // between two cars that have taken the flag, or across a whole lap.
    const marginFor = (a, b) => (a.finished || b.finished ||
        Math.abs(towerScore(a) - towerScore(b)) > lapLen * 0.5) ? 0 : TOWER_MARGIN;

    // Two settling passes a frame while the race is running, so the hysteresis
    // does its job. Once cars are taking the flag their order is a fact rather
    // than a judgement call, so settle it completely - otherwise the tower can
    // still be a few places behind the truth at the moment the race ends. A
    // lap-scale inversion is settled completely too.
    let lapGap = false;
    for (let i = 0; i < towerOrder.length - 1 && !lapGap; i++) {
        if (towerScore(towerOrder[i + 1]) > towerScore(towerOrder[i]) + lapLen * 0.5) {
            lapGap = true;
        }
    }
    const nPasses = (leaderFinished || lapGap) ? towerOrder.length : 2;
    for (let pass = 0; pass < nPasses; pass++) {
        for (let i = 0; i < towerOrder.length - 1; i++) {
            const a = towerOrder[i], b = towerOrder[i + 1];
            if (towerScore(b) > towerScore(a) + marginFor(a, b)) {
                towerOrder[i] = b;
                towerOrder[i + 1] = a;
            }
        }
    }
    return towerOrder;
}

// --- Pause --------------------------------------------------------------
// The game loop simply stops requesting frames. Everything that measures
// elapsed time does so against wall-clock anchors (raceStartTime,
// firstFinisherTime), so those are shifted forward by the paused duration on
// resume - otherwise a ten second pause would eat ten seconds of the DNF
// window and put a gap in every lap time.
let isPaused = false;
let pauseStartedAt = 0;

// A frame longer than this did not happen: the loop was not running (hidden
// tab, a sleeping machine, a long stall). See the guard in gameLoop.
const STALL_S = 0.25;

// --- Skipped Grand Prix -------------------------------------------------
// You sit the round out; the AI still races it for points. The real race
// loop runs with the drawing skipped, driven by skipClock instead of the wall
// clock, so a 60 second race resolves in about a second.
let skipMode = false;
let skipClock = 0;
let skipNow = 0;
let skipPlayer = null;      // the player's entry, held out of the field
let skipPlayers = [];       // every human entry (two of them on one keyboard)

// The DNF window is measured against the wall clock during a normal race and
// against the simulation clock while a Grand Prix is being skipped.
// performance.now(), not Date.now(): raceStartTime, track.currentRaceTime and
// the pause compensation are all measured against it, and firstFinisherTime
// being on a different clock meant the pause adjustment was mixing two time
// bases that only happen to share a unit.
function raceNow() { return skipMode ? skipNow : performance.now(); }
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
const pauseBtn = document.getElementById('pauseBtn');
const pauseOverlay = document.getElementById('pause-overlay');
const resumeBtn = document.getElementById('resume-btn');
const pauseQuitBtn = document.getElementById('pause-quit-btn');
const tyreScreen = document.getElementById('tyre-screen');
const tyreTitle = document.getElementById('tyre-title');
const tyreSubtitle = document.getElementById('tyre-subtitle');
const tyreOptions = document.getElementById('tyre-options');
const qualiScreen = document.getElementById('quali-screen');
const qualiBody = document.getElementById('quali-body');
const qualiTitle = document.getElementById('quali-title');
const qualiRaceBtn = document.getElementById('quali-race-btn');
const qualiMenuBtn = document.getElementById('quali-menu-btn');

// ===========================================================================
// CONTROLS
//
// Nothing downstream of here ever names a physical key. Each seat has its own
// logical input - up / down / left / right - and a scheme that says which keys
// fill it in. So "arrows or WASD" is a menu setting, and a second seat is just
// a second set of the same four booleans.
// ===========================================================================
// Needed before the menu wiring below runs; the mobile-controls block further
// down reuses it under its old name.
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const KEY_SCHEMES = {
    arrows: {
        label: 'Arrow keys', short: '↑←↓→',
        up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright'
    },
    wasd: {
        label: 'W A S D', short: 'W A S D',
        up: 'w', down: 's', left: 'a', right: 'd'
    }
};
const KEY_DIRS = ['up', 'down', 'left', 'right'];

const keys  = { up: false, down: false, left: false, right: false };   // seat 1
const keys2 = { up: false, down: false, left: false, right: false };   // seat 2

// Seat 1 uses whatever the menu says; seat 2 always gets the other scheme, so
// the two can never fight over a key.
function schemeName(seat) {
    const sel = document.getElementById('controls-select');
    const first = (sel && sel.value === 'wasd') ? 'wasd' : 'arrows';
    if (seat === 2) return first === 'wasd' ? 'arrows' : 'wasd';
    return first;
}
function schemeOf(seat) { return KEY_SCHEMES[schemeName(seat)]; }

function clearKeys() {
    for (const d of KEY_DIRS) { keys[d] = false; keys2[d] = false; }
}

// Both seats are routed at all times. Writing seat 2 when nobody is sitting in
// it costs nothing, and it means key handling never has to know what mode the
// game is in.
function routeKey(raw, down) {
    const k = (raw || '').toLowerCase();
    let used = false;
    for (const seat of [1, 2]) {
        const s = schemeOf(seat);
        const target = seat === 1 ? keys : keys2;
        for (const d of KEY_DIRS) {
            if (s[d] === k) { target[d] = down; used = true; }
        }
    }
    return used;
}

function typingInAField(e) {
    const t = e && e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

window.addEventListener('keydown', (e) => {
    if (typingInAField(e)) return;          // W in the lap box is a W
    if (routeKey(e.key, true)) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
    if (typingInAField(e)) return;
    if (routeKey(e.key, false)) e.preventDefault();
});

// --- menu: players + controls -------------------------------------------
// Seat 2 always takes whichever scheme seat 1 did not, so the menu only ever
// asks one question and the hint spells out the consequence.
function syncControlsUi() {
    // One keyboard between two people is not a thing on a phone: hide the
    // whole option and pin the game to one player.
    const pg = document.getElementById('players-group');
    if (IS_MOBILE) {
        if (pg) pg.style.display = 'none';
        const ps = document.getElementById('players-select');
        if (ps) ps.value = '1';
    }

    const two = twoPlayerEnabled();
    const g2 = document.getElementById('p2-color-group');
    const colorSel = document.getElementById('color-select');
    const spectator = colorSel.querySelector
        ? colorSel.querySelector('option[value="spectator"]') : null;

    if (g2) g2.style.display = two ? 'block' : 'none';
    const l1 = document.getElementById('p1-color-label');
    if (l1) l1.innerText = two ? 'Player 1 car color:' : 'Choose your car color:';
    const cl = document.getElementById('controls-label');
    if (cl) cl.innerText = two ? 'Controls (Player 1):' : 'Controls:';

    // Two people, nobody spectating.
    if (spectator) spectator.disabled = two;
    if (two && colorSel.value === 'spectator') colorSel.value = 'red';

    // Two seats cannot share a colour.
    const sel2 = document.getElementById('p2-color-select');
    if (two && sel2 && sel2.value === colorSel.value) {
        sel2.value = P_COLORS.find(c => c !== colorSel.value);
    }

    const hint = document.getElementById('controls-hint');
    if (hint) {
        const s1 = schemeOf(1), s2 = schemeOf(2);
        hint.innerHTML = two
            ? `<b>Player 1</b> ${s1.short} &nbsp;·&nbsp; <b>Player 2</b> ${s2.short}` +
              ' — both cars are on track at once, on one keyboard.'
            : `${s1.short} — up throttles, down brakes, left and right steer.`;
    }
}
['players-select', 'controls-select', 'color-select', 'p2-color-select'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.addEventListener) el.addEventListener('change', syncControlsUi);
});
syncControlsUi();

startBtn.addEventListener('click', () => {
    isChampionship = false;
    raceMode = 'race';
    pendingGrid = null;
    pendingWeather = null;
    const laps = parseInt(document.getElementById('laps-select').value, 10) || 5;
    if (qualifyingEnabled()) {
        chooseTyres('Qualifying tyres', 'One flying lap is all that matters here.',
            QUALI_LAPS - 1, () => startQualifying(null));
    } else {
        chooseTyres('Race tyres', 'This set has to last the whole race.',
            laps, () => startGame());
    }
});

champBtn.addEventListener('click', () => {
    isChampionship = true;
    raceMode = 'championship';
    pendingGrid = null;
    pendingWeather = null;
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

// Pause works in anything that is actually running: countdown, race,
// qualifying, practice. It is a no-op on the menus and result screens.
function setPaused(want) {
    if (gameState !== 'playing' && gameState !== 'countdown') return;
    if (want === isPaused) return;
    isPaused = want;

    if (isPaused) {
        pauseStartedAt = performance.now();
        pauseOverlay.style.display = 'flex';
        pauseBtn.innerText = '▶ Resume';
        if (typeof stopAudio === 'function') stopAudio();
        // release the controls so no car is left on full throttle
        clearKeys();
        return;
    }

    // Give back exactly the time that was spent paused.
    const paused = performance.now() - pauseStartedAt;
    raceStartTime += paused;
    if (firstFinisherTime) firstFinisherTime += paused;
    if (vscEndsAt !== null) vscEndsAt += paused;   // the VSC clock stops too
    pauseOverlay.style.display = 'none';
    pauseBtn.innerText = '⏸ Pause';
    if (typeof initAudio === 'function') initAudio(!playerCar, humanCars().length);
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);      // the loop stopped; start it again
}

pauseBtn.addEventListener('click', () => setPaused(!isPaused));
resumeBtn.addEventListener('click', () => setPaused(false));
pauseQuitBtn.addEventListener('click', () => {
    setPaused(false);
    quitBtn.click();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        if (gameState === 'playing' || gameState === 'countdown') {
            e.preventDefault();
            setPaused(!isPaused);
        }
    }
});

stopSessionBtn.addEventListener('click', () => {
    if (raceMode === 'practice') endPracticeSession();
    else if (raceMode === 'qualifying') endQualifying();
});

document.getElementById('gp-start-btn').addEventListener('click', () => {
    document.getElementById('gp-preview').style.display = 'none';
    const trackType = championshipState.tracks[championshipState.currentTrackIndex];
    const laps = parseInt(document.getElementById('laps-select').value, 10) || 5;
    if (qualifyingEnabled()) {
        chooseTyres('Qualifying tyres', 'One flying lap is all that matters here.',
            QUALI_LAPS - 1, () => startQualifying(trackType));
    } else {
        chooseTyres('Race tyres', 'This set has to last the whole race.',
            laps, () => startGame(trackType));
    }
});

document.getElementById('gp-skip-btn').addEventListener('click', skipGrandPrix);

qualiRaceBtn.addEventListener('click', () => {
    qualiScreen.style.display = 'none';
    const laps = parseInt(document.getElementById('laps-select').value, 10) || 5;
    chooseTyres('Race tyres', 'A fresh set. This one has to last the whole race.',
        laps, () => startGame(qualiTrackType));
});

qualiMenuBtn.addEventListener('click', () => {
    qualiScreen.style.display = 'none';
    pendingGrid = null;
    pendingWeather = null;
    isChampionship = false;
    menu.style.display = 'block';
});

restartBtn.addEventListener('click', () => {
    gameOverScreen.style.display = 'none';
    pendingGrid = null;
    pendingWeather = null;
    skipMode = false;
    skipPlayer = null;
    skipPlayers = [];
    menu.style.display = 'block';
});

nextRoundBtn.addEventListener('click', () => {
    gameOverScreen.style.display = 'none';
    skipMode = false;
    skipPlayer = null;
    skipPlayers = [];
    nextChampionshipRound();
});

champRestartBtn.addEventListener('click', () => {
    champFinalScreen.style.display = 'none';
    menu.style.display = 'block';
});

quitBtn.addEventListener('click', () => {
    gameState = 'menu';
    isPaused = false;
    pauseOverlay.style.display = 'none';
    hud.style.display = 'none';
    hideSplitHud();
    showVscBanner(false);   // never leave it lying over a menu
    timingTower.style.display = 'none';
    stopSessionBtn.style.display = 'none';
    stopSessionBtn.innerText = 'Stop Session';
    if (isMobile) mobileControls.style.display = 'none';
    menu.style.display = 'block';
    if (typeof stopAudio === 'function') stopAudio();
    isChampionship = false;
    // Abandoning a session mid-run must not leave a stale grid or weather
    // waiting to be applied to whatever is started next.
    qualiQueue = [];
    qualiTimes = [];
    pendingGrid = null;
    pendingWeather = null;
    skipMode = false;
    skipPlayer = null;
    skipPlayers = [];
    document.getElementById('skip-overlay').style.display = 'none';
});

// Mobile Controls detection and mapping
const isMobile = IS_MOBILE;
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
    
    bindTouch(btnUp, 'up');
    bindTouch(btnDown, 'down');
    bindTouch(btnLeft, 'left');
    bindTouch(btnRight, 'right');
}

// ===========================================================================
// QUALIFYING
// ===========================================================================

let pendingField = [];   // the field the current qualifying session belongs to

// A qualifying session is one warm-up lap from a standing start plus two
// flying laps. Both the player and the simulated opponents run this exact
// format, so the times are directly comparable.
const QUALI_LAPS = 3;

// Qualifying is the default way the grid is decided. Two things switch it off:
// spectator mode (there is no player to drive a session) and reverse grid,
// where the grid comes from the standings so there is nothing to qualify for.
function qualifyingEnabled() {
    // A championship carries its own field: whether anyone is driving was
    // settled when it was created, not by whatever the menu says now.
    if (isChampionship) {
        if (reverseGridEnabled()) return false;
        return !!(championshipState && championshipState.participants.some(p => p.isPlayer));
    }
    return humanSeats().length > 0;
}

function twoPlayerEnabled() {
    if (IS_MOBILE) return false;    // one screen, one on-screen pad, one driver
    const sel = document.getElementById('players-select');
    return !!(sel && sel.value === '2');
}

const P_COLORS = ['red', 'blue', 'yellow', 'purple', 'orange', 'white'];

// The human entries for a field built from the menu: none when spectating,
// one normally, two on a shared keyboard. Seat order is the seat number, and
// the two seats can never end up the same colour.
function humanSeats() {
    const color = document.getElementById('color-select').value;
    if (!twoPlayerEnabled()) {
        if (color === 'spectator') return [];
        return [{ isPlayer: true, playerIndex: 1, color: color,
                  skillVariation: 1, driverName: 'You' }];
    }
    const c1 = color === 'spectator' ? 'red' : color;
    const sel2 = document.getElementById('p2-color-select');
    let c2 = (sel2 && sel2.value) || 'blue';
    if (c2 === c1) c2 = P_COLORS.find(c => c !== c1);
    return [
        { isPlayer: true, playerIndex: 1, color: c1, skillVariation: 1, driverName: 'Player 1' },
        { isPlayer: true, playerIndex: 2, color: c2, skillVariation: 1, driverName: 'Player 2' }
    ];
}

function reverseGridEnabled() {
    const box = document.getElementById('reverse-grid-checkbox');
    return !!(box && box.checked);
}

function makeTrack(trackType) {
    switch (trackType) {
        case 'f1':           return new F1Track();
        case 'peanut':       return new PeanutTrack();
        case 'circomassimo': return new CircoMassimoTrack();
        case 'circle':       return new CircleTrack();
        case 'serpent':      return new SerpentTrack();
        case 'quadrato':     return new QuadratoTrack();
        case 'triangle':     return new TriangleTrack();
        case 'pettine':      return new PettineTrack();
        case 'thunder':      return new ThunderTrack();
        case 'crown':        return new CrownTrack();
        default:             return new OvalTrack();
    }
}

// The field for a single race: the player (unless spectating) plus AI on
// shuffled legendary names. Championship keeps its own persistent list.
function buildField() {
    if (isChampionship) return [...championshipState.participants];

    const color = document.getElementById('color-select').value;
    const numOpponents = parseInt(document.getElementById('opponents-select').value, 10);
    const possibleColors = ['red', 'blue', 'yellow', 'purple', 'orange', 'white', 'green', 'cyan', 'pink', 'gray', 'lime', 'black'];
    let aiColors = [...possibleColors];
    const field = [];

    for (const h of humanSeats()) {
        field.push(h);
        aiColors = aiColors.filter(c => c !== h.color);
    }

    const legendaryDrivers = ['Ayrton Senna', 'Michael Schumacher', 'Lewis Hamilton', 'Juan Manuel Fangio', 'Alain Prost', 'Jim Clark', 'Max Verstappen', 'Niki Lauda', 'Fernando Alonso', 'Sebastian Vettel'];
    const randomDrivers = [...legendaryDrivers].sort(() => Math.random() - 0.5);
    // Never spawn more cars than there are drivers: at 10 opponents spectator
    // mode would have asked for 11 and put the same name on two cars.
    const totalAIsToSpawn = Math.min(color === 'spectator' ? numOpponents + 1 : numOpponents,
                                     legendaryDrivers.length);

    for (let i = 0; i < totalAIsToSpawn; i++) {
        field.push({
            isPlayer: false,
            color: aiColors[i % aiColors.length],
            skillVariation: null,
            driverName: randomDrivers[i % randomDrivers.length]
        });
    }
    return field;
}

// ---------------------------------------------------------------------------
// One AI qualifying lap, simulated headlessly with the real physics.
//
// The driver runs ALONE: cars is swapped for a single-element array, so the
// AI's traffic, defending and overtaking logic is skipped and what comes back
// is genuine clean-air pace. An out lap is run first and discarded (Car only
// records a time from its second crossing of the line), so the number
// returned is an honest flying lap in milliseconds - directly comparable with
// whatever the player sets in their own session.
//
// Every global the physics touches is saved and restored, so this can be
// called mid-session without disturbing the race the player is driving.
// ---------------------------------------------------------------------------
function simulateQualifyingLap(qTrack, driverName, difficulty, skillVariation, raining) {
    const sCars = cars, sSkid = globalSkidMarks, sPart = globalParticles;
    const sRain = isRaining, sLaps = TOTAL_LAPS, sVsc = vscPowerFactor;
    const sLeader = qTrack.leaderFinished, sTime = qTrack.currentRaceTime;

    const line = qTrack.getRacingLine();
    let si = 0, md = Infinity;
    line.nodes.forEach((n, i) => {
        const d = Math.hypot(n.cx - qTrack.startX, n.cy - qTrack.startY);
        if (d < md) { md = d; si = i; }
    });
    const n0 = line.nodes[si];

    const car = new Car(n0.cx, n0.cy, 'red', false);
    car.driverName = driverName;
    car.angle = n0.heading;
    car.maxHealth = 1e9;          // a qualifying lap is not a damage test
    car.health = car.maxHealth;
    car.nextWaypoint = 0;
    car._lapPixels = line.length;
    car._tyreRaceLaps = QUALI_LAPS;
    car.tyre = TYRES[AI.chooseTyre(driverName, QUALI_LAPS, raining)] || TYRES.medium;
    car.tyreWear = 0;
    // Standing start, exactly like the player's session: lap 1 is the warm-up
    // lap and is thrown away, laps 2 and 3 are the flying laps.
    car.velocity = { x: 0, y: 0 };

    cars = [car];
    globalSkidMarks = [];
    globalParticles = [];
    isRaining = !!raining;
    TOTAL_LAPS = 9999;
    vscPowerFactor = 1;
    qTrack.leaderFinished = false;

    const ai = new AI(car, difficulty, skillVariation);
    ai.startRace();

    // Car only records a lap time from its second crossing onward, so running
    // to lap 3 yields exactly two timed flying laps and bestLapTime is the
    // better of them - the same thing the player's session measures.
    const dt = 1 / 60;
    let t = 0;
    while (t < 240 && car.lap < QUALI_LAPS) {
        t += dt;
        qTrack.currentRaceTime = t * 1000;
        ai.update(qTrack, dt);
        car.update(dt, qTrack);
    }

    cars = sCars; globalSkidMarks = sSkid; globalParticles = sPart;
    isRaining = sRain; TOTAL_LAPS = sLaps; vscPowerFactor = sVsc;
    qTrack.leaderFinished = sLeader; qTrack.currentRaceTime = sTime;

    return car.bestLapTime;   // null if the lap was never completed
}

// Run through the pending AI drivers, one per frame, while the player drives.
function qualiTick() {
    if (!qualiQueue.length) return;
    const p = qualiQueue.shift();
    const difficulty = isChampionship
        ? championshipState.difficulty
        : document.getElementById('difficulty-select').value;
    const lap = simulateQualifyingLap(qualiTrack, p.driverName, difficulty, p.skillVariation, isRaining);
    qualiTimes.push({ p: p, lap: lap });
    if (lap !== null) {
        RaceLog.event('QUALI', `${p.driverName || p.color} ${(lap / 1000).toFixed(3)}`);
    }
}

// Provisional order shown live in the tower and used for the final grid.
function qualiOrder() {
    const rows = qualiTimes
        .filter(q => q.lap !== null)
        .map(q => ({ p: q.p, lap: q.lap }));

    // One row per human on track. A driver whose session is already over keeps
    // the time they set - laps driven afterwards do not count.
    for (const c of humanCars()) {
        const seat = c.playerIndex || 1;
        rows.push({
            p: pendingField.find(x => x.isPlayer && (x.playerIndex || 1) === seat),
            lap: c.qualiDone ? (c.qualiFinalTime !== undefined ? c.qualiFinalTime : c.bestLapTime)
                             : c.bestLapTime,   // null until the first flying lap
            isPlayer: true
        });
    }
    // No time yet = no grid slot yet: those sort to the back, in field order.
    rows.sort((a, b) => {
        if (a.lap === null && b.lap === null) return 0;
        if (a.lap === null) return 1;
        if (b.lap === null) return -1;
        return a.lap - b.lap;
    });
    return rows;
}

function renderQualiTower() {
    const rows = qualiOrder();
    const pole = rows.length && rows[0].lap !== null ? rows[0].lap : null;
    const html = rows.map((r, i) => {
        let gap;
        if (r.lap === null) gap = '--';
        else if (i === 0) gap = (r.lap / 1000).toFixed(1);
        else gap = '+' + ((r.lap - pole) / 1000).toFixed(1);
        const code = participantCode(r.p);
        return `<div class="tt-row${r.p && r.p.isPlayer ? ' me' : ''}">` +
               `<span class="tt-pos">${i + 1}</span>` +
               `<span class="tt-chip" style="background:${r.p ? r.p.color : '#888'};"></span>` +
               `<span class="tt-name"${r.lap === null ? ' style="opacity:.45;"' : ''}>${code}</span>` +
               `<span class="tt-gap">${gap}</span></div>`;
    }).join('');
    const waiting = qualiQueue.length
        ? `<div class="tt-note">${qualiQueue.length} still out&hellip;</div>` : '';
    timingTower.innerHTML = html + waiting;
}

function startQualifying(forceTrackType) {
    menu.style.display = 'none';
    gameOverScreen.style.display = 'none';
    qualiScreen.style.display = 'none';
    hud.style.display = 'flex';
    if (isMobile) mobileControls.style.display = 'flex';

    raceMode = 'qualifying';
    globalSkidMarks = [];
    globalParticles = [];
    document.getElementById('dnf-timer').style.visibility = 'hidden';
    speedometer.innerText = '0 km/h';
    document.getElementById('lap-timer').innerText = '';
    posCounter.innerText = '';
    lapCounter.innerText = 'Qualifying — warm-up lap';
    hideSplitHud();

    qualiTrackType = forceTrackType || document.getElementById('track-select').value;
    track = makeTrack(qualiTrackType);
    track.getRacingLine();
    track.leaderFinished = false;
    track.currentRaceTime = 0;
    qualiTrack = track;

    // The weekend's weather is decided here and reused for the race, so
    // qualifying and the race are never run in different conditions.
    const forceWetRace = document.getElementById('wet-race-checkbox').checked;
    isRaining = isChampionship ? nextChampionshipWeather()
                               : (forceWetRace ? true : (Math.random() < 0.20));
    pendingWeather = isRaining;

    let weatherIndicator = document.getElementById('weather-indicator');
    if (!weatherIndicator) {
        weatherIndicator = document.createElement('div');
        weatherIndicator.id = 'weather-indicator';
        hud.insertBefore(weatherIndicator, quitBtn);
    }
    weatherIndicator.innerText = isRaining ? "Wet 🌧️" : "Dry ☀️";
    renderTyreIndicator(null);

    // AFTER the weather is decided, not before. This used to sit above the
    // block that sets isRaining, so a session got the PREVIOUS session's
    // weather: puddles appeared in dry qualifying and were missing in wet.
    if (typeof track.makePuddles === 'function') {
        track.puddles = [];
        if (isRaining) track.makePuddles(4 + Math.floor(Math.random() * 3));
    }

    TOTAL_LAPS = 9999;              // the session ends on lap count, not the flag
    vscActive = false;
    vscEndsAt = null;
    vscPowerFactor = 1;
    recoveries = [];
    showVscBanner(false);
    stopSessionBtn.style.display = 'inline-block';
    stopSessionBtn.innerText = 'End Qualifying';
    timingTower.style.display = 'block';
    timingTower.innerHTML = '';

    pendingField = buildField();
    qualiTimes = [];
    qualiQueue = pendingField.filter(p => !p.isPlayer);

    // The players start on the line, on the racing line, already rolling:
    // this is an out lap from the pits, not a standing start.
    cars = [];
    ais = [];
    playerCar = null;
    player2Car = null;

    const humans = pendingField.filter(p => p.isPlayer);
    twoPlayer = humans.length > 1;

    if (humans.length) {
        const line = track.getRacingLine();
        let si = 0, md = Infinity;
        line.nodes.forEach((n, i) => {
            const d = Math.hypot(n.cx - track.startX, n.cy - track.startY);
            if (d < md) { md = d; si = i; }
        });

        humans.forEach((playerP, k) => {
            // Two cars cannot leave the pits from the same square metre, so
            // seat 2 rolls out a few nodes back down the racing line. Both are
            // timed from their own first crossing, so nobody is disadvantaged.
            const idx = ((si - k * 5) % line.nodes.length + line.nodes.length) % line.nodes.length;
            const n0 = line.nodes[idx];
            const car = new Car(n0.cx, n0.cy, playerP.color, true);
            car.driverName = playerP.driverName || 'You';
            car.playerIndex = playerP.playerIndex || 1;
            car.angle = n0.heading;
            car.startX = n0.cx; car.startY = n0.cy; car.startAngle = n0.heading;
            // Qualifying is not a free hit: the barriers cost the same as in the
            // race, and a heavy enough shunt ends your session. The car is rebuilt
            // for the race though - you carry the grid slot over, not the damage.
            car.maxHealth = 255 + 10 * Math.max(0, Math.min(QUALI_LAPS, 40) - 5);
            car.health = car.maxHealth;
            car.nextWaypoint = 0;
            car._lapPixels = line.length;
            car.tyre = TYRES[seatTyre(car.playerIndex)] || TYRES.medium;
            car.tyreWear = 0;
            car._tyreRaceLaps = QUALI_LAPS;
            cars.push(car);
            if (car.playerIndex === 2) player2Car = car; else playerCar = car;
        });
    }

    RaceLog.start({
        mode: isChampionship ? 'Qualifying (championship round)' : 'Qualifying',
        track: qualiTrackType,
        laps: null,
        difficulty: isChampionship ? championshipState.difficulty
                                   : document.getElementById('difficulty-select').value,
        weather: isRaining ? 'wet' : 'dry',
        grid: pendingField.map(p => p.driverName || p.color)
    });

    gameState = 'playing';          // no start lights: you roll out of the pits
    raceStartTime = performance.now();
    countdownTimer = 0;
    lightState = 6;
    leaderFinished = false;
    finishCounter = 0;
    dnfWindowMs = 20000;
    firstFinisherTime = null;
    raceFinished = false;
    isFalseStartResetting = false;
    isPaused = false;
    pauseOverlay.style.display = 'none';
    pauseBtn.style.display = 'inline-block';
    pauseBtn.innerText = '⏸ Pause';
    winnerAnnouncement.style.display = 'none';

    if (typeof initAudio === 'function') initAudio(!playerCar, humanCars().length);
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

// ===========================================================================
// TYRE CHOICE
// ===========================================================================
// HUD readout: compound plus a bar for what is left of it.
function renderTyreIndicator(car) {
    const el = document.getElementById('tyre-indicator');
    if (!el) return;
    if (!car || !car.tyre) { el.innerHTML = ''; return; }
    const left = Math.max(0, Math.min(1, 1 - (car.tyreWear || 0)));
    // Green on a green track over green grass was unreadable. The bar now has
    // a dark well and a border of its own, the colour ramp runs through amber
    // to red, and the number is spelled out so it never depends on the fill
    // being legible at all.
    const col = left > 0.55 ? '#00e676' : (left > 0.30 ? '#ffc400' : '#ff3d00');
    el.innerHTML =
        '<span class="tyre-pip" style="background:' + car.tyre.colour + ';"></span>' +
        '<b>' + car.tyre.short + '</b>' +
        '<span id="tyre-wear-bar"><span id="tyre-wear-fill" style="width:' +
        (left * 100).toFixed(0) + '%;background:' + col + ';"></span></span>' +
        '<span id="tyre-wear-pct" style="color:' + col + ';">' +
        (left * 100).toFixed(0) + '%</span>';
}

// ===========================================================================
// TWO-PLAYER HUD
//
// One bar along the top can only ever describe one driver. With two people on
// the keyboard each gets their own card along the bottom, colour-keyed to the
// car, and the top bar keeps only what they share: weather, DNF clock, buttons.
// ===========================================================================
function hideSplitHud() {
    const el = document.getElementById('hud2');
    if (el) el.style.display = 'none';
}

function fmtLapMs(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '--.---';
    return (ms / 1000).toFixed(3);
}

function playerCardHtml(car, pos, field) {
    const s = schemeOf(car.playerIndex || 1);
    const speed = Math.sqrt(car.velocity.x ** 2 + car.velocity.y ** 2);

    let line1;
    if (raceMode === 'practice') {
        line1 = `Lap ${car.lap + 1}`;
    } else if (raceMode === 'qualifying') {
        line1 = car.qualiDone ? 'Session over'
              : (car.lap === 0 ? 'Warm-up lap'
                               : `Flying lap ${car.lap}/${QUALI_LAPS - 1}`);
    } else {
        line1 = `Lap ${Math.min(car.lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}` +
                (pos ? ` &nbsp; P${pos}/${field}` : '');
    }

    // tyre
    let tyreHtml = '';
    if (car.tyre) {
        const left = Math.max(0, Math.min(1, 1 - (car.tyreWear || 0)));
        const col = left > 0.55 ? '#00e676' : (left > 0.30 ? '#ffc400' : '#ff3d00');
        tyreHtml =
            `<span class="p-pip" style="background:${car.tyre.colour};"></span>` +
            `<b>${car.tyre.short}</b>` +
            `<span class="p-bar"><span style="width:${(left * 100).toFixed(0)}%;` +
            `background:${col};"></span></span>` +
            `<span style="color:${col};">${(left * 100).toFixed(0)}%</span>`;
    }

    const nowMs = typeof track.currentRaceTime === 'number' ? track.currentRaceTime : 0;
    const cur = car.finished || car.qualiDone
        ? (car.lastLapTime || 0)
        : Math.max(0, nowMs - car.lapStartTime);
    const curCol = car.bestLapTime ? (cur > car.bestLapTime ? '#ff8a80' : '#69f0ae') : '#fff';

    const dead = car.isBroken ? '<span class="p-dead">OUT</span>' : '';

    return `<div class="p-line"><span class="p-who" style="color:${car.color};">` +
           `${humanLabel(car)}</span>` +
           `<span class="p-keys">${s.short}</span>${dead}</div>` +
           `<div class="p-line"><span>${line1}</span></div>` +
           `<div class="p-line"><span class="p-speed">${Math.floor(speed * 0.5)} km/h</span>` +
           tyreHtml + `</div>` +
           `<div class="p-line"><span style="color:${curCol};">${fmtLapMs(cur)}</span>` +
           `<span style="opacity:.6;">B ${fmtLapMs(car.bestLapTime)}</span></div>`;
}

function renderSplitHud(sortedCars) {
    const box = document.getElementById('hud2');
    if (!box) return;
    if (!twoPlayer || !humanCars().length || skipMode) { box.style.display = 'none'; return; }

    box.style.display = 'flex';
    const p1 = document.getElementById('p1-card');
    const p2 = document.getElementById('p2-card');
    const seats = [[playerCar, p1], [player2Car, p2]];

    for (let i = 0; i < seats.length; i++) {
        const car = seats[i][0], el = seats[i][1];
        if (!el) continue;
        if (!car) { el.style.display = 'none'; continue; }
        el.style.display = 'block';
        el.style.borderLeftColor = car.color;
        el.style.borderRightColor = car.color;
        el.className = 'p-card' + (i === 1 ? ' p-right' : '');
        const pos = sortedCars ? sortedCars.indexOf(car) + 1 : 0;
        el.innerHTML = playerCardHtml(car, pos, sortedCars ? sortedCars.length : 0);
    }
}

function tyreLapsText(key, laps) {
    const t = TYRES[key];
    const life = t.life * laps;
    return life >= laps ? 'lasts the distance'
                        : '~' + life.toFixed(1) + ' of ' + laps + ' laps';
}

// Each seat runs its own set. Two players choose one after the other, and
// nothing else in the game has to care how many choices were made.
function seatTyre(index) {
    return (index === 2 ? playerTyre2 : playerTyre) || 'medium';
}

function chooseTyres(title, subtitle, laps, done) {
    if (!twoPlayerEnabled()) {
        showTyreChoice(title, subtitle, laps, done, 1);
        return;
    }
    showTyreChoice(title + ' — Player 1', subtitle, laps, () => {
        showTyreChoice(title + ' — Player 2', subtitle, laps, done, 2);
    }, 1);
}

function showTyreChoice(title, subtitle, laps, cb, seat) {
    pendingTyreSeat = seat === 2 ? 2 : 1;
    pendingTyreCb = cb;
    menu.style.display = 'none';
    gameOverScreen.style.display = 'none';
    qualiScreen.style.display = 'none';
    document.getElementById('gp-preview').style.display = 'none';
    hud.style.display = 'none';
    hideSplitHud();
    showVscBanner(false);   // never leave it lying over a menu
    gameState = 'menu';

    tyreTitle.innerText = title;
    tyreSubtitle.innerText = subtitle;
    tyreOptions.innerHTML = TYRE_KEYS.map(k => {
        const t = TYRES[k];
        const pace = ((t.grip - 1) * 100);
        return '<button class="tyre-opt" data-tyre="' + k + '">' +
            '<span class="tyre-dot" style="background:' + t.colour + ';"></span>' +
            '<span class="tyre-name">' + t.label + '</span>' +
            '<span class="tyre-stat">' + (pace >= 0 ? '+' : '') + pace.toFixed(1) + '% pace</span>' +
            '<span class="tyre-stat">' + tyreLapsText(k, laps) + '</span>' +
            '</button>';
    }).join('');
    Array.prototype.forEach.call(tyreOptions.querySelectorAll('.tyre-opt'), (b) => {
        b.addEventListener('click', () => {
            const pick = b.getAttribute('data-tyre');
            if (pendingTyreSeat === 2) playerTyre2 = pick; else playerTyre = pick;
            tyreScreen.style.display = 'none';
            const cb2 = pendingTyreCb;
            pendingTyreCb = null;
            if (cb2) cb2(pick);
        });
    });
    tyreScreen.style.display = 'block';
}

// ===========================================================================
// GRAND PRIX PREVIEW (championship)
// ===========================================================================

// Corners from the racing line: signed heading change per node, grouped into
// runs of consistent sign. In canvas coordinates y points down, so a positive
// heading change is a RIGHT-hand corner.
function countCorners(line) {
    const N = line.count, nodes = line.nodes, ds = line.ds;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    let left = 0, right = 0;
    let runSign = 0, runTurn = 0, gap = 0;
    const close = () => {
        // 0.35 rad ~ 20 degrees: kinks smaller than that are not corners
        if (Math.abs(runTurn) > 0.35) { if (runSign > 0) right++; else left++; }
        runSign = 0; runTurn = 0; gap = 0;
    };
    for (let i = 0; i < N; i++) {
        const dh = wrap(nodes[(i + 1) % N].heading - nodes[i].heading);
        const R = Math.abs(dh) > 1e-6 ? ds / Math.abs(dh) : Infinity;
        const sign = Math.sign(dh);
        if (R < 500 && sign !== 0) {           // curved enough to matter
            if (runSign === 0) runSign = sign;
            if (sign === runSign) { runTurn += dh; gap = 0; }
            else { close(); runSign = sign; runTurn = dh; }
        } else if (runSign !== 0 && ++gap > 4) {
            close();
        }
    }
    close();
    return { left, right };
}

// One clean-air flying lap with a hard-difficulty AI, recording top speed.
// Same sandbox trick as simulateQualifyingLap: every global the physics
// touches is saved and restored.
function measureTrackStats(qTrack, raining) {
    const sCars = cars, sSkid = globalSkidMarks, sPart = globalParticles;
    const sRain = isRaining, sLaps = TOTAL_LAPS, sVsc = vscPowerFactor;
    const sLeader = qTrack.leaderFinished, sTime = qTrack.currentRaceTime;

    const line = qTrack.getRacingLine();
    let si = 0, md = Infinity;
    line.nodes.forEach((n, i) => {
        const d = Math.hypot(n.cx - qTrack.startX, n.cy - qTrack.startY);
        if (d < md) { md = d; si = i; }
    });
    const n0 = line.nodes[si];
    const car = new Car(n0.cx, n0.cy, 'red', false);
    car.driverName = 'probe';
    car.angle = n0.heading;
    car.maxHealth = 1e9; car.health = car.maxHealth;
    car.nextWaypoint = 0;
    car._lapPixels = line.length;
    car._tyreRaceLaps = 5;
    car.tyre = TYRES.medium; car.tyreWear = 0;
    const v0 = Math.min(n0.vCorner || 200, 200);
    car.velocity = { x: Math.cos(n0.heading) * v0, y: Math.sin(n0.heading) * v0 };

    cars = [car]; globalSkidMarks = []; globalParticles = [];
    isRaining = !!raining; TOTAL_LAPS = 9999; vscPowerFactor = 1;
    qTrack.leaderFinished = false;

    const ai = new AI(car, 'hard', 1);
    ai.startRace();
    const dt = 1 / 60;
    let t = 0, vmax = 0;
    while (t < 180 && car.lap < 2) {
        t += dt;
        qTrack.currentRaceTime = t * 1000;
        ai.update(qTrack, dt);
        car.update(dt, qTrack);
        const sp = Math.hypot(car.velocity.x, car.velocity.y);
        if (sp > vmax) vmax = sp;
    }
    const lap = car.bestLapTime;

    cars = sCars; globalSkidMarks = sSkid; globalParticles = sPart;
    isRaining = sRain; TOTAL_LAPS = sLaps; vscPowerFactor = sVsc;
    qTrack.leaderFinished = sLeader; qTrack.currentRaceTime = sTime;
    return { lap: lap, vmax: vmax };
}

const TRACK_LABELS = {
    oval: 'Oval', peanut: 'Peanut', f1: 'F1 Circuit', circomassimo: 'Circus Maximus',
    circle: 'Circle', serpent: 'Serpent', quadrato: 'Square', triangle: 'Triangle',
    pettine: 'Comb', thunder: 'Thunder', crown: 'Crown'
};

function showGpPreview(trackType) {
    menu.style.display = 'none';
    gameOverScreen.style.display = 'none';
    qualiScreen.style.display = 'none';
    hud.style.display = 'none';
    hideSplitHud();
    showVscBanner(false);   // never leave it lying over a menu
    gameState = 'menu';               // nothing is running while this is up

    const round = championshipState.currentTrackIndex + 1;
    const total = championshipState.tracks.length;
    const wet = nextChampionshipWeather();

    const pTrack = makeTrack(trackType);
    const line = pTrack.getRacingLine();
    const corners = countCorners(line);
    const stats = measureTrackStats(pTrack, wet);

    document.getElementById('gp-title').innerText =
        `Round ${round}/${total} — ${TRACK_LABELS[trackType] || trackType}`;
    document.getElementById('gp-weather').innerHTML = wet
        ? '<span style="color:#64b5f6;">Wet 🌧️</span>' : 'Dry ☀️';

    // Mini-map: the real track, drawn scaled onto a small canvas.
    const map = document.getElementById('gp-map');
    const mctx = map.getContext('2d');
    const sc = Math.min(map.width / 1000, map.height / 700);
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, map.width, map.height);
    mctx.setTransform(sc, 0, 0, sc,
        (map.width - 1000 * sc) / 2, (map.height - 700 * sc) / 2);
    mctx.fillStyle = '#388E3C';
    mctx.fillRect(0, 0, 1000, 700);
    pTrack.draw(mctx);

    // 1 px = 1 m, the same fiction the speedometer already uses (0.5 factor).
    const laps = parseInt(document.getElementById('laps-select').value, 10) || 5;
    const cells = [
        ['Length', (line.length / 1000).toFixed(2) + ' km'],
        ['Laps', String(laps)],
        ['Corners', String(corners.left + corners.right)],
        ['Left / Right', corners.left + ' L / ' + corners.right + ' R'],
        ['Est. lap time', stats.lap ? (stats.lap / 1000).toFixed(1) + 's' : '—'],
        ['Top speed', Math.round(stats.vmax * 0.5) + ' km/h']
    ];
    document.getElementById('gp-stats').innerHTML = cells.map(c =>
        `<div class="gp-cell"><div class="gp-k">${c[0]}</div><div class="gp-v">${c[1]}</div></div>`).join('');

    document.getElementById('gp-start-btn').innerText =
        qualifyingEnabled() ? 'Start Qualifying' : 'Start Race';
    document.getElementById('gp-preview').style.display = 'block';
}

// You sit this one out. The race still happens: the AI field runs the full
// distance for real championship points, simulated at speed with the drawing
// skipped, and you are classified DNS.
function skipGrandPrix() {
    const trackType = championshipState.tracks[championshipState.currentTrackIndex];

    document.getElementById('gp-preview').style.display = 'none';
    document.getElementById('skip-overlay').style.display = 'flex';
    document.getElementById('skip-progress').innerText = 'Simulating the race…';

    skipMode = true;
    skipClock = 0;
    skipNow = 0;
    skipPlayers = championshipState.participants.filter(p => p.isPlayer);
    skipPlayer = skipPlayers[0] || null;

    startGame(trackType);        // builds the field WITHOUT the player
}

function endQualifying() {
    if (gameState === 'gameover') return;

    // Anyone still in the queue finishes their lap now: the grid can't be set
    // with drivers who never ran.
    while (qualiQueue.length) qualiTick();

    gameState = 'gameover';
    raceFinished = true;
    hud.style.display = 'none';
    hideSplitHud();
    showVscBanner(false);   // never leave it lying over a menu
    timingTower.style.display = 'none';
    stopSessionBtn.style.display = 'none';
    stopSessionBtn.innerText = 'Stop Session';
    if (isMobile) mobileControls.style.display = 'none';
    if (typeof stopAudio === 'function') stopAudio();

    const rows = qualiOrder();
    pendingGrid = rows.map(r => r.p).filter(Boolean);

    // A driver who never set a time still has to start somewhere: they keep
    // the back of the grid, which is exactly what qualiOrder already did.
    for (const p of pendingField) {
        if (!pendingGrid.includes(p)) pendingGrid.push(p);
    }

    const pole = rows.length && rows[0].lap !== null ? rows[0].lap : null;
    RaceLog.event('QUALI', 'session ended — pole: ' +
        (rows.length && rows[0].p ? (rows[0].p.driverName || rows[0].p.color) : 'nobody') +
        (pole ? ` ${(pole / 1000).toFixed(3)}` : ''));

    qualiTitle.innerText = isRaining ? 'Qualifying — Wet 🌧️' : 'Qualifying — Dry ☀️';
    qualiBody.innerHTML = rows.map((r, i) => {
        const name = r.p ? (r.p.isPlayer && !twoPlayer ? 'YOU' : r.p.driverName) : '?';
        const time = r.lap === null ? '<span style="opacity:.45;">no time</span>'
                                    : (r.lap / 1000).toFixed(3);
        const gap = r.lap === null ? '&ndash;'
                  : (i === 0 ? 'POLE' : '+' + ((r.lap - pole) / 1000).toFixed(3));
        const cls = (r.p && r.p.isPlayer ? ' q-me' : '') + (i === 0 ? ' q-pole' : '');
        return `<tr class="${cls.trim()}">` +
               `<td class="q-pos">${i + 1}</td>` +
               `<td class="q-driver">` +
               `<span class="tt-chip" style="background:${r.p ? r.p.color : '#888'};` +
               `display:inline-block;vertical-align:middle;margin-right:8px;"></span>` +
               `<span style="color:${r.p ? r.p.color : '#888'};">${name}</span></td>` +
               `<td>${time}</td>` +
               `<td class="q-gap">${gap}</td></tr>`;
    }).join('');

    RaceLog.end(rows.map(r => ({
        name: r.p ? (r.p.driverName || r.p.color) : '?',
        laps: 1,
        time: r.lap === null ? '--.---' : (r.lap / 1000).toFixed(3),
        best: r.lap === null ? '' : (r.lap / 1000).toFixed(3),
        note: r.lap === null ? 'no time' : (pole && r.lap === pole ? 'POLE' : '')
    })));

    qualiRaceBtn.innerText = isChampionship
        ? `Start Round ${championshipState.currentTrackIndex + 1}`
        : 'Start Race';
    qualiScreen.style.display = 'block';
}

function startGame(forceTrackType = null) {
    // A qualifying session hands over to the race here. Without this the race
    // still ran as a session: the tower kept showing qualifying times and the
    // "session over" check fired the moment the player completed lap 3.
    if (raceMode === 'qualifying') raceMode = isChampionship ? 'championship' : 'race';

    menu.style.display = 'none';
    // Nothing to watch while a skipped Grand Prix is being simulated.
    hud.style.display = skipMode ? 'none' : 'flex';
    if (isMobile) mobileControls.style.display = skipMode ? 'none' : 'flex';
    
    // Reset effects
    globalSkidMarks = [];
    globalParticles = [];
    
    document.getElementById('dnf-timer').style.visibility = 'hidden';
    
    const forceWetRace = document.getElementById('wet-race-checkbox').checked;
    // If a qualifying session has just run, the weekend's weather was decided
    // there and the race has to inherit it - you cannot qualify in the wet and
    // then race in the dry. Otherwise: championship uses the pre-rolled season
    // weather, a single race uses the toggle or a 20% chance.
    if (pendingWeather !== null) {
        isRaining = pendingWeather;
    } else if (isChampionship) {
        isRaining = nextChampionshipWeather();
    } else {
        isRaining = forceWetRace ? true : (Math.random() < 0.20);
    }

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
    
    // updateHUD only runs while playing, so anything left in these readouts
    // survives into the countdown: after qualifying the speedometer sat on
    // the last speed of the flying lap for the whole grid sequence.
    speedometer.innerText = '0 km/h';
    document.getElementById('lap-timer').innerText = '';
    posCounter.innerText = '';
    lapCounter.innerText = '';

    const isPractice = raceMode === 'practice';
    stopSessionBtn.style.display = isPractice ? 'inline-block' : 'none';
    timingTower.style.display = isPractice ? 'none' : 'block';
    timingTower.innerHTML = '';

    // Free practice: unlimited running, no opponents, no flag.
    TOTAL_LAPS = isPractice ? 9999 : parseInt(document.getElementById('laps-select').value, 10);

    vscActive = false;

    vscEndsAt = null;
    vscPowerFactor = 1;
    recoveries = [];
    showVscBanner(false);
    const trackType = forceTrackType || document.getElementById('track-select').value;
    const color = document.getElementById('color-select').value;
    const difficulty = document.getElementById('difficulty-select').value;

    track = makeTrack(trackType);

    // Pre-compute the AI racing line here (a few ms) so the very first racing
    // frame doesn't stutter while building it lazily.
    if (typeof track.getRacingLine === 'function') track.getRacingLine();

    // Standing water, only when it is raining. Fresh every race.
    if (typeof track.makePuddles === 'function') {
        track.puddles = [];
        if (isRaining) track.makePuddles(4 + Math.floor(Math.random() * 3));
    }

    cars = [];
    ais = [];
    playerCar = null; // Reset playerCar
    player2Car = null;

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
    
    let currentParticipants = [];
    let gridSource = 'simulated qualifying';

    if (isPractice) {
        // Free practice with nobody driving would be an empty track, so a
        // spectator still gets a car here.
        const seats = humanSeats();
        currentParticipants = seats.length ? seats
            : [{ isPlayer: true, playerIndex: 1, color: 'red', skillVariation: 1, driverName: 'You' }];
    } else if (pendingGrid) {
        // 1. The player just drove a qualifying session: that order IS the grid.
        currentParticipants = [...pendingGrid];
        gridSource = 'qualifying session';
    } else if (isChampionship && reverseGridEnabled()) {
        if (championshipState.currentTrackIndex === 0) {
            // 2a. Round 1: no standings to invert yet, so the grid is drawn at
            //     random. Nobody has earned anything, so nobody is seeded.
            currentParticipants = [...championshipState.participants];
            for (let i = currentParticipants.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [currentParticipants[i], currentParticipants[j]] =
                    [currentParticipants[j], currentParticipants[i]];
            }
            gridSource = 'random draw (reverse-grid round 1)';
        } else {
            // 2b. Most points starts last. Self-balancing: the better the
            //     championship is going, the further back the next race starts.
            currentParticipants = [...championshipState.participants]
                .sort((a, b) => (championshipState.points[a.color] || 0) -
                                (championshipState.points[b.color] || 0));
            gridSource = 'reverse championship order';
        }
    } else {
        currentParticipants = buildField();

        // 3. Simulated qualifying.
        // Each AI sets a notional flying lap (pace + the variance a single lap
        // really has) and the grid is the qualifying order. The player is
        // slotted mid-grid: they didn't drive a lap, so they neither gain nor
        // lose one.
        const aiDifficulty = isChampionship ? championshipState.difficulty : difficulty;
        const qualified = currentParticipants
            .filter(p => !p.isPlayer)
            .map(p => ({
                p: p,
                lap: AI.qualifyingPace(p.driverName, aiDifficulty, p.skillVariation, isRaining)
            }))
            .sort((a, b) => a.lap - b.lap)
            .map(x => x.p);

        const players = currentParticipants.filter(p => p.isPlayer);
        if (players.length) {
            qualified.splice(Math.floor(qualified.length / 2), 0, ...players);
        }
        currentParticipants = qualified;
    }

    // Skipped Grand Prix: you are not on the grid at all. The AI race that
    // follows is a real one for everyone else.
    if (skipMode) currentParticipants = currentParticipants.filter(p => !p.isPlayer);

    // The field is settled: this is what decides whether the game is in
    // two-player mode for the session about to run, not the menu.
    twoPlayer = currentParticipants.filter(p => p.isPlayer).length > 1;

    // Consumed: the next race builds its own grid unless it too is qualified for.
    pendingGrid = null;
    pendingWeather = null;

    racePoleColor = currentParticipants.length ? currentParticipants[0].color : null;
    lapLeaders = [];

    RaceLog.event('SESSION', `grid set from ${gridSource}: ` +
        currentParticipants.map((p, i) => `${i + 1}.${p.driverName || p.color}`).join(' '));

    // Spawn positions, one per starter: staggered 30px back each row and
    // alternating 20px either side of the centre line.
    const gridPositions = [];
    for (let i = 0; i < currentParticipants.length; i++) {
        gridPositions.push(getGridPos(35 + i * 30, i % 2 === 0 ? 20 : -20));
    }

    // 4. Instantiate cars at their assigned grid positions
    for (let i = 0; i < currentParticipants.length; i++) {
        const gridPos = gridPositions[i];
        const p = currentParticipants[i];
        
        const car = new Car(gridPos.x, gridPos.y, p.color, p.isPlayer);
        car.driverName = p.driverName;
        car.playerIndex = p.isPlayer ? (p.playerIndex || 1) : 0;
        car.gridIndex = i;              // stable tie-break before anyone moves
        car.startGridPos = i + 1;       // for the places-gained bonus

        // Tyres. The player has just chosen; each AI picks from its own style,
        // so the grid is a mix rather than ten cars on the same rubber.
        car._lapPixels = track.getRacingLine ? track.getRacingLine('standard').length : 3000;
        const tKey = p.isPlayer ? seatTyre(car.playerIndex)
                                : AI.chooseTyre(p.driverName, TOTAL_LAPS, isRaining);
        car.tyre = TYRES[tKey] || TYRES.medium;
        car.tyreWear = 0;
        car._tyreRaceLaps = TOTAL_LAPS;
        car.startX = gridPos.x;
        car.startY = gridPos.y;
        car.startAngle = gridPos.angle; // New property to store the grid angle
        car.angle = gridPos.angle;      // Set initial angle
        cars.push(car);
        
        if (p.isPlayer) {
            if (car.playerIndex === 2) player2Car = car;
            else playerCar = car;
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
    
    // The HUD is not updated during the countdown, so the tyre readout still
    // showed the compound from qualifying right up to the lights going out.
    // Render it here, the moment the grid exists.
    if (twoPlayer) {
        renderTyreIndicator(null);      // the cards carry it, one per driver
        renderSplitHud(null);
    } else {
        renderTyreIndicator(playerCar || cars[0] || null);
    }

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
    isPaused = false;
    pauseOverlay.style.display = 'none';
    pauseBtn.style.display = 'inline-block';
    pauseBtn.innerText = '⏸ Pause';
    winnerAnnouncement.style.display = 'none';
    
    // Initialize Audio
    if (typeof initAudio === 'function') {
        initAudio(!playerCar, humanCars().length); // Pass true if spectator mode
    }
    
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

// --- human seats ---------------------------------------------------------
// One place that knows which cars are driven by a person and which keys feed
// them. Seat 2 simply does not exist in a one-player game, so every call below
// is a no-op there.
function humanCars() {
    const out = [];
    if (playerCar) out.push(playerCar);
    if (player2Car) out.push(player2Car);
    return out;
}

function seatKeys(car) {
    return (car && car.playerIndex === 2) ? keys2 : keys;
}

function applyHumanInputs() {
    for (const c of humanCars()) {
        // A driver whose qualifying session is over coasts to a stop: they
        // cannot keep circulating and improving on a time everyone else has
        // already finished chasing.
        if (c.qualiDone) {
            c.inputs.up = c.inputs.down = c.inputs.left = c.inputs.right = false;
            continue;
        }
        const k = seatKeys(c);
        c.inputs.up = k.up;
        c.inputs.down = k.down;
        c.inputs.left = k.left;
        c.inputs.right = k.right;
    }
}

// How a human is labelled. Alone you are "YOU"; with someone else on the
// keyboard you need to be able to tell the two of you apart.
function humanLabel(car) {
    if (!car || !car.isPlayer) return '';
    if (!twoPlayer) return 'YOU';
    return car.playerIndex === 2 ? 'P2' : 'P1';
}

function updatePhysics(dt) {
    if (dt > 0.05) dt = 0.05; // cap dt for physics stability (min 20fps logic)
    
    // Player input
    applyHumanInputs();

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
    // A stopped car leaves no wake, and a crawling one leaves a weak one. The
    // ramp is set below where racing actually happens: over six circuits, only
    // 0.6% of racing car-frames are under 15 units of forward speed and 4% are
    // under 45, so the tow behind a moving car is untouched.
    cars.forEach(car => {
        car.isDrafting = false; // Reset drafting state
        car.draftStrength = 0;
    });

    // Handle 20s DNF timer
    if (firstFinisherTime && (raceNow() - firstFinisherTime > dnfWindowMs)) {
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

            // A slipstream is a hole punched in the air, so a car that is not
            // moving is not making one. Sitting behind a parked car - one that
            // has finished its qualifying laps, spun, or is stopped on the
            // grid - used to hand out a full tow.
            const ofx = Math.cos(otherCar.angle), ofy = Math.sin(otherCar.angle);
            const otherFwd = otherCar.velocity.x * ofx + otherCar.velocity.y * ofy;
            const wake = Math.max(0, Math.min(1,
                (otherFwd - DRAFT_MIN_SPEED) / (DRAFT_FULL_SPEED - DRAFT_MIN_SPEED)));
            if (wake <= 0) continue;

            const dx = otherCar.x - car.x;
            const dy = otherCar.y - car.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 20 || dist >= 190) continue;

            // ...and ahead ON THE ROAD, not merely in front of the nose. The
            // cone test alone was fooled by geometry: mid-corner, the car
            // CHASING you sits inside your forward cone across the chord, and
            // on tracks with close-packed legs a car half a circuit away
            // qualified. Measured before this check: 44% of all tow was being
            // handed out by a car that was actually behind. The lap-relative
            // odometer settles it, and still lets the leader draft a
            // backmarker who is genuinely just ahead of them on track.
            const lapL = car._lapPixels || 3000;
            const roadGap = (((otherCar.lapS || 0) - (car.lapS || 0)) % lapL + lapL) % lapL;
            if (roadGap <= 0 || roadGap >= 250) continue;

            // Where is it in MY frame: how far up the road, and how far off
            // the line I am travelling on?
            const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
            const along = dx * hx + dy * hy;
            const side = Math.abs(dx * -hy + dy * hx);
            if (along <= 20 || along >= DRAFT_RANGE) continue;

            // A wake is a CORRIDOR behind a car, not a wedge. The old test was
            // an angular cone of +/- 0.40 rad, which is 16px wide at 40px back
            // but 74px wide at the far end - wider than the road on some
            // circuits. Measured over 64,000 tows: a third went to a car more
            // than 20px off line (a car is only 14px wide, so no overlap at
            // all) and a sixth to one more than 30px off - alongside, not
            // behind. The corridor starts a little wider than a car and
            // spreads gently, so a tow now means what it looks like.
            const halfWidth = WAKE_HALF + WAKE_SPREAD * along;
            if (side >= halfWidth) continue;

            let headingDiff = Math.abs(car.angle - otherCar.angle);
            if (headingDiff > Math.PI) headingDiff = 2 * Math.PI - headingDiff;
            if (headingDiff > 0.7) continue;

            // Falloffs, multiplied together: distance up the road, position
            // across the corridor, and how nearly the two cars point the
            // same way.
            const distFactor = 1 - Math.max(0, (along - 45) / (DRAFT_RANGE - 45));
            const laneFactor = 1 - (side / halfWidth);
            const alignFactor = 1 - (headingDiff / 0.7);

            const strength = Math.max(0, Math.min(1, distFactor * laneFactor * alignFactor * wake));
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
    applyCraneCollisions();
    applyVscHold();

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
                        // Each car is billed against its own free band, so the
                        // player's wider one does not also let the AI off.
                        const freeOf = (c) => 65 + (c.isPlayer &&
                            typeof PLAYER_FREE_IMPACT !== 'undefined' ? PLAYER_FREE_IMPACT : 0);
                        const dmgOf = (c) => {
                            const f = freeOf(c);
                            return closing <= f ? 0 : 320 * Math.pow((closing - f) / 100, 2);
                        };
                        const d1 = dmgOf(c1), d2 = dmgOf(c2);
                        const dmg = Math.max(d1, d2);
                        if (dmg > 0) {
                            if (d1 > 0) c1.takeDamage(d1);
                            if (d2 > 0) c2.takeDamage(d2);
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

// Three-letter driver codes, as on a real timing screen.
const DRIVER_CODES = {
    'Ayrton Senna': 'SEN', 'Michael Schumacher': 'MSC', 'Lewis Hamilton': 'HAM',
    'Juan Manuel Fangio': 'FAN', 'Alain Prost': 'PRO', 'Jim Clark': 'CLA',
    'Max Verstappen': 'VER', 'Niki Lauda': 'LAU', 'Fernando Alonso': 'ALO',
    'Sebastian Vettel': 'VET'
};
// The same label from a participant record rather than a live car, for the
// screens that exist before or after the cars do.
function participantCode(p) {
    if (!p) return '---';
    if (p.isPlayer) {
        if (!twoPlayer) return 'YOU';
        return (p.playerIndex || 1) === 2 ? 'P2' : 'P1';
    }
    return DRIVER_CODES[p.driverName] ||
           (p.driverName || p.color || '---').slice(0, 3).toUpperCase();
}

function driverCode(car) {
    if (!car) return '---';
    if (car.isPlayer) return humanLabel(car);
    const n = car.driverName;
    if (n && DRIVER_CODES[n]) return DRIVER_CODES[n];
    if (n) return n.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
    return (car.color || '---').slice(0, 3).toUpperCase();
}

// =========================================================================
//  WRECK RECOVERY  +  VIRTUAL SAFETY CAR
//  A destroyed car must not be left sitting in the racing line as an
//  obstacle. It is taken off by a crane; while that happens every car runs
//  on reduced power and the yellow VSC banner is up.
// =========================================================================
// --- VSC: no overtaking -------------------------------------------------
// Cutting everyone's power equally is not enough to freeze the order, because
// a car with a run, a tow, or fresher tyres still closes and goes by. So each
// car meets an invisible wall that travels with the one in front: inside the
// hold distance it simply cannot go quicker than the car ahead, and the last
// stretch is a hard stop it cannot cross at all.
const VSC_HOLD_GAP = 62;      // px of track progress where the wall starts
const VSC_WALL_GAP = 30;      // px it can never get closer than
const VSC_PUSH_MAX = 1.2;     // px/frame the wall gives back: a nudge, not a jump

// Forward speed a car needs before it leaves a slipstream behind it.
const DRAFT_MIN_SPEED = 15;   // stopped or crawling: no wake at all
const DRAFT_FULL_SPEED = 45;  // at or above this: a full wake

// The wake itself: a corridor directly behind the car, a little wider than the
// car at its tail and spreading gently with distance. A car is 24 x 14.
const DRAFT_RANGE = 190;      // how far back the tow reaches, along the road
const WAKE_HALF = 11;         // half-width right behind the gearbox
const WAKE_SPREAD = 0.085;    // how much wider per pixel of distance

// The running order at the moment the VSC came out. Positions are held
// against THIS, not against a fresh sort every frame: re-sorting each frame
// let a pass that completed inside a single frame stick, because by the time
// the hold ran the two cars had already swapped and it dutifully held the new
// order. Freezing the list is also how a real VSC is adjudicated.
let vscOrder = null;

// Which way the circuit runs where this car is standing. Taken from the
// racing line, so it is right whichever way the car itself is pointing.
function trackDirAt(c) {
    if (!track || typeof track.getRacingLine !== 'function') return null;
    const line = track.getRacingLine('standard');
    if (!line || c._nodeIdx === undefined) return null;
    const n = line.nodes[c._nodeIdx];
    if (!n) return null;
    if (isFinite(n.heading)) return { x: Math.cos(n.heading), y: Math.sin(n.heading) };
    if (isFinite(n.tx)) return { x: n.tx, y: n.ty };
    return null;
}

function applyVscHold() {
    if (!vscActive) { vscOrder = null; return; }
    const running = cars.filter(c => !c.finished && !c.isBroken);
    if (running.length < 2) return;

    if (!vscOrder) {
        vscOrder = running.slice()
            .sort((a, b) => (b.trackProgress || 0) - (a.trackProgress || 0))
            .map(c => c.uid);
    }

    // The WALL is applied against whoever is physically ahead right now, not
    // against the frozen list. Holding the frozen order physically was worse:
    // if two cars did briefly swap, it then held the wrong one back and let
    // them separate in the wrong direction. The frozen list governs the
    // CLASSIFICATION instead - which is what the player actually sees, and is
    // guaranteed rather than merely very likely.
    //
    // Ordered by position ROUND THE LAP, not by total distance covered. Under
    // a VSC nobody may be passed at all, and that includes a backmarker you
    // are about to lap: on total distance he sorts a whole lap adrift, so he
    // was never anybody's "car ahead" and the leader drove straight past him.
    // On lap position the pairs are the cars that are actually nose to tail.
    const lapLen = (track && typeof track.getRacingLine === 'function')
        ? track.getRacingLine('standard').length : 1e9;
    const held = running.slice().sort((a, b) => (b.lapS || 0) - (a.lapS || 0));

    for (let i = 0; i < held.length; i++) {
        // wraps: the last car on the lap is chasing the first one round
        const ahead = held[(i - 1 + held.length) % held.length], c = held[i];
        if (ahead === c) continue;
        let gap = (ahead.lapS || 0) - (c.lapS || 0);
        if (gap < 0) gap += lapLen;
        if (gap >= VSC_HOLD_GAP) continue;

        // Everything below works along the TRACK, not along the car's own
        // nose. A car sideways on - mid-spin, or caught out of a slow corner -
        // has a heading that points across the circuit, and holding it back
        // "backwards" then threw it sideways across the tarmac at a
        // thousand pixels a second.
        const t = trackDirAt(c);
        if (!t) continue;

        const fwd = c.velocity.x * t.x + c.velocity.y * t.y;
        const ta = trackDirAt(ahead) || t;
        const aheadFwd = ahead.velocity.x * ta.x + ahead.velocity.y * ta.y;

        // Inside the wall it may not out-run the car ahead; right up against
        // it, it has to give a little back.
        const squeeze = gap <= VSC_WALL_GAP ? 0.92 : 1.0;
        const cap = Math.max(0, aheadFwd * squeeze);
        if (fwd > cap) {
            c.velocity.x -= t.x * (fwd - cap);
            c.velocity.y -= t.y * (fwd - cap);
        }

        // Still inside the wall: ease it back off the car in front. A nudge,
        // capped per frame - the gap is restored over a few tenths instead of
        // in one jump, which is the difference between a car being held up
        // and a car appearing somewhere else.
        if (gap < VSC_WALL_GAP) {
            const back = Math.min(VSC_PUSH_MAX, VSC_WALL_GAP - gap);
            c.x -= t.x * back;
            c.y -= t.y * back;
        }
    }
}

// --- grandstand geometry -------------------------------------------------
// Shared by the wreck's drop point AND the crane's route. The drop point has
// always avoided the crowd; the crane did not, so it drove through the stands
// on its way in and out.
function pointOnStand(track, px, py, pad) {
    const stands = (typeof track.getStands === 'function') ? track.getStands() : [];
    const p = pad === undefined ? 18 : pad;
    for (const st of stands) {
        const dx = px - st.x, dy = py - st.y;
        const ca = Math.cos(-st.angle), sa = Math.sin(-st.angle);
        const u = dx * ca - dy * sa;
        const v = dx * sa + dy * ca;
        if (Math.abs(u) < st.len / 2 + p && Math.abs(v) < st.depth / 2 + p) return true;
    }
    return false;
}

// How much of a straight route lies inside a grandstand, sampled.
function segmentStandHits(track, x1, y1, x2, y2, pad) {
    let hits = 0;
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
        const k = i / STEPS;
        if (pointOnStand(track, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, pad)) hits++;
    }
    return hits;
}

// Last line of defence: shove a point to the nearest edge of any grandstand it
// is inside. Route scoring gets the crane most of the way there, but on a
// layout ringed with stands there is not always a clear line, and a search
// cannot promise "never". This can, because it is applied every frame to the
// position actually drawn.
function nudgeOffStand(track, p, pad) {
    const stands = (typeof track.getStands === 'function') ? track.getStands() : [];
    const m = pad === undefined ? 14 : pad;
    for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        for (const st of stands) {
            const ca = Math.cos(-st.angle), sa = Math.sin(-st.angle);
            const dx = p.x - st.x, dy = p.y - st.y;
            const u = dx * ca - dy * sa;              // into the stand's own frame
            const v = dx * sa + dy * ca;
            const hu = st.len / 2 + m, hv = st.depth / 2 + m;
            if (Math.abs(u) >= hu || Math.abs(v) >= hv) continue;

            // push out of the nearer face
            const outU = hu - Math.abs(u);
            const outV = hv - Math.abs(v);
            let nu = u, nv = v;
            if (outU < outV) nu = (u >= 0 ? hu : -hu);
            else nv = (v >= 0 ? hv : -hv);

            // back to world coordinates
            const cb = Math.cos(st.angle), sb = Math.sin(st.angle);
            p.x = st.x + (nu * cb - nv * sb);
            p.y = st.y + (nu * sb + nv * cb);
            moved = true;
        }
        if (!moved) break;
    }
    return p;
}

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
    const onStand = (px, py, pad) => pointOnStand(track, px, py, pad);
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

            // The crane LEADS the wreck, so during the haul it sits a tow
            // length further out than this spot and finishes there. Scoring
            // only the wreck's resting place left the crane itself parked in
            // the crowd on the tracks that are ringed with stands.
            const ex = px + vx * 34, ey = py + vy * 34;
            if (onStand(ex, ey, 14)) score -= 240;
            score -= segmentStandHits(track, car.x, car.y, ex, ey, 12) * 18;

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
    const pick = { x: car.x + dirx * TOW, y: car.y + diry * TOW };

    // Where the crane waits, and therefore the route it drives in and out on.
    // This used to be a fixed 90px further out along the same line, with no
    // check at all - so on a track ringed with grandstands the crane parked in
    // the crowd and drove straight through it. Search for a spot that is clear
    // itself AND whose straight run to the car does not cross a stand.
    // Where the crane finishes the haul, and therefore where it withdraws from.
    const haulEnd = { x: tx + dirx * TOW, y: ty + diry * TOW };

    // Candidate parking spots: fanned out behind the drop point, plus a set
    // running ALONG the run-off strip either side of it. That strip is
    // stand-free by construction - getStands() rejects any stand that overlaps
    // the circuit - so on a layout boxed in by grandstands there is always a
    // clear way in even when every outward direction is blocked.
    const cand = [];
    for (let a = 0; a < 24; a++) {
        const spin = (a % 2 === 0 ? 1 : -1) * Math.floor(a / 2) * (Math.PI / 8);
        const ca = Math.cos(spin), sa = Math.sin(spin);
        const vx = dirx * ca - diry * sa;
        const vy = dirx * sa + diry * ca;
        for (const back of [55, 70, 90, 115, 145]) {
            cand.push({ x: tx + vx * back, y: ty + vy * back, spin: Math.abs(spin), back: back });
        }
    }
    const tgx = -diry, tgy = dirx;                       // along the track
    for (const side of [1, -1]) {
        for (const along of [60, 95, 135, 180]) {
            for (const out of [track.grassWidth + 26, track.grassWidth + 48]) {
                cand.push({
                    x: proj.projX + nx * out + tgx * side * along,
                    y: proj.projY + ny * out + tgy * side * along,
                    spin: 0.9, back: along
                });
            }
        }
    }

    let hx = null, hy = null, bestHome = -Infinity;
    {
        for (const c of cand) {
            const px = c.x, py = c.y;
            const spin = c.spin, back = c.back;
            if (px < 16 || px > 984 || py < 16 || py > 684) continue;

            let score = 0;
            if (pointOnStand(track, px, py, 22)) score -= 400;       // parked in the crowd
            // both legs it actually drives: in to the wreck, and back out again
            score -= segmentStandHits(track, px, py, pick.x, pick.y, 12) * 40;
            score -= segmentStandHits(track, haulEnd.x, haulEnd.y, px, py, 12) * 40;
            score -= Math.abs(spin) * 6;                             // prefer straight out
            score -= back * 0.06;                                    // prefer close by
            // and it must not be sitting on the racing surface either
            if (track.getClosestPoint(px, py).dist < track.grassWidth) score -= 200;

            if (score > bestHome) { bestHome = score; hx = px; hy = py; }
        }
    }
    if (hx === null) { hx = tx + dirx * 90; hy = ty + diry * 90; }

    const rec = {
        car: car,
        phase: 'approach',
        t: 0,
        from: { x: car.x, y: car.y },
        to: { x: tx, y: ty },
        tow: TOW,
        // where the crane comes from, and where it stands to pick the car up:
        home: { x: hx, y: hy },
        pick: pick,
        crane: { x: hx, y: hy }
    };
    recoveries.push(rec);

    car.recovering = true;
    car.velocity.x = 0;
    car.velocity.y = 0;

    RaceLog.event('WRECK', `${car.driverName || car.color} destroyed at ` +
        `(${Math.round(car.x)}, ${Math.round(car.y)}) — recovery started`);
}

function updateRecovery(dt) {
    // Recovery (and with it the VSC) belongs to races. In qualifying and
    // practice the field is one car and a wreck ends the session, so there is
    // no track to neutralise and no crane to send out.
    if (raceMode !== 'race' && raceMode !== 'championship') return;

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

        }

        // Whatever the route worked out, the crane is never drawn inside a
        // grandstand.
        if (r.phase !== 'done') nudgeOffStand(track, r.crane, 14);

        // ...nor inside another crane. Two wrecks close together used to send
        // two cranes to overlapping spots and they were drawn one on top of
        // the other, which read as one very confused machine.
        if (r.phase !== 'done') {
            for (let k = 0; k < recoveries.length; k++) {
                if (k === i) continue;
                const o = recoveries[k];
                if (!o || o.phase === 'done') continue;
                let dx = r.crane.x - o.crane.x, dy = r.crane.y - o.crane.y;
                let d = Math.hypot(dx, dy);
                if (d >= CRANE_CLEARANCE) continue;
                if (d < 0.001) { dx = 1; dy = 0; d = 1; }   // exactly co-located
                // Push them apart evenly, then keep both off the grandstands:
                // the separation must not be bought by parking in the crowd.
                const push = (CRANE_CLEARANCE - d) / 2;
                r.crane.x += (dx / d) * push;
                r.crane.y += (dy / d) * push;
                o.crane.x -= (dx / d) * push;
                o.crane.y -= (dy / d) * push;
                nudgeOffStand(track, r.crane, 14);
                nudgeOffStand(track, o.crane, 14);
            }
        }

        if (r.phase === 'done') {
            r.car.recovering = false;
            r.car.recovered = true;                 // parked, out of the way
            r.car.liftAmount = 0;
            recoveries.splice(i, 1);
            RaceLog.event('RECOVERY', `${r.car.driverName || r.car.color} removed from the circuit`);
        }
    }

    // 3. VSC follows the recoveries - but it does not end the instant the
    // crane is home. The track being clear starts a 3-second countdown,
    // shown with tenths on the banner: the old instant restart meant you
    // could not know when the power was coming back, and finding out
    // mid-corner with the throttle already open put you in the wall.
    const wanted = recoveries.length > 0;

    if (wanted) {
        // a fresh wreck during the countdown: back to a full VSC
        if (vscEndsAt !== null) {
            vscEndsAt = null;
            renderVscCountdown(null);
            RaceLog.event('VSC', 'ending aborted — new recovery under way');
        }
        if (!vscActive) {
            vscActive = true;
            vscPowerFactor = VSC_POWER;
            showVscBanner(true);
            renderVscCountdown(null);
            RaceLog.event('VSC', `deployed — engine power limited to ${Math.round(VSC_POWER * 100)}%`);
        }
    } else if (vscActive) {
        if (vscEndsAt === null) {
            vscEndsAt = raceNow() + VSC_ENDING_MS;
            RaceLog.event('VSC', `track clear — green flag in ${(VSC_ENDING_MS / 1000).toFixed(1)}s`);
        }
        const left = vscEndsAt - raceNow();
        if (left <= 0) {
            vscActive = false;
            vscEndsAt = null;
            vscPowerFactor = 1;
            showVscBanner(false);
            renderVscCountdown(null);
            RaceLog.event('VSC', 'withdrawn — track clear, full power');
        } else {
            renderVscCountdown(left);
        }
    }
}

// Raise and lower the banner. It lives along the bottom edge, which is also
// where the two-player cards sit, so the cards step up out of its way; and it
// has to come down whenever the race does, or it is left lying across the
// results screen and the menu.
function showVscBanner(on) {
    vscBanner.style.display = on ? 'flex' : 'none';
    const h2 = document.getElementById('hud2');
    if (h2) h2.style.bottom = on ? '52px' : '10px';
    if (!on) renderVscCountdown(null);
}

// The banner's ending clock: seconds and tenths, or back to the normal
// "recovery in progress" line when null.
function renderVscCountdown(leftMs) {
    const count = document.getElementById('vsc-count');
    const sub = document.getElementById('vsc-sub');
    if (!count || !sub) return;
    if (leftMs === null) {
        count.style.display = 'none';
        sub.innerText = 'VIRTUAL SAFETY CAR — RECOVERY IN PROGRESS';
    } else {
        count.style.display = 'block';
        count.innerText = (Math.max(0, leftMs) / 1000).toFixed(1);
        sub.innerText = 'TRACK CLEAR — GREEN FLAG IN';
    }
}

// --- cranes are solid ----------------------------------------------------
// A recovery vehicle sitting on the edge of the circuit is a hazard, not
// scenery. A car that runs into one is stopped by it and damaged, exactly as
// by a barrier: leaning on it costs little, spearing it costs a lot.
function applyCraneCollisions() {
    if (!recoveries.length) return;
    for (const c of cars) {
        if (c.finished || c.isBroken) continue;
        for (const r of recoveries) {
            if (r.phase === 'done') continue;
            const dx = c.x - r.crane.x, dy = c.y - r.crane.y;
            const d = Math.hypot(dx, dy);
            const minD = CRANE_RADIUS + 12;          // 12 = the car's own radius
            if (d >= minD || d < 0.001) continue;

            const nx = dx / d, ny = dy / d;
            // push clear
            c.x = r.crane.x + nx * minD;
            c.y = r.crane.y + ny * minD;

            // kill the component of velocity going INTO the crane, and take
            // the damage from it. Same shape as the barrier rule, so brushing
            // one is survivable and driving into it head-on is not.
            const into = -(c.velocity.x * nx + c.velocity.y * ny);
            if (into > 0) {
                c.velocity.x += nx * into * 1.35;     // stop, plus a little bounce
                c.velocity.y += ny * into * 1.35;
                const hit = Math.max(0, into - 30) * 0.10;
                if (hit > 0 && typeof c.takeDamage === 'function') {
                    c.takeDamage(hit * hit * 0.5);
                    if (!c._craneLogged || raceNow() - c._craneLogged > 2000) {
                        c._craneLogged = raceNow();
                        RaceLog.event('CONTACT', `${c.driverName || c.color} hit a recovery ` +
                            `vehicle (closing ${into.toFixed(0)} px/s)`);
                    }
                }
            }
        }
    }
}

// Where the AI should not go. ai.js reads this through the global.
function craneObstacles() {
    const out = [];
    for (const r of recoveries) {
        if (r.phase === 'done') continue;
        out.push({ x: r.crane.x, y: r.crane.y, r: CRANE_RADIUS });
    }
    return out;
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
    hideSplitHud();
    showVscBanner(false);   // never leave it lying over a menu
    timingTower.style.display = 'none';
    stopSessionBtn.style.display = 'none';
    if (isMobile) mobileControls.style.display = 'none';
    if (typeof stopAudio === 'function') stopAudio();

    // Every lap either driver set, each judged against their own best.
    const rows = [];
    let laps = [], best = null;
    for (const c of humanCars()) {
        const ls = c.lapTimes || [];
        const b = ls.length ? Math.min(...ls) : null;
        if (c === playerCar) { laps = ls; best = b; }
        ls.forEach((ms, i) => rows.push({
            name: (twoPlayer ? humanLabel(c) + ' ' : '') + `Lap ${i + 1}`,
            laps: 1,
            time: (ms / 1000).toFixed(3),
            best: ms === b ? 'BEST' : '',
            note: ''
        }));
    }

    RaceLog.event('SESSION', `practice stopped after ${rows.length} timed laps` +
        (best ? `, best ${(best / 1000).toFixed(3)}` : ''));
    RaceLog.end(rows);

    document.getElementById('result-message').innerText = 'Practice Session';
    resultMessage.style.color = '#26a69a';

    restartBtn.style.display = 'inline-block';
    nextRoundBtn.style.display = 'none';
    gameOverScreen.style.display = 'block';

    statsBody.innerHTML = '';
    if (!laps.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="9" style="padding: 14px; opacity: 0.7;">No completed laps.</td>`;
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
            <td>-</td>
            <td style="color: ${isBest ? '#4CAF50' : '#fff'};">${(ms / 1000).toFixed(3)}</td>
            <td style="color: #4CAF50;">${(best / 1000).toFixed(3)}</td>
            <td>${isBest ? '-' : delta}</td>
            <td>-</td>
            <td>-</td>
        `;
        statsBody.appendChild(tr);
    });
}

function updateHUD() {
    const dnfTimerDiv = document.getElementById('dnf-timer');
    if (firstFinisherTime && !raceFinished) {
        const timeLeft = Math.max(0, dnfWindowMs / 1000 - (raceNow() - firstFinisherTime) / 1000);
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

    // With two drivers the side panel cannot speak for either of them: the
    // per-driver readouts move to the two cards along the bottom, and the
    // whole panel goes away rather than sitting there as an empty box.
    const sideHud = document.getElementById('side-hud');
    if (twoPlayer) {
        if (sideHud) sideHud.style.display = 'none';
        lapCounter.innerText = '';
        posCounter.innerText = '';
        speedometer.innerText = '';
        const lt2 = document.getElementById('lap-timer');
        if (lt2) lt2.innerHTML = '';
        const ti2 = document.getElementById('tyre-indicator');
        if (ti2) ti2.innerHTML = '';
    } else if (sideHud) {
        sideHud.style.display = 'flex';
    }

    // Lap
    if (playerCar && !twoPlayer) {
        renderTyreIndicator(playerCar);
        if (raceMode === 'practice') {
            lapCounter.innerText = `Practice — lap ${playerCar.lap + 1}`;
        } else if (raceMode === 'qualifying') {
            lapCounter.innerText = playerCar.lap === 0
                ? 'Qualifying — warm-up lap'
                : `Qualifying — flying lap ${playerCar.lap}/${QUALI_LAPS - 1}`;
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

            // Three lines, biggest first: the live lap, then last, then best.
            // In a race you get half a glance at this - it has to land at
            // half a glance.
            lapTimerDiv.innerHTML =
                `<div class="lt-cur" style="color:${colour};">${fmt(current)}</div>` +
                `<div class="lt-sub">L&nbsp; ${lastStr}</div>` +
                `<div class="lt-sub lt-best">B&nbsp; ${fmt(playerCar.bestLapTime)}</div>`;
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
            if (a.raceTime !== b.raceTime) return a.raceTime - b.raceTime;
            // Dead heat to the millisecond: whoever crossed the line first.
            return (a.finishIndex || 0) - (b.finishIndex || 0);
        }
        // If only one finished, it's ahead
        if (a.finished) return -1;
        if (b.finished) return 1;
        
        // Otherwise sort by distance actually covered. trackProgress is the
        // monotone odometer, continuous and already cumulative across laps.
        //
        // It used to be lap -> waypointProgress -> distance to the next
        // waypoint, and both of those tie-breaks are step functions:
        // waypointProgress ticks when a car comes within 200px of a waypoint,
        // so two cars running side by side crossed that line a frame apart and
        // swapped, and the distance term flips again as they pass it. The
        // order was correct on average and jittering several times a second.
        // Under the VSC the order is held, so the classification reads from
        // the frozen list rather than from distance covered.
        if (vscActive && vscOrder) {
            const ia = vscOrder.indexOf(a.uid), ib = vscOrder.indexOf(b.uid);
            if (ia !== -1 && ib !== -1 && ia !== ib) return ia - ib;
        }
        const pa = a.trackProgress || 0, pb = b.trackProgress || 0;
        if (pa !== pb) return pb - pa;
        return (a.gridIndex || 0) - (b.gridIndex || 0);   // stable at lights-out
    });

    // ---- lap leaders -------------------------------------------------
    // Each time the leader completes another lap, record who it was. A driver
    // whose colour fills this array led every lap of the race.
    if (raceMode === 'race' || raceMode === 'championship') {
        const ldr = sortedCars[0];
        if (ldr && ldr.lap > lapLeaders.length) lapLeaders.push(ldr.color);
    }

    // ---- live timing tower ------------------------------------------
    // Gap to the car in front, in seconds. trackProgress is real distance
    // round the circuit, so the gap is that distance divided by the pace of
    // the car behind. A car more than a lap down is shown as laps, not time -
    // a time gap to someone you have already lapped is meaningless.
    if (raceMode === 'qualifying') {
        renderQualiTower();
    } else if (raceMode !== 'practice' && timingTower.style.display !== 'none') {
        const lapLen = track.getRacingLine ? track.getRacingLine('standard').length : 1;
        const rows = [];
        // Displayed order is the settled one, not the raw sort - see
        // stableTowerOrder. Classification and points still use sortedCars.
        const shown = stableTowerOrder(sortedCars);

        for (let i = 0; i < shown.length; i++) {
            const c = shown[i];

            // smoothed pace, so the gap doesn't jitter under braking
            const sp = Math.hypot(c.velocity.x, c.velocity.y);
            c._paceAvg = c._paceAvg === undefined ? sp : c._paceAvg + (sp - c._paceAvg) * 0.02;

            let gap;
            if (gameState === 'countdown') {
                // The grid is an order, not a set of gaps: nobody is any
                // number of seconds behind anybody until the lights go out.
                gap = i === 0 ? 'GRID' : '—';
            } else if (c.isBroken && !c.finished) {
                gap = c.recovered || c.recovering ? 'OUT' : 'DNF';
            } else if (i === 0) {
                gap = c.finished ? 'FIN' : 'LEADER';
            } else {
                const ahead = shown[i - 1];
                const behind = Math.max(0, (ahead.trackProgress || 0) - (c.trackProgress || 0));
                const lapsDown = Math.floor(behind / lapLen);
                if (lapsDown >= 1) {
                    gap = `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
                } else {
                    const pace = Math.max(60, c._paceAvg || 60);
                    gap = `+${(behind / pace).toFixed(1)}`;
                }
            }

            const name = driverCode(c);
            // Compound alongside the name: you can see at a glance who is on
            // what, which is the whole point of having a choice.
            const tw = c.tyre ? Math.max(0, Math.min(1, 1 - (c.tyreWear || 0))) : 1;
            const tyrePip = c.tyre
                ? `<span class="tt-tyre" style="background:${c.tyre.colour};` +
                  `opacity:${(0.35 + 0.65 * tw).toFixed(2)};" title="${c.tyre.label}">` +
                  `${c.tyre.short}</span>`
                : '<span class="tt-tyre" style="opacity:0;">-</span>';
            rows.push(
                `<div class="tt-row${c.isPlayer ? ' me' : ''}">` +
                `<span class="tt-pos">${i + 1}</span>` +
                `<span class="tt-chip" style="background:${c.color};"></span>` +
                `<span class="tt-name"${(c.isBroken && !c.finished) ? ' style="opacity:.45;"' : ''}>${name}</span>` +
                tyrePip +
                `<span class="tt-gap">${gap}</span>` +
                `</div>`);
        }
        timingTower.innerHTML = rows.join('');
    }

    renderSplitHud(sortedCars);

    const pos = playerCar ? sortedCars.indexOf(playerCar) + 1 : "-";
    if (playerCar && !twoPlayer) {
        if (raceMode === 'practice') {
            posCounter.innerText = '';
        } else if (raceMode === 'qualifying') {
            const qpos = qualiOrder().findIndex(r => r.p && r.p.isPlayer) + 1;
            posCounter.innerText = qpos > 0 ? `Provisional: P${qpos}` : '';
        } else {
            posCounter.innerText = `Pos: ${pos}/${cars.length}`;
        }
    } else if (!playerCar && (raceMode === 'race' || raceMode === 'championship')) {
        // Spectating: there is no car of yours to report, so the HUD follows
        // the race instead - which lap the leader is on, and who it is.
        // Two-player is NOT this case - both drivers have their own card.
        const ldr = sortedCars[0];
        if (ldr) {
            renderTyreIndicator(ldr);
            const lap = Math.min(ldr.lap + (ldr.finished ? 0 : 1), TOTAL_LAPS);
            lapCounter.innerText = `Lap: ${lap}/${TOTAL_LAPS}`;
            posCounter.innerText = `Leader: ${driverCode(ldr)}`;
        }
    }

    // Check win condition for the leader.
    // Use the recorded first finisher, never sortedCars[0].
    const firstFinisher = cars.find(c => c.finishIndex === 0);
    if (!leaderFinished && firstFinisher) {
        leaderFinished = true;
        firstFinisherTime = raceNow();
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
        if (firstFinisher.isPlayer) {
            winnerText.innerHTML = twoPlayer
                ? `${humanLabel(firstFinisher)} Finished First!` : 'You Finished First!';
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
    
    for (const hc of humanCars()) {
        if (hc.isBroken && !hc.notifiedBroken &&
            (raceMode === 'race' || raceMode === 'championship')) {
            hc.notifiedBroken = true;
            winnerAnnouncement.style.display = 'block';
            winnerAnnouncement.style.backgroundColor = 'rgba(0,0,0,0.8)';
            winnerText.innerHTML = twoPlayer
                ? `${humanLabel(hc)} — Car Destroyed!` : 'Car Destroyed!';
            winnerText.style.color = "#F44336";
            setTimeout(() => {
                winnerAnnouncement.style.display = 'none';
            }, 4000);
        }
    }

    // Everything below is RACE-END machinery, and it only applies to a race.
    // In qualifying the field is a single car - the player - so the moment
    // they wrecked, "every car is finished or broken" was true and the full
    // race-over path ran: "No one finished!", the round recorded with no
    // points, currentTrackIndex advanced. The championship literally skipped
    // a Grand Prix because of a qualifying crash. Sessions end through
    // endQualifying / endPracticeSession, never through here.
    if (raceMode !== 'race' && raceMode !== 'championship') return;

    // Handle 20s DNF timer
    let timeIsUp = false;
    if (firstFinisherTime && (raceNow() - firstFinisherTime > dnfWindowMs)) {
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
    // Once every car is classified the race is over, full stop. Spectator mode
    // used to sit and watch the DNF clock run down after the last car had
    // already crossed the line.
    const shouldEndRace = timeIsUp || allFinished;

    if (shouldEndRace && !raceFinished) {
        raceFinished = true;
        gameState = 'gameover';
        hud.style.display = 'none';
        hideSplitHud();
        showVscBanner(false);   // never leave it lying over a menu
        document.getElementById('skip-overlay').style.display = 'none';
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
        if (twoPlayer && humanCars().length) {
            // Two people raced: the headline is how they finished against each
            // other, in the order they crossed the line.
            headerText = humanCars()
                .slice()
                .sort((a, b) => sortedCars.indexOf(a) - sortedCars.indexOf(b))
                .map(c => `${humanLabel(c)} P${sortedCars.indexOf(c) + 1}`)
                .join('  ·  ');
        } else if (playerCar) {
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
            if (twoPlayer && humanCars().length) {
                // Keep the head-to-head as the headline, and colour it by
                // whether a person won the race outright.
                resultMessage.innerText = headerText;
                resultMessage.style.color =
                    sortedCars[0].isPlayer ? '#4CAF50' : '#fff';
            } else if (sortedCars[0] === playerCar) {
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

        if (skipMode) {
            const winner = sortedCars[0];
            const who = winner.driverName ? `${winner.driverName} (${winner.color})` : winner.color;
            resultMessage.innerText = `Grand Prix skipped — ${who} wins`;
            resultMessage.style.color = '#90a4ae';
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

        // Fastest lap of the race
        let fastestCar = null;
        for (const c of cars) {
            if (c.bestLapTime && (!fastestCar || c.bestLapTime < fastestCar.bestLapTime)) fastestCar = c;
        }
        if (fastestCar) {
            RaceLog.event('FASTLAP', `${fastestCar.driverName || fastestCar.color} — ` +
                `${RaceLog.fmt(fastestCar.bestLapTime)}`);
        }

        // ---- Grand Chelem ------------------------------------------------
        // Pole, win, fastest lap and every single lap led. All four, one race.
        const winnerCar = sortedCars[0];
        const ledEvery = lapLeaders.length >= TOTAL_LAPS && winnerCar &&
                         lapLeaders.every(col => col === winnerCar.color);
        const grandChelem = !!(winnerCar && winnerCar.finished &&
            racePoleColor === winnerCar.color &&
            fastestCar === winnerCar &&
            ledEvery);
        if (grandChelem) {
            RaceLog.event('CHELEM', `${winnerCar.driverName || winnerCar.color} — GRAND CHELEM ` +
                `(pole, win, fastest lap, led all ${TOTAL_LAPS} laps)`);
        }

        // Work out points BEFORE the season record is written: it used to be
        // built first, so every bonus it stored was undefined.
        if (isChampionship) {
            sortedCars.forEach((c, index) => {
                let pts = 0, bon = 0;
                if (c.finished) {
                    pts = f1Points[index] || 0;
                    const gained = Math.max(0, (c.startGridPos || (index + 1)) - (index + 1));
                    bon = Math.min(PLACES_BONUS_CAP, gained * PLACES_BONUS_PER);
                }
                c._ptsEarned = pts;
                c._bonusEarned = bon;
            });
        }

        // Season record: one row per race, kept for the end-of-championship recap
        if (isChampionship) {
            championshipState.results = championshipState.results || [];
            championshipState.results.push({
                track: championshipState.tracks[championshipState.currentTrackIndex] || '?',
                wet: isRaining,
                fastest: fastestCar ? fastestCar.color : null,
                pole: racePoleColor,
                chelem: grandChelem ? winnerCar.color : null,
                order: sortedCars.map((c, i) => ({
                    color: c.color,
                    code: driverCode(c),
                    name: c.driverName || c.color,
                    pos: i + 1,
                    pts: c.finished ? (f1Points[i] || 0) : 0,
                    bonus: c._bonusEarned || 0,
                    tyre: c.tyre ? c.tyre.key : null,
                    dnf: c.isBroken && !c.finished
                })).concat(skipMode ? skipPlayers.map(sp => ({
                    // you sat this one out: classified DNS, no points
                    color: sp.color,
                    code: participantCode(sp),
                    name: sp.driverName || sp.color,
                    pos: null, pts: 0, dnf: false, dns: true
                })) : [])
            });
        }

        // Populate stats table
        statsBody.innerHTML = '';
        sortedCars.forEach((c, index) => {
            const tr = document.createElement('tr');
            
            // Assign Championship Points
            // Places gained: one point per position recovered from the grid,
            // capped at 5. Deliberately generous next to the scoring tail -
            // P8 is worth 4 - so a hard drive from the back is worth about as
            // much as a quiet run in the top ten. That is the point.
            const ptsEarned = c._ptsEarned || 0;
            const bonusEarned = c._bonusEarned || 0;
            if (isChampionship && c.finished) {
                championshipState.points[c.color] += ptsEarned;
                if (bonusEarned > 0) {
                    championshipState.bonusPoints[c.color] =
                        (championshipState.bonusPoints[c.color] || 0) + bonusEarned;
                    championshipState.points[c.color] += bonusEarned;
                    const gained = Math.max(0, (c.startGridPos || (index + 1)) - (index + 1));
                    RaceLog.event('BONUS', `${c.driverName || c.color} — +${bonusEarned} for ` +
                        `${gained} place${gained > 1 ? 's' : ''} gained ` +
                        `(P${c.startGridPos} to P${index + 1})`);
                }
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
            const isFastest = fastestCar === c;
            const bestLapStr = (c.bestLapTime !== null && c.bestLapTime !== undefined && c.bestLapTime < Infinity)
                ? (formatTime(c.bestLapTime) + (isFastest ? ' &#9733;' : '')) : '-';

            const nameDisplay = c.driverName ? `${c.driverName} (${c.color})` : `${c.color} ${c.isPlayer ? '(You)' : ''}`;

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td style="color: ${c.color}; font-weight: bold; text-transform: capitalize;">${nameDisplay}</td>
                <td>${c.tyre ? `<span class="tyre-pip" style="background:${c.tyre.colour};" title="${c.tyre.label}"></span>${c.tyre.short}` : '-'}</td>
                <td${isLapped || isDNF ? ' style="opacity: 0.55;"' : ''}>${lapsStr}</td>
                <td${dim}>${timeStr}</td>
                <td style="color: ${isFastest ? '#ce93d8' : '#4CAF50'}; font-weight: ${isFastest ? 'bold' : 'normal'};">${bestLapStr}</td>
                <td>${gapStr}</td>
                <td>${isChampionship ? (ptsEarned || 0) : '-'}</td>
                <td class="pts-bonus"${bonusEarned > 0 ? ` title="${Math.max(0, (c.startGridPos || (index + 1)) - (index + 1))} places gained: P${c.startGridPos} to P${index + 1}"` : ''}>${isChampionship && bonusEarned > 0 ? '+' + bonusEarned : (isChampionship ? '&mdash;' : '-')}</td>
            `;
            statsBody.appendChild(tr);
        });
        
        // You skipped this one: show yourself at the bottom of the sheet as
        // DNS rather than silently omitting you from your own championship.
        if (skipMode) {
            for (const sp of skipPlayers) {
                const tr = document.createElement('tr');
                tr.style.opacity = '0.6';
                const who = twoPlayer ? (sp.driverName || 'Player') : 'You';
                tr.innerHTML = `
                    <td>&ndash;</td>
                    <td style="color: ${sp.color}; font-weight: bold;">${who} (${sp.color})</td>
                    <td>-</td>
                    <td>0</td>
                    <td>DNS</td>
                    <td>-</td>
                    <td>DNS</td>
                    <td>0</td>
                    <td class="pts-bonus">&mdash;</td>
                `;
                statsBody.appendChild(tr);
            }
        }

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
                
                const b = (championshipState.bonusPoints || {})[col] || 0;
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td style="color: ${col}; font-weight: bold;">${nameDisplay}</td>
                    <td>${championshipState.points[col] - b}</td>
                    <td class="pts-bonus">${b > 0 ? '+' + b : '&mdash;'}</td>
                    <td><b>${championshipState.points[col]}</b></td>
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

    // Paused: stop requesting frames and leave the last rendered frame on the
    // canvas. setPaused(false) restarts the loop.
    if (isPaused) return;

    const framePrev = lastTime;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    // A hidden tab stops requestAnimationFrame; it does not stop the clock.
    // Come back after half a minute in another window and the next frame
    // arrives with dt = 36. updatePhysics clamps that to 50ms, so almost no
    // racing happens - but raceStartTime, firstFinisherTime and vscEndsAt are
    // wall-clock anchors, so as far as they are concerned 36 seconds of race
    // went by. In one frame the whole DNF window was gone and ten cars, all
    // within six seconds of the flag, were classified "outside the time limit"
    // without turning a wheel.
    //
    // So a lost frame is treated exactly like a pause: the anchors are shifted
    // forward by the time nobody raced through. Anything under a quarter of a
    // second is a slow frame, not a stall, and is left alone.
    if (dt > STALL_S) {
        const lost = (timestamp - framePrev) - 1000 / 60;
        if (lost > 0) {
            raceStartTime += lost;
            if (firstFinisherTime) firstFinisherTime += lost;
            if (vscEndsAt !== null) vscEndsAt += lost;
        }
        dt = 1 / 60;
    }


    // ---- skipped Grand Prix: fast-forward the real race -----------------
    // The AI still races for real. Rather than reimplement the race headlessly
    // (and risk it diverging from the one you actually drive), the genuine
    // loop is run as fast as the frame budget allows with the drawing skipped.
    // Damage, VSC, blue flags, points and the results screen are therefore
    // exactly the same code that runs when you are on track.
    //
    // This has to sit ABOVE the countdown branch: that branch returns, so with
    // the check below it the start lights played out in real time (five or six
    // seconds of watching an empty screen) before the fast-forward began.
    if (skipMode && (gameState === 'playing' || gameState === 'countdown')) {
        // Two brakes on the inner loop: a wall-clock budget so the tab stays
        // responsive, and a hard step cap so a clock that does not advance
        // (or a very fast machine) can never turn this into a freeze.
        const budgetEnd = performance.now() + 24;
        const fixed = 1 / 60;
        let steps = 0;
        while (steps++ < 600 && performance.now() < budgetEnd && gameState !== 'gameover') {
            skipClock += fixed * 1000;
            if (gameState === 'countdown') {
                // no start procedure to watch: release the field immediately
                countdownTimer = goDelay;
                lightState = 6;
                gameState = 'playing';
                raceStartTime = skipClock;
                ais.forEach(ai => ai.startRace());
                continue;
            }
            countdownTimer += fixed;
            track.leaderFinished = leaderFinished;
            track.currentRaceTime = skipClock - raceStartTime;
            skipNow = skipClock;              // updateHUD reads this for the DNF window
            updatePhysics(fixed);
            updateHUD();
        }
        if (gameState !== 'gameover') {
            const done = cars.filter(c => c.finished || c.isBroken).length;
            document.getElementById('skip-progress').innerText =
                `Simulating the race… ${done}/${cars.length} classified`;
            requestAnimationFrame(gameLoop);
        }
        return;
    }

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
        applyHumanInputs();


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
                    ? humanLabel(car)
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
                        c.lapS = 0;
                        c._lastS = undefined;
                        c._lastDist = undefined;
                        c._lapAnchored = undefined;   // re-anchor on the new grid
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

                    // The tower is live on the grid now, and its hysteresis
                    // would keep the order a jumped start briefly produced.
                    // Rebuild from the reformed grid.
                    towerOrder = [];
                    
                    globalSkidMarks = [];
                    globalParticles = [];
                    lapLeaders = [];   // the aborted start never happened
                }, 1200);
            }
            
            // The moment a false start is called, everything stops dead.
            // Previously the cars kept running for the whole length of the
            // banner, so the offender (and anyone else already rolling, the
            // player included, who is still holding the throttle) slid a long
            // way down the circuit before the grid was reset.
            if (isFalseStartResetting) {
                car.velocity.x = 0;
                car.velocity.y = 0;
                car.inputs.up = false;
                car.inputs.down = false;
                car.inputs.left = false;
                car.inputs.right = false;
            } else if (car.inputs.up || Math.abs(car.velocity.x) > 0 || Math.abs(car.velocity.y) > 0) {
                car.update(dt, track);
            }
        });
        
        // The HUD runs from the moment the grid forms, not from lights-out:
        // the tower with everyone's compound, your grid slot, the side panel.
        // Nothing in it depends on the race having started - the cars simply
        // have not moved yet.
        updateHUD();

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
        
        // One engine per driver at the keyboard, each following its own car.
        if (typeof updateEngineSound === 'function') {
            humanCars().forEach((c, i) => {
                const speed = Math.sqrt(c.velocity.x ** 2 + c.velocity.y ** 2);
                updateEngineSound(speed, c.inputs.up, i);
            });
        }
        
        requestAnimationFrame(gameLoop);
        return;
    }
    
    if (gameState === 'playing') {
        countdownTimer += dt;

        // Track each human's reaction time on their first input
        for (const c of humanCars()) {
            const k = seatKeys(c);
            if (!c.inputRecorded && (k.up || k.down || k.left || k.right)) {
                c.reactionTime = (performance.now() - raceStartTime) / 1000;
                c.inputRecorded = true;
            }
        }
        
        track.leaderFinished = leaderFinished;
        track.currentRaceTime = performance.now() - raceStartTime;

        // One opponent's qualifying lap per frame. Simulating all ten at once
        // would freeze for a few hundred milliseconds; spread across frames it
        // disappears behind the player's own out lap, and the times appear in
        // the tower one by one the way a real session fills up.
        // dt < 0.05 = the previous frame was healthy. If the machine is
        // already struggling the queue simply waits; endQualifying() flushes
        // whatever is left before the grid is set, so nobody is ever missed.
        if (raceMode === 'qualifying' && dt < 0.05) qualiTick();

        // Warm-up lap plus two flying laps and a driver's session is over - or
        // the car is wrecked, in which case they keep whatever time they had
        // set (no time at all = back of the grid). With two on track the
        // session runs until BOTH are done; whoever finishes first parks.
        if (raceMode === 'qualifying' && humanCars().length) {
            for (const c of humanCars()) {
                if (c.qualiDone) continue;
                if (c.lap >= QUALI_LAPS || c.isBroken) {
                    c.qualiDone = true;
                    c.qualiFinalTime = c.bestLapTime;
                    if (c.isBroken) {
                        RaceLog.event('WRECK', `${humanLabel(c)} destroyed the car in ` +
                            'qualifying — session over');
                    }
                }
            }
            if (humanCars().every(c => c.qualiDone)) {
                endQualifying();
                return;
            }
        }

        // A wreck in free practice ends that session the same way.
        if (raceMode === 'practice' && humanCars().length &&
            humanCars().every(c => c.isBroken)) {
            RaceLog.event('WRECK', 'the car was destroyed in practice — session over');
            endPracticeSession();
            return;
        }

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
        
        // Hide lights after 1.5s of GO. Qualifying has no start procedure at
        // all - you roll out of the pits - so it must not draw the gantry:
        // countdownTimer starts at 0 there and the test passed, leaving a box
        // of five dead lights sitting over the track for the whole session.
        if (raceMode !== 'qualifying' && countdownTimer < goDelay + 1.5) {
            drawLights(ctx);
        }
        
        // One engine per driver at the keyboard, each following its own car.
        if (typeof updateEngineSound === 'function') {
            humanCars().forEach((c, i) => {
                const speed = Math.sqrt(c.velocity.x ** 2 + c.velocity.y ** 2);
                updateEngineSound(speed, c.inputs.up, i);
            });
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
    let aiColors = possibleColors.filter(c => c !== color);

    // Fixed for the whole season: the field is built once and every round
    // races the same drivers.
    twoPlayer = twoPlayerEnabled() && color !== 'spectator';

    // Every circuit, in a different order every season. A fixed calendar meant
    // you learned the season rather than the tracks: the same opener, the same
    // decider, every time.
    const tracks = ['oval', 'peanut', 'f1', 'circomassimo', 'circle', 'serpent',
                    'quadrato', 'triangle', 'pettine', 'thunder', 'crown'];
    for (let i = tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }

    // The season's weather is rolled once, up front, at the same 20% per race
    // as before - but a season with no wet race at all is rerolled. At 20% a
    // ten-race season came out completely dry about one time in nine, which is
    // how you can play a whole championship and never see the rain.
    // Rolled AFTER the shuffle, so weather[i] belongs to round i.
    const weather = tracks.map(() => Math.random() < 0.20);
    if (!weather.some(Boolean)) weather[Math.floor(Math.random() * weather.length)] = true;

    championshipState = {
        tracks: tracks,
        weather: weather,
        currentTrackIndex: 0,
        points: {},
        bonusPoints: {},          // places-gained, tracked apart from race points
        participants: [],
        results: [],
        difficulty: difficulty
    };

    // Famous names list
    let availableNames = ['Ayrton Senna', 'Michael Schumacher', 'Lewis Hamilton', 'Juan Manuel Fangio', 'Alain Prost', 'Jim Clark', 'Max Verstappen', 'Niki Lauda', 'Fernando Alonso', 'Sebastian Vettel'];
    // Shuffle names
    availableNames.sort(() => Math.random() - 0.5);
    
    // Initialize points and persistent AI modifiers
    if (color === 'spectator') {
        // capped at the number of distinct drivers - see buildField()
        const totalAIsToSpawn = Math.min(numOpponents + 1, availableNames.length);
        for (let i = 0; i < totalAIsToSpawn; i++) {
            let aiCol = possibleColors[i % possibleColors.length];
            let name = availableNames[i % availableNames.length];
            championshipState.participants.push({ isPlayer: false, color: aiCol, skillVariation: 0.8 + (Math.random() * 0.3), driverName: name });
            championshipState.points[aiCol] = 0;
            championshipState.bonusPoints[aiCol] = 0;
        }
    } else {
        for (const seat of humanSeats()) {
            championshipState.participants.push(seat);
            championshipState.points[seat.color] = 0;
            championshipState.bonusPoints[seat.color] = 0;
            aiColors = aiColors.filter(c => c !== seat.color);
        }

        for (let i = 0; i < numOpponents; i++) {
            let aiCol = aiColors[i % aiColors.length];
            let name = availableNames[i % availableNames.length];
            championshipState.participants.push({ isPlayer: false, color: aiCol, skillVariation: 0.8 + (Math.random() * 0.3), driverName: name });
            championshipState.points[aiCol] = 0;
            championshipState.bonusPoints[aiCol] = 0;
        }
    }
    
    nextChampionshipRound();
}

// Weather for the round about to be run, from the pre-rolled season.
function nextChampionshipWeather() {
    if (!championshipState || !championshipState.weather) return Math.random() < 0.20;
    const w = championshipState.weather[championshipState.currentTrackIndex];
    return w === undefined ? (Math.random() < 0.20) : w;
}

function nextChampionshipRound() {
    if (championshipState.currentTrackIndex >= championshipState.tracks.length) {
        showChampionshipFinal();
        return;
    }
    // Every round opens on the Grand Prix preview; the session starts (or the
    // whole round is skipped) from its buttons.
    showGpPreview(championshipState.tracks[championshipState.currentTrackIndex]);
}

function showChampionshipFinal() {
    hud.style.display = 'none';
    hideSplitHud();
    showVscBanner(false);   // never leave it lying over a menu
    if (isMobile) mobileControls.style.display = 'none';
    champFinalScreen.style.display = 'block';
    
    const sortedColors = Object.keys(championshipState.points).sort((a, b) => championshipState.points[b] - championshipState.points[a]);

    // Grand Chelems per driver across the season.
    const chelems = {};
    for (const r of (championshipState.results || [])) {
        if (r.chelem) chelems[r.chelem] = (chelems[r.chelem] || 0) + 1;
    }
    const anyChelem = Object.keys(chelems).length > 0;

    champStatsBody.innerHTML = '';
    sortedColors.forEach((color, idx) => {
        const tr = document.createElement('tr');
        if (idx === 0) tr.style.color = 'gold';
        else if (idx === 1) tr.style.color = 'silver';
        else if (idx === 2) tr.style.color = '#cd7f32'; // bronze

        const participant = championshipState.participants.find(p => p.color === color);
        const nameDisplay = participant && participant.driverName ? `${participant.driverName} (${color})` : color;

        const n = chelems[color] || 0;
        const star = n
            ? `<span class="gc-star" title="Grand Chelem: pole, win, fastest lap and led every lap` +
              `${n > 1 ? ` — ${n} times` : ''}">${'★'.repeat(Math.min(n, 3))}` +
              `${n > 3 ? `&times;${n}` : ''}</span>`
            : '';

        const bonus = (championshipState.bonusPoints || {})[color] || 0;
        const racePts = championshipState.points[color] - bonus;
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td style="color: ${color}; font-weight: bold;">${nameDisplay}${star}</td>
            <td>${racePts}</td>
            <td class="pts-bonus">${bonus > 0 ? '+' + bonus : '&mdash;'}</td>
            <td><b>${championshipState.points[color]}</b></td>
        `;
        champStatsBody.appendChild(tr);
    });

    const legend = document.getElementById('champ-legend');
    if (legend) {
        legend.innerHTML = anyChelem
            ? '<span class="gc-star">★</span> Grand Chelem &mdash; pole, win, fastest lap and every lap led'
            : '';
    }

    renderSeasonRecap();
}

// Full season grid: every driver, every race, with the fastest lap starred.
function renderSeasonRecap() {
    const host = document.getElementById('season-recap');
    if (!host) return;

    const races = championshipState.results || [];
    if (!races.length) { host.innerHTML = ''; return; }

    const order = Object.keys(championshipState.points)
        .sort((a, b) => championshipState.points[b] - championshipState.points[a]);

    const short = (t) => (t || '?').slice(0, 3).toUpperCase();

    let html = '<h2 style="margin:18px 0 8px;">Season Results</h2>' +
        '<div style="overflow-x:auto;"><table class="season-table"><thead><tr>' +
        '<th style="text-align:left;">Driver</th>';
    races.forEach(r => {
        html += `<th title="${r.track}${r.wet ? ' (wet)' : ''}">${short(r.track)}` +
                (r.wet ? '<span style="color:#64b5f6;">&#9730;</span>' : '') + '</th>';
    });
    html += '<th>Pts</th></tr></thead><tbody>';

    for (const color of order) {
        const p = championshipState.participants.find(x => x.color === color);
        const label = p ? participantCode(p) : color.slice(0, 3).toUpperCase();
        html += `<tr><td style="text-align:left;white-space:nowrap;">` +
                `<span class="tt-chip" style="background:${color};display:inline-block;vertical-align:middle;margin-right:6px;"></span>` +
                `<b style="color:${color};">${label}</b></td>`;

        for (const r of races) {
            const e = r.order.find(o => o.color === color);
            if (!e) { html += '<td class="sr-none">&ndash;</td>'; continue; }
            if (e.dns) { html += '<td class="sr-dns">DNS</td>'; continue; }
            const cls = e.dnf ? 'sr-dnf' : (e.pos === 1 ? 'sr-win' : (e.pos <= 3 ? 'sr-pod' : ''));
            const txt = e.dnf ? 'DNF' : e.pos;
            // Small superscripts beside the result: P for pole, F for fastest
            // lap, and a star when the two came with the win and every lap led.
            let marks = '';
            if (r.chelem === color) {
                marks = '<sup class="gc-star" title="Grand Chelem">★</sup>';
            } else {
                if (r.pole === color) marks += '<sup class="sr-pole" title="pole position">P</sup>';
                if (r.fastest === color) marks += '<sup class="sr-fl" title="fastest lap">F</sup>';
            }
            html += `<td class="${cls}">${txt}${marks}</td>`;
        }
        html += `<td><b>${championshipState.points[color]}</b></td></tr>`;
    }
    html += '</tbody></table></div>' +
        '<div style="font-size:11px;opacity:0.65;margin-top:6px;">' +
        '<sup class="sr-pole">P</sup> pole &nbsp;·&nbsp; <sup class="sr-fl">F</sup> fastest lap' +
        ' &nbsp;·&nbsp; <sup class="gc-star">★</sup> Grand Chelem' +
        ' &nbsp;·&nbsp; &#9730; wet race &nbsp;·&nbsp; DNS = Grand Prix skipped' +
        ' &nbsp;·&nbsp; gold = win, green = podium</div>';

    host.innerHTML = html;
}
