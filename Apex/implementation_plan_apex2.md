# Apex 2 — Technical Architecture & Implementation Blueprint

Questo documento è il **Game Design Document (GDD)** definitivo e la **guida all'architettura software** per il motore di gioco **Apex 2**. Qualsiasi sviluppatore, o Intelligenza Artificiale, deve essere in grado di ricostruire il gioco da zero leggendo questo file.

I file di gioco vivono in `Apex_2/`; l'originale in `Apex/` non va toccato. Le sezioni marcate **(Apex 2)** sono ciò che è cambiato rispetto a quello.

**Regola di questo documento:** ogni numero qui dentro è stato *misurato*, e dove una misura ha smentito un'ipotesi è scritto anche quello. Le ipotesi scartate valgono quanto quelle tenute — evitano di riprovarle.

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

`kerbWidthFor(seg)` adatta la larghezza allo spazio disponibile (`seg.r - trackWidth - 2`): su un tornante il cui raggio è appena maggiore della semi-larghezza il cordolo si assottiglia, e dove non c'è proprio spazio non viene disegnato. Con la geometria attuale tutti gli 11 tracciati hanno cordoli. Triangle era l'eccezione: i suoi archi avevano raggio 70, esattamente pari a `trackWidth`, quindi zero via di fuga interna e cordolo di larghezza negativa. Aprendo le tre curve a `r = 98` (e alzando il triangolo di 8px per farlo restare nel canvas) restano 26px di spazio, sufficienti per la fascia intera.

- **Cordolo**: grip ×0.80, attrito ×1.30, più una vibrazione laterale casuale proporzionale alla velocità. È fatto per essere usato: prendere un cordolo per raddrizzare una curva conviene.
- **Erba**: grip ×0.30, attrito ×2.50. Non conviene mai.

`kerbWidth` vale `clamp(trackWidth × 0.30, 14, 26)`. `ai.js` distingue i due casi (`onKerb` / `onGrass`) e reagisce di conseguenza, altrimenti tratterebbe un cordolo come un disastro e frenerebbe a sproposito.

### 2.4ter Tempo di reazione

Ogni vettura ne ha uno. Per un umano è l'istante del primo input dopo lo spegnimento dei semafori (`raceNow() - raceStartTime`, non `performance.now()`: lo stall guard sposta `raceStartTime` quando un frame va perso, e i due vanno letti sullo stesso orologio o una scheda in background inventa reazioni di secondi). Per l'IA è il ritardo che `AI_DRIVER_STYLES` tira alla partenza — Prost 0.45-0.90s, Verstappen 0.085-0.135 — quindi la colonna dice qualcosa anche sugli avversari.

Era già misurato e non veniva mostrato da nessuna parte: `reactStr` esisteva nella tabella dei risultati ma non c'era la `<td>` corrispondente. Ora la colonna **React** c'è, il più rapido allo spegnimento è evidenziato, e una partenza anticipata — che si legge come una reazione prossima a zero, perché tale è stata — porta il segnale di penalità.

Nota sul comportamento: dopo una falsa partenza la reazione viene ricronometrata dai semafori del **restart**. E se si resta sul gas, si riparte falsi all'infinito: i tasti non vengono azzerati dal reset della griglia, quindi l'unico modo di ripartire è alzare il piede.

### 2.4quater Telaio (Apex 2)

Tre vetture, scelte **una volta per stagione** e non più cambiabili. La regola di progetto è la stessa delle gomme e degli stili di guida: nessuna delle tre deve essere *la* buona.

I compromessi sono appesi alle leve che la fisica ha davvero, non a numeri decorativi:

| | `steer` | `top` | `power` | `grip` | `wear` |
|---|---|---|---|---|---|
| **Aero** | 1.030 | 0.928 | 1.000 | 1.00 | 1.15 |
| **Bolt** | 0.978 | 1.098 | 1.000 | 0.98 | 1.00 |
| **Ridge** | 0.992 | 1.005 | 0.985 | 1.04 | 0.88 |

Misura finale (24 gare, 9 vetture, tre per telaio a rotazione): all'asciutto 4.89 / 5.22 / 4.89 di posizione media, nel bagnato 6.06 / 4.33 / 4.61, e pesando la stagione reale (80% asciutto) **5.12 / 5.04 / 4.83 — 0.29 posizioni di scarto** su nove vetture.

- `steer` è la **velocità di sterzata**, cioè il limite che vincola quasi ovunque (`v = maxSteer / (1/R + maxSteer/500)`). È il numero più prezioso della vettura.
- `top` = `enginePower / baseFriction`. Il carico aerodinamico si paga in resistenza: chi curva meglio è il più lento in rettilineo.
- `power` alimenta anche `powerOversteer` (`demand = enginePower / speed`): la vettura muscolare *è* quella che scoda, non serve un fattore separato.
- `grip` è il limite laterale: nell'asciutto non si vede, nel bagnato è ciò che tiene su la macchina.
- `wear` entra in `tyrePerf`, che moltiplica la velocità di sterzata: gomme che durano sono passo vero nell'ultimo terzo di gara.

**Il tasso di cambio, misurato** (`chassis_sens.js`, una leva alla volta su tutti gli 11 circuiti), in % di tempo sul giro per 1% di leva:

| | asciutto | bagnato |
|---|---|---|
| steer | −0.351 | −0.174 |
| top | −0.160 | −0.115 |
| power | −0.101 | −0.152 |
| grip | −0.012 | −0.161 |
| brake | ~0 | ~0 |

Il primo tentativo dava +8.5% di sterzata contro −5.5% di velocità massima: sembrava un compromesso, ma la sterzata vale 2.2 volte la velocità massima, e quella vettura era più veloce su 8 circuiti su 11 e del 2.45% in media.

**La cosa più interessante emersa, e non riguarda queste tre vetture ma le corse.** Passo uguale in una prova cronometrata non significa risultati uguali in **gara**: un vantaggio di velocità massima viene in gran parte restituito dalla **scia** — ce l'ha anche chi ti segue — mentre un vantaggio in curva no. Misurato: la vettura potente era pari sul giro secco e finiva 1.2 posizioni più indietro a gara. `chassis_why.js` ha prima escluso la spiegazione ovvia: non si ritirava di più (0 ritiri su 18, salute 94.3% contro 94.7% e 96.3%). Mostrava però il 16% di sovrasterzo di potenza in più, un costo che esiste in gara e non in prova, perché nel traffico si accelera e si sterza insieme molto più spesso. Il suo motore è stato quindi convertito in **resistenza** (`power` 1.05 → 1.00, `top` 1.06 → 1.098): stesso passo, stessa identità, senza una tassa che si paga solo quando si lotta.

**Dove sono finite.** Con il 20% di gare bagnate di una stagione, le tre finiscono entro ~0.2 posizioni medie l'una dall'altra, ma per strade diverse: Aero domina l'asciutto e affoga nel bagnato, Ridge l'opposto, Bolt sta in mezzo e vince sui tracciati veloci. Sul giro secco la media di calendario resta entro lo 0.35%.

**L'IA sceglie per stile** (`AI.chooseChassis`): chi fa il tempo in curva prende l'Aero, chi lo fa in rettilineo il Bolt, chi ha mani morbide e non consuma il Ridge, e chi va forte in acqua guarda al `grip`. È un **sorteggio pesato** sui punteggi, non un massimo: una regola deterministica metteva tutta la griglia nella stessa vettura. `AI.assignChassis` estrae per l'intera griglia e ripesca chi è finito in una vettura sovraffollata, così su dieci macchine non se ne vedono mai più di cinque uguali.

