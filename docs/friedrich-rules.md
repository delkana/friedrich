# Friedrich — engineering rules reference

Designer **Richard Sivél**, publisher **Histogame** (2004; English co-pub Rio Grande).
Primary source: official Anniversary Edition rulebook v2.1 —
https://www.histogame.de/friedrich/FriedrichRules.pdf
(mirror: https://www.riograndegames.com/wp-content/uploads/2013/02/Friedrich-Rules.pdf)

This is the spec the engine is built against. Confidence levels noted at the end.

## Players & roles
- **3 or 4 players only** (no full 2-player game).
- 7 nations under 4 roles:
  - **Frederick** = Prussia + Hanover — solo **defender**.
  - **Elisabeth** = Russia + Sweden — attacker.
  - **Maria Theresa** = Austria + Imperial Army (Reichsarmee) — attacker.
  - **Pompadour** = France — attacker.
- 4p: one role each. 3p: one seat runs **both Elisabeth and Pompadour**. Frederick
  is always a standalone defender.

## How to start (rulebook "How to start")
1. The four roles are **raffled** to the players (by drawing the 13,13,13,13).
2. All pieces go on their printed set-up cities: generals on the city marked with
   their rank number in their colour, supply trains on cities marked "T".
3. Each player **secretly allots** their nation's whole establishment across its
   generals — min 1 each, max per the army-sheet limit (see below).
4. **One** of the four Tactical Card decks is shuffled as the shared draw deck;
   the other three are set aside. **No nation holds any cards** at the start —
   each draws its allotment as its own action stage opens.
5. Shuffle the 18 Cards of Fate onto the hour glass. (Eased variant: see below.)

## Map & the four suits
- Point-to-point graph: cities = nodes, roads = edges. Two road classes; **main
  roads** (thick) give a movement bonus.
- A grid of **33 sectors** overlays the map; each sector carries one suit
  (♥♦♣♠). **A location's suit = whichever grid rectangle it sits in** (not
  nationality/terrain). Suits recur in scattered sectors — the map is NOT four
  clean regions.
- Terrain (mountains/rivers/marsh) is modeled only as **missing edges**. No siege
  or river-crossing rules; "fortress" cities are just important junctions.
- Movement: general up to **3** cities (**4** if entirely on main roads); supply
  train **2** (**3** on main roads). No jumping over pieces. One piece per city,
  except up to **3 same-nation generals may stack**.

## Combat — suit-restricted bidding duel (no dice, no general TV)
- **Tactical Card (TC): one suit + one value 2..13.** Plus **Reserve** (wild):
  declared on play as any suit, value 1..10. A deck is **50 cards** = 48 suited
  (2..13 ×4) + 2 Reserves.
- The box holds **four such decks**, and they are used **one at a time**: one is
  shuffled as the **single draw deck shared by all players** and the other three
  are set aside. Played cards are set aside **sorted by their deck of origin**;
  when the draw deck runs out the next pristine deck is opened, and once all four
  have been used up the **two piles that accumulated most** are shuffled together.
  (So cards are a contested common pool, not a private per-nation supply.)
- A general may only play TCs matching **its own sector's suit**. If the two
  generals stand in different sectors, each plays its own suit. Reserve escapes
  the restriction.
- **Generals have RANK only** (1 = highest; governs stacking/removal order), NOT
  combat value. Strength = **secret troop count (1..8) + TCs played**.
- Resolution:
  1. Reveal troops. `score = attackerTroops − defenderTroops` (a stack pools).
  2. The side with **negative** score has the right to play; add a matching-suit
     TC value to the score.
  3. While their score stays negative they may keep playing. The instant it
     reaches **≥ 0**, the right to play **switches** to the opponent.
  4. Continues until the side whose turn it is **cannot or will not** play → that
     general is **defeated**. On exact tie score of 0 the attacker plays first;
     if a player gets the right to play at 0 and holds a matching card they
     **must** play it; no matching card + declines Reserve → **tie, no losses**.
