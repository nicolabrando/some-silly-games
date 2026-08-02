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
        lookBase: 58,
        lookSpeed: 0.26,
        steerTau: 0.11,         // steering low-pass (s)
        reaction: [0.45, 0.90],
        errorChance: 0.30,
        errorMag: 0.20,
        overtake: 0.30,         // willingness to move off-line to pass
        safeGap: 46,            // px kept from the car ahead
        gapGain: 1.1            // how hard the gap is closed
    },
    medium: {
        cornerFactor: 0.87,
        straightFactor: 0.90,
        brakeConfidence: 0.78,
        lineBlend: 0.75,
        lookBase: 46,
        lookSpeed: 0.21,
        steerTau: 0.07,
        reaction: [0.25, 0.50],
        errorChance: 0.10,
        errorMag: 0.11,
        overtake: 0.65,
        safeGap: 34,
        gapGain: 1.5
    },
    hard: {
        cornerFactor: 1.0,
        straightFactor: 1.0,
        brakeConfidence: 0.95,
        lineBlend: 1.0,
        lookBase: 38,
        lookSpeed: 0.17,
        steerTau: 0.04,
        reaction: [0.13, 0.24],
        errorChance: 0.02,
        errorMag: 0.05,
        overtake: 1.0,
        safeGap: 26,
        gapGain: 1.9
    }
};

// Physics constants mirrored from car.js - keep in sync if the car changes.
const AI_MAX_STEER = Math.PI * 0.7;
const AI_TOP_SPEED = 355;      // enginePower / baseFriction
const AI_BASE_GRIP = 1200;
const AI_CORNER_SAFETY = 0.90; // never ask for more than 90% of the theoretical limit
const AI_START_CAUTION = 4.5;  // seconds of extra caution after the lights

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
        const skillMul = 0.930 + (this.skillVariation - 0.8) * 0.233;

        // Copy the difficulty profile so per-driver tweaks stay local.
        this.p = Object.assign({}, AI_PROFILES[this.difficulty]);
        this.p.cornerFactor *= skillMul;
        this.p.straightFactor *= skillMul;

        this.applyDriverStyle();

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
        this.jamTimer = 0;
        this.startCaution = 0;
        this.breakoutTimer = 0;
        this.breakoutSide = 1;
        this.raceStarted = false;
        this.reactionTimer = 0;

        // Small permanent personal bias so cars don't stack on the same line.
        this.personalBias = (Math.random() - 0.5) * 12;
    }

    applyDriverStyle() {
        const p = this.p;
        switch (this.car.driverName) {
            case 'Max Verstappen':
                p.brakeConfidence *= 1.10; p.cornerFactor *= 1.030; p.overtake = 1.0; p.errorChance *= 0.7; break;
            case 'Ayrton Senna':
                p.cornerFactor *= 1.025; p.steerTau *= 0.85; p.overtake = Math.max(p.overtake, 0.9); break;
            case 'Michael Schumacher':
                p.cornerFactor *= 1.020; p.brakeConfidence *= 1.06; p.errorChance *= 0.6; break;
            case 'Alain Prost':
                p.errorChance *= 0.35; p.steerTau *= 1.25; p.brakeConfidence *= 0.95; p.straightFactor *= 1.01; break;
            case 'Lewis Hamilton':
                p.cornerFactor *= 1.015; p.lookBase += 12; p.errorChance *= 0.7; break;
            case 'Fernando Alonso':
                p.overtake = 1.0; p.brakeConfidence *= 1.05; break;
            case 'Sebastian Vettel':
                p.straightFactor *= 1.015; p.steerTau *= 0.9; break;
            case 'Niki Lauda':
                p.errorChance *= 0.4; p.brakeConfidence *= 0.98; break;
            case 'Jim Clark':
                p.steerTau *= 0.85; p.cornerFactor *= 1.015; break;
            case 'Juan Manuel Fangio':
                p.errorChance *= 0.5; p.cornerFactor *= 1.010; break;
        }
        // Clamp so no personality can push a driver past the physical limit.
        p.cornerFactor = Math.min(p.cornerFactor, 1.06);
        p.brakeConfidence = Math.min(p.brakeConfidence, 1.0);
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

        const line = track.getRacingLine ? track.getRacingLine() : null;
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
        const onGrass = Math.abs(latCar) > halfWidth;

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
        let gripScale = 1;
        if (typeof isRaining !== 'undefined' && isRaining) {
            gripScale = 0.35;
            if (car.driverName === 'Ayrton Senna') gripScale *= 1.4;
        }
        if (onGrass) gripScale *= 0.3;
        const latLimit = AI_BASE_GRIP * gripScale * 0.85;

        const aBrake = Math.max(80, (150 + 0.55 * speed) * this.p.brakeConfidence);

        // How far ahead do we need to look to stop in time?
        const needDist = 60 + (speed * speed) / (2 * aBrake);
        const scanNodes = Math.min(Math.floor(N / 2), Math.max(4, Math.ceil(needDist / ds)));

        const cornerCap = (idx) => {
            const nd = nodes[idx];
            const vSteer = nd.vCorner;
            const vGrip = Math.sqrt(latLimit * nd.radius);
            return Math.min(vSteer, vGrip) * AI_CORNER_SAFETY * this.p.cornerFactor;
        };

        let vTop = AI_TOP_SPEED * this.p.straightFactor;
        if (car.isDrafting) vTop *= 1.10;
        if (onGrass) vTop = Math.min(vTop, 150);
        if (typeof isRaining !== 'undefined' && isRaining) vTop *= 0.97;

        let vTarget = Math.min(vTop, cornerCap(i));
        for (let o = 1; o <= scanNodes; o++) {
            const idx = (i + o) % N;
            const dist = o * ds;
            const allowed = Math.sqrt(cornerCap(idx) ** 2 + 2 * aBrake * dist);
            if (allowed < vTarget) vTarget = allowed;
        }

        // Slow down if we are running wide towards the kerbs.
        const edge = Math.abs(latCar) / halfWidth;
        if (edge > 0.85) vTarget *= Math.max(0.55, 1 - (edge - 0.85) * 1.2);

        // Car-following cap (set by updateTraffic).
        if (this.followSpeed < vTarget) vTarget = this.followSpeed;

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

        const car = this.car;
        const lim = line.maxOffset;
        const here = line.nodes[i];
        // this.lateralOffset is measured relative to the racing line, so
        // absolute (centre-line) targets must be converted before use.
        const lineLat = here.alpha * this.p.lineBlend;

        let desired = 0;
        let hasTarget = false;
        let inContact = false;

        const caution = this.startCaution > 0 ? this.startCaution / AI_START_CAUTION : 0;
        const safeGap = this.p.safeGap + 26 * caution;

        if (typeof cars !== 'undefined' && cars.length > 1) {
            const tx = here.tx, ty = here.ty;
            const nx = here.nx, ny = here.ny;

            let bestFwd = Infinity;

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

                            // Laterally offset => we are (or can get) alongside
                            // rather than behind. Asking for less than their
                            // speed here is what let two AIs throttle each
                            // other down to a crawl and grind side by side.
                            if (Math.abs(side) > 18) {
                                const alongside = Math.max(theirFwd, 55);
                                if (v < alongside) v = alongside;
                            }
                            if (v < this.followSpeed) this.followSpeed = v;
                        }
                    }
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
                            const concede = Math.max(45, theirFwd * 0.88);
                            if (concede < this.followSpeed) this.followSpeed = concede;
                        }
                    }
                }
            }
        }

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

        if (!hasTarget) desired = 0;
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
