// =============================================================================
//  AI DRIVER  -  v7.1
// -----------------------------------------------------------------------------
//  The AI never cheats on physics: it only fills car.inputs, exactly like the
//  player's keyboard would.  What changed compared to the previous version:
//
//   * it follows a pre-computed racing line (track.getRacingLine()) sampled at a
//     constant arc-length step, instead of an index-based lookahead over
//     irregularly spaced waypoints (that irregularity was the main cause of the
//     zig-zag);
//   * throttle/brake come from a physical speed profile (steering-rate limit +
//     lateral grip limit) with a proper braking-distance lookahead, instead of
//     "brake whenever the steering angle is large" (which made the cars stall in
//     the middle of the track);
//   * the steering deadband is tied to the yaw rate actually achievable in one
//     frame, so the car can never command a correction it will overshoot;
//   * traffic is handled by shifting the *lateral offset of the target point*
//     instead of rotating the target direction, so avoidance can no longer flip
//     the aim behind the car and trigger the wrong-way / reverse recovery;
//   * wrong-way detection uses the track tangent, not the (possibly perturbed)
//     aim direction.
// =============================================================================

const AI_PROFILES = {
    easy: {
        cornerFactor: 0.72,     // fraction of the attainable cornering speed
        straightFactor: 0.68,   // fraction of top speed on the straights
        brakeConfidence: 0.55,  // lower => brakes earlier
        lineBlend: 0.35,        // 0 = centre line, 1 = full racing line
        radiusOptimism: 0.0,    // 0 = worst radius of the neighbourhood, 1 = local radius
        lookBase: 58,
        lookSpeed: 0.26,
        steerTau: 0.11,         // steering low-pass (s)
        reaction: [0.45, 0.90],
        errorChance: 0.30,
        errorMag: 0.20,
        overtake: 0.45,         // willingness to move off-line to pass
        safeGap: 38,            // px kept from the car ahead
        gapGain: 1.5,           // how hard the gap is closed
        defend: 0.0,            // how much it covers the line under attack
        lineLevel: 'standard',
        maxCorner: 0.85,        // ceiling after driver-style multipliers
        // How much of attack mode this level gets. The quick profiles already
        // run at the edge, so letting them push harder still just crashes
        // them - measured better than one retirement per race at impossible.
        attackGain: 1.00
    },
    medium: {
        cornerFactor: 0.95,
        straightFactor: 0.96,
        brakeConfidence: 0.86,
        lineBlend: 0.85,
        radiusOptimism: 0.25,
        lookBase: 44,
        lookSpeed: 0.20,
        steerTau: 0.06,
        reaction: [0.22, 0.42],
        errorChance: 0.06,
        errorMag: 0.09,
        overtake: 0.92,
        safeGap: 25,
        gapGain: 2.1,
        defend: 0.45,
        lineLevel: 'standard',
        maxCorner: 1.00,
        attackGain: 1.00
    },
    hard: {
        cornerFactor: 1.08,
        straightFactor: 1.0,
        brakeConfidence: 1.02,
        lineBlend: 1.0,
        radiusOptimism: 0.55,
        lookBase: 38,
        lookSpeed: 0.17,
        steerTau: 0.04,
        reaction: [0.11, 0.19],
        errorChance: 0.008,
        errorMag: 0.04,
        overtake: 1.0,
        safeGap: 19,
        gapGain: 2.5,
        defend: 0.75,
        lineLevel: 'standard',
        maxCorner: 1.13,
        attackGain: 0.55
    },
    impossible: {
        // 1.16 is the measured optimum: swept solo across every layout, lap
        // time bottoms out here and starts rising again past ~1.25 as the car
        // begins to scrub instead of turn.
        cornerFactor: 1.14,
        straightFactor: 1.0,
        brakeConfidence: 1.12,
        lineBlend: 1.0,
        radiusOptimism: 1.0,
        lookBase: 34,
        lookSpeed: 0.155,
        steerTau: 0.028,
        reaction: [0.085, 0.135],
        errorChance: 0.0,
        errorMag: 0.0,
        overtake: 1.0,
        safeGap: 16,
        gapGain: 2.9,
        defend: 0.95,
        lineLevel: 'fast',      // measured-optimal line, only at this level
        maxCorner: 1.19,
        attackGain: 0.30
    }
};

