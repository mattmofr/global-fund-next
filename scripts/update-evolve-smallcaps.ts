import { readFileSync, writeFileSync } from "node:fs";
import { normalizeEconomy } from "../packages/game-engine/src/economy.js";

// Reproducible, narrowly scoped catalogue update. Embedded saved games are never read.
const catalogPath = "packages/game-engine/legacy/data/gameData.json";
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const replacements = JSON.parse(readFileSync("docs/evolve-smallcap-replacements.json", "utf8"));
const auditPath = "docs/company-audit-all.json";
const capPath = "docs/market-caps.json";
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const caps = JSON.parse(readFileSync(capPath, "utf8"));
for (const replacement of replacements.records) {
  const company = catalog.companies.find((item: any) => item.id === replacement.slotId);
  if (!company || ![replacement.previousName, replacement.company.name].includes(company.name))
    throw new Error(`Unexpected company in preserved slot ${replacement.slotId}`);
  if (company.zone !== replacement.company.zone || company.sector !== replacement.company.sector)
    throw new Error("Replacement changes geographic or sector scarcity.");
  delete company.logoPath; delete company.logoSource;
  Object.assign(company, replacement.company, { catalogVersion: 4, source: replacement.evidence.sources[0], legacyIdAliases: [company.id] });
  const row = audit.companies.find((item: any) => item.id === company.id);
  if (!row) throw new Error(`Missing audit slot ${company.id}`);
  Object.assign(row, {
    currentName: company.name, country: company.country, zone: company.zone, sector: company.sector,
    ticker: company.ticker, exchange: company.exchange,
    verifiedSourceURL: replacement.evidence.sources[0],
    modification: `Catalog v4: ${replacement.previousName} replaced by a listed Small; opaque legacy ID preserved.`,
    retrievalDate: replacements.researchDate,
    verificationStatus: "verified_primary_source_content_consulted",
    evidence: { status: "direct_page_content_accessed", sourceVerified: true, checkedDate: replacements.researchDate,
      summary: replacement.evidence.calculation, sources: replacement.evidence.sources,
      confidence: replacement.evidence.confidence },
    logo: { status: "fallback-monogram", assetPath: null, reason: "Existing renderer fallback; no new artwork in this engine iteration." },
    catalogVersion: 4,
  });
  const cap = caps.rows.find((item: any) => item.id === company.id);
  if (!cap) throw new Error(`Missing capitalization slot ${company.id}`);
  Object.assign(cap, { name: company.name, marketCapUSD: company.marketCapUSD,
    asOf: company.marketCapAsOf, accessedAt: replacements.researchDate,
    sourceURL: company.marketCapSource, sourceTitle: `${company.name} — dated issuer/exchange evidence`,
    evidence: replacement.evidence.calculation, confidence: replacement.evidence.confidence,
    sources: replacement.evidence.sources });
}
catalog.companies = normalizeEconomy(catalog.companies);
for (const company of catalog.companies) {
  const row = audit.companies.find((item: any) => item.id === company.id);
  Object.assign(row, { basePrice: company.basePrice, baseIncome: company.baseIncome,
    marketCapUSD: company.marketCapUSD, capCategory: company.capCategory,
    marketCapAsOf: company.marketCapAsOf, marketCapSource: company.marketCapSource, economyVersion: company.economyVersion });
}
if (catalog.companies.length !== 91 || new Set(catalog.companies.map((company: any) => company.id)).size !== 91)
  throw new Error("91 unique catalogue slots required.");
audit.lastUpdated = replacements.researchDate;
audit.catalogVersion = 4;
caps.lastUpdated = replacements.researchDate;
caps.basis = "Approximate dated sizes for gameplay classification only. Eleven v4 replacements have issuer/exchange inputs and explicit approximate FX; other observations retain their original dates. No live quote.";
for (const [path, value] of [[catalogPath, catalog], [auditPath, audit], [capPath, caps]] as const)
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
console.log(`Preserved 91 slots; applied ${replacements.records.length} Small replacements and continuous economy v4.`);
