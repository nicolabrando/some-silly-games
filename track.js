class Track {
    constructor() {
        this.leftCenter = { x: 250, y: 300 };
        this.rightCenter = { x: 550, y: 300 };
        this.radius = 140;
        
        this.trackWidth = 60;      // Half width of the asphalt
        this.grassWidth = 100;     // Half width to the barrier (includes track + grass)
        
        this.waypoints = this.generateWaypoints();
    }

    generateWaypoints() {
        const waypoints = [];
        const numArcPoints = 12;
        
        // Clockwise direction
        // Top straight
        waypoints.push({ x: 250, y: 140 });
        waypoints.push({ x: 400, y: 140 });
        waypoints.push({ x: 550, y: 140 });

        // Right arc
        for (let i = 1; i <= numArcPoints; i++) {
            const angle = -Math.PI / 2 + (i * Math.PI) / numArcPoints;
            waypoints.push({
                x: this.rightCenter.x + this.radius * Math.cos(angle),
                y: this.rightCenter.y + this.radius * Math.sin(angle)
            });
        }

        // Bottom straight
        waypoints.push({ x: 550, y: 460 });
        waypoints.push({ x: 400, y: 460 });
        waypoints.push({ x: 250, y: 460 });

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
        const startX = 400;
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
}
