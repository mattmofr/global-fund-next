#!/usr/bin/env python3
"""Generate a current runtime market-distribution and primary-listing audit.

Reads the active legacy runtime catalogue, the reviewed primary-listing inventory,
and economy.ts. It never edits source data. Default output paths are the report and
JSON under docs/; pass --out-md/--out-json for a dry run or alternate destination.
"""
import argparse
import hashlib
import json
import math
import re
import subprocess
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "packages/game-engine/legacy/data/gameData.json"
LISTINGS_PATH = ROOT / "docs/company-primary-listings.json"
ECONOMY_PATH = ROOT / "packages/game-engine/src/economy.ts"
CAPS_PATH = ROOT / "docs/market-caps.json"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_economy(source):
    version_match = re.search(r"ECONOMY_VERSION\s*=\s*(\d+)", source)
    thresholds = {}
    for key, raw in re.findall(r"(medium|large):\s*([\d_]+)", source):
        thresholds[key] = int(raw.replace("_", ""))
    selected_match = re.search(r'SELECTED_ECONOMY_SCENARIO\s*=\s*["\']([^"\']+)', source)
    selected = selected_match.group(1) if selected_match else "unknown"
    # Parse the selected band declaration, including current continuous pricing.
    line = next((ln for ln in source.splitlines() if f'"{selected}"' in ln), "")
    bands = {}
    for key, lo, hi in re.findall(r"(small|medium|large):\s*\[([\d.]+),\s*([\d.]+)\]", line):
        bands[key] = [float(lo), float(hi)]
    pricing = "continuous" if "pricing: \"continuous\"" in line else "category_log_interpolation"
    return {
        "version": int(version_match.group(1)) if version_match else None,
        "selectedScenario": selected,
        "thresholdsUSD": thresholds,
        "declaredBandMetadataM": bands,
        "pricingMode": pricing,
        "bandMetadataIgnoredByContinuousPricing": pricing == "continuous",
        "scenarioMetadataNote": "V4 continuous pricing uses the fixed formula below; declared category bands and per-class yields are legacy scenario metadata and do not set current V4 prices or income.",
        "effectiveFormula": (
            "basePriceM = round2(clamp(25,1500,500*ln(1+marketCapUSD/50,000,000,000)/ln(5))); "
            "baseIncomeM = round2(basePriceM*(0.10+0.04*(1-exp(-marketCapUSD/200,000,000,000)))); "
            "one-share C/C price = basePriceM/5. Cap class only labels Small/Medium/Large."
        ) if pricing == "continuous" else "See economy.ts selected category-normalization formula.",
    }


