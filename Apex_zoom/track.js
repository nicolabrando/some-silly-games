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

// The racing line (see THE LINE, AND HOW IT IS CHOSEN below). Bump the
// version when the optimiser, its proxy or the physics it mirrors change, and
// regenerate lines.js (genlines.js): every shipped and remembered line is keyed
// by it. The margins are the distances from the road edge the optimised
// candidates are allowed to use; the judge picks between them per circuit.
const RACING_LINE_VERSION = 2;
const RACING_LINE_MARGINS = [20, 17, 14];

class SegmentedTrack {
    constructor() {
        // To be overridden by subclasses
        this.trackWidth = 75;
        this.grassWidth = 95;
        this.segments = [];
        this.startX = 500;
        this.startY = 150;
        // -------------------------------------------------------------------
        //  THE WORLD IS PER-CIRCUIT NOW (Apex Zoom).
        //  The screen shows a camera window, not the world, so a circuit is no
        //  longer bounded by the canvas: it declares how much world it needs
        //  and the camera and the pre-rendered layers follow. The default is
        //  the classic 1360x765, which keeps every shipped circuit's
        //  coordinates - and with them geomHash(), the shipped racing lines,
        //  the ghosts and the record book - EXACTLY as they were.
        // -------------------------------------------------------------------
        this.worldW = WORLD_W;
        this.worldH = WORLD_H;
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

        // The arena is derived from THIS circuit's world, with the same
        // left-hand reservation as ever: for a default-sized world the four
        // numbers below are bit-identical to the old ARENA_ constants, so no
        // shipped circuit moves by even half a pixel.
        const AX0 = ARENA_X0, AX1 = this.worldW, AY0 = 0, AY1 = this.worldH;
        const ox = (AX0 + AX1) / 2 - (x0 + x1) / 2;
        const oy = (AY0 + AY1) / 2 - (y0 + y1) / 2;
        this.fitOffset = { x: ox, y: oy, margin: M,
                           fits: (x1 - x0) + 2 * M <= AX1 - AX0 &&
                                 (y1 - y0) + 2 * M <= AY1 - AY0 };
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

        const line = this._lineOrFallback();
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

        // The centreline of the OVER road across the crossing, sampled off the
        // line itself. A tunnel roof has to put that road back on top of the
        // ground it buries, and the road there may be curving - Suzuka's is,
        // through the esses - so a rectangle will not do: this is the real
        // shape, stroked later at road and verge width.
        const span = Math.ceil((half + this.trackWidth + 30) / ds) + 2;
        const overPath = [];
        for (let k = -span; k <= span; k++) {
            const nd = nodes[(overIdx + k + N * 4) % N];
            overPath.push({ x: nd.cx, y: nd.cy });
        }

        this._bridge = {
            x: (o.cx + u.cx) / 2,
            y: (o.cy + u.cy) / 2,
            angle: Math.atan2(o.ty, o.tx),      // the deck runs along the upper road
            // ...and the tunnel runs along the LOWER one: it is the road that
            // changes level, so its heading is the one the portals square up to
            uAngle: Math.atan2(u.ty, u.tx),
            overPath: overPath,
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
        return inLapWindow(car.lapS, b.over, this._lineOrFallback().length);
    }
    underBridge(car) {
        const b = this.getBridge();
        if (!b || car.lapS === undefined) return false;
        return inLapWindow(car.lapS, b.under, this._lineOrFallback().length);
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
        if (this.bridgeStyle === 'tunnel') { this.drawTunnel(ctx, b); return; }
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
        //
        // And then the TIPS. Where the wall turns a corner whose inside
        // radius at R is smaller than `out`, the vertices on the cap and just
        // beside it cannot make the full push - the ridge is right there -
        // and they stop short, at R+4 or R+7, between neighbours that reached
        // R+12. Drawn, that is a hook of barrier poking out of the corner
        // towards the road: the spike Nicola saw at Thunder, and there was
        // one on the same corner of F1, Serpent, Triangle, Boomerang, Comb,
        // Crossover and Anchor. Measured over all of them: the group of
        // short-pushed vertices is 6 to 40px of trace, and the two full-push
        // vertices either side of it land within a pixel of one another -
        // because that is where the offset-12 walls of the two sides MEET.
        // So the group is dropped and the corner closes on itself. A narrow
        // island - Comb's teeth, Kart's spina, the whole of Circus Maximus's -
        // is a short push for hundreds of pixels on end and its ends are far
        // apart: left exactly as it was.
        const TIP_LEN = 45, TIP_GAP = 6;
        const pushed = [];
        for (const pts of loops) {
            const px = [], py = [], pt = [], raw = [];
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
                px.push(bx + nx * t); py.push(by + ny * t); pt.push(t);
                raw.push(pts[i], pts[i + 1]);
            }
            const n = px.length;
            const keep = new Array(n).fill(true);
            if (n > 8 && out > 0) {
                const closed = Math.hypot(raw[0] - raw[2 * n - 2], raw[1] - raw[2 * n - 1]) < 3;
                const full = (i) => pt[((i % n) + n) % n] >= out;
                let start = -1;
                for (let i = 0; i < n; i++) if (full(i)) { start = i; break; }
                if (start >= 0) {
                    let i = start, seen = 0;
                    while (seen < n) {
                        const idx = i % n;
                        if (full(idx)) { i++; seen++; continue; }
                        // a run of short pushes: measure it
                        let cnt = 0, len = 0, j = idx;
                        while (!full(j) && cnt < n) {
                            if (cnt) len += Math.hypot(raw[2 * (j % n)] - raw[2 * ((j - 1) % n)],
                                                       raw[2 * (j % n) + 1] - raw[2 * ((j - 1) % n) + 1]);
                            j++; cnt++;
                        }
                        const b0 = ((idx - 1) % n + n) % n, a0 = j % n;
                        // an open loop has no vertex before its first / after
                        // its last: never bridge across the seam of one
                        const bridgeable = closed || (idx > 0 && a0 > idx);
                        if (bridgeable && len <= TIP_LEN &&
                            Math.hypot(px[b0] - px[a0], py[b0] - py[a0]) <= TIP_GAP) {
                            for (let k = 0; k < cnt; k++) keep[(idx + k) % n] = false;
                        }
                        i += cnt; seen += cnt;
                    }
                }
            }
            const q = [];
            for (let i = 0; i < n; i++) if (keep[i]) q.push(px[i], py[i]);
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
            // A clash drops the vertex; whether it also BREAKS the run depends
            // on how much has been dropped in a row. Breaking at the first
            // clash was right for a thin island - its far side is hundreds of
            // pixels of clash and must not be bridged - and wrong at a sharp
            // tip: Triangle's infield corners are 23 degrees, so past the
            // corner the two sides sit inside a stroke width of each other
            // for the first 19px, further than the 24px-of-arc window
            // protects. The run broke there and left a stub of wall through
            // the corner, a 14px gap, and the wall starting again - a loose
            // piece of barrier lying at the tip. Now a short skip is bridged
            // by the chord to the next kept vertex, which on a wall is the
            // wall; only a long one - a whole side of an island - breaks.
            const SKIP_BREAK = 30;
            let skipped = 0;
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
                if (clash) {
                    skipped += i ? arc[i] - arc[i - 1] : 0;
                    if (skipped > SKIP_BREAK) flush();
                    continue;
                }
                skipped = 0;
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
        const line = this._lineOrFallback();
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
    // Kept for tools; the line itself is now chosen by _proxyTime (a speed
    // profile with braking, acceleration and the slip drag) and, when the
    // game is loaded, by an actual simulated lap (see _buildRacingLines).
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

    // =====================================================================
    //  THE LINE, AND HOW IT IS CHOSEN
    //
    //  Until v2 the racing line was a constrained Laplacian relaxation of the
    //  centre line - pull every node towards the midpoint of its neighbours,
    //  clamp it inside the road, stop after N sweeps - and the 'fast' line
    //  was the quickest of three depths by an analytic proxy. It looks like a
    //  racing line and it is not one. Relaxation SHORTENS the path; it has no
    //  idea that the car's cornering speed is set by the steering rate, so
    //  it hugs the inside of a 90-degree corner and leaves a kink of radius
    //  ~100px at each end of it. On Rectangle the AI was braking to 167 px/s
    //  four times a lap where the road allows an arc of radius ~190 that it
    //  takes at 220+; it was 10% slower round there than Nicola, who simply
    //  uses the width of the road, and similarly on every circuit made of
    //  straights and corners (Harbour, Anchor, Serpent, Comb, Crown...).
    //
    //  So the line is now OPTIMISED, in two steps:
    //
    //  1. _optimizeAlpha: a direct search on the lateral offsets. Raised-
    //     cosine bumps of 2 to 24 nodes are pushed left and right, a move is
    //     kept when the proxy lap time falls. The proxy (_proxyTime) is a
    //     speed profile on the candidate path: corner speed from the steering
    //     rate (v = wR/(1+wR/500), the physics' own closed form), from the
    //     POWER limit (in a corner the velocity lags the nose by a slip angle
    //     beta with sin(beta) = v/(3.5R); the lateral force v^2/R that holds
    //     the corner then has a component v^3/(3.5R^2) against the direction
    //     of travel - 100 px/s^2 at 200 px/s on R=150, the whole engine - so
    //     a mid-radius corner is power-limited as much as steering-limited,
    //     and a line that does not know it picks radii too tight), and from
    //     the SWING in an S: the nose must turn through the change of slip
    //     angle as well as the change of heading, which is what made the AI
    //     run out of road at the first chicane on Thunder with the first
    //     version of this. Then acceleration and braking passes, forward and
    //     backward, and the sum of ds/v.
    //  2. A JUDGE. The proxy ranks lines well but not perfectly, so when the
    //     game is loaded (main.js installs judgeRacingLine) each candidate -
    //     the three relaxations and the optimised lines at three margins from
    //     the edge - is driven by the AI itself for a flying lap and the
    //     quickest is kept. Where the optimiser does not help (Circle: one
    //     constant-radius corner; Thunder) the relaxation wins and nothing
    //     is lost. Measured over the eighteen circuits, the top AI's solo lap
    //     fell 4.5% on average: 8-12% on Anchor, Harbour, Rectangle, Serpent,
    //     Circo Massimo, nothing on Circle and Thunder, slower nowhere.
    //
    //  The optimisation costs 1-3 s per circuit in JavaScript, so it is not
    //  done at run time for the circuits the game ships with: tools/genlines
    //  (see /root/apex/genlines.js) runs exactly this code headless and writes
    //  lines.js, a table keyed by geomHash() - the circuit's segments, width
    //  and verge - of the offsets that won. A circuit whose geometry changes
    //  no longer matches its entry and falls through to the run-time path
    //  (optimise, judge, and remember the answer in localStorage under the
    //  same hash), so an edited circuit still gets the right line, just a
    //  couple of seconds later the first time. RACING_LINE_VERSION is part
    //  of every key: bump it when the optimiser, the proxy or the physics it
    //  mirrors change, and regenerate lines.js.
    //
    //  The same line serves every level. The weaker profiles blend it towards
    //  the centre (ai.js lineBlend), which is how they always drove, and the
    //  'fast' line is the same object: there is one line per circuit now, the
    //  best one the judge could find.
    // =====================================================================

    // Geometry fingerprint: segments, road width, verge. The same formula
    // main.js uses for the record book, so "has this circuit changed" means
    // one thing everywhere.
    geomHash() {
        let geom = this.trackWidth * 7 + this.grassWidth * 3;
        for (const s of this.segments)
            geom += s.type === 'line' ? (s.x1 + s.y1 + s.x2 + s.y2)
                                      : (s.cx + s.cy + s.r * 13);
        const str = geom.toFixed(1) + '|' + this.segments.length;
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    // level: 'standard' (default) or 'fast' - one line now, see above.
    getRacingLine(level) {
        if (!this._lineStd) this._buildRacingLines();
        return level === 'fast' ? this._lineFast : this._lineStd;
    }

    // While the line is being CHOSEN, `_lineStd` holds the candidate being
    // measured, so anything the measurement itself asks (the car's own lap
    // position, the bridge, the puddles) is answered with that candidate
    // rather than re-entering the search. This guard is what makes that safe:
    // if `_lineStd` were ever null in there, getRacingLine would call
    // _buildRacingLines again, from inside itself, for ever.
    _lineOrFallback() {
        if (!this._lineStd) {
            const base = this._lineBase();
            const maxOff = Math.max(3, this.trackWidth - 20);
            this._lineStd = this._lineFast = this._finishLine(base, this._relaxAlpha(base, 600, maxOff), maxOff);
            this._setLineStart(this._lineStd);
        }
        return this._lineStd;
    }

    _buildRacingLines() {
        const base = this._lineBase();
        const W = this.trackWidth;
        const hash = 'v' + RACING_LINE_VERSION + ':' + this.geomHash();
        let chosen = null;

        // 1. shipped table
        if (typeof RACING_LINES !== 'undefined' && RACING_LINES && RACING_LINES[hash] &&
            RACING_LINES[hash].a && RACING_LINES[hash].a.length === base.count) {
            const e = RACING_LINES[hash];
            chosen = this._finishLine(base, Float64Array.from(e.a), e.m);
            chosen.source = 'shipped';
        }
        // 2. remembered from a previous run
        if (!chosen) {
            try {
                const raw = localStorage.getItem('apexLine:' + hash);
                if (raw) {
                    const e = JSON.parse(raw);
                    if (e && e.a && e.a.length === base.count) {
                        chosen = this._finishLine(base, Float64Array.from(e.a), e.m);
                        chosen.source = 'cached';
                    }
                }
            } catch (e) { /* no storage: compute */ }
        }
        // 3. compute, judge, remember
        if (!chosen) {
            chosen = this._searchRacingLine(base);
            try {
                localStorage.setItem('apexLine:' + hash, JSON.stringify({
                    m: chosen.maxOffset,
                    a: Array.from(chosen.nodes, n => Math.round(n.alpha * 10) / 10)
                }));
            } catch (e) { /* storage full or absent: fine */ }
        }
        this._lineStd = chosen;
        this._lineFast = chosen;
        this._setLineStart(chosen);
        // the crossing is measured off the line, and anything asked for it
        // DURING the search was answered with a candidate: throw that away.
        this._bridge = undefined;
    }

    // Arc length of the start line itself. Node 0 is wherever the first
    // track segment happens to begin, which is no use as a datum: distances
    // have to be measured from the line every car crosses, or two cars at
    // the same point on track read differently.
    _setLineStart(line) {
        let si = 0, md = Infinity;
        for (let i = 0; i < line.count; i++) {
            const d = Math.hypot(line.nodes[i].cx - this.startX,
                                 line.nodes[i].cy - this.startY);
            if (d < md) { md = d; si = i; }
        }
        line.sStart = line.nodes[si].s;
    }

    // Candidates, proxy, judge. Returns the finished line.
    _searchRacingLine(base) {
        const W = this.trackWidth;
        const cands = [];
        // the three relaxation depths the old selection chose between
        for (const sweeps of [600, 1000, 1800]) {
            const maxOff = Math.max(3, W - 20);
            const alpha = this._relaxAlpha(base, sweeps, maxOff);
            cands.push({ name: 'relax' + sweeps, alpha: alpha, maxOff: maxOff,
                         proxy: this._proxyTime(base, alpha) });
        }
        // optimised from the best relaxation, at three margins from the edge
        let start = cands[0];
        for (const c of cands) if (c.proxy < start.proxy) start = c;
        for (const margin of RACING_LINE_MARGINS) {
            const maxOff = Math.max(3, W - margin);
            const r = this._optimizeAlpha(base, start.alpha, maxOff, {});
            cands.push({ name: 'opt' + margin, alpha: r.alpha, maxOff: maxOff, proxy: r.T });
        }
        // The judge - only where it is safe to run one. It drives a whole
        // qualifying lap per candidate through the game's own simulation, and
        // getRacingLine() is called from screens, from the start of a session
        // and from the record book: re-entering the race simulation from
        // inside any of those, for seconds at a time, is not something the
        // game should do while somebody is looking at it. genlines.js turns it
        // on (RACING_LINE_JUDGE_REPS = 3) because that is the whole point of
        // the generator; in the game the value is 0 and the proxy decides,
        // which only ever happens for a circuit that has been edited since
        // lines.js was built.
        let best = null;
        const judge = (typeof judgeRacingLine === 'function' &&
                       typeof RACING_LINE_JUDGE_REPS !== 'undefined' &&
                       RACING_LINE_JUDGE_REPS > 0) ? judgeRacingLine : null;
        for (const c of cands) {
            c.line = this._finishLine(base, c.alpha, c.maxOff);
            c.line.source = c.name;
            c.score = c.proxy;
            if (judge) {
                this._lineStd = c.line; this._lineFast = c.line;
                this._setLineStart(c.line);
                let lap = null;
                try { lap = judge(this); } catch (e) { lap = null; }
                this._lineStd = null; this._lineFast = null;
                if (lap && isFinite(lap) && lap > 0) c.score = lap;
                else c.score = c.proxy * 1000 + 1e6;   // a lap that never happened ranks last
            }
            if (!best || c.score < best.score) best = c;
        }
        return best.line;
    }

    // The uniformly resampled centre line: nodes with cx, cy, s, and the
    // tangent/normal frame. Everything else is an offset along the normal.
    _lineBase() {
        if (this._lineBaseCache) return this._lineBaseCache;
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
            nodes.push({ cx: a.x + (b.x - a.x) * t, cy: a.y + (b.y - a.y) * t, s: s });
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
        this._lineBaseCache = { nodes: nodes, count: N, ds: ds, length: total };
        return this._lineBaseCache;
    }

    // ---- constrained relaxation -> "geometric" racing line ---------------
    // Constrained Laplacian relaxation: each node is pulled towards the
    // midpoint of its neighbours and clamped inside the usable width, so
    // the path shortens and straightens. Run to convergence this becomes
    // the shortest path, which hugs the inner kerb and therefore tightens
    // the radius; stopping early leaves a length/curvature compromise. It
    // is the starting point of the optimiser and a candidate in its own
    // right.
    _relaxAlpha(base, sweeps, maxOff) {
        const nodes = base.nodes, N = base.count;
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
        return alpha;
    }

    // The old entry point, kept for the tools: a relaxed line, finished.
    buildRacingLine(sweeps) {
        const base = this._lineBase();
        const maxOff = Math.max(3, this.trackWidth - 20);
        return this._finishLine(base, this._relaxAlpha(base, sweeps, maxOff), maxOff);
    }

    // From offsets to a line the AI can drive: positions, heading, the two
    // radii and the steering-limited corner speed.
    _finishLine(base, alpha, maxOff) {
        const N = base.count, ds = base.ds;
        const nodes = base.nodes.map(n => Object.assign({}, n));
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
        // ---- local radius of curvature (wide stencil, then min-filter)
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
        // ---- dry, steering-limited corner speed ----------------------
        // The car's yaw rate is capped at maxSteer * (1 - v/500); holding a
        // radius R requires a yaw rate of v/R, hence the closed form below.
        const maxSteer = Math.PI * 0.7;
        for (let i = 0; i < N; i++) {
            const R = nodes[i].radius;
            let v = maxSteer / (1 / R + maxSteer / 500);
            if (!isFinite(v) || v < 0) v = 500;
            nodes[i].vCorner = Math.min(500, v);
        }
        return { nodes: nodes, count: N, ds: ds, length: base.length, maxOffset: maxOff };
    }

    // ---- the proxy and the optimiser ----------------------------------------
    // Both live in one closure so the optimiser can re-evaluate only the
    // nodes a move touched. _proxyTime(base, alpha) is the full evaluation;
    // _optimizeAlpha(base, alpha0, maxOff, opts) returns { alpha, T }.
    _lineModel(base, maxOff, opts) {
        opts = opts || {};
        const N = base.count, nodes = base.nodes, ds = base.ds;
        const cx = new Float64Array(N), cy = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
        for (let i = 0; i < N; i++) { cx[i] = nodes[i].cx; cy[i] = nodes[i].cy; nx[i] = nodes[i].nx; ny[i] = nodes[i].ny; }
        const k = Math.max(2, Math.round(26 / ds));
        // The BASE car (car.js): the chassis move these a few per cent and the
        // compound a few more, and the line that is best for one is best for
        // all of them within the noise.
        const OMEGA = Math.PI * 0.7, VTOP = 330;
        const P = 300, F = 0.85, BRK = 150, ALIGN = 3.5;
        const slipSin = (s, R) => Math.min(0.95, s / (ALIGN * R));
        const accelAt = (s, R) => { const sb = slipSin(s, R); return P * Math.sqrt(1 - sb * sb) - F * s - s * s * s / (ALIGN * R * R); };
        const brakeAt = (s, R) => { const sb = slipSin(s, R); return BRK * Math.sqrt(1 - sb * sb) + F * s + s * s * s / (ALIGN * R * R); };
        // v_power(R), the speed at which the engine can just hold the slip
        // drag of the corner, tabulated on log R
        const RMIN = 12, RMAX = 1e6, NT = 160, LR0 = Math.log(RMIN), LRS = Math.log(RMAX) - LR0;
        const vPowTab = new Float64Array(NT);
        for (let t = 0; t < NT; t++) {
            const R = Math.exp(LR0 + LRS * t / (NT - 1));
            let lo = 0, hi = 600;
            for (let it = 0; it < 40; it++) { const mid = 0.5 * (lo + hi); if (accelAt(mid, R) > 0) lo = mid; else hi = mid; }
            vPowTab[t] = lo;
        }
        const vPower = (R) => {
            const u = (Math.log(R < RMIN ? RMIN : (R > RMAX ? RMAX : R)) - LR0) / LRS * (NT - 1);
            const t0 = Math.floor(u), t1 = t0 + 1 < NT ? t0 + 1 : NT - 1, f = u - t0;
            return vPowTab[t0] * (1 - f) + vPowTab[t1] * f;
        };
        const SWING = 1, SWM = 6;   // slip-swing weight and half-span (nodes)
        // state: positions, segment lengths, radius, signed curvature, steady
        // slip, speed cap - and a trial copy of each
        const px = new Float64Array(N), py = new Float64Array(N), L = new Float64Array(N), Rn = new Float64Array(N), Kn = new Float64Array(N), Bn = new Float64Array(N), vmax = new Float64Array(N);
        const tpx = new Float64Array(N), tpy = new Float64Array(N), tL = new Float64Array(N), tR = new Float64Array(N), tK = new Float64Array(N), tB = new Float64Array(N), tvmax = new Float64Array(N);
        const v = new Float64Array(N);
        const segLen = (X, Y, i) => { const j = (i + 1) % N; const dx = X[j] - X[i], dy = Y[j] - Y[i]; return Math.sqrt(dx * dx + dy * dy); };
        let sgn = 1;
        const radiusAt = (X, Y, i) => {
            const A = (i - k + N) % N, C = (i + k) % N;
            const ax = X[A], ay = Y[A], bx = X[i], by = Y[i], qx = X[C], qy = Y[C];
            const a2 = (bx - qx) * (bx - qx) + (by - qy) * (by - qy), b2 = (ax - qx) * (ax - qx) + (ay - qy) * (ay - qy), c2 = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
            const cross = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
            const area = Math.abs(cross) * 0.5;
            sgn = cross >= 0 ? 1 : -1;
            let r = area < 1e-6 ? 1e6 : Math.sqrt(a2 * b2 * c2) / (4 * area);
            if (!(r < 1e6)) r = 1e6;
            return r < 12 ? 12 : r;
        };
        const steadyV = (r) => {
            const vc = OMEGA * r / (1 + OMEGA * r / 500);
            let vm = vc < VTOP ? vc : VTOP;
            const vp = vPower(r); if (vp < vm) vm = vp;
            return vm;
        };
        const slipOf = (vs, r, sg) => sg * Math.asin(Math.min(0.95, vs / (ALIGN * r)));
        // the cap at node i: the nose has to turn for the curvature AND for
        // the change of slip angle, read over +-SWM nodes so the node-scale
        // noise of a three-point radius does not drive it
        const vmaxAt = (RR, KK, BB, i) => {
            const p = (i - SWM + N) % N, n = (i + SWM) % N;
            const dB = SWING * (BB[n] - BB[p]) / (2 * SWM * ds);
            const keff = Math.abs(KK[i] + dB);
            let vm = keff > 1e-9 ? OMEGA / (keff + OMEGA / 500) : VTOP;
            if (vm > VTOP) vm = VTOP;
            const vp = vPower(RR[i]); if (vp < vm) vm = vp;
            return vm;
        };
        // the lap time of a complete state: acceleration forward, braking
        // backward (twice each, the lap is a loop), then the sum of ds/v
        const lapTime = (LL, RR, VM) => {
            for (let i = 0; i < N; i++) v[i] = VM[i];
            for (let rep = 0; rep < 2; rep++)
                for (let i = 0; i < N; i++) {
                    const p = (i - 1 + N) % N;
                    const q = v[p] * v[p] + 2 * accelAt(v[p], RR[p]) * LL[p];
                    const lim = Math.sqrt(q > 100 ? q : 100);
                    if (lim < v[i]) v[i] = lim;
                }
            for (let rep = 0; rep < 2; rep++)
                for (let i = N - 1; i >= 0; i--) {
                    const n = (i + 1) % N;
                    const lim = Math.sqrt(v[n] * v[n] + 2 * brakeAt(v[n], RR[n]) * LL[i]);
                    if (lim < v[i]) v[i] = lim;
                }
            let T = 0;
            for (let i = 0; i < N; i++) { const j = (i + 1) % N; T += LL[i] / (0.5 * (v[i] + v[j])); }
            return T;
        };
        const fullState = (a) => {
            for (let i = 0; i < N; i++) { px[i] = cx[i] + a[i] * nx[i]; py[i] = cy[i] + a[i] * ny[i]; }
            for (let i = 0; i < N; i++) L[i] = segLen(px, py, i);
            for (let i = 0; i < N; i++) { Rn[i] = radiusAt(px, py, i); Kn[i] = sgn / Rn[i]; Bn[i] = slipOf(steadyV(Rn[i]), Rn[i], sgn); }
            for (let i = 0; i < N; i++) vmax[i] = vmaxAt(Rn, Kn, Bn, i);
            return lapTime(L, Rn, vmax);
        };
        const optimize = (alpha0) => {
            const alpha = new Float64Array(N), talpha = new Float64Array(N);
            for (let i = 0; i < N; i++) alpha[i] = Math.max(-maxOff, Math.min(maxOff, alpha0[i]));
            let T = fullState(alpha);
            tpx.set(px); tpy.set(py); tL.set(L); tR.set(Rn); tK.set(Kn); tB.set(Bn); tvmax.set(vmax); talpha.set(alpha);
            const scales = opts.scales || [24, 16, 10, 6, 4, 2];
            const steps = opts.steps || [12, 6, 3, 1.5];
            const maxSweeps = opts.maxSweeps || 6;
            const wid = (h) => h + k + SWM;      // how far a bump's effect reaches
            for (const h of scales) {
                for (const st of steps) {
                    const stride = Math.max(1, Math.floor(h / 3));
                    for (let sweep = 0; sweep < maxSweeps; sweep++) {
                        let accepted = 0;
                        for (let i0 = 0; i0 < N; i0 += stride) {
                            for (let sg = 1; sg >= -1; sg -= 2) {
                                let changed = false;
                                for (let j = -h + 1; j <= h - 1; j++) {
                                    const idx = (i0 + j + N) % N;
                                    const wgt = 0.5 * (1 + Math.cos(Math.PI * j / h));
                                    let na = alpha[idx] + sg * st * wgt;
                                    if (na > maxOff) na = maxOff; else if (na < -maxOff) na = -maxOff;
                                    talpha[idx] = na;
                                    if (na !== alpha[idx]) changed = true;
                                    tpx[idx] = cx[idx] + na * nx[idx]; tpy[idx] = cy[idx] + na * ny[idx];
                                }
                                if (!changed) continue;
                                for (let j = -h; j <= h - 1; j++) { const idx = (i0 + j + N) % N; tL[idx] = segLen(tpx, tpy, idx); }
                                for (let j = -h + 1 - k; j <= h - 1 + k; j++) { const idx = (i0 + j + N) % N; tR[idx] = radiusAt(tpx, tpy, idx); tK[idx] = sgn / tR[idx]; tB[idx] = slipOf(steadyV(tR[idx]), tR[idx], sgn); }
                                const ww = wid(h);
                                for (let j = -ww; j <= ww; j++) { const idx = (i0 + j + N) % N; tvmax[idx] = vmaxAt(tR, tK, tB, idx); }
                                const Tt = lapTime(tL, tR, tvmax);
                                if (Tt < T - 1e-6) {
                                    T = Tt; accepted++;
                                    for (let j = -h + 1; j <= h - 1; j++) { const idx = (i0 + j + N) % N; alpha[idx] = talpha[idx]; px[idx] = tpx[idx]; py[idx] = tpy[idx]; }
                                    for (let j = -h; j <= h - 1; j++) { const idx = (i0 + j + N) % N; L[idx] = tL[idx]; }
                                    for (let j = -ww; j <= ww; j++) { const idx = (i0 + j + N) % N; Rn[idx] = tR[idx]; Kn[idx] = tK[idx]; Bn[idx] = tB[idx]; vmax[idx] = tvmax[idx]; }
                                } else {
                                    for (let j = -h + 1; j <= h - 1; j++) { const idx = (i0 + j + N) % N; talpha[idx] = alpha[idx]; tpx[idx] = px[idx]; tpy[idx] = py[idx]; }
                                    for (let j = -h; j <= h - 1; j++) { const idx = (i0 + j + N) % N; tL[idx] = L[idx]; }
                                    for (let j = -ww; j <= ww; j++) { const idx = (i0 + j + N) % N; tR[idx] = Rn[idx]; tK[idx] = Kn[idx]; tB[idx] = Bn[idx]; tvmax[idx] = vmax[idx]; }
                                }
                            }
                        }
                        if (!accepted) break;
                    }
                }
            }
            return { alpha: alpha, T: fullState(alpha) };
        };
        return { proxy: fullState, optimize: optimize };
    }

    _proxyTime(base, alpha) {
        return this._lineModel(base, 1e9, {}).proxy(alpha);
    }

    _optimizeAlpha(base, alpha0, maxOff, opts) {
        return this._lineModel(base, maxOff, opts).optimize(alpha0);
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

        const line = this._lineOrFallback();
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

                // 1. fully inside this circuit's world
                let ok = true;
                for (const p of pts) {
                    if (p.x < TRACK_X0 + 8 || p.x > this.worldW - 8 ||
                        p.y < 8 || p.y > this.worldH - 8) { ok = false; break; }
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

                // 4. and on dry land - ALL of it, not just the centre post.
                // Checking only (cx, cy) shipped stands with a corner in the
                // marina: a stand is a rectangle, and a rectangle can stand
                // on the beach with one foot in the water.
                if (this.water) {
                    const hl2 = len / 2 + 8, hd2 = depth / 2 + 8;
                    const ca = Math.cos(ang), sa = Math.sin(ang);
                    let wet = this._inWater(cx, cy);
                    for (const c2 of [[hl2, hd2], [hl2, -hd2], [-hl2, hd2], [-hl2, -hd2]]) {
                        if (wet) break;
                        wet = this._inWater(cx + c2[0] * ca - c2[1] * sa,
                                            cy + c2[0] * sa + c2[1] * ca);
                    }
                    if (wet) continue;
                }

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
        const line = this._lineOrFallback();
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

    // --- Water -----------------------------------------------------------
    // Circuits with a `water` property (arrays of polygon points, set up by
    // their constructors) get it painted UNDER everything else: a sand rim,
    // the deep fill, a shoreline shimmer, seeded static ripples, and any
    // `boats`. It lives in the baked track layer, so it costs nothing per
    // frame - which is also why the ripples are still: the bake redraws only
    // when the track changes, not on a clock.
    _inWater(x, y) {
        if (!this.water) return false;
        for (const poly of this.water) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                if ((poly[i].y > y) !== (poly[j].y > y) &&
                    x < (poly[j].x - poly[i].x) * (y - poly[i].y) /
                        (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
            }
            if (inside) return true;
        }
        return false;
    }

    drawWater(ctx) {
        if (!this.water) return;
        const path = (poly) => {
            ctx.beginPath();
            ctx.moveTo(poly[0].x, poly[0].y);
            for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
            ctx.closePath();
        };
        for (const poly of this.water) {
            // the beach: a sand band straddling the shoreline; the fill then
            // covers its inner half, leaving a rim on the outside
            path(poly);
            ctx.strokeStyle = '#d3bf8d';
            ctx.lineWidth = 16;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.fillStyle = '#175d87';
            ctx.fill();
            // shoreline foam
            path(poly);
            ctx.strokeStyle = 'rgba(140, 205, 235, 0.5)';
            ctx.lineWidth = 5;
            ctx.stroke();
            // seeded ripples, deterministic so the bake is stable
            let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
            for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
                                    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
            let rnd = Math.round(Math.abs(x0 + y0) + poly.length);
            const rr = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
            const n = Math.min(60, Math.round((x1 - x0) * (y1 - y0) / 26000));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
            ctx.lineWidth = 1.6;
            for (let k = 0; k < n; k++) {
                const rx = x0 + rr() * (x1 - x0), ry = y0 + rr() * (y1 - y0);
                if (!this._inWater(rx, ry)) continue;
                const rad = 5 + rr() * 10, a0 = rr() * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(rx, ry, rad, a0, a0 + 1.9);
                ctx.stroke();
            }
        }
        // boats: a wake (only for boats under way - a moored boat trailing
        // one was poking painted water out over the marina beach), a hull,
        // a deck stripe
        for (const b of (this.boats || [])) {
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.a);
            if (!b.m) {
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.beginPath();                   // wake
                ctx.moveTo(-14, 0); ctx.lineTo(-30, -4); ctx.lineTo(-30, 4);
                ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = '#f4f1e8';             // hull
            ctx.beginPath();
            ctx.moveTo(13, 0); ctx.lineTo(4, -5); ctx.lineTo(-11, -5);
            ctx.lineTo(-11, 5); ctx.lineTo(4, 5);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#8a6f4d';             // deck
            ctx.fillRect(-7, -2.5, 9, 5);
            ctx.restore();
        }
    }

    // The kerb pass, lifted out of draw() so the tunnel roof can put the
    // road back together above the buried one. `near`, when given, restricts
    // it to arcs whose kerb passes within r of (x, y) - the roof only needs
    // the handful of arcs at the crossing, not the whole lap, every frame.
    drawKerbs(ctx, near) {
        for (const seg of this.segments) {
            if (seg.type !== 'arc') continue;

            const kw = this.kerbWidthFor(seg);
            if (kw < 3) continue;               // no verge to put one on
            const rk = seg.r - this.trackWidth - kw / 2;
            if (rk <= 2) continue;
            if (near && Math.hypot(seg.cx - near.x, seg.cy - near.y) > seg.r + near.r) continue;

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
    }

    draw(ctx) {
        // Water first, under everything else - see drawWater.
        this.drawWater(ctx);

        // Stands next: they sit outside the barriers, behind the racing.
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
        this.drawKerbs(ctx);

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
    
    // --- THE TUNNEL ------------------------------------------------------
    //  The other way for two roads to cross: instead of lifting the second
    //  one onto a deck, drop it into the ground under the first.
    //
    //  Suzuka needed it. A deck is a straight slab aligned with the road on
    //  top of it, which is why the backstretch was put up there - it is
    //  straight where they meet. But that deck then sat over the ESSES, and
    //  the esses are the best corners on the circuit: you were driving them
    //  under a lid. Swapping the levels alone does not help, because the
    //  esses curve through 100 degrees inside the deck's own length and a
    //  straight slab laid along them would leave the road entirely. So the
    //  backstretch stays the road that changes level, and it now goes DOWN:
    //  the esses are ordinary ground-level road with nothing above them, and
    //  the backstretch dives under and comes out the far side.
    //
    //  Drawn as cut-and-cover: bury the lower road in the ground the upper
    //  one sits on, rebuild the upper road's verge, kerbs and asphalt on top
    //  of the fill, and put a portal at each end where the lower road goes
    //  in. The fill is not quite opaque, for the same reason the deck was
    //  not: at 0.9 the buried road still reads as a shape, so a driver in
    //  the tunnel can place themselves, and main.js draws the tags for
    //  everyone afterwards - a car you cannot see is still a car you can
    //  follow.
    drawTunnel(ctx, b) {
        b = b || this.getBridge();
        if (!b) return;
        const hl = b.half;                    // along the buried road
        const hw = this.wallRadius();         // its half width

        // 1. the ground the upper road stands on, laid over the lower one -
        //    in three bands, not one: the strip directly over the buried ROAD
        //    is left a shade thinner than the shoulders either side, so the
        //    line of the tunnel reads through the grass. The cars in it are
        //    NOT left to show through this - the upper road is rebuilt
        //    opaquely on top in step 3, which would bury them again whatever
        //    this alpha said. main.js draws them back over the finished
        //    crossing as shapes instead; see the ghost pass there.
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.uAngle);
        const ground = this.vergeColour || '#2e7d32';
        const tw = this.trackWidth;
        ctx.fillStyle = ground;
        ctx.globalAlpha = 0.98;                       // the shoulders: earth
        ctx.fillRect(-hl, -hw, hl * 2, hw - tw);
        ctx.fillRect(-hl, tw, hl * 2, hw - tw);
        ctx.globalAlpha = 0.9;                        // over the road itself
        ctx.fillRect(-hl, -tw, hl * 2, tw * 2);
        ctx.globalAlpha = 1;

        // 2. the portals. The mouth is dark on the OUTSIDE of the fill - on
        //    the road you are still driving, fading away from the opening,
        //    because that is where a hole in the ground reads from above.
        //    Then the retaining wall across the full corridor, with its top
        //    edge catching the light.
        for (const side of [-1, 1]) {
            const x = side * hl;
            const g = ctx.createLinearGradient(x, 0, x + side * 52, 0);
            g.addColorStop(0, 'rgba(0, 0, 0, 0.80)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(Math.min(x, x + side * 52), -this.trackWidth,
                         52, this.trackWidth * 2);
            ctx.fillStyle = '#8f9599';                       // the retaining wall
            ctx.fillRect(Math.min(x, x + side * 8), -hw, 8, hw * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';     // its lit top edge
            ctx.fillRect(x - (side > 0 ? 0 : 2), -hw, 2, hw * 2);
        }
        ctx.restore();

        // 3. the upper road, rebuilt on the fill - verge, kerbs, asphalt, in
        //    the same order the circuit itself is painted. Clipped to the
        //    buried rectangle so nothing outside the crossing is touched.
        const p = b.overPath;
        if (!p || p.length < 2) return;
        ctx.save();
        ctx.beginPath();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.uAngle);
        ctx.rect(-hl, -hw, hl * 2, hw * 2);
        ctx.clip();
        ctx.rotate(-b.uAngle);
        ctx.translate(-b.x, -b.y);

        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        const road = () => {
            ctx.beginPath();
            ctx.moveTo(p[0].x, p[0].y);
            for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
        };
        road();
        ctx.lineWidth = Math.max(this.grassWidth, this.barrierRadius()) * 2;
        ctx.strokeStyle = this.vergeColour || '#2e7d32';
        ctx.stroke();
        this.drawKerbs(ctx, { x: b.x, y: b.y, r: hl + this.grassWidth });
        road();
        ctx.lineWidth = this.trackWidth * 2;
        ctx.strokeStyle = '#555';
        ctx.stroke();
        ctx.restore();
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

        // Sul rettifilo del traguardo, 312px di dritto fra la diagonale che
        // arriva dalla conca e la staccata dell'ansa. La linea stava a 23px
        // dalla staccata - "troppo vicina alla prima curva", e lo era: si
        // passava sotto la bandiera gia' in frenata. Ora sta a 93px, con la
        // griglia (sei file, 180px) ancora tutta sul dritto e la finestra da
        // cui la corsia box prende in carico l'auto (250-360px prima della
        // linea) sull'ultimo tratto della diagonale, entro i 50px di
        // scostamento che quella finestra tollera. Verificato con le soste:
        // 13 pit stop, nessuno fuori pista in manovra.
        this.startX = 824;
        this.startY = 460;

        this.waypoints = this.generateWaypoints();
    }
}


// ===========================================================================
//  ARROW
// ===========================================================================
//
//  FROM NICOLA'S PENCIL DRAWING, corner for corner: a long thin point at the
//  top left, the leading edge sweeping right and down to a hooked tip on the
//  right, a long diagonal back to a round lobe in the bottom left, and a claw
//  curling up through the middle to close the point. 2800px of centre line -
//  third longest in the game - and 40% of it in corners.
//
//  DRAWN AS A LIST OF CORNERS, NOT AS A SET OF VERTICES. How far each turns,
//  how long the straight after it runs, what radius it wants; a least-squares
//  fit then closes the polygon - 360 degrees of total turn, zero displacement
//  - while holding three hard constraints: 150px between two roads that are
//  not joined, the arena, and the minimum radius below. Placing vertices by
//  hand and hoping the fillets behave crushes the radii exactly where they
//  need to be large. The tool is falcon.py in the harness folder.
//
//  THE ONE LIBERTY TAKEN, and it is forced. On paper the point at the top
//  left is a POINT: the two roads meet. The road here is 104px wide, and two
//  roads that meet leave a strip of tarmac 200px long with no barrier in it -
//  which is not a corner, it is a shortcut that skips one. The rule:
//
//     the grass INSIDE a corner is a disc of radius R - trackWidth, and past
//     about 80 degrees of turn that disc is the only thing between the
//     corner's two legs. A 142-degree point needs R >= wall/cos(19.5) = 74
//     for any barrier at all, and 93 for the barrier to be 36px wide.
//
//  So the point is a hairpin. What could be saved of the wedge is the pair of
//  long straights that run into it, and they are here: 165px of converging
//  road before the turn, which is what makes it read as a point rather than
//  as a loop.
//
//  NOT MIRRORED, and that is the whole point of leaving it as drawn. Five
//  circuits were flipped top-to-bottom (see mirrorVertically) because the
//  calendar leaned one way and Nicola drives with the arrow keys. Measured
//  again now, degrees of arc swept per lap summed over the calendar:
//
//      without this circuit   4600 right   4960 left    (360 left-heavy)
//      with it, as drawn      5140 right   5140 left    (level)
//
//  The drawing turns right - 540 degrees of right arc against 180 of left -
//  and that is exactly the 360 the calendar was short of. Mirroring it would
//  have taken the imbalance to 720 the other way. So: clockwise, as drawn.
// ===========================================================================
class ArrowTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 52;
        this.grassWidth = 72;

        this.segments = [
            { type: 'arc', cx: 249.26, cy: 83.42, r: 83.42, start: 2.216726, end: -1.570796, ccw: false },
            { type: 'line', x1: 249.26, y1: -0.00, x2: 417.62, y2: -0.00 },
            { type: 'arc', cx: 417.62, cy: 98.88, r: 98.88, start: -1.570796, end: -1.077073, ccw: false },
            { type: 'line', x1: 464.48, y1: 11.81, x2: 766.43, y2: 174.31 },
            { type: 'arc', cx: 719.57, cy: 261.38, r: 98.88, start: -1.077073, end: 0.940322, ccw: false },
            { type: 'line', x1: 777.86, y1: 341.25, x2: 578.77, y2: 486.56 },
            { type: 'arc', cx: 520.47, cy: 406.69, r: 98.88, start: 0.940322, end: 1.405692, ccw: false },
            { type: 'line', x1: 536.72, y1: 504.22, x2: 60.29, y2: 583.61 },
            { type: 'arc', cx: 44.03, cy: 486.07, r: 98.88, start: 1.405692, end: 2.879926, ccw: false },
            { type: 'line', x1: -51.48, y1: 511.65, x2: -58.43, y2: 485.72 },
            { type: 'arc', cx: 37.09, cy: 460.14, r: 98.88, start: 2.879926, end: -1.808598, ccw: false },
            { type: 'line', x1: 13.80, y1: 364.04, x2: 64.24, y2: 351.81 },
            { type: 'arc', cx: 86.08, cy: 441.90, r: 92.70, start: -1.808598, end: -1.440533, ccw: false },
            { type: 'line', x1: 98.12, y1: 349.99, x2: 229.73, y2: 367.23 },
            { type: 'arc', cx: 241.77, cy: 275.32, r: 92.70, start: 1.701060, end: 1.364392, ccw: true },
            { type: 'line', x1: 260.77, y1: 366.05, x2: 354.40, y2: 346.45 },
            { type: 'arc', cx: 338.68, cy: 271.36, r: 76.72, start: 1.364392, end: -0.077968, ccw: true },
            { type: 'line', x1: 415.16, y1: 265.38, x2: 414.36, y2: 255.11 },
            { type: 'arc', cx: 337.88, cy: 261.09, r: 76.72, start: -0.077968, end: -1.447295, ccw: true },
            { type: 'line', x1: 347.33, y1: 184.96, x2: 247.63, y2: 172.58 },
            { type: 'arc', cx: 258.01, cy: 88.92, r: 84.30, start: 1.694297, end: 2.216726, ccw: false },
            { type: 'line', x1: 207.27, y1: 156.24, x2: 199.05, y2: 150.04 }
        ];

        // Sul dritto lungo dell'ala (343px), 90px prima della staccata
        // dell'Artiglio: la griglia - dieci auto ogni 30px, 305px all'indietro
        // - sta sul dritto per i due terzi e finisce sull'arco della piega.
        this.startX = 687.17;
        this.startY = 131.66;

        this.waypoints = this.generateWaypoints();
    }
}

// ===========================================================================
//  PENTAGON
// ===========================================================================
//
//  A REGULAR PENTAGON, and exactly one. Five sides of 380.90px, five turns of
//  72.000 degrees, five straights of 213.80px, one fillet radius on all five
//  corners - equal to the last digit the doubles carry, because the shape is
//  not negotiated, it is constructed: the largest circumscribed circle that
//  fits the arena, five vertices 72 degrees apart on it, one radius. No
//  solver, no compromises, nothing measured off a drawing.
//
//  1791px of centre line and 40% of it in corners. It is the second shortest
//  circuit in the game after Circle, and that is what a pentagon costs: the
//  shape is almost circular, so its bounding box is nearly square (776 x 759
//  with the barrier) and the arena's spare width - 370px of it - cannot be
//  used by anything that has to stay regular.
//
//  ANTICLOCKWISE: five left-handers. Two reasons, and both matter.
//
//  The mechanical one: checkLapCross() counts a lap by crossing startX in +x,
//  so a side has to be driven left to right. A pentagon with a flat BASE and
//  its point up, driven anticlockwise, puts that side along the bottom. Point
//  down and the horizontal side moves to the top and the direction flips.
//
//  The other is the calendar. Nicola drives with the arrow keys and the
//  left/right balance is a thing he feels; Arrow was left as drawn precisely
//  because its 540 degrees of right sweep took the calendar level at
//  5140/5140. A pentagon is 360 degrees of turn ALL ONE WAY - there is no
//  such thing as a balanced one - so it has to lean, and it leans the safer
//  way: the complaint that started the mirroring was a sore right finger.
//  With Pentagon the calendar reads 5140 right against 5500 left.
// ===========================================================================
//  LOTUS - the circuit shown as Lotus in the menus, twice the size.
//  The class and the storage key stay PENTAGON: the key is written into
//  saved championships and into race logs already on disk, and a name on a
//  screen is not a reason to invalidate them. Same arrangement as Rectangle,
//  which is still `quadrato` underneath. The shape is a pentagon with a
//  chicane on every side, which is where the flower comes from.
//
//  It was 1.79 km in the classic world: five left-handers of r=115 joined by
//  five 214px straights, and nothing else. Nicola asked for a bigger one that
//  stays fair to all three chassis - which is the hard half of the request,
//  because the two obvious ways to grow a circuit BOTH move it towards Bolt.
//  Scale everything by k and the radii grow, and corner speed saturates at 500
//  as the radius rises (v = maxSteer/(1/R + maxSteer/500)), so the steering
//  rate an Aero paid its top speed for stops being worth anything; lengthen
//  only the straights and you have simply added top-speed running. Growing
//  while staying balanced therefore means ADDING CORNER WORK, not tarmac.
//
//  So every side now carries a CHICANE - a right-left pair with a breath
//  between its halves - and the vertex has come down from r=115 to r=100. The
//  lap is 3.68 km, 2.05x what it was, and it measures BETTER balanced than the
//  small one did: 0.72% between the best and worst chassis against 0.85%
//  before. (Measured with the game's own qualifying simulation, tyre pinned,
//  and with Math.random seeded to the same value for all three cars so they
//  meet the same AI mistakes - unpaired, the noise was as big as the effect.)
//
//  The five-fold symmetry is what makes this safe to author: the circuit is
//  one unit repeated five times, and ANY unit whose headings net to 72 degrees
//  closes the figure exactly, because five applications of a 72-degree rigid
//  rotation is the identity. The chicane nets zero, so it can be anything.
//
//  A side effect worth having: Pentagon used to be five left-handers and no
//  right-handers at all. It is now ten left and five right.
class PentagonTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 1600;
        this.worldH = 1390;
        this.trackWidth = 70;
        this.grassWidth = 90;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 235, y2: 0 },
            { type: 'arc', cx: 235, cy: 74, r: 74, start: -1.5708, end: -0.5585, ccw: false },
            { type: 'line', x1: 297.76, y1: 34.79, x2: 321.6, y2: 72.95 },
            { type: 'arc', cx: 384.36, cy: 33.73, r: 74, start: 2.5831, end: 1.5708, ccw: true },
            { type: 'line', x1: 384.36, y1: 107.73, x2: 564.36, y2: 107.73 },
            { type: 'arc', cx: 564.36, cy: 7.73, r: 100, start: 1.5708, end: 0.3142, ccw: true },
            { type: 'line', x1: 659.46, y1: 38.64, x2: 732.08, y2: -184.86 },
            { type: 'arc', cx: 802.46, cy: -162, r: 74, start: -2.8274, end: -1.8151, ccw: false },
            { type: 'line', x1: 784.56, y1: -233.8, x2: 828.22, y2: -244.68 },
            { type: 'arc', cx: 810.32, cy: -316.49, r: 74, start: 1.3265, end: 0.3142, ccw: true },
            { type: 'line', x1: 880.7, y1: -293.62, x2: 936.32, y2: -464.81 },
            { type: 'arc', cx: 841.21, cy: -495.71, r: 100, start: 0.3142, end: -0.9425, ccw: true },
            { type: 'line', x1: 899.99, y1: -576.61, x2: 709.87, y2: -714.74 },
            { type: 'arc', cx: 753.37, cy: -774.61, r: 74, start: -4.0841, end: -3.0718, ccw: false },
            { type: 'line', x1: 679.55, y1: -779.77, x2: 682.69, y2: -824.66 },
            { type: 'arc', cx: 608.87, cy: -829.82, r: 74, start: 0.0698, end: -0.9425, ccw: true },
            { type: 'line', x1: 652.37, y1: -889.69, x2: 506.74, y2: -995.49 },
            { type: 'arc', cx: 447.96, cy: -914.59, r: 100, start: -0.9425, end: -2.1991, ccw: true },
            { type: 'line', x1: 389.19, y1: -995.49, x2: 199.07, y2: -857.36 },
            { type: 'arc', cx: 155.57, cy: -917.23, r: 74, start: -5.3407, end: -4.3284, ccw: false },
            { type: 'line', x1: 127.85, y1: -848.62, x2: 86.13, y2: -865.47 },
            { type: 'arc', cx: 58.41, cy: -796.86, r: 74, start: -1.1868, end: -2.1991, ccw: true },
            { type: 'line', x1: 14.91, y1: -856.73, x2: -130.71, y2: -750.93 },
            { type: 'arc', cx: -71.93, cy: -670.03, r: 100, start: -2.1991, end: -3.4558, ccw: true },
            { type: 'line', x1: -167.04, y1: -639.13, x2: -94.42, y2: -415.63 },
            { type: 'arc', cx: -164.8, cy: -392.76, r: 74, start: -6.5973, end: -5.5851, ccw: false },
            { type: 'line', x1: -108.11, y1: -345.19, x2: -137.04, y2: -310.72 },
            { type: 'arc', cx: -80.35, cy: -263.16, r: 74, start: -2.4435, end: -3.4558, ccw: true },
            { type: 'line', x1: -150.73, y1: -240.29, x2: -95.11, y2: -69.1 },
            { type: 'arc', cx: 0, cy: -100, r: 100, start: -3.4558, end: -4.7124, ccw: true }
        ];

        // On the long straight, 20px before the chicane's braking point: the
        // grid - ten cars every 30px, 305px back - covers it and reaches into
        // the previous vertex, which on a pentagon is exactly like all the
        // others. Same arrangement as the small version had.
        this.startX = 215;
        this.startY = 0;

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

// ===========================================================================
//  THE BIG CIRCUITS (Apex Zoom)
//  These two are why the camera exists: their world is declared per circuit
//  (worldW x worldH) and is far larger than the screen, which the old
//  one-canvas renderer could never have shown. Geometry built the same way as
//  everything above - lines and tangent arcs, closed exactly - with the same
//  physics, kerbs, barriers and stands falling out of the same code.
// ===========================================================================

//  Marathon: a 7.5 km Grand Prix loop in a 2720x1530 world (four times the
//  area of the classic canvas). A kilometre-long start straight into a fast
//  right, a chicane, then an infield of second-gear corners between two
//  hairpins, and a long run home along the bottom. Eighteen corners.
//
//  THE CORNERS ARE THE POINT, and the first version got that wrong. It had
//  nine corners of 95-180px radius over 6.8 km, and the measurement that
//  matters is not the length of the straights - it is the SHARE OF THE LAP
//  where the steering rate binds rather than top speed. The corner model is
//      v = maxSteer / (1/R + maxSteer/500)
//  which SATURATES at 500 as R grows: on a big-radius corner extra steering
//  rate buys almost nothing, so a chassis that paid for steering with top
//  speed (Aero) has nowhere to earn it back. v1 spent 19% of the lap in real
//  corners against a classic-calendar mean of 46%, and Aero was 3.9% off the
//  best car here against 1.6% on the classic circuits - a circuit that picks
//  the chassis for you. The radii below are chosen against that number, not
//  by eye. (Nicola spotted this from the shape alone.)
class MaratonaTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2720;
        this.worldH = 1530;
        this.trackWidth = 60;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 1080, y2: 0 },
            { type: 'arc', cx: 1080, cy: 150, r: 150, start: -1.5708, end: 0, ccw: false },
            { type: 'line', x1: 1230, y1: 150, x2: 1230, y2: 350 },
            { type: 'arc', cx: 1145, cy: 350, r: 85, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 1145, y1: 435, x2: 985, y2: 435 },
            { type: 'arc', cx: 985, cy: 499, r: 64, start: 4.7124, end: 3.1416, ccw: true },
            { type: 'line', x1: 921, y1: 499, x2: 921, y2: 579 },
            { type: 'arc', cx: 985, cy: 579, r: 64, start: 3.1416, end: 1.5708, ccw: true },
            { type: 'line', x1: 985, y1: 643, x2: 1225, y2: 643 },
            { type: 'arc', cx: 1225, cy: 733, r: 90, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 1225, y1: 823, x2: 985, y2: 823 },
            { type: 'arc', cx: 985, cy: 895, r: 72, start: 4.7124, end: 3.1416, ccw: true },
            { type: 'line', x1: 913, y1: 895, x2: 913, y2: 975 },
            { type: 'arc', cx: 837, cy: 975, r: 76, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 837, y1: 1051, x2: 697, y2: 1051 },
            { type: 'arc', cx: 697, cy: 971, r: 80, start: 1.5708, end: 3.1416, ccw: false },
            { type: 'line', x1: 617, y1: 971, x2: 617, y2: 881 },
            { type: 'arc', cx: 543, cy: 881, r: 74, start: 6.2832, end: 4.7124, ccw: true },
            { type: 'line', x1: 543, y1: 807, x2: 203, y2: 807 },
            { type: 'arc', cx: 203, cy: 895, r: 88, start: 4.7124, end: 3.1416, ccw: true },
            { type: 'line', x1: 115, y1: 895, x2: 115, y2: 1005 },
            { type: 'arc', cx: 185, cy: 1005, r: 70, start: 3.1416, end: 1.5708, ccw: true },
            { type: 'line', x1: 185, y1: 1075, x2: 305, y2: 1075 },
            { type: 'arc', cx: 305, cy: 1165, r: 90, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 305, y1: 1255, x2: -395, y2: 1255 },
            { type: 'arc', cx: -395, cy: 1155, r: 100, start: 1.5708, end: 3.1416, ccw: false },
            { type: 'line', x1: -495, y1: 1155, x2: -495, y2: 835 },
            { type: 'arc', cx: -405, cy: 835, r: 90, start: 3.1416, end: 4.7124, ccw: false },
            { type: 'line', x1: -405, y1: 745, x2: -205, y2: 745 },
            { type: 'arc', cx: -205, cy: 665, r: 80, start: 7.854, end: 6.2832, ccw: true },
            { type: 'line', x1: -125, y1: 665, x2: -125, y2: 465 },
            { type: 'arc', cx: -215, cy: 465, r: 90, start: 6.2832, end: 4.7124, ccw: true },
            { type: 'arc', cx: -215, cy: 235, r: 140, start: 1.5708, end: 3.1416, ccw: false },
            { type: 'line', x1: -355, y1: 235, x2: -355, y2: 150 },
            { type: 'arc', cx: -205, cy: 150, r: 150, start: 3.1416, end: 4.7124, ccw: false },
            { type: 'line', x1: -205, y1: 0, x2: 0, y2: 0 }
        ];

        this.startX = 420;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}

