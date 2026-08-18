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

*Quarta versione, e la correzione che conta:* **le barriere fantasma.** La terza chiedeva l'insieme di livello a `wallRadius() + 12` — una barriera *più larga*, ricalcolata da zero. Ma vicino a qualsiasi rientranza i due insiemi non sono curve parallele: dove la strada torna su se stessa quello più largo **si richiude sopra la tacca e semplicemente non c'è**, mentre la fisica continua a fermare le auto lì dentro. Nicola ci è finito dentro a Lombard (circuito poi tolto dal calendario e sostituito da Kart — vedi §3.0quater; il difetto era della barriera, non della pista). Misurato allora: **Pettine aveva 996 punti di griglia** in cui un'auto si ferma e la vernice più vicina era fino a **171px** lontana — fra i denti del pettine non c'era barriera affatto — e Lombard 16 punti fino a 30px.

Ora la barriera è uno **scostamento** del confine fisico, non un secondo raggio: si calcola l'insieme di livello a `wallRadius()` e ogni punto viene spinto in fuori di 12 lungo la propria normale. Il test di appartenenza resta sul punto a `wallRadius`, ed è questo che tiene la vernice legata alla fisica. Un fantasma diventa **impossibile per costruzione**: ogni punto che ferma un'auto ha una barriera a 12px, perché la vernice *è* quel punto spostato. Misurato su tutti e 17: peggior scarto **11.9px**.

Due dettagli che il test ha trovato:

- il verde **non** è quello dell'erba. Il verge è `#2e7d32` e il prato `#3f8f45`; il verde della bandiera `#009246` accanto a quelli si legge come altra erba. È `#00d152`, a 101 e 92 punti RGB dai due;
- i tagli fra un pannello e l'altro si trovano per **lunghezza d'arco** e si interpolano, non si prendono dai vertici del run. I run escono da Douglas-Peucker, quindi un rettilineo è due punti per quanto sia lungo: tagliando sui vertici ogni rettilineo veniva dipinto di un colore solo, e il tricolore compariva solo nelle curve;
- la lunghezza del pannello è **per run**, `max(3.5, min(26, L/3))`. Con un valore fisso un run corto — l'interno di un dente di Pettine, il collo fra due lobi di Lombard (allora in calendario) — riceveva un pannello e un mozzicone, usciva tutto verde, e il verde pieno sull'erba si legge come *nessuna barriera*. Ora ogni run mostra tutti e tre i colori per quanto sia corto;
- **i cordoli non possono finire sotto la barriera.** `kerbWidth` è il 30% della strada, e su parecchi circuiti è più largo di tutto il verge: Peanut ha strada 70, verge 85 e cordolo 21, quindi il cordolo arrivava a 91 dalla mezzeria mentre l'armco sta a 85 — erano dipinti uno sull'altro. Nessuno se n'era accorto finché lì non c'era una barriera. `kerbWidthFor()` ora ha un terzo limite, `barrierRadius() − trackWidth − 4`, applicato lì e non in `draw()` così che anche `getSurface()` sia d'accordo con la vernice. I cordoli restano larghi 8-24px e finiscono 1-3px prima della barriera. La parte *raggiungibile* del cordolo non cambia su nessun circuito: il muro morde comunque prima.

Il test non legge il sorgente: passa al circuito un canvas che **registra ogni tratto**, e poi chiede dove sono finiti il bianco e il rosso. Su tutti e 17 ogni marcatura sta o su un cordolo o sulla barriera, con uno scarto massimo di 0.7px, e niente è dipinto sulla strada.

**3. Il muro viene disegnato dov'è.** `getWalls()` calcola l'insieme di livello «distanza dall'asse più vicino = `wallRadius()`»: campiona entrambi i lati dell'asse ogni 2px e tiene solo i punti a cui **nessun altro tratto** è più vicino — che è esattamente il bordo della zona percorribile, anche dove due tratti si accostano e il bordo non è più un semplice parallelo. Il risultato viene disegnato **dopo l'asfalto**, quindi non può essere coperto.

Due casi che non si vedevano a occhio e che il test ha trovato:

- ai **giunti** l'offset perpendicolare lascia un cuneo scoperto sull'esterno della curva: serve un ventaglio di direzioni attorno al vertice (Thunder aveva un buco di 15px);
- `getClosestPoint` ripiega sugli **estremi** di un arco per i punti fuori dal suo settore, quindi il confine può girare attorno a un estremo più di quanto giri il vertice: si percorre un cerchio intero attorno a ogni estremo e si tiene ciò che supera il test (altri 18px di buco su Thunder).

Il test non ricalcola la stessa formula: passa una **griglia** sull'arena, tiene i punti che stanno sul confine (`|dist − wallRadius| ≤ 0.9`) e chiede quanto dista il muro disegnato più vicino. Su tutti e 17 i circuiti il peggior scarto è **2.1px**, e nessun muro viene disegnato dove si può guidare. *La prima versione del test prendeva i punti di confine dalle normali della traiettoria ideale, che sono **lisciate**: pochi gradi di differenza a 72px di offset fanno dieci pixel, e segnalava buchi nel muro che erano buchi nella misura.*

### 2.4sexies-bis La barriera si traccia, non si ricuce (Apex 3)

Nicola ha segnalato che su alcuni circuiti le barriere tricolori sembravano disegnate male, e aveva ragione quattro volte in modi diversi. Sui denti di Pettine le due linee correvano **intrecciate**, scambiandosi di lato a ogni giunzione; alle imboccature delle spine di Kart si incrociavano in una X; ai cunei dell'incrocio di Crossover la linea usciva in **ganci** e asole; agli angoli delle isole di Quadrato, Serpent e F1 due tratti si sovrapponevano in una croce, con accanto uno spicchio di cordolo staccato dal nulla; e su Harbour, Zipper e Boomerang spuntavano **monconi** di cordolo in mezzo al verde, su pieghe della strada quasi invisibili.

Due cause, non una.

**La ricucitura.** `getWalls()` campionava l'asse, teneva i punti a cui nessun altro tratto era più vicino, e riuniva i superstiti **per prossimità**. Ma la prossimità non è un ordine: dove due tratti di strada corrono vicini, i superstiti dei **due lati** del corridoio cadono entro la stessa tolleranza di giunzione, e la polilinea zigzaga fra un lato e l'altro. Ogni difetto visibile era una forma di questo zigzag.

**L'offset senza freni.** I 12px di spinta verso l'esterno chiedevano solo «il punto spinto è ancora fuori strada?» — che resta vero anche **dopo aver attraversato tutta la striscia**: negli 8px fra i muri di Pettine ciascuna linea veniva dipinta oltre la metà, sul muro dell'altra. Incrociate per costruzione.

Ora la curva **si traccia**: marching squares sul campo di distanza phi(x, y) = «distanza dall'asse più vicino», campionato su un reticolo da 2px (esatto in una fascia attorno al contorno, stimato altrove da una passata a 8px — phi è 1-Lipschitz, lontano dal contorno basta il segno). Seguire il contorno phi = R cella per cella produce anelli **chiusi, ordinati e senza incroci** per costruzione: non esiste più una fase di ricucitura che possa sbagliare. Il campo è lo stesso `getClosestPoint` della fisica, e ogni vertice tracciato viene riagganciato al livello esatto lungo il proprio gradiente, quindi la vernice continua a non poter dissentire dal muro.

Sopra il tracciato, tre regole:

- la spinta si ferma **al crinale**: finché il passo si allontana dalla propria strada, la distanza sale di 1 con il passo; quando sale meno, la strada più vicina sta per cambiare ed è terreno d'altri. Ultimo passo onesto e stop — nella striscia da 8px ognuno si ferma a metà;
- **un muro per striscia**: un vertice che cade a meno di una pennellata (7.5px) da vernice già tenuta viene scartato e la run si spezza lì. Il confronto ignora gli ultimi 24px **d'arco** della linea in costruzione — se stessa e, nei tappi stretti, il proprio labbro opposto. D'arco e non di indice: la spinta verso l'interno ammassa i vertici nei tappi (un angolo dell'isola di Quadrato ne mette centinaia in due pixel), e una finestra contata a vertici lì vale mezzo pixel, il che staccava il tappo dal muro a cui apparteneva. Una striscia che nessuna vettura può raggiungere riceve **un** armco, come su un circuito vero — il lato soppresso resta ad al più 17px misurati dalla vernice tenuta, meno di una vettura;
- i **detriti** più corti di un pannello (il puntino collassato dentro il tornante interno di Thunder, le schegge ai cunei) non valgono una pennellata e si tolgono.

Due agguati trovati facendo, non pensando. Douglas-Peucker si appende ai **due estremi** di una run — e un anello sopravvissuto intero ne ha uno solo, la cucitura: ancorato lì si appiattisce tutto a un punto, e l'isola di Zipper è **sparita in un puntino** alla prima build. Una run chiusa ora si spezza al vertice più lontano dalla cucitura e le due metà si semplificano separate. E il cordolo, che è la correzione corretta a sua volta: la prima build scartava le fasce sotto i ~30px d'arco dipinto come spazzatura, togliendo il cordolo a undici pieghe leggere — quattro solo su Harbour. **Nicola li ha rivoluti**: il cordolo sta su ogni curva interna, corta o no. Aveva ragione due volte — contro i muri riparati i monconi si leggono per quello che sono, mini-cordoli su una piega, e quello che li faceva sembrare detriti era la barriera rotta dietro, non il cordolo. La soglia è sparita: i cordoli sono esattamente quelli di Apex 2, in vernice e in `getSurface()`.

Il muro tracciato si calcola una volta per **classe** di circuito e si condivide fra le istanze (`SegmentedTrack._wallStore`): riaprire l'albo dei record o rifare partenza non lo ripaga. Misurato su tutti e 17: traccia in 36–163ms, **zero** punti di vernice su terreno raggiungibile, e ogni punto della linea d'arresto ha vernice entro 12.4px (17 nel caso peggiore, il lato soppresso della striscia da 16px di Kart). La fisica non è stata toccata: `checkBarrierCollision` è identica, cambia solo che il muro dipinto ora è davvero il muro.


### 2.4sexies-ter Il circuito si dipinge una volta, e la stagione non si perde (Apex 3)

Tre lavori chiesti da Nicola dopo le barriere, tutti e tre del genere che non si vede finché manca.

**1. Il circuito statico è un livello, non un disegno.** Erba, cordoli, asfalto, linea del via, barriere, pozzanghere: niente di tutto questo si muove durante una sessione, e veniva ristrutturato dai path **sessanta volte al secondo** — misurato, 2.9–5.0ms a frame solo di circuito, che su un telefono è la parte grossa del budget. Ora si dipinge **una volta** in un canvas fuori schermo alla risoluzione piena e si blitta: 0.016–0.029ms a frame, centocinquanta volte meno. Il livello si ricostruisce da solo quando cambiano i suoi ingredienti: istanza del tracciato (ogni sessione ne fa una), risoluzione, o la lista delle pozzanghere **per riferimento** — il meteo si tira dopo aver fatto il tracciato, quindi il riferimento è il segnale onesto.

Fuori dal livello sta ciò che si muove: strisciate, particelle, pioggia, vetture, gru, il ponte (che va dipinto **sopra** le auto che ci passano sotto) — e le **tribune**, che sembrano statiche e non lo sono: le magliette della folla luccicano su un orologio da 260ms, e cuocerle nel livello congelava il pubblico per tutta la gara. La prima correzione — folla ridisegnata a ogni frame — si è mangiata quasi tutto il guadagno: 0.7–2.3ms a frame di soli spettatori. La folla ha quindi un **livello suo**, trasparente, ridipinto solo quando il suo orologio scatta davvero — quattro volte al secondo invece di sessanta — e blittato fra lo sfondo e il circuito, esattamente dove il codice vecchio la dipingeva. Il frame è tre operazioni: riempimento di sfondo, blit folla, blit circuito. Verificato con l'orologio fermato: 0–1 pixel su un milione di differenza dal disegno diretto, su tutti i circuiti provati.

**2. Il canvas segue il devicePixelRatio.** Il backing store era inchiodato a 1360x765 qualunque fosse lo schermo: su retina e su telefono il CSS lo gonfiava e ogni linea usciva morbida. Ora lo store segue il dpr (**tappato a 2**: oltre, il costo quadruplica per una nitidezza che non si vede) e una sola setTransform mappa le unità di mondo, così ogni draw del gioco continua a pensare in 1360x765. L'attenzione vera è sull'**elemento**, che non deve seguire: la sua scatola CSS derivava dagli attributi width/height, e raddoppiare lo store avrebbe raddoppiato il layout sugli schermi grandi. La prima versione inchiodava `style.width` alla misura di mondo e lasciava il restringimento a max-width/max-height — e reggeva solo finché l'asse stretto era la larghezza. Nicola l'ha trovata al primo giro: nel suo Firefox retina, con schede, barra degli indirizzi e segnalibri a mangiarsi una striscia, la finestra è corta d'**altezza**; un elemento rimpiazzato con larghezza esplicita non la restituisce, il canvas si è tenuto i suoi 1360px e il fondo dell'HUD è scivolato fuori dallo schermo. La scatola ora la dimensiona il foglio di stile: `width: min(mondo, larghezza finestra, altezza finestra per il 16:9)` — la domanda posta su entrambi gli assi insieme, che è esattamente ciò che faceva la misura intrinseca; il numero di mondo entra come `--world-w` da main.js, perché nessun limite di canvas si scrive a mano. E la regola sta su `#gameCanvas` **e basta**: la prima stesura l'aveva appoggiata al selettore nudo `canvas`, che veste ogni tela del gioco — la mappa dell'anteprima del GP si è gonfiata a tutta finestra portandosi via i pulsanti, a ogni round di ogni stagione, ed è Nicola ad averla trovata riprendendo un campionato. Le altre tele si dimensionano dai loro attributi e vogliono solo i max di prima, che sono tornati com'erano; l'unica il cui backing store è cresciuto oltre la sua scatola è quella principale, ed è l'unica a cui la regola parla. Rimisurato contro Apex 2 su otto combinazioni di finestra e dpr (corta, stretta, enorme, minuscola × 1 e 2): rettangolo CSS **identico** in tutte, store doppio a dpr 2, HUD dentro lo schermo nella finestra incriminata. La pioggia campionava le gocce su `canvas.width`: a dpr 2 metà cadevano fuori schermo. Piove in unità di mondo, non per risoluzione.