- Casualties/retreat (rule 8): **winner loses nothing, stays put.** Loser's
  casualties = final negative score (capped at troops). **Retreat distance =
  troops lost, exactly** — a stack never splits, never enters a city twice, and
  may not enter or pass through a city holding **any** piece (enemy or friendly,
  general or supply train — not even to destroy the train). It may pass through
  an objective city but does not (re-)conquer it. It must **finish as far from
  the winning general as possible** (only that general matters), and the
  **winner chooses the path**. Cannot go the full distance ⇒ **wiped out**.
  - Note the path itself has no lasting effect, and the endpoint is forced to be
    maximally far, so the winner's choice only bites when destinations tie —
    which is exactly when the engine asks (`pendingRetreat`).

## Draw allotments (per nation, start of its action stage)
Prussia 7 (4+3), Hanover 2 (1+1), Russia 4, Sweden 1, Austria 5 (4+1),
Imperial 1, France 4 — but France must then "select one to discard immediately"
(**its own choice** of the four, face-down; the stage waits for it). **No max hand
size**; cards persist across turns; TCs are also **spent like money** for
recruitment. Some Cards of Fate reduce these.

## Generals & armies
Confirmed against the official army sheet (`FriedrichArmeeplan.pdf`) — high
confidence; ranks, counts and establishments below are authoritative.

| Nation | Generals | Trains | Establishment | Per general |
|---|---|---|---|---|
| Prussia | 8 | 2 | 32 | 1–8 |
| Hanover | 2 | 1 | 12 | 1–8 |
| Russia | 4 | 2 | 16 | 1–8 |
| Sweden | 1 | 1 | 4 | 1–4 |
| Austria | 5 | 2 | 30 | 1–8 |
| Imperial | 1 | 1 | 6 | 1–6 |
| France | 3 | 2 | 20 | 1–8 |

- Ranks: **PR** 1 Friedrich, 2 Winterfeldt, 3 Prinz Heinrich, 4 Schwerin,
  5 Keith, 6 Seydlitz, 7 Dohna, 8 Lehwaldt · **HA** 1 Ferdinand v. Braunschweig,
  2 Cumberland · **RU** 1 Saltikov, 2 Fermor, 3 Apraxin, 4 Tottleben ·
  **SE** 1 Ehrensvärd · **AT** 1 Daun, 2 Browne, 3 Karl v. Lothringen, 4 Laudon,
  5 Lacy · **IM** 1 Hildburghausen · **FR** 1 Richelieu, 2 Soubise, 3 Chevert.
- Troops are **secret per general**; at set-up each player **secretly allots the
  whole establishment** across that nation's generals within the per-general
  limits above. The establishment is also a hard ceiling on recruitment.
  Transfer freely within a stack, never between unstacked generals.

### Set-up cities (EXACT)
Recovered from the VASSAL module's ready-to-play save via
`node scripts/extract-setup.mjs` — its piece coordinates land on the board's city
points to the pixel, so these are the printed set-up cities, not inferences.

| Nation | Generals | Trains ("T" cities) |
|---|---|---|
| Prussia | Friedrich + Winterfeldt **Oschatz**, Heinrich **Berlin**, Schwerin + Keith **Strehlen**, Seydlitz **Brandenburg**, Dohna **Arnswald**, Lehwaldt **Mohrungen** | Jüterbog, Grünberg |
| Hanover | Ferdinand **Stade**, Cumberland **Alfeld** | Gifhorn |
| Russia | Saltikov + Fermor **Bydgoszcz**, Apraxin **Łomża**, Tottleben **Sierpc** | Toruń, Warszawa |
| Sweden | Ehrensvärd **Stralsund** | Wismar |
| Austria | Daun **Brünn**, Browne + Lothringen **Melnik**, Laudon **Olmütz**, Lacy **Tabor** | Beraun, Pardubitz |
| Imperial | Hildburghausen **Hildburghausen** | Erlangen |
| France | Richelieu + Chevert **Iserlohn**, Soubise **Fulda** | Koblenz, Gemünden |

