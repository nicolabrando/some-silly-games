let __carUid = 0;

// =========================================================================
//  TYRE COMPOUNDS
// -------------------------------------------------------------------------
//  `grip` is the fresh multiplier, `falloff` how much of it is lost by the
//  time the tyre is finished, and `life` is the fraction of the RACE the
//  compound survives.
//
//  life is a fraction of the race rather than a number of laps, so a set
//  lasts proportionally longer the longer the race: a soft is spent after
//  ~4.5 laps of a 5-lap race and ~9 laps of a 10-lap one.
//
//  That has a consequence worth stating, because it decides how these numbers
//  were chosen. If life is a fraction of the distance then the shape of every
//  stint is identical at every race length - so race length CANNOT be what
//  makes one compound better than another, and tuning for "softs win short
//  races" is impossible by construction.
//
//  So they are tuned the other way: the three have the same MEAN pace across
//  a race to within 0.001%, and completely different shapes. Soft starts 10.3%
//  quicker than hard and finishes 16.6% slower - over its stint it throws away
//  a quarter of its performance, while the hard loses half a percent. The
//  first version of these numbers was half as dramatic and the difference was
//  not noticeable from the driving seat. Nothing is a free win; what
//  you are choosing is WHEN you want your performance. What then breaks the
//  tie is situational - track position, how much you slide the car (wear
//  accrues faster under load), a corner-heavy circuit, and the places-gained
//  bonus that pays for early aggression.
//
//  The multiplier is applied to the STEERING RATE, not just to grip. In this
//  car model the binding limit almost everywhere is how fast the car can
//  change direction, not how much lateral load it can hold - so a compound
//  that only touched `grip` would have been nearly invisible, the same trap
//  the rain fell into.
// =========================================================================
const TYRES = {
    soft:   { key: 'soft',   label: 'Soft',   short: 'S', colour: '#e53935',
              grip: 1.090, falloff: 0.2285, life: 0.90 },
    medium: { key: 'medium', label: 'Medium', short: 'M', colour: '#fdd835',
              grip: 1.000, falloff: 0.0696, life: 1.50 },
    hard:   { key: 'hard',   label: 'Hard',   short: 'H', colour: '#e0e0e0',
              grip: 0.988, falloff: 0.0240, life: 2.60 }
};
const TYRE_KEYS = ['soft', 'medium', 'hard'];

// --- Player damage handicap ---------------------------------------------
// Applied to the player's car only. Two handles: a straight scale on every
// hit, and extra impact speed that costs nothing at all, so light scrapes
// while learning a corner are genuinely free rather than merely cheap.
const PLAYER_DAMAGE_SCALE = 0.45;
const PLAYER_FREE_IMPACT = 28;      // px/s of closing speed added to the free band

