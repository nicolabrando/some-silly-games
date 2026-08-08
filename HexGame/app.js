document.addEventListener('DOMContentLoaded', () => {
    let NUM_PLAYERS = 2; // 2, 3, or 4
    let BOARD_SIZE = 11;
    let HEX_SIZE = 25;
    
    let playerConfigs = [
        { id: 1, type: 'human', difficulty: 0, color: '#ff4b4b' },
        { id: 2, type: 'ai', difficulty: 1, color: '#4b7bff' },
        { id: 3, type: 'ai', difficulty: 2, color: '#4bff6c' },
        { id: 4, type: 'ai', difficulty: 3, color: '#ffea4b' }
    ];
    
    let activePlayers = []; 
    let cells = []; // The board
    let currentPlayerIdx = 0; 
    let gameOver = false;
    let isThinking = false;
    
    // UI Elements
    const startMenuView = document.getElementById('start-menu-view');
    const gameView = document.getElementById('game-view');
    const hexGrid = document.getElementById('hex-grid');
    const svgBoard = document.getElementById('hex-board');
    const turnIndicator = document.getElementById('turn-indicator');
    const winnerModal = document.getElementById('winner-modal');
    const winnerText = document.getElementById('winner-text');
    
    // Audio
    const bgMusic = document.getElementById('bg-music');
    const musicToggle = document.getElementById('music-toggle');
    let isMusicPlaying = false;
    let isPlayingAudio = false;
    let audioContext;
    
    let globalTurnCounter = 1;
    let isContemplating = false;
    
    musicToggle.addEventListener('click', () => {
        if (isMusicPlaying) {
            bgMusic.pause();
            musicToggle.textContent = '🎵 Usa Audio';
        } else {
            bgMusic.play().catch(e => console.log('Audio autoplay blocked'));
            musicToggle.textContent = '🔇 Muta Audio';
        }
        isMusicPlaying = !isMusicPlaying;
    });
    
    // Menu controls
    const numPlayersToggles = document.querySelectorAll('#num-players-toggle .toggle-btn');
    const gridSizeSlider = document.getElementById('grid-size');
    const gridSizeVal = document.getElementById('grid-size-val');
    const playersConfigContainer = document.getElementById('players-config-container');
    const startGameBtn = document.getElementById('start-game-btn');
    
    const menuBtn = document.getElementById('menu-btn');
    const restartBtn = document.getElementById('restart-btn');
    const modalRestartBtn = document.getElementById('modal-restart-btn');
    const restartGameBtn = document.getElementById('restart-game-btn');
    const modalMenuBtn = document.getElementById('modal-menu-btn');
    const contemplateBtn = document.getElementById('modal-contemplate-btn');
    
    function renderPlayerConfigs() {
        playersConfigContainer.innerHTML = '';
        playersConfigContainer.className = 'players-config-grid';
        
        for (let i = 0; i < NUM_PLAYERS; i++) {
            let p = playerConfigs[i];
            
            let row = document.createElement('div');
            row.className = 'player-config-row';
            
            let label = document.createElement('div');
            label.className = 'player-label';
            label.style.color = p.color;
            label.textContent = `Giocatore ${p.id}`;
            
            let select = document.createElement('select');
            select.className = 'player-select';
            select.innerHTML = `
                <option value="human" ${p.type === 'human' ? 'selected' : ''}>Umano</option>
                <option value="0" ${p.type === 'ai' && p.difficulty === 0 ? 'selected' : ''}>AI - Easy</option>
                <option value="1" ${p.type === 'ai' && p.difficulty === 1 ? 'selected' : ''}>AI - Medium</option>
                <option value="2" ${p.type === 'ai' && p.difficulty === 2 ? 'selected' : ''}>AI - Hard</option>
                <option value="3" ${p.type === 'ai' && p.difficulty === 3 ? 'selected' : ''}>AI - Impossible</option>
            `;
            select.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'human') {
                    p.type = 'human';
                } else {
                    p.type = 'ai';
                    p.difficulty = parseInt(val);
                }
            });
            
            let colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.className = 'color-picker';
            colorPicker.value = p.color;
            colorPicker.addEventListener('input', (e) => {
                p.color = e.target.value;
                label.style.color = p.color;
            });
            
            row.appendChild(label);
            row.appendChild(select);
            row.appendChild(colorPicker);
            playersConfigContainer.appendChild(row);
        }
    }
    
    numPlayersToggles.forEach(btn => {
        btn.addEventListener('click', () => {
            numPlayersToggles.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            NUM_PLAYERS = parseInt(btn.dataset.num);
            renderPlayerConfigs();
        });
    });
    
    gridSizeSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        gridSizeVal.textContent = val;
        BOARD_SIZE = parseInt(val);
        HEX_SIZE = Math.max(10, 35 - Math.floor(BOARD_SIZE * 0.8));
    });
    
    function hexToRgb(hex) {
        let r = parseInt(hex.slice(1, 3), 16),
            g = parseInt(hex.slice(3, 5), 16),
            b = parseInt(hex.slice(5, 7), 16);
        return `${r}, ${g}, ${b}`;
    }

    startGameBtn.addEventListener('click', () => {
        activePlayers = playerConfigs.slice(0, NUM_PLAYERS);
        
        // Setup CSS Variables for dynamic colors
        for (let p of activePlayers) {
            document.documentElement.style.setProperty(`--player-${p.id}-color`, p.color);
            document.documentElement.style.setProperty(`--player-${p.id}-glow`, `drop-shadow(0 0 8px rgba(${hexToRgb(p.color)}, 0.8))`);
        }

        startMenuView.classList.add('view-hidden');
        gameView.classList.remove('view-hidden');
        isContemplating = false;
        startNewGame();
    });

    function showMenu() {
        gameView.classList.add('view-hidden');
        startMenuView.classList.remove('view-hidden');
    }
    
    menuBtn.addEventListener('click', showMenu);
    modalMenuBtn.addEventListener('click', () => {
        winnerModal.classList.add('modal-hidden');
        showMenu();
    });
    
    if(contemplateBtn) {
        contemplateBtn.addEventListener('click', () => {
            winnerModal.classList.add('modal-hidden');
            isContemplating = true;
            turnIndicator.textContent = "Contemplazione (clicca su un esagono)";
            turnIndicator.className = "current-player";
        });
    }

    if (restartBtn) restartBtn.addEventListener('click', startNewGame);
    if (modalRestartBtn) modalRestartBtn.addEventListener('click', startNewGame);
    if (restartGameBtn) restartGameBtn.addEventListener('click', startNewGame);

    // --- GAME LOGIC ---
    
    const dirs = [
        {dq: 1, dr: 0}, {dq: 0, dr: 1}, {dq: -1, dr: 1},
        {dq: -1, dr: 0}, {dq: 0, dr: -1}, {dq: 1, dr: -1}
    ];

    function generateBoard() {
        cells = [];
        let coords = [];
        
        if (NUM_PLAYERS === 2) {
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let q = 0; q < BOARD_SIZE; q++) {
                    coords.push({q, r, s: -q-r});
                }
            }
        } else if (NUM_PLAYERS === 3) {
            for (let r = -BOARD_SIZE; r <= BOARD_SIZE; r++) {
                for (let q = -BOARD_SIZE; q <= BOARD_SIZE; q++) {
                    let s = -q-r;
                    if (Math.abs(s) <= BOARD_SIZE) {
                        coords.push({q, r, s});
                    }
                }
            }
        } else if (NUM_PLAYERS === 4) {
            let R = BOARD_SIZE * HEX_SIZE * Math.sqrt(3);
            let span = BOARD_SIZE * 2;
            for (let r = -span; r <= span; r++) {
                for (let q = -span; q <= span; q++) {
                    let w = Math.sqrt(3) * HEX_SIZE;
                    let x = w * (q + r/2);
                    let y = (3/2) * HEX_SIZE * r;
                    if (Math.abs(x) <= R + 1 && Math.abs(y) <= R + 1 && 
                        Math.abs(x) + Math.abs(y) <= R * Math.sqrt(2) + 1) {
                        coords.push({q, r, s: -q-r});
                    }
                }
            }
        }

        let coordMap = new Map();
        let idCounter = 0;
        for (let c of coords) {
            let cell = {
                id: idCounter++,
                q: c.q, r: c.r, s: c.s,
                player: 0,
                starts: [], 
                targets: [],
                neighbors: []
            };
            cells.push(cell);
            coordMap.set(`${c.q},${c.r}`, cell);
        }
        
        for (let cell of cells) {
            for (let d of dirs) {
                let nq = cell.q + d.dq;
                let nr = cell.r + d.dr;
                let nCell = coordMap.get(`${nq},${nr}`);
                if (nCell) {
                    cell.neighbors.push(nCell.id);
                }
            }
            
            // Assign edges
            if (NUM_PLAYERS === 2) {
                if (cell.r === 0) cell.starts.push(1);
                if (cell.r === BOARD_SIZE - 1) cell.targets.push(1);
                if (cell.q === 0) cell.starts.push(2);
                if (cell.q === BOARD_SIZE - 1) cell.targets.push(2);
            } else if (NUM_PLAYERS === 3) {
                if (cell.r === BOARD_SIZE) cell.starts.push(1);
                if (cell.r === -BOARD_SIZE) cell.targets.push(1);
                if (cell.q === -BOARD_SIZE) cell.starts.push(2);
                if (cell.q === BOARD_SIZE) cell.targets.push(2);
                if (cell.s === BOARD_SIZE) cell.starts.push(3);
                if (cell.s === -BOARD_SIZE) cell.targets.push(3);
            } else if (NUM_PLAYERS === 4) {
                if (cell.neighbors.length < 6) {
                    let w = Math.sqrt(3) * HEX_SIZE;
                    let x = w * (cell.q + cell.r/2);
                    let y = (3/2) * HEX_SIZE * cell.r;
                    let angle = Math.atan2(y, x) * 180 / Math.PI;
                    if (angle < 0) angle += 360;
                    
                    let sector = Math.round(angle / 45) % 8;
                    
                    if (sector === 6) cell.starts.push(1);
                    if (sector === 2) cell.targets.push(1);
                    
                    if (sector === 4) cell.starts.push(2);
                    if (sector === 0) cell.targets.push(2);
                    
                    if (sector === 5) cell.starts.push(3);
                    if (sector === 1) cell.targets.push(3);
                    
                    if (sector === 3) cell.starts.push(4);
                    if (sector === 7) cell.targets.push(4);
                }
            }
        }
    }
    
    function getHexCenter(q, r) {
        const w = Math.sqrt(3) * HEX_SIZE;
        const x = w * (q + r/2);
        const y = (3/2) * HEX_SIZE * r;
        return { x, y };
    }
    
    function getHexPoints() {
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle_deg = 60 * i - 30;
            const angle_rad = Math.PI / 180 * angle_deg;
            points.push(`${HEX_SIZE * Math.cos(angle_rad)},${HEX_SIZE * Math.sin(angle_rad)}`);
        }
        return points.join(' ');
    }
    
    function renderBoard() {
        hexGrid.innerHTML = '';
        const existingBorders = svgBoard.querySelectorAll('.board-edge-line');
        existingBorders.forEach(el => el.remove());
        
        const hexPoints = getHexPoints();
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (let cell of cells) {
            const { x, y } = getHexCenter(cell.q, cell.r);
            
            minX = Math.min(minX, x - HEX_SIZE);
            minY = Math.min(minY, y - HEX_SIZE);
            maxX = Math.max(maxX, x + HEX_SIZE);
            maxY = Math.max(maxY, y + HEX_SIZE);
            
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', hexPoints);
            polygon.setAttribute('transform', `translate(${x}, ${y})`);
            polygon.setAttribute('class', 'hexagon');
            polygon.setAttribute('data-id', cell.id);
            
            polygon.addEventListener('click', () => handleHexClick(cell, polygon));
            
            hexGrid.appendChild(polygon);
            
            // Draw edges
            for (let p of activePlayers) {
                if (cell.starts.includes(p.id) || cell.targets.includes(p.id)) {
                    // Check which neighbor directions are missing
                    for (let i = 0; i < 6; i++) {
                        let d = dirs[i];
                        let nq = cell.q + d.dq;
                        let nr = cell.r + d.dr;
                        // If neighbor doesn't exist, this edge is a true boundary
                        let hasNeighbor = cells.some(c => c.q === nq && c.r === nr);
                        if (!hasNeighbor) {
                            // Points are i and (i+1)%6
                            let a1 = (60 * i - 30) * Math.PI / 180;
                            let a2 = (60 * ((i+1)%6) - 30) * Math.PI / 180;
                            let x1 = x + HEX_SIZE * Math.cos(a1);
                            let y1 = y + HEX_SIZE * Math.sin(a1);
                            let x2 = x + HEX_SIZE * Math.cos(a2);
                            let y2 = y + HEX_SIZE * Math.sin(a2);
                            
                            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                            line.setAttribute('x1', x1);
                            line.setAttribute('y1', y1);
                            line.setAttribute('x2', x2);
                            line.setAttribute('y2', y2);
                            line.setAttribute('class', `board-edge-line p${p.id}`);
                            svgBoard.appendChild(line);
                        }
                    }
                }
            }
        }
        
        const padding = HEX_SIZE * 2;
        svgBoard.setAttribute('viewBox', `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`);
    }
    
    function updatePlayersStatus() {
        const container = document.getElementById('players-status');
        if (!container) return;
        container.innerHTML = '';
        for (let p of activePlayers) {
            let card = document.createElement('div');
            card.className = `player-status-card p${p.id}`;
            if (p.eliminated) card.classList.add('eliminated');
            card.style.setProperty('--player-color', p.color);
            card.innerHTML = `
                <strong style="color: ${p.color}">Giocatore ${p.id}</strong>
                <span>Tipo: ${p.type === 'human' ? 'Umano' : 'IA'}</span>
                ${p.type === 'ai' ? `<span>Difficoltà: ${p.difficulty}</span>` : ''}
                ${p.eliminated ? '<span style="color: #ff4444; font-weight: bold; margin-top: 5px">ELIMINATO</span>' : ''}
            `;
            container.appendChild(card);
        }
    }

    function startNewGame() {
        globalTurnCounter = 1;
        isContemplating = false;
        for (let p of activePlayers) {
            p.eliminated = false;
        }
        generateBoard();
        renderBoard();
        updatePlayersStatus();
        currentPlayerIdx = 0;
        gameOver = false;
        isThinking = false;
        winnerModal.classList.add('modal-hidden');
        updateTurnIndicator();
        processTurn();
    }
    
    function processTurn() {
        if (gameOver) return;
        let p = activePlayers[currentPlayerIdx];
        if (p.type === 'ai') {
            isThinking = true;
            setTimeout(() => makeAIMove(p), 50);
        } else {
            isThinking = false;
        }
    }
    
    function handleHexClick(cell, element) {
        if (isContemplating) {
            if (cell.turnPlaced) {
                turnIndicator.textContent = "Mossa del turno: " + cell.turnPlaced;
            } else {
                turnIndicator.textContent = "Nessuna mossa in questa cella";
            }
            return;
        }
        if (gameOver || isThinking) return;
        let p = activePlayers[currentPlayerIdx];
        if (p.type !== 'human') return;
        
        if (cell.player !== 0) return;
        executeMove(cell, element, p.id);
    }

    function executeMove(cell, element, playerId) {
        cell.player = playerId;
        cell.turnPlaced = globalTurnCounter++;
        element.classList.add(`p${playerId}`);
        
        if (checkWinFast(cells.map(c => c.player), playerId)) {
            endGame(playerId);
            return;
        }
        
        let activeCount = 0;
        for (let p of activePlayers) {
            if (!p.eliminated) {
                if (!canPlayerWin(p.id)) {
                    p.eliminated = true;
                } else {
                    activeCount++;
                }
            }
        }
        
        if (activeCount === 0) {
            endGame(0);
            return;
        }
        
        let nextIdx = (currentPlayerIdx + 1) % NUM_PLAYERS;
        while (activePlayers[nextIdx].eliminated && nextIdx !== currentPlayerIdx) {
            nextIdx = (nextIdx + 1) % NUM_PLAYERS;
        }
        
        currentPlayerIdx = nextIdx;
        updatePlayersStatus();
        updateTurnIndicator();
        processTurn();
    }
    
    function updateTurnIndicator() {
        if (gameOver) return;
        let p = activePlayers[currentPlayerIdx];
        turnIndicator.textContent = `Giocatore ${p.id} ${p.type === 'ai' ? '(AI)' : ''}`;
        turnIndicator.className = `current-player p${p.id}`;
    }

    function endGame(winningPlayerId) {
        gameOver = true;
        if (winningPlayerId === 0) {
            winnerText.textContent = "Pareggio!";
            winnerText.style.color = "white";
            turnIndicator.textContent = "Partita Finita";
        } else {
            winnerText.textContent = `Vittoria Giocatore ${winningPlayerId}!`;
            winnerText.style.color = `var(--player-${winningPlayerId}-color)`;
            turnIndicator.textContent = `G${winningPlayerId} Vince!`;
        }
        winnerModal.classList.remove('modal-hidden');
        updatePlayersStatus();
    }

    // --- AI LOGIC ---
    function makeAIMove(playerObj) {
        if (gameOver) return;

        let emptyCells = cells.filter(c => c.player === 0);
        if(emptyCells.length === 0) return;

        let selectedCell = null;

        if (playerObj.difficulty === 0) {
            selectedCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        } 
        else if (playerObj.difficulty === 1) {
            selectedCell = getMediumMove(emptyCells, playerObj.id);
        } 
        else if (playerObj.difficulty === 2) {
            selectedCell = getMCTSMove(emptyCells, playerObj.id, 150);
        } 
        else if (playerObj.difficulty === 3) {
            selectedCell = getMCTSMove(emptyCells, playerObj.id, 600);
        }

        const element = svgBoard.querySelector(`polygon[data-id="${selectedCell.id}"]`);
        isThinking = false;
        executeMove(selectedCell, element, playerObj.id);
    }

    function getDijkstraInfo(player) {
        let dist = new Array(cells.length).fill(Infinity);
        let prev = new Array(cells.length).fill(-1);
        let unvisited = new Set();
        
        for (let i = 0; i < cells.length; i++) {
            unvisited.add(i);
            if (cells[i].starts.includes(player)) {
                if (cells[i].player === player) dist[i] = 0;
                else if (cells[i].player === 0) dist[i] = 1;
            }
        }
        
        let bestEnd = -1;
        let bestDist = Infinity;
        
        while(unvisited.size > 0) {
            let u = -1;
            let minDist = Infinity;
            for (let node of unvisited) {
                if (dist[node] < minDist) { minDist = dist[node]; u = node; }
            }
            if (u === -1 || minDist === Infinity) break;
            
            unvisited.delete(u);
            
            if (cells[u].targets.includes(player)) {
                if (minDist < bestDist) { bestDist = minDist; bestEnd = u; }
            }
            
            for (let v of cells[u].neighbors) {
                if (cells[v].player !== player && cells[v].player !== 0) continue; 
                let cost = cells[v].player === 0 ? 1 : 0;
                let alt = dist[u] + cost;
                if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
            }
        }
        
        if (bestEnd === -1) return { dist: Infinity, path: [] };
        
        let path = [];
        let curr = bestEnd;
        while (curr !== -1) {
            if (cells[curr].player === 0) path.push(cells[curr]);
            curr = prev[curr];
        }
        return { dist: bestDist, path: path };
    }

    function getMediumMove(emptyCells, myPlayerId) {
        let myPathInfo = getDijkstraInfo(myPlayerId);
        
        let minOppDist = Infinity;
        let bestOppPath = null;
        
        for (let p of activePlayers) {
            if (p.id === myPlayerId) continue;
            let oppPathInfo = getDijkstraInfo(p.id);
            if (oppPathInfo.dist < minOppDist) {
                minOppDist = oppPathInfo.dist;
                bestOppPath = oppPathInfo.path;
            }
        }
        
        if (myPathInfo.dist === Infinity && minOppDist === Infinity) {
            return emptyCells[Math.floor(Math.random() * emptyCells.length)];
        }
        
        if (myPathInfo.dist <= minOppDist && myPathInfo.path.length > 0) {
            return myPathInfo.path[Math.floor(Math.random() * myPathInfo.path.length)];
        } else if (bestOppPath && bestOppPath.length > 0) {
            return bestOppPath[Math.floor(Math.random() * bestOppPath.length)];
        }
        return emptyCells[Math.floor(Math.random() * emptyCells.length)];
    }

    function getMCTSMove(emptyCells, myPlayerId, maxTimeMs) {
        const startTime = performance.now();
        let scores = new Array(emptyCells.length).fill(0);
        let plays = new Array(emptyCells.length).fill(0);
        
        let simBoard = new Uint8Array(cells.length);
        
        let loopCount = 0;
        while(performance.now() - startTime < maxTimeMs) {
            let moveIndex = Math.floor(Math.random() * emptyCells.length);
            let cell = emptyCells[moveIndex];
            
            // Heuristic evaluation for MCTS using Dijkstra
            cell.player = myPlayerId;
            let dInfo = getDijkstraInfo(myPlayerId);
            let distScore = (dInfo.dist === Infinity) ? -999 : -dInfo.dist;
            cell.player = 0;
            
            let winner = simulateRandomGame(cell.id, simBoard, myPlayerId);
            
            let finalScore = 0;
            if (winner === myPlayerId) finalScore = 1;
            else if (winner === 0) finalScore = 0.5; 
            
            // Add a small heuristic bonus based on distance
            finalScore += (distScore / 1000); // Very small so real wins always override
            
            scores[moveIndex] += finalScore;
            plays[moveIndex]++;
            loopCount++;
        }
        
        let bestIndex = 0;
        let bestScore = -1;
        for (let i = 0; i < scores.length; i++) {
            if (plays[i] > 0) {
                let winRate = scores[i] / plays[i];
                if (winRate > bestScore) {
                    bestScore = winRate;
                    bestIndex = i;
                }
            }
        }
        return emptyCells[bestIndex];
    }

    function simulateRandomGame(firstMoveId, simBoard, myPlayerId) {
        let emptyIndices = [];
        for(let i=0; i<cells.length; i++) {
            let p = cells[i].player;
            simBoard[i] = p;
            if (p === 0 && i !== firstMoveId) {
                emptyIndices.push(i);
            }
        }
        
        simBoard[firstMoveId] = myPlayerId;
        
        // Shuffle
        for (let i = emptyIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            let temp = emptyIndices[i];
            emptyIndices[i] = emptyIndices[j];
            emptyIndices[j] = temp;
        }
        
        let rolloutPlayers = activePlayers.filter(p => !p.eliminated);
        if (rolloutPlayers.length === 0) rolloutPlayers = [activePlayers.find(p => p.id === myPlayerId) || activePlayers[0]];
        
        let tIdx = rolloutPlayers.findIndex(p => p.id === myPlayerId);
        if (tIdx === -1) tIdx = 0;
        tIdx = (tIdx + 1) % rolloutPlayers.length;
        
        for (let i = 0; i < emptyIndices.length; i++) {
            simBoard[emptyIndices[i]] = rolloutPlayers[tIdx].id;
            tIdx = (tIdx + 1) % rolloutPlayers.length;
        }
        
        for (let p of rolloutPlayers) {
            if (checkWinFast(simBoard, p.id)) return p.id;
        }
        return 0; // Pareggio
    }

    function checkWinFast(simBoard, player) {
        let visited = new Uint8Array(cells.length);
        let stack = [];
        
        for (let i = 0; i < cells.length; i++) {
            if (simBoard[i] === player && cells[i].starts.includes(player)) {
                stack.push(i);
                visited[i] = 1;
            }
        }
        
        while (stack.length > 0) {
            let curr = stack.pop();
            if (cells[curr].targets.includes(player)) return true;
            
            for (let nId of cells[curr].neighbors) {
                if (simBoard[nId] === player && visited[nId] === 0) {
                    visited[nId] = 1;
                    stack.push(nId);
                }
            }
        }
        return false;
    }

    function canPlayerWin(playerId) {
        let simBoard = new Uint8Array(cells.length);
        for (let i = 0; i < cells.length; i++) {
            if (cells[i].player === playerId || cells[i].player === 0) {
                simBoard[i] = playerId;
            } else {
                simBoard[i] = cells[i].player;
            }
        }
        return checkWinFast(simBoard, playerId);
    }
    
    // Inizializzazione UI menu
    renderPlayerConfigs();
});