//  Colossus: 5.1 km in a 2200x1300 world. A stadium section bites into the
//  middle, and the long run west is broken by two STEPS - a left-right pair
//  that keeps the car pointing west while moving the road down the world.
//  They exist because this circuit is short of vertical room and has width to
//  spare: they buy four real corners out of horizontal space. Mirrored, so it
//  turns left on balance and the big-circuit pair is even-handed the way the
//  classic calendar is.
class ColossoTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2200;
        this.worldH = 1300;
        this.trackWidth = 70;
        this.grassWidth = 90;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 620, y2: 0 },
            { type: 'arc', cx: 620, cy: 95, r: 95, start: -1.5708, end: 0, ccw: false },
            { type: 'line', x1: 715, y1: 95, x2: 715, y2: 205 },
            { type: 'arc', cx: 643, cy: 205, r: 72, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 643, y1: 277, x2: 523, y2: 277 },
            { type: 'arc', cx: 523, cy: 343, r: 66, start: 4.7124, end: 3.1416, ccw: true },
            { type: 'line', x1: 457, y1: 343, x2: 457, y2: 433 },
            { type: 'arc', cx: 523, cy: 433, r: 66, start: 3.1416, end: 1.5708, ccw: true },
            { type: 'line', x1: 523, y1: 499, x2: 803, y2: 499 },
            { type: 'arc', cx: 803, cy: 594, r: 95, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'line', x1: 803, y1: 689, x2: 543, y2: 689 },
            { type: 'arc', cx: 543, cy: 769, r: 80, start: 4.7124, end: 3.1416, ccw: true },
            { type: 'line', x1: 463, y1: 769, x2: 463, y2: 809 },
            { type: 'arc', cx: 383, cy: 809, r: 80, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 383, y1: 889, x2: 63, y2: 889 },
            { type: 'arc', cx: 63, cy: 974, r: 85, start: 4.7124, end: 3.1416, ccw: true },
            { type: 'line', x1: -22, y1: 974, x2: -22, y2: 994 },
            { type: 'arc', cx: -107, cy: 994, r: 85, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: -107, y1: 1079, x2: -307, y2: 1079 },
            { type: 'arc', cx: -307, cy: 984, r: 95, start: 1.5708, end: 3.1416, ccw: false },
            { type: 'line', x1: -402, y1: 984, x2: -402, y2: 804 },
            { type: 'arc', cx: -317, cy: 804, r: 85, start: 3.1416, end: 4.7124, ccw: false },
            { type: 'line', x1: -317, y1: 719, x2: -167, y2: 719 },
            { type: 'arc', cx: -167, cy: 644, r: 75, start: 7.854, end: 6.2832, ccw: true },
            { type: 'line', x1: -92, y1: 644, x2: -92, y2: 584 },
            { type: 'arc', cx: -172, cy: 584, r: 80, start: 6.2832, end: 4.7124, ccw: true },
            { type: 'arc', cx: -172, cy: 394, r: 110, start: 1.5708, end: 3.1416, ccw: false },
            { type: 'line', x1: -282, y1: 394, x2: -282, y2: 120 },
            { type: 'arc', cx: -162, cy: 120, r: 120, start: 3.1416, end: 4.7124, ccw: false },
            { type: 'line', x1: -162, y1: 0, x2: 0, y2: 0 }
        ];

        this.startX = 260;
        this.startY = 0;

        this.mirrorVertically();
        this.waypoints = this.generateWaypoints();
    }
}