**Dove si legge.** Il telaio ha una **colonna propria** nella tabella finale (era attaccato al nome e la colonna veniva fuori frastagliata), compare nella torre dei tempi subito a destra della mescola — in gara e in qualifica — e nell'HUD accanto alla propria gomma. Nella torre i codici pilota hanno larghezza fissa (`flex: 0 0 34px`), così le mescole formano una colonna dritta invece di ballare con la lunghezza del nome.

**Graficamente** le tre si distinguono nello stesso ingombro 24×14: alettoni larghi a due elementi e muso lungo per l'Aero, alettoni ridotti, pinna e gomme posteriori più grasse per il Bolt, fiancate piene e spalle alte per il Ridge — più una fascia del colore del telaio sul muso, che è quello che si legge davvero a velocità.

### 2.4quinquies Comandi mobili (Apex 2)

Su desktop **non cambia niente**, ed è verificato in modo forte: un giro di 600 frame guidato da tastiera atterra sugli stessi identici numeri della build precedente (differenza totale 0.000000 su posizione, angolo e velocità), perché la build vecchia viene ricostruita a runtime togliendo il codice nuovo e le due girano fianco a fianco.

Su telefono: **due pulsanti di sterzo a sinistra**, dove sta il pollice, e a destra una **striscia** che è acceleratore sopra la metà e freno/retromarcia sotto. Quanto sei lontano dal centro è quanto ne ottieni.

Perché serviva toccare la fisica: acceleratore e freno erano booleani. Ora `inputs.throttle` e `inputs.brake` sono 0..1, e chi li scrive scrive **anche** i booleani, perché il modello del sovrasterzo, l'IA e il cronometro della reazione leggono quelli. Una tastiera non li scrive mai, quindi risolve esattamente a 1 o 0. Il sovrasterzo di potenza scala con l'acceleratore effettivamente dato: dosarlo dolcemente è come si tiene il posteriore dietro.

Dettagli decisi guardando il pollice, non lo schermo: tutta la striscia è il comando (dove appoggi è dove va la leva), c'è una zona morta del 7% attorno al centro, e **al rilascio torna in folle** — una leva che restasse dov'è significherebbe entrare in curva a tavoletta perché hai tolto il pollice per sterzare. In più, su telefono i dati del pilota si spostano in **cima** alla colonna e la torre va sotto, così l'angolo in basso a sinistra — dove stanno i pulsanti dello sterzo — è strada e non la cosa che stai cercando di leggere.

### 2.4sexies Il muro che si vede è il muro che c'è (Apex 2)

Il muro era dipinto e calcolato in due posti diversi. `checkBarrierCollision()` ferma una vettura quando l'asse stradale **più vicino** dista più di `grassWidth − 12` (12 è il raggio di collisione dell'auto); la barriera invece era dipinta come un anello a `grassWidth`. Su un circuito largo le due cose si leggono come una sola. Su Lombard no: la sua fascia è più larga della strada di 14px, quindi dopo i 12px dell'auto restano **due pixel** di via di fuga — ti fermi sul bordo dell'asfalto mentre la barriera dipinta è 14px più in là, dall'altra parte di una striscia verde. E dove un altro tratto passa vicino, quell'anello è coperto dalla sua erba e non c'è proprio nulla da vedere: auto ferma contro il niente.

Due correzioni, entrambe emerse dalla misura.

**1. Il muro non può stare dentro l'asfalto.** `wallRadius() = max(grassWidth − 12, trackWidth + 2)`, usata sia dalla fisica sia dal disegno. Su **Pettine** (strada 70, fascia 75) le vetture venivano fermate **7px dentro** il tarmac, e su **Crown** 2px: da sempre, da quando sono stati disegnati. Ora c'è un pavimento.

**2. La barriera tricolore, in tre versioni.** Verde, bianca e rossa, e c'è voluto un po' per metterla dove va.

*Prima versione:* uno stroke largo `grassWidth*2 + 10`, tratteggiato, disegnato **sotto** l'erba — se ne vedeva un anello di 5px, tranne alle curve dove le giunzioni arrotondate lo gonfiavano lasciando **barre staccate** sull'erba e sopra i cordoli. Nicola ha chiesto cosa fossero: era la vecchia barriera che trapelava.

*Seconda versione:* tolta la banda, il muro veniva disegnato come una riga bianca da 5px con trattini rossi lungo la linea di arresto. Geometricamente corretta — passava esattamente dove l'auto si ferma — ma una riga sottile piatta sull'erba **si legge come vernice**, come una cosa su cui si passa. Che è esattamente com'è sembrata.

*Terza versione:* pannelli verde/bianco/rosso con un'ombra alla base, dipinti **un raggio-auto oltre la linea di arresto**: quando ti fermi la stai toccando. Su 15 circuiti su 17 questo coincide con `grassWidth`, dove il verge è sempre stato disegnato; Pettine e Crown avevano la fascia più stretta della propria barriera e l'erba viene ora disegnata fino a `max(grassWidth, barrierRadius())`, così l'armco non galleggia sullo sfondo (+9px e +4px).

*Quarta versione, e la correzione che conta:* **le barriere fantasma.** La terza chiedeva l'insieme di livello a `wallRadius() + 12` — una barriera *più larga*, ricalcolata da zero. Ma vicino a qualsiasi rientranza i due insiemi non sono curve parallele: dove la strada torna su se stessa quello più largo **si richiude sopra la tacca e semplicemente non c'è**, mentre la fisica continua a fermare le auto lì dentro. Nicola ci è finito dentro a Lombard. Misurato allora: **Pettine aveva 996 punti di griglia** in cui un'auto si ferma e la vernice più vicina era fino a **171px** lontana — fra i denti del pettine non c'era barriera affatto — e Lombard 16 punti fino a 30px.

Ora la barriera è uno **scostamento** del confine fisico, non un secondo raggio: si calcola l'insieme di livello a `wallRadius()` e ogni punto viene spinto in fuori di 12 lungo la propria normale. Il test di appartenenza resta sul punto a `wallRadius`, ed è questo che tiene la vernice legata alla fisica. Un fantasma diventa **impossibile per costruzione**: ogni punto che ferma un'auto ha una barriera a 12px, perché la vernice *è* quel punto spostato. Misurato su tutti e 17: peggior scarto **11.9px**.

Due dettagli che il test ha trovato:

- il verde **non** è quello dell'erba. Il verge è `#2e7d32` e il prato `#3f8f45`; il verde della bandiera `#009246` accanto a quelli si legge come altra erba. È `#00d152`, a 101 e 92 punti RGB dai due;
- i tagli fra un pannello e l'altro si trovano per **lunghezza d'arco** e si interpolano, non si prendono dai vertici del run. I run escono da Douglas-Peucker, quindi un rettilineo è due punti per quanto sia lungo: tagliando sui vertici ogni rettilineo veniva dipinto di un colore solo, e il tricolore compariva solo nelle curve;
- la lunghezza del pannello è **per run**, `max(3.5, min(26, L/3))`. Con un valore fisso un run corto — l'interno di un dente di Pettine, il collo fra due lobi di Lombard — riceveva un pannello e un mozzicone, usciva tutto verde, e il verde pieno sull'erba si legge come *nessuna barriera*. Ora ogni run mostra tutti e tre i colori per quanto sia corto;
- **i cordoli non possono finire sotto la barriera.** `kerbWidth` è il 30% della strada, e su parecchi circuiti è più largo di tutto il verge: Peanut ha strada 70, verge 85 e cordolo 21, quindi il cordolo arrivava a 91 dalla mezzeria mentre l'armco sta a 85 — erano dipinti uno sull'altro. Nessuno se n'era accorto finché lì non c'era una barriera. `kerbWidthFor()` ora ha un terzo limite, `barrierRadius() − trackWidth − 4`, applicato lì e non in `draw()` così che anche `getSurface()` sia d'accordo con la vernice. I cordoli restano larghi 8-24px e finiscono 1-3px prima della barriera. La parte *raggiungibile* del cordolo non cambia su nessun circuito: il muro morde comunque prima.

