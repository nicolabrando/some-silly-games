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
        
        const cx1 = 150;
        const cx2 = 850;
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