def cap_class(company, thresholds):
    cap = company["marketCapUSD"]
    return "small" if cap < thresholds["medium"] else "medium" if cap < thresholds["large"] else "large"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_value(*args):
    try:
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-md", type=Path, default=ROOT / "MARKET_DISTRIBUTION.md")
    parser.add_argument("--out-json", type=Path, default=ROOT / "docs/market-distribution.json")
    args = parser.parse_args()

    catalog = load_json(CATALOG_PATH)
    inventory = load_json(LISTINGS_PATH)
    raw_audit = load_json(ROOT / "docs/company-audit-all.json")
    identity_rows = {row["id"]: row for row in raw_audit.get("companies", [])}
    listing_rows = {row["id"]: row for row in inventory.get("records", [])}
    companies = catalog["companies"]
    zones = [row["id"] for row in catalog["zones"]]
    sectors = [row["id"] for row in catalog["sectors"]]
    economy = parse_economy(ECONOMY_PATH.read_text(encoding="utf-8"))
    thresholds = economy["thresholdsUSD"]

    if not thresholds or "medium" not in thresholds or "large" not in thresholds:
        raise SystemExit("Cannot parse cap thresholds from economy.ts")
    seen = Counter(row["id"] for row in companies)
    if any(count != 1 for count in seen.values()):
        raise SystemExit("Runtime catalogue contains duplicate company IDs")

    zone_sector = {z: {s: Counter() for s in sectors} for z in zones}
    zone_totals = {z: Counter() for z in zones}
    sector_totals = {s: Counter() for s in sectors}
    exchange_totals = Counter()
    exchange_categories = defaultdict(Counter)
    group = defaultdict(list)
    price_ranges = {c: [] for c in ("small", "medium", "large")}
    cap_ranges = {c: [] for c in ("small", "medium", "large")}
    listing_audit = []
    current_ids = set(seen)

    for company in companies:
        category = cap_class(company, thresholds)
        zone, sector = company["zone"], company["sector"]
        if zone not in zone_sector or sector not in zone_sector[zone]:
            raise SystemExit(f"Unknown runtime zone/sector for {company['id']}: {zone}/{sector}")
        zone_sector[zone][sector][category] += 1
        zone_totals[zone][category] += 1
        sector_totals[sector][category] += 1
        group[(zone, sector)].append(company)
        price_ranges[category].append(company["basePrice"])
        cap_ranges[category].append(company["marketCapUSD"])

        listing = listing_rows.get(company["id"], {})
        identity = identity_rows.get(company["id"], {})
        # Never retain a ticker after a slot is repurposed to a different issuer.
        same_issuer = listing.get("issuer") == company["name"]
        ticker = listing.get("ticker") if same_issuer else None
        exchange = listing.get("exchange") if same_issuer else None
        status = listing.get("status", "unknown") if same_issuer else "unknown_identity_changed_recheck"
        if not ticker or not exchange:
            ticker, exchange, status = None, None, "unknown"
        else:
            exchange_totals[exchange] += 1
            exchange_categories[exchange][category] += 1
        listing_audit.append({
            "id": company["id"], "issuer": company["name"], "zone": zone,
            "category": category,
            "ticker": ticker, "exchange": exchange, "instrument": listing.get("instrument") if ticker else None,
            "listingStatus": status, "listingNote": listing.get("note") if ticker else "Primary listing requires verification or inventory update.",
            "issuerIdentityEvidenceURL": identity.get("verifiedSourceURL"),
            "marketCapUSD": company["marketCapUSD"], "marketCapAsOf": company.get("marketCapAsOf"),
            "marketCapEvidenceURL": company.get("marketCapSource"),
        })

    stale_listing_ids = sorted(set(listing_rows) - current_ids)
    counts = {"zone": {z: {k: zone_totals[z][k] for k in price_ranges} for z in zones},
              "sector": {s: {k: sector_totals[s][k] for k in price_ranges} for s in sectors},
              "total": {k: sum(zone_totals[z][k] for z in zones) for k in price_ranges}}
    combos = [(z, s) for z in zones for s in sectors]
    empty = [(z, s) for z, s in combos if not group[(z, s)]]
    histogram = Counter(len(group[(z, s)]) for z, s in combos if group[(z, s)])
    controls = []
    for (zone, sector), members in sorted(group.items()):
        if not members:
            continue
        full_cost = sum(c["basePrice"] for c in members)
        if full_cost <= 100:
            controls.append({"zone": zone, "sector": sector, "companies": [c["name"] for c in members],
                             "sharesRequired": 5 * len(members), "costM": round(full_cost, 2)})

    # Opening-cash affordability, with an explicit 0 M€ reserve.
    cash_m, reserve_m = 100.0, 0.0
    first_share_budget = [
        {"id": c["id"], "name": c["name"], "zone": c["zone"], "sector": c["sector"],
         "category": cap_class(c, thresholds), "sharePriceM": round(c["basePrice"] / 5, 2),
         "basePriceM": c["basePrice"], "remainingCashAfterPurchaseM": round(cash_m - reserve_m - c["basePrice"] / 5, 2)}
        for c in companies if c["basePrice"] / 5 <= cash_m - reserve_m
    ]

    observed_ranges = {}
    observed_yields = {}
    traded_price_ranges = {}
    for category, prices in price_ranges.items():
        category_companies = [c for c in companies if cap_class(c, thresholds) == category]
        ratios = [c["baseIncome"] / c["basePrice"] for c in category_companies if c["basePrice"]]
        observed_ranges[category] = {"minM": round(min(prices), 2) if prices else None,
                                     "maxM": round(max(prices), 2) if prices else None,
                                     "shareMinM": round(min(prices) / 5, 2) if prices else None,
                                     "shareMaxM": round(max(prices) / 5, 2) if prices else None,
                                     "count": len(prices)}
        observed_yields[category] = {"minPercent": round(min(ratios) * 100, 2) if ratios else None,
                                     "maxPercent": round(max(ratios) * 100, 2) if ratios else None,
                                     "count": len(ratios)}
        low_factor, high_factor = 0.375, 2.25
        share_low = min(prices) / 5
        share_high = max(prices) / 5
        traded_price_ranges[category] = {
            "factorRange": [low_factor, high_factor],
            "sharePriceM": [round(share_low * low_factor, 4), round(share_high * high_factor, 4)],
            "fullFiveShareCostM": [round(share_low * low_factor * 5, 4), round(share_high * high_factor * 5, 4)],
        }
    overlaps = []
    order = ["small", "medium", "large"]
    for a, b in zip(order, order[1:]):
        ar, br = observed_ranges[a], observed_ranges[b]
        if ar["maxM"] is not None and br["minM"] is not None and ar["maxM"] >= br["minM"]:
            overlaps.append({"classes": [a, b], "fromM": br["minM"], "toM": ar["maxM"], "touchesOnly": ar["maxM"] == br["minM"]})
    traded_overlaps = []
    for a, b in zip(order, order[1:]):
        ar, br = traded_price_ranges[a]["sharePriceM"], traded_price_ranges[b]["sharePriceM"]
        low, high = max(ar[0], br[0]), min(ar[1], br[1])
        if low <= high:
            traded_overlaps.append({"classes": [a, b], "fromM": low, "toM": high})

    result = {
        "generatedAt": date.today().isoformat(), "runtimeSource": str(CATALOG_PATH.relative_to(ROOT)),
        "companyCount": len(companies), "uniqueCompanyIdCount": len(seen), "zones": zones, "sectors": sectors,
        "counts": counts,
        "zoneSectorSmallMediumLarge": {z: {s: {k: zone_sector[z][s][k] for k in price_ranges} for s in sectors} for z in zones},
        "emptyZoneSectorCells": [{"zone": z, "sector": s} for z, s in empty],
        "occupiedCellSizeHistogram": dict(sorted(histogram.items())),
        "fullControlAtOrBelow100M": controls,
        "firstShareBudget": {"openingCashM": cash_m, "reserveM": reserve_m, "availableAfterReserveM": cash_m-reserve_m,
                             "affordableCompanyCount": len(first_share_budget), "companies": first_share_budget},
        "economy": economy, "observedBasePriceRangesM": observed_ranges,
        "observedIncomeYieldRangesPercent": observed_yields,
        "adjacentObservedPriceClassOverlaps": overlaps,
        "observedMarketCapRangesUSD": {k: {"min": min(v) if v else None, "max": max(v) if v else None} for k,v in cap_ranges.items()},
        "tradedSharePriceRangesM": traded_price_ranges,
        "tradedAdjacentClassOverlapsM": traded_overlaps,
        "continuousCurveFrontiers": [],
        "marketCapReferenceAsOf": load_json(CAPS_PATH).get("consultedAt"),
        "marketCapDatasetLastUpdated": load_json(CAPS_PATH).get("lastUpdated"),
        "sourceTraceability": {
            "gitBranch": git_value("branch", "--show-current"),
            "gitHead": git_value("rev-parse", "HEAD"),
            "sha256": {str(path.relative_to(ROOT)): sha256(path) for path in
                       (CATALOG_PATH, CAPS_PATH, LISTINGS_PATH, ECONOMY_PATH, Path(__file__).resolve())},
        },
        "marketPlaces": {"basis": "One game company per issuer; exactly one representative listing per company where established. Geographic zone is the game company zone, not the exchange location.",
                          "exchangeCompanyCounts": dict(sorted(exchange_totals.items())),
                          "exchangeCategoryCounts": {e: {k: exchange_categories[e][k] for k in price_ranges} for e in sorted(exchange_totals)},
                          "totalCompanyCountsByCategory": counts["total"],
                          "unknownListingCount": sum(1 for r in listing_audit if not r["ticker"]),
                          "staleInventoryIds": stale_listing_ids, "records": listing_audit,
                          "methodology": inventory.get("methodology"), "venueReferences": inventory.get("venueReferences", {})},
    }

    if economy["pricingMode"] == "continuous":
        def curve_price(cap):
            raw = 500 * math.log1p(cap / 50_000_000_000) / math.log(5)
            return round(max(25.0, min(1500.0, raw)) + 1e-10, 2)
        frontiers = []
        for name, threshold in (("Small/Medium", thresholds["medium"]), ("Medium/Large", thresholds["large"])):
            frontiers.append({"boundary": name, "thresholdUSD": threshold,
                              "belowBy1USD": {"category": cap_class({"marketCapUSD": threshold - 1}, thresholds), "basePriceM": curve_price(threshold - 1)},
                              "atUSD": {"category": cap_class({"marketCapUSD": threshold}, thresholds), "basePriceM": curve_price(threshold)},
                              "aboveBy1USD": {"category": cap_class({"marketCapUSD": threshold + 1}, thresholds), "basePriceM": curve_price(threshold + 1)}})
        result["continuousCurveFrontiers"] = frontiers

    def money(v):
        return f"{v:.2f} M€" if v is not None else "—"
    md = [
        "# Répartition runtime du marché",
        "",
        f"Généré le {result['generatedAt']} depuis `{result['runtimeSource']}` : **{len(companies)} sociétés / {len(seen)} IDs uniques**. Une société compte une fois, quelle que soit sa place de cotation.",
        "",
        f"Dataset de capitalisations : consultation initiale {result['marketCapReferenceAsOf']}, dernière consolidation {result['marketCapDatasetLastUpdated']}; chaque émetteur conserve sa date de cap propre dans le JSON. Branche `{result['sourceTraceability']['gitBranch']}`, HEAD `{result['sourceTraceability']['gitHead']}`. SHA-256 : catalogue `{result['sourceTraceability']['sha256'][str(CATALOG_PATH.relative_to(ROOT))][:16]}`, caps `{result['sourceTraceability']['sha256'][str(CAPS_PATH.relative_to(ROOT))][:16]}`, script `{result['sourceTraceability']['sha256'][str(Path(__file__).resolve().relative_to(ROOT))][:16]}` (empreintes complètes dans le JSON).",
        "",
        "## Zones du jeu — sociétés Small / Medium / Large",
        "",
        "| Zone | Small | Medium | Large | Total |",
        "|---|---:|---:|---:|---:|",
    ]
    for z in zones:
        vals = counts["zone"][z]
        md.append(f"| {z} | {vals['small']} | {vals['medium']} | {vals['large']} | {sum(vals.values())} |")
    t = counts["total"]
    md += [f"| **Total** | **{t['small']}** | **{t['medium']}** | **{t['large']}** | **{len(companies)}** |", "",
           "## Secteurs — sociétés Small / Medium / Large", "", "| Secteur | Small | Medium | Large | Total |", "|---|---:|---:|---:|---:|"]
    for s in sectors:
        vals = counts["sector"][s]
        md.append(f"| {s} | {vals['small']} | {vals['medium']} | {vals['large']} | {sum(vals.values())} |")
    md += ["", "## Matrice zone × secteur — Small / Medium / Large", "", "Chaque cellule indique `S/M/L`.", "",
           "| Zone | " + " | ".join(sectors) + " |", "|---|" + "|".join(["---"] * len(sectors)) + "|"]
    for z in zones:
        md.append("| " + z + " | " + " | ".join("{}/{}/{}".format(*(zone_sector[z][s][k] for k in order)) for s in sectors) + " |")
    md += ["", f"Cellules occupées : **{len(combos)-len(empty)}/{len(combos)}**; vides : **{len(empty)}** — " + (", ".join(f"{z}/{s}" for z, s in empty) or "aucune") + ".",
           "Tailles des cellules occupées : " + ", ".join(f"{n} cellule(s) de {size} société(s)" for size, n in sorted(histogram.items())) + ".",
           "", "## Contrôle complet avec budget de 100 M€", "",
           "Au prix de base, contrôle = achat des cinq actions de chaque société de la cellule; sans choc de marché.", "",
           "| Zone / secteur | Sociétés | Actions requises | Coût complet |", "|---|---|---:|---:|"]
    if controls:
        for row in controls:
            md.append(f"| {row['zone']} / {row['sector']} | {', '.join(row['companies'])} | {row['sharesRequired']} | {money(row['costM'])} |")
    else:
        md.append("| — | Aucune cellule contrôlable à 100 M€ | — | — |")
    md += ["", "## Première action avec 100 M€ et réserve de 0 M€", "",
           f"Prix d’une action = `basePrice / 5`. **{len(first_share_budget)}/{len(companies)}** sociétés sont achetables individuellement à l’ouverture avec {cash_m:.0f} M€ de liquidités, réserve {reserve_m:.0f} M€. La liste et le solde résiduel par achat figurent dans le JSON.", "",
           "## Prix continu, classes et volatilité", "",
           f"Version économie {economy['version']}, scénario déclaré `{economy['selectedScenario']}`. Les seuils 40/200 Md$ classent les entreprises; les anciennes bandes small/medium/large ne découpent pas la courbe v4 en blocs. Formule active : `basePrice = round2(clamp(25,1500,500*ln(1+capUSD/50bn)/ln(5)))` M€ pour les cinq actions; prix d’action C/C = `basePrice/5`. Revenu C/C = `round2(basePrice*(0.10+0.04*(1-exp(-capUSD/200bn))))`.", "",
           "| Classe de cap | Capitalisations observées | Prix complet C/C observé | Prix/action C/C observé | Effectif |", "|---|---:|---:|---:|---:|"]
    for category in order:
        r = observed_ranges[category]
        cap_range = result["observedMarketCapRangesUSD"][category]
        md.append(f"| {category} | {cap_range['min']/1e9:.2f}–{cap_range['max']/1e9:.2f} Md$ | {money(r['minM'])}–{money(r['maxM'])} | {money(r['shareMinM'])}–{money(r['shareMaxM'])} | {r['count']} |")
    sample_gap = None
    if cap_ranges["small"] and cap_ranges["medium"]:
        small_max_company = max((c for c in companies if cap_class(c, thresholds) == "small"), key=lambda c:c["marketCapUSD"])
        medium_min_company = min((c for c in companies if cap_class(c, thresholds) == "medium"), key=lambda c:c["marketCapUSD"])
        sample_gap = {"smallMaxCompany": small_max_company["name"], "smallMaxCapUSD": small_max_company["marketCapUSD"], "smallMaxPriceM": small_max_company["basePrice"],
                      "mediumMinCompany": medium_min_company["name"], "mediumMinCapUSD": medium_min_company["marketCapUSD"], "mediumMinPriceM": medium_min_company["basePrice"],
                      "priceGapM": round(medium_min_company["basePrice"]-small_max_company["basePrice"],2)}
        result["observedSampleBoundaryGap"] = sample_gap
    frontier_rows = []
    for row in result["continuousCurveFrontiers"]:
        frontier_rows.append(f"| {row['boundary']} ({row['thresholdUSD']/1e9:g} Md$) | {row['belowBy1USD']['category']} {row['belowBy1USD']['basePriceM']:.2f} M€ | {row['atUSD']['category']} {row['atUSD']['basePriceM']:.2f} M€ | {row['aboveBy1USD']['category']} {row['aboveBy1USD']['basePriceM']:.2f} M€ |")
    md += ["", "Rendement revenu/prix observé, calculé des valeurs runtime arrondies : " + "; ".join(f"{k} {r['minPercent']:.2f}–{r['maxPercent']:.2f}%" for k,r in observed_yields.items()) + ". La courbe est continue et les seuils ne créent pas de saut :",
           "", "| Seuil | 1 USD dessous | Au seuil | 1 USD dessus |", "|---|---:|---:|---:|"] + frontier_rows
    if sample_gap:
        md.append(f"\nL’écart apparent du catalogue entre le Small le plus capitalisé ({sample_gap['smallMaxCompany']}, {sample_gap['smallMaxCapUSD']/1e9:.2f} Md$) et le Medium le moins capitalisé ({sample_gap['mediumMinCompany']}, {sample_gap['mediumMinCapUSD']/1e9:.2f} Md$) vaut {sample_gap['priceGapM']:.2f} M€ à C/C. Il vient des caps observés, pas d’une discontinuité de seuil.")
    md += ["", "| Classe | Prix/action C/C observé | Prix/action après facteur de marché 0,375–2,25 | Coût des 5 actions après facteur |", "|---|---:|---:|---:|"]
    for category in order:
        r = traded_price_ranges[category]
        md.append(f"| {category} | {money(observed_ranges[category]['shareMinM'])}–{money(observed_ranges[category]['shareMaxM'])} | {r['sharePriceM'][0]:.4f}–{r['sharePriceM'][1]:.4f} M€ | {r['fullFiveShareCostM'][0]:.4f}–{r['fullFiveShareCostM'][1]:.4f} M€ |")
    md += ["", "Les facteurs 0,375 (E/D, événements fermés) à 2,25 (A/A) appliqués aux bornes observées donnent les plages unitaires ci-dessus. Chevauchements unitaires : " + "; ".join(f"{row['classes'][0]}/{row['classes'][1]} {row['fromM']:.4f}–{row['toM']:.4f} M€" for row in traded_overlaps) + ". Les classes n’imposent donc pas trois blocs de prix à l’achat.",
           "", "## Places de cotation représentatives", "",
           "Les cinq zones ci-dessus sont les zones géographiques du jeu. Cette section dénombre les émetteurs par place de cotation, en choisissant au plus une ligne représentative par émetteur : jamais une occurrence par ADR. Une dual-primary reste un choix méthodologique documenté, non l’affirmation qu’il n’existe qu’une cotation primaire.", "",
           "| Place | Small | Medium | Large | Total |", "|---|---:|---:|---:|---:|"]
    for venue, n in sorted(exchange_totals.items()):
        url = inventory.get("venueReferences", {}).get(venue)
        cats = exchange_categories[venue]
        name = f"[{venue}]({url})" if url else venue
        md.append(f"| {name} | {cats['small']} | {cats['medium']} | {cats['large']} | {n} |")
    md.append(f"| **Total** | **{counts['total']['small']}** | **{counts['total']['medium']}** | **{counts['total']['large']}** | **{len(companies)}** |")
    unknown = [r for r in listing_audit if not r["ticker"]]
    md += ["", f"Émetteurs sans place/ticker établi dans l’inventaire : **{len(unknown)}**." + (" IDs : " + ", ".join(r['id'] for r in unknown) + "." if unknown else ""),
           f"Statuts de l’inventaire : {dict(Counter(r['listingStatus'] for r in listing_audit))}. Les entrées inférées doivent être confirmées sur une fiche de place; les nouveaux remplacements sont reliés à des références officielles d’échange. Les noms et capitalisations proviennent des entrées locales du catalogue et de l’audit société; chaque ligne du JSON conserve ces URLs et la date de capitalisation.",
           "", "## Méthode et limites", "",
           "La ventilation compte les entreprises runtime, non leurs 5 actions, leurs ADR, leurs filiales croisées, ni les pays de ventes. Les classifications sectorielles sont celles du jeu. Prix issus de `basePrice` runtime au moment de génération; les premiers achats supposent prix C/C et zéro réserve. Les places sont un inventaire indicatif de listings primaires/représentatifs, avec statuts inconnus explicites plutôt qu’une déduction par pays seul.",
           "La correction de Contextes est indépendante de cette ventilation d’entreprises et n’en modifie pas les effectifs; aucun résultat de simulation n’est anticipé ici.",
           ""]

    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text("\n".join(md), encoding="utf-8")
    args.out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.out_md} and {args.out_json}: {len(companies)} issuers; {len(empty)} empty zone-sector cells; {len(unknown)} unknown listings")


if __name__ == "__main__":
    main()
