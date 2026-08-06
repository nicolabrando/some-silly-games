'use strict';
/* ============================================================
   LIDO RUNNER — un platform balneare
   ============================================================ */

const IS_BROWSER = (typeof document !== 'undefined');
const IS_TOUCH = IS_BROWSER && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
    (window.matchMedia && matchMedia('(pointer: coarse)').matches));

const TILE = 40;
const VIEW_W = 960;
const VIEW_H = 560;
const ROWS = 14;
const WATER_Y = 13 * TILE + 18;          // pelo dell'acqua nei varchi
const N_LEVELS = 10;

// Codici tile
const T_EMPTY = 0, T_SAND = 1, T_CRATE = 2, T_STONE = 3;

/* ---------- utilità ---------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function makeRand(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
    const A = hexRgb(a), B = hexRgb(b);
    const r = Math.round(lerp(A[0], B[0], t));
    const g = Math.round(lerp(A[1], B[1], t));
    const bl = Math.round(lerp(A[2], B[2], t));
    return `rgb(${r},${g},${bl})`;
}

/* ---------- salvataggio (con fallback in memoria) ---------- */
const SAVE_KEY = 'lidoRunnerSave_v1';
let storageOK = false;
try {
    if (IS_BROWSER && window.localStorage) {
        localStorage.setItem('__lido_t', '1');
        localStorage.removeItem('__lido_t');
        storageOK = true;
    }
} catch (e) { storageOK = false; }

const DEFAULT_SAVE = { unlocked: 1, best: {}, sound: true, finished: false };
let save = Object.assign({}, DEFAULT_SAVE);
try {
    if (storageOK) {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            save = Object.assign({}, DEFAULT_SAVE, parsed);
            save.best = parsed.best || {};
            save.unlocked = clamp(parseInt(parsed.unlocked, 10) || 1, 1, N_LEVELS);
        }
    }
} catch (e) { save = Object.assign({}, DEFAULT_SAVE); }

function persistSave() {
    try { if (storageOK) localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ok */ }
}
function wipeSave() {
    save = Object.assign({}, DEFAULT_SAVE, { best: {} });
    try { if (storageOK) localStorage.removeItem(SAVE_KEY); } catch (e) { /* ok */ }
}
function totalBestCoins() {
    let t = 0;
    for (const k in save.best) t += save.best[k] | 0;
    return t;
}

/* ---------- audio (sintetizzato, WebAudio) ---------- */
let audioCtx = null, masterGain = null;

function ensureAudio() {
    if (!IS_BROWSER) return;
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.5;
            masterGain.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
}

function tone(freq, dur, opts) {
    if (!audioCtx || !save.sound) return;
    try {
        const o = opts || {};
        const t0 = audioCtx.currentTime + (o.delay || 0);
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.slide), t0 + dur);
        const v = o.vol || 0.18;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(masterGain);
        osc.start(t0); osc.stop(t0 + dur + 0.05);
    } catch (e) { /* niente audio, pazienza */ }
}
function noiseBurst(dur, vol, delay) {
    if (!audioCtx || !save.sound) return;
    try {
        const t0 = audioCtx.currentTime + (delay || 0);
        const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const g = audioCtx.createGain();
        g.gain.value = vol || 0.12;
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 900;
        src.connect(f); f.connect(g); g.connect(masterGain);
        src.start(t0);
    } catch (e) { /* ok */ }
}

const sfx = {
    jump()   { tone(300, 0.14, { type: 'square', vol: 0.06, slide: 560 }); },
    coin()   { tone(1180, 0.07, { type: 'triangle', vol: 0.12 }); tone(1570, 0.16, { type: 'triangle', vol: 0.10, delay: 0.06 }); },
    stomp()  { noiseBurst(0.12, 0.16); tone(200, 0.12, { type: 'square', vol: 0.07, slide: 80 }); },
    hurt()   { tone(320, 0.3, { type: 'sawtooth', vol: 0.09, slide: 90 }); },
    splash() { noiseBurst(0.35, 0.2); tone(220, 0.25, { type: 'sine', vol: 0.06, slide: 60 }); },
    click()  { tone(720, 0.05, { type: 'triangle', vol: 0.08 }); },
    locked() { tone(160, 0.12, { type: 'square', vol: 0.06 }); },
    win() {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.12, delay: i * 0.12 }));
        tone(1319, 0.4, { type: 'triangle', vol: 0.1, delay: 0.5 });
    },
    drop()   { tone(240, 0.08, { type: 'triangle', vol: 0.05, slide: 140 }); }
};

/* ---------- input ---------- */
const keys = { left: false, right: false, up: false, down: false };
let jumpBufferT = -1;        // pressione salto bufferizzata
let jumpHeld = false;
const uiPresses = [];        // eventi tastiera "di interfaccia" (Enter, Esc...)
const clicks = [];           // click del mouse in coordinate canvas
let mouseX = -100, mouseY = -100;

function bindInput(canvas) {
    const codeMap = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
        KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', Space: 'up'
    };
    window.addEventListener('keydown', (e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
        ensureAudio();
        const k = codeMap[e.code];
        if (k) {
            if (k === 'up' && !e.repeat && !keys.up) { jumpBufferT = 0.12; jumpHeld = true; }
            keys[k] = true;
        }
        if (!e.repeat) {
            if (e.code === 'Enter' || e.code === 'NumpadEnter') uiPresses.push('enter');
            else if (e.code === 'Escape') uiPresses.push('esc');
            else if (e.code === 'KeyM') uiPresses.push('mute');
            else if (e.code === 'KeyR') uiPresses.push('restart');
            else if (e.code === 'KeyQ') uiPresses.push('quit');
            else if (k) uiPresses.push(k);
        }
    });
    window.addEventListener('keyup', (e) => {
        const k = codeMap[e.code];
        if (k) {
            keys[k] = false;
            if (k === 'up') jumpHeld = false;
        }
    });
    window.addEventListener('blur', () => {
        keys.left = keys.right = keys.up = keys.down = false;
        jumpHeld = false;
    });

    function canvasCoords(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (VIEW_W / r.width),
            y: (e.clientY - r.top) * (VIEW_H / r.height)
        };
    }
    canvas.addEventListener('mousemove', (e) => {
        const p = canvasCoords(e);
        mouseX = p.x; mouseY = p.y;
    });
    canvas.addEventListener('mousedown', (e) => {
        ensureAudio();
        const p = canvasCoords(e);
        clicks.push(p);
    });
    // tocco sul canvas (menu e pannelli): equivale a un click
    canvas.addEventListener('touchstart', (e) => {
        ensureAudio();
        const t = e.changedTouches[0];
        if (t) {
            const p = canvasCoords(t);
            mouseX = p.x; mouseY = p.y;
            clicks.push(p);
        }
        e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ---------- temi (luce e cielo realistici) ---------- */
const THEMES = {
    alba: {
        skyTop: '#41628f', skyMid: '#c98d74', skyLow: '#f4c48c', horizonGlow: '#ffdba8',
        sun: { rx: 0.24, ry: 0.315, r: 30, col: '#ffd9a0', glow: 'rgba(255,190,120,0.55)' },
        seaFar: '#5b7d96', seaNear: '#3f6478', clouds: 5, cloudCol: '#e8c4a8',
        sandLight: '#f3dcae', sandBase: '#e3c088', sandDark: '#c49b64',
        ambient: 'rgba(255,150,80,0.10)', stars: 0, haze: 0.35
    },
    giorno: {
        skyTop: '#3f87c4', skyMid: '#8fc3e4', skyLow: '#dceef5', horizonGlow: '#f2fafc',
        sun: { rx: 0.78, ry: 0.13, r: 24, col: '#fff6d8', glow: 'rgba(255,246,210,0.5)' },
        seaFar: '#3a7ba0', seaNear: '#2e657f', clouds: 4, cloudCol: '#ffffff',
        sandLight: '#f6e2b4', sandBase: '#e9c98f', sandDark: '#c8a368',
        ambient: 'rgba(0,0,0,0)', stars: 0, haze: 0.22
    },
    nuvole: {
        skyTop: '#6e88a0', skyMid: '#a5b8c6', skyLow: '#d8e1e6', horizonGlow: '#e8eef0',
        sun: { rx: 0.68, ry: 0.16, r: 20, col: 'rgba(255,255,240,0.55)', glow: 'rgba(255,255,240,0.18)' },
        seaFar: '#4c6c82', seaNear: '#3b586c', clouds: 9, cloudCol: '#e9eef2',
        sandLight: '#e8d6ac', sandBase: '#d9bd8a', sandDark: '#b79966',
        ambient: 'rgba(60,80,100,0.08)', stars: 0, haze: 0.4
    },
    pomeriggio: {
        skyTop: '#3d7ab5', skyMid: '#9cc4dd', skyLow: '#f0e3c0', horizonGlow: '#fdf3d4',
        sun: { rx: 0.3, ry: 0.2, r: 26, col: '#ffedc0', glow: 'rgba(255,230,170,0.45)' },
        seaFar: '#39718f', seaNear: '#2d5b74', clouds: 5, cloudCol: '#fdf4e0',
        sandLight: '#f6e0ae', sandBase: '#e8c68c', sandDark: '#c6a065',
        ambient: 'rgba(255,200,110,0.06)', stars: 0, haze: 0.28
    },
    tramonto: {
        skyTop: '#4b4471', skyMid: '#c96a58', skyLow: '#f7a95e', horizonGlow: '#ffd489',
        sun: { rx: 0.62, ry: 0.325, r: 34, col: '#ffbe6e', glow: 'rgba(255,150,70,0.6)' },
        seaFar: '#5d5a7a', seaNear: '#41425c', clouds: 6, cloudCol: '#e6987e',
        sandLight: '#eec994', sandBase: '#dcae72', sandDark: '#b3854f',
        ambient: 'rgba(255,120,50,0.13)', stars: 0, haze: 0.4
    },
    sera: {
        skyTop: '#232c4e', skyMid: '#6a5a7e', skyLow: '#c97e63', horizonGlow: '#e5a173',
        sun: { rx: 0.5, ry: 0.35, r: 26, col: '#ffb066', glow: 'rgba(255,140,70,0.4)' },
        seaFar: '#3c4463', seaNear: '#2b3149', clouds: 4, cloudCol: '#8d7488',
        sandLight: '#d8b384', sandBase: '#c09a68', sandDark: '#96754c',
        ambient: 'rgba(30,40,90,0.2)', stars: 0.4, haze: 0.35
    },
    notte: {
        skyTop: '#0c1631', skyMid: '#1c2c50', skyLow: '#33486b', horizonGlow: '#4a6284',
        sun: null, moon: { rx: 0.72, ry: 0.14, r: 22 },
        seaFar: '#22344f', seaNear: '#182640', clouds: 3, cloudCol: '#2c3d5c',
        sandLight: '#a9976f', sandBase: '#8d7c58', sandDark: '#665a40',
        ambient: 'rgba(10,20,60,0.33)', stars: 1, haze: 0.3
    }
};
/* ============================================================
   LIVELLI — costruiti a codice con un piccolo builder
   (niente mappe ASCII: meno errori, più controllo)
   Regole di progetto: salite max 2 tile, buchi max 4 tile,
   cunicoli con soffitto alla riga 10 => bisogna accucciarsi.
   ============================================================ */

function LevelBuilder(width) {
    const grid = new Uint8Array(width * ROWS);      // solidi
    const oneway = new Uint8Array(width * ROWS);    // passerelle attraversabili
    const b = {
        width, grid, oneway,
        coins: [], crabs: [], urchins: [], decor: [], hints: [],
        startPos: null, flagPos: null,

        idx(x, y) { return y * width + x; },
        set(x, y, code) { if (x >= 0 && x < width && y >= 0 && y < ROWS) grid[b.idx(x, y)] = code; },
        get(x, y) { return (x < 0 || x >= width || y < 0 || y >= ROWS) ? 0 : grid[b.idx(x, y)]; },

        ground(x0, x1, top = 12, code = T_SAND) {
            for (let x = x0; x <= x1; x++) for (let y = top; y < ROWS; y++) b.set(x, y, code);
            return b;
        },
        stone(x0, x1, y0, y1) {
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) b.set(x, y, T_STONE);
            return b;
        },
        box(x, y, w = 1, h = 1) {
            for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) b.set(x + i, y + j, T_CRATE);
            return b;
        },
        clear(x0, x1, y0, y1) {
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) b.set(x, y, T_EMPTY);
            return b;
        },
        plank(x0, x1, row) {
            for (let x = x0; x <= x1; x++) if (x >= 0 && x < width) oneway[b.idx(x, row)] = 1;
            return b;
        },
        // cunicolo: tetto di casse alla riga "roof" (10 = serve accucciarsi), passaggio libero sotto
        tunnel(x0, x1, roof = 10, code = T_CRATE) {
            for (let x = x0; x <= x1; x++) {
                b.set(x, roof, code);
                b.set(x, roof + 1, T_EMPTY);
            }
            return b;
        },
        topAt(x) {
            for (let y = 0; y < ROWS; y++) if (b.get(x, y)) return y;
            return ROWS;
        },
        coin(x, y) { b.coins.push({ tx: x, ty: y }); return b; },
        coinRow(x0, x1, y) { for (let x = x0; x <= x1; x++) b.coin(x, y); return b; },
        coinArc(x0, x1, yTop) {
            const n = x1 - x0;
            for (let x = x0; x <= x1; x++) {
                const t = n === 0 ? 0.5 : (x - x0) / n;
                b.coin(x, yTop + Math.round((1 - Math.sin(Math.PI * t)) * 1.4));
            }
            return b;
        },
        urchin(x) { b.urchins.push({ tx: x, ty: b.topAt(x) - 1 }); return b; },
        crab(x) { b.crabs.push({ tx: x, ty: b.topAt(x) - 1 }); return b; },
        umbrella(x, c = 0) { b.decor.push({ type: 'umbrella', tx: x, ty: b.topAt(x), c }); return b; },
        cabin(x, c = 0) { b.decor.push({ type: 'cabin', tx: x, ty: b.topAt(x), c }); return b; },
        towel(x, c = 0) { b.decor.push({ type: 'towel', tx: x, ty: b.topAt(x), c }); return b; },
        startAt(x) { b.startPos = { tx: x, ty: b.topAt(x) }; return b; },
        flagAt(x) { b.flagPos = { tx: x, ty: b.topAt(x) }; return b; },
        hint(x, y, text) { b.hints.push({ x: x * TILE, y: y * TILE, text }); return b; }
    };
    return b;
}

