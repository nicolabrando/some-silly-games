const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
//  RESOLUTION
//  The canvas used to keep a fixed 1360x765 backing store whatever the
//  screen: on a phone or any retina display the CSS scaled it up and every
//  line went soft. The backing store now follows devicePixelRatio (capped at
//  2 - beyond that the cost quadruples for sharpness nobody can see) and one
//  setTransform maps world units onto it, so every draw call in the game
//  keeps thinking in 1360x765 and nothing else changes.
//
//  The ELEMENT, on the other hand, must NOT follow: its CSS box derived from
//  the width/height attributes, so doubling the backing store would double
//  the layout size on a big screen. The box is therefore sized by the
//  stylesheet - width: min(world, viewport width, viewport height by the
//  aspect ratio) - which shrinks to fit on BOTH axes, the way the intrinsic
//  size used to. The world number is fed in from here as --world-w rather
//  than typed into the CSS, because no canvas limit is written by hand.
//
//  The first version pinned style.width to the world size and left the
//  shrinking to max-width/max-height. That holds only while the WIDTH is
//  the tight axis: in a window short of height - Nicola's retina Firefox,
//  with tabs, URL bar and bookmarks eating a strip - a replaced element
//  with an explicit width does not give it back, the canvas kept its 1360px
//  and the bottom of the HUD slid off the screen. min() asks the question
//  on both axes at once, which is what the old intrinsic behaviour did.
// ---------------------------------------------------------------------------
let RES = 1;
function applyResolution() {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (RES === dpr && canvas.width === Math.round(WORLD_W * dpr)) return;
    RES = dpr;
    document.documentElement.style.setProperty('--world-w', WORLD_W + 'px');
    canvas.width = Math.round(WORLD_W * RES);
    canvas.height = Math.round(WORLD_H * RES);
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
}
applyResolution();
if (typeof window !== 'undefined' && window.addEventListener) {
    // zoom or a move to another monitor changes dpr; the store follows
    window.addEventListener('resize', applyResolution);
}

// ---------------------------------------------------------------------------
//  THE STATIC TRACK LAYER
//  Grass ring, kerbs, asphalt, start line, barriers, stands, puddles: none
//  of it moves during a session, and it was all being re-stroked from paths
//  every frame - hundreds of barrier panels and kerb arcs, sixty times a
//  second, which on a phone was most of the frame. It is now drawn ONCE into
//  an offscreen canvas at full resolution and blitted per frame.
//
//  What stays out of the layer is what moves: skid marks, particles, rain,
//  the cars, the cranes, the bridge deck (painted OVER the cars that drive
//  under it) - and the STANDS, which look static but are not: the crowd's
//  shirts shimmer on a 260ms clock, and baking them into the circuit would
//  freeze the crowd for the whole race. They get a LAYER OF THEIR OWN,
//  transparent, redrawn only when the shimmer clock actually ticks - four
//  times a second instead of sixty - and blitted between the background and
//  the circuit, which is exactly where the old code painted them. Measured
//  before this split: the crowd alone was 0.7-2.3ms per frame, most of what
//  the bake had just saved.
//
//  The frame is therefore three cheap operations: background fill, stands
//  blit, circuit blit. The circuit layer rebuilds when its inputs change -
//  a new track instance (every session makes one), a new resolution, or a
//  reassigned puddle list (weather is rolled after the track is made, so
//  the reference is the honest signal); the stands layer additionally on
//  the shimmer tick.
// ---------------------------------------------------------------------------
let trackLayer = null;
let standsLayer = null;
function drawTrackFrame(g) {
    if (!trackLayer || trackLayer.track !== track ||
        trackLayer.res !== RES || trackLayer.puddles !== track.puddles) {
        const cv = document.createElement('canvas');
        cv.width = Math.round(WORLD_W * RES);
        cv.height = Math.round(WORLD_H * RES);
        const t = cv.getContext('2d');
        t.setTransform(RES, 0, 0, RES, 0, 0);
        const st = track._stands;      // the crowd is the other layer's job
        track._stands = [];
        track.draw(t);                 // transparent outside its own strokes
        track._stands = st;
        trackLayer = { canvas: cv, track: track, res: RES, puddles: track.puddles };
    }
    const tick = Math.floor(Date.now() / 260);   // drawStands' own clock
    if (!standsLayer || standsLayer.track !== track || standsLayer.res !== RES) {
        const cv = document.createElement('canvas');
        cv.width = Math.round(WORLD_W * RES);
        cv.height = Math.round(WORLD_H * RES);
        standsLayer = { canvas: cv, track: track, res: RES, tick: null };
    }
    if (standsLayer.tick !== tick) {
        const t = standsLayer.canvas.getContext('2d');
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.clearRect(0, 0, standsLayer.canvas.width, standsLayer.canvas.height);
        t.setTransform(RES, 0, 0, RES, 0, 0);
        track.drawStands(t);
        standsLayer.tick = tick;
    }
    g.fillStyle = '#388E3C';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.drawImage(standsLayer.canvas, 0, 0, WORLD_W, WORLD_H);
    g.drawImage(trackLayer.canvas, 0, 0, WORLD_W, WORLD_H);
}

// The world, the HUD column and the racing box all live in track.js: they are
// facts about where a circuit is allowed to be, and track.js is what puts the
// circuits there (`centreInArena`). This file reads them.
//
// The HUD is one column down the left: the timing tower, the driver's
// readouts, the two-player cards and the VSC strip all live in it, so there is
// only ONE thing taking room from the circuits instead of two. Everything to
// the right of it, top to bottom, is racing surface - and the circuits are
// centred inside that box by track.js, so nothing is ever drawn off the edge.

// The HUD lives in #stage, a WORLD_W x WORLD_H box laid exactly over the
// canvas and scaled with it. Without that the bands would be reserved in world
// pixels but the HUD drawn in CSS pixels, and the two would only agree at one
// particular window size.
function layoutStage() {
    const stage = document.getElementById('stage');
    const box = document.getElementById('game-container');
    if (!stage || !box || typeof canvas.getBoundingClientRect !== 'function') return;
    const c = canvas.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const k = c.width / WORLD_W;
    stage.style.setProperty('--stage-x', (c.left - b.left) + 'px');
    stage.style.setProperty('--stage-y', (c.top - b.top) + 'px');
    stage.style.setProperty('--stage-scale', k);
}
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', layoutStage);
}

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
// La VSC e' un limite di VELOCITA', non di potenza. Nella prima versione era
// solo potenza al 28%, e la potenza e' relativa: la velocita' che ne esce e'
// proporzionale al motore, quindi al TELAIO. Misurato su Oval, sotto VSC il
// piu' veloce del gruppo viaggiava il 32% piu' del piu' lento (95 contro 72
// px/s) - un Bolt (top 1.098) contro un Aero (0.928), piu' il carattere del
// pilota. Sotto una neutralizzazione i distacchi non devono cambiare, quindi
// il numero che conta e' assoluto e uguale per tutti; la potenza resta
// limitata solo per rendere la ripartenza morbida, ed e' abbastanza alta che
// anche il telaio piu' lento arrivi al tetto.
const VSC_SPEED = 90;     // px/s: la velocita' della VSC, uguale per chiunque
const VSC_POWER = 0.50;   // engine power while the VSC is out
// Once the track is clear the VSC runs 3 more seconds, counted down on the
// banner in tenths, so the restart is never a surprise.
const VSC_ENDING_MS = 3000;
let vscEndsAt = null;      // wall-clock (raceNow) moment the VSC will end
let recoveries = [];       // { car, phase, t, from, to, crane }
// and two of them never occupy the same patch of ground.
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
let pendingWetLevel = null; // 'damp' | 'soaked', pinned with it
let wetLevel = null;        // the live one, read by car.js and ai.js
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

// --- Chassis -------------------------------------------------------------
// Unlike tyres, this is chosen ONCE and lived with: for a whole season in the
// championship, and per session from the menu everywhere else. The menu value
// is the fallback; championshipState.chassis[seat] wins while a season is on,
// so a mid-season fiddle with the menu cannot change the car under you.
let playerChassis = CHASSIS_DEFAULT;
let playerChassis2 = CHASSIS_DEFAULT;
let pendingChassisSeat = 1;
let pendingChassisCb = null;

function seatChassis(index) {
    if (isChampionship && championshipState && championshipState.chassis) {
        const c = championshipState.chassis[index === 2 ? 2 : 1];
        if (c) return c;
    }
    return (index === 2 ? playerChassis2 : playerChassis) || CHASSIS_DEFAULT;
}

// Outside a championship the car is chosen once per weekend, on the same
// screen. `weekendChassisAsked` is cleared whenever the menu comes back up, so
// a new weekend asks again and qualifying-then-race does not.
let weekendChassisAsked = false;

// Is anybody actually driving? Spectator mode has no player, so there is
// nothing to equip and nobody to ask.
//
// `humanSeats()` reads the menu, which is right for a one-off race and wrong
// for a championship: a season's field is settled when it is created, not by
// whatever the dropdowns say now. qualifyingEnabled() already made that
// distinction; this is the same question asked once, in one place, so the two
// screens that ask the player something cannot disagree about whether there is
// a player.
// ---------------------------------------------------------------------------
//  WHO THE HUD IS ABOUT
// ---------------------------------------------------------------------------
//  Yours, if you are driving. If you are spectating there is no car of yours,
//  and the panel used to fall back to two lines about the leader - which lap
//  and who. Now a spectator can pick a car out of the timing tower and get the
//  whole panel for it: lap, speed, live lap time, tyre and wear.
//
//  It falls back to the leader when nothing is picked, and also when the car
//  you picked is out of the race - a HUD frozen on a wreck is worse than one
//  that moves on.
let spectateCar = null;

function raceLeader() {
    let best = null, bestLap = -1, bestProg = -1;
    for (const c of cars) {
        const lap = Math.min(c.lap, TOTAL_LAPS);
        const prog = c.trackProgress || 0;
        if (lap > bestLap || (lap === bestLap && prog > bestProg)) {
            best = c; bestLap = lap; bestProg = prog;
        }
    }
    return best;
}

function hudCar() {
    if (twoPlayer) return null;              // each seat has its own card
    if (playerCar) return playerCar;
    if (spectateCar && cars.indexOf(spectateCar) >= 0 &&
        !(spectateCar.isBroken && !spectateCar.finished)) return spectateCar;
    return raceLeader();
}

// Clicking a row in the tower follows that car. Only while spectating: with a
// car of your own the panel is about you and nothing else.
function spectateFollow(idx) {
    if (playerCar || twoPlayer) return;
    const c = cars[idx];
    if (!c) return;
    spectateCar = (spectateCar === c) ? null : c;   // click again to let go
}

function anyoneDriving() {
    if (isChampionship) {
        return !!(championshipState &&
                  championshipState.participants.some(p => p.isPlayer));
    }
    return humanSeats().length > 0;
}

function chooseChassisForWeekend(done) {
    if (weekendChassisAsked || !anyoneDriving()) { done(); return; }
    const seats = humanSeats();
    const ask = (n) => {
        if (n >= seats.length) { weekendChassisAsked = true; done(); return; }
        const idx = seats[n].playerIndex || 1;
        showChassisChoice(
            seats.length > 1 ? `Player ${idx} — pick your car` : 'Pick your car',
            'For this session and the race that follows it.',
            (pick) => {
                if (idx === 2) playerChassis2 = pick; else playerChassis = pick;
                ask(n + 1);
            });
    };
    ask(0);
}

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
// ---------------------------------------------------------------------------
//  HOW MANY LAPS DOWN, HONESTLY
//  The tower used to answer this with DISTANCE: "is the car on the row above
//  me more than a lap-length in front?". That is not what being lapped
//  means, and it read wrong most of the time - measured over a fifteen-lap
//  race, 85% of the rows belonging to lapped cars were shown with an
//  ordinary time interval, so a car a whole lap down appeared as "+0.0"
//  against the car above it. Nicola could not tell who was racing whom,
//  which is the one thing a timing tower is for.
//
//  Being lapped is a fact about LAPS: the leader has completed more of them
//  than you AND is in front of you on the road. The correction term is what
//  makes it exact - a car three seconds behind a leader who has just crossed
//  the line reads lap 5 against his 6 and is not lapped at all, it is simply
//  further round the current lap than he is.
//
//      lapsDown = (leader.lap - c.lap) - (c.lapS > leader.lapS ? 1 : 0)
//
//  Clamped at zero: the car with the most distance covered IS the leader,
//  and nobody is a negative lap behind him.
// ---------------------------------------------------------------------------
function lapsDownFrom(leader, c) {
    if (!leader || !c || leader === c) return 0;
    const behindOnLap = (c.lapS || 0) > (leader.lapS || 0) ? 1 : 0;
    return Math.max(0, (leader.lap || 0) - (c.lap || 0) - behindOnLap);
}

// ---------------------------------------------------------------------------
//  ONE ORDER FOR THE WHOLE FIELD
//  Finished, retired and still circulating, ranked by one comparator that
//  both the timing tower and the results sheet use. This is the fix for the
//  last places rearranging themselves while the stragglers come in.
//
//  What it used to do: a finished car scored 1e12 + laps, a running car
//  scored its distance - about 9000. So the instant ANY car took the flag it
//  leapt above every car still on the road, including cars physically ahead
//  of it. Probed directly: a lapped backmarker crossing the line scored
//  1.004e12 against 8923 for a lead-lap car still circulating a thousand
//  pixels further down the road. The backmarker jumped above it, then fell
//  back the moment that car crossed - and with cars trickling in over the
//  closing laps the bottom of the tower rearranged itself every few seconds.
//
//  Two rules, and they are the ones a race steward would use:
//
//    * two CLASSIFIED cars are separated by laps, then by the clock. Never
//      by distance - two cars that finish a second apart freeze their
//      odometers within a few pixels of each other, and a few pixels of
//      frame-capture noise must not be allowed to reorder a podium.
//    * anything else is separated by DISTANCE COVERED, with a classified car
//      counted at the odometer reading it had when it was classified rather
//      than its live one. A finished car keeps rolling after the flag
//      (measured, up to 344px of it) and a retired one gets carried off by a
//      crane; neither is racing any more, and neither should move.
//
//  A car crossing the line therefore lands exactly where it already was, and
//  the order stops moving. The first attempt at this put a finished car at
//  "laps x lap length", which looked right and was not: trackProgress does
//  not start at zero - the grid sits most of a lap behind the line - so that
//  number sat a whole lap below the running cars and the churn got worse.
//  Freezing the car's own odometer is the version that has no origin to get
//  wrong.
// ---------------------------------------------------------------------------
function progressOf(c) {
    if (!c) return 0;
    return (c._classProgress !== undefined) ? c._classProgress : (c.trackProgress || 0);
}

// Negative when a is ahead of b.
function raceCmp(a, b) {
    const af = !!a.finished, bf = !!b.finished;
    if (af && bf) {
        const la = Math.min(a.lap, TOTAL_LAPS), lb = Math.min(b.lap, TOTAL_LAPS);
        if (la !== lb) return lb - la;
        const ta = isFinite(a.raceTime) ? a.raceTime : Infinity;
        const tb = isFinite(b.raceTime) ? b.raceTime : Infinity;
        if (ta !== tb) return ta - tb;
        return (a.finishIndex || 0) - (b.finishIndex || 0);
    }
    const pa = progressOf(a), pb = progressOf(b);
    if (pa !== pb) return pb - pa;
    // dead level: a classified car is ahead of one still waiting to be
    if (af !== bf) return af ? -1 : 1;
    return 0;
}

// The odometer is frozen the moment a car is classified - see raceCmp.
function freezeClassified() {
    for (const c of cars) {
        if ((c.finished || c.isBroken) && c._classProgress === undefined) {
            c._classProgress = c.trackProgress || 0;
        }
    }
}

