// The world these circuits are laid out in. 16:9, so a modern screen is
// filled rather than letterboxed. main.js has the same pair.
const TRACK_W = 1280;
const TRACK_H = 720;

// The timing tower and the driver's readouts share one column down the left,
// so the racing surface starts here and not at zero. Everything to the right
// of it - the full height - is circuit. main.js has the same number.
const TRACK_X0 = 210;

// Number of radii around a puddle's outline. Enough to look organic,
// few enough that the per-frame containment test stays trivial.
const PUDDLE_LOBES = 11;

class SegmentedTrack {
    constructor() {
        // To be overridden by subclasses
        this.trackWidth = 75;
        this.grassWidth = 95;
        this.segments = [];
        this.startX = 500;
        this.startY = 150;
    }

    generateWaypoints() {
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

    // Width of the kerb band lining the inside of the corners.
    get kerbWidth() {
        return Math.min(26, Math.max(14, this.trackWidth * 0.30));
    }

    // How much of it actually fits on a given corner. On a hairpin whose
    // radius is barely wider than the track there is almost no inside run-off,
    // so the kerb is whatever will fit - possibly nothing at all.
    kerbWidthFor(seg) {
        if (!seg || seg.type !== 'arc') return 0;
        return Math.min(this.kerbWidth, Math.max(0, seg.r - this.trackWidth - 2));
    }

    getSurface(x, y) {
        const distData = this.getClosestPoint(x, y);
        if (distData.dist <= this.trackWidth) return 'track';

        // Kerbs exist only on the *inside* of a corner: the nearest piece of
        // geometry has to be an arc, and the point has to be on the side
        // towards the arc's centre. The outside of a corner and the whole of
        // every straight are grass.
        const seg = distData.seg;
        if (distData.segType === 'arc' && seg &&
            distData.dist <= this.trackWidth + this.kerbWidthFor(seg) &&
            Math.hypot(x - seg.cx, y - seg.cy) < seg.r) {
            return 'kerb';
        }
        return 'grass';
    }
    
    checkBarrierCollision(car) {
        const distData = this.getClosestPoint(car.x, car.y);
        const currentRadius = distData.dist;
        
        // Boundaries (using 12 as car collision radius)
        const maxAllowed = this.grassWidth - 12;
        
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
                const free = 60 + (car.isPlayer && typeof PLAYER_FREE_IMPACT !== 'undefined'
                    ? PLAYER_FREE_IMPACT : 0);
                if (intoWall > free) {
                    car.takeDamage(260 * Math.pow((intoWall - free) / 100, 2));
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

            // An irregular outline rather than a circle. PUDDLE_LOBES radii
            // around the centre, each randomly scaled, then smoothed with its
            // neighbours so the edge undulates instead of spiking. Water finds
            // the shape of the tarmac; a perfect disc reads as a decal.
            const raw = [];
            for (let k = 0; k < PUDDLE_LOBES; k++) raw.push(0.62 + Math.random() * 0.70);
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
        
        const dashLen = 100; // Increased length for better visibility

        
        // 1. Outer Barrier (Green segment)
        this.drawPath(ctx);
        ctx.lineWidth = this.grassWidth * 2 + 10;
        ctx.strokeStyle = '#009246'; // Distinct Italian Green
        ctx.setLineDash([dashLen, dashLen * 2]);
        ctx.lineDashOffset = 0;
        ctx.stroke();
        
        // 2. Outer Barrier (White segment)
        this.drawPath(ctx);
        ctx.strokeStyle = '#ffffff'; // White
        ctx.lineDashOffset = -dashLen;
        ctx.stroke();
        
        // 3. Outer Barrier (Red segment)
        this.drawPath(ctx);
        ctx.strokeStyle = '#d32f2f'; // Italian Red
        ctx.lineDashOffset = -dashLen * 2;
        ctx.stroke();
        
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        
        // 3. Grass Margin (Dark Green)
        this.drawPath(ctx);
        ctx.lineWidth = this.grassWidth * 2;
        ctx.strokeStyle = '#2e7d32';
        ctx.stroke();

        // 4. Kerbs on the inside of every corner (red / white).
        //    Drawn as a thin band hugging the inner edge of the asphalt, so
        //    nothing appears on the outside of the corner or on the straights.
        for (const seg of this.segments) {
            if (seg.type !== 'arc') continue;

            const kw = this.kerbWidthFor(seg);
            if (kw < 5) continue;               // hairpin with no inside run-off
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

        // 5. Track Asphalt (Dark Grey)
        this.drawPath(ctx);
        ctx.lineWidth = this.trackWidth * 2;
        ctx.strokeStyle = '#555';
        ctx.stroke();

        this.drawStartLine(ctx);
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

        // the wall itself: white with red blocks, like every other barrier
        // a driver is meant to keep away from
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.lineWidth = 11;
        ctx.strokeStyle = '#f5f5f5';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 + 8, y);
        ctx.lineTo(x2 - 8, y);
        ctx.lineWidth = 11;
        ctx.setLineDash([26, 26]);
        ctx.strokeStyle = '#d32f2f';
        ctx.stroke();
        ctx.setLineDash([]);

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
            { type: 'line', x1: 387.8, y1: 593.25, x2: 1096.8, y2: 593.55 },
            { type: 'arc', cx: 1096.8, cy: 496.35, r: 97.2, start: 1.5708, end: -1.5708, ccw: true },
            { type: 'line', x1: 1096.8, y1: 399.15, x2: 963.87, y2: 409.71 },
            { type: 'arc', cx: 963.87, cy: 280.11, r: 129.6, start: 1.5708, end: 3.14159, ccw: false },
            { type: 'line', x1: 834.27, y1: 280.11, x2: 867.57, y2: 223.65 },
            { type: 'arc', cx: 770.37, cy: 223.65, r: 97.2, start: 0, end: -3.14159, ccw: true },
            { type: 'line', x1: 673.17, y1: 223.65, x2: 691.96, y2: 332.08 },
            { type: 'arc', cx: 605.56, cy: 332.08, r: 86.4, start: 0, end: 1.5708, ccw: false },
            { type: 'line', x1: 605.56, y1: 418.48, x2: 387.8, y2: 409.65 },
            { type: 'arc', cx: 387.8, cy: 501.45, r: 91.8, start: -1.5708, end: -4.71239, ccw: true }
        ];
        
        this.startX = 704.4;
        this.startY = 593.38;
        
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

class PettineTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 75; // reduced so curbs do not overwrite each other
        
        this.segments = [
            { type: 'line', x1: 371, y1: 108.96, x2: 1119, y2: 108.96 },
            { type: 'arc', cx: 1119, cy: 188.96, r: 80, start: -1.5708, end: 1.5708, ccw: false },
            { type: 'arc', cx: 1119, cy: 348.96, r: 80, start: -1.5708, end: -3.14159, ccw: true },
            { type: 'line', x1: 1039, y1: 348.96, x2: 1039, y2: 531.04 },
            { type: 'arc', cx: 959, cy: 531.04, r: 80, start: 0, end: 3.14159, ccw: false },
            { type: 'line', x1: 879, y1: 531.04, x2: 879, y2: 368.8 },
            { type: 'arc', cx: 799, cy: 368.8, r: 80, start: 0, end: -3.14159, ccw: true },
            { type: 'line', x1: 719, y1: 368.8, x2: 719, y2: 531.04 },
            { type: 'arc', cx: 639, cy: 531.04, r: 80, start: 0, end: 3.14159, ccw: false },
            { type: 'line', x1: 559, y1: 531.04, x2: 559, y2: 348.96 },
            { type: 'arc', cx: 479, cy: 348.96, r: 80, start: 0, end: -1.5708, ccw: true },
            { type: 'line', x1: 479, y1: 268.96, x2: 371, y2: 268.96 },
            { type: 'arc', cx: 371, cy: 188.96, r: 80, start: 1.5708, end: 4.71239, ccw: false }
        ];
        
        this.startX = 703.74;
        this.startY = 108.96;
        
        this.waypoints = this.generateWaypoints();
    }
}
