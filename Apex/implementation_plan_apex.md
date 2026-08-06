# Apex — Technical Architecture & Implementation Blueprint

Questo documento è il **Game Design Document (GDD)** definitivo e la **guida all'architettura software** per il motore di gioco **Apex**. Qualsiasi sviluppatore, o Intelligenza Artificiale, deve essere in grado di ricostruire il gioco da zero leggendo questo file.

## 1. Architettura di Sistema e Game Loop

Il gioco gira interamente lato client tramite il tag HTML5 `<canvas>`. L'aggiornamento logico e grafico è gestito tramite il pattern `requestAnimationFrame`.

### 1.1 Il Game Loop (`main.js`)
La funzione `gameLoop(timestamp)` è il cuore pulsante.
- **Delta Time (dt)**: Il tempo trascorso tra il frame precedente e quello attuale `(timestamp - lastTime) / 1000`. Per evitare glitch della fisica causati dal blocco del thread o dal tab in background, il `dt` viene limitato a un tetto massimo: `if (dt > 0.05) return;` (non avanza il gioco se il framerate droppa sotto i 20 FPS improvvisamente).
- **Stati del Gioco (`gameState`)**:
  - `menu`: Mostra l'interfaccia DOM sovrapposta. Il canvas è nero.
  - `countdown`: Semifisica attiva. Le auto possono muoversi e ricevere penalità per partenze anticipate (jump start), ma il timer ufficiale della gara non parte. Il renderer mostra i semafori basandosi su `countdownTimer`.
  - `racing`: Il loop completo. Applica la simulazione fisica (`updatePhysics(dt)`), calcola i danni/collisioni, aggiorna l'HUD, gestisce il timer DNF e il lookahead dell'IA.
  - `gameover`: Arresta la simulazione, mostra la classifica finale e aggiorna l'UI del campionato, salvando il progresso.

### 1.2 Gestione dello Stato e Memoria
- I dati temporanei (vettori di posizione, particelle, tracce gomma) risiedono in scope globale in array mutabili (`cars`, `globalParticles`, `globalSkidMarks`).
- Vengono svuotati e riallocati esclusivamente dentro la funzione `startGame()`.
- **`globalSkidMarks`** è un ring buffer da 4000 punti (`car.js` scarta il più vecchio prima di aggiungere). Prima cresceva senza limite: accettabile con 4 vetture su 5 giri, non con 12 su 10.

---

## 2. Il Motore Fisico (Classe `Car`)

La simulazione in `car.js` non utilizza body fisici esterni (come Matter.js), ma una simulazione cinematica basata su derivate temporali.

### 2.1 Forze e Accelerazione
- **Input**: Accettano booleani (`inputs.up`, `inputs.left`, ecc.).
- **Trazione Motore**: `engineForce`. Se l'acceleratore è premuto, una forza è applicata nel vettore direzionale corrente.
- **Resistenze (Drag/Friction)**: 
  - La resistenza aerodinamica cresce con il quadrato della velocità: `drag * velocity * |velocity|`. Questo determina la velocità massima.
  - L'attrito volvente costante simula l'inerzia.
- **Formula dell'Aggiornamento**: 
  `new_velocity = old_velocity + (engineForce - drag) * dt`

### 2.2 Il Calcolo del Grip (Aderenza)
Il modello ha due comportamenti distinti al limite, entrambi emergenti e non scriptati:

- **Sottosterzo da saturazione** — `this.gripUse` misura quanta dell'aderenza laterale disponibile la curva sta già chiedendo (`|lateralSpeed| * 3.5 / currentGrip`, calcolato a fine frame e usato al frame successivo). L'efficacia dello sterzo viene moltiplicata per `1 - 0.35 * gripUse`: se entri troppo forte, girare di più non serve, l'avantreno lava e vai largo. Prima l'unico termine era `1 - v/500`, cioè sottosterzo *in funzione della velocità* e non del carico reale.
- **Sovrasterzo di potenza** — la coppia motore è costante ma la velocità a cui il retrotreno riesce a trasformarla in avanzamento no: a bassa velocità la richiesta è molto più alta. Se acceleri sterzando sotto i ~200 px/s, `powerOversteer` (0..1) sale, aggiunge una rotazione **non richiesta** (`± 1.15 rad/s` a fondo scala) e riduce del 45% la rigidezza di riallineamento, così il posteriore continua a uscire invece di essere ripreso subito. Il fattore `slipperiness` (fino a 2.4×) lo rende molto più facile sul bagnato e sull'erba.

Entrambi generano sgommate reali (soglia `lateralSpeed > 60`), quindi il feedback visivo è automatico.

