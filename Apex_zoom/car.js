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
// ---------------------------------------------------------------------------
//  WITH PIT STOPS ON, A SET IS A FIXED AMOUNT OF ROAD
//  pitLife, in pixels, absolute, whatever the race length. The numbers are
//  deliberately SHORT of a five-lap race on a typical circuit (~14000px):
//  with compounds priced 2-3% a lap apart, a ~5s stop can never pay for
//  itself on pace in a 65-second sprint, so a mode where any compound cruises
//  to the flag is a mode where nobody ever stops - measured, twice: at
//  generous lives the whole grid picked the hard and the feature was
//  furniture. With no set able to cover the distance, the race becomes WHICH
//  tyres and WHEN, which is the game pit stops are for. The one honest
//  exception survives: on the shortest circuits the hard (10500px against
//  Circo Massimo's 10250px race) really can run through, so the no-stop
//  gamble exists exactly where the arithmetic says it should - and only there.
const PIT_LIVES = { soft: 6500, medium: 8950, hard: 11350,
                    drift: 9500, inter: 8650, wet: 11350 };

// ...AND HOW MUCH OF IT A LONG CIRCUIT EATS
//
// The table above was fitted when the game had twenty circuits, none of them
// longer than 3769px a lap. It now has thirty-two, and the twelve added since
// run 5000 to 7872px: at a flat distance a soft does not survive one lap of
// Monza, and an eight-lap race there is six stops. A pit stop that is
// compulsory four times a race is not a decision either.
//
// Two obvious answers, and both are wrong on their own. Keep the distance
// flat and the long circuits are a farce. Give every circuit its own number
// so a set is worth N laps everywhere and the CIRCUIT stops mattering: every
// race becomes the same one stop and the only variable left is the lap count
// you typed into the menu - which is exactly the model this mode replaced.
//
// So: the life scales with the SQUARE ROOT of the circuit's length. A lap
// twice as long eats a set 1.4 times as fast, not twice as fast. Measured
// across the calendar that takes the spread from 5.5x to 2.3x - Circle still
// nurses a hard through a five-lap race and Monza still cannot - while the
// twenty circuits the table was fitted on barely move at all, because 2500px
// is about their median and the correction there is 1.0.
const PIT_REF_LAP = 2500;
// THE EXPONENT IS 0.7, NOT 0.5, and the lives are 8% longer than they were.
// The square root was fitted on the twenty circuits that existed when pit
// stops went in and it made the long ones brutal: Marathon at 7469px gave a
// drift 2.0 laps and a hard 2.4, so a five-lap Grand Prix there was a
// two-stopper for the whole field whatever anybody chose - which is what
// Nicola saw, and 26 pit events in one race is the log agreeing with him.
//
//   p = 0     a set is a fixed distance: 5.5x across the calendar, and a soft
//             that cannot complete a lap of Monza
//   p = 1     a set is a fixed number of laps: the circuit stops mattering
//   p = 0.5   2.35x, and the longest third of the calendar unraceable
//   p = 0.7   1.67x - Marathon becomes S1.9 M2.6 H3.3 D2.7, so five laps is a
//             one-stopper on the hard and a two-stopper if you want the pace,
//             while Circle still gets S3.1 M4.2 H5.4 and stays a no-stop
//
// The circuit still decides the strategy, which was the whole point of having
// a law at all; it no longer decides it by making half the calendar the same
// forced two-stop.
const PIT_LIFE_P = 0.7;
function pitLifePx(key, lapPx) {
    return (PIT_LIVES[key] || 9500) *
           Math.pow((lapPx || PIT_REF_LAP) / PIT_REF_LAP, PIT_LIFE_P);
}

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
    //
    //  AND `loose`, WHICH IS WHAT FINALLY MADE IT A DRIFT TYRE. All of the
    //  above multiplies powerOversteer, and powerOversteer only exists once
    //  demand (engine over speed) clears 1.45 - about 207 px/s - and is at
    //  its cap below 80. So in a hairpin every compound was at the cap and
    //  felt the same, and in a fast corner none of them moved at all: Nicola
    //  measured it with his hands ("I can break the rear loose in the tight
    //  stuff exactly as I do on the hard, and it has no advantage") and
    //  drifttest.js measured it with numbers - full lock and full throttle
    //  for 1.2s at 240 px/s gave a slip angle of 10 degrees on this tyre
    //  against 12 on the hard. Slower AND straighter. `loose` moves the onset
    //  down by that much demand: 1.0 puts it at 0.45, which is 660 px/s, so
    //  the tail is available in every corner in the game. Same test after:
    //  30 degrees at 240, 22 at 300, 16 at 360, against the hard's 12, 11
    //  and 9; and at 120 the car will spin in a second if you let it. Lift
    //  and it all goes away and the 0.78 of steering rate is what is left,
    //  so on this tyre you rotate with the throttle or you push wide.
    //
    //  The AI feeds the throttle in on it above 190 px/s (ai.js, 5c), the way
    //  a person would; measured in the dry with all ten cars on it: level
    //  with the medium at Kart, Comb and F1, 2% off at Circle, 10-12% off at
    //  Harbour and the Oval. It was 3% up on the tight circuits before; the
    //  compound is a toy for a person now, not a strategy for the grid, and
    //  the pick logic - temperament times slow-corner share, never above 30%
    //  - was already keeping it off the fast circuits.
    //
    //  THIRD PASS, after two seasons on it with `loose` and the scrub in
    //  (14 wins out of 15 against the Impossible grid): the slide at speed
    //  was paid for, and it was still the quickest tyre on anything with a
    //  hairpin in it. Measured with the game's own driver sent on the tyre at
    //  EVERY speed and pinning the throttle in the slow corners - the way
    //  Nicola's telemetry says he drives it - it was 5-7% quicker than the
    //  medium at Comb, 2-4% at Kart and Thunder, however hard the slide was
    //  charged for. Scrub cannot buy that back because the gain was not the
    //  slide: it was `hook`, the slow-corner steering bonus fitted in the
    //  first pass, when the tyre had no slide to speak of and needed SOMETHING
    //  to be quick with. At 0.58 it out-steered a medium below 171 px/s on
    //  the rack alone, and now the tail rotates the car on top of that. So
    //  the hook goes to 0.30: the rack is slower than a medium's everywhere,
    //  and what the tyre has in a hairpin it has from the throttle. Same
    //  measurement after: Comb -1.2%, Kart -1.1%, Thunder +0.8%, Anchor
    //  +4.7%, Serpent +0.8%, Harbour +2.8%, Kettle -0.5%, Oval -1.7% - a
    //  specialist's shape at a specialist's size. The scrub was moved to the
    //  EXTRA oversteer (over a slick's at the same demand) from 0 px/s, so a
    //  slick pays nothing in a hairpin either.
    //  FALLOFF, 08/26. The compound had falloff 0.0150 - the lowest in the
    //  game, hard included - on top of life 2.00, so it was both the loosest
    //  tyre and the most durable one: five laps cost it 0.8% of its grip
    //  against a medium's 6.1%. A tyre with no tread that never goes off is
    //  not a specialist, it is a free lunch, and it also meant the new
    //  scrub-wear law below could never be FELT on the one compound built to
    //  slide. 0.0600 sits between a hard (0.0240) and a medium (0.0696):
    //  measured over five laps, driven tidily it now loses 3.5% - still less
    //  than a medium - and driven sideways it loses more. The life stays at
    //  2.00 on purpose: the distance a set covers is a property of the
    //  casing, how fast it goes off is a property of how it is used.
    drift:  { key: 'drift',  label: 'Drift',  short: 'D', colour: '#ab47bc',
              grip: 0.780, falloff: 0.0600, life: 2.00, bite: 1.000, slide: 1.55,
              hook: 0.30, hookBand: 320, loose: 1.0,
              // A TREAD BUILT TO BE SCRUBBED. The wear model charges the
              // sideways part of the motion squared (see `scrub` in update),
              // which is right for a slick and perverse for this one: the
              // drift compound exists to be driven sideways, its own slide
              // figure is 1.55, and then the wear law erased a set for doing
              // exactly that. The AI never notices - it drives a computed
              // speed profile and sits at 16% slip on every compound, under
              // the 20% free band - so the whole penalty landed on the only
              // driver who actually provokes the car, which is Nicola, on the
              // only tyre he provokes it with.
              //
              // 0.15 is not immunity: a genuinely wild lap still costs
              // something. It is the difference between a tyre that rewards
              // being used as intended and one that punishes it.
              scrubWear: 0.15 },
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
              rainGrip: 3.55, aqua: 0.60, dryWear: 3.4, rain: true,
              dampMul: 0.55 }
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