//  SPA. 7.5 km in a 3400x1780 world - the biggest world any circuit has asked
//  for, and level with Marathon as the longest lap.
//
//  A PORTRAIT AND NOT A SURVEY. What had to survive is what the place is: the
//  hairpin at La Source with the pit straight and the Bus Stop either side of
//  it, the plunge and climb through Eau Rouge and Raidillon, a Kemmel straight
//  long enough to hurt, the chicane at Les Combes, the right at Bruxelles that
//  turns the lap back on itself, the double left at Pouhon, Fagnes, Stavelot,
//  and the fast run home through Paul Frere and Blanchimont into the Bus Stop.
//
//  Two of the game's own rules fixed the drawing, and both are worth knowing
//  before anyone edits a number here:
//
//  1. checkLapCross() counts a lap by crossing startX travelling in +x, so the
//     start/finish straight HAS to run east. That fixes the rotation of the
//     whole circuit. Rotating is safe; mirroring is not, because a mirror
//     turns every right-hander into a left and Spa is a right-handed circuit -
//     which is also why this one is not in mirrorVertically()'s list.
//  2. A closed lap turns through exactly 360 degrees. Drawn corner by corner
//     off the map it came to 466, and no chicane can absorb 106 degrees.
//
//  So it was not drawn, it was SOLVED: /root/tools/design_spa.js lays the lap
//  out with a turtle - so the road is continuous by construction - and then
//  finds the two straights either side of Courbe Paul Frere by linear algebra,
//  which shuts the loop to four decimal places while leaving every corner the
//  shape it was given. The straights between the corners were then searched
//  for, against the closure, the corridor separation, the world it has to fit
//  and the lap length wanted. That is why the coordinates below are not round
//  numbers: they are the answer, not the input. Edit design_spa.js, not this.
//
//  La Source is r=92 and not the r=60 the map wants, because a hairpin of
//  radius r brings the road back within 2r of the straight it left and two
//  corridors here need 168px of daylight. It is still the slowest corner on
//  the lap: radius is what makes a corner slow in this game.
class SpaTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 3400;
        this.worldH = 1780;
        this.trackWidth = 62;
        this.grassWidth = 82;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 400, y2: 0 },
            { type: 'arc', cx: 400, cy: 92, r: 92, start: -1.5708, end: 1.39626, ccw: false },
            { type: 'line', x1: 415.98, y1: 182.6, x2: 219.01, y2: 217.33 },
            { type: 'arc', cx: 245.41, cy: 367.02, r: 152, start: 4.53786, end: 3.87463, ccw: true },
            { type: 'line', x1: 132.45, y1: 265.31, x2: 45.46, y2: 361.92 },
            { type: 'arc', cx: -64.52, cy: 262.89, r: 148, start: 0.73304, end: 1.6057, ccw: false },
            { type: 'line', x1: -69.69, y1: 410.8, x2: -199.61, y2: 406.27 },
            { type: 'arc', cx: -206.87, cy: 614.14, r: 208, start: 4.7473, end: 3.87463, ccw: true },
            { type: 'line', x1: -361.44, y1: 474.96, x2: -1033.92, y2: 1221.82 },
            { type: 'arc', cx: -1087.42, cy: 1173.64, r: 72, start: 0.73304, end: 2.02458, ccw: false },
            { type: 'line', x1: -1118.99, y1: 1238.36, x2: -1168.42, y2: 1214.25 },
            { type: 'arc', cx: -1197.35, cy: 1273.57, r: 66, start: 5.16617, end: 4.32842, ccw: true },
            { type: 'line', x1: -1222.08, y1: 1212.37, x2: -1277.71, y2: 1234.85 },
            { type: 'arc', cx: -1306.18, cy: 1164.38, r: 76, start: 1.18682, end: 2.1293, ccw: false },
            { type: 'line', x1: -1346.45, y1: 1228.83, x2: -1439.74, y2: 1170.54 },
            { type: 'arc', cx: -1496.97, cy: 1262.13, r: 108, start: 5.27089, end: 4.60767, ccw: true },
            { type: 'line', x1: -1508.26, y1: 1154.72, x2: -1682.3, y2: 1173.02 },
            { type: 'arc', cx: -1689.62, cy: 1103.4, r: 70, start: 1.46608, end: 4.08407, ccw: false },
            { type: 'line', x1: -1730.76, y1: 1046.77, x2: -1520.42, y2: 893.94 },
            { type: 'arc', cx: -1574.49, cy: 819.51, r: 92, start: 7.22566, end: 6.38791, ccw: true },
            { type: 'line', x1: -1483, y1: 829.13, x2: -1470.07, y2: 706.14 },
            { type: 'arc', cx: -1574.49, cy: 695.17, r: 105, start: 6.38791, end: 5.37561, ccw: true },
            { type: 'line', x1: -1509.85, y1: 612.43, x2: -1565.01, y2: 569.33 },
            { type: 'arc', cx: -1624.11, cy: 644.98, r: 96, start: 5.37561, end: 4.50295, ccw: true },
            { type: 'line', x1: -1644.07, y1: 551.08, x2: -1869.05, y2: 598.9 },
            { type: 'arc', cx: -1884.02, cy: 528.47, r: 72, start: 1.36136, end: 2.37365, ccw: false },
            { type: 'line', x1: -1935.81, y1: 578.49, x2: -1987.91, y2: 524.53 },
            { type: 'arc', cx: -2038.26, cy: 573.16, r: 70, start: 5.51524, end: 4.64258, ccw: true },
            { type: 'line', x1: -2043.15, y1: 503.33, x2: -2137.42, y2: 509.92 },
            { type: 'arc', cx: -2143, cy: 430.12, r: 80, start: 1.50098, end: 2.6529, ccw: false },
            { type: 'line', x1: -2213.64, y1: 467.68, x2: -2267.63, y2: 366.14 },
            { type: 'arc', cx: -2186.4, cy: 322.95, r: 92, start: 2.6529, end: 4.11898, ccw: false },
            { type: 'line', x1: -2237.84, y1: 246.67, x2: -1889.65, y2: 11.81 },
            { type: 'arc', cx: -1831.49, cy: 98.03, r: 104, start: 4.11898, end: 4.71239, ccw: false },
            { type: 'line', x1: -1831.49, y1: -5.97, x2: -1411.49, y2: -5.97 },
            { type: 'arc', cx: -1411.49, cy: -123.97, r: 118, start: 7.85398, end: 7.33038, ccw: true },
            { type: 'line', x1: -1352.49, y1: -21.78, x2: -988.76, y2: -231.78 },
            { type: 'arc', cx: -939.76, cy: -146.9, r: 98, start: 4.18879, end: 4.71239, ccw: false },
            { type: 'line', x1: -939.76, y1: -244.9, x2: -559.76, y2: -244.9 },
            { type: 'arc', cx: -559.76, cy: -188.9, r: 56, start: 4.71239, end: 5.93412, ccw: false },
            { type: 'line', x1: -507.14, y1: -208.06, x2: -443.86, y2: -34.21 },
            { type: 'arc', cx: -395, cy: -52, r: 52, start: 9.07571, end: 7.85398, ccw: true },
            { type: 'line', x1: -395, y1: 0, x2: 0, y2: 0 }
        ];

        // 130px into the pit straight: 610px of road behind the line, which is
        // room for a 12-car grid (35 + 11*30 = 365 back) and then some, and
        // 260 ahead of it before the car has to stop for La Source.
        this.startX = 130;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}