La tenuta di strada definisce quanto veloce l'auto può curvare prima di sbandare e quanto veloce può accelerare senza slittare.
- Viene calcolato lo *slip angle* basandosi sul prodotto scalare tra il vettore velocità e la direzione di prua dell'auto.
- `currentGrip` è il coefficiente di base (`0.6`).
- **Pioggia**: Se `isRaining` è `true`, il grip viene moltiplicato per `0.20` (e le particelle passano da nero fumo ad azzurro acqua, sfruttando i parametri globalParticles). Il valore è basso di proposito: vedi la nota in §4.6bis: sopra ~0.25 il clamp del grip laterale non entra mai in saturazione e la pioggia non si sente.
- **Bonus Personaggio**: sopra il fattore pioggia si applica `car.wetGripBonus`, impostato da `AI_DRIVER_STYLES` (Senna 1.42, Schumacher 1.28, Hamilton 1.26 … Lauda 0.90). Il giocatore vale 1.0.
- **Derapata**: Se la forza centripeta richiesta dalla sterzata supera l'aderenza laterale massima, l'auto perde trazione e slitta tangenzialmente alla curva, perdendo molta velocità (`this.velocity.x *= 0.9`).

### 2.3 Gestione Danni
Il danno è **proporzionale all'impatto reale**, non al tempo di contatto.

- **Fra vetture** (`main.js`): solo un urto in avvicinamento fa danno, e vale `max(0, closingSpeed - 45) * 0.22`, con un **cooldown di 250 ms per coppia** (indicizzato su `car.uid`) perché un singolo contatto non venga fatturato sessanta volte al secondo. Sopra i 12 HP di danno partono le scintille.
- **Contro le barriere** (`track.js`): `max(0, v·n - 30) * 0.10`, dove `v·n` è la componente di velocità *dentro* il muro. Strisciare lungo la barriera è quasi gratis, entrarci di muso no.
- La regola precedente addebitava 2 HP a *ogni frame* di contatto — 120 HP/s, identici che sfiorassi qualcuno a 30 px/s o lo speronassi a 300. Misurato prima: con 12 vetture la salute minima a fine gara scendeva a 0–60% e le vetture si distruggevano a vicenda. Dopo: **86–100%, zero distrutte**.

### 2.4 Condizione della vettura
`car.condition` scala grip e potenza: vale 1 sopra il 60% di salute, poi cala linearmente fino a 0.70 alla distruzione. Prima la barra della vita non significava nulla: al 5% andavi come al 100% e poi esplodevi di colpo. L'IA legge `car.condition` (in `gripScale` e `vTop`), altrimenti una vettura danneggiata continuerebbe a guidare al passo di una integra e finirebbe fuori.

### 2.4bis Superfici: asfalto, cordolo, erba
`getClosestPoint()` restituisce anche il **segmento** più vicino, e `getSurface()` lo usa per due test: la fascia oltre `trackWidth` è **cordolo** solo se (a) il pezzo di geometria più vicino è un `arc` e (b) il punto sta dalla parte del *centro* dell'arco, cioè all'**interno** della curva. Fuori curva e sui rettilinei resta erba. Nessuna annotazione manuale dei tracciati.

`kerbWidthFor(seg)` adatta la larghezza allo spazio disponibile (`seg.r - trackWidth - 2`): su un tornante il cui raggio è appena maggiore della semi-larghezza il cordolo si assottiglia, e dove non c'è proprio spazio non viene disegnato. Con la geometria attuale: 9 tracciati su 10 hanno cordoli; Triangle no, perché i suoi archi hanno raggio esattamente pari a `trackWidth` e quindi zero via di fuga interna.

- **Cordolo**: grip ×0.80, attrito ×1.30, più una vibrazione laterale casuale proporzionale alla velocità. È fatto per essere usato: prendere un cordolo per raddrizzare una curva conviene.
- **Erba**: grip ×0.30, attrito ×2.50. Non conviene mai.

`kerbWidth` vale `clamp(trackWidth × 0.30, 14, 26)`. `ai.js` distingue i due casi (`onKerb` / `onGrass`) e reagisce di conseguenza, altrimenti tratterebbe un cordolo come un disastro e frenerebbe a sproposito.

### 2.5 Scia (slipstream)
`car.draftStrength` è continuo in 0..1, prodotto di quattro attenuazioni (distanza, cono, allineamento delle prue, e la *velocità* di chi la genera: sotto 15 unità di avanzamento un'auto non lascia scia, la scia è piena da 45), invece del booleano di prima che dava +15% di colpo entrando nel cono e zero uscendone. In più il donatore deve essere **davanti sulla strada** (0 < gap d'arco < 250px, calcolato modulo giro su `lapS`): il solo cono geometrico veniva ingannato in curva — il 44% della scia misurata arrivava da un'auto in realtà dietro, inseguitore compreso. Effetto: `+18%` di spinta e `-22%` di resistenza, entrambi scalati dalla forza della scia.

---

## 3. Gestione del Tracciato (`track.js`)

I tracciati non sono tilemap, ma curve parametriche vettoriali per permettere fluidità assoluta ad alte velocità.