### Reading the board's markers
Confirmed by inspecting the 6000px board at high zoom:
- **Star ornament, in a nation's colour** = that nation's **depot city** (Berlin's
  star is Prussian blue, Sierpc's is Russian green). This is what makes the
  rulebook's recruitment example legal — Russia re-enters generals at Sierpc.
- **Plain magenta dot** = an ordinary **set-up city** (Oschatz, Jüterbog).
- The blue/coloured **number** next to a city is which general(s) start there
  ("1&2" at Oschatz = Friedrich and Winterfeldt); a **"T"** marks a train's start.

So depot cities and "T" cities are different things that sometimes coincide
(Grünberg, Koblenz, Gemünden, Warszawa are both).
- **Supply train**: a cube, cannot fight or hold objectives (exception: the
  Imperial supply train protects objectives like a general, radius 3). One train
  supplies unlimited same-color generals. Captured when an enemy general enters
  its city (mover must stop).

## Hidden information — what a player may know
- **Troop counts are secret**, written on the army sheet. **Combat is the only
  thing that reveals them:** "First, the opposing players state how many troops
  their participating generals command." That is declared aloud ⇒ **public**
  knowledge, not per-viewer.
- A declaration is the **stack's total**, never the split inside it (that stays
  on the army sheet). So an exact number is only ever pinned to a general who
  **fought alone**; a stack is only ever a last-seen total.
- **Casualties are public** (they are the final score), so after a battle the
  survivors' total is still known exactly.
- **Recruiting clouds it:** a player "just says how many troops he is recruiting,
  but not which general(s) will receive them … he has to tell the other players
  the new troops-total of his nation". So the nation-wide total is public, and
  every one of that nation's declared strengths becomes a *was*.
- Engine: `state.sightings[pieceId] = { total, with, certain }` (public).
  Declared on `attack`, re-declared from the true state after combat resolves,
  clouded (`certain: false`) when that nation recruits. `redact` hides the
  counters (`HIDDEN_TROOPS`) and passes sightings through. **The log is public
  and is NOT redacted** — never write private facts into it (a recruit must not
  name who was reinforced).
- The client shows `?` / `4` / `4?`. Note the last-known display is a **memory
  aid the physical game does not provide** — at a table you must remember the
  declaration yourself. Deliberate, agreed with the user 2026-07-17.

## Supply
- **In home country → always supplied.** Russia and France have **no home
  country** — supplied only at their **depot cities**.
- Otherwise trace a path **≤ 6 cities** through **friendly pieces only** to a
  same-color supply train. Blocked / >6 / train destroyed = **cut off**.
- **Binary attrition**, checked in that nation's supply phase: cut off → flip
  **face-down** (still acts). Still cut off next supply phase → **lose all
  troops, removed**. Regain supply first → flip back up. Merging a face-up with a
  face-down general makes **both** face-down.

## Victory
- **Attacker wins the instant it holds ALL its objective cities** (1st + 2nd
  order; eased conditions can drop 2nd order). Eased: 1st-order suffices for
  Sweden if Russia is out, and for Austria/Imperial if the Imperial Army switched
  players.
- **Frederick wins passively** when Russia, Sweden AND France have all been
  removed by Cards of Fate (survival).
- **Austria can never be removed** by a Card of Fate — it only wins or is blocked.
- Objective regions (exact city lists NOT online — need the physical map/army
  sheets): Austria→Silesia, Russia→East Prussia/Baltic, France→Hanover,
  Sweden→Baltic/Pomerania, Prussia→14 in Bohemia (expert "Offensive Option" only).