const LEVELS = [
    /* ---------- 1 · LA BATTIGIA (alba) — imparare i comandi ---------- */
    {
        name: 'La battigia', theme: 'alba', backdrop: 'beach',
        build(b) {
            b.ground(0, 19).ground(22, 37).ground(41, 67);
            b.ground(30, 33, 11);                       // piccola duna
            b.plank(14, 17, 10).plank(46, 49, 10);
            b.coinRow(6, 9, 11);
            b.coinRow(14, 17, 9);
            b.coinArc(19, 22, 10);
            b.coinRow(25, 28, 11);
            b.coinRow(30, 33, 10);
            b.coinArc(37, 41, 10);
            b.coinRow(46, 49, 9);
            b.coinRow(55, 58, 11);
            b.umbrella(4, 0).umbrella(43, 1).towel(10, 0).towel(60, 2);
            b.startAt(2).flagAt(64);
            b.hint(1.6, 8.1, '←  →   muoviti');
            b.hint(11.5, 6.4, '↑  salta\n(tieni premuto = salto più alto)');
            b.hint(18.6, 7.6, "occhio all'acqua!");
            b.hint(44.5, 6.6, '↓ in aria = giù in picchiata');
        }
    },

    /* ---------- 2 · LA PASSEGGIATA (giorno) — sopra o sotto ---------- */
    {
        name: 'La passeggiata', theme: 'giorno', backdrop: 'beach',
        build(b) {
            b.ground(0, 11).ground(15, 24).ground(29, 44).ground(48, 60).ground(64, 83);
            // via alta (gradino di passerella: non intralcia chi corre a terra)
            b.plank(8, 9, 10);
            b.plank(11, 14, 9).plank(16, 20, 8).plank(22, 26, 8).plank(29, 33, 9);
            b.plank(25, 28, 10);                        // ponte basso sul buco largo
            b.plank(50, 53, 10).plank(55, 58, 9).plank(60, 63, 9);
            b.coinRow(4, 6, 11);
            b.coinRow(16, 20, 7).coinRow(22, 26, 7);
            b.coinRow(25, 28, 9);
            b.coinArc(12, 15, 10);
            b.coinRow(36, 39, 11);
            b.coinArc(45, 48, 10);
            b.coinRow(55, 58, 8).coinRow(60, 63, 8);
            b.coinRow(68, 71, 11).coinRow(74, 76, 10);
            b.umbrella(4, 1).umbrella(38, 2).umbrella(70, 0);
            b.cabin(33, 0).cabin(75, 1).towel(20, 1).towel(56, 3);
            b.startAt(2).flagAt(80);
            b.hint(23, 6.2, 'sopra… o sotto:\nscegli tu la strada');
        }
    },

    /* ---------- 3 · LE CABINE (giorno) — accucciarsi nei cunicoli ---------- */
    {
        name: 'Le cabine', theme: 'giorno', backdrop: 'beach',
        build(b) {
            b.ground(0, 29).ground(33, 57).ground(61, 87);
            b.box(12, 11, 2, 1).box(13, 10, 1, 1);      // scaletta di casse
            b.plank(15, 18, 8);
            b.box(36, 11);                               // gradino per salire sul tetto
            b.tunnel(38, 44, 10);                        // cunicolo: accucciati!
            b.box(66, 11);
            b.tunnel(68, 73, 10);
            b.box(75, 11);
            b.plank(77, 80, 9);
            b.urchin(24).urchin(50).urchin(54);
            b.coinRow(5, 8, 11);
            b.coinRow(15, 18, 7);
            b.coinRow(39, 43, 11);                       // dentro il cunicolo
            b.coinRow(39, 43, 9);                        // sul tetto del cunicolo
            b.coinArc(29, 33, 10);
            b.coinRow(46, 48, 11);
            b.coinArc(57, 61, 10);
            b.coinRow(69, 72, 11);
            b.coinRow(77, 80, 8);
            b.cabin(4, 0).cabin(20, 1).cabin(28, 2).cabin(52, 3).cabin(82, 1);
            b.umbrella(46, 2).towel(63, 0);
            b.startAt(2).flagAt(84);
            b.hint(34.6, 7.3, '↓ a terra = accucciati');
            b.hint(38.5, 8.6, 'striscia nel cunicolo →');
        }
    },

    /* ---------- 4 · IL MOLO (pomeriggio) — granchi in pattuglia ---------- */
    {
        name: 'Il molo', theme: 'pomeriggio', backdrop: 'water',
        build(b) {
            b.stone(0, 9, 11, 13).stone(14, 21, 11, 13).stone(26, 33, 11, 13);
            b.stone(40, 47, 11, 13).stone(54, 63, 11, 13).stone(70, 91, 11, 13);
            b.plank(11, 12, 9).plank(23, 24, 9);
            b.plank(35, 38, 9);
            b.plank(49, 52, 10);
            b.plank(65, 66, 10).plank(68, 69, 9);
            b.crab(58).crab(78).crab(86);
            b.urchin(30).urchin(74);
            b.coinRow(3, 6, 10);
            b.coinRow(11, 12, 8).coinRow(23, 24, 8);
            b.coinRow(16, 19, 10);
            b.coinRow(35, 38, 8);
            b.coinRow(43, 45, 10);
            b.coinRow(49, 52, 9);
            b.coinRow(56, 61, 9);
            b.coinRow(65, 69, 8);
            b.coinRow(80, 83, 10);
            b.umbrella(5, 3).umbrella(60, 1).cabin(88, 2).towel(42, 2);
            b.startAt(2).flagAt(89);
            b.hint(54.5, 7.2, 'salta SOPRA i granchi…\no giraci alla larga');
        }
    },

    /* ---------- 5 · LE DUNE (giorno) — su e giù, ricci di mare ---------- */
    {
        name: 'Le dune', theme: 'giorno', backdrop: 'beach',
        build(b) {
            b.ground(0, 9, 12).ground(10, 17, 11).ground(18, 23, 10).ground(24, 29, 11);
            b.ground(30, 35, 12).ground(39, 46, 12).ground(47, 53, 11).ground(54, 59, 10);
            b.ground(60, 65, 11).ground(69, 95, 12);
            // via alta panoramica
            b.plank(25, 28, 8).plank(30, 33, 7).plank(35, 38, 7);
            b.crab(21).crab(88);
            b.urchin(42).urchin(45).urchin(74).urchin(78).urchin(82);
            b.coinRow(4, 7, 11);
            b.coinRow(12, 15, 10);
            b.coinRow(19, 22, 9);
            b.coinRow(25, 28, 7).coinRow(30, 33, 6).coinRow(35, 38, 6);
            b.coinArc(35, 39, 10);
            b.coinRow(48, 52, 10);
            b.coinRow(55, 58, 9);
            b.coinArc(66, 69, 10);
            b.coin(43, 10).coin(44, 10);
            b.coinRow(75, 77, 10).coinRow(79, 81, 10);
            b.coinRow(88, 91, 11);
            b.umbrella(5, 2).umbrella(62, 0).towel(50, 1).cabin(70, 3);
            b.startAt(2).flagAt(92);
            b.hint(24.5, 5.6, 'lassù pagano di più…');
        }
    },

    /* ---------- 6 · LE PASSERELLE (pomeriggio) — via dei tetti ---------- */
    {
        name: 'Le passerelle', theme: 'pomeriggio', backdrop: 'beach',
        build(b) {
            b.ground(0, 44).ground(48, 77).ground(81, 99);
            // salita alla via alta
            b.box(12, 11, 1, 1).box(13, 10, 1, 2);
            b.plank(15, 20, 8).plank(22, 27, 8).plank(29, 32, 7).plank(34, 39, 8).plank(41, 47, 8);
            // seconda tratta alta
            b.plank(74, 76, 10).plank(78, 81, 9);
            // via bassa: cunicolo e guai
            b.tunnel(62, 67, 10);
            b.box(60, 11);
            b.crab(35).crab(70).crab(90);
            b.urchin(24).urchin(55).urchin(85);
            b.coinRow(15, 20, 7).coinRow(22, 27, 7).coinRow(29, 32, 6).coinRow(34, 39, 7).coinRow(42, 46, 7);
            b.coinRow(5, 8, 11);
            b.coinRow(28, 31, 11);
            b.coinArc(44, 48, 10);
            b.coinRow(50, 53, 11);
            b.coinRow(63, 66, 11);          // nel cunicolo
            b.coinRow(63, 66, 9);           // sopra il cunicolo
            b.coinArc(77, 81, 8);
            b.coinRow(87, 89, 11);
            b.cabin(18, 0).cabin(23, 1).cabin(52, 2).cabin(57, 0).cabin(93, 3);
            b.umbrella(8, 1).umbrella(40, 3).umbrella(64, 2).towel(33, 0);
            b.startAt(2).flagAt(96);
            b.hint(12.5, 6.8, 'di sopra si vola,\ndi sotto si striscia');
        }
    },

    /* ---------- 7 · VENTO SUL MARE (nuvolo) — passerelle a scalini ---------- */
    {
        name: 'Vento sul mare', theme: 'nuvole', backdrop: 'water',
        build(b) {
            b.stone(0, 7, 11, 13).stone(20, 27, 11, 13).stone(44, 51, 11, 13);
            b.stone(68, 75, 11, 13).stone(84, 95, 11, 13);
            b.plank(9, 10, 9).plank(13, 14, 8).plank(17, 18, 9);
            b.plank(29, 30, 9).plank(33, 34, 8).plank(37, 38, 8).plank(41, 42, 9);
            b.plank(53, 54, 10).plank(57, 58, 9).plank(61, 62, 8).plank(65, 66, 9);
            b.plank(77, 78, 9).plank(81, 82, 10);
            b.crab(47).crab(93);
            b.urchin(23).urchin(71);
            b.coinRow(2, 5, 10);
            b.coinRow(9, 10, 8).coinRow(13, 14, 7).coinRow(17, 18, 8);
            b.coinRow(29, 30, 8).coinRow(33, 34, 7).coinRow(37, 38, 7).coinRow(41, 42, 8);
            b.coinRow(21, 26, 10);
            b.coinRow(53, 54, 9).coinRow(57, 58, 8).coinRow(61, 62, 7).coinRow(65, 66, 8);
            b.coinRow(77, 78, 8).coinRow(81, 82, 9);
            b.coinRow(69, 74, 10);
            b.coinRow(85, 87, 10);
            b.umbrella(3, 2).cabin(92, 1).towel(24, 3);
            b.startAt(2).flagAt(89);
            b.hint(7.5, 6.4, 'salti precisi:\nprendi la rincorsa giusta');
        }
    },

    /* ---------- 8 · IL DEPOSITO (tramonto) — labirinto di casse ---------- */
    {
        name: 'Il deposito', theme: 'tramonto', backdrop: 'beach',
        build(b) {
            b.ground(0, 49).ground(53, 99);
            // muro con passaggio basso + scala di casse
            b.box(16, 11).box(18, 10, 1, 2);
            b.box(20, 9, 2, 2);                          // muro: sotto ci si accuccia
            b.box(25, 9, 2, 1);                          // mensola con monete
            b.box(30, 11);
            b.tunnel(32, 38, 10);
            b.crab(43).crab(55).crab(85);
            b.urchin(28).urchin(47).urchin(69).urchin(93);
            // scala + arco dopo il buco
            b.box(56, 11, 2, 1).box(58, 10, 2, 2).box(60, 9, 2, 3);
            b.stone(62, 68, 9, 9);                       // tettoia: sopra si cammina, sotto si passa in piedi
            b.tunnel(74, 79, 10);
            b.box(72, 11);
            b.coinRow(5, 8, 11);
            b.coinRow(20, 21, 8);
            b.coinRow(25, 26, 8);
            b.coinRow(33, 37, 11).coinRow(33, 37, 9);
            b.coinArc(49, 53, 10);
            b.coinRow(62, 68, 8);
            b.coinRow(63, 67, 11);
            b.coinRow(75, 78, 11).coinRow(75, 78, 9);
            b.coinRow(88, 91, 11);
            b.towel(11, 2).cabin(89, 0);
            b.startAt(2).flagAt(96);
            b.hint(15.5, 6.9, 'il deposito del lido:\ncerca i passaggi');
        }
    },

    /* ---------- 9 · IL MOLO LUNGO (sera) — un po' di tutto ---------- */
    {
        name: 'Il molo lungo', theme: 'sera', backdrop: 'water',
        build(b) {
            b.ground(0, 15);
            b.stone(19, 26, 11, 13).stone(30, 39, 11, 13).stone(50, 59, 11, 13);
            b.stone(63, 74, 11, 13).stone(78, 87, 11, 13).stone(96, 109, 11, 13);
            b.plank(41, 42, 9).plank(45, 46, 8).plank(48, 49, 9);
            b.plank(89, 90, 10).plank(93, 94, 9);
            // magazzino sul molo: sotto ci si accuccia, sopra si cammina
            b.box(63, 10, 1, 1);
            b.box(66, 8, 3, 2);
            b.crab(33).crab(55).crab(82).crab(101);
            b.urchin(21).urchin(71).urchin(85).urchin(105);
            b.coinRow(5, 8, 11);
            b.coinArc(16, 18, 10);
            b.coinRow(22, 25, 10);
            b.coinArc(27, 29, 10);
            b.coinRow(34, 37, 10);
            b.coinRow(41, 42, 8).coinRow(45, 46, 7).coinRow(48, 49, 8);
            b.coinRow(52, 57, 9);
            b.coinRow(66, 68, 7);
            b.coinRow(66, 68, 10);
            b.coinArc(75, 77, 10);
            b.coinRow(80, 83, 10);
            b.coinRow(89, 90, 9).coinRow(93, 94, 8);
            b.coinRow(99, 103, 10);
            b.umbrella(8, 0).cabin(12, 2).towel(52, 1).cabin(98, 1);
            b.startAt(2).flagAt(106);
            b.hint(17, 7.2, 'il molo si allunga\nnella sera…');
        }
    },

    /* ---------- 10 · IL FARO (notte) — gran finale ---------- */
    {
        name: 'Il faro', theme: 'notte', backdrop: 'water',
        build(b) {
            b.ground(0, 19, 12).ground(23, 34, 12);
            b.stone(38, 45, 11, 13).stone(56, 65, 11, 13);
            b.ground(69, 84, 12);
            b.stone(88, 111, 11, 13);
            b.plank(47, 48, 9).plank(51, 52, 8).plank(54, 55, 9);
            b.tunnel(74, 79, 10);
            b.box(72, 11);
            // salita finale alla piattaforma del faro
            b.box(94, 10, 2, 1).box(97, 9, 2, 2);
            b.stone(100, 106, 8, 13);
            b.crab(41).crab(63).crab(91);
            b.urchin(27).urchin(31).urchin(59).urchin(81);
            b.coinRow(5, 8, 11);
            b.coinArc(19, 23, 10);
            b.coinRow(25, 30, 10);
            b.coinArc(35, 37, 10);
            b.coinRow(40, 43, 10);
            b.coinRow(47, 48, 8).coinRow(51, 52, 7).coinRow(54, 55, 8);
            b.coinRow(58, 62, 10);
            b.coinArc(66, 68, 10);
            b.coinRow(75, 78, 11).coinRow(75, 78, 9);
            b.coinArc(85, 87, 10);
            b.coinRow(90, 93, 10);
            b.coinRow(94, 95, 9).coinRow(97, 98, 8);
            b.coinRow(99, 102, 7);
            b.towel(10, 3).cabin(15, 1).umbrella(70, 2);
            b.startAt(2).flagAt(103);
            b.hint(89, 6.6, 'ultima salita:\nil faro ti aspetta');
        }
    }
];

