# Game engine

The TypeScript facade validates typed commands and clones the state before applying them. Rejected commands leave the original state intact. The engine has no UI, networking, timers, persistence, or browser dependencies. Its local CommonJS core is adapted from the old project; the old project itself remains untouched.

## Turn schedule

The highest opening die selects the starter once. Play follows the cyclic seat order from that seat, and this order never rotates at cycle boundaries. Insolvent seats are skipped; detained solvent players retain their turn for trial. `starterIndex` is a fixed order anchor, even if its original seat becomes insolvent. Older saves retain and freeze their currently stored anchor, without replaying turns or inferring unrecorded tie-break rolls.

Cycle 1 starts with all indices at C, no Context, and each fund's chosen starting market already selected at no cost. Players roll, resolve their cell, trade, end their turn, then acknowledge the next turn. Cycle 2 onward opens with one shared Context and each player chooses geography before rolling. Staying costs zero; moving to another market costs 1 M€. A detained player rolls their trial in geography on a subsequent turn. A failed trial skips the turn; detention on a cell immediately skips trading. No jailed holder receives sector income or Event dividends, although NAV continues to reflect prices.

## Current board and decks — October 13, 2026

The active board has 52 cells: **39 sector cells, 10 Events, two markets and Start**. Real estate replaces Market Crash at case 26; Bull is case 14 and Bear case 40. Finance, technology and real estate appear five times each; the other six sectors appear four times each. Every 13-cell quarter contains all nine sectors, and circular gaps between a sector's appearances range from 9 to 14 cells. The old Crash capture describes a historical board.

The 50-card Event deck has five sector cards per sector and five global cards: 19 favorable, 19 unfavorable and 12 mixed. Target selection first pools available companies held by the active fund, then companies held by anyone, then all available companies. It chooses a zone uniformly from zones present in the selected pool, then a company in that zone; within the zone it avoids the last four targets when another candidate exists. Events do not alter grades.

The 100 Context cards retain their type counts: 35 positive, 35 negative, 10 neutral, 10 prison and 10 regulation. The balanced catalogue contains 70 grade rotations from C, 20 pure directional changes and 10 neutral C assignments; zone coverage is 36 assignments per zone and sector coverage is 20 per sector. The grade assignments are absolute, so the effect after earlier cards depends on the current grade. These deck patterns preserve the existing type-based block construction.

## Market shocks and save migration

Bull remains case 14 and Bear is case 40 (zero-based index 39). Their effects are symmetric and deterministic: improve/degrade every zone by one grade, with a total two-grade change in the active fund's current zone. Sector grades do not change and grades clamp to A/E. From C/C, prices move ±25% elsewhere and ±50% in the active zone. Market Crash is no longer on the active board. Existing E/E liquidation and reopening rules still apply.

The active versions are `boardLayoutVersion = 3`, `cardRulesVersion = 3`, and `marketRulesVersion = 2`. The board migration recognizes complete official v1/v2 layouts before upgrading to v3; it preserves numerical positions, history and frozen identities of resolved notices. Card migration replaces only recognized IDs in remaining decks and discards in place, preserving their order and count; unknown cards remain unchanged and the already revealed `currentContext` is preserved. Custom or unrecognized boards are not reordered, and newer unsupported versions are never downgraded. Detailed audits and measurement limits: [BOARD_BALANCE_AUDIT.md](../../BOARD_BALANCE_AUDIT.md), [EVENT_BALANCE_AUDIT.md](../../EVENT_BALANCE_AUDIT.md), [CONTEXT_BALANCE_AUDIT.md](../../CONTEXT_BALANCE_AUDIT.md), [ENGINE_RULES.md](../../ENGINE_RULES.md).

The opening cycle is numbered 1. The 100 Context cards govern cycles 2 through 101; after every solvent player completes the final Context cycle, the next-turn command finishes the game and ranks solvent funds by current NAV. If only one solvent fund remains, the game ends earlier.

Event notices publish the selected company's ID and name, its zone and sector, and the effect separately from the story. Judicial targeting never depends on parsing the narrative.

## Start accounting