Il test non legge il sorgente: passa al circuito un canvas che **registra ogni tratto**, e poi chiede dove sono finiti il bianco e il rosso. Su tutti e 17 ogni marcatura sta o su un cordolo o sulla barriera, con uno scarto massimo di 0.7px, e niente è dipinto sulla strada.

**3. Il muro viene disegnato dov'è.** `getWalls()` calcola l'insieme di livello «distanza dall'asse più vicino = `wallRadius()`»: campiona entrambi i lati dell'asse ogni 2px e tiene solo i punti a cui **nessun altro tratto** è più vicino — che è esattamente il bordo della zona percorribile, anche dove due tratti si accostano e il bordo non è più un semplice parallelo. Il risultato viene disegnato **dopo l'asfalto**, quindi non può essere coperto.

Due casi che non si vedevano a occhio e che il test ha trovato:

- ai **giunti** l'offset perpendicolare lascia un cuneo scoperto sull'esterno della curva: serve un ventaglio di direzioni attorno al vertice (Thunder aveva un buco di 15px);
- `getClosestPoint` ripiega sugli **estremi** di un arco per i punti fuori dal suo settore, quindi il confine può girare attorno a un estremo più di quanto giri il vertice: si percorre un cerchio intero attorno a ogni estremo e si tiene ciò che supera il test (altri 18px di buco su Thunder).

Il test non ricalcola la stessa formula: passa una **griglia** sull'arena, tiene i punti che stanno sul confine (`|dist − wallRadius| ≤ 0.9`) e chiede quanto dista il muro disegnato più vicino. Su tutti e 17 i circuiti il peggior scarto è **2.1px**, e nessun muro viene disegnato dove si può guidare. *La prima versione del test prendeva i punti di confine dalle normali della traiettoria ideale, che sono **lisciate**: pochi gradi di differenza a 72px di offset fanno dieci pixel, e segnalava buchi nel muro che erano buchi nella misura.*

### 2.4septies Un urto non chiude la sessione

Dal log di una qualifica a Crossover: vettura distrutta 1.6s dopo l'inizio del secondo giro lanciato, sessione finita. Un solo contatto.

La curva del danno contro le barriere — `260 · ((v·n − 88)/100)²` — era stata tarata su circuiti dove il muro si può **solo sfiorare**. Misurato: sugli undici originali la barriera sta a **88-89° dal muso**, cioè di striscio. Due dei nuovi tornano su se stessi — dentro un uncino di Lombard e nei cunei accanto all'incrocio di Crossover — e lì il muro sta a **0-2° dal muso**. Un tocco a 260 px/s costa 346 HP su 255: distruzione istantanea.

Ora un singolo impatto non può togliere più del **62% della vita**, misurato su ciò che l'auto perde davvero (quindi vale lo stesso per il giocatore, il cui danno è già scalato in `takeDamage`). Uno scontro pesante rovina comunque la gara — resta il 38% — e il secondo la chiude. Sfiorare il muro continua a costare zero.

### 2.4octies La scelta del telaio, in un posto solo

C'erano due controlli per una sola decisione: la tendina nel menu e la schermata di inizio stagione. La tendina è sparita. Il telaio si sceglie sempre sulla stessa schermata: **una volta per stagione** nel campionato, **una volta per weekend** altrove — non di nuovo fra qualifica e gara (`weekendChassisAsked`, azzerato quando si torna al menu).

### 2.5 Scia (slipstream)
`car.draftStrength` è continuo in 0..1, prodotto di quattro attenuazioni (distanza, cono, allineamento delle prue, e la *velocità* di chi la genera: sotto 15 unità di avanzamento un'auto non lascia scia, la scia è piena da 45), invece del booleano di prima che dava +15% di colpo entrando nel cono e zero uscendone. La geometria non è più un **cono angolare** ma un **corridoio di scia**: semilarghezza `WAKE_HALF + WAKE_SPREAD * distanza` (11px + 0.085/px), cioè 14px a 40px di distanza e 27px a fondo scala, contro i 16px e 74px del vecchio cono a ±0.40 rad. Il cono, essendo angolare, a distanza diventava più largo della carreggiata: misurato su 64.000 traini, un terzo andava a un'auto oltre 20px fuori asse (l'auto è larga 14px, quindi zero sovrapposizione) e un sesto oltre 30px, cioè affiancata e non dietro. Col corridoio la mediana è 4px fuori asse e il caso peggiore 20px. Effetto sulla gara misurato su 12 gare complete: sorpassi 2.68 → 2.80 (invariato), auto in scia in un dato istante 6.63 → 3.52. In più il donatore deve essere **davanti sulla strada** (0 < gap d'arco < 250px, calcolato modulo giro su `lapS`): il solo cono geometrico veniva ingannato in curva — il 44% della scia misurata arrivava da un'auto in realtà dietro, inseguitore compreso. Effetto: `+18%` di spinta e `-22%` di resistenza, entrambi scalati dalla forza della scia.

---

## 3. Gestione del Tracciato (`track.js`)

I tracciati non sono tilemap, ma curve parametriche vettoriali per permettere fluidità assoluta ad alte velocità.

### Il mondo: 1280x720

Il canvas era 1000x700, cioè 10:7. Su uno schermo 16:9 la CSS lo scalava mantenendo le proporzioni e restavano due bande verdi ai lati: non era che i tracciati fossero piccoli (usavano già il 90% della larghezza in media), era il letterbox. Il mondo è quindi passato a **1280x720**, esattamente 16:9, e i tracciati sono stati riallargati per riempirlo. `WORLD_W`/`WORLD_H` in `main.js` e `TRACK_W`/`TRACK_H` in `track.js`: nessun limite di canvas è più scritto a mano.

**La colonna dell'HUD.** L'HUD non era mai stato "sopra" la pista: stava nelle bande verdi del letterbox, che a 10:7 su uno schermo 16:9 erano larghe un quinto dello schermo. Passando a 16:9 quello spazio sparisce. Il primo tentativo fu un **ticker orizzontale** in alto piu' una **barra** in basso, con i tracciati nella fascia fra le due. Non ha funzionato: dieci vetture allineate su 1280px di ticker sono illeggibili — una torre dei tempi si legge dall'alto in basso, non da sinistra a destra — e due bande costavano ai tracciati due morsi invece di uno.

Ora c'è **una sola colonna a sinistra**, larga `PANEL_W = 210` pixel di mondo (`TRACK_X0` in `track.js` è lo stesso numero), che contiene nell'ordine: la striscia VSC, la torre dei tempi (una riga per vettura, ancorata in alto), i dati del pilota o le due card del multigiocatore (ancorate in basso con `margin-top: auto`). Tutto ciò che sta a destra, per tutta l'altezza, è pista: `ARENA_X0 = 210`, `ARENA_X1 = 1280`, `ARENA_Y0 = 0`, `ARENA_Y1 = 720`. Gru, rottami ed etichette usano questi quattro numeri, non più le vecchie bande.

**Un avvertimento che è già costato una segnalazione.** Il CSS conteneva un *secondo* blocco `#timing-tower` più in basso nel file, avanzo della torre verticale della v9. Stessa specificità, definito dopo: vinceva lui. La torre nuova veniva quindi disegnata con le regole vecchie (`position: absolute; top: 60px`, larghezze fisse per colonna) dentro il contenitore nuovo, ed era questo — non il concetto di ticker — a renderla illeggibile. `apex_layout.js` ora conta i blocchi: `#timing-tower`, `#hud`, `#side-hud`, `#hud2`, `#sidebar` devono essere definiti **una volta sola**.

Perché la riserva sia esatta a qualunque dimensione di finestra, l'HUD di gara vive dentro `#stage`: un riquadro di 1280x720 posizionato esattamente sopra il canvas e scalato con lui (`--stage-x/y/scale`, ricalcolati al resize). Senza, la colonna sarebbe riservata in pixel di mondo e l'HUD disegnato in pixel CSS, e i due coinciderebbero solo a una particolare dimensione. I menù restano fuori dallo stage, a scala di finestra, così il testo non rimpicciolisce.

**Come sono stati riallargati.** Non per scalatura — una scalatura non uniforme trasformerebbe gli archi in ellissi. Un tracciato è una catena chiusa di rette e archi tangenti fra loro; **traslando** un arco la catena resta tangente purché, per ogni retta che unisce due archi, le due traslazioni differiscano solo *lungo* quella retta. È un vincolo lineare per retta (due archi uniti direttamente devono muoversi insieme). Si chiede quindi la traslazione che verrebbe da una scalatura e la si **proietta** sui vincoli. Risultato: ogni raggio, ogni ampiezza, ogni velocità di percorrenza sopravvive intatta — si allungano solo i rettilinei.

Lo stesso strumento ha rifatto il lavoro quando la colonna ha preso i 210px di sinistra: si chiede una compressione in x e un allungamento in y attorno al centro, si proietta sui vincoli, si ricostruiscono i rettilinei fra gli archi spostati. I raggi sopravvivono tutti, quindi **ogni curva si percorre esattamente alla velocità di prima**; cambiano solo le lunghezze dei rettilinei (fra -1% e -18% di sviluppo a seconda del tracciato). L'allungamento verticale è tappato a 1.30: oltre, un circuito smette di somigliare a se stesso.

**La distanza minima fra due tratti di strada.** La barriera viene disegnata a `grassWidth` dall'asse (piu' 5px di bordo), quindi due tratti di strada **non adiacenti lungo il giro** devono stare ad almeno `2 x grassWidth + 10` l'uno dall'altro. Sotto quella soglia le due barriere si attraversano, non ne viene disegnata nessuna, e sullo schermo si vede una lastra unica di asfalto senza muro. È successo su **Thunder**: la compressione ha portato il collo fra le due gobbe da 168px a 147, contro i 170 che servono.

