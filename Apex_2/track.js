// ===========================================================================
//  THE WORLD, AND THE BOX A CIRCUIT IS ALLOWED TO BE IN
// ===========================================================================
//
//  These five numbers live here, in the geometry file, and main.js reads them.
//  They describe where a circuit may be drawn, which is a fact about circuits,
//  and two files each keeping their own copy of the edge of the screen is the
//  WET_GRIP bug with different numbers.
//
//  The world grew from 1280x720 to 1360x765 - still 16:9 to the pixel - and
//  the reason is worth keeping. Every circuit is laid out by hand so that its
//  GRASS touches the arena: 216 to 1274 in the old world, six pixels of
//  courtesy inside the box. That was the right envelope while the grass was
//  the outermost thing drawn. Then the wide kerbs came back, the verge floor
//  went to `trackWidth + 18` so a 16px kerb would fit under the armco, and the
//  wall moved out - taking with it the painted barrier at wallRadius + 12 and
//  the grass margin, which is stroked to whichever of the two is wider.
//  Thirteen circuits ended up 2 to 19px past the right-hand edge of the canvas
//  and were simply cut off there.
//
//  Scaling the layouts down to fit was tried first and reverted: it worked,
//  but Comb paid 4.6% of its size and the gap between its teeth became wide
//  enough to drive through. A bigger world costs nothing but apparent size -
//  everything renders 6.25% smaller on the same screen - and moves no circuit
//  relative to any other. The widest, Comb, needs 1108px of arena; there are
//  1150.
const WORLD_W = 1360;
const WORLD_H = 765;

const PANEL_W = 210;
const ARENA_X0 = PANEL_W;
const ARENA_X1 = WORLD_W;
const ARENA_Y0 = 0;
const ARENA_Y1 = WORLD_H;

// TRACK_W, TRACK_H and TRACK_X0 were a THIRD copy of these three numbers,
// carrying a comment that said "main.js has the same pair" - which is not a
// constraint, it is a hope, and it was already broken: the world grew and they
// did not, so the crowd stands were still being kept inside a 1280px canvas.
const TRACK_W = WORLD_W;
const TRACK_H = WORLD_H;
const TRACK_X0 = ARENA_X0;


// Number of radii around a puddle's outline. Enough to look organic,
// few enough that the per-frame containment test stays trivial.
const PUDDLE_LOBES = 19;

// Douglas-Peucker on a flat [x, y, x, y, ...] run. A wall is nearly all
// smooth arc, so this is a large saving for no visible change.
function simplifyRun(r, tol) {
    const n = r.length / 2;
    if (n < 3) return r;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const ax = r[a * 2], ay = r[a * 2 + 1], bx = r[b * 2], by = r[b * 2 + 1];
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        let worst = -1, wi = -1;
        for (let i = a + 1; i < b; i++) {
            const px = r[i * 2], py = r[i * 2 + 1];
            const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
            if (d > worst) { worst = d; wi = i; }
        }
        if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(r[i * 2], r[i * 2 + 1]);
    return out;
}

// Is a lap position inside a window that may wrap past the start line?
function inLapWindow(s, win, lapLen) {
    if (win.from <= win.to) return s >= win.from && s <= win.to;
    return s >= win.from || s <= win.to;      // the window straddles the line
}

class SegmentedTrack {
    constructor() {
        // To be overridden by subclasses
        this.trackWidth = 75;
        this.grassWidth = 95;
        this.segments = [];
        this.startX = 500;
        this.startY = 150;
        // How much verge the circuit reserves outside its road, at minimum -
        // see wallRadius(). Eighteen everywhere, because a 16px kerb has to
        // fit under the armco, and Comb is the one exception: its teeth run
        // close enough together that 18 of verge each makes the grass between
        // them driveable, and its arcs are too tight to carry a 16px kerb
        // anyway. It reserves 12, which is still more than the 10px kerb it
        // can actually use.
        this.vergeFloor = 18;
        // Straight walls that are not an offset of the road: Comb has none any
        // more, but the hook is here because a circuit that needs one needs it
        // in the physics, not only in the paint.
        this.dividers = [];
        // True on circuits flipped by mirrorVertically(). The ghost store
        // reads it: a lap recorded one way round cannot drive the other.
        this.mirrored = false;
    }

    // =====================================================================
    //  MIRRORING A CIRCUIT
    //  Thirteen of the seventeen circuits turned right on balance and three
    //  turned left (Crossover, a figure of eight, is the one honest neutral:
    //  272 degrees each way). Nicola plays with the arrow keys, and after
    //  enough seasons the imbalance stops being a statistic and becomes a
    //  sore right ring finger: 5545 degrees of right sweep per calendar
    //  against 2545 of left.
    //
    //  The fix is a TOP-TO-BOTTOM mirror of five right-handed circuits,
    //  chosen among the ones whose silhouette barely changes when flipped.
    //  A vertical mirror is the one transformation that is safe here by
    //  construction: y negates, so every right-hander becomes a left-hander
    //  - which is the point - while the x direction of travel is untouched,
    //  and checkLapCross() counts a lap by crossing startX in +x. Reversing
    //  the segment order instead (same layout, driven backwards) would have
    //  reversed that crossing and silently stopped the lap counter; it was
    //  considered and rejected for exactly that reason.
    //
    //  Everything else is derived - waypoints, racing line, walls, stands,
    //  kerbs, grid slots, the spina, the bridge - so nothing else is
    //  touched. Under reflection an arc's angles negate and its winding
    //  flips; a line keeps its point order. Lap times are unchanged (the
    //  mirrored circuit is congruent), so the record book and personal
    //  bests stay honest; the ghost does not (its trace is coordinates),
    //  which is what the `mirrored` flag on the ghost key is for.
    // =====================================================================
    mirrorVertically() {
        for (const s of this.segments) {
            if (s.type === 'line') {
                s.y1 = -s.y1;
                s.y2 = -s.y2;
            } else {
                s.cy = -s.cy;
                const a = s.start;
                s.start = -a;
                s.end = -s.end;
                s.ccw = !s.ccw;
            }
        }
        for (const d of (this.dividers || [])) {
            d.y1 = -d.y1;
            d.y2 = -d.y2;
        }
        this.startY = -this.startY;
        this.mirrored = true;
        // centreInArena(), called from generateWaypoints, translates the
        // negated coordinates back into the arena; nothing here needs to
        // know where the arena is.
    }

    // =====================================================================
    //  CENTRING THE CIRCUIT IN THE ARENA
    // =====================================================================
    //
    //  A TRANSLATION, and never anything else. This is the whole difference
    //  between it and the version that had to be thrown away: that one scaled
    //  the layouts to make them fit, which took Comb's teeth from 160px apart
    //  to 153 and turned the grass between them into a shortcut. A circuit
    //  that has moved sideways is the same circuit - same lap length, same
    //  corner radii, same gaps, same record book. A circuit that has been
    //  scaled is a new one wearing the old one's name.
    //
    //  So if a circuit genuinely does not fit, this does NOT quietly squeeze
    //  it: it leaves it where it is and says so. The arena is 1150 x 765 and
    //  the widest circuit needs 1108, so there is room; the day there is not,
    //  the answer is a bigger world or a smaller circuit, decided on purpose.
    centreInArena() {
        if (this._centred) return;
        this._centred = true;

        // The outermost paint, which is what the edge of the canvas sees: the
        // grass margin is stroked out to whichever of the grass and the
        // barrier ring is wider (see draw(), step 1).
        const M = Math.max(this.grassWidth, this.barrierRadius());

        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        const see = (x, y) => {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        };
        for (const seg of this.segments) {
            if (seg.type === 'line') { see(seg.x1, seg.y1); see(seg.x2, seg.y2); continue; }
            // An arc reaches wherever its sweep goes, not the four compass
            // points of its circle: sample it. At 0.01 rad the chord sag is
            // r/20000 of a pixel.
            const sweep = this._arcSweep(seg);
            const n = Math.max(8, Math.ceil(Math.abs(sweep) / 0.01));
            for (let i = 0; i <= n; i++) {
                const a = seg.start + sweep * (i / n);
                see(seg.cx + seg.r * Math.cos(a), seg.cy + seg.r * Math.sin(a));
            }
        }
        if (!isFinite(x0)) return;

        const ox = (ARENA_X0 + ARENA_X1) / 2 - (x0 + x1) / 2;
        const oy = (ARENA_Y0 + ARENA_Y1) / 2 - (y0 + y1) / 2;
        this.fitOffset = { x: ox, y: oy, margin: M,
                           fits: (x1 - x0) + 2 * M <= ARENA_X1 - ARENA_X0 &&
                                 (y1 - y0) + 2 * M <= ARENA_Y1 - ARENA_Y0 };
        if (Math.abs(ox) < 0.0005 && Math.abs(oy) < 0.0005) return;

        for (const seg of this.segments) {
            if (seg.type === 'line') {
                seg.x1 += ox; seg.y1 += oy; seg.x2 += ox; seg.y2 += oy;
            } else {
                seg.cx += ox; seg.cy += oy;
            }
        }
        this.startX += ox;
        this.startY += oy;
        for (const d of (this.dividers || [])) {
            d.x1 += ox; d.y1 += oy; d.x2 += ox; d.y2 += oy;
        }
        // Everything else - the racing line, the wall, the barrier, the
        // stands, the bridge - is derived from the segments on first use and
        // cached after, and this runs from the constructor, before any of
        // them exists.
    }

    generateWaypoints() {
        // Every subclass constructor ends with `this.waypoints =
        // this.generateWaypoints()`, which makes this the one hook that runs
        // after the geometry exists and before anything reads it.
        this.centreInArena();

        const waypoints = [];
        const numPoints = 15; // points per segment (straight)
        
        for (const seg of this.segments) {
            if (seg.type === 'line') {
                for (let i = 0; i < numPoints; i++) {
                    waypoints.push({
                        x: seg.x1 + (seg.x2 - seg.x1) * (i / numPoints),
                        y: seg.y1 + (seg.y2 - seg.y1) * (i / numPoints)
                    });
                }
            } else if (seg.type === 'arc') {
                let start = seg.start;
                let end = seg.end;
                
                if (!seg.ccw) { // clockwise
                    while (end <= start) end += Math.PI * 2;
                } else { // counter-clockwise
                    while (end >= start) end -= Math.PI * 2;
                }
                
                const sweep = end - start;
                const arcPoints = Math.max(5, Math.floor(Math.abs(sweep) * seg.r / 15)); // dynamic density
                
                for (let i = 0; i < arcPoints; i++) {
                    const angle = start + sweep * (i / arcPoints);
                    waypoints.push({
                        x: seg.cx + seg.r * Math.cos(angle),
                        y: seg.cy + seg.r * Math.sin(angle)
                    });
                }
            }
        }
        
        return waypoints;
    }
    
