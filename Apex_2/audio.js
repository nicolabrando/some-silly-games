const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let engineOscillator = null;    // seat 1, kept as its own name for clarity
let engineGain = null;
let engines = [];               // one voice per driver at the keyboard
let isAudioInitialized = false;

// BGM variables
let bgmOscillator = null;
let bgmGain = null;
let bgmInterval = null;

// ---------------------------------------------------------------------------
//  SPECTATOR BGM
//  A four-bar chase loop in A minor at 132bpm: walking bass, syncopated lead,
//  kick and hat. Written as step tables (one entry per sixteenth) rather than
//  a single tone sequence, so the parts move against each other.
// ---------------------------------------------------------------------------
const BGM_BPM = 132;
const BGM_STEP_MS = 60000 / BGM_BPM / 4;      // one sixteenth

const N = {                                    // note -> Hz
    A2: 110.00, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00,
    A3: 220.00, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00,
    A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00
};

// i-VI-VII-i, the classic chase progression
const BGM_BASS = [
    N.A2, 0, N.A2, 0, N.A2, 0, N.E3, 0, N.A2, 0, N.A2, 0, N.G3, 0, N.E3, 0,
    N.F3, 0, N.F3, 0, N.F3, 0, N.C4, 0, N.F3, 0, N.F3, 0, N.C4, 0, N.A3, 0,
    N.G3, 0, N.G3, 0, N.G3, 0, N.D4, 0, N.G3, 0, N.G3, 0, N.D4, 0, N.B4 / 2, 0,
    N.A2, 0, N.A2, 0, N.E3, 0, N.A2, 0, N.C3, 0, N.E3, 0, N.G3, 0, N.A3, 0
];

// syncopated: lands off the bass, leaves gaps to breathe
const BGM_LEAD = [
    N.A4, 0, 0, N.C5, N.E5, 0, N.D5, 0, N.C5, 0, N.A4, 0, 0, N.B4, 0, 0,
    N.C5, 0, 0, N.F4, N.A4, 0, N.C5, 0, N.A4, 0, N.F4, 0, 0, N.G4, 0, 0,
    N.D5, 0, 0, N.B4, N.G4, 0, N.B4, 0, N.D5, 0, N.G5, 0, 0, N.D5, 0, 0,
    N.E5, 0, N.C5, 0, N.A4, 0, N.E4, 0, N.A4, 0, N.C5, 0, N.E5, 0, N.A5, 0
];

// 1 = kick, 2 = hat, 3 = both
const BGM_DRUM = [
    3, 0, 2, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 2, 2, 0,
    3, 0, 2, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 2, 2, 0,
    3, 0, 2, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 2, 2, 0,
    3, 0, 2, 0, 1, 0, 2, 0, 3, 2, 3, 2, 3, 2, 3, 2
];

let noteIndex = 0;
let noiseBuffer = null;

// ---------------------------------------------------------------------------
//  ENGINES
//  One voice per driver at the keyboard. With two of them the pair has to be
//  tellable apart by ear, so the second engine is pitched a little differently
//  and the two are panned to opposite sides - your car is the one on your side
//  of the stereo image.
// ---------------------------------------------------------------------------
const ENGINE_VOICES = [
    { pitch: 1.00, cutoff: 800, pan: -0.45 },   // seat 1
    { pitch: 1.18, cutoff: 950, pan: 0.45 }     // seat 2, a shade higher strung
];

function makeEngineVoice(spec, level) {
    const osc = audioContext.createOscillator();
    osc.type = 'sawtooth';

    const gain = audioContext.createGain();
    gain.gain.value = level;

    // Lowpass filter to muffle the raw sawtooth
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.cutoff;

    osc.connect(filter);
    filter.connect(gain);

    // Panning is a nicety, not a requirement: older engines have no panner.
    let tail = gain;
    if (typeof audioContext.createStereoPanner === 'function') {
        const pan = audioContext.createStereoPanner();
        pan.pan.value = spec.pan;
        gain.connect(pan);
        tail = pan;
    }
    tail.connect(audioContext.destination);

    osc.frequency.value = 50 * spec.pitch;      // idle
    osc.start();
    return { osc: osc, gain: gain, pitch: spec.pitch, base: level };
}

