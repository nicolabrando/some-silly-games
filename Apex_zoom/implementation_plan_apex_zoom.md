# Apex Zoom — la revisione della visuale

Derivato da **Apex_3** (ago 2026). La meccanica di gioco è identica: fisica,
IA, gomme, danni, VSC, qualifiche, campionato, ghost — nessun numero è
cambiato. È cambiato **che cosa mostra lo schermo**: non più tutta la pista,
ma una **finestra di zoom che segue l'auto che stai guidando**. È questo che
permette di creare piste più grandi del canvas. La parte pit stop della build
separata `Apex_3_pit_stop` è volutamente esclusa.

## L'idea in una riga

Il canvas (1360×765, invariato: elemento, stage HUD e menu non si toccano) non
è più *il mondo* ma una *finestra sul mondo*; il mondo appartiene al circuito
(`track.worldW × track.worldH`, default 1360×765) e la camera decide quale
pezzo se ne vede.

## Che cosa è stato toccato

### track.js
- `SegmentedTrack` dichiara `worldW`/`worldH` (default: il mondo classico).
  `centreInArena()` e il posizionamento delle tribune leggono l'arena dal
  mondo del circuito con la stessa riserva sinistra di sempre: per i 20
  circuiti classici i quattro numeri sono **bit-identici a prima**, quindi
  nessuna coordinata si muove → `geomHash()` invariato → linee di gara
  shipped, ghost e record book restano validi.
- Due circuiti nuovi, il motivo di tutto:
  - **Marathon** (`maratona`): 7,47 km, mondo 2720×1530 (4 volte l'area del
    canvas), rettilineo del traguardo da un chilometro, **18 curve**: una
    chicane, due tornanti e un settore centrale di curve lente fra loro.
  - **Colossus** (`colosso`): 5,06 km, mondo 2200×1300, **15 curve**; il lungo
    ritorno verso ovest è spezzato da due *gradini* (coppia sinistra-destra che
    lascia l'auto puntata a ovest ma sposta la strada in basso): comprano
    quattro curve vere usando lo spazio orizzontale, che qui abbonda, invece di
    quello verticale, che manca. Specchiato, così gira a sinistra e il
    calendario resta bilanciato.
  Geometria costruita come le altre (linee + archi tangenti, chiusura esatta a
  0,000 px, separazione fra corridoi verificata), stessa fisica, cordoli,
  barriere e tribune derivati dallo stesso codice.

- **Pentagon ingrandita e rinominata Lotus** (ago 2026, richiesta di Nicola): da 1,79 km a
  **3,68 km** (2,05×), mondo 1600×1390. Vedi la sezione dedicata più sotto.

### lines.js
Le linee di gara dei due circuiti nuovi sono state ottimizzate e **giudicate
con il simulatore del gioco stesso** (stesso procedimento di genlines,
`RACING_LINE_JUDGE_REPS = 3`) e spedite qui, chiavi `v2:y3sw7f` (maratona) e
`v2:1c7w272` (colosso) — rigenerate dopo il ridisegno dei tracciati. Un
circuito modificato ricade come sempre sul calcolo a runtime.

### main.js
- **La camera** (`camera`, `updateCamera`, `applyWorldTransform` /
  `applyScreenTransform`): segue l'auto con zoom da menu (Wide 1.5 /
  Standard 1.85 / Close 2.3, ricordato in `apexzoom.camera`), guarda un po'
  avanti nella direzione di marcia (max 170 px, smorzato), arriva con
  smoothing esponenziale e scatta secco solo quando è il mondo a
  teletrasportarsi (inizio sessione, griglia rifatta dopo falsa partenza,
  soglia 420 px). Mai oltre il bordo del mondo; su un mondo più piccolo della
  finestra centra tutto e riproduce l'inquadratura vecchia. L'ancora è il
  centro della zona NON coperta dalla colonna HUD (x = 785), non del canvas.
- **Due giocatori, uno schermo**: niente split screen; la camera inquadra la
  coppia, allargando solo quanto serve (padding 190 px, zoom mai sotto 0,55)
  e restringendo quando si ricompattano. **Spettatore**: segue il leader, o
  l'auto scelta cliccando la torre tempi (già esistente: `spectateFollow`).
- **I layer pre-renderizzati** (circuito e tribune) sono grandi quanto il
  mondo a `layerScale()` px per unità: ideale `RES × zoom`, con tetto di
  44 Mpx e 8192 px per lato (12 Mpx / 4096 su mobile) perché un mondo grande
  non chieda mezzo giga di canvas. Per frame si blitta **solo il rettangolo
  visibile**. Il verde di fondo riempie la finestra in screen-space, così il
  bordo del mondo non si vede mai.
- **Minimappa** (novità, `drawMinimap`): in alto a destra, silhouette della
  pista bakeata una volta a sessione, un punto per auto (i tuoi cerchiati di
  bianco, i rottami grigi), rettangolo bianco = dove sta guardando la
  finestra. Prezzo della camera: senza, non vedi chi arriva.
- **Semaforo** in screen-space, centrato sulla zona visibile; pioggia e
  minimappa idem (il mondo si disegna in world-space, l'arredo della
  finestra no).
- **Gru / VSC**: il pivot entra dal bordo più vicino del mondo del circuito
  (su Marathon il braccio può essere lungo centinaia di px: voluto, la torre
  resta fuori campo).
- Anteprime (carta del GP, pagina "The circuits") scalano sull'arena del
  circuito; Marathon e Colossus entrano nel menu, nelle etichette
  (MAR / COL) e nel `SEASON_POOL`, quindi nel campionato (calendario fino a
  22 gare) e nel record book (che li misura come gli altri).

### Salvataggi (localStorage)
- **Separati** da Apex_3: campionato (`apexzoom.championship`), seed
  (`apexzoom.season.seed`), record book (`apexzoom.explore.records`) — una
  stagione di qui può contenere Marathon, che Apex_3 non sa costruire.
- **Condivisi** con Apex_3, apposta: ghost (`apex2.ghost.laps`) e personal
  best (`apex2.player.bests`) — stessa geometria e stessa fisica, un giro
  tuo resta un giro tuo. (Con file:// la condivisione dipende dal browser;
  se i due build risultano origin diversi, semplicemente ognuno tiene i suoi.)

### car.js — le auto ridisegnate

A questo zoom un'auto è una cinquantina di pixel a schermo, non più
ventiquattro, quindi il vecchio "lozenge con le ruote" non reggeva più: sono
ridisegnate come monoposto viste dall'alto. **La fisica non è toccata**: la
scatola di collisione, la spaziatura della griglia, la gru e le strisciate
lavorano su `width`/`height` che non cambiano; `paintCarBody` disegna in una
scatola fissa 24×14 e la scala.

Le proporzioni sono mappate da un'auto vera (5,6 m × 2,0 m), non fatte a occhio
— **il primo tentativo era sbagliato proprio lì**: ruote lunghe una volta e
mezza il vero e corpo unico dalla punta alla coda. Due misure hanno risolto:

- **ala anteriore 1,80 m su 2,00 di carreggiata, ala posteriore 1,05**: la
  posteriore è quasi la metà dell'anteriore, ed è il singolo indizio più forte
  che stai guardando una F1 moderna. Verificato a pixel (rapporto 1,4–1,8×),
  non a occhio, perché a occhio sembravano uguali: gli endplate posteriori
  erano più lunghi degli anteriori, il contrario del vero.
- **ruota 0,72 m** ≈ 3,9 unità delle 24, non 5,2.

E il corpo è disegnato **a pezzi separati** — muso ad ago, monoscocca, due
pance, cofano motore — con giunzioni visibili: è quella separazione a impedire
che torni a leggersi come un blocco unico.

