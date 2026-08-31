// `let`, not `const`, and for exactly one reason: there are no ears in the
// development loop, so the only way to check that a squeal is a squeal and a
// crash is not a punch is to render the game's OWN audio graph offline and
// measure the spectrum. test_audio.js does that by pointing this at an
// OfflineAudioContext for the length of a render and putting it back after.
// Nothing in the game ever reassigns it.
let audioContext = new (window.AudioContext || window.webkitAudioContext)();

// ---------------------------------------------------------------------------
//  THE MASTER TAP
//  Everything the game makes a noise with hangs off this one gain node -
//  engines, music, and the effects below - so there is a single place that
//  turns the sound down and a single place that turns it off. Before this,
//  every voice connected straight to the destination and nothing could be
//  quietened at all: the game had no volume control of any kind.
// ---------------------------------------------------------------------------
let masterGain = null;
const SOUND_LEVELS = { off: 0, quiet: 0.45, normal: 1 };
let soundChoice = 'normal';
try {
    const v = localStorage.getItem('apexzoom.sound');
    if (SOUND_LEVELS[v] !== undefined) soundChoice = v;
} catch (e) { /* no storage: the default */ }

function audioOut() {
    if (!masterGain) {
        masterGain = audioContext.createGain();
        masterGain.gain.value = SOUND_LEVELS[soundChoice];
        masterGain.connect(audioContext.destination);
    }
    return masterGain;
}

function setSoundLevel(key) {
    soundChoice = SOUND_LEVELS[key] !== undefined ? key : 'normal';
    audioOut().gain.setTargetAtTime(SOUND_LEVELS[soundChoice], audioContext.currentTime, 0.05);
    try { localStorage.setItem('apexzoom.sound', soundChoice); } catch (e) { /* fine */ }
}
function soundLevelKey() { return soundChoice; }
function soundIsOn() { return SOUND_LEVELS[soundChoice] > 0; }
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
    tail.connect(audioOut());

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

    initSfx();
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
    // 0.6s rather than 0.2: the crash tail and the squeal both loop or read
    // out of this, and a fifth of a second of noise repeated is a texture with
    // an audible period in it.
    const len = Math.floor(audioContext.sampleRate * 0.6);
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
    bgmGain.connect(audioOut());

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

// ===========================================================================
//  SOUND EFFECTS
// ===========================================================================
//
//  Until now the only things the game made a noise with were the engines and
//  the spectator music. Everything else it already KNOWS about was silent:
//  it detects contact, it detects a wheel on a kerb, it detects the car
//  sliding, it counts the start lights down, it waves the chequered flag and
//  it deploys the VSC - and the race log has an entry for every one of them.
//  So none of this is new mechanics; it is wiring sound onto events the game
//  was already raising.
//
//  Two kinds of sound, handled differently:
//
//  CONTINUOUS - the kerb rattle, the tyre squeal, the rumble of grass. These
//  are three voices built ONCE and left running silent, with only their gain
//  moved each frame. Building a node per frame would be both expensive and
//  clicky; a gain ramp is neither.
//
//  ONE-SHOT - impacts, the lights, the flag, the VSC. Built on the spot and
//  discarded, which is what they are.
//
//  WHOSE ears. The continuous voices follow the car the CAMERA is following -
//  yours when you are driving, the car you picked when you are spectating -
//  because those are the sounds that come from under you. Impacts are the
//  exception: any car's shunt is audible, quieter the further it is from the
//  middle of the screen and panned to the side it happened on, so a crash
//  behind you is a crash you hear - and one on the far side of a seven
//  kilometre circuit is one you do not.
// ===========================================================================
let sfx = null;

function makeNoiseVoice(type, freq, q, level) {
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    const filt = audioContext.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    if (q) filt.Q.value = q;
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    src.connect(filt); filt.connect(gain); gain.connect(audioOut());
    src.start();
    return { src: src, filt: filt, gain: gain, level: level };
}

