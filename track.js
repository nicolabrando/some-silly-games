class OvalTrack {
    constructor() {
        this.leftCenter = { x: 300, y: 350 };
        this.rightCenter = { x: 700, y: 350 };
        this.radius = 160;
        
        this.trackWidth = 80;      // Half width of the asphalt
        this.grassWidth = 120;     // Half width to the barrier (includes track + grass)
        
        this.waypoints = this.generateWaypoints();
    }

    generateWaypoints() {
        const waypoints = [];
        const numArcPoints = 12;
        
        // Clockwise direction
        // Top straight
        waypoints.push({ x: this.leftCenter.x, y: this.leftCenter.y - this.radius });
        waypoints.push({ x: (this.leftCenter.x + this.rightCenter.x) / 2, y: this.leftCenter.y - this.radius });
        waypoints.push({ x: this.rightCenter.x, y: this.rightCenter.y - this.radius });

        // Right arc
        for (let i = 1; i <= numArcPoints; i++) {
            const angle = -Math.PI / 2 + (i * Math.PI) / numArcPoints;
            waypoints.push({
                x: this.rightCenter.x + this.radius * Math.cos(angle),
                y: this.rightCenter.y + this.radius * Math.sin(angle)
            });
        }

        // Bottom straight
        waypoints.push({ x: this.rightCenter.x, y: this.rightCenter.y + this.radius });
        waypoints.push({ x: (this.leftCenter.x + this.rightCenter.x) / 2, y: this.leftCenter.y + this.radius });
        waypoints.push({ x: this.leftCenter.x, y: this.leftCenter.y + this.radius });

        // Left arc
        for (let i = 1; i < numArcPoints; i++) {
            const angle = Math.PI / 2 + (i * Math.PI) / numArcPoints;
            waypoints.push({
                x: this.leftCenter.x + this.radius * Math.cos(angle),
                y: this.leftCenter.y + this.radius * Math.sin(angle)
            });
        }
        
        return waypoints;
    }

    getSurface(x, y) {
        let dist;
        if (x < this.leftCenter.x) {
            dist = Math.sqrt(Math.pow(x - this.leftCenter.x, 2) + Math.pow(y - this.leftCenter.y, 2)) - this.radius;
        } else if (x > this.rightCenter.x) {
            dist = Math.sqrt(Math.pow(x - this.rightCenter.x, 2) + Math.pow(y - this.rightCenter.y, 2)) - this.radius;
        } else {
            if (y < this.leftCenter.y) dist = y - (this.leftCenter.y - this.radius);
            else dist = y - (this.leftCenter.y + this.radius);
        }
        dist = Math.abs(dist);

        if (dist <= this.trackWidth) return 'track';
        return 'grass';
    }
    
    checkBarrierCollision(car) {
        let cx, cy;
        const x = car.x;
        const y = car.y;
        
        if (x < this.leftCenter.x) {
            cx = this.leftCenter.x; cy = this.leftCenter.y;
        } else if (x > this.rightCenter.x) {
            cx = this.rightCenter.x; cy = this.rightCenter.y;
        } else {
            cx = x; cy = this.leftCenter.y;
        }
        
        const dx = x - cx;
        const dy = y - cy;
        const currentRadius = Math.sqrt(dx*dx + dy*dy);
        
        // Boundaries (using 12 as car collision radius)
        const innerLimit = this.radius - this.grassWidth + 12;
        const outerLimit = this.radius + this.grassWidth - 12;
        
        let hit = false;
        let nx = dx / currentRadius;
        let ny = dy / currentRadius;
        
        if (currentRadius < innerLimit) {
            const push = innerLimit - currentRadius;
            car.x += nx * push;
            car.y += ny * push;
            hit = true;
        } else if (currentRadius > outerLimit) {
            const push = currentRadius - outerLimit;
            car.x -= nx * push;
            car.y -= ny * push;
            hit = true;
        }
        
        if (hit) {
            // Dampen velocity to prevent sliding along walls too fast
            car.velocity.x *= 0.8;
            car.velocity.y *= 0.8;
        }
    }

    draw(ctx) {
        // Draw Grass area (lighter green)
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        this.addCapsuleSubpath(ctx, this.leftCenter, this.rightCenter, this.radius + this.grassWidth);
        ctx.fill();

        // Outer barrier
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#d32f2f';
        ctx.stroke();

        // Inner barrier and grass
        ctx.fillStyle = '#2e7d32'; // dark grass inside
        ctx.beginPath();
        this.addCapsuleSubpath(ctx, this.leftCenter, this.rightCenter, this.radius - this.grassWidth);
        ctx.fill();
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#d32f2f';
        ctx.stroke();

        // Draw Asphalt
        ctx.fillStyle = '#555';
        ctx.beginPath();
        this.addCapsuleSubpath(ctx, this.leftCenter, this.rightCenter, this.radius + this.trackWidth); // Outer asphalt
        this.addCapsuleSubpath(ctx, this.leftCenter, this.rightCenter, this.radius - this.trackWidth, true); // Inner hole, CCW
        ctx.fill('evenodd');

        // Draw Start/Finish line
        this.drawStartLine(ctx);
    }

    addCapsuleSubpath(ctx, leftCenter, rightCenter, radius, ccw = false) {
        if (!ccw) {
            // Clockwise
            ctx.moveTo(leftCenter.x, leftCenter.y + radius); // bottom left
            ctx.arc(leftCenter.x, leftCenter.y, radius, Math.PI / 2, -Math.PI / 2, false); // left side
            ctx.lineTo(rightCenter.x, rightCenter.y - radius); // top right
            ctx.arc(rightCenter.x, rightCenter.y, radius, -Math.PI / 2, Math.PI / 2, false); // right side
            ctx.closePath(); // bottom right to bottom left
        } else {
            // Counter-clockwise
            ctx.moveTo(leftCenter.x, leftCenter.y - radius); // top left
            ctx.arc(leftCenter.x, leftCenter.y, radius, -Math.PI / 2, Math.PI / 2, true); // left side
            ctx.lineTo(rightCenter.x, rightCenter.y + radius); // bottom right
            ctx.arc(rightCenter.x, rightCenter.y, radius, Math.PI / 2, -Math.PI / 2, true); // right side
            ctx.closePath(); // top right to top left
        }
    }
    
    drawStartLine(ctx) {
        ctx.fillStyle = '#fff';
        const startX = (this.leftCenter.x + this.rightCenter.x) / 2;
        const startY = this.leftCenter.y - this.radius - this.trackWidth;
        const width = 10;
        const height = this.trackWidth * 2;
        
        // Draw checkered pattern
        for (let i = 0; i < height; i += 10) {
            for (let j = 0; j < width; j += 5) {
                if ((i / 10 + j / 5) % 2 === 0) {
                    ctx.fillRect(startX + j, startY + i, 5, 10);
                } else {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(startX + j, startY + i, 5, 10);
                    ctx.fillStyle = '#fff';
                }
            }
        }
    }
    
    // Generalized lap cross check for both tracks
    checkLapCross(prevX, prevY, currX, currY) {
        // Start line is on the top straight, going right
        const midX = (this.leftCenter.x + this.rightCenter.x) / 2;
        if (prevX < midX && currX >= midX && currY < this.leftCenter.y) {
            return true;
        }
        return false;
    }
}