function initAudio(isSpectator = false, seats = 1) {
    if (isAudioInitialized) return;

    // Resume context if suspended (browser policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    engines = [];
    if (!isSpectator) {
        const n = Math.max(1, Math.min(ENGINE_VOICES.length, seats || 1));
        // Two engines at full level is just loud, so share the headroom.
        const level = 0.05 * (n > 1 ? 0.8 : 1);
        for (let i = 0; i < n; i++) engines.push(makeEngineVoice(ENGINE_VOICES[i], level));

        engineOscillator = engines[0].osc;
        engineGain = engines[0].gain;
    } else {
        // BGM Setup
        startBGM();
    }

    isAudioInitialized = true;
}

function updateEngineSound(speed, isAccelerating, seat = 0) {
    if (!isAudioInitialized) return;
    const e = engines[seat];
    if (!e) return;

    // Map speed to frequency (e.g. 0 -> 50Hz, max speed -> 200Hz)
    // Assuming max speed is around 350
    const targetFreq = (50 + (speed * 0.4)) * e.pitch;

    // Smooth transition
    e.osc.frequency.setTargetAtTime(targetFreq, audioContext.currentTime, 0.1);

    // Adjust volume based on throttle
    const targetVolume = isAccelerating ? e.base * 2 : e.base;
    e.gain.gain.setTargetAtTime(targetVolume, audioContext.currentTime, 0.1);
}

// short burst of white noise, reused for the hi-hat
function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(audioContext.sampleRate * 0.2);
    noiseBuffer = audioContext.createBuffer(1, len, audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
}

function bgmTone(freq, when, dur, type, level, dest, detune) {
    const osc = audioContext.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    const env = audioContext.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(env);
    env.connect(dest);
    osc.start(when);
    osc.stop(when + dur + 0.02);
}

function bgmKick(when, dest) {
    const osc = audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.11);
    const env = audioContext.createGain();
    env.gain.setValueAtTime(0.9, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
    osc.connect(env); env.connect(dest);
    osc.start(when); osc.stop(when + 0.18);
}

function bgmHat(when, dest) {
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer();
    const hp = audioContext.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const env = audioContext.createGain();
    env.gain.setValueAtTime(0.16, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    src.connect(hp); hp.connect(env); env.connect(dest);
    src.start(when); src.stop(when + 0.06);
}

function startBGM() {
    bgmGain = audioContext.createGain();
    bgmGain.gain.value = 0.16;
    bgmGain.connect(audioContext.destination);

    // Gentle low-pass on the lead so the square waves are bright, not harsh.
    const leadBus = audioContext.createGain();
    leadBus.gain.value = 1;
    const leadFilter = audioContext.createBiquadFilter();
    leadFilter.type = 'lowpass';
    leadFilter.frequency.value = 3200;
    leadBus.connect(leadFilter);
    leadFilter.connect(bgmGain);

    noteIndex = 0;

    bgmInterval = setInterval(() => {
        const t = audioContext.currentTime + 0.02;
        const i = noteIndex % BGM_BASS.length;

        const bass = BGM_BASS[i];
        if (bass > 0) bgmTone(bass, t, 0.16, 'triangle', 0.55, bgmGain);

        const lead = BGM_LEAD[i];
        if (lead > 0) {
            // two slightly detuned squares: gives the lead some width
            bgmTone(lead, t, 0.13, 'square', 0.16, leadBus, -6);
            bgmTone(lead, t, 0.13, 'square', 0.13, leadBus, +7);
        }

        const drum = BGM_DRUM[i];
        if (drum & 1) bgmKick(t, bgmGain);
        if (drum & 2) bgmHat(t, bgmGain);

        noteIndex = (noteIndex + 1) % BGM_BASS.length;
    }, BGM_STEP_MS);
}

function stopAudio() {
    for (const e of engines) {
        try { e.osc.stop(); } catch (err) { /* already stopped */ }
    }
    engines = [];
    engineOscillator = null;
    engineGain = null;
    if (bgmInterval) {
        clearInterval(bgmInterval);
        bgmInterval = null;
    }
    isAudioInitialized = false;
}
