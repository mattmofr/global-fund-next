import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LayoutGroup, motion } from "motion/react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Crown, Info, Minus, Network, Plus, Search, X } from "lucide-react";
import * as echarts from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsOption, TooltipComponentOption } from "echarts";
import type { Company, GameCommand, GameView, Grade, HistoryPoint, Player } from "@global-fund/shared";
import AnimatedMoney from "../presentation/AnimatedMoney";
import { usePresentationSettings } from "../presentation/settings";
import { GradeJewel } from "../ui/GradeJewel";
import { SectorIcon } from "../ui/SectorIcon";
import { GRADE_META, PALETTE } from "../ui/theme";
import { money, signedPercent, tone } from "../ui/format";
import { profitLossPercent, sortTradingRows, type TradingSortDirection, type TradingSortKey } from "./tradingSort";
import { companyCurrentIncome } from "./companyValuation";
import CompanyValuationDialog from "./CompanyValuationDialog";
import "./trading-desk.css";

echarts.use([LineChart, PieChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

type Props = {
  game: GameView;
  viewerId: string;
  canAct: boolean;
  onCommand: (command: GameCommand) => void;
  browseZone?: string;
  onBrowseZoneChange?: (zoneId: string) => void;
  initialTab?: Tab;
  onClose?: () => void;
  onEndTurn?: () => void;
  onReturnTravel?: () => void;
};
type Tab = "market" | "portfolio" | "analysis" | "statistics";
type RatingScope = "zone" | "sector";
type CapFilter = "all" | "small" | "medium" | "large";
type Catalog = { id: string; name: string }[];
/** One history reading, ready for a line chart (axis keeps the cycle, the tooltip the full label). */
type SeriesPoint = { cycle: number; tip: string; value: number };
type Slice = { id: string; name: string; short: string; value: number; color: string };

const TABS: [Tab, string][] = [["market", "Marché"], ["portfolio", "Portefeuille"], ["analysis", "Analyse"], ["statistics", "Statistiques"]];
const GRADE_ORDER: Grade[] = ["A", "B", "C", "D", "E"];
const CHART_FONT = "Inter, system-ui, sans-serif";
/** Chart ink, mirrored from the tokens in styles.css (canvas cannot read CSS variables). */
const INK = {
  text: PALETTE.text,
  label: "#7d7a73", // --text-3
  grid: "rgba(255, 255, 255, 0.05)",
  axis: "rgba(255, 255, 255, 0.08)",
  gold: PALETTE.accent,
  wash: "rgba(227, 184, 96, 0.08)",
  panel: PALETTE.surface2, // card surface: rings around end dots
  tooltip: "#2a2a2e", // --surface-3
  quiet: "#67635c", // the non-leading ring slices
};
const axisNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const percent0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

const amount = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const catalogName = (items: Catalog, id: string) => items.find((item) => item.id === id)?.name ?? id;
const holding = (company: Company, viewerId: string) => amount(company.holdings?.[viewerId]);
/** "Immobilier & infrastructures" → "Immobilier" (the remainder stays in the DOM for sorting and assistive tech). */
const splitName = (name: string) => {
  const [head, ...rest] = name.split(/\s+&\s+/);
  return { head: head ?? name, rest: rest.length ? ` & ${rest.join(" & ")}` : "" };
};
const monogram = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word && !/^(the|le|la|les|de|des|of)$/i.test(word));
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "GF";
};
/** Short market names for tight labels; the full name stays in titles. */
const ZONE_SHORT: Record<string, string> = { africa: "Afrique & M.-O." };
const zoneShort = (id: string, name: string) => (name.length > 14 ? ZONE_SHORT[id] ?? name : name);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const historyTip = (point: HistoryPoint) => {
  const reason = typeof point.reason === "string" && point.reason ? ` · ${point.reason}` : "";
  return `${point.label || `Cycle ${point.cycle}`}${reason}`;
};
const periodChange = (points: SeriesPoint[]) => {
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  return points.length > 1 && first && last != null ? (last / first - 1) * 100 : null;
};
const share = (value: number, total: number) => percent0.format((value / (total || 1)) * 100);

function priceSeries(history: HistoryPoint[], companyId: string): SeriesPoint[] {
  return history
    .filter((point) => Number.isFinite(point.prices?.[companyId]))
    .map((point) => ({ cycle: point.cycle, tip: historyTip(point), value: point.prices[companyId] }))
    .filter((point) => point.value >= 0);
}

/** Exposure slices, largest first: the lead in gold, the rest in one quiet neutral. */
function rankSlices(rows: { id: string; name: string; short: string; value: number }[]): Slice[] {
  return [...rows]
    .sort((a, b) => b.value - a.value)
    .map((row, index) => ({ ...row, color: index === 0 ? INK.gold : INK.quiet }));
}

/* ------------------------------------------------------------- charts -- */

const tooltipChrome = (): TooltipComponentOption => ({
  confine: true,
  backgroundColor: INK.tooltip,
  borderColor: "rgba(255, 255, 255, 0.12)",
  borderWidth: 1,
  padding: [9, 13],
  textStyle: { color: INK.text, fontFamily: CHART_FONT, fontSize: 12 },
  extraCssText: "border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.35),0 18px 48px rgba(0,0,0,.45);",
});

/** Round value-axis bounds with a little headroom, so flat or tiny moves stay centred and legible. */
function niceExtent(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max) * 0.16, 1);
  const raw = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const low = Math.floor((min - span * 0.12) / step) * step;
  return { min: min >= 0 ? Math.max(0, low) : low, max: Math.ceil((max + span * 0.12) / step) * step, interval: step };
}