On crossing Start, performance is current NAV minus the previous Start NAV, excluding external capital flows since that baseline. A positive result injects 20 M€, a negative result withdraws 20 M€ through the settlement payment process, and an unchanged value produces no flow. The new baseline is recorded after that flow, before resolving the landing cell. Lap notices expose performance in M€ and percentage return. Monetary amounts are rounded to cents for comparing NAV, so floating point noise cannot trigger a reward.

Landing on a sector pays only other holders: the active fund receives no bank or market income for its own shares, including fully controlled companies and monopolies. Those holdings still earn income when another fund lands on the sector. Full control of one company guarantees at least C/C income. A monopoly requires all five shares of every company in the same zone and sector and guarantees at least A/A income. At E/E an available company pays its current liquidation share value to holders, clears holdings and acquisition basis, and stays unavailable until either grade improves.

All dice and card draws are authoritative random outcomes. Runtime validation rejects unknown command fields, including injected `die`, `roll`, or `value`.

## Market placement and save compatibility

`SeatConfig.startingMarket` and `RoomPlayer.startingMarket` use exactly five IDs: `americas`, `europe`, `asia`, `africa` (Africa and Middle East), and `oceania`. New funds have explicit `startingMarket` and `currentMarket`. The legacy `zone` field remains the authority for movement/trading and synchronizes `currentMarket` in commands and snapshots. Detention keeps `zone: "prison"` and exposes `currentMarket: null`; `previousZone` retains the market to return to.

Human starting choices are preserved. AI starting locations balance market occupancy, without changing opening cash, grades, or economic rules. The server recalculates AI placement at launch after remote humans choose their market.

Old country IDs are accepted only as a reading adapter for old clients and saves. Missing initial markets infer from an existing recognized nationality, then a valid saved location, then Europe if neither exists. The adapter never moves an existing fund or rewrites its company catalog, holdings, costs, cash, grades, or phase. Real legacy nationality fields remain when already supplied; new market selections never invent a nationality. Explicit invalid market IDs are rejected instead of falling back to a legacy country.

## Economy v3

New games take normalized values from the local catalogue. `src/economy.ts` separates approximate, sourced real capitalizations from game values: game classes use 40/200 billion USD thresholds, then logarithmic interpolation within each class. The measured `progression-growth` scenario uses full-company C/C prices 25–100 / 180–450 / 550–1500 M€ and per-sector-landing incomes of 10 / 12 / 14 percent of those prices. Large shares cost 110–300 M€ at opening C/C. These yields are gameplay parameters, not real annual investment returns. Embedded saved catalogs are never repriced.

Normal/hard AI destination scoring ignores shares it cannot buy after its existing cash reserve and the travel cost. The scoring formula and easy strategy are preserved. AI uses the same validated command API as humans. Reproducible balancing reports and their limitations are documented in `ECONOMY_BALANCING.md`.

## Settlement authority

Insufficient cash opens `phase: "settlement"` when liquid assets remain. The debt, resume phase, creditor order, frozen priority values, decision actor and optional offer are part of the state. A rejected engine command leaves that state intact.

- `LIQUIDATE_ASSETS` sells selected owned shares across markets to fund the obligation. Partial liquidation may keep the selection phase open.
- `PROPOSE_SETTLEMENT` freezes server prices; it accepts assets below, equal to or above the debt, provided the payer can cover the cash complement.
- `ACCEPT_SETTLEMENT`, `REJECT_SETTLEMENT` and `REQUIRE_CASH` belong to the pending creditor, not necessarily the active turn player.
- `cashDelta = debt − frozenAssetValue`; positive cash goes debtor→creditor, negative cash goes creditor→debtor. Receiving cost basis uses full frozen share value.
- Multi-creditor order uses ascending fund valuation then stable seat order, as explicitly confirmed by the user. Values are frozen before payments.
- This exceptional liquidation bypasses normal zone/detention sale restrictions and never grants ordinary buying rights. Exhausted insufficient assets trigger insolvency with only funded money credited.

Simulation and server loops use `getDecisionPlayerId(state)` before selecting and executing an AI command; using only `activePlayerId` would miss creditor decisions. The engine still has no socket, database, timer or UI dependency. Persistence and command serialization belong to the server. Structured receipts are kept in `settlementHistory` with title values, signed cash, reason, cycle and unpaid amount.

Full French rules and presentation behavior: [SETTLEMENT_RULES.md](../../SETTLEMENT_RULES.md).