    getClosestPoint(x, y) {
        let minDist = Infinity;
        let bestProj = {x: 0, y: 0};
        let bestType = 'line';
        let bestSeg = null;
        
        for (const seg of this.segments) {
            let dist, projX, projY;
            if (seg.type === 'line') {
                const dx = seg.x2 - seg.x1;
                const dy = seg.y2 - seg.y1;
                const len2 = dx*dx + dy*dy;
                let t = ((x - seg.x1)*dx + (y - seg.y1)*dy) / len2;
                t = Math.max(0, Math.min(1, t));
                projX = seg.x1 + t * dx;
                projY = seg.y1 + t * dy;
                dist = Math.hypot(x - projX, y - projY);
            } else if (seg.type === 'arc') {
                let target = Math.atan2(y - seg.cy, x - seg.cx);
                
                // Angle between logic
                let targetNorm = (target % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
                let startNorm = (seg.start % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
                let endNorm = (seg.end % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
                
                let inSweep = false;
                if (!seg.ccw) { // Clockwise
                    if (startNorm <= endNorm) inSweep = targetNorm >= startNorm && targetNorm <= endNorm;
                    else inSweep = targetNorm >= startNorm || targetNorm <= endNorm;
                } else { // Counter-clockwise
                    if (startNorm >= endNorm) inSweep = targetNorm <= startNorm && targetNorm >= endNorm;
                    else inSweep = targetNorm <= startNorm || targetNorm >= endNorm;
                }
                
                if (inSweep) {
                    projX = seg.cx + seg.r * Math.cos(target);
                    projY = seg.cy + seg.r * Math.sin(target);
                    dist = Math.hypot(x - projX, y - projY);
                } else {
                    const x1 = seg.cx + seg.r * Math.cos(seg.start);
                    const y1 = seg.cy + seg.r * Math.sin(seg.start);
                    const d1 = Math.hypot(x - x1, y - y1);
                    
                    const x2 = seg.cx + seg.r * Math.cos(seg.end);
                    const y2 = seg.cy + seg.r * Math.sin(seg.end);
                    const d2 = Math.hypot(x - x2, y - y2);
                    
                    if (d1 < d2) {
                        dist = d1; projX = x1; projY = y1;
                    } else {
                        dist = d2; projX = x2; projY = y2;
                    }
                }
            }
            
            if (dist < minDist) {
                minDist = dist;
                bestProj = {x: projX, y: projY};
                bestType = seg.type;
                bestSeg = seg;
            }
        }
        
        return { dist: minDist, projX: bestProj.x, projY: bestProj.y, segType: bestType, seg: bestSeg };
    }

    // =====================================================================
    //  THE BRIDGE
    //  Only Crossover has one. Everything about it is DERIVED: find where two
    //  stretches of the racing line that are far apart along the lap come
    //  close together in space, and that is the crossing. The two clusters of
    //  nodes there are the two roads; the one whose heading is more nearly
    //  horizontal at that point is arbitrary, so the choice is made explicit
    //  instead - `bridgeOverFirst` says whether the road that reaches the
    //  crossing FIRST in the lap is the one on top.
    //
    //  Returned in the same units the cars carry: lapS, distance round the
    //  lap from the start line. So "is this car under the bridge" is one
    //  comparison, with no geometry at render time.
    // =====================================================================
    getBridge() {
        if (!this.hasBridge) return null;
        if (this._bridge !== undefined) return this._bridge;

        const line = this.getRacingLine('standard');
        const N = line.count, nodes = line.nodes, ds = line.length / N;
        const apart = Math.ceil((this.trackWidth * 6) / ds);   // "far apart along the lap"

        // the closest approach between two such stretches
        let bi = -1, bj = -1, bd = Infinity;
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                if (Math.min(j - i, N - (j - i)) < apart) continue;
                const d = Math.hypot(nodes[i].cx - nodes[j].cx, nodes[i].cy - nodes[j].cy);
                if (d < bd) { bd = d; bi = i; bj = j; }
            }
        }
        if (bd > this.trackWidth) { this._bridge = null; return null; }

        const sStart = line.sStart || 0;
        const L = line.length;
        const lapSOf = (i) => (((nodes[i].s - sStart) % L) + L) % L;

        // how far either side of the crossing the deck reaches: enough to
        // cover the road underneath plus its verges
        const half = this.grassWidth + 26;
        const win = (i) => {
            const w = Math.ceil(half / ds) + 2;
            return { from: lapSOf((i - w + N) % N), to: lapSOf((i + w) % N) };
        };

        const overIdx = this.bridgeOverFirst === false ? bj : bi;
        const underIdx = this.bridgeOverFirst === false ? bi : bj;
        const o = nodes[overIdx], u = nodes[underIdx];

        this._bridge = {
            x: (o.cx + u.cx) / 2,
            y: (o.cy + u.cy) / 2,
            angle: Math.atan2(o.ty, o.tx),      // the deck runs along the upper road
            half: half,                          // half its length, along the road
            // Half its width - and it is the WALL, not the road, because that
            // is where the parapet stands. It used to be trackWidth + 30, so
            // the deck was painted twelve pixels past the line where a car is
            // actually stopped: grey that reads as road and is not.
            wide: this.wallRadius(),
            over: win(overIdx),
            under: win(underIdx)
        };
        return this._bridge;
    }

    // Is this car on the road that goes OVER? Anything else at the crossing
    // is underneath it, and must be drawn before the deck.
    onBridge(car) {
        const b = this.getBridge();
        if (!b || car.lapS === undefined) return false;
        return inLapWindow(car.lapS, b.over, this.getRacingLine('standard').length);
    }
    underBridge(car) {
        const b = this.getBridge();
        if (!b || car.lapS === undefined) return false;
        return inLapWindow(car.lapS, b.under, this.getRacingLine('standard').length);
    }

    // Two cars at the same point are not necessarily in the same place: one
    // may be on the bridge and the other under it. Collisions, the slipstream
    // and the AI's idea of traffic all have to ask this first, or the crossing
    // becomes a demolition derby between cars that never see each other.
    sameLevel(a, b) {
        if (!this.hasBridge) return true;
        const ao = this.onBridge(a), bo = this.onBridge(b);
        const au = this.underBridge(a), bu = this.underBridge(b);
        return !((ao && bu) || (bo && au));
    }

    // The deck itself, drawn after the cars underneath and before the ones on
    // top of it. A slab with a shadow under its lip and a railing either side,
    // so it reads as something the road climbs over.
    drawBridge(ctx) {
        const b = this.getBridge();
        if (!b) return;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);

        const hl = b.half, hw = b.wide;

        // the shadow it casts on the road below, offset down-right
        ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
        ctx.fillRect(-hl + 5, -hw + 6, hl * 2, hw * 2);

        // the deck: the same tarmac as the rest of the circuit, so it reads as
        // road rather than as a lid - but not quite opaque. Solid, it hid the
        // road underneath completely: you drove the underpass blind, with the
        // grass wedges of the crossing invisible under it. At 0.88 the road
        // below and the cars on it show through as shapes, which is enough to
        // place yourself, and the deck still reads as being on top.
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = '#6b6f73';
        ctx.fillRect(-hl, -hw, hl * 2, hw * 2);
        ctx.globalAlpha = 1;
        // a slightly lighter strip down the middle: the running surface
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(-hl, -this.trackWidth, hl * 2, this.trackWidth * 2);

        // expansion joints across it
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 2;
        for (const t of [-0.55, 0.55]) {
            ctx.beginPath();
            ctx.moveTo(hl * t, -hw);
            ctx.lineTo(hl * t, hw);
            ctx.stroke();
        }

        // railings along both edges, with posts
        for (const side of [-1, 1]) {
            const y = side * hw;
            ctx.fillStyle = '#d7d7d7';
            ctx.fillRect(-hl, y - side * 5, hl * 2, 5);
            ctx.fillStyle = '#8d8d8d';
            for (let x = -hl + 6; x < hl; x += 22) {
                ctx.fillRect(x, y - side * 9, 3, 9);
            }
        }
        ctx.restore();
    }

    // =====================================================================
    //  THE WALL YOU ACTUALLY HIT
    //  checkBarrierCollision stops a car when the NEAREST centre line is more
    //  than grassWidth - 12 away (12 being the car's collision radius). The
    //  painted barrier, on the other hand, is a ring at grassWidth: on a wide
    //  circuit the two are close enough that stopping reads as touching the
    //  wall, but they are not the same line, and on a tight one they are
    //  nowhere near each other.
    //
    //  Lombard made that plain. Its verge is 14px wider than its road, so
    //  after the 12px of car there are TWO pixels of run-off: you stop at the
    //  edge of the tarmac while the painted barrier is 14px away across a
    //  green band - and where another part of the circuit passes close, that
    //  painted ring is covered over by its grass and there is nothing to see
    //  at all. A car stopped dead against nothing.
    //
    //  So the wall is drawn where the wall IS: the level set of "distance to
    //  the nearest centre line = grassWidth - 12". Sampling both offsets of
    //  the centre line and keeping only the points that no OTHER stretch of
    //  road is closer to gives exactly the boundary of the drivable area,
    //  including the places where two stretches run together and the boundary
    //  is not a simple offset at all.
    // =====================================================================
    // How far from the centre line a car's CENTRE can get before the barrier
    // stops it. grassWidth is where the barrier stands and 12 is the car's
    // collision radius - but on a circuit whose verge is barely wider than its
    // road that subtraction puts the wall INSIDE the asphalt. Pettine (road
    // 70, verge 75) stopped cars 7px in from the edge of the tarmac, and Crown
    // 2px in; both had done so since they were drawn. The floor keeps the
    // barrier just outside the road, wherever it is.
    // The floor is +9 rather than +2 because a kerb has to fit UNDER it. A
    // kerb is drawn outward from the edge of the road and must end inside the
    // wall - paint it past the wall and on a tight arc it covers the barrier,
    // which is how Thunder and Comb came to look as though their inner
    // barriers were missing.
    //
    // Two pixels of verge cannot carry a kerb, so four circuits had none:
    // Peanut, Comb, Crown, Harbour. Raising the floor gives every circuit
    // enough room for one, and it is a floor rather than seventeen separate
    // edits because the requirement is the same everywhere. Most circuits are
    // untouched or gain a pixel; the four tight ones gain five to seven, which
    // is run-off they always should have had.
    wallRadius() {
        return Math.max(this.grassWidth - 12, this.trackWidth + this.vergeFloor);
    }

    // How far outside the stopping line the armco is painted: one car radius,
    // so that a stopped car is touching it rather than buried in it.
    //
    // This is an OFFSET, not a second radius, and that distinction was a bug.
    // The first version asked for the level set at wallRadius() + 12 - a wider
    // barrier, computed from scratch. Near anything re-entrant the two sets are
    // not parallel curves: where the road doubles back on itself the wider set
    // closes over the notch and simply is not there, while the physics is still
    // stopping cars inside it. Measured, that left Pettine with 996 grid spots
    // where a car is stopped and the nearest painted barrier is up to 171px
    // away - between the teeth of the comb there was no barrier at all - and
    // Lombard with 16 at up to 30px, which is the one Nicola drove into.
    //
    // Building it as an offset of the physics boundary instead makes a ghost
    // impossible by construction: every point that stops a car is 12px inside
    // a painted barrier, because the paint IS that point pushed outwards.
    barrierOffset() {
        return 12;
    }
    barrierRadius() {
        return this.wallRadius() + this.barrierOffset();
    }

    // The barrier as geometry: the set of points at exactly R from the nearest
    // stretch of centre line, each pushed `out` further along its own outward
    // normal. `out` moves the curve without changing which points are ON it.
    //
    // HOW THE CURVE IS FOUND, second edition. The first edition offset dense
    // samples of the centre line, kept the ones no other stretch was closer
    // to, and re-joined the survivors by proximity. Every defect Nicola
    // pointed at in the painted barriers came out of that joining step,
    // because proximity is not order: wherever two stretches of road run
    // close - a comb tooth at Pettine, a spina strip at Kart, the wedges of
    // Crossover's crossing, the island corners of Quadrato and Serpent -
    // survivors from BOTH sides of the gap fall inside the join tolerance,
    // and the run zigzags between them: panels braided down the teeth,
    // crossed at Kart's funnels, hooked at the wedge tips. The 12px paint
    // offset made it worse, because "is there room" was asked as "is the
    // pushed point still off the road" - which stays true after crossing the
    // WHOLE strip, so the two lines were painted past each other, each
    // standing on the other side's wall.
    //
    // So the curve is now TRACED, not stitched: marching squares over the
    // distance field phi(x, y) = "distance to the nearest centre line",
    // sampled on a 2px lattice. Following the contour phi = R cell by cell
    // yields closed, ordered, non-crossing loops by construction - there is
    // no joining heuristic left to get wrong. The field is the same
    // getClosestPoint the physics asks, and every traced vertex is snapped
    // back onto the exact level set along its own gradient, so the paint
    // still cannot disagree with the wall.
    //
    // Three rules ride on top of the trace, and all three are visible on
    // Pettine:
    // - the outward push stops at the RIDGE of the field, the line where
    //   "away from my road" starts to mean "towards the next one". In an 8px
    //   strip each side now stops in the middle instead of overshooting onto
    //   the opposite wall;
    // - where a wall would be painted within a stroke's width of paint that
    //   is already there, it is dropped: one strip of ground no car can
    //   reach gets ONE armco, the way a real circuit builds one wall between
    //   two roads, not two fences drawn through each other. A wall dropped
    //   this way is at most ~19px from the line a stopped car touches -
    //   less than a car's length - and the kept line IS the wall it stands
    //   for, just seen from the other side;
    // - debris shorter than a panel (the collapsed dot inside Thunder's
    //   hairpin, slivers at the crossing) is not worth a stroke and is
    //   culled.