### 3.1 Geometria e Analitica
Ogni classe di tracciato (es. `CircoMassimoTrack`, `F1Track`) definisce un array `this.segments` contenente primitive geometriche:
- **`line`**: tra due punti `(x1, y1)` e `(x2, y2)`.
- **`arc`**: definiti da centro `(cx, cy)`, raggio `r`, `startAngle`, `endAngle` e direzione antioraria (`ccw`).

### 3.2 Il Tracciamento dei Limiti
La collisione con l'erba/muri non è basata su box di collisione, ma su **calcoli di distanza dal segmento più vicino**:
1. Nel metodo `updatePhysics()`, il gioco iterativamente controlla la distanza ortogonale tra le coordinate `(car.x, car.y)` e tutti i segmenti del tracciato.
2. Trova la distanza `d` dal punto più vicino della linea centrale del segmento.
3. Se `d > trackWidth/2`, l'auto è sull'erba (il grip crolla, velocità massima cappata).
4. Se `d > grassWidth`, l'auto ha colpito un "muro invisibile", la sua velocità verso l'esterno viene invertita e subisce un drop drastico.

### 3.2bis Progressione sul giro e conteggio giri
`Car.updateTrackProgress()` mantiene `car.trackProgress`: un odometro **monotòno** della progressione reale lungo il circuito, in pixel di pista. Ogni frame cerca il nodo più vicino della racing line (ricerca locale in una finestra, con riacquisizione globale se il migliore dista più di 220px), ne prende l'ascissa curvilinea, srotola il salto sul traguardo e accumula **solo in avanti**. Un giro viene conteggiato quando la progressione dall'ultimo passaggio supera il **45%** del giro.

> Ci sono voluti tre tentativi sbagliati per arrivarci, ognuno con la sua ragione:
> 1. `if (this.x > 650)` — soglia hardcoded, funzionava sui dieci tracciati per fortuna geometrica (**Circle la superava di soli 69px**) e sarebbe morta al primo tracciato nuovo.
> 2. Odometro della **distanza percorsa** — gonfiato da ogni sbandata, testacoda e retromarcia: con la fisica del sovrasterzo un'auto che pattinava poteva armare il marker senza essere andata da nessuna parte e **incassare un giro mai completato**.
> 3. Ascissa curvilinea a `car.nextWaypoint` — ma `checkWaypoints` avanza con un raggio di 200px, che su un tornante salta dall'altra parte della curva e in rettilineo supera il traguardo prima dell'auto. Due vetture affiancate risultavano distanti un giro intero, ed è **questo** che generava le bandiere blu dal nulla.

> La misura va presa dalla **posizione reale** della vettura, non da un indice che le corre avanti.

> **N.B.** prendere la bandiera è una domanda separata dal contare un giro. Quando il leader ha finito, la gara di chiunque altro termina al **primo** passaggio sul traguardo, che quel passaggio abbia completato un giro o no. Legare le due cose costringeva chi era appena transitato a rifare quasi un giro intero prima di essere classificato.

### 3.3 Waypoints (progressione di gara)
Il tracciato genera una lista ordinata di nodi spaziali (`this.waypoints`) calcolata preventivamente discretizzando i segmenti geometrici.
Questi punti hanno spaziatura **irregolare** (15 punti per ogni `line` indipendentemente dalla sua lunghezza, ~1 punto ogni 15px sugli `arc`) e vengono usati **solo** per la progressione di gara (`car.checkWaypoints`, `waypointProgress`) e per la classifica dell'HUD. L'IA **non** li usa.

### 3.4 Racing Line (`getRacingLine()`)
Struttura separata, costruita pigramente una sola volta per istanza di tracciato (5–25 ms, precalcolata in `startGame()`), consumata esclusivamente dall'IA. `buildRacingLine()` esegue:

1. **Ricampionamento uniforme**: la linea centrale viene densificata (~2px) e poi ricampionata a passo di ascissa curvilinea costante `ds ≈ 8px` → 200–340 nodi. Ogni nodo porta con sé `cx, cy` (centro pista), tangente `tx, ty` e normale `nx, ny`.
2. **Rilassamento vincolato**: sweep di Gauss–Seidel laplaciano sull'offset laterale `alpha[i]`, clampato a `±(trackWidth - 20)`. Il risultato è una traiettoria che frena all'esterno, taglia l'apice ed esce larga. Il numero di iterazioni è **volutamente finito**: portato a convergenza il rilassamento produce il percorso più corto, che si incolla al cordolo interno e stringe troppo il raggio. `getRacingLine()` costruisce la linea `standard` a 600 sweep e, per il livello Impossible, prova anche 1000 e 1800 sweep tenendo quella con il miglior tempo sul giro analitico (`_lapTimeOf`).
3. **Raggio di curvatura** locale per ogni nodo (circonferenza circoscritta con stencil largo). Ne vengono salvati due: `radius`, filtrato col minimo del vicinato (conservativo, per frenare in tempo), e `radiusRaw`, il valore locale. L'IA interpola fra i due con `radiusOptimism`.
4. **Velocità massima di curva a secco** (`vCorner`). Il limite dominante in questo motore non è il grip ma la **velocità di imbardata**: `car.js` cappa la sterzata a `maxSteer * (1 - v/500)`, e tenere un raggio `R` richiede un rateo `v/R`. Da cui la forma chiusa `v = maxSteer / (1/R + maxSteer/500)`.