**3. Il campionato sopravvive a un reload.** Record personali, albo e seed erano già in localStorage; la stagione no — chiudi la scheda al round sette e il campionato era sparito. `championshipState` è dati puri da cima a fondo (l'rng col seed si consuma alla creazione, non si conserva), quindi si serializza com'è. Si salva a ogni checkpoint che lo cambia: all'ingresso di un round — che copre la creazione e le scelte del telaio, entrambe imbutite in `nextChampionshipRound` — e quando i punti di una gara sono stati applicati. Si cancella quando compare la classifica finale (una stagione finita è un ricordo, non uno stato ripristinabile) e si sovrascrive quando ne parte una nuova.

Nel menu, sotto Start Championship, compare **Resume Championship — Round X of Y** quando un salvataggio esiste. Riprendere riarma i tre globali che una stagione richiede (isChampionship, raceMode, i telai per sedile) ed entra dalla **stessa porta** di ogni altro round, `nextChampionshipRound`: anteprima del GP, salto del round e classifiche si comportano come se la scheda non si fosse mai chiusa. Un salvataggio abbandonato a metà scelta del telaio ha sedili senza macchina: si richiede con la stessa schermata della prima volta. Il pulsante usa l'attributo `hidden` e non style.display, perché `setMenuMode` scrive display su tutto ciò che porta data-modes e l'avrebbe riesumato a ogni visita della tab.

Un agguato da manuale, trovato col pulsante che faceva il morto davanti a una stagione salvata: la chiamata di avvio a `refreshChampResume` stava fra i listener del menu, **prima** nel file della `const` con la chiave dello storage — zona morta temporale, la lettura lancia, il catch risponde «nessun salvataggio». La chiamata vive ora in fondo al file, con le altre di avvio, e il commento dice perché. Verificato il giro completo in Chromium: stagione creata → GP saltato → punti nel salvataggio → reload → Resume — Round 2 of 10 → anteprima del round giusto con punti, partecipanti e telaio intatti, zero errori.

### 2.4sexies-quater Il fantasma e la mossa unica (Apex 3)

Due meccaniche nuove, scelte da Nicola dalla lista di quelle che non snaturano il gioco: una per quando si è soli in pista, una per quando non lo si è.

**Il fantasma.** In prova e in qualifica i giri del giocatore vengono registrati — posizione e direzione a ogni frame, timbrate con l'orologio del giro — e il migliore rivive come **sagoma pallida** che riparte a ogni passaggio sul traguardo. Battilo e prende il posto lui, sul momento: il fantasma che insegui è sempre il più veloce che tu sia mai stato su quel circuito, con quel meteo — asciutto e bagnato sono fantasmi separati, perché un giro bagnato è un altro sport. Registrato **a tempo e non a frame** (una traccia rigiocata frame per frame correrebbe più forte su una macchina più veloce): al salvataggio i campioni si ricampionano su una griglia fissa a 30Hz, arrotondati al decimo di pixel — un giro costa fra 3 e 15KB — e il replay interpola sullo stesso orologio del cronometro. Misurato: registrato un giro da 6.517 su Circle, ricaricata la pagina e rifatto guidare lo stesso pilota, dopo 5 secondi la sagoma sta a **6px** dall'auto. Niente ombra, niente targhetta, niente collisioni, disegnato sotto le vetture vere; la gara non lo mostra mai — è un compagno d'allenamento, non un'undicesima macchina.

**La mossa unica.** La difesa c'era già, e specchiava: copertura = propria linea più `defend` volte lo scarto dall'attaccante, ricalcolata a ogni frame — cioè un ondeggiare con altri passaggi, che per giunta non sapeva nulla del circuito: copriva il centro del rettilineo e lasciava aperto l'interno della curva dopo, che è l'unico posto dove un sorpasso succede davvero. Ora è un **impegno**, la regola vera: quando un'auto dello stesso giro si mette in coda, il difensore sceglie il punto UNA volta — l'interno della prossima curva che valga qualcosa (raggio sotto i 420, cercata camminando la traiettoria nei 300px avanti); su un rettilineo lungo, il lato da cui l'attaccante arriva — ci si sposta, e tiene la linea. Se l'attaccante esce dalla finestra di rilevamento proprio perché ci siamo mossi, la linea si tiene su una grazia di 0.7s invece di rimbalzare indietro, perché rimbalzare sarebbe la seconda mossa. L'impegno si spegne quando la lotta va avanti: attaccante affiancato o davanti (quello è correre, e ci pensa il codice di sopra), attaccante sparito, curva coperta ormai alle spalle — la mossa è spesa, la prossima curva è una decisione nuova — bandiera blu o VSC. Quanto della strada prende la copertura è `p.defend`: Prost socchiude la porta dove Schumacher ci parcheggia davanti.

Misurato su dodici Gran Premi saltati (sei per build, stagioni da spettatore): la difesa si impegna circa **26 volte a gara** (voce DEFEND nel RaceLog, con 6s di silenzio per pilota perché un duello lungo non diventi un tabulato), **zero** ritiri in più (0 e 0), punti-rimonta invariati (15/11 prima, 17/14 dopo): si sorpassa quanto prima, ma adesso il sorpasso va **costruito** — fuori dalla traiettoria, o alla curva successiva. E vale anche contro il giocatore, che è il punto.

### 2.4sexies-quinquies Otto a destra, otto a sinistra (Apex 3)

Il difetto l'ha trovato l'anulare destro di Nicola, non un test: dopo abbastanza stagioni con la freccia destra, fastidio al dito. Misurato, aveva ragione lui: **tredici** circuiti su diciassette giravano in senso orario, tre in antiorario, e Crossover — un otto — era l'unico onestamente neutro (272 gradi per lato). In gradi di sterzata per calendario: **5545 a destra contro 2545 a sinistra**, più del doppio del lavoro su un dito solo.

La cura è uno **specchio verticale** di cinque circuiti destrorsi: Oval, Peanut, Circle, Quadrato e Kart, scelti fra quelli la cui sagoma cambia meno ribaltata (i primi quattro sono quasi simmetrici; si nota soprattutto il traguardo che passa sul rettilineo di sotto). Ora il calendario fa **8 orari, 8 antiorari e Crossover neutro**, con la torsione netta totale esattamente a **zero gradi** — con 17 circuiti la parità perfetta non esiste, questa è la più perfetta possibile.

Perché specchio e non inversione di marcia: `checkLapCross()` conta il giro attraversando startX **in +x**, e uno specchio verticale nega la y lasciando intatta la direzione orizzontale di marcia — ogni curva a destra diventa a sinistra, che è il punto, e il contagiri non se ne accorge per costruzione. Invertire l'ordine dei segmenti (stesso disegno, percorso al contrario) avrebbe invertito anche quell'attraversamento e spento il contagiri in silenzio: considerato e scartato per questo. Sotto riflessione un arco nega gli angoli e ribalta il verso; una retta tiene l'ordine dei punti; tutto il resto — traiettoria, muri, cordoli, tribune, griglia, spina, ponte — è derivato e non si tocca. `centreInArena()` ricolloca da sola le coordinate negate.

I tempi non cambiano: il circuito specchiato è **congruente**. Verificato — e con un agguato dentro: la prima misura dava il Peanut specchiato più lento del **21.8%**, giri identici al millisecondo, zero uscite. Colpa non trovata nel codice perché non c'era: le sessioni di prova pescano il bagnato al 20%, e il lato specchiato l'aveva pescato due volte di fila. Rimisurato controllando il meteo: sull'asciutto 9.2–9.6 secondi da specchiato contro 9.4–9.7 da originale. Record e personal best restano quindi validi; il **fantasma no** — la sua traccia sono coordinate, e un giro registrato in un verso attraverserebbe il mondo specchiato contromano — quindi l'orientamento fa parte della sua chiave (`circle~acw:dry`) e i giri vecchi restano orfani invece che sbagliati.

### 2.4sexies-octies La stagione buttata via da un click (Apex 3)

Nicola ha segnalato un campionato che al round 2 aveva **tutti i punteggi a zero**, con log e schermata. La schermata, verificata contro il log riga per riga, era **corretta**: 40 punti gara per lui sono 15 di Crossover più 25 di F1, il bonus +5 è quello dell'unico round in cui ha guadagnato posizioni, e tutti e undici i totali tornano. Il difetto non era nel conteggio: era che quella stagione **non era la sua**. Ne era cominciata una nuova, e lui non se n'era accorto.

Colpa di due cose mie, che insieme fanno un buco.

**Il pulsante Resume stava sotto il bordo dello schermo.** L'avevo messo nella riga dei pulsanti principali, che su una finestra di 800px cade a **y=736** — in un menu che è già scrollabile. Sulla finestra di Nicola (Firefox retina con schede, barra e segnalibri: la stessa che aveva già fatto uscire l'HUD) non si vedeva affatto. Ora la stagione salvata si annuncia **in cima al menu**, sopra le tab e visibile su tutte, con quanti round mancano e chi guida: *«Championship in progress — Round 3 of 5, Michael Schumacher leads on 36»*, e il pulsante Resume dentro il banner.

**E «Start Championship» cancellava la stagione in corso in silenzio.** Un click, nessuna domanda, il salvataggio sovrascritto: chi non trova il Resume preme l'unico pulsante che vede, e la stagione è andata — stesse cinque schermate, stessi cinque round, punti da capo. Ora il primo click **chiede**: il pulsante diventa rosso e dice *«Discard round 3 of 5? Press again»*, il secondo procede, e si disarma da solo dopo sei secondi, cambiando tab o premendo Resume. Nessuna finestra di dialogo del browser — il gioco non ne ha mai usate — la domanda la fa il pulsante stesso.

Verificato che il salvataggio in sé è sano, perché era il primo sospetto: due round giocati, ricarica della pagina, Resume — indice, punti e archivio delle gare identici al bit, e il round 3 riparte accumulando sopra. E l'accumulo dei punti è stato ripercorso su cinque round interi (skip e guidati): sempre cumulativo, mai parziale. La correzione è sui percorsi, non sull'aritmetica.

### 2.4sexies-novies La torre e i doppiati (Apex 3)

«Fa sempre confusione nell'ordine con i doppiati.» Misurato prima di toccare niente: l'**ordine** era giusto — nessun salto di distanza in una gara da quindici giri, e la fila mostrata non si discostava mai di più di due posizioni da quella vera, che è l'isteresi che impedisce a due auto affiancate di scambiarsi di posto sessanta volte al secondo. A essere sbagliata era la **colonna dei distacchi**, e in modo sistematico: su 458 righe di doppiati campionate, l'**85%** era scritto come un distacco a tempo. Un'auto un giro sotto leggeva «+0.0» sotto quella davanti. Impossibile capire chi stesse correndo con chi, che è l'unica cosa per cui esiste una torre.

La causa è una definizione sbagliata. «Quanti giri sotto» veniva calcolato dalla **distanza**: *l'auto sulla riga sopra è più avanti di una lunghezza-giro?* Ma essere doppiati non è un fatto di distanza, è un fatto di **giri**, e le due cose non coincidono: Alonso al giro 5 contro il sesto degli altri era doppiato pur essendo sei secondi e mezzo — non un giro intero — dietro a chi lo precedeva in classifica. La domanda giusta è: il leader ha completato più giri di me **ed è davanti a me sulla strada**?

    lapsDown = (leader.lap − c.lap) − (c.lapS > leader.lapS ? 1 : 0)

Il termine di correzione è ciò che la rende esatta, e si vede subito in prova: quando il leader taglia il traguardo legge giro 8 mentre tutti gli altri sono al 7, e nessuno di loro è doppiato — sono semplicemente più indietro nel giro corrente di quanto lui sia avanti nel suo. Senza quel termine l'intera griglia si sarebbe marcata doppiata una volta a giro.

Tre conseguenze sullo schermo. Il distacco di un doppiato è **«+1 LAP»**, sempre, per ognuno di loro e calcolato **contro il leader** invece che contro la riga di sopra. Un intervallo a tempo compare solo fra auto che si stanno davvero contendendo la posizione, cioè sullo stesso giro. E il gruppo del giro dei leader finisce con una **riga tratteggiata**: sotto quella riga nessuno sta correndo con chi sta sopra — metà della confusione non erano i numeri, era che la torre sembrava una coda unica.

Verificato leggendo quello che la torre **disegna davvero**, non ricalcolando la stessa formula: su 445 righe di doppiati in Apex 3 e 475 nella build pit stop, **zero** etichettate male e **zero** righe del giro dei leader marcate per errore. (E «+1 LAP» è la cosa più lunga che quella colonna debba mai dire: il corsivo che le avevo messo sbordava a destra e si portava via la P — via il corsivo, un filo di corpo e di spaziatura in meno, ritaglio misurato **0px** su ogni riga.)

**E poi l'ordine, che invece andava toccato.** Nicola: «l'ordine di arrivo continua a cambiare quando arrivano le ultime macchine.» Vero, e la causa era una scala sbagliata: un'auto arrivata valeva `1e12 + giri`, una ancora in pista valeva la sua distanza — circa 9000. Quindi **nell'istante in cui una qualsiasi auto tagliava il traguardo saltava sopra tutte quelle ancora in corsa**, comprese quelle fisicamente davanti a lei. Sondato direttamente: un doppiato che taglia segnava 1.004e12 contro 8923 di un'auto sul giro dei leader che stava mille pixel più avanti sulla strada. Il doppiato scavalcava, e ricadeva appena quell'auto tagliava; con più auto che rientrano nei giri finali, il fondo della torre si riordinava ogni pochi secondi.

Ora c'è **un solo confronto** (`raceCmp`) usato sia dalla torre sia dal foglio dei risultati — prima erano due funzioni con due risposte diverse per un'auto arrivata, quindi ordine live e classifica finale potevano dissentire. Due regole, quelle che userebbe un commissario:

- due auto **classificate** si separano per giri, poi per cronometro. Mai per distanza: due auto che arrivano a un secondo l'una dall'altra congelano il contachilometri a pochi pixel di distanza, e qualche pixel di rumore del frame non può riordinare un podio;
- tutto il resto si separa per **distanza percorsa**, con l'auto classificata contata al valore che aveva **quando è stata classificata**, non a quello vivo. Un'auto arrivata continua a rotolare oltre la bandiera (misurato, fino a 344px) e una ritirata viene portata via dalla gru: nessuna delle due sta più correndo, e nessuna delle due deve muoversi in classifica.

Un tentativo intermedio metteva l'auto arrivata a «giri × lunghezza del giro», che sembrava giusto e non lo era: `trackProgress` non parte da zero — la griglia sta quasi un giro dietro il traguardo — quindi quel numero finiva un giro sotto le auto in pista e il rimescolamento peggiorava (misurato: PRO passava 6→5→4→3→2→1→2→3→4→5 dopo essere arrivato). Congelare il contachilometri dell'auto stessa è la versione che non ha origini da sbagliare. Misurato dopo: su gare a Circo Massimo, Kettle, Oval e Peanut, **nessuna posizione cambia più dopo l'arrivo**, e torre e foglio dei risultati coincidono pilota per pilota.

### 2.4sexies-decies I rivali, le gru e il cartello (Apex 3)

**MONACO C'È STATO, E NON C'È PIÙ.** Chiesto come circuito nuovo — stretto, tortuoso, chiuso dai palazzi, in riva al mare, senza un dito di verde fra asfalto e barriera — e rifatto tre volte: la prima aveva l'acqua nell'infield, la seconda festonava i rettifili di 28px (meno della semicarreggiata, quindi una retta ci passava lo stesso), la terza è arrivata a venti curve su una carreggiata da 60px, la più stretta del gioco, con tornante, due chicane e il mare da un lato. Misurato contro gli altri diciassette con lo stesso codice era il più chiuso di tutti: 426px di rettilineo percorribile contro i 780-990 della norma, 26.6% della linea guidata dritta contro il 36-76%, dieci arrivati su dieci e zero ritiri. Poi Nicola ha chiesto di togliere i cordoli, e subito dopo di eliminarlo. È stato eliminato: classe, voce nella tendina, sigla, etichetta e posto nel calendario. Il calendario torna a **diciassette** circuiti e nessun'altra pista è stata toccata — il cordolo sul prato, le barriere e i muri sono esattamente quelli di prima.

Resta una cosa dal giro: una stagione salvata che nomina un circuito che questa build non ha più viene **rifiutata** invece di essere caricata. `makeTrack()` su una chiave sconosciuta restituisce un Oval, quindi il round si sarebbe corso altrove con la tabella che stampava `undefined`: meglio una stagione nuova che una che mente su dove si è corso.

