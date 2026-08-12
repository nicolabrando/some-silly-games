let __carUid = 0;

// =========================================================================
//  TYRE COMPOUNDS
// -------------------------------------------------------------------------
//  `grip` is the fresh multiplier, `falloff` how much of it is lost by the
//  time the tyre is finished, `life` the fraction of the RACE the compound
//  survives, and `bite` its own hold on the STEERING RATE.
//
//  life is a fraction of the race rather than a number of laps, so a set lasts
//  proportionally longer the longer the race: a soft is spent after ~4.5 laps
//  of a 5-lap race and ~9 laps of a 10-lap one. The medium's life came down
//  from 1.50 to 1.30 as part of this fit: at 1.50 it barely wore at all, which
//  left it and the hard within 0.2% of each other for a whole stint and meant
//  the hard's endurance could never buy it anything. It was taken to 1.05
//  first and that was too far - at Harbour, the tightest of the circuits, the
//  field lost enough grip late in the race to start running wide, 8.6% of the
//  sampled frames on the grass against 0.2%, and one car in eight failed to
//  finish. 1.30 keeps the shape and gives that back. That has a consequence worth
//  stating, because it decides how these numbers were chosen: if life is a
//  fraction of the distance then the shape of every stint is identical at
//  every race length, so race length CANNOT be what makes one compound better
//  than another, and tuning for "softs win short races" is impossible by
//  construction. (chooseTyre used to try anyway - see ai.js.)
//
//  WHY `bite` HAD TO EXIST. The binding cornering limit in this model is the
//  steering rate, not the grip - v = maxSteer / (1/R + maxSteer/500) - so grip
//  is nearly free: measured one knob at a time it is worth -0.012% of lap time
//  per 1%, against -0.351% for the steering rate. tyrePerf did multiply the
//  steering rate, but it is the GRIP curve, and nine per cent of it bought the
//  soft almost nothing while its cliff cost it everything. Measured over a full
//  solo stint on four circuits: soft +1.8%, medium +0.1%, hard +0.2% off the
//  best. The soft was not a strategy, it was a trap - never the right call at
//  any distance, which is why the AI taking it 39% of the time was handing the
//  player most of a second a lap.
//
//  `bite` multiplies the steering rate directly and FADES WITH THE SET: all of
//  it on a fresh tyre, none of it on a spent one. So the soft is genuinely the
//  quickest thing on the road early and genuinely the slowest at the end, and
//  what you are choosing is WHEN you want your performance. Nothing is a free
//  win; what breaks the tie is situational - track position, how much you slide
//  the car (wear accrues faster under load), a corner-heavy circuit, and the
//  places-gained bonus that pays for early aggression.
//
//  FITTED, not chosen (tyrefit.js sweeps `bite` and the medium's life over full
//  solo stints). Three things had to be true at once, and every candidate that
//  satisfied two of them failed the third:
//
//    * no compound more than 1.5% better over a full race  -> worst case 1.46%
//    * the first lap goes  soft < medium < hard
//    * the last lap goes   hard < medium < soft
//
//  The middle one is what killed the earlier candidates: several closed the
//  overall gap by making the HARD quicker than the medium on a fresh set,
//  which is nonsense however good the totals look.
//
//  Note the fit is done at medium difficulty, not at impossible. At the top of
//  the ladder the AI is pinned against its own `maxCorner` ceiling, so extra
//  steering rate is partly thrown away and the soft measures better than it
//  is; the player has no such ceiling.
// =========================================================================
//  Numbers per compound, all independent, all with a neutral default so a
//  compound that says nothing about one behaves exactly as before:
//    grip     - how hard it holds, and (through tyrePerf) how fast it steers
//    bite     - steering rate bought back on a fresh set only
//    slide    - how readily the tail steps out, multiplying powerOversteer
//    hook     - steering rate bought back only in the SLOW corners, fading to
//               nothing at hookBand. This is the one that can make a compound
//               a specialist: bite pays the same everywhere, so a tyre meant
//               for hairpins cannot be built out of it.
//    hookBand - the speed above which hook is worth nothing (default 160)
//    rainGrip - multiplier on WET_GRIP: what the tread is worth in the rain
//    aqua     - 0..1, how much of the aquaplaning penalty the tread clears
//    dryWear  - wear multiplier on a dry road, for rubber not meant to be there
//  `slide` exists because grip cannot do that job on its own. Grip is also the
//  clamp on lateral force, so buying slide with grip costs lap time steeply:
//  measured (driftsweep.js) at a constant fresh steering rate, walking grip
//  from 0.78 to 0.74 doubles the deficit, 1.65% to 3.04%. A tyre meant to be
//  loose rather than slow needs the two separated.
const TYRES = {
    soft:   { key: 'soft',   label: 'Soft',   short: 'S', colour: '#e53935',
              grip: 1.090, falloff: 0.2285, life: 0.90, bite: 1.010, slide: 1.00 },
    medium: { key: 'medium', label: 'Medium', short: 'M', colour: '#fdd835',
              grip: 1.000, falloff: 0.0696, life: 1.30, bite: 1.000, slide: 1.00 },
    hard:   { key: 'hard',   label: 'Hard',   short: 'H', colour: '#e0e0e0',
              grip: 0.988, falloff: 0.0240, life: 2.60, bite: 1.005, slide: 1.00 },
    // ---- DRIFT ----------------------------------------------------------
    //  A compound that gives up lateral grip on purpose. In this model that is
    //  not just "worse": grip is what feeds three separate things, and giving
    //  it away buys all three.
    //
    //    * slipperiness = baseGrip / currentGrip, and it multiplies
    //      powerOversteer directly. At grip 0.70 that is 1.43x, so the tail
    //      steps out on a throttle input that would not have moved it at all
    //      on a medium.
    //    * alignStiffness = 3.5 * (1 - slideRelease * powerOversteer), so a
    //      bigger slide is also a slide the tyres fight less. It keeps going
    //      instead of being caught.
    //    * the lateral force is clamped to currentGrip, so once it is sideways
    //      it stays sideways.
    //
    //  WHERE IT PAYS, AND WHY THAT HAD TO BE REBUILT.
    //
    //  The first version bought its pace back with `bite`: 1.344 x 0.780 gave
    //  a steering rate of 1.048, a shade above the medium's. That worked and
    //  it was wrong, because `bite` is FLAT - it pays the same on a 250 px/s
    //  sweeper as in a hairpin. The tyre came out slightly worse than a medium
    //  everywhere instead of clearly better somewhere, which is not a choice.
    //  Measured over a season on the same seed, in a human's hands: 3.7% off
    //  on best lap, 27 championship points down, quicker on one circuit of
    //  five and by 0.9%. Nobody would ever pick it.
    //
    //  Worse, that `bite` was a workaround for a broken instrument. Every tyre
    //  number here was fitted against the AI, and the AI never provokes the
    //  car - it drives a computed speed profile - so the drift compound
    //  measured 0.5 to 1.3% SLOW on all seventeen circuits and the only way to
    //  make it look competitive was a flat bonus. Fixing the measurement is
    //  what let the workaround go.
    //
    //  So `bite` is 1.00 now - no fresh-tyre term at all - and the steering
    //  rate is simply what the grip gives: 0.78, a fifth below a medium,
    //  charged on every corner of every lap. It is bought back by `hook`,
    //  which only exists at low speed. Fitted (driftfit.js, AI medium, 5-lap
    //  solo stints) at hook 0.58 over a band of 320 px/s:
    //
    //      Pettine      -3.2%     Oval     +3.0%
    //      Circo Massimo-2.8%     Peanut   +3.2%
    //      Kart         -1.0%     Kettle   +3.4%
    //      Thunder      -0.5%     Circle   +4.0%
    //
    //  which is the shape that was wanted: right where the lap is made of slow
    //  corners, plainly wrong where it is not. Pettine is 51% of a lap under
    //  160 px/s and gains most; Circle is a constant-radius sweeper with none
    //  and loses most.
    //
    //  The penalty at the fast end has a floor that is nothing to do with
    //  steering: grip 0.78 also caps lateral force, and in a fast corner the
    //  AI is grip-limited rather than steering-limited (vGrip = sqrt(lat x
    //  tyrePerf x R)), so no amount of hook can rescue it there. The tyre is
    //  steering-limited where it is quick and grip-limited where it is slow,
    //  and both come out of the physics rather than out of a special case.
    //
    //  `bite` was tried below 1.0 as a way of charging the flat deficit and
    //  rejected: it FADES with wear, so a value under one would make the tyre
    //  get better as it wore out.
    //
    //  Where that is quick and where it is not is a real circuit question. The
    //  yaw boost in powerOversteer is worth most below 160 px/s, so a hairpin
    //  is where a slide beats grip; a long fast sweeper is where it does not.
    //  Measured (tyrecost.js, 5-lap solo stints): quicker than the medium at
    //  Circle and Kart, slower at F1 and the Oval.
    //
    //  Grip stops at 0.78 because that is where the lateral-force clamp starts
    //  costing real time (driftsweep.js: 0.78 is 1.65% off, 0.74 is 3.04%).
    //  The rest of the character comes from `slide`, which touches nothing but
    //  the oversteer term. 1.282 of slipperiness times 1.55 of slide is a tail
    //  that steps out twice as readily as the medium's.
    drift:  { key: 'drift',  label: 'Drift',  short: 'D', colour: '#ab47bc',
              grip: 0.780, falloff: 0.0150, life: 2.00, bite: 1.000, slide: 1.55,
              hook: 0.58, hookBand: 320 },
    // ---- RAIN -----------------------------------------------------------
    //  Two treaded compounds. What separates them is not simply "more wet
    //  grip": the wet road and the standing water on it are two different
    //  problems, and each tyre is built for one of them.
    //
    //    intermediate - a lot of the dry tyre's steering rate kept (grip 0.94,
    //      so tyrePerf and with it the steering rate stay high) and 2.5x the
    //      wet grip. Quick on a merely wet road. It has no answer to a puddle.
    //    full wet - slower in the corners (grip 0.87 is a real steering-rate
    //      cost) but 3.55x the wet grip and, decisively, it clears water:
    //      `aqua` takes out 60% of the aquaplaning. It is the tyre that can be
    //      driven through the standing water rather than surviving it.
    //
    //  So the choice is a reading of the circuit, not a strategy on a scale:
    //  how much of this lap is puddle? main.js scatters 4-6 of them per wet
    //  race and they land where the racing line goes, so the answer changes
    //  from race to race - which is the point.
    //
    //  The two numbers were set by measuring exactly that (wetsweep.js, 5-lap
    //  wet stints at Oval, Circle and Triangle). At 0.87/3.55 the intermediate
    //  wins all three circuits on a clean wet road, by 0.2 to 1.8%, and the
    //  full wet wins all three with eight puddles down, by 0.9 to 5.7%. Half a
    //  point either way collapses that: 0.84/3.30 hands five of six to the
    //  intermediate, 0.90/3.30 hands all six to the full wet.
    //
    //  On a dry road both are wrong, and wrong in the way rain tyres are wrong:
    //  not merely slow but destroying themselves. dryWear 4.5 and 3.4 against a
    //  life of 1.15 means a set is finished around a third of the way in.
    inter:  { key: 'inter',  label: 'Inter',  short: 'I', colour: '#43a047',
              grip: 0.940, falloff: 0.1400, life: 1.15, bite: 1.020, slide: 1.00,
              rainGrip: 2.50, aqua: 0.10, dryWear: 4.5, rain: true },
    wet:    { key: 'wet',    label: 'Wet',    short: 'W', colour: '#1e88e5',
              grip: 0.870, falloff: 0.0900, life: 1.55, bite: 1.030, slide: 1.00,
              rainGrip: 3.55, aqua: 0.60, dryWear: 3.4, rain: true }
};
const TYRE_KEYS = ['soft', 'medium', 'hard', 'drift', 'inter', 'wet'];
// The two treaded compounds, kept as a list so nothing has to test a key by
// name to ask "is this a rain tyre?".
const RAIN_TYRE_KEYS = TYRE_KEYS.filter(k => TYRES[k].rain);
const DRY_TYRE_KEYS = TYRE_KEYS.filter(k => !TYRES[k].rain);