    // phi on a 2px lattice covering every segment plus the widest paint.
    // Computed once per track and freed after the trace. Exact in a band
    // around the wall's own contour, estimated from an 8px pre-pass
    // everywhere else: phi is 1-Lipschitz, so a coarse value more than a
    // cell-diagonal clear of R settles which side of the contour every fine
    // node under it is on, and that is all a far node is ever asked.
    _phiGrid() {
        if (this._phi) return this._phi;
        const STEP = 2, COARSE = 8, SAFE = 14;
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const g of this.segments) {
            if (g.type === 'line') {
                bx0 = Math.min(bx0, g.x1, g.x2); bx1 = Math.max(bx1, g.x1, g.x2);
                by0 = Math.min(by0, g.y1, g.y2); by1 = Math.max(by1, g.y1, g.y2);
            } else {
                bx0 = Math.min(bx0, g.cx - g.r); bx1 = Math.max(bx1, g.cx + g.r);
                by0 = Math.min(by0, g.cy - g.r); by1 = Math.max(by1, g.cy + g.r);
            }
        }
        const pad = this.barrierRadius() + 26;
        const x0 = Math.floor(bx0 - pad), y0 = Math.floor(by0 - pad);
        const w = Math.ceil((bx1 + pad - x0) / STEP) + 2;
        const h = Math.ceil((by1 + pad - y0) / STEP) + 2;
        const R = this.wallRadius();
        const cw = Math.ceil((w * STEP) / COARSE) + 2;
        const ch = Math.ceil((h * STEP) / COARSE) + 2;
        const coarse = new Float32Array(cw * ch);
        for (let j = 0; j < ch; j++)
            for (let i = 0; i < cw; i++)
                coarse[j * cw + i] =
                    this.getClosestPoint(x0 + i * COARSE, y0 + j * COARSE).dist;
        const phi = new Float32Array(w * h);
        for (let j = 0; j < h; j++) {
            const cj = Math.min(ch - 2, (j * STEP / COARSE) | 0);
            const fy = (j * STEP - cj * COARSE) / COARSE;
            for (let i = 0; i < w; i++) {
                const ci = Math.min(cw - 2, (i * STEP / COARSE) | 0);
                const fx = (i * STEP - ci * COARSE) / COARSE;
                const c00 = coarse[cj * cw + ci], c10 = coarse[cj * cw + ci + 1];
                const c01 = coarse[(cj + 1) * cw + ci];
                const c11 = coarse[(cj + 1) * cw + ci + 1];
                const est = c00 + (c10 - c00) * fx + (c01 - c00) * fy
                          + (c11 - c10 - c01 + c00) * fx * fy;
                phi[j * w + i] = Math.abs(est - R) > SAFE
                    ? est
                    : this.getClosestPoint(x0 + i * STEP, y0 + j * STEP).dist;
            }
        }
        this._phi = { x0: x0, y0: y0, step: STEP, w: w, h: h, phi: phi };
        return this._phi;
    }

    // Marching squares on phi at iso-value R. Returns ordered loops of
    // [x, y, ...]; the padding in _phiGrid keeps the contour clear of the
    // lattice border, so every loop closes (first point repeated last).
    _traceWall(R) {
        const G = this._phiGrid();
        const w = G.w, h = G.h, phi = G.phi, S = G.step;

        // One id per lattice edge - horizontal even, vertical odd - and one
        // interpolated crossing per edge, shared by both cells that border
        // it, so neighbouring cells agree on the point to the last bit.
        const ptOf = new Map();
        const keyPt = (key) => {
            let p = ptOf.get(key);
            if (p) return p;
            const e = key >> 1, j = (e / w) | 0, i = e % w;
            const a = phi[j * w + i];
            const b = (key & 1) ? phi[(j + 1) * w + i] : phi[j * w + i + 1];
            const t = (R - a) / (b - a);
            p = (key & 1)
                ? [G.x0 + i * S, G.y0 + (j + t) * S]
                : [G.x0 + (i + t) * S, G.y0 + j * S];
            ptOf.set(key, p);
            return p;
        };
        const HE = (i, j) => (j * w + i) * 2, VE = (i, j) => (j * w + i) * 2 + 1;

        const segA = [], segB = [], touch = new Map();
        const join = (ka, kb) => {
            const id = segA.length;
            segA.push(ka); segB.push(kb);
            let la = touch.get(ka); if (!la) touch.set(ka, la = []); la.push(id);
            let lb = touch.get(kb); if (!lb) touch.set(kb, lb = []); lb.push(id);
        };
        for (let j = 0; j < h - 1; j++) {
            for (let i = 0; i < w - 1; i++) {
                const v0 = phi[j * w + i], v1 = phi[j * w + i + 1];
                const v3 = phi[(j + 1) * w + i], v2 = phi[(j + 1) * w + i + 1];
                let m = 0;
                if (v0 < R) m |= 1; if (v1 < R) m |= 2;
                if (v2 < R) m |= 4; if (v3 < R) m |= 8;
                if (m === 0 || m === 15) continue;
                const T = HE(i, j), B = HE(i, j + 1), L = VE(i, j), Rt = VE(i + 1, j);
                switch (m) {
                    case 1: case 14: join(T, L); break;
                    case 2: case 13: join(T, Rt); break;
                    case 3: case 12: join(L, Rt); break;
                    case 4: case 11: join(Rt, B); break;
                    case 6: case 9:  join(T, B); break;
                    case 7: case 8:  join(L, B); break;
                    // The two saddles: which corners the contour separates is
                    // decided by the cell's centre, not by convention, so two
                    // strips passing a hair apart cannot be fused into an X.
                    case 5:
                        if ((v0 + v1 + v2 + v3) / 4 < R) { join(T, Rt); join(B, L); }
                        else { join(T, L); join(Rt, B); }
                        break;
                    case 10:
                        if ((v0 + v1 + v2 + v3) / 4 < R) { join(T, L); join(Rt, B); }
                        else { join(T, Rt); join(B, L); }
                        break;
                }
            }
        }

        const used = new Uint8Array(segA.length);
        const loops = [];
        for (let s = 0; s < segA.length; s++) {
            if (used[s]) continue;
            used[s] = 1;
            const keys = [segA[s], segB[s]];
            let cur = segB[s];
            for (;;) {
                const cand = touch.get(cur);
                let nxt = -1;
                for (let q = 0; q < cand.length; q++)
                    if (!used[cand[q]]) { nxt = cand[q]; break; }
                if (nxt < 0) break;
                used[nxt] = 1;
                cur = segA[nxt] === cur ? segB[nxt] : segA[nxt];
                keys.push(cur);
            }
            if (keys.length < 4) continue;
            const pts = [];
            for (const k of keys) { const p = keyPt(k); pts.push(p[0], p[1]); }
            loops.push(pts);
        }
        return loops;
    }

    getWalls(R, out) {
        if (R === undefined) R = this.wallRadius();
        out = out || 0;
        this._wallCache = this._wallCache || {};
        const key = R + ':' + out;
        if (this._wallCache[key]) return this._wallCache[key];
        // The geometry of a circuit never changes after its constructor, so
        // the traced wall is shared across instances of the same circuit:
        // reopening the record book, or restarting a race, does not pay for
        // the trace again.
        const store = SegmentedTrack._wallStore || (SegmentedTrack._wallStore = {});
        const skey = this.constructor.name + ':' + key;
        if (store[skey]) return (this._wallCache[key] = store[skey]);
        if (!this.segments.length) return (this._wallCache[key] = []);

        const loops = this._traceWall(R);
        this._phi = null;   // a megabyte per circuit, and the trace is done

        // Snap each traced vertex onto the exact level set, then push it
        // outward - at most `out`, never past the ridge. dist rises 1:1 with
        // the step for as long as the step really moves away from this road;
        // the moment it rises slower, the nearest road is about to change
        // and the paint is about to cross onto somebody else's strip: stop
        // on the last honest step. (And never onto reachable ground,
        // R - 0.75, same rule as ever.)
        const pushed = [];
        for (const pts of loops) {
            const q = [];
            for (let i = 0; i < pts.length; i += 2) {
                const cp = this.getClosestPoint(pts[i], pts[i + 1]);
                if (cp.dist < 1e-6) continue;
                const nx = (pts[i] - cp.projX) / cp.dist;
                const ny = (pts[i + 1] - cp.projY) / cp.dist;
                const bx = cp.projX + nx * R, by = cp.projY + ny * R;
                let t = 0;
                for (let s = 1; s <= out; s++) {
                    const d = this.getClosestPoint(bx + nx * s, by + ny * s).dist;
                    if (d < R - 0.75 || d < R + s - 0.9) break;
                    t = s;
                }
                q.push(bx + nx * t, by + ny * t);
            }
            if (q.length >= 4) pushed.push(q);
        }

        // One wall per strip. A vertex that lands within a stroke's width of
        // paint already kept is dropped and its run breaks there. "Already
        // kept" excludes the last 24px OF ARC of the very line being drawn -
        // always close and always innocent: the line itself and, around a
        // tight cap, its far lip. Arc length and not a count of vertices,
        // because the inward push crowds the trace's vertices together round
        // a tight cap - a corner of Quadrato's island lands hundreds of them
        // in a couple of pixels - and a count that stands for "24px back"
        // on a straight stands for half a pixel there, which broke the cap
        // off the wall it belonged to.
        const CELL = 4, RAD = 7.5, BEHIND = 24;
        const polyLen = (r) => {
            let L = 0;
            for (let i = 2; i < r.length; i += 2)
                L += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
            return L;
        };
        const bins = new Map();
        const runs = [];
        for (let li = 0; li < pushed.length; li++) {
            const q = pushed[li], n = q.length / 2;
            // arc length along the pushed loop, per vertex, for the window
            const arc = new Float64Array(n);
            for (let i = 1; i < n; i++)
                arc[i] = arc[i - 1] +
                    Math.hypot(q[i * 2] - q[i * 2 - 2], q[i * 2 + 1] - q[i * 2 - 1]);
            const total = arc[n - 1];
            let cur = [];
            const flush = () => {
                // shorter than a panel is debris, not barrier
                if (cur.length >= 4 && polyLen(cur) >= 14) runs.push(cur);
                cur = [];
            };
            for (let i = 0; i < n; i++) {
                const x = q[i * 2], y = q[i * 2 + 1];
                const cx = Math.round(x / CELL), cy = Math.round(y / CELL);
                let clash = false;
                for (let a = cx - 2; a <= cx + 2 && !clash; a++) {
                    for (let b = cy - 2; b <= cy + 2 && !clash; b++) {
                        const list = bins.get(a * 100003 + b);
                        if (!list) continue;
                        for (let e = 0; e < list.length; e += 4) {
                            if (list[e] === li) {
                                const d = Math.abs(list[e + 1] - arc[i]);
                                if (Math.min(d, total - d) <= BEHIND) continue;
                            }
                            const dx = list[e + 2] - x, dy = list[e + 3] - y;
                            if (dx * dx + dy * dy <= RAD * RAD) { clash = true; break; }
                        }
                    }
                }
                if (clash) { flush(); continue; }
                cur.push(x, y);
                const bk = cx * 100003 + cy;
                let list = bins.get(bk);
                if (!list) bins.set(bk, list = []);
                list.push(li, arc[i], x, y);
            }
            flush();
        }

        // Thin them out. The trace lands a vertex roughly every 2px, which
        // is what it takes to FIND the wall, not what it takes to draw it:
        // Douglas-Peucker at half a pixel keeps the shape and throws away
        // nine tenths of the points. One care it did not need before: DP
        // hangs a run on its two endpoints, and a loop that survived intact
        // has only one - its seam - so anchoring there flattens the whole
        // loop to a dot (Zipper's island vanished into one). A closed run is
        // split at its farthest point from the seam and the halves stitched
        // back together.
        const simp = (r) => {
            const n = r.length / 2;
            const closed = n > 3 &&
                Math.hypot(r[0] - r[r.length - 2], r[1] - r[r.length - 1]) < 0.01;
            if (!closed) return simplifyRun(r, 0.5);
            let far = 1, best = -1;
            for (let i = 1; i < n - 1; i++) {
                const dx = r[i * 2] - r[0], dy = r[i * 2 + 1] - r[1];
                const d = dx * dx + dy * dy;
                if (d > best) { best = d; far = i; }
            }
            const a = simplifyRun(r.slice(0, far * 2 + 2), 0.5);
            const b = simplifyRun(r.slice(far * 2), 0.5);
            return a.concat(b.slice(2));
        };
        store[skey] = this._wallCache[key] = runs.map(simp);
        return this._wallCache[key];
    }

    // The armco: green, white and red, in that order, all the way round.
    //
    // It is painted at barrierRadius(), so it stands one car radius outside
    // the line where a car is stopped - which means it is the thing your car
    // is touching when it stops, not a stripe lying on the verge. The green is
    // NOT the green of the grass: the verge is #2e7d32 and the field beyond it
    // #3f8f45, both muted, and the flag's own #009246 next to them would read
    // as more grass. It is lifted to a saturated emerald that neither of them
    // can be mistaken for.
    drawBarrier(ctx) {
        const runs = this.getWalls(this.wallRadius(), this.barrierOffset());
        const COLS = ['#00d152', '#f7f7f7', '#e02b2b'];

        ctx.save();
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';

        // A shadow along the foot, so the armco stands up off the grass
        ctx.lineWidth = 9;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)';
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const r of runs) {
            ctx.moveTo(r[0], r[1] + 2);
            for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1] + 2);
        }
        ctx.stroke();

        // Then the panels, one colour after another along the run.
        //
        // The cut points are found by ARC LENGTH and interpolated, not taken
        // from the run's own vertices. The runs come out of Douglas-Peucker,
        // so a straight is two points however long it is: cutting at vertices
        // painted the whole of a straight in a single colour, which is how the
        // first version of this came out - one green line down the inside of
        // every straight and the tricolour only in the corners.
        //
        // The panels are collected by colour and stroked three times rather
        // than once each: Zipper is four hundred panels, and four hundred
        // stroke() calls a frame is a cost worth not paying.
        ctx.lineCap = 'butt';
        ctx.lineWidth = 6;
        const bands = [[], [], []];
        for (const r of runs) {
            // Panel length is per RUN, not global. A fixed 26px meant a short
            // run - the inside of a comb tooth at Pettine, the neck between two
            // lobes at Lombard - got one panel and a stub, came out solid
            // green, and solid green against grass reads as no barrier at all.
            // Every run now shows all three colours however short it is.
            let L = 0;
            for (let i = 2; i < r.length; i += 2)
                L += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
            const SEG = Math.max(3.5, Math.min(26, L / 3));
            let band = 0, cur = [r[0], r[1]], left = SEG;
            for (let i = 2; i < r.length; i += 2) {
                let x0 = r[i - 2], y0 = r[i - 1];
                const x1 = r[i], y1 = r[i + 1];
                let seg = Math.hypot(x1 - x0, y1 - y0);
                while (seg > left) {
                    const t = left / seg;
                    const mx = x0 + (x1 - x0) * t, my = y0 + (y1 - y0) * t;
                    cur.push(mx, my);
                    bands[band % 3].push(cur);
                    band++;
                    cur = [mx, my];
                    x0 = mx; y0 = my;
                    seg -= left;
                    left = SEG;
                }
                left -= seg;
                cur.push(x1, y1);
            }
            if (cur.length >= 4) bands[band % 3].push(cur);
        }
        for (let b = 0; b < 3; b++) {
            ctx.strokeStyle = COLS[b];
            ctx.beginPath();
            for (const p of bands[b]) {
                ctx.moveTo(p[0], p[1]);
                for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
            }
            ctx.stroke();
        }

        // a thin dark rail along the top edge ties the panels together
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(20, 20, 24, 0.55)';
        ctx.beginPath();
        for (const r of runs) {
            ctx.moveTo(r[0], r[1] - 2.4);
            for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1] - 2.4);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Width of the kerb band lining the inside of the corners.
    get kerbWidth() {
        return Math.min(26, Math.max(14, this.trackWidth * 0.30));
    }

    // How much of it actually fits on a given corner. Two limits, and the
    // second one was missing.
    //
    // 1. On a hairpin whose radius is barely wider than the track there is
    //    almost no inside run-off, so the kerb is whatever will fit.
    // 2. It has to stop before the BARRIER. kerbWidth is 30% of the road, and
    //    on several circuits that is wider than the whole verge: Peanut runs a
    //    70px road with an 85px verge and a 21px kerb, so the kerb reached 91
    //    from the middle of the road while the armco stands at 85 - the two
    //    were painted on top of one another. Nobody noticed while there was no
    //    barrier drawn there. Four pixels of clearance, and the cap is applied
    //    here rather than in draw() so that getSurface() agrees with the paint.
    // A kerb has to fit between the edge of the road and the WALL. The third
    // cap used to be written against barrierRadius - where the paint goes -
    // which is twelve pixels further out, so on every circuit in the game the
    // kerb ran 6 to 8px past the wall, onto ground no car can reach.
    //
    // Harmless on a wide sweeper, and not harmless at all on the inside of a
    // tight one. There, "outside the road" points at the arc's own centre, so
    // the boundary is a small circle and the barrier offset shrinks it further:
    // at Thunder's inner hairpin the wall sits 17.75px from the arc centre and
    // the painted barrier collapses to a 5.75px dot, while the kerb - drawn
    // outward from the road edge - covers everything out to 25.75. The
    // tricolour was still being drawn; the kerb was on top of it. That is the
    // "missing inner barrier" at Thunder and Comb.
    //
    // Where the verge is too thin for any kerb at all the answer is none: four
    // circuits have 3px or less between road and wall, and a kerb there was
    // always a fiction painted over the thing it was hiding.
    kerbWidthFor(seg) {
        if (!seg || seg.type !== 'arc') return 0;
        const w = Math.min(this.kerbWidth,
                           Math.max(0, seg.r - this.trackWidth - 2),
                           Math.max(0, this.wallRadius() - this.trackWidth - 2));
        return w < 3 ? 0 : w;
        // There was briefly a third rule here: bands with less than ~30px of
        // painted arc were dropped as litter, which took the kerb off eleven
        // shallow bends - four at Harbour among them. Nicola asked for them
        // back: the kerb goes on EVERY inside curve, short or not. Against
        // the repaired walls they read as the mini-kerbs they are, and the
        // rule went; kerbs are exactly as they were in Apex 2.
    }

    // The widest the kerb ever gets on this circuit, measured from the centre
    // line. Used by the tests that check it stays inside the wall.
    kerbOuterRadius() {
        let w = 0;
        for (const s of this.segments) w = Math.max(w, this.kerbWidthFor(s));
        return w ? this.trackWidth + w : 0;
    }

    getSurface(x, y) {
        const distData = this.getClosestPoint(x, y);
        if (distData.dist <= this.trackWidth) return 'track';

        // Kerbs exist only on the INSIDE of a corner, which is where they are
        // painted: the nearest piece of geometry has to be an arc, and the
        // point has to be on the side towards that arc's centre. The outside of
        // a corner and the whole of every straight are grass. The surface and
        // the paint say the same thing, which is the only way either of them
        // means anything.
        const seg = distData.seg;
        if (distData.segType === 'arc' && seg &&
            distData.dist <= this.trackWidth + this.kerbWidthFor(seg) &&
            Math.hypot(x - seg.cx, y - seg.cy) < seg.r) {
            return 'kerb';
        }
        return 'grass';
    }
    
    // =====================================================================
    //  THE CROSSING IS TWO ROADS, NOT ONE OPEN SQUARE
    //  getClosestPoint() answers "how far is the nearest piece of road", and
    //  where two roads cross that is the wrong question. The union of the two
    //  corridors is an open X, so inside it there is no wall at all: you could
    //  steer off the bridge deck sideways and land on the road underneath, or
    //  climb from the underpass up onto the deck. Both of which Nicola did.
    //  And in the middle of that X sit the four grass wedges between the two
    //  roads, whose tips ARE solid - hidden under the deck, which is how you
    //  hit a barrier you cannot see.
    //
    //  So on a circuit with a bridge the wall is measured against the car's
    //  OWN stretch of road: the racing line nodes around the index the car is
    //  already tracking (car._nodeIdx, kept by car.js with a windowed search).
    //  Away from the crossing the two answers are the same number; at the
    //  crossing this one keeps everybody on the deck they are actually on.
    //
    //  The fallback matters: a car that has been spun and mis-localised would
    //  otherwise be measured against a road it is nowhere near and pushed
    //  across the circuit. Past a wall's worth of margin the global answer
    //  wins again.
    // =====================================================================
    closestOnOwnRoad(car) {
        if (!car || car._nodeIdx === undefined) return null;
        const line = this.getRacingLine('standard');
        const nodes = line.nodes, N = line.count;
        if (!N) return null;
        const W = Math.ceil((this.wallRadius() * 2.5) / (line.ds || 1)) + 2;
        let bd = Infinity, bx = 0, by = 0;
        for (let o = -W; o <= W; o++) {
            const a = nodes[(car._nodeIdx + o + N * 4) % N];
            const b = nodes[(car._nodeIdx + o + 1 + N * 4) % N];
            const dx = b.cx - a.cx, dy = b.cy - a.cy;
            const l2 = dx * dx + dy * dy;
            let t = l2 > 1e-9 ? ((car.x - a.cx) * dx + (car.y - a.cy) * dy) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const px = a.cx + t * dx, py = a.cy + t * dy;
            const d = (car.x - px) * (car.x - px) + (car.y - py) * (car.y - py);
            if (d < bd) { bd = d; bx = px; by = py; }
        }
        if (!isFinite(bd)) return null;
        return { dist: Math.sqrt(bd), projX: bx, projY: by, segType: 'line', seg: null };
    }

    checkBarrierCollision(car) {
        let distData = this.getClosestPoint(car.x, car.y);
        if (this.hasBridge) {
            const own = this.closestOnOwnRoad(car);
            if (own && own.dist > distData.dist &&
                own.dist < this.wallRadius() + 70) distData = own;
        }
        const currentRadius = distData.dist;
        
        // Boundaries (using 12 as car collision radius). One definition, shared
        // with the wall that gets drawn - see wallRadius().
        const maxAllowed = this.wallRadius();
        
        if (currentRadius > maxAllowed) {
            // Push car back inside the allowed bounds
            const dx = car.x - distData.projX;
            const dy = car.y - distData.projY;
            const len = Math.hypot(dx, dy);
            
            if (len > maxAllowed) {
                const push = len - maxAllowed;
                const nx = dx / len;
                const ny = dy / len;
                car.x -= nx * push;
                car.y -= ny * push;

                // Damage scaled by how hard we went into the wall, not by how
                // long we scrape along it: a glancing brush is nearly free, a
                // square hit is expensive.
                // Same shape as car-to-car contact: leaning on the barrier
                // through a corner is free, spearing it is not.
                //   <60 px/s ->   0 hp
                //   100      ->  42 hp
                //   150      -> 210 hp
                //   200      -> 510 hp   (terminal)
                const intoWall = car.velocity.x * nx + car.velocity.y * ny;
                // The player gets a wider free band as well as the damage
                // scale in takeDamage - see PLAYER_FREE_IMPACT in car.js.
                const free = 60 + (car.isPlayer && typeof playerFreeImpact === 'function'
                    ? playerFreeImpact() : 0);
                if (intoWall > free) {
                    // ONE impact may not finish a healthy car.
                    //
                    // The curve above was set on circuits where a wall can only
                    // ever be grazed - measured, the barrier is 88 to 89
                    // degrees off your nose on all of the old ones, so a "square
                    // hit" was unreachable. Two of the new circuits double back
                    // on themselves: on Lombard, inside a hook, and on
                    // Crossover, in the wedges beside the crossing, the wall
                    // stands 0 to 2 degrees off your nose. There a single touch
                    // at 260px/s costs 346hp of a 255hp car - qualifying over,
                    // one mistake, no warning. It ended a session in a log
                    // Nicola sent.
                    //
                    // So a heavy shunt still all but ruins the car, and a
                    // second one does finish it, but the first one leaves you
                    // something to limp home with.
                    const raw = 260 * Math.pow((intoWall - free) / 100, 2);
                    // The cap is on what the car ACTUALLY loses, so it means
                    // the same thing for the player - whose damage is scaled
                    // down in takeDamage - as for everybody else: at most 62%
                    // of a full car, from any one impact.
                    const scale = (car.isPlayer && typeof playerDamageScale === 'function')
                        ? playerDamageScale() : 1;
                    const cap = (car.maxHealth * 0.62) / scale;
                    car.takeDamage(Math.min(raw, cap));
                }

                // Tangent projection for sliding effect (non-sticky wall)
                const tx = -ny;
                const ty = nx;
                const vDotT = car.velocity.x * tx + car.velocity.y * ty;
                car.velocity.x = tx * vDotT * 0.98;
                car.velocity.y = ty * vDotT * 0.98;
            }
        }
    }
    
    // =====================================================================
    //  RACING LINE  (used exclusively by the AI - does not touch waypoints)
    // ---------------------------------------------------------------------
    //  Builds, lazily and only once per track instance (~5-25 ms), a
    //  uniformly sampled centre line plus a "geometric" racing line obtained
    //  by constrained Laplacian relaxation, together with the local radius of
    //  curvature and the maximum physically attainable corner speed.
    // =====================================================================

    _arcSweep(seg) {
        let start = seg.start;
        let end = seg.end;
        if (!seg.ccw) {
            while (end <= start) end += Math.PI * 2;
        } else {
            while (end >= start) end -= Math.PI * 2;
        }
        return end - start;
    }

    _segLength(seg) {
        if (seg.type === 'line') return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
        return Math.abs(this._arcSweep(seg)) * seg.r;
    }

    _segPoint(seg, t) {
        if (seg.type === 'line') {
            return { x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t };
        }
        const a = seg.start + this._arcSweep(seg) * t;
        return { x: seg.cx + seg.r * Math.cos(a), y: seg.cy + seg.r * Math.sin(a) };
    }

    // Analytic lap time of a candidate line: sum of ds / attainable speed.
    // Used to pick the best line rather than assuming a fixed relaxation is
    // optimal - which layout wins changes from track to track.
    _lapTimeOf(line) {
        let t = 0;
        const N = line.count;
        for (let i = 0; i < N; i++) {
            const a = line.nodes[i];
            const b = line.nodes[(i + 1) % N];
            const seg = Math.hypot(b.x - a.x, b.y - a.y);
            t += seg / Math.min(355, a.vCorner);
        }
        return t;
    }

    // level: 'standard' (default) or 'fast'.
    // 'fast' is the quickest of several relaxation depths, measured rather
    // than assumed. Only the Impossible AI is allowed to use it.
    // Total centre-line length, cached. Used by car.js for the half-distance
    // check, which must be in real distance: the waypoint list is unevenly
    // spaced (15 points per line segment regardless of its length), so
    // "half the waypoints" is not "half the lap".
    getLength() {
        if (this._length === undefined) {
            let L = 0;
            for (const seg of this.segments) L += this._segLength(seg);
            this._length = L;
        }
        return this._length;
    }

    // Cumulative arc length along the waypoint polyline, so a car's progress
    // round the lap can be measured in real track distance rather than in
    // distance travelled (which a spin or a reverse inflates for free).
    getWaypointArcLengths() {
        if (!this._wpS) {
            const w = this.waypoints;
            const S = new Float64Array(w.length);
            let acc = 0;
            for (let i = 0; i < w.length; i++) {
                S[i] = acc;
                const n = w[(i + 1) % w.length];
                acc += Math.hypot(n.x - w[i].x, n.y - w[i].y);
            }
            this._wpS = S;
            this._wpTotal = acc;
        }
        return this._wpS;
    }

    getWaypointTotal() {
        this.getWaypointArcLengths();
        return this._wpTotal;
    }

    getRacingLine(level) {
        if (!this._lineStd) {
            this._lineStd = this.buildRacingLine(600);

            let best = this._lineStd;
            let bestT = this._lapTimeOf(best);
            for (const sweeps of [1000, 1800]) {
                const cand = this.buildRacingLine(sweeps);
                const tc = this._lapTimeOf(cand);
                if (tc < bestT) { best = cand; bestT = tc; }
            }
            this._lineFast = best;

            // Arc length of the start line itself. Node 0 is wherever the
            // first track segment happens to begin, which is no use as a
            // datum: distances have to be measured from the line every car
            // crosses, or two cars at the same point on track read differently.
            for (const line of [this._lineStd, this._lineFast]) {
                let si = 0, md = Infinity;
                for (let i = 0; i < line.count; i++) {
                    const d = Math.hypot(line.nodes[i].cx - this.startX,
                                         line.nodes[i].cy - this.startY);
                    if (d < md) { md = d; si = i; }
                }
                line.sStart = line.nodes[si].s;
            }
        }
        return level === 'fast' ? this._lineFast : this._lineStd;
    }

    buildRacingLine(sweeps) {
        // ---- 1. dense polyline of the centre line -----------------------
        const dense = [];
        for (const seg of this.segments) {
            const len = this._segLength(seg);
            const n = Math.max(2, Math.ceil(len / 2));
            for (let i = 0; i < n; i++) dense.push(this._segPoint(seg, i / n));
        }

        const M = dense.length;
        const cum = new Float64Array(M + 1);
        for (let i = 0; i < M; i++) {
            const a = dense[i];
            const b = dense[(i + 1) % M];
            cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
        }
        const total = cum[M];

        // ---- 2. uniform resampling --------------------------------------
        const N = Math.max(48, Math.round(total / 8));
        const ds = total / N;

        const nodes = [];
        let j = 0;
        for (let i = 0; i < N; i++) {
            const s = i * ds;
            while (j < M - 1 && cum[j + 1] < s) j++;
            const segLen = cum[j + 1] - cum[j];
            const t = segLen > 1e-9 ? (s - cum[j]) / segLen : 0;
            const a = dense[j];
            const b = dense[(j + 1) % M];
            nodes.push({
                cx: a.x + (b.x - a.x) * t,
                cy: a.y + (b.y - a.y) * t,
                s: s
            });
        }

        // centre-line tangents / normals
        for (let i = 0; i < N; i++) {
            const p = nodes[(i + 1) % N];
            const m = nodes[(i - 1 + N) % N];
            const tx = p.cx - m.cx;
            const ty = p.cy - m.cy;
            const L = Math.hypot(tx, ty) || 1;
            nodes[i].tx = tx / L;
            nodes[i].ty = ty / L;
            nodes[i].nx = -ty / L;   // left/right normal (unit)
            nodes[i].ny = tx / L;
        }

        // ---- 3. constrained relaxation -> racing line --------------------
        // Constrained Laplacian relaxation: each node is pulled towards the
        // midpoint of its neighbours and clamped inside the usable width, so
        // the path shortens and straightens ("geometric" racing line: brake
        // outside, clip the apex, exit wide).
        //
        // The iteration count is deliberately finite.  Run to convergence this
        // becomes the shortest path, which hugs the inner kerb and therefore
        // tightens the radius; stopping early leaves a length/curvature
        // compromise.  600 sweeps is the safe all-round setting; getRacingLine
        // also measures deeper relaxations and keeps the quickest as the
        // 'fast' line for the Impossible AI.
        const maxOff = Math.max(3, this.trackWidth - 20);
        const alpha = new Float64Array(N);

        const px = (i) => nodes[i].cx + alpha[i] * nodes[i].nx;
        const py = (i) => nodes[i].cy + alpha[i] * nodes[i].ny;

        const nSweeps = sweeps || 600;
        for (let it = 0; it < nSweeps; it++) {
            for (let i = 0; i < N; i++) {
                const ip = (i + 1) % N;
                const im = (i - 1 + N) % N;
                const mx = (px(im) + px(ip)) * 0.5 - nodes[i].cx;
                const my = (py(im) + py(ip)) * 0.5 - nodes[i].cy;
                let want = mx * nodes[i].nx + my * nodes[i].ny;
                if (want > maxOff) want = maxOff;
                if (want < -maxOff) want = -maxOff;
                alpha[i] += (want - alpha[i]) * 0.35;
            }
        }

        for (let i = 0; i < N; i++) {
            nodes[i].alpha = alpha[i];
            nodes[i].x = nodes[i].cx + alpha[i] * nodes[i].nx;
            nodes[i].y = nodes[i].cy + alpha[i] * nodes[i].ny;
        }

        // racing-line heading
        for (let i = 0; i < N; i++) {
            const p = nodes[(i + 1) % N];
            const m = nodes[(i - 1 + N) % N];
            nodes[i].heading = Math.atan2(p.y - m.y, p.x - m.x);
        }

        // ---- 4. local radius of curvature (wide stencil, then min-filter)
        const k = Math.max(2, Math.round(26 / ds));
        const raw = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            const A = nodes[(i - k + N * 4) % N];
            const B = nodes[i];
            const C = nodes[(i + k) % N];
            const a = Math.hypot(B.x - C.x, B.y - C.y);
            const b = Math.hypot(A.x - C.x, A.y - C.y);
            const c = Math.hypot(A.x - B.x, A.y - B.y);
            const area = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) * 0.5;
            let r = area < 1e-6 ? 1e6 : (a * b * c) / (4 * area);
            if (!isFinite(r) || r > 1e6) r = 1e6;
            raw[i] = Math.max(12, r);
        }
        // Two radii per node:
        //   radius     - conservative, the tightest of the neighbourhood, so an
        //                AI reading it brakes early enough for what is coming;
        //   radiusRaw  - the local value, which a very good driver can exploit.
        // ai.js blends between them with its "radiusOptimism" parameter.
        const w = Math.max(1, Math.round(k * 0.6));
        for (let i = 0; i < N; i++) {
            let r = raw[i];
            for (let o = -w; o <= w; o++) {
                const v = raw[(i + o + N * 4) % N];
                if (v < r) r = v;
            }
            nodes[i].radius = r;
            nodes[i].radiusRaw = raw[i];
        }

        // ---- 5. dry, steering-limited corner speed ----------------------
        // The car's yaw rate is capped at maxSteer * (1 - v/500); holding a
        // radius R requires a yaw rate of v/R, hence the closed form below.
        const maxSteer = Math.PI * 0.7;
        for (let i = 0; i < N; i++) {
            const R = nodes[i].radius;
            let v = maxSteer / (1 / R + maxSteer / 500);
            if (!isFinite(v) || v < 0) v = 500;
            nodes[i].vCorner = Math.min(500, v);
        }

        return { nodes: nodes, count: N, ds: ds, length: total, maxOffset: maxOff };
    }

    checkLapCross(prevX, prevY, currX, currY) {
        // Broaden the Y check so we don't miss cars on the grass/barrier
        if (prevX < this.startX && currX >= this.startX && Math.abs(currY - this.startY) < this.grassWidth + 100) {
            return true;
        }
        return false;
    }

    drawPath(ctx) {
        ctx.beginPath();
        let first = true;
        for (const seg of this.segments) {
            if (seg.type === 'line') {
                if (first) {
                    ctx.moveTo(seg.x1, seg.y1);
                    first = false;
                } else {
                    ctx.lineTo(seg.x1, seg.y1);
                }
                ctx.lineTo(seg.x2, seg.y2);
            } else if (seg.type === 'arc') {
                ctx.arc(seg.cx, seg.cy, seg.r, seg.start, seg.end, seg.ccw);
                first = false;
            }
        }
        ctx.closePath();
    }

    // =====================================================================
    //  GRANDSTANDS
    //  Placed once from the track geometry: sampled along the centre line,
    //  pushed outside the barrier, and rejected where they would fall off the
    //  canvas or land on another part of the circuit.
    // =====================================================================
    getStands() {
        if (this._stands) return this._stands;

        const line = this.getRacingLine('standard');
        const stands = [];

        let seed = 987654321;
        const rand = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };

        // Every corner of the rectangle must clear the circuit and the canvas,
        // not just its centre: a long stand tangent to a corner would otherwise
        // have its ends buried in the track.
        const corners = (cx, cy, ang, len, depth) => {
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const hl = len / 2, hd = depth / 2;
            const pts = [];
            for (const [u, v] of [[-hl, -hd], [hl, -hd], [hl, hd], [-hl, hd]]) {
                pts.push({ x: cx + u * ca - v * sa, y: cy + u * sa + v * ca });
            }
            return pts;
        };

        // Dense candidate sweep, then keep only what fits. Better to try many
        // positions and reject most than to place a few blindly.
        const step = Math.max(4, Math.round(line.count / 60));

        for (let i = 0; i < line.count; i += step) {
            const n = line.nodes[i];
            const ang = Math.atan2(n.ty, n.tx);

            for (const side of [1, -1]) {
                const len = 96 + rand() * 44;      // noticeably bigger than before
                const depth = 34 + rand() * 8;
                const off = this.grassWidth + 24 + depth / 2;

                const cx = n.cx + n.nx * off * side;
                const cy = n.cy + n.ny * off * side;

                const pts = corners(cx, cy, ang, len, depth);

                // 1. fully on canvas
                let ok = true;
                for (const p of pts) {
                    if (p.x < TRACK_X0 + 8 || p.x > TRACK_W - 8 ||
                        p.y < 8 || p.y > TRACK_H - 8) { ok = false; break; }
                }
                if (!ok) continue;

                // 2. every corner clear of every part of the circuit
                for (const p of pts) {
                    if (this.getClosestPoint(p.x, p.y).dist < this.grassWidth + 14) { ok = false; break; }
                }
                if (!ok) continue;
                // and the middle of the long sides, for a stand straddling a gap
                for (const t of [-0.5, 0, 0.5]) {
                    const mx = cx + Math.cos(ang) * len * t;
                    const my = cy + Math.sin(ang) * len * t;
                    if (this.getClosestPoint(mx, my).dist < this.grassWidth + 14) { ok = false; break; }
                }
                if (!ok) continue;

                // 3. clear of every stand already placed (bounding circles + margin)
                const r = Math.hypot(len / 2, depth / 2);
                for (const s of stands) {
                    const rs = Math.hypot(s.len / 2, s.depth / 2);
                    if (Math.hypot(cx - s.x, cy - s.y) < r + rs + 12) { ok = false; break; }
                }
                if (!ok) continue;

                stands.push({
                    x: cx, y: cy, angle: ang, len: len, depth: depth,
                    fill: 0.55 + rand() * 0.45,     // how full this stand is
                    seed: Math.floor(rand() * 100000)
                });
            }
        }

        this._stands = stands;
        return stands;
    }

    drawStands(ctx) {
        const stands = this.getStands();
        const shimmer = Math.floor(Date.now() / 260);
        const shirts = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fb8c00',
                        '#8e24aa', '#ffffff', '#00acc1', '#d81b60', '#6d4c41'];

        for (const s of stands) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.angle);

            const hl = s.len / 2;
            const hd = s.depth / 2;

            // structure: back wall, then tiered seating stepping down to the track
            ctx.fillStyle = '#4a4a52';
            ctx.fillRect(-hl - 3, -hd - 3, s.len + 6, s.depth + 6);
            ctx.fillStyle = '#5f5f68';
            ctx.fillRect(-hl, -hd, s.len, s.depth);

            const rows = 4;
            const rowH = s.depth / rows;
            let rnd = s.seed;
            const rr = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };

            for (let r = 0; r < rows; r++) {
                const y = -hd + r * rowH;
                // tier deck, lighter towards the track
                ctx.fillStyle = r % 2 === 0 ? '#6b6b75' : '#77777f';
                ctx.fillRect(-hl, y, s.len, rowH - 1);

                // spectators
                const seats = Math.floor(s.len / 7);
                for (let k = 0; k < seats; k++) {
                    if (rr() > s.fill) continue;
                    const idx = Math.floor(rr() * shirts.length);
                    // a few of them keep moving about
                    const bob = (rr() < 0.12) ? ((shimmer + k) % 2) : 0;
                    ctx.fillStyle = shirts[idx];
                    ctx.fillRect(-hl + 3 + k * 7, y + 1.5 + bob, 4, 4);
                }
            }

            // safety fence facing the circuit
            ctx.strokeStyle = 'rgba(210,210,215,0.55)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-hl, hd + 1.5);
            ctx.lineTo(hl, hd + 1.5);
            ctx.stroke();

            ctx.restore();
        }
    }

    // --- Puddles ---------------------------------------------------------
    // Standing water, only in the wet. Placed on the racing line itself so
    // they are unavoidable at speed rather than scenery you can steer round,
    // and offset sideways so the fast line through a corner is a real choice.
    // Regenerated per race (main.js calls makePuddles at the start).
    makePuddles(count) {
        this.puddles = [];
        if (typeof this.getRacingLine !== 'function') return this.puddles;
        const line = this.getRacingLine('standard');
        const N = line.count;
        const n = count === undefined ? 5 : count;
        const used = [];
        for (let attempt = 0; attempt < n * 12 && this.puddles.length < n; attempt++) {
            const i = Math.floor(Math.random() * N);
            // keep them apart: a cluster is just a wet sector
            if (used.some(j => Math.abs(i - j) < N / (n + 2))) continue;
            used.push(i);
            const nd = line.nodes[i];
            const side = (Math.random() < 0.5 ? 1 : -1);
            const off = (0.25 + Math.random() * 0.55) * this.trackWidth * side;
            const r = 26 + Math.random() * 22;

            // An irregular outline rather than a circle, built from three
            // things laid on top of each other:
            //
            //   * a STRETCH. Water pools along the road rather than across it,
            //     so the outline is an ellipse elongated in the direction the
            //     tarmac runs, by a random amount.
            //   * two waves round the outline, a slow one and a fast one. One
            //     harmonic alone gives an egg; two give a shape with a couple
            //     of broad bays and some smaller kinks, which is what a puddle
            //     looks like.
            //   * per-lobe noise, smoothed once with its neighbours so the
            //     edge undulates instead of spiking.
            //
            // The first version was noise alone, smoothed - which reads as a
            // slightly wobbly disc, because random values with no structure
            // average out to a circle. The structure is what makes it a shape.
            const stretch = 1.25 + Math.random() * 0.55;   // along the road
            const along = Math.atan2(nd.ty !== undefined ? nd.ty : 0,
                                     nd.tx !== undefined ? nd.tx : 1);
            const ph1 = Math.random() * Math.PI * 2, ph2 = Math.random() * Math.PI * 2;
            const a1 = 0.16 + Math.random() * 0.16;        // slow wave
            const a2 = 0.06 + Math.random() * 0.10;        // fast one
            const w2 = 3 + Math.floor(Math.random() * 3);  // 3, 4 or 5 lobes
            const raw = [];
            for (let k = 0; k < PUDDLE_LOBES; k++) {
                const th = (k / PUDDLE_LOBES) * Math.PI * 2;
                // ellipse: r(th) for a body stretched by `stretch` along `along`
                const rel = th - along;
                const ex = Math.cos(rel) / stretch, ey = Math.sin(rel);
                const ell = 1 / Math.sqrt(ex * ex + ey * ey);
                raw.push(ell * (1 + a1 * Math.sin(2 * th + ph1)
                                  + a2 * Math.sin(w2 * th + ph2))
                             * (0.86 + Math.random() * 0.28));
            }
            const rad = [];
            for (let k = 0; k < PUDDLE_LOBES; k++) {
                const a = raw[(k - 1 + PUDDLE_LOBES) % PUDDLE_LOBES];
                const b = raw[k];
                const c = raw[(k + 1) % PUDDLE_LOBES];
                rad.push((a + 2 * b + c) / 4);
            }
            this.puddles.push({
                x: nd.cx + nd.nx * off,
                y: nd.cy + nd.ny * off,
                r: r,
                rad: rad,
                rot: Math.random() * Math.PI * 2,
                rMax: r * Math.max.apply(null, rad)
            });
        }
        return this.puddles;
    }

    // Radius of a puddle in the direction of a given angle.
    _puddleRadius(p, ang) {
        if (!p.rad) return p.r;
        const n = p.rad.length;
        const t = ((ang - p.rot) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * n;
        const i0 = Math.floor(t) % n;
        const i1 = (i0 + 1) % n;
        const f = t - Math.floor(t);
        return p.r * (p.rad[i0] * (1 - f) + p.rad[i1] * f);
    }

    puddleAt(x, y) {
        if (!this.puddles || !this.puddles.length) return false;
        for (const p of this.puddles) {
            const dx = x - p.x, dy = y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > (p.rMax || p.r) * (p.rMax || p.r)) continue;   // cheap reject
            const rr = this._puddleRadius(p, Math.atan2(dy, dx));
            if (d2 < rr * rr) return true;
        }
        return false;
    }

    drawPuddles(ctx) {
        if (!this.puddles || !this.puddles.length) return;
        ctx.save();
        for (const p of this.puddles) {
            const n = (p.rad && p.rad.length) || 1;
            // Points on the outline, joined with a Catmull-Rom style smoothing
            // through the midpoints so the shape is organic, not a polygon.
            const pts = [];
            for (let k = 0; k < n; k++) {
                const a = p.rot + (k / n) * Math.PI * 2;
                const rr = p.r * (p.rad ? p.rad[k] : 1);
                pts.push([p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr]);
            }
            ctx.beginPath();
            const mid = (i, j) => [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
            let m = mid(n - 1, 0);
            ctx.moveTo(m[0], m[1]);
            for (let k = 0; k < n; k++) {
                const nx = mid(k, (k + 1) % n);
                ctx.quadraticCurveTo(pts[k][0], pts[k][1], nx[0], nx[1]);
            }
            ctx.closePath();

            const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.1, p.x, p.y, p.rMax || p.r);
            g.addColorStop(0, 'rgba(64,104,150,0.80)');
            g.addColorStop(0.65, 'rgba(78,120,166,0.60)');
            g.addColorStop(1, 'rgba(96,140,186,0.34)');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = 'rgba(190,225,250,0.34)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        ctx.restore();
    }

    draw(ctx) {
        // Stands first: they sit outside the barriers, behind everything else.
        this.drawStands(ctx);

        ctx.lineCap = 'butt'; // Crucial for segmented drawing without huge overlap
        ctx.lineJoin = 'round';
        
        // The tricolour barrier is back, and this time it is where a barrier
        // belongs. Two earlier attempts were not: the original was a stroke
        // wider than the grass drawn UNDERNEATH it, so only a ring showed and
        // the round joins at the corners bulged it into detached bars lying on
        // the verge; the second was a thin dashed line painted along the line
        // where a car stops, which was geometrically right but read as paint.
        // This one is drawn last, as panels, at barrierRadius() - one car
        // radius outside the stopping line, so it is the thing you are
        // touching when you stop.

        // 1. Grass Margin (Dark Green), out as far as the barrier. On fifteen
        //    circuits that is grassWidth exactly; Pettine and Crown have a
        //    verge narrower than their own barrier and get the few pixels they
        //    were missing, so the armco never floats on the background.
        this.drawPath(ctx);
        ctx.lineWidth = Math.max(this.grassWidth, this.barrierRadius()) * 2;
        // Grass unless a circuit says otherwise: vergeColour is the hook a
        // layout uses when its run-off is not lawn.
        ctx.strokeStyle = this.vergeColour || '#2e7d32';
        ctx.stroke();

        // 2. Kerbs, on the INSIDE of every corner, wide enough to cover the
        //    grass out to the barrier.
        //
        //    Inside of arcs only: a straight has no kerb, and neither does the
        //    outside of a corner. That is how they were drawn originally and it
        //    is what Nicola wants back - a band round the whole lap, tried
        //    first, was the wrong reading of "bigger".
        //
        //    What HAS changed is the width. They used to be capped against
        //    barrierRadius, which let them run past the wall and, on a tight
        //    arc, straight over the tricolour barrier; then capped against the
        //    wall, which on four circuits left no room at all. The verge is 18px
        //    everywhere now, so the band is 16 and reaches from the edge of the
        //    asphalt to just short of the armco on every circuit in the game.
        for (const seg of this.segments) {
            if (seg.type !== 'arc') continue;

            const kw = this.kerbWidthFor(seg);
            if (kw < 3) continue;               // no verge to put one on
            const rk = seg.r - this.trackWidth - kw / 2;
            if (rk <= 2) continue;

            const sweep = this._arcSweep(seg);
            const arcLen = Math.abs(sweep) * rk;
            const bands = Math.max(4, Math.round(arcLen / 22));

            for (let b = 0; b < bands; b++) {
                const a0 = seg.start + sweep * (b / bands);
                const a1 = seg.start + sweep * ((b + 1) / bands);
                ctx.beginPath();
                ctx.arc(seg.cx, seg.cy, rk, a0, a1, sweep < 0);
                ctx.lineWidth = kw;
                ctx.strokeStyle = (b % 2 === 0) ? '#d32f2f' : '#f2f2f2';
                ctx.stroke();
            }
        }

        // 3. Track Asphalt (Dark Grey)
        this.drawPath(ctx);
        ctx.lineWidth = this.trackWidth * 2;
        ctx.strokeStyle = '#555';
        ctx.stroke();

        this.drawStartLine(ctx);
        this.drawBarrier(ctx);
        // On top of the asphalt, under the cars.
        this.drawPuddles(ctx);
    }
    
    drawStartLine(ctx) {
        ctx.fillStyle = '#fff';
        const startY = this.startY - this.trackWidth;
        const width = 10;
        const height = this.trackWidth * 2;
        
        // Draw checkered pattern
        for (let i = 0; i < height; i += 10) {
            for (let j = 0; j < width; j += 5) {
                if ((i / 10 + j / 5) % 2 === 0) {
                    ctx.fillRect(this.startX + j, startY + i, 5, 10);
                } else {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(this.startX + j, startY + i, 5, 10);
                    ctx.fillStyle = '#fff';
                }
            }
        }
    }
}

class OvalTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 80;
        this.grassWidth = 110;
        
        const cx1 = 350;
        const cx2 = 650;
        const cy = 350;
        const r = 180; // the end radius; the straights carry the extra width
        
        this.startX = 657.33;
        this.startY = 180;
        
        this.segments = [
            { type: 'line', x1: 506, y1: 180, x2: 984, y2: 180 },
            { type: 'arc', cx: 984, cy: 360, r: 180, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 984, y1: 540, x2: 506, y2: 540 },
            { type: 'arc', cx: 506, cy: 360, r: 180, start: 1.5708, end: -1.5708, ccw: false }
        ];
        
        this.mirrorVertically();   // see mirrorVertically(): the left-hand half of the calendar
        this.waypoints = this.generateWaypoints();
    }
}


class F1Track extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 60;
        this.grassWidth = 80;
        this.startX = 603.53;
        this.startY = 147.5;
        
        this.segments = [
            { type: 'line', x1: 396, y1: 147.5, x2: 981.5, y2: 147.5 },
            { type: 'arc', cx: 981.5, cy: 360, r: 212.5, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 981.5, y1: 572.5, x2: 800.34, y2: 572.5 },
            { type: 'arc', cx: 800.34, cy: 497.5, r: 75, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: 725.34, y1: 497.5, x2: 725.34, y2: 422.5 },
            { type: 'arc', cx: 650.34, cy: 422.5, r: 75, start: 0, end: -1.5708, ccw: true },
            { type: 'line', x1: 650.34, y1: 347.5, x2: 396, y2: 347.5 },
            { type: 'arc', cx: 396, cy: 247.5, r: 100, start: 1.5708, end: -1.5708, ccw: false }
        ];
        
        this.waypoints = this.generateWaypoints();
    }
}

class PeanutTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 85;
        const dx = 250;
        const dy = 1000;
        const theta = Math.atan2(dy, dx);
        
        const cx1 = 250;
        const cx2 = 750;
        const cy = 350;
        const rSmall = 125;
        
        // Distance is sqrt(250^2 + 1000^2) = 1030.7
        // So R_big = 1030.7 - 125 = 905.7
        
        const rBig = 905.7;
        const cyTop = cy - dy;
        const cyBot = cy + dy;
        
        this.startX = 745;
        this.startY = 251.28;
        
        this.segments = [
            { type: 'arc', cx: 472.14, cy: 360, r: 171.14, start: 1.12096, end: 5.16223, ccw: false },
            { type: 'arc', cx: 745, cy: -205.1, r: 456.38, start: 2.02064, end: 1.12096, ccw: true },
            { type: 'arc', cx: 1017.86, cy: 360, r: 171.14, start: 4.26255, end: 2.02064, ccw: false },
            { type: 'arc', cx: 745, cy: 925.1, r: 456.38, start: -1.12096, end: -2.02064, ccw: true }
        ];
        
        this.mirrorVertically();   // see mirrorVertically(): the left-hand half of the calendar
        this.waypoints = this.generateWaypoints();
    }
}

class CircoMassimoTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 50;
        this.grassWidth = 70;
        
        
        this.startX = 724.57;
        this.startY = 285.6;
        
        this.segments = [
            { type: 'line', x1: 360.4, y1: 285.6, x2: 1129.6, y2: 285.6 },
            { type: 'arc', cx: 1129.6, cy: 360, r: 74.4, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 1129.6, y1: 434.4, x2: 360.4, y2: 434.4 },
            { type: 'arc', cx: 360.4, cy: 360, r: 74.4, start: 1.5708, end: -1.5708, ccw: false }
        ];
        
        this.waypoints = this.generateWaypoints();
    }
    
    draw(ctx) {
        super.draw(ctx);
        
        // The "spina", the central barrier of the Circus. It used to be a
        // 15px grey line with a 10px sand line painted ON TOP of it, which
        // left 2.5px of visible wall per side - effectively invisible. Now
        // the sand is the bed and the wall stands on it.
        // Derived from the geometry rather than typed in, so the spina follows
        // the circuit wherever it is laid out.
        const ends = this.segments.filter(s => s.type === 'arc');
        const x1 = Math.min(ends[0].cx, ends[1].cx);
        const x2 = Math.max(ends[0].cx, ends[1].cx);
        const y = (ends[0].cy + ends[1].cy) / 2;
        ctx.lineCap = 'round';

        // sand bed, wider than the wall
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.lineWidth = 28;
        ctx.strokeStyle = '#d9bd88';
        ctx.stroke();

        // wall shadow
        ctx.beginPath();
        ctx.moveTo(x1, y + 3);
        ctx.lineTo(x2, y + 3);
        ctx.lineWidth = 11;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)';
        ctx.stroke();

        // The wall itself. It used to be white with red blocks, to match the
        // barriers - but nothing is painted white and red outside the road any
        // more, and on this one the markings were the only thing that made the
        // spina look like a line rather than a thing. Concrete, with a lighter
        // top edge, so it reads as standing up off the sand.
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.lineWidth = 11;
        ctx.strokeStyle = '#5f6066';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y - 2.5);
        ctx.lineTo(x2, y - 2.5);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#9b9da6';
        ctx.stroke();

        // the metae: the gilded turning posts at either end of the spina
        for (const mx of [x1, x2]) {
            ctx.beginPath();
            ctx.arc(mx, y, 10, 0, Math.PI * 2);
            ctx.fillStyle = '#c9a227';
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#6d4c00';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(mx - 2.5, y - 2.5, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.fill();
        }
    }
}

class CircleTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 80;
        this.grassWidth = 100;
        
        const cx = 500;
        const cy = 350;
        const r = 250;
        
        this.segments = [
            { type: 'arc', cx: 745, cy: 360, r: 226.55, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'arc', cx: 745, cy: 360, r: 226.55, start: 1.5708, end: -1.5708, ccw: false }
        ];
        
        this.startX = 745;
        this.startY = 133.45;
        
        this.mirrorVertically();   // see mirrorVertically(): the left-hand half of the calendar
        this.waypoints = this.generateWaypoints();
    }
}

class SerpentTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 55;
        this.grassWidth = 75;
        
        this.segments = [
            { type: 'line', x1: 421, y1: 605.69, x2: 1079, y2: 605.69 },
            { type: 'arc', cx: 1079, cy: 485.69, r: 120, start: 1.5708, end: -1.5708, ccw: true },
            { type: 'line', x1: 1079, y1: 365.69, x2: 690.21, y2: 365.69 },
            { type: 'arc', cx: 690.21, cy: 275.69, r: 90, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: 600.21, y1: 275.69, x2: 600.21, y2: 194.31 },
            { type: 'arc', cx: 520.21, cy: 194.31, r: 80, start: 0, end: -1.5708, ccw: true },
            { type: 'line', x1: 520.21, y1: 114.31, x2: 371, y2: 114.31 },
            { type: 'arc', cx: 371, cy: 194.31, r: 80, start: -1.5708, end: -3.14159, ccw: true },
            { type: 'line', x1: 291, y1: 194.31, x2: 291, y2: 475.69 },
            { type: 'arc', cx: 421, cy: 475.69, r: 130, start: 3.14159, end: 1.5708, ccw: true }
        ];
        
        this.startX = 657.56;
        this.startY = 605.69;
        
        this.waypoints = this.generateWaypoints();
    }
}

class ThunderTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 60;
        this.grassWidth = 80;
        
        this.segments = [
            { type: 'line', x1: 413.89, y1: 608.75, x2: 1070.49, y2: 609.04 },
            { type: 'arc', cx: 1070.49, cy: 490.79, r: 118.25, start: 1.5708, end: -1.5708, ccw: true },
            { type: 'line', x1: 1070.49, y1: 372.53, x2: 904.31, y2: 385.72 },
            { type: 'arc', cx: 904.31, cy: 256.3, r: 129.42, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: 774.9, y1: 256.3, x2: 788.54, y2: 233.17 },
            { type: 'arc', cx: 666.33, cy: 233.17, r: 122.21, start: 0, end: -3.14159, ccw: true },
            { type: 'line', x1: 544.12, y1: 233.17, x2: 555.69, y2: 299.93 },
            { type: 'arc', cx: 469.94, cy: 299.93, r: 85.75, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 469.94, y1: 385.68, x2: 413.89, y2: 383.41 },
            { type: 'arc', cx: 413.89, cy: 496.08, r: 112.67, start: -1.5708, end: -4.71239, ccw: true }
        ];
        
        this.startX = 707.09;
        this.startY = 608.88;
        
        this.waypoints = this.generateWaypoints();
    }
}

class QuadratoTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 90;
        
        const L = 100; // inner boundary
        const R = 900;
        const T = 100;
        const B = 600;
        const r = 100; // corner radius
        
        this.segments = [
            { type: 'line', x1: 406, y1: 123.5, x2: 1084, y2: 123.5 },
            { type: 'arc', cx: 1084, cy: 223.5, r: 100, start: -1.5708, end: 0, ccw: false },
            { type: 'line', x1: 1184, y1: 223.5, x2: 1184, y2: 496.5 },
            { type: 'arc', cx: 1084, cy: 496.5, r: 100, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 1084, y1: 596.5, x2: 406, y2: 596.5 },
            { type: 'arc', cx: 406, cy: 496.5, r: 100, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: 306, y1: 496.5, x2: 306, y2: 223.5 },
            { type: 'arc', cx: 406, cy: 223.5, r: 100, start: 3.14159, end: -1.5708, ccw: false }
        ];
        
        this.startX = 672.4;
        this.startY = 123.5;
        
        this.mirrorVertically();   // see mirrorVertically(): the left-hand half of the calendar
        this.waypoints = this.generateWaypoints();
    }
}

class TriangleTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 90;

        // The corners used to have r = 70, exactly the track width. Kerbs are
        // laid on whatever inside run-off is left over - kerbWidthFor() returns
        // r - trackWidth - 2 - so at r = 70 there was room for -2px of kerb and
        // the three corners came out bare. Opening them to r = 98 leaves 26px,
        // enough for the full band, and the triangle is shifted 8px up so the
        // wider shape still sits inside the canvas.
        this.segments = [
            { type: 'arc', cx: 404, cy: 431.4, r: 98, start: 1.5708, end: -1.96739, ccw: false },
            { type: 'line', x1: 366.14, y1: 341.01, x2: 707.14, y2: 198.21 },
            { type: 'arc', cx: 745, cy: 288.6, r: 98, start: -1.96739, end: -1.1742, ccw: false },
            { type: 'line', x1: 782.86, y1: 198.21, x2: 1123.86, y2: 341.01 },
            { type: 'arc', cx: 1086, cy: 431.4, r: 98, start: -1.1742, end: 1.5708, ccw: false },
            { type: 'line', x1: 1086, y1: 529.4, x2: 404, y2: 529.4 }
        ];

        this.startX = 434.77;
        this.startY = 312.27;

        this.waypoints = this.generateWaypoints();
    }
}

// --- Crown -----------------------------------------------------------------
// A long main straight along the bottom, a slow corner at the end of it (the
// overtaking spot), a fast right-hand sweeper, and then an esse that dips back
// down between two peaks before a long constant-radius left brings you home.
// The esse is the point of it: every other circuit here bulges outwards only,
// so this is the one place the road actually doubles back on itself.
class CrownTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 58;
        this.grassWidth = 68;   // the two legs of the esse are 148px apart

        this.segments = [
            { type: 'arc', cx: 412.79, cy: 462.26, r: 117, start: 3.04599, end: 1.5708, ccw: true },
            { type: 'line', x1: 412.79, y1: 579.26, x2: 1065.81, y2: 579.26 },
            { type: 'arc', cx: 1065.81, cy: 481.76, r: 97.5, start: 1.5708, end: 0.34854, ccw: true },
            { type: 'line', x1: 1157.44, y1: 515.06, x2: 1197.4, y2: 405.1 },
            { type: 'arc', cx: 1063, cy: 356.26, r: 143, start: 0.34854, end: -1.0103, ccw: true },
            { type: 'line', x1: 1139.02, y1: 235.14, x2: 1040.02, y2: 173 },
            { type: 'arc', cx: 984.73, cy: 261.09, r: 104, start: -1.0103, end: -2.32054, ccw: true },
            { type: 'line', x1: 913.86, y1: 184.98, x2: 848.18, y2: 246.14 },
            { type: 'arc', cx: 786.16, cy: 179.54, r: 91, start: 0.82105, end: 2.25446, ccw: false },
            { type: 'line', x1: 728.68, y1: 250.09, x2: 621.37, y2: 162.65 },
            { type: 'arc', cx: 559.78, cy: 238.24, r: 97.5, start: -0.88714, end: -1.87688, ccw: true },
            { type: 'line', x1: 530.41, y1: 145.27, x2: 392.99, y2: 188.69 },
            { type: 'arc', cx: 439.99, cy: 337.44, r: 156, start: -1.87688, end: 3.04599, ccw: true },
            { type: 'line', x1: 284.71, y1: 352.33, x2: 296.32, y2: 473.43 }
        ];

        this.startX = 714.23;
        this.startY = 579.26;

        this.waypoints = this.generateWaypoints();
    }
}

// A long fast sweep down one side into a hairpin, then a short technical
// run home. The circuit for a car that can carry speed.
class BoomerangTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 64;
        this.grassWidth = 84;
        this.segments = [
            { type: 'arc', cx: 427.67, cy: 435.34, r: 108.01, start: 1.7429871, end: 2.9816795000000003, ccw: false },
            { type: 'line', x1: 321.04, y1: 452.54, x2: 301.62, y2: 332.17 },
            { type: 'arc', cx: 427.64, cy: 311.84, r: 127.65, start: 2.9816795000000003, end: -1.884417, ccw: false },
            { type: 'line', x1: 388.26, y1: 190.43, x2: 585.91, y2: 126.32 },
            { type: 'arc', cx: 658.61, cy: 350.48, r: 235.65, start: -1.884417, end: -1.3481354, ccw: false },
            { type: 'line', x1: 710.65, y1: 120.65, x2: 1064.08, y2: 200.67 },
            { type: 'arc', cx: 1031.56, cy: 344.31, r: 147.28, start: -1.3481354, end: -0.0964738, ccw: false },
            { type: 'line', x1: 1178.16, y1: 330.13, x2: 1189.59, y2: 448.32 },
            { type: 'arc', cx: 1101.63, cy: 456.83, r: 88.37, start: -0.0964738, end: 1.3825748000000002, ccw: false },
            { type: 'line', x1: 1118.17, y1: 543.64, x2: 806.05, y2: 603.09 },
            { type: 'arc', cx: 784.01, cy: 487.35, r: 117.83, start: 1.3825748000000002, end: 1.7429871, ccw: false },
            { type: 'line', x1: 763.82, y1: 603.43, x2: 409.16, y2: 541.75 }
        ];
        this.startX = 852.02;
        this.startY = 152.66;

        this.waypoints = this.generateWaypoints();
    }
}

// Three quick direction changes hung between two long corners: this one
// asks how well your car changes direction, and nothing else.
class ZipperTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 58;
        this.grassWidth = 76;
        this.segments = [
            { type: 'arc', cx: 408.9, cy: 294.46, r: 116.9, start: 3.1415927000000003, end: -1.6991196, ccw: false },
            { type: 'line', x1: 393.94, y1: 178.52, x2: 536.04, y2: 160.18 },
            { type: 'arc', cx: 549.13, cy: 261.63, r: 102.29, start: -1.6991196, end: -0.6610432, ccw: false },
            { type: 'line', x1: 629.88, y1: 198.83, x2: 662.08, y2: 240.23 },
            { type: 'arc', cx: 735.13, cy: 183.42, r: 92.55, start: 2.4805495, end: 0.7266423, ccw: true },
            { type: 'line', x1: 804.3, y1: 244.9, x2: 849.17, y2: 194.43 },
            { type: 'arc', cx: 925.62, cy: 262.39, r: 102.29, start: -2.4149503, end: -1.4157996, ccw: false },
            { type: 'line', x1: 941.41, y1: 161.32, x2: 1099.14, y2: 185.97 },
            { type: 'arc', cx: 1081.1, cy: 301.47, r: 116.9, start: -1.4157996, end: 0, ccw: false },
            { type: 'line', x1: 1198, y1: 301.47, x2: 1198, y2: 391.61 },
            { type: 'arc', cx: 1071.35, cy: 391.61, r: 126.65, start: 0, end: 1.4464413, ccw: false },
            { type: 'line', x1: 1087.06, y1: 517.28, x2: 749.12, y2: 559.52 },
            { type: 'arc', cx: 730.99, cy: 414.52, r: 146.13, start: 1.4464413, end: 1.7033479, ccw: false },
            { type: 'line', x1: 711.68, y1: 559.37, x2: 401.91, y2: 518.07 },
            { type: 'arc', cx: 418.65, cy: 392.53, r: 126.65, start: 1.7033479, end: 3.1415927000000003, ccw: false },
            { type: 'line', x1: 292, y1: 392.53, x2: 292, y2: 294.46 }
        ];
        this.startX = 1004.5;
        this.startY = 171.18;

        this.waypoints = this.generateWaypoints();
    }
}

// One enormous constant-radius curve you are in for a very long time, and
// one genuinely slow corner at the end of it.
class KettleTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 92;
        this.segments = [
            { type: 'arc', cx: 466.88, cy: 301.96, r: 158.89, start: 2.9441971000000002, end: -1.6041173000000002, ccw: false },
            { type: 'line', x1: 461.59, y1: 143.16, x2: 927.71, y2: 127.62 },
            { type: 'arc', cx: 936.01, cy: 376.41, r: 248.93, start: -1.6041173000000002, end: -0.5724598000000001, ccw: false },
            { type: 'line', x1: 1145.25, y1: 241.57, x2: 1163.43, y2: 269.78 },
            { type: 'arc', cx: 1065.49, cy: 332.9, r: 116.52, start: -0.5724598000000001, end: 0.9300126, ccw: false },
            { type: 'line', x1: 1135.15, y1: 426.31, x2: 948.9, y2: 565.21 },
            { type: 'arc', cx: 866.57, cy: 454.82, r: 137.7, start: 0.9300126, end: 1.6092389000000002, ccw: false },
            { type: 'line', x1: 861.28, y1: 592.42, x2: 475.87, y2: 577.6 },
            { type: 'arc', cx: 481.57, cy: 429.41, r: 148.3, start: 1.6092389000000002, end: 2.9441971000000002, ccw: false },
            { type: 'line', x1: 336.15, y1: 458.49, x2: 311.08, y2: 333.12 }
        ];
        this.startX = 648.04;
        this.startY = 136.94;

        this.waypoints = this.generateWaypoints();
    }
}

// Tight and walled in: short straights, late braking, and the hardest
// place on the calendar to get past anybody.
class HarbourTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 54;
        this.grassWidth = 70;
        this.segments = [
            { type: 'arc', cx: 378.86, cy: 311.52, r: 92.86, start: 3.0132694, end: -2.0344439000000003, ccw: false },
            { type: 'line', x1: 337.33, y1: 228.47, x2: 528.13, y2: 133.07 },
            { type: 'arc', cx: 565.04, cy: 206.9, r: 82.54, start: -2.0344439000000003, end: -1.5444866, ccw: false },
            { type: 'line', x1: 567.21, y1: 124.38, x2: 910.85, y2: 133.43 },
            { type: 'arc', cx: 907.86, cy: 246.88, r: 113.49, start: -1.5444866, end: -1.0636978, ccw: false },
            { type: 'line', x1: 962.98, y1: 147.67, x2: 1153.59, y2: 253.57 },
            { type: 'arc', cx: 1105.99, cy: 339.25, r: 98.02, start: -1.0636978, end: 0.2140607, ccw: false },
            { type: 'line', x1: 1201.77, y1: 360.07, x2: 1177.77, y2: 470.47 },
            { type: 'arc', cx: 1092.07, cy: 451.84, r: 87.7, start: 0.2140607, end: 1.3677510999999998, ccw: false },
            { type: 'line', x1: 1109.76, y1: 537.74, x2: 838.83, y2: 593.52 },
            { type: 'arc', cx: 818.02, cy: 492.46, r: 103.18, start: 1.3677510999999998, end: 1.8337910999999998, ccw: false },
            { type: 'line', x1: 791.2, y1: 592.09, x2: 565.87, y2: 531.42 },
            { type: 'arc', cx: 544.95, cy: 609.14, r: 80.48, start: -1.3078016000000001, end: -1.7942729000000002, ccw: true },
            { type: 'line', x1: 527.11, y1: 530.66, x2: 424.73, y2: 553.93 },
            { type: 'arc', cx: 403.01, cy: 458.35, r: 98.02, start: 1.3473197000000001, end: 3.0132694, ccw: false },
            { type: 'line', x1: 305.8, y1: 470.89, x2: 286.77, y2: 323.41 }
        ];
        this.startX = 704.67;
        this.startY = 128;

        this.waypoints = this.generateWaypoints();
    }
}