Due errori di misura da non ripetere:
1. la prima verifica misurava sulla **traiettoria ideale**, non sull'asse stradale. La traiettoria taglia le curve, quindi due suoi tratti possono risultare piu' distanti delle strade a cui appartengono: dava 147 "a posto" quando la strada non lo era.
2. la soglia usata era `trackWidth + grassWidth` invece di `2 x grassWidth`. Con quella, Thunder risultava a posto anche **prima** della compressione — e invece già allora, a 168px contro 170, i bordi delle due barriere si sovrapponevano di 2px.

**Come è stato aperto il collo.** Una richiesta affine (comprimi in x, allunga in y) non può aprire una strettoia locale, e a raggi bloccati la forma aveva esaurito la sua libertà a 174px. Il vincolo di tangenza però resta lineare anche se si lascia libero il **raggio**: l'estremo di un arco sta in `c + r·u(θ)`, quindi sotto `(t, dr)` si sposta di `t + dr·u(θ)`, e la condizione sul rettilineo diventa `(t_B + dr_B u_B)·n = (t_A + dr_A u_A)·n`. Con tre incognite per arco invece di due, una risalita stocastica nello spazio lecito (proponi, proietta, tieni se il collo si è allargato e tutto sta ancora nell'arena) porta Thunder a **220px**, con i raggi che *crescono* (97→118, 97→122, 92→113) invece di stringersi. `apex_tracks.js` verifica ora questa distanza su tutti e 11.

Il Circo Massimo è l'eccezione dichiarata: i suoi due rettilinei sono fatti per correre affiancati e ciò che li divide è la **spina**, disegnata da `CircoMassimoTrack.draw()` e non dalla passata ordinaria delle barriere. Per lui la regola è solo che le due strade non si sovrappongano.

Due tracciati non hanno alcun grado di libertà — **Peanut** e **Circle** non hanno rettilinei, ogni arco tocca il successivo, quindi l'unica mossa lecita è una similitudine. Quelli vengono scalati uniformemente (Peanut -19%, con i raggi che scalano con lui; Circle cresce, tappato a +15%). **Triangle** ne ha uno solo, la crescita isotropa: si stringe in entrambe le direzioni e non può riempire l'altezza.

**Crown** è l'unico tracciato in cui la strada torna indietro su se stessa: fra le due punte c'è una esse, cioè un arco con `ccw` opposto a tutti gli altri. È stato costruito con un raccordo di vertici (fillet) che gestisce anche i vertici concavi, e verificato numericamente prima di entrare nel gioco: giunzioni a gap zero, ingombro con barriere dentro il canvas, e distanza minima fra due tratti non adiacenti di 151px contro i 116px di larghezza pista, così `getClosestPoint` non può agganciare una vettura al tratto sbagliato.

**Calendario del campionato**: i tracciati vengono mescolati (Fisher-Yates) all'inizio di ogni stagione, e il meteo viene tirato *dopo* la mescolata, così `weather[i]` appartiene al round `i`. Un calendario fisso faceva imparare la stagione invece dei tracciati.

### 3.0bis Le cinque piste di Apex 2, e come sono state costruite

Non scrivendo archi a mano: ognuna è un **anello di vertici con un raggio per vertice**, e un raccordo (fillet) lo trasforma nella catena retta/arco che il gioco vuole, con ogni giunzione tangente per costruzione (`build_tracks.js`).

- **Boomerang** — una lunga curva veloce su un lato, un tornante in fondo, poi un tratto tecnico corto.
- **Zipper** — tre cambi di direzione rapidi appesi fra due curvoni: chiede solo quanto bene la tua macchina cambia direzione.
- **Kettle** — un curvone a raggio costante in cui si resta dentro parecchio, e una curva davvero lenta alla fine.
- **Harbour** — stretto e murato: rettilinei corti, frenate tardi, il posto più difficile del calendario per passare.
- **Crossover** — l'incrocio (sotto).

**Il bug del costruttore, che vale la pena ricordare.** Un raccordo consuma `t = r/tan(θ/2)` di bordo da entrambi i lati del vertice. Se i due raccordi di uno stesso lato ne vogliono più di quanto il lato ne abbia, il "rettilineo" fra loro esce **rovesciato** — e un rettilineo rovesciato non è un rettilineo corto, è un tornante che il progettista non ha mai disegnato. Su Crossover ne era nato uno di **raggio 12px**: la traiettoria ideale ci passava dentro a 25 px/s, le auto strisciavano, e la gara finiva con 3 vetture su 8 al traguardo e il 17% del tempo fuori pista. Ora i raggi vengono rientrati finché ogni lato può pagarsi i due angoli che lo condividono, e un controllo verifica che nessun rettilineo punti contro il lato a cui appartiene.