class Car {
    constructor(x, y, color, isPlayer = false) {
        this.uid = ++__carUid;
        this.x = x;
        this.y = y;
        this.color = color;
        this.isPlayer = isPlayer;
        
        this.width = 24;
        this.height = 14;
        
        this.angle = 0;
        this.velocity = { x: 0, y: 0 };
        
        this.maxHealth = 100;
        this.health = 100;
        this.isBroken = false;
        
        // Physics constants (Drift physics)
        this.enginePower = 300;
        this.brakingPower = 150; // Reduced for less abrupt braking
        this.maxSteer = Math.PI * 0.7; // Very smooth steering
        this.baseGrip = 1200; // Lower grip to allow sliding
        this.baseFriction = 0.85; // Drag
        
        this.inputs = {
            up: false,
            down: false,
            left: false,
            right: false
        };
        
        // Race logic
        this.lap = 0;
        this.nextWaypoint = 1;
        this.waypointProgress = 0; // Absolute waypoint counter for accurate rankings
        this.finished = false;
        this.halfwayMarkerCrossed = false;
        
        this.raceTime = null;
        this.lapStartTime = 0;
        this.lastLapTime = null;
        this.bestLapTime = null;
        this.reactionTime = null;
        this.inputRecorded = false;
        
        // Effects & Slipstream
        this.isDrafting = false;

        // Damage state: lastHitAt keys the per-pair cooldown by car uid,
        // condition scales grip and power as the car gets battered.
        this.lastHitAt = {};
        this.condition = 1;

        // Handling state (see update): how much of the available lateral grip
        // the current corner is using, and how far the rear is stepping out.
        this.gripUse = 0;
        this.powerOversteer = 0;

        // Distance covered round the circuit, in track pixels, measured from
        // the start line, and its value at the last crossing. Directly
        // comparable between any two cars anywhere on the lap.
        this.trackProgress = 0;
        this.lapStartProgress = 0;
        this.lapS = 0;              // position round the current lap, 0 at the line
        this._lastS = undefined;
        this._lastDist = undefined;
        this._lapAnchored = undefined;
        this._nodeIdx = undefined;

        // Slipstream strength, 0..1 (set by main.js)
        this.draftStrength = 0;

        // --- Tyres -----------------------------------------------------
        // wear runs 0 (fresh) -> 1 (finished) over compound.life * TOTAL_LAPS
        // laps. tyrePerf is the resulting handling multiplier, recomputed each
        // frame and read by ai.js so the AI's speed profile matches the rubber
        // it is actually on.
        this.tyre = TYRES.medium;
        this.tyreWear = 0;
        this.tyrePerf = 1;

        // Blue flag (set each frame by main.js when a car on a higher lap closes in)
        this.blueFlag = false;
        this.blueFlagTimer = 0;
        this.blueFlagFrom = null;
    }
    
    update(dt, track) {
        // Being craned away, or already parked outside the barriers: the
        // wreck is scenery now, not a car.
        if (this.recovering || this.recovered) {
            this.velocity.x = 0;
            this.velocity.y = 0;
            return;
        }

        const surface = track.getSurface(this.x, this.y);

        // --- Condition -------------------------------------------------
        // A battered car is a slower car. Above 60% health nothing changes;
        // below that grip and power fade away linearly, down to 70% at the
        // point of destruction. Without this the health bar meant nothing
        // until the instant the car exploded.
        const hpFrac = this.maxHealth > 0 ? Math.max(0, this.health / this.maxHealth) : 1;
        this.condition = hpFrac >= 0.6 ? 1 : 0.70 + 0.30 * (hpFrac / 0.6);

        const speedForKerb = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);

        // --- Tyres -----------------------------------------------------
        // Wear accrues with distance covered, and faster when the car is
        // leaning on the tyre: a driver who slides it about destroys a set
        // sooner than one who is smooth, without any per-driver special case.
        // Explicit, because TOTAL_LAPS is 9999 during a session: a qualifying
        // set has to be scaled to the qualifying distance or a soft would be
        // finished before the flying lap even starts.
        const laps = this._tyreRaceLaps || 5;
        const tyre = this.tyre || TYRES.medium;
        if (!this.finished && !this.isBroken && this._lapPixels) {
            const moved = Math.hypot(this.velocity.x, this.velocity.y) * dt;
            const lapFrac = moved / this._lapPixels;                 // laps covered this frame
            const abuse = 1 + 0.55 * (this.gripUse || 0);
            this.tyreWear += lapFrac * abuse / Math.max(0.05, tyre.life * laps);
        }
        const w = Math.max(0, Math.min(1.25, this.tyreWear));
        // ^1.6: the first half of a set costs almost nothing, the last of it
        // falls away quickly - the cliff is what makes the choice interesting.
        this.tyrePerf = tyre.grip - tyre.falloff * Math.pow(w, 1.6);

        // Adjust physics based on surface
        let currentGrip = this.baseGrip * this.condition * this.tyrePerf;
        let currentFriction = this.baseFriction;

