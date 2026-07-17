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
- Casualties/retreat: **winner loses nothing, stays put.** Loser's casualties =
  final negative score (capped at troops). **Retreat distance = troops lost**;
  winner picks path, loser ends as far from winner as possible, no re-entering a
  city, no passing pieces — if it can't complete, loser is **wiped out**.

## Draw allotments (per nation, start of its action stage)
Prussia 7 (4+3), Hanover 2 (1+1), Russia 4, Sweden 1, Austria 5 (4+1),
Imperial 1, France draws 4 then discards 1 face-down. **No max hand size**; cards
persist across turns; TCs are also **spent like money** to build/move supply
trains. Some Cards of Fate reduce these.

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
- The sheet gives each general's start city as a **map grid reference** (Friedrich
  F4, Lehwaldt M9, …). Those margin coordinates are not in our extracted map data,
  so `pieces.ts` uses the historically sensible city in the right sector; every one
  is test-verified to start in supply. Mapping the grid is the way to make these exact.
- **Supply train**: a cube, cannot fight or hold objectives (exception: the
  Imperial supply train protects objectives like a general, radius 3). One train
  supplies unlimited same-color generals. Captured when an enemy general enters
  its city (mover must stop).

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

## Known divergences (engine vs rulebook)

Deliberate simplifications still in the code. None is load-bearing for a playable
game, but each is a real difference a rules lawyer would catch.

- **France's discard is not a choice.** The sheet says: "Of the four Tactical
  Cards drawn each turn, select one to discard immediately." We discard the last
  card drawn instead of letting France pick. Needs a pending-discard sub-phase.
- **Retreat path is not chosen by the winner.** The loser is placed on the
  reachable empty city farthest from the winner; the rules give the winner the
  choice of path.
- **No substitute recruitment site.** If every depot is blocked, the rules allow
  recruiting elsewhere at a premium (8 points); we simply refuse.
- **Set-up cities are inferred, not exact** — see Generals & armies above.

## Confidence
- **High:** player counts/groupings, no-TV combat, card face, suit/sector rule,
  combat resolution + retreat, movement/stacking/troop caps, 6-city supply +
  binary attrition, Cards of Fate list/timing, sequence of play, victory logic,
  objective lists per nation, general rosters/ranks, city coordinates (VASSAL).
- **Medium:** road/adjacency graph (from scan transcription, needs verification
  pass against the 6000px board); sector-suit rectangles (being assembled).
- **Open:** Maria Theresa vs Pompadour token colors (cosmetic only).