Le differenze fra telai sono accentuate come chiesto: **Aero** ha l'ala più
larga a due elementi, i bargeboard e i winglet sulle pance, e la vita più
stretta; **Bolt** ha ali tozze, niente bargeboard, la pinna e le gomme
posteriori più grasse del gioco; **Ridge** ha le pance più larghe e squadrate
con le feritoie di raffreddamento e il roll hoop grosso. La stessa funzione
disegna ora anche l'auto sulla **carta di scelta del telaio**, così quello che
scegli è riconoscibilmente quello che poi guidi. Sul fianco interno di ogni
gomma c'è una banda del colore della **mescola**, come nella torre tempi.

**Costo, e come è stato pagato.** Il disegno nuovo costa 3,4× il vecchio (170 µs
per auto contro 48, cioè 2,0 ms di frame su 16,7 invece di 0,6). Non è
accettabile per qualcosa che non cambia mai: l'immagine di un'auto dipende solo
da telaio, colore, mescola e ingrandimento della camera. Quindi viene disegnata
**una volta in un canvas fuori schermo e poi blittata** — lo stesso trucco già
usato per il circuito. Risultato misurato: **0,37 ms per 11 auto, cioè meno del
vecchio disegno (0,63)** pur essendo molto più dettagliato. La scala si legge
dalla matrice del contesto, così funziona in gara a qualsiasi zoom e anche nei
menu; un'auto appesa alla gru salta la cache e disegna diretta, perché la sua
scala cambia ogni frame. Confrontate le due rese affiancate a scala di gara:
indistinguibili.

### La prova libera partiva col semaforo (bug)

La prova libera eseguiva la procedura di partenza completa: cinque luci rosse,
attesa casuale e **regola della partenza anticipata armata**. Da solo su un
circuito vuoto quella regola non ha niente da sorvegliare — non c'è griglia da
rifare né posizioni da guadagnare — e faceva danno vero: se tieni il gas
premuto aspettando il verde, come chiunque, vieni pizzicato prima che le luci
si spengano. La griglia "si rifà" (una macchina, dove già era), la penalità
viene registrata, e il conto alla rovescia riparte da zero — col gas ancora
premuto, quindi succede di nuovo. **Misurato: cinque penalità in sei secondi e
la sessione che non parte mai.** Non si riusciva a provare il circuito.

Ora la prova fa quello che fanno già le qualifiche: parte e basta. Il ramo del
frame loop dove vive la regola viene saltato, ed è quello a disarmarla; il
semaforo non viene nemmeno disegnato.

### audio.js — il circuito fa rumore

C'erano i motori e la musichetta, e nient'altro. Tutto quello che il gioco
*già rileva* era muto: contatti, ruota sul cordolo, auto che scivola, semaforo,
bandiera a scacchi, VSC — eventi che finiscono perfino nel race log. Quindi non
è meccanica nuova, è cablaggio.

Due categorie, trattate diversamente:

- **Continui** (cordolo, erba, stridio gomme): tre voci costruite **una volta**
  e lasciate girare a volume zero, di cui ogni frame si muove solo il guadagno.
  Costruire un nodo per frame sarebbe costoso e produrrebbe clic; una rampa no.
- **Singoli** (impatti, luci, bandiera, VSC, record personale): costruiti sul
  momento e buttati via.

**Di chi sono le orecchie.** I suoni continui seguono l'auto che segue la
*camera* — la tua se guidi, quella scelta se guardi — perché sono i rumori che
vengono da sotto di te. Gli impatti fanno eccezione: si sentono ovunque
succedano, più piano più sono lontani dal centro dello schermo e panpottati dal
lato giusto, e oltre il bordo della finestra non si sentono affatto. Massimo
tre per frame, perché un tamponamento al primo giro ne alzerebbe una dozzina e
oltre i tre aggiungono solo fango.

Gli agganci sono minimi e in un posto solo ciascuno: `takeDamage` è l'unico
punto da cui passa **ogni** danno del gioco (barriere, ruota a ruota, gru),
quindi il suono non può sfasarsi dal danno; la superficie e lo scivolamento
erano già calcolati dalla fisica e ora vengono solo *pubblicati* sull'auto —
la fisica non chiama l'audio, decide il frame loop.

**Il volume.** Il gioco non aveva alcun controllo del volume. Ora tutto passa
per un unico nodo master (motori, musica ed effetti insieme) e nel menu c'è
**Sound: On / Quiet / Off**, ricordato come lo zoom.

Verificato contando i nodi che il gioco costruisce davvero e leggendo i
guadagni che rampa (in headless non si sente niente): volume off/quiet/on =
0 / 0,45 / 1; tre voci di superficie mute a riposo; auto messa **davvero** su
cordolo, erba e di traverso → i guadagni giusti si alzano e tornano a zero;
impatto vicino = 1 suono, lontano = 0, dieci insieme = 3, sfioramento = 0; a
volume off non viene costruito **nessun** oscillatore.

Nota: la prima versione del test pilotava i guadagni con chiamate finte e
leggeva zero ogni volta — perché il frame loop li riscriveva dall'auto vera
sessanta volte al secondo. Cioè il sistema che funziona. Il test ora muove
l'auto e lascia girare la catena vera.

### racing.html / style.css
Titolo e badge **APEX ZOOM**, i due circuiti (XL) nel menu, il selettore
**Camera zoom**, "How to play" aggiornato (sezione "The camera", riscritto il
paragrafo dei 2 giocatori che prometteva tutta la pista a schermo),
cache-bust `?v=zoom8`. Nel CSS solo il pallino gomma della classifica qualifiche.

## Il bilanciamento dei telai sui circuiti XL

Nicola ha sospettato che piste grandi con rettilinei lunghi penalizzassero
troppo il telaio **Aero**. Misurato con il simulatore del gioco (giro di
qualifica, gomma **bloccata** — `AI.chooseTyre` è randomica e senza bloccarla
si confrontano le gomme, non i telai — 2 piloti × 2 giri, medium, 22 circuiti):

**Aveva ragione, ma non per il motivo che pensava.** La correlazione fra
ritardo dell'Aero e lunghezza del rettilineo più lungo è ≈ 0 (r = 0,03 sui 22
circuiti: su Comb, che ha 784 px di rettilineo, l'Aero *vince*). Il vero
meccanismo è il modello di velocità in curva:

    v = maxSteer / (1/R + maxSteer/500)

che **satura a 500** al crescere di R: su una curva di raggio grande lo sterzo
in più non compra quasi nulla, quindi un telaio che ha pagato lo sterzo con la
velocità di punta (Aero: −7% di top) non ha dove recuperarlo. Non conta quanto
è lungo il rettilineo, conta **quanta parte del giro sta al limite di velocità
massima invece che al limite di sterzo**.

I circuiti XL v1 erano proprio così: raggi da 95 a 180 px e poche curve.

| | curve vere sul giro | giro al limite di top speed | ritardo Aero (asciutto) |
|---|---|---|---|
| Classici (media) | 46% | 31% | 1,2% |
| XL v1 | 29% | 45% | **3,6%** |
| XL v2 (attuale) | 54% | 25% | **1,3%** |

**La correzione è nella geometria, non nei telai**: `car.js` e `ai.js` sono
byte-identici ad Apex_3, quindi ritoccare i numeri dei telai avrebbe
ribilanciato anche i 20 circuiti classici e rotto la parità con Apex_3. I due
tracciati XL sono stati ridisegnati con raggi scelti *contro quel numero*: la
soglia è raggio di linea < 213 px perché una curva conti come curva per
l'Aero, e > 419 px perché lì comandi solo la velocità massima.

Risultato: sui circuiti XL l'Aero passa da 3,64% a **1,27%** di ritardo medio,
cioè esattamente quanto sui classici (1,23%). Sul bagnato gli XL gli sono
addirittura favorevoli (0,17% contro 0,69%) e vince Colossus.

