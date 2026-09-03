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
            `, ${meta.weather}` +
            // in the body as well as the header: this is the line a reader
            // lands on, and PIT events further down mean nothing without it
            (meta.pits ? `, ${meta.pits}` : ''));
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
                   `| AI ${m.difficulty || '-'} | ${m.weather || '?'}` +
                   (m.playerTyre ? ` | you on ${m.playerTyre}` : '') +
                   (m.playerChassis ? ` (${m.playerChassis})` : '') +
                   // The seed makes a season repeatable, so it belongs in the
                   // log: without it a championship you want to run again on
                   // another tyre is gone the moment you close the page.
                   (m.seed ? ` | season ${m.seed}` : '') +
                   // WHETHER THE BOX WAS OPEN. Two seasons run on the same seed
                   // and the same circuits are not the same experiment if one of
                   // them could stop and the other could not - and the tyre
                   // lines below mean something different in each. It is one
                   // clause and it makes the log answerable.
                   (m.pits ? ` | ${m.pits}` : ''));
        // Which rubber everyone started on. This was missing, and its absence
        // made a whole question unanswerable: two championships were run to
        // find out whether one compound was too strong and the logs could not
        // say which compound had been used. A log that cannot answer the
        // question it was collected for is not a log.
        if (m.tyres && m.tyres.length) {
            lines.push('  tyres: ' + m.tyres.join(', '));
        }
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
                           `laps ${r.laps}  time ${r.time}  best ${r.best}  ` +
                           `${(r.tyre || '').padEnd(7)}${r.note || ''}`);
            });
        }
        return lines.join('\n');
    },

    // The name the game goes by on screen. One place, because it appears
    // twice - at the top of the file and in the file's own name - and they
    // were allowed to drift: the download was still called apex2 long after
    // the title screen had stopped saying it.
    title: 'APEX 3',

    // Where the readable report ends and the data begins. Defined here, once,
    // and read by the importer in main.js: the writer and the reader of a file
    // format must not each keep their own copy of the line that separates it.
    dataMark: '=== APEX 3 DATA \u2014 do not edit below this line ===',

    // What travels with the file besides the text. A hook, not a dependency:
    // main.js sets this to a function returning the seasons and the record
    // book, and racelog.js goes on knowing nothing about either.
    payload: null,

    // The file as it is written to disk: the report, then the data.
    fileText() {
        let out = this.text(false);
        let box = null;
        if (typeof this.payload === 'function') {
            try { box = this.payload(); } catch (e) { box = null; }
        }
        if (box) {
            out += '\n\n' + this.dataMark + '\n' +
                   '(this block is what makes the file loadable again: seasons and lap records)\n' +
                   JSON.stringify(box) + '\n';
        }
        return out;
    },

    text(onlyLast) {
        const list = onlyLast && this.current ? [this.current] : this.sessions;
        if (!list.length) return 'No sessions recorded yet.';
        // A log read six months from now should say what wrote it.
        const head = `${this.title} — race log` +
                     `\nexported ${new Date().toLocaleString()}` +
                     `\n${list.length} session${list.length > 1 ? 's' : ''}\n`;
        return head + list.map(s => this.sessionText(s)).join('\n\n');
    },

    download() {
        const blob = new Blob([this.fileText()], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `${this.title.toLowerCase().replace(/\s+/g, '')}-log-${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
};

// Handy from the dev console: RaceLog.dump()
RaceLog.dump = function (onlyLast) { console.log(this.text(onlyLast !== false)); };