**Dove va il traguardo, e perché non è una scelta libera.** `checkLapCross()` conta un giro quando la x dell'auto passa `startX` andando **verso destra** con `|y - startY| < grassWidth + 100`. Quel test non sa su quale pezzo di strada sei, quindi un traguardo è valido solo se **nessun altro tratto** del circuito attraversa quella x, nella stessa direzione, dentro quella fascia. Zipper l'aveva su un rettilineo percorso da destra a sinistra: zero giri completati da chiunque, per l'intera gara. `fix_starts.js` sceglie il rettilineo — lungo, orizzontale, percorso verso destra e **univoco** — e verifica tutti e 16 i circuiti.

### 3.0quater Lombard, e la lunghezza della stagione

**Il circuito.** È la **rosa camuna** della bandiera lombarda — con **tre** braccia invece delle quattro della bandiera, perché quattro sono inguidabili.

La versione a quattro è stata costruita per prima, direttamente dal path SVG della bandiera: otto archi, un uncino riflesso alternato a un lobo lungo, giunzioni che chiudono a 0.0000px. È la forma, esatta. Ed è anche un corridoio: quattro braccia a 90° in un riquadro quadrato lasciano così poco spazio fra loro che la carreggiata può essere solo **32**, e a quella larghezza non si corre.

Quindi la rosa è stata **ricostruita in forma parametrica** dalle proporzioni della bandiera, invece che ridisegnata:

- N lobi su un anello di raggio A, uno ogni 360/N gradi;
- N uncini su un anello di raggio B, a metà strada fra i lobi;
- ogni giunzione è una **tangenza esterna** fra un cerchio-lobo e un cerchio-uncino: è quella a invertire la curvatura e a fare di un uncino un uncino, quindi i lobi si percorrono tutti in un verso e gli uncini nell'altro, e ogni giunto è liscio per costruzione.

La tangenza fissa la dimensione: `A² + B² − 2AB·cos(π/N) = (Rlobo + Runcino)²`. Verificato contro la bandiera stessa: a N=4 con i suoi rapporti la ricostruzione la riproduce arco per arco, lobi 281° e uncini −191°.

A N=3 i centri sono a 120° invece che a 90°, troppo lontani perché i raggi della bandiera li raggiungano: l'equazione **non ha radice** e i cerchi devono crescere. Meno braccia, più grandi — ed è esattamente per questo che c'è spazio per una strada.

L'ultima scelta libera è quanto profondi siano gli uncini, ed è un baratto diretto con la larghezza, misurato invece che indovinato (`lombard.js sweep`):

| ampiezza uncino | strada più larga possibile |
|---|---|
| 187° | nessuna strada ci sta |
| 167° | 34 |
| 154° | 46 |
| **148°** | **52** ← scelta |

cioè la strada più larga che la rosa può portare restando una rosa. In gara: 8 vetture su 8 al traguardo, 1.7% del tempo fuori pista, giri da 14.3s.

*Un errore di misura da ricordare*: il primo sweep riportava uncini da 142-160° per archi che in realtà erano da 191°, perché la formula ignorava il flag di verso. Era sbagliata la misura, non la forma — e per un attimo sembrava che la costruzione parametrica non producesse affatto una rosa.

**La lunghezza della stagione.** Il menu ha un menu a tendina *Season Length* (default 10), con la targhetta CHAMPIONSHIP sotto il selettore.

La tendina non è scritta nell'HTML: viene **costruita da `SEASON_POOL`**, la lista dei circuiti. Così la stagione più lunga offerta è esattamente il numero di circuiti che esistono (17), e aggiungerne uno la allunga da solo — non c'è un secondo posto da ricordarsi di aggiornare. Il calendario viene estratto dalla stessa lista **senza reimmissione**, quindi una stagione non visita mai due volte lo stesso posto.

Il valore viene comunque *clampato* e non creduto — una tendina non si può digitare, ma è il clamp a decidere: vuoto → 10, `0` o negativo → 1, `999` → 17, testo → 10.

### 3.0ter Crossover: l'incrocio e il ponte

Due anelli uniti da due lunghe diagonali che si incrociano **fra i vertici**, non su un vertice: è questo a renderlo un incrocio vero e non due curve vicine. Non è un otto preciso: la metà destra è un unico curvone veloce, la sinistra è stretta e ha una curva in più.

**Perché un incrocio è possibile.** Ogni vettura si localizza sulla traiettoria a partire da dov'era **il frame prima** (`car._nodeIdx`, `ai.nodeIdx`), cercando solo in una finestra intorno. Le due strade si toccano nello spazio ma sono mezzo giro di distanza come indice, quindi né il contachilometri né l'IA possono saltare dall'una all'altra.

Restava un buco: dopo un testacoda o una speronata la ricerca torna **globale**, e lì il nodo più vicino può appartenere all'altra strada. È successo: vetture riagganciate alla metà sbagliata, che giravano in un solo lobo dell'otto senza mai passare sul traguardo (0 giri completati). Ora la ricerca globale prende il nodo **più vicino**, e lascia che sia la direzione di marcia a decidere **solo quando c'è una vera ambiguità**: un altro nodo altrettanto vicino nello *spazio* ma lontano lungo il *giro*. Che è esattamente cos'è un incrocio, e non somiglia a nient'altro su nessun circuito.

*La prima versione preferiva il nodo allineato punto e basta, e cambiava silenziosamente ogni circuito: dieci vetture ferme sullo stesso punto leggevano dieci distanze diverse (151px di scarto) perché puntavano da parti diverse, e la scia — che si basa sullo stesso numero — cominciava a regalare traini a vetture 22px fuori linea. L'hanno trovata due harness che non avevo ancora copiato su Apex 2: passavano sull'originale e fallivano qui.*

**Il ponte.** `getBridge()` non è scritto a mano: trova dove due tratti lontani lungo il giro si avvicinano nello spazio, e quello è l'incrocio. Restituisce le due finestre in **lapS** — la stessa unità che le auto già portano — quindi "questa vettura è sotto il ponte?" è un confronto, senza geometria a tempo di rendering.

- **Disegno**: prima le vetture che stanno sotto, poi la campata, poi quelle che ci sono sopra, e **infine i cartellini di tutti** (nome e barra della salute). Per questo `Car.draw()` è stato spezzato in `draw(ctx, skipTags)` e `drawTags(ctx)`: sotto il ponte la macchina non si vede, ma si vede chi è e come sta.
- **Fisica**: due vetture nello stesso pixel possono essere a dieci metri di distanza in verticale. `track.sameLevel(a, b)` è consultato dalle collisioni, dalla scia e dal traffico dell'IA, altrimenti l'incrocio diventa un demolition derby fra auto che non si vedono nemmeno.

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

- **Car following**: se qualcuno occupa la nostra traiettoria (`|side| < 30`), il target di velocità viene cappato a `v_loro + (gap - safeGap) * gapGain`. Gap negativo ⇒ si frena. Questo, e non un generico "rallenta", è ciò che ha azzerato i tamponamenti a catena.
- **Sorpasso**: contemporaneamente l'offset laterale si sposta verso il lato con più spazio (rate-limited a 110 px/s, con isteresi sul lato scelto). Appena si è affiancati il cono di *following* non è più soddisfatto e l'IA riapre il gas.
- **Ruota a ruota**: repulsione laterale pura, mai frenata.
- **Slipstream**: `car.isDrafting` (calcolato in `main.js`) alza il tetto di velocità del 10%.

#### 4.4bis La coda che si apriva a ventaglio (Apex 2)