// A wet race comes in two kinds, and they differ in how much water is on the
// road - both as standing puddles and as grip.
//
//   damp    - a drying or lightly wet track. Two or three puddles, and enough
//             grip that the STEERING RATE is the binding limit again rather
//             than the lateral clamp. That is what makes the intermediate the
//             right tyre: it keeps more steering rate (grip x bite 0.959) and
//             gives up wet grip (2.50 against 3.55).
//   soaked  - the rain this game already had. 0.13 of dry grip, eight to
//             twelve puddles, and the full wet wins comfortably.
//
// Measured before building it: with grip held the same, the full wet is
// already ahead at ZERO puddles (+0.30% over five circuits) and by +1.28% at
// today's four to six. So puddle count alone would have changed the scenery
// and not the decision.
//
// 1.20 rather than more: at 1.35 a slick becomes the quickest tyre on a damp
// road at Kart, and "in the rain the rain tyres are the tyre" is a property
// worth keeping. At 1.20 the best slick is still 4.5% behind the best rain
// tyre on every circuit, and the intermediate is 1.35% clear of the full wet.
const DAMP_GRIP_MUL = 1.20;
function wetGripNow(level) {
    const lv = level !== undefined ? level
             : (typeof wetLevel !== 'undefined' ? wetLevel : null);
    return lv === 'damp' ? WET_GRIP * DAMP_GRIP_MUL : WET_GRIP;
}

// What a compound's tread is worth on a DAMP road rather than a soaked one.
//
// Grip alone could not make the intermediate the right damp tyre. Swept from
// 1.0 to 1.9 times the wet grip, the full wet stayed ahead the whole way -
// +1.23% down to +0.24% - because rainGrip multiplies whatever WET_GRIP is, so
// the full wet's 3.55 against the intermediate's 2.50 survives the change. To
// reach the regime where steering rate binds instead of grip you would need
// something close to a dry road.
//
// So the tyre has to be wrong for the conditions, and there is a real reason
// for it: a full wet on a damp track is over-tyred. There is not enough water
// to clear, the tread squirms and overheats, and it gives back the grip it was
// carried there for. `dampMul` is that, and only the full wet has one.
function tyreRainGrip(tyre, level) {
    const rg = (tyre && tyre.rainGrip) || 1;
    const lv = level !== undefined ? level
             : (typeof wetLevel !== 'undefined' ? wetLevel : null);
    if (lv !== 'damp') return rg;
    return rg * ((tyre && tyre.dampMul) || 1);
}

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
// A slide sheds speed (see the oversteer block in update()): SCRUB_RATE px/s^2
// per unit of EXTRA oversteer - what the compound has above a slick at the
// same demand - per px/s of speed above SCRUB_FROM. Slicks have no extra.
let SCRUB_FROM = 0;
let SCRUB_RATE = 1.0;
// Fraction of the 160 px/s yaw gain still available at 400 px/s and above.
let YAW_HIGH_FLOOR = 0.40;
// How far above the steady-state cornering rotation (a/v, with a the grip the
// road is actually giving) the free yaw may take the car. See the long note in
// update(): 1 would forbid a drift outright, since a drift IS a rotation above
// the steady value; 2 is inert on dry tarmac for every compound in the game and
// binds on a loose one in the rain, which is the only place the model was
// letting the nose turn faster than any road could turn it.
let YAW_CAP = 2.0;
// Sideways motion, as a fraction of the car's speed, that costs no extra wear:
// every driver corners with some slip and the tyre table was fitted with that
// in it. 0.20 is 11.5 degrees. Above it the extra wear grows with the SQUARE
// of the excess, scaled by SLIDE_WEAR - see the wear block in update().
let SLIDE_FREE = 0.20;
let SLIDE_WEAR = 30;

// ---------------------------------------------------------------------------
//  GRAVITY ACROSS THE ROAD - camber, and nothing else.
//
//  RELIEF_BANK 200 at full camber is 200 px/s^2 sideways, against enginePower
//  300 and brakingPower 150. The lateral force a tyre actually generates
//  through an ordinary corner is |lateralSpeed| x 3.5, which runs 100-250 in
//  this model - the 1200 grip figure is a CLAMP that binds only in a slide -
//  so a fully banked corner is worth roughly one tyre's worth of extra
//  cornering. Enough to change the line you take; not so much that a corner
//  drives itself.
//
//  There was a RELIEF_G here too, gravity along the road rather than across
//  it: a gradient. It was removed with the circuit that used it. It worked -
//  a one-in-six descent took a third of the brakes away exactly as the
//  arithmetic said it would - and that was the problem. Camber gives
//  something back; a gradient only ever takes.
const RELIEF_BANK = 200;
// Quanto l'acqua ferma puo' abbassare il tetto d'imbardata: e' un PAVIMENTO
// sul fattore della pozzanghera. 0 = l'acqua lo abbassa quanto vuole (com'era
// prima del 08/26), 1 = non lo abbassa affatto. Vedi la nota al tetto in
// update() per il perche'.
let YAW_WATER_FLOOR = 0.85;
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
//
//  A THIRD ROUND, because the calendar moved and the fit did not. Lotus,
//  Marathon and Colossus were redrawn and Spa was added, and measured over the
//  23 circuits as they now stand the Aero car won ONE of them and was 1.7% off
//  the pace on average. Over races - ten cars, the field split three ways, the
//  chassis rotated between the same ten drivers - it finished P6.20 on average
//  against P4.60 for the Bolt, and won 3 races of 18. That is not a trade-off,
//  it is a menu entry nobody should ever pick.
//
//  TWO numbers were wrong, and they are wrong at DIFFERENT RACE DISTANCES,
//  which is why one of them alone never showed up:
//
//    steer 1.030 -> 1.055.  Swept across all 23 circuits, this is where the
//      three level out on one-lap pace (deficits 0.88 / 0.89 / 0.56, against
//      1.68 / 0.73 / 0.41 before). Over four-lap races it puts the Aero at
//      P5.35 against P5.48 and P5.67 - the flattest the three have ever been.
//
//    wear 1.15 -> 1.05.  And over EIGHT-lap races the same car was straight
//      back to P6.53, because tyre wear feeds tyrePerf, which multiplies the
//      steering rate: the downforce it had just been given wore off exactly as
//      the tyres did. Measured at steer 1.055, over eight laps: wear 1.15
//      gives P6.53, wear 1.00 gives P4.97, wear 0.95 gives P5.22 - the last
//      two are the same number inside the noise, so the whole of the effect is
//      spent by 1.00 and 1.05 is the midpoint that lands the eight-lap race
//      level rather than over-corrected.
//
//  Note WHY one number could not have done it: the two knobs bite at
//  different race distances. Steering rate is nearly the only thing that
//  matters over four laps and wear nearly the only thing that matters over
//  eight, so a fit done at one distance looks perfect and is wrong at the
//  other. The first attempt here moved steer alone, measured four-lap races,
//  and declared victory.
//
//  At 1.05 the Aero is still the hardest of the three on its tyres (Bolt 1.00,
//  Ridge 0.88), so its card is still true; it simply no longer destroys them.
//
//  A FOURTH ROUND, when the fourth car arrived - and a change of instrument.
//  Fitting on real-time races cost forty minutes a battery; the game's own
//  skip path (skipMode - the genuine loop with the drawing skipped) runs the
//  same races at a few hundred times speed, so this round was fitted on
//  48-72 races per view instead of 12-18 (tools/race_fast.js; standard error
//  about 0.25 of a position). Three views, because the knobs bite at
//  different distances: 4-lap dry, 4-lap wet, 8-lap dry.
//
//  What the batteries said, and what moved:
//    - Bolt at top 1.098 was the class of the four-car field (P4.67 dry
//      against a P5.5 field mean, four standard errors). top -> 1.090.
//    - Ridge sat P5.75-5.78 dry in run after run. steer 0.992 -> 1.000.
//    - Torque was fitted from scratch: power 1.065 -> 1.085 and top 1.025 ->
//      1.032 for dry pace; then it faded over distance (P6.18 at 8 laps) and
//      drowned in the wet (P5.95) - wear -> 0.92 and grip -> 1.00. Grip was
//      the knife-edge knob: 0.985 gave P6.05 in the wet and 1.00 gave P5.53
//      (96 races), a full half position for a percent and a half of grip,
//      because with an engine this size the wet rear is always near the spin
//      cap and a sliver of grip decides which side of it the car lives on.
//      So Torque's wet-grip BAR reads +0% and its wet weakness is entirely
//      its own engine, which is the honest version of the trade.
//  Final spreads, at the shipped numbers: 0.30 dry, 0.47 wet (96 races),
//  0.59 over eight laps - every view inside two standard errors, against a
//  spread of 1.6 positions when the round began.
//
//  A CAVEAT worth leaving for whoever fits this next: even at 48-72 races a
//  view, the standard error on an average finish is about 0.25 of a position.
//  Differences under half a position are still noise, and chasing them is
//  how a fit starts oscillating. Fit to three views at once, accept anything
//  inside two standard errors, and stop.
// =========================================================================
const CHASSIS = {
    aero: {
        key: 'aero', label: 'Aero', short: 'AER', accent: '#4dd0e1',
        line1: 'High downforce',
        line2: 'Turns in like nothing else and drags its heels on the straight. Hard on tyres, and it brakes latest.',
        steer: 1.055, top: 0.928, power: 1.000, grip: 1.00, wear: 1.05, brake: 1.05
    },
    bolt: {
        key: 'bolt', label: 'Bolt', short: 'BLT', accent: '#ff7043',
        line1: 'Low drag, long legs',
        line2: 'Fastest thing on the straight by a distance. It does not want to turn.',
        steer: 0.978, top: 1.090, power: 1.000, grip: 0.98, wear: 1.00, brake: 0.97
    },
    ridge: {
        key: 'ridge', label: 'Ridge', short: 'RDG', accent: '#9ccc65',
        line1: 'Understeer, but it lasts',
        line2: 'Washes wide if you rush it. Still on its tyres at the end, and quick in the rain.',
        steer: 1.000, top: 1.005, power: 0.985, grip: 1.04, wear: 0.88, brake: 1.02
    },
    // The fourth car, added a year after the first three, because the three
    // majors were downforce, drag and durability and nobody had built the
    // engine. `power` was the one knob no chassis had ever majored in - and it
    // is the one with a built-in vice, since powerOversteer is DERIVED from it
    // (demand = enginePower / speed): the muscular car is genuinely the loose
    // one, no separate fudge needed. Numbers fitted the same way as the other
    // three - races, not lap times; see the fourth fitting round below.
    torque: {
        key: 'torque', label: 'Torque', short: 'TRQ', accent: '#ba68c8',
        line1: 'Big engine, loose rear',
        line2: 'Fires out of the slow corners like nothing else, and the tail wants to come along. Soft brakes.',
        steer: 0.975, top: 1.032, power: 1.085, grip: 1.00, wear: 0.92, brake: 0.96
    }
};
const CHASSIS_KEYS = ['aero', 'bolt', 'ridge', 'torque'];
const CHASSIS_DEFAULT = 'ridge';