// -----------------------------------------------------------------------------
//  DRIVER STYLES
//  Multipliers applied on top of the difficulty profile, so a personality
//  colours *how* a driver is quick without letting anyone escape the physics.
//    corner/straight : pace
//    brake           : how late they brake (>1 = later)
//    steerTau        : <1 = sharper, more nervous hands; >1 = smoother
//    err             : mistake frequency
//    overtake/gap    : wheel-to-wheel aggression (gap <1 = sits closer)
//    defend          : how hard they cover the line when attacked
//    wet             : grip multiplier in the rain (also used by car.js)
//    cleanAir        : pace bonus when there is nobody within ~160px ahead
// -----------------------------------------------------------------------------
//  BALANCE RULE: these are styles, not tiers. Nobody may be quicker than
//  everybody else in every condition. `corner` and `straight` are therefore
//  ANTI-CORRELATED - a driver who carries more speed through a corner gives it
//  back down the straight - and any driver with a real advantage (few
//  mistakes, pace in the rain, pace in clean air) pays for it somewhere else.
//
//  The previous version broke this rule badly. `corner` ran from 0.995 to
//  1.045 with nothing traded against it, so a handful of drivers were simply
//  faster than the rest: measured over 30 races, Senna won 47% of them and
//  three drivers never won at all, with 5.3 places between the best and worst
//  mean finishing position. It is now 2.4 places and every driver wins
//  between 7% and 13%.
//
//  TWO FITTED COLUMNS, both set by simulation rather than by eye:
//
//  `trim` - a whole-lap pace multiplier fitted so every driver's mean
//  finishing position in the DRY lands mid-field. It absorbs the things that
//  cannot be reasoned about on paper: mistakes cost time, traffic costs time.
//
//  `wet` - NOT simply "how good they are in the rain". A wet race is
//  corner-dominated, so the corner/straight split above already creates rain
//  specialists on its own, and the honest wet-weather ranking is the NET of
//  the two. These values are the correction that lands the net order where it
//  is meant to be (Schumacher, Hamilton and Senna strongest; Lauda and Vettel
//  weakest) with a spread of about four places instead of eight. That is why
//  a rain expert can carry a number below 1.
//
//  Change any personality trait and both columns need refitting.
const AI_DRIVER_STYLES = {
    // Blinding through the quick stuff and peerless in the rain; gives it back
    // on the straights and lives closest to the edge - by far the most mistakes.
    'Ayrton Senna':       { corner: 1.030, straight: 0.978, brake: 1.05, steerTau: 0.75, err: 1.90, overtake: 1.00, gap: 0.85, defend: 0.95, wet: 1.024, cleanAir: 1, trim: 0.9979 },
    // The Professor: never errs, superb alone - and genuinely poor in the wet
    // and reluctant wheel to wheel.
    'Alain Prost':        { corner: 0.985, straight: 1.028, brake: 0.88, steerTau: 1.45, err: 0.22, overtake: 0.70, gap: 1.25, defend: 0.55, wet: 0.990, cleanAir: 1.01, trim: 1.0114 },
    // Relentless metronome, brutal on defence, superb in the rain; nothing
    // special in clean air.
    'Michael Schumacher': { corner: 1.018, straight: 0.992, brake: 1.08, steerTau: 0.95, err: 0.60, overtake: 0.95, gap: 0.88, defend: 1.00, wet: 1.047, cleanAir: 0.999, trim: 1.0002 },
    // Latest braker on the grid, never yields - and error-prone with it.
    'Max Verstappen':     { corner: 1.012, straight: 0.996, brake: 1.18, steerTau: 0.70, err: 1.10, overtake: 1.00, gap: 0.75, defend: 1.00, wet: 0.981, cleanAir: 0.998, trim: 1.0126 },
    // Thrives in the wet and in a fight; the weakest of the lot on his own.
    'Lewis Hamilton':     { corner: 1.010, straight: 1.000, brake: 1.02, steerTau: 0.90, err: 0.75, overtake: 0.95, gap: 0.92, defend: 0.85, wet: 1.007, cleanAir: 0.997, trim: 1.0010 },
    // Unbeatable wheel to wheel, ordinary once the road is clear.
    'Fernando Alonso':    { corner: 1.005, straight: 1.000, brake: 1.10, steerTau: 0.85, err: 0.70, overtake: 1.00, gap: 0.72, defend: 1.00, wet: 1.010, cleanAir: 0.997, trim: 0.9954 },
    // Devastating in clean air and on a straight; hates traffic and the rain.
    'Sebastian Vettel':   { corner: 1.000, straight: 1.018, brake: 1.00, steerTau: 0.88, err: 0.85, overtake: 0.75, gap: 1.15, defend: 0.70, wet: 1.012, cleanAir: 1.014, trim: 0.9973 },
    // Famously smooth and almost mistake-free; passive in a fight.
    'Jim Clark':          { corner: 1.022, straight: 0.986, brake: 0.96, steerTau: 1.40, err: 0.30, overtake: 0.80, gap: 1.05, defend: 0.60, wet: 1.021, cleanAir: 1.005, trim: 0.9928 },
    // The computer: calculated risk, no heroics, no mistakes - and no pace in
    // the wet.
    'Niki Lauda':         { corner: 0.992, straight: 1.022, brake: 0.92, steerTau: 1.20, err: 0.28, overtake: 0.75, gap: 1.20, defend: 0.70, wet: 1.020, cleanAir: 1.008, trim: 0.9919 },
    // Wins at the slowest speed necessary: no weakness, no standout either.
    'Juan Manuel Fangio': { corner: 1.005, straight: 1.006, brake: 0.94, steerTau: 1.30, err: 0.32, overtake: 0.90, gap: 1.10, defend: 0.80, wet: 1.018, cleanAir: 1.003, trim: 0.9988 }
};

// Physics constants mirrored from car.js - keep in sync if the car changes.
const AI_MAX_STEER = Math.PI * 0.7;
const AI_TOP_SPEED = 355;      // enginePower / baseFriction
const AI_BASE_GRIP = 1200;
const AI_CORNER_SAFETY = 0.90; // never ask for more than 90% of the theoretical limit
const AI_START_CAUTION = 4.5;  // seconds of extra caution after the lights