// ---------------------------------------------------------------------------
//  A TYRE SQUEAL, which is not a filtered hiss
//
//  The old one was white noise through a single bandpass at Q 7. That is a
//  band of noise, and a band of noise is a RUSHING sound - wind, a hiss, a
//  fabric rustle. It is not what a tyre does. A tyre at the limit is a
//  self-excited oscillator: the tread grips, slips, snaps back and grips
//  again, thousands of times a second, and what comes out has a definite
//  PITCH with harmonics on it, wobbling as the slip angle changes.
//
//  So three things, and it is all three together that make it a squeal:
//    - Q 30 instead of 7. A high-Q bandpass on noise rings: the output is
//      near-sinusoidal at the centre frequency, which is the pitch.
//    - a SECOND resonance a fifth above it (x1.5) and a third an octave and
//      a half up (x3). One peak is a whistle; a stack of them is a screech.
//    - an LFO wobbling all three by a few per cent at ~7Hz. A dead-steady
//      tone is a test signal; the warble is what says "rubber".
//  And a little of the old broadband underneath, because a tyre is also
//  scrubbing tarmac - it just is not ONLY doing that.
function makeSquealVoice(level) {
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    const gain = audioContext.createGain();
    gain.gain.value = 0;

    // the resonant stack
    const parts = [];
    // The gains look large because a Q30 bandpass passes about f/Q = 50Hz of
    // a broadband source and throws the rest away, while the scrub bed below
    // at Q 2.5 passes nearly a kilohertz. Measured, the first draft's 1.0 /
    // 0.55 / 0.22 against a bed at 0.16 left the bed carrying most of the
    // energy - which is to say it was still a hiss with a tint on it.
    for (const [mult, q, amp] of [[1, 30, 3.6], [1.5, 26, 1.3], [3, 18, 0.5]]) {
        const f = audioContext.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1100 * mult;
        f.Q.value = q;
        const g = audioContext.createGain();
        g.gain.value = amp;
        src.connect(f); f.connect(g); g.connect(gain);
        parts.push({ filt: f, mult: mult });
    }
    // and the scrub bed it sits on
    const bed = audioContext.createBiquadFilter();
    bed.type = 'bandpass';
    bed.frequency.value = 2200;
    bed.Q.value = 2.5;
    const bedG = audioContext.createGain();
    bedG.gain.value = 0.09;
    src.connect(bed); bed.connect(bedG); bedG.connect(gain);

    // the warble
    const lfo = audioContext.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 7.3;
    for (const pt of parts) {
        const d = audioContext.createGain();
        d.gain.value = 42 * pt.mult;          // a few per cent of each peak
        lfo.connect(d); d.connect(pt.filt.frequency);
    }
    lfo.start();

    gain.connect(audioOut());
    src.start();
    return { src: src, parts: parts, bed: bed, gain: gain, level: level, lfo: lfo };
}

function initSfx() {
    if (sfx) return sfx;
    sfx = {
        // rumble strips: a hard, midrange rattle
        kerb: makeNoiseVoice('bandpass', 420, 1.2, 0.30),
        // grass: broadband, dull, and loud enough to be a warning
        grass: makeNoiseVoice('lowpass', 320, 0, 0.34),
        // rubber giving up - and it is a pitch, not a hiss. See above.
        slide: makeSquealVoice(0.20)
    };
    return sfx;
}

// Called once a frame with what the followed car is doing. Everything is a
// ramp, never a jump: a squeal that switches on in one frame is a click.
function updateSurfaceSound(surface, slide, speed) {
    if (!isAudioInitialized || !sfx) return;
    const t = audioContext.currentTime;
    const fast = Math.max(0, Math.min(1, speed / 240));
    const kerb = surface === 'kerb' ? 0.35 + 0.65 * fast : 0;
    const grass = surface === 'grass' ? 0.30 + 0.70 * fast : 0;
    // the squeal starts where the game starts laying rubber down (60 px/s of
    // lateral speed, car.js) and is at full cry twice that
    const squeal = Math.max(0, Math.min(1, (slide - 60) / 90));
    sfx.kerb.gain.gain.setTargetAtTime(kerb * sfx.kerb.level, t, 0.02);
    sfx.grass.gain.gain.setTargetAtTime(grass * sfx.grass.level, t, 0.05);
    sfx.slide.gain.gain.setTargetAtTime(squeal * sfx.slide.level, t, 0.03);
    if (squeal > 0) {
        // The pitch rises as the slide worsens, which is what makes it a
        // warning rather than an ornament - and the whole resonant stack has
        // to move together or it stops being one sound and becomes three.
        const f0 = 900 + 620 * squeal;
        for (const pt of sfx.slide.parts)
            pt.filt.frequency.setTargetAtTime(f0 * pt.mult, t, 0.05);
        sfx.slide.bed.frequency.setTargetAtTime(1800 + 900 * squeal, t, 0.06);
    }
}

