// =============================================================================
//  RACE LOG
// -----------------------------------------------------------------------------
//  A structured record of everything that happens in a session: lap times,
//  flags, contact, retirements, safety-car periods, the final classification.
//  Kept in memory for the whole browser session, viewable from the menu and
//  downloadable as a text file so a race can be picked apart after the fact.
//
//  Also mirrored to console.log, so it can be read live in the dev tools.
// =============================================================================

const RaceLog = {
    sessions: [],
    current: null,
    echoToConsole: true,
    maxEvents: 4000,          // ring buffer per session

    // ---- lifecycle ---------------------------------------------------
    start(meta) {
        this.current = {
            id: this.sessions.length + 1,
            startedAt: new Date(),
            meta: meta || {},
            events: [],
            result: null
        };
        this.sessions.push(this.current);
        // keep memory bounded across a long play session
        if (this.sessions.length > 30) this.sessions.shift();

        this.event('SESSION', `${meta.mode} — ${meta.track}` +
            (meta.laps ? `, ${meta.laps} laps` : '') +
            (meta.difficulty ? `, ${meta.difficulty}` : '') +
            `, ${meta.weather}`);
        return this.current;
    },

    end(result) {
        if (!this.current) return;
        this.current.result = result;
        this.event('END', 'session closed');
    },

    // ---- recording ---------------------------------------------------
    event(type, text, data) {
        if (!this.current) return;
        const e = {
            t: (typeof track !== 'undefined' && track && typeof track.currentRaceTime === 'number')
                ? track.currentRaceTime / 1000 : 0,
            type: type,
            text: text,
            data: data
        };
        this.current.events.push(e);
        if (this.current.events.length > this.maxEvents) this.current.events.shift();
        if (this.echoToConsole) {
            console.log(`[${e.t.toFixed(3)}] ${type.padEnd(9)} ${text}`);
        }
        return e;
    },

    // ---- reading -----------------------------------------------------
    fmt(ms) {
        if (ms === null || ms === undefined || !isFinite(ms)) return '--.---';
        return (ms / 1000).toFixed(3);
    },

    sessionText(s) {
        const lines = [];
        lines.push('='.repeat(72));
        lines.push(`SESSION ${s.id}  ${s.startedAt.toLocaleString()}`);
        const m = s.meta || {};
        lines.push(`  mode ${m.mode || '?'} | track ${m.track || '?'} | laps ${m.laps || '-'} ` +
                   `| AI ${m.difficulty || '-'} | ${m.weather || '?'}`);
        if (m.grid && m.grid.length) {
            lines.push('  grid: ' + m.grid.map((g, i) => `P${i + 1} ${g}`).join(', '));
        }
        lines.push('-'.repeat(72));
        for (const e of s.events) {
            lines.push(`  ${e.t.toFixed(3).padStart(8)}  ${e.type.padEnd(9)}  ${e.text}`);
        }
        if (s.result && s.result.length) {
            lines.push('-'.repeat(72));
            lines.push('  CLASSIFICATION');
            s.result.forEach((r, i) => {
                lines.push(`   P${String(i + 1).padStart(2)}  ${String(r.name).padEnd(22)} ` +
                           `laps ${r.laps}  time ${r.time}  best ${r.best}  ${r.note || ''}`);
            });
        }
        return lines.join('\n');
    },

    text(onlyLast) {
        const list = onlyLast && this.current ? [this.current] : this.sessions;
        if (!list.length) return 'No sessions recorded yet.';
        return list.map(s => this.sessionText(s)).join('\n\n');
    },

    download() {
        const blob = new Blob([this.text(false)], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `apex2-log-${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
};

// Handy from the dev console: RaceLog.dump()
RaceLog.dump = function (onlyLast) { console.log(this.text(onlyLast !== false)); };