// --- racecraft ----------------------------------------------------------
// Without these the field forms a train: everyone settles at the safe gap,
// matches the speed of the car in front and the race finishes in grid order.
// Two things fix that - being allowed to actually outpace a car you are
// alongside, and building up to a committed attempt when you are held up.
const AI_CLEAR_SIDE = 26;      // px of lateral separation = on a different line
const AI_OVERLAP_SIDE = 14;    // px below which we are squarely in their gearbox
const AI_ALONGSIDE_GAIN = 0.40;// speed advantage allowed when nearly clear
const AI_ATTACK_BUILD = 1.8;   // seconds held up before attack mode is full
const AI_ATTACK_CORNER = 0.14; // extra cornering commitment at full attack
// Hard ceiling on the attack boost. cornerFactor bottoms out around 1.16 and
// past ~1.25 the car scrubs instead of turning, so an unbounded boost simply
// crashed the quick profiles: hard went to 0.75 retirements a race. Capping
// here means attack mode gives medium a real lift and the top levels almost
// none - which is right, they are already at the limit.
const AI_ATTACK_CORNER_CAP = 1.20;
const AI_ATTACK_BRAKE = 0.12;  // extra braking commitment at full attack
const AI_ATTACK_GAP = 0.45;    // fraction the safe gap shrinks by at full attack
// Cars collide at 22px of separation, so a "safe" gap below that is an
// instruction to crash. Impossible runs a 16px gap; shrinking it another 45%
// asked for 8.8px and produced better than one retirement per race.
const AI_MIN_GAP = 21;

function aiNormAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

class AI {
    constructor(car, difficulty, skillVariation = null) {
        this.car = car;
        this.difficulty = AI_PROFILES[difficulty] ? difficulty : 'medium';

        // Championship stores skillVariation in [0.8, 1.1]; map it to a mild
        // (+/- 3.5%) pace multiplier so drivers differ without blurring the
        // difficulty levels.
        const raw = (skillVariation === null || skillVariation === undefined || !isFinite(skillVariation))
            ? 0.8 + Math.random() * 0.3
            : skillVariation;
        this.skillVariation = Math.max(0.8, Math.min(1.1, raw));

        this.p = AI.buildProfile(car.driverName, this.difficulty, this.skillVariation);
        // car.js reads this for the rain grip bonus.
        this.car.wetGripBonus = this.p.wetSkill;

        // --- state -------------------------------------------------------
        this.nodeIdx = -1;
        this.searchTimer = 0;
        this.steerAngle = 0;        // low-passed heading error
        this.steerDir = 0;          // -1 left, 0 none, +1 right
        this.lateralOffset = 0;     // tactical offset on top of the racing line
        this.offsetTarget = 0;
        this.stuckTimer = 0;
        this.reverseTimer = 0;
        this.kTurnTimer = 0;
        this.errorTimer = 1 + Math.random() * 2;
        this.errorAngle = 0;
        this.followSpeed = Infinity;
        this.blueFlagLift = 1;
        this.followTimer = 0;       // how long we have been stuck behind someone
        this.attack = 0;            // 0..1 attack mode, built up by followTimer
        this.jamTimer = 0;
        this.startCaution = 0;
        this.breakoutTimer = 0;
        this.breakoutSide = 1;
        this.raceStarted = false;
        this.reactionTimer = 0;

        // Small permanent personal bias so cars don't stack on the same line.
        this.personalBias = (Math.random() - 0.5) * 12;
    }

    startRace() {
        const r = this.p.reaction;
        this.reactionTimer = r[0] + Math.random() * (r[1] - r[0]);
        this.car.reactionTime = this.reactionTimer;
        // Extra room for the run down to turn 1, where the whole grid arrives
        // together: without it the back of the field wipes itself out.
        this.startCaution = AI_START_CAUTION;
    }

    idle() {
        this.car.inputs = { up: false, down: false, left: false, right: false };
    }

    // -------------------------------------------------------------------
    //  Locate the car on the racing line (local search, with a full
    //  re-acquisition when the local one clearly lost the car).
    // -------------------------------------------------------------------
    locate(line) {
        const nodes = line.nodes;
        const N = line.count;
        const car = this.car;

        const scan = (from, count) => {
            let best = -1, bestD = Infinity;
            for (let o = 0; o < count; o++) {
                const i = (from + o + N * 4) % N;
                const d = (car.x - nodes[i].cx) ** 2 + (car.y - nodes[i].cy) ** 2;
                if (d < bestD) { bestD = d; best = i; }
            }
            return { idx: best, d2: bestD };
        };

        let res;
        if (this.nodeIdx < 0) {
            res = scan(0, N);
        } else {
            const window = Math.max(40, Math.round(220 / line.ds));
            res = scan(this.nodeIdx - 12, window);
            // Lost it (spun, punted, teleported after a false start): rescan.
            if (res.d2 > 200 * 200) res = scan(0, N);
        }
        this.nodeIdx = res.idx;
        return res.idx;
    }

    nodePos(line, i, extraOffset) {
        const n = line.nodes[i];
        let off = n.alpha * this.p.lineBlend + extraOffset;
        const lim = line.maxOffset;
        if (off > lim) off = lim;
        if (off < -lim) off = -lim;
        return { x: n.cx + off * n.nx, y: n.cy + off * n.ny };
    }