// ===========================================================================
//  WHAT A CAR LOOKS LIKE FROM ABOVE
// ===========================================================================
//
//  Drawn in a fixed 24 x 14 design box, nose towards +x, and scaled to
//  whatever W x H the caller has. NOTHING here touches the physics: the
//  collision box, the grid spacing, the crane and the skid marks all work off
//  the car's own width and height, which never change. What changes is what
//  the shape SAYS.
//
//  The camera changed what this drawing has to do. When the whole circuit was
//  on screen a car was twenty-four pixels long and the honest answer was a
//  coloured lozenge with wheels; now the window magnifies by 1.5 to 2.3 and a
//  car is fifty pixels of screen, so the parts of a real single-seater are
//  worth drawing properly.
//
//  The proportions are mapped from a real car (5.6m long, 2.0m across the
//  wheels) onto the box, which is stubbier than the real thing, so x is
//  compressed - and the FIRST attempt got this badly wrong by eye: the tyres
//  were half as long again as a real wheel and the body was one continuous
//  blob from tip to tail. Both are fixed by measurement rather than taste:
//
//    front wing   1.80m of 2.00m track  ->  span 0.90 of H
//    rear wing    1.05m of 2.00m track  ->  span 0.52 of H   <- much narrower,
//                                           and the clearest single cue that
//                                           you are looking at a modern F1 car
//    wheel        0.72m across          ->  about 3.5 units of the 24
//    sidepods     1.40m wide            ->  0.70 of H, but only BETWEEN the
//                                           axles, so they can be wider than
//                                           the gap between the wheels
//
//  And the body is drawn as SEPARATE PARTS - needle nose, monocoque, two
//  sidepods, engine cover - with visible seams between them, because that
//  separation is what stops it reading as a lozenge.
//
//  Reading the three cars apart:
//    AERO  - a car that is mostly wing. The widest front wing, in two
//            elements, with long endplates running back towards the wheels; a
//            deep two-element rear wing; bargeboards ahead of the sidepods and
//            winglets on top of them; a hard coke-bottle waist and the
//            narrowest body. Smallest rear tyres of the three.
//    BOLT  - a car built to go straight. A stub front wing barely wider than
//            the nose, a shallow single-element rear wing, no bargeboards, a
//            long shark fin from the airbox to the wing, a smooth torpedo of a
//            body - and the fattest rear tyres in the game, because that is
//            the only way it puts its own engine on the road.
//    RIDGE - a car built to last. The widest, boxiest sidepods with cooling
//            louvres cut into them, a big roll hoop, heavy shoulders, a
//            blunter nose and a conventional wing at each end.
//    TORQUE - a dragster in a single-seater's clothes. The biggest airbox in
//            the field feeding the biggest engine, narrow front tyres and
//            ENORMOUS rears - wider than Bolt's, because there is even more
//            engine to put on the road - modest single-element wings, and a
//            wide flat engine cover. The stance says it before the stats do.
//
//  The thin coloured band on the inner sidewall of each tyre is the compound,
//  the same colours as the timing tower - the one place in the game where you
//  can see what the car AHEAD of you is on without reading a table.
// ===========================================================================
const CHASSIS_ART = {
    aero: {
        fwSpan: 6.7, fwD: 2.3, fwTwo: true, fwEndL: 3.4,      // front wing
        rwSpan: 3.7, rwD: 2.4, rwTwo: true,                   // rear wing
        ftW: 2.6, rtW: 3.0,                                   // tyre widths
        noseW: 0.62, noseBase: 1.75,                          // the needle
        podW: 4.3, podTail: 1.5, podNose: 2.2,                // sidepods
        spine: 1.5,                                           // engine cover
        barge: true, winglet: true, fin: 0, louvres: 0, hoop: 1.5
    },
    bolt: {
        fwSpan: 3.9, fwD: 1.6, fwTwo: false, fwEndL: 2.0,
        rwSpan: 2.6, rwD: 1.6, rwTwo: false,
        // rtW 3.9: the fattest rears of the ORIGINAL three - Torque, which
        // carries even more engine, has since out-fattened it (4.2).
        ftW: 2.4, rtW: 3.9,
        noseW: 0.55, noseBase: 1.6,
        podW: 3.9, podTail: 1.3, podNose: 1.7,
        spine: 1.5,
        barge: false, winglet: false, fin: 6.6, louvres: 0, hoop: 1.3
    },
    ridge: {
        fwSpan: 6.0, fwD: 2.0, fwTwo: false, fwEndL: 2.6,
        rwSpan: 3.2, rwD: 2.0, rwTwo: false,
        ftW: 2.8, rtW: 3.4,
        noseW: 0.95, noseBase: 2.05,
        podW: 4.9, podTail: 2.2, podNose: 2.9,
        spine: 1.9,
        barge: false, winglet: false, fin: 0, louvres: 3, hoop: 1.9
    },
    torque: {
        fwSpan: 4.8, fwD: 1.8, fwTwo: false, fwEndL: 2.2,
        rwSpan: 3.0, rwD: 1.9, rwTwo: false,
        ftW: 2.3, rtW: 4.2,                    // the dragster stance
        noseW: 0.75, noseBase: 1.9,
        podW: 4.4, podTail: 1.8, podNose: 2.4,
        spine: 2.0,
        barge: false, winglet: false, fin: 0, louvres: 0, hoop: 2.2
    }
};