        // Rain effect on asphalt
        if (typeof isRaining !== 'undefined' && isRaining && surface !== 'grass') {
            // In this car model the *steering rate* is the binding limit
            // almost everywhere, so the wet grip clamp only bites well below
            // the value you would expect. 0.13 rather than 0.20: rain now
            // costs real lap time instead of a few km/h of top speed.
            currentGrip *= 0.13;
            // Wet-weather skill, from the driver style table in ai.js.
            if (this.wetGripBonus) currentGrip *= this.wetGripBonus;
        }

        // --- Puddles ---------------------------------------------------
        // Standing water: grip collapses and the car is dragged back. Only
        // ever present in the wet.
        this.inPuddle = false;
        this.aquaplane = 0;
        if (typeof isRaining !== 'undefined' && isRaining && surface !== 'grass' &&
            typeof track.puddleAt === 'function' && track.puddleAt(this.x, this.y)) {
            this.inPuddle = true;
            // Aquaplaning: the tyres are riding on water, so the front has
            // almost nothing to steer with. It builds with speed - crawl
            // through and you keep some control, arrive at racing speed and
            // you are a passenger until you are through the other side.
            this.aquaplane = Math.max(0, Math.min(1, (speedForKerb - 55) / 150));
            currentGrip *= 0.45 - 0.25 * this.aquaplane;
            currentFriction *= 2.2;
            if (speedForKerb > 90 && Math.random() < 0.5) {
                const spray = (Math.random() - 0.5) * 16 * (speedForKerb / 300);
                this.velocity.x += -Math.sin(this.angle) * spray;
                this.velocity.y += Math.cos(this.angle) * spray;
            }
        }

        if (surface === 'grass') {
            currentGrip *= 0.3; // Slippery!
            currentFriction *= 2.5; // Slows you down!
        } else if (surface === 'kerb') {
            // A kerb is meant to be usable. You lose a bit of grip and scrub a
            // little speed, and the car is unsettled by the rumble strips - but
            // running two wheels over one is a normal part of a fast lap, not
            // the disaster that dropping onto grass is.
            currentGrip *= 0.80;
            currentFriction *= 1.30;
            if (speedForKerb > 60) {
                // rumble: a small, rapid lateral disturbance
                const jolt = (Math.random() - 0.5) * 26 * (speedForKerb / 300);
                this.velocity.x += -Math.sin(this.angle) * jolt;
                this.velocity.y += Math.cos(this.angle) * jolt;
            }
        }
        
        if (this.finished || this.isBroken) {
            // Suspend commands, let it coast by inertia
            this.inputs.up = false;
            this.inputs.down = false;
            this.inputs.left = false;
            this.inputs.right = false;
        }
        
        // --- Longitudinal forces (Engine, Brakes) ---
        let forwardForce = 0;
        
        // Virtual Safety Car: everyone runs on reduced power while a wreck is
        // being recovered (global set by main.js).
        const vsc = (typeof vscPowerFactor !== 'undefined') ? vscPowerFactor : 1;

        if (this.inputs.up) {
            forwardForce += this.enginePower * this.condition * vsc;
            // Slipstream: continuous with distance rather than an on/off cone,
            // so the tow builds as you close in instead of snapping on.
            if (this.draftStrength > 0) {
                forwardForce += this.enginePower * 0.26 * this.draftStrength * vsc;
            }
        }
        if (this.inputs.down) {
            forwardForce -= this.brakingPower;
        }
        
        // --- Steering ---
        const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
        
        const steerInput = (this.inputs.right ? 1 : 0) - (this.inputs.left ? 1 : 0);