Misurato su una gara di sole IA a **Circle** — un unico curvone, dove il giro esterno è quasi il doppio dell'interno — otto vetture su dieci passavano il **100% della gara** entro 160px da un'altra e giravano **dal 19 al 26% più lente** del proprio passo solitario. Non fuori pista: 0% di tempo sull'erba. E a una velocità media **più alta** dei battistrada (160-168 contro 139-143). Andavano più forte facendo più strada: erano tutte all'esterno.

Quattro cause, tutte trovate misurando:

1. **La soglia di sorpasso non esisteva.** L'offset laterale scattava per chiunque fosse entro la finestra di following, 140px: in una coda di otto ogni vettura si scostava da quella davanti. Ora si esce dalla scia solo entro `AI_PASS_RANGE = 72px`, cioè quando un attacco è davvero possibile; oltre, si tiene la traiettoria e si usa il cap di velocità.
2. **Gli offset si sommavano a cascata.** Il bersaglio era `otherLat + dir * step`, relativo alla vettura davanti: la seconda si scostava dalla prima, la terza dalla seconda già larga, e all'ottava il treno era steso su tutta la carreggiata. Ora è limitato a `min(lim, step + 14)` dalla traiettoria ideale — si formano due file, non un ventaglio.
3. **«Il lato con più spazio» è sempre l'esterno**, e l'esterno è la strada lunga. `AI_INSIDE_BONUS = 40` aggiunge spazio *virtuale* all'interno della curva, in proporzione a quanto è stretta (`min(1, 700/raggio)`: nulla in rettilineo, tutto in tornante). Il verso della curva si legge dal frame normale, `sign((t_{i+4} − t_i) · n_i)`.
4. **Il limite laterale era misurato dalla traiettoria ideale invece che dalla pista.** Il clamp era `|desired| ≤ lim`, ma `desired` è relativo alla linea: su Circle la linea sta incollata al cordolo interno (`alpha = −60` per tutto il giro), quindi il punto di mira poteva finire a **120px dalla mezzeria di una strada larga 80**. Ora si clampa in coordinate di mezzeria (`lim − lineLat`, `−lim − lineLat`).

Risultato, stessa misura, stessi semi: Oval +3.2% → −0.2%, Triangle +1.7% → +0.3%, Circle +17.7% → +16.0%. Circle resta l'anomalia e probabilmente deve restarlo: dieci auto, una sola traiettoria e nessuna zona di frenata sono una coda anche nella realtà.

**Cosa NON era la causa**, verificato per ablazione: la safety car (con `VSC_POWER` a 1.0 la perdita non cambia di un decimo), il danno da contatto, e il cap di car-following (rimuoverlo peggiora). E la proposta iniziale — `attackGain` da 0.30 a 0.80, `safeGap` 16→22, `defend` 0.95→0.70 — è stata **misurata e scartata**: all'Oval portava la perdita a +23%, due vetture distrutte e la safety car fuori per il 39% della gara. Il commento nel codice aveva ragione: alzare l'attacco ai profili veloci li fa solo schiantare.


### 4.5 Recuperi
- **Contromano**: rilevato confrontando l'assetto con la **tangente della pista**, non con la direzione del target (che avoidance e offset possono perturbare). Sopra 25 px/s frena e sterza, altrimenti retromarcia con sterzo invertito finché l'errore non scende sotto 0.9 rad.
- **Insabbiamento**: se l'IA chiede gas ma resta sotto 22 px/s per 1.1 s, retromarcia 0.75 s ruotando il muso via dalla barriera (segno di `right·n` rispetto alla posizione laterale).

### 4.6 Livelli di difficoltà
I **cinque** profili in `AI_PROFILES` scalano coerentemente pace, prudenza e pulizia:

| | easy | medium | hard | impossible | alien |
|---|---|---|---|---|---|
| `cornerFactor` (frazione del limite fisico in curva) | 0.72 | 0.826 | 0.950 | 1.14 | 1.14 |
| `straightFactor` (frazione della velocità massima) | 0.68 | 0.834 | 0.880 | 1.00 | 1.00 |
| `brakeConfidence` | 0.80 | 0.86 | 1.02 | 1.12 | 1.12 |
| `lineBlend` | 0.70 | 0.85 | 1.00 | 1.00 | 1.00 |
| `radiusOptimism` | 0.28 | 0.25 | 0.55 | 1.00 | 1.00 |
| `errorChance` | 0.16 | 0.06 | 0.008 | 0 | 0 |
| `safeGap` / `gapGain` | 38 / 1.5 | 25 / 2.1 | 19 / 2.5 | 16 / 2.9 | 16 / 2.9 |
| `defend` | 0 | 0.45 | 0.75 | 0.95 | 1.00 |
| `attackGain` | 1.00 | 1.00 | 0.55 | 0.30 | 0.30 |
| `skillFloor` | 0.8 | 0.8 | 0.8 | 0.8 | **1.1** |
| traiettoria | standard | standard | standard | **fast** | **fast** |
| tempo di reazione (s) | 0.45–0.90 | 0.22–0.42 | 0.11–0.19 | 0.085–0.135 | 0.085–0.120 |
| handicap danni al giocatore | sì | sì | sì | sì | **no** |

#### Come sono stati rimessi i pioli (Apex 2)

La scala era **ammassata in alto**. Misurato (giro solitario mediano, gomma fissata perché la lotteria delle mescole non spostasse la risposta): `easy +59.8%`, `medium +15.5%`, `hard +3.7%`, `impossible 0`. Tre quarti dell'intervallo stavano nel gradino più basso, e hard e impossible distavano 3.7 punti — dentro il rumore da gara a gara. Dopo il refit, stessa misura, quattro circuiti: `easy +44.2%`, `medium +26.8%`, `hard +10.6%`, `impossible 0`, `alien 0`. Gradini di 17.4, 16.2 e 10.6 invece di 44.3, 11.8 e 3.7.

**Come** ogni piolo è stato spostato conta quanto dove è finito:

- **easy non ha ricevuto più aderenza.** Ha ricevuto una traiettoria migliore, frenate più tarde, mani più ferme e meno errori (`lineBlend` 0.35→0.70, `brakeConfidence` 0.55→0.80, `radiusOptimism` 0→0.28, `steerTau` 0.11→0.085, `errorChance` 0.30→0.16), con `cornerFactor` intatto a 0.72. Scalarne il passo avrebbe portato la sua velocità in curva **sopra** quella di medium (0.826): un'assurdità sulla carta anche dove non lo è sul cronometro, perché easy perde molto più per la linea che guida che per il grip che le è concesso.
- **medium e hard** hanno i due parametri di passo scalati per 0.869 e 0.880, letti su una **curva di risposta misurata** e non scelti a occhio.
- **impossible non è stata toccata, perché non ha dove andare.** Spazzando il suo `cornerFactor` verso l'alto del 4, 8 e 12% il giro si muove di −1.6%, −1.2% e −0.7%: l'IA è già al limite della macchina, non del proprio coraggio.

#### Alien: non un'IA più veloce, un campo senza vetture deboli

Non esiste un'IA più veloce — vedi sopra. Quello che Alien toglie è la **metà debole della griglia**. `skillVariation` vive in [0.8, 1.1] e si mappa in un moltiplicatore di passo da 0.930 a 1.000, quindi a ogni altro livello un terzo del campo gira fino al 7% sotto il proprio massimo. `skillFloor: 1.1` alza il pavimento: ogni vettura corre in cima al proprio intervallo, e non resta nessuno da raccogliere lungo la strada. Misurato: il sorteggio di abilità passa da 7.0% di dispersione a **0%**, e la vettura più lenta del campo passa da `cornerFactor` 1.064 a 1.122. Quel che resta di dispersione (4.3%) sono le **personalità**, e devono restare.