//  SUZUKA. 6.7 km in a 2080x2290 world - the game's first TALL world, because
//  the lap-counter rule (checkLapCross counts a lap crossing startX eastbound)
//  pins the pit straight east-west, and this circuit is a portrait of a place
//  whose long axis then comes out vertical.
//
//  A portrait of Suzuka, loosely: a First Corner that hooks through 170
//  degrees in two bites, THE ESSES - see below, they are the point of the
//  place - Dunlop, a vestigial Degner, the kinked underpass run to the
//  HAIRPIN, 200R, a Spoon that is itself a small pair of esses, a 1005px
//  backstretch that dives under the esses, the 130R sweep into the Casio
//  chicane, and a long Last Curve. And the thing that makes it Suzuka rather
//  than anywhere else: the lap CROSSES ITSELF - a figure of eight, the
//  second on the calendar after Crossover, with the backstretch dropping
//  into a TUNNEL beneath the esses (bridgeOverFirst true, bridgeStyle
//  'tunnel': you are on top through the esses, and three corners later you
//  are the traffic underneath), crossing at 70 degrees.
//
//  THE ESSES are six alternating 100-degree corners at r120, and their depth
//  is a designed threshold, found by measuring rather than luck. The road
//  swings 65px either side of its mean line. The AI racing line's sideways
//  budget is 46px, so the OPTIMISED line cannot straighten them - measured,
//  it slaloms at the road's own radius, flat to the stops at every apex. The
//  PLAYER's budget is the half-road minus half a car plus the kerb: 60 - 7 +
//  16 = 69px. So the straight line through the esses exists, only over the
//  kerbs, at full commitment, with 4px to spare: you can drive them straight
//  and the AI never will. Nicola chose this layout off the preview sheet,
//  and the chassis-parity brief the first draft was built to was dropped at
//  the same moment - this circuit is allowed to prefer whoever it prefers.
//
//  A figure of eight turns through ZERO net degrees, not 360, so its corner
//  angles must cancel - the design tool balances them by computing the Last
//  Curve's sweep as whatever brings the sum home. It also splits handedness
//  almost evenly by construction, which is why this circuit, like Crossover,
//  is not in the mirror list and owes the ring fingers nothing.
//
//  Drawn, searched and checked by /root/tools/design_suzuka.js: closure to
//  the pixel, EXACTLY one self-crossing, corridor separation 181px everywhere
//  the bridge approach is not (the rule stands down within 200px of the
//  crossing, where two roads converging is the whole idea). Edit that tool,
//  not these numbers.
class SuzukaTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2080;
        this.worldH = 2290;
        this.trackWidth = 60;
        this.grassWidth = 80;
        this.hasBridge = true;
        // The esses (earlier in the lap) are the road at GROUND level, and
        // the backstretch dives under them - see drawTunnel. It was the
        // other way round until Nicola pointed out the obvious: the deck
        // was sitting over the best corners on the circuit and you drove
        // them under a lid. The backstretch is still the road that changes
        // level, because it is the straight one where they meet; it just
        // goes down now instead of up. No segment moved, so every lap time
        // and record set on this circuit still stands.
        this.bridgeOverFirst = true;
        this.bridgeStyle = 'tunnel';

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 475, y2: 0 },
            { type: 'arc', cx: 475, cy: 170, r: 170, start: -1.5708, end: -0.41888, ccw: false },
            { type: 'arc', cx: 534.38, cy: 143.56, r: 105, start: -0.41888, end: 1.39626, ccw: false },
            { type: 'line', x1: 552.61, y1: 246.97, x2: 419.66, y2: 270.41 },
            { type: 'arc', cx: 440.5, cy: 388.59, r: 120, start: 4.53786, end: 2.79253, ccw: true },
            { type: 'line', x1: 327.74, y1: 429.63, x2: 343.47, y2: 472.85 },
            { type: 'arc', cx: 230.71, cy: 513.9, r: 120, start: -0.34907, end: 1.39626, ccw: false },
            { type: 'line', x1: 251.55, y1: 632.07, x2: 206.25, y2: 640.06 },
            { type: 'arc', cx: 227.08, cy: 758.24, r: 120, start: 4.53786, end: 2.79253, ccw: true },
            { type: 'line', x1: 114.32, y1: 799.28, x2: 130.05, y2: 842.51 },
            { type: 'arc', cx: 17.29, cy: 883.55, r: 120, start: -0.34907, end: 1.39626, ccw: false },
            { type: 'line', x1: 38.13, y1: 1001.73, x2: -7.17, y2: 1009.71 },
            { type: 'arc', cx: 13.66, cy: 1127.89, r: 120, start: 4.53786, end: 2.79253, ccw: true },
            { type: 'line', x1: -99.1, y1: 1168.93, x2: -83.37, y2: 1212.16 },
            { type: 'arc', cx: -196.13, cy: 1253.2, r: 120, start: -0.34907, end: 1.39626, ccw: false },
            { type: 'line', x1: -175.29, y1: 1371.38, x2: -254.08, y2: 1385.27 },
            { type: 'arc', cx: -233.24, cy: 1503.45, r: 120, start: 4.53786, end: 2.89725, ccw: true },
            { type: 'line', x1: -349.67, y1: 1532.48, x2: -330.32, y2: 1610.1 },
            { type: 'arc', cx: -409.88, cy: 1629.94, r: 82, start: -0.24435, end: 0.5236, ccw: false },
            { type: 'line', x1: -338.87, y1: 1670.94, x2: -353.87, y2: 1696.92 },
            { type: 'arc', cx: -416.22, cy: 1660.92, r: 72, start: 0.5236, end: 0.76794, ccw: false },
            { type: 'line', x1: -364.43, y1: 1710.94, x2: -557.5, y2: 1910.86 },
            { type: 'arc', cx: -643.82, cy: 1827.5, r: 120, start: 0.76794, end: 1.01229, ccw: false },
            { type: 'line', x1: -580.23, y1: 1929.27, x2: -631.11, y2: 1961.06 },
            { type: 'arc', cx: -595.08, cy: 2018.73, r: 68, start: 4.15388, end: 1.53589, ccw: true },
            { type: 'line', x1: -592.7, y1: 2086.69, x2: -432.8, y2: 2081.11 },
            { type: 'arc', cx: -439.78, cy: 1881.23, r: 200, start: 1.53589, end: 0.90757, ccw: true },
            { type: 'line', x1: -316.65, y1: 2038.83, x2: 187.68, y2: 1644.81 },
            { type: 'arc', cx: 126.11, cy: 1566, r: 100, start: 0.90757, end: 0.20944, ccw: true },
            { type: 'line', x1: 223.93, y1: 1586.8, x2: 250.96, y2: 1459.64 },
            { type: 'arc', cx: 164.88, cy: 1441.34, r: 88, start: 0.20944, end: -0.5236, ccw: true },
            { type: 'line', x1: 241.09, y1: 1397.34, x2: -261.41, y2: 526.98 },
            { type: 'arc', cx: -434.62, cy: 626.98, r: 200, start: -0.5236, end: -0.94248, ccw: true },
            { type: 'line', x1: -317.06, y1: 465.18, x2: -434.37, y2: 379.95 },
            { type: 'arc', cx: -403.8, cy: 337.88, r: 52, start: -4.08407, end: -2.89725, ccw: false },
            { type: 'line', x1: -454.26, y1: 325.3, x2: -443.13, y2: 280.67 },
            { type: 'arc', cx: -489.7, cy: 269.06, r: 48, start: 0.24435, end: -0.69813, ccw: true },
            { type: 'arc', cx: -341.86, cy: 145, r: 145, start: -3.83972, end: -1.5708, ccw: false },
            { type: 'line', x1: -341.86, y1: 0, x2: 0, y2: 0 }
        ];

        // 130px past the turtle origin: 596px of road behind the line (the
        // solved final straight plus the origin run) for a 12-car grid, and
        // 320px ahead before First Corner asks anything of anybody.
        this.startX = 130;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}