function silenceSurfaceSound() {
    if (!sfx) return;
    const t = audioContext.currentTime;
    sfx.kerb.gain.gain.setTargetAtTime(0, t, 0.03);
    sfx.grass.gain.gain.setTargetAtTime(0, t, 0.03);
    sfx.slide.gain.gain.setTargetAtTime(0, t, 0.03);
}

// ---------------------------------------------------------------------------
//  A CRASH, which is not a punch
//
//  The old one was a sine at 150Hz swept down to 38, plus a bright noise
//  crack. That is the standard recipe for a HIT in a fighting game, and it is
//  the recipe for a good reason - a descending sine is the most legible "you
//  connected" a game can make. It is also nothing like two cars touching.
//
//  What is actually different about a crash:
//    - IT HAS NO PITCH. A sine sweep is a note. Panels, wheels and carbon are
//      broadband: everything below is filtered NOISE, and the only tonal
//      thing left is a brief metallic ring, high and quiet.
//    - IT IS NOT ONE EVENT. A hit is a single envelope; a crash is a cluster
//      - the first contact, the panels behind it, something coming loose -
//      spread over a couple of hundred milliseconds. Three grains at random
//      offsets, each shorter and quieter than the last, and the ear reads
//      "crunch" instead of "whack".
//    - IT ENDS BADLY. A punch decays cleanly. A crash leaves debris
//      skittering and something scraping, so there is a long, quiet,
//      high-passed tail underneath that outlasts everything else.
//    - AND NO TWO ARE ALIKE. Every number below is jittered per hit, so ten
//      contacts in a first-corner pile-up are ten sounds rather than one
//      sound ten times, which is the other half of why the old one read as a
//      game rather than as an accident.
//
//  `severity` is 0..1, `pan` -1..1, `dist` 0..1 where 1 is far away.
function sfxImpact(severity, pan, dist) {
    if (!isAudioInitialized || !soundIsOn()) return;
    const t0 = audioContext.currentTime + 0.005;
    const s = Math.max(0.08, Math.min(1, severity));
    const level = s * (1 - Math.max(0, Math.min(1, dist)));
    if (level < 0.015) return;
    const rnd = (a, b) => a + Math.random() * (b - a);

    let dest = audioOut();
    if (typeof audioContext.createStereoPanner === 'function') {
        const p = audioContext.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan || 0));
        p.connect(audioOut());
        dest = p;
    }

    // A burst of noise through one filter, with a hard attack and an
    // exponential tail. Everything in the crash is one of these.
    const burst = (when, dur, type, freq, q, amp, dend) => {
        if (amp < 0.004) return;
        const src = audioContext.createBufferSource();
        src.buffer = getNoiseBuffer();
        src.playbackRate.value = rnd(0.85, 1.2);
        const f = audioContext.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        if (q) f.Q.value = q;
        // the filter opens and shuts across the burst: a panel deforming is
        // bright at the instant of contact and dull immediately after
        if (dend) f.frequency.exponentialRampToValueAtTime(Math.max(40, dend), when + dur);
        const g = audioContext.createGain();
        // A GainNode's gain defaults to 1, and scheduling the first event at
        // `when` leaves it AT ONE until then. See the note at the ring below:
        // this is the same trap, and it is only harmless here because the
        // source has not started yet.
        g.gain.value = 0;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(amp, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        src.connect(f); f.connect(g); g.connect(dest);
        src.start(when); src.stop(when + dur + 0.02);
    };

    // ---- the grains: first contact, then what follows it ----------------
    // Spaced far enough apart to be heard as separate events, and each one
    // short enough that the one before it has largely gone: the first draft
    // put them 12-55ms apart with bodies lasting 170-230ms, so they summed
    // into a single envelope and it was one blow again. Real panel collapse
    // is 40-150ms between crunches.
    const grains = s > 0.45 ? 3 : (s > 0.18 ? 2 : 1);
    let when = t0;
    for (let i = 0; i < grains; i++) {
        if (i > 0) when += rnd(0.045, 0.11);
        const fall = Math.pow(0.58, i);                     // each one smaller
        // the body: mass, low and dull, and NOT a tone
        burst(when, rnd(0.045, 0.075) + 0.045 * s, 'lowpass',
              rnd(150, 260) + 220 * s, 0.9, 0.85 * level * fall, rnd(60, 95));
        // the panel: the crunch proper, mid and broad
        burst(when + rnd(0, 0.005), rnd(0.035, 0.065) + 0.035 * s, 'bandpass',
              rnd(700, 1200) + 700 * s, 1.1, 0.55 * level * fall, rnd(240, 420));
    }

    // ---- one metallic ring, brief and quiet -----------------------------
    // The only pitched thing in here. A crash does have a ring in it - a
    // wheel rim, a floor - but it is an overtone, not a bass note, so it is
    // high, short and well under the noise.
    if (s > 0.25) {
        const ring = audioContext.createOscillator();
        ring.type = 'triangle';
        ring.frequency.value = rnd(1700, 2600);
        const rg = audioContext.createGain();
        // gain.value = 0 FIRST, and this one is not pedantry. A GainNode's
        // gain defaults to 1; scheduling the first event at t0+0.004 left it
        // at ONE for the four milliseconds before that, with the oscillator
        // already running - four milliseconds of a 2kHz triangle at full
        // amplitude, on every impact, no matter how gentle or how far away.
        // Measured: a crash 98% of the way across the circuit peaked at 0.66
        // where its own body noise peaked at 0.003. That click WAS the
        // "picchiaduro" sound, and no amount of redesigning the crunch around
        // it would have helped.
        rg.gain.value = 0;
        rg.gain.setValueAtTime(0, t0);
        rg.gain.linearRampToValueAtTime(0.10 * level, t0 + 0.004);
        rg.gain.exponentialRampToValueAtTime(0.0001, t0 + rnd(0.09, 0.18));
        ring.connect(rg); rg.connect(dest);
        ring.start(t0); ring.stop(t0 + 0.24);
    }

    // ---- and the debris, which outlasts the impact ----------------------
    // Loud enough to be heard under the crunch and long enough to outlive it:
    // measured, this is what stops the sound ENDING, which is the difference
    // between something breaking and something being hit.
    const tail = 0.30 + 0.70 * s;
    burst(t0 + 0.03, tail, 'highpass', rnd(1500, 2300), 0.7, 0.30 * level, 3400);
}

