class Car {
    constructor(x, y, color, isPlayer = false) {
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
        
        // Physics constants (Drift physics)
        this.enginePower = 300;
        this.brakingPower = 800;
        this.maxSteer = Math.PI * 0.7; // Very smooth steering
        this.baseGrip = 1200; // Lower grip to allow sliding
        this.baseFriction = 0.85; // Drag
        
        this.inputs = {
            up: false,
            down: false,
            left: false,
            right: false
        };
        
        // Race logic
        this.lap = 0;
        this.nextWaypoint = 1;
        this.finished = false;
        this.halfwayMarkerCrossed = false;
        
        this.raceTime = null;
        this.reactionTime = null;
        this.inputRecorded = false;
    }
    
    update(dt, track) {
        const surface = track.getSurface(this.x, this.y);
        
        // Adjust physics based on surface
        let currentGrip = this.baseGrip;
        let currentFriction = this.baseFriction;
        
        if (surface === 'grass') {
            currentGrip *= 0.3; // Slippery!
            currentFriction *= 2.5; // Slows you down!
        }
        
        if (this.finished || this.isBroken) {
            // Suspend commands, let it coast by inertia
            this.inputs.up = false;
            this.inputs.down = false;
            this.inputs.left = false;
            this.inputs.right = false;
        }
        
        // --- Longitudinal forces (Engine, Brakes) ---
        let forwardForce = 0;
        
        if (this.inputs.up) {
            forwardForce += this.enginePower;
        }
        if (this.inputs.down) {
            forwardForce -= this.brakingPower;
        }
        
        // --- Steering ---
        const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
        
        // Only steer if moving
        if (speed > 10) {
            // Steering less effective at very high speeds to simulate understeer
            // Harsher penalty to make cornering difficult at max speed
            const steerEffectiveness = Math.max(0.10, 1 - (speed / 500)); 
            const steerAmount = this.maxSteer * dt * steerEffectiveness;
            
            // Allow reversing steer direction if going backwards
            const dir = (this.velocity.x * Math.cos(this.angle) + this.velocity.y * Math.sin(this.angle) >= 0) ? 1 : -1;
            
            if (this.inputs.left) this.angle -= steerAmount * dir;
            if (this.inputs.right) this.angle += steerAmount * dir;
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
        
        // Desired lateral correction force to stop sliding
        let lateralForce = -lateralSpeed * 3.5; // Much softer alignment for drifting to make high speed cornering require braking
        
        // Clamp to grip limit
        if (lateralForce > currentGrip) lateralForce = currentGrip;
        if (lateralForce < -currentGrip) lateralForce = -currentGrip;
        
        // Apply lateral force
        this.velocity.x += rightX * lateralForce * dt;
        this.velocity.y += rightY * lateralForce * dt;
        
        // Apply friction/drag
        this.velocity.x -= this.velocity.x * currentFriction * dt;
        this.velocity.y -= this.velocity.y * currentFriction * dt;
        
        const previousX = this.x;
        
        // Update position
        this.x += this.velocity.x * dt;
        this.y += this.velocity.y * dt;
        
        // Enforce robust barrier collision
        track.checkBarrierCollision(this);
        
        // Update race progress
        this.checkWaypoints(track);
        
        // Ensure car goes around the track
        if (this.x > 650) {
            this.halfwayMarkerCrossed = true;
        }
        
        // Exact finish line crossing
        if (track.checkLapCross(previousX, this.y, this.x, this.y)) {
            if (this.halfwayMarkerCrossed) {
                this.lap++;
                this.halfwayMarkerCrossed = false;
                
                // If the car crosses the finish line and the leader has already finished,
                // OR if the car itself just completed the last lap.
                if (this.lap >= TOTAL_LAPS || (track.leaderFinished && this.lap > 0)) {
                    if (!this.finished) {
                        this.finished = true;
                        this.raceTime = track.currentRaceTime; // passed via track object for convenience
                        if (this.jumpStartPenalty) {
                            this.raceTime += 5000; // 5 seconds penalty
                        }
                    }
                }
            }
        }
    }
    
    checkWaypoints(track) {
        const wp = track.waypoints[this.nextWaypoint];
        const dist = Math.sqrt((this.x - wp.x)**2 + (this.y - wp.y)**2);
        
        // 200px radius for waypoint trigger to avoid missing them if driving wide
        if (dist < 200) {
            this.nextWaypoint = (this.nextWaypoint + 1) % track.waypoints.length;
        }
    }
    
    takeDamage(amount) {
        if (this.isBroken || this.finished) return;
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.isBroken = true;
        }
    }
    
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        
        // Car shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 2 + 2, this.width, this.height);
        
        // Car body
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 4);
        ctx.fill();
        
        // Windshield (front)
        ctx.fillStyle = '#000';
        ctx.beginPath();
        // Shift it a bit forward. Center is at 0. Front is at width/2.
        ctx.roundRect(this.width / 8, -this.height / 2 + 2, 6, this.height - 4, 1);
        ctx.fill();
        
        // Spoiler (back)
        ctx.fillStyle = '#111';
        ctx.beginPath();
        // placed at the very back (-width/2)
        ctx.roundRect(-this.width / 2, -this.height / 2 + 1, 4, this.height - 2, 1);
        ctx.fill();
        
        // Headlights
        ctx.fillStyle = '#ffffe0';
        ctx.beginPath();
        ctx.arc(this.width / 2, -this.height / 2 + 3, 2, 0, Math.PI * 2);
        ctx.arc(this.width / 2, this.height / 2 - 3, 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
        
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