// The seam between one body part and the next is a VEIL OF BLACK over the
// part behind, not a darker shade computed from the colour. The cars are
// given CSS colour names - 'red', 'purple', 'white', 'black' - so there is no
// hex to do arithmetic on, and a function that quietly returned its input for
// anything but #rrggbb would have made every car in the game a single flat
// blob while looking right in a preview that happened to use hex.
const _SEAM = 'rgba(0, 0, 0, 0.28)';

// One car, at the origin, nose towards +x. `tyre` may be null.
function paintCarBody(g, W, H, bodyColor, ch, tyre) {
    const A = CHASSIS_ART[ch.key] || CHASSIS_ART.ridge;
    const accent = ch.accent;
    g.save();
    g.scale(W / 24, H / 14);          // the design box is 24 x 14

    const HY = 7;                      // half the track width
    const fx = 5.6, rx = -6.2;         // axle centres
    const ftL = 3.9, rtL = 4.3;        // wheel diameters, seen from above

    // ---- floor -----------------------------------------------------------
    // The floor is drawn NARROWER THAN THE SIDEPODS through the middle of the
    // car, so it disappears underneath them and shows only where it really
    // shows from above: ahead of the pods, in the gap between the front
    // wheels, and behind them at the diffuser. The first version was as wide
    // as the bodywork and simply drew a dark halo round every car.
    const flW = A.podW - 0.6;
    g.fillStyle = 'rgba(28, 28, 32, 0.88)';
    g.beginPath();
    g.moveTo(8.2, -1.4);
    g.lineTo(4.0, -3.3);                       // out into the gap between the
    g.lineTo(1.0, -flW);                       // front wheels
    g.lineTo(-3.0, -flW);
    g.lineTo(-6.6, -A.podTail - 0.7);
    g.lineTo(-9.5, -A.podTail - 0.2);          // the diffuser
    g.lineTo(-9.5, A.podTail + 0.2);
    g.lineTo(-6.6, A.podTail + 0.7);
    g.lineTo(-3.0, flW);
    g.lineTo(1.0, flW);
    g.lineTo(4.0, 3.3);
    g.lineTo(8.2, 1.4);
    g.closePath();
    g.fill();
    // diffuser strakes, the one bit of the floor with any detail in it
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    for (let i = -1; i <= 1; i++) {
        g.fillRect(-9.4, i * (A.podTail * 0.55) - 0.16, 2.4, 0.32);
    }

    // ---- suspension ------------------------------------------------------
    // Two wishbones a corner, drawn before the wheels and the body so both
    // ends are tucked under something, the way they are on the car. Light
    // enough to read against the floor they cross.
    g.strokeStyle = 'rgba(48, 48, 54, 0.95)';
    g.lineWidth = 0.7;
    g.beginPath();
    for (const s of [-1, 1]) {
        g.moveTo(3.0, s * 1.5);  g.lineTo(fx - 0.6, s * (HY - A.ftW * 0.55));
        g.moveTo(4.6, s * 1.4);  g.lineTo(fx + 1.0, s * (HY - A.ftW * 0.55));
        g.moveTo(-4.0, s * 1.8); g.lineTo(rx + 0.7, s * (HY - A.rtW * 0.55));
        g.moveTo(-8.0, s * 1.6); g.lineTo(rx - 1.1, s * (HY - A.rtW * 0.55));
    }
    g.stroke();

    // ---- rear wing -------------------------------------------------------
    // Narrow, and behind everything: on a modern car it is barely half the
    // width of the front wing, which is most of what says "F1" from above.
    const rwX = -11.9;
    g.fillStyle = '#141416';
    g.beginPath();
    g.roundRect(rwX, -A.rwSpan, A.rwD, A.rwSpan * 2, 0.5);
    g.fill();
    if (A.rwTwo) {
        g.fillStyle = 'rgba(255, 255, 255, 0.13)';
        g.fillRect(rwX + A.rwD * 0.58, -A.rwSpan + 0.5, 0.6, A.rwSpan * 2 - 1.0);
    }
    g.fillStyle = accent;                                   // endplates
    g.fillRect(rwX - 0.2, -A.rwSpan - 0.5, A.rwD + 0.9, 1.0);
    g.fillRect(rwX - 0.2, A.rwSpan - 0.5, A.rwD + 0.9, 1.0);
    g.fillStyle = '#17171a';                                // and its pylons
    g.fillRect(rwX + A.rwD, -1.3, 2.0, 0.8);
    g.fillRect(rwX + A.rwD, 0.5, 2.0, 0.8);

    // ---- front wing ------------------------------------------------------
    // Wide, and its endplates run BACK towards the front wheels - the other
    // half of the silhouette that reads as a single-seater.
    const fwX = 9.3;
    g.fillStyle = '#141416';
    g.beginPath();
    g.roundRect(fwX, -A.fwSpan, A.fwD, A.fwSpan * 2, 0.5);
    g.fill();
    if (A.fwTwo) {
        g.fillStyle = 'rgba(255, 255, 255, 0.13)';
        g.fillRect(fwX + A.fwD * 0.52, -A.fwSpan + 0.5, 0.6, A.fwSpan * 2 - 1.0);
    }
    g.fillStyle = accent;
    const feX = fwX + A.fwD - A.fwEndL, feL = Math.min(A.fwEndL + 0.7, 11.9 - feX);
    g.fillRect(feX, -A.fwSpan - 0.55, feL, 1.1);
    g.fillRect(feX, A.fwSpan - 0.55, feL, 1.1);
    // the two pylons the nose hangs the wing from
    g.fillStyle = '#17171a';
    g.fillRect(fwX - 1.0, -A.noseW - 0.5, 1.2, 0.55);
    g.fillRect(fwX - 1.0, A.noseW - 0.05, 1.2, 0.55);

    // ---- wheels ----------------------------------------------------------
    const tyreCol = (tyre && tyre.colour) || null;
    const wheel = (cx, len, wid) => {
        for (const s of [-1, 1]) {
            const y0 = s > 0 ? HY - wid : -HY;
            g.fillStyle = '#131315';
            g.beginPath();
            g.roundRect(cx - len / 2, y0, len, wid, 1.0);
            g.fill();
            g.fillStyle = 'rgba(255, 255, 255, 0.09)';      // the crown
            g.fillRect(cx - len / 2 + 0.45, y0 + wid * 0.36, len - 0.9, wid * 0.28);
            if (tyreCol) {                                   // compound sidewall
                g.fillStyle = tyreCol;
                g.globalAlpha = 0.92;
                g.fillRect(cx - len / 2 + 0.5, s > 0 ? y0 : y0 + wid - 0.5, len - 1.0, 0.5);
                g.globalAlpha = 1;
            }
        }
    };
    wheel(rx, rtL, A.rtW);
    wheel(fx, ftL, A.ftW);

    // ---- bargeboards, in the gap between front wheel and sidepod ---------
    if (A.barge) {
        g.fillStyle = 'rgba(20, 20, 22, 0.92)';
        for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(3.4, s * 2.3);
            g.lineTo(1.4, s * 4.2);
            g.lineTo(0.5, s * 3.9);
            g.lineTo(2.5, s * 2.1);
            g.closePath();
            g.fill();
        }
    }

    // ---- sidepods, as their own bodies -----------------------------------
    // Drawn before the monocoque and in a darker shade, so there is a seam
    // where one part stops and the next begins. That seam is the difference
    // between a car and a lozenge.
    for (const pass of [bodyColor, _SEAM]) {
        g.fillStyle = pass;
        for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(2.1, s * 1.3);
            g.lineTo(1.7, s * A.podNose);        // the inlet
            g.lineTo(0.7, s * A.podW);           // shoulder, and it is widest here
            g.lineTo(-2.6, s * A.podW);
            g.lineTo(-6.4, s * A.podTail);       // coke bottle, clear of the wheel
            g.lineTo(-7.4, s * 1.0);
            g.lineTo(-1.0, s * 1.1);
            g.closePath();
            g.fill();
        }
    }
    // Ridge's cooling louvres, cut into the top of those big sidepods
    if (A.louvres) {
        g.fillStyle = 'rgba(0, 0, 0, 0.32)';
        for (let i = 0; i < A.louvres; i++) {
            const x = -1.2 - i * 1.7;
            g.fillRect(x, -A.podW + 0.55, 1.05, 1.4);
            g.fillRect(x, A.podW - 1.95, 1.05, 1.4);
        }
    }
    // Aero's winglets, perched on the sidepods
    if (A.winglet) {
        g.fillStyle = accent;
        g.fillRect(-3.6, -A.podW - 0.45, 3.0, 0.75);
        g.fillRect(-3.6, A.podW - 0.3, 3.0, 0.75);
    }

    // ---- nose, monocoque and engine cover --------------------------------
    g.fillStyle = bodyColor;
    g.beginPath();
    g.moveTo(9.6, -A.noseW);                     // the tip, sitting on the wing
    g.lineTo(6.4, -A.noseW - 0.45);              // a long needle, not a wedge
    g.lineTo(3.4, -A.noseBase);
    g.lineTo(1.2, -2.15);                        // the driver's shoulders
    g.lineTo(-1.4, -A.spine - 0.35);
    g.lineTo(-6.0, -A.spine * 0.72);             // the cover tapering away
    g.lineTo(-9.2, -0.75);
    g.lineTo(-9.2, 0.75);
    g.lineTo(-6.0, A.spine * 0.72);
    g.lineTo(-1.4, A.spine + 0.35);
    g.lineTo(1.2, 2.15);
    g.lineTo(3.4, A.noseBase);
    g.lineTo(6.4, A.noseW + 0.45);
    g.lineTo(9.6, A.noseW);
    g.closePath();
    g.fill();

    // A highlight down the spine. It gives the bodywork some form from
    // above - and it is the only thing that keeps the BLACK car in the field
    // from reading as a hole in the road.
    g.fillStyle = 'rgba(255, 255, 255, 0.13)';
    g.beginPath();
    g.moveTo(6.2, -0.3);
    g.lineTo(3.2, -0.55);
    g.lineTo(-6.0, -0.5);
    g.lineTo(-8.8, -0.3);
    g.lineTo(-8.8, 0.3);
    g.lineTo(-6.0, 0.5);
    g.lineTo(3.2, 0.55);
    g.lineTo(6.2, 0.3);
    g.closePath();
    g.fill();

    // Bolt's shark fin, along the top of the engine cover to the wing
    if (A.fin > 0) {
        g.fillStyle = accent;
        g.beginPath();
        g.moveTo(-2.6, -0.40);
        g.lineTo(-2.6 - A.fin, -0.22);
        g.lineTo(-2.6 - A.fin, 0.22);
        g.lineTo(-2.6, 0.40);
        g.closePath();
        g.fill();
    }

    // ---- cockpit, halo, mirrors ------------------------------------------
    g.fillStyle = '#0c0c10';                     // the opening
    g.beginPath();
    g.roundRect(0.5, -1.35, 3.6, 2.7, 1.2);
    g.fill();
    g.fillStyle = 'rgba(216, 218, 226, 0.9)';    // the helmet in it
    g.beginPath();
    g.ellipse(1.9, 0, 0.95, 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(24, 24, 30, 0.85)';      // and the visor
    g.fillRect(2.35, -0.62, 0.55, 1.24);
    g.fillStyle = 'rgba(11, 11, 13, 0.92)';      // roll hoop behind the head
    g.beginPath();
    g.roundRect(-1.5, -A.hoop, 1.9, A.hoop * 2, 0.7);
    g.fill();
    // the halo: a hoop round the opening carried on one pillar in front
    g.strokeStyle = 'rgba(196, 199, 206, 0.85)';
    g.lineWidth = 0.5;
    g.beginPath();
    g.arc(2.0, 0, 1.95, -Math.PI * 0.62, Math.PI * 0.62);
    g.stroke();
    g.beginPath();
    g.moveTo(3.9, 0);
    g.lineTo(4.8, 0);
    g.stroke();
    // mirrors, one either side of the opening
    g.fillStyle = 'rgba(26, 26, 30, 0.9)';
    g.fillRect(2.5, -2.5, 1.3, 0.75);
    g.fillRect(2.5, 1.75, 1.3, 0.75);

    g.restore();
}