> **N.B.** `vCorner` e `radius` sono i soli valori memorizzati: il limite di grip (`sqrt(latLimit * R)`) viene ricalcolato a runtime dall'IA perché dipende da pioggia, erba e bonus pilota.

---

## 4. Intelligenza Artificiale (Classe `AI`)

L'IA non "bara" sulla fisica; essa fornisce solo un pacchetto di `inputs` ad un oggetto `Car`, subendo le stesse identiche regole del giocatore umano. Tutta la logica vive in `ai.js`; l'interfaccia verso `main.js` è minima: `new AI(car, difficulty, skillVariation)`, `startRace()`, `update(track, dt)`.

### 4.1 Localizzazione e punto di mira (pure pursuit)
1. **Localizzazione**: ricerca locale del nodo più vicino della racing line in una finestra attorno all'indice del frame precedente (con riacquisizione globale se la distanza supera i 200px, es. dopo un testacoda o il reset da falsa partenza). Costo O(finestra), non O(N).
2. **Punto di mira**: si avanza di una **distanza** `lookDist = lookBase + v * lookSpeed` (25–210px), non di un numero di indici. Poiché i nodi sono equispaziati, la distanza di lookahead è coerente su rettilinei e curve — l'uso di indici su waypoint a spaziatura irregolare era la causa principale dello zig-zag della versione precedente.
3. **Offset laterale**: il punto di mira viene spostato lateralmente di `alpha * lineBlend + offsetTattico + biasPersonale`, clampato dentro la pista. `lineBlend` vale 0.35 su *easy* (traiettoria quasi centrale) e 1.0 su *hard* (racing line piena).

### 4.2 Sterzo (anti zig-zag)
L'errore angolare grezzo passa in un filtro passa-basso (`steerTau`), poi entra in un comparatore con **banda morta dimensionata sulla fisica**:

```
steerRate = maxSteer * max(0.10, 1 - v/500)   // imbardata realmente disponibile
dead      = clamp(steerRate * dt * 0.85, 0.012, 0.22)
release   = dead * 0.45                        // isteresi
```

Il comando non viene mai dato se la correzione richiesta è inferiore a quella che l'auto produrrebbe in un singolo frame: è matematicamente impossibile innescare l'oscillazione sinistra/destra frame-per-frame.

### 4.3 Profilo di velocità (frenata predittiva)
Per ogni nodo il limite è `min(vCorner, sqrt(latLimit * radius)) * CORNER_SAFETY * cornerFactor`, dove `latLimit` incorpora pioggia, erba e il bonus Senna.

L'IA scansiona in avanti fino alla distanza di arresto `60 + v²/(2*aBrake)` e prende il minimo di `sqrt(vLimit_j² + 2*aBrake*d_j)`: frena cioè esattamente quando la distanza residua non basta più. `aBrake = (150 + 0.55v) * brakeConfidence` — un `brakeConfidence` basso (easy) equivale a frenare in anticipo.

Throttle e freno hanno una banda di *coast* (`0.97·vTarget … 1.07·vTarget`) che impedisce lo sfarfallio gas/freno. Sotto i 18 px/s `inputs.down` viene forzato a `false`, perché a quella velocità `car.js` lo interpreta come retromarcia (era questo il motivo per cui le vetture si fermavano in mezzo alla pista).

### 4.4 Traffico e sorpassi
Tutto viene risolto nel **frame della pista** (tangente/normale del nodo corrente), non nel frame dell'auto: in curva una vettura che sta davanti sulla strada appare di lato rispetto al muso, e la vecchia IA le si buttava addosso.

- **Car following**: se qualcuno occupa la nostra traiettoria (`|side| < 27`), il target di velocità viene cappato a `v_loro + (gap - safeGap) * gapGain`. Gap negativo ⇒ si frena. Questo, e non un generico "rallenta", è ciò che ha azzerato i tamponamenti a catena.
- **Sorpasso**: contemporaneamente l'offset laterale si sposta verso il lato con più spazio (rate-limited a 110 px/s, con isteresi sul lato scelto). Appena si è affiancati il cono di *following* non è più soddisfatto e l'IA riapre il gas.
- **Ruota a ruota**: repulsione laterale pura, mai frenata.
- **Slipstream**: `car.isDrafting` (calcolato in `main.js`) alza il tetto di velocità del 10%.