In più cade l'handicap del giocatore. `PLAYER_DAMAGE_SCALE` (0.45) e `PLAYER_FREE_IMPACT` (28 px/s) esistono perché l'IA conosce in anticipo lo sterzo che le servirà e un umano ha quattro frecce e un tempo di reazione; ad Alien il presupposto del livello è che al giocatore non sia concesso nulla che non sia concesso al campo. Sono passati da costanti a funzioni (`playerDamageScale()`, `playerFreeImpact()`) e `applyDifficultyRules(diff)` le arma all'inizio di ogni sessione, così qualifica e gara sono d'accordo.

**`cornerFactor` sopra 1.0 non è barare**: `AI_CORNER_SAFETY` vale 0.90, quindi 1.16 significa chiedere il 104% della velocità *tabulata*, che è a sua volta calcolata sul raggio conservativo (filtro di minimo). Il valore non è scelto a occhio: è il minimo misurato spazzando `cornerFactor` da 0.90 a 1.70 in giri singoli senza traffico su sei tracciati. Il tempo sul giro migliora fino a ~1.15–1.25 e poi **peggiora**, perché la vettura comincia a strisciare invece di girare (a 1.35 l'Oval accumula 3.4 s fuori pista). `maxCorner` per livello impedisce ai moltiplicatori pilota di superare quel tetto.

**`radiusOptimism`** decide quale raggio l'IA si fida di usare: 0 = il più stretto del vicinato (frena molto prima dell'apice), 1 = quello locale. Da solo vale l'1.5–8% sul giro.

**Traiettoria `fast`**: `getRacingLine('fast')` costruisce tre rilassamenti (600/1000/1800 sweep), ne misura analiticamente il tempo sul giro e tiene il più veloce. Su alcuni layout (Oval −2%) vince un rilassamento più profondo, su altri no — per questo viene misurato invece che assunto. È riservata ai due pioli in cima.

`skillVariation` (0.8–1.1, persistito nel campionato) viene rimappato in un moltiplicatore di passo di ±3.5%, con il pavimento di `skillFloor`.


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

### 4.6quater Scelta della mescola (Apex 2)

`AI.chooseTyre(driverName, laps, raining)` sceglie la gomma come il pilota guida: gli aggressivi, quelli che sbagliano, quelli che stanno attaccati prendono la soft e accettano il precipizio; i lisci e calcolatori prendono qualcosa che ci sarà ancora alla fine. Deliberatamente rumorosa, perché una regola deterministica metteva gli stessi nove piloti sulla stessa mescola ogni volta.

Due correzioni, entrambe misurate.

**1. La lunghezza della gara non può contare, e contava.** C'era `want += (5 − laps) * 0.055`. Ma la vita della gomma in `car.js` è un **multiplo della gara**: `tyreWear += lapFrac · abuse / (tyre.life · laps)`, quindi una soft arriva alla bandiera con lo stesso 1.11 di usura che la gara sia di due giri o di venti. Il termine spostava tutto il campo per niente. Rimosso, e ora c'è un test che verifica la proprietà invece dell'intenzione.

**2. La soft era una trappola, e l'IA ci cascava il 39% delle volte.** Misurato su uno stint solitario completo, mediato su quattro circuiti: **soft +1.8%**, medium +0.1%, hard +0.2% rispetto alla migliore. Parte 9% avanti di grip e finisce 16% indietro, e il grip in questo modello è quasi gratis perché il limite in curva che morde è la **velocità di sterzata**, non l'aderenza (`v = maxSteer / (1/R + maxSteer/500)`): il lato buono è attutito, il precipizio no. Il campo la prendeva 39 volte su 100 e regalava al giocatore quasi un secondo al giro per niente. Ora `want -= 0.15` con soglie 0.66/0.36: **soft 19-20%**, una scommessa da minoranza — che è ancora la cosa più veloce in pista per la prima metà — invece della scelta di default.

**3. La soft ora tocca la velocità di sterzata** (`bite`, in `car.js`). Era la nota rimasta aperta e Nicola ha deciso: dato che il grip quasi non paga, la mescola deve toccare la cosa che morde. `bite` moltiplica la velocità di sterzata direttamente e **svanisce con la gomma** — tutta su una gomma nuova, niente su una finita — così la soft è davvero la cosa più veloce in pista all'inizio e davvero la più lenta alla fine. Quello che scegli è *quando* vuoi la prestazione.

Tre condizioni dovevano valere insieme, e ogni candidato che ne soddisfaceva due falliva la terza: nessuna mescola più del 1.5% migliore su una gara intera (ottenuto 1.27%), primo giro `soft < medium < hard`, ultimo giro `hard < medium < soft`. La condizione di mezzo ha ucciso diversi candidati che chiudevano il divario complessivo rendendo la **hard** più veloce della medium a gomma nuova — un'assurdità per quanto buoni fossero i totali.

Serviva anche accorciare la vita della medium: a `life 1.50` non si consumava quasi, il che la lasciava entro lo 0.2% dalla hard per tutto lo stint e faceva sì che la durata della hard non potesse comprarle niente. Portata a 1.05 era **troppo**: ad Harbour, il più stretto dei circuiti, il campo perdeva abbastanza aderenza a fine gara da cominciare ad allargare — 8.6% dei frame sull'erba contro 0.2%, e una vettura su otto non finiva. **1.30** tiene la forma e restituisce quello.

Il fit è fatto a difficoltà *medium*, non a impossible: in cima alla scala l'IA è incollata al proprio tetto `maxCorner`, quindi la velocità di sterzata in più viene in parte buttata via e la soft misura meglio di quanto sia. Il giocatore quel tetto non ce l'ha.


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

Scala dei tempi sul giro (miglior giro, 6 vetture, asciutto) **prima** del refit dei pioli di Apex 2 — tenuta qui perché è la misura contro cui il refit è stato fatto:

| tracciato | easy | medium | hard | impossible |
|---|---|---|---|---|
| Oval | 10.30 | 7.55 | 6.77 | 6.52 |
| F1 | 13.60 | 9.85 | 8.95 | 8.80 |
| Circle | 9.32 | 6.77 | 5.92 | 5.35 |
| Serpent | 16.93 | 12.32 | 11.10 | 10.80 |
| Pettine | 23.52 | 15.88 | 14.20 | 13.98 |

Per la scala dopo il refit — e per come è stata ottenuta — vedi §4.6 e §6bis.

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
### Frame stall (scheda in secondo piano)

`requestAnimationFrame` si ferma quando la scheda non è visibile, ma `performance.now()` no. Al ritorno arriva un frame con `dt` di decine di secondi: `updatePhysics` lo tronca a 50ms, quindi non si corre praticamente nulla, ma `raceStartTime`, `firstFinisherTime` e `vscEndsAt` sono ancore su orologio a muro e quindi credono che la gara sia andata avanti. In un log reale questo ha squalificato dieci vetture su undici per "outside the time limit" mentre erano tutte al quarto giro su cinque e a sei secondi dalla bandiera, senza che nessuna avesse percorso un metro.

`gameLoop` tratta quindi un frame più lungo di `STALL_S` (0.25s) esattamente come una pausa: sposta avanti le ancore del tempo perso e forza `dt` a 1/60. Sotto la soglia resta un frame lento normale, e il tempo scorre.

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

## 6bis. Come è stata ritarata la difficoltà (Apex 2)