**Nota onesta, fuori dalla richiesta**: sull'intero calendario l'Aero resta
~1,2% dietro a Ridge in asciutto (3 vittorie su 22 contro 12 di Ridge), mentre
sul bagnato i tre sono allineati. Non è una regressione di questa build — è
ereditato da Apex_3, con gli stessi identici `car.js` e `ai.js` — e non l'ho
toccato perché sarebbe una decisione tua, non un effetto collaterale della
finestra di zoom. Se vuoi, la leva giusta misurata è `steer` dell'Aero (vale
−0,351% di tempo sul giro per ogni +1%), quindi 1,030 → ~1,034 chiuderebbe il
divario in asciutto senza toccare il bagnato.

## L'acceleratore attraverso la pausa

`setPaused()` chiamava `clearKeys()` entrando in pausa, "per non lasciare
nessuna auto a tutto gas". Nessuna lo era: il frame loop si ferma in pausa,
quindi non gira una ruota comunque. Costava però una cosa vera — mettere in
pausa con lo spazio tenendo il gas azzerava il flag mentre il tasto era ancora
fisicamente giù, e il browser non manda un nuovo `keydown` per un tasto che non
è mai risalito: alla ripresa l'auto veleggiava finché non partiva
l'**auto-ripetizione** della tastiera. Circa mezzo secondo senza gas, proprio
nel momento in cui stavi ripartendo.

Ora lo stato dei tasti sopravvive alla pausa (i listener restano vivi, quindi
se molli il tasto in pausa il `keyup` arriva e pulisce come sempre; il gas
analogico su mobile torna a zero da solo al `touchend`). L'unico modo per cui
un tasto potrebbe restare incastrato è che la finestra perda il fuoco mentre è
premuto — alt-tab, un'altra app, la scheda in background — perché il `keyup`
va a qualcun altro: per quello c'è una guardia su `blur` e
`visibilitychange`, che è il posto giusto e copre anche la gara in corso, cosa
che la vecchia `clearKeys()` in pausa non faceva.

## Lotus (ex Pentagon), il doppio e più equilibrata di prima

Era 1,79 km nel mondo classico: cinque curve a sinistra da r=115 unite da
cinque rettilinei da 214 px, e nient'altro. Nicola l'ha chiesta più grande
**mantenendo l'equilibrio fra i telai**, che è la metà difficile: entrambi i
modi ovvi di ingrandire un circuito spostano verso Bolt. Scalare tutto per k fa
crescere i raggi, e la velocità in curva satura a 500 al crescere di R
(`v = maxSteer/(1/R + maxSteer/500)`), quindi lo sterzo che un Aero ha pagato
con la velocità di punta smette di valere; allungare solo i rettilinei aggiunge
per definizione tratti a velocità massima. Crescere restando in equilibrio vuol
dire quindi **aggiungere lavoro di curva, non asfalto**.

Così ogni lato porta ora una **chicane** (destra-sinistra con un respiro in
mezzo) e il vertice è sceso da r=115 a r=100. Effetto collaterale gradito:
Pentagon era cinque curve a sinistra e zero a destra, ora è **10 sinistra e 5
destra**.

Il trucco che rende sicuro tutto questo è la simmetria a cinque: il circuito è
**una unità ripetuta cinque volte**, e qualunque unità che giri 72° netti
richiude la figura in modo esatto, perché cinque applicazioni di una rotazione
rigida di 72° sono l'identità. La chicane gira 0° netti, quindi può essere
qualsiasi cosa senza rompere la chiusura.

### Come è stata scelta, e perché serviva un metro nuovo

Ho generato sette varianti e le ho misurate col simulatore del gioco. Al primo
tentativo il risultato era inutilizzabile: misurando lo stesso identico
circuito due volte lo scarto fra il telaio migliore e il peggiore veniva 1,45%
e poi 0,36% — **il rumore era grande quanto l'effetto**, perché l'IA sbaglia
apposta (`errorChance`) e ogni giro è diverso. Alzare i campioni non bastava, e
nemmeno passare a difficoltà `hard`.

La soluzione è stata rendere il confronto **appaiato**: `Math.random` viene
sostituito da un generatore con seme, azzerato allo stesso valore prima di ogni
giro, così i tre telai incontrano *esattamente la stessa sequenza di errori* e
nella differenza resta solo la macchina. Da quel momento la misura è
perfettamente ripetibile (le due righe di controllo danno numeri identici).

| variante | giro | curve vere | a velocità max | scarto fra telai |
|---|---|---|---|---|
| Pentagon com'era | 1792 m | 15% | 0% | 0,85% |
| solo rettilinei più lunghi | 3599 m | 20% | 44% | 1,22% |
| lati sempre in curva, zero rettilinei | 3247 m | 18% | 43% | 1,67% |
| due chicane per lato | 4825 m | 12% | 38% | 1,04% |
| **scelta: una chicane per lato** | **3677 m** | **28%** | **23%** | **0,74%** |

Nota controintuitiva: la variante "lati sempre in curva", pensata per non avere
mai velocità massima, è la peggiore — la linea di gara **raddrizza** le curve
larghe e il 43% del giro finisce comunque a velocità massima. Contano i raggi
della *linea*, non quelli dell'asfalto.

La versione scelta è quindi più grande del doppio **e meglio bilanciata di
com'era** (0,74% contro 0,85%). Verificata anche in gara: 0,09 auto fuori pista
in media (Harbour 0,11, Kart 0,00) e 0,40 ritiri a gara su cinque gare
(Harbour 0,20, Comb 0,00) — traffico normale, non un circuito che rompe le auto.

Nel menu è marcata **(XL)** come Marathon e Colossus, perché anche lei ora non
sta nello schermo, e su richiesta di Nicola si chiama **Lotus**: cambia solo
l'etichetta, la chiave interna resta `pentagon` perché è scritta nei campionati
salvati e nei race log già su disco — stessa scelta già fatta per Rectangle,
che sotto è ancora `quadrato`. Il codice a tre lettere passa da PEN a **LOT**. Fantasmi e record personali della vecchia Pentagon vengono
scartati dal timbro di geometria descritto qui sotto.

## Il fantasma della pista di prima

Lo store dei giri fantasma era indicizzato per **nome del circuito** e verso di
percorrenza, non per geometria. Un fantasma è una lista di **coordinate**:
finché la pista non cambia va bene, ma Marathon e Colossus sono stati ridisegnati
fra la prima build di Apex Zoom e questa, e il giro registrato sul vecchio
tracciato continuava a riprodursi sul nuovo — passando attraverso lo scenario,
su una strada che non esiste più. È esattamente quello che Nicola ha visto in
qualifica.

Ora ogni giro salvato porta `g`, il `geomHash()` del circuito — la stessa
impronta con cui sono già indicizzate la linea di gara e il record book — e in
lettura un timbro che non corrisponde non è un giro di questo circuito.

I giri salvati **prima** di questa modifica non hanno timbro. Restano validi per
i venti circuiti di Apex 3, le cui coordinate non si sono mosse di un pixel (è
la premessa di tutta questa build), quindi un fantasma fatto lì corre ancora
qui; per i due ridisegnati non c'è quella garanzia, e un giro senza timbro viene
scartato invece che guidato dentro un muro (`GEOM_REDRAWN`, che elenca
Marathon, Colossus e ora anche Pentagon). Il primo giro buono
che fai lo rimpiazza con uno timbrato.

**Stesso difetto, stessa cura, per i record personali** (`pbRecord`): un tempo
sul vecchio Marathon non è un record sul nuovo. Erano indicizzati solo per nome
e comparivano nella pagina del circuito come "Your best". Ora sono timbrati
anche loro, e un record di una geometria superata viene sostituito invece che
usato come riferimento da battere. (Il record book dell'IA aveva già questo
controllo e si sanava da solo.)

## La gomma nelle qualifiche

Nella torre tempi e nella classifica finale, accanto al tempo, c'è il pallino
del compound su cui è stato fatto — lo stesso di gara, così "S" vuol dire la
stessa cosa in tutto il gioco. Il compound sta **nella colonna del tempo**
perché è parte di cosa il tempo significa: mezzo secondo è tanto fra due piloti
e niente fra una soft e una hard.