### 4.5 Recuperi
- **Contromano**: rilevato confrontando l'assetto con la **tangente della pista**, non con la direzione del target (che avoidance e offset possono perturbare). Sopra 25 px/s frena e sterza, altrimenti retromarcia con sterzo invertito finché l'errore non scende sotto 0.9 rad.
- **Insabbiamento**: se l'IA chiede gas ma resta sotto 22 px/s per 1.1 s, retromarcia 0.75 s ruotando il muso via dalla barriera (segno di `right·n` rispetto alla posizione laterale).

### 4.6 Livelli di difficoltà
I quattro profili in `AI_PROFILES` scalano coerentemente pace, prudenza e pulizia:

| | easy | medium | hard | impossible |
|---|---|---|---|---|
| `cornerFactor` (frazione del limite fisico in curva) | 0.72 | 0.95 | 1.08 | 1.14 |
| `straightFactor` (frazione della velocità massima) | 0.68 | 0.96 | 1.00 | 1.00 |
| `brakeConfidence` | 0.55 | 0.86 | 1.02 | 1.12 |
| `lineBlend` | 0.35 | 0.85 | 1.00 | 1.00 |
| `radiusOptimism` | 0.00 | 0.25 | 0.55 | 1.00 |
| `errorChance` | 0.30 | 0.06 | 0.008 | 0 |
| `safeGap` / `gapGain` | 46 / 1.1 | 32 / 1.6 | 25 / 1.9 | 22 / 2.2 |
| `defend` | 0 | 0.25 | 0.55 | 0.85 |
| traiettoria | standard | standard | standard | **fast** |
| tempo di reazione (s) | 0.45–0.90 | 0.22–0.42 | 0.11–0.19 | 0.085–0.135 |

**`cornerFactor` sopra 1.0 non è barare**: `AI_CORNER_SAFETY` vale 0.90, quindi 1.16 significa chiedere il 104% della velocità *tabulata*, che è a sua volta calcolata sul raggio conservativo (filtro di minimo). Il valore 1.16 non è scelto a occhio: è il minimo misurato spazzando `cornerFactor` da 0.90 a 1.70 in giri singoli senza traffico su sei tracciati. Il tempo sul giro migliora fino a ~1.15–1.25 e poi **peggiora**, perché la vettura comincia a strisciare invece di girare (a 1.35 l'Oval accumula 3.4 s fuori pista). `maxCorner` per livello impedisce ai moltiplicatori pilota di superare quel tetto.

**`radiusOptimism`** decide quale raggio l'IA si fida di usare: 0 = il più stretto del vicinato (frena molto prima dell'apice), 1 = quello locale. Da solo vale l'1.5–8% sul giro.

**Traiettoria `fast`**: `getRacingLine('fast')` costruisce tre rilassamenti (600/1000/1800 sweep), ne misura analiticamente il tempo sul giro e tiene il più veloce. Su alcuni layout (Oval −2%) vince un rilassamento più profondo, su altri no — per questo viene misurato invece che assunto. È l'unico vantaggio strutturale riservato a Impossible.

`skillVariation` (0.8–1.1, persistito nel campionato) viene rimappato in un moltiplicatore di passo di ±3.5%.

### 4.6ter Qualifiche
`AI.qualifyingPace(driverName, difficulty, skillVariation, raining)` restituisce un giro secco nozionale: `0.60/cornerFactor + 0.40/straightFactor`, diviso per `sqrt(cleanAir)` (in qualifica si è sempre in aria libera) e per `sqrt(wetSkill)` se piove, più una dispersione di ±(5.5% + errorChance×25%) — un giro secco ha varianza vera, e di più per chi vive sul filo.

La griglia è l'ordine di qualifica; il giocatore viene inserito a metà schieramento (non ha girato, quindi non guadagna né perde nulla). Prima la griglia era un semplice shuffle, quindi tutto il passo e la personalità dell'IA non avevano alcun peso su dove si partiva. Misurato su 200 sessioni: Vettel P3.17 di media (miglior qualificatore, come da profilo), Fangio P7.66 — con abbastanza rimescolamento da non essere prevedibile.

`AI.buildProfile()` è la sola fonte di verità per i profili, usata sia dall'IA in gara sia dalle qualifiche.

### 4.6bis Stili di guida
`AI_DRIVER_STYLES` applica moltiplicatori *sopra* il profilo di difficoltà. Ogni pilota ha nove parametri, non uno:

