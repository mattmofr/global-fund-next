#!/usr/bin/env python3
"""Compare complete seeded AI campaigns without replaying any game rules."""
import hashlib
import json
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
PATHS = {
    "referenceV3EconomyV4Contexts": "docs/economic-progression-baseline-v3.json",
    "candidateV4EconomyV4Contexts": "docs/economic-progression-continuous-v4.json",
}


def summarize(data):
    if data["completedGames"] != data["requestedGames"] or data["partialGames"] or data["failedGames"]:
        raise ValueError("Comparison requires complete campaigns with no failed or partial games.")
    records = data["records"]
    waiting = []
    for record in records:
        checkpoint = record["checkpoints"].get("10")
        if not checkpoint:
            continue  # Early endings cannot establish a ten-cycle wait.
        purchases = {row["id"]: row["firstPurchases"]["any"] for row in record["playerResults"]}
        for player in checkpoint["players"]:
            purchase = purchases[player["id"]]
            no_buy_by_10 = purchase is None or purchase["cycle"] > 10
            waiting.append({"solvent": player["solvent"], "noBuyByCycle10": no_buy_by_10,
                            "initialCashStillUnused": no_buy_by_10 and player["cash"] >= 100,
                            "cash": player["cash"]})
    funds = [row for record in records for row in record["playerResults"]]
    return {
        "games": data["completedGames"], "funds": len(funds), "commands": data["commands"],
        "durationSeconds": data["durationSeconds"], "sources": data["sourceHashes"],
        "catalog": data["catalog"], "firstPurchases": data["firstPurchaseSummary"],
        "checkpoints": data["checkpoints"], "finalValue": data["finalValue"],
        "cashAtOpeningStillUnused": {
            "definition": "At the end of cycle 10, no BUY_SHARE since opening and cash >=100 M€.",
            "fundsObservedAtCycle10": len(waiting),
            "fundsWithoutAnyBuyByCycle10": sum(row["noBuyByCycle10"] for row in waiting),
            "fundsWithoutAnyBuyAndCashAtLeast100": sum(row["initialCashStillUnused"] for row in waiting),
            "averageCashAmongNeverBoughtAtCycle10": mean([row["cash"] for row in waiting if row["noBuyByCycle10"]])
            if any(row["noBuyByCycle10"] for row in waiting) else None,
            "firstBuyAfterCycle10OrNotObservedAmongAllFunds": sum(
                row["firstPurchases"]["any"] is None or row["firstPurchases"]["any"]["cycle"] > 10 for row in funds),
            "earlyEndCaveat": "Funds in games ending before cycle 10 are omitted from checkpoint counts, never imputed.",
        },
    }


def main():
    data = {key: json.loads((ROOT / path).read_text()) for key, path in PATHS.items()}
    reference, candidate = data.values()
    if reference["seedPlan"]["gameSeeds"] != candidate["seedPlan"]["gameSeeds"]:
        raise ValueError("Seeds differ.")
    if reference["sourceHashes"]["gameData"] != candidate["sourceHashes"]["gameData"]:
        raise ValueError("Deck/board source data differs: economic catalog overrides must isolate the comparison.")
    if reference["sourceHashes"]["simulator"] != candidate["sourceHashes"]["simulator"]:
        raise ValueError("Simulator sources differ.")
    results = {key: summarize(value) for key, value in data.items()}
    report = {
        "schemaVersion": 1, "method": "Paired seeds and final V4 decks/board/AI; reference overrides all V3 static company metadata and prices.",
        "sources": {key: {"path": path, "sha256": hashlib.sha256((ROOT / path).read_bytes()).hexdigest()}
                    for key, path in PATHS.items()},
        "comparisons": results,
        "limits": ["40 games/120 funds per campaign; estimates describe this AI policy, not human play.",
                   "Action-dependent RNG paths diverge after economic choices differ; seeds do not promise identical later dice/cards.",
                   "First-purchase means exclude funds without that purchase; those counts are explicit.",
                   "The raw simulator also contains a censored 100-personal-turn metric. It is not the user's 100 M€ cash requirement."],
    }
    (ROOT / "docs/economic-progression-comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: {"firstPurchases": value["firstPurchases"], "unusedCash": value["cashAtOpeningStillUnused"],
                            "finalValue": value["finalValue"]} for key, value in results.items()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