// =============================================================================
//  LUNGOLAGO, XL. The lake circuit.
//
//  A clockwise ring laid around a lake, and for half the lap the road IS the
//  shore. The reading: a 1200px pit straight into T1; the east side now
//  EARNS its speed - the terraces esse (two 32-degree lift-and-turns), the
//  330R sweep, then a flowing S right on the waterline - before the
//  south-east hook; the south run is a CAUSEWAY, lake past one wall, lagoon
//  past the other, with an esse flick at its exit; the south-west corner
//  opens the west climb, where the road walks out onto a HEADLAND and wraps
//  its tip through 144 degrees with water on three sides; a kink and a
//  70-degree last curve bring it home. 6244px, fifteen corners, 2950x1900.
//
//  Built by /root/tools/design_water.js - turtle construction, the last
//  curve computed from the turtle's actual heading, the run home solved to
//  close to the pixel. The water is BUILT FROM the road: shorelines are the
//  centreline offset 112px sideways, stitched with hand-set deep-water
//  anchors. The east esse and shore S were added on Nicola's call - the
//  first cut was a bolt monoculture (+4% on the aero) - so the fast side
//  now demands two real changes of direction. Edit that tool, not these
//  numbers.
// =============================================================================
class LungolagoTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2950;
        this.worldH = 1900;
        this.trackWidth = 60;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 620, y2: 0 },
            { type: 'arc', cx: 620, cy: 145, r: 145, start: -1.5708, end: -0.06981, ccw: false },
            { type: 'line', x1: 764.65, y1: 134.89, x2: 773.72, y2: 264.57 },
            { type: 'arc', cx: 983.2, cy: 249.92, r: 210, start: 3.07178, end: 2.51327, ccw: true },
            { type: 'line', x1: 813.31, y1: 373.35, x2: 860.33, y2: 438.08 },
            { type: 'arc', cx: 690.44, cy: 561.51, r: 210, start: -0.62832, end: -0.06981, ccw: false },
            { type: 'line', x1: 899.93, y1: 546.86, x2: 909, y2: 676.55 },
            { type: 'arc', cx: 579.8, cy: 699.57, r: 330, start: -0.06981, end: 0.38397, ccw: false },
            { type: 'line', x1: 885.77, y1: 823.19, x2: 840.82, y2: 934.45 },
            { type: 'arc', cx: 609.02, cy: 840.8, r: 250, start: 0.38397, end: 0.83776, ccw: false },
            { type: 'arc', cx: 943.59, cy: 1212.37, r: 250, start: 3.97935, end: 3.52557, ccw: true },
            { type: 'line', x1: 711.79, y1: 1118.72, x2: 666.84, y2: 1229.98 },
            { type: 'arc', cx: 527.76, cy: 1173.79, r: 150, start: 0.38397, end: 1.5708, ccw: false },
            { type: 'line', x1: 527.76, y1: 1323.79, x2: 307.76, y2: 1323.79 },
            { type: 'line', x1: 307.76, y1: 1323.79, x2: -252.24, y2: 1323.79 },
            { type: 'arc', cx: -252.24, cy: 1493.79, r: 170, start: 4.71239, end: 3.63028, ccw: true },
            { type: 'line', x1: -402.34, y1: 1413.98, x2: -428.16, y2: 1462.54 },
            { type: 'arc', cx: -578.26, cy: 1382.73, r: 170, start: 0.48869, end: 1.5708, ccw: false },
            { type: 'line', x1: -578.26, y1: 1552.73, x2: -758.26, y2: 1552.73 },
            { type: 'arc', cx: -758.26, cy: 1432.73, r: 120, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: -878.26, y1: 1432.73, x2: -878.26, y2: 1292.73 },
            { type: 'arc', cx: -708.26, cy: 1292.73, r: 170, start: 3.14159, end: 4.39823, ccw: false },
            { type: 'line', x1: -760.8, y1: 1131.05, x2: -656.18, y2: 1097.06 },
            { type: 'arc', cx: -699.44, cy: 963.91, r: 140, start: 7.53982, end: 5.02655, ccw: true },
            { type: 'line', x1: -656.18, y1: 830.76, x2: -760.8, y2: 796.77 },
            { type: 'arc', cx: -708.26, cy: 635.09, r: 170, start: 1.88496, end: 3.14159, ccw: false },
            { type: 'line', x1: -878.26, y1: 635.09, x2: -878.26, y2: 590.09 },
            { type: 'arc', cx: -578.26, cy: 590.09, r: 300, start: 3.14159, end: 3.49066, ccw: false },
            { type: 'line', x1: -860.17, y1: 487.48, x2: -715.07, y2: 88.83 },
            { type: 'arc', cx: -588.21, cy: 135, r: 135, start: 3.49066, end: 4.71239, ccw: false },
            { type: 'line', x1: -588.21, y1: 0, x2: 0, y2: 0 }
        ];

        // 310px past the turtle origin: the solved straight runs in behind
        // the grid, and T1 is 310px ahead of pole.
        this.startX = 310;
        this.startY = 0;

        // Water and boats live in the same frame as the segments and are
        // translated with them after centreInArena has decided the offset.
        // m: true = moored, drawn without a wake.
        this.water = [
            [{x:797,y:682},{x:798,y:693},{x:798,y:702},{x:797,y:711},{x:797,y:720},{x:796,y:729},{x:794,y:738},{x:793,y:747},{x:790,y:756},{x:788,y:764},{x:785,y:773},{x:781,y:782},{x:777,y:794},{x:772,y:806},{x:767,y:818},{x:762,y:831},{x:757,y:843},{x:752,y:855},{x:747,y:868},{x:742,y:880},{x:737,y:891},{x:734,y:899},{x:731,y:905},{x:728,y:911},{x:724,y:917},{x:720,y:923},{x:716,y:928},{x:711,y:934},{x:706,y:939},{x:699,y:945},{x:688,y:956},{x:676,y:969},{x:664,y:983},{x:652,y:997},{x:642,y:1012},{x:632,y:1028},{x:623,y:1044},{x:615,y:1060},{x:608,y:1075},{x:603,y:1089},{x:598,y:1101},{x:593,y:1114},{x:588,y:1126},{x:583,y:1139},{x:578,y:1151},{x:573,y:1163},{x:568,y:1176},{x:564,y:1186},{x:562,y:1191},{x:560,y:1194},{x:558,y:1197},{x:556,y:1200},{x:553,y:1202},{x:550,y:1204},{x:548,y:1206},{x:545,y:1208},{x:541,y:1209},{x:538,y:1210},{x:535,y:1211},{x:531,y:1212},{x:525,y:1212},{x:514,y:1212},{x:500,y:1212},{x:487,y:1212},{x:473,y:1212},{x:459,y:1212},{x:445,y:1212},{x:432,y:1212},{x:418,y:1212},{x:404,y:1212},{x:390,y:1212},{x:377,y:1212},{x:363,y:1212},{x:349,y:1212},{x:335,y:1212},{x:322,y:1212},{x:308,y:1212},{x:294,y:1212},{x:280,y:1212},{x:266,y:1212},{x:252,y:1212},{x:238,y:1212},{x:224,y:1212},{x:210,y:1212},{x:196,y:1212},{x:182,y:1212},{x:168,y:1212},{x:154,y:1212},{x:140,y:1212},{x:126,y:1212},{x:112,y:1212},{x:98,y:1212},{x:84,y:1212},{x:70,y:1212},{x:56,y:1212},{x:42,y:1212},{x:28,y:1212},{x:14,y:1212},{x:0,y:1212},{x:-14,y:1212},{x:-28,y:1212},{x:-42,y:1212},{x:-56,y:1212},{x:-70,y:1212},{x:-84,y:1212},{x:-98,y:1212},{x:-112,y:1212},{x:-126,y:1212},{x:-140,y:1212},{x:-154,y:1212},{x:-168,y:1212},{x:-182,y:1212},{x:-196,y:1212},{x:-210,y:1212},{x:-224,y:1212},{x:-238,y:1212},{x:-520,y:1265},{x:-766,y:1297},{x:-766,y:1288},{x:-766,y:1284},{x:-765,y:1279},{x:-763,y:1275},{x:-762,y:1271},{x:-760,y:1266},{x:-758,y:1262},{x:-755,y:1259},{x:-752,y:1255},{x:-749,y:1252},{x:-746,y:1249},{x:-742,y:1246},{x:-739,y:1243},{x:-735,y:1241},{x:-730,y:1239},{x:-724,y:1237},{x:-713,y:1233},{x:-700,y:1229},{x:-687,y:1225},{x:-674,y:1221},{x:-661,y:1216},{x:-648,y:1212},{x:-635,y:1208},{x:-619,y:1203},{x:-599,y:1195},{x:-577,y:1184},{x:-556,y:1171},{x:-537,y:1157},{x:-519,y:1140},{x:-503,y:1122},{x:-489,y:1102},{x:-476,y:1081},{x:-466,y:1059},{x:-458,y:1036},{x:-452,y:1012},{x:-449,y:988},{x:-447,y:964},{x:-449,y:940},{x:-452,y:915},{x:-458,y:892},{x:-466,y:869},{x:-476,y:847},{x:-489,y:826},{x:-503,y:806},{x:-519,y:788},{x:-537,y:771},{x:-556,y:757},{x:-577,y:744},{x:-599,y:733},{x:-619,y:725},{x:-635,y:720},{x:-648,y:716},{x:-661,y:711},{x:-674,y:707},{x:-687,y:703},{x:-700,y:699},{x:-713,y:695},{x:-724,y:691},{x:-730,y:689},{x:-735,y:687},{x:-739,y:685},{x:-742,y:682},{x:-746,y:679},{x:-749,y:676},{x:-752,y:673},{x:-755,y:669},{x:-758,y:665},{x:-760,y:661},{x:-762,y:657},{x:-763,y:653},{x:-765,y:649},{x:-766,y:644},{x:-767,y:635},{x:-660,y:520},{x:-240,y:430},{x:300,y:470},{x:640,y:560}],
            [{x:528,y:1436},{x:514,y:1436},{x:500,y:1436},{x:487,y:1436},{x:473,y:1436},{x:459,y:1436},{x:445,y:1436},{x:432,y:1436},{x:418,y:1436},{x:404,y:1436},{x:390,y:1436},{x:377,y:1436},{x:363,y:1436},{x:349,y:1436},{x:335,y:1436},{x:322,y:1436},{x:308,y:1436},{x:294,y:1436},{x:280,y:1436},{x:266,y:1436},{x:252,y:1436},{x:238,y:1436},{x:224,y:1436},{x:210,y:1436},{x:196,y:1436},{x:182,y:1436},{x:168,y:1436},{x:154,y:1436},{x:140,y:1436},{x:126,y:1436},{x:112,y:1436},{x:98,y:1436},{x:84,y:1436},{x:70,y:1436},{x:56,y:1436},{x:42,y:1436},{x:28,y:1436},{x:14,y:1436},{x:0,y:1436},{x:-14,y:1436},{x:-28,y:1436},{x:-42,y:1436},{x:-56,y:1436},{x:-70,y:1436},{x:-84,y:1436},{x:-98,y:1436},{x:-112,y:1436},{x:-126,y:1436},{x:-140,y:1436},{x:-154,y:1436},{x:-168,y:1436},{x:-182,y:1436},{x:-196,y:1436},{x:-210,y:1436},{x:-224,y:1436},{x:-238,y:1436},{x:-300,y:1560},{x:40,y:1660},{x:380,y:1580},{x:470,y:1450}]
        ];
        this.boats = [
            { x: 160, y: 760, a: 0.5 }, { x: 430, y: 640, a: 2.2 },
            { x: -180, y: 620, a: 4.1 }, { x: 170, y: 1500, a: 1.1, m: true }
        ];

        this.waypoints = this.generateWaypoints();
        const o = this.fitOffset || { x: 0, y: 0 };
        for (const poly of this.water) for (const p of poly) { p.x += o.x; p.y += o.y; }
        for (const b of this.boats) { b.x += o.x; b.y += o.y; }
    }
}

