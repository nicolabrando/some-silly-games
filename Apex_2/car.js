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

// =========================================================================
//  CHASSIS  -  chosen once, for a whole season
// -------------------------------------------------------------------------
//  Three cars, and none of them is the good one. The trades are hung on the
//  handles the physics actually has, so each is felt from the driving seat
//  rather than read off a stat screen:
//
//    steer  - the STEERING RATE, which is the binding cornering limit in this
//             model almost everywhere (v = maxSteer / (1/R + maxSteer/500)).
//             This is the single most valuable number on the car, so anything
//             that raises it pays dearly elsewhere. Think of it as downforce.
//    top    - top speed, = enginePower / baseFriction. Downforce costs drag,
//             so the car that turns best is the slowest in a straight line.
//    power  - engine force: acceleration out of the slow stuff. It also
//             drives `powerOversteer` (demand = enginePower / speed), so the
//             muscular car genuinely is the loose one - that is not a
//             separate fudge factor, it falls out of the same number.
//    grip   - the lateral limit. In the DRY the steering rate binds first and
//             this barely shows; in the WET, on grass and on the kerbs it is
//             what is holding the car up. So it is a wet-weather trait.
//    wear   - tyre wear rate. Wear feeds tyrePerf, which multiplies the
//             steering rate, so a set that lasts is real pace in the last
//             third of a race rather than a number in a menu.
//    brake  - braking force.
//
//  The three are meant to be circuit-dependent and style-dependent, not
//  ranked: Aero wants corners, Bolt wants straights, Ridge wants a long race
//  or a wet one.
//
//  THE EXCHANGE RATE, measured one knob at a time over the whole calendar
//  (chassis_sens.js), as % of lap time per 1% of the knob:
//
//                  dry      wet
//      steer     -0.351   -0.174
//      top       -0.160   -0.115
//      power     -0.101   -0.152
//      grip      -0.012   -0.161      <- nothing in the dry, everything in the wet
//      brake     ~0       ~0
//
//  Which is the whole reason the first attempt was not balanced: steering
//  rate is worth 2.2x its own size in top speed, so a car given +8.5% of it
//  and only -5.5% of top speed was quicker on 8 circuits out of 11 and 2.45%
//  quicker on average. The numbers below are set so the three come out level
//  on MEAN dry pace and diverge per circuit - which is the point.
//
//  A SECOND ROUND of fitting was needed after RACING them rather than
//  time-trialling them (chassis_split.js keeps dry and wet apart). Two things
//  only a race shows:
//    - tyre life is worth far more over a distance than it looks on one lap,
//      so the durable car was winning the dry as well: 4.2 of 9 against 5.6
//      for the powerful one. wear 0.72 -> 0.86.
//    - grip is nearly free in the dry and decisive in the wet, so the rain
//      was a rout - 3.0 of 9 against 6.7. The grips were pulled in from
//      1.12/0.92 to 1.06/0.97, and the power car's engine trimmed from 1.08
//      to 1.05: in the wet a big engine is mostly a way of spinning the
//      rears, since powerOversteer sits at its cap once the surface is wet.
// =========================================================================
const CHASSIS = {
    aero: {
        key: 'aero', label: 'Aero', short: 'AER', accent: '#4dd0e1',
        line1: 'High downforce',
        line2: 'Turns in like nothing else and drags its heels on the straight. Hard on tyres.',
        steer: 1.030, top: 0.928, power: 1.000, grip: 1.00, wear: 1.15, brake: 1.05
    },
    bolt: {
        key: 'bolt', label: 'Bolt', short: 'BLT', accent: '#ff7043',
        line1: 'Low drag, long legs',
        line2: 'Fastest thing on the straight by a distance. It does not want to turn.',
        steer: 0.978, top: 1.098, power: 1.000, grip: 0.98, wear: 1.00, brake: 0.97
    },
    ridge: {
        key: 'ridge', label: 'Ridge', short: 'RDG', accent: '#9ccc65',
        line1: 'Understeer, but it lasts',
        line2: 'Washes wide if you rush it. Still on its tyres at the end, and quick in the rain.',
        steer: 0.992, top: 1.005, power: 0.985, grip: 1.04, wear: 0.88, brake: 1.02
    }
};
const CHASSIS_KEYS = ['aero', 'bolt', 'ridge'];
const CHASSIS_DEFAULT = 'ridge';

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
        
        // Physics constants (Drift physics). These are the BASE car; the
        // chassis multiplies them, so there is exactly one place where the
        // reference numbers live and setChassis() can always be re-applied.
        this.baseEnginePower = 300;
        this.baseBrakingPower = 150; // Reduced for less abrupt braking
        this.baseMaxSteer = Math.PI * 0.7; // Very smooth steering
        this.baseBaseGrip = 1200; // Lower grip to allow sliding
        this.baseBaseFriction = 0.85; // Drag
        this.setChassis(CHASSIS_DEFAULT);
        
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
    
    // Apply a chassis. Everything the physics reads is derived here, so a
    // car's numbers can never drift out of step with the badge on its nose.
    setChassis(key) {
        const c = CHASSIS[key] || CHASSIS[CHASSIS_DEFAULT];
        this.chassis = c;
        this.chassisKey = c.key;
        this.enginePower = this.baseEnginePower * c.power;
        this.brakingPower = this.baseBrakingPower * c.brake;
        this.maxSteer = this.baseMaxSteer * c.steer;
        this.baseGrip = this.baseBaseGrip * c.grip;
        // top speed = enginePower / baseFriction, so the drag that delivers
        // the quoted top speed follows from the power it was given.
        this.baseFriction = this.baseBaseFriction * (c.power / c.top);
        this.tyreWearScale = c.wear;
        return this;
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
            // The chassis is part of how hard the car is on its rubber: a
            // high-downforce car loads the tyre far more than one running
            // little wing.
            const chassisWear = this.tyreWearScale || 1;
            this.tyreWear += lapFrac * abuse * chassisWear / Math.max(0.05, tyre.life * laps);
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
            // Suspend commands, let it coast by inertia. The analogue pair has
            // to be cleared too, or a finished car would keep the throttle the
            // slider was last holding.
            this.inputs.up = false;
            this.inputs.down = false;
            this.inputs.left = false;
            this.inputs.right = false;
            this.inputs.throttle = 0;
            this.inputs.brake = 0;
        }
        
        // --- Longitudinal forces (Engine, Brakes) ---
        let forwardForce = 0;
        
        // Virtual Safety Car: everyone runs on reduced power while a wreck is
        // being recovered (global set by main.js).
        const vsc = (typeof vscPowerFactor !== 'undefined') ? vscPowerFactor : 1;

        // Throttle and brake are ANALOGUE, 0..1. A keyboard can only ask for
        // 0 or 1, so `up`/`down` still mean exactly what they meant and a
        // desktop lap is bit-identical; a touch slider can ask for anything
        // in between. Whoever sets `throttle` must also set `up`, because the
        // oversteer model, the AI and the effects all read the boolean.
        const thr = this.inputs.throttle !== undefined
            ? Math.max(0, Math.min(1, this.inputs.throttle))
            : (this.inputs.up ? 1 : 0);
        const brk = this.inputs.brake !== undefined
            ? Math.max(0, Math.min(1, this.inputs.brake))
            : (this.inputs.down ? 1 : 0);

        if (thr > 0) {
            forwardForce += this.enginePower * this.condition * vsc * thr;
            // Slipstream: continuous with distance rather than an on/off cone,
            // so the tow builds as you close in instead of snapping on.
            if (this.draftStrength > 0) {
                forwardForce += this.enginePower * 0.26 * this.draftStrength * vsc * thr;
            }
        }
        if (brk > 0) {
            forwardForce -= this.brakingPower * brk;
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
        if (thr > 0 && steerInput !== 0 && speed > 12 && !this.finished && !this.isBroken) {
            // scaled by the throttle actually applied: feeding it in gently is
            // how you keep the rear behind you
            const demand = (this.enginePower * this.condition * thr) / Math.max(70, speed);
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

        // A global rescan must not just take the nearest node. On a circuit
        // that crosses itself the nearest node can belong to the OTHER road -
        // they share the same pixels - and a car that gets punted at the
        // crossing would be re-attached to the wrong half of the lap, drive
        // round one lobe of the eight for ever and never complete a lap. So
        // the rescan prefers a node the car is actually pointing along; only
        // if nothing agrees with the direction of travel does it fall back to
        // plain distance.
        const dirX = Math.hypot(this.velocity.x, this.velocity.y) > 25
            ? this.velocity.x / Math.hypot(this.velocity.x, this.velocity.y)
            : Math.cos(this.angle);
        const dirY = Math.hypot(this.velocity.x, this.velocity.y) > 25
            ? this.velocity.y / Math.hypot(this.velocity.x, this.velocity.y)
            : Math.sin(this.angle);
        // Take the nearest node - and only let the direction of travel overrule
        // that when there is a genuine ambiguity: another node just as close in
        // SPACE but far away along the LAP. That is exactly what a crossing is,
        // and nothing else on any circuit looks like it.
        //
        // The first version of this preferred an aligned node outright, which
        // quietly changed every circuit: ten cars parked on the same spot read
        // ten different distances (151px apart) because they were pointing
        // different ways, and the slipstream, which is keyed off the same
        // number, started handing out tows to cars 22px off line.
        const globalScan = () => {
            let fi = 0, fd = Infinity;
            for (let i = 0; i < N; i++) {
                const d = d2(i);
                if (d < fd) { fd = d; fi = i; }
            }
            const near = Math.sqrt(fd) + 8;
            const apart = (this.width || 24) * 3;
            let bi = fi, bAlign = nodes[fi].tx * dirX + nodes[fi].ty * dirY;
            for (let i = 0; i < N; i++) {
                if (i === fi) continue;
                if (Math.sqrt(d2(i)) > near) continue;
                if (Math.abs(nodes[i].s - nodes[fi].s) < apart) continue;   // same stretch
                const al = nodes[i].tx * dirX + nodes[i].ty * dirY;
                if (al > bAlign + 0.25) { bAlign = al; bi = i; }
            }
            return { i: bi, d: d2(bi) };
        };

        let best = 0;
        let bd = Infinity;
        if (this._nodeIdx === undefined) {
            const g = globalScan(); best = g.i; bd = g.d;
        } else {
            for (let o = -14; o <= 34; o++) {
                const i = (this._nodeIdx + o + N * 2) % N;
                const d = d2(i);
                if (d < bd) { bd = d; best = i; }
            }
            if (bd > 220 * 220) {          // lost it (spun, punted, teleported)
                const g = globalScan(); best = g.i; bd = g.d;
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
    
    draw(ctx, skipTags) {
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
        
        // --- an open-wheeler, nose towards +x, same 24x14 footprint --------
        // Everything below is placed off W and H, so the physics (collision
        // box, spawn spacing, crane, skid marks) is untouched.
        const W = this.width, H = this.height;

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.roundRect(-W / 2 + 2, -H / 2 + 2, W, H, 4);
        ctx.fill();

        // --- the three chassis, in the same 24x14 box ---------------------
        // Nothing here touches the physics: the collision box, the grid
        // spacing and the crane all work off W and H, which never change.
        // What changes is what the shape SAYS - a car covered in wing, a car
        // that is mostly engine, a car built to survive the distance - so a
        // glance at the timing screen and a glance at the road agree.
        const ch = this.chassis || CHASSIS[CHASSIS_DEFAULT];
        const K = ch.key;
        const P = K === 'aero'
            ? { fwD: 3.0, fwSpan: 1.00, rwD: 3.2, rwSpan: 0.88, pod: 1.4,
                rearTyre: 5.0, fin: 0, nose: 5.6 }
            : K === 'bolt'
            ? { fwD: 1.7, fwSpan: 0.80, rwD: 2.0, rwSpan: 0.60, pod: 2.2,
                rearTyre: 6.2, fin: 6.5, nose: 3.6 }
            : { fwD: 2.2, fwSpan: 0.90, rwD: 2.6, rwSpan: 0.76, pod: 3.0,
                rearTyre: 5.4, fin: 0, nose: 4.6 };

        // front wing: the aero car's is a full-width plane with tall
        // endplates, the bolt's a stub
        const fwH = H * P.fwSpan;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(W / 2 - P.fwD + 0.8, -fwH / 2, P.fwD - 0.8, fwH);
        ctx.fillStyle = ch.accent;
        ctx.fillRect(W / 2 - P.fwD - 0.4, -fwH / 2, P.fwD + 0.4, 1.2);   // endplates
        ctx.fillRect(W / 2 - P.fwD - 0.4, fwH / 2 - 1.2, P.fwD + 0.4, 1.2);
        if (K === 'aero') {
            // a second element: this is the car that is all wing
            ctx.fillStyle = '#101010';
            ctx.fillRect(W / 2 - P.fwD - 0.2, -fwH / 2 + 1.2, 1.0, fwH - 2.4);
        }

        // rear wing
        const rwH = H * P.rwSpan;
        ctx.fillStyle = '#111';
        ctx.fillRect(-W / 2, -rwH / 2, P.rwD, rwH);
        ctx.fillStyle = ch.accent;
        ctx.fillRect(-W / 2, -rwH / 2 - 0.4, P.rwD + 1.0, 1.2);
        ctx.fillRect(-W / 2, rwH / 2 - 0.8, P.rwD + 1.0, 1.2);

        // exposed tyres. The bolt puts more rubber on the road at the back,
        // which is the only way it holds on to its own engine.
        ctx.fillStyle = '#161616';
        ctx.fillRect(-W / 2 + 3.4, -H / 2, P.rearTyre, 3.7);
        ctx.fillRect(-W / 2 + 3.4, H / 2 - 3.7, P.rearTyre, 3.7);
        ctx.fillRect(W / 2 - 9.2, -H / 2 + 0.3, 4.2, 3.1);
        ctx.fillRect(W / 2 - 9.2, H / 2 - 3.4, 4.2, 3.1);
        ctx.fillStyle = '#3c3c3c';
        ctx.fillRect(-W / 2 + 5.2, -H / 2 + 1.1, 1.6, 1.4);
        ctx.fillRect(-W / 2 + 5.2, H / 2 - 2.5, 1.6, 1.4);
        ctx.fillRect(W / 2 - 7.8, -H / 2 + 1.2, 1.4, 1.3);
        ctx.fillRect(W / 2 - 7.8, H / 2 - 2.5, 1.4, 1.3);

        // monocoque: the nose length and the sidepods are what separate the
        // three silhouettes from above - a needle, a slab, a full-bodied car
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 0.4, 0);
        ctx.lineTo(W / 2 - P.nose, -2.2);
        ctx.lineTo(1.5, -3.5);
        ctx.lineTo(-2.5, -H / 2 + 3.4 - P.pod);
        ctx.lineTo(-W / 2 + 3.6, -H / 2 + 3.8 - P.pod);
        ctx.lineTo(-W / 2 + 2.5, -1.7);
        ctx.lineTo(-W / 2 + 2.5, 1.7);
        ctx.lineTo(-W / 2 + 3.6, H / 2 - 3.8 + P.pod);
        ctx.lineTo(-2.5, H / 2 - 3.4 + P.pod);
        ctx.lineTo(1.5, 3.5);
        ctx.lineTo(W / 2 - P.nose, 2.2);
        ctx.closePath();
        ctx.fill();

        // the bolt's shark fin, running back to the rear wing
        if (P.fin > 0) {
            ctx.fillStyle = ch.accent;
            ctx.fillRect(-W / 2 + P.rwD, -0.7, P.fin, 1.4);
        }
        // and the ridge's high sidepod shoulders, the full-bodied look
        if (K === 'ridge') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(-6.5, -H / 2 + 3.5, 6.0, 1.4);
            ctx.fillRect(-6.5, H / 2 - 4.9, 6.0, 1.4);
        }

        // accent flash on the nose: the badge you actually read at speed
        ctx.fillStyle = ch.accent;
        ctx.fillRect(W / 2 - P.nose - 1.2, -1.0, 2.6, 2.0);

        // cockpit opening + halo hoop over it
        ctx.fillStyle = '#101014';
        ctx.beginPath();
        ctx.roundRect(-2.6, -2.1, 6.0, 4.2, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(210, 210, 210, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0.6, 0, 2.4, -Math.PI * 0.75, Math.PI * 0.75);
        ctx.stroke();

        ctx.restore();

        // Everything above the car - health, name, blue flag - is drawn by
        // drawTags(), separately, because on a circuit with a bridge the deck
        // has to go between the two: under it you cannot see the car, but you
        // can still see who it is and how they are doing.
        if (!skipTags) this.drawTags(ctx);
    }

    drawTags(ctx) {
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