        // Only steer if moving
        if (speed > 10) {
            // Two separate reasons the car will not rotate as much as you ask:
            //
            //  1. speed  - the classic arcade term, the faster you go the less
            //              the front does;
            //  2. grip   - genuine front washout. If the corner is already
            //              asking for more lateral grip than the tyres can
            //              give (this.gripUse, measured last frame), turning
            //              the wheel further just makes it worse. This is what
            //              turns "too fast into a corner" into running wide
            //              rather than into a magic change of direction.
            const speedTerm = Math.max(0.10, 1 - (speed / 500));
            const understeer = 1 - 0.35 * (this.gripUse || 0);
            // The compound acts here, on how fast the car can change
            // direction. This is the binding limit in this model, so it is
            // the only place a tyre can make a difference you can feel.
            // Aquaplaning kills the steering almost entirely: at speed only a
            // tenth of the input reaches the road, so the car carries straight
            // on through the water whatever you ask of it.
            const aqua = 1 - 0.90 * (this.aquaplane || 0);
            const steerEffectiveness = speedTerm * understeer * (this.tyrePerf || 1) * aqua;
            const steerAmount = this.maxSteer * dt * steerEffectiveness;

            // Allow reversing steer direction if going backwards
            const dir = (this.velocity.x * Math.cos(this.angle) + this.velocity.y * Math.sin(this.angle) >= 0) ? 1 : -1;

            if (this.inputs.left) this.angle -= steerAmount * dir;
            if (this.inputs.right) this.angle += steerAmount * dir;
        }

        // --- Power oversteer -------------------------------------------
        // Engine torque is constant, but the speed at which the rear tyres can
        // turn it into forward motion is not: at low speed the demand on them
        // is far higher, and if you are also asking them to hold the car in a
        // corner the tail steps out. Slippery surfaces make it far easier.
        let powerOversteer = 0;
        if (this.inputs.up && steerInput !== 0 && speed > 12 && !this.finished && !this.isBroken) {
            const demand = (this.enginePower * this.condition) / Math.max(70, speed);
            const slipperiness = Math.max(1, Math.min(2.4, this.baseGrip / Math.max(1, currentGrip)));
            powerOversteer = Math.max(0, Math.min(1, ((demand - 1.45) / 2.2) * slipperiness));
        }
        this.powerOversteer = powerOversteer;

        if (powerOversteer > 0) {
            // The rotation you did not ask for. This is the oversteer proper:
            // the car turns *more* than the steering input commands.
            //
            // The boost term makes it a deliberate tool rather than just a
            // hazard: below ~160 px/s, throttle plus lock will pivot the car
            // round far faster than the steering alone ever could, which is
            // how you get a slow hairpin or a spin turn done.
            const lowSpeed = Math.max(0, Math.min(1, 1 - speed / 160));
            const yawGain = 1.15 + 1.75 * lowSpeed;
            this.angle += steerInput * powerOversteer * yawGain * dt;
        }

        // Direction vectors
        const headingX = Math.cos(this.angle);
        const headingY = Math.sin(this.angle);
        const rightX = Math.cos(this.angle + Math.PI / 2);
        const rightY = Math.sin(this.angle + Math.PI / 2);

        // Apply engine force to velocity
        this.velocity.x += headingX * forwardForce * dt;
        this.velocity.y += headingY * forwardForce * dt;

        // --- Lateral forces (Cornering / Drifting) ---
        const lateralSpeed = this.velocity.x * rightX + this.velocity.y * rightY;

        // Alignment stiffness: how hard the tyres fight the slide. A rear axle
        // busy putting power down fights it less, so the slide keeps building
        // instead of being caught immediately.
        // A rear axle busy putting power down fights the slide less, so the
        // rotation keeps building instead of being caught immediately. The
        // effect is stronger at low speed, where the pivot is the point.
        const slideRelease = 0.45 + 0.20 * Math.max(0, Math.min(1, 1 - speed / 160));
        const alignStiffness = 3.5 * (1 - slideRelease * powerOversteer);
        let lateralForce = -lateralSpeed * alignStiffness;

        // How much of the available grip this corner is asking for. Used next
        // frame for the understeer term above, and it is the reason a car can
        // be made to push wide by simply carrying too much speed in.
        this.gripUse = Math.min(1, Math.abs(lateralSpeed) * 3.5 / Math.max(1, currentGrip));

        // Clamp to grip limit
        if (lateralForce > currentGrip) lateralForce = currentGrip;
        if (lateralForce < -currentGrip) lateralForce = -currentGrip;