// ---------------------------------------------------------------------------
//  AND WHY IT IS DRAWN ONCE AND KEPT
//
//  The art above costs about 3.4 times what the old lozenge did - measured,
//  170 microseconds a car against 48, which over eleven cars is 2.0ms of a
//  16.7ms frame instead of 0.6ms. That is a real bite for something that does
//  not change: a car's picture depends only on its chassis, its colour, its
//  compound and how far the camera is magnifying, and none of those change
//  from frame to frame. So it is painted ONCE into a small offscreen canvas
//  and blitted after that - the same trick the circuit layer already uses, for
//  the same reason.
//
//  The scale is read off the CONTEXT's own transform rather than passed in, so
//  this works wherever it is called from - the race at whatever zoom, a menu
//  card, anything - and a car being lifted by the crane skips the cache
//  entirely and draws direct, because its scale changes every frame and there
//  are never more than two of them.
// ---------------------------------------------------------------------------
const CAR_SPRITE_PAD = 1.30;      // the shadow and the wings reach past the box
const CAR_SPRITE_MAX = 160;       // entries; a race only ever needs a dozen
const _carSprites = new Map();

function carSprite(W, H, color, ch, tyre, scale) {
    const key = ch.key + '|' + color + '|' + ((tyre && tyre.key) || '-') + '|' + scale;
    let sp = _carSprites.get(key);
    if (sp) return sp;
    if (_carSprites.size >= CAR_SPRITE_MAX) _carSprites.clear();
    const pw = W * CAR_SPRITE_PAD, ph = H * CAR_SPRITE_PAD;
    const cv = document.createElement('canvas');
    cv.width = Math.max(8, Math.ceil(pw * scale));
    cv.height = Math.max(8, Math.ceil(ph * scale));
    const g = cv.getContext('2d');
    g.setTransform(scale, 0, 0, scale, cv.width / 2, cv.height / 2);
    g.save();
    g.translate(1.6, 1.9);
    paintCarShadow(g, W, H, ch);
    g.restore();
    paintCarBody(g, W, H, color, ch, tyre);
    sp = { canvas: cv, pw: pw, ph: ph };
    _carSprites.set(key, sp);
    return sp;
}

// How many device pixels the context is currently putting on one car unit.
// Quantised, or a camera that eases its zoom would ask for a new sprite every
// frame; capped, so nothing can ask for a huge one.
function _ctxScale(g) {
    if (typeof g.getTransform !== 'function') return null;
    const m = g.getTransform();
    const s = Math.hypot(m.a, m.b);
    if (!(s > 0.05) || s > 12) return null;
    return Math.min(8, Math.max(0.5, Math.ceil(s * 4) / 4));
}

// The shadow. It used to be a rounded rectangle of the whole 24 x 14 box,
// which was honest when the car was a lozenge and is not now: from above you
// would see a slab of grey with a single-seater sitting in the middle of it.
// This is the same silhouette the car has - body, wings, four wheels - in one
// path, which costs one fill.
function paintCarShadow(g, W, H, ch, alpha) {
    const A = CHASSIS_ART[ch.key] || CHASSIS_ART.ridge;
    g.save();
    g.scale(W / 24, H / 14);
    const HY = 7, fx = 5.6, rx = -6.2;
    g.fillStyle = 'rgba(0, 0, 0, ' + (alpha === undefined ? 0.3 : alpha) + ')';
    g.beginPath();
    // body and floor
    g.moveTo(9.4, -1.0);
    g.lineTo(4.0, -3.4);
    g.lineTo(0.8, -A.podW);
    g.lineTo(-3.0, -A.podW);
    g.lineTo(-7.0, -A.podTail - 0.8);
    g.lineTo(-9.6, -A.podTail - 0.3);
    g.lineTo(-9.6, A.podTail + 0.3);
    g.lineTo(-7.0, A.podTail + 0.8);
    g.lineTo(-3.0, A.podW);
    g.lineTo(0.8, A.podW);
    g.lineTo(4.0, 3.4);
    g.lineTo(9.4, 1.0);
    g.closePath();
    // wings
    g.roundRect(9.3, -A.fwSpan, 2.3, A.fwSpan * 2, 0.5);
    g.roundRect(-11.9, -A.rwSpan, 2.3, A.rwSpan * 2, 0.5);
    // wheels
    for (const s of [-1, 1]) {
        g.roundRect(fx - 1.95, s > 0 ? HY - A.ftW : -HY, 3.9, A.ftW, 1.0);
        g.roundRect(rx - 2.15, s > 0 ? HY - A.rtW : -HY, 4.3, A.rtW, 1.0);
    }
    g.fill();
    g.restore();
}