function buildWorld(levelIndex) {
    const def = LEVELS[levelIndex];
    // larghezze scelte per livello
    const widths = [68, 84, 88, 92, 96, 100, 96, 100, 110, 112];
    const b = LevelBuilder(widths[levelIndex]);
    def.build(b);

    // decorazioni automatiche sulla sabbia (cespugli, conchiglie, stelle marine)
    const rnd = makeRand(1234 + levelIndex * 777);
    const occupied = new Set();
    for (const d of b.decor) for (let i = -1; i <= 2; i++) occupied.add(d.tx + i);
    if (b.startPos) occupied.add(b.startPos.tx);
    if (b.flagPos) { occupied.add(b.flagPos.tx); occupied.add(b.flagPos.tx - 1); occupied.add(b.flagPos.tx + 1); }
    for (const u of b.urchins) occupied.add(u.tx);
    for (let x = 1; x < b.width - 1; x++) {
        if (occupied.has(x)) continue;
        const top = b.topAt(x);
        if (top >= ROWS) continue;
        if (b.get(x, top) !== T_SAND) continue;
        const r = rnd();
        if (r < 0.10) b.decor.push({ type: 'grass', tx: x, ty: top, c: (rnd() * 3) | 0 });
        else if (r < 0.17) b.decor.push({ type: 'shell', tx: x, ty: top, c: (rnd() * 3) | 0 });
        else if (r < 0.21) b.decor.push({ type: 'star', tx: x, ty: top, c: (rnd() * 2) | 0 });
    }

    return {
        index: levelIndex,
        name: def.name,
        theme: THEMES[def.theme],
        themeName: def.theme,
        backdrop: def.backdrop || 'water',
        width: b.width,
        widthPx: b.width * TILE,
        grid: b.grid,
        oneway: b.oneway,
        coins: b.coins.map(c => ({ x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE / 2, taken: false, phase: (c.tx * 7 + c.ty * 13) % 100 })),
        crabs: b.crabs.map(c => ({ x: c.tx * TILE + 4, y: (c.ty + 1) * TILE - 24, w: 32, h: 24, vx: 44, dead: 0, phase: c.tx % 10 })),
        urchins: b.urchins.map(u => ({ x: u.tx * TILE + 6, y: (u.ty + 1) * TILE - 24, w: 28, h: 24 })),
        decor: b.decor,
        hints: b.hints,
        start: { x: b.startPos.tx * TILE + 5, feetY: b.startPos.ty * TILE },
        flag: { x: b.flagPos.tx * TILE + TILE / 2, baseY: b.flagPos.ty * TILE },
        totalCoins: b.coins.length
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LEVELS, buildWorld, LevelBuilder };
}
/* ============================================================
   MONDO DI GIOCO — fisica, collisioni, entità, stati
   ============================================================ */

const GRAVITY = 2300;
const JUMP_VEL = -520;          // tenendo premuto si sale fino a ~3 tile
const JUMP_CUT = -170;          // rilascio anticipato = salto corto
const RUN_MAX = 280;
const CROUCH_MAX = 112;
const ACCEL_GROUND = 1700;
const ACCEL_AIR = 1150;
const FRICTION_GROUND = 1900;
const FRICTION_AIR = 260;
const FALL_MAX = 800;
const FALL_MAX_FAST = 1000;
const COYOTE = 0.09;

const P_W = 30, P_H_STAND = 56, P_H_CROUCH = 30;

let world = null;
let state = 'menu';             // menu | play | dying | won | pause | gameover
let stateT = 0;
let curLevel = 0;
let runCoins = 0;
const MAX_LIVES = 10;
let lives = MAX_LIVES;          // vite dell'intera partita: a zero si riparte dal livello 1
let introT = 0;
let deathKind = '';
let camX = 0;
let camShake = 0;
let elapsed = 0;                // orologio globale per le animazioni
let winNewBest = false;
let justFinishedAll = false;

const player = {
    x: 0, y: 0, w: P_W, h: P_H_STAND,
    vx: 0, vy: 0, facing: 1,
    grounded: false, coyoteT: 0, onOneway: false, dropT: 0,
    crouching: false, runPhase: 0, landT: 0, airT: 0,
    spin: 0
};

const particles = [];
const floaters = [];

/* ---------- interrogazioni sulla griglia ---------- */
function solidAt(tx, ty) {
    if (!world) return 0;
    if (tx < 0 || tx >= world.width) return T_STONE;   // pareti ai bordi del livello
    if (ty < 0 || ty >= ROWS) return 0;
    return world.grid[ty * world.width + tx];
}
function onewayAt(tx, ty) {
    if (!world) return 0;
    if (tx < 0 || tx >= world.width || ty < 0 || ty >= ROWS) return 0;
    return world.oneway[ty * world.width + tx];
}

function rectHitsSolid(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.01) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++)
            if (solidAt(tx, ty)) return true;
    return false;
}

/* ---------- particelle ---------- */
function spawnParticles(x, y, n, opts) {
    const o = opts || {};
    for (let i = 0; i < n; i++) {
        particles.push({
            x: x + (Math.random() - 0.5) * (o.spread || 10),
            y: y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * (o.vx || 120) + (o.vxBase || 0),
            vy: -Math.random() * (o.vyUp || 90) + (o.vyBase || 0),
            life: 1, decay: (o.decay || 2.2) * (0.7 + Math.random() * 0.6),
            size: (o.size || 3) * (0.6 + Math.random() * 0.8),
            color: o.color || '#d9c08c',
            grav: o.grav !== undefined ? o.grav : 300,
            shape: o.shape || 'dot'
        });
    }
}
function spawnDust(x, y, n) {
    spawnParticles(x, y, n, { color: 'rgba(226,202,150,0.85)', vx: 90, vyUp: 60, size: 3.4, decay: 2.6, grav: -30 });
}
function spawnSplash(x, y) {
    spawnParticles(x, y, 26, { color: 'rgba(210,235,245,0.9)', vx: 220, vyUp: 330, size: 3.2, decay: 1.6, grav: 620, spread: 26 });
    spawnParticles(x, y, 10, { color: 'rgba(160,205,225,0.8)', vx: 120, vyUp: 180, size: 5, decay: 1.8, grav: 520, spread: 30 });
}
function spawnSparkle(x, y, color) {
    spawnParticles(x, y, 8, { color: color || '#ffd75e', vx: 140, vyUp: 130, size: 2.6, decay: 2.8, grav: 90, shape: 'spark' });
}
function spawnConfetti() {
    const cols = ['#e85d4a', '#f2b134', '#4a90ba', '#68b06e', '#e8e4d8'];
    for (let i = 0; i < 60; i++) {
        particles.push({
            x: camX + Math.random() * VIEW_W, y: -10 - Math.random() * 120,
            vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 90,
            life: 1, decay: 0.24, size: 3 + Math.random() * 3,
            color: cols[i % cols.length], grav: 30, shape: 'confetti', phase: Math.random() * 6.28
        });
    }
}
function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color: color || '#fff', t: 0 });
}

/* ---------- ciclo di vita del livello ---------- */
function startLevel(i, keepLives) {
    curLevel = i;
    if (!keepLives) lives = MAX_LIVES;   // partita nuova dal menu (o dopo il game over)
    world = buildWorld(i);
    respawn();
    state = 'play';
    stateT = 0;
    introT = 2.1;
}
function respawn() {
    runCoins = 0;
    for (const c of world.coins) c.taken = false;
    for (const cr of world.crabs) { cr.dead = 0; cr.squashT = 0; cr.x = cr.spawnX !== undefined ? cr.spawnX : (cr.spawnX = cr.x); cr.vx = Math.abs(cr.vx); }
    player.x = world.start.x;
    player.y = world.start.feetY - P_H_STAND;
    player.vx = 0; player.vy = 0; player.h = P_H_STAND;
    player.crouching = false; player.grounded = true; player.coyoteT = 0;
    player.dropT = 0; player.facing = 1; player.spin = 0; player.airT = 0;
    camX = 0; camShake = 0;
    particles.length = 0;
    floaters.length = 0;
    jumpBufferT = -1;
}
function retryLevel() { respawn(); state = 'play'; stateT = 0; introT = 0.9; }
function toMenu() { state = 'menu'; stateT = 0; world = null; }

function die(kind) {
    if (state !== 'play') return;
    lives = Math.max(0, lives - 1);
    deathKind = kind;
    state = 'dying';
    stateT = 0;
    camShake = kind === 'hit' ? 7 : 3;
    if (kind === 'splash') {
        sfx.splash();
        spawnSplash(player.x + player.w / 2, WATER_Y);
    } else {
        sfx.hurt();
        player.vy = -430;
        spawnParticles(player.x + player.w / 2, player.y + player.h / 2, 12, { color: '#e8654a', vx: 200, vyUp: 200, grav: 500 });
    }
}

function winLevel() {
    if (state !== 'play') return;
    state = 'won';
    stateT = 0;
    sfx.win();
    spawnConfetti();
    const idx = String(curLevel);
    const prev = save.best[idx] | 0;
    winNewBest = runCoins > prev && prev > 0;
    if (runCoins > prev) save.best[idx] = runCoins;
    if (curLevel + 1 < N_LEVELS) {
        save.unlocked = Math.max(save.unlocked, curLevel + 2);
    } else {
        justFinishedAll = !save.finished;
        save.finished = true;
    }
    persistSave();
}

/* ---------- aggiornamento giocatore ---------- */
function updatePlayer(dt) {
    const p = player;
    const wasGrounded = p.grounded;
    const prevBottom = p.y + p.h;

    if (jumpBufferT > 0) jumpBufferT -= dt;
    if (p.dropT > 0) p.dropT -= dt;
    if (p.coyoteT > 0) p.coyoteT -= dt;
    if (p.landT > 0) p.landT -= dt;

    /* --- accucciarsi / rialzarsi --- */
    if (p.grounded) {
        if (keys.down && !p.crouching) {
            p.crouching = true;
            p.y += (P_H_STAND - P_H_CROUCH);
            p.h = P_H_CROUCH;
        } else if (!keys.down && p.crouching) {
            const ny = p.y - (P_H_STAND - P_H_CROUCH);
            if (!rectHitsSolid(p.x, ny, p.w, P_H_STAND)) {
                p.crouching = false;
                p.y = ny; p.h = P_H_STAND;
            }
        }
    } else if (p.crouching && !keys.down) {
        const ny = p.y - (P_H_STAND - P_H_CROUCH);
        if (!rectHitsSolid(p.x, ny, p.w, P_H_STAND)) {
            p.crouching = false;
            p.y = ny; p.h = P_H_STAND;
        }
    }

    /* --- movimento orizzontale --- */
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const maxV = (p.crouching && p.grounded) ? CROUCH_MAX : RUN_MAX;
    if (dir !== 0) {
        const acc = p.grounded ? ACCEL_GROUND : ACCEL_AIR;
        p.vx += dir * acc * dt;
        // inversione più reattiva a terra
        if (p.grounded && Math.sign(p.vx) !== dir && Math.abs(p.vx) > 40) p.vx += dir * acc * dt * 0.8;
        p.vx = clamp(p.vx, -maxV, maxV);
        p.facing = dir;
    } else {
        const fr = p.grounded ? FRICTION_GROUND : FRICTION_AIR;
        if (p.vx > 0) p.vx = Math.max(0, p.vx - fr * dt);
        else if (p.vx < 0) p.vx = Math.min(0, p.vx + fr * dt);
    }

    /* --- salto (con buffer e coyote time) --- */
    if (jumpBufferT > 0 && (p.grounded || p.coyoteT > 0)) {
        let doJump = true;
        if (p.crouching) {
            if (keys.down && p.onOneway) {
                // giù + salto su una passerella = ci si lascia cadere sotto
                p.dropT = 0.22;
                p.grounded = false; p.coyoteT = 0;
                doJump = false;
                sfx.drop();
            } else {
                const ny = p.y - (P_H_STAND - P_H_CROUCH);
                if (!rectHitsSolid(p.x, ny, p.w, P_H_STAND)) {
                    p.crouching = false; p.y = ny; p.h = P_H_STAND;
                } else {
                    doJump = false; // incastrato nel cunicolo: non si salta
                }
            }
        } else if (keys.down && p.onOneway) {
            p.dropT = 0.22;
            p.grounded = false; p.coyoteT = 0;
            doJump = false;
            sfx.drop();
        }
        if (doJump) {
            p.vy = JUMP_VEL;
            p.grounded = false; p.coyoteT = 0;
            sfx.jump();
            spawnDust(p.x + p.w / 2, p.y + p.h, 6);
        }
        jumpBufferT = -1;
    }

    /* --- gravità (variabile per il salto modulato) --- */
    let g = GRAVITY;
    if (p.vy < 0 && jumpHeld) g = GRAVITY * 0.5;
    else if (keys.down && !p.grounded) g = GRAVITY * 1.9;
    p.vy += g * dt;
    if (!jumpHeld && p.vy < JUMP_CUT) p.vy = JUMP_CUT;
    const fallCap = (keys.down && !p.grounded) ? FALL_MAX_FAST : FALL_MAX;
    if (p.vy > fallCap) p.vy = fallCap;

    /* --- integrazione X --- */
    let nx = p.x + p.vx * dt;
    if (nx < camX + 2) { nx = camX + 2; if (p.vx < 0) p.vx = 0; }          // non si esce a sinistra dalla schermata
    if (nx + p.w > world.widthPx - 2) { nx = world.widthPx - 2 - p.w; p.vx = 0; }
    if (rectHitsSolid(nx, p.y, p.w, p.h)) {
        const step = Math.sign(nx - p.x) || 1;
        let tx = step > 0 ? Math.floor((nx + p.w - 0.01) / TILE) : Math.floor(nx / TILE);
        nx = step > 0 ? tx * TILE - p.w - 0.01 : (tx + 1) * TILE + 0.01;
        if (rectHitsSolid(nx, p.y, p.w, p.h)) nx = p.x;                     // sicurezza
        p.vx = 0;
    }
    p.x = nx;

    /* --- integrazione Y --- */
    let ny = p.y + p.vy * dt;
    p.grounded = false;
    p.onOneway = false;
    if (p.vy >= 0) {
        // discesa: solidi
        if (rectHitsSolid(p.x, ny, p.w, p.h)) {
            const ty = Math.floor((ny + p.h - 0.01) / TILE);
            ny = ty * TILE - p.h - 0.01;
            if (rectHitsSolid(p.x, ny, p.w, p.h)) ny = p.y;
            if (p.vy > 520) { spawnDust(p.x + p.w / 2, ny + p.h, 8); p.landT = 0.14; }
            p.vy = 0;
            p.grounded = true;
            p.coyoteT = COYOTE;
        } else if (p.dropT <= 0) {
            // passerelle attraversabili
            const newBottom = ny + p.h;
            const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w - 0.01) / TILE);
            let landedAt = -1;
            const ty0 = Math.max(0, Math.floor((prevBottom - 2) / TILE));
            const ty1 = Math.min(ROWS - 1, Math.floor(newBottom / TILE));
            for (let ty = ty0; ty <= ty1 && landedAt < 0; ty++) {
                const top = ty * TILE;
                if (prevBottom <= top + 2 && newBottom >= top) {
                    for (let tx = x0; tx <= x1; tx++) {
                        if (onewayAt(tx, ty)) { landedAt = top; break; }
                    }
                }
            }
            if (landedAt >= 0) {
                ny = landedAt - p.h - 0.01;
                if (p.vy > 520) { spawnDust(p.x + p.w / 2, ny + p.h, 8); p.landT = 0.14; }
                p.vy = 0;
                p.grounded = true;
                p.onOneway = true;
                p.coyoteT = COYOTE;
            }
        }
    } else {
        // salita: testata sul soffitto
        if (rectHitsSolid(p.x, ny, p.w, p.h)) {
            const ty = Math.floor(ny / TILE);
            ny = (ty + 1) * TILE + 0.01;
            if (rectHitsSolid(p.x, ny, p.w, p.h)) ny = p.y;
            p.vy = 0;
        }
    }
    p.y = ny;

    // se atterrati su solido pieno, ricontrolla anche le passerelle sotto i piedi (per onOneway)
    if (p.grounded && !p.onOneway) {
        const tyFeet = Math.floor((p.y + p.h + 1) / TILE);
        const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w - 0.01) / TILE);
        let solidBelow = false;
        for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, tyFeet)) solidBelow = true;
        if (!solidBelow) {
            for (let tx = x0; tx <= x1; tx++) if (onewayAt(tx, tyFeet)) { p.onOneway = true; break; }
        }
    }

    /* --- animazioni --- */
    if (p.grounded) {
        p.airT = 0;
        p.runPhase += Math.abs(p.vx) * dt * 0.055;
        if (Math.abs(p.vx) > 30 && Math.random() < Math.abs(p.vx) / RUN_MAX * 0.14) {
            spawnDust(p.x + p.w / 2 - p.facing * 8, p.y + p.h, 1);
        }
    } else {
        p.airT += dt;
    }

    /* --- cadere in acqua --- */
    if (p.y + p.h > WATER_Y + 14) { die('splash'); return; }

    /* --- monete --- */
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    for (const c of world.coins) {
        if (c.taken) continue;
        const dx = c.x - pcx, dy = c.y - pcy;
        if (dx * dx + dy * dy < 34 * 34) {
            c.taken = true;
            runCoins++;
            sfx.coin();
            spawnSparkle(c.x, c.y);
            addFloater(c.x, c.y - 14, '+1', '#ffd75e');
        }
    }

    /* --- ricci: si evitano e basta --- */
    for (const u of world.urchins) {
        if (p.x < u.x + u.w - 4 && p.x + p.w > u.x + 4 && p.y < u.y + u.h - 2 && p.y + p.h > u.y + 6) {
            die('hit');
            return;
        }
    }

    /* --- granchi: schiacciali dall'alto, non toccarli di lato --- */
    for (const cr of world.crabs) {
        if (cr.dead) continue;
        if (p.x < cr.x + cr.w - 4 && p.x + p.w > cr.x + 4 && p.y < cr.y + cr.h && p.y + p.h > cr.y + 4) {
            if (p.vy > 0 && prevBottom <= cr.y + 12) {
                cr.dead = 1; cr.squashT = 0.6;
                p.vy = -440;
                sfx.stomp();
                camShake = 3;
                spawnParticles(cr.x + cr.w / 2, cr.y + cr.h / 2, 10, { color: '#e07a50', vx: 170, vyUp: 160, grav: 480 });
            } else {
                die('hit');
                return;
            }
        }
    }

    /* --- bandierina! --- */
    const f = world.flag;
    if (Math.abs(pcx - f.x) < 24 && p.y + p.h > f.baseY - 3 * TILE - 10 && p.y < f.baseY + 4) {
        winLevel();
        return;
    }

    /* --- camera: avanza e non torna indietro --- */
    const target = pcx - VIEW_W * 0.42;
    camX = clamp(Math.max(camX, target), 0, world.widthPx - VIEW_W);
}