        // Apply lateral force
        this.velocity.x += rightX * lateralForce * dt;
        this.velocity.y += rightY * lateralForce * dt;
        
        // Apply friction/drag
        let drag = currentFriction;
        if (this.draftStrength > 0) drag *= (1 - 0.30 * this.draftStrength);
        
        this.velocity.x -= this.velocity.x * drag * dt;
        this.velocity.y -= this.velocity.y * drag * dt;
        
        // --- Emit Effects (Skid Marks & Particles) ---
        // Emit skidmarks if lateral sliding is high
        if (typeof globalSkidMarks !== 'undefined' && Math.abs(lateralSpeed) > 60 && !this.isBroken) {
            // Ring buffer: the array used to grow without bound. Fine for a
            // 5-lap race with 4 cars, not for 10 laps with 12.
            if (globalSkidMarks.length >= 4000) globalSkidMarks.shift();
            // Drop a skidmark
            globalSkidMarks.push({
                x: this.x,
                y: this.y,
                angle: this.angle,
                width: this.width,
                opacity: 0.5,
                time: Date.now()
            });
        }
        
        // Emit particles
        if (typeof globalParticles !== 'undefined' && speed > 50 && !this.isBroken) {
            // Mud/grass particles
            if (surface === 'grass' && Math.random() < 0.3) {
                globalParticles.push({
                    x: this.x - headingX * 10,
                    y: this.y - headingY * 10,
                    vx: -headingX * 20 + (Math.random()-0.5)*20,
                    vy: -headingY * 20 + (Math.random()-0.5)*20,
                    life: 1.0,
                    type: 'mud'
                });
            }
            // Rain spray particles (check if it's raining via global var)
            if (typeof isRaining !== 'undefined' && isRaining && surface !== 'grass' && Math.random() < 0.4) {
                globalParticles.push({
                    x: this.x - headingX * 12,
                    y: this.y - headingY * 12,
                    vx: -headingX * 10 + (Math.random()-0.5)*15,
                    vy: -headingY * 10 + (Math.random()-0.5)*15,
                    life: 0.6,
                    type: 'spray'
                });
            }
        }
        
        const previousX = this.x;
        const prevY = this.y;

        // Update position
        this.x += this.velocity.x * dt;
        this.y += this.velocity.y * dt;

        
        // Enforce robust barrier collision
        track.checkBarrierCollision(this);
        
        // Update race progress
        this.checkWaypoints(track);
        
        // --- Progress round the circuit -------------------------------
        this.updateTrackProgress(track);
        
