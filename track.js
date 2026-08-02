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
            }
        }
        
        return { dist: minDist, projX: bestProj.x, projY: bestProj.y };
    }

    getSurface(x, y) {
        const distData = this.getClosestPoint(x, y);
        if (distData.dist <= this.trackWidth) return 'track';
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
                
                car.takeDamage(0.5); // Increased barrier damage
                
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

    draw(ctx) {
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

        // 4. Track Asphalt (Dark Grey)
        this.drawPath(ctx);
        ctx.lineWidth = this.trackWidth * 2;
        ctx.strokeStyle = '#555';
        ctx.stroke();

        this.drawStartLine(ctx);
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
        const r = 180; // Scaled to look round and fit perfectly within 1000x700
        
        this.startX = 500;
        this.startY = cy - r;
        
        this.segments = [
            { type: 'line', x1: cx1, y1: cy - r, x2: cx2, y2: cy - r },
            { type: 'arc', cx: cx2, cy: cy, r: r, start: -Math.PI/2, end: Math.PI/2, ccw: false },
            { type: 'line', x1: cx2, y1: cy + r, x2: cx1, y2: cy + r },
            { type: 'arc', cx: cx1, cy: cy, r: r, start: Math.PI/2, end: -Math.PI/2, ccw: false }
        ];
        
        this.waypoints = this.generateWaypoints();
    }
}


class F1Track extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 60;
        this.grassWidth = 80;
        this.startX = 450;
        this.startY = 100;
        
        this.segments = [
            { type: 'line', x1: 250, y1: 100, x2: 650, y2: 100 },
            { type: 'arc', cx: 650, cy: 312.5, r: 212.5, start: -Math.PI/2, end: Math.PI/2, ccw: false },
            { type: 'line', x1: 650, y1: 525, x2: 550, y2: 525 },
            { type: 'arc', cx: 550, cy: 450, r: 75, start: Math.PI/2, end: Math.PI, ccw: false },
            { type: 'line', x1: 475, y1: 450, x2: 475, y2: 375 },
            { type: 'arc', cx: 400, cy: 375, r: 75, start: 0, end: -Math.PI/2, ccw: true },
            { type: 'line', x1: 400, y1: 300, x2: 250, y2: 300 },
            { type: 'arc', cx: 250, cy: 200, r: 100, start: Math.PI/2, end: -Math.PI/2, ccw: false }
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
        
        this.startX = 500;
        this.startY = cyTop + rBig;
        
        this.segments = [
            { type: 'arc', cx: cx1, cy: cy, r: rSmall, start: theta, end: 2 * Math.PI - theta, ccw: false },
            { type: 'arc', cx: 500, cy: cyTop, r: rBig, start: Math.PI - theta, end: theta, ccw: true },
            { type: 'arc', cx: cx2, cy: cy, r: rSmall, start: Math.PI + theta, end: Math.PI - theta, ccw: false },
            { type: 'arc', cx: 500, cy: cyBot, r: rBig, start: -theta, end: -Math.PI + theta, ccw: true }
        ];
        
        this.waypoints = this.generateWaypoints();
    }
}

class CircoMassimoTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 50;
        this.grassWidth = 70;
        
        const cx1 = 120; // Stretched to 120
        const cx2 = 880; // Stretched to 880
        const cy = 350;
        const r = 60;
        
        this.startX = 500;
        this.startY = cy - r;
        
        this.segments = [
            { type: 'line', x1: cx1, y1: cy - r, x2: cx2, y2: cy - r },
            { type: 'arc', cx: cx2, cy: cy, r: r, start: -Math.PI/2, end: Math.PI/2, ccw: false },
            { type: 'line', x1: cx2, y1: cy + r, x2: cx1, y2: cy + r },
            { type: 'arc', cx: cx1, cy: cy, r: r, start: Math.PI/2, end: -Math.PI/2, ccw: false }
        ];
        
        this.waypoints = this.generateWaypoints();
    }
    
    draw(ctx) {
        super.draw(ctx);
        
        // Draw the "spina" (central separation barrier)
        ctx.beginPath();
        ctx.moveTo(120, 350);
        ctx.lineTo(880, 350);
        ctx.lineWidth = 15;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#cccccc'; // Stone grey color for the barrier
        ctx.stroke();
        
        // Draw sand/dirt inside the spina area
        ctx.beginPath();
        ctx.moveTo(120, 350);
        ctx.lineTo(880, 350);
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#e0c090'; // Sand color
        ctx.stroke();
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
            { type: 'arc', cx: cx, cy: cy, r: r, start: -Math.PI/2, end: Math.PI/2, ccw: false },
            { type: 'arc', cx: cx, cy: cy, r: r, start: Math.PI/2, end: -Math.PI/2, ccw: false }
        ];
        
        this.startX = 500;
        this.startY = cy - r;
        
        this.waypoints = this.generateWaypoints();
    }
}

class SerpentTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 55;
        this.grassWidth = 75;
        
        this.segments = [
            { type: 'line', x1: 250, y1: 600, x2: 780, y2: 600 },
            { type: 'arc', cx: 780, cy: 480, r: 120, start: Math.PI/2, end: -Math.PI/2, ccw: true },
            { type: 'line', x1: 780, y1: 360, x2: 480, y2: 360 },
            { type: 'arc', cx: 480, cy: 270, r: 90, start: Math.PI/2, end: Math.PI, ccw: false },
            { type: 'line', x1: 390, y1: 270, x2: 390, y2: 180 },
            { type: 'arc', cx: 310, cy: 180, r: 80, start: 0, end: -Math.PI/2, ccw: true },
            { type: 'line', x1: 310, y1: 100, x2: 200, y2: 100 },
            { type: 'arc', cx: 200, cy: 180, r: 80, start: -Math.PI/2, end: -Math.PI, ccw: true },
            { type: 'line', x1: 120, y1: 180, x2: 120, y2: 470 },
            { type: 'arc', cx: 250, cy: 470, r: 130, start: Math.PI, end: Math.PI/2, ccw: true }
        ];
        
        this.startX = 500;
        this.startY = 600;
        
        this.waypoints = this.generateWaypoints();
    }
}

class ThunderTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 60;
        this.grassWidth = 80;
        
        this.segments = [
            { type: 'line', x1: 170, y1: 570, x2: 825, y2: 570 },
            { type: 'arc', cx: 825, cy: 480, r: 90, start: Math.PI/2, end: -Math.PI/2, ccw: true },
            { type: 'line', x1: 825, y1: 390, x2: 730, y2: 390 },
            { type: 'arc', cx: 730, cy: 270, r: 120, start: Math.PI/2, end: Math.PI, ccw: false },
            { type: 'line', x1: 610, y1: 270, x2: 610, y2: 200 },
            { type: 'arc', cx: 520, cy: 200, r: 90, start: 0, end: -Math.PI, ccw: true },
            { type: 'line', x1: 430, y1: 200, x2: 430, y2: 320 },
            { type: 'arc', cx: 350, cy: 320, r: 80, start: 0, end: Math.PI/2, ccw: false },
            { type: 'line', x1: 350, y1: 400, x2: 170, y2: 400 },
            { type: 'arc', cx: 170, cy: 485, r: 85, start: -Math.PI/2, end: -Math.PI * 1.5, ccw: true }
        ];
        
        this.startX = 500;
        this.startY = 570;
        
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
            { type: 'line', x1: L+r, y1: T, x2: R-r, y2: T },
            { type: 'arc', cx: R-r, cy: T+r, r: r, start: -Math.PI/2, end: 0, ccw: false },
            { type: 'line', x1: R, y1: T+r, x2: R, y2: B-r },
            { type: 'arc', cx: R-r, cy: B-r, r: r, start: 0, end: Math.PI/2, ccw: false },
            { type: 'line', x1: R-r, y1: B, x2: L+r, y2: B },
            { type: 'arc', cx: L+r, cy: B-r, r: r, start: Math.PI/2, end: Math.PI, ccw: false },
            { type: 'line', x1: L, y1: B-r, x2: L, y2: T+r },
            { type: 'arc', cx: L+r, cy: T+r, r: r, start: Math.PI, end: -Math.PI/2, ccw: false }
        ];
        
        this.startX = 500;
        this.startY = T;
        
        this.waypoints = this.generateWaypoints();
    }
}

class TriangleTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 90;
        
        this.segments = [
            { type: 'line', x1: 250.00, y1: 570.00, x2: 750.00, y2: 570.00 },
            { type: 'arc', cx: 750.00, cy: 500.00, r: 70, start: 1.5708, end: -0.7289, ccw: true },
            { type: 'line', x1: 802.22, y1: 453.38, x2: 552.22, y2: 173.38 },
            { type: 'arc', cx: 500.00, cy: 220.00, r: 70, start: -0.7289, end: -2.4127, ccw: true },
            { type: 'line', x1: 447.78, y1: 173.38, x2: 197.78, y2: 453.38 },
            { type: 'arc', cx: 250.00, cy: 500.00, r: 70, start: -2.4127, end: 1.5708, ccw: true }
        ];
        
        this.startX = 500;
        this.startY = 570;
        
        this.waypoints = this.generateWaypoints();
    }
}

class PettineTrack extends SegmentedTrack {
    constructor() {
        super();
        this.trackWidth = 70;
        this.grassWidth = 75; // reduced so curbs do not overwrite each other
        
        this.segments = [
            { type: 'line', x1: 150, y1: 150, x2: 800, y2: 150 },
            { type: 'arc', cx: 800, cy: 230, r: 80, start: -Math.PI/2, end: Math.PI/2, ccw: false },
            { type: 'arc', cx: 800, cy: 390, r: 80, start: -Math.PI/2, end: -Math.PI, ccw: true },
            { type: 'line', x1: 720, y1: 390, x2: 720, y2: 520 },
            { type: 'arc', cx: 640, cy: 520, r: 80, start: 0, end: Math.PI, ccw: false },
            { type: 'line', x1: 560, y1: 520, x2: 560, y2: 390 },
            { type: 'arc', cx: 480, cy: 390, r: 80, start: 0, end: -Math.PI, ccw: true },
            { type: 'line', x1: 400, y1: 390, x2: 400, y2: 520 },
            { type: 'arc', cx: 320, cy: 520, r: 80, start: 0, end: Math.PI, ccw: false },
            { type: 'line', x1: 240, y1: 520, x2: 240, y2: 390 },
            { type: 'arc', cx: 160, cy: 390, r: 80, start: 0, end: -Math.PI/2, ccw: true },
            { type: 'line', x1: 160, y1: 310, x2: 150, y2: 310 },
            { type: 'arc', cx: 150, cy: 230, r: 80, start: Math.PI/2, end: Math.PI*1.5, ccw: false }
        ];
        
        this.startX = 500;
        this.startY = 150;
        
        this.waypoints = this.generateWaypoints();
    }
}
