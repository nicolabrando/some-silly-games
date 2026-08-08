import re

with open("app.js", "r") as f:
    app_js = f.read()

# Fix handleHexClick
new_handleHexClick = '''    function handleHexClick(cell, element) {
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
    }'''
app_js = re.sub(r"    function handleHexClick.*?executeMove\(cell, element, p\.id\);\n        } catch\(e\) {\n            document\.title = \"ERROR_HHC: \" \+ e\.toString\(\);\n        }\n    }", new_handleHexClick, app_js, flags=re.DOTALL)

# Fix executeMove
new_executeMove = '''    function executeMove(cell, element, playerId) {
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
    }'''
app_js = re.sub(r"    function executeMove.*?processTurn\(\);\n        } catch\(e\) {\n            document\.title = \"ERROR_EXEC: \" \+ e\.toString\(\) \+ \" \| \" \+ e\.stack;\n        }\n    }", new_executeMove, app_js, flags=re.DOTALL)

# Fix processTurn
new_processTurn = '''    function processTurn() {
        if (gameOver) return;
        let p = activePlayers[currentPlayerIdx];
        if (p.type === 'ai') {
            isThinking = true;
            setTimeout(() => makeAIMove(p), 50);
        } else {
            isThinking = false;
        }
    }'''
app_js = re.sub(r"    function processTurn\(\) {\n        try {\n            if \(gameOver\) return;\n            let p = activePlayers\[currentPlayerIdx\];\n            document\.title = \"Turn: \" \+ p\.id \+ \" \" \+ p\.type;\n            if \(p\.type === 'ai'\) {\n                isThinking = true;\n                setTimeout\(\(\) => {\n                    try \{ makeAIMove\(p\); \} \n                    catch \(e\) \{ document\.title = \"ERROR_AI: \" \+ e\.toString\(\); \}\n                \}, 50\);\n            \} else {\n                isThinking = false;\n            }\n        } catch\(err\) {\n            document\.title = \"ERROR_PT: \" \+ err\.toString\(\);\n        }\n    }", new_processTurn, app_js, flags=re.DOTALL)

with open("app.js", "w") as f:
    f.write(app_js)