`simulateQualifyingLap` sceglieva la gomma internamente (`AI.chooseTyre`) e
restituiva solo il tempo; ora accetta un parametro d'uscita facoltativo `out` e
ci scrive il compound. È un out-parameter e non un valore di ritorno diverso
perché altri quattro chiamanti (record book, giudice della linea, statistiche
del circuito) vogliono solo il tempo. Finisce anche nel Race Log.

## Il campionato in sospeso non si faceva riprendere (bug)

Nicola: «quando ne inizio uno nuovo mi chiede se voglio scartare quello vecchio
in corso, ma non vedo un tasto resume». Le due cose si contraddicono: l'avviso
di scarto e il banner *Resume* leggono lo stesso salvataggio con la stessa
funzione, `loadChampionshipSave()`. Se uno vede la stagione, l'altro non può
non vederla — a meno che non stia mentendo uno dei due.

Mentiva il banner, e la colpa era **dell'ordine delle righe in main.js**.

`refreshChampResume()` veniva chiamato a fine caricamento, riga 6420. Ma
`loadChampionshipSave()` controlla il calendario salvato contro `SEASON_POOL`,
e `SEASON_POOL` è un `const` dichiarato **otto righe più sotto**. Al momento
della chiamata era nella *temporal dead zone*: la lettura lanciava un
`ReferenceError`, il `try/catch` della funzione lo inghiottiva e rispondeva
`null` — cioè «nessuna stagione salvata». Il banner restava `hidden` con la
stagione lì in `localStorage`. Quando poi il giocatore premeva *Start
Championship*, lo script aveva finito di girare da un pezzo, `SEASON_POOL`
esisteva, la stessa identica chiamata funzionava — e partiva l'avviso di
scarto. Due risposte opposte alla stessa domanda a cinque secondi di distanza.

Ironia: quella chiamata era **già stata spostata una volta** più in basso, per
lo stesso motivo, quando inciampava in `CHAMP_STORE_KEY`. Non abbastanza in
basso.

Tre correzioni, non una:

1. **La chiamata è l'ultima riga del file.** Non «abbastanza in fondo»:
   l'ultima. Sotto non va più niente. Regola posizionale e ottusa, perché un
   `const` nella dead zone qui è invisibile — il `catch` lo copre.