// =============================================================================
//  RIVIERA, XL. The sea circuit - and the calendar's left-handed XL.
//
//  Anticlockwise, the sea the whole length of the south side: the pit
//  straight is a 1750px SEA-FRONT - the longest straight in the game - into
//  a heavy 148-degree left hairpin wrapped around a rocky cove, the lap's
//  big braking zone. The way home now works for a living: a climbing esse
//  out of the hairpin, the old-town pair, the dip around the MARINA and its
//  moored boats, a chicane off the flat-out kink, and a harbour esse feeding
//  the last corner onto the sea again. 5215px, fifteen corners, 3150x1550.
//
//  Built by /root/tools/design_water.js, same discipline as Lungolago. The
//  climbing esse, the chicane and the harbour esse were added on Nicola's
//  call - the first cut read +4.4% for the aero, a straight-line monoculture
//  - and the sea-front itself was left alone: its length IS the circuit's
//  identity. Edit that tool, not these numbers.
// =============================================================================
class RivieraTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 3150;
        this.worldH = 1550;
        this.trackWidth = 62;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 1750, y2: 0 },
            { type: 'arc', cx: 1750, cy: -85, r: 85, start: 1.5708, end: -1.01229, ccw: true },
            { type: 'line', x1: 1795.04, y1: -157.08, x2: 1701.76, y2: -215.38 },
            { type: 'arc', cx: 1765.35, cy: -317.14, r: 120, start: -4.15388, end: -3.36849, ccw: false },
            { type: 'line', x1: 1648.42, y1: -290.15, x2: 1632.68, y2: -358.35 },
            { type: 'arc', cx: 1515.75, cy: -331.36, r: 120, start: -0.22689, end: -1.01229, ccw: true },
            { type: 'line', x1: 1579.34, y1: -433.12, x2: 1486.06, y2: -491.42 },
            { type: 'arc', cx: 1565.55, cy: -618.62, r: 150, start: -4.15388, end: -3.49066, ccw: false },
            { type: 'line', x1: 1424.59, y1: -567.32, x2: 1363.03, y2: -736.46 },
            { type: 'arc', cx: 1259.66, cy: -698.84, r: 110, start: -0.34907, end: -1.5708, ccw: true },
            { type: 'line', x1: 1259.66, y1: -808.84, x2: 1179.66, y2: -808.84 },
            { type: 'arc', cx: 1179.66, cy: -668.84, r: 140, start: -1.5708, end: -2.40855, ccw: true },
            { type: 'line', x1: 1075.62, y1: -762.52, x2: 988.63, y2: -665.91 },
            { type: 'arc', cx: 899.46, cy: -746.21, r: 120, start: -5.55015, end: -3.87463, ccw: false },
            { type: 'line', x1: 810.28, y1: -665.91, x2: 770.13, y2: -710.5 },
            { type: 'arc', cx: 666.09, cy: -616.82, r: 140, start: -0.73304, end: -1.5708, ccw: true },
            { type: 'line', x1: 666.09, y1: -756.82, x2: 606.09, y2: -756.82 },
            { type: 'arc', cx: 606.09, cy: -1176.82, r: 420, start: -4.71239, end: -4.36332, ccw: false },
            { type: 'arc', cx: 424.82, cy: -678.78, r: 110, start: -1.22173, end: -1.91986, ccw: true },
            { type: 'line', x1: 387.2, y1: -782.15, x2: 335.52, y2: -763.34 },
            { type: 'arc', cx: 297.89, cy: -866.71, r: 110, start: -5.06145, end: -4.36332, ccw: false },
            { type: 'line', x1: 260.27, y1: -763.34, x2: 82.33, y2: -828.1 },
            { type: 'arc', cx: 34.45, cy: -696.55, r: 140, start: -1.22173, end: -3.14159, ccw: true },
            { type: 'line', x1: -105.55, y1: -696.55, x2: -105.55, y2: -295.39 },
            { type: 'arc', cx: -235.55, cy: -295.39, r: 130, start: -6.28319, end: -5.68977, ccw: false },
            { type: 'arc', cx: -20, cy: -150, r: 130, start: -2.54818, end: -3.14159, ccw: true },
            { type: 'arc', cx: 0, cy: -150, r: 150, start: -3.14159, end: -4.71239, ccw: true }
        ];

        // 420px past the origin: room for the whole grid on the sea-front
        // with the west corner well behind it.
        this.startX = 420;
        this.startY = 0;

        this.water = [
            [{x:-1400,y:112},{x:3600,y:112},{x:3600,y:2200},{x:-1400,y:2200}],
            [{x:1759,y:112},{x:1782,y:109},{x:1813,y:102},{x:1842,y:89},{x:1869,y:72},{x:1892,y:51},{x:1912,y:27},{x:1928,y:-1},{x:1939,y:-31},{x:1946,y:-62},{x:1947,y:-94},{x:1943,y:-125},{x:1934,y:-156},{x:1920,y:-184},{x:1902,y:-210},{x:1886,y:-227},{x:1965,y:-175},{x:2075,y:-20},{x:2075,y:380},{x:1760,y:640}],
            [{x:1001,y:-829},{x:993,y:-820},{x:984,y:-810},{x:975,y:-800},{x:967,y:-791},{x:958,y:-781},{x:949,y:-771},{x:940,y:-762},{x:932,y:-752},{x:923,y:-742},{x:916,y:-735},{x:913,y:-731},{x:911,y:-730},{x:909,y:-729},{x:907,y:-728},{x:905,y:-727},{x:903,y:-726},{x:901,y:-726},{x:898,y:-726},{x:896,y:-726},{x:894,y:-727},{x:892,y:-728},{x:890,y:-729},{x:888,y:-730},{x:886,y:-731},{x:883,y:-735},{x:877,y:-742},{x:869,y:-751},{x:861,y:-760},{x:852,y:-768},{x:870,y:-836}]
        ];
        this.boats = [
            { x: 420, y: 320, a: 0.15 }, { x: 1080, y: 440, a: 3.3 },
            { x: 1590, y: 270, a: 1.8 }, { x: 1965, y: 95, a: 2.6, m: true },
            { x: 880, y: -800, a: 1.60, m: true }, { x: 922, y: -806, a: 1.55, m: true },
            { x: 958, y: -800, a: 1.62, m: true }
        ];

        this.waypoints = this.generateWaypoints();
        const o = this.fitOffset || { x: 0, y: 0 };
        for (const poly of this.water) for (const p of poly) { p.x += o.x; p.y += o.y; }
        for (const b of this.boats) { b.x += o.x; b.y += o.y; }
    }
}