class F1Track {
    constructor() {
        this.trackWidth = 50;      // Wider asphalt
        this.grassWidth = 70;      // Reduced to 70 so inner red barriers don't overlap with grass
        
        // Center line segments for F1 track (Spaced out and centered for 1000x700)
        this.segments = [
            { type: 'line', x1: 300, y1: 150, x2: 700, y2: 150 },
            { type: 'arc', cx: 700, cy: 337.5, r: 187.5, start: -Math.PI/2, end: Math.PI/2, ccw: false },
            { type: 'line', x1: 700, y1: 525, x2: 600, y2: 525 },
            { type: 'arc', cx: 600, cy: 450, r: 75, start: Math.PI/2, end: Math.PI, ccw: false },
            { type: 'line', x1: 525, y1: 450, x2: 525, y2: 375 },
            { type: 'arc', cx: 450, cy: 375, r: 75, start: 0, end: -Math.PI/2, ccw: true },
            { type: 'line', x1: 450, y1: 300, x2: 300, y2: 300 },
            { type: 'arc', cx: 300, cy: 225, r: 75, start: Math.PI/2, end: -Math.PI/2, ccw: false }
        ];
        
        this.waypoints = this.generateWaypoints();
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
                car.x -= (dx / len) * push;
                car.y -= (dy / len) * push;
                
                // Dampen velocity
                car.velocity.x *= 0.8;
                car.velocity.y *= 0.8;
            }
        }
    }
    
    checkLapCross(prevX, prevY, currX, currY) {
        // Start line is on the top straight, x=500, going right
        if (prevX < 500 && currX >= 500 && currY < 250) {
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
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Outer barrier red
        this.drawPath(ctx);
        ctx.lineWidth = this.grassWidth * 2 + 10;
        ctx.strokeStyle = '#d32f2f';
        ctx.stroke();
        
        // Grass (dark green)
        this.drawPath(ctx);
        ctx.lineWidth = this.grassWidth * 2;
        ctx.strokeStyle = '#2e7d32';
        ctx.stroke();
        
        // Track Asphalt
        this.drawPath(ctx);
        ctx.lineWidth = this.trackWidth * 2;
        ctx.strokeStyle = '#555';
        ctx.stroke();

        this.drawStartLine(ctx);
    }
    
    drawStartLine(ctx) {
        ctx.fillStyle = '#fff';
        const startX = 500;
        const startY = 150 - this.trackWidth;
        const width = 10;
        const height = this.trackWidth * 2;
        
        // Draw checkered pattern
        for (let i = 0; i < height; i += 10) {
            for (let j = 0; j < width; j += 5) {
                if ((i / 10 + j / 5) % 2 === 0) {
                    ctx.fillRect(startX + j, startY + i, 5, 10);
                } else {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(startX + j, startY + i, 5, 10);
                    ctx.fillStyle = '#fff';
                }
            }
        }
    }
}