## Cards of Fate / end-game ("Clock of Fate")
- **18 cards.** Turns 1–5 just advance a time track. **From end of turn 6, draw &
  execute one Card of Fate as the last action of every turn**; each drawn card
  goes to the bottom (players can't see how close the fatal cards are).
- 6 "Strokes of Fate":
  - **ELISABETH** (Tsarina's death — "Miracle of the House of Brandenburg"):
    Russia quits; 1 Prussian general retired.
  - **SWEDEN**: Sweden quits; 1 Prussian general retired.
  - **INDIA**: Austria→4 draw, France→3 draw (does not remove France).
  - **AMERICA**: France quits; Cumberland retired; Hanover→1 draw.
  - **LORD BUTE**: Prussia→5 draw. **POEMS**: Prussia→4 draw.
- France needs **two** cards (INDIA then AMERICA); Russia and Sweden one each.
  Game ends → **Prussia wins** once all three have quit, unless an attacker met
  objectives first (check objectives before drawing).
- Player reallocation: if Russia+Sweden out, Elisabeth's player takes Imperial; if
  France out, Pompadour's player takes Imperial. Imperial always acts in slot 6.

## Sequence of play
Turn = 7 nation action stages in fixed order:
**Prussia → Hanover → Russia → Sweden → Austria → Imperial → France.**
Each nation's stage = 5 phases: **1 draw TCs → 2 move (may conquer/recruit/re-enter)
→ 3 combat (active generals must attack adjacent enemies) → 4 retroactive
conquests → 5 supply.** End of turn: turns 1–5 remove a time marker; from turn 6
draw+execute one Card of Fate.

## Board scan observations (Anniversary Edition, seen 2026-07-16)

A scan of the actual board confirms and adds:
- **Suit-sector grid is printed as thin blue rectangles**, each stamped with one
  large suit symbol, overlaid across political borders (♠ around Berlin/
  Brandenburg, ♥ near Magdeburg, ♦ sectors across Poland, etc.). Irregular
  sizes; suits recur in scattered sectors. The map margin also carries a finer
  A–O / 1–8 index grid — distinct from (finer than) the suit sectors.
- **Legend semantics:** plain circle = city; marked circle = **setup city**; red
  starburst = **depot city**; two square icons = **Austrian objectives of 1st
  and 2nd order** (the order distinction is printed on the board). Thin line =
  road, thick black = main road.
- **Other nations' objectives** are colored squares (green cluster in East
  Prussia/Baltic = Russia's; red around Hannover = France's) — the full
  objective list is recoverable from a high-res scan.
- **Territories:** Preussen blue incl. exclaves (Ostfriesland, Cottbus);
  Hannover + HRE lands yellow; Sachsen its own gold pocket; Österreich/Böhmen
  white; **Polska neutral tan**; green **Sverige** foothold at Stralsund.
- The board carries a year/turn box (starting 1756) with historical event notes
  and an hourglass illustration (Clock of Fate flavor), a compass rose, and a
  scale bar in Prussian miles.
- City count is in the hundreds — extraction plan: tile a high-res scan into
  overlapping margin-grid tiles, transcribe per tile (cities, type flags, road
  segments, sector suits), merge by pixel proximity, generate NODES/EDGES.

## Objective cities per nation (RESOLVED 2026-07-16)

Read from the 6000px VASSAL board + official playing-aid table (counts match
14 / 10 / 5+5 / 12+4 / 5+5 / 10 exactly). Solid banner = 1st order, striped = 2nd.

- **Prussia (blue, 14, Offensive Option only):** Eger, Karlsbad, Saaz, Teplitz,
  Pilsen, Prag, Wotitz, Kolin, Tschaslau, Jungbunzlau, Königgrätz, Trautenau,
  Friedland (the Bohemian one), Trübau.
- **Austria (grey) — 1st order (12):** Breslau, Schweidnitz, Glatz, Neisse,
  Brieg, Oels, Liegnitz, Waldenburg, Cosel, Lublinitz, Zittau, Radeberg.
  **2nd order (4):** Bunzlau, Görlitz, Muskau, Kamenz.
- **Russia (dark green, 10, no 2nd order):** Königsberg, Rastenburg, Riesenburg,
  Ortelsburg, Colberg, Neu Stettin, Stargard, Pyritz, Woldenberg, Küstrin.
- **Sweden (light green) — 1st order (5):** Stettin, Cammin, Greifenhagen,
  Anklam, Malchin. **2nd order (5):** Pritzwalk, Neuruppin, Prenzlau,
  Angermünde, Schwedt.
- **France (red, 10, no 2nd order):** Wittingen, Diepholz, Minden, Hannover,
  Hameln, Braunschweig, Magdeburg, Halberstadt, Göttingen, Kassel.
- **Imperial Army (yellow/gold) — 1st order (5):** Leipzig, Torgau, Dresden,
  Pirna, Chemnitz. **2nd order (5):** Bitterfeld, Meißen, Rochlitz, Naumburg,
  Zwickau.

Note: Austria's grey squares vs Imperial gold squares both sit in Saxony/Silesia
regions — tile transcriptions that reported "grey" in Saxony may actually be gold
(Imperial); reconcile against this list, which wins.

## General rosters with ranks (RESOLVED 2026-07-16)

From the official army sheet (histogame.de/friedrich/FriedrichArmeeplan.pdf) +
VASSAL setup stacks. Start sectors in parens (army-sheet grid refs).

- **Prussia** (troop max 32): 1 Friedrich d. Große (F4), 2 Winterfeldt (F4),
  3 Prinz Heinrich (G6), 4 Schwerin (K3), 5 Keith (K3), 6 Seydlitz (F6),
  7 Dohna (I7), 8 Lehwaldt (M9). Supply trains: F5 (Jüterbog), I5 (Grünberg).
- **Hannover** (max 12): 1 Ferdinand v. Braunschweig (B8 = Stade),
  2 Cumberland (C5 = Alfeld). Supply: C6.
- **Russia** (max 16): 1 Saltikov (L7), 2 Fermor (L7), 3 Apraxin (O7),
  4 Tottleben (M7). Supply: Torun, Warszawa.
- **Sweden** (max 4): 1 Ehrensvärd (F9 = Stralsund). Supply: D8 (Wismar).
- **Austria** (max 30): 1 Daun (K1 = Brünn), 2 Browne (H2 = Melnik),
  3 Karl v. Lothringen (H2), 4 Laudon (L1 = Olmütz), 5 Lacy (H1 = Tabor).
  Supply: Beraun, Pardubitz.
- **Imperial Army** (max 6): 1 Hildburghausen (D2). Supply: D1 (Erlangen).
- **France** (max 20): 1 Richelieu (A4 = Iserlohn), 2 Soubise (B3 = Fulda),
  3 Chevert (A4). Supply: Koblenz, Gemünden.

## Digital source assets (local)

- `docs/assets/vassal/Friedrich_v1.0.vmod` — VASSAL module (Curt Pangracs, 2020,
  based on Anniversary v1.1). https://obj.vassalengine.org/images/5/5e/Friedrich_%28v1.0%29.vmod
- `docs/assets/vassal/board-6000x4000.png` — 6000×4000 Anniversary board (from
  the vmod). All VASSAL region coordinates index into this image.
- `docs/assets/vassal/buildFile.xml` — module XML: **680 named city regions with
  pixel coords** (parse: `node scripts/parse-vassal.mjs` →
  `docs/assets/extraction/vassal-cities.json`). Names are anglicized/de-umlauted,
  some typos (Emdert=Emden, Straslund=Stralsund, Islerlohn=Iserlohn). NO road
  adjacency — roads exist only as pixels; derive from scan-tile transcriptions +
  verification crops against the 6000px board.
- `docs/assets/board-scan.jpg` (1800×1211) + `docs/assets/tiles/` — user's scan,
  tiled for the transcription fleet (`docs/assets/extraction/tile-*.json`).
- BGG entry is id **12891** (not 9625). BGG HTML/xmlapi 403 anonymously; use
  api.geekdo.com/api/files?objectid=12891&objecttype=thing.

## Recruitment (rule 10)
- TCs are spent as **money** (any suit), shown to the others, **no change** for
  overpayment. **Troop = 6**, **supply train = 6**, **general free but must
  receive ≥1 new troop**. Troops may reinforce any general already on the map.
  A nation may never exceed its starting establishment.
- Pieces re-enter on **any one of their nation's depot cities**, where they may
  legally stack; never where another nation's piece stands. They **may not move**
  in the phase they re-enter.
- **All depots blocked by another player** (rule 10a/b) → that nation picks one
  **substitute re-entry site**, which may change turn to turn, and **every** troop
  and train it recruits costs **8** instead of 6 (even troops not given to a
  re-entering general). The permitted regions, by sector:
  | Nation | Substitute region |
  |---|---|
  | Prussia | the Berlin spades sector |
  | Hanover | the Stade diamonds sector, **north of Munster** only |
  | Russia | the Warszawa spades sector |
  | Sweden | Sweden (Sverige), incl. exclaves |
  | Austria | the Brünn diamonds sector, **Austrian territory only** |
  | Imperial | the spades sector south of Hildburghausen |
  | France | the hearts sector south of Koblenz |

  Note "another **player**", not another nation: pieces you control yourself can
  simply be marched away, so they block re-entry without earning you a substitute.

## Conquest of objectives (rule 5)
- A general conquers an objective **of his own colour** by moving onto it — but
  **only if it is not protected at that moment**. "It is protected if a general
  of the defending nation is positioned **1, 2 or 3 cities away**." One defender
  holds the city against any force that merely walks in; you must draw him off or
  kill him first. This is the backbone of Prussia's defensive game.
- **The defending nation is one NATION, not a side.** "All nations are defending
  their home country, including all exclaves. Furthermore, **Prussia is defending
  occupied Sachsen (Saxony)**. NOTE: Hanover does not defend any objectives in
  Prussia! Prussia does not defend any objectives in Hanover!"
- So `defendingNation(node) = node.occupiedBy ?? node.home`. **Saxony is why
  `occupiedBy` exists**: it is the Imperial Army's home country AND holds all ten
  of its objectives, so its home cannot be what defends it — Prussia occupies it
  and does. This is also why the board shades Saxony apart from the rest of the
  Reich (`OCCUPIED_SAXONY` in geography.ts, drawn inside the Imperial border).
- **Still not modelled:** conquest also happens when a general "moves over" an
  objective in passing, or "starts his movement phase on it and moves away". We
  only conquer on ending the move there.

## Home countries (rule 1) — and the map's geography
- "All **dark-blue** areas (including all exclaves) are the home country of
  **Prussia**; all **light blue** areas are the home country of **Hanover**." The
  board really does print two blues: Prussia `#9CD3F1`, Hanover `#D3EAF2`.
- "The home country of the **Imperial Army** is **all yellow territories**,
  including Sachsen." Both the Reich's yellow `#F6E87E` and Saxony's gold
  `#F4DB65` count — as does Hessen's.
- **Austria** white, **Sweden** green (Pomerania). **Russia and France have no
  home country**; Poland's salmon is nobody's.
- Counts in `map-data.ts`: prussia 197, imperial 200, austria 71, hanover 49,
  sweden 6, none 148. **Two bugs lived here** (fixed 2026-07-17): the tint→home
  table keyed Hanover `hanover` while the transcription spells it `hannover`, so
  Hanover had **no home country at all**; and only Saxony mapped to imperial, so
  the Imperial Army was homeless on its own general's city. Tests now pin both.
- `HOME_COUNTRY` in the generated `geography.ts` is derived from `node.home` —
  the same field supply reads — as the ground nearer one of that nation's home
  cities than any other city, clipped to land. It is deliberately NOT traced off
  the printed border: if the two disagreed, the map would be lying about the rule.
- `COASTLINE` IS traced off the board, because nothing in the city data implies
  where the water is. The sea is not blue — it is the same cream as the margin —
  so it is found by colour plus connectivity (big cream regions reaching the edge
  of the sheet), which is what stops the cream city discs from punching holes in
  it. Only the largest land component is kept, or the FRIEDRICH title and the
  1756 box get their own little coastlines. Regenerate:
  `powershell ./scripts/dump-board.ps1` then `node scripts/extract-geography.mjs`.

## Implementation notes
- **Retreat is decided, not enumerated.** Listing every exact-length simple path
  explodes (~6.5× per two extra cities), and retreats are as long as the troops
  lost — 20+ for a big stack, not the ≤8 one might assume from a lone general.
  `retreat.ts` never enumerates: only the cities furthest from the winner can be
  the answer, so it ranks candidates by that distance and decides one band at a
  time, stopping at the first band that yields a legal path. This is fast
  structurally — the winner is always adjacent to the loser, so a city far from
  the winner is far from the retreat's start, leaving almost no slack, and slack
  is what makes the search branch. ~10-20ms at 31 cities, the worst a legal
  position allows (map diameter is 43+). A bipartite pocket fixes path parity, so
  the one case that could otherwise thrash is decided outright by 2-colouring.
  Cross-checked against brute force in `retreat.test.ts`.
- **Sectors are derived, not listed.** A city's sector is its nearest suit stamp
  (`sectors.ts`), which is also how its suit is assigned — so the substitute
  regions above are computed from the rule's own words rather than hand-listed.
  The four sectors the rulebook names by suit (Berlin/Warszawa spades,
  Brünn/Stade diamonds) all come out with the right suit, which is a good check
  on the Voronoi reconstruction.

## Confidence
- **High:** player counts/groupings, no-TV combat, card face, suit/sector rule,
  combat resolution + retreat, movement/stacking/troop caps, 6-city supply +
  binary attrition, Cards of Fate list/timing, sequence of play, victory logic,
  objective lists per nation, general rosters/ranks, city coordinates (VASSAL).
- **Medium:** road/adjacency graph (from scan transcription, needs verification
  pass against the 6000px board); sector-suit rectangles (being assembled).
- **Open:** Maria Theresa vs Pompadour token colors (cosmetic only).