2. **Il `catch` non mente più.** Storage bloccato e JSON rotto restano risposte
   normali («non c'è nulla da riprendere»); un `ReferenceError` o un
   `TypeError` no, quelli vogliono dire che la funzione è rotta. Continua a
   restituire `null` (un salvataggio letto a metà non deve arrivare al gioco)
   ma prima lo scrive in console. È esattamente il messaggio che avrebbe fatto
   trovare questo bug in dieci secondi.
3. **Ogni strada che riporta al menù passa da `showMenu()`**, che aggiorna il
   banner. Prima il banner veniva aggiornato solo al caricamento e al
   salvataggio: era giusto per fortuna, non per costruzione. Adesso uscire da
   una gara con *Quit to menu* a metà stagione mostra il banner subito, senza
   ricaricare la pagina.

Già che c'ero, il testo del banner: prima di girare una ruota sono tutti a zero
punti e l'ordinamento restituiva un colore a caso — c'era scritto «you lead on
0». Niente punti, nessun leader. E ora dice anche **su che circuito** si
riprende: «Round 2 di 10 · Colossus — Niki Lauda leads on 44». Una stagione la
si riconosce da lì.

### Dove sta il tasto

In cima al menù, sopra le tre linguette, banda gialla: *Championship in
progress* a sinistra, **Resume** a destra. Si vede su tutte e tre le linguette,
non solo su Championship, e sta sopra la piega anche con una finestra bassa
(verificato a 620 px d'altezza). *Start Championship* resta quello che era:
inizia una stagione **nuova**, e chiede conferma due volte se ne sta buttando
via una.

## Il gioco si chiama Apex 3

Titolo della schermata iniziale e `<title>` della pagina: **APEX 3**, col numero
nella pastiglia rossa — quella pastiglia era nata per il 2 ed è tornata a fare
il suo mestiere. La cartella resta `Apex_zoom` e **restano anche tutte le
chiavi di `localStorage`** (`apexzoom.championship`, `apexzoom.explore.records`,
`apexzoom.camera`, `apexzoom.sound`, `apexzoom.season.seed`): rinominarle
avrebbe buttato via il campionato in corso, il libro dei record e le
impostazioni. Un nome è un nome.

## Il menu: più largo, più grande, e finalmente ci sta tutto

Era largo 600px su due colonne, e su qualunque portatile sotto i 900px di
altezza **scrollava** — 780px di contenuto in 720 di finestra. Un menu che
scrolla è esattamente il modo in cui il tasto Resume era sparito, quindi
"più leggibile" qui vuol dire due cose insieme: caratteri più grandi *e*
niente barra di scorrimento.

**940px, tre colonne**, con un filetto verticale a separarle:

| | |
|---|---|
| **Session** | pista / lunghezza stagione / seme, giri + avversari, gara bagnata |
| **Drivers** | giocatori, la tua auto, auto del 2° giocatore, difficoltà IA, griglia invertita |
| **Controls & screen** | comandi, audio, zoom della camera |

La **difficoltà IA** è passata sotto *Drivers* — quanto vanno forte gli
avversari è un fatto sugli avversari — e non è una questione di gusto: era
quello che sbilanciava le colonne. In campionato *Session* era alta 382px
contro 224 e 300 delle altre; spostando quel campo le tre diventano 304, 302,
300. La colonna più alta decide l'altezza del pannello, quindi quei 78px sono
usciti dal menu.

La **riga che spiega la modalità** è uscita dalle colonne ed è andata a tutta
larghezza sotto le linguette: in una colonna da 260px erano cinque righe di
testo, adesso sono due, ed è sotto la linguetta che sta spiegando invece che
tre campi più in basso.

Tutto un gradino più grande: etichette 12 → 13.5px, menu a tendina e caselle
15 → 16.5px con più imbottitura, linguette 12 → 14px, il pulsante di partenza
17 → 19px, i suggerimenti 10-11px → 11.5-13px e meno trasparenti. In cambio ho
recuperato l'altezza dove non si legge niente: margini del titolo, spazio
attorno alle linguette, e *How to play* chiuso (che da solo costava 64px fra
bordo e margini, per una riga di testo).

Risultato misurato (`measure_menu.js`, sei formati di finestra):

| finestra | prima | adesso |
|---|---|---|
| MacBook 14" | 780 / 819px, campionato **scrollava** | **696px in entrambe le modalità, ci sta** |
| 1440×900 | scrollava di 13 | ci sta |
| 1280×800 | scrollava di 64-103 | ci sta |
| 900×800 | scrollava di 64-103 | ci sta (tre colonne fino a 860px) |
| 1280×720 | scrollava di 136-175 | scrolla di 52 |

Gara singola e campionato hanno adesso **la stessa altezza esatta** (696px):
cambiando linguetta il pannello non salta più.

## Il punto del giro veloce

+1 in campionato a chi segna il giro più veloce della gara, **solo se
classificato nei primi dieci e solo se arriva in fondo**. È la regola della F1
ed esiste per un motivo: senza la condizione il punto lo prende quasi sempre
chi è fuori dai giochi — un'auto doppiata due volte ha pista libera e niente da
perdere — e chi si ritira si porterebbe via un punto da una gara che non ha
finito. La **stella accanto al tempo resta incondizionata**: il giro più veloce
è un fatto, e capita che sia segnato da chi poi non lo incassa.

La regola vive in una funzione sua, `fastestLapPointFor(isFastest, index,
finished)`, non in una riga dentro la schermata dei risultati: così le si può
fare la domanda senza far correre una gara, ed è così che è testata.

Dove finisce il punto: nella colonna che prima si chiamava **Bonus pts** e ora
si chiama **Extra pts** — «i punti che non vengono dalla posizione d'arrivo».
Ci stavano già i sorpassi guadagnati dalla griglia; il giro veloce è la stessa
categoria. La cella mostra il totale con una **F** in apice quando il punto del
giro veloce è dentro, e il tooltip lo scompone: *«3 posizioni guadagnate (P7 →
P4): +3 · fastest lap: +1»*. Nel registro di gara è un evento a sé
(`FLPOINT`), separato dal bonus sorpassi, altrimenti la riga «+3 per 3
posizioni guadagnate» sarebbe diventata falsa.

Le classifiche non hanno avuto bisogno di modifiche: `bonusPoints` è già «tutto
ciò che non è punteggio d'arrivo», e la separazione *Race pts / Extra pts /
Total* continua a tornare da sola.

### Un errore trovato per strada

La riga **DNS** (il Gran Premio che salti) aveva nove celle contro le undici
dell'intestazione: era rimasta indietro di due colonne da quando erano entrate
*Car* e *React*, e stampava «DNS» sotto *Laps*. Sistemata.

## I tuoi tempi, sulla schermata dove scegli la gomma

Il libro dei record esisteva già e si riempiva da sempre: ogni giro completato
dal giocatore finisce in `pbRecord(pista, gomma, tempo, bagnato, timbro)`,
asciutto e bagnato in caselle separate. Il problema era **quando** si poteva
leggere — solo dal pannello di pausa, a metà sessione, cioè dopo il momento in
cui sarebbe servito. Ora è dove si decide.

Due posti, perché rispondono a due domande diverse:

- **Su ogni pulsante**, una riga in fondo: `you 18.417`, cioè il tuo miglior
  giro su quella mescola **nel meteo che stai per trovare**, in verde se è il
  tuo più veloce fra tutte le mescole in quella condizione, e `you —` se su
  quella gomma qui non hai mai girato. Sul pulsante perché è lì che è già il
  dito.
- **Sotto i pulsanti**, il libro completo: una riga per mescola, ☀️ Dry e 🌧️ Wet
  in due colonne, con la **colonna di oggi evidenziata** e il migliore di ogni
  condizione in verde. Risponde alla domanda che il pulsante non può
  rispondere: *e con l'altro tempo, com'era?* Compaiono solo le mescole su cui
  hai davvero un tempo — sei righe di trattini sarebbero una tabella che non
  dice niente — e se su quel circuito non hai mai girato non c'è tabella ma una
  riga: *«No laps of your own at Kart yet — whatever you set today becomes the
  time to beat.»*

Nel tooltip di ogni cella c'è **quando** è stato fatto quel tempo («set 3 days
ago»): un giro di tre mesi fa, con un telaio che magari non guidi più, vale
meno di uno di stamattina.

### Tre dettagli che non sono dettagli

**Il circuito giusto.** La schermata gomme arriva *prima* che
`startQualifying()` costruisca qualcosa, quindi `track` è ancora il circuito
della sessione precedente — o niente, in una scheda appena aperta. Serviva
`upcomingTrackKey()`: in campionato il round corrente del calendario, altrimenti
la tendina del menu. Stesso ragionamento di `upcomingWeather()`, che esisteva
già per il meteo.

**Il tracciato giusto.** Un record è un tempo su una **geometria**, non su un
nome: le stesse regole del fantasma. `upcomingGeomStamp()` chiede il timbro al
circuito se è già costruito, altrimenti ne costruisce uno solo per calcolarlo —
0,5-0,8 ms anche per Marathon, invisibile su una schermata di menu. Un tempo
sul vecchio Marathon quindi **non compare**: non è un record su questa pista.

**Asciutto e bagnato, e basta.** Il libro non ha mai distinto *damp* da
*soaked*, e inventare la distinzione adesso vorrebbe dire o buttare via tutti i
giri sul bagnato già salvati o fingere di sapere che tipo di pioggia fosse
ciascuno. Quindi una colonna bagnato è una colonna bagnato, e la nota sotto la
tabella lo dice.

La tabella compare anche prima della gara e della prova libera, non solo prima
delle qualifiche: è la stessa schermata e la stessa decisione. La chiave di
`localStorage` resta `apex2.player.bests` — non è namespaced come le altre, e
rinominarla butterebbe via i tempi fatti da Apex 3 in poi.

## Anche il log si chiama Apex 3

Il file scaricato dal Race Log si chiamava ancora `apex2-log-….txt`, mesi dopo
che la schermata iniziale aveva smesso di dirlo. Adesso è `apex3-log-….txt`, e
il file si presenta: prima riga **APEX 3 — race log**, poi la data di
esportazione e quante sessioni contiene. Un log riletto fra sei mesi deve dire
da cosa è uscito.

Il nome sta in **un posto solo** (`RaceLog.title`) perché compare in due — in
cima al file e nel nome del file — ed è esattamente così che avevano divorziato.

Restano `apex2` due chiavi di `localStorage`: `apex2.ghost.laps` (i fantasmi) e
`apex2.player.bests` (i tuoi tempi). Non le vede nessuno se non aprendo gli
strumenti da sviluppatore, e rinominarle vorrebbe dire buttare via i fantasmi e
tutto il libro dei record, cioè proprio i tempi che la schermata gomme ha
appena cominciato a mostrare. Il nome è quello che si legge; quelle sono
serrature.

## La falsa partenza non costa più cinque secondi

Nicola: «cinque secondi sono adeguati o troppi? Tanto non si può ingannare il
sistema, nessuno guadagna nulla tentandola». Aveva ragione, e i numeri lo
dicono — ma non del tutto, e la parte che mancava era proprio quella che
giustificava la penalità.

**Quanto costavano davvero cinque secondi.** Misurato su dodici gare simulate a
calendario fisso (`measure_penalty2.js`): a 5 giri gli arrivati sono separati
da 0,85s, quindi +5s costano in media **2,9 posizioni**, e su circuiti corti si
arriva a 4,2. In F1 gli stessi cinque secondi ne costano **una**. Fuori scala
di tre-quattro volte.

**E il motivo per cui esistono in F1 qui non vale.** Una partenza anticipata non
guadagna un centimetro: la griglia si rifà, le velocità si azzerano, i contagiri
si cancellano. Non c'è nessun vantaggio da togliere.

**Però un buco c'era.** Il semaforo del restart pescava fra 2,6 e 4,2 secondi,
quello della partenza vera fra 2,6 e 6,5: una finestra due volte e mezzo più
stretta, quindi più facile da anticipare. Bruciare la partenza per farsene dare
una più leggibile era l'unico modo di fregare la procedura, ed era gratis.
Adesso le due pescano dalla stessa `rollGoDelay()` — una funzione sola, così non
possono più divergere.

### La formula

    penalità = 5% di un giro qui  x  radice(giri / 5)

minimo 1 secondo, massimo 5.

Il primo fattore è il rapporto della F1: cinque secondi su un giro da novanta.
Il secondo c'è perché **il campo non si allarga in proporzione alla distanza**.
Misurato sugli stessi tre circuiti:

| giri | gara del vincitore | ampiezza del campo | per giro | una posizione vale |
|---|---|---|---|---|
| 3 | 57s | 10,5s | 3,50s | 0,72s |
| 5 | 101s | 11,8s | 2,35s | 0,85s |
| 10 | 201s | 15,4s | 1,54s | 1,23s |
| 20 | 401s | 20,5s | 1,03s | 1,62s |

Sestuplicando la distanza il campo si allarga del doppio: i distacchi crescono
come la **radice** dei giri. Una penalità lineare nei giri — l'idea ovvia —
ricomincerebbe a strafare sulle gare lunghe come i 5s fissi strafanno su quelle
corte.

Cosa ne esce, in pratica:

| | 5 giri | 20 giri |
|---|---|---|
| Oval (giro 8,7s) | 1,0s | 1,0s |
| Kart (18,0s) | 1,0s | 2,0s |
| Colossus (24,8s) | 1,2s | 2,5s |
| Marathon (36,3s) | 1,8s | 3,6s |

Sui circuiti normali e sulle gare corte **vince il minimo di un secondo**, ed è
giusto così: la formula lì darebbe 0,4-0,9s, cioè esattamente una posizione, ma
sotto il secondo non è una penalità, è un arrotondamento. La formula conta sui
circuiti XL e sulle gare lunghe, che è dove i cinque secondi fissi erano più
sbagliati.

Ogni infrazione successiva costa di nuovo lo stesso, e l'importo esatto lo dice
il cartello («+1.0 second penalty — 5% of a lap here, over 3 laps»), il registro
di gara e il tooltip sul foglio dei risultati.

### Dettagli implementativi

Il giro di riferimento è **lo stesso numero che l'anteprima del Gran Premio
stampa come "Est. lap time"**, così la penalità e la schermata che la annuncia
non possono contraddirsi. Misurarlo vuol dire simulare un giro (50-140 ms),
quindi si fa una volta per circuito per sessione e si tiene in cache — e
l'anteprima la riempie gratis quando disegna. In prova libera non si misura
niente: lì la procedura di partenza non esiste.

L'importo viene calcolato **quando avviene l'infrazione** e portato sull'auto
(`jumpPenaltyMs`), non ricalcolato alla bandiera: il tempo aggiunto al traguardo
è per costruzione quello che il cartello aveva mostrato.

Il valore iniziale di `racePenaltyS` è scritto a mano e non letto da
`JUMP_MIN_S`: quella costante vive più in basso nel file e sarebbe nella
temporal dead zone. È la stessa trappola che aveva nascosto il banner Resume per
un'intera build — due volte in una sessione basta.

## Le linguette, e su quale si atterra

*Championship* è la prima, *Single Race* la seconda. E prima vuol dire anche
predefinita: il menu si apre sul campionato. Una prima linguetta su cui non
atterri si legge come una svista.

## L'archivio delle stagioni

Ogni campionato mai giocato, tenuto. **Non al traguardo finale ma a ogni
round**: una stagione abbandonata al quarto Gran Premio sono comunque quattro
gare, e «salvale man mano» vuol dire esattamente che quella che hai mollato
resta. Lo snapshot lo scrive `saveChampionship()`, che gira alla creazione della
stagione e all'inizio di ogni round.

Da non confondere col salvataggio che già c'era: `apexzoom.championship` è **una**
stagione, quella che puoi riprendere, e viene cancellata quando finisce.
`apexzoom.seasons` è la storia, e non la cancella niente. Massimo 40 stagioni,
le più recenti; se la scrittura non ci sta lo storage viene sfoltito una
stagione alla volta invece di perdere tutto l'archivio per un errore di quota.

Una stagione ha un `id` suo dal momento in cui nasce: il seme non basta (due
stagioni possono condividerlo — è a questo che serve) e l'orario di inizio da
solo collide se ne rilanci una subito.

### La schermata

Dal menu, **The seasons**, tre livelli:

- **La carriera**, in cima: titoli, gare, vittorie con percentuale, podi, pole,
  giri veloci, Grand Chelem, ritiri, punti, miglior piazzamento, gare sul
  bagnato, circuito dove hai vinto di più, telaio che usi di solito, e chi ti ha
  portato via più titoli.
- **L'elenco**: seme, data, round fatti su totali, campione, dove sei arrivato,
  e se è finita o a che round l'hai lasciata.
- **La stagione aperta**: dati del campionato (round, difficoltà, la tua auto,
  quanti round bagnati, campione, tu, e **il rivale della stagione** — quello a
  cui il gioco dà una spinta, che finora spariva insieme alla stagione), la
  classifica completa con partenze / vittorie / podi / pole / giri veloci /
  Grand Chelem / ritiri / DNS / miglior piazzamento / punti gara / punti extra
  / totale per ogni pilota, e la **griglia round per round**.

Tutti quei numeri sono **contati dai verbali di gara**, non salvati accanto a
essi: un totale derivato non può divergere dalle gare che dovrebbe riassumere.
E la griglia round per round è disegnata da `renderSeasonRecap()`, la stessa
funzione della schermata di fine stagione — generalizzata per accettare una
stagione invece di leggere quella in corso, così una stagione di tre mesi fa si
disegna con lo stesso codice di quella appena finita.

## Un file solo, che esce e rientra

Il `.txt` del Race Log era un rapporto da leggere. Adesso porta in fondo anche
un blocco di dati — stagioni e libro dei record — dopo una riga marcatore. Lo
stesso file è quindi il rapporto **e** il salvataggio: lo scarichi su una
macchina, lo carichi su un'altra, e la storia ti segue. Rileggere la prosa
sarebbe stato l'altro modo di farlo, e la prosa non è un formato dati.

Si carica da due porte, il Race Log e la schermata delle stagioni, con un solo
`<input type="file">`. E si **unisce**, non sostituisce: importare non può
costarti le stagioni che avevi già. A parità di `id` vince lo snapshot più
recente, il che rende importare due volte lo stesso file un'operazione a vuoto
invece che un duplicato. I tempi sul giro si fondono **sul cronometro**: vince
il più veloce, da qualunque macchina venga, e un tempo importato più lento non
sovrascrive mai il tuo.

Il marcatore è definito una volta sola, in `racelog.js` che lo scrive, e letto
da lì dall'importatore: chi scrive e chi legge un formato non possono tenere
ciascuno la propria copia della riga che lo separa. E `racelog.js` non sa niente
di stagioni: `RaceLog.payload` è un gancio che main.js riempie.

### Un bug trovato per strada

Il pallino col colore del pilota (`.tt-chip`) aveva una dimensione **solo dentro
la torre dei tempi**. Lo stesso span nella griglia di fine stagione era un
inline-block vuoto senza larghezza: invisibile da sempre. Adesso la classe ha
una dimensione sua e i colori si vedono in tutte e tre le tabelle.

## Leggere un log scritto prima che esistesse il blocco dati

Nicola ha provato a caricare un `.txt` scaricato **il giorno prima** che tutto
questo esistesse, e l'importatore l'ha respinto. Aveva ragione a farlo: in quel
file un blocco dati non c'e'. Ma la stagione **c'e'**, dentro il rapporto — il
calendario, le classifiche, le pole, i giri veloci, i bonus. Quindi quando non
c'e' il blocco da leggere, si legge il testo.

E' un parser di prosa e lo sa: riconosce **solo** quello che scrive questo
gioco, scarta quello che non sa leggere invece di indovinare, e marca quello che
produce come ricostruito, così una stagione recuperata da un rapporto non viene
mai scambiata per una che il gioco ha salvato da sé.

Due cose che un log non ha mai portato, e che nessun parser può inventare:

- **i colori dei piloti.** Ci sono solo i nomi. I colori vengono assegnati
  nell'ordine di griglia dalla lista del gioco: la stagione importata è coerente
  con sé stessa e stabile fra un caricamento e l'altro, ma non sono i colori con
  cui hai corso.
- **quanto doveva essere lungo il calendario.** Si contano i round che il file
  contiene davvero. «10 rounds» vuol dire *dieci sono nel file*.

Un dettaglio sui punti: i log vecchi vengono ricalcolati **con le regole di
allora** — punti F1 per posizione più il bonus sorpassi che il log riporta, e
niente punto del giro veloce, perché quando quella stagione è stata corsa quella
regola non c'era. La classifica ricostruita è quella che hai visto, non quella
che vedresti oggi.

L'`id` di una stagione importata è derivato dalle sue stesse parole (seme, data
della prima gara, calendario), quindi ricaricare lo stesso file due volte
ricade sulla stessa stagione invece di crearne una copia. E se lo stesso seme
compare due volte nello stesso log con un circuito che si ripete, sono due
stagioni diverse sullo stesso calendario — che è esattamente a cosa serve un
seme.