/* ---------- granchi ---------- */
function updateCrabs(dt) {
    for (const cr of world.crabs) {
        if (cr.dead) { cr.squashT -= dt; continue; }
        const dir = Math.sign(cr.vx) || 1;
        const nx = cr.x + cr.vx * dt;
        const aheadX = dir > 0 ? nx + cr.w + 2 : nx - 2;
        const atx = Math.floor(aheadX / TILE);
        const footTy = Math.floor((cr.y + cr.h + 4) / TILE);
        const bodyTy = Math.floor((cr.y + cr.h / 2) / TILE);
        let turn = false;
        if (solidAt(atx, bodyTy)) turn = true;                                    // muro
        else if (!solidAt(atx, footTy) && !onewayAt(atx, footTy)) turn = true;    // bordo
        else {
            for (const u of world.urchins) {                                       // riccio davanti
                if (Math.abs((u.x + u.w / 2) - aheadX) < 26 && Math.abs(u.y - cr.y) < 30) { turn = true; break; }
            }
        }
        if (turn) cr.vx = -cr.vx;
        else cr.x = nx;
    }
}

/* ---------- particelle e scritte ---------- */
function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const pa = particles[i];
        pa.vy += (pa.grav || 0) * dt;
        pa.x += pa.vx * dt;
        pa.y += pa.vy * dt;
        pa.life -= pa.decay * dt;
        if (pa.shape === 'confetti') pa.phase += dt * 8;
        if (pa.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
        const fl = floaters[i];
        fl.t += dt;
        fl.y -= 34 * dt;
        if (fl.t > 0.9) floaters.splice(i, 1);
    }
}

/* ---------- macchina a stati ---------- */
function updateGame(dt) {
    elapsed += dt;
    stateT += dt;
    if (camShake > 0) camShake = Math.max(0, camShake - dt * 18);
    if (introT > 0) introT -= dt;

    if (state === 'play') {
        updatePlayer(dt);
        if (state === 'play' || state === 'won' || state === 'dying') {
            updateCrabs(dt);
            updateParticles(dt);
        }
    } else if (state === 'dying') {
        // animazione di morte
        if (deathKind === 'hit') {
            player.vy += GRAVITY * dt;
            player.y += player.vy * dt;
            player.x += player.facing * -40 * dt;
            player.spin += dt * 9;
        } else {
            player.y += 60 * dt; // affonda piano nell'acqua
        }
        updateCrabs(dt);
        updateParticles(dt);
        if (stateT > 1.15) {
            if (lives > 0) retryLevel();
            else { state = 'gameover'; stateT = 0; }
        }
    } else if (state === 'gameover') {
        updateParticles(dt);
    } else if (state === 'won') {
        // piccola festa: il giocatore resta lì, i coriandoli scendono
        player.vx = 0;
        if (!player.grounded) {
            player.vy = Math.min(player.vy + GRAVITY * dt, FALL_MAX);
            const ny = player.y + player.vy * dt;
            if (rectHitsSolid(player.x, ny, player.w, player.h)) {
                player.vy = 0; player.grounded = true;
            } else player.y = ny;
        }
        updateParticles(dt);
    } else if (state === 'menu') {
        updateParticles(dt);
    }
    // 'pause': tutto fermo
}
/* ============================================================
   RESA GRAFICA — cielo, mare, sabbia, entità, omino
   ============================================================ */

const HORIZON_Y = 208;
const FONT = "'Nunito', system-ui, sans-serif";

let texCache = { theme: null, sand: null, sandTop: null, crate: null, stone: null, plank: null };
let vignetteCv = null;
let seaLevelSeed = 0;

function txt(s, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.globalAlpha = o.alpha !== undefined ? o.alpha : 1;
    ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 700} ${o.size || 16}px ${FONT}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    if (o.shadow) {
        ctx.shadowColor = o.shadow;
        ctx.shadowBlur = o.shadowBlur || 8;
        ctx.shadowOffsetY = o.shadowY || 2;
    }
    ctx.fillStyle = o.color || '#fff';
    ctx.fillText(s, x, y);
    ctx.restore();
}

function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

/* ---------- texture dei tile (pre-renderizzate per tema) ---------- */
function makeTex(w, h, fn) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    fn(c);
    return cv;
}

function buildTextures(theme) {
    if (texCache.theme === theme) return;
    const rnd = makeRand(20260806);
    texCache.theme = theme;

    texCache.sand = makeTex(TILE, TILE, (c) => {
        c.fillStyle = theme.sandBase;
        c.fillRect(0, 0, TILE, TILE);
        for (let i = 0; i < 26; i++) {
            c.fillStyle = rnd() < 0.5 ? theme.sandDark : theme.sandLight;
            c.globalAlpha = 0.24 + rnd() * 0.3;
            const s = 1 + rnd() * 1.8;
            c.fillRect(rnd() * TILE, rnd() * TILE, s, s);
        }
        c.globalAlpha = 0.1;
        c.fillStyle = theme.sandDark;
        c.fillRect(0, TILE - 3, TILE, 3);
        c.globalAlpha = 1;
    });

    texCache.sandTop = makeTex(TILE, 12, (c) => {
        c.fillStyle = theme.sandLight;
        c.beginPath();
        c.moveTo(0, 12);
        c.lineTo(0, 5);
        for (let x = 0; x <= TILE; x += 5) c.lineTo(x, 4 + Math.sin(x * 1.7) * 1.6 + rnd() * 1.2);
        c.lineTo(TILE, 12);
        c.closePath();
        c.fill();
        for (let i = 0; i < 6; i++) {
            c.fillStyle = theme.sandDark;
            c.globalAlpha = 0.35;
            c.beginPath();
            c.arc(rnd() * TILE, 7 + rnd() * 4, 0.8 + rnd(), 0, 7);
            c.fill();
        }
        c.globalAlpha = 1;
    });

    texCache.crate = makeTex(TILE, TILE, (c) => {
        const g = c.createLinearGradient(0, 0, 0, TILE);
        g.addColorStop(0, '#c08b56');
        g.addColorStop(1, '#9c6c40');
        c.fillStyle = g;
        c.fillRect(0, 0, TILE, TILE);
        c.strokeStyle = 'rgba(90,58,30,0.8)';
        c.lineWidth = 3;
        c.strokeRect(1.5, 1.5, TILE - 3, TILE - 3);
        c.strokeStyle = 'rgba(90,58,30,0.4)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(3, 3); c.lineTo(TILE - 3, TILE - 3);
        c.moveTo(TILE - 3, 3); c.lineTo(3, TILE - 3);
        c.stroke();
        c.fillStyle = 'rgba(255,230,190,0.28)';
        c.fillRect(3, 3, TILE - 6, 3);
        c.fillStyle = 'rgba(70,44,22,0.85)';
        [[6, 6], [TILE - 8, 6], [6, TILE - 8], [TILE - 8, TILE - 8]].forEach(p => {
            c.beginPath(); c.arc(p[0] + 1, p[1] + 1, 1.6, 0, 7); c.fill();
        });
    });

    texCache.stone = makeTex(TILE, TILE, (c) => {
        const g = c.createLinearGradient(0, 0, 0, TILE);
        g.addColorStop(0, '#c4bbaa');
        g.addColorStop(1, '#a49a88');
        c.fillStyle = g;
        c.fillRect(0, 0, TILE, TILE);
        for (let i = 0; i < 22; i++) {
            c.fillStyle = rnd() < 0.5 ? 'rgba(120,110,95,0.35)' : 'rgba(235,228,212,0.3)';
            const s = 1 + rnd() * 2.4;
            c.fillRect(rnd() * TILE, rnd() * TILE, s, s);
        }
        c.strokeStyle = 'rgba(105,96,82,0.5)';
        c.lineWidth = 2;
        c.strokeRect(0, 0, TILE, TILE);
        c.fillStyle = 'rgba(245,240,225,0.4)';
        c.fillRect(0, 0, TILE, 3);
    });

    texCache.plank = makeTex(TILE, 12, (c) => {
        const g = c.createLinearGradient(0, 0, 0, 12);
        g.addColorStop(0, '#b3814f');
        g.addColorStop(0.35, '#a06e42');
        g.addColorStop(1, '#7e5432');
        c.fillStyle = g;
        c.fillRect(0, 0, TILE, 12);
        c.strokeStyle = 'rgba(70,44,22,0.5)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, 4.5); c.lineTo(TILE, 4.5);
        c.moveTo(0, 9.5); c.lineTo(TILE, 9.5);
        c.stroke();
        c.fillStyle = 'rgba(255,235,200,0.35)';
        c.fillRect(0, 0, TILE, 1.6);
        c.fillStyle = 'rgba(60,38,18,0.8)';
        c.beginPath(); c.arc(7, 6, 1.3, 0, 7); c.fill();
        c.beginPath(); c.arc(TILE - 7, 6, 1.3, 0, 7); c.fill();
    });
}