function lineOption(points: SeriesPoint[], name: string, reduced: boolean): EChartsOption {
  const last = points.length - 1;
  const extent = points.length ? niceExtent(points.map((point) => point.value)) : null;
  const cycleStart = points.map((point, index) => index === 0 || point.cycle !== points[index - 1].cycle);
  return {
    animation: !reduced,
    animationDuration: 600,
    animationEasing: "cubicOut",
    animationDurationUpdate: 260,
    textStyle: { fontFamily: CHART_FONT },
    grid: { left: 2, right: 10, top: 14, bottom: 2 },
    tooltip: {
      ...tooltipChrome(),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "rgba(227, 184, 96, 0.45)", width: 1 } },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const point = points[item?.dataIndex ?? -1];
        return point ? `<div class="td-tip"><span>${escapeHtml(point.tip)}</span><b>${escapeHtml(money(point.value))}</b></div>` : "";
      },
    },
    xAxis: {
      type: "category",
      data: points.map((_, index) => String(index)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: INK.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: INK.label,
        fontSize: 11,
        margin: 12,
        hideOverlap: true,
        interval: (index: number) => cycleStart[index] ?? false,
        formatter: (_value: string, index: number) => `C${points[index]?.cycle ?? ""}`,
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...(extent ?? { splitNumber: 4 }),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK.label, fontSize: 11, margin: 12, formatter: (value: number) => axisNumber.format(value) },
      splitLine: { lineStyle: { color: INK.grid } },
    },
    series: [{
      type: "line",
      name,
      smooth: 0.3,
      showSymbol: true,
      symbol: "none",
      lineStyle: { width: 2, color: INK.gold, cap: "round", join: "round" },
      areaStyle: { color: INK.wash },
      emphasis: { disabled: true },
      data: points.map((point, index) => index === last
        ? { value: point.value, symbol: "circle", symbolSize: 10, itemStyle: { color: INK.gold, borderColor: INK.panel, borderWidth: 2 } }
        : { value: point.value, symbol: "none" }),
    }],
  };
}

function donutOption(slices: Slice[], reduced: boolean): EChartsOption {
  return {
    animation: !reduced,
    animationDuration: 700,
    animationEasing: "cubicOut",
    textStyle: { fontFamily: CHART_FONT },
    series: [{
      type: "pie",
      radius: ["78%", "94%"],
      center: ["50%", "50%"],
      padAngle: slices.length > 1 ? 1.8 : 0,
      startAngle: 90,
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderRadius: 3 },
      emphasis: { scale: true, scaleSize: 4 },
      data: slices.map((slice) => ({ name: slice.name, value: slice.value, itemStyle: { color: slice.color } })),
    }],
  };
}

/** ECharts host. Options are compared by content so server pushes never replay animations. */
const EChart = memo(function EChart({ option, label, className = "", onReady }: {
  option: EChartsOption; label: string; className?: string; onReady?: (chart: ECharts | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const latest = useRef({ option, label, onReady });
  const signature = useMemo(() => `${label}|${JSON.stringify(option)}`, [option, label]);
  useEffect(() => { latest.current = { option, label, onReady }; });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let instance: ECharts | null = null;
    let observer: ResizeObserver | null = null;
    let resizeFrame = 0;
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => instance?.resize());
    };
    const frame = requestAnimationFrame(() => {
      instance = echarts.init(element, undefined, { renderer: "canvas" });
      instance.setOption(withAria(latest.current.option, latest.current.label), true);
      chart.current = instance;
      latest.current.onReady?.(instance);
      observer = new ResizeObserver(resize);
      observer.observe(element);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      latest.current.onReady?.(null);
      instance?.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(withAria(latest.current.option, latest.current.label), true);
  }, [signature]);
  return <div ref={host} className={`td-chart ${className}`} role="img" aria-label={label} />;
});
const withAria = (option: EChartsOption, label: string): EChartsOption => ({ ...option, aria: { enabled: true, label: { description: label } } });

/* -------------------------------------------------------------- parts -- */

/** Company mark: official logo on a light plate, a monogram when there is none. */
function Logo({ company, size = "md" }: { company: Company; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = Boolean(company.logoPath) && failed !== company.logoPath;
  return (
    <i className={`td-logo td-logo--${size} ${showLogo ? "has-logo" : "is-monogram"}`} aria-hidden="true">
      {showLogo
        ? <img src={company.logoPath} alt="" loading="lazy" draggable={false} onError={() => setFailed(company.logoPath ?? null)} />
        : <span>{monogram(company.name)}</span>}
    </i>
  );
}

/**
 * Five share pips. Newly confirmed shares light up with a short pop; `ghost`
 * previews an order (+n shares outlined in gold, −n shares hollowed out).
 */
function Pips({ value, ghost = 0 }: { value: number; ghost?: number }) {
  const previous = useRef(value);
  const before = previous.current;
  useEffect(() => { previous.current = value; }, [value]);
  const low = Math.max(0, Math.min(value, value + ghost));
  const high = Math.min(5, Math.max(value, value + ghost));
  return (
    <span className={`td-pips ${value >= 5 ? "is-full" : ""}`} aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => {
        const lit = index < value;
        const previewed = ghost !== 0 && index >= low && index < high;
        const classes = [lit && "lit", lit && index >= before && "is-new", previewed && (ghost > 0 ? "is-gain" : "is-loss")].filter(Boolean).join(" ");
        return <i key={index} className={classes || undefined} />;
      })}
    </span>
  );
}

function SectorName({ id, name, iconSize = 14 }: { id: string; name: string; iconSize?: number }) {
  const { head, rest } = splitName(name);
  return <><SectorIcon id={id} size={iconSize} /><span className="td-sector-head">{head}</span>{rest && <span className="sr-only">{rest}</span>}</>;
}

const capTitle = (cap?: Company["capCategory"]) => cap ? `${cap[0].toUpperCase()}${cap.slice(1)} Cap · taille de l’entreprise` : "Catégorie de taille inconnue";

/* ---------------------------------------------------------- component -- */