## La porta, non l'importatore

Nicola ha riprovato con sei log e ha detto: «ancora non mi lascia caricare
questo tipo di file». Provati tutti e sei nel build corrente: **entrano tutti**,
sette stagioni in totale. Quindi quello che non funzionava non era
l'importatore — era la porta per arrivarci, e il round precedente aveva testato
l'importatore e non la porta.

Tre cose sistemate, ognuna un modo diverso in cui «non mi lascia caricare» può
essere letteralmente vero:

- **L'input era `display:none`.** Safari rifiuta un `.click()` da script su un
  input file che non è renderizzato: il selettore semplicemente non si apre, e
  sullo schermo non compare niente che spieghi perché. Ora è fuori schermo ma
  renderizzato — e soprattutto i due pulsanti *Load* sono diventati
  **`<label for="data-file">`**: un'etichetta legata a un input file apre il
  selettore da sola, in qualunque browser, senza script di mezzo.
- **`accept=".txt,.json,text/plain"`** poteva rendere non selezionabili file
  `.txt` perfettamente validi in certe finestre di dialogo. Tolto: un file
  sbagliato riceve una frase, che è più gentile di un file che non si riesce
  nemmeno a scegliere.
- **Un file alla volta.** Sei log erano sei giri nel selettore. Adesso l'input è
  `multiple`, li legge in fila e riporta il totale.