function towerScore(c) {
    return progressOf(c);
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
    // Hysteresis only where the order is a judgement call: two cars still
    // racing, nose to tail. Never between classified cars, and never across
    // a lap.
    const marginFor = (a, b) => (a.finished || b.finished ||
        Math.abs(progressOf(a) - progressOf(b)) > lapLen * 0.5) ? 0 : TOWER_MARGIN;

    // Two settling passes a frame while the race is running, so the hysteresis
    // does its job. Once cars are taking the flag their order is a fact rather
    // than a judgement call, so settle it completely - otherwise the tower can
    // still be a few places behind the truth at the moment the race ends. A
    // lap-scale inversion is settled completely too.
    let lapGap = false;
    for (let i = 0; i < towerOrder.length - 1 && !lapGap; i++) {
        if (progressOf(towerOrder[i + 1]) > progressOf(towerOrder[i]) + lapLen * 0.5) {
            lapGap = true;
        }
    }
    const nPasses = (leaderFinished || lapGap) ? towerOrder.length : 2;
    for (let pass = 0; pass < nPasses; pass++) {
        for (let i = 0; i < towerOrder.length - 1; i++) {
            const a = towerOrder[i], b = towerOrder[i + 1];
            const m = marginFor(a, b);
            const swap = m > 0
                ? progressOf(b) > progressOf(a) + m       // racing: needs to earn it
                : raceCmp(b, a) < 0;                      // settled: the truth wins
            if (swap) {
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
    // The analogue pair has to go too, or a touch throttle would survive a grid
    // reset - but it must be DELETED, not set to zero.
    //
    // The whole scheme rests on one invariant: a keyboard never defines
    // keys.throttle, so `k.throttle !== undefined ? k.throttle : (k.up ? 1 : 0)`
    // falls back to the arrow keys. Writing 0 broke that invariant permanently.
    // From the first clearKeys() onwards the throttle was defined-and-zero, the
    // fallback stopped firing, and the car ignored the accelerator for the rest
    // of the session however hard the arrow was held. The steering still worked,
    // because that reads the booleans - which is why it presents as "the
    // controls stopped working" rather than "the throttle died".
    //
    // It has always been wrong; pausing with the space bar is simply the first
    // thing that made it easy to hit, because clearKeys() runs on every pause.
    delete keys.throttle; delete keys.brake;
    delete keys2.throttle; delete keys2.brake;
    if (typeof renderDrive === 'function') renderDrive(0);
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
    if (l1) l1.innerText = two ? 'Player 1 car' : 'Your car';
    const cl = document.getElementById('controls-label');
    if (cl) cl.innerText = two ? 'Controls — Player 1' : 'Controls';

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

// --- menu: the mode tabs -------------------------------------------------
// The menu grew one control at a time until every setting needed a tag saying
// which mode it belonged to, and a paragraph to explain the tags. The tabs put
// each setting under the only mode that reads it, so nothing needs a caveat -
// and the one Start button on show is always the right one. The buttons and
// their wiring above do not change; the two that do not apply are just hidden.
const MENU_MODES = {
    race: {
        hint: 'One weekend: pick a car, qualify — a warm-up lap and two flying ' +
              'laps, your best counts — and the classification is the grid. ' +
              'The race is run in whatever weather qualifying got.'
    },
    champ: {
        hint: 'A season with F1 points: the calendar is drawn at random — never ' +
              'the same circuit twice — and every round rolls its own weather. ' +
              'One car for the whole season, qualifying before every race. ' +
              '<b>Reverse grid</b> sets each grid from the standings instead, ' +
              'leader last — round&nbsp;1 drawn by lot.'
    },
    practice: {
        hint: 'Your circuit and weather, no opponents, as many laps as you ' +
              'like — every one of them timed. <b>Stop</b> in the HUD ends the ' +
              'session and lists them all, best lap marked.'
    }
};

function setMenuMode(mode) {
    if (!MENU_MODES[mode]) mode = 'race';
    menu.dataset.mode = mode;
    menu.querySelectorAll('.mode-tab').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    menu.querySelectorAll('[data-modes]').forEach(el => {
        el.style.display = el.dataset.modes.split(' ').includes(mode) ? '' : 'none';
    });
    const hint = document.getElementById('mode-hint');
    if (hint) hint.innerHTML = MENU_MODES[mode].hint;
}

menu.querySelectorAll('.mode-tab').forEach(b => {
    b.addEventListener('click', () => {
        if (typeof disarmChampWipe === 'function') disarmChampWipe();
        setMenuMode(b.dataset.mode);
    });
});
setMenuMode('race');

startBtn.addEventListener('click', () => {
    isChampionship = false;
    raceMode = 'race';
    pendingGrid = null;
    pendingWeather = null; pendingWetLevel = null;
    const laps = parseInt(document.getElementById('laps-select').value, 10) || 5;
    // The car is chosen on the same screen a season uses, and asked once for
    // the whole weekend - not again between qualifying and the race. There
    // used to be a dropdown in the menu as well, which meant two controls for
    // one decision.
    chooseChassisForWeekend(() => {
        if (qualifyingEnabled()) {
            chooseTyres('Qualifying tyres', 'One flying lap is all that matters here.',
                QUALI_LAPS - 1, () => startQualifying(null));
        } else {
            chooseTyres('Race tyres', 'This set has to last the whole race.',
                laps, () => startGame());
        }
    });
});

champBtn.addEventListener('click', () => {
    // A season in progress is not thrown away on one click.
    const saved = loadChampionshipSave();
    if (saved && !champWipeArmed) {
        champBtn.textContent = 'Discard round ' + (saved.currentTrackIndex + 1) +
            ' of ' + saved.tracks.length + '? Press again';
        champBtn.classList.add('menu-danger');
        champWipeArmed = setTimeout(disarmChampWipe, 6000);
        return;
    }
    disarmChampWipe();
    isChampionship = true;
    raceMode = 'championship';
    pendingGrid = null;
    pendingWeather = null; pendingWetLevel = null;
    startChampionship();
});

// The saved season, if there is one. hidden (the attribute) rather than
// style.display, because setMenuMode writes display on everything tagged
// data-modes and would un-hide it on every visit to the tab.
const champResumeBtn = document.getElementById('champ-resume-btn');
if (champResumeBtn) champResumeBtn.addEventListener('click', resumeChampionship);

practiceBtn.addEventListener('click', () => {
    isChampionship = false;
    raceMode = 'practice';
    pendingGrid = null;
    // A fresh roll of the weather, as for a race: without this a practice
    // run after a wet weekend inherited that weekend's rain.
    pendingWeather = null; pendingWetLevel = null;
    // The same two screens a race weekend opens with. Practice used to skip
    // the second and start on whatever set was chosen last, under weather it
    // never announced - so you could pull out on slicks into the rain and only
    // find out at the first corner. Nothing wears in free running (TOTAL_LAPS
    // is 9999), so the life line says so instead of quoting a race distance.
    chooseChassisForWeekend(() => {
        chooseTyres('Practice tyres',
            'Free running: nothing wears out here. Take the set you want to learn.',
            0, () => startGame());
    });
});

logBtn.addEventListener('click', () => {
    logBody.textContent = RaceLog.text(false);
    logScreen.style.display = 'block';
    logBody.scrollTop = logBody.scrollHeight;
});

// The two reference screens. They are pure reading - nothing they do can start
// a session - so they simply swap places with the menu and swap back.
document.getElementById('explore-tracks-btn')
    .addEventListener('click', () => showExploreTracks());
document.getElementById('explore-drivers-btn')
    .addEventListener('click', () => showExploreDrivers());
// Back is one step back, not all the way out. From a circuit's card it returns
// to the wall of circuits - which is where you were, and where you almost
// certainly want to go next - and only from the wall does it leave for the
// menu. It used to drop you at the menu from either, so looking at two
// circuits in a row meant walking in through the front door twice.
document.getElementById('ex-tracks-back').addEventListener('click', () => {
    const detail = document.getElementById('ex-track-detail');
    if (detail && detail.style.display !== 'none') { exShowTrackList(); return; }
    document.getElementById('explore-tracks').style.display = 'none';
    menu.style.display = 'block';
});
document.getElementById('ex-drivers-back').addEventListener('click', () => {
    document.getElementById('explore-drivers').style.display = 'none';
    menu.style.display = 'block';
});

document.getElementById('log-close-btn').addEventListener('click', () => {
    logScreen.style.display = 'none';
});

document.getElementById('log-download-btn').addEventListener('click', () => {
    RaceLog.download();
});

// ---------------------------------------------------------------------------
//  THE PAUSE PANEL
//
//  A pause screen that only says PAUSED is a wasted screen: the one moment the
//  game is not moving is the one moment you can actually read something off it.
//  So it carries the numbers you cannot take in at racing speed - how far the
//  car ahead really is, what the tyre has left, how your best lap compares with
//  the quickest of the session - and it says different things in a race and in
//  qualifying, because they are different questions.
//
//  It is rebuilt on every pause rather than kept live: the game is stopped, so
//  there is nothing to update, and a snapshot cannot drift out of step with the
//  frozen picture behind it.
// ---------------------------------------------------------------------------
const pauseStats = document.getElementById('pause-stats');
// Set by startGame/startQualifying, read by the pause panel: which circuit is
// under us, and the classification as of the last frame. sortedCars is a local
// inside the loop, so it has to be handed out deliberately.
let currentTrackKey = null;
let lastRunningOrder = [];

function pzRow(k, v, cls) {
    return `<div class="pz-row"><span class="k">${k}</span>` +
           `<span class="v${cls ? ' ' + cls : ''}">${v}</span></div>`;
}
function pzBar(frac, colour) {
    const f = Math.max(0, Math.min(1, frac));
    return `<div class="pz-bar"><i style="width:${(f * 100).toFixed(0)}%;` +
           `background:${colour};"></i></div>`;
}
function pzCol(head, body) {
    return `<div class="pz-col"><div class="pz-h">${head}</div>${body}</div>`;
}
// The damage costs POWER AND GRIP, not health points, and the two numbers are
// not the same: car.js holds the car at full performance until 40% of its
// health is gone, then fades it linearly to 70% at the point of destruction.
// So "Condition 75%, Performance 100%" is a real and useful thing to read -
// nothing has been lost yet - and "Condition 20%, Performance 80%" says how
// much car is left to race with.
function pzPerfClass(p) {
    return p >= 0.999 ? 'pz-good' : (p >= 0.90 ? 'pz-warn' : 'pz-bad');
}

// Green while there is plenty, amber past halfway, red near the end.
function pzWearClass(left) {
    return left > 0.5 ? 'pz-good' : (left > 0.22 ? 'pz-warn' : 'pz-bad');
}
function pzWearColour(left) {
    return left > 0.5 ? '#7fe08a' : (left > 0.22 ? '#ffd54f' : '#ff5252');
}

// The car's own condition: the same three facts in a race and in qualifying.
function pauseCarCol(car) {
    const ch = car.chassis || CHASSIS[CHASSIS_DEFAULT];
    const tyreLeft = Math.max(0, Math.min(1, 1 - (car.tyreWear || 0)));
    const hp = car.maxHealth ? Math.max(0, car.health / car.maxHealth) : 1;
    const speed = Math.hypot(car.velocity.x, car.velocity.y);
    let body = '';
    body += pzRow('Car', `<span style="color:${ch.accent};">${ch.label}</span>`);
    body += pzRow('Tyre', car.tyre
        ? `<span style="color:${car.tyre.colour};">${car.tyre.label}</span>`
        : '&mdash;');
    body += pzRow('Life left', (tyreLeft * 100).toFixed(0) + '%', pzWearClass(tyreLeft));
    body += pzBar(tyreLeft, pzWearColour(tyreLeft));
    body += pzRow('Condition', (hp * 100).toFixed(0) + '%', pzWearClass(hp));
    body += pzBar(hp, pzWearColour(hp));
    // ...and what that is costing on track. `condition` is the number car.js
    // multiplies the engine and the grip by, and top speed is power over drag,
    // so this single figure is the car's performance as a fraction of the one
    // that left the pits.
    const perf = (car.condition === undefined || !isFinite(car.condition)) ? 1 : car.condition;
    // Just the number: .pz-row does not wrap, so a longer value hangs out of
    // the right-hand side of the panel instead of shortening.
    body += pzRow('Performance', (perf * 100).toFixed(0) + '%', pzPerfClass(perf));
    body += pzRow('Speed', speed.toFixed(0));
    return pzCol('Your car', body);
}

// Everyone's best lap of the session so far, and whose it is.
function pauseFastest() {
    let best = null, who = null;
    for (const c of cars) {
        if (c.bestLapTime !== null && c.bestLapTime !== undefined &&
            (best === null || c.bestLapTime < best)) { best = c.bestLapTime; who = c; }
    }
    if (raceMode === 'qualifying') {
        for (const q of qualiTimes) {
            if (q.lap !== null && (best === null || q.lap < best)) {
                best = q.lap; who = q.p;
            }
        }
    }
    return { ms: best, who: who };
}

function renderPausePanel() {
    if (!pauseStats) return;
    const cols = [];
    const humans = typeof humanCars === 'function' ? humanCars() : [];
    const fast = pauseFastest();
    const fastName = fast.who
        ? (fast.who.isPlayer ? 'you' : (driverCode(fast.who) ||
           (fast.who.driverName || '').slice(0, 3).toUpperCase()))
        : '';

    // ---- qualifying -----------------------------------------------------
    if (raceMode === 'qualifying') {
        const order = qualiOrder();
        const pole = order.length ? order[0] : null;
        for (const car of humans) {
            const seat = car.playerIndex || 1;
            const idx = order.findIndex(r => r.isPlayer && r.p &&
                (r.p.playerIndex || 1) === seat);
            const mine = idx >= 0 ? order[idx] : null;
            const myLap = mine ? mine.lap : car.bestLapTime;
            let body = '';
            body += pzRow('Provisional', idx >= 0 ? 'P' + (idx + 1) + ' of ' + order.length : '&mdash;',
                'big');
            body += pzRow('Your best', fmtLapMs(myLap), 'big');
            if (pole && pole.lap !== null && myLap !== null && myLap !== undefined) {
                const d = (myLap - pole.lap) / 1000;
                body += pzRow('Gap to pole', d <= 0 ? 'POLE' : '+' + d.toFixed(3),
                    d <= 0 ? 'pz-good' : (d < 0.25 ? 'pz-warn' : ''));
            } else {
                body += pzRow('Gap to pole', 'no time yet');
            }
            body += pzRow('Last lap', fmtLapMs(car.lastLapTime));
            body += pzRow('Lap', car.qualiDone ? 'session over'
                : Math.min(car.lap + 1, QUALI_LAPS) + ' of ' + QUALI_LAPS);
            if (humans.length > 1) {
                // one column each, same reason as the race panel below
                const tyreLeft = Math.max(0, Math.min(1, 1 - (car.tyreWear || 0)));
                body += pzRow('Tyre', (tyreLeft * 100).toFixed(0) + '% left', pzWearClass(tyreLeft));
                body += pzBar(tyreLeft, pzWearColour(tyreLeft));
                cols.push(pzCol(humanLabel(car), body));
                continue;
            }
            cols.push(pzCol('Your lap', body));
            cols.push(pauseCarCol(car));
        }
        let sess = '';
        sess += pzRow('On pole', pole && pole.p
            ? (pole.isPlayer ? 'you' : (DRIVER_CODES[pole.p.driverName] || pole.p.driverName || '&mdash;'))
            : '&mdash;');
        sess += pzRow('Pole time', pole ? fmtLapMs(pole.lap) : '&mdash;');
        sess += pzRow('Runners in', order.filter(r => r.lap !== null).length + ' of ' + order.length);
        sess += pzRow('Circuit', currentTrackKey ? trackLabel(currentTrackKey) : '&mdash;');
        sess += pzRow('Weather', isRaining ? 'wet' : 'dry', isRaining ? 'pz-warn' : '');
        cols.push(pzCol('Session', sess));
        pauseStats.innerHTML = cols.join('');
        return;
    }

    // ---- a race ---------------------------------------------------------
    const order = lastRunningOrder.length ? lastRunningOrder : cars.slice();
    const lapLen = (track && track.getRacingLine)
        ? track.getRacingLine('standard').length : 1;

    for (const car of humans) {
        const pos = order.indexOf(car) + 1;
        const ahead = pos > 1 ? order[pos - 2] : null;
        const behind = pos > 0 && pos < order.length ? order[pos] : null;
        // Same arithmetic as the timing tower: distance round the circuit over
        // the pace of the car that has to cover it.
        const gapTo = (other, mine) => {
            if (!other) return null;
            const d = Math.abs((other.trackProgress || 0) - (mine.trackProgress || 0));
            const laps = Math.floor(d / lapLen);
            if (laps >= 1) return '+' + laps + ' lap' + (laps > 1 ? 's' : '');
            const pace = Math.max(60, mine._paceAvg || Math.hypot(mine.velocity.x, mine.velocity.y) || 60);
            return (d / pace).toFixed(1) + 's';
        };
        const grid = (car.gridIndex || 0) + 1;
        const moved = pos > 0 ? grid - pos : 0;

        let body = '';
        body += pzRow('Position', pos > 0 ? 'P' + pos + ' of ' + order.length : '&mdash;', 'big');
        body += pzRow('Lap', Math.min(car.lap + 1, TOTAL_LAPS) + ' of ' + TOTAL_LAPS);
        body += pzRow('Car ahead', ahead ? driverCode(ahead) + '  ' + gapTo(ahead, car) : 'clear road',
            ahead ? '' : 'pz-good');
        body += pzRow('Car behind', behind ? driverCode(behind) + '  ' + gapTo(behind, car) : 'nobody');
        body += pzRow('From the grid', moved === 0 ? 'held P' + grid
            : (moved > 0 ? '+' + moved + ' place' + (moved > 1 ? 's' : '')
                         : moved + ' place' + (moved < -1 ? 's' : '')),
            moved > 0 ? 'pz-good' : (moved < 0 ? 'pz-bad' : ''));
        // Two seats means two of everything, and six columns is not a panel it
        // is a spreadsheet. With a passenger each driver gets one column with
        // the four things that decide the next lap.
        if (humans.length > 1) {
            const tyreLeft = Math.max(0, Math.min(1, 1 - (car.tyreWear || 0)));
            const hp = car.maxHealth ? Math.max(0, car.health / car.maxHealth) : 1;
            body += pzRow('Best lap', fmtLapMs(car.bestLapTime));
            body += pzRow('Tyre', (tyreLeft * 100).toFixed(0) + '% left', pzWearClass(tyreLeft));
            body += pzBar(tyreLeft, pzWearColour(tyreLeft));
            body += pzRow('Condition', (hp * 100).toFixed(0) + '%', pzWearClass(hp));
            body += pzBar(hp, pzWearColour(hp));
            cols.push(pzCol(humanLabel(car), body));
            continue;
        }
        cols.push(pzCol('Your race', body));

        let pace = '';
        pace += pzRow('Last lap', fmtLapMs(car.lastLapTime), 'big');
        pace += pzRow('Your best', fmtLapMs(car.bestLapTime));
        if (fast.ms !== null && car.bestLapTime) {
            const d = (car.bestLapTime - fast.ms) / 1000;
            pace += pzRow('Fastest lap', d <= 0 ? 'yours' : '+' + d.toFixed(3) + ' (' + fastName + ')',
                d <= 0 ? 'pz-good' : '');
        } else {
            pace += pzRow('Fastest lap', fast.ms !== null
                ? fmtLapMs(fast.ms) + ' (' + fastName + ')' : 'not set');
        }
        pace += pzRow('Tyre age', (Math.min(1.25, car.tyreWear || 0) * 100).toFixed(0) + '% used');
        pace += pzRow('Track', isRaining ? 'wet' : 'dry', isRaining ? 'pz-warn' : '');
        if (typeof vscActive !== 'undefined' && vscActive)
            pace += pzRow('Flag', 'SAFETY CAR', 'pz-warn');
        cols.push(pzCol('Pace', pace));
        cols.push(pauseCarCol(car));
    }

    // Spectating: no car of yours, so report the race instead.
    if (!humans.length) {
        const ldr = order[0];
        let body = '';
        body += pzRow('Leader', ldr ? driverCode(ldr) : '&mdash;', 'big');
        body += pzRow('Lap', ldr ? Math.min(ldr.lap + 1, TOTAL_LAPS) + ' of ' + TOTAL_LAPS : '&mdash;');
        body += pzRow('Fastest lap', fast.ms !== null
            ? fmtLapMs(fast.ms) + ' (' + fastName + ')' : 'not set');
        body += pzRow('Running', order.filter(c => !c.isBroken).length + ' of ' + order.length);
        body += pzRow('Weather', isRaining ? 'wet' : 'dry', isRaining ? 'pz-warn' : '');
        cols.push(pzCol('The race', body));
    }

    pauseStats.innerHTML = cols.join('');
}

// Pause works in anything that is actually running: countdown, race,
// qualifying, practice. It is a no-op on the menus and result screens.
function setPaused(want) {
    if (gameState !== 'playing' && gameState !== 'countdown') return;
    if (want === isPaused) return;
    isPaused = want;

    if (isPaused) {
        pauseStartedAt = performance.now();
        renderPausePanel();          // a snapshot, taken before the clock stops
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
    // Space joins P and Esc. It is safe: neither control scheme binds it -
    // seat 1 is the arrows or WASD and seat 2 gets the other - so nothing is
    // being taken away from anybody's car. preventDefault matters here or the
    // browser scrolls the page under the canvas.
    const k = e.key;
    if (k === 'p' || k === 'P' || k === 'Escape' || k === ' ' || k === 'Spacebar') {
        if (typingInAField(e)) return;
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
    pendingWeather = null; pendingWetLevel = null;
    isChampionship = false;
    weekendChassisAsked = false;   // a new weekend, a new choice of car
    menu.style.display = 'block';
});

restartBtn.addEventListener('click', () => {
    gameOverScreen.style.display = 'none';
    pendingGrid = null;
    pendingWeather = null; pendingWetLevel = null;
    skipMode = false;
    skipPlayer = null;
    skipPlayers = [];
    weekendChassisAsked = false;   // a new weekend, a new choice of car
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
    weekendChassisAsked = false;   // a new weekend, a new choice of car
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
    weekendChassisAsked = false;   // a new weekend, a new choice of car
    menu.style.display = 'block';
    if (typeof stopAudio === 'function') stopAudio();
    isChampionship = false;
    // Abandoning a session mid-run must not leave a stale grid or weather
    // waiting to be applied to whatever is started next.
    qualiQueue = [];
    qualiTimes = [];
    pendingGrid = null;
    pendingWeather = null; pendingWetLevel = null;
    skipMode = false;
    skipPlayer = null;
    skipPlayers = [];
    document.getElementById('skip-overlay').style.display = 'none';
});

// Mobile Controls detection and mapping
const isMobile = IS_MOBILE;
const mobileControls = document.getElementById('mobile-controls');

// ---------------------------------------------------------------------------
//  TOUCH DRIVING
//  Steering is two buttons - it is a yes or no, and a thumb is good at that.
//  The throttle is not: how MUCH throttle is most of the skill in a corner,
//  so it is a strip you slide. Above the middle is gas, below it is brake and
//  then reverse, and how far you are from the middle is how much you get.
//
//  setDrive() is the only way in. It writes BOTH the analogue pair and the
//  booleans, because the oversteer model, the AI and the reaction timer all
//  read the booleans - and a desktop, which never calls this, leaves
//  keys.throttle undefined and therefore behaves exactly as it always did.
// ---------------------------------------------------------------------------
const TOUCH_DEAD_ZONE = 0.07;   // fraction of travel that still counts as off

function setDrive(v) {
    v = Math.max(-1, Math.min(1, v));
    if (Math.abs(v) < TOUCH_DEAD_ZONE) v = 0;
    keys.throttle = v > 0 ? v : 0;
    keys.brake = v < 0 ? -v : 0;
    keys.up = keys.throttle > 0;
    keys.down = keys.brake > 0;
    renderDrive(v);
}

function renderDrive(v) {
    const fill = document.getElementById('mt-fill');
    const knob = document.getElementById('mt-knob');
    const read = document.getElementById('mt-read');
    if (!fill || !knob || !read) return;
    const mag = Math.abs(v) * 50;                  // % of the strip, from centre
    fill.style.top = v > 0 ? (50 - mag) + '%' : '50%';
    fill.style.height = mag + '%';
    fill.style.background = v >= 0 ? '#00e676' : '#ff5252';
    knob.style.top = (50 - v * 50) + '%';
    read.innerText = (v === 0 ? '0' : (v > 0 ? '+' : '-') + Math.round(Math.abs(v) * 100)) + '%';
    read.style.color = v > 0 ? '#00e676' : (v < 0 ? '#ff5252' : '#b0bec5');
}

if (isMobile) {
    if (document.body && document.body.classList) document.body.classList.add('is-mobile');

    const btnLeft = document.getElementById('btnLeft');
    const btnRight = document.getElementById('btnRight');

    const bindTouch = (btn, keyName) => {
        if (!btn) return;
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[keyName] = true; });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); keys[keyName] = false; });
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); keys[keyName] = false; });
    };
    bindTouch(btnLeft, 'left');
    bindTouch(btnRight, 'right');

    // The whole strip is the control, not just the knob: wherever the thumb
    // lands is where the lever goes, and sliding from there adjusts it. The
    // 18px inset means the very ends are reachable without fighting the edge
    // of the screen.
    const strip = document.getElementById('mobile-throttle');
    if (strip) {
        const fromTouch = (clientY) => {
            const r = strip.getBoundingClientRect();
            const half = Math.max(1, r.height / 2 - 18);
            setDrive((r.top + r.height / 2 - clientY) / half);
        };
        const onMove = (e) => {
            e.preventDefault();
            const t = e.touches && e.touches[0];
            if (t) fromTouch(t.clientY);
        };
        strip.addEventListener('touchstart', onMove);
        strip.addEventListener('touchmove', onMove);
        // Lift off and it returns to neutral, like taking your foot off a
        // pedal. A lever that stayed where you left it would mean driving
        // into a corner flat because you took your thumb away to steer.
        const release = (e) => { e.preventDefault(); setDrive(0); };
        strip.addEventListener('touchend', release);
        strip.addEventListener('touchcancel', release);
    }
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