export default function TradingDesk({
  game,
  viewerId,
  canAct,
  onCommand,
  browseZone,
  onBrowseZoneChange,
  initialTab = "market",
  onClose,
  onEndTurn,
  onReturnTravel,
}: Props) {
  const { reducedMotion } = usePresentationSettings();
  const viewer = game.players.find((player) => player.id === viewerId) as Player | undefined;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [filter, setFilter] = useState("all");
  const [capFilter, setCapFilter] = useState<CapFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: TradingSortKey; direction: TradingSortDirection }>({ key: "company", direction: "ascending" });
  const [ratingScope, setRatingScope] = useState<RatingScope>("zone");
  /** The order button under the pointer or focus: its result is previewed on the selected row. */
  const [preview, setPreview] = useState<"buy" | "sell" | null>(null);
  const [valuationOpen, setValuationOpen] = useState(false);
  const flashes = useHoldingFlashes(game.companies, viewerId);
  const activeZone = viewer?.zone ?? "";
  const selectedZone = game.phase === "geography" ? browseZone ?? activeZone : activeZone;
  const selected = game.companies.find((company) => company.id === selectedId) ?? null;
  useEffect(() => setValuationOpen(false), [tab, selectedId]);

  const companies = useMemo(() => {
    const source = tab === "portfolio"
      ? game.companies.filter((company) => holding(company, viewerId) > 0)
      : game.companies.filter((company) => company.zone === selectedZone);
    return source
      .filter((company) => filter === "all" || company.sector === filter)
      .filter((company) => capFilter === "all" || company.capCategory === capFilter)
      .filter((company) => {
        const query = search.trim().toLocaleLowerCase("fr-FR");
        return !query || [company.name, company.ticker, company.country]
          .some((value) => value?.toLocaleLowerCase("fr-FR").includes(query));
      })
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [game.companies, tab, viewerId, selectedZone, filter, capFilter, search]);
  const sortedCompanies = useMemo(() => {
    const rows = companies.map((company) => {
      const held = holding(company, viewerId);
      const average = company.averageBuyPrice?.[viewerId];
      return {
        id: company.id,
        name: company.name,
        sector: catalogName(game.sectors, company.sector),
        capitalization: company.capCategory ?? null,
        price: amount(company.price),
        profitLoss: profitLossPercent(amount(company.price), average, held),
        held,
        available: amount(company.sharesAvailable),
        company,
      };
    });
    return sortTradingRows(rows, sort.key, sort.direction).map((row) => row.company);
  }, [companies, game.sectors, sort, viewerId]);
  useEffect(() => {
    if (tab === "statistics") {
      if (!game.companies.some((company) => company.id === selectedId))
        setSelectedId(game.companies[0]?.id ?? "");
      return;
    }
    if (!companies.some((company) => company.id === selectedId))
      setSelectedId(companies[0]?.id ?? "");
  }, [companies, game.companies, selectedId, tab]);

  const held = selected ? holding(selected, viewerId) : 0;
  const average = selected?.averageBuyPrice?.[viewerId] ?? null;
  const selectedProfitLoss = selected ? profitLossPercent(amount(selected.price), average, held) : null;
  const buyTotal = amount(selected?.price) * quantity;
  const canTrade = Boolean(
    selected &&
      viewer &&
      canAct &&
      game.phase === "market" &&
      game.activePlayerId === viewerId &&
      !viewer.jailed &&
      viewer.geoResolved &&
      viewer.zone === selected.zone &&
      selected.available &&
      quantity >= 1 &&
      quantity <= 5,
  );
  const disabledReason = !viewer
    ? "Joueur introuvable."
    : game.phase !== "market"
      ? "Les échanges sont disponibles pendant la phase Marché."
      : game.activePlayerId !== viewerId || !canAct
        ? "Attendez votre tour pour passer un ordre."
        : viewer.jailed
          ? "Les échanges sont suspendus pendant la détention."
          : !viewer.geoResolved
            ? "Choisissez une destination avant de trader."
            : selected && selected.zone !== viewer.zone
              ? "Cette entreprise est hors de votre zone active."
              : selected && !selected.available
                ? "Cette entreprise n’est pas disponible à l’échange."
                : "";
  const trade = (side: "BUY_SHARE" | "SELL_SHARE") => {
    if (!selected || !canTrade) return;
    if (side === "BUY_SHARE" && (quantity > selected.sharesAvailable || buyTotal > amount(viewer?.cash))) return;
    if (side === "SELL_SHARE" && quantity > held) return;
    onCommand({ type: side, companyId: selected.id, quantity });
  };
  const buyDisabled = !canTrade || !selected || quantity > selected.sharesAvailable || buyTotal > amount(viewer?.cash);
  const sellDisabled = !canTrade || quantity > held;
  /** Shares the selected company would hold after the previewed order (presentation only). */
  const previewShares = preview === "buy" && !buyDisabled ? held + quantity : preview === "sell" && !sellDisabled ? held - quantity : null;
  const previewOn = (side: "buy" | "sell") => ({
    onPointerEnter: () => setPreview(side),
    onPointerLeave: () => setPreview(null),
    onFocus: () => setPreview(side),
    onBlur: () => setPreview(null),
  });

  const history = useMemo(() => (selected ? priceSeries(game.marketHistory, selected.id) : []), [game.marketHistory, selected]);
  const marketOption = useMemo(() => lineOption(history, selected?.name ?? "Cours", reducedMotion), [history, selected?.name, reducedMotion]);
  const historyChange = periodChange(history);

  const exposure = useMemo(() => {
    const rows = (key: "zone" | "sector", catalog: Catalog) =>
      catalog
        .map((item) => ({
          ...item,
          value: game.companies
            .filter((company) => company[key] === item.id)
            .reduce((sum, company) => sum + holding(company, viewerId) * amount(company.price), 0),
        }))
        .filter((item) => item.value > 0);
    return { zones: rows("zone", game.zones), sectors: rows("sector", game.sectors) };
  }, [game.companies, game.zones, game.sectors, viewerId]);
  const zoneSlices = useMemo(() => rankSlices(exposure.zones.map((zone) => ({
    id: zone.id, name: zone.name, short: zoneShort(zone.id, zone.name), value: zone.value,
  }))), [exposure.zones]);
  const sectorSlices = useMemo(() => rankSlices(exposure.sectors.map((sector) => ({
    id: sector.id, name: sector.name, short: splitName(sector.name).head, value: sector.value,
  }))), [exposure.sectors]);

  const fullOwned = game.companies.filter((company) => holding(company, viewerId) >= 5);
  const monopolyCount = useMemo(() => {
    const groups = new Map<string, { all: Company[]; owned: Company[] }>();
    game.companies.forEach((company) => {
      const key = `${company.zone}:${company.sector}`;
      const group = groups.get(key) ?? { all: [], owned: [] };
      group.all.push(company);
      if (holding(company, viewerId) >= 5) group.owned.push(company);
      groups.set(key, group);
    });
    return [...groups.values()].filter((group) => group.owned.length === group.all.length && group.all.length > 0).length;
  }, [game.companies, viewerId]);
  const ownershipGroups = useMemo(() => {
    const groups = new Map<string, { zone: string; sector: string; companies: Company[]; complete: boolean }>();
    game.companies.forEach((company) => {
      const key = `${company.zone}:${company.sector}`;
      const group = groups.get(key) ?? { zone: company.zone, sector: company.sector, companies: [], complete: true };
      group.companies.push(company);
      group.complete &&= holding(company, viewerId) >= 5;
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [game.companies, viewerId]);
  const fullGroups = ownershipGroups.filter((group) => group.complete);
  const portfolioGroups = ownershipGroups
    .map((group) => ({ ...group, members: group.companies, companies: group.companies.filter((company) => holding(company, viewerId) > 0) }))
    .filter((group) => group.companies.length > 0)
    .sort((a, b) => `${a.zone}:${a.sector}`.localeCompare(`${b.zone}:${b.sector}`));
  const selectedGroup = selected
    ? ownershipGroups.find((group) => group.zone === selected.zone && group.sector === selected.sector)
    : undefined;
  const selectedZoneGrade = selected ? game.zoneGrades?.[selected.zone] ?? "C" : "C";
  const selectedSectorGrade = selected ? game.sectorGrades?.[selected.sector] ?? "C" : "C";
  const currentIncome = selected ? companyCurrentIncome(selected, game, viewerId) : 0;
  const currentIncomeFloor = selectedGroup?.complete
    ? "monopoly"
    : selected && Object.values(selected.holdings ?? {}).some((shares) => amount(shares) >= 5) ? "control" : "none";
  const heldCount = game.companies.filter((company) => holding(company, viewerId) > 0).length;
  const positionsValue = game.companies.reduce((sum, company) => sum + holding(company, viewerId) * amount(company.price), 0);

  const navHistory = useMemo(() => game.marketHistory
    .map((point) => ({ cycle: point.cycle, tip: historyTip(point), value: point.funds?.[viewerId] }))
    .filter((point): point is SeriesPoint => Number.isFinite(point.value)), [game.marketHistory, viewerId]);
  const navOption = useMemo(() => lineOption(navHistory, "Valeur du fonds", reducedMotion), [navHistory, reducedMotion]);
  const navChange = periodChange(navHistory);
  const ratingCatalog = ratingScope === "zone" ? game.zones : game.sectors;

  const zoneName = catalogName(game.zones, selectedZone);
  const titleZone = zoneName.toUpperCase() || "ZONE À DÉFINIR";
  const zoneGrade = game.zoneGrades?.[selectedZone];
  const isListTab = tab === "market" || tab === "portfolio";
  const marketOpen = game.phase === "market";

  const selectRow = (company: Company) => {
    setSelectedId(company.id);
    setQuantity(1);
  };
  const onRowsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".td-row"));
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
    rows[next]?.click();
  };

  return (
    <section className={`trading-desk is-${tab}`} aria-label="Salle des marchés" data-phase={game.phase}>
      <header className="td-header">
        <div className="td-heading">
          {tab === "portfolio" ? (
            <>
              <h1><span className="td-title-main">PORTEFEUILLE</span></h1>
              {viewer?.name && <span className="td-title-note">{viewer.name}</span>}
            </>
          ) : (
            <>
              <h1 title={zoneName ? `Trading — ${zoneName}` : undefined}>
                <span className="td-title-over">TRADING</span>
                <span className="td-title-sep"> — </span>
                <span className="td-title-main">{titleZone}</span>
              </h1>
              {zoneGrade && <GradeJewel grade={zoneGrade} size="sm" label={`Note de la zone ${zoneName}`} className="td-zone-grade" />}
            </>
          )}
        </div>
        <div className="td-header-end">
          <span className={`td-status ${marketOpen ? "is-open" : "is-paused"}`}><i aria-hidden="true" />{marketOpen ? "Marché ouvert" : "Marché en pause"}</span>
          <div className="td-capital" title={viewer ? `Liquidités de ${viewer.name}` : undefined}>
            <span>Liquidités</span>
            <strong><AnimatedMoney value={amount(viewer?.cash)} /></strong>
          </div>
          <div className="td-header-actions">
            {game.phase === "market" && canAct && onEndTurn && (
              <button type="button" className="gf-btn gf-btn--ghost gf-btn--sm td-end-turn" onClick={onEndTurn} aria-label="Terminer le marché" title="Terminer le marché">
                <Check size={15} strokeWidth={2} aria-hidden="true" />Terminer le marché
              </button>
            )}
            {game.phase === "geography" && onReturnTravel && (
              <button type="button" className="gf-btn gf-btn--quiet gf-btn--sm td-back-travel" onClick={onReturnTravel} aria-label="Retour à la décision de voyage" title="Retour à la décision de voyage">
                <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />Voyage
              </button>
            )}
            {onClose && (
              <button type="button" className="gf-icon-btn td-close" onClick={onClose} aria-label="Retour au plateau" title="Retour au plateau · Échap">
                <X size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="td-toolbar">
        <nav className="td-tabs" aria-label="Vues du marché">
          <LayoutGroup id="td-tabs">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
                {id === "portfolio" && heldCount > 0 && <b>{heldCount}</b>}
                {tab === id && <motion.i layoutId="td-tab-ink" className="td-tab-ink" aria-hidden="true" transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }} />}
              </button>
            ))}
          </LayoutGroup>
        </nav>
        {isListTab && (
          <div className="td-filters">
            <label className="td-search">
              <Search size={15} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Rechercher une entreprise</span>
              <input type="search" aria-label="Rechercher une entreprise" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Société, pays…" />
            </label>
            {game.phase === "geography" && onBrowseZoneChange && (
              <label className="td-select">
                <span className="sr-only">Zone à consulter</span>
                <select value={selectedZone} onChange={(event) => onBrowseZoneChange(event.target.value)}>
                  {game.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}{zone.id === activeZone ? " · votre position" : ""}</option>)}
                </select>
              </label>
            )}
            <label className="td-select">
              <span className="sr-only">Filtrer par secteur</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">Tous secteurs</option>
                {game.sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
              </select>
            </label>
            <label className="td-select td-select--cap">
              <span className="sr-only">Filtrer par taille de capitalisation</span>
              <select value={capFilter} onChange={(event) => setCapFilter(event.target.value as CapFilter)}>
                <option value="all">Toutes tailles</option>
                <option value="small">Small Cap</option>
                <option value="medium">Medium Cap</option>
                <option value="large">Large Cap</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {tab === "analysis" ? (
        <div className="td-view td-analysis">
          <DonutCard title="Exposition par zone" slices={zoneSlices} reduced={reducedMotion} label="Répartition par zone" />
          <DonutCard title="Exposition par secteur" slices={sectorSlices} reduced={reducedMotion} label="Répartition par secteur" />
          <article className="td-card td-ownership">
            <header className="td-card-head"><h2>Contrôle</h2></header>
            <section className="td-control-block" aria-label="Détentions intégrales">
              <div className="td-tally" title="5/5 parts d’une société · revenu minimum C/C">
                <strong>{fullOwned.length}</strong>
                <span><Crown size={15} strokeWidth={1.8} aria-hidden="true" />{fullOwned.length > 1 ? "Contrôles" : "Contrôle"} 5/5</span>
                <small>Revenu minimum C/C</small>
              </div>
              {fullOwned.length > 0 && (
                <ul className="td-owned-list">
                  {fullOwned.map((company) => (
                    <li key={company.id}>
                      <Logo company={company} size="sm" />
                      <span>{company.name}</span>
                      <small>{zoneShort(company.zone, catalogName(game.zones, company.zone))} · {splitName(catalogName(game.sectors, company.sector)).head}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="td-control-block is-monopoly" aria-label="Monopoles zone et secteur">
              <div className="td-tally" title="Toutes les sociétés d’un groupe zone × secteur à 5/5 · revenu minimum A/A">
                <strong>{monopolyCount}</strong>
                <span><Network size={15} strokeWidth={1.8} aria-hidden="true" />{monopolyCount > 1 ? "Monopoles" : "Monopole"}</span>
                <small>Revenu minimum A/A</small>
              </div>
              {fullGroups.length > 0 && (
                <ul className="td-owned-list">
                  {fullGroups.map((group) => (
                    <li key={`${group.zone}:${group.sector}`}>
                      <SectorIcon id={group.sector} size={15} />
                      <span>{catalogName(game.zones, group.zone)} · {catalogName(game.sectors, group.sector)}</span>
                      <small>{group.companies.length} {group.companies.length > 1 ? "sociétés" : "société"}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </article>
        </div>
      ) : tab === "statistics" ? (
        <div className="td-view td-statistics">
          <article className="td-card td-stat-card td-nav-history">
            <header className="td-card-head">
              <h2>Valeur du fonds</h2>
              {navHistory.length > 0 && (
                <p className="td-figure">
                  <strong>{money(navHistory.at(-1)!.value)}</strong>
                  {navChange != null && <b className={tone(navChange)}>{signedPercent(navChange)}</b>}
                </p>
              )}
            </header>
            {navHistory.length > 1
              ? <EChart option={navOption} label={`Historique de la valeur du fonds : ${navHistory.map((point) => `${point.tip} ${money(point.value)}`).join("; ")}`} />
              : <p className="td-empty">{navHistory.length ? `Un relevé : ${money(navHistory[0].value)}` : "Aucun relevé de valeur."}</p>}
          </article>
          <article className="td-card td-stat-card td-rating-history">
            <header className="td-card-head">
              <h2>Notations</h2>
              <div className="td-rating-tabs" role="group" aria-label="Groupe de notations">
                <button type="button" className={ratingScope === "zone" ? "active" : ""} aria-pressed={ratingScope === "zone"} onClick={() => setRatingScope("zone")}>Zones</button>
                <button type="button" className={ratingScope === "sector" ? "active" : ""} aria-pressed={ratingScope === "sector"} onClick={() => setRatingScope("sector")}>Secteurs</button>
              </div>
            </header>
            {game.marketHistory.length > 1
              ? <RatingTimeline history={game.marketHistory} scope={ratingScope} items={ratingCatalog} />
              : <p className="td-empty">Historique insuffisant.</p>}
          </article>
          <article className="td-card td-stat-card td-company-history">
            <header className="td-card-head">
              <h2>Cours historiques</h2>
              {history.length > 0 && (
                <p className="td-figure">
                  <strong>{money(history.at(-1)!.value)}</strong>
                  {historyChange != null && <b className={tone(historyChange)}>{signedPercent(historyChange)}</b>}
                </p>
              )}
            </header>
            <label className="td-select td-select--block">
              <span className="sr-only">Entreprise à analyser</span>
              <select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
                {game.zones.map((zone) => (
                  <optgroup key={zone.id} label={zone.name}>
                    {game.companies.filter((company) => company.zone === zone.id).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {history.length > 1
              ? <EChart option={marketOption} label={`Historique de ${selected?.name ?? "l’entreprise"} : ${history.map((point) => `${point.tip} ${money(point.value)}`).join("; ")}`} />
              : <p className="td-empty">{history.length ? `Un relevé : ${money(history[0].value)}` : "Aucun historique pour cette société."}</p>}
          </article>
        </div>
      ) : (
        <div className="td-view td-workspace">
          <section className={`td-list ${tab === "portfolio" ? "is-portfolio" : ""}`} aria-label={tab === "portfolio" ? "Vos positions" : "Cotations"}>
            {tab === "portfolio" && (
              <>
                <header className="td-list-caption">
                  <span className="td-kicker">VOS POSITIONS</span>
                  {positionsValue > 0 && <strong title="Valeur actuelle de l’ensemble des positions">{money(positionsValue)}</strong>}
                </header>
                {portfolioGroups.length > 0 && (
                  <section className="td-portfolio-groups" tabIndex={0} aria-label="Groupes de contrôle par zone et secteur">
                    {portfolioGroups.map((group) => {
                      const controlled = group.companies.filter((company) => holding(company, viewerId) === 5).length;
                      const total = group.members.length;
                      const complete = controlled === total && total > 0;
                      const zone = catalogName(game.zones, group.zone);
                      const sector = catalogName(game.sectors, group.sector);
                      return (
                        <article
                          className={`td-portfolio-group ${complete ? "complete" : ""}`}
                          key={`${group.zone}:${group.sector}`}
                          aria-label={`${zone} · ${sector} : ${controlled}/${total} contrôlées${complete ? ", monopole, revenu minimum A/A" : ""}`}
                          title={complete ? "Monopole : toutes les sociétés du groupe à 5/5 · revenu minimum A/A" : "Seuil 5/5 par société pour C/C · toutes à 5/5 pour le monopole A/A"}
                        >
                          <header>
                            <SectorIcon id={group.sector} size={14} />
                            <strong>{zoneShort(group.zone, zone)} · {splitName(sector).head}</strong>
                            {complete && <Network className="td-group-mark" size={14} strokeWidth={1.8} aria-hidden="true" />}
                          </header>
                          <div className="td-group-progress">
                            <span className="td-group-bar" aria-hidden="true">
                              {group.members.map((company) => {
                                const shares = holding(company, viewerId);
                                return <i key={company.id} className={shares >= 5 ? "is-full" : ""} title={`${company.name} : ${shares}/5`}><i style={{ width: `${shares * 20}%` }} /></i>;
                              })}
                            </span>
                            <small>{complete ? "Monopole · A/A" : `${controlled}/${total} contrôlée${controlled > 1 ? "s" : ""}`}</small>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                )}
              </>
            )}
            <div className="td-table-scroll">
              <div className="td-column-head">
                {([
                  ["company", "Entreprise", "entreprise", undefined, false],
                  ["sector", "Secteur", "secteur", undefined, false],
                  ["capitalization", "Taille", "catégorie de capitalisation : Small Cap, Medium Cap ou Large Cap", "Capitalisation : Small · Medium · Large", false],
                  ["price", "Cours", "cours actuel par part", undefined, true],
                  ["profitLoss", "P/L", "plus-value ou moins-value en pourcentage par rapport au prix moyen d’achat", "P/L = (cours actuel / prix moyen − 1) × 100 ; tiret si PRU inconnu ou aucune part détenue", true],
                  ["held", "Vos parts", "parts détenues", "Parts détenues sur 5", true],
                  ["available", "Dispo.", "parts disponibles", "Parts disponibles sur 5", true],
                ] as const).map(([key, label, accessibleLabel, tooltip, numeric]) => (
                  <span key={key} className={`td-column ${numeric ? "is-num" : ""}`} role="columnheader" aria-sort={sort.key === key ? sort.direction : "none"}>
                    <button
                      type="button"
                      className="td-sort-button"
                      title={tooltip}
                      aria-label={`Trier par ${accessibleLabel}, ordre ${sort.key === key && sort.direction === "ascending" ? "décroissant" : "croissant"}`}
                      onClick={() => setSort((current) => ({ key, direction: current.key === key && current.direction === "ascending" ? "descending" : "ascending" }))}
                    >
                      {label}
                      {sort.key === key && (sort.direction === "ascending"
                        ? <ArrowUp className="td-sort-indicator" size={12} strokeWidth={2.2} aria-hidden="true" />
                        : <ArrowDown className="td-sort-indicator" size={12} strokeWidth={2.2} aria-hidden="true" />)}
                    </button>
                  </span>
                ))}
              </div>
              <div className="td-rows" onKeyDown={onRowsKeyDown}>
                {sortedCompanies.map((company, index) => {
                  const shares = holding(company, viewerId);
                  const profitLoss = profitLossPercent(amount(company.price), company.averageBuyPrice?.[viewerId], shares);
                  const monopoly = fullGroups.some((group) => group.zone === company.zone && group.sector === company.sector);
                  const sectorName = catalogName(game.sectors, company.sector);
                  const isSelected = selected?.id === company.id;
                  const origin = company.country || catalogName(game.zones, company.zone);
                  return (
                    <button
                      key={company.id}
                      type="button"
                      className={`td-row ${isSelected ? "selected" : ""} ${shares === 5 ? "has-control" : ""} ${monopoly ? "has-monopoly" : ""}`}
                      style={{ "--i": Math.min(index, 14) } as CSSProperties}
                      data-flash={flashes[company.id]}
                      aria-pressed={isSelected}
                      onClick={() => selectRow(company)}
                    >
                      <span className="td-name">
                        <Logo company={company} />
                        <span className="td-name-text">
                          <span className="td-name-line">
                            <b title={company.name}>{company.name}</b>
                            {shares === 5 && <Crown className="td-mark" size={13} strokeWidth={1.9} aria-label="Contrôle total · revenu minimum C/C" />}
                            {monopoly && <Network className="td-mark" size={13} strokeWidth={1.9} aria-label="Monopole · revenu minimum A/A" />}
                          </span>
                          <small title={[company.ticker, origin].filter(Boolean).join(" · ")}>{origin}</small>
                        </span>
                      </span>
                      <span className="td-sector" title={sectorName}><SectorName id={company.sector} name={sectorName} /></span>
                      <span className={`td-cap-category ${company.capCategory ?? "unknown"}`} title={capTitle(company.capCategory)}>
                        {company.capCategory && <i className="td-cap-gauge" aria-hidden="true"><i /><i /><i /></i>}
                        {company.capCategory?.toUpperCase() ?? "—"}
                      </span>
                      <span className="td-price"><b><AnimatedMoney value={amount(company.price)} /></b></span>
                      <span className={`td-profit-loss ${profitLoss == null ? "unknown" : profitLoss >= 0 ? "positive" : "negative"}`}>{profitLoss == null ? "—" : signedPercent(profitLoss)}</span>
                      <span className={`td-held ${shares ? "" : "is-empty"}`} title={`${shares} / 5 parts détenues`}>
                        <span className="sr-only">{shares} / 5</span>
                        <Pips value={shares} ghost={isSelected && previewShares != null ? previewShares - shares : 0} />
                      </span>
                      <span className="td-available"><b>{company.sharesAvailable}</b><small> / 5</small></span>
                    </button>
                  );
                })}
                {!companies.length && (
                  <p className="td-empty">
                    {search.trim() ? "Aucun résultat." : tab === "portfolio" ? "Aucune position." : "Aucune société dans cette zone."}
                  </p>
                )}
              </div>
            </div>
          </section>

          <aside className="td-card td-focus" aria-label="Fiche valeur">
            {selected ? (
              <>
                <div className="td-focus-summary" key={selected.id}>
                  <div className="td-identity">
                    <Logo company={selected} size="lg" />
                    <div className="td-identity-text">
                      <h2 title={selected.name}>{selected.name}</h2>
                      <p title={[catalogName(game.sectors, selected.sector), selected.country, catalogName(game.zones, selected.zone), selected.ticker].filter(Boolean).join(" · ")}>
                        <SectorIcon id={selected.sector} size={14} />
                        <span className="td-identity-sector">{splitName(catalogName(game.sectors, selected.sector)).head}</span>
                        {tab === "portfolio" && <>
                          <span data-testid="company-sector-grade"><GradeJewel grade={selectedSectorGrade} size="sm" label={`Secteur ${catalogName(game.sectors, selected.sector)}`} className="td-sector-grade" /></span>
                        </>}
                        {selected.country && <><i aria-hidden="true" /><span>{selected.country}</span></>}
                        {(tab === "portfolio" || selected.zone !== selectedZone) && <><i aria-hidden="true" /><span>{catalogName(game.zones, selected.zone)}</span>{tab === "portfolio" && <span data-testid="company-zone-grade"><GradeJewel grade={selectedZoneGrade} size="sm" label={`Zone ${catalogName(game.zones, selected.zone)}`} className="td-sector-grade" /></span>}</>}
                        {selected.ticker && <><i aria-hidden="true" /><span className="td-ticker">{selected.ticker}</span></>}
                      </p>
                    </div>
                    {(held >= 5 || selectedGroup?.complete) && (
                      <div className="td-badges">
                        {held >= 5 && <span className="td-badge" title="5/5 parts · revenu minimum C/C"><Crown size={13} strokeWidth={1.9} aria-hidden="true" />Contrôle C/C</span>}
                        {selectedGroup?.complete && (
                          <span className="td-badge is-monopoly" title={`Monopole ${catalogName(game.zones, selectedGroup.zone)} · ${catalogName(game.sectors, selectedGroup.sector)} · revenu minimum A/A`}>
                            <Network size={13} strokeWidth={1.9} aria-hidden="true" />Monopole A/A
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="td-quote">
                    <div>
                      <span className="td-label" title="Cours actuel d’une part">Cours</span>
                      <strong><AnimatedMoney value={amount(selected.price)} /></strong>
                      {historyChange != null && (
                        <span className="td-change" title={`Variation sur ${history.length} relevés`}>
                          <b className={tone(historyChange)}>{signedPercent(historyChange)}</b> depuis C{history[0]?.cycle}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="td-label" title="Prix de revient unitaire : prix moyen d’achat par part">PRU</span>
                      <strong className={average == null ? "unknown" : ""}>{average == null ? "—" : money(average)}</strong>
                    </div>
                    <div>
                      <span className="td-label" title="Plus ou moins-value latente par rapport au prix moyen d’achat">P/L</span>
                      <strong className={selectedProfitLoss == null ? "unknown" : selectedProfitLoss >= 0 ? "positive" : "negative"}>{selectedProfitLoss == null ? "—" : signedPercent(selectedProfitLoss)}</strong>
                    </div>
                    <div>
                      <span className="td-label" title="Parts détenues sur 5">Parts</span>
                      <strong>{held} / 5</strong>
                    </div>
                    <div>
                      <span className="td-label" title="Valorisation actuelle de cette participation">Valeur</span>
                      <strong><AnimatedMoney value={amount(selected.price) * held} /></strong>
                    </div>
                  </div>
                </div>
                {tab === "portfolio" && <div className="td-income-row">
                  <div className="td-income-copy">
                    <span className="td-label">Revenu par part</span>
                    <strong data-testid="company-income-per-share">{money(currentIncome)}</strong>
                    <small>à l’arrivée d’un autre fonds sur ce secteur, pas par cycle{viewer?.jailed ? " · détenu : revenu versé à la banque" : ""}</small>
                    {currentIncomeFloor !== "none" && <span className={`td-income-floor ${currentIncomeFloor}`}>
                      {currentIncomeFloor === "monopoly" ? "Plancher A/A · monopole" : "Plancher C/C · contrôle"}
                    </span>}
                  </div>
                  <button type="button" className="gf-btn gf-btn--quiet gf-btn--sm td-valuation-open" onClick={() => setValuationOpen(true)}>
                    Abaque prix/revenu
                  </button>
                </div>}
                <div className="td-focus-details">
                  <div className="td-chart-frame">
                    {history.length > 1 ? (
                      <EChart option={marketOption} label={`Historique de ${selected.name} : ${history.map((point) => `${point.tip}, ${money(point.value)}`).join("; ")}`} className="td-price-chart" />
                    ) : (
                      <div className="td-no-chart">{history.length === 1 ? `Premier relevé : ${money(history[0].value)}` : "Pas encore d’historique."}</div>
                    )}
                  </div>
                </div>
                <div className="td-focus-order">
                  <div className="td-ticket">
                    <div className="td-quantity" role="group" aria-label="Quantité">
                      <button type="button" aria-label="Réduire la quantité" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus size={16} strokeWidth={2} aria-hidden="true" /></button>
                      <span><b key={quantity}>{quantity}</b><small>{quantity > 1 ? "parts" : "part"}</small></span>
                      <button type="button" aria-label="Augmenter la quantité" disabled={quantity >= 5} onClick={() => setQuantity((value) => Math.min(5, value + 1))}><Plus size={16} strokeWidth={2} aria-hidden="true" /></button>
                    </div>
                    <button type="button" className="gf-btn gf-btn--primary td-trade-btn td-buy" aria-label="Acheter" disabled={buyDisabled} onClick={() => trade("BUY_SHARE")} {...previewOn("buy")}>
                      <span>Acheter</span><small>{money(buyTotal)}</small>
                    </button>
                    <button type="button" className="gf-btn gf-btn--ghost td-trade-btn td-sell" aria-label="Vendre" disabled={sellDisabled} onClick={() => trade("SELL_SHARE")} {...previewOn("sell")}>
                      <span>Vendre</span><small>{money(buyTotal)}</small>
                    </button>
                  </div>
                  {disabledReason && (
                    <p className="td-disabled-reason" role="status">
                      <Info size={14} strokeWidth={2} aria-hidden="true" />
                      <span>{game.phase === "geography" ? "Consultation libre pendant la décision de voyage." : disabledReason}</span>
                    </p>
                  )}
                  {canTrade && quantity > selected.sharesAvailable && (
                    <p className="td-disabled-reason is-warn" role="status">
                      <Info size={14} strokeWidth={2} aria-hidden="true" /><span>Seulement {selected.sharesAvailable} parts disponibles.</span>
                    </p>
                  )}
                  {canTrade && buyTotal > amount(viewer?.cash) && (
                    <p className="td-disabled-reason is-warn" role="status">
                      <Info size={14} strokeWidth={2} aria-hidden="true" /><span>Trésorerie insuffisante pour cet ordre.</span>
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="td-no-selection">
                <p>Aucune valeur sélectionnée.</p>
              </div>
            )}
          </aside>
        </div>
      )}
      {valuationOpen && selected && <CompanyValuationDialog
        company={selected}
        game={game}
        viewerId={viewerId}
        zoneGrade={selectedZoneGrade}
        sectorGrade={selectedSectorGrade}
        onClose={() => setValuationOpen(false)}
      />}
    </section>
  );
}

/**
 * Rows whose holdings just changed on the server get a one-off wash
 * (gold when shares arrive, red when they leave). Never driven by the click.
 */
function useHoldingFlashes(companies: Company[], viewerId: string) {
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});
  const snapshot = useRef<{ viewerId: string; held: Map<string, number> } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  useEffect(() => {
    const held = new Map(companies.map((company) => [company.id, holding(company, viewerId)]));
    const previous = snapshot.current;
    snapshot.current = { viewerId, held };
    if (!previous || previous.viewerId !== viewerId) return;
    const changed: Record<string, "up" | "down"> = {};
    held.forEach((value, id) => {
      const before = previous.held.get(id);
      if (before != null && before !== value) changed[id] = value > before ? "up" : "down";
    });
    const ids = Object.keys(changed);
    if (!ids.length) return;
    setFlashes((current) => ({ ...current, ...changed }));
    timers.current.push(window.setTimeout(() => setFlashes((current) => {
      const next = { ...current };
      ids.forEach((id) => { delete next[id]; });
      return next;
    }), 1150));
  }, [companies, viewerId]);
  return flashes;
}

/* ------------------------------------------------------------- views --- */

/**
 * Exposure ring. The centre names the leading slice; hovering a slice or a
 * legend row brings that slice to the centre instead.
 */
function DonutCard({ title, label, slices, reduced }: { title: string; label: string; slices: Slice[]; reduced: boolean }) {
  const chart = useRef<ECharts | null>(null);
  const latestSlices = useRef(slices);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => { latestSlices.current = slices; }, [slices]);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const active = slices.find((slice) => slice.id === activeId) ?? slices[0];
  const option = useMemo(() => donutOption(slices, reduced), [slices, reduced]);
  const onReady = useCallback((instance: ECharts | null) => {
    chart.current = instance;
    if (!instance) return;
    instance.on("mouseover", (params: { dataIndex?: number }) => setActiveId(latestSlices.current[params.dataIndex ?? -1]?.id ?? null));
    instance.on("mouseout", () => setActiveId(null));
  }, []);
  const focusSlice = (slice: Slice, on: boolean) => {
    chart.current?.dispatchAction({ type: on ? "highlight" : "downplay", seriesIndex: 0, name: slice.name });
    setActiveId(on ? slice.id : null);
  };
  return (
    <article className={`td-card td-donut-card ${slices.length > 5 ? "is-dense" : ""}`}>
      <header className="td-card-head"><h2>{title}</h2></header>
      {slices.length ? (
        <div className="td-donut-body">
          <div className="td-donut">
            <EChart option={option} label={`${label} : ${slices.map((slice) => `${slice.name} ${money(slice.value)}`).join(", ")}`} onReady={onReady} />
            {active && (
              <div className="td-donut-center" aria-hidden="true" key={active.id}>
                <strong>{share(active.value, total)}<small>%</small></strong>
                <span>{active.short}</span>
                <small className="td-donut-amount">{money(active.value)}</small>
              </div>
            )}
          </div>
          <ul className="td-legend">
            {slices.map((slice) => (
              <li
                key={slice.id}
                className={active?.id === slice.id ? "is-active" : undefined}
                tabIndex={0}
                title={`${slice.name} · ${money(slice.value)}`}
                onMouseEnter={() => focusSlice(slice, true)}
                onMouseLeave={() => focusSlice(slice, false)}
                onFocus={() => focusSlice(slice, true)}
                onBlur={() => focusSlice(slice, false)}
              >
                <i style={{ background: slice.color }} aria-hidden="true" />
                <span>{slice.short}</span>
                <b>{share(slice.value, total)} %</b>
                <small>{money(slice.value)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="td-empty">Aucune position à analyser.</p>
      )}
    </article>
  );
}

/**
 * Rating history as one ribbon per zone or sector: each run of identical grades
 * is a segment (same data as a line chart, readable at a glance).
 */
function RatingTimeline({ history, scope, items }: { history: HistoryPoint[]; scope: RatingScope; items: Catalog }) {
  const key = scope === "zone" ? "zoneGrades" : "sectorGrades";
  const count = history.length;
  const rows = items.map((item) => {
    const runs: { grade: Grade | null; start: number; end: number }[] = [];
    history.forEach((point, index) => {
      const grade = (point[key]?.[item.id] as Grade | undefined) ?? null;
      const run = runs.at(-1);
      if (run && run.grade === grade) run.end = index;
      else runs.push({ grade, start: index, end: index });
    });
    const known = runs.filter((run) => run.grade);
    return { item, runs, first: known[0]?.grade ?? null, last: known.at(-1)?.grade ?? null };
  });
  const summary = rows.map((row) => `${row.item.name} : ${row.first ?? "—"} → ${row.last ?? "—"}`).join(" ; ");
  const cycleLabel = (index: number) => `C${history[index]?.cycle ?? ""}`;
  return (
    <div className={`td-ratings is-${scope}`} role="img" aria-label={`Historique des notations par ${scope === "zone" ? "zone" : "secteur"} : ${summary}`}>
      <div className="td-ratings-grid">
        {rows.map(({ item, runs, last }) => (
          <div className="td-rating-row" key={item.id}>
            <span className="td-rating-name" title={item.name}>
              {scope === "sector" && <SectorIcon id={item.id} size={14} />}
              {scope === "zone" ? zoneShort(item.id, item.name) : splitName(item.name).head}
            </span>
            <span className="td-rating-track">
              {runs.filter((run) => run.grade).map((run) => (
                <i
                  key={run.start}
                  className={`g-${run.grade}`}
                  style={{ left: `${(run.start / count) * 100}%`, width: `${((run.end - run.start + 1) / count) * 100}%` }}
                  title={`${item.name} · ${run.grade} — ${GRADE_META[run.grade!].label} · ${cycleLabel(run.start)}${run.end > run.start ? ` → ${cycleLabel(run.end)}` : ""}`}
                >{(run.end - run.start + 1) / count >= 0.2 && <b>{run.grade}</b>}</i>
              ))}
            </span>
            {last ? <GradeJewel grade={last} size="sm" label={item.name} /> : <span />}
          </div>
        ))}
        <div className="td-rating-foot" aria-hidden="true">
          <span />
          <span className="td-rating-axis"><span>{cycleLabel(0)}</span><span>{cycleLabel(count - 1)}</span></span>
          <span />
        </div>
        <div className="td-rating-legend" aria-hidden="true">
          {GRADE_ORDER.map((grade) => <span key={grade}><i className={`g-${grade}`} />{grade}</span>)}
        </div>
      </div>
    </div>
  );
}