| pilota | tratto dominante | come si vede in pista |
|---|---|---|
| Senna | `corner 1.045`, `wet 1.42`, `err ×1.6` | il più veloce sul giro secco, imprendibile sul bagnato, ogni tanto va oltre |
| Prost | `err ×0.25`, `brake 0.88`, `steerTau ×1.45` | frena prestissimo, mani immobili, non sbaglia mai |
| Schumacher | `brake 1.08`, `defend 1.00`, `wet 1.28` | metronomo, difesa durissima, fortissimo in pioggia |
| Verstappen | `brake 1.15`, `gap 0.75`, `steerTau ×0.70` | stacca più tardi di tutti, sta attaccato, non cede mai |
| Hamilton | `corner 1.030`, `lookBase +14`, `wet 1.26` | velocità d'ingresso enorme, guarda lontano |
| Alonso | `gap 0.72`, `overtake 1.0`, `defend 1.00` | ruota a ruota è il peggior avversario possibile |
| Vettel | `cleanAir 1.030`, `gap 1.15`, `overtake 0.75` | devastante in aria libera, meno a suo agio nel traffico |
| Clark | `steerTau ×1.40`, `err ×0.30` | sembra lentissimo, non lo è |
| Lauda | `brake 0.92`, `wet 0.90`, `err ×0.30` | calcolatore, nessun eroismo, soffre in pioggia |
| Fangio | `err ×0.30`, `corner 1.000` | vince alla velocità minima necessaria |

Due meccanismi esistono apposta per rendere visibili questi tratti:

- **`cleanAir`**: bonus di passo quando `followSpeed === Infinity`, cioè quando non c'è nessuno da gestire davanti. È ciò che rende Vettel uno specialista da pole e da fuga.
- **`wetSkill`**: moltiplicatore di grip in pioggia, letto sia da `ai.js` (per il profilo di velocità) sia da `car.js` (per la fisica), così l'IA guida davvero come pensa di poter guidare.

> **Nota sulla pioggia**: il fattore di grip bagnato è stato portato da 0.35 a **0.20**. In questo modello fisico il limite dominante è la velocità di imbardata (§3.4): sopra ~0.25 il clamp del grip laterale non entrava *mai* in saturazione alle velocità reali, quindi la pioggia costava solo qualche km/h di velocità di punta e tutto il talento sul bagnato era inerte. Misurato prima: penalità bagnato 0.0% per **tutti** i piloti. Dopo: Senna +0.0%, Hamilton +0.4%, Schumacher +0.4%, Verstappen +3.1%, Prost +5.2%, Vettel +7.6%, Lauda +9.3%.

### 4.7 Gestione dei contatti
Il modello di danno di `main.js` applica 2 HP **per frame** di contatto: 2,5 s di sfregamento continuo distruggono una vettura. L'IA quindi non deve solo evitare gli urti, ma soprattutto non deve *restare* attaccata. Tre meccanismi, tutti nati da bug osservati in simulazione:

1. **Rottura della simmetria in affiancamento**: se una vettura è lateralmente sfalsata di oltre 18px, l'IA non chiede mai una velocità inferiore alla sua. Senza questa clausola due IA si limitano a vicenda in retroazione positiva fino a strisciare a 6 px/s l'una contro l'altra finché entrambe esplodono.
2. **Chi insegue cede**: a contatto (< 30px) la vettura che si trova dietro riduce a `0.88 ×` la velocità dell'altra e si infila alle sue spalle. Senza, due vetture incastrate si spingono lungo la barriera fino alla distruzione.
3. **Cautela alla partenza** (`AI_START_CAUTION = 4.5 s`): `safeGap` maggiorato di 26px e target di velocità ridotto fino al 9%, in dissolvenza. È ciò che elimina i maxi-tamponamenti alla prima curva con griglie da 12 vetture in *hard*.

### 4.8 Bandiere blu
`main.js` (in `updatePhysics`) alza `car.blueFlag` quando una vettura **più di 0.55 giri avanti** in `trackProgress` (§3.2bis) sta arrivando da dietro. Serve anche che le due vetture stiano andando **nella stessa direzione** (assetti entro 1.0 rad): su Circo Massimo i due rettilinei quasi si toccano, quindi chi arriva in senso opposto è a pochi pixel e mezzo giro di distanza — cioè esattamente la firma di un doppiaggio, ma non lo è.

> Misurato su 10 gare con campo omogeneo (nessun doppiaggio reale): **253 bandiere spurie prima, 14 dopo** — e le 14 rimaste sono situazioni di doppiaggio genuinamente imminente. Il difetto è stato trovato leggendo il log di un campionato vero: era pieno di `BLUE` al primo giro, quando nessuno può ancora essere doppiato.

Condizioni geometriche: entro 215px, con proiezione longitudinale fra -205 e +45 e scostamento laterale sotto 95px (per non far scattare la bandiera a chi si trova su un altro tratto di pista). Il flag ha un timer di 0.8 s, così non sfarfalla fra un frame e l'altro.

