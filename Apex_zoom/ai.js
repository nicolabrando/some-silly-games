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

// -----------------------------------------------------------------------------
//  THE LADDER
//
//  Measured before it was refitted (median solo lap, sixteen circuits, tyre
//  pinned so a compound lottery could not move the answer):
//
//      easy +59.8%   medium +15.5%   hard +3.7%   impossible 0
//
//  Three quarters of the range was in the bottom step and the top two rungs
//  were the same rung - hard and impossible were three points apart, which is
//  inside the race-to-race noise. After the refit, same measurement, four
//  circuits (oval, triangle, f1, serpent):
//
//      easy +44.2%   medium +26.8%   hard +10.6%  impossible 0    alien 0
//
//  Steps of 10.6, 16.2 and 17.4 points instead of 3.7, 11.8 and 44.3. Not
//  perfectly even - easy's mistake rate makes its median lap noisy, and the
//  figure swings between 36% and 44% depending which circuits are in the set -
//  but every rung is now a rung.
//
//  HOW EACH RUNG WAS MOVED matters as much as where it went:
//
//  * easy was not given more grip. It was given a better LINE, later braking,
//    steadier hands and fewer mistakes - lineBlend 0.35 -> 0.70, brakeConfidence
//    0.55 -> 0.80, radiusOptimism 0 -> 0.28, steerTau 0.11 -> 0.085, errorChance
//    0.30 -> 0.16 - with cornerFactor untouched at 0.72. Scaling its pace
//    instead would have put its corner speed above medium's 0.826, which is
//    nonsense on paper even where it is not on the stopwatch: easy loses far
//    more to the line it drives than to the grip it is allowed to use.
//  * medium and hard had their two pace knobs scaled by 0.869 and 0.880,
//    read off a measured response curve rather than guessed.
//  * impossible was not touched, because there is nowhere for it to go. Sweeping
//    its corner factor up by 4, 8 and 12% moved the lap by -1.6%, -1.2% and
//    -0.7%: the AI is already at the limit of the car, not of its own nerve.
//
//  Which is why ALIEN is not a faster AI. It is the same pace with no weak
//  cars in the field: skillFloor lifts the bottom of the skill range so every
//  driver runs at the top of it, instead of a spread that hands the player a
//  slow half of the grid. That, and the player's own damage handicap comes off.
//
//  THE TOP WAS RAISED ANYWAY - not here, in track.js. "At the limit of the car"
//  was true of the LINE the AI was given, not of the car: Nicola's logs had him
//  qualifying 5-14% quicker than the Impossible grid on every circuit made of
//  straights and corners (Rectangle 14%, Zipper and Harbour 11%, Crown 10%,
//  Serpent 9%), and only slower on the Oval and the Circle. Traced, the AI on
//  Rectangle was braking to 167 px/s four times a lap, because the relaxed line
//  it followed had a kink of radius ~100px at each end of every corner; the
//  road allows an arc of ~190 taken at 220+, which is what he drives. The line
//  is now optimised and judged by a simulated lap (track.js, THE LINE, AND HOW
//  IT IS CHOSEN), and the same neutral measurement - solo lap, neutral driver,
//  medium, dry, Aero - came back:
//
//      easy +41.5%   medium +22.2%   hard +8.0%   impossible 0    alien 0
//
//  with the top itself 4.5% quicker on average (8-12% on Anchor, Harbour,
//  Rectangle, Serpent, Circo Massimo). Every level shares the line, so the
//  rungs moved up together and the ladder kept its shape - the numbers here
//  were not refitted. Against his own best laps the top is now level on
//  Harbour, Serpent, Peanut and Boomerang, quicker on the Oval and the Circle,
//  and 3-7% slower on Rectangle, Zipper, Crown, Crossover and Kettle - the
//  remaining difference is how he drives a slow corner, not which line.
//  Alien is unchanged by construction: the same line, the same pace, no weak
//  cars, no damage handicap.
// -----------------------------------------------------------------------------
const AI_PROFILES = {
    easy: {
        // how hard this level leans on the throttle to rotate a slow corner
        provoke: 0.00,
        cornerFactor: 0.72,     // fraction of the attainable cornering speed
        straightFactor: 0.68,   // fraction of top speed on the straights
        brakeConfidence: 0.80,  // lower => brakes earlier
        lineBlend: 0.70,        // 0 = centre line, 1 = full racing line
        radiusOptimism: 0.28,   // 0 = worst radius of the neighbourhood, 1 = local radius
        lookBase: 58,
        lookSpeed: 0.26,
        steerTau: 0.085,        // steering low-pass (s)
        reaction: [0.45, 0.90],
        errorChance: 0.16,
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
        // how hard this level leans on the throttle to rotate a slow corner
        provoke: 0.25,
        cornerFactor: 0.826,    // 0.95 x 0.869, fitted to land 24% off impossible
        straightFactor: 0.834,  // 0.96 x 0.869
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
        maxCorner: 0.869,
        attackGain: 1.00
    },
    hard: {
        // how hard this level leans on the throttle to rotate a slow corner
        provoke: 0.45,
        cornerFactor: 0.950,    // 1.08 x 0.880, fitted to land 12% off impossible
        straightFactor: 0.880,
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
        maxCorner: 0.994,
        attackGain: 0.55
    },
    impossible: {
        // how hard this level leans on the throttle to rotate a slow corner
        provoke: 0.65,
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
        attackGain: 0.30,
        skillFloor: 0.8         // the full skill range: some cars are weaker
    },
    // The top rung, and it is not a faster car - there is no faster car. What
    // it removes is the weak half of the grid. skillVariation runs in [0.8,
    // 1.1] and maps to a pace multiplier of 0.930 to 1.000, so at every other
    // level a third of the field is up to 7% off its own best. Here the floor
    // is 1.1: every car runs at the top of the range, so there is nobody to
    // pick off on the way through. Measured over the logs, the player's margin
    // came from exactly that - not from beating the leaders, but from passing
    // the ones the ladder had already slowed down.
    alien: {
        // how hard this level leans on the throttle to rotate a slow corner
        provoke: 0.65,
        cornerFactor: 1.14,
        straightFactor: 1.0,
        brakeConfidence: 1.12,
        lineBlend: 1.0,
        radiusOptimism: 1.0,
        lookBase: 34,
        lookSpeed: 0.155,
        steerTau: 0.028,
        reaction: [0.085, 0.120],
        errorChance: 0.0,
        errorMag: 0.0,
        overtake: 1.0,
        safeGap: 16,
        gapGain: 2.9,
        defend: 1.0,
        lineLevel: 'fast',
        maxCorner: 1.19,
        attackGain: 0.30,
        skillFloor: 1.1,        // no weak cars at all
        noPlayerHandicap: true  // and the player pays full price for a shunt
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
//  is meant to be. That is why a rain expert can carry a number below 1.
//
//  REFITTED, and the refit found a bug rather than a balance problem. The
//  measured order used to be almost exactly reversed - Senna slowest of the ten
//  in the rain, Lauda quickest, when the profiles say the opposite - and no
//  value of this column could have fixed it, because the cause was upstream:
//  ai.js aimed at 0.20 of dry grip in the wet while car.js delivered 0.13. The
//  AI believed the road was 54% grippier than it was, aimed about 24% past the
//  limit in every wet corner, and scrubbed - and the higher a driver's wetSkill
//  the further past the limit it aimed. The drivers meant to be best in the
//  rain were the ones being punished by it. Both now read WET_GRIP from car.js.
//
//  With that fixed the column was refitted by measurement (wetfit.js: solo wet
//  laps, four circuits, the gap averaged per circuit so the longest lap cannot
//  decide it). Measured order now, quickest to slowest in the rain:
//
//      Hamilton, Senna, Schumacher, Clark, Alonso,
//      Fangio, Verstappen, Vettel, Lauda, Prost        spread 4.5%
//
//  which is what every profile says: the three this file names as strongest in
//  the rain are the three quickest in it, Clark - "quick in the wet" - is
//  fourth, and Verstappen, Vettel, Lauda and Prost, the four whose comments say
//  the rain is not their weather, are the four slowest.
//
//  Two things about the fitting itself, both learned the hard way. The error
//  has to be MEAN-CENTRED before it is stepped on, because both the measurement
//  and the target are quoted as a gap to whoever is quickest - so the level is
//  not a real quantity and stepping on the raw error walked nine of the ten
//  drivers into the same cap in one move. And a single linear extrapolation
//  from one probe point overshot to a worst error of 3.4 points; iterating with
//  a damped step got it to 1.2.
//
//  Change any personality trait and both columns need refitting.
//
//  THIRD FIT of the trim column (the game moved again: four chassis, Spa, the
//  redrawn XLs, and every driver now qualifying and racing in the chassis
//  their own taste picks). Fitted at IMPOSSIBLE, where Nicola actually plays,
//  and ANALYTICALLY this time: seventy real simulated flying laps per driver
//  per circuit on four circuits, each driver's median lap against the field's
//  mean, trim moved by the measured gap (damped 0.85) in ONE step - which
//  out-fitted four rounds of iterating on 80-race batteries, because an
//  average finishing position carries ±0.35 of noise at that sample size and
//  the medians carry almost none.
//
//  What this fit fixes and what it does not, both measured at impossible:
//  one-lap pace is LEVEL (it is what was fitted), so grids and poles spread
//  across the whole field. Race finishing spread improved from 3.8 to about
//  3.0 positions and there it STOPS: Senna, Verstappen and Alonso lose the
//  rest to crash rate (20-30% a race against Prost's 6-14%), and that
//  residual resisted every single-trait fix that was tried - err halved,
//  steerTau compressed, gap raised, overtake cut, compounds pinned, each
//  measured on 64-80 race batteries and none of them moved the wreck rate
//  outside its noise. Whatever prices aggression into the wall at impossible
//  is spread across several traits at once, and flattening them all would
//  flatten the drivers into one person. It is left: the wild trio really is
//  wilder, and pays for it - more than the original design intended, less
//  than before this fit.
const AI_DRIVER_STYLES = {
    // Blinding through the quick stuff and peerless in the rain; gives it back
    // on the straights and lives closest to the edge - by far the most mistakes.
    'Ayrton Senna':       { corner: 1.030, straight: 0.978, brake: 1.05, steerTau: 0.75, err: 1.90, overtake: 1.00, gap: 0.85, defend: 0.95, wet: 1.026, cleanAir: 1, look: -6, trim: 1.0102 },
    // The Professor: never errs, superb alone - and genuinely poor in the wet
    // and reluctant wheel to wheel.
    'Alain Prost':        { corner: 0.985, straight: 1.028, brake: 0.88, steerTau: 1.45, err: 0.22, overtake: 0.70, gap: 1.25, defend: 0.55, wet: 0.988, cleanAir: 1.01, look: 10, trim: 1.0019 },
    // Relentless metronome, brutal on defence, superb in the rain; nothing
    // special in clean air.
    'Michael Schumacher': { corner: 1.018, straight: 0.992, brake: 1.08, steerTau: 0.95, err: 0.60, overtake: 0.95, gap: 0.88, defend: 1.00, wet: 1.050, cleanAir: 0.999, look: 4, trim: 1.0005 },
    // Latest braker on the grid, never yields - and error-prone with it.
    'Max Verstappen':     { corner: 1.012, straight: 0.996, brake: 1.18, steerTau: 0.70, err: 1.10, overtake: 1.00, gap: 0.75, defend: 1.00, wet: 0.949, cleanAir: 0.998, look: -8, trim: 1.0271 },
    // Thrives in the wet and in a fight; the weakest of the lot on his own.
    'Lewis Hamilton':     { corner: 1.010, straight: 1.000, brake: 1.02, steerTau: 0.90, err: 0.75, overtake: 0.95, gap: 0.92, defend: 0.85, wet: 1.038, cleanAir: 0.997, look: 8, trim: 0.9978 },
    // Unbeatable wheel to wheel, ordinary once the road is clear.
    'Fernando Alonso':    { corner: 1.005, straight: 1.000, brake: 1.10, steerTau: 0.85, err: 0.70, overtake: 1.00, gap: 0.72, defend: 1.00, wet: 1.044, cleanAir: 0.997, look: 0, trim: 0.9972 },
    // Devastating in clean air and on a straight; hates traffic and the rain.
    'Sebastian Vettel':   { corner: 1.000, straight: 1.018, brake: 1.00, steerTau: 0.88, err: 0.85, overtake: 0.75, gap: 1.15, defend: 0.70, wet: 0.986, cleanAir: 1.014, look: -2, trim: 0.9938 },
    // Famously smooth and almost mistake-free; passive in a fight.
    'Jim Clark':          { corner: 1.022, straight: 0.986, brake: 0.96, steerTau: 1.40, err: 0.30, overtake: 0.80, gap: 1.05, defend: 0.60, wet: 1.011, cleanAir: 1.005, look: 8, trim: 0.9907 },
    // The computer: calculated risk, no heroics, no mistakes - and no pace in
    // the wet.
    'Niki Lauda':         { corner: 0.992, straight: 1.022, brake: 0.92, steerTau: 1.20, err: 0.28, overtake: 0.75, gap: 1.20, defend: 0.70, wet: 1.014, cleanAir: 1.008, look: 10, trim: 0.9846 },
    // Wins at the slowest speed necessary: no weakness, no standout either.
    'Juan Manuel Fangio': { corner: 1.005, straight: 1.006, brake: 0.94, steerTau: 1.30, err: 0.32, overtake: 0.90, gap: 1.10, defend: 0.80, wet: 1.015, cleanAir: 1.003, look: 4, trim: 0.9961 }
};

// Physics constants mirrored from car.js - keep in sync if the car changes.
// These are the BASE car. Since the chassis choice moves all three of them,
// nothing may read these directly any more: the AI asks the car it is driving
// (aiSteerOf / aiTopOf / aiGripOf below). An AI reading the base numbers while
// sitting in a different chassis is the worst of both worlds - it would brake
// for corners its car could take flat, and aim at a top speed it does not have.
// Above this the corner is quick enough that rotating the car is just scrub:
// powerOversteer is (demand - 1.45)/2.2 and demand falls with speed, so past
// about 200 px/s there is nothing to provoke anyway.
const AI_PROVOKE_SPEED = 190;
// How far out on the road the car may be and still be provoked. 0.70 was the
// first guess and it switched the whole thing off: the racing line HUGS the
// edges, so in a corner `edge` sits well above that and the condition was
// never true. 0.88 is just inside where the AI already starts scrubbing speed
// for running wide (0.90), so the two agree about what "in trouble" means.
const AI_PROVOKE_EDGE = 0.88;
const AI_MAX_STEER = Math.PI * 0.7;
const AI_TOP_SPEED = 355;      // enginePower / baseFriction
const AI_BASE_GRIP = 1200;
const aiSteerOf = (car) => (car && car.maxSteer) || AI_MAX_STEER;
const aiTopOf = (car) => (car && car.enginePower && car.baseFriction)
    ? car.enginePower / car.baseFriction : AI_TOP_SPEED;
const aiGripOf = (car) => (car && car.baseGrip) || AI_BASE_GRIP;
const AI_CORNER_SAFETY = 0.90; // never ask for more than 90% of the theoretical limit
// The camber constant, which MUST be the same number car.js uses: an AI that
// thinks the road leans more than it does commits to a corner that is not
// there. Same failure mode as WET_GRIP, which was wrong here for weeks and had
// the field driving past the limit in every wet corner - so this reads the
// car's own value when car.js is loaded and only falls back if it is not.
const AI_RELIEF_BANK = (typeof RELIEF_BANK !== 'undefined') ? RELIEF_BANK : 200;
// ...and a direct term for camber on top of the grip one, because in this
// model the STEERING RATE is what usually binds and camber does not touch it:
// without this a banked corner would be worth nothing to the AI and an
// off-camber one would be free.
//
// ASYMMETRIC, and the second number is now unused: no circuit has a negative
// bank any more (see the note at CascadeTrack). It is kept because the sign is
// honoured everywhere else, and because it records something measured: slowing
// the entry barely touches an off-camber slide. The sideways share of a car's
// speed through a -0.85 corner was 28-30% at a caution of 0.10 and still 28%
// at 0.30, because the slide is not an entry-speed mistake - it is 200 px/s2
// of gravity pushing the car outward for as long as the corner lasts, and no
// approach speed makes that go away. Which is most of why off-camber went.
const AI_BANK_GAIN = 0.10;      // credit for a road that leans in
const AI_BANK_CAUTION = 0.22;   // and respect for one that leans out
// Running out of road (block 5): how much of the half-width a car may use
// before its error is turned away - 14px leaves the body of a sideways car
// inside the white line - and the shortest distance the turning-away is
// planned over, so that being a few px wide at the next node does not read
// as an emergency stop.
const AI_EDGE_MARGIN = 14;
// Off the grid, hold the grid column until the start caution ends (see
// updateTraffic). Every car used to aim at the racing line the moment the
// lights went out, ten cars into one file before turn 1; measured at
// Impossible on the optimised lines, heavy contacts in the first six seconds
// went from 13-21 per 24 races to 4 with this on.
const AI_HOLD_COLUMN = true;
const AI_CONVERGE_MIN = 50;
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
// How close you have to be before pulling out of the queue is worth it.
// Without this the trigger was the whole 140px following window, so every car
// in a train offset itself from the one in front and the queue fanned out
// across the road. Measured at Circle - one continuous corner, where the
// outside line is nearly twice the distance of the inside - eight of the ten
// cars spent 100% of the race in traffic lapping 19-26% off their own solo
// pace, at a HIGHER average speed than the leaders: they were driving the long
// way round. Inside this range a move is on; outside it, sit in the tow.
const AI_PASS_RANGE = 72;
// Virtual room added to the inside of a corner when choosing which way to go.
// "The side with the most room" is always the outside, and the outside of a
// corner is the long way round; this is what stops the AI from queueing up
// around the outside of everything.
const AI_INSIDE_BONUS = 40;

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
        const prof = AI_PROFILES[this.difficulty];
        const floor = prof.skillFloor === undefined ? 0.8 : prof.skillFloor;
        const raw = (skillVariation === null || skillVariation === undefined || !isFinite(skillVariation))
            ? 0.8 + Math.random() * 0.3
            : skillVariation;
        this.skillVariation = Math.max(floor, Math.min(1.1, raw));

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
        // defending (see updateTraffic): one committed move, held to the corner
        this.coverActive = false;
        this.coverLat = 0;
        this.coverS = -1;       // lap distance of the corner being covered
        this.coverGrace = 0;
        this.coverLog = 0;
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
        // and keep the grid column down to turn 1 (updateTraffic)
        this.holdColumn = AI_HOLD_COLUMN;
        this.holdLat = undefined;
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

        const scan = (from, count, directed) => {
            let fall = -1, fallD = Infinity;
            for (let o = 0; o < count; o++) {
                const i = (from + o + N * 4) % N;
                const d = (car.x - nodes[i].cx) ** 2 + (car.y - nodes[i].cy) ** 2;
                if (d < fallD) { fallD = d; fall = i; }
            }
            if (!directed) return { idx: fall, d2: fallD };

            // A whole-lap scan only happens after a spin or a shunt, and on a
            // circuit that crosses itself the nearest node can belong to the
            // other road. Direction settles it - but ONLY between nodes that
            // are equally close in space and far apart along the lap, which is
            // what a crossing is. Preferring an aligned node outright would
            // change how every other circuit reads.
            const sp = Math.hypot(car.velocity.x, car.velocity.y);
            const dx0 = sp > 25 ? car.velocity.x / sp : Math.cos(car.angle);
            const dy0 = sp > 25 ? car.velocity.y / sp : Math.sin(car.angle);
            const near = Math.sqrt(fallD) + 8;
            const apart = 72;
            let best = fall, bAlign = nodes[fall].tx * dx0 + nodes[fall].ty * dy0;
            for (let o = 0; o < count; o++) {
                const i = (from + o + N * 4) % N;
                if (i === fall) continue;
                const d = Math.hypot(car.x - nodes[i].cx, car.y - nodes[i].cy);
                if (d > near) continue;
                if (Math.abs(nodes[i].s - nodes[fall].s) < apart) continue;
                const al = nodes[i].tx * dx0 + nodes[i].ty * dy0;
                if (al > bAlign + 0.25) { bAlign = al; best = i; }
            }
            return { idx: best,
                     d2: (car.x - nodes[best].cx) ** 2 + (car.y - nodes[best].cy) ** 2 };
        };

        let res;
        if (this.nodeIdx < 0) {
            res = scan(0, N, true);
        } else {
            const window = Math.max(40, Math.round(220 / line.ds));
            res = scan(this.nodeIdx - 12, window, false);
            // Lost it (spun, punted, teleported after a false start): rescan.
            if (res.d2 > 200 * 200) res = scan(0, N, true);
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
        const steerRate = aiSteerOf(car) * steerEff;
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
            // WET_GRIP is car.js's number, imported rather than copied. It used
            // to be written out here as 0.20 with a comment saying it matched
            // car.js exactly. It had not matched for some time: car.js was taken
            // to 0.13 so that rain would cost real lap time, and this line was
            // not moved with it.
            //
            // The consequence was not a rounding. In the rain the AI believed it
            // had 0.20/0.13 = 1.54x the grip it actually had, so it aimed at a
            // corner speed about 24% too high, ran wide of the limit and scrubbed
            // - and the better a driver's wetSkill, the further past the limit it
            // aimed. That is why the wet-weather ranking came out inverted, with
            // the drivers meant to be strongest in the rain slowest in it: the
            // wet balance could not work while the AI was driving to a circuit
            // that was 54% grippier than the one underneath it.
            // The compound's own contribution has to be here for the same
            // reason: an AI on full wets that aims at intermediate speeds is
            // throwing away most of what the tyre is for, and an AI on slicks
            // in the rain that does not know it will drive off the road.
            // Through the same function the physics uses, so the AI knows a
            // full wet is over-tyred on a damp road rather than driving to the
            // grip it would have had in a downpour.
            const rainGrip = tyreRainGrip(car.tyre);
            // wetGripNow, not WET_GRIP: a damp track is grippier than a
            // soaked one, and an AI that does not know which kind of wet it is
            // driving on is the WET_GRIP bug all over again with a new name.
            gripScale = wetGripNow() * rainGrip * (this.p.wetSkill || 1);
        }
        if (onGrass) gripScale *= 0.3;
        else if (onKerb) gripScale *= 0.80;
        const latLimit = aiGripOf(car) * gripScale * 0.85;

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

        // What the tyres are actually giving right now. Two numbers, because
        // car.js has two: tyrePerf is the lateral grip, tyreSteer is the same
        // thing with the compound's `bite` on the steering rate folded in. The
        // AI has to aim to the same limits or it will keep entering corners at
        // soft-tyre speed on a worn set of hards.
        const tyreF = car.tyreSteer || car.tyrePerf || 1;
        const tyreG = car.tyrePerf || 1;

        const cornerCap = (idx) => {
            const nd = nodes[idx];
            const R = radiusOf(nd);
            // vCorner is tabulated for nd.radius; rescale it for the radius we
            // are actually willing to commit to (v scales ~ with R here).
            // A compound's `hook` is worth more the slower you are going, so the
            // steering rate available in a corner depends on the speed you take
            // it at - which is the thing being solved for. Two passes of fixed
            // point: guess with the flat rate, read the hook at that speed,
            // solve again. The map is monotone and the second pass moves the
            // answer by well under a per cent, so a third would be theatre.
            //
            // It has to be here at all for the same reason WET_GRIP does: an AI
            // that does not know the tyre gains steering in the slow corners
            // will brake for a speed it could have beaten, and the compound's
            // whole point disappears into a safety margin.
            const flat = aiSteerOf(car) * tyreF;
            let vSteer = flat / (1 / R + flat / 500);
            for (let k = 0; k < 2; k++) {
                const s = flat * tyreHookAt(car.tyre, vSteer);
                vSteer = s / (1 / R + s / 500);
            }
            // A loose compound driven "sent" - throttle down through the
            // corner, the tail out - rotates faster than its steering rate
            // says (the oversteer yaw adds to it), so the car can commit to
            // more speed. AI.driftSend is how much more; 0 is the default and
            // means the AI feathers it instead (block 5c). It exists so the
            // tyre's potential in a person's hands can be MEASURED with the
            // game's own driver (driftsend.js), which is how SCRUB_RATE in
            // car.js was set.
            if (AI.driftSend && car.tyre && car.tyre.loose && vSteer > AI.driftSendFrom)
                vSteer *= 1 + AI.driftSend;
            // CAMBER. Banked into the corner, gravity holds the car in and
            // the tyre has less to find, so the same radius can be taken
            // faster; off-camber the same slope takes it away again. It is
            // added to the grip limit rather than multiplied through it,
            // because that is what it physically is - a force the tyre never
            // has to generate - and the steering-rate limit is deliberately
            // left alone: the nose still has to be pointed round the corner
            // however much the road is leaning.
            const bank = nd.bank || 0;
            const vGrip = Math.sqrt(Math.max(60, latLimit * tyreG + AI_RELIEF_BANK * bank) * R);
            const cf = Math.min(this.p.cornerFactor * (1 + AI_ATTACK_CORNER * atk),
                                Math.max(this.p.cornerFactor, AI_ATTACK_CORNER_CAP));
            // The tabulated ceiling has to move with the hook too, or it clamps
            // the gain straight back off again.
            const tabF = tyreF * tyreHookAt(car.tyre, vSteer);
            // ...and a small direct term on top, because on this circuit the
            // steering rate is what usually binds, and a limit the camber
            // never touches would make a banked corner worth nothing to the
            // AI and an off-camber one free. Measured, not guessed: see
            // test_relief.js, which drives both and compares.
            const bankF = 1 + (bank > 0 ? AI_BANK_GAIN : AI_BANK_CAUTION) * bank;
            return Math.min(nd.vCorner * 1.35 * tabF, vSteer, vGrip) *
                   AI_CORNER_SAFETY * cf * bankF;
        };

        // Under the VSC everyone has the same reduced power, so the AI must
        // aim lower too rather than sitting at full throttle pointlessly.
        const vscF = (typeof vscPowerFactor !== 'undefined') ? vscPowerFactor : 1;
        let vTop = aiTopOf(car) * this.p.straightFactor * condition * vscF;
        // ...e sotto la VSC il tetto e' quello e basta: uguale per tutti i
        // telai e tutti i piloti, altrimenti la neutralizzazione cambia i
        // distacchi invece di congelarli.
        if (vscF < 1 && typeof VSC_SPEED !== 'undefined') vTop = VSC_SPEED;
        if (car.draftStrength > 0) vTop *= 1 + 0.17 * car.draftStrength;
        if (onGrass) vTop = Math.min(vTop, 150);
        else if (onKerb) vTop *= 0.95;
        if (typeof isRaining !== 'undefined' && isRaining) vTop *= 0.97;

        // Clean-air specialists (Vettel, Prost, Lauda) find that extra tenth
        // when there is nobody to worry about in front.
        if (this.p.cleanAir !== 1 && this.followSpeed === Infinity) vTop *= this.p.cleanAir;

        // ---- running out of road -------------------------------------------
        // The speed profile above is the LINE's: the radius at each node ahead
        // says how fast that node can be taken BY A CAR ON THE LINE. A car that
        // is wide of where it means to be - shuffled out by traffic, holding a
        // defensive line, sliding on worn tyres - is not on the line, and on a
        // real racing line that matters: the line itself runs out to the edge
        // of the road at the exit of every corner, so a car 30px wide of it
        // there is 30px onto the grass. With the old, inside-hugging line the
        // outside of every corner was spare road and the error was free; with
        // the optimised lines (track.js, THE LINE) it put cars in the wall -
        // measured at Impossible, 1.4 retirements a race against 0.7, and
        // the wall damage, previously nil, was a third of the total.
        //
        // So each node ahead is also asked: where will the car be if it keeps
        // its present error, and does that fit on the road? Where it does not,
        // the excess has to be turned away over the distance to that node -
        // curvature 2e/d^2 on top of the line's own - and that tighter path
        // has its own steering-limited speed, which caps the profile like any
        // corner. Nothing changes for a car on its line (e = 0); a car that
        // is wide slows by exactly what it needs to get back, and no more.
        const targetHere = this.nodePos(line, i, totalOffset);
        const errLat = (car.x - here.cx) * here.nx + (car.y - here.cy) * here.ny
                     - ((targetHere.x - here.cx) * here.nx + (targetHere.y - here.cy) * here.ny);
        const roomEdge = halfWidth - AI_EDGE_MARGIN;
        const wSteer = aiSteerOf(car) * tyreF;
        const wideCap = (idx, dist) => {
            if (Math.abs(errLat) < 2) return Infinity;
            const nd = nodes[idx];
            let tgt = nd.alpha * this.p.lineBlend + totalOffset;
            const lim = line.maxOffset;
            if (tgt > lim) tgt = lim; else if (tgt < -lim) tgt = -lim;
            const excess = Math.abs(tgt + errLat) - roomEdge;
            if (excess <= 0) return Infinity;
            const d = dist < AI_CONVERGE_MIN ? AI_CONVERGE_MIN : dist;
            const kConv = 2 * excess / (d * d);
            const kLine = 1 / radiusOf(nd);
            return wSteer / (kLine + kConv + wSteer / 500) * AI_CORNER_SAFETY * this.p.cornerFactor;
        };

        let vTarget = Math.min(vTop, cornerCap(i));
        for (let o = 1; o <= scanNodes; o++) {
            const idx = (i + o) % N;
            const dist = o * ds;
            const cap = Math.min(cornerCap(idx), wideCap(idx, dist));
            const allowed = Math.sqrt(cap * cap + 2 * aBrake * dist);
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

        // ================================================================
        //  5b. PROVOKING THE CAR
        // ================================================================
        //  Everything above is a speed profile: work out how fast the corner
        //  can be taken, then hold that speed. It is a good way to be quick and
        //  it is not how a person drives - a driver rotating a slow corner
        //  keeps the power on THROUGH it and lets the tail come round.
        //
        //  The AI never did, and it showed. powerOversteer needs thr > 0 and
        //  lock on at the same time; in a slow corner the AI sits in its dead
        //  band with the throttle shut. Measured over four laps: the AI carries
        //  0.12 to 0.19 of oversteer in the slow stuff and leaves ZERO skid
        //  marks on every circuit in the game, where a person carries 0.68 and
        //  leaves dozens. It is also why the drift compound measured badly in
        //  AI hands for weeks - the tyre's whole point is a mechanism the AI
        //  was not using.
        //
        //  So: in a slow corner, at the corner speed, with lock on, feed the
        //  throttle back in. Only ever ADDS throttle - Math.max - so it can
        //  never slow a car that was already accelerating.
        const prov = this.p.provoke || 0;
        if (prov > 0 && this.steerDir !== 0 && !car.inputs.down &&
            speed > 25 && speed < AI_PROVOKE_SPEED) {
            // Only once it has finished braking and is at the corner speed.
            // Provoking on the way in would just carry too much speed to the
            // apex, which is understeer, not rotation.
            const settled = speed > vTarget * 0.88 && speed < vTarget * 1.05;
            // And not when the tyre is already saturated: gripUse is last
            // frame's lateral demand against the clamp, so this is the car
            // telling the driver it has nothing left. Feeding it more there is
            // how you spin rather than how you rotate.
            const room = (car.gripUse || 0) < 0.80;
            // And only from a position it can afford to lose a little. `edge`
            // is how close the car already is to the limit of the road; a
            // driver running wide is gathering the car up, not throwing it in
            // further. Without this, Kart at provoke 0.50 spent 14% of the lap
            // on the grass and cut most of a corner - which the stopwatch
            // reported as a 24% improvement, because a lap you did not drive
            // is always quick.
            const safe = edge < AI_PROVOKE_EDGE;
            if (settled && room && safe) {
                // HOW MUCH THROTTLE, and the first version had this backwards.
                //
                // The tail only starts to move once `demand` clears 1.45, and
                // demand is enginePower x thr / speed - so the throttle needed
                // RISES with speed. The first attempt tapered it the other way,
                // `prov * (1 - speed/190)`, which fed least where most was
                // needed: at 150 px/s no setting below 0.74 produces any
                // oversteer at all, and the whole sweep from 0.35 to 1.10 came
                // back identical to two decimal places because none of it ever
                // crossed the threshold.
                //
                // So the parameter is expressed against the threshold itself.
                // provoke 0 sits exactly on it and nothing happens; provoke 1
                // is flat out. What it means is "how far past the point where
                // the car starts to rotate", which is what a driver is choosing.
                const P = (car.enginePower || 296) * (car.condition || 1);
                // The onset is the TYRE's, not a constant: a loose compound
                // (car.js, `loose`) starts to rotate at a fraction of the
                // demand a slick needs, and provoke means "how far past the
                // onset", so it has to be measured from where the onset is.
                const onset = 1.45 - ((car.tyre && car.tyre.loose) || 0);
                const need = Math.min(1, onset * Math.max(70, speed) / Math.max(1, P));
                const want = Math.min(1, need + prov * (1 - need));
                // The EFFECTIVE throttle, and READ BEFORE `up` is forced on.
                // Two bugs lived on these three lines. First, reading the
                // `throttle` field alone says 0 on a frame the car is flat out,
                // because the AI leaves it undefined and car.js falls back to
                // the boolean - writing 0.3 over that is a brake pedal, and
                // oversteer FELL from 0.152 to 0.004 at Thunder. Then, fixing
                // that by reading `up`, the read happened AFTER this block had
                // already set `up = true`, so it always came back 1 and the
                // whole provoke parameter did nothing: a sweep from 0.15 to
                // 1.10 returned identical lap times to two decimal places.
                const had = car.inputs.throttle !== undefined ? car.inputs.throttle
                                                             : (car.inputs.up ? 1 : 0);
                car.inputs.up = true;
                car.inputs.throttle = Math.max(had, want);
            }
        }

        // ================================================================
        //  5c. A LOOSE COMPOUND AT SPEED
        // ================================================================
        //  On the drift tyre the same throttle that rotates a hairpin
        //  oversteers a fast corner - its onset sits at 430 px/s, so with lock
        //  on and the pedal down the tail is out at any speed the AI ever
        //  corners at. Measured before this block: all ten cars on drift at
        //  the Oval, best lap 36% slower than on the medium, from a controller
        //  fighting the yaw it kept provoking. A person feeds the power in
        //  there; so does this. Above the provoke band, steering, the throttle
        //  is capped where demand stays a tenth under the onset - 25 to 55%
        //  between 200 and 400 px/s. Slower out of a fast corner, which is the
        //  price of the compound, and not sideways.
        if (car.tyre && car.tyre.loose && car.inputs.up && this.steerDir !== 0 &&
            speed >= AI_PROVOKE_SPEED) {
            if (AI.driftSend) {
                // Sent: keep it lit, lift only when the slide is past catching.
                // This is the default; the feathering branch below is kept for
                // AI.driftSend = 0 and is what the first version did.
                const vdir = Math.atan2(car.velocity.y, car.velocity.x);
                let slip = car.angle - vdir;
                while (slip > Math.PI) slip -= 2 * Math.PI;
                while (slip < -Math.PI) slip += 2 * Math.PI;
                if (Math.abs(slip) > 0.50) { car.inputs.up = false; car.inputs.throttle = 0; }
            } else {
                const onset = 1.45 - car.tyre.loose;
                const P = (car.enginePower || 296) * (car.condition || 1);
                const cap = Math.max(0.25, Math.min(1, onset * 0.9 * Math.max(70, speed) / Math.max(1, P)));
                const had = car.inputs.throttle !== undefined ? car.inputs.throttle : 1;
                car.inputs.throttle = Math.min(had, cap);
            }
        }

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

        // Which way the road is turning here, in the normal frame: the centre
        // of the corner lies on the side the tangent is rotating towards, and
        // that side is the short way round. +1 = inside is +n, -1 = inside is
        // -n, 0 = straight.
        const ahead4 = line.nodes[(i + 4) % line.count];
        const insideSign = Math.sign((ahead4.tx - here.tx) * here.nx +
                                     (ahead4.ty - here.ty) * here.ny) || 0;

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

        // ---- the esses rule ---------------------------------------------
        // Racing alongside through ALTERNATING tight corners is how mid-pack
        // cars destroy each other. Suzuka's wreck map (27 Aug 2026) at
        // Impossible: 4.3 retirements a race, 103 of 104 fatal blows were
        // car-on-car, nearly all on lap 1 in the esses - and none of them
        // during the start caution, so the column hold was innocent. The
        // mechanism: the alongside law below grants a car speed to hold a
        // position two-wide, which through one corner is a race and through
        // six alternating ones is a demolition derby - the racing line swings
        // 65px per arc, the two lanes have to cross, and the wheel-to-wheel
        // push grinds both cars along the kerbs six times in a row.
        //
        // So, real racecraft: nobody holds a car around the outside of a
        // slalom. When the line ahead alternates - a strong left run AND a
        // strong right run (radius < 300 sustained for ~50px each way) inside
        // the next 420px - the TRAILING car of an alongside pair gives up its
        // alongside rights, lifts to ~93% of the leader's speed and folds
        // back onto the line behind. One corner, a hairpin, a T1 complex all
        // stay one-signed in this window, so normal passing is untouched;
        // Spa's Bus Stop and the whole of Pettine flag too, which is correct
        // - they are slaloms.
        //
        // Measured (suzuka_wreckmap2, 24 races each). Suzuka at Impossible:
        // 4.33 -> 2.00 retirements a race; at Medium 0.5-0.97 -> 0.00. The
        // classics with the rule live: pettine 0.38, f1 0.25, oval 0.71 -
        // the healthy band. The same instrument put SPA at 2.42, nearly all
        // lap 1 at Eau Rouge: the identical two-wide-through-a-swing
        // mechanism, but at radii above this detector's 300 threshold, so
        // the rule does not reach it. Raising the threshold would flag fast
        // flowing sections on half the calendar and needs its own broad
        // regression pass - left measured and undone, deliberately.
        let _slalom = null;
        const slalomAhead = () => {
            if (_slalom !== null) return _slalom;
            const N = line.count, nodes = line.nodes;
            const lookN = Math.min(Math.ceil(420 / line.ds), N - 1);
            let runL = 0, runR = 0, hasL = false, hasR = false;
            // The window starts a little BEHIND the car: without that, the
            // rule expired two arcs before the exit (the window ahead was
            // all one sign by then) and the deaths simply moved to the last
            // esses - measured, seg13-16 took over from seg6-8.
            for (let o = -10; o < lookN; o++) {
                const j = (i + o + N) % N;
                const nd = nodes[j];
                if ((nd.radius || 1e9) < 300) {
                    const n2 = nodes[(j + 2) % N];
                    const cross = nd.tx * n2.ty - nd.ty * n2.tx;
                    if (cross > 0) { runL++; runR = 0; }
                    else if (cross < 0) { runR++; runL = 0; }
                } else { runL = 0; runR = 0; }
                if (runL >= 6) hasL = true; else if (runR >= 6) hasR = true;
                if (hasL && hasR) break;
            }
            return (_slalom = hasL && hasR);
        };
        // Who gives way in a pair: whoever is behind - and a dead-even pair
        // (|fwd| <= 2, where neither reads as trailing) is broken by list
        // order, so exactly one of the two backs out instead of neither.
        const yieldsTo = (fwd, other) => fwd > 2 ||
            (fwd > -2 && cars.indexOf(car) > cars.indexOf(other));

        if (typeof cars !== 'undefined' && cars.length > 1) {
            const tx = here.tx, ty = here.ty;
            const nx = here.nx, ny = here.ny;

            for (const other of cars) {
                if (other === car || other.isBroken) continue;
                // A car in the pit sequence is in the pits, not on the road:
                // nothing to follow, nothing to defend against.
                if (other.pitPhase) continue;
                // A car on the bridge and a car under it are not traffic for
                // one another, however close they look from above.
                if (track.sameLevel && !track.sameLevel(car, other)) continue;

                const dx = other.x - car.x;
                const dy = other.y - car.y;
                if (dx * dx + dy * dy > 170 * 170) continue;

                const fwd = dx * tx + dy * ty;      // down the road (+ = ahead)
                const side = dx * nx + dy * ny;      // across the road
                const otherLat = latCar + side;

                if (fwd > -4 && fwd < 140 && Math.abs(side) < 34) {
                    // ---- someone is in our path -------------------------
                    if (fwd < bestFwd) {
                        bestFwd = fwd;

                        // A car that is all but stopped in the road - spun,
                        // shunted, stalled - is an obstacle, not a car to
                        // follow, and it is dealt with differently twice below:
                        // the move round it starts from the whole window rather
                        // than from passing range, and the closing speed is
                        // what the brakes can actually shed, not the follow law.
                        const theirFwd0 = other.velocity.x * tx + other.velocity.y * ty;
                        const ourFwd0 = car.velocity.x * tx + car.velocity.y * ty;
                        const obstacle = theirFwd0 < 80 || theirFwd0 < 0.6 * ourFwd0;

                        // The esses rule (above): trailing into a slalom, the
                        // move is off - no aiming beside them, and no
                        // alongside speed rights below. A stopped car is
                        // still swerved round: obstacles override the rule.
                        const bail = !obstacle && slalomAhead() && yieldsTo(fwd, other);

                        // Choose a side - but only if a move is actually on.
                        // Beyond AI_PASS_RANGE we hold the racing line and use
                        // the speed cap below, which is what keeps a queue a
                        // queue instead of a fan.
                        if (!bail && fwd < (obstacle ? 140 : AI_PASS_RANGE)) {
                        hasTarget = true;
                        // The side with the most room is the outside of the
                        // corner, and the outside is the long way round. Give
                        // the inside some virtual room, in proportion to how
                        // tight the corner is - nothing on a straight, the
                        // full bonus on a hairpin.
                        const tight = Math.min(1, 700 / Math.max(1, here.radius || 1e6));
                        const inside = insideSign * AI_INSIDE_BONUS * tight;
                        const roomRight = lim - Math.max(otherLat, latCar) + Math.max(0, inside);
                        const roomLeft = lim + Math.min(otherLat, latCar) + Math.max(0, -inside);
                        let dir;
                        if (Math.abs(this.lateralOffset - (-lineLat)) > 10 && Math.abs(this.lateralOffset) > 6) {
                            dir = Math.sign(this.lateralOffset) || 1;
                        } else {
                            dir = roomRight >= roomLeft ? 1 : -1;
                        }
                        if (dir > 0 && roomRight < 20 && roomLeft > roomRight) dir = -1;
                        if (dir < 0 && roomLeft < 20 && roomRight > roomLeft) dir = 1;

                        const step = 26 + 16 * this.p.overtake;
                        // Aim beside them - but never further from the racing
                        // line than one move is worth. The target used to be
                        // purely relative to the car ahead, so in a queue the
                        // offsets CASCADED: the second car pulled out from the
                        // first, the third from the second's already-wide
                        // position, and by the eighth the train was spread
                        // across the whole road. Clamping to a lane either side
                        // of the line makes them queue in two lanes instead of
                        // fanning out.
                        const passLim = Math.min(lim, step + 14);
                        desired = Math.max(-passLim, Math.min(passLim,
                                           (otherLat + dir * step) - lineLat));
                        }

                        // ---- car following: never drive into their gearbox
                        if (fwd > -6 && Math.abs(side) < 30) {
                            const theirFwd = other.velocity.x * tx + other.velocity.y * ty;
                            // Through a slalom, following distance is not
                            // about braking - the car ahead SWINGS, and a
                            // nose inside its swing envelope gets clipped by
                            // crossing paths. Hold back roughly an arc: the
                            // 16-21px race gap at Impossible reads as
                            // "share the arc with me", and the wreck map
                            // shows how that ends. Attack mode does not get
                            // to shrink this one.
                            const gap = fwd - safeGap - (slalomAhead() ? 55 : 0);
                            let v = theirFwd + gap * this.p.gapGain;
                            if (v < 0) v = 0;
                            // The follow law above is for a car that is MOVING:
                            // gap x gapGain reads 244 px/s at 100px from a
                            // stationary one, which the brakes cannot turn into
                            // a stop in 100px. Against an obstacle the cap is
                            // the speed the brakes can shed over the gap. This
                            // is where the optimised lines were losing cars:
                            // not in the wall, but arriving at 150-230 px/s on
                            // a car spun across the road - pairs of retirements
                            // at the same second in the log.
                            if (obstacle) {
                                const aStop = (150 + 0.55 * speed) * this.p.brakeConfidence;
                                const vStop = Math.sqrt(Math.max(0, theirFwd * theirFwd + 2 * aStop * Math.max(0, gap)));
                                if (vStop < v) v = vStop;
                            }

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
                            if (bail) {
                                // Tuck in: drop to 93% of their pace until
                                // we are clearly behind. The floor keeps a
                                // conceding car rolling - a crawler in the
                                // middle of a slalom is an obstacle.
                                const tuck = Math.max(45, theirFwd * 0.93);
                                if (tuck < v) v = tuck;
                            } else if (clear >= AI_CLEAR_SIDE) {
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
                    } else if (slalomAhead() && yieldsTo(fwd, other)) {
                        // The esses rule again: wheel to wheel with a slalom
                        // coming, the trailing car backs out BEFORE the
                        // contact, not after it.
                        const theirFwd = other.velocity.x * tx + other.velocity.y * ty;
                        const concede = Math.max(45, theirFwd * 0.93);
                        if (concede < this.followSpeed) this.followSpeed = concede;
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

        // ---- defending: ONE move, made early, held to the corner ----------
        // Schumacher / Verstappen / Alonso make themselves very hard to pass;
        // Prost and Lauda concede rather than risk the car.
        //
        // The first version MIRRORED the attacker frame by frame - cover =
        // our line plus defend times (his line minus ours) - which is
        // weaving with extra steps, and it knew nothing about the circuit:
        // it covered the middle of a straight and left open the inside of
        // the next corner, which is the one place a pass actually happens.
        //
        // Now it is a commitment, the real one-move rule. When a same-lap
        // car sits on our tail, the defender picks its spot ONCE - the
        // inside of the next corner, found by walking the line ahead; on a
        // long straight, the side the attacker is coming on - moves there,
        // and holds that line. No re-crossing, no tracking the feints: if
        // the attacker flickers out of the detection window because we
        // moved, the line is held on a grace timer rather than snapped
        // back, because snapping back would be the second move. The hold
        // ends when the fight moves on: attacker alongside or ahead (that
        // is racing, handled above), attacker gone, the covered corner
        // passed (the move spent - the next corner is a new decision),
        // blue flag, or the VSC. How much of the road the cover takes is
        // p.defend, so Prost still leaves the door ajar where Schumacher
        // parks the car in front of it.
        this.coverLog = Math.max(0, this.coverLog - dt);
        const vscHeld = (typeof vscPowerFactor !== 'undefined') && vscPowerFactor < 1;
        const mayDefend = this.p.defend > 0.05 && !this.car.blueFlag && !vscHeld;
        if (hasTarget || !mayDefend) {
            // somebody ahead or alongside, a flag, or the VSC: not defending
            this.coverActive = false;
        } else if (attacker) {
            this.coverGrace = 0;
            if (this.coverActive && this.coverS >= 0) {
                // the corner we covered is behind us: that move is spent
                const gone = (here.s - this.coverS + line.length) % line.length;
                if (gone > 40 && gone < line.length / 2) this.coverActive = false;
            }
            if (!this.coverActive) {
                // find the inside of the next corner worth covering
                let coverLat = null;
                this.coverS = -1;
                for (let k = 2; k <= 60; k++) {
                    const nd = line.nodes[(i + k) % line.count];
                    const gain = (nd.s - here.s + line.length) % line.length;
                    if (gain > 300) break;
                    if ((nd.radius || 1e6) < 420) {
                        const a2 = line.nodes[(i + k + 4) % line.count];
                        const sgn = Math.sign((a2.tx - nd.tx) * nd.nx +
                                              (a2.ty - nd.ty) * nd.ny) || 0;
                        if (sgn) {
                            coverLat = sgn * (lim - 6);
                            this.coverS = nd.s;
                            break;
                        }
                    }
                }
                if (coverLat === null) {
                    // open road: block the side he is coming on, once
                    const attLat = (attacker.x - here.cx) * here.nx +
                                   (attacker.y - here.cy) * here.ny;
                    coverLat = Math.abs(attLat - latCar) > 6
                        ? Math.sign(attLat - latCar) * (lim - 6)
                        : (latCar >= 0 ? 1 : -1) * (lim - 6);
                }
                this.coverActive = true;
                this.coverLat = latCar + (coverLat - latCar) * this.p.defend;
                if (this.coverLog <= 0 && typeof RaceLog !== 'undefined' && RaceLog.event) {
                    RaceLog.event('DEFEND', (car.driverName || car.color) +
                        ' covers the line against ' +
                        (attacker.driverName || attacker.color));
                    this.coverLog = 6;
                }
            }
            desired = Math.max(-lim, Math.min(lim, this.coverLat)) - lineLat;
            hasTarget = true;
        } else if (this.coverActive) {
            // he vanished from the window - possibly because we moved. Hold
            // the line a moment instead of snapping back into a weave.
            this.coverGrace += dt;
            if (this.coverGrace > 0.7) {
                this.coverActive = false;
            } else {
                desired = Math.max(-lim, Math.min(lim, this.coverLat)) - lineLat;
                hasTarget = true;
            }
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

        // Off the grid every car used to aim at the racing line at once - ten
        // cars into one file before turn 1. While the start caution lasts, hold
        // the grid column instead: the offset is set once from where the car
        // actually is and frozen; the follow law and the wheel-to-wheel push
        // still act. Released with the caution, after which the offset decays
        // back to the line at the usual rate.
        if (this.holdColumn) {
            if (this.startCaution > 0) {
                if (this.holdLat === undefined) this.holdLat = latCar - lineLat;
                if (!inContact) desired = Math.max(-lim - lineLat, Math.min(lim - lineLat, this.holdLat));
            } else {
                this.holdColumn = false;
            }
        }

        // Niente da scansare: la gru non tocca terra (vedi LA GRU in main.js).
        // The offset is measured from the RACING LINE, but the limit belongs to
        // the TRACK, so it has to be clamped in centre-line terms. It used to be
        // clamped as |desired| <= lim, which on a circuit whose line sits hard
        // against the inside kerb - Circle has alpha at the full -60 the whole
        // way round - allowed an aim point 120px from the middle of a road only
        // 80px wide. Nobody actually drove off, the aim point simply dragged the
        // queue out towards the outside of the corner, which is the long way
        // round: the trapped cars were lapping 20% slower than the leaders at a
        // HIGHER average speed.
        const hi = lim - lineLat, lo = -lim - lineLat;
        if (desired > hi) desired = hi;
        if (desired < lo) desired = lo;

        // Rate-limited lateral movement -> smooth, believable weaving
        // (faster when we are actually rubbing against someone).
        // Returning to the line stays slower than leaving it. Tried at 105 to
        // pull the shuffled-wide cars back sooner: it did nothing for the pace
        // (Circle 14.5% against 13.9%) and put two cars in the wall at the Oval,
        // because a car snapping back onto the line lands on whoever is there.
        const rate = inContact ? 170 : (hasTarget ? 110 : 60);
        const delta = desired - this.lateralOffset;
        const maxStep = rate * dt;
        this.lateralOffset += Math.max(-maxStep, Math.min(maxStep, delta));
    }
}

// -----------------------------------------------------------------------------
//  Profile construction, shared by the live AI and by qualifying simulation.
// -----------------------------------------------------------------------------
// Chi ha il pacchetto buono quest'anno: { driver, boost } in campionato,
// null in gara singola. Lo scrive main.js a ogni sessione.
AI.seasonRival = null;
// How much extra corner speed the AI commits to on a loose compound, driving
// it SENT - throttle down, tail out, lifting only past 29 degrees of slide -
// rather than feathered (block 5c), and from what corner speed up (0 = in
// the hairpins too, which is where the tyre is now meant to be driven).
// Measured with the full grid of ten, random talent and chassis, dry
// (aidrift.js), drift against medium with the third-pass physics: at 0.20
// from 0 the AI on the drift tyre is level on Comb, Kart and Thunder and
// 1-5% off on Harbour, F1 and the Oval - the specialist's shape - with no
// retirements and nobody backwards; feathered it was 3-7% off everywhere.
// And it drifts visibly, which is what Nicola asked for ("the AI cannot use
// it to drift through the corners"). 0 turns it off.
AI.driftSend = 0.20;
AI.driftSendFrom = 0;

AI.buildProfile = function (driverName, difficulty, skillVariation) {
    const base = AI_PROFILES[difficulty] ? AI_PROFILES[difficulty] : AI_PROFILES.medium;
    const p = Object.assign({}, base);

    // skillFloor lifts the bottom of the skill range. Everywhere but Alien it
    // is 0.8, the full spread; at Alien it is 1.1, so every car in the field
    // runs at the top of it.
    const floor = base.skillFloor === undefined ? 0.8 : base.skillFloor;
    const sv = Math.max(floor, Math.min(1.1, isFinite(skillVariation) ? skillVariation : 0.95));
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
        // Who leans on the throttle to turn the car. The same two traits that
        // decide who reaches for the drift compound: living on the edge, and
        // quick hands to catch what that starts. Senna and Verstappen rotate
        // everything; Prost and Clark drive it round.
        p.provoke *= Math.max(0.25, Math.min(1.8,
            1 + (s.err - 0.7) * 0.30 + (1 - s.steerTau) * 0.45));
        // How far up the road they read, in pixels on top of the difficulty's
        // own look-ahead. This used to be one line of special case - Hamilton,
        // and nobody else, +14 - which is exactly the thing the balance rule
        // at the top of this table forbids: a real advantage that nothing is
        // traded against. It never entered the trim fit either, because trim
        // only scales corner and straight pace. Measured across 110 of
        // Nicola's own races, Hamilton finished 4.63 on average against 5.42
        // for the next man and took 14 of the 47 races the AI won between
        // them; he was the title rival every season, which is what he
        // reported. It is a column now: a trait like any other, visible,
        // spread across the field, and paid for in the refitted trim.
        p.lookBase += (s.look || 0);
    }

    // ---- il rivale della stagione ---------------------------------------
    // Dieci piloti tarati per finire a due decimi l'uno dall'altro sono equi
    // e, su cinque round, piatti: non c'e' nessuno da battere in particolare.
    // Quindi in campionato UNO di loro - estratto a sorte a inizio stagione,
    // mai il giocatore - passa l'anno con qualcosa in piu'. Non e' un ritorno
    // al caso Hamilton: quello era cablato su un nome, invisibile e per
    // sempre; questo cambia pilota ogni stagione, e' annunciato, e muore con
    // la stagione. Vale solo in campionato: nelle gare singole seasonRival
    // resta null.
    // IL PASSO DEL RIVALE NON STA PIU' QUI. Stava: cornerFactor e
    // straightFactor per il boost. Non funzionava, e il motivo e' due righe
    // sotto - `cornerFactor = min(cornerFactor, maxCorner)`. A Impossible la
    // scala di difficolta' fa gia' girare tutti al limite fisico, quindi il
    // boost veniva tagliato via, e tagliato in modo DISUGUALE: con un boost
    // dell'8%, Senna guadagnava lo 0,33% e Verstappen lo 0,44%, mentre Lauda
    // il 6,88%. Il vantaggio del rivale dipendeva da quale nome usciva.
    // Misurato su 42 stagioni di Nicola: piazzamento medio 5,29 fra i dieci
    // AI, cioe' il caso.
    //
    // Ora il rivale ha piu' MACCHINA (Car.setChassis, parametro `edge`): grip,
    // potenza e freni insieme, senza tetto e identici per chiunque peschi il
    // ruolo. Qui resta solo la parte che il tetto non tocca.
    const rv = AI.seasonRival;
    if (rv && rv.driver === driverName) {
        // e sbaglia un po' meno: un rivale in forma non e' solo piu' veloce,
        // e' anche piu' solido. Senza questo il vantaggio se lo mangiavano
        // gli errori nei giri di traffico. (A Impossible e Alien errorChance
        // e' gia' 0, quindi qui non fa nulla: il passo lo da' la macchina.)
        p.errorChance *= (rv.errScale === undefined ? 0.80 : rv.errScale);
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
// How much of a lap this circuit spends in the band where a compound's `hook`
// is worth anything. Cached, because it needs the racing line and the answer
// never changes for a given layout.
//
// It exists so the field does not throw the drift compound away on a circuit it
// is wrong for. Before this, chooseTyre drew it on temperament alone and the AI
// took it to Circle - where it is 4% off the pace - as readily as to Pettine,
// where it is 3% up. A specialist tyre handed out at random is not a specialist
// tyre, it is a handicap applied to a random driver.
// Takes the TRACK ITSELF, or a key if that is all the caller has. Taking the
// object matters: ai.js must not need makeTrack, which lives in main.js. The
// first version called it and every harness that loads ai.js without main.js -
// which is most of them - silently got null back, applied no adjustment at all,
// and handed the drift compound out just as often at the Oval as at Pettine.
// The test caught it; a dependency that fails quietly would not have been.
const AI_SLOW_SHARE = {};
AI.slowShare = function (track) {
    if (!track) return null;
    const key = typeof track === 'string' ? track : (track.trackKey || null);
    if (key && AI_SLOW_SHARE[key] !== undefined) return AI_SLOW_SHARE[key];
    let share = null;
    try {
        let t = track;
        if (typeof track === 'string') {
            if (typeof makeTrack !== 'function') return null;
            t = makeTrack(track);
        }
        if (!t || typeof t.getRacingLine !== 'function') return null;
        const line = t.getRacingLine();
        let n = 0;
        for (let i = 0; i < line.count; i++)
            if ((line.nodes[i].vCorner || 999) < 160) n++;
        share = n / Math.max(1, line.count);
    } catch (e) { share = null; }
    if (key) AI_SLOW_SHARE[key] = share;
    return share;
};

AI.chooseTyre = function (driverName, laps, raining, trackKey) {
    const s = AI_DRIVER_STYLES[driverName];

    // ---- RAIN ------------------------------------------------------------
    // With treaded rubber available, a slick in the rain is not a strategy,
    // it is a mistake: 0.13 of dry grip against the intermediate's 0.33 and
    // the full wet's 0.43. So the wet race is a choice between the two rain
    // compounds, and it is a reading of the circuit rather than of the driver.
    //
    // The intermediate keeps most of the dry tyre's steering rate and is the
    // quicker thing on a merely wet road. The full wet clears standing water -
    // 60% of the aquaplaning taken out - and a puddle taken at speed on
    // intermediates is a passenger ride. Circuits are scattered with 4-6
    // puddles per wet race, so how much of the lap is water varies, and the
    // field should not all guess the same way about it.
    //
    // Temperament decides who errs which way: a driver who lives on the edge
    // backs the quicker tyre and hopes to miss the water, a calculating one
    // takes the tyre that works everywhere. Wet skill pushes the same way -
    // the intermediate is the tyre that asks you to keep it on the road
    // through standing water, and that is a thing only some drivers can do.
    //
    // What comes out: Senna, Hamilton, Schumacher and Alonso mostly on
    // intermediates, Prost and Lauda mostly on full wets, and Verstappen in
    // between - the biggest risk-taker on the grid but genuinely poor in the
    // rain, and the two pull him in opposite directions.
    if (raining) {
        let full = 0.50;
        if (s) {
            full -= (s.err - 0.7) * 0.30;          // risk-taker -> intermediate
            full -= (s.overtake - 0.85) * 0.30;    // attacker -> intermediate
            full += (s.cleanAir - 1.0) * 4.0;      // long-game -> full wet
            full -= ((s.wet || 1) - 1) * 5.0;      // rainmasters back themselves
        }
        full += (Math.random() - 0.5) * 0.50;
        return full > 0.5 ? 'wet' : 'inter';
    }

    // 0 = wants the hard, 1 = wants the soft
    let want = 0.5;
    if (s) {
        want += (s.err - 0.7) * 0.16;          // lives on the edge -> soft
        want += (1 - s.gap) * 0.55;            // sits close, wants track position
        want += (s.overtake - 0.85) * 0.45;    // fights -> wants the early edge
        want -= (s.steerTau - 1.0) * 0.30;     // smooth hands -> kinder on tyres
        want -= (s.cleanAir - 1.0) * 6.0;      // clean-air specialists play the long game
    }
    // Race length used to push the whole field one way here - `(5 - laps) *
    // 0.055`. It cannot: tyre life in car.js is a MULTIPLE OF THE RACE, so a
    // soft ends every race at the same 1.11 of wear whether the race is two
    // laps or twenty. The term was moving the field for no reason and is gone.
    //
    // What replaces it is the measured fact. Over a full solo stint the three
    // compounds come out: soft +1.8%, medium +0.1%, hard +0.2% off the best,
    // averaged over four circuits - the soft is simply the slow one. It starts
    // 9% up on grip and ends 16% down, and grip is nearly free in this model
    // because the binding cornering limit is the STEERING RATE, not grip
    // (v = maxSteer / (1/R + maxSteer/500)), so the upside is muted and the
    // cliff is not. The field was taking it 39% of the time and handing the
    // player most of a second a lap for nothing.
    //
    // It is not removed - a gambler's choice is worth having, and it really is
    // the quickest thing on the road for the first half - but it is now the
    // minority call it deserves to be.
    want -= 0.15;
    // In the wet the cliff matters less: nobody is near the limit anyway.
    if (raining) want += 0.10;

    want += (Math.random() - 0.5) * 0.42;      // genuine spread, race to race

    // THE DRIFT COMPOUND is not on that scale at all. Soft, medium and hard are
    // one axis - how much performance now against how much later - and the
    // drift tyre is off it: it trades lateral grip for a tail that steps out
    // on the throttle at any speed (car.js, `loose`). In AI hands, feeding
    // the power in above 190 px/s (5c below), it is level with the medium on
    // the tight circuits and 10-12% off on the fast ones - a gamble that a
    // person can turn into something and the grid mostly cannot.
    //
    // Who takes it is a question of temperament, not of strategy. A driver who
    // is happy with the car moving around underneath them - nervous hands, a
    // lot of mistakes, always attacking - will have a go; the smooth,
    // calculating ones never will. Senna and Verstappen take it about one race
    // in five, Prost and Clark not at all.
    if (s) {
        let drift = 0.06;
        drift += (s.err - 0.7) * 0.05;          // lives on the edge
        drift += (1 - s.steerTau) * 0.18;       // sharp, nervous hands
        drift += (s.overtake - 0.85) * 0.25;    // always on the attack
        // ...and then the circuit, which is now the bigger question. The
        // compound is fitted to be about 3% up where half the lap is slow
        // corners and 3-4% down where none of it is, so temperament decides
        // WHO is tempted and the layout decides WHETHER it is worth it.
        // Pettine and Circo Massimo see it often, Circle and the Oval almost
        // never. A flat 20% band either side of neutral, so it never becomes
        // the whole grid's tyre and never disappears entirely.
        const slow = AI.slowShare(trackKey);
        if (slow !== null && slow !== undefined)
            drift *= Math.max(0.20, Math.min(2.20, slow / 0.22));
        if (Math.random() < Math.max(0, Math.min(0.30, drift))) return 'drift';
    }

    if (want > 0.66) return 'soft';
    if (want < 0.36) return 'hard';
    return 'medium';
};

// ---------------------------------------------------------------------------
//  CHASSIS CHOICE
//  Picked once, for the whole season, before anyone knows which circuits will
//  come up - so a driver chooses the car that suits the way they drive, not
//  the car that suits the next race.
//
//  Each chassis gets a score per driver, and the pick is a weighted draw over
//  those scores rather than "the best one". Two reasons: a deterministic rule
//  puts the whole grid in the same car, which is the outcome this is meant to
//  avoid; and a driver taking a car that does not flatter them is a perfectly
//  ordinary thing to happen.
//
//  What each style is reacting to:
//    corner vs straight  - the anti-correlated pace pair. A driver who makes
//                          their time in the corners wants downforce; one who
//                          makes it on the straights wants the low-drag car.
//    steerTau            - smooth hands (>1). Smooth drivers get on with the
//                          understeering car and look after its tyres.
//    err                 - lives on the edge. The loose, powerful car suits
//                          someone comfortable with a car that moves around.
//    wet                 - a rain specialist values the lateral grip, which is
//                          what is actually holding the car up in the wet.
// ---------------------------------------------------------------------------
AI.chooseChassis = function (driverName, rand) {
    const rnd = rand || Math.random;
    const s = AI_DRIVER_STYLES[driverName];
    const score = { aero: 1, bolt: 1, ridge: 1, torque: 1 };

    if (s) {
        // where this driver makes their lap time
        const cornerBias = (s.corner - 1) - (s.straight - 1);   // + = corner merchant
        score.aero  += cornerBias * 34;
        score.bolt  -= cornerBias * 34;

        // hands
        const smooth = s.steerTau - 1;                          // + = smooth
        score.ridge += smooth * 0.85;
        score.aero  += (-smooth) * 0.30;                        // sharp hands like the pointy car
        score.torque += (-smooth) * 0.22;                       // and the loose one

        // appetite for a car that moves around. This affinity used to belong
        // to Bolt, back when Bolt carried the big engine; the engine moved to
        // Torque when Torque was built, and the affinity moved with it -
        // powerOversteer follows the engine, not the badge.
        score.torque += (s.err - 0.7) * 0.42;
        score.bolt  += (s.err - 0.7) * 0.10;
        score.ridge += (0.7 - s.err) * 0.38;

        // rain: the grip car shines, the low-grip muscle car suffers
        score.ridge += (s.wet - 1.005) * 26;
        score.torque -= (s.wet - 1.005) * 12;

        // late brakers want the brakes and the front end - which rules the
        // soft-braked Torque out for them
        score.aero  += (s.brake - 1) * 1.6;
        score.torque -= (s.brake - 1) * 0.8;
    }

    for (const k of CHASSIS_KEYS) score[k] = Math.max(0.08, score[k]);

    // weighted draw, with the weights squared so a real preference shows
    // through but never becomes a certainty
    const w = CHASSIS_KEYS.map(k => score[k] * score[k]);
    const total = w.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    for (let i = 0; i < CHASSIS_KEYS.length; i++) {
        r -= w[i];
        if (r <= 0) return CHASSIS_KEYS[i];
    }
    return CHASSIS_KEYS[CHASSIS_KEYS.length - 1];
};

// The whole field, chosen at once. Left to themselves the ten draws can still
// come out lopsided; this keeps drawing for anyone who landed in an
// over-subscribed car until no chassis holds more than its share plus one, so
// there is always something of each on the grid to look at and to race.
AI.assignChassis = function (names, rand) {
    const rnd = rand || Math.random;
    const picks = names.map(n => AI.chooseChassis(n, rnd));
    const cap = Math.ceil(names.length / CHASSIS_KEYS.length) + 1;
    for (let pass = 0; pass < 40; pass++) {
        const count = {};
        for (const k of CHASSIS_KEYS) count[k] = 0;
        for (const p of picks) count[p]++;
        const over = CHASSIS_KEYS.filter(k => count[k] > cap);
        if (!over.length) break;
        const k = over[0];
        const i = picks.lastIndexOf(k);
        const under = CHASSIS_KEYS.filter(x => count[x] < cap)
            .sort((a, b) => count[a] - count[b]);
        picks[i] = under.length ? under[0] : picks[i];
    }
    return picks;
};

// DEAD SINCE THE REAL-SIM GRIDS, kept only so an old save or tool that calls
// it does not throw. Measured against the genuine simulator this formula had
// drifted into caricature - Prost took 47% of every grid's poles and its
// order was nearly the reverse of the real laps' order - so single races now
// build their grids with simulateQualifyingLap, the way sessions always did.
AI.qualifyingPace = function (driverName, difficulty, skillVariation, raining, chassis) {
    const p = AI.buildProfile(driverName, difficulty, skillVariation);

    // Roughly 60% of a lap is spent cornering, 40% flat out.
    // The chassis enters exactly there: its steering rate sets the corner
    // speed, its top speed the straight. Only an approximation - the real
    // sessions run the real physics - but a skipped Grand Prix must not hand
    // out a grid that pretends every car is identical.
    const ch = (typeof CHASSIS !== 'undefined' && CHASSIS[chassis]) || null;
    const cf = ch ? Math.pow(ch.steer, 0.55) : 1;
    const sf = ch ? ch.top : 1;
    let pace = 0.60 / (p.cornerFactor * cf) + 0.40 / (p.straightFactor * sf);
    pace /= Math.sqrt(p.cleanAir);               // qualifying is always clean air
    if (raining) pace /= Math.sqrt(p.wetSkill);  // grip enters the corner speed as a square root

    // A single flying lap has real variance, and more of it for drivers who
    // live closer to the edge. Without enough spread the same driver takes
    // pole every single time and qualifying stops being interesting.
    const spread = 0.055 + p.errorChance * 0.25;
    return pace * (1 + (Math.random() - 0.5) * spread);
};