    update(track, dt) {
        const car = this.car;

        if (!dt || !isFinite(dt)) dt = 0.016;
        if (dt > 0.05) dt = 0.05;

        if (car.isBroken || car.finished) { this.idle(); return; }

        // --- reaction at the lights -------------------------------------
        if (!this.raceStarted) {
            this.idle();
            if (this.reactionTimer > 0) {
                this.reactionTimer -= dt;
                if (this.reactionTimer > 0) return;
                this.raceStarted = true;
            } else {
                return; // lights not out yet
            }
        }

        if (this.startCaution > 0) this.startCaution -= dt;

        const line = track.getRacingLine ? track.getRacingLine(this.p.lineLevel) : null;
        if (!line) { this.idle(); return; }

        this.idle();

        const nodes = line.nodes;
        const N = line.count;
        const ds = line.ds;

        const i = this.locate(line);
        const here = nodes[i];

        const speed = Math.hypot(car.velocity.x, car.velocity.y);
        const headX = Math.cos(car.angle);
        const headY = Math.sin(car.angle);
        const forwardSpeed = car.velocity.x * headX + car.velocity.y * headY;

        // Signed distance from the centre line (positive = normal side).
        const latCar = (car.x - here.cx) * here.nx + (car.y - here.cy) * here.ny;
        const halfWidth = track.trackWidth;
        // A kerb is cheap, grass is not: only the latter warrants panicking.
        const kerbW = track.kerbWidth !== undefined ? track.kerbWidth : 0;
        const offLine = Math.abs(latCar);
        const onKerb = offLine > halfWidth && offLine <= halfWidth + kerbW;
        const onGrass = offLine > halfWidth + kerbW;

        // ================================================================
        //  1. WRONG WAY  -  compare heading with the track tangent
        // ================================================================
        const tangentErr = aiNormAngle(here.heading - car.angle);
        if (Math.abs(tangentErr) > 2.0) this.kTurnTimer = 0.4;

        if (this.kTurnTimer > 0) {
            this.kTurnTimer -= dt;
            if (Math.abs(tangentErr) < 0.9) {
                this.kTurnTimer = 0;                    // realigned, carry on
            } else {
                if (forwardSpeed > 25) {
                    car.inputs.down = true;             // scrub off speed first
                    if (tangentErr > 0) car.inputs.right = true; else car.inputs.left = true;
                } else {
                    car.inputs.down = true;             // reverse
                    // reversing inverts the steering sign inside car.js
                    if (tangentErr > 0) car.inputs.left = true; else car.inputs.right = true;
                }
                this.stuckTimer = 0;
                return;
            }
        }

        // ================================================================
        //  2. STUCK RECOVERY  (jammed against a barrier)
        // ================================================================
        if (this.reverseTimer > 0) {
            this.reverseTimer -= dt;
            car.inputs.down = true;
            // Rotate the nose away from the wall we are stuck against.
            // d(nose . n)/d(angle) = right . n ; reversing, "left" increases angle.
            const rightDotN = (-headY) * here.nx + headX * here.ny;
            const wantPositiveDTheta = -(Math.sign(latCar || 1) * Math.sign(rightDotN || 1)) > 0;
            if (wantPositiveDTheta) car.inputs.left = true; else car.inputs.right = true;
            if (this.reverseTimer <= 0) this.stuckTimer = -0.6;
            return;
        }

        // ================================================================
        //  3. TARGET POINT ON THE RACING LINE
        // ================================================================
        let lookDist = this.p.lookBase + speed * this.p.lookSpeed;
        if (onGrass) lookDist = Math.min(lookDist, 55);       // short leash off-track
        lookDist = Math.max(24, Math.min(210, lookDist));

        const ahead = Math.max(1, Math.round(lookDist / ds));
        const aimIdx = (i + ahead) % N;

        // ---- traffic: decide the tactical lateral offset -----------------
        this.updateTraffic(track, line, i, speed, headX, headY, latCar, dt);

        const totalOffset = this.lateralOffset + this.personalBias;
        const aim = this.nodePos(line, aimIdx, totalOffset);

        let angleToAim = Math.atan2(aim.y - car.y, aim.x - car.x);

        // ---- occasional human error (easy / medium) ----------------------
        this.errorTimer -= dt;
        if (this.errorTimer <= 0) {
            if (Math.random() < this.p.errorChance) {
                this.errorAngle = (Math.random() - 0.5) * 2 * this.p.errorMag;
                this.errorTimer = 0.25 + Math.random() * 0.45;
            } else {
                this.errorAngle = 0;
                this.errorTimer = 0.8 + Math.random() * 1.6;
            }
        }
        angleToAim += this.errorAngle;

        // ================================================================
        //  4. STEERING  (pure pursuit + physically-sized deadband)
        // ================================================================
        const rawDiff = aiNormAngle(angleToAim - car.angle);
        const tau = this.p.steerTau;
        const blend = Math.min(1, dt / Math.max(0.01, tau));
        this.steerAngle += aiNormAngle(rawDiff - this.steerAngle) * blend;
        const diff = this.steerAngle;

        // Yaw rate the car can actually produce right now.
        const steerEff = Math.max(0.10, 1 - speed / 500);
        const steerRate = AI_MAX_STEER * steerEff;
        // Don't command a correction we would overshoot inside a single frame.
        const dead = Math.max(0.012, Math.min(0.22, steerRate * dt * 0.85));
        const release = dead * 0.45;   // hysteresis: kills the zig-zag

        if (this.steerDir === 0) {
            if (diff > dead) this.steerDir = 1;
            else if (diff < -dead) this.steerDir = -1;
        } else if (this.steerDir > 0) {
            if (diff < release) this.steerDir = (diff < -dead) ? -1 : 0;
        } else {
            if (diff > -release) this.steerDir = (diff > dead) ? 1 : 0;
        }

        if (speed < 8) {
            // Below 8 px/s car.js ignores the steering entirely - just go.
            this.steerDir = diff > 0.05 ? 1 : (diff < -0.05 ? -1 : 0);
        }

        if (this.steerDir > 0) car.inputs.right = true;
        else if (this.steerDir < 0) car.inputs.left = true;

        // ================================================================
        //  5. SPEED PROFILE  (corner limit + braking lookahead)
        // ================================================================
        // A damaged car has less grip and less power: the AI must know, or it
        // keeps driving to the pace of a healthy car and simply goes off.
        const condition = car.condition !== undefined ? car.condition : 1;

        let gripScale = condition;
        if (typeof isRaining !== 'undefined' && isRaining) {
            gripScale = 0.20 * (this.p.wetSkill || 1);   // matches car.js exactly
        }
        if (onGrass) gripScale *= 0.3;
        else if (onKerb) gripScale *= 0.80;
        const latLimit = AI_BASE_GRIP * gripScale * 0.85;

        // Attack mode: a driver trying to force a way past leaves the braking
        // later and commits harder than they would in clean air.
        const atk = this.attack * this.p.overtake * (this.p.attackGain !== undefined ? this.p.attackGain : 1);
        const aBrake = Math.max(80, (150 + 0.55 * speed) *
                                    this.p.brakeConfidence * (1 + AI_ATTACK_BRAKE * atk));

        // How far ahead do we need to look to stop in time?
        const needDist = 60 + (speed * speed) / (2 * aBrake);
        const scanNodes = Math.min(Math.floor(N / 2), Math.max(4, Math.ceil(needDist / ds)));

        // A better driver trusts the local radius; a weaker one only trusts the
        // worst radius in the neighbourhood and therefore slows for a corner
        // long before its apex.
        const opt = this.p.radiusOptimism;
        const radiusOf = (nd) => nd.radius + (nd.radiusRaw !== undefined ? (nd.radiusRaw - nd.radius) * opt : 0);

        // What the tyres are actually giving right now. car.js applies this to
        // the steering rate; the AI has to aim to the same limit or it will
        // keep entering corners at soft-tyre speed on a worn set of hards.
        const tyreF = car.tyrePerf || 1;

        const cornerCap = (idx) => {
            const nd = nodes[idx];
            const R = radiusOf(nd);
            // vCorner is tabulated for nd.radius; rescale it for the radius we
            // are actually willing to commit to (v scales ~ with R here).
            const steerRateNow = AI_MAX_STEER * tyreF;
            const vSteer = steerRateNow / (1 / R + steerRateNow / 500);
            const vGrip = Math.sqrt(latLimit * R);
            const cf = Math.min(this.p.cornerFactor * (1 + AI_ATTACK_CORNER * atk),
                                Math.max(this.p.cornerFactor, AI_ATTACK_CORNER_CAP));
            return Math.min(nd.vCorner * 1.35 * tyreF, vSteer, vGrip) * AI_CORNER_SAFETY * cf;
        };

        // Under the VSC everyone has the same reduced power, so the AI must
        // aim lower too rather than sitting at full throttle pointlessly.
        const vscF = (typeof vscPowerFactor !== 'undefined') ? vscPowerFactor : 1;
        let vTop = AI_TOP_SPEED * this.p.straightFactor * condition * vscF;
        if (car.draftStrength > 0) vTop *= 1 + 0.17 * car.draftStrength;
        if (onGrass) vTop = Math.min(vTop, 150);
        else if (onKerb) vTop *= 0.95;
        if (typeof isRaining !== 'undefined' && isRaining) vTop *= 0.97;

        // Clean-air specialists (Vettel, Prost, Lauda) find that extra tenth
        // when there is nobody to worry about in front.
        if (this.p.cleanAir !== 1 && this.followSpeed === Infinity) vTop *= this.p.cleanAir;

        let vTarget = Math.min(vTop, cornerCap(i));
        for (let o = 1; o <= scanNodes; o++) {
            const idx = (i + o) % N;
            const dist = o * ds;
            const allowed = Math.sqrt(cornerCap(idx) ** 2 + 2 * aBrake * dist);
            if (allowed < vTarget) vTarget = allowed;
        }

        // Slow down if we are running wide towards the kerbs.
        const edge = offLine / (halfWidth + kerbW * 0.5);
        if (edge > 0.90) vTarget *= Math.max(0.60, 1 - (edge - 0.90) * 1.2);

        // Car-following cap (set by updateTraffic).
        if (this.followSpeed < vTarget) vTarget = this.followSpeed;

        // Being lapped under blue flags: ease off so the pass is quick.
        vTarget *= this.blueFlagLift;

        // Opening laps: back off a touch while the field is still bunched.
        if (this.startCaution > 0) vTarget *= 1 - 0.09 * (this.startCaution / AI_START_CAUTION);

        // ---- throttle / brake with a dead band so it never flickers ------
        if (speed > vTarget * 1.07) {
            car.inputs.down = true;
        } else if (speed < vTarget * 0.97) {
            car.inputs.up = true;
        }
        // else: coast

        // Never let a car sit still (or start reversing) on the racing line:
        // below ~18 px/s "down" would engage reverse instead of the brakes.
        if (speed < 18) {
            car.inputs.down = false;
            car.inputs.up = true;
        }

        // ================================================================
        //  6. STUCK DETECTION
        // ================================================================
        if (car.inputs.up && speed < 22) {
            this.stuckTimer += dt;
            if (this.stuckTimer > 1.1) {
                this.reverseTimer = 0.75;
                this.stuckTimer = 0;
            }
        } else {
            this.stuckTimer = Math.max(-1, this.stuckTimer - dt * 1.5);
        }
    }