**HAMILTON NON ERA UN'IMPRESSIONE.** Contati sui cinque log di Nicola, 110 gare: media di arrivo **4.63** contro 5.42 del secondo, 43 podi, e **14 delle 47 vittorie andate all'IA** — il triplo dell'atteso su dieci piloti. La causa era una riga: `if (driverName === 'Lewis Hamilton') p.lookBase += 14;`, un bonus di anticipo cablato per lui solo, cioè esattamente ciò che la regola di bilanciamento in cima alla tabella vieta — un vantaggio reale contro cui non è scambiato nulla. Peggio: non entrava nel fit del `trim`, che scala solo il passo in curva e in rettilineo. Ora è una **colonna** come le altre (`look`), distribuita su tutta la griglia secondo il carattere di ciascuno — chi legge lontano (Prost, Lauda, Clark) contro chi frena all'ultimo (Verstappen, Senna) — e pagata nel trim.

Rimisurato in simulazione su 60 gare con il 20% di bagnato: lo spread fra migliore e peggiore passa da **3.00 a 2.12** posizioni (l'obiettivo dichiarato nel file è 2.4), Hamilton scende da 3.83 a 4.42 e le vittorie si spargono su **dieci** piloti diversi. Le uniche due correzioni di trim applicate — Senna e Schumacher, i due estremi — vengono da quel campione da 60 gare e non dalle iterazioni rumorose che avevo provato prima: a 20 gare l'errore standard su una media di arrivo è 0.65 posizioni, e inseguire uno spread di 2.5 con quel rumore significa tarare sul rumore.

**LE GRU ERANO MOLLE.** `applyCraneCollisions` restituiva `1.35` volte la componente di velocità entrante: un rimbalzo, non un ostacolo. Ora ne toglie esattamente una volta, quindi l'auto **scivola lungo** il mezzo e la si aggira come si aggira un muro. Misurato: 260 px/s addosso alla gru diventano 0, senza inversione.

**E IL RELITTO È DETRITO.** Un'auto distrutta spariva dalle collisioni all'istante, quindi ci si passava attraverso. Ora resta solida finché sta a terra e smette di esserlo solo quando è **sollevata dal gancio** o parcheggiata dietro le barriere, perché solo allora non c'è davvero più. Ed è peso morto: chi la tocca prende tutto lo spostamento, il rottame non si muove di un pixel (misurato: separazione da 15 a 22px, relitto fermo a 0.00).

**IL CARTELLO DEL VINCITORE** era una scatola al 20% dell'altezza, in mezzo allo schermo, cioè sulla strada — e compare proprio mentre qualcun altro sta ancora facendo le sue ultime curve. Ora è una striscia sottile appesa al bordo superiore, fuori dalla carreggiata e translucida.

### 2.4septies-decies Anchor, dal foglio di Nicola (Apex 3)

Un circuito nuovo arrivato come **fotografia di un disegno a penna**: un dito verticale in alto a sinistra, un lungo rettifilo in cima, un'ansa a destra che scende e risale, una conca larga a sinistra che riporta al traguardo. Con due indicazioni scritte sul foglio che valgono quanto il tratto: la **linea di partenza** a metà del rettifilo basso e una **freccia** che punta a destra, cioè il senso di marcia. E un avvertimento: «l'ho disegnato male, la larghezza della pista dovrebbe essere costante».

Quindi del disegno si è preso la **forma**. La carreggiata è costante, 100px come Kart e Circo Massimo, e tutto il resto — muro, barriera, cordoli, tribune — lo deriva il gioco dalle stesse regole di ogni altro circuito. Il nome è mio: **Anchor**, perché è quello che sembra — l'asta verticale, il ceppo orizzontale e i due bracci che si arrotolano in basso.

**Due cose il disegno non poteva sapere.** La prima: i due tornanti erano tracciati con le gambe attaccate, cioè con l'isola in mezzo di spessore zero. Il muro sta a 68px dalla mezzeria e la barriera a 80, quindi due tratti non adiacenti devono stare almeno **146px** l'uno dall'altro o non c'è dove disegnarli. Le gambe del dito sono a 176px, quelle dell'ansa a 166. La seconda: il rettifilo alto e quello del traguardo si toccavano, condividendo un bordo; ora stanno a 185px. Misurato sul giro finito, il punto più stretto fra tratti non adiacenti è **176px** contro i 146 richiesti.

**La geometria** è un poligono con un arco tangente a ogni vertice, come Monaco: tangenza esatta per costruzione, e i raggi si stringono da soli finché ogni raccordo entra nel suo lato. Chiusura **0.010px**, rottura di tangenza **0.003°**, torsione esattamente −360°. Dodici curve, raggi da 75 a 140, giro **2925px** — il terzo più lungo del gioco dopo Kart e Comb. Il rettifilo alto è lungo 543px, ed è il punto in cui si sta più a lungo col gas aperto.

**L'arena.** La prima stesura era larga 1156px contro i 1150 disponibili e `centreInArena()` la dichiarava fuori misura — quel controllo esiste apposta per non far passare in silenzio un circuito che non ci sta. Stretta del 2.5% in orizzontale: 1131 contro 1150, 740 contro 765 in altezza.

**Il traguardo sta dove lo ha messo lui**, in fondo al rettifilo basso, che è l'unico tratto che si percorre verso destra — e `checkLapCross()` conta il giro solo attraversando `startX` in quel verso. Ci sono 312px di dritto prima della linea, il che serve anche alla corsia box: l'auto viene presa in carico fra 250 e 360px prima della linea e trascinata alla piazzola, e su un tratto curvo la manovra taglia fuori strada. Verificato con le soste attive: **13 pit stop** in una gara da sei giri, nessuna auto piantata in corsia, **zero fotogrammi fuori pista** durante la manovra.

**Guidabile a tutti e quattro i livelli**: dieci arrivati su dieci e zero ritiri da facile a impossibile, tempo contro il muro fra 0.5% e 1.6% — fra i valori più bassi del gioco. Miglior giro da 19.9s a facile a 14.3s a impossibile.

**Gira in senso antiorario**, come chiede la freccia: 594° di curve a sinistra contro 234° a destra. Il calendario torna a **8 orari contro 10 antiorari**, dalla parte che risparmia l'anulare destro.

**E una nota che non riguarda il circuito ma il modo in cui il gioco viene aperto.** Al primo giro di prova Nicola ha selezionato Anchor e si è ritrovato all'Oval. I file sul disco erano giusti — classe, `case 'anchor'`, etichetta, sigla, calendario — ma il browser aveva ricaricato solo `racing.html` e serviva `main.js` e `track.js` **dalla cache**: il menu mostrava la voce nuova e lo switch, vecchio, cadeva nel `default:` che è l'Oval. Ora ogni `<script>` e il foglio di stile portano un `?v=<data>` che va cambiato quando cambiano quei file; se un cambiamento non si vede lo stesso, ricarica forzata (Cmd+Shift+R). Vale la pena saperlo perché lo stesso inganno può far sembrare "non applicata" qualunque modifica futura.

### 2.4duodevicies Il rivale della stagione (Apex 3)

Tolto il bonus cablato di Hamilton, il campionato e' diventato equo — e Nicola ha notato subito il rovescio: «le performance degli altri risultano un po' appiattite», nessuno contro cui scontrarsi. La sua proposta: in campionato, un pilota a caso prende un "boost" per quella stagione soltanto.

**E' l'idea giusta, e per una ragione che il gioco aveva gia' in pancia.** `skillVariation` — l'estrazione fra 0.8 e 1.1 che ogni pilota fa a inizio stagione — vale il **7% di passo**, tre volte lo scarto fra i caratteri (2%) e piu' di qualunque differenza di telaio. Una gerarchia stagionale quindi esisteva gia', ed era casuale come vuole lui; solo che era **invisibile e senza nome**, quindi si leggeva come rumore e non come un rivale. Il lavoro non era creare la differenza: era darle un nome.

**Come funziona.** All'apertura del campionato uno degli avversari viene estratto **dallo stesso flusso seminato** del calendario e della pioggia (stesso seme, stesso rivale) e per tutta la stagione:

- non subisce l'estrazione di `skillVariation`: prende il massimo (1.1), quindi non esiste il rivale sfortunato al sorteggio;
- prende un **+1.5%** su passo in curva e in rettilineo (`RIVAL_BOOST`);
- **sbaglia il 20% in meno** — un rivale in forma non e' solo piu' veloce, e' anche piu' solido.

Non e' un ritorno al caso Hamilton, ed e' utile dire perche': quello era cablato su un nome e non finiva mai. Questo cambia pilota ogni stagione e muore con la stagione.

**E non e' scritto da nessuna parte.** La prima versione lo annunciava sulla schermata del Gran Premio e lo marcava in classifica con un'etichetta FORM; Nicola le ha fatte togliere entrambe, con la ragione giusta: «chi e' lo si dovrebbe vedere dai risultati, non da un'etichetta». Un rivale dichiarato in anticipo e' un'informazione; un rivale che si riconosce perche' e' sempre davanti e' una stagione. Resta la riga nel **log** — quello e' il registro di cosa e' successo, non un avviso prima che succeda. Nelle gare singole `AI.seasonRival` resta `null` e la griglia e' esattamente quella tarata.

**I numeri sono misurati, non scelti.** Sedici stagioni intere simulate (5 round, 5 giri, dieci avversari), con le gare vere e il disegno saltato:

| | titoli al rivale | piazzamento medio del rivale |
|---|---|---|
| solo boost +1.4%, `skillVariation` a sorte | **0 / 8** | 5.0 |
| boost +1.5% **e** estrazione massima, difficile | **4 / 8** | 1.50 |
| boost +1.5% **e** estrazione massima, medio | **3 / 8** | 1.88 |

La prima riga e' la lezione: col solo boost, il rivale finiva quinto e non vinceva niente — l'estrazione casuale se lo mangiava. Con le due cose insieme e' il favorito dichiarato e perde comunque **nove stagioni su sedici**, che e' quello che serve: qualcuno da battere, non un muro. Il titolo continua ad andare a cinque o sei piloti diversi su otto stagioni.

### 2.4undevicies Il ponte di Crossover: due strade, non un piazzale

Tre segnalazioni in una: sotto il ponte c'e' una barriera che sporge in pista e non si vede, dal ponte si scende di lato, e da sotto in qualche modo si sale.

Sono lo stesso bug. `getClosestPoint()` risponde alla domanda «quanto e' lontano il pezzo di strada **piu' vicino**», e dove due strade si incrociano quella e' la domanda sbagliata: l'unione dei due corridoi e' una X aperta, e dentro la X **non c'e' nessun muro**. Da sopra si esce di lato e si atterra sulla strada di sotto; da sotto si sale sul ponte. E nei quattro cunei d'erba fra le due strade i muri ci sono eccome — con il piano del ponte disegnato sopra, invisibili: e' la barriera contro cui Nicola e' andato a sbattere due volte.

Ora, sui circuiti con ponte, il muro si misura contro la **propria** strada: i nodi della linea attorno all'indice che l'auto sta gia' inseguendo (`car._nodeIdx`, tenuto da car.js con una ricerca a finestra). Lontano dall'incrocio le due risposte sono lo stesso numero; all'incrocio questa tiene ciascuno sulla carreggiata su cui e'. Con una via d'uscita: un'auto trottolata e mal localizzata verrebbe misurata contro una strada dove non e', quindi oltre un muro di margine torna a valere la risposta globale. Verificato spingendo un'auto di traverso a 260 px/s in mezzo all'incrocio: si ferma a 86px dalla **sua** mezzeria — il parapetto — mentre si trova a 1px dalla mezzeria dell'altra strada. Prima ci passava sopra.

Due ritocchi al disegno del ponte, gia' che c'era. Il piano era largo `trackWidth + 30`, cioe' dodici pixel **oltre** la linea dove l'auto viene fermata: grigio che si legge come strada e non lo e'. Ora e' largo quanto il muro, quindi il parapetto sta dove sta il muro. Ed era opaco, quindi il sottopasso si guidava alla cieca: ora e' all'88%, e la strada di sotto con le auto che ci passano si intravede.

### 2.4vicies La VSC era relativa, e si vedeva (Apex 3)

Domanda di Nicola, e la domanda conteneva gia' la diagnosi: «durante la VSC alcune macchine vanno piu' veloce di altre. La velocita' ridotta e' assoluta o relativa a quella massima? In questo caso alcuni telai andrebbero piu' veloce di altri».

**Era relativa.** `vscPowerFactor` valeva 0.28 e moltiplicava la *potenza*: in car.js la spinta del motore, in ai.js il tetto di velocita' `aiTopOf(car) * straightFactor * condition * 0.28`. Tutti e due i fattori portano dentro il **telaio** — `aiTopOf` e' potenza/attrito, cioe' la velocita' massima di quella macchina — e il **carattere del pilota**. Un Bolt (top 1.098) contro un Aero (0.928) sono gia' il 18%; sommato al passo in rettilineo (±2.8%) e alla pescata di `skillVariation`, il risultato misurato su Oval e' che sotto VSC **il piu' veloce del gruppo viaggiava il 32% piu' del piu' lento**: 95 px/s contro 72.

Il muro anti-sorpasso (`applyVscHold`) nascondeva meta' del problema e non l'altra: chi e' incolonnato entro 62px viene limitato alla velocita' di chi ha davanti, ma chi corre in aria libera va al proprio passo, quindi **i distacchi cambiavano durante la neutralizzazione**. Che e' esattamente cio' che una neutralizzazione non deve fare.

**Ora e' assoluta.** `VSC_SPEED = 90` px/s, lo stesso numero per ogni telaio, ogni pilota e ogni livello di difficolta':

- l'IA, sotto VSC, non scala piu' il proprio tetto ma lo sostituisce con `VSC_SPEED` (e continua a frenare per le curve, perche' il limite di curva resta il minore dei due);
- il giocatore ha un **limitatore**: il gas si chiude linearmente negli ultimi 8 px/s prima del tetto e sopra il tetto entra un filo di freno, cosi' chi arriva lanciato scende alla velocita' della VSC in meno di un secondo invece che per solo attrito;
- la potenza resta limitata — al **50%** invece che al 28% — non piu' per fissare la velocita' ma per rendere morbida la ripresa: serve che anche il telaio piu' lento arrivi al tetto, altrimenti il tetto non lega e lo scarto resta.

Misurato di nuovo su Oval, stessa gara, stessa VSC: scarto fra il piu' veloce e il piu' lento **1 px/s, l'1.2%**, e nessuna correlazione col telaio — aero, bolt e ridge stanno tutti fra 86 e 87 px/s. Su Harbour lo stesso. La velocita' di crociera della VSC e' rimasta dov'era (mediana 81 prima, 86 adesso), quindi la neutralizzazione dura quanto durava.

### 2.4unetvicies Il libro dei record non si ricostruisce piu' per intero (Apex 3)

«Perche' ricostruisce tutto il libro dei record ogni volta che apro The Circuits? Non li tiene in memoria?»

Li teneva: `exRecords` in memoria e una copia in `localStorage`, con un'**impronta** della fisica che li ha misurati, cosi' che un libro misurato con altre gomme non venga mostrato accanto a numeri che non gli appartengono piu'. Verificato: da zero sono 1224 giri di qualifica in 31 secondi, salvati in 5.6 KB, e alla riapertura si caricano senza ricostruire niente.

Il problema era **cosa** invalidava l'impronta. Era una sola, e sommava la fisica **e la geometria di tutti i circuiti insieme**: bastava spostare un vertice, aggiungere una pista o toglierne una perche' l'intero libro finisse nel cestino e si ricostruissero milleduecento giri per diciotto circuiti di cui diciassette erano identici a prima. Nei giorni in cui e' arrivata questa domanda ogni build cambiava la geometria — Monaco dentro, Monaco fuori, Anchor dentro, Anchor ristretto del 2.5% — quindi il libro si ricostruiva praticamente a ogni apertura. Funzionava come scritto, ed era scritto male.

Ora le impronte sono **due**: la fisica (gomme, bagnato, profili IA, caratteri dei piloti) resta globale, perche' se cambia quella nessun tempo vale piu'; la geometria e' **per circuito** e invalida solo il proprio. E `exStartBuild` costruisce **solo i circuiti che mancano** invece di azzerare tutto.

Misurato sui quattro casi: da zero 1224 giri e 31s; riapertura 0 giri; **un solo circuito ridisegnato 68 giri e 4 secondi** invece di 1224 e 31; fisica cambiata, di nuovo tutto, che e' giusto. Un diciannovesimo circuito ora costa i suoi giri e basta.

### 2.4duo-et-vicies Tre ritocchi ai circuiti: le punte del muro, la linea di Anchor, il nome di Crossover (Apex 3)

**LE PUNTE DEL MURO.** Screenshot di Thunder: alle punte dei cunei d'erba — dove il muro gira uno spigolo — un uncino di barriera che sporge verso la pista, «piccole barriere che spuntano in mezzo alla pista, e ce ne sono anche in altri». C'erano: **18 punte su 8 circuiti** (F1, Serpent, Triangle, Boomerang, Crossover, Comb, Thunder, Anchor), trovate con una scansione e non a occhio.

La causa sta nel modo in cui il muro dipinto viene ricavato dal muro fisico. La barriera e' il muro (livello R) spinto in fuori di 12px lungo la normale, «mai oltre il crinale». A una punta il cui raggio interno a R e' minore di 12 — un arco da 85.75 contro un muro da 78, a Thunder — i vertici sulla calotta e subito accanto non ce la fanno: il crinale e' li', si fermano a R+4, R+7, in mezzo a vicini arrivati a R+12. Disegnato, e' un uncino di 10-16px che esce dallo spigolo. Misurato su tutte e diciotto: il gruppo di vertici "corti" e' lungo 6-40px di traccia, e i due vertici pieni che lo delimitano cadono **entro un pixel** l'uno dall'altro — perche' e' esattamente li' che i muri a +12 dei due lati si incontrano. Quindi il gruppo si toglie e lo spigolo si chiude su se stesso. Un'isola stretta — i denti di Comb, la spina di Kart, tutta quella di Circo Massimo — e' spinta corta per centinaia di pixel e ha gli estremi lontani: resta com'era.

Chiuso lo spigolo ne e' saltato fuori un secondo, a Triangle. I suoi angoli interni sono di **23 gradi**: oltre lo spigolo i due lati stanno dentro una larghezza di pennello l'uno dall'altro per i primi 19px, piu' dei 24px d'arco che la finestra "innocente" del dedupe protegge. Il tracciato si spezzava li' e lasciava un moncone di muro attraverso lo spigolo, un buco di 14px, e il muro che ricomincia: un pezzo di barriera sciolto sulla punta. Ora un salto breve (≤30px) e' scavalcato dalla corda al vertice successivo — che su un muro E' il muro — e solo un salto lungo, un intero lato d'isola, spezza. Verificato su tutti i circuiti: nessun tratto di barriera che entri nel raggio del muro, 2 run per circuito (piu' le isole di Crossover, Kart e Comb), le 18 punte pulite in un foglio di contatto.

**LA LINEA DI ANCHOR** stava a 23px dalla staccata della prima curva: si passava sotto la bandiera gia' in frenata. Spostata indietro di 70px, a 93 dalla staccata; la griglia (sei file, 180px) resta tutta sul dritto e la finestra da cui la corsia box prende in carico l'auto cade sull'ultimo tratto della diagonale, dentro i 50px di scostamento che tollera. Verificato con le soste: 15 pit stop, nessuno fuori pista in manovra; dieci arrivati e zero ritiri a tutti e quattro i livelli.

**CROSSOVER** si chiama Crossover. Il « — bridge» nella tendina era una didascalia, non un nome.

### 2.4ter-et-vicies Practice apre come un weekend, e la schermata delle gomme legge il meteo giusto (Apex 3)

«In Practice non viene mostrato il meteo e la scelta delle gomme prima di cominciare.» Vero: il pulsante Practice chiedeva il telaio e partiva — sull'ultimo treno scelto, con un meteo tirato a sorte e mai annunciato. Si poteva uscire dai box con le slick sotto la pioggia e scoprirlo alla prima curva. Ora Practice apre con le stesse due schermate di un weekend di gara: telaio, poi gomme sotto la fascia del meteo. Il meteo viene ritirato a sorte a ogni sessione (prima una practice dopo un weekend bagnato ereditava la pioggia di quel weekend). In prova libera niente si consuma — `TOTAL_LAPS` e' 9999 — quindi la riga della durata dice «no wear in free practice» invece di citare una distanza di gara che non c'e'.

Nel verificarlo e' saltato fuori un errore che c'era **anche in gara**. La schermata delle gomme prende il meteo da due posti: la fascia in alto legge `upcomingWeather()`, cioe' il meteo appena fissato per la sessione, ma l'ordine della lista e la riga della durata leggevano `isRaining` — la globale che viene scritta **quando la sessione parte**, cioe' dopo. Al primo weekend bagnato dopo un caricamento la fascia diceva DAMP e la lista si apriva con le slick, con l'intermedia quotata «~0.5 of 2 laps» — la sua vita al tasso di usura dell'asciutto. Due risposte diverse sulla stessa schermata, una giusta e una no. Ora legge tutto dalla stessa fonte: sotto la fascia DAMP la lista si apre con intermedia e full wet, «lasts the distance». Il pannello dei box a gara in corso continua a leggere `isRaining`, che li' e' la verita'.

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

### 3.0quater Kart, e la lunghezza della stagione

**Il circuito.** È **Circus Maximus tre volte**. Circus Maximus è un rettilineo percorso due volte: si va all'andata da un lato di un muro centrale, si gira in fondo, si torna dall'altro. Kart ne impila tre.

Quattro strade orizzontali: tre rettilinei con una spina fra una coppia e l'altra, più un ritorno che riporta dalla fine del terzo all'inizio del primo.

```
  y1  --------------------->     si guida verso destra
      ======= spina =======
  y2  <---------------------     verso sinistra
      ======= spina =======
  y3  --------------------->     verso destra
      ======= spina =======
  y4  <---------------------     il ritorno
```

Sono le **due estremità** a farla funzionare. A **destra** due tornanti normali: da y1 a y2 e da y3 a y4. A **sinistra** due semicerchi **concentrici** attorno allo stesso centro — uno piccolo che porta da y2 a y3, e uno grande che riporta il ritorno fino a y1. Concentrici, e distanti esattamente una spina: è per questo che l'estremità sinistra viene pulita quanto la destra.

Il conto delle sterzate è la prima cosa da verificare su qualsiasi tracciato chiuso: `+180 −180 +180 +180 = +360`. Chiude, e doveva.

I numeri non sono scritti a mano, sono **risolti** (`kart2.js`): le giunzioni chiudono a **0.0000px** e le tangenti a **0.0000°**, perché ogni raggio di tornante *è* metà del passo fra le corsie e i due archi di sinistra condividono il centro.

**Il passo di 152 è scelto contro Circus Maximus stesso.** Su una pista con la spina il vincolo non è lo spazio libero: è che il **muro fra le due corsie esista**. Con un raggio di muro di 58, 152 lascia una striscia di 31.8px di prato interno fra due corsie, contro i 32.8 di Circus Maximus. Sotto i ~120 non ci sarebbe muro affatto e si passerebbe dritti attraverso la spina.

Con 3769px è **il circuito più lungo del gioco** — il precedente, Pettine, sta a 3053. Ed è il punto: tre rettilinei lunghi, lunghi quanto l'arena concede una volta che l'arco di ritorno a sinistra si è preso i suoi 228px. In gara: 8 vetture su 8 al traguardo, 0.9% del tempo fuori pista, giri da 20.2s.

**Ha sostituito Lombard**, la rosa camuna, che è stata rimossa dal calendario su richiesta.

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

### 3bis. Il mondo è 1360×765, e il perché

Nicola: «alcuni circuiti risultano un po' tagliati sulla destra, vengono coperti da una banda verde».

**Cosa succedeva.** Ogni circuito è disegnato a mano perché la sua **erba** tocchi l'arena: da 216 a 1274 nel vecchio mondo, sei pixel di cortesia dentro `[210, 1280]`. Era l'inviluppo giusto finché l'erba era la cosa più esterna disegnata. Poi sono tornati i cordoli larghi e il pavimento del prato è andato a `trackWidth + 18`: `wallRadius = max(grassWidth − 12, trackWidth + 18)`, e dove la strada è larga rispetto al prato vince il pavimento, portandosi dietro il **muro**, la **barriera dipinta** a `wallRadius + 12` e il **margine d'erba**, che viene tracciato fino al più largo fra i due. Tredici circuiti su diciassette uscivano da 2 a 19 pixel oltre il bordo destro del canvas. Lo sbordo era **simmetrico** — i tracciati sono centrati — ma a sinistra finiva sotto la colonna dell'HUD, che è opaca: per questo se ne vedeva un lato solo.

**La prima risposta era sbagliata.** Scalare i tracciati per farceli stare funzionava — tutti e diciassette dentro, tutti i cordoli vivi — ma Comb pagava il 4.6%, e i denti di Comb erano già a 160px contro un muro che ne voleva 176. A 153 il varco è diventato comodo e Nicola ha tagliato dritto per il centro del circuito. **Una correzione estetica che cambia la guida non è una correzione.**

**Il mondo, invece.** 1280×720 → **1360×765**, sempre 16:9 al pixel. L'arena passa da 1070 a 1150 e il circuito più largo ne chiede 1144. Costa il **6.25% di dimensione apparente** — tutto renderizza un po' più piccolo sullo stesso schermo — e non muove nessun circuito rispetto a un altro: niente tempi sul giro diversi, niente record da invalidare.

`centreInArena()` è una **traslazione, e mai altro**. È tutta lì la differenza con la versione buttata via: un circuito spostato di lato è lo stesso circuito; un circuito scalato è un circuito nuovo col nome di quello vecchio. Se un tracciato davvero non ci stesse, non viene schiacciato di nascosto: resta dov'è e `fitOffset.fits` dice di no.

E i cinque numeri (`WORLD_W`, `WORLD_H`, `PANEL_W`, `ARENA_*`) stanno **in `track.js`**, che è il file che ci mette dentro i circuiti. `TRACK_W`/`TRACK_H`/`TRACK_X0` erano una **terza** copia con il commento «main.js has the same pair» — che non è un vincolo, è una speranza, ed era già rotta: il mondo era cresciuto e loro no, quindi le tribune venivano ancora tenute dentro un canvas da 1280. Ora sono alias.

### 3quater. Comb non si taglia più

Il taglio non l'aveva creato la scalatura, l'aveva solo reso comodo. La causa è più vecchia e più semplice: **la strada è 70 per lato**, quindi due denti a 160px lasciano **20px di prato** in mezzo — meno di una macchina. E col muro a 88 i due corridoi guidabili si sovrapponevano di 16px: bastava tenere due ruote su un dente e due sull'altro.

Una barriera in mezzo era la risposta ovvia e **non ci sta**: una barriera vuole un raggio d'auto di franco per lato, 24px, e di prato ce n'erano 20 in tutto. Non esiste uno spessore di muro che fermi il taglio senza stare anche sulla strada.

Quindi i denti si sono allontanati: **160 → 172**, che porta l'U-turn fra due denti da raggio 80 a 86 e allarga il pettine di 36px, assorbiti dai 80px di arena guadagnati. Il pavimento del prato qui è **12** invece di 18, che mette il muro a 82: due corridoi da 82 in un varco da 172 lasciano **8 pixel di terreno che nessuna macchina può raggiungere**, e la barriera tricolore ci viene dipinta sopra dalla macchina ordinaria, perché `getWalls()` disegna il confine dell'area guidabile ovunque quel confine si trovi. **Niente viene disegnato di speciale e niente viene collisionato di speciale.**

Stessa cosa per l'altro punto stretto: il rettilineo del traguardo e il ritorno erano anche loro a 160, e ora sono a 172.

I cordoli non solo restano, sono **più larghi**: erano tappati dalla strettezza degli archi (80 − 70 − 2 = 8px) e gli archi ora sono 86, quindi sono 10. Il giro passa da 3053 a 3159px (+3.5%).

Copertura: `apex2_arena.js` (27 controlli) — inviluppo di tutti e diciassette, «tradotto e mai scalato», e la cresta fra i denti misurata: non guidabile, con la vernice a 3.9px dalla mezzeria.

### 3ter. Il nome del circuito

`quadrato` è la **chiave** di Rectangle, ed è giusto che resti: sta dentro i campionati salvati e dentro ogni log su disco. Quello che non doveva succedere è che arrivasse a schermo. Succedeva in due punti, e sono due modi diversi di sbagliare la stessa cosa:

- `RaceLog.start({ track: trackType })` riceveva la chiave e la stampava — «track quadrato»;
- la tabella di fine stagione ricavava le intestazioni con `(t || '?').slice(0, 3).toUpperCase()` sulla chiave — «QUA».

Ora ci sono due sole porte, `trackLabel(key)` e `trackCode(key)`, e nessuno legge più `TRACK_LABELS` direttamente (c'è un test che conta le occorrenze). Le sigle sono **scritte a mano** in `TRACK_CODES` e non ritagliate: tagliare la chiave è come è nato QUA, e tagliare l'etichetta non sopravvive ai circuiti che abbiamo, perché Circle e Circus Maximus danno entrambi CIR e Crown e Crossover danno entrambi CRO. Sono REC, COM, CMX, CRS, CRW.

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

**4. Sei mescole, tre assi diversi.** La tabella `TYRES` non è più una scala sola. Soft/medium/hard sono un asse — quanta prestazione adesso contro quanta dopo. **Drift** (§6quater) è fuori da quell'asse: baratta aderenza laterale per rotazione. **Inter** e **Wet** (§6quinquies) sono su un asse che nemmeno esiste finché non piove. `chooseTyre` le tratta come tre decisioni separate: se piove sceglie *solo* fra le due da pioggia e la domanda è quanta acqua c'è; se non piove c'è prima un tiro sulla drift, per temperamento, e solo dopo la scala soft/medium/hard.

| | grip | bite | slide | rainGrip | aqua | dryWear | life |
|---|---|---|---|---|---|---|---|
| Soft | 1.090 | 1.010 | — | — | — | — | 0.90 |
| Medium | 1.000 | 1.000 | — | — | — | — | 1.30 |
| Hard | 0.988 | 1.005 | — | — | — | — | 2.60 |
| Drift | 0.780 | 1.000 | **1.55** | — | — | — | 2.00 |
| Inter | 0.940 | 1.020 | — | **2.50** | 0.10 | **4.5** | 1.15 |
| Wet | 0.870 | 1.030 | — | **3.55** | **0.60** | **3.4** | 1.55 |

più `hook 0.58` e `hookBand 320` sulla sola drift: velocità di sterzata restituita solo sotto i 320 px/s, che è ciò che la rende specialista invece che un modificatore piatto (§6quater).

I trattini sono default neutri (`|| 1`, `|| 0`) letti dalla fisica, non voci mancanti in una tabella di lookup: le quattro mescole da asciutto attraversano il codice nuovo e ne escono identiche a prima.


### 4.6quinquies Un'IA che provoca la macchina (Apex 2)

Tutto quello che l'IA faceva era un **profilo di velocità**: calcola quanto veloce si può prendere la curva, poi tieni quella velocità. È un buon modo per essere veloci e non è come guida una persona — chi ruota una curva lenta **tiene il gas dentro** e lascia venire il posteriore.

Misurato prima di toccare niente, quattro giri su sei circuiti: l'IA portava **0.12–0.19** di `powerOversteer` nelle curve lente e lasciava **zero** segni di gomma su tutti e diciassette i circuiti. Una persona ne porta 0.68 e ne lascia decine.

Ora c'è `provoke`: in curva lenta, alla velocità di curva, con lo sterzo dentro, il gas rientra oltre il punto in cui il posteriore comincia a muoversi. **−0.86% sul giro** su sei circuiti, sovrasterzo da 0.138 a 0.175, e zero uscite di pista.

**Il guadagno viene dalla rotazione, non dal gas in più.** C'è un controllo apposta: a `provoke 0.01` il gas arriva esattamente sulla soglia del sovrasterzo e non oltre — stessa quantità di "smetti di veleggiare", nessuna rotazione — e l'IA è **più lenta dello 0.33%**. Tutto il guadagno sta nel far ruotare l'auto.

Quattro guardie, ognuna messa lì da una misura e non dal gusto:

- **solo alla velocità di curva** (`speed > vTarget*0.88 && < 1.05`): provocare in ingresso è sottosterzo, non rotazione;
- **solo con aderenza da spendere** (`gripUse < 0.80`): è la gomma che dice che non ha più niente;
- **solo da una posizione recuperabile** (`edge < 0.88`): a 0.70 la funzione si spegneva del tutto, perché la traiettoria ideale sta incollata ai bordi e `edge` in curva è quasi sempre sopra;
- **mai sotto i 25 px/s né sopra i 190**, dove non ci sarebbe niente da provocare.

**È un temperamento, non un interruttore**: la probabilità è modulata dagli stessi due tratti che decidono chi prende la drift — errori e mani rapide. Senna 0.96, Verstappen 0.82, Schumacher 0.65, Lauda 0.51, Clark 0.46, Prost 0.42. Easy non provoca mai; medium 0.25, hard 0.45, impossible e alien 0.65. La scala di difficoltà regge: 44.9 / 26.3 / 10.4 / −0.6 / −1.3, gradini 18.6 / 15.9 / 11.0.

**Tre errori, tutti miei, tutti nello stesso punto del codice.**

1. Ho scritto `throttle` senza leggere prima quello effettivo: l'IA lascia il campo `undefined` e `car.js` ricade sul booleano, quindi leggere il campo dà 0 su un frame a tutto gas. Scriverci sopra 0.3 è un pedale del freno — il sovrasterzo a Thunder è **crollato da 0.152 a 0.004**.
2. Corretto quello, leggevo il valore **dopo** aver già forzato `up = true`, quindi tornava sempre 1: uno sweep da 0.15 a 1.10 ha restituito tempi identici a due decimali.
3. E la rampa era **al contrario**. Il posteriore si muove solo quando `demand` supera 1.45, e `demand` è potenza × gas / velocità: il gas necessario **cresce** con la velocità. La mia rampa lo riduceva proprio dove serviva di più — a 150 px/s nessun valore sotto 0.74 produce sovrasterzo. Ora il parametro è espresso **contro la soglia**: `provoke 0` ci sta sopra e non succede niente, `provoke 1` è tutto gas. Che è anche quello che sceglie un pilota.

**E una cosa che NON ha risolto, registrata perché era l'ipotesi di partenza.** L'idea era che la drift misurasse male in mano all'IA perché l'IA non provoca mai. Insegnarle a provocare avrebbe dovuto renderle la gomma più utile. **Non succede**: il divario della drift dalla migliore slick passa da −0.62% a −0.53%, cioè niente. La funzione vale comunque — l'IA è più veloce e più viva — ma l'ipotesi era sbagliata e sta scritto nel test.

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
### 4ter-ter Explore: circuiti e piloti (Apex 2)

Due schermate di consultazione dal menu. **Niente di quello che mostrano è una tabella scritta a mano accanto al gioco**: i numeri dei circuiti vengono dai circuiti, le barre dei piloti da `AI_DRIVER_STYLES`, e i record sul giro vengono **misurati** facendo girare la simulazione di qualifica del gioco quando apri una scheda. Un record misurato non può essere in disaccordo con la build in cui è stampato.

**Explore the circuits.** Una griglia di schede, ognuna col proprio tracciato disegnato in scala e la lunghezza. Cliccandone una si apre una pagina con la mappa grande e: lunghezza, curve, sinistre/destre, larghezza della strada, velocità massima, passo gara asciutto e bagnato, penalità del bagnato in percentuale, e il raggio della curva più stretta. Sotto, il **record sul giro** asciutto e bagnato con il nome di chi l'ha fatto e un pallino del colore della mescola, e una tabellina con il tempo di un giro su **ognuna** delle quattro mescole da asciutto.

**Il libro dei record si costruisce una volta sola, per tutti i circuiti insieme.** Prima era pigro: aprivi una scheda e partivano trenta giri di qualifica. Sbagliato due volte — aspettavi ogni volta, e i numeri arrivavano a pezzi, quindi due circuiti non erano confrontabili finché non finivano entrambi. Ora è un batch unico su tutti e diciassette, in background mentre leggi, a fette da 12 ms; aprire una scheda non fa più partire niente.

Cosa copre il batch è stato deciso **misurando** (`qbench.js`, sei circuiti, dieci piloti su ognuna delle sei mescole):

- all'**asciutto la soft fa il record su tutti e sei i circuiti**. Su un giro singolo la gomma è nuova, e nuova è esattamente dove `bite` mette la soft davanti a tutto: `grip × bite` 1.101 contro 1.048 della drift e 1.000 della medium. Quindi solo la soft ha bisogno di tutti e dieci i piloti;
- sul **bagnato le due mescole da pioggia se lo dividono 3-3** — full wet a Oval, F1 e Circle, intermedia a Pettine, Harbour e Kart — perché quale vince è una domanda sul circuito. Entrambe hanno bisogno di tutti e dieci;
- le altre mescole da asciutto non fanno mai un record, ma **l'ordine in cui arrivano** vale la pena saperlo prima di sceglierne una: girano una volta ciascuna con un pilota solo, lo stesso per tutte e quattro, così l'unica cosa che varia è la gomma.

Ogni lavoro gira `EX_RUNS = 2` volte e tiene il migliore, perché l'IA sbaglia di proposito (`errorChance`) e un giro di un pilota che ha sbagliato non è il passo di quel pilota. In tutto **1156 giri di qualifica**, 68 per circuito.

**Il libro viene salvato**, in `localStorage`, dentro un `try/catch` — su `file://` Chrome lancia un'eccezione e la schermata deve funzionare lo stesso, semplicemente rimisurando. La chiave porta un **fingerprint della fisica** che l'ha prodotto: tabella gomme, `WET_GRIP`, profilo Alien, tabella stili piloti, `EX_RUNS`. Se una qualsiasi di quelle cose cambia, il libro salvato viene buttato invece di essere mostrato accanto a numeri che non descrive più. Un libro dei record che sopravvive di nascosto al bilanciamento che ha misurato è peggio di nessun libro.

**«Est. lap» era il nome sbagliato, e si vedeva.** La cifra stava sopra un record più veloce di parecchi secondi senza che niente dicesse perché. Non sono la stessa misura e nessuna delle due è sbagliata: il **passo gara** è una vettura a difficoltà *hard* su medium che guida uno stint; il **record** è un alien su soft nuove che non deve conservare niente. Misurato, il divario va da **+9% a Kart a +28% a Circle** — Circle è tutto curve, quindi difficoltà e velocità di sterzata pesano al massimo e non c'è rettilineo a diluirle. Non è un artefatto di misura: portare la sonda da due a quattro giri non sposta la cifra. Quindi le etichette dicono «Race pace, dry» e «Race pace, wet», una nota sotto la griglia spiega la differenza, e il riquadro dei record mette il **numero esatto per quel circuito**.

**Back torna indietro di un passo, non fuori.** Dalla scheda di un circuito si torna al muro dei circuiti; solo dal muro si esce al menu. Prima si finiva al menu da entrambi, quindi guardare due circuiti di fila voleva dire rientrare dalla porta principale ogni volta.

**Explore the drivers.** Una scheda per pilota: codice, una riga di prosa, i punti di forza e di debolezza, e dieci barre coi valori numerici accanto. I punti di forza **non sono scritti da nessuna parte**: sono le voci su cui quel pilota si scosta di più dalla media del campo, in ciascuna direzione. Gli estremi di ogni barra sono scelti perché i dieci piloti si distribuiscano davvero sull'intervallo — una barra su cui stanno tutti all'80% non dice niente — e c'è un test che verifica che ogni barra usi almeno il 60% della sua corsa.

**Il bagnato è misurato, non letto da un parametro.** C'è una colonna `wet` in `AI_DRIVER_STYLES` e sarebbe la cosa ovvia su cui mettere una barra. Sarebbe anche sbagliata: quella colonna è una **correzione**, non un'abilità — una gara bagnata è dominata dalle curve, quindi lo split curva/rettilineo crea già gli specialisti della pioggia da solo. Quindi la schermata i giri li fa: uno asciutto e uno bagnato per ogni pilota, sui **quattro circuiti su cui il bilanciamento è stato tarato**, ordinati sul **tempo bagnato assoluto** col divario mediato **per circuito** e non sommato (sommare i tempi pesa il circuito più lungo).

Due trappole, entrambe scoperte misurando:

- il primo tentativo usava il **rapporto** bagnato/asciutto. Sul bagnato le curve crollano e i rettilinei no, quindi chi passa più tempo a tavoletta conserva la frazione più alta del proprio tempo asciutto: misurava quanto rettilineo contiene il giro di un pilota, non quanto va sotto la pioggia;
- e la **mescola va fissata**. `simulateQualifyingLap` normalmente lascia scegliere a `chooseTyre`, che è casuale per progetto — giusto in una sessione, sbagliato qui. Un record che dipende dalla gomma che il pilota ha pescato non è un record, è una lotteria, e si vedeva: stesso circuito, detentore e ordine diversi a ogni apertura. Ora tutti girano sulla stessa gomma: **soft** per il record all'asciutto, **medium** per il confronto fra piloti, ed **entrambe** le mescole da pioggia per il record sul bagnato, tenendo la migliore — perché quale delle due sia più veloce è una domanda sul circuito (§6quinquies), e fissarne una avrebbe reso sbagliata metà dei record. Un pallino del colore della mescola accanto al detentore dice quale ha girato.

### 6ter. Il bilanciamento del bagnato, e il bug che lo rendeva impossibile (Apex 2)

La classifica misurata sul bagnato usciva **quasi esattamente al contrario** di quello che il commento in `ai.js` dichiara: Senna il più lento dei dieci sotto la pioggia, Lauda il più veloce, quando i profili dicono l'opposto.

**Nessun valore della colonna `wet` avrebbe potuto sistemarlo, perché la causa stava a monte.** `ai.js` mirava a **0.20** del grip asciutto sul bagnato — con un commento che diceva «matches car.js exactly» — mentre `car.js` ne consegnava **0.13**. Erano andati fuori sincrono quando car.js fu portato a 0.13 perché la pioggia costasse tempo vero, e quella riga non fu spostata con lui.

La conseguenza non era un arrotondamento: sotto la pioggia l'IA credeva di avere `0.20/0.13 = 1.54×` il grip che aveva davvero, quindi puntava a una velocità in curva **circa il 24% troppo alta**, usciva dal limite e strisciava — e **più alto era il `wetSkill` di un pilota, più lontano dal limite puntava**. I piloti destinati a essere i più forti sotto la pioggia erano esattamente quelli che la pioggia puniva.

Ora è una costante sola, `WET_GRIP`, definita in `car.js` e letta da entrambi. Sistemato quello, la sola correzione ha già quasi raddrizzato l'ordine da sola, e la colonna è stata **rifatta per misura** (`wetfit.js`).

Due cose sul fit, imparate sbagliando:

- l'errore va **centrato sulla media** prima di farci un passo sopra. Sia la misura sia il bersaglio sono espressi come divario dal più veloce, quindi il livello non è una grandezza reale: solo le differenze lo sono. Facendo il passo sull'errore grezzo, nove piloti su dieci sono finiti contro lo stesso limite in una mossa sola;
- una singola estrapolazione lineare da un punto di sonda ha sbagliato di **3.4 punti** nel caso peggiore. Iterando con passo smorzato si scende a 1.2.

Ordine finale, dal più veloce al più lento sotto la pioggia, su quattro circuiti:

| | | |
|---|---|---|
| 1. Senna | 2. Schumacher | 3. Hamilton |
| 4. Alonso | 5. Clark | 6. Fangio |
| 7. Verstappen | 8. Prost | 9. Vettel |
| 10. Lauda | | spread 4.9% |

che è quello che dicono i profili: i tre che `ai.js` nomina come i più forti sotto la pioggia sono i tre più veloci, Clark — «quick in the wet» — è quinto, e i quattro i cui commenti dicono che la pioggia non è il loro tempo sono i quattro più lenti.

Anche le descrizioni sulle schede piloti sono state riscritte due volte: una prima per allinearle al cronometro quando contraddiceva i profili, e di nuovo — tornando all'originale — quando il cronometro ha ricominciato a dare loro ragione.

### 6quater. La mescola drift, e perché il grip da solo non bastava (Apex 2)

Una gomma «fatta apposta per driftare». Il nome è facile, dimostrare che lo faccia no: `a2/apex_tyres.js` §5 misura se l'oggetto chiamato Drift sia misurabilmente tale, e ci sono voluti tre tentativi perché **le prime due misure erano sbagliate**, in modi che dicono qualcosa sul modello.

**Errore 1 — il picco di `powerOversteer` su una finestra lunga non misura niente.** `demand` divide per la velocità **in avanti**, quindi quando l'auto ha ruotato abbastanza la componente in avanti crolla, `demand` esplode e ogni mescola si incolla allo stesso numero. Novanta frame a sterzo tutto dentro fanno girare l'auto di 180°: soft, medium, hard e drift tornavano tutte **0.721**. La finestra ora è di venti frame, con la velocità tenuta costante perché `demand` sia identico per tutte e resti solo la mescola a fare la differenza.

**Errore 2 — la velocità laterale e i segni di gomma premiano la soft, e giustamente.** Qui lo scivolamento laterale è per lo più il vettore velocità che resta indietro rispetto al muso, quindi *sembra* più di traverso quello che ruota più in fretta — e la soft ha la velocità di sterzata più alta delle quattro (`grip × bite = 1.101` contro 1.048 della drift). Non dice niente sull'aderenza. Quello che distingue una gomma da drift non è quanto in fretta comincia a scivolare ma che **non smette**, quindi lo scivolamento va misurato da solo.

**Errore 3 — e questo era il più istruttivo.** La prova «calcio laterale, poi lascio tutto» dava lo stesso identico risultato a tutte e quattro: 27 frame per raddrizzarsi. Perché `alignStiffness = 3.5 · (1 − slideRelease · powerOversteer)`, e senza gas `powerOversteer` è zero: la forza che raccoglie l'auto è 3.5 secca per tutti. Il limite sulla forza laterale poi non morde nemmeno a quelle velocità (3.5 × 150 = 525 contro un limite di 973 anche sulla drift). **Tutto l'effetto della mescola su uno scivolamento passa per `slipperiness → powerOversteer → alignStiffness`**, quindi il gas va tenuto: un drift si tiene col gas anche nel codice.

Poi il problema vero. `slipperiness = baseGrip / currentGrip`, quindi il carattere si compra abbassando il grip — ma **il grip è anche il limite sulla forza laterale**, e comprarlo così costa tempo in fretta. Misurato (`driftsweep.js`) a velocità di sterzata fresca costante 1.048:

| grip | bite | slipperiness | costo sul giro |
|---|---|---|---|
| 0.78 | 1.344 | 1.282 | **+1.65%** |
| 0.74 | 1.416 | 1.351 | +3.04% |
| 0.70 | 1.497 | 1.429 | +3.51% |
| 0.62 | 1.690 | 1.613 | +4.10% |

Il canale è esaurito a 0.78. Da lì in poi si compra solo lentezza. Quindi è stato aggiunto **`slide`**, un attributo generico della tabella gomme come `bite` — default 1.00 su tutte le altre — che moltiplica solo il termine di sovrasterzo:

```js
powerOversteer = clamp(((demand − 1.45) / 2.2) · slipperiness · tyreSlide, 0, 1)
```

Con `slide 1.55`: sovrasterzo **+99%** rispetto alla medium, 2.5× il tempo di traverso, 2.5× i segni sull'asfalto. E il costo sul giro **scende** da 1.65% a 1.22%, perché la rotazione in più aiuta davvero nelle curve lente. La fisica non nomina mai una mescola: legge un attributo, come faceva già con `bite`.

#### E poi il rifacimento, perché era mediocre ovunque invece che ottima da qualche parte

Questa prima versione comprava il passo con **`bite 1.344`**: `1.344 × 0.780 = 1.048`, una velocità di sterzata un filo sopra la medium. Funzionava ed era sbagliato, perché **`bite` è piatto** — paga uguale su un curvone a 250 px/s e in un tornante. La gomma usciva un po' peggio della medium *dappertutto* invece che chiaramente migliore *da qualche parte*, che non è una scelta.

Misurato in mano a Nicola, due campionati sullo stesso seed, stessi cinque circuiti, stesso telaio, AI impossible: **3.7% sul miglior giro** (1.6% sul mediano), **98 punti contro 125**, più veloce su un circuito su cinque e per lo 0.9%, e **13 contatti contro 2**. Nessuno l'avrebbe scelta.

Peggio: quel `bite` era **un rattoppo a uno strumento rotto**. Tutti i numeri delle gomme erano tarati contro l'IA, e l'IA non provoca mai la macchina — guida un profilo di velocità calcolato — quindi la drift misurava **0.5–1.3% più lenta su tutti e diciassette i circuiti** e l'unico modo di farla sembrare competitiva era un bonus piatto. Aggiustare la misura è ciò che ha permesso di togliere il rattoppo.

**Ora `bite` è 1.00** — nessun termine da gomma nuova — e la velocità di sterzata è semplicemente quella che dà il grip: **0.78**, un quinto sotto la medium, pagata su ogni curva di ogni giro. Viene ricomprata da **`hook`**, che esiste solo a bassa velocità:

```js
tyreHookAt(tyre, speed) = 1 + hook · clamp(1 − speed / hookBand, 0, 1)
```

Tarato (`driftfit.js`, AI medium, stint solitari) a **`hook 0.58`, `hookBand 320`**. Risultato su tutti e 17 i circuiti (`driftcheck.js`):

| | | | |
|---|---|---|---|
| Pettine (51% lento) | **−3.2%** | Circle (0%) | +4.0% |
| Circo Massimo (22%) | **−2.8%** | Kettle (0%) | +3.4% |
| Kart (18%) | **−1.0%** | Peanut (0%) | +3.2% |
| Thunder (32%) | **−0.5%** | Oval (0%) | +3.0% |

**Correlazione fra "quanta parte del giro è curva lenta" e vantaggio della drift: da r = −0.49 a r = −0.88.** Vince su 6 circuiti su 17 a medium, 8 su 17 a impossible.

Tre cose imparate facendolo:

- **la banda a 160 px/s era troppo stretta.** È la stessa del boost di imbardata, e all'inizio l'avevo riusata per simmetria — ma alle velocità a cui si prendono davvero le curve qui, sotto i 160 ci sta solo un tornante vero: `R=40` è 74 px/s, `R=90` è già 141, `R=130` è 181. Il gancio pagava su due curve al giro e il deficit piatto si pagava su tutte le altre. Da qui `hookBand` per mescola, 320 sulla drift;
- **`bite` sotto 1.0 non si può usare** per addebitare il deficit piatto: **svanisce con l'usura**, quindi un valore sotto uno farebbe *migliorare* la gomma man mano che si consuma. Provato e scartato;
- **la penalità sui circuiti veloci ha un pavimento che non c'entra con lo sterzo.** `grip 0.78` limita anche la forza laterale, e in una curva veloce l'IA è limitata dall'aderenza e non dalla sterzata (`vGrip = sqrt(lat · tyrePerf · R)`), quindi nessun gancio la può salvare lì. La gomma è limitata dallo sterzo dove va forte e dall'aderenza dove va piano, e vengono entrambe dalla fisica invece che da un caso speciale.

**L'IA sa dove conviene.** `AI.chooseTyre` prende ora il circuito e moltiplica la probabilità di pescare la drift per la frazione di giro lento, normalizzata su 0.22 e limitata fra 0.20× e 2.20×. Pettine 33%, Oval 5%. Una gomma specialista distribuita a caso non è una gomma specialista, è un handicap assegnato a sorte.

#### Cosa ha trovato la prima stagione col refit — due difetti, uno grosso

Nicola ha corso `prova` sulla nuova drift, stesso seed, stessi cinque circuiti. **Non ha funzionato come previsto.**

Sul passo non è cambiato quasi niente: **miglior giro all'asciutto +3.7% → +4.1%**, per circuito un pareggio confuso (harbour 9.55 → 9.25 e serpent 11.57 → 11.40 meglio, triangle 8.46 → 8.76 e thunder 11.53 → 11.92 peggio). Quello che è cambiato sono **i giri distrutti**: harbour 10.84 / **16.82** / 9.25 / **17.82**, thunder 11.92 / **17.59** / 12.78 / 12.53. Quattro giri rovinati su venti, **17 contatti contro 13**, e il giro mediano da +1.6% a +12.6% — un numero interamente dentro quegli incidenti, non nel passo.

**Difetto 1 — il gancio sfondava nel bagnato, ed era un bug mio.** La banda è misurata in px/s, ma sotto la pioggia l'aderenza cala a 0.13 del secco e *tutte* le curve scendono dentro la banda: un bonus per curve lente diventa un bonus generale, misurato fra **+29% e +48% di sterzata su tutto il giro**. Nel log si vedeva chiarissimo: circomassimo bagnato, drift da **+15.5% a +1.9%** rispetto alla medium. Una gomma senza battistrada non può andare quasi come una medium sotto la pioggia. `tyreHookAt` ora prende il meteo e restituisce 1 quando piove, leggendo `isRaining` se il chiamante non lo passa — così i due lati non possono essere in disaccordo sul tempo che fa, che è il fallimento di `WET_GRIP` travestito.

**Difetto 2 — `slide` e `hook` si sommavano nella stessa curva.** Vivono entrambi a bassa velocità: il gancio dà sterzata proprio dove il sovrasterzo è massimo, quindi un input piccolo imbarda forte mentre `alignStiffness` — che `powerOversteer` stesso abbassa — ha smesso di raccogliere la macchina. Ora dove il gancio è attivo la gomma **restituisce parte dello scivolamento**: `SLIDE_DECOUPLE = 0.6`, che a gancio pieno lascia 1.22 dei 1.55. Non tutto: una gomma da drift che smette di sovrasterzare nelle curve lente non è una gomma da drift. Misurato con la telemetria del gioco, tempo passato saturi in curva lenta: drift **da 71% a 66%**, ancora sopra soft 61%, medium 57%, hard 53%.

Nessuno dei due tocca la specializzazione: r resta **−0.883** e la drift vince ancora su 6 circuiti su 17.

**E una cosa che resta aperta, onestamente.** L'harness prevedeva triangle, serpent e thunder come vittorie della drift; in mano a Nicola sono state tutte e quattro sconfitte. Il modello dell'IA e le mani umane divergono, probabilmente perché l'IA sfrutta la sterzata in più *calcolando* una velocità d'ingresso più alta, mentre una persona sente il 22% di sterzata in meno ovunque. Una gara per circuito e una varianza di sessione del 3–4% non bastano per concludere.

#### Terza stagione: cosa hanno dimostrato le correzioni, e cosa no

Stessa `prova`, stessi cinque circuiti, drift con gancio + correzione bagnato + scollegamento.

**Lo scollegamento ha funzionato, e su questo i dati sono netti.** Contatti **da 17 a 7** — e **cinque dei sette sono un unico incidente al via a thunder**: Verstappen a 1.03s, Senna a 3.4s, Vettel a 5.7s e 7.3s, tutti nei primi sette secondi partendo dalla P7. Tolta quella gara: **2 contatti in quattro gare**, contro i 12 e 13 delle due versioni precedenti sugli stessi quattro circuiti. Harbour è il giro più pulito mai fatto su drift — 9.42 / 9.69 / 9.82 / 9.53, zero contatti, miglior giro migliore della v1 — e non ci sono più giri da sedici secondi. Punti **100**, il migliore delle tre versioni, con P1 P1 P1 DNF P1.

**La correzione del bagnato ha funzionato.** Circo Massimo torna chiaramente più lenta della medium (11.13 / 10.46 / 16.59 / 12.44 contro 9.98 / 9.58 / 10.08 / 10.63), P1 con un contatto invece di P6 con otto.

**Il costo si è spostato sulle qualifiche, e lì si compone.** Giri di qualifica: harbour 9.136 → P1, serpent 10.350 → P1, circomassimo 10.133 → P1, ma **triangle 8.800 → P6** e **thunder 11.799 → P7**. Quel P7 è diventato quattro contatti in sette secondi e la vettura distrutta a 43.9s. La catena è *gomma → giro secco peggiore → griglia peggiore → contatto al via → ritiro*: difendibile per una mescola che rinuncia al 22% di sterzata piatta, ma è una penalità che si moltiplica invece di essere solo passo.

**Sul passo i dati non dicono ancora niente, e va scritto.** Due gare su cinque hanno avuto un incidente precoce — thunder ritirata al secondo giro, serpent con 14.76 / 24.56 nei primi due giri e **zero contatti**, quindi un'uscita e un rientro. Il numero grezzo dà +11.2% sul miglior giro all'asciutto; tolta thunder è +7.0%; e il contributo di serpent viene da una gara di cui la prima metà è stata buttata (qualifica 10.35 contro 12.38 in gara). Con `n=1` per circuito e due gare rovinate, **nessuna conclusione sul passo in mano umana**. Quello che i dati sostengono è che lo scollegamento ha funzionato; niente di più.

Il campo IA prende la drift nel **14%** dei casi all'asciutto (3 su 10 a harbour, 1 su 10 a thunder), dentro la banda di progetto.

**Stato: chiusa qui.** Non per convinzione che sia perfetta, ma perché l'unica modifica che verrebbe in mente — ammorbidire la penalità in qualifica — sarebbe artificiale: è corretto che una gomma con meno sterzata faccia un giro secco peggiore. Se giocando risulterà sbagliata, il gioco ora registra da solo la mescola, la telemetria per giro e i personal best per gomma, quindi la questione si riapre con dati invece che con impressioni.

Una cosa che il test **fissa apposta**: la soft gira più forte della drift (`grip × bite` 1.101 contro 1.048) e va bene così. Non è la stessa cosa dello scivolare, e dare alla drift più `bite` della soft la renderebbe anche la gomma più veloce del gioco.

### 6quinquies. Le gomme da bagnato (Apex 2)

Due mescole scolpite, **Inter** e **Wet**. Quattro cose dovevano essere vere insieme, e sono tutte misurate in `apex2_wettyres.js` (38 controlli).

**1. Sotto la pioggia non sono una preferenza, sono *la* gomma.** Su stint solitari di 5 giri, ogni mescola da asciutto perde contro ogni mescola da bagnato su ogni circuito: la slick migliore è **17% indietro**. L'IA non porta mai una slick a una gara bagnata.

**2. All'asciutto sono uno sbaglio, e caro.** 12-14% fuori dal passo, ma soprattutto **si distruggono**: `dryWear` 4.5 e 3.4 significa che un set arriva a 3.83 e 2.15 volte la propria vita in una gara di 5 giri. Senza pit stop, questo è ciò che impedisce che «metto le wet e sto tranquillo» sia un'assicurazione gratis. Sotto la pioggia la stessa gomma arriva alla bandiera a 0.68.

**3. Nessuna delle due domina l'altra — e a decidere è l'acqua, non il circuito.** Questo è il punto su cui la prima taratura falliva: con `grip 0.84 / rainGrip 3.30` l'intermedia vinceva 5 volte su 6 e l'unica vittoria della full wet era rumore. La regola dev'essere leggibile. Misurato (`wetsweep.js`) su Oval, Circle e Triangle, a **0.87 / 3.55**:

| | oval | circle | triangle |
|---|---|---|---|
| **strada bagnata pulita** | inter +0.2% | inter +1.8% | inter +0.9% |
| **otto pozzanghere** | wet +1.3% | wet +5.7% | wet +0.9% |

Mezzo punto in una direzione o nell'altra distrugge tutto: 0.84/3.30 dà cinque su sei all'intermedia, 0.90/3.30 dà tutte e sei alla full wet.

Il meccanismo è `aqua`, che toglie il 60% dell'aquaplaning alla full wet. Ha dovuto **alzare il pavimento oltre che appiattire la pendenza** (`(0.45 + 0.30·aqua) − 0.25·aquaplane`): togliere solo il termine dipendente dalla velocità lasciava la full wet appena avanti, perché una pozzanghera dura pochi frame e la differenza non aveva il tempo di vedersi.

**4. L'IA deve mirare alla strada su cui è davvero.** È il bug di `WET_GRIP` (§6ter) disponibile di nuovo, una riga più in là: le mescole da pioggia moltiplicano quella stessa costante, quindi `ai.js` deve leggere `car.tyre.rainGrip` e moltiplicarlo allo stesso modo. C'è un test sul sorgente di entrambi i file.

Qui una misura ha smentito una mia aspettativa e ha avuto ragione lei. Avevo scritto che `gripUse` sulle gomme da bagnato dovesse essere alto come sulle slick, sul presupposto che una gomma che l'IA non sfrutta sia una gomma sprecata. È il contrario: `gripUse` è velocità laterale contro **il limite**, e le mescole da pioggia alzano il limite di 2.4× e 3.1×. Una slick sotto la pioggia sta alta (47%) perché è limitata dall'aderenza; una full wet sta bassa (17%) perché **non lo è più** — e non esserlo è tutto ciò per cui esiste la gomma. Riferimento: una slick all'asciutto sta al 7.7%.

**Scelta dell'IA.** In pioggia `chooseTyre` sceglie fra le due, per temperamento: chi vive sul filo e attacca prende l'intermedia più veloce sperando di schivare l'acqua, chi calcola prende quella che funziona ovunque. La `wetSkill` spinge verso l'intermedia — è la gomma che ti chiede di tenerla in strada nell'acqua alta, e non tutti sanno farlo. Risultato: Senna, Schumacher, Alonso e Hamilton quasi sempre in intermedia, Prost sempre in full wet, Verstappen nel mezzo perché è il più spericolato della griglia ma davvero mediocre sotto la pioggia, e le due cose lo tirano in direzioni opposte. Il 45% della griglia prende la full wet.

**Il meteo era deciso DOPO la scelta gomme, e questo era un bug vero.** `isRaining` veniva impostato dentro `startQualifying` e `startGame`, che girano *dopo* la schermata delle gomme: quella schermata leggeva quindi il meteo della **sessione precedente**. Un round bagnato chiedeva le gomme sotto un banner grande che diceva `DRY` — peggio dell'iconcina che sostituiva, perché sbagliato con sicurezza. E per una gara singola non era nemmeno un problema di dato vecchio: il tiro al 20% non era ancora avvenuto, quindi in quel momento *non esisteva* una risposta onesta.

Ora è una decisione sola: `decideWeather()` la calcola (weekend già fissato → campionato pre-tirato → interruttore o 20%), `commitWeather()` la fissa in `pendingWeather` **prima** che la schermata venga disegnata, e tutto il resto la rilegge. Stessa forma di `WET_GRIP`: se due posti devono essere d'accordo su un fatto, lo leggono da uno solo invece di ricavarlo ciascuno per conto suo. Una nota: `forceWetRace` era una `const` locale dentro le due funzioni, quindi spostare la decisione fuori l'ha lasciata fuori scope — ora la casella viene letta dentro `decideWeather`.

**Il meteo, grande, dove si sceglie.** Era un'iconcina in un angolo del menu, e Nicola ha scelto le slick per una gara bagnata più volte senza vederla. Non è un errore piccolo: una slick sotto la pioggia è il 17% fuori passo, non ci sono pit stop, e la gara è finita alla prima curva. Ora sulla **schermata di scelta gomme** — cioè dove la decisione viene presa davvero — c'è un banner con simbolo, la parola `WET` o `DRY` a 30px, un colore per stato e una riga che dice la conseguenza («treaded rubber, or you will be seconds a lap slower» / «slicks — rain tyres will destroy themselves»). Sta *sopra* i pulsanti, non sotto, e viene ricostruito a ogni apertura: un banner rimasto indietro sarebbe peggio di nessun banner. Lo vede anche il posto due.

**Interfaccia.** Tutte e sei le mescole sono sempre offerte — una slick sotto la pioggia è una scommessa legittima, non una cosa da nascondere — ma l'ordine segue il meteo. Sotto la pioggia il numero in testa non è più `grip × bite` ma `wet grip ×`, perché sul bagnato è il limite di aderenza a mordere e non la velocità di sterzata; e la durata scritta sul pulsante si muove col meteo, o è una bugia: la full wet dice «lasts the distance» sotto la pioggia e «~2.3 di 5 giri» all'asciutto.

**Record in Explore.** Il giro record sul bagnato ora viene simulato su **entrambe** le mescole da pioggia e tiene la migliore, con un pallino del colore della mescola accanto al nome. Fissarne una avrebbe reso sbagliata metà dei record.

### 6sexies. Due tipi di bagnato: `damp` e `soaked` (Apex 2)

La richiesta era: due gare bagnate diverse, **stesso grip**, a cambiare solo il numero di pozzanghere — poche nel primo tipo, molte nel secondo — e pozzanghere di forma più irregolare.

**La misura ha detto che quella prima metà non poteva funzionare, e il perché è interessante.** Se il grip è identico, l'unica leva è l'acqua, e l'acqua è precisamente ciò che la full wet neutralizza (`aqua 0.60`, §6quinquies). Quindi il tipo «poche pozzanghere» dovrebbe essere il regno dell'intermedia. Misurato prima di dire di sì, su sei circuiti e **zero** pozzanghere:

| pozzanghere | 0 | 2 | 4 | 8 |
|---|---|---|---|---|
| chi vince | wet +0.6% | wet +0.9% | wet +1.3% | wet +2.6% |

**La full wet è già avanti a strada pulita.** Il punto di pareggio non sta a un certo numero di pozzanghere: sta *sotto lo zero*. Contare meno pozzanghere non produce una seconda gara, produce la stessa gara con un margine più stretto — e l'intermedia, che nel gioco esiste apposta, non avrebbe più un posto dove essere la scelta giusta.

Perciò la strada bagnata **è** diversa nei due casi, e non solo l'acqua sopra:

- `WET_GRIP = 0.13` resta il fondo. `DAMP_GRIP_MUL = 1.20` lo alza del 20% quando la pista è `damp`: una strada umida ha più aderenza di una allagata, il che è anche l'unica cosa fisicamente sensata da dire.
- la full wet paga quella strada: `dampMul: 0.55` **solo su di lei**, perché è la gomma con più intaglio e su asfalto quasi asciutto sta pattinando su gomma che non tocca. L'intermedia non ha `dampMul`.

Le due leve insieme spostano il vincitore, che era il punto:

| | intermedia | full wet | miglior slick | drift |
|---|---|---|---|---|
| **damp** (1-3 pozzanghere) | **+0.1%** | +1.4% | +4.5% | +14.4% |
| **soaked** (8-12 pozzanghere) | +4.3% | **0.0%** | +11.5% | +20.4% |

Sei circuiti, `dampcheck.js`. Il moltiplicatore è stato scelto misurando, non stimato: **1.35 è stato scartato** perché a Kart faceva della hard la gomma più veloce sul bagnato leggero — una strada umida non deve diventare una gara asciutta di nascosto. **1.20 è il punto**: intermedia avanti dell'1.35% nel damp, e le slick restano 4.5% dietro senza mai vincere.

**Come si tira.** `WET_KINDS = ['damp', 'damp', 'soaked']` — due terzi umido, un terzo allagato, perché la gara estrema deve restare l'eccezione. `puddleCountFor(kind, rand)` dà 1-3 e 8-12. Il tipo viene fissato insieme al meteo, in `commitWeather`, e in campionato è **pre-tirato dal seed** con le altre gare (`nextChampionshipWetKind`): due stagioni sullo stesso seed devono trovare la stessa acqua, o il confronto fra due mescole non regge (§ seed).

**Si vede prima di scegliere le gomme.** Il banner ha tre stati invece di due — `DRY`, `DAMP 🌦️`, `SOAKED 🌧️` — ognuno con la sua conseguenza scritta accanto: «barely any standing water — the intermediate keeps more steering» contro «standing water everywhere — the full wet drives through it». Un banner che dicesse solo `WET` per due gare che vogliono gomme diverse sarebbe il difetto di §6quinquies rifatto con più passaggi.

**La forma delle pozzanghere.** Erano cerchi con un po' di rumore. Ora ogni pozza è **allungata lungo la pista** (`stretch` 1.25-1.80 nella direzione della tangente al nodo più vicino: l'acqua si raccoglie in solchi, non in monete) e il raggio è modulato da due seni di periodo diverso con fasi casuali, campionati su `PUDDLE_LOBES = 19` vertici. Verificato renderizzando: il raggio varia fra il 43% e il 136% del suo valore medio, con 3-7 rientranze per pozza, e nessuna resta convessa.

**Un dettaglio che non è cosmetico.** `wetGripNow(level)` e `tyreRainGrip(tyre, level)` sono le **due sole** funzioni che decidono l'aderenza sul bagnato, e le chiamano sia `car.js` sia `ai.js`. È la stessa disciplina di `WET_GRIP` (§6ter): ora però i numeri da tenere allineati sono quattro invece di uno, quindi la costante nuda non basta più — serve un accessore, altrimenti la prossima variante di meteo riapre il bug con un nome diverso.

Copertura: `apex2_wettyres.js` §8-§9 (54 controlli) e `apex2_signage.js` (56).

### 4ter-bis La pausa (Apex 2)

**Si mette in pausa con Spazio, P o Esc**, o col pulsante nell'angolo, in qualsiasi cosa stia girando davvero: griglia, gara, qualifica, prova libera. Spazio è sicuro perché nessuno dei due schemi di comando lo usa — il posto 1 ha frecce o WASD e il posto 2 prende l'altro — e c'è un test che lo verifica invece di darlo per scontato. `preventDefault` è obbligatorio o il browser scrolla la pagina sotto il canvas.

**Lo schermo di pausa porta dei numeri.** Una schermata che dice solo PAUSA è uno schermo sprecato: l'unico momento in cui il gioco è fermo è l'unico in cui puoi davvero leggere qualcosa. Quindi mostra le cose che a velocità di gara non riesci a registrare, e dice cose diverse in gara e in qualifica perché sono domande diverse.

In **gara**, tre colonne: *La tua gara* (posizione, giro, chi hai davanti e a che distanza, chi hai dietro, quante posizioni hai fatto rispetto alla griglia), *Passo* (ultimo giro, tuo migliore, distacco dal giro più veloce della sessione e di chi è, usura, meteo, bandiera VSC se è fuori) e *La tua auto* (telaio, mescola, vita residua e integrità con due barre, velocità).

In **qualifica**: *Il tuo giro* (posizione provvisoria, tuo migliore, distacco dalla pole, ultimo giro, a che giro sei dei tre), *La tua auto*, e *Sessione* (chi è in pole e con che tempo, quanti hanno già girato, circuito, meteo).

I distacchi usano la stessa aritmetica della torre dei tempi — distanza sul giro divisa per il passo di chi la deve coprire — perché due numeri diversi per la stessa cosa sono peggio di nessun numero. Con **due giocatori** il pannello si comprime a una colonna a testa: sei colonne non sono un pannello, sono un foglio di calcolo.

Il pannello viene ricostruito a ogni pausa e non tenuto vivo: il gioco è fermo, non c'è niente da aggiornare, e un'istantanea non può andare fuori sincrono con l'immagine congelata dietro.

**Ed è trasparente**, perché era la richiesta e ha un senso: una pausa che non lascia vedere la pista non ti dice niente della situazione in cui hai messo in pausa — dov'è l'auto davanti, da che parte gira la prossima curva — che è esattamente quello per cui ti sei fermato. Lo sfondo è passato da `rgba(0,0,0,0.62)` a `0.28` e il pannello da `0.90` a `0.62`, con un `backdrop-filter: blur(3px)` dietro così il circuito si legge senza che i numeri diventino faticosi.

`setPaused()` restituisce esattamente il tempo passato in pausa: `raceStartTime`, `firstFinisherTime` e `vscEndsAt` vengono spostati avanti alla ripresa, quindi una pausa non costa niente. C'è un test che ferma il gioco per 2000ms di orologio a muro e verifica che il tempo di gara trascorso non si muova di un millisecondo.

**Il bug che la pausa ha fatto emergere.** Uscendo dalla pausa le frecce smettevano di far accelerare l'auto. `clearKeys()` — che gira a ogni pausa — faceva `keys.throttle = 0`, uno **zero definito**. Ma tutto lo schema poggia su un solo invariante: *una tastiera non definisce mai la coppia analogica*, perché il routing è

```js
inputs.throttle = k.throttle !== undefined ? k.throttle : (k.up ? 1 : 0);
```

Scrivere `0` rompeva l'invariante in modo permanente: dalla prima `clearKeys()` in poi il fallback non scattava più e l'auto ignorava l'acceleratore per il resto della sessione, per quanto tenessi premuto. **Lo sterzo continuava a funzionare**, perché legge i booleani — ed è per questo che si presenta come «i comandi non funzionano più» invece che «l'acceleratore è morto». Ora si fa `delete`, che riporta l'oggetto alla forma con cui nasce.

Il bug c'era da quando esiste la coppia analogica; la barra spaziatrice l'ha solo reso banale da incontrare, perché mettere in pausa è diventato comodo. Il test di regressione è stato prima verificato **contro il codice rotto** — quattro asserzioni falliscono, e una di queste stampa `123 -> 81`, cioè l'auto che rallenta col piede sul gas — perché un test di regressione che non fallisce sul bug non serve a niente.

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
- **[Apex 2] `keys.throttle` non va mai messo a zero su una tastiera: va cancellato.** L'intero instradamento dei comandi poggia sull'invariante «una tastiera non definisce la coppia analogica», e uno zero definito lo rompe per sempre: l'acceleratore muore e lo sterzo no, quindi sembra tutt'altro problema. Vale per qualsiasi cosa in futuro voglia azzerare i comandi.
- **[Apex 2] Non contare le curve dalla traiettoria ideale.** La traiettoria è precisamente la cosa che raddrizza le curve — frena largo, tocca l'apice, esce largo — quindi qualsiasi soglia sul suo raggio locale lascia cadere le curve larghe. Rectangle veniva dichiarato di due curve quando ne ha quattro. Si contano dai **segmenti**, che sono il progetto.
- **[Apex 2] Una statistica mostrata a schermo va misurata, non letta da un parametro che le somiglia.** La colonna `wet` è una correzione fitted, non un'abilità: ordinarci i piloti dava l'opposto del vero. Vale per qualsiasi barra futura — se il numero non predice il comportamento, non è quel numero che va mostrato.
- **[Apex 2] Se due file devono usare lo stesso numero, devono leggerlo dallo stesso posto.** `ai.js` mirava a 0.20 di grip sul bagnato con un commento che diceva «matches car.js exactly» mentre `car.js` usava 0.13: un'IA che crede la strada il 54% più grippante di com'è passa il limite a ogni curva. Ora è `WET_GRIP`, una costante sola. Un commento non è un vincolo.
- **[Apex 2] Fissa la mescola quando confronti piloti fra loro.** `chooseTyre` è casuale per progetto; qualsiasi misura che confronti due piloti senza pinnarla sta in parte tirando i dadi.
- **[Apex 2] Prima di misurare `powerOversteer`, tieni ferma la velocità.** `demand` divide per la velocità in avanti, quindi qualunque cosa faccia perdere velocità all'auto — più grip, più rotazione, una pozzanghera — alza il sovrasterzo per motivi che non c'entrano con quello che stai misurando. Su una finestra lunga l'auto ruota, la componente in avanti crolla e **tutte le mescole convergono sullo stesso numero**. È successo due volte con valori diversi (0.721 e 0.000) prima che fosse chiaro.
- **[Apex 2] Uno scivolamento senza gas non distingue niente.** `alignStiffness = 3.5 · (1 − slideRelease · powerOversteer)`: a gas chiuso `powerOversteer` è zero e la rigidezza è 3.5 per tutti. Anche il limite sulla forza laterale non morde alle velocità normali. Tutto l'effetto della mescola su un traverso passa per `slipperiness → powerOversteer → alignStiffness`, quindi il gas resta dentro.
- **[Apex 2] Un attributo nuovo sulla tabella gomme deve avere un default neutro nella fisica, non una tabella di lookup.** `tyre.rainGrip || 1`, `tyre.aqua || 0`, `tyre.dryWear || 1`: così le mescole vecchie attraversano il codice nuovo e ne escono identiche, e c'è un test che verifica che le quattro da asciutto **non dichiarino** nessuno dei tre.
- **[Apex 2] Non basta che ognuna delle due opzioni vinca da qualche parte: la regola dev'essere leggibile.** Inter contro full wet vinceva 5-1 e sembrava «bilanciato». Non lo era: era una gomma migliore più un circuito rumoroso. La taratura giusta è quella in cui si può dire *perché* — strada pulita l'intermedia, acqua alta la full wet, su tutti i circuiti.
- **[Apex 2] Se lo strumento non sa misurare una cosa, non tararla: aggiusta lo strumento.** Il `bite 1.344` della drift esisteva solo perché stavo misurando contro l'IA, e l'IA il sovrasterzo non lo provoca: nelle mie misure l'unico modo di non farla risultare lenta era un bonus piatto. Era un rattoppo, non una scelta di progetto, e ha reso la gomma mediocre ovunque per un anno di conversazione. La strada giusta era registrare la mescola nel log e i personal best per gomma — cioè imparare a misurare in mano al giocatore — e solo dopo tarare.
- **[Apex 2] "Più grandi" non vuol dire "dappertutto".** Alla richiesta di cordoli più grandi che coprissero l'erba ho disegnato una banda continua su tutto il giro, entrambi i lati, straights compresi — e ho anche cambiato `getSurface` perché la vernice non mentisse. Non era quello: li voleva **solo all'interno delle curve**, come sono sempre stati, ma larghi. Gli screenshot lo dicevano già: a Thunder i rettilinei erano nudi. Peanut sembrava una banda continua solo perché è fatto interamente di archi.
- **[Apex 2] Il pavimento del muro è +18: è la larghezza del cordolo a deciderlo.** Prima +2, poi +9 per farci stare un cordolo qualsiasi, infine +18 perché un cordolo *largo* vuole 16px di prato. Il numero non è estetico: `verge = wallRadius − trackWidth` è tutto lo spazio che esiste fra l'asfalto e l'armco, e ci devono stare cordolo e margine.
- **[Apex 2] Il pavimento del muro è +9, non +2, perché sotto ci deve stare un cordolo.** `wallRadius = max(grassWidth − 12, trackWidth + 9)`. Con +2 quattro circuiti avevano 2-4px di prato e nessun cordolo poteva starci dentro al muro. È un pavimento unico e non diciassette modifiche separate perché il requisito è lo stesso ovunque: la maggior parte dei circuiti guadagna un pixel, i quattro stretti da cinque a sette.
- **[Apex 2] Un test che fissa un tempo del giocatore e si aspetta una posizione si rompe appena l'IA cambia passo.** Due test di qualifica sono caduti quando l'IA ha imparato a provocare: il tempo scelto cadeva una posizione più indietro. Peggio, il campo è diventato abbastanza costante che due IA segnano lo stesso tempo **al microsecondo**, e un "punto medio" fra due tempi uguali è un pareggio che sposta il giocatore. Ora cercano una coppia di tempi *distinti* e verificano lo slot relativo.
- **[Apex 2] Non contare i giri guardando cambiare `lastLapTime`.** Due giri identici al millisecondo collassano in uno, il totale di tre giri contro quattro si legge come un **−25%** che non è mai successo, e la sonda lo riporta senza battere ciglio. Si contano da `car.lap`. Ha ingannato due tabelle prima di essere notato.
- **[Apex 2] Quando una misura sembra spettacolare, chiedersi prima se il giro è stato guidato.** Un −24% a Kart era l'auto che tagliava la pista con il 14% del giro sull'erba. Le sonde ora scartano i giri con le ruote fuori e dicono quanti circuiti sono rimasti utilizzabili.
- **[Apex 2] Due funzioni sorelle devono porsi la stessa domanda nello stesso modo.** `chooseChassisForWeekend` aveva la guardia "c'è qualcuno che guida?" dalla nascita e `chooseTyres` no: in modalità spettatore la schermata delle gomme compariva sopra una gara già partita, chiedendo che mescola mettere a una macchina che nessuno guidava. Ora la domanda è una sola, `anyoneDriving()`, e sa che il campo di un campionato è deciso alla creazione e non dal menu.
- **[Apex 2] Se una cosa "non si vede", controlla anche cosa le sta sopra.** Le barriere interne di Thunder e Comb sembravano mancanti e invece venivano disegnate correttamente: era il **cordolo** a coprirle. `kerbWidthFor` limitava il cordolo su `barrierRadius()` — dove va la *vernice* — invece che su `wallRadius()`, quindi su tutti e diciassette i circuiti il cordolo sborda va 6-8px oltre il muro. Innocuo su un curvone; sull'interno di una curva stretta no, perché lì "fuori dalla strada" punta verso il centro dell'arco: il confine è un cerchietto e lo scostamento della barriera lo restringe ancora. All'interno del tornante di Thunder il muro sta a 17.75px dal centro dell'arco e la barriera dipinta collassa a un punto di 5.75px, mentre il cordolo copre tutto fino a 25.75.
- **[Apex 2] Quando l'inferenza gira a vuoto, disegna.** Ho passato tre misure a dedurre il difetto dai numeri — copertura del confine, vernice su superficie guidabile, frammentazione dei tratti — e tutte dicevano «a posto». Renderizzare i due circuiti in SVG con la stessa geometria del gioco, e ricolorare il cordolo di magenta, l'ha reso ovvio in due immagini. Per un difetto visivo, guardare costa meno che ragionare.
- **[Apex 2] Prima di mostrare un dato, chiedersi se a quel punto esiste già.** Il banner del meteo sulla schermata gomme è stato subito sbagliato: `isRaining` viene impostato dentro `startQualifying`/`startGame`, che girano *dopo*, quindi mostrava il meteo della sessione precedente — e per una gara singola il tiro al 20% non era nemmeno avvenuto. La correzione non è leggere meglio: è **decidere prima** e fissare il risultato (`commitWeather` → `pendingWeather`).
- **[Apex 2] Un'informazione va messa dove si prende la decisione, non dove è comoda metterla.** Il meteo c'era già — un'icona nel menu — e veniva mancato lo stesso, perché la scelta delle gomme avviene su un'altra schermata. Spostarlo sulla schermata di scelta gomme, grande, con la conseguenza scritta accanto, è costato dieci righe. Vale per qualsiasi cosa che il giocatore «avrebbe dovuto vedere».
- **[Apex 2] Una classifica senza il round non dice niente.** «Current Standings» con 145 punti non fa capire se manca una gara o sei. Il numero del round esce da `championshipState`, contato *dopo* l'incremento, e a fine stagione la tabella smette di chiamarsi «current».
- **[Apex 2] Un incidente non è un dato sul passo, e va tolto prima di mediare.** Nella terza stagione due gare su cinque avevano un'uscita o un ritiro al secondo giro: il divario grezzo sul miglior giro diceva +11.2%, tolta la gara ritirata +7.0%, e il resto veniva da una gara buttata a metà. Prima di concludere qualcosa sulla velocità, guardare **quante gare sono utilizzabili** — con `n=1` per circuito ne bastano due storte per inventare un risultato.
- **[Apex 2] Una penalità sul giro secco si moltiplica, una sul passo gara no.** La drift costa sterzata, quindi costa qualifica, quindi costa griglia, quindi costa contatti al via: P7 a thunder è diventato quattro botte in sette secondi e un ritiro. Quando si toglie prestazione a qualcosa, chiedersi se la si sta togliendo in un punto che si propaga.
- **[Apex 2] Una soglia in px/s non significa la stessa cosa sotto la pioggia.** L'aderenza cala a 0.13 del secco, quindi *tutte* le velocità in curva scendono: qualsiasi bonus "sotto X px/s" diventa un bonus generale quando piove. Il gancio della drift regalava fra +29% e +48% di sterzata su un giro bagnato intero. Vale per qualunque futura soglia sulla velocità — vanno chieste rispetto alla velocità *disponibile*, non a un numero fisso.
- **[Apex 2] Due effetti che vivono nella stessa fascia si sommano, e la somma è la cosa che si sente.** `slide` e `hook` sono entrambi a bassa velocità: presi singolarmente erano tarati, insieme producevano 17 contatti e quattro giri distrutti su venti. Quando si aggiunge un termine, guardare *dove* agisce e cosa c'è già lì.
- **[Apex 2] Un bonus piatto non può fare una gomma specialista.** `bite` moltiplica la velocità di sterzata in ogni curva, quindi paga uguale sul curvone e nel tornante: una mescola costruita con quello sarà sempre "un po' meglio o un po' peggio dappertutto". Serve un termine che dipenda dalla velocità (`hook`), e la sua banda va scelta guardando **le velocità a cui si prendono davvero le curve** — 160 px/s sembrava naturale e copriva due curve al giro.
- **[Apex 2] Un attributo che svanisce con l'usura non può portare un valore negativo.** `bite` sotto 1.0 farebbe migliorare la gomma consumandosi. Vale per qualsiasi futuro termine legato a `max(0, 1 − w)`.
- **[Apex 2] `ai.js` non deve dipendere da `main.js`.** `AI.slowShare` chiamava `makeTrack`, che vive in main.js: negli harness che caricano solo track/car/ai la funzione tornava `null` in silenzio e l'IA distribuiva la gomma specialista a caso. Passa l'oggetto pista, non la chiave. Una dipendenza che fallisce zitta è peggio di una che esplode.
- **[Apex 2] Una cifra derivata va etichettata con come è stata ottenuta, non con cosa sembra.** «Est. lap» stava sopra un record più veloce del 9-28% e non diceva perché: erano due misure diverse (hard su medium in uno stint, contro alien su soft nuove) e la scheda le presentava come se fossero la stessa. Se due numeri sulla stessa pagina non possono essere confrontati, la pagina deve dirlo.
- **[Apex 2] Un dato salvato deve portarsi dietro il fingerprint della cosa che l'ha prodotto.** Il libro dei record è misurato dalla build: cambia una gomma, `WET_GRIP` o un profilo IA e i tempi salvati descrivono un gioco che non esiste più. La chiave in `localStorage` include quel fingerprint, quindi il libro stantio viene buttato invece di essere mostrato con l'aria di essere autorevole.
- **[Apex 2] Con un clock finto, uno slice temporale non si chiude mai.** Gli harness congelano `performance.now()` fra un drain e l'altro, quindi il ciclo `while (performance.now() - t0 < 12)` di `exStep` esaurisce l'intera coda in una chiamata sola. Non è un bug del gioco, ma qualsiasi test che voglia osservare uno stato *transitorio* (una barra di avanzamento a metà) non può farlo così: si verifica la proprietà, o si pilota il renderer a mano.
- **[Apex 2] `gripUse` basso non vuol dire gomma sprecata.** È velocità laterale contro **il limite**, quindi una mescola che alza il limite abbassa il numero. Una slick sotto la pioggia sta al 47% perché è limitata dall'aderenza; la full wet sta al 17% perché non lo è più, ed è esattamente per questo che esiste. Avevo scritto il test con l'aspettativa opposta.
- **[Apex 2] Se la leva richiesta non ha un punto di pareggio, dirlo prima di costruirla.** La proposta era «stesso grip, cambia solo il numero di pozzanghere». Misurato: la full wet vince **anche a zero pozzanghere**, quindi meno acqua non produce una seconda gara — produce la stessa gara con un margine più stretto. Il pareggio stava sotto lo zero, cioè da nessuna parte. Una richiesta che non funziona va misurata e riportata, non implementata alla lettera.
- **[Apex 2] Una costante condivisa smette di bastare appena diventa condizionale.** `WET_GRIP` era un numero solo e due file lo leggevano; con due tipi di bagnato i numeri diventano quattro (strada × mescola) e la costante nuda non basta più. `wetGripNow(level)` e `tyreRainGrip(tyre, level)` sono ora le uniche due porte, e i test controllano il **sorgente** di entrambi i file: la disciplina è la stessa di §6ter, ma un livello più in su.
- **[Apex 2] Non tarare un moltiplicatore a occhio quando può cambiare quale gomma vince.** `DAMP_GRIP_MUL = 1.35` sembrava ragionevole e a Kart rendeva la **hard** la gomma più veloce sotto la pioggia leggera. 1.20 tiene l'intermedia davanti e le slick 4.5% dietro su tutti e sei i circuiti. Il criterio non è «quanto sembra giusto», è *chi vince e dove*.
- **[Apex 2] Un finto pilota che tiene il gas fisso smette di distinguere le mescole appena il resto migliora.** La sezione 3 di `apex2_tele.js` separava drift e medium (71% contro 57% di tempo al soffitto del sovrasterzo); dopo il disaccoppiamento `slide`/`hook` e le vie di fuga più larghe, **tutte e quattro** stanno al 63% perché `powerOversteer` è clampato a 1.0 e ci arriva sempre. Un canale che satura per tutti non misura più niente. Registrato nel test invece di allentare la soglia — la stessa proprietà è misurata a velocità bloccata in `a2/apex_tyres.js` §5, dove nulla satura.
- **[Apex 2] Un test di identità bit-a-bit invecchia quando una feature nuova usa la via nuova.** «Un giro da tastiera è identico alla build pre-analogico» era vero finché l'unico utente del gas analogico era il giocatore. Poi l'IA ha imparato a provocare, e provoca **scrivendo un gas analogico**: la build vecchia legge solo `inputs.up`, gli avversari guidano diverso, e il giro del giocatore cade 0.05 più in là per colpa del traffico. La differenza non era nella cosa che il test voleva proteggere. Ora la sezione azzera `provoke` in entrambe le build e lo dice.
- **[Apex 2] Un inviluppo disegnato a mano scade quando cambia qualcosa che sta più in fuori.** I diciassette circuiti erano fittati sull'**erba**, che era la cosa più esterna che venisse disegnata; poi il pavimento del prato è andato a `trackWidth + 18` per far stare i cordoli, e muro, barriera e margine d'erba si sono spostati oltre quell'inviluppo. Tredici circuiti finivano fuori dal canvas a destra. La correzione è stata **allargare il mondo**, non stringere i circuiti: quando il contenitore è troppo piccolo, cambiare il contenitore non cambia niente di ciò che c'è dentro.
- **[Apex 2] Se non ci sta una macchina, non ci sta nemmeno una barriera.** Fra due denti di Comb c'erano 20px di prato e la risposta ovvia era metterci un muro. Un muro vuole 12px di franco per lato: 24 su 20 disponibili. Non c'era nessuno spessore che funzionasse, e il tempo speso a cercarlo era tempo speso a non accettare che la geometria fosse sbagliata. I denti sono andati a 172.
- **[Apex 2] Una correzione estetica che cambia la guida non è una correzione.** Scalare i tracciati per rimetterli dentro lo schermo era corretto in senso stretto — tutti e diciassette dentro, tutti i cordoli vivi — e costava a Comb il 4.6%, che ha reso attraversabile il varco fra i denti. Il difetto da riparare era che si vedeva una banda verde; il risultato era che si poteva tagliare il circuito. Prima di accettare una modifica geometrica «piccola», chiedersi su quale vincolo di gioco quel piccolo margine stava in bilico.
- **[Apex 2] Uno sbordo simmetrico si vede da un lato solo.** I tracciati sono centrati, quindi uscivano di 19px a destra e di 19px a sinistra — ma a sinistra c'è la colonna opaca dell'HUD. Quando un difetto grafico sembra avere un lato preferito, chiedersi cosa c'è sopra l'altro lato prima di cercare una causa asimmetrica.
- **[Apex 2] Quando si sposta la geometria, il libro dei record va invalidato con lei.** `exFingerprint` teneva gomme, `WET_GRIP` e profili IA ma **non** la forma dei circuiti: durante il tentativo di fit Comb è diventato il 4.6% più corto e ogni tempo salvato descriveva un circuito che non esisteva più. Ora la geometria entra nel fingerprint, sommata dai **segmenti** e non dalle traiettorie: rilassare diciassette racing line a ogni salvataggio sarebbe quasi un secondo per scoprire che non è cambiato niente.
- **[Apex 2] Un `Math.random = origRandom` avanzato rende bugiardo tutto quello che viene dopo.** La sezione 8 di `apex2_wettyres.js` chiama `seedRandom(909)` prima di ogni stint e credeva di confrontare le mescole sulla stessa acqua; una riga più su, un ripristino dimenticato aveva rimesso il generatore vero, e ogni stint pescava pozzanghere nuove. Il margine da misurare è 1.4 punti, lo scarto che questo introduce è ±2: passava le volte in cui l'ho scritto e falliva circa una volta su tre dopo. Ora c'è un `throw` se il generatore seminato non c'è più.
- **[Apex 2] Una soglia sul caso peggiore di un campione è una moneta.** «Ogni pozzanghera ha almeno 3 insenature» su dodici estrazioni passava spesso; su duecento falliva regolarmente, perché chiedeva della più sfortunata di duecento. Le affermazioni sulle forme casuali si fanno su **percentili** — la mediana, e quante stanno sotto — non sul minimo.
- **[Apex 2] Una sigla non si ricava tagliando una stringa.** «QUA» veniva da `slice(0, 3)` sulla **chiave** `quadrato`, che nessuno aveva rinominato perché è storage. E tagliare l'etichetta non basta comunque: Circle/Circus Maximus e Crown/Crossover collidono entrambe. Le sigle si scrivono, e la chiave non deve poter raggiungere lo schermo — una porta sola, `trackLabel`/`trackCode`, con un test che conta quanti la scavalcano.