/* ---------- cielo, mare, sfondo ---------- */
function drawSky(theme, levelIdx) {
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 40);
    g.addColorStop(0, theme.skyTop);
    g.addColorStop(0.62, theme.skyMid);
    g.addColorStop(1, theme.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, HORIZON_Y + 40);

    // stelle
    if (theme.stars > 0) {
        const rnd = makeRand(99 + levelIdx);
        ctx.save();
        for (let i = 0; i < 70 * theme.stars; i++) {
            const sx = rnd() * VIEW_W, sy = rnd() * (HORIZON_Y - 30);
            const tw = 0.4 + 0.6 * Math.abs(Math.sin(elapsed * (0.6 + rnd()) + i));
            ctx.globalAlpha = tw * (0.25 + rnd() * 0.55) * theme.stars;
            ctx.fillStyle = '#dfe8ff';
            ctx.fillRect(sx, sy, rnd() < 0.12 ? 2 : 1.2, 1.2);
        }
        ctx.restore();
    }

    // sole o luna
    if (theme.sun) {
        const sx = theme.sun.rx * VIEW_W, sy = theme.sun.ry * (HORIZON_Y + 40);
        const gl = ctx.createRadialGradient(sx, sy, 2, sx, sy, theme.sun.r * 4);
        gl.addColorStop(0, theme.sun.glow);
        gl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gl;
        ctx.fillRect(sx - theme.sun.r * 4, sy - theme.sun.r * 4, theme.sun.r * 8, theme.sun.r * 8);
        ctx.fillStyle = theme.sun.col;
        ctx.beginPath(); ctx.arc(sx, sy, theme.sun.r, 0, 7); ctx.fill();
    }
    if (theme.moon) {
        const mx = theme.moon.rx * VIEW_W, my = theme.moon.ry * (HORIZON_Y + 40);
        const gl = ctx.createRadialGradient(mx, my, 2, mx, my, theme.moon.r * 4.4);
        gl.addColorStop(0, 'rgba(200,215,255,0.35)');
        gl.addColorStop(1, 'rgba(200,215,255,0)');
        ctx.fillStyle = gl;
        ctx.fillRect(mx - 110, my - 110, 220, 220);
        ctx.fillStyle = '#e8edf5';
        ctx.beginPath(); ctx.arc(mx, my, theme.moon.r, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(160,175,205,0.55)';
        ctx.beginPath(); ctx.arc(mx - 6, my - 4, 4.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(mx + 7, my + 6, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(mx + 2, my - 9, 2.2, 0, 7); ctx.fill();
    }

    // foschia sull'orizzonte
    const hz = ctx.createLinearGradient(0, HORIZON_Y - 46, 0, HORIZON_Y + 6);
    hz.addColorStop(0, 'rgba(255,255,255,0)');
    hz.addColorStop(1, theme.horizonGlow);
    ctx.save();
    ctx.globalAlpha = theme.haze;
    ctx.fillStyle = hz;
    ctx.fillRect(0, HORIZON_Y - 46, VIEW_W, 52);
    ctx.restore();

    // nuvole (lento parallasse)
    const rnd = makeRand(500 + levelIdx * 31);
    ctx.save();
    for (let i = 0; i < theme.clouds; i++) {
        const baseX = rnd() * 1400, cy = 24 + rnd() * 120, sc = 0.6 + rnd() * 0.9;
        const drift = elapsed * (3 + rnd() * 5);
        let cx = (baseX + drift - camX * 0.05) % 1400;
        if (cx < -200) cx += 1400;
        ctx.globalAlpha = 0.5 + rnd() * 0.3;
        ctx.fillStyle = theme.cloudCol;
        for (let k = 0; k < 4; k++) {
            const ox = (k - 1.5) * 26 * sc, oy = Math.sin(k * 2.1) * 6 * sc;
            ctx.beginPath();
            ctx.ellipse(cx + ox, cy + oy, (26 - Math.abs(k - 1.5) * 7) * sc, 13 * sc, 0, 0, 7);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawSea(theme, levelIdx) {
    const isBeach = !!(world && world.backdrop === 'beach');
    const seaBot = isBeach ? 356 : VIEW_H;
    const g = ctx.createLinearGradient(0, HORIZON_Y, 0, seaBot + (isBeach ? 30 : 0));
    g.addColorStop(0, theme.seaFar);
    g.addColorStop(1, theme.seaNear);
    ctx.fillStyle = g;
    ctx.fillRect(0, HORIZON_Y, VIEW_W, seaBot - HORIZON_Y);

    // linea dell'orizzonte
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, HORIZON_Y, VIEW_W, 1.5);

    // scintillio del mare
    ctx.save();
    const rnd = makeRand(700 + levelIdx * 17);
    for (let row = 0; row < 12; row++) {
        const y = HORIZON_Y + 6 + row * row * 1.9;
        if (y > seaBot - 10) break;
        const alpha = 0.16 * (1 - row / 14);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#e8f4f8';
        const speed = 8 + row * 3;
        for (let i = 0; i < 7; i++) {
            const w = 14 + rnd() * 46 + row * 6;
            let x = (rnd() * 1100 + elapsed * speed * (i % 2 ? 1 : -0.7) - camX * (0.03 + row * 0.008)) % 1100;
            if (x < -w) x += 1100;
            ctx.fillRect(x, y + Math.sin(elapsed * 1.4 + i * 2 + row) * 1.4, w, 1.6);
        }
    }
    ctx.restore();

    // barchette a vela lontane (solo col chiaro)
    if (!theme.moon) {
        const rnd2 = makeRand(90 + levelIdx * 7);
        ctx.save();
        for (let i = 0; i < 2; i++) {
            let x = (rnd2() * 900 + elapsed * (2.5 + i) - camX * 0.04) % 1000;
            if (x < -40) x += 1000;
            const y = HORIZON_Y + 10 + rnd2() * 14;
            const s = 0.5 + rnd2() * 0.5;
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = '#3c4a55';
            ctx.beginPath();
            ctx.moveTo(x - 9 * s, y); ctx.lineTo(x + 9 * s, y); ctx.lineTo(x + 5 * s, y + 3.5 * s); ctx.lineTo(x - 5 * s, y + 3.5 * s);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#eef2f0';
            ctx.beginPath();
            ctx.moveTo(x, y - 1.5); ctx.lineTo(x, y - 14 * s); ctx.lineTo(x + 7 * s, y - 2.5); ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x - 1.5, y - 2); ctx.lineTo(x - 6 * s, y - 2); ctx.lineTo(x - 1.5, y - 10 * s); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
    }

    // spiaggia asciutta alle spalle del percorso (livelli "beach")
    if (isBeach) {
        const bg = ctx.createLinearGradient(0, seaBot - 8, 0, VIEW_H);
        bg.addColorStop(0, mixHex(theme.sandLight, '#ffffff', 0.22));
        bg.addColorStop(0.35, theme.sandLight);
        bg.addColorStop(1, theme.sandBase);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(0, seaBot + 6);
        for (let x = 0; x <= VIEW_W; x += 16) {
            ctx.lineTo(x, seaBot + Math.sin((x + camX * 0.25) * 0.025) * 4);
        }
        ctx.lineTo(VIEW_W, VIEW_H);
        ctx.lineTo(0, VIEW_H);
        ctx.closePath();
        ctx.fill();
        // bagnasciuga: linea di schiuma animata
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let x = 0; x <= VIEW_W; x += 10) {
            const y = seaBot + Math.sin((x + camX * 0.25) * 0.025) * 4 + Math.sin(elapsed * 1.7 + x * 0.04) * 2;
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = theme.sandDark;
        for (let i = 0; i < 40; i++) {
            const rx = ((i * 97 + 31) % 960);
            const ry = seaBot + 22 + ((i * 53) % Math.max(1, VIEW_H - seaBot - 30));
            ctx.fillRect(rx, ry, 2.2, 2.2);
        }
        ctx.restore();
    }

    // faro lontano all'orizzonte (in tutti i livelli tranne l'ultimo, dove è vicino)
    if (world && world.index < 9) {
        const fx = VIEW_W - 90 - camX * 0.015;
        drawLighthouse(fx, HORIZON_Y + 2, 0.32, false);
    }

    // gabbiani
    if (!theme.moon) {
        const rnd3 = makeRand(40 + levelIdx * 3);
        ctx.save();
        ctx.strokeStyle = 'rgba(60,70,80,0.75)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
            let x = (rnd3() * 800 + elapsed * (14 + i * 6) - camX * 0.1) % (VIEW_W + 200);
            if (x < -60) x += VIEW_W + 200;
            const y = 60 + rnd3() * 90 + Math.sin(elapsed * 0.7 + i * 2.4) * 10;
            const f = Math.sin(elapsed * 7 + i * 1.7) * 4;
            const s = 0.8 + rnd3() * 0.5;
            ctx.beginPath();
            ctx.moveTo(x - 8 * s, y + f * 0.4);
            ctx.quadraticCurveTo(x - 3 * s, y - 3 - f, x, y);
            ctx.quadraticCurveTo(x + 3 * s, y - 3 - f, x + 8 * s, y + f * 0.4);
            ctx.stroke();
        }
        ctx.restore();
    }
}

function drawLighthouse(x, baseY, scale, near) {
    ctx.save();
    ctx.translate(x, baseY);
    ctx.scale(scale, scale);
    const H = 300;
    // torre a strisce
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#e8e2d4' : '#c94f3d';
        const yy = -H + (i * H / 6);
        const wTop = 26 + (i) * 3.2, wBot = 26 + (i + 1) * 3.2;
        ctx.beginPath();
        ctx.moveTo(-wTop, yy); ctx.lineTo(wTop, yy);
        ctx.lineTo(wBot, yy + H / 6); ctx.lineTo(-wBot, yy + H / 6);
        ctx.closePath(); ctx.fill();
    }
    // ombreggiatura laterale
    const sg = ctx.createLinearGradient(-46, 0, 46, 0);
    sg.addColorStop(0, 'rgba(40,40,60,0.35)');
    sg.addColorStop(0.45, 'rgba(0,0,0,0)');
    sg.addColorStop(1, 'rgba(40,40,60,0.2)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-26, -H); ctx.lineTo(26, -H); ctx.lineTo(46, 0); ctx.lineTo(-46, 0);
    ctx.closePath(); ctx.fill();
    // lanterna
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(-20, -H - 26, 40, 26);
    ctx.fillStyle = near ? '#ffe9a3' : '#d8d2be';
    ctx.fillRect(-14, -H - 22, 28, 18);
    ctx.fillStyle = '#912f24';
    ctx.beginPath();
    ctx.moveTo(-24, -H - 26); ctx.lineTo(0, -H - 44); ctx.lineTo(24, -H - 26);
    ctx.closePath(); ctx.fill();
    // galleria
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(-26, -H - 4, 52, 6);
    ctx.restore();

    // fascio di luce rotante (solo da vicino, di notte)
    if (near) {
        const ly = baseY - 300 * scale - 13 * scale * 2;
        const ang = Math.sin(elapsed * 0.55) * 1.15;
        for (const dir of [1, -1]) {
            ctx.save();
            ctx.translate(x, ly);
            ctx.rotate(ang * dir + (dir < 0 ? Math.PI : 0));
            const bg = ctx.createLinearGradient(0, 0, 560, 0);
            bg.addColorStop(0, 'rgba(255,236,170,0.34)');
            bg.addColorStop(1, 'rgba(255,236,170,0)');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.moveTo(0, -3);
            ctx.lineTo(560, -46);
            ctx.lineTo(560, 46);
            ctx.lineTo(0, 3);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        const gl = ctx.createRadialGradient(x, ly, 1, x, ly, 60 * scale + 26);
        gl.addColorStop(0, 'rgba(255,240,180,0.8)');
        gl.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(x, ly, 60 * scale + 26, 0, 7); ctx.fill();
    }
}

/* ---------- decorazioni da spiaggia ---------- */
const CABIN_COLORS = [['#4a7fb5', '#eef2ee'], ['#c95f4e', '#f2ece0'], ['#68a06e', '#f0f2ea'], ['#d9a13e', '#f5efdd']];
const UMB_COLORS = [['#d95445', '#f2ece0'], ['#3d7ab5', '#eef2ee'], ['#e8a03c', '#f5efdd'], ['#5a9e68', '#f0f2ea']];

function drawCabin(px, py, ci) {
    const col = CABIN_COLORS[ci % CABIN_COLORS.length];
    const w = 76, h = 62;
    ctx.save();
    ctx.translate(px + 2, py);
    // ombra
    ctx.fillStyle = 'rgba(60,45,25,0.18)';
    ctx.beginPath(); ctx.ellipse(w / 2, 2, w * 0.55, 5, 0, 0, 7); ctx.fill();
    // corpo a strisce verticali
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? col[1] : col[0];
        ctx.fillRect(i * w / 6, -h, w / 6 + 0.5, h);
    }
    // ombreggiatura
    const g = ctx.createLinearGradient(0, -h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(70,50,30,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, -h, w, h);
    // porta
    ctx.fillStyle = 'rgba(60,42,26,0.75)';
    rr(w / 2 - 11, -h + 18, 22, h - 18, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(w / 2 - 8, -h + 24, 16, 2);
    // tetto
    ctx.fillStyle = mixHex(col[0], '#3c2f22', 0.35);
    ctx.beginPath();
    ctx.moveTo(-6, -h);
    ctx.lineTo(w / 2, -h - 22);
    ctx.lineTo(w + 6, -h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(-6, -h); ctx.lineTo(w / 2, -h - 22); ctx.lineTo(w / 2, -h - 18); ctx.lineTo(-1, -h);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawUmbrella(px, py, ci) {
    const col = UMB_COLORS[ci % UMB_COLORS.length];
    ctx.save();
    ctx.translate(px + TILE / 2, py);
    ctx.fillStyle = 'rgba(60,45,25,0.2)';
    ctx.beginPath(); ctx.ellipse(6, 1, 30, 4.5, 0, 0, 7); ctx.fill();
    ctx.rotate(-0.12);
    // palo
    ctx.fillStyle = '#8a6b4a';
    ctx.fillRect(-2, -74, 4, 74);
    // calotta
    const R = 38;
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? col[1] : col[0];
        const a0 = Math.PI + (i / 6) * Math.PI;
        const a1 = Math.PI + ((i + 1) / 6) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(0, -70);
        ctx.arc(0, -70, R, a0, a1);
        ctx.closePath();
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(80,55,30,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -70, R, Math.PI, 0);
    ctx.stroke();
    // festoni sull'orlo
    ctx.fillStyle = col[0];
    for (let i = 0; i < 5; i++) {
        const ax = -R + (i + 0.5) * (R * 2 / 5);
        ctx.beginPath();
        ctx.arc(ax, -70, 5.5, 0, Math.PI);
        ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, -70 - R, 3, 0, 7); ctx.fill();
    ctx.restore();
}

function drawTowel(px, py, ci) {
    const col = UMB_COLORS[(ci + 1) % UMB_COLORS.length];
    ctx.save();
    ctx.translate(px + 2, py);
    ctx.rotate(0.02);
    ctx.fillStyle = col[0];
    rr(0, -7, 52, 8, 2); ctx.fill();
    ctx.fillStyle = col[1];
    for (let i = 0; i < 3; i++) ctx.fillRect(6 + i * 16, -7, 6, 8);
    ctx.fillStyle = 'rgba(60,45,25,0.15)';
    ctx.fillRect(0, 0, 52, 2);
    ctx.restore();
}

function drawGrass(px, py, ci) {
    ctx.save();
    ctx.translate(px + TILE / 2, py + 1);
    ctx.strokeStyle = ['#8a9a5c', '#7c9052', '#9aa768'][ci % 3];
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const sway = Math.sin(elapsed * 1.7 + px * 0.05) * 2.2;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3.4, 0);
        ctx.quadraticCurveTo(i * 4 + sway * 0.4, -8, i * 4.4 + sway, -14 - Math.abs(i) * -2.4);
        ctx.stroke();
    }
    ctx.restore();
}

function drawShell(px, py, ci) {
    ctx.save();
    ctx.translate(px + TILE / 2, py - 3);
    ctx.rotate((ci - 1) * 0.5);
    ctx.fillStyle = ['#e8d8c8', '#dfc8b8', '#e2d2d8'][ci % 3];
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,110,90,0.5)';
    ctx.lineWidth = 0.8;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(i * 2.4, -4.6);
        ctx.stroke();
    }
    ctx.restore();
}

function drawStarfish(px, py, ci) {
    ctx.save();
    ctx.translate(px + TILE / 2, py - 4);
    ctx.rotate(ci * 0.7);
    ctx.fillStyle = ci % 2 ? '#d97b52' : '#c9694a';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
        ctx.lineTo(Math.cos(a2) * 2.8, Math.sin(a2) * 2.8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/* ---------- tile e acqua ---------- */
function drawTiles() {
    const tx0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const tx1 = Math.min(world.width - 1, Math.ceil((camX + VIEW_W) / TILE) + 1);

    // acqua di fondo nei varchi (dietro ai tile)
    for (let tx = tx0; tx <= tx1; tx++) {
        let hasSolid = false;
        for (let ty = 0; ty < ROWS; ty++) if (world.grid[ty * world.width + tx]) { hasSolid = true; break; }
        if (!hasSolid) {
            const x = tx * TILE;
            const g = ctx.createLinearGradient(0, WATER_Y - 6, 0, VIEW_H);
            g.addColorStop(0, 'rgba(62,112,146,0.92)');
            g.addColorStop(1, 'rgba(14,40,62,0.97)');
            ctx.fillStyle = g;
            ctx.fillRect(x, WATER_Y - 4, TILE, VIEW_H - WATER_Y + 4);
        }
    }

    for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = 0; ty < ROWS; ty++) {
            const code = world.grid[ty * world.width + tx];
            if (!code) continue;
            const x = tx * TILE, y = ty * TILE;
            if (code === T_SAND) {
                ctx.drawImage(texCache.sand, x, y);
                if (!solidAt(tx, ty - 1)) ctx.drawImage(texCache.sandTop, x, y);
            } else if (code === T_CRATE) {
                ctx.drawImage(texCache.crate, x, y);
            } else if (code === T_STONE) {
                ctx.drawImage(texCache.stone, x, y);
                if (!solidAt(tx, ty - 1)) {
                    ctx.fillStyle = 'rgba(250,246,232,0.5)';
                    ctx.fillRect(x, y, TILE, 2.5);
                }
            }
        }
    }

    // passerelle con paletti di sostegno
    for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = 0; ty < ROWS; ty++) {
            if (!world.oneway[ty * world.width + tx]) continue;
            const x = tx * TILE, y = ty * TILE;
            const leftEnd = !onewayAt(tx - 1, ty);
            const rightEnd = !onewayAt(tx + 1, ty);
            // paletti alle estremità
            if (leftEnd || rightEnd) {
                let footY = WATER_Y + 8;
                for (let sy = ty + 1; sy < ROWS; sy++) {
                    if (solidAt(tx, sy)) { footY = sy * TILE + 2; break; }
                }
                const px = leftEnd ? x + 5 : x + TILE - 10;
                ctx.fillStyle = '#6e4e30';
                ctx.fillRect(px, y + 10, 5, footY - y - 10);
                ctx.fillStyle = 'rgba(0,0,0,0.22)';
                ctx.fillRect(px + 3.6, y + 10, 1.4, footY - y - 10);
            }
            ctx.drawImage(texCache.plank, x, y);
        }
    }

    // superficie dell'acqua nei varchi (davanti ai tile)
    ctx.save();
    for (let tx = tx0; tx <= tx1; tx++) {
        let hasSolid = false;
        for (let ty = 0; ty < ROWS; ty++) if (world.grid[ty * world.width + tx]) { hasSolid = true; break; }
        if (!hasSolid) {
            const x = tx * TILE;
            const bob = Math.sin(elapsed * 2.1 + tx * 0.8) * 2.2;
            ctx.fillStyle = 'rgba(225,242,248,0.65)';
            ctx.fillRect(x - 1, WATER_Y - 3 + bob, TILE + 2, 2.6);
            ctx.fillStyle = 'rgba(160,205,228,0.4)';
            ctx.fillRect(x - 1, WATER_Y + bob, TILE + 2, 5);
        }
    }
    ctx.restore();
}

/* ---------- entità ---------- */
function drawCoin(c) {
    const bobY = c.y + Math.sin(elapsed * 2.6 + c.phase) * 3;
    const sq = Math.abs(Math.cos(elapsed * 2.4 + c.phase * 0.4));
    ctx.save();
    ctx.translate(c.x, bobY);
    ctx.scale(0.35 + 0.65 * sq, 1);
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
    g.addColorStop(0, '#ffe9a0');
    g.addColorStop(0.65, '#f2b135');
    g.addColorStop(1, '#c9862a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(130,85,20,0.8)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,210,0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 6.6, 0, 7); ctx.stroke();
    ctx.restore();
    // scintilla
    const tw = (elapsed * 1.3 + c.phase) % 3;
    if (tw < 0.28) {
        ctx.save();
        ctx.globalAlpha = 1 - tw / 0.28;
        ctx.fillStyle = '#fff8dc';
        ctx.translate(c.x + 5, bobY - 6);
        ctx.rotate(tw * 4);
        ctx.fillRect(-4, -0.8, 8, 1.6);
        ctx.fillRect(-0.8, -4, 1.6, 8);
        ctx.restore();
    }
}

function drawUrchin(u) {
    const cx = u.x + u.w / 2, cy = u.y + u.h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#241c30';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (let i = 0; i < 13; i++) {
        const a = Math.PI + (i / 12) * Math.PI;
        const wig = Math.sin(elapsed * 2 + i) * 0.04;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a + wig) * 6, Math.sin(a + wig) * 6 - 2);
        ctx.lineTo(Math.cos(a + wig) * 17, Math.sin(a + wig) * 17 - 2);
        ctx.stroke();
    }
    const g = ctx.createRadialGradient(-3, -8, 1, 0, -4, 13);
    g.addColorStop(0, '#4a3a5e');
    g.addColorStop(1, '#1d1728');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -2, 11, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(190,170,220,0.5)';
    ctx.beginPath(); ctx.arc(-4, -7, 2, 0, 7); ctx.fill();
    ctx.restore();
}

