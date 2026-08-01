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
        
        this.errorTimer = 0;
        this.isMakingError = false;
        
        // Random offset so AIs don't follow the exact same path
        this.pathOffset = {
            x: (Math.random() - 0.5) * 40,
            y: (Math.random() - 0.5) * 40
        };
        
        this.raceStarted = false;
        this.reactionTimer = 0;
    }
    
    startRace() {
        // Reaction time +50% compared to before
        this.reactionTimer = (0.15 + Math.random() * 0.25) * 1.5;
        this.car.reactionTime = this.reactionTimer;
    }
    
    update(track, dt) {
        // Reset inputs
        this.car.inputs = { up: false, down: false, left: false, right: false };
        
        // Use a default dt of 0.016 if not provided (when called from updatePhysics, dt is passed to car.update, but ai.update needs it too)
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
        
        // Find next waypoint to target
        let targetIndex = this.car.nextWaypoint;
        let targetWP = track.waypoints[targetIndex];
        
        // If we are close to the target, look ahead to the next one for smoother steering
        const distToCurrent = Math.sqrt((this.car.x - targetWP.x)**2 + (this.car.y - targetWP.y)**2);
        if (distToCurrent < this.lookAheadDistance) {
             targetIndex = (targetIndex + 1) % track.waypoints.length;
             targetWP = track.waypoints[targetIndex];
        }
        
        // Calculate angle to target with path offset
        const dx = (targetWP.x + this.pathOffset.x) - this.car.x;
        const dy = (targetWP.y + this.pathOffset.y) - this.car.y;
        let angleToTarget = Math.atan2(dy, dx);
        
        if (this.isMakingError) {
            // Steer in slightly the wrong direction
            angleToTarget += 0.5 * (Math.random() > 0.5 ? 1 : -1);
        }
        
        // Normalize angle difference to [-PI, PI]
        let angleDiff = angleToTarget - this.car.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        // Steering
        if (angleDiff > this.steeringSmoothness) {
            this.car.inputs.right = true;
        } else if (angleDiff < -this.steeringSmoothness) {
            this.car.inputs.left = true;
        }
        
        // Speed control
        const speed = Math.sqrt(this.car.velocity.x**2 + this.car.velocity.y**2);
        
        let target = this.targetSpeed;
        if (this.isMakingError) {
             target *= 1.2; // Accelerate when shouldn't!
        }
        
        // If angle difference is large, we need to brake or coast
        if (Math.abs(angleDiff) > this.corneringPatience && speed > target * 0.5) {
            this.car.inputs.down = true; // brake
        } else if (speed < target) {
            this.car.inputs.up = true; // throttle
        }
    }
}
