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

//  ...AND THE LIMITER AFTER IT
//  Every voice is mixed by addition, and addition does not care about
//  headroom. Measured: one impact peaks at 0.40 and three at once at 0.61,
//  both fine - but three impacts while the car is on a kerb and sliding, which
//  is precisely what the first corner of a race is, peaked at 1.197. Anything
//  past 1.0 is clipped by the hardware, and clipping is a crackle, on the one
//  event in the race that most needs to sound like something heavy.
//
//  So one compressor across the master bus, set as a limiter: a threshold at
//  -6dB with a 12:1 ratio, which leaves everything quieter than half scale
//  untouched and folds a 1.2 peak back to about 0.5. Its side effect is the
//  one a mixing desk wants anyway - a big crash ducks the rest of the mix for
//  a moment, which is part of what makes it read as big.
//
//  Exported rather than inlined so the test can put the same limiter on its
//  own offline renders: a headroom check against a limiter configured by hand
//  in the test would be checking the test's numbers, not the game's.
function makeLimiter(ctx) {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.knee.value = 6;
    lim.ratio.value = 12;
    lim.attack.value = 0.003;
    lim.release.value = 0.15;
    return lim;
}

function audioOut() {
    if (!masterGain) {
        masterGain = audioContext.createGain();
        masterGain.gain.value = SOUND_LEVELS[soundChoice];
        // If an engine has no compressor at all the mix goes straight out, as
        // it did before this existed.
        if (typeof audioContext.createDynamicsCompressor === 'function') {
            const lim = makeLimiter(audioContext);
            masterGain.connect(lim);
            lim.connect(audioContext.destination);
        } else {
            masterGain.connect(audioContext.destination);
        }
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

// ---------------------------------------------------------------------------
//  A ROMBO IS TWO THINGS, AND THE FIRST DRAFT HAD SIX
//
//  The engine was one sawtooth through a fixed 800Hz lowpass: a buzz with no
//  weight under it and a timbre that never changed however hard the car was
//  driven. The fix for that was a sub, a detuned twin, a square at the second
//  harmonic, a noise bed and a tanh drive stage - and the result measured
//  exactly as asked and sounded, in Nicola's words, "un po' troppo ricco, non
//  sembra neanche il rombo di un motore".
//
//  He is right, and the measurements were not wrong - they were incomplete. An
//  engine note is a HARMONIC SERIES on one fundamental. Everything that is not
//  in that series reads as something else in the room: the noise bed is wind,
//  the detuned twin is a chorus, the square at 2x is a second instrument, and
//  a drive stage on top of all four turns the lot into fuzz. Each one adds
//  energy where a spectrogram wants it and takes away the one property that
//  makes the ear call it an engine.
//
//  So: two oscillators and two filters, and the two things that were actually
//  missing.
//
//    WEIGHT. A sine an octave under the firing rate, quiet - the chest of the
//      sound. A lowpass can only take away, and at 50-190Hz the saw's
//      fundamental was the bottom of the sound with nothing beneath it.
//
//    THE FILTER MOVES. An engine being driven is brighter than one coasting,
//      and a fixed cutoff is why the old one sounded the same at 40km/h and at
//      300. This is most of what "it sounds like it is working" means, and it
//      costs one line.
//
//  Simpler than the draft before it and simpler than it looks: the saw's own
//  harmonic series does the rest, which is what it was always for.
// ---------------------------------------------------------------------------
function makeEngineVoice(spec, level) {
    const mix = audioContext.createGain();
    mix.gain.value = 1;

    const oscs = [];
    const add = (type, mult, amp) => {
        const o = audioContext.createOscillator();
        o.type = type;
        o.frequency.value = 50 * spec.pitch * mult;
        const g = audioContext.createGain();
        g.gain.value = amp;
        o.connect(g); g.connect(mix);
        o.start();
        oscs.push({ osc: o, mult: mult });
    };
    add('sawtooth', 1, 1.00);          // the engine: one note, one harmonic series
    add('sine', 0.5, 0.35);            // ...and the chest under it

    // A LIFT AT THE FIRING RATE, which follows it. A fixed lift boosts
    // whatever is sitting on it, and at racing speed that is not the note - it
    // is the octave below. Measured on the draft with a fixed 110Hz lift: the
    // loudest partial in the whole sound was the sub at every speed, which is
    // a drone with an engine somewhere behind it.
    const body = audioContext.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 50 * spec.pitch;
    body.Q.value = 0.9;
    body.gain.value = 4;

    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.cutoff * 0.9;
    filter.Q.value = 0.7;

    const gain = audioContext.createGain();
    gain.gain.value = level;

    mix.connect(body); body.connect(filter); filter.connect(gain);

    // Panning is a nicety, not a requirement: older engines have no panner.
    let tail = gain;
    if (typeof audioContext.createStereoPanner === 'function') {
        const pan = audioContext.createStereoPanner();
        pan.pan.value = spec.pan;
        gain.connect(pan);
        tail = pan;
    }
    tail.connect(audioOut());

    return { oscs: oscs, osc: oscs[0].osc, gain: gain, filter: filter,
             body: body, pitch: spec.pitch, base: level, cutoff: spec.cutoff };
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
        // 0.05 of a bare sawtooth and 0.05 of this are not the same loudness -
        // the sub and the body lift add energy the meter sees - so the number
        // is set by measurement rather than by arithmetic: this is what comes
        // out level with the voice it replaces.
        const level = 0.050 * (n > 1 ? 0.8 : 1);
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
    const t = audioContext.currentTime;

    // Map speed to frequency (e.g. 0 -> 50Hz, max speed -> 200Hz)
    // Assuming max speed is around 350. Every partial keeps its ratio, so the
    // whole voice moves as one instrument rather than drifting apart.
    const f = (50 + speed * 0.4) * e.pitch;
    for (const o of e.oscs) o.osc.frequency.setTargetAtTime(f * o.mult, t, 0.1);

    // THE FILTER MOVES WITH THE REVS, and opens further under power: an engine
    // being driven is brighter than one coasting, and that difference is most
    // of what "sounds like it is working" means.
    const rev = Math.max(0, Math.min(1, speed / 350));
    const open = e.cutoff * (0.9 + 1.8 * rev) * (isAccelerating ? 1.2 : 1);
    e.filter.frequency.setTargetAtTime(open, t, 0.08);
    if (e.body) e.body.frequency.setTargetAtTime(Math.min(320, f), t, 0.1);

    // Adjust volume based on throttle
    const targetVolume = isAccelerating ? e.base * 2 : e.base;
    e.gain.gain.setTargetAtTime(targetVolume, t, 0.1);
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
//  A TYRE SQUEAL, which is a VOICE
//
//  Four attempts at this, and the first three were all the same attempt.
//
//    1. white noise through one bandpass at Q7          -> a rustle
//    2. noise through a stack of resonances at Q30      -> a rustle with a tint
//    3. the same, higher, wider, in stereo              -> a wider rustle
//
//  Nicola kept asking for the same thing in different words - stridente, then
//  deciso, then "una voce acuta che strilla quasi" - and the fourth phrasing
//  is the one that says what was actually wrong. Every version above was
//  FILTERED NOISE, and filtered noise cannot scream. You can make it bright,
//  you can make it narrow, you can make it wide, and it is still air rushing:
//  there is no pitch in it, only a region where there happens to be more
//  energy. A scream is the opposite kind of signal - a PERIODIC one, a source
//  buzzing at a definite rate with a full harmonic series on it - and no
//  amount of shaping turns one into the other.
//
//  So the source changed. This is a voice, built the way a voice is:
//
//    GLOTTIS. A sawtooth at 620-1080Hz - the rate of a real shriek, and every
//      harmonic above it in one go. A tyre at the limit works the same way as
//      vocal folds do: it grips, slips, snaps back and grips again, hundreds
//      of times a second, and that is a periodic source, not a hiss.
//
//    TRACT. Four fixed formants at 950 / 2050 / 3150 / 4400Hz, weighted
//      upwards so the shriek band carries the sound. FIXED is the whole
//      trick and it is what every version before this got backwards: the
//      resonances used to be multiples of the fundamental, so they moved with
//      it and the timbre never changed - which is a siren. In a voice the
//      harmonics slide and the formants stay where they are, so different
//      harmonics light up as the pitch moves, and THAT is what the ear hears
//      as something with a throat.
//
//    STRAIN. A real scream is not clean. Vibrato at 5.4Hz, a fast tremble at
//      31Hz that adds the rasp of a voice being pushed, and random jitter -
//      noise through a 30Hz lowpass into the oscillator's detune - because
//      nothing alive holds a frequency steady. Without these three it is a
//      test tone with formants on it.
//
//    BREATH. A little noise through the same formants, so it is a voice and
//      not an organ pipe, and the tarmac is still being scrubbed.
//
//  And it is still built twice and panned apart, which is what made it big
//  last time: different jitter noise, +-1.2% detune, different vibrato rates.
//  Two copies of one voice is one voice; two voices is a crowd.
// x0.5 = down an octave. One number, because an octave is one decision and it
// has to move the source, the whistle and the formants together or it is not
// an octave, it is a different vowel.
const SQUEAL_OCTAVE = 0.5;
const SQUEAL_F0 = 620 * SQUEAL_OCTAVE;          // at the first slip
const SQUEAL_F1 = 1080 * SQUEAL_OCTAVE;         // at full cry

function makeSquealVoice(level) {
    const gain = audioContext.createGain();
    gain.gain.value = 0;

    const voices = [], formants = [], lfos = [];

    // f0 x mult is a HARMONIC; a formant is none of the above - it sits at a
    // frequency of its own and waits for harmonics to pass through it.
    // Five of them, weighted hard upwards, and WIDE. Two reasons, both
    // measured. A sawtooth falls off 6dB an octave, so formants of equal gain
    // leave the lowest one carrying the sound - the first draft measured a
    // centroid of 1513Hz and 24% of its energy above 2kHz, which is a shout
    // rather than a shriek. And a narrow formant at 4.4kHz over a source
    // whose harmonics are 1kHz apart can fall BETWEEN two of them and go
    // silent; Q 5-7 up there always catches at least one, and which one it
    // catches keeps changing as the pitch moves, which is the shimmer.
    // ...and NARROWER than the first draft's 7-4.5. Wide formants smear a
    // pitch across a band, which is the opposite of "netto": the sound has to
    // arrive as a line, not as a region. The risk of narrow formants over a
    // source whose harmonics are a kilohertz apart - a formant falling between
    // two of them and going quiet - is now carried by the whistle, which needs
    // no formant at all.
    // ONE OCTAVE DOWN, and the formants come with it. "Abbassa di un'ottava il
    // suono dello stridio" is about the SOUND, not only its pitch: halving the
    // source alone would have been the same throat singing lower, and the 3-6
    // kHz formants would have kept every bit of the shrillness that was the
    // thing to move. Halving the whole instrument - source, whistle and tract
    // together - is a bigger throat, and it transposes what the ear actually
    // hears. The comment above still holds inside a slide: the formants do not
    // TRACK f0 from frame to frame, which is what makes this a voice rather
    // than a siren. They are simply built an octave lower once.
    const FORMANTS = [[950, 11, 0.5], [2050, 13, 1.8], [3150, 12, 2.2],
                      [4400, 10, 1.8], [5800, 8, 1.1]]
                     .map(([hz, q, amp]) => [hz * SQUEAL_OCTAVE, q, amp]);

    // +-8 cents rather than +-21: at 21 the two sides beat about twenty times
    // a second, which is heard as roughness rather than as width.
    for (const side of [{ pan: -0.6, vib: 5.4, tune: -8, offset: 0 },
                        { pan: 0.6, vib: 6.1, tune: 8, offset: 0.31 }]) {
        let dest = gain;
        if (typeof audioContext.createStereoPanner === 'function') {
            const p = audioContext.createStereoPanner();
            p.pan.value = side.pan;
            p.connect(gain);
            dest = p;
        }

        // ---- the source: a buzz, and the noise that rides with it -------
        const osc = audioContext.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 800 * SQUEAL_OCTAVE;
        osc.detune.value = side.tune;          // +-1.2%, so the two sides beat

        const breath = audioContext.createBufferSource();
        breath.buffer = getNoiseBuffer();
        breath.loop = true;
        const breathG = audioContext.createGain();
        breathG.gain.value = 0.15;             // under the buzz, never over it
        breath.connect(breathG);

        // ---- and the whistle itself -------------------------------------
        // "Una sorta di fischio netto." A voice with formants on it is a
        // shout; what makes something a WHISTLE is one component so much
        // stronger and so much purer than everything around it that the ear
        // hears a single line rather than a timbre. So there is a sine on the
        // second harmonic, straight out with no formant in front of it -
        // 1240-2160Hz, which is where a whistle lives - carrying the pitch,
        // with the buzz and its formants left behind it as the body.
        //
        // The THIRD harmonic, not the fundamental and not the second: at
        // 620-1080Hz a pure tone is a hum, and at twice that the line sat at
        // 1240-2160 and pulled the whole sound's centre of gravity down to
        // 2.3kHz with it. Three times puts it at 1860-3240 - a whistle
        // register, above the second formant, where it cuts instead of
        // filling in.
        const whistle = audioContext.createOscillator();
        whistle.type = 'sine';
        whistle.frequency.value = 2400 * SQUEAL_OCTAVE;
        whistle.detune.value = side.tune;
        const whistleG = audioContext.createGain();
        // 0.22, and the first try at 0.85 is the reason the number is written
        // down. At 0.85 the sine was not a line THROUGH the sound, it was the
        // sound: spectral flatness fell from 0.16 to 0.003, the spread from
        // 0.65 of the centroid to 0.33, and what came out was a test tone with
        // a rumour of a voice behind it. A whistle is a dominant partial in
        // something, not a partial on its own.
        whistleG.gain.value = 0.22;
        whistle.connect(whistleG); whistleG.connect(dest);

        // ---- the tract: fixed resonances, one bank per side -------------
        const bank = [];
        for (const [hz, q, amp] of FORMANTS) {
            const f = audioContext.createBiquadFilter();
            f.type = 'bandpass';
            f.frequency.value = hz;
            f.Q.value = q;
            const g = audioContext.createGain();
            g.gain.value = amp;
            osc.connect(f); breathG.connect(f);
            f.connect(g); g.connect(dest);
            const fm = { filt: f, hz: hz };
            bank.push(fm); formants.push(fm);
        }

        // ---- strain -----------------------------------------------------
        // vibrato: slow and wide enough to hear as a wobble
        const vib = audioContext.createOscillator();
        vib.type = 'sine';
        vib.frequency.value = side.vib;
        const vibD = audioContext.createGain();
        // 20 cents, down from 38. Vibrato is what stops a tone being a test
        // signal; past a point it is also what stops it being a definite
        // pitch, and "netto" is a request for the second thing back.
        vibD.gain.value = 20;                  // cents
        vib.connect(vibD); vibD.connect(osc.detune);
        vib.start(); lfos.push(vib);

        // tremble: fast, shallow, and the difference between a voice singing
        // and a voice at the end of its range
        const rasp = audioContext.createOscillator();
        rasp.type = 'sine';
        rasp.frequency.value = 31;
        const raspD = audioContext.createGain();
        raspD.gain.value = 5;
        rasp.connect(raspD); raspD.connect(osc.detune);
        rasp.start(); lfos.push(rasp);

        // jitter: noise, slowed right down, wandering the pitch a few cents.
        // Nothing periodic can do this job - the point is that it never
        // repeats, and an LFO always does.
        const jit = audioContext.createBufferSource();
        jit.buffer = getNoiseBuffer();
        jit.loop = true;
        const jitLp = audioContext.createBiquadFilter();
        jitLp.type = 'lowpass';
        jitLp.frequency.value = 30;
        const jitD = audioContext.createGain();
        // 10 cents, down from 45: enough that it is not a machine, little
        // enough that the line stays a line
        jitD.gain.value = 10;
        jit.connect(jitLp); jitLp.connect(jitD); jitD.connect(osc.detune);
        jit.start(0, side.offset);

        osc.start();
        whistle.start();
        breath.start(0, side.offset);
        voices.push({ osc: osc, whistle: whistle, bank: bank });
    }

    gain.connect(audioOut());
    return { voices: voices, formants: formants, gain: gain, level: level, lfos: lfos };
}

// ---------------------------------------------------------------------------
//  A KERB, which is not a hiss either
//
//  A rumble strip is not a texture, it is a SEQUENCE: a row of ribs, and the
//  wheel hits them one at a time. What you hear from inside the car is
//  tum-tum-tum-tum, and how fast it comes at you is how fast you are going -
//  which makes it the one sound on the car that is a speedometer.
//
//  The old kerb was a bandpass at 420Hz on looping noise. That is a continuous
//  rattle: it got louder with speed and never once told you the ribs were
//  discrete. So this is an impulse train instead, and the interesting part is
//  that it is built without scheduling anything.
//
//      sawtooth LFO  ->  waveshaper  ->  the gain of the noise path
//
//  The shaper's curve is ((1 - x) / 2)^7, which turns the sawtooth's linear
//  ramp into a spike: the instant the saw snaps back the output is 1, and it
//  falls to half in about a twelfth of a cycle. Instant attack, quick decay,
//  once per rib - a thud. The tail is a fraction of the PERIOD rather than a
//  fixed time, so the hits shorten as they speed up, exactly as they do when
//  the ribs start arriving faster than the tyre can finish ringing.
//
//  Doing it with one oscillator instead of a scheduler buys two things. The
//  rate is an AudioParam, so speed changes glide instead of stepping, and
//  there is nothing per-frame to get behind: a scheduler would have to run a
//  lookahead, and everything it had already queued would keep thumping for as
//  long as that lookahead after the wheel came off the kerb.
function makeKerbVoice(level) {
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;

    // What one rib sounds like: a low thump with a slap on top of it. The
    // thump is the tyre wall deforming, the slap is the tread edge catching.
    const body = audioContext.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 240;
    const bodyG = audioContext.createGain();
    // A pulse train is silent between hits, so its RMS is a quarter of its
    // peak where a continuous voice's is most of it: measured, the first
    // draft came out at half the loudness of the hiss it replaced. These are
    // set so the kerb is as present as it was, not as loud on paper.
    bodyG.gain.value = 3.8;          // a 240Hz lowpass passes 240Hz of noise;
                                     // the slap's bandpass passes over a kHz
    const slap = audioContext.createBiquadFilter();
    slap.type = 'bandpass';
    slap.frequency.value = 1500;
    slap.Q.value = 1.1;
    const slapG = audioContext.createGain();
    slapG.gain.value = 0.75;

    // the gate: silent by itself, opened once per rib by the shaper below
    const pulse = audioContext.createGain();
    pulse.gain.value = 0;
    src.connect(body); body.connect(bodyG); bodyG.connect(pulse);
    src.connect(slap); slap.connect(slapG); slapG.connect(pulse);

    const lfo = audioContext.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 8;
    const shaper = audioContext.createWaveShaper();
    const CURVE = new Float32Array(2048);
    for (let i = 0; i < CURVE.length; i++) {
        const x = (i / (CURVE.length - 1)) * 2 - 1;      // -1 .. 1
        CURVE[i] = Math.pow((1 - x) / 2, 7);             // 1 at the snap, then away
    }
    shaper.curve = CURVE;
    lfo.connect(shaper); shaper.connect(pulse.gain);
    lfo.start();

    // and a thin continuous bed underneath, because a wheel on a kerb is also
    // scrubbing across the paint between ribs. Quiet: if this is loud the
    // rhythm stops being the sound and it is a rattle again.
    const bed = audioContext.createBiquadFilter();
    bed.type = 'bandpass';
    bed.frequency.value = 900;
    bed.Q.value = 0.8;
    const bedG = audioContext.createGain();
    bedG.gain.value = 0.12;
    src.connect(bed); bed.connect(bedG);

    const gain = audioContext.createGain();
    gain.gain.value = 0;
    pulse.connect(gain); bedG.connect(gain);
    gain.connect(audioOut());
    src.start();
    return { src: src, gain: gain, level: level, lfo: lfo, body: body, slap: slap };
}

function initSfx() {
    if (sfx) return sfx;
    sfx = {
        // rumble strips: one thud per rib, and they come at you faster the
        // quicker you are going. See above.
        kerb: makeKerbVoice(0.50),
        // grass: broadband, dull, and loud enough to be a warning
        grass: makeNoiseVoice('lowpass', 320, 0, 0.34),
        // rubber giving up - and it is a pitch, not a hiss. See above.
        slide: makeSquealVoice(0.11)
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
    const squeal = Math.max(0, Math.min(1, (slide - 55) / 75));
    sfx.kerb.gain.gain.setTargetAtTime(kerb * sfx.kerb.level, t, 0.02);
    sfx.grass.gain.gain.setTargetAtTime(grass * sfx.grass.level, t, 0.05);
    // 0.015, not 0.03: three frames to full cry rather than seven. The squeal
    // has to arrive WITH the slide to be a warning about it.
    sfx.slide.gain.gain.setTargetAtTime(squeal * sfx.slide.level, t, 0.015);
    // HOW FAST THE RIBS ARRIVE. This is the whole point of the kerb voice: the
    // rate is the sound. 5Hz at walking pace, 23Hz flat out - fast enough to
    // be a hammering, still slow enough that the ear counts the hits instead
    // of fusing them into a tone, which is what happens somewhere past 30.
    sfx.kerb.lfo.frequency.setTargetAtTime(5 + 18 * fast, t, 0.06);
    if (squeal > 0) {
        // The pitch rises as the slide worsens, which is what makes it a
        // warning rather than an ornament. It ran at 620-1080Hz and now runs
        // an octave under that, at 310-540, with the formants moved with it -
        // a voice is heard through its harmonics, so moving the tract is what
        // makes this an octave rather than a gearshift.
        const f0 = SQUEAL_F0 + (SQUEAL_F1 - SQUEAL_F0) * squeal;
        for (const v of sfx.slide.voices) {
            v.osc.frequency.setTargetAtTime(f0, t, 0.05);
            // the whistle rides the third harmonic, so it is the same slide
            v.whistle.frequency.setTargetAtTime(f0 * 3, t, 0.05);
        }
        // The formants barely move, and that is deliberate - they are the
        // throat, not the note. What they do is lift a little under strain,
        // the way a voice being pushed does, so the last of the slide is
        // brighter without being higher.
        for (const fm of sfx.slide.formants)
            fm.filt.frequency.setTargetAtTime(fm.hz * (1 + 0.13 * squeal), t, 0.08);
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
    const burst = (when, dur, type, freq, q, amp, dend, att) => {
        if (amp < 0.004) return;
        const src = audioContext.createBufferSource();
        src.buffer = getNoiseBuffer();
        src.playbackRate.value = rnd(0.85, 1.2);
        const f = audioContext.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        if (q) f.Q.value = q;
        // The filter opens and shuts across the burst: a panel deforming is
        // bright at the instant of contact and dull immediately after.
        //
        // setValueAtTime FIRST. An AudioParam ramp with no anchor starts from
        // the context's zero, not from where the sound does - so the body of
        // the crash, a lowpass meant to slide from 300Hz down to 80 across its
        // own 90ms, was already at 80Hz before it made a sound. Measured, the
        // whole impact had 0.2% of its energy below 200Hz: a car crash with no
        // weight in it at all.
        if (dend) {
            f.frequency.setValueAtTime(freq, when);
            f.frequency.exponentialRampToValueAtTime(Math.max(40, dend), when + dur);
        }
        const g = audioContext.createGain();
        // A GainNode's gain defaults to 1, and scheduling the first event at
        // `when` leaves it AT ONE until then. See the note at the ring below:
        // this is the same trap, and it is only harmless here because the
        // source has not started yet.
        g.gain.value = 0;
        g.gain.setValueAtTime(0.0001, when);
        // 2ms unless asked otherwise. Mass is slower to get going than sheet
        // metal is, and the mass layer below asks for 5.
        g.gain.linearRampToValueAtTime(amp, when + (att || 0.002));
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
        // The body: mass, low and dull, and NOT a tone. The amplitude looks
        // enormous next to the others and is not: a lowpass at 400Hz passes
        // 400Hz of a broadband source while the debris tail's highpass passes
        // twenty kilohertz, so at equal amplitude the tail carries fifty times
        // the power. Measured before this was corrected, the whole impact had
        // 1% of its energy below 200Hz - a car crash with no weight in it.
        //
        // AND IT WAS STILL TOO LIGHT. Nicola: "sembrano più dei carrelli
        // della spesa vuoti che vanno a sbattere uno contro l'altro", which is
        // an exact description of a spectrum with its weight in the mids -
        // a trolley is a thin steel frame with nothing in it, and the sound
        // says so. 13% under 200Hz was the measurement; a loaded car hitting
        // a barrier is nearer half. So the body dropped an octave and got
        // longer, and the mass layer below joined it.
        burst(when, rnd(0.075, 0.125) + 0.09 * s, 'lowpass',
              rnd(95, 155) + 110 * s, 0.9, 4.0 * level * fall, rnd(42, 62));
        // the panel: the crunch proper, mid and broad
        burst(when + rnd(0, 0.005), rnd(0.035, 0.065) + 0.035 * s, 'bandpass',
              rnd(700, 1200) + 700 * s, 1.1, 0.55 * level * fall, rnd(240, 420));
    }

    // ---- the mass, which is the part you feel ---------------------------
    // One low thump under the whole cluster, longer than any of them and cut
    // off at the bottom of hearing. This is not a fourth grain and it is not
    // a note: it is filtered noise, so it has no pitch to identify - what it
    // has is a quarter of a second of energy under 120Hz, which is the
    // difference between two objects colliding and two objects with weight
    // colliding. It is slower to start than the crunch (5ms of attack rather
    // than 2) because that is how mass behaves, and it starts a hair EARLY,
    // so the low end is already moving when the panels arrive.
    //
    // The first go at this weighed 5.0 and ran for half a second, and the
    // measurements said what that sounds like: 68% of the energy under 200Hz
    // and a spectral flatness of 0.14, down from 0.61. That is not a heavy
    // crash, it is a boom with a crash somewhere behind it - the low end had
    // stopped supporting the sound and started replacing it. Half the weight
    // and two thirds the length puts it under the crunch instead of over it.
    burst(t0 - 0.004, 0.22 + 0.32 * s, 'lowpass',
          rnd(62, 95) + 35 * s, 0.6, 4.4 * level, rnd(32, 46), 0.007);

    // ---- and the settle, which is the second half of weight -------------
    // A heavy thing that hits something does not stop when the noise does: it
    // rocks, drops back onto its suspension and thumps a second time, a tenth
    // of a second later and lower than the first. This is the cheapest weight
    // in the whole sound, because it adds low energy WITHOUT piling it at the
    // same instant as everything else - the failure mode of simply turning the
    // bass up is a boom, and a boom is one event, while this is two.
    if (s > 0.35) {
        burst(t0 + rnd(0.09, 0.16), 0.20 + 0.26 * s, 'lowpass',
              rnd(52, 78), 0.6, 2.1 * level, rnd(28, 40), 0.008);
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
        rg.gain.linearRampToValueAtTime(0.06 * level, t0 + 0.004);
        rg.gain.exponentialRampToValueAtTime(0.0001, t0 + rnd(0.09, 0.18));
        ring.connect(rg); rg.connect(dest);
        ring.start(t0); ring.stop(t0 + 0.24);
    }

    // ---- and the debris, which outlasts the impact ----------------------
    // Loud enough to be heard under the crunch and long enough to outlive it:
    // measured, this is what stops the sound ENDING, which is the difference
    // between something breaking and something being hit.
    // Quieter than it was, and so is the ring above it. Both are the RATTLE,
    // and a rattle over a thin body is exactly the trolley: the fix is as much
    // about what sits on top of the weight as about the weight itself.
    // ...and it went UP again when the mass layer went in. Nothing about the
    // debris changed; the head of the impact got half as loud again, and a
    // tail measured against a bigger head is a quieter tail. The rule this
    // sound is held to is that something is still skittering long after the
    // bang, so the tail has to keep pace with whatever the bang becomes.
    // ...and it was lengthened rather than turned up. Turning it up to 0.19
    // did restore the ratio, and it did it by adding as much to the top of the
    // spectrum as the mass layer had added to the bottom - which is a louder
    // crash, not a heavier one. Duration puts energy in the late window where
    // the ratio is measured without putting any in the head at all.
    const tail = 0.45 + 1.00 * s;
    burst(t0 + 0.03, tail, 'highpass', rnd(2400, 3200), 0.7, 0.145 * level, 4200);
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
    // a half-finished radio call outliving its race is the one way this
    // feature can follow you into a menu
    if (typeof radioStop === 'function') radioStop();
    silenceSurfaceSound();
    for (const e of engines) {
        for (const o of (e.oscs || [{ osc: e.osc }]))
            try { o.osc.stop(); } catch (err) { /* already stopped */ }
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

// ===========================================================================
//  TEAM RADIO
//
//  The pit wall, out loud. The words come from the browser's own speech
//  synthesiser - no audio files, no network, nothing to ship - and the RADIO
//  is everything around them: a squelch open, a burst of band noise under the
//  first syllable, and the click of the button being let go at the end.
//
//  WHY THE VOICE ITSELF IS NOT FILTERED. speechSynthesis writes straight to
//  the output device; it is not a node and cannot be routed through the Web
//  Audio graph, so there is no way to put a band-pass and a little distortion
//  across the words the way a real radio does. What sells a radio call is
//  mostly the framing anyway - the squelch, the noise floor, the clipped
//  delivery - and all three of those are here. Verified on Nicola's own Mac
//  before any of this was written: 199 voices, 44 of them English, and a test
//  utterance ran start to end in his Chrome on a file:// page.
// ===========================================================================
let radioVoice = null;
let radioVoiceTried = false;

// A British male if there is one - it is the accent of the genre - then any
// English, then whatever the machine has. Daniel is macOS's en-GB male and is
// what the check on Nicola's machine picked.
function pickRadioVoice() {
    if (radioVoice || radioVoiceTried) return radioVoice;
    if (typeof speechSynthesis === 'undefined') { radioVoiceTried = true; return null; }
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return null;                 // not loaded yet; asked again next call
    radioVoiceTried = true;
    const by = (re) => vs.find(v => re.test(v.name) && /^en/i.test(v.lang));
    radioVoice = by(/^Daniel/) || by(/^(Oliver|Arthur|George|Malcolm)/) ||
                 vs.find(v => /^en[-_]GB/i.test(v.lang)) ||
                 vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
    return radioVoice;
}
if (typeof speechSynthesis !== 'undefined' && speechSynthesis.addEventListener) {
    // Chrome fills the list asynchronously and sometimes only after the first
    // getVoices() call, so both the event and the poll above are needed
    speechSynthesis.addEventListener('voiceschanged', () => {
        radioVoiceTried = false; radioVoice = null; pickRadioVoice();
    });
}

// THE SQUELCH. A press and a release, and they do not sound the same: the
// press opens onto a hiss that takes a moment to settle, the release is short,
// dry and a little harder. Both are noise through a narrow band - the band IS
// the radio, because a channel that only carries 400 to 2600 hertz is what
// makes a voice sound like it came down a wire.
function radioSquelch(open, delay) {
    if (!isAudioInitialized || !soundIsOn()) return;
    const t = audioContext.currentTime + (delay || 0);
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    const bp = audioContext.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = open ? 1450 : 1950;
    bp.Q.value = 0.9;
    // a second, resonant stage: one bandpass is a filter, two is a receiver
    const peak = audioContext.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 2400;
    peak.Q.value = 3;
    peak.gain.value = 9;
    const env = audioContext.createGain();
    const dur = open ? 0.16 : 0.075;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(open ? 0.15 : 0.11, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(peak); peak.connect(env); env.connect(audioOut());
    src.start(t); src.stop(t + dur + 0.02);
    // and the button, keyed and let go
    sfxTone(open ? 1320 : 990, 0.035, 0.07, 'square', delay || 0);
}

// THE ROGER BEEP - the two-tone blip that tops and tails a real team radio.
// It is the single most recognisable thing about the sound, and it is the one
// part of it that does not depend on the voice at all.
function radioBeep(up, delay) {
    if (!isAudioInitialized || !soundIsOn()) return;
    const d = delay || 0;
    if (up) {
        sfxTone(1180, 0.055, 0.10, 'sine', d);
        sfxTone(1570, 0.070, 0.11, 'sine', d + 0.055);
    } else {
        sfxTone(1570, 0.050, 0.09, 'sine', d);
        sfxTone(1050, 0.085, 0.10, 'sine', d + 0.050);
    }
}

// THE CARRIER. A thin band of static for the voice to sit on - and, on top of
// it, the two things that say "this is a radio and not a room": the static
// BREATHING at syllable rate, as a real channel does when something is
// modulating it, and the odd crackle and half-second drop-out. The voice
// itself cannot be filtered - speechSynthesis writes straight to the output
// device and is not a Web Audio node - so everything that makes this sound
// like a transmission has to happen around it, and the more of it there is the
// better the illusion holds.
function radioCarrier(secs) {
    if (!isAudioInitialized || !soundIsOn()) return null;
    const t = audioContext.currentTime;
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    const bp = audioContext.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 0.7;
    const peak = audioContext.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 2500;
    peak.Q.value = 2.5;
    peak.gain.value = 7;
    const env = audioContext.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.032, t + 0.05);
    src.connect(bp); bp.connect(peak); peak.connect(env); env.connect(audioOut());
    src.start(t);

    // ...breathing. A slow random walk at roughly syllable rate, scheduled a
    // few seconds ahead and topped up while the call runs.
    let at = t + 0.05;
    const swell = () => {
        const until = audioContext.currentTime + 3;
        while (at < until) {
            const step = 0.09 + Math.random() * 0.11;
            at += step;
            env.gain.linearRampToValueAtTime(0.016 + Math.random() * 0.030, at);
        }
    };
    swell();
    const swellTimer = setInterval(swell, 1800);

    // ...and the crackle: short noise pops, and now and then the channel drops
    // out for a moment the way a real one does behind a grandstand.
    const pop = () => {
        if (!isAudioInitialized || !soundIsOn()) return;
        const n = audioContext.currentTime;
        const p = audioContext.createBufferSource();
        p.buffer = getNoiseBuffer();
        const hp = audioContext.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1100;
        const g = audioContext.createGain();
        const dur = 0.012 + Math.random() * 0.03;
        g.gain.setValueAtTime(0.05 + Math.random() * 0.06, n);
        g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
        p.connect(hp); hp.connect(g); g.connect(audioOut());
        p.start(n); p.stop(n + dur + 0.02);
    };
    const popTimer = setInterval(() => { if (Math.random() < 0.55) pop(); }, 420);

    return { stop: () => {
        clearInterval(swellTimer);
        clearInterval(popTimer);
        const n = audioContext.currentTime;
        env.gain.cancelScheduledValues(n);
        env.gain.setValueAtTime(env.gain.value, n);
        env.gain.exponentialRampToValueAtTime(0.0001, n + 0.12);
        try { src.stop(n + 0.2); } catch (e) { /* already stopped */ }
    } };
}

// ---------------------------------------------------------------------------
//  ...and the call itself.
//
//  ONE VOICE AT A TIME, and never a backlog. A race generates these in
//  clusters - you take the lead, set the fastest lap and get blue flags in the
//  same ten seconds - and a radio that queued all of them would still be
//  reading out lap 4 on lap 6. So a call in progress is either left alone or
//  cut off by something more important, and nothing waits its turn: by the
//  time the wall could say it, it is no longer true.
//
//  PRIORITY is the whole queue. 3 is the flag and the box call, 2 is the race
//  changing under you, 1 is colour.
let radioOn = true;
let radioBusy = null;          // { pri, carrier } while a call is live
let radioLastAt = 0;           // wall clock of the last call, for the gap
let radioNext = null;          // ONE call waiting, and only for a few seconds
let radioSeq = 0;              // which call is live, for the timers that outlive it
const RADIO_GAP_MS = 1200;     // the wall does not chatter, but it does talk
const RADIO_WAIT_MS = 7000;    // past this a held call is no longer news
const RADIO_BEEP_MS = 170;     // the blip, before the words that follow it

function setTeamRadio(on) { radioOn = !!on; if (!radioOn) radioStop(); }
function teamRadioOn() { return radioOn; }

// Silence, and nothing waiting: the race is over, or the radio has been
// switched off. Everything that was going to be said is now not going to be.
function radioStop() {
    radioCut();
    radioNext = null;
    if (radioPump) { clearTimeout(radioPump); radioPump = null; }
}

// ...as opposed to a call being CUT OFF by a bigger one, which must leave the
// held slot alone: the first version used radioStop() for both, so a
// priority-3 call interrupting a priority-1 also threw away the line waiting
// behind it - the exact line the holding was written to save.
function radioCut() {
    if (typeof speechSynthesis !== 'undefined') {
        try { speechSynthesis.cancel(); } catch (e) { /* nothing to cancel */ }
    }
    if (radioBusy && radioBusy.carrier) radioBusy.carrier.stop();
    radioBusy = null;
}

// THE ONE HELD CALL. A lap crossing now produces two lines, not one, and the
// second of them is worth hearing a second and a half later - so instead of
// dropping it, it waits. Exactly one waits: a backlog would still be reading
// out lap four on lap six, which is what the queue was written to avoid. A
// bigger call replaces whatever is waiting, and anything older than seven
// seconds is thrown away rather than said, because by then it is not true.
let radioPump = null;
function radioHold(text, pri) {
    if (radioNext && radioNext.pri > pri) return false;
    radioNext = { text: text, pri: pri, at: Date.now() };
    if (!radioPump) radioPump = setTimeout(radioDrain, 300);
    return true;
}
function radioDrain() {
    radioPump = null;
    if (!radioNext) return;
    if (Date.now() - radioNext.at > RADIO_WAIT_MS) { radioNext = null; return; }
    if (radioBusy || Date.now() - radioLastAt < RADIO_GAP_MS) {
        radioPump = setTimeout(radioDrain, 300);
        return;
    }
    const n = radioNext;
    radioNext = null;
    teamRadio(n.text, n.pri, true);
}

// `text` is what the wall says. `pri` decides whether it may interrupt, and
// whether it waits its turn or is forgotten.
function teamRadio(text, pri, fromHold) {
    if (!radioOn || !text) return false;
    if (typeof speechSynthesis === 'undefined') return false;
    if (!soundIsOn()) return false;                  // the volume control owns it too
    pri = pri || 1;
    const now = Date.now();
    // something is already being said: only a bigger call may cut in, and the
    // one it displaces goes into the held slot rather than into the bin
    if (radioBusy) {
        if (pri <= radioBusy.pri) return fromHold ? false : radioHold(text, pri);
        radioCut();
    } else if (now - radioLastAt < RADIO_GAP_MS && pri < 3) {
        return fromHold ? false : radioHold(text, pri);
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = pickRadioVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    // Clipped, flat and a touch hurried, the way somebody talks into a
    // pit-wall mic with a car going past. The jitter is small on purpose: it
    // stops twenty calls in a race sounding like the same recording.
    u.rate = 1.18 + (Math.random() - 0.5) * 0.06;
    u.pitch = 0.78 + (Math.random() - 0.5) * 0.05;
    u.volume = 1;
    radioSquelch(true, 0);
    radioBeep(true, 0.05);
    const carrier = radioCarrier();
    const seq = ++radioSeq;
    radioBusy = { pri: pri, carrier: carrier, seq: seq };
    const done = () => {
        if (!radioBusy) return;
        if (radioBusy.carrier) radioBusy.carrier.stop();
        radioBusy = null;
        radioLastAt = Date.now();
        radioBeep(false, 0.02);
        radioSquelch(false, 0.14);
        if (radioNext && !radioPump) radioPump = setTimeout(radioDrain, 300);
    };
    u.onend = done;
    u.onerror = done;
    // A safety net: Chrome occasionally drops an utterance without firing
    // either event, and a radioBusy that never clears is a radio that never
    // speaks again. Two seconds per ten characters is far longer than any of
    // these lines take.
    const cap = 1200 + text.length * 90;
    setTimeout(() => { if (radioBusy && radioBusy.seq === seq) done(); }, cap);
    // ...and the words start a beat after the beep, so the blip is not talked
    // over by its own message.
    setTimeout(() => {
        if (!radioBusy || radioBusy.seq !== seq) return;            // cut off before it began
        try { speechSynthesis.speak(u); } catch (e) { done(); }
    }, RADIO_BEEP_MS);
    return true;
}