function drawCrab(cr) {
    const cx = cr.x + cr.w / 2, cy = cr.y + cr.h;
    const squash = cr.dead ? clamp(cr.squashT / 0.6, 0, 1) : 1;
    ctx.save();
    ctx.translate(cx, cy);
    if (cr.dead) ctx.globalAlpha = squash;
    ctx.scale(1 + (cr.dead ? 0.3 : 0), cr.dead ? 0.35 : 1);
    const walk = elapsed * 9 + cr.phase;
    // zampe
    ctx.strokeStyle = '#a8412a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < 3; i++) {
            const lift = Math.sin(walk + i * 2.1 + (s > 0 ? 0 : 3)) * 2.4;
            ctx.beginPath();
            ctx.moveTo(s * 8, -7);
            ctx.quadraticCurveTo(s * 15, -6, s * (16 + i * 2.4), -0.5 - Math.max(0, lift));
            ctx.stroke();
        }
    }
    // corpo
    const g = ctx.createRadialGradient(-4, -12, 2, 0, -9, 16);
    g.addColorStop(0, '#e87a52');
    g.addColorStop(1, '#c04226');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -9, 15, 10, 0, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,40,20,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -9, 15, 10, 0, 0, 7);
    ctx.stroke();
    // chele
    const dir = Math.sign(cr.vx) || 1;
    for (let s = -1; s <= 1; s += 2) {
        const cxx = s * 13, open = Math.sin(walk * 0.7 + s) * 0.15;
        ctx.fillStyle = '#d05530';
        ctx.beginPath();
        ctx.arc(cxx, -14, 4.6, Math.PI * (0.9 + open), Math.PI * (2.4 + open));
        ctx.fill();
    }
    // occhi
    for (let s = -1; s <= 1; s += 2) {
        ctx.strokeStyle = '#8a3018';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(s * 4, -16);
        ctx.lineTo(s * 5.5, -21);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s * 5.5, -22, 2.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#20140e';
        ctx.beginPath(); ctx.arc(s * 5.5 + dir * 0.9, -22, 1.3, 0, 7); ctx.fill();
    }
    ctx.restore();
}

function drawFlag(f) {
    const poleH = 3 * TILE + 12;
    const x = f.x, base = f.baseY;
    ctx.save();
    // basetta
    ctx.fillStyle = 'rgba(60,45,25,0.25)';
    ctx.beginPath(); ctx.ellipse(x, base + 1, 16, 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#8a8274';
    rr(x - 7, base - 6, 14, 7, 2); ctx.fill();
    // palo
    const pg = ctx.createLinearGradient(x - 2.5, 0, x + 2.5, 0);
    pg.addColorStop(0, '#d8d2c4');
    pg.addColorStop(0.5, '#f2eee2');
    pg.addColorStop(1, '#b0a996');
    ctx.fillStyle = pg;
    ctx.fillRect(x - 2.5, base - poleH, 5, poleH - 4);
    ctx.fillStyle = '#e0b53e';
    ctx.beginPath(); ctx.arc(x, base - poleH - 3, 4.5, 0, 7); ctx.fill();
    // bandiera che sventola
    const fy = base - poleH + 6;
    ctx.fillStyle = '#d6493a';
    ctx.beginPath();
    ctx.moveTo(x + 3, fy);
    const L = 44;
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        ctx.lineTo(x + 3 + t * L, fy + Math.sin(elapsed * 7 - t * 4) * 3.4 * t + t * 2);
    }
    for (let i = 10; i >= 0; i--) {
        const t = i / 10;
        ctx.lineTo(x + 3 + t * L, fy + 24 - t * 5 + Math.sin(elapsed * 7 - t * 4 + 0.6) * 3.4 * t);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x + 16, fy + 11, 5.5, 0, 7);
    ctx.fill();
    ctx.restore();
}

/* ---------- l'omino ---------- */
const SKIN = '#e8b28a', SKIN_D = '#d09a72', CAP = '#d6493a', SHIRT = '#f2ede0', SHORTS = '#3f6a9e', SHOE = '#7a5230';