## Un timbro del build sullo schermo

Aprire il gioco da disco vuol dire che il browser può servire una pagina in
cache: una correzione consegnata un'ora fa **non c'è**, e non c'è niente da
vedere che lo dica. Il `?v=` sui file busta gli script, ma non `racing.html`
stesso — se è quella a venire dalla cache, chiede i vecchi indirizzi e il giro
si chiude.

Sotto il menu adesso c'è una riga piccola e grigia: **build zoom16 · 23 Aug
2026**. Serve a rispondere in due secondi alla domanda che finora non aveva
risposta — «sto guardando la versione nuova?» — e a farla diventare una domanda
che si può fare a distanza.

## Cancellare, riprendere, e il tasso di vittorie

**Cancellare.** Ogni riga ha una crocetta. Non è annullabile, quindi chiede —
col pulsante stesso, come fa *Start Championship*, non con una finestra del
browser che questo gioco non ha mai usato: primo clic diventa «Sure? Press
again», secondo clic e la stagione se ne va, e si disarma da sola dopo cinque
secondi. Se quella cancellata è anche la stagione che sta nello slot di ripresa,
lo slot viene svuotato con lei: lasciare il banner *Resume* del menu puntato a
una stagione appena buttata via sarebbe l'archivio che mente al menu.

**Riprendere.** Una stagione lasciata a metà ha un *Resume* che la riporta al
round dov'eri. Perché funzionasse ho dovuto cambiare cosa viene archiviato:
finché una stagione è **incompleta** l'archivio si porta dietro anche il suo
stato vivo — mescole, telai, il rivale, la variazione di bravura di ogni IA —
che è roba che il riassunto per lo schermo non contiene. Appena finisce, quello
stato viene buttato: da una stagione conclusa non c'è niente da riprendere, ed
è la parte più pesante della voce. I risultati non vengono duplicati: la copia
viva li omette e li ritrova nella voce d'archivio.

Il gioco ha **uno solo** slot di ripresa, quindi riprendere dall'archivio lo
toglie a quello che ci stava. Non si perde niente, ed è per costruzione: ogni
stagione viene archiviata a ogni round, quindi quella spodestata è già nella
lista e si riprende allo stesso modo. Va nel registro di gara che è successo.