// How much of its dry grip a car keeps on a wet road. Read by car.js for the
// physics and by ai.js for the speed the AI aims at - the two must be the same
// number or the AI drives to a circuit that is not there.
const WET_GRIP = 0.13;

// The speed below which a compound's `hook` is worth anything, and the function
// that says how much. Same 160 px/s as the yaw boost in powerOversteer, and
// deliberately so: this is the band where a car is being rotated rather than
// carried, and a tyre built for that band should be worth something in exactly
// the same places.
//
// Read by car.js for the steering it applies and by ai.js for the corner speed
// it aims at. One function, both sides. The last time those two disagreed - the
// wet grip constant - the AI drove past the limit in every wet corner for weeks.
// The band is per compound, with 160 as the default, because 160 turned out to
// be far too narrow to build a tyre on: at the speeds a car actually takes
// corners here, only a genuine hairpin lives under it. R=40 is 74 px/s but R=90
// is already 141 and R=130 is 181, so a band of 160 pays on maybe two corners
// of a lap and the flat deficit is charged on all the rest.
const HOOK_BAND = 160;
// How much of a compound's `slide` is handed back where its `hook` is fully
// active. 0 leaves the two stacked, 1 removes the drift character exactly where
// the tyre is meant to drift. 0.6 was chosen to leave the drift compound at
// 1.22 of slide in a hairpin - a fifth more oversteer than a slick rather than
// half again as much.
const SLIDE_DECOUPLE = 0.6;
// `wet` is passed because a band measured in px/s means something completely
// different once it is raining. Grip falls to 0.13 of dry, so EVERY corner on
// the circuit drops inside the band and a slow-corner bonus turns into a
// blanket one: measured, the drift compound was picking up between +29% and
// +48% of steering rate over an entire wet lap. It showed - a tyre with no
// tread at all went from 15.5% off the medium in the rain to 1.9% off, which
// is nonsense. The hook is a dry-road device and now says so.
function tyreHookAt(tyre, speed, wet) {
    const h = (tyre && tyre.hook) || 0;
    if (!h) return 1;
    if (wet === undefined ? (typeof isRaining !== 'undefined' && isRaining) : wet) return 1;
    const band = (tyre && tyre.hookBand) || HOOK_BAND;
    return 1 + h * Math.max(0, Math.min(1, 1 - speed / band));
}

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
// ...and taken away again at Alien, where the point of the level is that the
// player is given nothing the field is not. Set by main.js when the session
// starts; everything that reads the two constants goes through these instead.
let playerHandicapOn = true;
function playerDamageScale() { return playerHandicapOn ? PLAYER_DAMAGE_SCALE : 1; }
function playerFreeImpact() { return playerHandicapOn ? PLAYER_FREE_IMPACT : 0; }

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
        this.tyreSteer = 1;
        this.tyreSlide = 1;

        // ---- Lap telemetry --------------------------------------------
        // Enough to answer "where did this compound's time come from", which
        // lap times on their own cannot. The drift compound's whole mechanism
        // is powerOversteer, and powerOversteer is a SLOW-CORNER effect - it
        // saturates below 116 px/s on the drift and below 81 on everything
        // else, and the yaw boost that goes with it lives under 160. So the
        // question is not just how quick the lap was but how much of it was
        // spent in that band and how much rotation was being bought there.
        //
        // Collected for every car, but only the player's is written out: the
        // AI never provokes oversteer at all, which is exactly why measuring
        // this tyre in AI hands said so little.
        this._tele = null;
        this.lastLapTele = null;
        this.resetLapTelemetry();

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

    resetLapTelemetry() {
        this._tele = { t: 0, slowT: 0, osSum: 0, osFrames: 0, osHigh: 0,
                       slideDist: 0, dist: 0, vSum: 0, frames: 0 };
    }

    // The lap that just ended, as numbers rather than a single time.
    closeLapTelemetry() {
        const a = this._tele;
        if (!a || !a.frames) return null;
        return {
            tyre: (this.tyre && this.tyre.key) || 'medium',
            // share of the lap spent under the yaw-boost speed, where the
            // compound's oversteer is worth anything at all
            slowShare: a.slowT / Math.max(1e-6, a.t),
            // how much oversteer was actually being carried while down there,
            // and how much of that time it was pinned at the ceiling
            osMean: a.osFrames ? a.osSum / a.osFrames : 0,
            osPinned: a.osFrames ? a.osHigh / a.osFrames : 0,
            // how far the car actually travelled sideways
            slidePct: 100 * a.slideDist / Math.max(1, a.dist),
            vMean: a.vSum / a.frames
        };
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
            // Rain rubber on a dry road tears itself apart. This is the reason
            // a wet tyre is not simply a safe default: get the call wrong and
            // the set is gone a third of the way in, and there are no stops.
            const dry = !(typeof isRaining !== 'undefined' && isRaining);
            const surfaceWear = dry ? (tyre.dryWear || 1) : 1;
            this.tyreWear += lapFrac * abuse * chassisWear * surfaceWear /
                             Math.max(0.05, tyre.life * laps);
        }
        const w = Math.max(0, Math.min(1.25, this.tyreWear));
        // ^1.6: the first half of a set costs almost nothing, the last of it
        // falls away quickly - the cliff is what makes the choice interesting.
        this.tyrePerf = tyre.grip - tyre.falloff * Math.pow(w, 1.6);
        // The compound's own hold on the steering rate, fading with the set:
        // all of it on a fresh tyre, none of it on a spent one.
        const bite = tyre.bite === undefined ? 1 : tyre.bite;
        this.tyreSteer = this.tyrePerf * (1 + (bite - 1) * Math.max(0, 1 - w));
        // How willingly the tail steps out on this compound. Unlike bite it
        // does not fade with the set - a loose carcass is loose fresh or spent.
        this.tyreSlide = tyre.slide === undefined ? 1 : tyre.slide;

        // Adjust physics based on surface
        let currentGrip = this.baseGrip * this.condition * this.tyrePerf;
        let currentFriction = this.baseFriction;

        // Rain effect on asphalt
        if (typeof isRaining !== 'undefined' && isRaining && surface !== 'grass') {
            // In this car model the *steering rate* is the binding limit
            // almost everywhere, so the wet grip clamp only bites well below
            // the value you would expect. 0.13 rather than 0.20: rain now
            // costs real lap time instead of a few km/h of top speed.
            //
            // It is a named constant because ai.js has to aim at the same
            // number. It did not, for a while - see the note there - and an AI
            // that thinks the road is 54% grippier than it is drives straight
            // past the limit every corner.
            currentGrip *= WET_GRIP * (tyre.rainGrip || 1);
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
            // A treaded tyre pumps the water out from under itself. `aqua` is
            // the fraction of the aquaplaning it clears - not of the puddle's
            // grip loss, of the SPEED-dependent part, because that is the part
            // that makes a puddle undriveable rather than merely slow.
            //
            // It lifts the floor as well as flattening the slope. Only taking
            // out the speed term left the full wet barely ahead - a puddle is
            // over in a few frames, so the difference had almost no time to
            // show - and the choice between the two rain compounds came down to
            // steering rate on every circuit, which is not a choice.
            const aqua = tyre.aqua || 0;
            this.aquaplane = Math.max(0, Math.min(1, (speedForKerb - 55) / 150)) *
                             (1 - aqua);
            currentGrip *= (0.45 + 0.30 * aqua) - 0.25 * this.aquaplane;
            currentFriction *= 2.2 - 0.9 * (tyre.aqua || 0);
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
            // ...and `hook` acts here too, but only down in the slow stuff. It
            // is what makes a compound a specialist rather than a flat upgrade:
            // `bite` pays the same on a 250 px/s sweeper as in a hairpin, so a
            // tyre meant for hairpins cannot be built out of it.
            const hook = tyreHookAt(this.tyre, speed);
            const steerEffectiveness = speedTerm * understeer *
                                       (this.tyreSteer || this.tyrePerf || 1) * hook * aqua;
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
            // `slide` and `hook` both live at low speed, and stacking them was a
            // mistake you could count: a season on the refitted drift compound
            // produced 17 contacts and four ruined laps out of twenty, against
            // 13 and none before. The steering rate arrives in the same corner
            // as the surplus rotation, so a small input yaws the car hard while
            // alignStiffness - which powerOversteer itself scales down - has
            // stopped gathering it up.
            //
            // So where the tyre is being given steering, it gives back some of
            // the slide. Not all of it: a drift tyre that stops oversteering in
            // slow corners is not a drift tyre. At full hook this leaves 1.22
            // of the 1.55, still well clear of the slicks' 1.00.
            const hookNow = tyreHookAt(this.tyre, speed);
            const hookFrac = this.tyre && this.tyre.hook
                ? (hookNow - 1) / this.tyre.hook : 0;
            const effSlide = 1 + ((this.tyreSlide || 1) - 1) * (1 - SLIDE_DECOUPLE * hookFrac);
            powerOversteer = Math.max(0, Math.min(1,
                ((demand - 1.45) / 2.2) * slipperiness * effSlide));
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

        // ---- Lap telemetry ------------------------------------------------
        // Everything here is already computed; this only adds it up. 160 px/s
        // is the top of the yaw-boost band (lowSpeed = 1 - speed/160), which is
        // the only place a compound's oversteer is worth anything, so that is
        // the line the "slow" share is drawn at.
        if (this._tele && !this.finished && !this.isBroken) {
            const a = this._tele;
            a.t += dt; a.frames++;
            a.vSum += speed;
            a.dist += speed * dt;
            a.slideDist += Math.abs(lateralSpeed) * dt;
            if (speed < 160) {
                a.slowT += dt;
                a.osFrames++;
                a.osSum += powerOversteer;
                if (powerOversteer > 0.95) a.osHigh++;
            }
        }

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
                    this.lastLapTele = this.closeLapTelemetry();
                }
                this.lapStartTime = typeof track.currentRaceTime !== 'undefined' ? track.currentRaceTime : 0;
                this.resetLapTelemetry();
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
        if (this.isPlayer) amount *= playerDamageScale();
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