// THE CROSSING. Two loops joined by two long diagonals that cross in the
// middle of the circuit, with a bridge carrying one over the other.
//
// Deliberately not a neat figure of eight: the right-hand loop is a single
// fast sweep, the left one is tighter and carries an extra corner, so the two
// halves of a lap feel nothing alike.
//
// The crossing works because every car localises itself on the racing line
// from where it was LAST frame (car.js keeps _nodeIdx, ai.js keeps nodeIdx),
// searching only a window around it. The two roads meet in space but are half
// a lap apart in node index, so neither the odometer nor the AI can jump
// across. Only a car that has been thrown more than 200px - spun or punted -
// falls back to a global search, and that is already a car in trouble.
class CrossoverTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 68;
        this.grassWidth = 86;
        this.segments = [
            { type: 'arc', cx: 1004.49, cy: 313.93, r: 139.47, start: -2.4719537, end: -0.8507256, ccw: false },
            { type: 'line', x1: 1096.47, y1: 209.08, x2: 1138.93, y2: 246.33 },
            { type: 'arc', cx: 1043.88, cy: 354.68, r: 144.13, start: -0.8507256, end: 0.8245938, ccw: false },
            { type: 'line', x1: 1141.73, y1: 460.51, x2: 1085.55, y2: 512.45 },
            { type: 'arc', cx: 1002.27, cy: 422.36, r: 122.68, start: 0.8245938, end: 2.2794226, ccw: false },
            { type: 'line', x1: 922.43, y1: 515.51, x2: 549.73, y2: 196.06 },
            { type: 'arc', cx: 468.67, cy: 290.62, r: 124.55, start: -0.8621700999999999, end: -2.2774105, ccw: true },
            { type: 'line', x1: 387.81, y1: 195.89, x2: 341.64, y2: 235.31 },
            { type: 'arc', cx: 415.04, cy: 321.29, r: 113.05, start: -2.2774105, end: 2.6504290999999998, ccw: true },
            { type: 'line', x1: 315.35, y1: 374.61, x2: 362.32, y2: 462.43 },
            { type: 'arc', cx: 453.56, cy: 413.62, r: 103.47, start: 2.6504290999999998, end: 1.8622531, ccw: true },
            { type: 'line', x1: 423.83, y1: 512.73, x2: 544.27, y2: 548.87 },
            { type: 'arc', cx: 578.69, cy: 434.16, r: 119.76, start: 1.8622531, end: 0.6696389, ccw: true },
            { type: 'line', x1: 672.58, y1: 508.49, x2: 895.14, y2: 227.36 }
        ];
        this.startX = 472.01;
        this.startY = 527.19;

        // Where the bridge is, and which stretch of road goes over it. Both
        // are worked out from the geometry in getBridge() - the crossing point
        // is wherever the two straights meet, and "over" is whichever of them
        // runs along bridgeAngle.
        this.hasBridge = true;

        this.waypoints = this.generateWaypoints();
    }
}

// =========================================================================
//  KART  -  Circus Maximus, three times over.
// -------------------------------------------------------------------------
//  Circus Maximus is one straight driven twice: out along one side of a
//  central wall, round the far end, back along the other. Kart stacks three
//  of them. Four horizontal roads - three straights with a spina between each
//  pair, and a return that carries you from the end of the third back to the
//  start of the first:
//
//      y1  --------------------->     driven right
//          ======= spina =======
//      y2  <---------------------     driven left
//          ======= spina =======
//      y3  --------------------->     driven right
//          ======= spina =======
//      y4  <---------------------     the return
//
//  The two ends are what make it work. On the RIGHT, two ordinary hairpins:
//  y1 to y2 and y3 to y4. On the LEFT, two CONCENTRIC semicircles about the
//  same centre - a small one taking y2 to y3, and a big one taking the return
//  all the way back up to y1. Concentric, and exactly one spina apart, which
//  is why the left end comes out as tidy as the right.
//
//  Turning: +180 -180 +180 +180 = +360. It closes, and it had to.
//
//  The numbers are not typed in, they are solved (kart2.js). Joint gaps come
//  out at 0.0000px and the tangent breaks at 0.0000 degrees, because every
//  hairpin radius IS half the spacing and the two left arcs share a centre.
//  The spacing of 152 is chosen against Circus Maximus itself: with a 58px
//  wall radius it leaves a 31.8px strip of infield between two lanes, against
//  32.8 there. Below about 120 there would be no wall between the lanes at all
//  and you could drive straight across the spina.
//
//  At 3769px it is the longest circuit in the game - Pettine, the previous
//  longest, is 3053. That is the point of it: three long straights, and the
//  straights are as long as the arena allows once the return arc on the left
//  has taken its 228px.
// =========================================================================
class KartTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 50;
        this.grassWidth = 70;
        this.segments = [
            { type: 'line', x1: 529, y1: 132, x2: 1113, y2: 132 },
            { type: 'arc', cx: 1113, cy: 208, r: 76, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 1113, y1: 284, x2: 529, y2: 284 },
            { type: 'arc', cx: 529, cy: 360, r: 76, start: -1.5708, end: 1.5708, ccw: true },
            { type: 'line', x1: 529, y1: 436, x2: 1113, y2: 436 },
            { type: 'arc', cx: 1113, cy: 512, r: 76, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 1113, y1: 588, x2: 529, y2: 588 },
            { type: 'arc', cx: 529, cy: 360, r: 228, start: 1.5708, end: 4.7124, ccw: false }
        ];
        // On the top straight, which is the only thing crossing this x going
        // left to right inside the band the lap counter watches.
        this.startX = 891.08;
        this.startY = 132;

        this.mirrorVertically();   // see mirrorVertically(): the left-hand half of the calendar
        this.waypoints = this.generateWaypoints();
    }
}

// ===========================================================================
//  ANCHOR
// ===========================================================================
//
//  Disegnato a mano da Nicola su un foglio e fotografato: un dito verticale
//  in alto a sinistra, un lungo rettifilo in cima, un'ansa a destra che
//  scende e risale, e a sinistra una conca larga che riporta al traguardo.
//  Il disegno era a larghezza variabile - lo dice lui stesso - quindi quello
//  che si e' preso e' la FORMA; la carreggiata qui e' costante come su ogni
//  altro circuito, 50px di semicarreggiata come Kart e Circo Massimo.
//
//  Due cose il disegno non poteva sapere. La prima: i due tornanti erano
//  disegnati con le gambe attaccate, cioe' con l'isola in mezzo di spessore
//  zero. Il muro sta a 58px dalla mezzeria e la barriera a 70, quindi due
//  tratti non adiacenti devono stare almeno 126px l'uno dall'altro o non c'e'
//  dove disegnarli: le gambe del dito sono a 180px e quelle dell'ansa a 170.
//  La seconda: il rettifilo alto e quello del traguardo erano a contatto, e
//  ora stanno a 185px. Misurato sul giro finito, il punto piu' stretto fra
//  tratti non adiacenti e' 180px contro i 126 richiesti.
//
//  LA GEOMETRIA e' un poligono con un arco tangente a ogni vertice, come
//  Monaco: la tangenza e' esatta per costruzione e non per taratura, e i
//  raggi si stringono da soli finche' ogni raccordo entra nel suo lato.
//  Chiusura 0.009px, rottura di tangenza 0.024 gradi, torsione esattamente
//  -360. Dodici curve, raggi da 75 a 140, giro 2970px - il terzo piu' lungo
//  del gioco dopo Kart e Comb.
//
//  Gira in senso ANTIORARIO, che e' quello che il disegno chiede: la freccia
//  di Nicola punta a destra sul rettifilo del traguardo e l'infield sta a
//  sinistra. Porta il calendario a 8 orari contro 10 antiorari, cioe' dalla
//  parte che risparmia l'anulare destro.
// ===========================================================================
class AnchorTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 50;
        this.grassWidth = 70;

        this.segments = [
            { type: 'arc', cx: 604.42, cy: 600.00, r: 140.00, start: -2.148661, end: -1.570796, ccw: false },
            { type: 'line', x1: 604.42, y1: 460.00, x2: 916.80, y2: 460.00 },
            { type: 'arc', cx: 916.80, cy: 535.00, r: 75.00, start: -1.570796, end: 0.000000, ccw: false },
            { type: 'line', x1: 991.80, y1: 535.00, x2: 991.80, y2: 550.00 },
            { type: 'arc', cx: 1066.80, cy: 550.00, r: 75.00, start: 3.141593, end: 1.570796, ccw: true },
            { type: 'line', x1: 1066.80, y1: 625.00, x2: 1082.55, y2: 625.00 },
            { type: 'arc', cx: 1082.55, cy: 550.00, r: 75.00, start: 1.570796, end: 0.000000, ccw: true },
            { type: 'line', x1: 1157.55, y1: 550.00, x2: 1157.55, y2: 355.00 },
            { type: 'arc', cx: 1077.55, cy: 355.00, r: 80.00, start: 0.000000, end: -1.570796, ccw: true },
            { type: 'line', x1: 1077.55, y1: 275.00, x2: 534.68, y2: 275.00 },
            { type: 'arc', cx: 534.67, cy: 191.00, r: 84.00, start: 1.570796, end: 3.141593, ccw: false },
            { type: 'line', x1: 450.68, y1: 191.00, x2: 450.68, y2: 126.75 },
            { type: 'arc', cx: 368.93, cy: 126.75, r: 81.75, start: 0.000000, end: -1.570796, ccw: true },
            { type: 'line', x1: 368.93, y1: 45.00, x2: 356.93, y2: 45.00 },
            { type: 'arc', cx: 356.93, cy: 126.75, r: 81.75, start: -1.570796, end: 3.141593, ccw: true },
            { type: 'line', x1: 275.18, y1: 126.75, x2: 275.18, y2: 203.40 },
            { type: 'arc', cx: 135.18, cy: 203.40, r: 140.00, start: 0.000000, end: 0.375510, ccw: false },
            { type: 'line', x1: 265.42, y1: 254.75, x2: 194.28, y2: 435.20 },
            { type: 'arc', cx: 302.77, cy: 477.97, r: 116.61, start: -2.766083, end: 2.737062, ccw: true },
            { type: 'line', x1: 195.57, y1: 523.87, x2: 204.47, y2: 544.66 },
            { type: 'arc', cx: 288.46, cy: 508.71, r: 91.36, start: 2.737062, end: 1.940585, ccw: true },
            { type: 'line', x1: 255.44, y1: 593.89, x2: 270.74, y2: 599.82 },
            { type: 'arc', cx: 307.55, cy: 504.86, r: 101.85, start: 1.940585, end: 0.992932, ccw: true },
            { type: 'line', x1: 363.19, y1: 590.17, x2: 527.94, y2: 482.73 }
        ];

        // Sul rettifilo del traguardo, 324px di dritto fra la diagonale che
        // arriva dalla conca e la staccata dell'ansa: la linea sta in fondo,
        // cosi' la finestra da cui la corsia box prende in carico l'auto
        // (250-360px prima della linea) cade ancora sull'asfalto dritto.
        this.startX = 894;
        this.startY = 460;

        this.waypoints = this.generateWaypoints();
    }
}

// ===========================================================================
//  COMB
// ===========================================================================
//
//  THE TEETH USED TO BE 160px APART, and that number was not chosen: it was
//  the old layout rule, 2 x grassWidth + 10, and the circuit was drawn exactly
//  to it. Two things then made it wrong.
//
//  The road is 70 EITHER SIDE of the centre line, so two teeth 160 apart leave
//  a strip of grass 20px wide between their tarmac - narrower than a car. And
//  the verge floor went to `trackWidth + 18` when the wide kerbs came back,
//  which puts the wall 88 from each centre line: 176 of driveable ground in a
//  160px gap. The two corridors overlapped by 16px, so a car could sit with a
//  pair of wheels on each tooth and drive straight across the middle of the
//  circuit, skipping a hairpin. Nicola found it.
//
//  A barrier down the middle was the obvious answer and it does not fit. A
//  barrier needs a car's radius of clearance on each side - 24px - and there
//  are 20px of grass in total. There is no thickness of wall that stops the
//  cut without also standing on the road.
//
//  So the teeth moved apart: 160 -> 172, which makes the U-turn between them
//  a radius 86 instead of 80, and the whole comb 36px wider. The verge floor
//  is 12 here instead of 18, which puts the wall at 82: two corridors of 82 in
//  a 172px gap leave EIGHT PIXELS of ground no car can reach, and the barrier
//  gets painted along it by the ordinary machinery, because getWalls() draws
//  the boundary of the driveable area wherever that boundary happens to be.
//  Nothing special is drawn and nothing special is collided with.
//
//  The kerbs are unchanged in kind and slightly wider in fact: they were
//  capped by the tightness of the arcs (80 - 70 - 2 = 8px) and the arcs are
//  now 86, so they are 10. The lap goes from 3053px to 3095.
class PettineTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 75; // reduced so curbs do not overwrite each other
        // See the note above: 12, not 18, so that 172px of gap holds two walls
        // and a strip of solid ground between them. The kerb it has to carry
        // is 10px, capped by the radius of the hairpins, so 12 is enough.
        this.vergeFloor = 12;

        this.segments = [
            { type: 'line', x1: 335, y1: 108.96, x2: 1119, y2: 108.96 },
            { type: 'arc', cx: 1119, cy: 194.96, r: 86, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'arc', cx: 1119, cy: 360.96, r: 80, start: -1.5708, end: -3.14159, ccw: true },
            { type: 'line', x1: 1039, y1: 360.96, x2: 1039, y2: 531.04 },
            { type: 'arc', cx: 953, cy: 531.04, r: 86, start: 0, end: 3.14159, ccw: false },
            { type: 'line', x1: 867, y1: 531.04, x2: 867, y2: 368.8 },
            { type: 'arc', cx: 781, cy: 368.8, r: 86, start: 0, end: -3.14159, ccw: true },
            { type: 'line', x1: 695, y1: 368.8, x2: 695, y2: 531.04 },
            { type: 'arc', cx: 609, cy: 531.04, r: 86, start: 0, end: 3.14159, ccw: false },
            { type: 'line', x1: 523, y1: 531.04, x2: 523, y2: 360.96 },
            { type: 'arc', cx: 443, cy: 360.96, r: 80, start: 0, end: -1.5708, ccw: true },
            { type: 'line', x1: 443, y1: 280.96, x2: 335, y2: 280.96 },
            { type: 'arc', cx: 335, cy: 194.96, r: 86, start: 1.5708, end: 4.71239, ccw: false }
        ];

        this.startX = 703.74;
        this.startY = 108.96;

        this.waypoints = this.generateWaypoints();
    }
}