// --- The damage handicap -------------------------------------------------
// Two handles: a straight scale on every hit, and extra impact speed that
// costs nothing at all, so light scrapes while learning a corner are genuinely
// free rather than merely cheap. What they are worth, against a 255hp car:
//
//     closing        without          with
//      80 px/s          7 hp           0 hp
//     100             39             0.7
//     120             97            10
//     150            231            47
//   the hit that ends a full car:  154 px/s  ->  226 px/s
//
// WHO GETS IT is three states, not two:
//   - normally, the player and nobody else. The AI drives to a computed speed
//     profile with perfect lookahead and knows exactly how much steering it is
//     about to need; a human has four arrow keys and a reaction time, so the
//     same corner costs them contact the AI never has.
//   - with "No AI handicap" ticked, EVERY car. Nicola asked for it after
//     watching the field retire from contact he had walked away from: the
//     forgiving curve is not a cheat if everyone is on it, it is just a
//     gentler ruleset, and it makes for closer racing rather than an easier
//     race.
//   - at ALIEN, nobody at all, and the checkbox is refused. The whole premise
//     of that level is that the player is given nothing the field is not, and
//     giving the FIELD something instead is the same bargain from the other
//     side. main.js unticks and disables the box when Alien is chosen, and
//     applyDifficultyRules forces the flag off as well - a UI that can be
//     raced past is not a rule.
const PLAYER_DAMAGE_SCALE = 0.45;
const PLAYER_FREE_IMPACT = 28;      // px/s of closing speed added to the free band
// Both set by main.js when a session starts, so qualifying and the race agree.
let playerHandicapOn = true;        // false at Alien
let noAiHandicapOn = false;         // true when the box is ticked (never at Alien)