    // -------------------------------------------------------------------
    //  Traffic.
    //  Everything is resolved in the *track* frame (tangent / normal at the
    //  current node) rather than in the car frame: in a corner a car directly
    //  ahead on the road can sit well off to the side of our nose, and using
    //  the car frame made the old AI dive at it.
    //
    //  Two outputs:
    //    this.lateralOffset -> where to place the target point sideways
    //    this.followSpeed   -> car-following speed cap (prevents rear-ending)
    // -------------------------------------------------------------------
    updateTraffic(track, line, i, speed, headX, headY, latCar, dt) {
        this.followSpeed = Infinity;
        this.blueFlagLift = 1;

        const car = this.car;
        const lim = line.maxOffset;
        const here = line.nodes[i];
        // this.lateralOffset is measured relative to the racing line, so
        // absolute (centre-line) targets must be converted before use.
        const lineLat = here.alpha * this.p.lineBlend;

        let desired = 0;
        let hasTarget = false;
        let inContact = false;
        let attacker = null;        // quicker car sitting right on our tail
        let bestFwd = Infinity;     // distance to the nearest car in our path

        const caution = this.startCaution > 0 ? this.startCaution / AI_START_CAUTION : 0;
        // Held up for a while => close right up and have a go, but never ask
        // to sit closer than the cars are wide.
        const atkGap = this.attack * this.p.overtake *
                       (this.p.attackGain !== undefined ? this.p.attackGain : 1);
        const safeGap = Math.max(AI_MIN_GAP, (this.p.safeGap + 26 * caution) *
                        (1 - AI_ATTACK_GAP * atkGap));

        if (typeof cars !== 'undefined' && cars.length > 1) {
            const tx = here.tx, ty = here.ty;
            const nx = here.nx, ny = here.ny;

            for (const other of cars) {
                if (other === car || other.isBroken) continue;

                const dx = other.x - car.x;
                const dy = other.y - car.y;
                if (dx * dx + dy * dy > 170 * 170) continue;

                const fwd = dx * tx + dy * ty;      // down the road (+ = ahead)
                const side = dx * nx + dy * ny;      // across the road
                const otherLat = latCar + side;

                if (fwd > -4 && fwd < 140 && Math.abs(side) < 34) {
                    // ---- someone is in our path -------------------------
                    hasTarget = true;

                    if (fwd < bestFwd) {
                        bestFwd = fwd;

                        // Choose the side with the most room, and stick to a
                        // side once committed so we don't dither.
                        const roomRight = lim - Math.max(otherLat, latCar);
                        const roomLeft = lim + Math.min(otherLat, latCar);
                        let dir;
                        if (Math.abs(this.lateralOffset - (-lineLat)) > 10 && Math.abs(this.lateralOffset) > 6) {
                            dir = Math.sign(this.lateralOffset) || 1;
                        } else {
                            dir = roomRight >= roomLeft ? 1 : -1;
                        }
                        if (dir > 0 && roomRight < 20 && roomLeft > roomRight) dir = -1;
                        if (dir < 0 && roomLeft < 20 && roomRight > roomLeft) dir = 1;

                        const step = 26 + 16 * this.p.overtake;
                        desired = (otherLat + dir * step) - lineLat;

                        // ---- car following: never drive into their gearbox
                        if (fwd > -6 && Math.abs(side) < 30) {
                            const theirFwd = other.velocity.x * tx + other.velocity.y * ty;
                            const gap = fwd - safeGap;
                            let v = theirFwd + gap * this.p.gapGain;
                            if (v < 0) v = 0;

                            // How much of the car ahead is genuinely in our
                            // path. The cap exists to stop us rear-ending them,
                            // so it should fade out as we move off their line.
                            //
                            // This used to clamp us to THEIR speed the moment
                            // we were alongside, which meant an overtake could
                            // be started but never completed: the attacker drew
                            // level, matched pace, and dropped back into the
                            // queue. The field finished in grid order.
                            const clear = Math.abs(side);
                            if (clear >= AI_CLEAR_SIDE) {
                                // On a different line: free to outpace them.
                                // Bounded rather than uncapped - lifting the
                                // cap entirely let a car arrive alongside at
                                // any speed at all, and the moment it drifted
                                // back towards the line it was a big hit.
                                // Measured 1.0 retirements a race at impossible.
                                const free = Math.max(theirFwd, 55) * (1 + AI_ALONGSIDE_GAIN);
                                if (v < free) v = free;
                            } else if (clear > AI_OVERLAP_SIDE) {
                                const room = (clear - AI_OVERLAP_SIDE) /
                                             (AI_CLEAR_SIDE - AI_OVERLAP_SIDE);
                                const alongside = Math.max(theirFwd, 55) *
                                                  (1 + AI_ALONGSIDE_GAIN * room);
                                if (v < alongside) v = alongside;
                            }
                            // A tow is only worth having if you are allowed
                            // to spend it. Without this the AI simply lifted
                            // to hold its safe gap, so a stronger slipstream
                            // sped the whole train up equally and changed
                            // nothing: measured 0.65 places of movement per
                            // race either way.
                            v += (car.draftStrength || 0) * 45;
                            if (v < this.followSpeed) this.followSpeed = v;
                        }
                    }
                } else if (fwd < -8 && fwd > -85 && Math.abs(side) < 30 && other.lap >= car.lap) {
                    // Someone is on our tail on the same lap: candidate attacker.
                    const theirFwd = other.velocity.x * tx + other.velocity.y * ty;
                    const ourFwd = car.velocity.x * tx + car.velocity.y * ty;
                    if (theirFwd > ourFwd - 8) attacker = other;
                } else if (Math.abs(fwd) < 30 && Math.abs(side) < 36) {
                    // ---- wheel to wheel ---------------------------------
                    hasTarget = true;
                    const push = (36 - Math.abs(side));
                    const want = (latCar + (side > 0 ? -push : push)) - lineLat;
                    if (Math.abs(want) > Math.abs(desired)) desired = want;

                    if (dx * dx + dy * dy < 30 * 30) {
                        inContact = true;
                        // Break the symmetry: whoever is the trailing car
                        // concedes and tucks in behind. Without this, two cars
                        // locked side by side push each other along the barrier
                        // and grind themselves to destruction.
                        if (fwd > 2) {
                            const theirFwd = other.velocity.x * tx + other.velocity.y * ty;
                            // Less willing to back out than before - they will
                            // hold the position and risk the contact.
                            const concede = Math.max(60, theirFwd * 0.95);
                            if (concede < this.followSpeed) this.followSpeed = concede;
                        }
                    }
                }
            }
        }

        // ---- attack mode -----------------------------------------------
        // Sitting in someone's dirty air with nowhere to go builds frustration
        // into commitment: brake later, carry more through the corner, sit
        // closer. It decays quickly once the road is clear again, so this is a
        // burst used to force a move, not a permanent pace increase - the
        // difficulty ladder is unaffected in clean air.
        const heldUp = hasTarget && bestFwd > 0 && bestFwd < 95 && !this.car.blueFlag;
        // Sitting in a tow is what gives you the run, so it should bring the
        // move on sooner rather than being a reason to sit there.
        if (heldUp) this.followTimer += dt * (1 + 1.3 * (car.draftStrength || 0));
        else this.followTimer = Math.max(0, this.followTimer - dt * 2.5);
        this.attack = Math.max(0, Math.min(1, this.followTimer / AI_ATTACK_BUILD));

        // ---- deadlock breaker ------------------------------------------
        // Two cars can mutually cap each other's speed and crawl side by side,
        // grinding damage off one another. If we have been slow *and* speed
        // limited for a while, commit to one side and ignore the cap briefly.
        if (speed < 35 && this.followSpeed < 50) this.jamTimer += dt;
        else this.jamTimer = Math.max(0, this.jamTimer - dt * 2);

        if (this.jamTimer > 2.0) {
            this.jamTimer = 0;
            this.breakoutTimer = 1.2;
            this.breakoutSide = Math.random() < 0.5 ? -1 : 1;
        }
        if (this.breakoutTimer > 0) {
            this.breakoutTimer -= dt;
            if (this.followSpeed < 90) this.followSpeed = 90;
            desired = this.breakoutSide * lim;
            hasTarget = true;
        }

        // ---- defending: cover the line against a car right behind ---------
        // Schumacher / Verstappen / Alonso make themselves very hard to pass;
        // Prost and Lauda concede rather than risk the car. Never applied when
        // we are being lapped (that is what the blue flag is for), and the
        // movement is a single decisive cover, not weaving.
        if (this.p.defend > 0.05 && !this.car.blueFlag && !hasTarget && attacker) {
            const attLat = (attacker.x - here.cx) * here.nx + (attacker.y - here.cy) * here.ny;
            const cover = latCar + (attLat - latCar) * this.p.defend;
            desired = Math.max(-lim, Math.min(lim, cover)) - lineLat;
            hasTarget = true;
        }

        // ---- blue flag: we are being lapped, get out of the way ----------
        // main.js raises car.blueFlag when a car on a higher lap is closing.
        // We move to the edge of the track on the opposite side to the car
        // coming through, and lift slightly so the pass is quick and clean.
        this.blueFlagLift = 1;
        const lapper = this.car.blueFlag ? this.car.blueFlagFrom : null;
        if (lapper) {
            const lapperLat = (lapper.x - here.cx) * here.nx + (lapper.y - here.cy) * here.ny;
            let side;
            if (Math.abs(lapperLat - latCar) > 10) {
                side = lapperLat > latCar ? -1 : 1;      // he is on that side, go the other way
            } else {
                side = here.alpha >= 0 ? -1 : 1;         // dead behind: concede the racing line
            }
            desired = side * lim - lineLat;
            hasTarget = true;
            this.blueFlagLift = 0.88;
        }

        if (!hasTarget) desired = 0;

        // A recovery crane parked on the edge of the circuit is solid, so it
        // is worth steering round rather than into. It overrides everything
        // above: a car being lapped still has to miss the crane.
        const cranes = (typeof craneObstacles === 'function') ? craneObstacles() : [];
        if (cranes.length) {
            const line = track.getRacingLine(this.lineLevel || 'standard');
            const node = line.nodes[car._nodeIdx === undefined ? 0 : car._nodeIdx];
            if (node) {
                for (const cr of cranes) {
                    // how far ahead is it, and on which side of the line?
                    const dx = cr.x - car.x, dy = cr.y - car.y;
                    const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
                    const ahead = dx * hx + dy * hy;
                    if (ahead < -20 || ahead > 190) continue;
                    // lateral position of the crane relative to the racing line
                    const craneLat = (cr.x - node.cx) * node.nx + (cr.y - node.cy) * node.ny;
                    const meLat = this.lateralOffset + (this.personalBias || 0);
                    const clear = cr.r + 20;
                    if (Math.abs(craneLat - meLat) > clear) continue;
                    // go round whichever side there is more room on
                    const goLeft = craneLat > 0;
                    const want = goLeft ? craneLat - clear : craneLat + clear;
                    desired = Math.max(-lim, Math.min(lim, want));
                    hasTarget = true;
                }
            }
        }

        if (desired > lim) desired = lim;
        if (desired < -lim) desired = -lim;

        // Rate-limited lateral movement -> smooth, believable weaving
        // (faster when we are actually rubbing against someone).
        const rate = inContact ? 170 : (hasTarget ? 110 : 60);
        const delta = desired - this.lateralOffset;
        const maxStep = rate * dt;
        this.lateralOffset += Math.max(-maxStep, Math.min(maxStep, delta));
    }
}