// =============================================================================
//  THE PLAIN TRIO - Onda, Dedalo, Vallone. No bridges, no water, no gimmicks:
//  three XLs that are nothing but road, asked to treat the four chassis
//  ROUGHLY alike (Nicola's brief: "grossomodo bilanciati" - no monocultures,
//  no decimal-chasing). The shared recipe, learned from Marathon (spread
//  0.5%, the calendar's most even circuit): plenty of MEDIUM corners,
//  straights that end before the engine settles the argument, and a little
//  of everything - slow stuff for the Aero and the Torque, fast sweeps for
//  the Ridge, enough full throttle that the Bolt is not ballast.
//
//  All three built by /root/tools/design_trio.js - same turtle discipline as
//  the other XLs, last curve computed from the actual heading, closure
//  solved to the pixel; Vallone's proportions were picked by a coarse grid
//  search over its lengths and angles after hand-tuning thrashed. Edit that
//  tool, not these numbers.
// =============================================================================

//  ONDA, XL. Anticlockwise - the calendar's third left-hander - and a rhythm
//  circuit: two trains of alternating medium sweeps (the waves), a
//  hairpin-ish anchor at the far end, one honest straight in the middle,
//  5300px of lap that never quite goes straight and never quite stops.
class OndaTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2800;
        this.worldH = 1980;
        this.trackWidth = 60;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 700, y2: 0 },
            { type: 'arc', cx: 700, cy: -130, r: 130, start: 1.5708, end: 0.08727, ccw: true },
            { type: 'line', x1: 829.51, y1: -118.67, x2: 846.94, y2: -317.91 },
            { type: 'arc', cx: 996.37, cy: -304.84, r: 150, start: -3.05433, end: -1.90241, ccw: false },
            { type: 'line', x1: 947.53, y1: -446.66, x2: 1004.26, y2: -466.2 },
            { type: 'arc', cx: 955.43, cy: -608.02, r: 150, start: 1.23918, end: 0.08727, ccw: true },
            { type: 'line', x1: 1104.86, y1: -594.95, x2: 1115.31, y2: -714.49 },
            { type: 'arc', cx: 1274.71, cy: -700.55, r: 160, start: -3.05433, end: -1.8326, ccw: false },
            { type: 'line', x1: 1233.29, y1: -855.1, x2: 1291.25, y2: -870.63 },
            { type: 'arc', cx: 1249.84, cy: -1025.18, r: 160, start: 1.309, end: 0.20944, ccw: true },
            { type: 'line', x1: 1406.34, y1: -991.91, x2: 1495.74, y2: -1412.51 },
            { type: 'arc', cx: 1409.67, cy: -1430.81, r: 88, start: 0.20944, end: -1.88496, ccw: true },
            { type: 'line', x1: 1382.47, y1: -1514.5, x2: 887.92, y2: -1353.81 },
            { type: 'arc', cx: 925.01, cy: -1239.69, r: 120, start: -1.88496, end: -3.10669, ccw: true },
            { type: 'line', x1: 805.08, y1: -1243.87, x2: 799.84, y2: -1093.97 },
            { type: 'arc', cx: 659.93, cy: -1098.85, r: 140, start: -6.24828, end: -5.06145, ccw: false },
            { type: 'line', x1: 707.81, y1: -967.29, x2: 651.43, y2: -946.77 },
            { type: 'arc', cx: 699.31, cy: -815.22, r: 140, start: -1.91986, end: -2.89725, ccw: true },
            { type: 'line', x1: 563.47, y1: -849.09, x2: 542.91, y2: -766.61 },
            { type: 'arc', cx: 348.85, cy: -815, r: 200, start: -6.03884, end: -4.99164, ccw: false },
            { type: 'line', x1: 403.98, y1: -622.74, x2: 355.91, y2: -608.96 },
            { type: 'line', x1: 355.91, y1: -608.96, x2: -31.35, y2: -497.92 },
            { type: 'arc', cx: 10, cy: -353.73, r: 150, start: -1.85005, end: -3.14159, ccw: true },
            { type: 'line', x1: -140, y1: -353.73, x2: -140, y2: -140 },
            { type: 'arc', cx: 0, cy: -140, r: 140, start: -3.14159, end: -4.71239, ccw: true }
        ];

        this.startX = 300;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}