// Does this car take damage on the gentle curve? One predicate, so the three
// places that bill damage - takeDamage, the barrier, and car-to-car contact -
// cannot disagree about who is on which ruleset.
function softDamage(car) {
    if (!playerHandicapOn) return false;               // Alien: nobody
    return !!(car && (car.isPlayer || noAiHandicapOn));
}
function damageScaleFor(car) { return softDamage(car) ? PLAYER_DAMAGE_SCALE : 1; }
function freeImpactFor(car) { return softDamage(car) ? PLAYER_FREE_IMPACT : 0; }

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

        // --- Pit stops (only with the menu switch on; see main.js) -------
        this.wantPit = false;        // box armed for the next time past the pits
        this.pitNextTyre = null;     // compound waiting at the box
        this.pitPhase = null;        // null | 'approach' | 'stopped' | 'exit'
        this.pitTimer = 0;
        this.pitCount = 0;
        this.pitGrace = 0;           // ghosted for a beat after rejoining
        this.pitPlan = null;         // AI: { stopLap, tyre } decided on the grid

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
        // Published for whoever is listening (audio.js, through the frame
        // loop). The physics does not call the audio itself: eleven cars
        // squealing would be noise, and only the car the camera is following
        // is actually under your ears.
        this.surfaceNow = surface;

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
            // ---- AND A TYRE DRAGGED SIDEWAYS IS BEING ERASED ---------------
            // `abuse` above is the fraction of the grip being used, and it
            // saturates: once the car is at the limit, sliding it further
            // costs nothing. So a lap spent sideways wore a set exactly as
            // much as a clean one - which is how the drift compound ended up
            // being both the loosest tyre in the game and the most durable.
            //
            // What actually eats a tread is the rubber being scrubbed off:
            // the sideways part of the motion, |sin(slip angle)|, which is the
            // same quantity the lap telemetry already calls "sideways % of the
            // distance". Below SLIDE_FREE the tread is deforming rather than
            // abrading - ordinary cornering is 11-15% sideways for everybody,
            // and charging that would quietly rewrite the whole soft/medium/
            // hard balance - so only the EXCESS counts, and it counts squared,
            // because wear climbs far faster than the angle does.
            const latV = -this.velocity.x * Math.sin(this.angle) +
                          this.velocity.y * Math.cos(this.angle);
            const sinSlip = speedForKerb > 30
                ? Math.min(1, Math.abs(latV) / speedForKerb) : 0;
            const over = Math.max(0, sinSlip - SLIDE_FREE);
            const scrub = 1 + SLIDE_WEAR * over * over *
                          (tyre.scrubWear === undefined ? 1 : tyre.scrubWear);
            // The chassis is part of how hard the car is on its rubber: a
            // high-downforce car loads the tyre far more than one running
            // little wing.
            const chassisWear = this.tyreWearScale || 1;
            // Rain rubber on a dry road tears itself apart. This is the reason
            // a wet tyre is not simply a safe default: get the call wrong and
            // the set is gone a third of the way in, and there are no stops.
            const dry = !(typeof isRaining !== 'undefined' && isRaining);
            const surfaceWear = dry ? (tyre.dryWear || 1) : 1;
            // Two wear laws, one switch. The historical law scales a set to
            // the RACE: life x race laps, so a soft always died at 90% of the
            // distance whether the race was three laps or thirty - which is
            // tidy, and means the length of the race never changes what a
            // compound IS. With pit stops on, the other rule applies: a set is
            // an amount of ROAD (pitLifePx), full stop. A soft is about three
            // laps of a typical circuit wherever you are in the season; a long
            // circuit like Monza eats a medium that a short one like Peanut
            // would nurse home - the strategy becomes a property of the
            // CIRCUIT, which is the point of having one.
            // pitRoadWear, NOT pitModeOn: qualifying can have the box open
            // (a wrong compound is fixable) while still measuring a set as a
            // share of its own three laps. The two questions came apart the
            // day the box opened in qualifying.
            const pit = typeof pitRoadWear !== 'undefined' && pitRoadWear;
            const lifeLaps = pit
                ? pitLifePx(tyre.key, this._lapPixels) / this._lapPixels
                : tyre.life * laps;
            this.tyreWear += lapFrac * abuse * scrub * chassisWear * surfaceWear /
                             Math.max(0.05, lifeLaps);
        }
        const pitWall = typeof pitRoadWear !== 'undefined' && pitRoadWear;
        // In pit mode the clamp moves out to 1.6: the wear does not stop
        // accruing just because the set is finished, and the wall below needs
        // the number to keep counting.
        const w = Math.max(0, Math.min(pitWall ? 1.6 : 1.25, this.tyreWear));
        // ^1.6: the first half of a set costs almost nothing, the last of it
        // falls away quickly - the cliff is what makes the choice interesting.
        this.tyrePerf = tyre.grip - tyre.falloff * Math.pow(w, 1.6);
        // Past 100% in pit mode the set is not a slower tyre, it is a FINISHED
        // one. The ordinary falloff is tuned for a game with no stops, where
        // limping home had to be possible - and with a cap of 1.25 and a
        // gentle slope, limping was always cheaper than a stop, measured: the
        // whole grid ran the hard into the ground and nobody ever boxed. Six
        // points of perf per point of overrun, floored at 0.30 so the
        // arithmetic downstream (vGrip is a square root) stays real: a set 20%
        // over is a crawl, and the crawl is the argument for the pit box.
        if (pitWall && w > 1) {
            this.tyrePerf = Math.max(0.30, this.tyrePerf - 6.0 * (w - 1));
        }
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
            currentGrip *= wetGripNow() * tyreRainGrip(tyre);
            // Wet-weather skill, from the driver style table in ai.js.
            if (this.wetGripBonus) currentGrip *= this.wetGripBonus;
        }

        // The rotation ceiling further down is measured against the grip of
        // the ROAD, and this is where that number is taken - BEFORE the
        // standing water. See the long note at the ceiling itself: a puddle
        // takes away the friction that turns the car and, in the same
        // instant, the friction that would stop it turning. Charging the
        // first and not crediting the second made the one place where a car
        // should swap ends most easily the one place where it could not
        // rotate at all.
        let gripForYaw = currentGrip;
        // Quanto l'acqua ferma puo' abbassare il tetto: 0 = quanto vuole (com'era
        // prima), 1 = per niente. Vedi la nota al tetto.
        const waterFloor = (typeof YAW_WATER_FLOOR === 'undefined') ? 1 : YAW_WATER_FLOOR;

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
            const puddleGrip = (0.45 + 0.30 * aqua) - 0.25 * this.aquaplane;
            currentGrip *= puddleGrip;
            gripForYaw *= Math.max(puddleGrip, waterFloor);
            currentFriction *= 2.2 - 0.9 * (tyre.aqua || 0);
            if (speedForKerb > 90 && Math.random() < 0.5) {
                const spray = (Math.random() - 0.5) * 16 * (speedForKerb / 300);
                this.velocity.x += -Math.sin(this.angle) * spray;
                this.velocity.y += Math.cos(this.angle) * spray;
            }
        }

        if (surface === 'grass') {
            currentGrip *= 0.3; // Slippery!
            gripForYaw *= 0.3;  // grass is measured, and stays as it was
            currentFriction *= 2.5; // Slows you down!
        } else if (surface === 'kerb') {
            // A kerb is meant to be usable. You lose a bit of grip and scrub a
            // little speed, and the car is unsettled by the rumble strips - but
            // running two wheels over one is a normal part of a fast lap, not
            // the disaster that dropping onto grass is.
            currentGrip *= 0.80;
            gripForYaw *= 0.80;
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
        
        // --- Camber ----------------------------------------------------
        // Null on every circuit with no banking, which is all but one of
        // them, and one array lookup on the other: see track.js, CAMBER. Read
        // here, before the forces, and used once, after the grip clamp below.
        const relief = (typeof track.reliefFor === 'function') ? track.reliefFor(this) : null;
        // Nobody is pushed about on the grid. A car held at the lights has its
        // inputs off and drag is proportional to speed, so at rest there is
        // nothing to balance a sideways force - and moving before the lights
        // go out is a jump-start penalty.
        const onTheGrid = typeof gameState !== 'undefined' && gameState === 'countdown';

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

        // Il limitatore della VSC. Il gas si chiude avvicinandosi al tetto e
        // sopra il tetto entra un filo di freno: cosi' anche chi ci arriva
        // lanciato scende alla velocita' della VSC in qualche decimo invece
        // che per attrito. Vale per il giocatore come per l'IA - e' lo stesso
        // numero, che e' il punto.
        let vscLimit = 1;
        if (vsc < 1 && typeof VSC_SPEED !== 'undefined') {
            const vNow = Math.hypot(this.velocity.x, this.velocity.y);
            vscLimit = Math.max(0, Math.min(1, (VSC_SPEED - vNow) / 8));
            if (vNow > VSC_SPEED + 6) forwardForce -= this.brakingPower * 0.30;
        }

        if (thr > 0) {
            forwardForce += this.enginePower * this.condition * vsc * thr * vscLimit;
            // Slipstream: continuous with distance rather than an on/off cone,
            // so the tow builds as you close in instead of snapping on.
            if (this.draftStrength > 0) {
                forwardForce += this.enginePower * 0.26 * this.draftStrength * vsc * thr * vscLimit;
            }
        }
        if (brk > 0) {
            forwardForce -= this.brakingPower * brk;
        }
        
        // --- Steering ---
        const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
        
        const steerInput = (this.inputs.right ? 1 : 0) - (this.inputs.left ? 1 : 0);
        let steerRateNow = 0;      // rad/s the front tyres are turning us at

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
            // ...and the same thing as a RATE, kept for the yaw ceiling below.
            steerRateNow = this.maxSteer * steerEffectiveness;

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
            // Where the tail starts to go. 1.45 of demand is engine over speed
            // at about 207 px/s on 300 of power, so a slick only ever steps
            // out below that - and saturates below 80, which is why every
            // compound felt the same in a hairpin: they were all at the cap.
            // A compound's `loose` pulls the onset down the demand scale, i.e.
            // up the speed scale: the drift tyre's 1.0 puts it at 0.45, which
            // is 660 px/s - every corner the game has. Nothing else on the
            // road is affected.
            const onset = 1.45 - ((this.tyre && this.tyre.loose) || 0);
            powerOversteer = Math.max(0, Math.min(1,
                ((demand - onset) / 2.2) * slipperiness * effSlide));
            // What a plain slick would be doing here - same car, same surface,
            // same pedal, compound traits stripped. The difference is what
            // the loose compound is getting for free, and it is what the
            // scrub below is charged on.
            this._osSlick = Math.max(0, Math.min(1, ((demand - 1.45) / 2.2) * slipperiness));
        } else {
            this._osSlick = 0;
            this._yawAsked = 0; this._yawFree = 0;
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
            // ...and above the pivot band the free rotation tapers off: the
            // faster the car the less the rear can turn it. YAW_HIGH_FLOOR of
            // the 160 px/s figure is left at 400 px/s and beyond. Slicks have
            // no oversteer above 207 px/s, so only a loose compound feels it,
            // and for that compound it is the difference between a tail that
            // is out and a corner that is being taken 13% faster than a
            // slick can take it (see SCRUB_RATE: the pair were set together).
            const highSpeed = Math.max(0, Math.min(1, (speed - 160) / 240));
            const yawGain = (1.15 + 1.75 * lowSpeed) * (1 - (1 - YAW_HIGH_FLOOR) * highSpeed);
            let tail = powerOversteer * yawGain;

            // ---- THE ROTATION HAS TO COME FROM THE ROAD TOO ----------------
            // The line above adds rotation to the nose directly: it asks the
            // tyres for nothing, so it is the same on dry tarmac, on a soaked
            // circuit and on the grass. The lateral FORCE is already clamped
            // at `currentGrip` a few lines down, so the corner pays for the
            // friction it uses and the pivot does not - and that is the whole
            // of what was wrong with the drift compound in the rain.
            //
            // A car cornering at the limit has a = v^2/R at most `currentGrip`
            // (which in this model is an acceleration), and turns at w = v/R.
            // So the rotation the road can pay for is w = a/v = currentGrip/v -
            // the SAME number that already clamps the lateral force, applied to
            // the nose instead of to the trajectory. Turning in, and a drift
            // above all, are transients that legitimately exceed the steady
            // value, so the ceiling is YAW_CAP x that, and only the free part
            // is cut: the steering itself is never touched.
            //
            // Measured with throttle and lock in (yawsource.js), rotation asked
            // as a multiple of that ceiling:
            //
            //                       dry        soaked
            //   slicks             0.2x        1.3-2.1x
            //   intermediate       0.2x        0.6-1.0x
            //   DRIFT              0.4x        2.7-2.8x
            //
            // At YAW_CAP = 2 nothing in the dry comes close - the compound
            // Nicola drives is untouched, bit for bit - a slick in a wet
            // hairpin gives up about a tenth, the rain tyres nothing at all,
            // and the drift in the rain loses 40-44% of its free rotation.
            // It still steps out at any throttle (slipperiness is at its cap
            // once it rains) and is still just as hard to gather up (the force
            // that straightens the car is clamped by the same small grip):
            // what it loses is the ability to POINT the car faster than the
            // road could ever have turned it.
            // ...and ONE THING THE FIRST VERSION GOT WRONG, found by driving
            // it: the grip this is measured against is the road's, taken
            // before the standing water. Friction is what creates a rotation
            // AND what stops one; a ceiling proportional to grip counts only
            // the first half, so it concluded that a car cannot rotate on
            // ice. Measured in a puddle, the drift compound asked for 1.51 of
            // free yaw and was given 0.15 - six degrees of slip in a second
            // and a half - while the FULL WET, which pumps the water away and
            // so keeps its grip, was drifting at 39. A rain tyre that slides
            // better than a drift tyre is the signature of a broken model.
            // Standing water may now pull the ceiling down only as far as
            // YAW_WATER_FLOOR. Everything else about a puddle is untouched:
            // the lateral force still collapses, aquaplaning still kills the
            // steering (`aqua` multiplies the front end and always has), the
            // drag is the same. See 2.4duodetricies-quater for the tuning -
            // at 0.85 the AI's wet races are inside their own noise band and
            // the player gets 33 degrees of slip in the water against 25 on
            // the road beside it; at 1.00 the slicks start spinning too.
            const yawCeiling = YAW_CAP * gripForYaw / Math.max(40, speed);
            const room = Math.max(0, yawCeiling - steerRateNow);
            const asked = tail;
            if (tail > room) tail = room;
            // read by the probes (yawsource.js): what was asked, what the road
            // allowed, and what the nose actually got.
            this._yawAsked = asked; this._yawCeil = yawCeiling;
            this._yawSteer = steerRateNow; this._yawFree = tail;

            this.angle += steerInput * tail * dt;

            // AND A SLIDE AT SPEED COSTS SPEED. The rotation above used to be
            // free: it bypasses the steering-rate limit, and nothing in the
            // model charged for it. Below 160 px/s that is the pivot and it
            // stays free. Above, it was a superpower the moment a compound
            // could oversteer there - Nicola ran a season on the drift tyre
            // with `loose` and took nine poles out of ten against the
            // Impossible grid, 4-13% clear: at 300 px/s, throttle down, the
            // tyre turned at 1.25 rad/s where a slick is steering-limited to
            // 0.87, so a corner the slick takes at 217 it took at 300.
            //
            // So a rear that is spinning up at speed scrubs: SCRUB_RATE of
            // deceleration per unit of oversteer per px/s above SCRUB_FROM.
            // At 300 px/s and 0.5 of oversteer that is 187 px/s^2 against 120
            // of surplus thrust: a held slide there bleeds about 60 px/s a
            // second. At 240 and 0.66 it is 148 against 156 - the slide holds
            // its speed - and below ~230 the car still accelerates out of it.
            // So the fun band (150-250, where Nicola's telemetry says he
            // drifts) keeps its slide, and the fast sweeper stops being a
            // corner the tyre takes 13% quicker than a slick can. Set with
            // the game's own driver sent on the tyre (driftsend.js) against
            // the medium: 1.0 left it 2% up, 3.0 put it 0.5% down, 2.5 is
            // level within the noise. Slicks do not oversteer above 207 px/s
            // at all and only faintly above 150, so nothing about them or
            // about the AI's laps changes.
            // Charged on the EXTRA oversteer only - what this compound has
            // above a slick at the same demand - so a slick is untouched, in
            // a hairpin and everywhere else. Deceleration SCRUB_RATE per
            // unit of extra oversteer per px/s of speed: for the drift tyre
            // at 1.0 that is about 30 px/s^2 at 100 px/s, 110 at 150, 170 at
            // 200, 160 at 240, 150 at 300 - against 150-230 of surplus
            // thrust, so a held slide bleeds speed above ~230 and still
            // accelerates out of a hairpin, just less than a slick does.
            const extra = Math.max(0, powerOversteer - (this._osSlick || 0));
            if (extra > 0 && speed > SCRUB_FROM) {
                const k = SCRUB_RATE * extra * (speed - SCRUB_FROM) / speed;
                this.velocity.x -= this.velocity.x * k * dt;
                this.velocity.y -= this.velocity.y * k * dt;
            }
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

        // ...and then the camber, which is gravity across the road rather
        // than the tyres' doing - so it goes on AFTER the grip clamp, not
        // through it. A banked corner does not give the tyre more grip; it
        // holds the car in with a force the tyre never has to find, which is
        // exactly why a banked corner can be taken faster than the same
        // radius flat. Off-camber is the same force pushing the other way,
        // and the car runs wide whatever the driver does with the wheel.
        this.bankNow = 0;
        if (relief && (relief.bx || relief.by) && !onTheGrid) {
            this.bankNow = relief.bank || 0;
            this.velocity.x += relief.bx * RELIEF_BANK * dt;
            this.velocity.y += relief.by * RELIEF_BANK * dt;
        }


        // Apply friction/drag
        let drag = currentFriction;
        if (this.draftStrength > 0) drag *= (1 - 0.30 * this.draftStrength);
        
        this.velocity.x -= this.velocity.x * drag * dt;
        this.velocity.y -= this.velocity.y * drag * dt;
        
        // --- Emit Effects (Skid Marks & Particles) ---
        // Emit skidmarks if lateral sliding is high
        this.slideNow = this.isBroken ? 0 : Math.abs(lateralSpeed);
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
                    // The amount was worked out when the offence happened and
                    // carried here, so the time added at the flag is exactly
                    // the one the banner showed. It is no longer a flat five
                    // seconds: see jumpPenaltySeconds() in main.js.
                    this.raceTime += this.jumpPenaltyMs || 0;
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
        // Scaled rather than the car being made tougher: barriers and contact
        // still hurt, they just stop ending a race in one mistake. WHO is on
        // the gentle curve depends on the difficulty and on the "No AI
        // handicap" box - see softDamage() and the note above it.
        amount *= damageScaleFor(this);
        this.health -= amount;
        // One hook for every hit in the game - barriers, wheel-to-wheel and
        // the crane all arrive here - so the sound cannot get out of step with
        // the damage. What it is worth hearing is main.js's business.
        if (typeof onCarImpact === 'function') onCarImpact(this, amount);
        if (this.health <= 0) {
            this.health = 0;
            this.isBroken = true;
        }
    }
    
    draw(ctx, skipTags) {
        // Un rottame appeso al gancio e' in aria: la sua ombra resta a terra e
        // scivola fuori da sotto. In una vista dall'alto e' l'unica cosa che
        // dica "questa e' sopra la pista, non sulla pista".
        if (this.liftAmount > 0.02) {
            const kk = this.liftAmount;
            ctx.save();
            ctx.translate(this.x + 14 * kk, this.y + 18 * kk);
            ctx.rotate(this.angle);
            paintCarShadow(ctx, this.width, this.height,
                           this.chassis || CHASSIS[CHASSIS_DEFAULT], 0.34 - 0.10 * kk);
            ctx.restore();
        }

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
        
        // --- an open-wheeler, nose towards +x ------------------------------
        // paintCarBody draws in a fixed 24 x 14 design box and scales to the
        // car's own width and height, so the physics - collision box, grid
        // spacing, crane, skid marks - is untouched by anything it does.
        // See WHAT A CAR LOOKS LIKE FROM ABOVE, above.
        const ch = this.chassis || CHASSIS[CHASSIS_DEFAULT];
        const sc = this.liftAmount ? null : _ctxScale(ctx);
        if (sc) {
            const sp = carSprite(this.width, this.height, this.color, ch, this.tyre, sc);
            ctx.drawImage(sp.canvas, -sp.pw / 2, -sp.ph / 2, sp.pw, sp.ph);
        } else {
            ctx.save();
            ctx.translate(1.6, 1.9);
            paintCarShadow(ctx, this.width, this.height, ch);
            ctx.restore();
            paintCarBody(ctx, this.width, this.height, this.color, ch, this.tyre);
        }

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

        // ...and, for whoever is actually driving, how much tyre is left.
        if (this.isPlayer) this.drawTyreGauge(ctx);
    }

    // HOW MUCH RUBBER IS LEFT, under your own car and nobody else's.
    //
    // The number exists in three places already - the pit panel, the tyre
    // screen, the HUD - and reading any of them costs you the corner you were
    // looking at. So it goes where the eyes already are: under the car, drawn
    // in world space like the health bar above it, and only under the cars with
    // a human in them - both of them, in a two-player race.
    //
    // TWO CHANNELS, because it has to answer two questions at a glance and one
    // bar cannot. The SHELL is the compound's own colour - which tyre am I on -
    // and the FILL runs green to amber to red - how much of it is left.
    // Colouring the fill by compound would have made every soft look like an
    // emergency and every hard look fine.
    drawTyreGauge(ctx) {
        const t = this.tyre;
        if (!t || this.isBroken) return;
        // Thinner than the health bar above (24 x 4) on purpose: two bars of
        // the same weight on the same car read as one instrument in two places.
        const W = 26, H = 3;
        const x = this.x - W / 2;
        const y = this.y + this.height + 6;
        const wear = Math.max(0, this.tyreWear || 0);
        const left = Math.max(0, 1 - Math.min(1, wear));

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
        ctx.strokeStyle = t.colour || '#fdd835';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - 0.9, y - 0.9, W + 1.8, H + 1.8);

        if (wear >= 1) {
            // PAST THE ODOMETER the bar is not merely empty. In a pit-stop race
            // the car keeps going on rubber that is finished, and losing 6% of
            // grip per 1% over is not a thing to find out about in a corner, so
            // the gauge pulses - the only thing on screen that does.
            ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(Date.now() / 260));
            ctx.fillStyle = '#F44336';
            ctx.fillRect(x, y, W, H);
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = left > 0.5 ? '#4CAF50' : (left > 0.22 ? '#FFC107' : '#F44336');
            ctx.fillRect(x, y, W * left, H);
        }
        ctx.restore();
    }
}
