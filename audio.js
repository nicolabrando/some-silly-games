const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let engineOscillator = null;
let engineGain = null;
let isAudioInitialized = false;

// BGM variables
let bgmOscillator = null;
let bgmGain = null;
let bgmInterval = null;

const melody = [
    261.63, 0, 329.63, 0, 392.00, 0, 523.25, 0,
    392.00, 0, 329.63, 0, 261.63, 0, 196.00, 0,
    293.66, 0, 349.23, 0, 440.00, 0, 587.33, 0,
    440.00, 0, 349.23, 0, 293.66, 0, 220.00, 0,
];

let noteIndex = 0;

function initAudio() {
    if (isAudioInitialized) return;
    
    // Resume context if suspended (browser policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    // Engine Sound Setup
    engineOscillator = audioContext.createOscillator();
    engineOscillator.type = 'sawtooth';
    
    engineGain = audioContext.createGain();
    engineGain.gain.value = 0.05; // Base low volume
    
    // Lowpass filter to muffle the raw sawtooth
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    
    engineOscillator.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(audioContext.destination);
    
    engineOscillator.frequency.value = 50; // Idle frequency
    engineOscillator.start();
    
    // BGM Setup
    startBGM();
    
    isAudioInitialized = true;
}

function updateEngineSound(speed, isAccelerating) {
    if (!isAudioInitialized || !engineOscillator) return;
    
    // Map speed to frequency (e.g. 0 -> 50Hz, max speed -> 200Hz)
    // Assuming max speed is around 350
    const targetFreq = 50 + (speed * 0.4); 
    
    // Smooth transition
    engineOscillator.frequency.setTargetAtTime(targetFreq, audioContext.currentTime, 0.1);
    
    // Adjust volume based on throttle
    const targetVolume = isAccelerating ? 0.1 : 0.05;
    engineGain.gain.setTargetAtTime(targetVolume, audioContext.currentTime, 0.1);
}

function startBGM() {
    bgmGain = audioContext.createGain();
    bgmGain.gain.value = 0.03; // Background music should be quiet
    bgmGain.connect(audioContext.destination);
    
    // Play a note every 150ms
    bgmInterval = setInterval(() => {
        const freq = melody[noteIndex];
        
        if (freq > 0) {
            const osc = audioContext.createOscillator();
            osc.type = 'square';
            osc.frequency.value = freq;
            
            const envelope = audioContext.createGain();
            envelope.gain.setValueAtTime(0, audioContext.currentTime);
            envelope.gain.linearRampToValueAtTime(0.03, audioContext.currentTime + 0.02);
            envelope.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
            
            osc.connect(envelope);
            envelope.connect(bgmGain);
            
            osc.start(audioContext.currentTime);
            osc.stop(audioContext.currentTime + 0.1);
        }
        
        noteIndex = (noteIndex + 1) % melody.length;
    }, 150);
}

function stopAudio() {
    if (engineOscillator) {
        engineOscillator.stop();
        engineOscillator = null;
    }
    if (bgmInterval) {
        clearInterval(bgmInterval);
        bgmInterval = null;
    }
    isAudioInitialized = false;
}