        // Exact finish line crossing.
        // Once the car is classified it must stop scoring laps: while it coasts
        // to a halt it can drift back over the line and gain a phantom lap,
        // which would push it up the final standings.
        if (!this.finished && !this.isBroken && track.checkLapCross(previousX, this.y, this.x, this.y)) {
            if (this.halfwayMarkerCrossed) {
                this.lap++;
                this.halfwayMarkerCrossed = false;
                this.lapStartProgress = this.trackProgress;
                
                // Calculate lap time
                if (typeof track.currentRaceTime !== 'undefined' && this.lap > 1) {
                    const currentLapTime = track.currentRaceTime - this.lapStartTime;
                    this.lastLapTime = currentLapTime;
                    if (this.bestLapTime === null || currentLapTime < this.bestLapTime) {
                        this.bestLapTime = currentLapTime;
                    }
                }
                this.lapStartTime = typeof track.currentRaceTime !== 'undefined' ? track.currentRaceTime : 0;
            }

            // Taking the flag is a separate question from scoring a lap.
            // Once the leader has finished, your race ends the next time you
            // cross the line - whether or not that crossing completed a lap.
            // (Tying the two together made a car that had just passed the line
            // when the leader finished drive most of another lap before being
            // classified.)
            if (!this.finished && (this.lap >= TOTAL_LAPS || track.leaderFinished)) {
                this.finished = true;
                this.raceTime = track.currentRaceTime; // passed via track object for convenience
                if (this.jumpStartPenalty) {
                    // 5s per offence, not a flat 5s however many times you jumped
                    this.raceTime += 5000 * (this.jumpStartPenalties || 1);
                }
            }
        }
    }
    
    // Distance covered round the circuit, in track pixels, measured from the
    // START LINE - the same datum for every car, so two cars level on track
    // read the same number wherever they started from.
    //
    // Four earlier attempts were wrong, each for its own reason:
    //   1. a hardcoded "x > 650" half-distance marker - geometry-specific;
    //   2. distance *travelled* - inflated by every spin and reverse, so a car
    //      could bank a lap it had never completed;
    //   3. arc length at car.nextWaypoint - checkWaypoints advances that on a
    //      200px radius, which on a hairpin jumps to the far side of the corner
    //      and on the straight clears the finish line before the car does. Both
    //      made cars look a lap apart when they were side by side, which is
    //      what produced blue flags out of nowhere;
    //   4. forward-only accumulation from wherever the car happened to start.
    //      That reads zero at each car's own grid slot, and the slots are 30px
    //      apart, so the car starting last carried a permanent ~270px credit -
    //      a sixth of a lap on the Oval. Level on track, it was scored a
    //      quarter of a second up the road, and once it went a lap down that
    //      credit was enough to float it back above cars on the lead lap. It
    //      then appeared in the timing tower wherever it physically was rather
    //      than at the bottom where a lapped car belongs.
    //
    // So: arc length from the start line, unwrapped across it. Two cars level
    // on track now read the same number whatever grid slot they came from, and
    // a car a lap down reads exactly one lap length behind.
    updateTrackProgress(track) {
        if (typeof track.getRacingLine !== 'function') return;
        const line = track.getRacingLine('standard');
        const nodes = line.nodes;
        const N = line.count;
        const total = line.length;

        const d2 = (i) => (this.x - nodes[i].cx) ** 2 + (this.y - nodes[i].cy) ** 2;

        let best = 0;
        let bd = Infinity;
        if (this._nodeIdx === undefined) {
            for (let i = 0; i < N; i++) { const d = d2(i); if (d < bd) { bd = d; best = i; } }
        } else {
            for (let o = -14; o <= 34; o++) {
                const i = (this._nodeIdx + o + N * 2) % N;
                const d = d2(i);
                if (d < bd) { bd = d; best = i; }
            }
            if (bd > 220 * 220) {          // lost it (spun, punted, teleported)
                bd = Infinity;
                for (let i = 0; i < N; i++) { const d = d2(i); if (d < bd) { bd = d; best = i; } }
            }
        }
        this._nodeIdx = best;

        // Where we are round the lap, 0 at the start line. Same origin for
        // every car, which is the whole point.
        const sStart = line.sStart || 0;
        this.lapS = (((nodes[best].s - sStart) % total) + total) % total;

        // Unwrap it across the line into a continuous distance. A car cannot
        // cover half a lap in one frame, so the nearest continuation of last
        // frame's reading is the true one.
        let d = this.lapS;
        if (this._lastDist !== undefined) {
            d += Math.round((this._lastDist - d) / total) * total;
        }
        this.trackProgress = d;
        this._lastDist = d;
        this._lastS = nodes[best].s;

        // The grid sits behind the line, so a car starts the race most of a
        // lap "into" lap zero. Anchor the first reading or the half-distance
        // check below fires on the formation lap and the very first crossing
        // scores a lap nobody drove.
        if (this._lapAnchored === undefined) {
            this.lapStartProgress = d;
            this._lapAnchored = true;
        }

        if (!this.halfwayMarkerCrossed &&
            this.trackProgress - this.lapStartProgress > total * 0.45) {
            this.halfwayMarkerCrossed = true;
        }
    }

    checkWaypoints(track) {
        const wp = track.waypoints[this.nextWaypoint];
        const dist = Math.sqrt((this.x - wp.x)**2 + (this.y - wp.y)**2);
        
        // 200px radius for waypoint trigger to avoid missing them if driving wide
        if (dist < 200) {
            this.nextWaypoint = (this.nextWaypoint + 1) % track.waypoints.length;
            this.waypointProgress++;
        }
    }
    
    takeDamage(amount) {
        if (this.isBroken || this.finished) return;
        // The AI drives to a computed speed profile with perfect lookahead and
        // knows exactly how much steering it is about to need. A human has
        // four arrow keys and a reaction time, so the same corner costs them
        // contact the AI never has. Scaling the player's damage compensates
        // for that gap rather than making the car tougher: barriers and
        // contact still hurt, they just stop ending a race in one mistake.
        if (this.isPlayer) amount *= PLAYER_DAMAGE_SCALE;
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.isBroken = true;
        }
    }
    
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // A wreck on the hook is lifted clear of the tarmac, and once parked
        // it is drawn dimmed so it reads as scenery rather than a rival.
        // On the hook it is drawn slightly larger, as if lifted off the
        // ground. Once parked it keeps its full colour - it is a recognisable
        // car sitting behind the barriers, not a ghost.
        if (this.liftAmount) {
            const k = 1 + 0.30 * this.liftAmount;
            ctx.scale(k, k);
        }
        
        // Car shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 2 + 2, this.width, this.height);
        
        // Car body
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 4);
        ctx.fill();
        
        // Windshield (front)
        ctx.fillStyle = '#000';
        ctx.beginPath();
        // Shift it a bit forward. Center is at 0. Front is at width/2.
        ctx.roundRect(this.width / 8, -this.height / 2 + 2, 6, this.height - 4, 1);
        ctx.fill();
        
        // Spoiler (back)
        ctx.fillStyle = '#111';
        ctx.beginPath();
        // placed at the very back (-width/2)
        ctx.roundRect(-this.width / 2, -this.height / 2 + 1, 4, this.height - 2, 1);
        ctx.fill();
        
        // Headlights
        ctx.fillStyle = '#ffffe0';
        ctx.beginPath();
        ctx.arc(this.width / 2, -this.height / 2 + 3, 2, 0, Math.PI * 2);
        ctx.arc(this.width / 2, this.height / 2 - 3, 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
        
        // Draw Health Bar
        if (this.health > 0) {
            const barWidth = 24;
            const barHeight = 4;
            const healthRatio = this.health / this.maxHealth;
            
            ctx.fillStyle = '#000'; // border
            ctx.fillRect(this.x - barWidth / 2 - 1, this.y - this.height - 10 - 1, barWidth + 2, barHeight + 2);
            
            // color based on health
            if (healthRatio > 0.5) ctx.fillStyle = '#4CAF50'; // Green
            else if (healthRatio > 0.25) ctx.fillStyle = '#FFC107'; // Yellow
            else ctx.fillStyle = '#F44336'; // Red
            
            
            ctx.fillRect(this.x - barWidth / 2, this.y - this.height - 10, barWidth * healthRatio, barHeight);
        }
        
        // Blue flag: this car is about to be lapped and must move over.
        if (this.blueFlag) {
            const bx = this.x + 14;
            const by = this.y - this.height - 26;
            const wave = Math.sin(Date.now() / 90) * 2;

            ctx.save();
            // pole
            ctx.strokeStyle = '#e8e8e8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx, by + 15);
            ctx.stroke();

            // pennant
            ctx.fillStyle = '#1565ff';
            ctx.strokeStyle = 'rgba(0,0,0,0.65)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(bx + 1, by + 0.5);
            ctx.quadraticCurveTo(bx + 8, by + 1 + wave, bx + 16, by + 1 - wave);
            ctx.lineTo(bx + 16, by + 10 - wave);
            ctx.quadraticCurveTo(bx + 8, by + 10 + wave, bx + 1, by + 9.5);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // Draw driver name
        if (this.driverName) {
            ctx.font = '10px Arial';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'black';
            ctx.shadowBlur = 3;
            ctx.fillText(this.driverName, this.x, this.y - this.height - 15);
            ctx.shadowBlur = 0; // reset
        }
    }
}