// -----------------------------------------------------------------------------
//  Profile construction, shared by the live AI and by qualifying simulation.
// -----------------------------------------------------------------------------
AI.buildProfile = function (driverName, difficulty, skillVariation) {
    const base = AI_PROFILES[difficulty] ? AI_PROFILES[difficulty] : AI_PROFILES.medium;
    const p = Object.assign({}, base);

    const sv = Math.max(0.8, Math.min(1.1, isFinite(skillVariation) ? skillVariation : 0.95));
    const skillMul = 0.930 + (sv - 0.8) * 0.233;
    p.cornerFactor *= skillMul;
    p.straightFactor *= skillMul;

    p.wetSkill = 1;
    p.cleanAir = 1;

    const s = AI_DRIVER_STYLES[driverName];
    if (s) {
        // trim is the fitted whole-lap pace handle that keeps the field level
        const trim = s.trim === undefined ? 1 : s.trim;
        p.cornerFactor *= s.corner * trim;
        p.straightFactor *= s.straight * trim;
        p.brakeConfidence *= s.brake;
        p.steerTau *= s.steerTau;
        p.errorChance *= s.err;
        p.overtake *= s.overtake;
        p.safeGap *= s.gap;
        p.defend *= s.defend;
        p.wetSkill = s.wet;
        p.cleanAir = s.cleanAir;
        if (driverName === 'Lewis Hamilton') p.lookBase += 14;   // reads the track furthest ahead
    }

    // Hard ceiling: a personality colours how a driver is quick, it never lets
    // one escape the physics of the car.
    p.cornerFactor = Math.min(p.cornerFactor, p.maxCorner);
    p.overtake = Math.min(p.overtake, 1);
    p.defend = Math.min(p.defend, 1);
    return p;
};