function drawPlayer() {
    const p = player;
    const fx = p.x + p.w / 2;
    const fy = p.y + p.h;
    const crouch = p.h < 40;
    const speed = Math.abs(p.vx) / RUN_MAX;
    const dir = p.facing;

    // ombra a terra
    let shadowY = -1;
    const txm = Math.floor(fx / TILE);
    for (let ty = Math.floor(fy / TILE); ty < ROWS; ty++) {
        if (solidAt(txm, ty) || onewayAt(txm, ty)) { shadowY = ty * TILE; break; }
    }
    if (shadowY > 0) {
        const dh = clamp(1 - (shadowY - fy) / 260, 0.15, 1);
        ctx.save();
        ctx.globalAlpha = 0.26 * dh;
        ctx.fillStyle = '#241a10';
        ctx.beginPath();
        ctx.ellipse(fx, shadowY + 3, 16 * dh + 4, 4.4 * dh + 1, 0, 0, 7);
        ctx.fill();
        ctx.restore();
    }

    ctx.save();
    ctx.translate(fx, fy);
    if (state === 'dying' && deathKind === 'hit') ctx.rotate(p.spin);
    ctx.scale(dir, 1);
    if (p.landT > 0) {
        const s = p.landT / 0.14;
        ctx.scale(1 + 0.12 * s, 1 - 0.14 * s);
    }

    const run = p.runPhase;
    const moving = speed > 0.12 && p.grounded;
    const inAir = !p.grounded;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (!crouch) {
        const hipY = -22;
        // gambe
        for (let leg = 0; leg < 2; leg++) {
            const ph = run + leg * Math.PI;
            let footX, footY, kneeX, kneeY;
            if (inAir) {
                footX = leg === 0 ? 8 : -7;
                footY = leg === 0 ? -8 : -3;
                kneeX = leg === 0 ? 7 : -4;
                kneeY = -14;
            } else if (moving) {
                footX = Math.sin(ph) * 10;
                footY = -Math.max(0, Math.sin(ph + Math.PI / 2)) * 7;
                kneeX = Math.sin(ph) * 6 + 2;
                kneeY = hipY / 2 - 2 + Math.max(0, Math.sin(ph)) * 2;
            } else {
                footX = leg === 0 ? 4 : -4;
                footY = 0;
                kneeX = footX;
                kneeY = hipY / 2;
            }
            ctx.strokeStyle = leg === 0 ? SKIN : SKIN_D;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(0, hipY);
            ctx.quadraticCurveTo(kneeX, kneeY, footX, footY - 3);
            ctx.stroke();
            // sandalo
            ctx.strokeStyle = leg === 0 ? SHOE : mixHex(SHOE, '#000000', 0.25);
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(footX - 2, footY - 2.5);
            ctx.lineTo(footX + 5, footY - 2.5);
            ctx.stroke();
        }
        // pantaloncini
        ctx.fillStyle = SHORTS;
        rr(-9, -34, 18, 14, 4); ctx.fill();
        // busto (canotta)
        const lean = moving ? 0.14 + speed * 0.1 : 0.05;
        ctx.save();
        ctx.rotate(inAir ? -0.06 : lean * 0.5);
        ctx.fillStyle = SHIRT;
        rr(-9.5, -49, 19, 19, 6); ctx.fill();
        ctx.fillStyle = '#d6493a';
        ctx.fillRect(-9.5, -42.5, 19, 3.6);
        ctx.fillStyle = 'rgba(90,70,50,0.14)';
        ctx.fillRect(-9.5, -33.5, 19, 3);
        ctx.restore();
        // braccia
        for (let arm = 0; arm < 2; arm++) {
            const ph = run + arm * Math.PI + Math.PI;
            let handX, handY;
            if (inAir) {
                handX = arm === 0 ? 10 : -9;
                handY = p.vy < 0 ? -52 : -36;
            } else if (moving) {
                handX = Math.sin(ph) * 9;
                handY = -30 + Math.cos(ph) * 3;
            } else {
                handX = arm === 0 ? 7 : -7;
                handY = -30 + Math.sin(elapsed * 2) * 0.8;
            }
            ctx.strokeStyle = arm === 0 ? SKIN : SKIN_D;
            ctx.lineWidth = 5.5;
            ctx.beginPath();
            ctx.moveTo(arm === 0 ? 4 : -4, -46);
            ctx.quadraticCurveTo((handX + (arm === 0 ? 6 : -6)) / 2, -40, handX, handY);
            ctx.stroke();
        }
        // testa
        const bobH = moving ? Math.sin(run * 2) * 1.2 : Math.sin(elapsed * 2) * 0.8;
        const hy = -56 + bobH;
        ctx.fillStyle = SKIN;
        ctx.beginPath(); ctx.arc(1, hy, 9, 0, 7); ctx.fill();
        // orecchio
        ctx.fillStyle = SKIN_D;
        ctx.beginPath(); ctx.arc(-3, hy + 1, 2, 0, 7); ctx.fill();
        // cappellino
        ctx.fillStyle = CAP;
        ctx.beginPath();
        ctx.arc(1, hy - 2, 9.4, Math.PI * 0.95, Math.PI * 2.02);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = mixHex(CAP, '#000', 0.2);
        rr(4, hy - 6.5, 10, 3.4, 2); ctx.fill();
        // occhio e sorriso
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(6, hy - 0.5, 2.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#2a1d14';
        ctx.beginPath(); ctx.arc(6.9, hy - 0.5, 1.35, 0, 7); ctx.fill();
        ctx.strokeStyle = '#a06a4a';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(4.5, hy + 4, 3, 0.15, Math.PI * 0.65);
        ctx.stroke();
    } else {
        /* -------- accucciato -------- */
        // gambe piegate
        ctx.strokeStyle = SKIN;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(-2, -8);
        ctx.quadraticCurveTo(8, -12, 9, -2.5);
        ctx.stroke();
        ctx.strokeStyle = SKIN_D;
        ctx.beginPath();
        ctx.moveTo(-3, -8);
        ctx.quadraticCurveTo(-10, -11, -9, -2.5);
        ctx.stroke();
        ctx.strokeStyle = SHOE;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(6, -2.5); ctx.lineTo(12, -2.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-12, -2.5); ctx.lineTo(-6, -2.5); ctx.stroke();
        // corpo raccolto
        ctx.fillStyle = SHORTS;
        rr(-9, -14, 18, 8, 3); ctx.fill();
        ctx.fillStyle = SHIRT;
        rr(-8, -22, 16, 10, 4); ctx.fill();
        ctx.fillStyle = '#d6493a';
        ctx.fillRect(-8, -18, 16, 2.6);
        // braccia in avanti
        ctx.strokeStyle = SKIN;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(2, -18);
        ctx.quadraticCurveTo(10, -16, 12, -10);
        ctx.stroke();
        // testa bassa
        ctx.fillStyle = SKIN;
        ctx.beginPath(); ctx.arc(3, -25, 8.4, 0, 7); ctx.fill();
        ctx.fillStyle = CAP;
        ctx.beginPath();
        ctx.arc(3, -27, 8.8, Math.PI * 0.95, Math.PI * 2.02);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = mixHex(CAP, '#000', 0.2);
        rr(6, -31, 9, 3, 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(7.5, -24.5, 2.3, 0, 7); ctx.fill();
        ctx.fillStyle = '#2a1d14';
        ctx.beginPath(); ctx.arc(8.2, -24.5, 1.2, 0, 7); ctx.fill();
    }
    ctx.restore();
}

/* ---------- particelle, scritte volanti, suggerimenti ---------- */
function drawParticles() {
    for (const pa of particles) {
        ctx.save();
        ctx.globalAlpha = clamp(pa.life, 0, 1);
        ctx.fillStyle = pa.color;
        if (pa.shape === 'confetti') {
            ctx.translate(pa.x, pa.y);
            ctx.rotate(pa.phase);
            ctx.fillRect(-pa.size / 2, -pa.size / 4, pa.size, pa.size / 2);
        } else if (pa.shape === 'spark') {
            ctx.translate(pa.x, pa.y);
            ctx.rotate(pa.life * 5);
            ctx.fillRect(-pa.size, -0.7, pa.size * 2, 1.4);
            ctx.fillRect(-0.7, -pa.size, 1.4, pa.size * 2);
        } else {
            ctx.beginPath();
            ctx.arc(pa.x, pa.y, pa.size, 0, 7);
            ctx.fill();
        }
        ctx.restore();
    }
}
function drawFloaters() {
    for (const fl of floaters) {
        txt(fl.text, fl.x, fl.y, {
            size: 15, weight: 900, color: fl.color, align: 'center',
            alpha: clamp(1 - fl.t / 0.9, 0, 1), shadow: 'rgba(0,0,0,0.4)', shadowBlur: 4
        });
    }
}
function drawHints(dark) {
    for (const h of world.hints) {
        const lines = h.text.split('\n');
        const bob = Math.sin(elapsed * 1.6 + h.x * 0.01) * 2;
        lines.forEach((ln, i) => {
            txt(ln, h.x, h.y + bob + i * 19, {
                size: 15.5, weight: 900, italic: true, align: 'left',
                color: dark ? 'rgba(255,244,222,0.8)' : 'rgba(255,248,230,0.88)',
                shadow: 'rgba(40,28,16,0.55)', shadowBlur: 5, shadowY: 1
            });
        });
    }
}

/* ---------- HUD ---------- */
function drawCoinIcon(x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, '#ffe9a0');
    g.addColorStop(0.65, '#f2b135');
    g.addColorStop(1, '#c9862a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(130,85,20,0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,210,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, 7); ctx.stroke();
}

function drawHeart(x, y, s, filled, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.globalAlpha = alpha !== undefined ? alpha : 1;
    ctx.beginPath();
    ctx.moveTo(0, 4.2);
    ctx.bezierCurveTo(-7.2, -1.6, -5.2, -8.4, 0, -3.8);
    ctx.bezierCurveTo(5.2, -8.4, 7.2, -1.6, 0, 4.2);
    ctx.closePath();
    if (filled) {
        const g = ctx.createLinearGradient(0, -8, 0, 5);
        g.addColorStop(0, '#ff7a86');
        g.addColorStop(1, '#d1293e');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,10,25,0.7)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(-2.6, -4.2, 1.7, 1.1, -0.6, 0, 7);
        ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(16,22,30,0.4)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }
    ctx.restore();
}

function drawHearts() {
    const n = MAX_LIVES, gap = 22;
    const x0 = VIEW_W / 2 - (n - 1) * gap / 2;
    ctx.fillStyle = 'rgba(18,24,32,0.42)';
    rr(x0 - 24, 12, (n - 1) * gap + 48, 36, 18); ctx.fill();
    for (let i = 0; i < n; i++) {
        let a = 1;
        // il cuoricino appena perso lampeggia durante l'animazione di morte
        if (state === 'dying' && i === lives) {
            drawHeart(x0 + i * gap, 30, 1.35, Math.sin(elapsed * 16) > 0, 0.9);
            continue;
        }
        drawHeart(x0 + i * gap, 30, 1.35, i < lives, a);
    }
}

function drawHUD() {
    // monete
    ctx.save();
    ctx.fillStyle = 'rgba(18,24,32,0.42)';
    rr(14, 12, 118, 36, 18); ctx.fill();
    drawCoinIcon(35, 30, 11);
    txt(`${runCoins} / ${world.totalCoins}`, 52, 36, { size: 17, weight: 900, color: '#fff' });
    // vite
    drawHearts();
    // livello
    const label = `${world.index + 1} · ${world.name}`;
    ctx.font = `900 16px ${FONT}`;
    const w = ctx.measureText(label).width + 30;
    ctx.fillStyle = 'rgba(18,24,32,0.42)';
    rr(VIEW_W - 14 - w, 12, w, 36, 18); ctx.fill();
    txt(label, VIEW_W - 14 - w / 2, 35, { size: 16, weight: 900, color: '#fff', align: 'center' });
    if (!IS_TOUCH) txt('Esc = pausa', VIEW_W - 16, VIEW_H - 10, { size: 12, weight: 700, color: 'rgba(255,255,255,0.45)', align: 'right' });
    ctx.restore();
}

/* ---------- vignettatura ---------- */
function drawVignette() {
    if (!vignetteCv) {
        vignetteCv = makeTex(VIEW_W, VIEW_H, (c) => {
            const g = c.createRadialGradient(VIEW_W / 2, VIEW_H * 0.45, VIEW_H * 0.5, VIEW_W / 2, VIEW_H * 0.5, VIEW_H * 0.95);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(10,8,14,0.34)');
            c.fillStyle = g;
            c.fillRect(0, 0, VIEW_W, VIEW_H);
        });
    }
    ctx.drawImage(vignetteCv, 0, 0);
}

/* ---------- scena di gioco completa ---------- */
function renderWorld() {
    const theme = world.theme;
    buildTextures(theme);

    drawSky(theme, world.index);
    drawSea(theme, world.index);

    const shakeX = Math.sin(elapsed * 67) * camShake;
    const shakeY = Math.cos(elapsed * 59) * camShake * 0.7;

    ctx.save();
    ctx.translate(-Math.round(camX - shakeX), Math.round(shakeY));

    // faro vicino nel livello finale (dietro ai tile)
    if (world.index === 9) {
        drawLighthouse(world.widthPx - 130, 11 * TILE + 2, 0.9, true);
    }

    // decorazioni
    for (const d of world.decor) {
        const px = d.tx * TILE, py = d.ty * TILE;
        if (px + 120 < camX || px - 80 > camX + VIEW_W) continue;
        if (d.type === 'cabin') drawCabin(px - TILE, py, d.c);
        else if (d.type === 'umbrella') drawUmbrella(px, py, d.c);
        else if (d.type === 'towel') drawTowel(px, py, d.c);
        else if (d.type === 'grass') drawGrass(px, py, d.c);
        else if (d.type === 'shell') drawShell(px, py, d.c);
        else if (d.type === 'star') drawStarfish(px, py, d.c);
    }

    drawTiles();
    drawFlag(world.flag);

    for (const c of world.coins) {
        if (c.taken) continue;
        if (c.x + 30 < camX || c.x - 30 > camX + VIEW_W) continue;
        drawCoin(c);
    }
    for (const u of world.urchins) {
        if (u.x + 60 < camX || u.x - 60 > camX + VIEW_W) continue;
        drawUrchin(u);
    }
    for (const cr of world.crabs) {
        if (cr.dead && cr.squashT <= 0) continue;
        if (cr.x + 60 < camX || cr.x - 60 > camX + VIEW_W) continue;
        drawCrab(cr);
    }

    const sinking = (state === 'dying' && deathKind === 'splash' && stateT > 0.55);
    if (!sinking) drawPlayer();

    drawParticles();
    drawFloaters();
    drawHints(!!theme.moon);

    ctx.restore();

    // luce d'ambiente del tema
    if (theme.ambient && theme.ambient !== 'rgba(0,0,0,0)') {
        ctx.fillStyle = theme.ambient;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    drawVignette();

    // flash rosso quando si viene colpiti
    if (state === 'dying' && stateT < 0.3) {
        ctx.fillStyle = `rgba(190,40,25,${0.28 * (1 - stateT / 0.3)})`;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    drawHUD();

    // titolo del livello in apertura
    if (introT > 0 && (state === 'play' || state === 'pause')) {
        const a = clamp(introT > 1.6 ? (2.1 - introT) * 2 : introT / 0.8, 0, 1);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(16,22,30,0.4)';
        rr(VIEW_W / 2 - 190, 84, 380, 86, 16); ctx.fill();
        txt(`Livello ${world.index + 1}`, VIEW_W / 2, 120, { size: 19, weight: 700, color: 'rgba(255,255,255,0.75)', align: 'center' });
        txt(world.name, VIEW_W / 2, 152, { size: 29, weight: 900, color: '#fff', align: 'center' });
        ctx.restore();
    }
}
/* ============================================================
   INTERFACCIA — menu livelli, pannelli, ciclo principale
   ============================================================ */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// monete totali per livello (per il menu)
const LEVEL_META = [];
for (let i = 0; i < N_LEVELS; i++) LEVEL_META.push(buildWorld(i).totalCoins);

let menuSel = 0;
let resetArmT = -1;
let cardWiggle = new Array(N_LEVELS).fill(0);

/* ---------- pulsanti ---------- */
function drawButton(b, hot, primary) {
    ctx.save();
    const lift = hot ? -2 : 0;
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2 + lift);
    ctx.fillStyle = 'rgba(30,20,12,0.25)';
    rr(-b.w / 2 + 2, -b.h / 2 + 4, b.w, b.h, 12); ctx.fill();
    ctx.fillStyle = primary ? (hot ? '#d96e5b' : '#c95f4e') : (hot ? '#5d7891' : '#4d6478');
    rr(-b.w / 2, -b.h / 2, b.w, b.h, 12); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    rr(-b.w / 2, -b.h / 2, b.w, b.h / 2.4, 12); ctx.fill();
    txt(b.label, 0, 6, { size: 17, weight: 900, color: '#fff7ec', align: 'center' });
    ctx.restore();
}
function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/* ---------- menu principale ---------- */
function menuCards() {
    const cw = 150, ch = 102, gx = 18, gy = 22;
    const x0 = (VIEW_W - (5 * cw + 4 * gx)) / 2;
    const y0 = 248;
    const cards = [];
    for (let i = 0; i < N_LEVELS; i++) {
        const r = Math.floor(i / 5), c = i % 5;
        cards.push({ i, x: x0 + c * (cw + gx), y: y0 + r * (ch + gy), w: cw, h: ch });
    }
    return cards;
}

function renderMenu(dt) {
    const theme = THEMES.giorno;
    drawSky(theme, 0);
    drawSea(theme, 0);

    // spiaggia in primo piano
    const sg = ctx.createLinearGradient(0, 380, 0, VIEW_H);
    sg.addColorStop(0, theme.sandLight);
    sg.addColorStop(1, theme.sandBase);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, 428);
    for (let x = 0; x <= VIEW_W; x += 24) ctx.lineTo(x, 424 + Math.sin(x * 0.02) * 7);
    ctx.lineTo(VIEW_W, VIEW_H); ctx.lineTo(0, VIEW_H);
    ctx.closePath();
    ctx.fill();
    // bagnasciuga
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let x = 0; x <= VIEW_W; x += 8) {
        const y = 425 + Math.sin(x * 0.02) * 7 + Math.sin(elapsed * 1.8 + x * 0.05) * 2.4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    drawUmbrella(48, 520, 0);
    drawTowel(150, 532, 2);
    drawStarfish(860, 536, 1);
    drawGrass(910, 528, 0);
    drawShell(790, 542, 2);

    // titolo
    ctx.save();
    ctx.translate(VIEW_W / 2, 118);
    ctx.rotate(-0.012);
    txt('LIDO RUNNER', 0, 0, {
        size: 64, weight: 900, italic: true, color: '#fff', align: 'center',
        shadow: 'rgba(30,50,80,0.55)', shadowBlur: 14, shadowY: 5
    });
    ctx.restore();
    txt('una corsa in riva al mare', VIEW_W / 2, 152, {
        size: 19, weight: 700, italic: true, color: 'rgba(255,255,255,0.92)', align: 'center',
        shadow: 'rgba(30,50,80,0.4)', shadowBlur: 8, shadowY: 2
    });

    // monete totali
    const tot = totalBestCoins();
    ctx.fillStyle = 'rgba(18,24,32,0.4)';
    rr(VIEW_W - 148, 14, 134, 34, 17); ctx.fill();
    drawCoinIcon(VIEW_W - 128, 31, 10);
    txt(`${tot}`, VIEW_W - 112, 37, { size: 16, weight: 900, color: '#fff' });
    txt('raccolte', VIEW_W - 24, 37, { size: 12.5, weight: 700, color: 'rgba(255,255,255,0.7)', align: 'right' });

    txt('scegli il livello', VIEW_W / 2, 232, { size: 16, weight: 900, color: 'rgba(60,42,24,0.75)', align: 'center' });

    // schede dei livelli
    const cards = menuCards();
    for (const cd of cards) {
        const unlocked = cd.i < save.unlocked;
        const hot = inRect(mouseX, mouseY, cd) && unlocked;
        const sel = menuSel === cd.i;
        if (cardWiggle[cd.i] > 0) cardWiggle[cd.i] -= dt;
        const wig = cardWiggle[cd.i] > 0 ? Math.sin(cardWiggle[cd.i] * 40) * 3 : 0;

        ctx.save();
        ctx.translate(cd.x + cd.w / 2 + wig, cd.y + cd.h / 2 + (hot ? -3 : 0));
        // ombra
        ctx.fillStyle = 'rgba(40,28,16,0.25)';
        rr(-cd.w / 2 + 2, -cd.h / 2 + 5, cd.w, cd.h, 14); ctx.fill();
        // corpo
        ctx.fillStyle = unlocked ? (hot ? '#fdf8ea' : '#f7f0dc') : 'rgba(94,102,110,0.82)';
        rr(-cd.w / 2, -cd.h / 2, cd.w, cd.h, 14); ctx.fill();
        if (sel) {
            ctx.strokeStyle = '#c95f4e';
            ctx.lineWidth = 3.5;
            rr(-cd.w / 2 + 1, -cd.h / 2 + 1, cd.w - 2, cd.h - 2, 13); ctx.stroke();
        }
        if (unlocked) {
            const done = (save.best[String(cd.i)] || 0) > 0 || cd.i + 1 < save.unlocked || (cd.i === N_LEVELS - 1 && save.finished);
            txt(String(cd.i + 1), -cd.w / 2 + 16, -cd.h / 2 + 34, { size: 27, weight: 900, color: '#c95f4e' });
            txt(LEVELS[cd.i].name, 0, -cd.h / 2 + 58, { size: 14.5, weight: 900, color: '#4a3826', align: 'center' });
            drawCoinIcon(-26, cd.h / 2 - 21, 8);
            txt(`${save.best[String(cd.i)] || 0} / ${LEVEL_META[cd.i]}`, -14, cd.h / 2 - 15, { size: 13.5, weight: 700, color: '#6e5a40' });
            if (done) {
                ctx.strokeStyle = '#68a06e';
                ctx.lineWidth = 3.4;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(cd.w / 2 - 30, -cd.h / 2 + 22);
                ctx.lineTo(cd.w / 2 - 24, -cd.h / 2 + 29);
                ctx.lineTo(cd.w / 2 - 13, -cd.h / 2 + 15);
                ctx.stroke();
            }
        } else {
            txt(String(cd.i + 1), -cd.w / 2 + 16, -cd.h / 2 + 34, { size: 27, weight: 900, color: 'rgba(235,240,245,0.5)' });
            // lucchetto
            ctx.fillStyle = 'rgba(230,236,242,0.85)';
            rr(-11, -6, 22, 18, 4); ctx.fill();
            ctx.strokeStyle = 'rgba(230,236,242,0.85)';
            ctx.lineWidth = 3.4;
            ctx.beginPath();
            ctx.arc(0, -7, 7, Math.PI, 0);
            ctx.stroke();
            ctx.fillStyle = 'rgba(70,80,90,0.9)';
            ctx.beginPath(); ctx.arc(0, 2, 2.6, 0, 7); ctx.fill();
            txt('completa il precedente', 0, cd.h / 2 - 12, { size: 11, weight: 700, color: 'rgba(235,240,245,0.75)', align: 'center' });
        }
        ctx.restore();
    }

    // piè di pagina
    const footerTxt = IS_TOUCH
        ? 'tocca un livello per giocare  ·  usa le frecce sotto lo schermo  ·  ▲ tienilo premuto per saltare più in alto'
        : '←  →  muoviti      ↑  salta (tieni premuto = più in alto)      ↓  accucciati / picchiata      Invio  conferma';
    txt(footerTxt, VIEW_W / 2, 518, {
        size: 14, weight: 700, color: 'rgba(60,42,24,0.78)', align: 'center'
    });

    // audio
    const audioBtn = { x: VIEW_W - 150, y: VIEW_H - 38, w: 136, h: 28 };
    const hotA = inRect(mouseX, mouseY, audioBtn);
    ctx.fillStyle = hotA ? 'rgba(50,38,22,0.35)' : 'rgba(50,38,22,0.22)';
    rr(audioBtn.x, audioBtn.y, audioBtn.w, audioBtn.h, 14); ctx.fill();
    txt(`audio: ${save.sound ? 'sì' : 'no'}  (M)`, audioBtn.x + audioBtn.w / 2, audioBtn.y + 19, { size: 13, weight: 700, color: 'rgba(60,42,24,0.85)', align: 'center' });

    // azzera progressi
    const resetBtn = { x: 14, y: VIEW_H - 38, w: 190, h: 28 };
    const hotR = inRect(mouseX, mouseY, resetBtn);
    if (resetArmT > 0) resetArmT -= dt;
    ctx.fillStyle = hotR ? 'rgba(50,38,22,0.3)' : 'rgba(50,38,22,0.16)';
    rr(resetBtn.x, resetBtn.y, resetBtn.w, resetBtn.h, 14); ctx.fill();
    txt(resetArmT > 0 ? 'sicuro? clicca di nuovo' : 'azzera i progressi', resetBtn.x + resetBtn.w / 2, resetBtn.y + 19, {
        size: 13, weight: 700, color: resetArmT > 0 ? '#a8402e' : 'rgba(60,42,24,0.7)', align: 'center'
    });

    // input del menu
    for (const c of clicks) {
        for (const cd of cards) {
            if (inRect(c.x, c.y, cd)) {
                menuSel = cd.i;
                if (cd.i < save.unlocked) { sfx.click(); startLevel(cd.i); }
                else { sfx.locked(); cardWiggle[cd.i] = 0.3; }
            }
        }
        if (inRect(c.x, c.y, audioBtn)) { save.sound = !save.sound; persistSave(); sfx.click(); }
        if (inRect(c.x, c.y, resetBtn)) {
            if (resetArmT > 0) { wipeSave(); resetArmT = -1; sfx.stomp(); }
            else { resetArmT = 2.5; sfx.click(); }
        }
    }
    for (const k of uiPresses) {
        if (k === 'left') menuSel = Math.max(0, menuSel - 1);
        else if (k === 'right') menuSel = Math.min(N_LEVELS - 1, menuSel + 1);
        else if (k === 'up') menuSel = Math.max(0, menuSel - 5);
        else if (k === 'down') menuSel = Math.min(N_LEVELS - 1, menuSel + 5);
        else if (k === 'enter') {
            if (menuSel < save.unlocked) { sfx.click(); startLevel(menuSel); }
            else { sfx.locked(); cardWiggle[menuSel] = 0.3; }
        } else if (k === 'mute') { save.sound = !save.sound; persistSave(); }
    }
}

/* ---------- pannello di fine livello ---------- */
function renderWonOverlay() {
    const t = clamp((stateT - 0.65) / 0.3, 0, 1);
    if (t <= 0) return;
    ctx.fillStyle = `rgba(12,16,22,${0.5 * t})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const isLast = world.index === N_LEVELS - 1;
    const pw = 500, ph = isLast ? 320 : 292;
    const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2 - 10 + (1 - t) * 26;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = 'rgba(30,20,12,0.35)';
    rr(px + 3, py + 7, pw, ph, 20); ctx.fill();
    ctx.fillStyle = '#f7f0dc';
    rr(px, py, pw, ph, 20); ctx.fill();
    ctx.fillStyle = '#c95f4e';
    rr(px, py, pw, 10, [20, 20, 0, 0]); ctx.fill();

    if (isLast) {
        txt('Hai completato', VIEW_W / 2, py + 58, { size: 22, weight: 700, color: '#6e5a40', align: 'center' });
        txt('LIDO RUNNER!', VIEW_W / 2, py + 96, { size: 38, weight: 900, italic: true, color: '#c95f4e', align: 'center' });
    } else {
        txt('Livello completato!', VIEW_W / 2, py + 66, { size: 30, weight: 900, color: '#4a3826', align: 'center' });
        txt(world.name, VIEW_W / 2, py + 94, { size: 17, weight: 700, italic: true, color: '#8a7458', align: 'center' });
    }

    const cy = py + (isLast ? 140 : 136);
    drawCoinIcon(VIEW_W / 2 - 92, cy - 6, 12);
    txt(`Monete:  ${runCoins} / ${world.totalCoins}`, VIEW_W / 2 - 72, cy, { size: 20, weight: 900, color: '#4a3826' });
    if (winNewBest) {
        txt('nuovo record!', VIEW_W / 2 + 148, cy, { size: 15, weight: 900, italic: true, color: '#68a06e', align: 'center' });
    }
    if (isLast) {
        txt(`Totale sui 10 livelli: ${totalBestCoins()} monete`, VIEW_W / 2, cy + 32, { size: 15.5, weight: 700, color: '#6e5a40', align: 'center' });
    }

    const by = py + ph - 64;
    const buttons = [];
    if (!isLast) {
        buttons.push({ x: px + 30, y: by, w: 120, h: 42, label: 'Menu', act: 'menu' });
        buttons.push({ x: px + 164, y: by, w: 130, h: 42, label: 'Rigioca', act: 'retry' });
        buttons.push({ x: px + 308, y: by, w: 162, h: 42, label: 'Avanti  →', act: 'next', primary: true });
    } else {
        buttons.push({ x: px + 80, y: by, w: 150, h: 42, label: 'Menu', act: 'menu', primary: true });
        buttons.push({ x: px + 270, y: by, w: 150, h: 42, label: 'Rigioca', act: 'retry' });
    }
    for (const b of buttons) drawButton(b, inRect(mouseX, mouseY, b), b.primary);
    txt(isLast ? 'Invio = menu' : 'Invio = livello successivo', VIEW_W / 2, py + ph - 10, { size: 12.5, weight: 700, color: 'rgba(110,90,64,0.7)', align: 'center' });
    ctx.restore();

    function doAct(act) {
        if (act === 'menu') { sfx.click(); toMenu(); }
        else if (act === 'retry') { sfx.click(); retryLevel(); }
        else if (act === 'next') { sfx.click(); startLevel(world.index + 1, true); }   // le vite si portano avanti
    }
    if (t >= 1) {
        for (const c of clicks) for (const b of buttons) if (inRect(c.x, c.y, b)) doAct(b.act);
        for (const k of uiPresses) {
            if (k === 'enter') doAct(isLast ? 'menu' : 'next');
            else if (k === 'restart') doAct('retry');
            else if (k === 'quit' || k === 'esc') doAct('menu');
        }
    }
}

/* ---------- vite finite ---------- */
function renderGameOverOverlay() {
    const t = clamp((stateT - 0.15) / 0.3, 0, 1);
    ctx.fillStyle = `rgba(12,16,22,${0.58 * t})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (t <= 0) return;

    const pw = 470, ph = 280;
    const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2 - 8 + (1 - t) * 26;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = 'rgba(30,20,12,0.35)';
    rr(px + 3, py + 7, pw, ph, 20); ctx.fill();
    ctx.fillStyle = '#f7f0dc';
    rr(px, py, pw, ph, 20); ctx.fill();
    ctx.fillStyle = '#a8402e';
    rr(px, py, pw, 10, [20, 20, 0, 0]); ctx.fill();

    drawHeart(VIEW_W / 2, py + 62, 2.6, false, 0.9);
    txt('Vite finite!', VIEW_W / 2, py + 116, { size: 30, weight: 900, color: '#4a3826', align: 'center' });
    txt(`Sei arrivato al livello ${curLevel + 1} · ${world.name}`, VIEW_W / 2, py + 146, { size: 15.5, weight: 700, italic: true, color: '#8a7458', align: 'center' });
    txt('Si ricomincia dalla spiaggia, con 10 cuoricini nuovi', VIEW_W / 2, py + 170, { size: 14, weight: 700, color: '#6e5a40', align: 'center' });

    const by = py + ph - 64;
    const buttons = [
        { x: px + 32, y: by, w: 150, h: 42, label: 'Menu', act: 'menu' },
        { x: px + 208, y: by, w: 230, h: 42, label: 'Dal livello 1  →', act: 'level1', primary: true }
    ];
    for (const b of buttons) drawButton(b, inRect(mouseX, mouseY, b), b.primary);
    txt('Invio = si riparte', VIEW_W / 2, py + ph - 10, { size: 12.5, weight: 700, color: 'rgba(110,90,64,0.7)', align: 'center' });
    ctx.restore();

    function doAct(act) {
        if (act === 'menu') { sfx.click(); toMenu(); }
        else if (act === 'level1') { sfx.click(); startLevel(0); }
    }
    if (t >= 1) {
        for (const c of clicks) for (const b of buttons) if (inRect(c.x, c.y, b)) doAct(b.act);
        for (const k of uiPresses) {
            if (k === 'enter') doAct('level1');
            else if (k === 'quit' || k === 'esc') doAct('menu');
        }
    }
}

/* ---------- pausa ---------- */
function renderPauseOverlay() {
    ctx.fillStyle = 'rgba(12,16,22,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const pw = 380, ph = 250;
    const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
    ctx.fillStyle = 'rgba(30,20,12,0.35)';
    rr(px + 3, py + 7, pw, ph, 20); ctx.fill();
    ctx.fillStyle = '#f7f0dc';
    rr(px, py, pw, ph, 20); ctx.fill();
    txt('Pausa', VIEW_W / 2, py + 52, { size: 30, weight: 900, color: '#4a3826', align: 'center' });

    const buttons = [
        { x: px + 40, y: py + 78, w: pw - 80, h: 42, label: 'Riprendi  (Esc)', act: 'resume', primary: true },
        { x: px + 40, y: py + 128, w: pw - 80, h: 42, label: 'Ricomincia il livello  (R)', act: 'retry' },
        { x: px + 40, y: py + 178, w: pw - 80, h: 42, label: 'Torna al menu  (Q)', act: 'menu' }
    ];
    for (const b of buttons) drawButton(b, inRect(mouseX, mouseY, b), b.primary);

    function doAct(act) {
        if (act === 'resume') { state = 'play'; sfx.click(); }
        else if (act === 'retry') { sfx.click(); retryLevel(); }
        else if (act === 'menu') { sfx.click(); toMenu(); }
    }
    for (const c of clicks) for (const b of buttons) if (inRect(c.x, c.y, b)) doAct(b.act);
    for (const k of uiPresses) {
        if (k === 'esc') doAct('resume');
        else if (k === 'restart') doAct('retry');
        else if (k === 'quit') doAct('menu');
    }
}

/* ---------- ciclo principale ---------- */
let lastNow = performance.now();

function frame(now) {
    const dt = clamp((now - lastNow) / 1000, 0, 1 / 30);
    lastNow = now;

    if (state !== 'pause') updateGame(dt);
    else elapsed += dt * 0.15; // in pausa il mare si muove appena

    if (state === 'menu') {
        renderMenu(dt);
    } else {
        renderWorld();
        if (state === 'won') renderWonOverlay();
        else if (state === 'pause') renderPauseOverlay();
        else if (state === 'gameover') renderGameOverOverlay();
        else {
            // input di gioco
            for (const k of uiPresses) {
                if (k === 'esc' && state === 'play') { state = 'pause'; sfx.click(); }
                else if (k === 'restart' && state === 'play') retryLevel();
                else if (k === 'mute') { save.sound = !save.sound; persistSave(); }
            }
        }
    }

    clicks.length = 0;
    uiPresses.length = 0;
    requestAnimationFrame(frame);
}

/* ---------- comandi touch (mobile): frecce sotto lo schermo ---------- */
function bindTouchControls() {
    const hold = [['tcLeft', 'left'], ['tcRight', 'right'], ['tcDown', 'down']];
    for (const [id, key] of hold) {
        const el = document.getElementById(id);
        if (!el) continue;
        const on = (e) => { e.preventDefault(); ensureAudio(); keys[key] = true; el.classList.add('on'); };
        const off = (e) => { e.preventDefault(); keys[key] = false; el.classList.remove('on'); };
        el.addEventListener('pointerdown', on);
        el.addEventListener('pointerup', off);
        el.addEventListener('pointercancel', off);
        el.addEventListener('pointerleave', off);
    }
    const j = document.getElementById('tcJump');
    if (j) {
        j.addEventListener('pointerdown', (e) => {
            e.preventDefault(); ensureAudio();
            jumpBufferT = 0.12; jumpHeld = true; keys.up = true;
            j.classList.add('on');
        });
        const jOff = (e) => { e.preventDefault(); jumpHeld = false; keys.up = false; j.classList.remove('on'); };
        j.addEventListener('pointerup', jOff);
        j.addEventListener('pointercancel', jOff);
        j.addEventListener('pointerleave', jOff);
    }
    const p = document.getElementById('tcPause');
    if (p) {
        p.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); uiPresses.push('esc'); });
    }
}

/* ---------- avvio ---------- */
bindInput(canvas);
if (IS_TOUCH) {
    document.body.classList.add('touch');
    bindTouchControls();
}
requestAnimationFrame(frame);

/* maniglia di debug/test */
window.LR = {
    get state() { return state; },
    get world() { return world; },
    get player() { return player; },
    get camX() { return camX; },
    get runCoins() { return runCoins; },
    get save() { return save; },
    get lives() { return lives; },
    set lives(v) { lives = v; },
    startLevel, retryLevel, toMenu, wipeSave,
    keys
};