- **Grafica**: `Car.draw()` disegna la vettura come **monoposto a ruote scoperte** nello stesso ingombro 24×14 della fisica: ala anteriore a tutta larghezza con paratie, ala posteriore più stretta, quattro pneumatici esposti (posteriori più larghi) con mozzi, monoscocca rastremata a muso stretto e coda pinzata, abitacolo scuro con halo. Sopra la vettura doppiata disegna una bandierina blu su asta, con un'ondulazione basata su `Date.now()`. La vede anche il giocatore quando sta per essere doppiato.
- **Comportamento IA**: `updateTraffic` porta l'offset laterale al bordo della carreggiata **dalla parte opposta** a quella da cui arriva il doppiatore (se è esattamente in scia, cede la traiettoria ideale) e applica `blueFlagLift = 0.88` al target di velocità, così il sorpasso è rapido e pulito. Misurato in simulazione: mentre la bandiera è esposta l'offset laterale medio è al 95-98% del massimo disponibile, cioè le vetture si spostano davvero.

### 4.9 Validazione
La logica è stata verificata con un harness headless (`vm` di Node, stessi `track.js`/`car.js`/`ai.js`, `dt` fisso a 1/60) su 10 tracciati × 4 difficoltà, con griglie da 6 a 12 vetture, gare da 3 e 5 giri, con e senza pioggia, su più seed. Criteri: tempo passato sull'erba, contatti con le barriere, tempo fermi, vetture distrutte, variazioni di posizione.

Risultato: **0 uscite di pista, 0 contatti con le barriere, 0 ritiri per danni**, con separazione monotona dei tempi sul giro tra i tre livelli su ogni tracciato.

Scala dei tempi sul giro dopo la ritaratura (miglior giro, 6 vetture, asciutto):

| tracciato | easy | medium | hard | impossible |
|---|---|---|---|---|
| Oval | 10.30 | 7.55 | 6.77 | 6.52 |
| F1 | 13.60 | 9.85 | 8.95 | 8.80 |
| Circle | 9.32 | 6.77 | 5.92 | 5.35 |
| Serpent | 16.93 | 12.32 | 11.10 | 10.80 |
| Pettine | 23.52 | 15.88 | 14.20 | 13.98 |

A *impossible* le vetture girano sul filo: compare qualche decimo cumulativo fuori pista (0.2–0.4 s su ~200 secondi-vettura). È voluto — è il livello in cui l'IA usa tutto il margine.

> Unico residuo noto: con **12 vetture su Pettine in *easy*** (il tracciato più lungo alla difficoltà più lenta) qualche vettura può superare i 20 s di distacco dal leader e cadere sotto la regola DNF del §6. È il regolamento a scattare, non l'IA a incepparsi: disattivando il timer tutte tagliano il traguardo. Se dovesse dare fastidio, il parametro da toccare è la finestra dei 20 s, non `AI_PROFILES`.

---

## 4bis. Virtual Safety Car e rimozione dei rottami (`main.js`)

Una vettura distrutta non resta in mezzo alla traiettoria:

1. `updateRecovery()` intercetta ogni auto appena passata a `isBroken` (esclusi i DNF da limite di tempo, che non sono incidenti) e apre una **recovery**.
2. Parte la **VSC**: `vscPowerFactor = 0.45`, letto da `car.js` per la forza motrice e da `ai.js` per il target di velocità, così anche l'IA rallenta invece di restare inutilmente a tavoletta. Banner giallo a schermo.
3. La **gru** attraversa tre fasi — `approach` (1.6 s), `lift` (0.9 s), `haul` (1.8 s, con smoothstep) — e deposita il rottame a `grassWidth + 55` px dalla linea centrale, cioè **oltre le barriere**, con clamp ai bordi del canvas.
4. A rimozione completata parte un **countdown di 3 secondi** mostrato sul banner con i decimi (`VSC_ENDING_MS`): la potenza resta limitata e l'ordine congelato finché il conto non arriva a zero, così la ripartenza non coglie mai nessuno a metà curva. Un nuovo incidente durante il conto lo annulla e la VSC torna piena.
5. Al termine del countdown la VSC rientra e la potenza torna piena.

Il rottame è escluso dalle collisioni fra vetture da quando è distrutto, e `Car.update()` esce subito per le auto in recupero o già rimosse: non è più un'auto, è scenografia.

## 4ter. Modalità e log

- **Free Practice** (`raceMode === 'practice'`): circuito e meteo scelti, nessun avversario, `TOTAL_LAPS` a 9999, niente qualifiche né bandiera. Ogni giro finisce in `car.lapTimes`; il pulsante **Stop Session** chiude e mostra la tabella dei tempi con il migliore evidenziato.
- **`racelog.js`** registra ogni sessione come lista di eventi tipizzati (`SESSION`, `LAP`, `BLUE`, `CONTACT`, `WRECK`, `VSC`, `RECOVERY`, `PENALTY`, `DNF`, `FINISH`) più la classifica finale. Consultabile dal menu, scaricabile come `.txt`, e replicato su `console.log` per la lettura dal vivo. `RaceLog.dump()` dalla console stampa tutto.

## 5. Audio Dinamico (Procedurale Web Audio)