// Notional single flying lap, lower is quicker. Used to set the grid instead
// of shuffling it at random, so the front row means something.
// ---------------------------------------------------------------------------
//  TYRE CHOICE
//  A driver picks rubber the way they drive. The aggressive, error-prone,
//  wheel-to-wheel types take the soft and accept the cliff; the smooth,
//  calculating ones take something that will still be there at the end. Race
//  length pushes the whole field one way: nobody starts a long race on softs.
//
//  Deliberately noisy. A deterministic rule put the same nine drivers on the
//  same compound every single time, which is exactly the "everyone makes the
//  same choice" outcome this is meant to avoid.
// ---------------------------------------------------------------------------
AI.chooseTyre = function (driverName, laps, raining) {
    const s = AI_DRIVER_STYLES[driverName];

    // 0 = wants the hard, 1 = wants the soft
    let want = 0.5;
    if (s) {
        want += (s.err - 0.7) * 0.16;          // lives on the edge -> soft
        want += (1 - s.gap) * 0.55;            // sits close, wants track position
        want += (s.overtake - 0.85) * 0.45;    // fights -> wants the early edge
        want -= (s.steerTau - 1.0) * 0.30;     // smooth hands -> kinder on tyres
        want -= (s.cleanAir - 1.0) * 6.0;      // clean-air specialists play the long game
    }
    // A long race eats a soft alive; a short one barely troubles it.
    want += (5 - laps) * 0.055;
    // In the wet the cliff matters less: nobody is near the limit anyway.
    if (raining) want += 0.10;

    want += (Math.random() - 0.5) * 0.42;      // genuine spread, race to race

    if (want > 0.62) return 'soft';
    if (want < 0.38) return 'hard';
    return 'medium';
};

AI.qualifyingPace = function (driverName, difficulty, skillVariation, raining) {
    const p = AI.buildProfile(driverName, difficulty, skillVariation);

    // Roughly 60% of a lap is spent cornering, 40% flat out.
    let pace = 0.60 / p.cornerFactor + 0.40 / p.straightFactor;
    pace /= Math.sqrt(p.cleanAir);               // qualifying is always clean air
    if (raining) pace /= Math.sqrt(p.wetSkill);  // grip enters the corner speed as a square root

    // A single flying lap has real variance, and more of it for drivers who
    // live closer to the edge. Without enough spread the same driver takes
    // pole every single time and qualifying stops being interesting.
    const spread = 0.055 + p.errorChance * 0.25;
    return pace * (1 + (Math.random() - 0.5) * spread);
};