Chi **non** si può riprendere: le stagioni finite (non c'è niente da riprendere)
e quelle ricostruite da un log (un rapporto dice cosa è successo, non a che
punto era la stagione). Il pulsante non compare, e se ci si arriva per altre
strade la funzione risponde di no.

**Anche quelle di prima.** La prima versione richiedeva lo stato vivo per
riprendere, e questo rendeva definitivamente non riprendibile ogni stagione
archiviata prima che l'archivio imparasse a tenerlo — cioè una regola su
*quando è stato scritto il codice*, non sulla stagione, e il giocatore non ha
modo di vederla. Adesso una stagione senza stato viene **ricostruita** da quello
che l'archivio ha comunque: calendario, classifica, risultati e auto sono quelli
veri; la variazione di bravura delle IA viene ritirata dallo stesso intervallo
della partenza di stagione (deve esistere: `new AI(car, difficulty,
p.skillVariation)` con `undefined` produce un'IA che guida a NaN) e il rivale
della stagione viene lasciato cadere, perché inventarne uno diverso sarebbe
peggio che non averlo. Finisce nel registro di gara, così resta scritto.

Quella che sta nello slot viene comunque rabboccata col suo stato vero quando si
passa dal menu, una volta sola e solo se manca davvero: se è lei che riprendi,
riprendi l'originale.

### Una stagione senza gare non ha un campione

`flag-quick-783`, zero round su cinque, dichiarava campione «You» e ti dava P1.
A zero gare sono tutti a zero punti e l'ordinamento restituisce il primo colore
che trova, che è sempre il giocatore. Adesso una stagione senza risultati mostra
un trattino in *Champion* e in *You* — è la stessa trappola che diceva «you lead
on 0» nel banner del menu, in un'altra tabella.

**Win rate.** Colonna a destra: la quota delle gare che hai **iniziato** e hai
vinto, con la frazione accanto in piccolo — 25% <sub>1/4</sub>. Sulle gare
iniziate, non sui round del calendario: un Gran Premio saltato non è una gara
che non hai vinto. Chi ha corso da spettatore ha un trattino.

## Verificato (Chromium headless, dpr 2)

Gara singola con qualifiche su Oval fino al risultato (linea "shipped" ⇒
coordinate classiche intatte); pratica su Marathon; gara 2 giocatori su
Colossus; gare spettatore complete sui due circuiti nuovi — 10/10
classificati, zero rotture, zero uscite dal tracciato, ~40 s/giro Marathon;
incidente forzato a centro mondo → gru + VSC + rimozione; click sulla torre
da spettatore sposta la camera; cambio zoom a metà sessione (re-bake del
layer); pagina circuiti con 22 carte; anteprima GP di Marathon in
campionato; falsa partenza → snap della camera sulla griglia rifatta.
Nessun errore JS in tutte le sessioni.

Sulla pausa, tre casi automatizzati (`test_pause.js`): tasto **tenuto**
attraverso la pausa → 120 ms dopo la ripresa l'auto sta già accelerando
(243 → 253 px/s, non veleggia); tasto **mollato** durante la pausa → niente gas
alla ripresa; **blur** con il tasto giù → tutto rilasciato. Tutti e tre passano.

Sui telai, benchmark completo asciutto e bagnato sui 22 circuiti con gomma
bloccata, prima e dopo il ridisegno.

Su fantasmi e gomme (`test_ghost_tyre.js`): giro senza timbro su Marathon e
Colossus → **scartato**; giro senza timbro su Oval → **riprodotto** (geometria
invariata); giro con timbro sbagliato su F1 → scartato; giro con timbro giusto
su Comb → riprodotto; salvataggio e rilettura → torna timbrato. In qualifica su
Marathon: pallino della gomma su tutte le righe della torre e su tutte le righe
con un tempo nella classifica finale (chi non ha segnato tempo non ne ha, ed è
giusto così).

Sul campionato in sospeso (`test_champ_resume.js`), otto controlli: senza
salvataggio il banner resta nascosto; stagione da 3 round avviata davvero dal
menù → il salvataggio compare in `localStorage`; **ricaricata la pagina il
banner è visibile** (`display:flex`, 536x65 px, sopra la piega) su tutte e tre
le linguette e anche con la finestra alta 620 px; *Resume* riporta a
`currentTrackIndex` giusto con l'anteprima del GP aperta; con 44 punti in
classifica il banner nomina il leader, con zero punti non nomina nessuno;
*Quit to menu* a metà round rimette il banner senza ricaricare; e l'avviso di
scarto continua ad armarsi. Zero errori JS.

Sul punto del giro veloce (`test_fastest_lap.js`), due parti. La regola
interrogata direttamente, tabella di verità completa: vincitore col giro veloce
→ 1, decimo → 1, **undicesimo → 0**, sedicesimo → 0, **ritirato → 0**, e chi non
ha il giro veloce → 0 (le due righe che rifiutano il punto non si possono
ottenere a comando da una gara vera, quindi si chiedono alla regola). Poi due
round di campionato simulati per intero, e la classifica **ricostruita da zero**
dai verbali di gara e confrontata con quella che il gioco sta portando avanti:
esatta al punto. Sullo schermo, la cella dice `+2ᶠ` per chi ha vinto e segnato
il giro veloce, l'intestazione dice *Extra pts* e ogni riga ha tante celle
quante l'intestazione.

Sul menu (`measure_menu.js`), sei formati di finestra per due modalità:
larghezza del pannello, altezza del contenuto, se scrolla e di quanto, quante
colonne, e la dimensione reale dei caratteri letta dal browser.

Sui tempi precedenti nella schermata gomme (`test_tyre_records.js`), il libro
viene **seminato** con tempi inventati e timbrati con la geometria che il gioco
sta usando, poi il gioco viene portato fino alla schermata gomme e gli si chiede
cosa mostra. Asciutto all'Oval: cinque righe, medium 18.417 in verde nella
colonna asciutto, colonna asciutto evidenziata, sul pulsante `you 18.417` in
verde e `you —` sull'intermedia. Stesso circuito sotto la pioggia: si accende
l'altra colonna, l'intermedia passa in verde con 23.880 e la medium diventa
`you —`. Kart, mai girato: niente tabella, la riga che invita a fare il primo
tempo, e tutti i pulsanti a trattino. Marathon con un tempo timbrato col
vecchio tracciato: **non mostrato**. Infine un giro registrato davvero: più
veloce prende il record, più lento viene rifiutato. Zero errori JS.

Sul nome del log (`test_racelog_name.js`): una prova libera vera, poi il
download **intercettato** — il nome viene letto dall'elemento `<a download>` che
il gioco costruisce davvero, non dalla stringa che lo compone —
`apex3-log-2026-08-23T05-39-49.txt` da un blob, prima riga `APEX 3 — race log`,
la sessione e i suoi eventi ancora dentro, e la parola `apex2` che non compare
da nessuna parte nel file.

Sulla falsa partenza (`test_false_start.js`), tre cose. La formula interrogata
direttamente sui circuiti veri: Oval/Kart/F1 a 5 giri → 1,0s (il minimo),
Colossus 1,2s, Marathon 1,8s, Marathon x20 3,6s, x50 5,0s (il tetto), e la forma
a radice verificata lontano dai due clamp — quadruplicando i giri la penalità
raddoppia esatta (2,0 → 4,0). Il semaforo: 4000 estrazioni, da 2,60s a 6,50s, e
la stessa funzione chiamata sia alla partenza sia al restart. Poi una gara vera
con l'acceleratore tenuto giù mentre le luci sono ancora accese: un'infrazione
registrata, 1,0s portato sull'auto, il cartello che dice «+1.0 second penalty», e
al traguardo 60s che diventano 61s.

Sull'archivio (`test_seasons.js`): linguette nell'ordine giusto e atterraggio su
Championship; archivio vuoto che lo dice invece di mostrare una tabella vuota;
una stagione da 3 round giocata davvero → archiviata **dopo il primo round**,
`done 1 / 3`, non completa; tornati al menu compare nell'elenco come «left at
round 2»; aperta, undici piloti in classifica, e le vittorie e le partenze
contate confrontate con quelle scritte nei verbali (10 partenze, non 11: quel
round il giocatore l'aveva saltato ed è DNS). Poi due stagioni inventate a mano
per far quadrare la carriera: 1 titolo, 4 gare, 2 vittorie, 4 podi, 2 gare
bagnate, «beaten by Rival». Infine il giro completo del file: scaricato,
`localStorage` **azzerato**, ricaricato — stesse tre stagioni, stessi id, stessi
verbali, due tempi sul giro migliorati; caricato una seconda volta non aggiunge
niente; e un file senza dati dentro risponde «no Apex data in that file».

Le suite esistenti passano tutte. Due di loro (`test_game`, `test_features`)
sono state corrette, non il gioco: davano per scontato che il menu si aprisse su
*Single Race*, cosa che funzionava per caso perché era la prima linguetta.
`test_tyre_records` aveva un difetto suo, che si è visto solo eseguendolo in
serie: il caso «asciutto» non forzava l'asciutto e la gara singola tira pioggia
una volta su cinque, quindi falliva una volta ogni cinque esecuzioni. Adesso il
meteo è fissato.

Sull'import dei log vecchi (`test_log_import.js`) il test gira **sul file vero di
Nicola**, non su un campione inventato, perché il formato che deve reggere è
quello che il gioco ha scritto davvero. Il file contiene una stagione da dieci
round, e ne esce: seme `brake-hard-813`, dieci circuiti tutti diversi, tre
bagnati, undici piloti, 110 partenze. Le pole (10), i giri veloci (10) e i Grand
Chelem (3) sono **contati nel file con un metodo diverso da quello del parser** e
confrontati. Il giocatore: 4 vittorie, 10 podi su 10 gare, 6 pole, 5 giri
veloci, 2 Grand Chelem, zero ritiri, 221 punti, telaio Aero — e i punti
dell'archivio tornano sommando gara per gara. Sullo schermo la stagione appare
marcata «from a log» con la nota sui colori, e ricaricare lo stesso file una
seconda volta non crea un doppione.

Sulla porta (`test_multi_import.js`) il test guida **il vero `<input type=file>`
con i file veri**, perché l'ultima volta il codice passava qui e falliva sulla
sua macchina: era la porta a non essere testata. Controlla che l'input esista,
sia `multiple`, non abbia filtro `accept`, non sia nascosto, e che i due
controlli *Load* siano etichette legate a lui. Poi carica **tutti e sette i log
in un colpo solo**: sette stagioni sullo scaffale — fra cui due volte
`brake-hard-813`, stesso seme e due tentativi diversi, riconosciute come
stagioni distinte — 59 gare, 28 vittorie, 6 titoli, 1277 punti in carriera. Gli
stessi sette file una seconda volta non aggiungono niente.

Su cancella/riprendi/win rate (`test_season_actions.js`), con tre stagioni
inventate: finita, a metà con lo stato, e a metà **senza** stato. Il tasso di
vittorie legge 60% 3/5, 50% 1/2 e 0% 0/3; la crocetta c'è su tutte e tre, il
*Resume* solo su una. Il primo clic sulla crocetta dice «Sure? Press again» e la
stagione **è ancora lì**; il secondo la toglie. Poi la parte che conta: con una
stagione già nello slot di ripresa se ne riprende un'altra dall'archivio — lo
slot passa di mano, la ripresa riparte dal round 3, telaio, rivale e due gare
già corse tutti al loro posto, **e la stagione spodestata è ancora nella lista e
ancora ripristinabile**. La stagione finita e quella senza stato rifiutano.
Infine, cancellando la stagione che teneva lo slot, lo slot resta vuoto e il
banner *Resume* del menu sparisce.

Il controllo sul timbro del build non è più legato a un numero scritto a mano:
il test confronta il timbro con la versione con cui la pagina carica davvero
`main.js`, che è la cosa che deve restare vera (e voleva dire modificare il test
a ogni consegna).

E una stagione **senza stato vivo** — archiviata come lo erano tutte fino a
un'ora fa — si riprende lo stesso: ricostruita dalla voce d'archivio riparte dal
round 4 con le tre gare già corse, 54 punti, il telaio giusto, ogni IA con una
bravura valida e nessun rivale. Una ricostruita da un log continua a rifiutare.
Una stagione con zero gare non nomina un campione e non ti dà una posizione, ma
si può riprendere.