//  DEDALO, XL. Clockwise and technical: switch-corners at club radii pinch
//  the east side twice, an esse breaks the west run home, and the breather
//  straight is the only rest anybody gets. 5255px.
class DedaloTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2400;
        this.worldH = 1800;
        this.trackWidth = 58;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 560, y2: 0 },
            { type: 'arc', cx: 560, cy: 135, r: 135, start: -1.5708, end: -0.03491, ccw: false },
            { type: 'line', x1: 694.92, y1: 130.29, x2: 700.15, y2: 280.2 },
            { type: 'arc', cx: 820.08, cy: 276.01, r: 120, start: 3.10669, end: 1.18682, ccw: true },
            { type: 'line', x1: 865.03, y1: 387.27, x2: 976.29, y2: 342.32 },
            { type: 'arc', cx: 1028.74, cy: 472.12, r: 140, start: -1.95477, end: -0.73304, ccw: false },
            { type: 'line', x1: 1132.78, y1: 378.45, x2: 1233.15, y2: 489.92 },
            { type: 'arc', cx: 1010.21, cy: 690.66, r: 300, start: -0.73304, end: 0, ccw: false },
            { type: 'line', x1: 1310.21, y1: 690.66, x2: 1310.21, y2: 1120.66 },
            { type: 'arc', cx: 1215.21, cy: 1120.66, r: 95, start: 0, end: 2.0944, ccw: false },
            { type: 'line', x1: 1167.71, y1: 1202.93, x2: 1063.78, y2: 1142.93 },
            { type: 'arc', cx: 998.78, cy: 1255.51, r: 130, start: 5.23599, end: 3.35103, ccw: true },
            { type: 'line', x1: 871.62, y1: 1228.48, x2: 850.83, y2: 1326.3 },
            { type: 'arc', cx: 733.45, cy: 1301.35, r: 120, start: 0.20944, end: 1.22173, ccw: false },
            { type: 'line', x1: 774.5, y1: 1414.11, x2: 671.13, y2: 1451.73 },
            { type: 'arc', cx: 565.1, cy: 1160.43, r: 310, start: 1.22173, end: 1.74533, ccw: false },
            { type: 'line', x1: 511.27, y1: 1465.72, x2: 393.1, y2: 1444.88 },
            { type: 'arc', cx: 448.66, cy: 1129.74, r: 320, start: 1.74533, end: 2.02458, ccw: false },
            { type: 'line', x1: 308.39, y1: 1417.36, x2: -23.14, y2: 1255.66 },
            { type: 'arc', cx: 38.23, cy: 1129.83, r: 140, start: 2.02458, end: 3.14159, ccw: false },
            { type: 'line', x1: -101.77, y1: 1129.83, x2: -101.77, y2: 330 },
            { type: 'arc', cx: -281.77, cy: 330, r: 180, start: 6.28319, end: 5.75959, ccw: true },
            { type: 'arc', cx: 30, cy: 150, r: 180, start: 2.61799, end: 3.14159, ccw: false },
            { type: 'arc', cx: 0, cy: 150, r: 150, start: 3.14159, end: 4.71239, ccw: false }
        ];

        this.startX = 290;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}

//  VALLONE, XL. Clockwise, the grand-prix mix: a proper braking T1 off the
//  long top straight, a fast falling valley side, the POCKET - a hairpin
//  loop pushed up into the infield, the lap's signature - a south-west
//  corner onto the climb, an esse on the way up, and the last curve home.
//  6399px. Its proportions came out of a grid search: the ones where both
//  solved straights close the lap AND the lap lands nearest 6400.
class ValloneTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2750;
        this.worldH = 1750;
        this.trackWidth = 62;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 600, y2: 0 },
            { type: 'arc', cx: 600, cy: 120, r: 120, start: -1.5708, end: -0.34907, ccw: false },
            { type: 'line', x1: 712.76, y1: 78.96, x2: 825.63, y2: 389.06 },
            { type: 'arc', cx: 628.29, cy: 460.88, r: 210, start: -0.34907, end: 0.41888, ccw: false },
            { type: 'line', x1: 820.14, y1: 546.3, x2: 689.98, y2: 838.63 },
            { type: 'arc', cx: 571.22, cy: 785.75, r: 130, start: 0.41888, end: 1.43117, ccw: false },
            { type: 'line', x1: 589.31, y1: 914.49, x2: 292.23, y2: 956.24 },
            { type: 'arc', cx: 281.8, cy: 881.97, r: 75, start: 1.43117, end: 3.7001, ccw: false },
            { type: 'line', x1: 218.19, y1: 842.23, x2: 398.37, y2: 553.89 },
            { type: 'arc', cx: 296.6, cy: 490.3, r: 120, start: 6.84169, end: 3.78736, ccw: true },
            { type: 'line', x1: 200.76, y1: 418.08, x2: -16.49, y2: 706.39 },
            { type: 'arc', cx: -104.34, cy: 640.19, r: 110, start: 0.64577, end: 2.14675, ccw: false },
            { type: 'line', x1: -164.25, y1: 732.44, x2: -399.08, y2: 579.94 },
            { type: 'arc', cx: -469.88, cy: 688.97, r: 130, start: 5.28835, end: 4.41568, ccw: true },
            { type: 'arc', cx: -545.9, cy: 440.33, r: 130, start: 1.27409, end: 2.14675, ccw: false },
            { type: 'line', x1: -616.7, y1: 549.36, x2: -667.02, y2: 516.68 },
            { type: 'arc', cx: -503.63, cy: 265.08, r: 300, start: 2.14675, end: 2.49582, ccw: false },
            { type: 'line', x1: -743.22, y1: 445.62, x2: -846.75, y2: 308.24 },
            { type: 'arc', cx: -734.94, cy: 223.98, r: 140, start: 2.49582, end: 4.71239, ccw: false },
            { type: 'line', x1: -734.94, y1: 83.98, x2: -203.91, y2: 83.98 },
            { type: 'arc', cx: -203.91, cy: -56.02, r: 140, start: 7.85398, end: 7.19076, ccw: true },
            { type: 'line', x1: -117.71, y1: 54.3, x2: -86.19, y2: 29.68 },
            { type: 'arc', cx: 0, cy: 140, r: 140, start: 4.04916, end: 4.71239, ccw: false }
        ];

        this.startX = 330;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}




// =============================================================================
//  PUZZLE, XL. Two leaves of the rosa camuna, and a real circuit around them.
//
//  The name came after the drawing: one leaf hangs OUT of the lap and the
//  other folds INTO the infield, which is precisely a jigsaw piece - a tab
//  on one side, a blank on the other.
//
//  This started as LOMBARDY - the Lombard emblem's five-petal rose taken
//  literally, tangency-perfect and, as Nicola put it after driving it, a
//  nightmare: no straight anywhere on the lap, five 238-degree loops back to
//  back, five hairpins in the notches, nowhere to settle. Faithful to the
//  flag, hostile to the driver.
//
//  So two petals were kept and everything else thrown away. What survives is
//  the LEAF: a reverse-curve neck in, a 210-degree carousel at r280 you can
//  lean on instead of fight, a neck back out. The sweeps are set so that
//  leaf = 2 x neck, which makes the whole excursion HEADING-NEUTRAL: the
//  road leaves the lap pointing one way and rejoins it pointing the same
//  way, so the leaf hangs off the side and the ring behind it stays a clean
//  ring. That is exactly what the five-petal version could not do - there,
//  every petal dragged the heading 130 degrees round and the lap folded over
//  itself.
//
//  On a clockwise ring an outward leaf always swings left of travel, so two
//  outward leaves would both have been right-handers. The second one hangs
//  INWARD instead, into the empty infield, which costs nothing and buys the
//  lap its opposite lock. Around them: a 840px pit straight, a real braking
//  corner at T1, a 740px bottom straight to have a run at, and four corners
//  at four different radii. 7.3km.
//
//  Built by /root/tools/design_puzzle.js. Edit that tool, not these numbers.
// =============================================================================
class PuzzleTrack extends SegmentedTrack {
    constructor() {
        super();
        this.worldW = 2220;
        this.worldH = 2020;
        this.trackWidth = 60;
        this.grassWidth = 80;

        this.segments = [
            { type: 'line', x1: 0, y1: 0, x2: 840, y2: 0 },
            { type: 'arc', cx: 840, cy: 160, r: 160, start: -1.5708, end: 0, ccw: false },
            { type: 'line', x1: 1000, y1: 160, x2: 1000, y2: 400 },
            { type: 'arc', cx: 1220, cy: 400, r: 220, start: 3.14159, end: 1.309, ccw: true },
            { type: 'arc', cx: 1349.41, cy: 882.96, r: 280, start: -1.8326, end: 1.8326, ccw: false },
            { type: 'arc', cx: 1220, cy: 1365.93, r: 220, start: 4.97419, end: 3.14159, ccw: true },
            { type: 'line', x1: 1000, y1: 1365.93, x2: 1000, y2: 1625.93 },
            { type: 'arc', cx: 830, cy: 1625.93, r: 170, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 830, y1: 1795.93, x2: 90, y2: 1795.93 },
            { type: 'arc', cx: 90, cy: 1555.93, r: 240, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: -150, y1: 1555.93, x2: -150, y2: 1305.93 },
            { type: 'arc', cx: 70, cy: 1305.93, r: 220, start: 3.14159, end: 4.97419, ccw: false },
            { type: 'arc', cx: 199.41, cy: 822.96, r: 280, start: 8.11578, end: 4.45059, ccw: true },
            { type: 'arc', cx: 70, cy: 340, r: 220, start: 1.309, end: 3.14159, ccw: false },
            { type: 'line', x1: -150, y1: 340, x2: -150, y2: 150 },
            { type: 'arc', cx: 0, cy: 150, r: 150, start: 3.14159, end: 4.71239, ccw: false }
        ];

        // 380px along the pit straight: the whole grid forms up behind the
        // line with the last corner well clear of the back row.
        this.startX = 380;
        this.startY = 0;

        this.waypoints = this.generateWaypoints();
    }
}
