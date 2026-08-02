class AI {
    constructor(car, difficulty, skillVariation = null) {
        this.car = car;
        this.difficulty = difficulty; // 'easy', 'medium', 'hard'
        
        // Add random variation to make them unique (0.8x to 1.1x multiplier)
        this.skillVariation = skillVariation !== null ? skillVariation : (0.8 + (Math.random() * 0.3));
        
        // Configure difficulty parameters (Increased speeds for v5)
        if (this.difficulty === 'easy') {
            this.targetSpeed = 150 * this.skillVariation; // Slower for easy
            this.lookAheadDistance = 50;
            this.corneringPatience = 0.8;
            this.steeringSmoothness = 0.05;
        } else if (this.difficulty === 'medium') {
            this.targetSpeed = 500 * this.skillVariation; // Was hard, now medium
            this.lookAheadDistance = 150;
            this.corneringPatience = 0.1;
            this.steeringSmoothness = 0.3;
        } else {
            this.targetSpeed = 700 * this.skillVariation; // Extreme mode
            this.lookAheadDistance = 200;
            this.corneringPatience = 0.02;
            this.steeringSmoothness = 0.5; // Very snappy
        }
        
        // --- Unique Driving Styles ---
        if (this.car.driverName) {
            switch(this.car.driverName) {
                case 'Max Verstappen':
                    this.targetSpeed *= 1.1;
                    this.corneringPatience = 0.01; // Extremely late braking
                    this.steeringSmoothness = 0.6;
                    break;
                case 'Alain Prost':
                    this.steeringSmoothness = 0.1; // Very smooth
                    this.corneringPatience = 0.15; // Clean lines
                    this.pathOffset = { x: 0, y: 0 }; // Perfect racing line
                    break;
                case 'Ayrton Senna':
                    this.targetSpeed *= 1.05;
                    this.steeringSmoothness = 0.2;
                    // Will get bonus in rain via main.js
                    break;
                case 'Michael Schumacher':
                    this.targetSpeed *= 1.08;
                    this.corneringPatience = 0.05;
                    break;
                case 'Lewis Hamilton':
                    this.targetSpeed *= 1.05;
                    this.lookAheadDistance = 250; // Looks far ahead
                    break;
                case 'Fernando Alonso':
                    this.corneringPatience = 0.08;
                    this.steeringSmoothness = 0.4; // Aggressive steering
                    break;
            }
        }
        
        this.errorTimer = 0;
        this.isMakingError = false;
        
        // Random offset so AIs don't follow the exact same path
        this.pathOffset = {
            x: (Math.random() - 0.5) * 40,
            y: (Math.random() - 0.5) * 40
        };
        
        this.raceStarted = false;
        this.reactionTimer = 0;
        
        this.stuckTimer = 0;
        this.reverseTimer = 0;
    }
    
    startRace() {
        // Reaction time +50% compared to before
        this.reactionTimer = (0.15 + Math.random() * 0.25) * 1.5;
        this.car.reactionTime = this.reactionTimer;
    }
    
    update(track, dt) {
        // Reset inputs
        this.car.inputs = { up: false, down: false, left: false, right: false };
        
        // Use a default dt of 0.016 if not provided
        if (!dt) dt = 0.016;
        
        if (!this.raceStarted) {
            if (this.reactionTimer > 0) {
                this.reactionTimer -= dt;
                if (this.reactionTimer <= 0) {
                    this.raceStarted = true;
                } else {
                    return; // Wait for reaction
                }
            } else {
                return; // Haven't been told to start yet
            }
        }
        
        // Error logic
        this.errorTimer -= dt;
        if (this.errorTimer <= 0) {
            if (this.isMakingError) {
                this.isMakingError = false;
                this.errorTimer = 2 + Math.random() * 3; // Drive normally for 2-5 seconds
            } else {
                // Chance to make an error based on difficulty
                const errorChance = this.difficulty === 'easy' ? 0.4 : (this.difficulty === 'medium' ? 0.15 : 0.02);
                if (Math.random() < errorChance) {
                    this.isMakingError = true;
                    this.errorTimer = 0.2 + Math.random() * 0.5; // Make mistake for 0.2 to 0.7 seconds
                } else {
                    this.errorTimer = 1.0; // Check again in 1 second
                }
            }
        }
        
        // 1. Find the closest waypoint to the car (Track progress)
        let closestDist = Infinity;
        let closestIndex = 0;
        for (let i = 0; i < track.waypoints.length; i++) {
            const wp = track.waypoints[i];
            const d2 = (this.car.x - wp.x)**2 + (this.car.y - wp.y)**2;
            if (d2 < closestDist) {
                closestDist = d2;
                closestIndex = i;
            }
        }
        
        // 2. Dynamic Lookahead based on speed and stats
        const speed = Math.sqrt(this.car.velocity.x**2 + this.car.velocity.y**2);
        
        let lookAheadPoints = Math.floor(this.lookAheadDistance / 20) + Math.floor(speed / 100);
        if (lookAheadPoints < 2) lookAheadPoints = 2; // Always look at least a bit ahead
        if (lookAheadPoints > 15) lookAheadPoints = 15;
        
        let targetIndex = (closestIndex + lookAheadPoints) % track.waypoints.length;
        let targetWP = track.waypoints[targetIndex];
        
        // Calculate angle to target with path offset
        const dx = (targetWP.x + this.pathOffset.x) - this.car.x;
        const dy = (targetWP.y + this.pathOffset.y) - this.car.y;
        let angleToTarget = Math.atan2(dy, dx);
        
        // --- Collision Avoidance ---
        let avoidX = 0;
        let avoidY = 0;
        let nearbyAvoids = 0;
        
        if (typeof cars !== 'undefined') {
            for (const otherCar of cars) {
                if (otherCar === this.car || otherCar.isBroken) continue;
                
                const distToOther = Math.sqrt((this.car.x - otherCar.x)**2 + (this.car.y - otherCar.y)**2);
                const avoidRadius = 70; // Start avoiding if within 70 pixels
                
                if (distToOther < avoidRadius && distToOther > 0.1) {
                    const isDraftingOther = this.car.isDrafting; 
                    const repulsionStrength = isDraftingOther ? 1.5 : (1.0 - (distToOther / avoidRadius));
                    
                    let pushX = (this.car.x - otherCar.x) / distToOther;
                    let pushY = (this.car.y - otherCar.y) / distToOther;
                    
                    // If drafting, swerve laterally relative to heading
                    if (isDraftingOther) {
                        const headingX = Math.cos(this.car.angle);
                        const headingY = Math.sin(this.car.angle);
                        const side = this.pathOffset.x > 0 ? 1 : -1;
                        pushX = -headingY * side;
                        pushY = headingX * side;
                    }
                    
                    avoidX += pushX * repulsionStrength;
                    avoidY += pushY * repulsionStrength;
                    nearbyAvoids++;
                }
            }
        }
        
        // --- Barrier & Grass Avoidance ---
        let targetSpeedMultiplier = 1.0;
        if (track && track.getClosestPoint) {
            const distData = track.getClosestPoint(this.car.x, this.car.y);
            const distToCenter = distData.dist;
            
            // If on grass or very close to wall, slow down drastically and steer to center
            if (distToCenter > track.trackWidth * 0.7) {
                targetSpeedMultiplier = 0.4; // Slow down to regain control
                const dxCenter = distData.projX - this.car.x;
                const dyCenter = distData.projY - this.car.y;
                const lenCenter = Math.hypot(dxCenter, dyCenter);
                if (lenCenter > 0.1) {
                    avoidX += (dxCenter / lenCenter) * 3.0; // Strong push to center
                    avoidY += (dyCenter / lenCenter) * 3.0;
                    nearbyAvoids++;
                }
            } else {
                // Normal barrier avoidance
                const distToBarrier = track.grassWidth - distData.dist;
                const barrierAvoidRadius = 35;
                if (distToBarrier < barrierAvoidRadius) {
                    const repulsionStrength = 1.0 - (Math.max(0, distToBarrier) / barrierAvoidRadius);
                    const dxCenter = distData.projX - this.car.x;
                    const dyCenter = distData.projY - this.car.y;
                    const lenCenter = Math.hypot(dxCenter, dyCenter);
                    if (lenCenter > 0.1) {
                        avoidX += (dxCenter / lenCenter) * repulsionStrength * 2.5;
                        avoidY += (dyCenter / lenCenter) * repulsionStrength * 2.5;
                        nearbyAvoids++;
                    }
                }
            }
        }
        
        if (nearbyAvoids > 0) {
            // Blend the avoidance vector into the target direction
            const blendFactor = Math.min(0.9, nearbyAvoids * 0.4); 
            const targetDirX = Math.cos(angleToTarget);
            const targetDirY = Math.sin(angleToTarget);
            
            const finalDirX = targetDirX * (1 - blendFactor) + avoidX * blendFactor;
            const finalDirY = targetDirY * (1 - blendFactor) + avoidY * blendFactor;
            
            angleToTarget = Math.atan2(finalDirY, finalDirX);
        }
        
        if (this.isMakingError) {
            angleToTarget += 0.5 * (Math.random() > 0.5 ? 1 : -1);
        }
        
        // Normalize angle difference to [-PI, PI]
        let angleDiff = angleToTarget - this.car.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        let target = this.targetSpeed * targetSpeedMultiplier;
        if (this.isMakingError) {
             target *= 1.2; // Accelerate when shouldn't!
        }
        
        // --- Intelligent Wrong-Way Recovery (K-Turn) ---
        if (Math.abs(angleDiff) > Math.PI / 2) { // More than 90 degrees wrong way
            if (speed > 40) {
                // Going too fast the wrong way, slam the brakes
                this.car.inputs.down = true;
                this.car.inputs.up = false;
                if (angleDiff > 0) this.car.inputs.right = true;
                else this.car.inputs.left = true;
            } else {
                // Stopped or slow: K-Turn
                this.car.inputs.up = false;
                this.car.inputs.down = true; // Reverse
                // When reversing, steering left swings the nose to the right relative to the world
                if (angleDiff > 0) {
                    this.car.inputs.left = true;
                } else {
                    this.car.inputs.right = true;
                }
            }
            this.stuckTimer = 0; // Reset stuck timer while recovering
            return;
        }
        
        // --- Stuck Detection (Forward) ---
        if (this.stuckTimer > 1.0) {
            // We are currently reversing to get unstuck from a wall
            this.stuckTimer += dt;
            this.car.inputs.up = false;
            this.car.inputs.down = true; // Reverse
            
            // Steer arbitrarily to dislodge
            this.car.inputs.left = (this.pathOffset.x > 0);
            this.car.inputs.right = !this.car.inputs.left;
            
            if (this.stuckTimer > 1.8) {
                this.stuckTimer = 0; // Done reversing
            }
            return;
        }
        
        // --- Normal Driving ---
        // Steering
        if (angleDiff > this.steeringSmoothness) {
            this.car.inputs.right = true;
        } else if (angleDiff < -this.steeringSmoothness) {
            this.car.inputs.left = true;
        }
        
        // Speed control
        if (Math.abs(angleDiff) > this.corneringPatience && speed > target * 0.5) {
            this.car.inputs.down = true; // brake
        } else if (speed < target) {
            this.car.inputs.up = true; // throttle
        }
        
        // Update stuck timer if we are trying to go forward but stuck
        if (this.car.inputs.up && speed < 30) {
            this.stuckTimer += dt;
        } else {
            this.stuckTimer = Math.max(0, this.stuckTimer - dt);
        }
    }
}