// One short tone. The start lights, the flag and the VSC are all this.
function sfxTone(freq, dur, level, type, delay) {
    if (!isAudioInitialized || !soundIsOn()) return;
    const t = audioContext.currentTime + (delay || 0);
    const osc = audioContext.createOscillator();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    const env = audioContext.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.01);
    env.gain.setValueAtTime(level, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = audioContext.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    osc.connect(env); env.connect(lp); lp.connect(audioOut());
    osc.start(t); osc.stop(t + dur + 0.03);
}

function sfxLight()     { sfxTone(660, 0.16, 0.18); }             // one red light on
function sfxLightsOut() { sfxTone(1320, 0.42, 0.24, 'sawtooth'); } // and away
function sfxChequered() {
    sfxTone(880, 0.12, 0.20); sfxTone(1175, 0.12, 0.20, 'square', 0.14);
    sfxTone(1568, 0.30, 0.22, 'square', 0.28);
}
function sfxVsc(on) {
    if (on) { sfxTone(520, 0.20, 0.16, 'triangle'); sfxTone(390, 0.26, 0.16, 'triangle', 0.22); }
    else    { sfxTone(660, 0.16, 0.16, 'triangle'); sfxTone(880, 0.24, 0.16, 'triangle', 0.18); }
}
function sfxBest() {                                   // a new personal best
    sfxTone(784, 0.10, 0.16); sfxTone(1047, 0.20, 0.18, 'square', 0.10);
}

function stopAudio() {
    silenceSurfaceSound();
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