Nicola vinceva sempre il campionato in *impossible*. Prima di toccare qualsiasi cosa sono state ricostruite le sue stagioni dai log e misurato dove finisse davvero il margine. Vale la pena tenerne traccia perché **la prima diagnosi era sbagliata**, e la seconda è stata trovata solo perché la prima è stata misurata.

**Cosa dicono i log** (5 stagioni, 52 gare, classifiche ricostruite con i punti veri):

| stagione | livello | risultati | margine sul 2° |
|---|---|---|---|
| ago 9 | impossible | 7 vittorie su 10, media P1.56 | 83 pt (38%) |
| ago 9 (2ª) | impossible | 5 su 10, media P2.22 | 44 pt (22%) |
| ago 8 | impossible | 6 su 11, media P1.89 | 24 pt (12%) |
| ago 7 | hard | 7 su 11, media P1.73 | 119 pt (48%) |
| ago 7 | medium | 7 su 10, media P1.00 | 62 pt (35%) |

**La qualifica era già tarata bene.** Su 25 sessioni asciutte a impossible: griglia media P5.3 su 12, pole 9 volte su 25, giro tipico +2.9% dalla pole, miglior giro di sempre −4.9%. È esattamente quello che deve fare il livello più alto.

**Il margine nasceva in gara**, dove l'IA girava il 9-10% più lenta della propria qualifica mentre il giocatore non perdeva nulla (−0.5%). Da lì è partita la caccia.

**Prima diagnosi (sbagliata): il traffico.** Sembrava ovvio — le IA passano il 60-85% della gara entro 160px l'una dall'altra. Ma il confronto era viziato: la qualifica è simulata su una mescola scelta per 3 giri e la gara su una scelta per 5, e soft→medium sono 9% di grip. Rifacendo la misura contro un **giro solitario sulla gomma con cui si corre davvero**, la perdita crolla da 12.4% a **2.5%**.

**Ablazioni**, tutte negative, tutte utili: azzerare la safety car (`VSC_POWER = 1.0`) non cambia la perdita di un decimo, nonostante la VSC sia fuori il 22-30% della gara; togliere il danno da contatto non cambia nulla; togliere il cap di car-following peggiora. E la proposta di aprire l'attacco (`attackGain` 0.30→0.80) portava l'Oval a +23% con due vetture distrutte.

**Seconda diagnosi (quella vera), in tre pezzi:**

1. **La coda si apriva a ventaglio** sui circuiti senza zone di sorpasso — §4.4bis. Su Circle otto vetture su dieci giravano il 22% più lente del proprio passo, a velocità più alta, perché facevano più strada.
2. **L'IA sceglieva una gomma dominata** il 39% delle volte — §4.6quater.
3. **La scala non aveva un piolo sopra di lui**, e non poteva averlo: hard e impossible distavano 3.7% e sopra impossible non c'è passo disponibile — §4.6.

Gli attrezzi di misura sono nella cartella di lavoro e non nel gioco: `logscan.js` (classifiche ricostruite dai log), `logwhy.js` (da dove viene il margine), `ladder.js` / `ladder2.js` (dove si colloca il giocatore sulla scala), `racecost.js` e `traffic.js` (perdita di passo in gara, con varianti e ablazioni), `tyrecost.js` (stint per mescola), `ladderfit.js` (curva di risposta dei pioli).

---


## 7. Checklist di Manutenzione Futura
- **[CRITICAL] Modifiche alla Pista**: Qualsiasi resize al Canvas HTML (es. se verrà introdotta una minimappa e scroll laterale) **richiederà di riscrivere completamente il metodo drawPath in `SegmentedTrack`** per introdurre un _camera offset_ in fase di operazione ctx.
- **[CRITICAL] Aggiunta di UI HTML**: Ricordare sempre i null check `if (playerCar)`. La modalità Spectator causerà eccezioni letali nel thread principale di rendering se cerchi di stampare sul DOM le statistiche della vettura di un player inesistente. Usa `sortedCars[0]` per le statistiche del leader.
- **Aggiornamento Fisica Ghiaccio/Sterrato**: In futuro per il rally, aggiungi un tag stringa "terrain" in `SegmentedTrack` che restituisca specifici preset per la scalatura in `updatePhysics` (`slip threshold`, `drag modifier`, ecc.). Attualmente la divisione è hardcoded su "track" vs "grass".
- **[CRITICAL] Elementi HTML e `main.js`**: `main.js` risolve i suoi controlli a livello top-level (`const resumeBtn = document.getElementById('resume-btn')`) e ci registra subito i listener. Se un elemento sparisce da `racing.html`, `getElementById` restituisce `null`, la riga successiva lancia un TypeError e **l'intero script si ferma**: nessun bottone viene collegato e il menu diventa inerte. È successo davvero quando una ristrutturazione dell'HTML ha inghiottito `#pause-overlay`. Vale lo stesso per `insertBefore(nuovo, riferimento)`: il nodo di riferimento deve essere figlio del genitore su cui chiami il metodo, altrimenti `NotFoundError`.
  Il guardiano è `apex_boot.js`: costruisce il DOM **solo** dagli id realmente presenti in `racing.html`, restituisce `null` per tutto il resto e implementa `insertBefore` con il controllo di parentela. Gli altri harness usano uno stub che inventa un elemento per qualsiasi id — comodo per pilotare il gioco headless, cieco a questa classe di bug.
- **[Apex 2] Non tarare una difficoltà su un confronto viziato.** «L'IA gira il 9% più lenta in gara che in qualifica» sembrava traffico, ed era in gran parte la **mescola**: la qualifica sceglie la gomma per 3 giri e la gara per 5, e soft→medium sono 9% di grip. Qualsiasi misura di «passo perso in gara» va fatta contro un giro solitario **sulla gomma con cui si corre**, altrimenti si insegue il fantasma sbagliato. Costò un giro intero di modifiche all'IA, tutte da buttare.
- **[Apex 2] Un test non deve codificare un artefatto del campione.** Due sono stati riscritti dopo questa ritaratura: uno pretendeva che almeno lo 0.5% dei traini venisse da un'auto quasi ferma (era 0.33% *perché l'IA aveva smesso di incepparsi* — un successo che faceva fallire il test), l'altro che una gara lunga spingesse il campo su gomme dure (impossibile: la vita della gomma è un multiplo della gara). Entrambi ora verificano la **proprietà** e non la frequenza osservata.
- **[Apex 2] Il limite laterale dell'IA si misura dalla pista, non dalla traiettoria ideale.** `desired` è relativo alla linea, `maxOffset` alla mezzeria: clamparli insieme mandava il punto di mira fuori strada su ogni circuito la cui linea sta incollata al cordolo.
- **[Apex 2] Una barriera dipinta va costruita come SCOSTAMENTO del confine fisico, mai come un secondo insieme di livello più largo.** I due coincidono solo dove il bordo è liscio; vicino a una rientranza quello largo si richiude sopra la tacca e sparisce, e resta un muro invisibile. `ghost.js` (e la sezione 8 di `apex2_newtracks.js`) misurano la proprietà giusta: trova i punti dove un'auto si ferma e chiedi quanto è lontana la vernice più vicina. Deve essere un raggio d'auto, ovunque.
- **[Apex 2] Se una cosa si dipinge sul tracciato, il suo limite va messo dove lo legge anche la fisica.** Il cordolo di Peanut finiva sotto l'armco perché il limite stava in `draw()`; ora sta in `kerbWidthFor()`, che usano sia il disegno sia `getSurface()`.