// Every track made here is tagged with the key it was made from. Several
// things downstream need to ask a track object what it is - the AI's compound
// choice depends on the layout now - and reverse-mapping a constructor name is
// the kind of thing that breaks silently when a circuit is renamed.
function makeTrack(trackType) {
    const t = makeTrackRaw(trackType);
    t.trackKey = trackType;
    return t;
}
function trackKeyOf(t) { return (t && t.trackKey) || null; }

// Il rivale della stagione vale SOLO in campionato: in gara singola la griglia
// torna quella tarata. Questa riga gira all'inizio di ogni sessione, quindi
// una stagione ripresa da localStorage si riporta dietro il suo rivale senza
// che nessuno debba ricordarselo.
function applySeasonRival() {
    AI.seasonRival = (isChampionship && championshipState && championshipState.rival)
                   ? championshipState.rival : null;
}
function makeTrackRaw(trackType) {
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
        case 'boomerang':    return new BoomerangTrack();
        case 'zipper':       return new ZipperTrack();
        case 'kettle':       return new KettleTrack();
        case 'harbour':      return new HarbourTrack();
        case 'crossover':    return new CrossoverTrack();
        case 'kart':       return new KartTrack();
        case 'anchor':       return new AnchorTrack();
        case 'arrow':        return new ArrowTrack();
        case 'pentagon':     return new PentagonTrack();
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

    // One chassis draw for the whole field, so the grid is never ten of the
    // same car (see AI.assignChassis).
    const aiNames = [];
    for (let i = 0; i < totalAIsToSpawn; i++) aiNames.push(randomDrivers[i % randomDrivers.length]);
    const aiChassis = AI.assignChassis(aiNames);

    for (let i = 0; i < totalAIsToSpawn; i++) {
        field.push({
            isPlayer: false,
            color: aiColors[i % aiColors.length],
            skillVariation: null,
            driverName: aiNames[i],
            chassis: aiChassis[i]
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
function simulateQualifyingLap(qTrack, driverName, difficulty, skillVariation, raining, chassis) {
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
    // Qualifying is run in the car the driver will race, or the grid would be
    // set by a car nobody is driving.
    car.setChassis(chassis || CHASSIS_DEFAULT);
    car.angle = n0.heading;
    car.maxHealth = 1e9;          // a qualifying lap is not a damage test
    car.health = car.maxHealth;
    car.nextWaypoint = 0;
    car._lapPixels = line.length;
    car._tyreRaceLaps = QUALI_LAPS;
    car.tyre = TYRES[AI.chooseTyre(driverName, QUALI_LAPS, raining, qTrack)] ||
               TYRES.medium;
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

// The line judge. track.js asks for this when it has to choose between
// candidate racing lines (THE LINE, AND HOW IT IS CHOSEN, in track.js): the
// top AI drives each candidate alone for a flying lap - medium, dry, the
// reference chassis, a driver with no personality - and the quickest
// candidate is the line. Returns the lap in ms, null if none was completed.
// It only ever runs for a circuit whose line is not in lines.js (an edited
// or new layout), once; the answer is then remembered in localStorage.
// How many flying laps the judge drives per candidate, best kept. ZERO in the
// game: judging means running the race simulation from inside getRacingLine(),
// which the interface calls, and a circuit that is not in lines.js is an
// edited circuit - it gets the proxy's answer straight away instead of a
// multi-second freeze. genlines.js sets 3, because there the whole job is to
// choose well and the sim is noisy to about a per cent.
let RACING_LINE_JUDGE_REPS = 0;
function judgeRacingLine(qTrack) {
    const real = AI.chooseTyre;
    AI.chooseTyre = () => 'medium';
    try {
        let best = null;
        for (let r = 0; r < Math.max(1, RACING_LINE_JUDGE_REPS); r++) {
            const lap = simulateQualifyingLap(qTrack, 'Line judge', 'impossible', 1.1, false, CHASSIS_DEFAULT);
            if (lap && isFinite(lap) && (best === null || lap < best)) best = lap;
        }
        return best;
    } catch (e) {
        return null;
    } finally {
        AI.chooseTyre = real;
    }
}

// Run through the pending AI drivers, one per frame, while the player drives.
// The player's damage handicap is a difficulty setting like any other: it is on
// everywhere except Alien, whose whole premise is that the player is given
// nothing the field is not. Called once as each session starts, so qualifying
// and the race agree.
function applyDifficultyRules(diff) {
    const prof = (typeof AI_PROFILES !== 'undefined' && AI_PROFILES[diff]) || null;
    if (typeof playerHandicapOn !== 'undefined')
        playerHandicapOn = !(prof && prof.noPlayerHandicap);
}

function qualiTick() {
    if (!qualiQueue.length) return;
    const p = qualiQueue.shift();
    const difficulty = isChampionship
        ? championshipState.difficulty
        : document.getElementById('difficulty-select').value;
    const lap = simulateQualifyingLap(qualiTrack, p.driverName, difficulty, p.skillVariation,
                                      isRaining, p.chassis);
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
        // The car each driver is in, in qualifying too: the grid you are
        // about to line up on is half chassis and half driver.
        const ck = r.p && r.p.isPlayer ? seatChassis(r.p.playerIndex || 1)
                                       : (r.p && r.p.chassis);
        const ch = CHASSIS[ck] || CHASSIS[CHASSIS_DEFAULT];
        return `<div class="tt-row${r.p && r.p.isPlayer ? ' me' : ''}">` +
               `<span class="tt-pos">${i + 1}</span>` +
               `<span class="tt-chip" style="background:${r.p ? r.p.color : '#888'};"></span>` +
               `<span class="tt-name"${r.lap === null ? ' style="opacity:.45;"' : ''}>${code}</span>` +
               `<span class="tt-ch" style="background:${ch.accent};" title="${ch.label}">${ch.short}</span>` +
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
    hud.style.display = 'block';
    layoutStage();
    if (isMobile) mobileControls.style.display = 'flex';

    raceMode = 'qualifying';
    lastRunningOrder = [];
    globalSkidMarks = [];
    globalParticles = [];
    document.getElementById('dnf-timer').style.visibility = 'hidden';
    speedometer.innerText = '0 km/h';
    document.getElementById('lap-timer').innerText = '';
    posCounter.innerText = '';
    lapCounter.innerText = 'Qualifying — warm-up lap';
    hideSplitHud();

    qualiTrackType = forceTrackType || document.getElementById('track-select').value;
    currentTrackKey = qualiTrackType;            // for the pause panel
    track = makeTrack(qualiTrackType);
    track.getRacingLine();
    track.leaderFinished = false;
    track.currentRaceTime = 0;
    qualiTrack = track;

    // The weekend's weather is decided here and reused for the race, so
    // qualifying and the race are never run in different conditions.
    // Already decided, before the tyre screen. Committing again is a no-op:
    // the point is that this line cannot come to a different answer than the
    // banner the player has just read.
    isRaining = commitWeather();

    let weatherIndicator = document.getElementById('weather-indicator');
    if (!weatherIndicator) {
        weatherIndicator = document.createElement('div');
        weatherIndicator.id = 'weather-indicator';
        // into the right-hand group of the bar, beside the buttons. It used
        // to be inserted before quitBtn as a child of #hud; quitBtn now lives
        // inside #hud-right, and insertBefore throws if the reference node is
        // not actually a child of the parent.
        (document.getElementById('hud-right') || hud).appendChild(weatherIndicator);
    }
    weatherIndicator.innerText = isRaining
        ? (wetLevel === 'soaked' ? 'Soaked 🌧️' : 'Damp 🌦️') : 'Dry ☀️';
    renderTyreIndicator(null);

    // AFTER the weather is decided, not before. This used to sit above the
    // block that sets isRaining, so a session got the PREVIOUS session's
    // weather: puddles appeared in dry qualifying and were missing in wet.
    if (typeof track.makePuddles === 'function') {
        track.puddles = [];
        if (isRaining) track.makePuddles(puddleCountFor(wetLevel));
    }

    applyDifficultyRules(isChampionship ? championshipState.difficulty
                                       : document.getElementById('difficulty-select').value);
    applySeasonRival();
    TOTAL_LAPS = 9999;              // the session ends on lap count, not the flag
    vscActive = false;
    vscEndsAt = null;
    vscPowerFactor = 1;
    recoveries = [];
    showVscBanner(false);
    stopSessionBtn.style.display = 'inline-block';
    stopSessionBtn.innerText = 'End Qualifying';
    timingTower.style.display = 'flex';
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
        track: trackLabel(qualiTrackType),
        laps: null,
        difficulty: isChampionship ? championshipState.difficulty
                                   : document.getElementById('difficulty-select').value,
        weather: isRaining ? (wetLevel === 'soaked' ? 'soaked' : 'damp') : 'dry',
        seed: isChampionship && championshipState ? championshipState.seed : null,
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
    // The chassis badge sits with the tyre: the two things about the car you
    // did not choose this lap and cannot change now.
    const ch = car.chassis || CHASSIS[CHASSIS_DEFAULT];
    el.innerHTML =
        '<span class="ch-pip" style="background:' + ch.accent + ';" title="' +
        ch.label + ' - ' + ch.line1 + '">' + ch.short + '</span>' +
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

    // One row: the card is a strip along the bottom, not a box in the corner.
    return `<span class="p-who" style="color:${car.color};">${humanLabel(car)}</span>` +
           `<span class="p-keys">${s.short}</span>${dead}` +
           `<span>${line1}</span>` +
           `<span class="p-speed">${Math.floor(speed * 0.5)} km/h</span>` +
           `<span class="p-line">${tyreHtml}</span>` +
           `<span style="color:${curCol};font-weight:bold;">${fmtLapMs(cur)}</span>` +
           `<span style="opacity:.6;">B ${fmtLapMs(car.bestLapTime)}</span>`;
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
        el.style.display = 'flex';
        el.style.borderTopColor = car.color;
        el.className = 'p-card';
        const pos = sortedCars ? sortedCars.indexOf(car) + 1 : 0;
        el.innerHTML = playerCardHtml(car, pos, sortedCars ? sortedCars.length : 0);
    }
}

// One line of character per compound, for the choice screen. The numbers above
// it say how quick; this says what it will feel like.
const TYRE_NOTE = {
    soft:   'quickest early, gone by the flag',
    medium: 'holds its shape',
    hard:   'slowest, and still there at the end',
    drift:  'the tail steps out on the throttle at any speed \u2014 lift and it pushes',
    inter:  'the quick wet tyre \u2014 no answer to a puddle',
    wet:    'slower, but it drives through standing water'
};

function tyreLapsText(key, laps) {
    // Free practice: unlimited running and no wear to speak of.
    if (!laps || !isFinite(laps)) return 'no wear in free practice';
    const t = TYRES[key];
    // Wear runs dryWear times faster on a road this tyre was not built for, so
    // the number on the button has to depend on the weather. A full wet reads
    // "lasts the distance" in the rain and "~1.5 of 5 laps" in the dry, which
    // is the whole of what makes choosing it a decision.
    // upcomingWeather(), not isRaining: the global is set when the session
    // STARTS, and this runs on the screen before it, so it was reading the
    // previous session's weather. Under a DAMP banner the intermediate read
    // '~0.5 of 2 laps' - its life at the dry-road wear rate.
    const dry = !upcomingWeather();
    const rate = dry ? (t.dryWear || 1) : 1;
    const life = t.life * laps / rate;
    return life >= laps ? 'lasts the distance'
                        : '~' + life.toFixed(1) + ' of ' + laps + ' laps';
}

// Each seat runs its own set. Two players choose one after the other, and
// nothing else in the game has to care how many choices were made.
function seatTyre(index) {
    return (index === 2 ? playerTyre2 : playerTyre) || 'medium';
}

// ---------------------------------------------------------------------------
//  THE WEATHER IS ONE DECISION, MADE ONCE
// ---------------------------------------------------------------------------
//  It used to be made inside startQualifying and startGame - which run AFTER
//  the tyre screen. So the screen where you choose your tyres was reading
//  `isRaining` left over from the previous session, and a wet round could ask
//  for tyres under a large banner reading DRY. Worse for a single race: the
//  20% roll had not happened yet, so no honest answer existed at that moment.
//
//  Now the decision is taken before the tyre screen and pinned in
//  `pendingWeather`, and everything downstream reads that. Same shape as
//  WET_GRIP: if two places have to agree about a fact, they read it from one
//  place instead of each working it out.
// A wet race is DAMP or SOAKED. Two thirds of them are damp: heavy rain should
// still feel like an event when it turns up.
const WET_KINDS = ['damp', 'damp', 'soaked'];
function rollWetKind(rand) {
    const r = rand || Math.random;
    return WET_KINDS[Math.floor(r() * WET_KINDS.length)];
}
// How many puddles each kind puts down. Fitted (puddlefit.js) either side of
// where the two rain tyres cross: measured, the full wet's advantage grows from
// +0.30% at no puddles to +4.41% at twelve, so the two kinds have to sit far
// enough apart to give different answers.
function puddleCountFor(kind, rand) {
    const r = rand || Math.random;
    return kind === 'soaked' ? 8 + Math.floor(r() * 5)    // 8-12
                             : 1 + Math.floor(r() * 3);   // 1-3
}

function decideWeather() {
    if (pendingWeather !== null) return pendingWeather;   // a weekend already fixed it
    if (isChampionship) return nextChampionshipWeather(); // pre-rolled with the calendar
    // The checkbox is read here rather than passed in: it used to be a local
    // const inside startQualifying and startGame, and moving the decision out
    // of those functions left it out of scope. A single source for the toggle
    // as well as for the answer.
    const box = document.getElementById('wet-race-checkbox');
    return (box && box.checked) ? true : (Math.random() < 0.20);
}
function commitWeather() {
    pendingWeather = decideWeather();
    // ...and WHICH KIND of wet, pinned at the same moment for the same reason.
    // wetLevel is read by the physics and by the AI through wetGripNow(), so it
    // has to be settled before either of them looks at it.
    if (!pendingWeather) { pendingWetLevel = null; }
    else if (pendingWetLevel === null) {
        pendingWetLevel = isChampionship ? nextChampionshipWetKind() : rollWetKind();
    }
    wetLevel = pendingWetLevel;
    return pendingWeather;
}

// The kind of wet the season rolled for this round, alongside the weather
// itself so the two cannot disagree.
function nextChampionshipWetKind() {
    if (!championshipState || !championshipState.wetKind) return rollWetKind();
    const k = championshipState.wetKind[championshipState.currentTrackIndex];
    return k || rollWetKind();
}

// What to call it on screen and in the log.
function weatherLabel() {
    if (!pendingWeather && !isRaining) return 'Dry';
    return wetLevel === 'soaked' ? 'Soaked' : (wetLevel === 'damp' ? 'Damp' : 'Wet');
}
// What the session you are about to start will be. Reading `isRaining` here is
// the bug; reading the committed decision is the fix.
function upcomingWeather() {
    return pendingWeather !== null ? pendingWeather
         : (typeof isRaining !== 'undefined' && isRaining);
}

function chooseTyres(title, subtitle, laps, done) {
    // Before the screen is drawn, not after it is answered.
    commitWeather();
    // NOBODY TO ASK. In spectator mode the race still needs its weather decided
    // - the AI has to know what it is driving on - but there is no player to
    // put tyres on, and the screen came up anyway, over a race that had already
    // started. chooseChassisForWeekend had this guard from the beginning and
    // chooseTyres never got one; two sibling functions, one of them asking a
    // question with no one in the room.
    if (!anyoneDriving()) { done(); return; }
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

    // THE WEATHER, IN A SIZE YOU CANNOT WALK PAST. It was already on the menu
    // as a small icon, and that was not enough - picking slicks for a wet race
    // is a 17% mistake with no way back, and it happened several times. It goes
    // here rather than anywhere else because this is the screen where the
    // decision is actually made.
    const tw = document.getElementById('tyre-weather');
    if (tw) {
        const wet = upcomingWeather();
        const soaked = wet && pendingWetLevel === 'soaked';
        tw.className = 'tw ' + (wet ? 'tw-wet' : 'tw-dry');
        tw.innerHTML = '<span class="tw-icon">' +
            (wet ? (soaked ? '🌧️' : '🌦️') : '☀️') + '</span>' +
            '<span class="tw-word">' +
            (wet ? (soaked ? 'SOAKED' : 'DAMP') : 'DRY') + '</span>' +
            // The consequence, and for a wet race that means WHICH rain tyre.
            // The two kinds differ in standing water and in grip, and those are
            // exactly what separates the intermediate from the full wet.
            '<span class="tw-note">' + (!wet
                ? 'slicks — rain tyres will destroy themselves'
                : (soaked
                    ? 'standing water everywhere — the full wet drives through it'
                    : 'barely any standing water — the intermediate keeps more steering'))
            + '</span>';
    }
    // In the rain the treaded compounds lead, in the dry the slicks do. Nothing
    // is hidden either way - a slick in the wet is a legitimate gamble and a
    // wet tyre in the dry is a legitimate mistake - but the list should not
    // open with the wrong half of it.
    const wetNow = upcomingWeather();   // the same answer the banner above gives
    const order = wetNow ? RAIN_TYRE_KEYS.concat(DRY_TYRE_KEYS)
                         : DRY_TYRE_KEYS.concat(RAIN_TYRE_KEYS);
    tyreOptions.innerHTML = order.map(k => {
        const t = TYRES[k];
        // The headline number used to be (grip - 1), and grip is the wrong
        // number to put on a button: it is nearly free in the dry, because the
        // binding cornering limit is the STEERING RATE. It also libelled the
        // drift compound, which reads -30% on grip and is level with the medium
        // on the stopwatch. What sets corner speed on a fresh set is grip x
        // bite, so that is what the button says.
        const pace = ((t.grip * (t.bite === undefined ? 1 : t.bite)) - 1) * 100;
        // And in the rain grip x bite is the wrong headline too. On a wet road
        // the lateral clamp really does bind - 0.13 of dry grip is low enough
        // that it is the limit rather than the steering rate - so what decides
        // corner speed is the tread, and that is what the button says.
        // And `grip x bite` is only the whole story for a compound whose
        // steering rate is the same in every corner. The drift tyre's is not:
        // it is 22% down flat and bought back by `hook` below 320 px/s, so the
        // single number would read -22% and libel a tyre that is 3% QUICKER
        // where the lap is made of slow corners. Two numbers when there are
        // two to give.
        const hookPace = t.hook
            ? ((t.grip * (t.bite === undefined ? 1 : t.bite) * (1 + t.hook)) - 1) * 100
            : null;
        const head = wetNow
            ? 'wet grip ×' + (t.rainGrip || 1).toFixed(2)
            : (hookPace !== null
                ? pace.toFixed(0) + '% fast corners, ' +
                  (hookPace >= 0 ? '+' : '') + hookPace.toFixed(0) + '% slow ones'
                : (pace >= 0 ? '+' : '') + pace.toFixed(1) + '% pace');
        const note = TYRE_NOTE[k] || '';
        return '<button class="tyre-opt" data-tyre="' + k + '">' +
            '<span class="tyre-dot" style="background:' + t.colour + ';"></span>' +
            '<span class="tyre-name">' + t.label + '</span>' +
            '<span class="tyre-stat">' + head + '</span>' +
            '<span class="tyre-stat">' + tyreLapsText(k, laps) + '</span>' +
            (note ? '<span class="tyre-stat">' + note + '</span>' : '') +
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

// Corners, counted from the circuit's own SEGMENTS rather than from the racing
// line. In canvas coordinates y points down, so a positive sweep is a RIGHT.
//
// The first version read the racing line and only counted a node as "curved
// enough to matter" if its local radius was under 500px. That is a threshold on
// the RACING LINE, and the racing line is precisely the thing that straightens
// corners out: it brakes wide, clips the apex and exits wide, so on a broad
// circuit a real 90-degree corner comes out with a radius well over 500 and was
// not counted at all. Rectangle - four square corners, and nobody would argue -
// was reported as having two, because two of its four had been relaxed past the
// threshold and two had not. It was not off by a rounding, it was silently
// dropping half the circuit.
//
// The segments have no such problem: they are the design. An arc is a corner. A
// run of arcs bending the same way with nothing between them is ONE corner, the
// way a double-apex is one corner; put a straight between them and they are
// two. The only judgement left is how much bend counts, and how long a straight
// has to be to separate two corners - and both of those are honest questions
// about the shape rather than artefacts of the measurement.
const CORNER_MIN_TURN = 0.35;   // ~20 degrees; less than that is a kink
const CORNER_SPLIT_RUN = 25;    // px of straight that separates two corners

function countCorners(track) {
    const segs = (track && track.segments) || [];
    if (!segs.length) return { left: 0, right: 0 };

    // signed heading change of an arc, which is its sweep
    const sweepOf = (g) => {
        let d = g.end - g.start;
        if (!g.ccw) { while (d <= 0) d += Math.PI * 2; while (d > Math.PI * 2) d -= Math.PI * 2; }
        else { while (d >= 0) d -= Math.PI * 2; while (d < -Math.PI * 2) d += Math.PI * 2; }
        return d;
    };

    // Start the walk on a straight wherever there is one, so a corner is never
    // cut in half by the seam. If the circuit is all arcs - Circle, Peanut -
    // the seam is closed at the end instead.
    let startAt = segs.findIndex(g => g.type === 'line' &&
        Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= CORNER_SPLIT_RUN);
    const allArcs = startAt < 0;
    if (allArcs) startAt = 0;

    let left = 0, right = 0, runTurn = 0, runSign = 0;
    let firstTurn = 0, firstSign = 0, opened = false;
    const close = () => {
        if (Math.abs(runTurn) > CORNER_MIN_TURN) { if (runSign > 0) right++; else left++; }
        runTurn = 0; runSign = 0;
    };
    for (let n = 0; n < segs.length; n++) {
        const g = segs[(startAt + n) % segs.length];
        if (g.type === 'line') {
            if (Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= CORNER_SPLIT_RUN) close();
            continue;
        }
        const d = sweepOf(g);
        const sign = Math.sign(d) || runSign;
        if (runSign !== 0 && sign !== runSign) close();
        if (runSign === 0) runSign = sign;
        runTurn += d;
        if (!opened) { opened = true; }
        if (n === 0) { firstTurn = runTurn; firstSign = runSign; }
    }
    // On an all-arc circuit the walk starts inside a corner, so the run still
    // open at the end is the same corner the walk began in - joining them, not
    // counting them twice, is what makes Circle one corner and not two.
    if (allArcs && runSign !== 0 && runSign === firstSign) {
        // already accumulated together, since nothing closed the run
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
    anchor: 'Anchor', arrow: 'Arrow', pentagon: 'Pentagon',
    oval: 'Oval', peanut: 'Peanut', f1: 'F1 Circuit', circomassimo: 'Circus Maximus',
    // 'quadrato' is the internal key and stays put: it is written into saved
    // championships and into every race log already on disk. Only the label
    // changed - the circuit has been a rounded rectangle since the world went
    // 16:9, and calling it Square was misleading.
    circle: 'Circle', serpent: 'Serpent', quadrato: 'Rectangle', triangle: 'Triangle',
    boomerang: 'Boomerang', zipper: 'Zipper', kettle: 'Kettle',
    harbour: 'Harbour', crossover: 'Crossover', kart: 'Kart',
    pettine: 'Comb', thunder: 'Thunder', crown: 'Crown'
};

// The three-letter code, written out rather than sliced off the label, for two
// reasons. Slicing a KEY is how `quadrato` came to appear as QUA in a season
// table whose every other column had been renamed years ago - the label had
// moved on and the abbreviation was still reading the internal name. And
// slicing the LABEL does not survive the circuits we have: Circle and Circus
// Maximus both give CIR, Crown and Crossover both give CRO.
const TRACK_CODES = {
    anchor: 'ANC', arrow: 'ARW', pentagon: 'PEN',
    oval: 'OVA', peanut: 'PEA', f1: 'F1C', circomassimo: 'CMX',
    circle: 'CIR', serpent: 'SER', quadrato: 'REC', triangle: 'TRI',
    boomerang: 'BOO', zipper: 'ZIP', kettle: 'KET',
    harbour: 'HAR', crossover: 'CRS', kart: 'KAR',
    pettine: 'COM', thunder: 'THU', crown: 'CRW'
};

// Every place a circuit is NAMED goes through these two. A raw key must never
// reach the screen or the log: it is storage, and it is allowed to be stale.
function trackLabel(key) { return TRACK_LABELS[key] || key || '?'; }
function trackCode(key) {
    if (TRACK_CODES[key]) return TRACK_CODES[key];
    return trackLabel(key).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

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
    const corners = countCorners(pTrack);
    const stats = measureTrackStats(pTrack, wet);

    document.getElementById('gp-title').innerText =
        `Round ${round}/${total} — ${trackLabel(trackType)}`;
    // Bigger than it was. The small version was walked past often enough to
    // cost races, and this is the screen you look at before every round.
    const gpKind = wet ? (championshipState && championshipState.wetKind
                         ? championshipState.wetKind[championshipState.currentTrackIndex]
                         : null) : null;
    document.getElementById('gp-weather').innerHTML =
        '<span class="gp-wx ' + (wet ? 'gp-wx-wet' : 'gp-wx-dry') + '">' +
        (wet ? ((gpKind === 'soaked' ? 'SOAKED 🌧️' : 'DAMP 🌦️')) : 'DRY ☀️') + '</span>' +
        // The seed sits with the round because this is the screen you look at
        // every race: whatever else you forget, the name of the season you are
        // in is in front of you, and it is what makes running it again possible.
        (championshipState && championshipState.seed
            ? ` <span class="gp-seed" title="Type this into Season seed to run this ` +
              `exact calendar again">season ${championshipState.seed}</span>` : '');

    // Mini-map: the real track, drawn scaled onto a small canvas.
    const map = document.getElementById('gp-map');
    const mctx = map.getContext('2d');
    // Only the arena, not the whole world: the left column is HUD, and a
    // mini-map with a 210px empty margin down one side is just a smaller map.
    const aw = ARENA_X1 - ARENA_X0, ah = ARENA_Y1 - ARENA_Y0;
    const sc = Math.min(map.width / aw, map.height / ah);
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, map.width, map.height);
    mctx.setTransform(sc, 0, 0, sc,
        (map.width - aw * sc) / 2 - ARENA_X0 * sc,
        (map.height - ah * sc) / 2 - ARENA_Y0 * sc);
    mctx.fillStyle = '#388E3C';
    mctx.fillRect(ARENA_X0, ARENA_Y0, aw, ah);
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

// ===========================================================================
//  EXPLORE  -  two reference screens off the menu.
//
//  Everything on them is COMPUTED, never a table typed alongside the game and
//  left to rot: the circuit numbers come from the circuit, the driver bars come
//  from AI_DRIVER_STYLES, and the lap records are measured by running the
//  game's own qualifying simulation when you open a card. A record that is
//  measured cannot disagree with the build it is printed in.
// ===========================================================================

const EX_DRIVER_NAMES = ['Ayrton Senna', 'Michael Schumacher', 'Lewis Hamilton',
    'Max Verstappen', 'Fernando Alonso', 'Sebastian Vettel', 'Alain Prost',
    'Jim Clark', 'Niki Lauda', 'Juan Manuel Fangio'];

// A line of prose per driver. The numbers below it are the truth; this is what
// the numbers add up to.
//
// These have been rewritten twice, and the second rewrite is the interesting
// one. Written first from the comments in AI_DRIVER_STYLES, they were then
// contradicted by the measurement - Senna slowest in the rain, Lauda quickest,
// the exact reverse of every profile - so they were rewritten to match the
// stopwatch. Then the cause turned up: ai.js was aiming at 0.20 of dry grip in
// the wet while car.js delivered 0.13, so the AI drove every wet corner 24%
// past the limit and the drivers who lean hardest on the car suffered most.
// With the two numbers agreeing and the wet column refitted on top, the
// original descriptions are true again, and these are them.
const EX_DRIVER_BLURB = {
    'Ayrton Senna': 'Blinding through the quick stuff and second to nobody but Schumacher in the rain. He gives it back on the straights, and he lives closer to the edge than anybody: by a distance the most mistakes on the grid.',
    'Alain Prost': 'The Professor. Almost never errs and is superb with the road to himself — and genuinely poor in the wet, and the most reluctant on the grid to go wheel to wheel.',
    'Michael Schumacher': 'A relentless metronome. Brutal on defence, brakes later than almost anyone, and the quickest of the ten when it rains. Nothing special once the road is clear, which is where the others take it back.',
    'Max Verstappen': 'The latest braker on the grid and he never yields an inch. That commitment is not free: he makes real mistakes, and he is mid-field at best in the wet.',
    'Lewis Hamilton': 'Thrives in a fight and reads the circuit further ahead than anyone else. Handy in the rain and the weakest of the ten with the road to himself: a racer rather than a time-triallist.',
    'Fernando Alonso': 'Unbeatable wheel to wheel. He will sit closer to your gearbox than anyone, will not be moved off a line, and is one of the three quickest in the wet. Ordinary once the road is clear.',
    'Sebastian Vettel': 'Devastating in clean air and down a straight. Give him the lead and he disappears; put him in traffic and he would rather wait than fight. The rain is not his weather.',
    'Jim Clark': 'Famously smooth — the gentlest hands here — and almost mistake-free, which is why he is quick in the wet. Passive in a fight, and that is what it costs him.',
    'Niki Lauda': 'The computer. Calculated risk, no heroics, no mistakes, and real speed down a straight. He has no pace at all in the rain, and he will not fight you for a place he can take later.',
    'Juan Manuel Fangio': 'Wins at the slowest speed necessary. No weakness anywhere and no standout either, which over a long calendar is its own kind of weapon.'
};

// The bars. Each is a value from the style table turned into a 0..1 fill, with
// the range chosen so the ten drivers actually spread across it - a bar where
// everyone sits at 80% tells you nothing. `inv` means low is good.
const EX_BARS = [
    { k: 'corner',   label: 'Cornering',  lo: 0.980, hi: 1.035 },
    { k: 'straight', label: 'Straights',  lo: 0.975, hi: 1.030 },
    { k: 'brake',    label: 'Late braking', lo: 0.86, hi: 1.20 },
    { k: 'cleanAir', label: 'Clean air',  lo: 0.995, hi: 1.016 },
    { k: 'overtake', label: 'Attacking',  lo: 0.68, hi: 1.02 },
    { k: 'defend',   label: 'Defending',  lo: 0.52, hi: 1.02 },
    { k: 'gap',      label: 'Sits close', lo: 1.28, hi: 0.70 },   // inverted on purpose
    { k: 'err',      label: 'Consistency', lo: 1.95, hi: 0.20 },  // inverted: fewer mistakes is better
    { k: 'steerTau', label: 'Smooth hands', lo: 0.68, hi: 1.48 }
];

function exBarFrac(v, b) {
    const f = (v - b.lo) / (b.hi - b.lo);
    return Math.max(0, Math.min(1, f));
}
function exBarColour(f) {
    // one hue ramp, so a long bar always reads as "more of this"
    return f > 0.72 ? '#7fe08a' : (f > 0.38 ? '#c9d36a' : '#e0a76a');
}

// WET WEATHER IS MEASURED, not read off the table.
//
// There is a `wet` column in AI_DRIVER_STYLES and it would be the obvious thing
// to put a bar on. It would also be wrong. That column is a CORRECTION, not an
// ability: a wet race is corner-dominated, so the corner/straight split already
// makes rain specialists on its own, and the column is only what lands the NET
// order where it is meant to be - which is why a rain expert can carry a number
// below 1. Ranking the drivers by it puts Prost near the top, and Prost is the
// one the profile calls poor in the rain.
//
// So the screen runs the laps instead: a dry one and a wet one for every
// driver, and ranks them on the wet time itself. See exWetFrac for why the
// wet-to-dry RATIO, which is the obvious measure, is also the wrong one.
//
// FOUR circuits, and they are the same four the wet balance was fitted on
// (wetfit.js). Two - Circle, one long corner, and Oval, mostly straight - were
// enough to show the shape, but not to agree with the fit: Clark came out
// fourth in the rain over four circuits and seventh over those two, because
// which circuits you pick is itself a wet-weather bias. A screen that reports
// a different order from the one the balance was set to is a screen arguing
// with the game.
const EX_WET_TRACKS = ['circle', 'oval', 'f1', 'serpent'];
const exWet = { done: 0, total: EX_DRIVER_NAMES.length * EX_WET_TRACKS.length * 2, by: {} };

// What the bar shows is ABSOLUTE pace in the rain, not the ratio of wet to dry.
//
// The ratio was the first thing tried and it is a trap: in the wet the corners
// collapse and the straights do not, so whoever spends most of the lap flat out
// keeps the highest fraction of their dry time. It ranked Lauda and Prost - the
// two straight-line specialists, and the two the profiles call poor in the rain
// - at the top, and Senna and Schumacher at the bottom. It was measuring how
// much straight a driver's lap contains.
//
// Who is quickest when it rains is the question a driver card is being asked,
// so that is what it answers: the wet lap time itself, over both circuits, as a
// gap to whoever is fastest.
// The gap is averaged PER CIRCUIT, not summed across them. Adding the two lap
// times together weights whichever circuit is longer, and the two are chosen
// precisely because they disagree - so the Oval, being the slower lap, would
// have quietly decided the ranking on its own and the answer would have been
// "who is quick on a straight" all over again.
function exWetGap(name) {
    const r = exWet.by[name];
    if (!r) return null;
    const gaps = [];
    for (const tk of EX_WET_TRACKS) {
        const mine = r[tk] && r[tk].wet;
        if (!mine) return null;
        const all = EX_DRIVER_NAMES.map(n => exWet.by[n] && exWet.by[n][tk] && exWet.by[n][tk].wet)
            .filter(Boolean);
        if (all.length < EX_DRIVER_NAMES.length) return null;
        const best = Math.min(...all);
        gaps.push((mine - best) / best);
    }
    return gaps.reduce((a, x) => a + x, 0) / gaps.length;
}
function exWetFrac(name) {
    const mine = exWetGap(name);
    if (mine === null) return null;
    const all = EX_DRIVER_NAMES.map(exWetGap);
    if (all.some(x => x === null)) return null;
    const best = Math.min(...all), worst = Math.max(...all);
    return { gap: mine, frac: worst > best ? (worst - mine) / (worst - best) : 0.5 };
}

function exMeasureWet(done) {
    if (exWet.done >= exWet.total) { if (done) done(); return; }
    const jobs = [];
    for (const tk of EX_WET_TRACKS)
        for (const wet of [false, true])
            for (const name of EX_DRIVER_NAMES) jobs.push({ name, wet, tk });
    const tracks = {};
    for (const tk of EX_WET_TRACKS) { tracks[tk] = makeTrack(tk); tracks[tk].getRacingLine(); }
    let i = 0;
    const step = () => {
        if (document.getElementById('explore-drivers').style.display === 'none') return;
        const t0 = performance.now();
        while (i < jobs.length && performance.now() - t0 < 45) {
            const j = jobs[i++];
            // pinned for the same reason as the records, on the middle
            // compound because this is a comparison between drivers rather
            // than a record attempt
            const ms = exPinnedTyre('medium', () =>
                simulateQualifyingLap(tracks[j.tk], j.name, 'alien', 1.1, j.wet, 'ridge'));
            exWet.done++;
            if (ms) {
                const r = exWet.by[j.name] = exWet.by[j.name] || {};
                (r[j.tk] = r[j.tk] || {})[j.wet ? 'wet' : 'dry'] = ms;
            }
        }
        exRenderDrivers();
        if (i < jobs.length) setTimeout(step, 0); else if (done) done();
    };
    setTimeout(step, 0);
}

// Strengths and weaknesses are not written down either: they are whatever this
// driver is furthest from the field on, in each direction.
function exDriverTags(name) {
    const s = AI_DRIVER_STYLES[name];
    if (!s) return { up: [], down: [] };
    const scored = EX_BARS.map(b => {
        const mine = exBarFrac(s[b.k], b);
        const others = EX_DRIVER_NAMES.filter(n => n !== name)
            .map(n => exBarFrac(AI_DRIVER_STYLES[n][b.k], b));
        const avg = others.reduce((a, x) => a + x, 0) / others.length;
        return { label: b.label, d: mine - avg };
    });
    // and the measured one, once it exists
    const w = exWetFrac(name);
    if (w) {
        const all = EX_DRIVER_NAMES.map(exWetFrac).filter(Boolean).map(x => x.frac);
        const avg = all.reduce((a, x) => a + x, 0) / all.length;
        scored.push({ label: 'Wet weather', d: w.frac - avg });
    }
    scored.sort((a, b) => b.d - a.d);
    return {
        up: scored.filter(x => x.d > 0.16).slice(0, 3).map(x => x.label),
        down: scored.filter(x => x.d < -0.16).slice(-3).map(x => x.label)
    };
}

function exDriverCardHtml(name) {
    const s = AI_DRIVER_STYLES[name];
    const tags = exDriverTags(name);
    const code = DRIVER_CODES[name] || name.slice(0, 3).toUpperCase();
    const bars = EX_BARS.map(b => {
        const f = exBarFrac(s[b.k], b);
        return `<div class="ex-bar-row"><span class="lab">${b.label}</span>` +
            `<span class="ex-bar"><i style="width:${(f * 100).toFixed(0)}%;` +
            `background:${exBarColour(f)};"></i></span>` +
            `<span class="num">${s[b.k].toFixed(b.hi > 1.1 || b.lo > 1.1 ? 2 : 3)}</span></div>`;
    }).join('');
    // the measured wet row sits with the others, marked as what it is
    const w = exWetFrac(name);
    const wetRow = w
        ? `<div class="ex-bar-row"><span class="lab">Wet weather</span>` +
          `<span class="ex-bar"><i style="width:${(w.frac * 100).toFixed(0)}%;` +
          `background:#64b5f6;"></i></span>` +
          `<span class="num">${w.gap < 0.0005 ? 'best' : '+' + (100 * w.gap).toFixed(1) + '%'}</span></div>`
        : `<div class="ex-bar-row"><span class="lab">Wet weather</span>` +
          `<span class="ex-bar"></span><span class="num" style="opacity:0.4;">&hellip;</span></div>`;
    return `<div class="ex-driver" style="border-left-color:${exDriverHue(name)};">` +
        `<div class="ex-code">${code}</div>` +
        `<h3>${name}</h3>` +
        `<div class="ex-blurb">${EX_DRIVER_BLURB[name] || ''}</div>` +
        `<div class="ex-tags">` +
        tags.up.map(t => `<span class="ex-tag up">${t}</span>`).join('') +
        tags.down.map(t => `<span class="ex-tag down">${t}</span>`).join('') +
        `</div>${bars}${wetRow}</div>`;
}
// A stable colour per driver, so a card is recognisable at a glance.
function exDriverHue(name) {
    const i = EX_DRIVER_NAMES.indexOf(name);
    return `hsl(${(i * 36 + 12) % 360}, 62%, 58%)`;
}

function exRenderDrivers() {
    const grid = document.getElementById('ex-driver-grid');
    if (!grid) return;
    const head = exWet.done < exWet.total
        ? `<div style="grid-column:1/-1;font-size:11px;opacity:0.5;">` +
          `running wet and dry laps to rank the rain &mdash; ${exWet.done} of ${exWet.total}</div>`
        : '';
    grid.innerHTML = head + EX_DRIVER_NAMES.map(exDriverCardHtml).join('');
}

function showExploreDrivers() {
    menu.style.display = 'none';
    document.getElementById('explore-drivers').style.display = 'block';
    exRenderDrivers();
    exMeasureWet();
}

// --- the circuits ----------------------------------------------------------

// Draw a circuit into a canvas, scaled to the arena. Used by both the little
// cards and the opened page.
function exDrawTrack(canvas, track) {
    const ctx = canvas.getContext('2d');
    const aw = ARENA_X1 - ARENA_X0, ah = ARENA_Y1 - ARENA_Y0;
    const sc = Math.min(canvas.width / aw, canvas.height / ah);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sc, 0, 0, sc,
        (canvas.width - aw * sc) / 2 - ARENA_X0 * sc,
        (canvas.height - ah * sc) / 2 - ARENA_Y0 * sc);
    ctx.fillStyle = '#2f6f36';
    ctx.fillRect(ARENA_X0, ARENA_Y0, aw, ah);
    track._stands = [];        // no crowd on a thumbnail
    track.puddles = [];
    track.draw(ctx);
}

// ===========================================================================
//  EXPLORE: THE RECORD BOOK
// ===========================================================================
//
//  Every lap time on these screens is measured by this build, not typed in.
//  It used to be measured LAZILY - open a circuit, watch thirty qualifying
//  laps run - which is wrong twice over: you wait every time, and the numbers
//  arrive piecemeal so two circuits are never comparable until both finish.
//
//  It is now one batch over every circuit, run once, and then kept. What the
//  batch covers was decided by measuring rather than guessing (qbench.js, six
//  circuits, ten drivers on each of the six compounds):
//
//    * in the DRY the soft sets the record on every circuit, all six of six.
//      On a single flying lap the tyre is fresh, and fresh is exactly where
//      `bite` puts the soft ahead of everything else - grip x bite 1.101
//      against the drift compound's 1.048 and the medium's 1.000. So only the
//      soft needs all ten drivers.
//    * in the WET the two rain compounds split it 3-3 - full wet at Oval, F1
//      and Circle, intermediate at Pettine, Harbour and Kart - because which
//      one wins is a question about the circuit. Both need all ten drivers.
//    * the other dry compounds never hold a record, but the ORDER they come in
//      is worth knowing before you pick one, so they are run once each with a
//      single driver. Same driver across all four, so the comparison is the
//      compound and nothing else.
//
//  Each job runs EX_RUNS times and keeps the best, because the AI makes
//  mistakes on purpose (`errorChance`) and one lap of a driver who erred is
//  not that driver's pace.
const EX_RUNS = 2;
const EX_ORDER_DRIVER = 'Ayrton Senna';
const exRecords = {};   // key -> { dry, wet, byTyre: {}, done, total }
const exBuild = { jobs: null, i: 0, done: 0, total: 0, running: false, t0: 0 };

// Records survive a reload where the browser allows it. Keyed by a fingerprint
// of the physics that produced them: change a tyre, a wet constant or an AI
// profile and the stored book is thrown away rather than quietly shown next to
// numbers it no longer matches. That has to be automatic - a record book that
// silently outlives the balance it measured is worse than no record book.
// L'impronta e' DUE impronte, e la ragione e' pratica. La prima versione ne
// aveva una sola, che sommava la fisica E la geometria di tutti i circuiti:
// aggiungere una pista - o toglierne una, o spostarne un vertice - buttava via
// il libro INTERO e faceva ricostruire milleduecento giri per diciotto
// circuiti che non erano cambiati. Nicola se ne e' accorto dal fatto che il
// libro si ricostruiva ogni volta che apriva "The Circuits", ed e' esattamente
// quello che succedeva: in quei giorni ogni build cambiava la geometria.
//
// Ora: la fisica (gomme, bagnato, profili IA, caratteri, EX_RUNS) e' globale e
// se cambia butta tutto, perche' un tempo misurato con altre gomme non e' un
// tempo. La geometria e' PER CIRCUITO, e invalida solo il suo. Aggiungere un
// diciannovesimo circuito ora costa i giri di quel circuito e basta.
function exPhysHash() {
    const bits = [JSON.stringify(TYRES), String(WET_GRIP),
                  JSON.stringify(AI_PROFILES.alien || {}),
                  JSON.stringify(AI_DRIVER_STYLES), String(EX_RUNS),
                  // the racing line is part of the physics of a lap: a new
                  // optimiser means new reference times
                  'line' + (typeof RACING_LINE_VERSION !== 'undefined' ? RACING_LINE_VERSION : 1),
                  // the yaw ceiling is physics: a lap driven under it is not
                  // the same lap (see the note in car.js update())
                  'yaw' + (typeof YAW_CAP !== 'undefined' ? YAW_CAP : 0)];
    return exHash(bits.join('|'));
}

// Sommata dai SEGMENTI, non dalla linea ideale: la linea costa 5-25ms per
// circuito a rilassarsi e questa gira a ogni salvataggio e a ogni caricamento,
// che sarebbe quasi un secondo per scoprire che non e' cambiato niente.
//
// La geometria ci deve stare: un tempo sul giro e' un fatto su una forma. Il
// pomeriggio in cui i tracciati sono stati scalati per entrare nell'arena,
// Comb ha perso il 4.6% della sua lunghezza e ogni tempo salvato per lui e'
// diventato il tempo di un circuito che non esisteva piu'.
function exGeomHash(key) {
    try {
        const t = makeTrack(key);
        if (typeof t.geomHash === 'function') return t.geomHash();
        let geom = t.trackWidth * 7 + t.grassWidth * 3;
        for (const s of t.segments)
            geom += s.type === 'line' ? (s.x1 + s.y1 + s.x2 + s.y2)
                                      : (s.cx + s.cy + s.r * 13);
        return exHash(geom.toFixed(1));
    } catch (e) { return 'x'; }
}

function exHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

function exFingerprint() {
    // The GEOMETRY belongs in here too, and it was missing. A record book is
    // lap times, and a lap time is a fact about a shape: the afternoon the
    // layouts were scaled to fit the arena, Comb lost 4.6% of its length and
    // every saved time for it became a time for a circuit that no longer
    // existed - and the book would have gone on showing them. That change was
    // reverted, but the hole it exposed was real.
    //
    // Summed from the SEGMENTS, not from the racing line: the racing line
    // costs 5-25ms per circuit to relax and this runs on every save and load,
    // which would be most of a second to notice that nothing has changed.
    return exPhysHash();
}
const EX_STORE_KEY = 'apex2.explore.records';

// ===========================================================================
//  YOUR OWN BESTS, BY CIRCUIT AND BY COMPOUND
// ===========================================================================
//
//  The one number nobody has ever measured about this game is how much a
//  compound is worth IN THE PLAYER'S HANDS. Every tyre in the table was
//  balanced against the AI, and the AI cannot use the drift compound at all -
//  it drives a computed speed profile and never provokes the car, so the drift
//  tyre measures 0.5 to 1.3% SLOW on all seventeen circuits when the AI holds
//  it, and quick enough to win championships when a person does.
//
//  So the game keeps your own best lap per circuit per compound, and shows the
//  gap. No special mode to run, no laps to set aside: play, and after a few
//  sessions the comparison is simply there.
// ---------------------------------------------------------------------------
//  THE SEASON SURVIVES A RELOAD
//  Personal bests, the record book and the season seed were already in
//  localStorage; the championship itself was not - close the tab at round
//  seven and the season was gone. championshipState is plain data end to end
//  (the seeded rng is consumed at creation, never stored), so the whole
//  thing serialises as it stands.
//
//  Saved at every checkpoint that changes it: when a round is entered (which
//  covers creation and the chassis picks, both of which funnel through
//  nextChampionshipRound) and when a race's points have been applied. The
//  save is cleared when the final standings are shown - a finished season is
//  a memory, not a resumable state - and simply overwritten when a new one
//  starts.
//
//  Resuming re-arms the three globals a season needs (isChampionship,
//  raceMode, the per-seat chassis) and walks in through the same door as
//  every other round: nextChampionshipRound, so the GP preview, skip flow
//  and standings all behave as if the tab had never closed. A save from a
//  season abandoned mid-picking has seats without cars; those are asked
//  again, with the same screen the season used the first time.
// ---------------------------------------------------------------------------
const CHAMP_STORE_KEY = 'apex2.championship';
function saveChampionship() {
    if (!championshipState) return;
    try {
        window.localStorage.setItem(CHAMP_STORE_KEY,
            JSON.stringify({ v: 1, state: championshipState }));
    } catch (e) { /* storage full or blocked: the season just is not saved */ }
    refreshChampResume();
}
function loadChampionshipSave() {
    try {
        const raw = window.localStorage.getItem(CHAMP_STORE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        const s = data && data.v === 1 && data.state;
        // enough shape-checking to refuse a save this build cannot drive
        if (!s || !Array.isArray(s.tracks) || !Array.isArray(s.participants) ||
            typeof s.currentTrackIndex !== 'number' || !s.points ||
            s.currentTrackIndex >= s.tracks.length) return null;
        // A calendar can name a circuit this build no longer has - Monaco was
        // added and then taken out again in the same afternoon. makeTrack()
        // would quietly hand back an Oval and the season table would print
        // "undefined" for the round, so the save is refused instead: better a
        // fresh season than one that lies about where it raced.
        if (!s.tracks.every(t => SEASON_POOL.indexOf(t) !== -1)) return null;
        return s;
    } catch (e) { return null; }
}
function clearChampionshipSave() {
    try { window.localStorage.removeItem(CHAMP_STORE_KEY); } catch (e) { }
    refreshChampResume();
}
// The saved season announces itself at the TOP of the menu, in its own
// banner, on every tab. It used to be a button in the main row - which on
// Nicola's window sat 736px down a scrollable menu, below the fold. He
// never saw it, pressed Start Championship instead, and the season he was
// running was replaced by a fresh one: same screens, same five rounds,
// every score back to zero at round two. That is the bug he reported, and
// the button's POSITION was half of it.
function refreshChampResume() {
    const bar = document.getElementById('champ-resume-banner');
    const det = document.getElementById('crb-detail');
    const s = loadChampionshipSave();
    if (bar) bar.hidden = !s;
    if (det && s) {
        const leader = Object.keys(s.points || {})
            .sort((a, b) => (s.points[b] || 0) - (s.points[a] || 0))[0];
        const who = leader && s.participants
            ? (s.participants.find(p => p.color === leader) || {})
            : null;
        det.textContent = 'Round ' + (s.currentTrackIndex + 1) + ' of ' +
            s.tracks.length + (leader
                ? ' — ' + (who && who.isPlayer ? 'you lead' :
                    ((who && who.driverName) || leader) + ' leads') +
                  ' on ' + (s.points[leader] || 0)
                : '');
    }
    disarmChampWipe();
}

// Starting a new championship over a saved one is destructive, so it asks.
// Not a browser dialog - the game has never used one - but the button
// itself: the first press turns it into the warning, the second goes
// through, and it disarms itself after a few seconds or if you touch
// anything else.
let champWipeArmed = 0;
function disarmChampWipe() {
    const btn = document.getElementById('champ-btn');
    if (champWipeArmed) clearTimeout(champWipeArmed);
    champWipeArmed = 0;
    if (btn) {
        btn.textContent = 'Start Championship';
        btn.classList.remove('menu-danger');
    }
}
function resumeChampionship() {
    disarmChampWipe();
    const s = loadChampionshipSave();
    if (!s) { refreshChampResume(); return; }
    championshipState = s;
    isChampionship = true;
    raceMode = 'championship';
    pendingGrid = null;
    pendingWeather = null; pendingWetLevel = null;
    skipMode = false; skipPlayer = null; skipPlayers = [];
    const ch = championshipState.chassis || (championshipState.chassis = {});
    if (ch[1]) playerChassis = ch[1];
    if (ch[2]) playerChassis2 = ch[2];
    menu.style.display = 'none';
    const unpicked = championshipState.participants
        .some(p => p.isPlayer && !p.chassis);
    if (unpicked) chooseChassisForSeason(() => nextChampionshipRound());
    else nextChampionshipRound();
}

// ---------------------------------------------------------------------------
//  THE GHOST
//  Practice used to be a lap with nobody to measure against until the tower
//  updated; now your best lap DRIVES. In practice and qualifying the
//  player's laps are recorded - position and heading each frame, stamped
//  with lap time - and the best one is replayed as a pale silhouette that
//  sets off every time you cross the line. Beat it and the new lap takes
//  its place on the spot: the ghost you chase is always the fastest you
//  have ever been on this circuit, in this weather.
//
//  Recorded by TIME, not by frame: a trace replayed frame-by-frame would
//  run faster on a fast machine. Samples carry their lap-clock timestamp
//  and are resampled to a fixed 30Hz grid on save (rounded to a tenth of a
//  pixel), so a 25-second lap costs about 20KB and playback interpolates
//  on the same clock the lap timer uses. Dry and wet are separate ghosts -
//  a wet best is a different sport - and the race never shows one: the
//  ghost is a training partner, not an eleventh car.
// ---------------------------------------------------------------------------
const GHOST_STORE_KEY = 'apex2.ghost.laps';
const GHOST_HZ = 30;
let ghostStore = null;    // lazy: { "track:dry": {v, ms, hz, data:[x,y,a...]} }
let ghostS = null;        // per-session state
// The orientation is part of the key: a trace recorded before a circuit
// was mirrored would replay through the mirrored world like a wrong-way
// driver. Times transfer (the circuit is congruent); coordinates do not.
function ghostKeyFor(trackKey, wet) { return trackKey + ':' + (wet ? 'wet' : 'dry'); }
function ghostTrackKey(t) { return trackKeyOf(t) + (t && t.mirrored ? '~acw' : ''); }
function loadGhostStore() {
    if (ghostStore) return ghostStore;
    ghostStore = {};
    try {
        const raw = window.localStorage.getItem(GHOST_STORE_KEY);
        if (raw) ghostStore = JSON.parse(raw) || {};
    } catch (e) { }
    return ghostStore;
}
function ghostFor(trackKey, wet) {
    const g = loadGhostStore()[ghostKeyFor(trackKey, wet)];
    return (g && g.v === 1 && Array.isArray(g.data) && g.data.length >= 6 &&
            g.hz > 0 && g.ms > 1000) ? g : null;
}
// timestamped [t,x,y,a, ...] -> fixed-rate [x,y,a, ...] on the 30Hz grid
function ghostResample(samples, ms) {
    const n = Math.max(2, Math.round(ms / 1000 * GHOST_HZ) + 1);
    const out = new Array(n * 3);
    let j = 0;
    const S = samples.length;
    for (let k = 0; k < n; k++) {
        const t = Math.min(ms, k * 1000 / GHOST_HZ);
        while (j + 4 < S - 4 && samples[j + 4] <= t) j += 4;
        const t0 = samples[j], t1 = samples[j + 4] !== undefined ? samples[j + 4] : t0 + 1;
        const f = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-6, t1 - t0)));
        const x = samples[j + 1] + (samples[j + 5] - samples[j + 1]) * f;
        const y = samples[j + 2] + (samples[j + 6] - samples[j + 2]) * f;
        let a0 = samples[j + 3], da = samples[j + 7] - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        out[k * 3]     = Math.round((x) * 10) / 10;
        out[k * 3 + 1] = Math.round((y) * 10) / 10;
        out[k * 3 + 2] = Math.round((a0 + da * f) * 100) / 100;
    }
    return out;
}
function saveGhostLap(trackKey, wet, ms, samples) {
    const store = loadGhostStore();
    store[ghostKeyFor(trackKey, wet)] = { v: 1, ms: Math.round(ms), hz: GHOST_HZ,
                                          data: ghostResample(samples, ms) };
    try { window.localStorage.setItem(GHOST_STORE_KEY, JSON.stringify(store)); }
    catch (e) { /* storage full: this lap is simply not kept */ }
}
function ghostTick() {
    const on = gameState === 'playing' &&
        (raceMode === 'practice' || raceMode === 'qualifying') &&
        playerCar && track;
    if (!on) { ghostS = null; return; }
    if (!ghostS || ghostS.track !== track) {
        ghostS = { track: track, wet: !!isRaining, lastLap: playerCar.lap, rec: null,
                   best: ghostFor(ghostTrackKey(track), !!isRaining) };
    }
    if (playerCar.lap !== ghostS.lastLap) {
        // the line was just crossed inside updatePhysics: the buffer holds
        // the finished lap, playerCar.lastLapTime its official time
        const r = ghostS.rec;
        if (playerCar.lap === ghostS.lastLap + 1 && r && r.length >= 240 &&
            r[0] < 120 && playerCar.lastLapTime && playerCar.lastLapTime > 3000 &&
            (!ghostS.best || playerCar.lastLapTime < ghostS.best.ms)) {
            saveGhostLap(ghostTrackKey(track), ghostS.wet, playerCar.lastLapTime, r);
            ghostS.best = ghostFor(ghostTrackKey(track), ghostS.wet);
        }
        ghostS.rec = null;
        ghostS.lastLap = playerCar.lap;
    }
    if (playerCar.isBroken) { ghostS.rec = null; return; }
    const t = track.currentRaceTime - playerCar.lapStartTime;
    if (t >= 0) {
        if (!ghostS.rec) { if (t < 120) ghostS.rec = []; else return; }
        ghostS.rec.push(t, playerCar.x, playerCar.y, playerCar.angle);
    }
}
function drawGhostCar(g) {
    if (!ghostS || !ghostS.best || !playerCar || playerCar.lap < 1) return;
    const gb = ghostS.best;
    const t = track.currentRaceTime - playerCar.lapStartTime;
    const n = gb.data.length / 3;
    if (!(t >= 0) || n < 2) return;
    const tf = t / 1000 * gb.hz;
    if (tf > n - 1) return;                    // its lap is done; yours is not
    const k = Math.min(n - 2, Math.floor(tf)), f = Math.min(1, tf - k);
    const i3 = k * 3, j3 = i3 + 3;
    const x = gb.data[i3] + (gb.data[j3] - gb.data[i3]) * f;
    const y = gb.data[i3 + 1] + (gb.data[j3 + 1] - gb.data[i3 + 1]) * f;
    let da = gb.data[j3 + 2] - gb.data[i3 + 2];
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const a = gb.data[i3 + 2] + da * f;
    // A pale outline in the car's 24x14 box: unmistakably not a rival - no
    // shadow, no tag, no collision, drawn under the real cars.
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.globalAlpha = 0.36;
    g.fillStyle = '#eaf5ff';
    g.beginPath(); g.roundRect(-12, -7, 24, 14, 4); g.fill();
    g.fillStyle = '#8fb8d8';
    g.fillRect(-12, -6, 4, 12);
    g.fillRect(8, -5, 4, 10);
    g.globalAlpha = 0.6;
    g.lineWidth = 1.2;
    g.strokeStyle = '#ffffff';
    g.beginPath(); g.roundRect(-12, -7, 24, 14, 4); g.stroke();
    g.restore();
}

const PB_STORE_KEY = 'apex2.player.bests';
let playerBests = null;         // { trackKey: { tyreKey: { ms, when, wet } } }

function pbLoad() {
    if (playerBests) return playerBests;
    playerBests = {};
    try {
        const raw = window.localStorage.getItem(PB_STORE_KEY);
        if (raw) playerBests = JSON.parse(raw) || {};
    } catch (e) { /* no storage: the table just lives for this session */ }
    return playerBests;
}
function pbSave() {
    try { window.localStorage.setItem(PB_STORE_KEY, JSON.stringify(playerBests || {})); }
    catch (e) { /* as above */ }
}

// Called with a completed lap. Wet and dry are kept apart - a wet lap next to a
// dry one in the same column would make the compound look like the cause of a
// difference the weather made.
function pbRecord(trackKey, tyreKey, ms, wet) {
    if (!trackKey || !tyreKey || !ms || !isFinite(ms)) return;
    const all = pbLoad();
    const slot = wet ? tyreKey + ':wet' : tyreKey;
    const t = all[trackKey] || (all[trackKey] = {});
    if (!t[slot] || ms < t[slot].ms) {
        t[slot] = { ms: ms, when: Date.now(), wet: !!wet };
        pbSave();
    }
}

function exSaveRecords() {
    try {
        const out = {};
        for (const k of Object.keys(exRecords)) {
            const r = exRecords[k];
            if (r.done >= r.total && (r.dry || r.wet))
                out[k] = { dry: r.dry, wet: r.wet, byTyre: r.byTyre, g: exGeomHash(k) };
        }
        window.localStorage.setItem(EX_STORE_KEY,
            JSON.stringify({ v: exPhysHash(), tracks: out }));
    } catch (e) { /* file:// origins, private mode, quota - all fine, just slower */ }
}
function exLoadRecords() {
    try {
        const raw = window.localStorage.getItem(EX_STORE_KEY);
        if (!raw) return false;
        const box = JSON.parse(raw);
        if (!box || box.v !== exPhysHash()) return false;   // altra fisica: si butta tutto
        let n = 0;
        for (const k of Object.keys(box.tracks || {})) {
            if (SEASON_POOL.indexOf(k) === -1) continue;    // circuito non piu' nel gioco
            const r = box.tracks[k];
            if (!r || r.g !== exGeomHash(k)) continue;      // quel tracciato e' cambiato
            exRecords[k] = { dry: r.dry, wet: r.wet, byTyre: r.byTyre || {},
                             done: 1, total: 1 };
            n++;
        }
        return n > 0;
    } catch (e) { return false; }
}

// Every lap this build needs to run, for every circuit, in one list.
function exBuildJobs(keys) {
    const jobs = [];
    for (const key of (keys && keys.length ? keys : SEASON_POOL)) {
        for (let run = 0; run < EX_RUNS; run++) {
            for (const name of EX_DRIVER_NAMES)
                jobs.push({ key, name, wet: false, tyre: 'soft', rec: true });
            for (const tyre of RAIN_TYRE_KEYS)
                for (const name of EX_DRIVER_NAMES)
                    jobs.push({ key, name, wet: true, tyre, rec: true });
            for (const tyre of DRY_TYRE_KEYS)
                jobs.push({ key, name: EX_ORDER_DRIVER, wet: false, tyre, rec: false });
        }
    }
    return jobs;
}

function exStartBuild() {
    if (exBuild.running) return;
    // Solo i circuiti che mancano davvero: quelli caricati dal libro salvato
    // restano dove sono. Un circuito nuovo costa i suoi giri, non quelli di
    // tutti e diciotto.
    const missing = SEASON_POOL.filter(k => {
        const r = exRecords[k];
        return !r || r.done < r.total || (!r.dry && !r.wet);
    });
    if (!missing.length) return;
    exBuild.jobs = exBuildJobs(missing);
    exBuild.i = 0; exBuild.done = 0; exBuild.total = exBuild.jobs.length;
    exBuild.running = true; exBuild.t0 = performance.now();
    for (const key of missing)
        exRecords[key] = { dry: null, wet: null, byTyre: {}, done: 0, total: 0 };
    for (const j of exBuild.jobs) exRecords[j.key].total++;
    exStep();
}

// Time-sliced so the page stays alive: this is over a thousand qualifying laps
// and it runs while you read the cards, not instead of it. 12 ms rather than
// the 45 the lazy version used - it is background work now, so it should give
// way to the interface rather than compete with it.
function exStep() {
    if (!exBuild.running) return;
    const t0 = performance.now();
    const tracks = {};
    while (exBuild.i < exBuild.jobs.length && performance.now() - t0 < 12) {
        const j = exBuild.jobs[exBuild.i++];
        const qt = tracks[j.key] || (tracks[j.key] = (() => {
            const t = makeTrack(j.key); t.getRacingLine(); return t;
        })());
        const ms = exPinnedTyre(j.tyre, () =>
            simulateQualifyingLap(qt, j.name, 'alien', 1.1, j.wet, 'ridge'));
        const rec = exRecords[j.key];
        rec.done++; exBuild.done++;
        if (!ms) continue;
        if (j.rec) {
            const slot = j.wet ? 'wet' : 'dry';
            if (!rec[slot] || ms < rec[slot].ms)
                rec[slot] = { ms, who: j.name, tyre: j.tyre };
        }
        if (!rec.byTyre[j.tyre] || ms < rec.byTyre[j.tyre]) rec.byTyre[j.tyre] = ms;
    }
    exRenderBuildProgress();
    if (document.getElementById('ex-rec')) exRenderRecords(exOpenKey);
    if (exBuild.i < exBuild.jobs.length) { setTimeout(exStep, 0); return; }
    exBuild.running = false;
    exSaveRecords();
    exRenderBuildProgress();
    if (document.getElementById('ex-rec')) exRenderRecords(exOpenKey);
}

function exRenderBuildProgress() {
    const el = document.getElementById('ex-tracks-sub');
    if (!el) return;
    if (!exBuild.running) {
        el.innerHTML = SEASON_POOL.length + ' of them. Pick one.' +
            (exBuild.total ? ' <span style="opacity:0.55;">Record book built from ' +
                exBuild.total.toLocaleString() + ' qualifying laps.</span>' : '');
        return;
    }
    const f = exBuild.done / Math.max(1, exBuild.total);
    el.innerHTML = SEASON_POOL.length + ' of them. Pick one. ' +
        '<span style="opacity:0.6;">Running the record book &mdash; ' +
        exBuild.done + ' of ' + exBuild.total + ' qualifying laps' +
        '</span><span class="ex-build-bar"><i style="width:' +
        (f * 100).toFixed(1) + '%"></i></span>';
}

// Run something with every driver on the same rubber. Both measurements on
// these screens compare drivers with each other, and chooseTyre is random by
// design, so without this the comparison is partly a coin toss.
function exPinnedTyre(key, fn) {
    const real = AI.chooseTyre;
    AI.chooseTyre = () => key;
    try { return fn(); } finally { AI.chooseTyre = real; }
}

function exTrackStats(track) {
    const line = track.getRacingLine();
    const corners = countCorners(track);
    return { line, corners };
}

function exShowTrackList() {
    const grid = document.getElementById('ex-track-grid');
    const detail = document.getElementById('ex-track-detail');
    if (detail) detail.style.display = 'none';
    if (!grid) return;
    grid.style.display = 'grid';
    grid.innerHTML = '';
    for (const key of SEASON_POOL) {
        const btn = document.createElement('button');
        btn.className = 'ex-card';
        const cv = document.createElement('canvas');
        cv.width = 200; cv.height = 140;
        btn.appendChild(cv);
        const t = makeTrack(key);
        exDrawTrack(cv, t);
        const line = t.getRacingLine();
        const name = document.createElement('div');
        name.className = 'ex-name';
        name.innerText = trackLabel(key);
        const meta = document.createElement('div');
        meta.className = 'ex-meta';
        meta.innerText = (line.length / 1000).toFixed(2) + ' km';
        btn.appendChild(name);
        btn.appendChild(meta);
        btn.addEventListener('click', () => exOpenTrack(key));
        grid.appendChild(btn);
    }
}

let exOpenKey = null;      // which circuit's card is on screen, for live updates

function exOpenTrack(key) {
    const grid = document.getElementById('ex-track-grid');
    const detail = document.getElementById('ex-track-detail');
    if (!detail) return;
    exOpenKey = key;
    grid.style.display = 'none';
    detail.style.display = 'block';

    const track = makeTrack(key);
    const { line, corners } = exTrackStats(track);
    const dry = measureTrackStats(track, false);
    const wet = measureTrackStats(track, true);
    // Kept so the record box can put a number on the difference between race
    // pace and a record lap, on this circuit, rather than leaving the reader to
    // wonder why the two figures disagree. It is not a constant: Circle, which
    // is nothing but corners, is +28%, while Kart is +9%.
    if (exRecords[key]) exRecords[key].pace = dry.lap;

    // "Est. lap" was the wrong name and it showed: the figure reads several
    // seconds slower than the lap record below it, and nothing said why. They
    // are not the same measurement and neither is wrong. RACE PACE is what a
    // hard-difficulty car does on mediums with a stint's worth of fuel in the
    // tyre; the RECORD is an alien on a fresh soft with nothing to save. The
    // gap between them is the difference between driving a race and setting a
    // time, which is a real thing, so both are shown and both are labelled.
    const cells = [
        ['Length', (line.length / 1000).toFixed(2) + ' km'],
        ['Corners', String(corners.left + corners.right)],
        ['Left / Right', corners.left + ' L / ' + corners.right + ' R'],
        ['Road width', Math.round(track.trackWidth * 2) + ' m'],
        ['Top speed', Math.round(dry.vmax * 0.5) + ' km/h'],
        ['Race pace, dry', dry.lap ? (dry.lap / 1000).toFixed(1) + 's' : '—'],
        ['Race pace, wet', wet.lap ? (wet.lap / 1000).toFixed(1) + 's' : '—'],
        ['Wet penalty', (dry.lap && wet.lap)
            ? '+' + (100 * (wet.lap - dry.lap) / dry.lap).toFixed(0) + '%' : '—'],
        ['Tightest corner', Math.round(exTightest(track)) + ' m']
    ];

    detail.innerHTML =
        `<div class="ex-d-head"><h2>${trackLabel(key)}</h2>` +
        `<button id="ex-track-list-btn" style="width:auto;margin:0;padding:6px 14px;` +
        `font-size:12px;background:#37474f;color:#cfd8dc;">All circuits</button></div>` +
        `<div class="ex-d-body">` +
        `<canvas id="ex-d-map" width="380" height="266"></canvas>` +
        `<div class="ex-d-side">` +
        `<div class="ex-grid">` +
        cells.map(c => `<div class="ex-cell"><div class="ex-k">${c[0]}</div>` +
            `<div class="ex-v">${c[1]}</div></div>`).join('') +
        `</div>` +
        `<div class="ex-note">Race pace is a hard-difficulty car on mediums, ` +
        `driving a stint. The records below are one flying lap on fresh softs ` +
        `at alien pace &mdash; a different thing, and quicker by 10 to 30% ` +
        `depending on the circuit.</div>` +
        `<div class="ex-rec" id="ex-rec"></div>` +
        `</div></div>`;

    exDrawTrack(document.getElementById('ex-d-map'), track);
    document.getElementById('ex-track-list-btn')
        .addEventListener('click', exShowTrackList);
    exRenderRecords(key);
}

// The tightest corner on the circuit, as a radius. Read off the racing line,
// because that is the radius a car actually has to take.
function exTightest(track) {
    const line = track.getRacingLine();
    let r = Infinity;
    for (let i = 0; i < line.count; i++) {
        const v = line.nodes[i].radius;
        if (v < r) r = v;
    }
    return Math.min(r, 9999);
}

function exRenderRecords(key) {
    const box = document.getElementById('ex-rec');
    if (!box) return;
    const rec = exRecords[key];
    const row = (cls, label, r) => {
        if (!r || !r.ms) return `<div class="ex-rec-row ${cls}"><span class="who">${label}</span>` +
            `<span class="t">—</span></div>`;
        const t = TYRES[r.tyre];
        const dot = t ? `<span class="ex-rec-tyre" style="background:${t.colour};" ` +
            `title="${t.label}"></span>` : '';
        return `<div class="ex-rec-row ${cls}"><span class="who">${label} &mdash; ` +
            `${r.who}${dot}</span><span class="t">${(r.ms / 1000).toFixed(3)}</span></div>`;
    };
    let html = `<div class="ex-rec-h">Lap record</div>` +
        row('ex-rec-dry', 'Dry', rec && rec.dry) +
        row('ex-rec-wet', 'Wet', rec && rec.wet);
    if (rec && rec.pace && rec.dry && rec.dry.ms) {
        const gap = 100 * (rec.pace - rec.dry.ms) / rec.dry.ms;
        html += `<div class="ex-rec-gap">Race pace above is +${gap.toFixed(0)}% ` +
            `on this circuit &mdash; different car, different tyre, different day.</div>`;
    }

    // The order the compounds come in on THIS circuit, one driver on each so
    // the only thing varying is the rubber. The soft holds every dry record in
    // the game, but by how much is a circuit question, and the drift compound's
    // place in the order moves about more than anything else.
    const bt = (rec && rec.byTyre) || {};
    const have = DRY_TYRE_KEYS.filter(k => bt[k]);
    if (have.length > 1) {
        const best = Math.min(...have.map(k => bt[k]));
        html += `<div class="ex-rec-h" style="margin-top:12px;">One lap, by compound</div>`;
        html += have.sort((a, b) => bt[a] - bt[b]).map(k => {
            const d = 100 * (bt[k] - best) / best;
            return `<div class="ex-tyre-row">` +
                `<span class="ex-rec-tyre" style="background:${TYRES[k].colour};"></span>` +
                `<span class="n">${TYRES[k].label}</span>` +
                `<span class="t">${(bt[k] / 1000).toFixed(3)}</span>` +
                `<span class="d">${d < 0.001 ? '&mdash;' : '+' + d.toFixed(1) + '%'}</span>` +
                `</div>`;
        }).join('');
    }

    // ---- and the same table for YOU -------------------------------------
    // The point of the whole exercise. The AI's ordering above says what the
    // compounds are worth to a driver that never provokes the car; this one
    // says what they are worth to you, which is a different question and the
    // one the balance actually has to answer.
    const pb = pbLoad()[key] || {};
    const mine = Object.keys(pb).filter(s => pb[s] && pb[s].ms);
    if (mine.length) {
        const bestMine = Math.min(...mine.map(s => pb[s].ms));
        html += `<div class="ex-rec-h" style="margin-top:12px;">Your best, by compound</div>`;
        html += mine.sort((a, b) => pb[a].ms - pb[b].ms).map(slot => {
            const wet = slot.indexOf(':wet') > 0;
            const k = wet ? slot.slice(0, -4) : slot;
            const t = TYRES[k];
            if (!t) return '';
            const d = 100 * (pb[slot].ms - bestMine) / bestMine;
            return `<div class="ex-tyre-row">` +
                `<span class="ex-rec-tyre" style="background:${t.colour};"></span>` +
                `<span class="n">${t.label}${wet ? ' <i style="opacity:0.6;">wet</i>' : ''}</span>` +
                `<span class="t">${(pb[slot].ms / 1000).toFixed(3)}</span>` +
                `<span class="d">${d < 0.001 ? '&mdash;' : '+' + d.toFixed(1) + '%'}</span>` +
                `</div>`;
        }).join('');
        if (mine.length < 2)
            html += `<div class="ex-rec-foot">one compound so far &mdash; ` +
                `drive a lap on another and the comparison appears here</div>`;
    }

    if (exBuild.running) {
        const f = exBuild.done / Math.max(1, exBuild.total);
        html += `<div class="ex-progress"><i style="width:${(f * 100).toFixed(1)}%"></i></div>` +
            `<div class="ex-rec-foot">building the record book &mdash; ` +
            `${exBuild.done} of ${exBuild.total} qualifying laps, all ` +
            `${SEASON_POOL.length} circuits at once</div>`;
    } else {
        html += `<div class="ex-rec-foot">` +
            `every driver, ${EX_RUNS} laps each, best kept &mdash; soft in the dry, ` +
            `both rain compounds in the wet</div>`;
    }
    box.innerHTML = html;
}

function showExploreTracks() {
    // Try the stored book first; if it is missing or was measured by a
    // different balance, build it - once, for every circuit, in the background
    // while you read. Opening a card never starts a simulation any more.
    if (!Object.keys(exRecords).length) exLoadRecords();
    exShowTrackList();
    menu.style.display = 'none';
    document.getElementById('explore-tracks').style.display = 'block';
    exStartBuild();
    exRenderBuildProgress();
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
    hud.style.display = skipMode ? 'none' : 'block';
    layoutStage();
    if (isMobile) mobileControls.style.display = skipMode ? 'none' : 'flex';
    
    // Reset effects
    globalSkidMarks = [];
    globalParticles = [];
    
    document.getElementById('dnf-timer').style.visibility = 'hidden';
    
    // If a qualifying session has just run, the weekend's weather was decided
    // there and the race has to inherit it - you cannot qualify in the wet and
    // then race in the dry. Otherwise: championship uses the pre-rolled season
    // weather, a single race uses the toggle or a 20% chance. All of that is
    // decideWeather's job now, and it has already been asked once before the
    // tyre screen, so this line only reads the answer back.
    isRaining = commitWeather();

    // UI for weather.
    // A normal flex child of the HUD, not an absolutely positioned overlay:
    // pinned at right:150px it sat exactly where the DNF timer lands once the
    // lap timer is in the row, and the two texts overlapped.
    let weatherIndicator = document.getElementById('weather-indicator');
    if (!weatherIndicator) {
        weatherIndicator = document.createElement('div');
        weatherIndicator.id = 'weather-indicator';
        // into the right-hand group of the bar, beside the buttons. It used
        // to be inserted before quitBtn as a child of #hud; quitBtn now lives
        // inside #hud-right, and insertBefore throws if the reference node is
        // not actually a child of the parent.
        (document.getElementById('hud-right') || hud).appendChild(weatherIndicator);
    }
    weatherIndicator.innerText = isRaining
        ? (wetLevel === 'soaked' ? 'Soaked 🌧️' : 'Damp 🌦️') : 'Dry ☀️';
    
    // updateHUD only runs while playing, so anything left in these readouts
    // survives into the countdown: after qualifying the speedometer sat on
    // the last speed of the flying lap for the whole grid sequence.
    speedometer.innerText = '0 km/h';
    document.getElementById('lap-timer').innerText = '';
    posCounter.innerText = '';
    lapCounter.innerText = '';

    const isPractice = raceMode === 'practice';
    stopSessionBtn.style.display = isPractice ? 'inline-block' : 'none';
    timingTower.style.display = isPractice ? 'none' : 'flex';
    timingTower.innerHTML = '';

    // Free practice: unlimited running, no opponents, no flag.
    TOTAL_LAPS = isPractice ? 9999 : parseInt(document.getElementById('laps-select').value, 10);

    vscActive = false;

    vscEndsAt = null;
    vscPowerFactor = 1;
    recoveries = [];
    showVscBanner(false);
    const trackType = forceTrackType || document.getElementById('track-select').value;
    currentTrackKey = trackType;                 // for the pause panel
    lastRunningOrder = [];
    const color = document.getElementById('color-select').value;
    const difficulty = document.getElementById('difficulty-select').value;
    applyDifficultyRules(isChampionship ? championshipState.difficulty : difficulty);
    applySeasonRival();

    track = makeTrack(trackType);

    // Pre-compute the AI racing line here (a few ms) so the very first racing
    // frame doesn't stutter while building it lazily.
    if (typeof track.getRacingLine === 'function') track.getRacingLine();

    // Standing water, only when it is raining. Fresh every race.
    if (typeof track.makePuddles === 'function') {
        track.puddles = [];
        if (isRaining) track.makePuddles(puddleCountFor(wetLevel));
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
                lap: AI.qualifyingPace(p.driverName, aiDifficulty, p.skillVariation,
                                       isRaining, p.isPlayer ? seatChassis(p.playerIndex || 1) : p.chassis)
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
    pendingWeather = null; pendingWetLevel = null;

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
        // The chassis, before anything else touches the physics: it rewrites
        // enginePower, maxSteer, baseGrip, drag and tyre wear.
        car.setChassis(p.isPlayer ? seatChassis(car.playerIndex)
                                  : (p.chassis || CHASSIS_DEFAULT));
        car.gridIndex = i;              // stable tie-break before anyone moves
        car.startGridPos = i + 1;       // for the places-gained bonus

        // Tyres. The player has just chosen; each AI picks from its own style,
        // so the grid is a mix rather than ten cars on the same rubber.
        car._lapPixels = track.getRacingLine ? track.getRacingLine('standard').length : 3000;
        const tKey = p.isPlayer ? seatTyre(car.playerIndex)
                                : AI.chooseTyre(p.driverName, TOTAL_LAPS, isRaining, track);
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
        track: trackLabel(trackType),
        laps: isPractice ? null : TOTAL_LAPS,
        difficulty: isPractice ? null : (isChampionship ? championshipState.difficulty : difficulty),
        weather: isRaining ? (wetLevel === 'soaked' ? 'soaked' : 'damp') : 'dry',
        seed: isChampionship && championshipState ? championshipState.seed : null,
        playerTyre: (() => {
            const p = cars.find(c => c.isPlayer);
            return p && p.tyre ? p.tyre.label : null;
        })(),
        playerChassis: (() => {
            const p = cars.find(c => c.isPlayer);
            return p && p.chassis ? p.chassis.label : null;
        })(),
        tyres: cars.map(c => (c.driverName || c.color) + ' ' +
            ((c.tyre && c.tyre.short) || '?')),
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
        // Analogue where there is one, the boolean everywhere else. A keyboard
        // never sets these, so a desktop seat gets exactly 1 or 0.
        c.inputs.throttle = k.throttle !== undefined ? k.throttle : (k.up ? 1 : 0);
        c.inputs.brake = k.brake !== undefined ? k.brake : (k.down ? 1 : 0);
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

    // A car that has been classified stops counting - see raceCmp.
    freezeClassified();

    // --- log: completed laps ------------------------------------------
    cars.forEach(c => {
        if (c.lap > c._prevLap) {
            if (!c.lapTimes) c.lapTimes = [];
            if (c.lastLapTime) c.lapTimes.push(c.lastLapTime);
            const isBest = c.lastLapTime && c.lastLapTime === c.bestLapTime;
            RaceLog.event('LAP', `${c.driverName || c.color} lap ${c.lap}` +
                (c.lastLapTime ? ` — ${RaceLog.fmt(c.lastLapTime)}${isBest ? '  (best)' : ''}` : ' (out lap)'));
            // Only the human's laps carry telemetry into the log and into the
            // personal-best table. The AI's would be noise: it never provokes
            // the car, so its oversteer numbers are the same on every compound.
            if (c.isPlayer && c.lastLapTime) {
                pbRecord(currentTrackKey, (c.tyre && c.tyre.key) || 'medium',
                         c.lastLapTime, isRaining);
                const te = c.lastLapTele;
                if (te) RaceLog.event('TELE',
                    `${humanLabel(c)} lap ${c.lap} on ${te.tyre} — ` +
                    `${(100 * te.slowShare).toFixed(0)}% of it under 160 px/s, ` +
                    `oversteer ${te.osMean.toFixed(2)} there ` +
                    `(pinned ${(100 * te.osPinned).toFixed(0)}% of that time), ` +
                    `sideways ${te.slidePct.toFixed(1)}% of the distance, ` +
                    `mean ${te.vMean.toFixed(0)} px/s`);
            }
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
            // and no tow through a bridge deck
            if (track.sameLevel && !track.sameLevel(car, otherCar)) continue;

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
            // A wreck is DEBRIS: it sits where it stopped and you have to go
            // round it. It stops being an obstacle only once it is off the
            // ground - on the hook (liftAmount) or parked behind the
            // barriers (recovered) - because then it genuinely is not there
            // any more. It used to vanish the instant it broke, so a car
            // that had just been destroyed in front of you was something you
            // drove straight through.
            const gone = (c) => c.recovered || (c.liftAmount || 0) > 0.05;
            if ((c1.isBroken && gone(c1)) || (c2.isBroken && gone(c2))) continue;
            // On a circuit with a bridge, two cars can share a pixel and be
            // ten metres apart vertically.
            if (track.sameLevel && !track.sameLevel(c1, c2)) continue;
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
                // Dead weight: a wreck does not spring out of the way, so the
                // running car takes the whole displacement and the debris
                // stays put. Two live cars share it, exactly as before.
                const w1 = c1.isBroken ? 0 : 1, w2 = c2.isBroken ? 0 : 1;
                const tot = (w1 + w2) || 1;
                c1.x -= pushX * 2 * w1 / tot;
                c1.y -= pushY * 2 * w1 / tot;
                c2.x += pushX * 2 * w2 / tot;
                c2.y += pushY * 2 * w2 / tot;

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
                            typeof playerFreeImpact === 'function' ? playerFreeImpact() : 0);
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

// =========================================================================
//  LA GRU
// =========================================================================
//
//  COS'ERA PRIMA, e perche' non c'e' piu'. Un carro attrezzi cingolato che
//  entrava dal prato, agganciava il rottame e lo trascinava via. Era un
//  oggetto SOLIDO: le auto ci rimbalzavano contro, l'IA aveva una regola per
//  scansarlo, e ci voleva una pagina di ricerca per trovargli una strada che
//  non attraversasse le tribune. Nicola aveva chiesto delle gru e intendeva
//  quelle da cantiere: un braccio che entra SOPRA il circuito, cala un gancio,
//  solleva l'auto e la porta fuori. Niente sulla strada. Quindi:
//
//    * la torre sta fuori dal bordo dell'immagine, dal lato piu' vicino al
//      rottame. Non si vede mai: si vede solo il braccio;
//    * il braccio ruota fino alla direzione del rottame mentre il carrello
//      corre in fuori lungo di esso;
//    * il gancio cala, l'auto viene sollevata (car.js la disegna piu' grande
//      e le lascia l'ombra a terra: e' l'unica cosa che in vista dall'alto
//      dice "questa e' in aria");
//    * il carrello rientra e il braccio ruota indietro, e l'auto se ne va con
//      lui, oltre il bordo del mondo.
//
//  Non c'e' piu' un punto dove posare il rottame, perche' il rottame non viene
//  posato: viene portato via. E non c'e' piu' collisione, ne' regola d'IA, ne'
//  ricerca di percorso, perche' tutta la macchina e' quindici metri in aria.
const JIB_SWING = 1.9;      // s, il braccio entra
const JIB_HOOK  = 1.2;      // s, gancio giu' e sollevamento
const JIB_HAUL  = 2.8;      // s, lo porta fuori
const JIB_PARK  = 26;       // px, distanza del carrello a riposo
const JIB_OUT   = 74;       // px di quanto la torre sta fuori dall'arena

function startRecovery(car) {
    // Da che parte entra: il bordo piu' vicino. Da quella scelta sola discende
    // tutto il resto - dove sta la torre, quanto e' lungo il braccio, di
    // quanto deve ruotare.
    const dLeft = car.x - ARENA_X0, dRight = ARENA_X1 - car.x;
    const dTop = car.y - ARENA_Y0, dBottom = ARENA_Y1 - car.y;
    const near = Math.min(dLeft, dRight, dTop, dBottom);
    let pivot, alongX = 0, alongY = 1;
    if (near === dRight)      { pivot = { x: ARENA_X1 + JIB_OUT, y: car.y }; }
    // A sinistra la torre va fuori dal CANVAS, non fuori dall'arena: fra i due
    // c'e' la colonna dell'HUD, e una gru piazzata li' resterebbe in vista a
    // posare l'auto in mezzo al prato invece di portarsela fuori. Il braccio
    // attraversa quella fascia e per un pezzo sta dietro il pannello, il che
    // e' esattamente come deve sembrare: entra da fuori campo.
    else if (near === dLeft)  { pivot = { x: -JIB_OUT, y: car.y }; }
    else if (near === dTop)   { pivot = { x: car.x, y: ARENA_Y0 - JIB_OUT }; alongX = 1; alongY = 0; }
    else                      { pivot = { x: car.x, y: ARENA_Y1 + JIB_OUT }; alongX = 1; alongY = 0; }

    // Due rottami dallo stesso lato metterebbero due torri sullo stesso pixel:
    // la seconda scivola lungo il suo bordo.
    for (const o of recoveries) {
        if (o.phase === 'done' || !o.pivot) continue;
        if (Math.hypot(o.pivot.x - pivot.x, o.pivot.y - pivot.y) > 110) continue;
        pivot.x += alongX * 130;
        pivot.y += alongY * 130;
    }

    const aim = Math.atan2(car.y - pivot.y, car.x - pivot.x);
    const dist = Math.hypot(car.x - pivot.x, car.y - pivot.y);

    // A riposo il braccio sta quasi disteso lungo il bordo, non puntato sulla
    // strada: e' l'entrare in rotazione che lo fa leggere come una gru e non
    // come una freccia che sta li'.
    const inward = Math.atan2((ARENA_Y0 + ARENA_Y1) / 2 - pivot.y,
                              (ARENA_X0 + ARENA_X1) / 2 - pivot.x);
    let off = aim - inward;
    while (off > Math.PI) off -= 2 * Math.PI;
    while (off < -Math.PI) off += 2 * Math.PI;
    const park = inward + (off >= 0 ? -1 : 1) * (Math.PI / 2.3);

    recoveries.push({
        car: car,
        phase: 'swing',
        t: 0,
        pivot: pivot,
        jib: dist + 80,                 // il braccio e' piu' lungo del necessario
        aim: aim, park: park, dist: dist,
        ang: park, reach: JIB_PARK,
        hook: { x: pivot.x, y: pivot.y }
    });

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
        const lerpAng = (a, b, e) => {
            let d = b - a;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            return a + d * e;
        };

        if (r.phase === 'swing') {
            // il braccio ruota dentro e il carrello corre in fuori: il gancio
            // arriva sul rottame esattamente alla fine dei due movimenti
            const e = smooth(Math.min(1, r.t / JIB_SWING));
            r.ang = lerpAng(r.park, r.aim, e);
            r.reach = JIB_PARK + (r.dist - JIB_PARK) * e;
            if (r.t >= JIB_SWING) { r.phase = 'hook'; r.t = 0; r.ang = r.aim; r.reach = r.dist; }

        } else if (r.phase === 'hook') {
            // gancio giu', l'auto si stacca da terra
            r.car.liftAmount = Math.min(1, r.t / JIB_HOOK);
            if (r.t >= JIB_HOOK) { r.phase = 'haul'; r.t = 0; }

        } else if (r.phase === 'haul') {
            // il carrello rientra, il braccio torna indietro, e l'auto appesa
            // al gancio esce dall'inquadratura con lui
            const e = smooth(Math.min(1, r.t / JIB_HAUL));
            r.ang = lerpAng(r.aim, r.park, e);
            r.reach = r.dist + (JIB_PARK - r.dist) * e;
            r.car.x = r.pivot.x + Math.cos(r.ang) * r.reach;
            r.car.y = r.pivot.y + Math.sin(r.ang) * r.reach;
            if (r.t >= JIB_HAUL) { r.phase = 'done'; r.t = 0; }
        }

        r.hook.x = r.pivot.x + Math.cos(r.ang) * r.reach;
        r.hook.y = r.pivot.y + Math.sin(r.ang) * r.reach;

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
            RaceLog.event('VSC', `deployed — speed limited to ${VSC_SPEED} px/s for everyone`);
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

function drawCranes(ctx) {
    for (const r of recoveries) {
        if (r.phase === 'done') continue;
        const on = Math.floor(Date.now() / 200) % 2 === 0;
        const ca = Math.cos(r.ang), sa = Math.sin(r.ang);
        const trX = r.pivot.x + ca * r.reach, trY = r.pivot.y + sa * r.reach;

        ctx.save();
        ctx.translate(r.pivot.x, r.pivot.y);
        ctx.rotate(r.ang);

        // --- controbraccio e contrappeso, dall'altra parte della torre ----
        ctx.strokeStyle = '#37474f';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-66, 0); ctx.stroke();
        ctx.fillStyle = '#37474f';
        ctx.fillRect(-80, -12, 18, 24);

        // --- il braccio: due correnti e un traliccio a zig-zag fra loro ----
        // Rastremato: 7px alla torre, 3 alla punta. E' quello che lo fa
        // leggere come una struttura e non come una barra.
        const J = r.jib;
        const wAt = (s) => 7 - 4 * Math.min(1, s / J);
        ctx.strokeStyle = '#e65100';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        for (let s = 0; s + 26 <= J; s += 26) {
            ctx.moveTo(s, -wAt(s)); ctx.lineTo(s + 13, wAt(s + 13));
            ctx.moveTo(s + 13, wAt(s + 13)); ctx.lineTo(s + 26, -wAt(s + 26));
            ctx.moveTo(s, -wAt(s)); ctx.lineTo(s, wAt(s));
        }
        ctx.stroke();
        ctx.strokeStyle = '#f9a825';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(0, -7); ctx.lineTo(J, -3);
        ctx.moveTo(0, 7); ctx.lineTo(J, 3);
        ctx.stroke();
        // punta
        ctx.fillStyle = '#37474f';
        ctx.beginPath(); ctx.arc(J, 0, 4, 0, Math.PI * 2); ctx.fill();

        // --- la torre, vista dall'alto: un traliccio quadrato -------------
        ctx.fillStyle = '#455a64'; ctx.fillRect(-14, -14, 28, 28);
        ctx.fillStyle = '#f9a825'; ctx.fillRect(-11, -11, 22, 22);
        ctx.strokeStyle = '#e65100'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-11, -11); ctx.lineTo(11, 11);
        ctx.moveTo(11, -11); ctx.lineTo(-11, 11);
        ctx.stroke();

        // --- il carrello, sul braccio -------------------------------------
        ctx.save();
        ctx.translate(r.reach, 0);
        if (on) {
            ctx.fillStyle = 'rgba(255,214,0,0.20)';
            ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#263238'; ctx.fillRect(-9, -9, 18, 18);
        ctx.fillStyle = '#ffb300'; ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = on ? '#fff176' : '#8d6e00';
        ctx.fillRect(-2.5, -12, 5, 4);
        ctx.restore();
        ctx.restore();

        // --- il cavo e il gancio ------------------------------------------
        // In pianta cavo e gancio cadono sullo stesso punto del carrello, e
        // un cavo lungo zero non si vede: il gancio si disegna come due anelli
        // concentrici sotto il carrello, che e' il modo in cui una vista
        // dall'alto puo' dire "qui pende qualcosa".
        const lift = r.car ? (r.car.liftAmount || 0) : 0;
        if (r.phase === 'hook' || r.phase === 'haul') {
            ctx.strokeStyle = 'rgba(20,20,20,0.85)';
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(trX, trY, 7 + 3 * lift, 0, Math.PI * 2); ctx.stroke();
            ctx.lineWidth = 2.4;
            ctx.beginPath(); ctx.arc(trX, trY, 3.4, 0, Math.PI * 2); ctx.stroke();
        }

        // --- etichetta -----------------------------------------------------
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = on ? '#ffd600' : '#c8a600';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3;
        ctx.strokeText('RECOVERY', trX, trY - 22);
        ctx.fillText('RECOVERY', trX, trY - 22);
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
    //
    // The car this panel is ABOUT. Normally yours; when you are spectating it
    // is whichever car you picked out of the timing tower, or the leader if
    // you have not picked one. The whole block used to be gated on playerCar,
    // so a spectator got two lines - leader's lap and name - and nothing else.
    const hc = hudCar();
    if (hc && !twoPlayer) {
        renderTyreIndicator(hc);
        if (raceMode === 'practice') {
            lapCounter.innerText = `Practice — lap ${hc.lap + 1}`;
        } else if (raceMode === 'qualifying') {
            lapCounter.innerText = hc.lap === 0
                ? 'Qualifying — warm-up lap'
                : `Qualifying — flying lap ${hc.lap}/${QUALI_LAPS - 1}`;
        } else {
            let currentLap = hc.lap + 1;
            if (currentLap > TOTAL_LAPS) currentLap = TOTAL_LAPS;
            lapCounter.innerText = `Lap: ${currentLap}/${TOTAL_LAPS}`;
        }
        
        // Speed
        const speed = Math.sqrt(hc.velocity.x**2 + hc.velocity.y**2);
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
            const current = hc.finished ? (hc.lastLapTime || 0) : Math.max(0, nowMs - hc.lapStartTime);

            // Green while we are up on our best, red once we have lost it.
            let colour = '#fff';
            if (hc.bestLapTime) {
                colour = current > hc.bestLapTime ? '#ff8a80' : '#69f0ae';
            }

            const lastStr = hc.lastLapTime
                ? `${fmt(hc.lastLapTime)}${hc.lastLapTime === hc.bestLapTime ? ' ★' : ''}`
                : '--.---';

            // The live lap big, last and best beside it: the bar is one row,
            // so these read left to right rather than stacked.
            lapTimerDiv.innerHTML =
                `<span class="lt-cur" style="color:${colour};">${fmt(current)}</span>` +
                `<span class="lt-sub">L ${lastStr}</span>` +
                `<span class="lt-sub lt-best">B ${fmt(hc.bestLapTime)}</span>`;
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
        // The same comparator the tower settles towards - see raceCmp. These
        // used to be two functions with two different answers for a finished
        // car, so the live order and the results sheet could disagree about
        // who came where.
        const k = raceCmp(a, b);
        if (k !== 0) return k;
        return (a.gridIndex || 0) - (b.gridIndex || 0);   // stable at lights-out
    });

    lastRunningOrder = sortedCars;

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
                // Lapped cars say so, every one of them, and against the
                // LEADER rather than against whoever happens to be on the
                // row above - which is what used to turn a car a lap down
                // into "+0.0". An interval is shown only between cars that
                // are actually racing each other, i.e. on the same lap.
                const lapsDown = lapsDownFrom(shown[0], c);
                if (lapsDown >= 1) {
                    gap = `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
                } else {
                    const ahead = shown[i - 1];
                    const behind = Math.max(0, (ahead.trackProgress || 0) - (c.trackProgress || 0));
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
            // and which car they are in, immediately to its right
            const ch = c.chassis || CHASSIS[CHASSIS_DEFAULT];
            const chPip = `<span class="tt-ch" style="background:${ch.accent};" ` +
                `title="${ch.label}">${ch.short}</span>`;
            // One cell per car, laid left to right along the top.
            // Spectating: the row is a button that follows that car. It is
            // an onclick attribute rather than a listener because the tower is
            // rebuilt from innerHTML every frame - a listener attached here
            // would be thrown away before it could ever fire.
            const idx = cars.indexOf(c);
            const spect = !playerCar && !twoPlayer;
            // The lead-lap group is marked once, at its edge: everything
            // below that rule is a lap or more down and is not racing the
            // cars above it. Half the confusion was never the numbers, it
            // was that the tower looked like one continuous queue.
            const down = (gameState === 'countdown' || c.finished ||
                          (c.isBroken && !c.finished)) ? 0 : lapsDownFrom(shown[0], c);
            const prev = i > 0 ? shown[i - 1] : null;
            const prevDown = (prev && gameState !== 'countdown' && !prev.finished &&
                              !(prev.isBroken && !prev.finished))
                ? lapsDownFrom(shown[0], prev) : 0;
            const lapClass = (down >= 1 ? ' tt-lapped' : '') +
                             (down >= 1 && prevDown < down ? ' tt-lapline' : '');
            rows.push(
                `<div class="tt-row${c.isPlayer ? ' me' : ''}${lapClass}` +
                `${spect ? ' tt-click' : ''}${spectateCar === c ? ' tt-watch' : ''}" ` +
                (spect ? `onclick="spectateFollow(${idx})" ` +
                         `title="Follow ${c.driverName || c.color}" ` : '') +
                `style="border-left-color:${c.color};">` +
                `<div class="tt-top">` +
                `<span class="tt-pos">${i + 1}</span>` +
                `<span class="tt-name"${(c.isBroken && !c.finished) ? ' style="opacity:.45;"' : ''}>${name}</span>` +
                tyrePip + chPip +
                `</div>` +
                `<div class="tt-gap">${gap}</div>` +
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
    } else if (!playerCar && !twoPlayer &&
               (raceMode === 'race' || raceMode === 'championship')) {
        // Spectating. The lap, speed, tyre and live lap time were all filled in
        // above for whichever car is being followed; only the position line is
        // different, because "Pos" for a spectator has to say WHOSE position.
        const hc2 = hudCar();
        if (hc2) {
            const p2 = sortedCars.indexOf(hc2) + 1;
            posCounter.innerText =
                (spectateCar === hc2 ? '▶ ' : 'Leader: ') +
                `${driverCode(hc2)}  P${p2}/${cars.length}`;
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

        // Show temporary winner announcement. It lives at the very top of
        // the arena now - see the CSS - because in the middle of the screen
        // it covered the road at the one moment somebody is still driving
        // the last corners of their own race.
        winnerAnnouncement.style.display = 'block';
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

    // A session with nobody in `cars` - a spectator qualifying, where the AI
    // laps are simulated rather than driven - satisfies "everyone finished"
    // vacuously, and the block below then names sortedCars[0]. There is no
    // sortedCars[0]: it threw, which on file:// reads as "Script error, line
    // 0" and freezes the game with no way of telling what happened.
    if (shouldEndRace && !raceFinished && !sortedCars.length) raceFinished = true;
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
            tyre: (c.tyre && c.tyre.label) || '',
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

        // Quickest away from the lights. Everyone has one: a human's is the
        // moment of their first input after lights out, an AI's is the delay
        // its driver style rolled (Prost 0.45-0.90s, Verstappen 0.085-0.135).
        let quickestStart = null;
        for (const c of cars) {
            if (c.reactionTime && (!quickestStart || c.reactionTime < quickestStart.reactionTime)) {
                quickestStart = c;
            }
        }
        if (quickestStart) {
            RaceLog.event('START', `${quickestStart.driverName || quickestStart.color} — ` +
                `best reaction ${quickestStart.reactionTime.toFixed(3)}s`);
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

            // Reaction at the lights. It was already measured for every car
            // and simply never shown; a jump start reads as a near-zero here,
            // which is exactly what it was.
            const reactStr = c.reactionTime ? `${c.reactionTime.toFixed(3)}s` : '&mdash;';
            const isQuickest = quickestStart === c && cars.length > 1;
            const isFastest = fastestCar === c;
            const bestLapStr = (c.bestLapTime !== null && c.bestLapTime !== undefined && c.bestLapTime < Infinity)
                ? (formatTime(c.bestLapTime) + (isFastest ? ' &#9733;' : '')) : '-';

            const nameDisplay = c.driverName ? `${c.driverName} (${c.color})` : `${c.color} ${c.isPlayer ? '(You)' : ''}`;
            const chas = c.chassis || CHASSIS[CHASSIS_DEFAULT];
            // A column of its own. Glued in front of the driver's name it
            // read as part of the name and made the column ragged.
            const chasCell = `<span class="ch-pip" style="background:${chas.accent};" ` +
                `title="${chas.label} — ${chas.line1}">${chas.short}</span>`;

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td style="color: ${c.color}; font-weight: bold; text-transform: capitalize;">${nameDisplay}</td>
                <td>${chasCell}</td>
                <td>${c.tyre ? `<span class="tyre-pip" style="background:${c.tyre.colour};" title="${c.tyre.label}"></span>${c.tyre.short}` : '-'}</td>
                <td${isLapped || isDNF ? ' style="opacity: 0.55;"' : ''}>${lapsStr}</td>
                <td${dim}>${timeStr}</td>
                <td style="color: ${isFastest ? '#ce93d8' : '#4CAF50'}; font-weight: ${isFastest ? 'bold' : 'normal'};">${bestLapStr}</td>
                <td>${gapStr}</td>
                <td style="color: ${isQuickest ? '#ffd54f' : '#cfd8dc'}; font-weight: ${isQuickest ? 'bold' : 'normal'};"${c.jumpStartPenalty ? ' title="jump start — penalty applied"' : (isQuickest ? ' title="quickest away from the lights"' : '')}>${reactStr}${c.jumpStartPenalty ? ' &#9888;' : ''}</td>
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
            saveChampionship();      // points, results and the new round, all in
            champRecapSection.style.display = 'block';
            // currentTrackIndex has just been advanced, so it is now the number
            // of rounds COMPLETED - which is exactly the round you have just
            // driven. When it reaches the end of the calendar there is nothing
            // left to be current about, so the table says so.
            const done = championshipState.currentTrackIndex;
            const total = championshipState.tracks.length;
            const recapTitle = document.getElementById('champ-recap-title');
            if (recapTitle) {
                recapTitle.innerHTML = done >= total
                    ? 'Final Standings <span class="recap-round">after all ' +
                      total + ' rounds</span>'
                    : 'Current Standings <span class="recap-round">after round ' +
                      done + ' of ' + total + '</span>';
            }
            champRecapBody.innerHTML = '';
            
            // Sort by current points
            const sortedColors = Object.keys(championshipState.points).sort((a, b) => championshipState.points[b] - championshipState.points[a]);
            sortedColors.forEach((col, idx) => {
                const tr = document.createElement('tr');
                if (idx === 0) tr.style.color = 'gold';
                else if (idx === 1) tr.style.color = 'silver';
                else if (idx === 2) tr.style.color = '#cd7f32';
                
                const participant = championshipState.participants.find(p => p.color === col);
                // Nessun contrassegno per il rivale della stagione: chi e' lo
                // dicono i risultati. La riga nel log resta - quello e' il
                // registro della stagione, non un avviso in anticipo.
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
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    
    // Fast rain streaks. World units, not canvas.width: the backing store is
    // RES times the world now, and streaks rolled across it would land off
    // screen - it rains harder on retina, which is not a weather model.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 50; i++) {
        const x = Math.random() * WORLD_W;
        const y = Math.random() * WORLD_H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 5, y + 25);
    }
    ctx.stroke();
}

function gameLoop(timestamp) {
    if (gameState === 'menu') {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
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

        drawTrackFrame(ctx);
        cars.forEach(car => car.draw(ctx));
        if (typeof track.drawBridge === 'function') track.drawBridge(ctx);
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
                // raceNow(), not performance.now(): the stall guard shifts
                // raceStartTime when a frame is lost, and the two have to be
                // read off the same clock or a hidden tab invents a reaction
                // time of several seconds.
                c.reactionTime = (raceNow() - raceStartTime) / 1000;
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
        ghostTick();
        
        // If spectator, we don't need to update a camera because it's a fixed-screen game
        
        updateHUD();
        
        // Draw Track - the pre-rendered layer, one drawImage
        drawTrackFrame(ctx);
        
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
        
        // The ghost first, under everything alive
        drawGhostCar(ctx);

        // Draw Cars
        // Draw broken/finished cars first so active ones draw on top
        const renderSorted = [...cars].sort((a, b) => {
            if (a.isBroken !== b.isBroken) return a.isBroken ? -1 : 1;
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            return 0;
        });
        
        // On a circuit with a bridge the draw order has three layers: the cars
        // underneath it, then the deck, then the cars on top of it. The tags -
        // name and health bar - are drawn last for EVERYONE, so a car you
        // cannot see is still a car you can follow.
        const bridged = typeof track.getBridge === 'function' && track.getBridge();
        if (bridged) {
            renderSorted.forEach(car => { if (!track.onBridge(car)) car.draw(ctx, true); });
            track.drawBridge(ctx);
            renderSorted.forEach(car => { if (track.onBridge(car)) car.draw(ctx, true); });
            renderSorted.forEach(car => car.drawTags(ctx));
        } else {
            renderSorted.forEach(car => car.draw(ctx));
        }

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
ctx.fillRect(0, 0, WORLD_W, WORLD_H);

// Put the HUD stage over the canvas straight away, and again once the browser
// has settled the layout - getBoundingClientRect is zero until it has.
layoutStage();
if (typeof setTimeout === 'function') setTimeout(layoutStage, 0);

// From down here and not from the menu wiring: refreshChampResume reads
// CHAMP_STORE_KEY, a const that lives mid-file - called any earlier it is in
// the dead zone, the read throws, the catch answers "no save", and the
// resume button plays dead with a season sitting right there in storage.
// (Found exactly that way.)
refreshChampResume();

// How many rounds the season runs. Ten by default, which is what it always
// was; the field is clamped rather than trusted, because a browser will hand
// back whatever the user typed - including nothing at all.
// Every circuit the championship can draw from. One list, and everything
// else - the dropdown, the clamp, the calendar - reads it, so adding a
// circuit to the game adds it to the season without touching anything else.
const SEASON_POOL = ['oval', 'peanut', 'f1', 'circomassimo', 'circle', 'serpent',
                     'quadrato', 'triangle', 'pettine', 'thunder', 'crown',
                     'boomerang', 'zipper', 'kettle', 'harbour', 'crossover', 'kart',
                     'anchor', 'arrow', 'pentagon'];
const SEASON_DEFAULT = 10;

// Quanto va piu' forte il rivale della stagione. Il numero non e' a occhio:
// simulando stagioni intere, sotto l'1% non lo si distingue dal rumore (chi
// vince cambia comunque ogni anno), sopra il 2% il campionato e' deciso a
// meta' calendario. Vedi 2.4duodevicies nel piano.
let RIVAL_BOOST = 1.015;

function seasonRounds() {
    const el = document.getElementById('rounds-select');
    const n = parseInt(el && el.value, 10);
    if (!isFinite(n)) return Math.min(SEASON_DEFAULT, SEASON_POOL.length);
    return Math.max(1, Math.min(SEASON_POOL.length, n));
}

// What the seed box says, or a fresh one if it is empty. Whitespace and case
// are ignored so a seed copied off the screen with a stray space still lands on
// the same calendar - the whole point is that it is retypeable.
function seasonSeedText() {
    const el = document.getElementById('season-seed');
    const raw = (el && el.value ? String(el.value) : '').trim().toLowerCase();
    return raw || makeSeedText();
}
const SEED_STORE_KEY = 'apex2.season.seed';
function rememberSeed(text) {
    try { window.localStorage.setItem(SEED_STORE_KEY, text); } catch (e) { }
}
function lastSeed() {
    try { return window.localStorage.getItem(SEED_STORE_KEY) || ''; } catch (e) { return ''; }
}

// The dropdown is built from the pool rather than written out in the HTML:
// the longest season on offer is then exactly the number of circuits that
// exist, and it cannot drift out of step when one is added.
function populateSeasonLengths() {
    const el = document.getElementById('rounds-select');
    if (!el) return;
    const want = Math.min(SEASON_DEFAULT, SEASON_POOL.length);
    let html = '';
    for (let i = 1; i <= SEASON_POOL.length; i++) {
        html += '<option value="' + i + '"' + (i === want ? ' selected' : '') + '>' +
                i + (i === 1 ? ' round' : ' rounds') + '</option>';
    }
    el.innerHTML = html;
    el.value = String(want);
}
populateSeasonLengths();

// The repeat button fills the box with the seed of the last season started.
// Two clicks - repeat, then change the tyre - is the whole workflow the
// comparison needs.
(function wireSeedBox() {
    const el = () => document.getElementById('season-seed');
    const again = document.getElementById('seed-again');
    if (again) again.addEventListener('click', () => {
        const box = el(), s = lastSeed();
        if (box && s) { box.value = s; box.focus(); }
    });
    // And its opposite: roll a new one and show it, rather than leaving the box
    // empty and finding out what you got afterwards. Same size and shape as the
    // repeat button - they are two halves of one control.
    const roll = document.getElementById('seed-random');
    if (roll) roll.addEventListener('click', () => {
        const box = el();
        if (box) { box.value = makeSeedText(); box.focus(); }
    });
})();

// ---------------------------------------------------------------------------
//  THE SEED
// ---------------------------------------------------------------------------
//  A calendar drawn at random is right for playing and useless for comparing.
//  Two championships run to find out what a tyre is worth visited five
//  different circuits each and shared two, so the answer rested on two races.
//
//  So the calendar and the weather come from a NAMED draw. Type the same seed
//  and you get the same seventeen-circuit shuffle and the same rain, which
//  makes "the same season on a different tyre" a thing you can actually run.
//  Leave it blank and a fresh one is rolled and then shown, so a season you
//  enjoyed can be repeated after the fact.
//
//  Deliberately only the calendar and the weather. The racing itself - grid
//  order, AI mistakes, tyre choices, where the puddles fall - stays on
//  Math.random, because a seed that froze those too would make the comparison
//  a replay rather than a second attempt.
function seedFrom(text) {
    let h = 2166136261 >>> 0;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
// mulberry32: small, fast, and good enough for shuffling seventeen circuits.
function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Seeds are shown to you and typed back in, so they are words rather than
// nine-digit numbers: easier to read off a screen and to write in a log.
const SEED_WORDS = ['apex', 'kerb', 'slip', 'drift', 'lock', 'tow', 'wing', 'brake',
                    'grid', 'flag', 'wet', 'dry', 'soft', 'hard', 'late', 'quick'];
function makeSeedText() {
    const r = () => SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
    return r() + '-' + r() + '-' + Math.floor(100 + Math.random() * 900);
}

// The calendar: `rounds` circuits drawn from the pool, WITHOUT replacement, so
// a season never visits the same place twice. The dropdown cannot ask for more
// rounds than there are circuits; the refill below is there only so that a
// longer season asked for in code still returns something sensible rather than
// a short list.
function seasonCalendar(rounds, rng) {
    const rand = rng || Math.random;
    const pool = SEASON_POOL;
    const shuffled = () => {
        const a = pool.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };
    const out = [];
    while (out.length < rounds) {
        const bag = shuffled();
        for (let i = 0; i < bag.length && out.length < rounds; i++) out.push(bag[i]);
    }
    return out;
}

function startChampionship() {
    const color = document.getElementById('color-select').value;
    const difficulty = document.getElementById('difficulty-select').value;
    const numOpponents = parseInt(document.getElementById('opponents-select').value, 10);
    
    const possibleColors = ['red', 'blue', 'yellow', 'purple', 'orange', 'white', 'green', 'cyan', 'pink', 'gray', 'lime', 'black'];
    let aiColors = possibleColors.filter(c => c !== color);

    // Fixed for the whole season: the field is built once and every round
    // races the same drivers.
    twoPlayer = twoPlayerEnabled() && color !== 'spectator';

    // Every circuit, in a different order every season - unless you name the
    // season. A fixed calendar meant you learned the season rather than the
    // tracks; a calendar you cannot repeat meant two championships were never
    // comparable. A seed gives both: blank rolls a new one, typed reproduces it.
    const seedText = seasonSeedText();
    const rng = seededRng(seedFrom(seedText));
    const tracks = seasonCalendar(seasonRounds(), rng);

    // The season's weather is rolled once, up front, at the same 20% per race
    // as before - but a season with no wet race at all is rerolled. At 20% a
    // ten-race season came out completely dry about one time in nine, which is
    // how you can play a whole championship and never see the rain.
    // Rolled AFTER the shuffle, and from the SAME seeded stream, so the same
    // seed gives the same rain in the same places.
    const weather = tracks.map(() => rng() < 0.20);
    if (!weather.some(Boolean)) weather[Math.floor(rng() * weather.length)] = true;
    // ...and which kind of wet each of those is, from the SAME stream, so a
    // seed reproduces the rain exactly rather than approximately.
    const wetKind = weather.map(w => (w ? rollWetKind(rng) : null));

    championshipState = {
        seed: seedText,
        tracks: tracks,
        weather: weather,
        wetKind: wetKind,
        currentTrackIndex: 0,
        points: {},
        bonusPoints: {},          // places-gained, tracked apart from race points
        participants: [],
        results: [],
        difficulty: difficulty
    };
    // Written back into the box and kept, so the season you have just started
    // can be run again on a different tyre without having copied anything down.
    rememberSeed(seedText);
    const seedEl = document.getElementById('season-seed');
    if (seedEl) seedEl.value = seedText;

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

    // ---- il rivale della stagione --------------------------------------
    // Uno degli avversari - estratto dallo stesso flusso seminato del
    // calendario e della pioggia, quindi lo stesso seme da' lo stesso rivale -
    // corre tutta la stagione con qualcosa in piu'. Mai il giocatore, mai la
    // gara singola, e finisce con la stagione.
    const aiNames = championshipState.participants.filter(p => !p.isPlayer)
                                                  .map(p => p.driverName);
    if (aiNames.length) {
        const pick = aiNames[Math.floor(rng() * aiNames.length)];
        championshipState.rival = { driver: pick, boost: RIVAL_BOOST };
        // Due cose, non una. La prima: skillVariation, che ogni pilota pesca
        // fra 0.8 e 1.1 a inizio stagione, vale il 7% di passo - tre volte lo
        // scarto fra i caratteri. Un rivale con una pescata storta e' un
        // rivale invisibile, quindi al rivale la pescata non tocca: prende il
        // massimo. La seconda: RIVAL_BOOST sopra, che e' quello che lo stacca
        // anche da chi ha pescato bene. Da sole nessuna delle due basta -
        // misurato: col solo boost all'1.4% il rivale finiva quinto di media
        // e non vinceva un titolo su otto.
        const rp = championshipState.participants.find(p => p.driverName === pick);
        if (rp) rp.skillVariation = 1.1;
        RaceLog.event('SEASON', `rival — ${pick}, +${((RIVAL_BOOST - 1) * 100).toFixed(1)}% pace for the season`);
    }

    // Chassis for the season. Drawn once for the whole AI field so the grid
    // is a mix, and locked in: nobody changes car between rounds, which is
    // what makes the choice a commitment rather than a per-race optimisation.
    const aiParts = championshipState.participants.filter(p => !p.isPlayer);
    const picks = AI.assignChassis(aiParts.map(p => p.driverName));
    aiParts.forEach((p, i) => { p.chassis = picks[i]; });
    championshipState.chassis = {};

    RaceLog.event('SEASON', 'chassis — ' + aiParts.map(p =>
        `${p.driverName}: ${CHASSIS[p.chassis].label}`).join(', '));

    // Then the player picks theirs, and the season starts.
    chooseChassisForSeason(() => nextChampionshipRound());
}

// ---------------------------------------------------------------------------
//  The season's chassis choice. One screen per human seat, before round one.
//  Spectating, there is nobody to ask.
// ---------------------------------------------------------------------------
function chooseChassisForSeason(done) {
    const seats = championshipState.participants.filter(p => p.isPlayer);
    if (!seats.length) { done(); return; }
    const ask = (n) => {
        if (n >= seats.length) { done(); return; }
        const seat = seats[n];
        const idx = seat.playerIndex || 1;
        showChassisChoice(
            seats.length > 1 ? `Player ${idx} — pick your car` : 'Pick your car',
            'One choice for the whole season. Every circuit, wet and dry.',
            (pick) => {
                championshipState.chassis[idx] = pick;
                seat.chassis = pick;
                if (idx === 2) playerChassis2 = pick; else playerChassis = pick;
                RaceLog.event('SEASON', `Player ${idx} — ${CHASSIS[pick].label}`);
                ask(n + 1);
            });
    };
    ask(0);
}

function showChassisChoice(title, subtitle, cb) {
    const screen = document.getElementById('chassis-screen');
    const opts = document.getElementById('chassis-options');
    if (!screen || !opts) { cb(CHASSIS_DEFAULT); return; }   // never block the season
    pendingChassisCb = cb;
    menu.style.display = 'none';
    gameOverScreen.style.display = 'none';
    qualiScreen.style.display = 'none';
    document.getElementById('gp-preview').style.display = 'none';
    hud.style.display = 'none';
    hideSplitHud();
    showVscBanner(false);
    gameState = 'menu';

    document.getElementById('chassis-title').innerText = title;
    document.getElementById('chassis-subtitle').innerText = subtitle;
    opts.innerHTML = CHASSIS_KEYS.map(k => chassisCardHtml(k)).join('');
    Array.prototype.forEach.call(opts.querySelectorAll('.chassis-opt'), (b) => {
        b.addEventListener('click', () => {
            const pick = b.getAttribute('data-chassis');
            screen.style.display = 'none';
            const c = pendingChassisCb;
            pendingChassisCb = null;
            if (c) c(pick);
        });
    });
    screen.style.display = 'block';
}

// A card per car: the badge, what it is for, and the four numbers that
// actually differ, as bars against the base car.
function chassisCardHtml(k) {
    const c = CHASSIS[k];
    const bar = (label, v, hint) => {
        // v is a multiplier around 1; show it as a bar either side of centre
        const pct = Math.max(-1, Math.min(1, (v - 1) / 0.22));
        const w = Math.abs(pct) * 50;
        const left = pct >= 0 ? 50 : 50 - w;
        const col = pct >= 0 ? '#66bb6a' : '#ef5350';
        return `<div class="ch-stat" title="${hint}">` +
               `<span class="ch-k">${label}</span>` +
               `<span class="ch-bar"><i style="left:${left}%;width:${w}%;background:${col};"></i></span>` +
               `<span class="ch-v">${v >= 1 ? '+' : ''}${((v - 1) * 100).toFixed(0)}%</span></div>`;
    };
    return `<button class="chassis-opt" data-chassis="${k}" style="border-color:${c.accent};">` +
        `<span class="ch-badge" style="background:${c.accent};">${c.short}</span>` +
        `<span class="ch-name">${c.label}</span>` +
        `<span class="ch-line1" style="color:${c.accent};">${c.line1}</span>` +
        `<span class="ch-line2">${c.line2}</span>` +
        bar('Cornering', c.steer, 'steering rate - the binding cornering limit') +
        bar('Top speed', c.top, 'engine power against drag') +
        bar('Acceleration', c.power, 'engine force out of the slow corners') +
        bar('Wet grip', c.grip, 'lateral grip - what holds the car up in the rain') +
        bar('Tyre life', 2 - c.wear, 'how long a set lasts') +
        `</button>`;
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
    saveChampionship();   // covers season creation and the chassis picks too
    // Every round opens on the Grand Prix preview; the session starts (or the
    // whole round is skipped) from its buttons.
    showGpPreview(championshipState.tracks[championshipState.currentTrackIndex]);
}

function showChampionshipFinal() {
    clearChampionshipSave();
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

    // trackCode, not a slice: the column heads used to read the raw key.
    const short = (t) => trackCode(t);

    let html = '<h2 style="margin:18px 0 8px;">Season Results</h2>' +
        '<div style="overflow-x:auto;"><table class="season-table"><thead><tr>' +
        '<th style="text-align:left;">Driver</th>';
    races.forEach(r => {
        html += `<th title="${trackLabel(r.track)}${r.wet ? ' (wet)' : ''}">${short(r.track)}` +
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