Per massimizzare le performance e rimuovere dipendenze esterne (nessun MP3 da caricare), il gioco implementa un sintetizzatore interno basato su `AudioContext`.
- **Motore (`engineOscillator`)**: Generatore d'onda a "dente di sega" (`sawtooth`), fatto passare in un `BiquadFilterNode` passa-basso per smussare le frequenze altissime sgradevoli. La frequenza (il _pitch_) scala linearmente con la velocità dell'auto nel game loop, e il volume subisce leggeri drop se il gas (`inputs.up`) non è premuto.
- **Musica di Sottofondo (`BGM`)**: Un sequencer esegue l'array `melody` ciclicamente ogni 150ms usando oscillatori a onda quadra combinati con un *Envelope Generator* (rampe lineari/esponenziali nel nodo del Gain) per dare un attacco e rilascio a 8-bit alle note.

---

## 6. Il Sistema DNF (Did Not Finish) e Regolamenti

In pieno stile motorsport, l'architettura applica le seguenti regole competitive gestite nel main loop:
- **Partenza Anticipata (Jump Start)**:
  Le fisiche sono attive già nei 5 secondi di countdown (`gameState === 'countdown'`).
  Se lo spostamento vettoriale della `Car` supera lo `0.1` mentre `lightState < 6`, si alza il flag `jumpStartPenalty`. L'auto riottiene la penalità e viene teleportata alle coordinate originali di partenza. In questo istante **devono sempre essere svuotati gli array grafici** `globalSkidMarks` e `globalParticles`, altrimenti queste tracce "esploderanno" a schermo appena scatta il verde.
- **Spettatore & Risoluzione Gara (timer relativo)**:
  La gara non finisce al traguardo del leader, ma registra in quel momento la variabile `firstFinisherTime`. Da lì parte un timer visivo in overlay (`updateHUD`) di durata `dnfWindowMs = clamp(2 × miglior giro del leader, 8s, 45s)`.
  Erano 20 secondi fissi: su Pettine (giri da 24s a easy) significava mezzo giro di margine, sull'Oval (giri da 10s) due giri interi — stessa regola, severità completamente diversa. Misurato ora: 37s su Pettine/easy, 8s su Circle/impossible.
  Le auto in pista (player o IA) che terminano questo lasso di tempo e non hanno ancora tagliato il traguardo (che calcola l'incrocio tra la vettura e il primissimo segmento geometrico della pista, confrontato con l'accumulo totale dei lap), ricevono forzatamente un lap time `Infinity` e la loro struct interna assegna `isBroken = true` per considerarle "Did Not Finish".
- **Chi ha vinto (`finishIndex`)**:
  L'ordine di arrivo viene **registrato mentre accade**: a ogni frame, ogni vettura appena passata a `finished` riceve `finishIndex = finishCounter++`. Il banner "Finished First" usa `finishIndex === 0`, mai `sortedCars[0]`.
  Derivare il vincitore da un riordino ricalcolato ogni frame è fragile: basta un singolo incremento di giro anomalo per promuovere una vettura sopra il vincitore reale per un frame — ed è esattamente il frame in cui il banner scatta. Per la stessa ragione il comparatore usa `Math.min(lap, TOTAL_LAPS)`, e `car.js` smette di contare i giri una volta che la vettura è classificata.
  Il reset dopo una falsa partenza azzera anche tutto lo stato di gara (`lap`, `halfwayMarkerCrossed`, `waypointProgress`, `finished`, tempi): la gara ricomincia da zero, non solo le posizioni.
  - **N.B. per la Modalità Spettatore (AI vs AI)**: In questa modalità `playerCar` è nullo, ma **il timer dei 20 secondi ha la precedenza di sistema**. La gara si arresterà prematuramente *soltanto* se letteralmente tutte le vetture in pista (inclusi i DNF / esplosi) finiscono prima dei 20 secondi previsti. In questo modo il giocatore osserva in toto l'esito reale dello scontro IA senza tagli improvvisi della videocamera non appena si taglia la finish line in blocco.

---

## 7. Checklist di Manutenzione Futura
- **[CRITICAL] Modifiche alla Pista**: Qualsiasi resize al Canvas HTML (es. se verrà introdotta una minimappa e scroll laterale) **richiederà di riscrivere completamente il metodo drawPath in `SegmentedTrack`** per introdurre un _camera offset_ in fase di operazione ctx.
- **[CRITICAL] Aggiunta di UI HTML**: Ricordare sempre i null check `if (playerCar)`. La modalità Spectator causerà eccezioni letali nel thread principale di rendering se cerchi di stampare sul DOM le statistiche della vettura di un player inesistente. Usa `sortedCars[0]` per le statistiche del leader.
- **Aggiornamento Fisica Ghiaccio/Sterrato**: In futuro per il rally, aggiungi un tag stringa "terrain" in `SegmentedTrack` che restituisca specifici preset per la scalatura in `updatePhysics` (`slip threshold`, `drag modifier`, ecc.). Attualmente la divisione è hardcoded su "track" vs "grass".
