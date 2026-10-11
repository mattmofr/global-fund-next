/**
 * Renders the figurine portraits used by the HTML interface (game/Pawn.tsx)
 * from the real 3D pieces, through the dev-only studio page
 * (apps/web/pawn-studio.html). A private Vite dev server is started on a free
 * port; nothing else is touched.
 *
 *   npx tsx scripts/redesign/render-pawns.ts
 *
 * Options
 *   --pieces=lion,bull   Pieces to render (default: all six).
 *   --size=512           Output size in px (rendered at 2x, then downsampled).
 *   --out=<dir>          Output directory (default: apps/web/public/assets/pawns/render).
 *   --shots=<list>       Extra review screenshots: sheet, review, globe, plane, turn-<piece>, hero-menu, hero-setup, hero-lobby
 *                        (any studio query can be appended after a colon, e.g. "globe:flight=europe-oceania").
 *   --shots-out=<dir>    Where review screenshots go (default: <os tmp>/gf-pawn-shots).
 *   --viewport=WxH       Viewport of the review screenshots (default 1600x900).
 *   --frames=N           Screenshots per shot (default 1), one every --every=ms (default 400): films an animation.
 *   --no-portraits       Only take the review screenshots.
 *   --swiftshader        Software WebGL instead of the hardware GPU.
 *   --cache=<name>       Private Vite dependency cache name.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createServer as createViteServer } from "vite";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key!, rest.length ? rest.join("=") : "true"] as const;
}));
const ROOT = resolve(import.meta.dirname, "../..");
const ALL = ["lion", "bull", "globe", "crystal", "tower", "leaf"];
const PIECES = (args.get("pieces") ?? ALL.join(",")).split(",").filter((piece) => ALL.includes(piece));
const SIZE = Number(args.get("size") ?? 512);
const OUT = resolve(args.get("out") ?? join(ROOT, "apps/web/public/assets/pawns/render"));
const SHOTS = (args.get("shots") ?? "").split(",").filter(Boolean);
const SHOTS_OUT = resolve(args.get("shots-out") ?? join(tmpdir(), "gf-pawn-shots"));
const [VW, VH] = (args.get("viewport") ?? "1600x900").split("x").map(Number) as [number, number];

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port"))));
    });
  });
}

async function waitReady(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => (window as unknown as { __pawnStudio?: { ready: boolean } }).__pawnStudio?.ready === true, undefined, { timeout, polling: 100 });
}

async function main() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const vite = await createViteServer({
    root: join(ROOT, "apps/web"),
    configFile: join(ROOT, "apps/web/vite.config.ts"),
    cacheDir: join(tmpdir(), `gf-vite-cache-${(args.get("cache") ?? "pawn-studio").replace(/[^\w-]/g, "")}`),
    logLevel: "error",
    clearScreen: false,
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
  });
  await vite.listen();
  const browser = await chromium.launch({
    headless: true,
    args: args.has("swiftshader") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
  });
  const errors: string[] = [];
  try {
    { // Warm Vite's dependency optimizer once.
      const warm = await browser.newPage();
      await warm.goto(`${origin}/pawn-studio.html?mode=review`, { waitUntil: "load", timeout: 120_000 }).catch(() => {});
      await warm.waitForTimeout(2500);
      await warm.close();
    }
    if (!args.has("no-portraits")) {
      await mkdir(OUT, { recursive: true });
      const render = SIZE * 2;
      for (const piece of PIECES) {
        const page = await browser.newPage({ viewport: { width: render, height: render }, deviceScaleFactor: 1 });
        page.on("pageerror", (error) => errors.push(`${piece}: ${error.message}`));
        page.on("console", (message) => { if (message.type() === "error") errors.push(`${piece}: ${message.text()}`); });
        await page.goto(`${origin}/pawn-studio.html?piece=${piece}&size=${render}`, { waitUntil: "load" });
        await waitReady(page);
        const dataUrl = await page.evaluate((size) => (window as unknown as { __pawnStudio: { capture: (size: number) => string } }).__pawnStudio.capture(size), SIZE);
        const file = join(OUT, `${piece}.png`);
        await writeFile(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
        console.log(`✓ ${piece} → ${file}`);
        await page.close();
      }
    }
    if (SHOTS.length) {
      await mkdir(SHOTS_OUT, { recursive: true });
      for (const shot of SHOTS) {
        const [name, extra] = shot.split(":");
        const query = name!.startsWith("turn-") ? `mode=turn&piece=${name!.slice(5)}`
          : name === "review" ? "mode=review"
          : name === "sheet" ? "mode=sheet"
          : name === "globe" ? "mode=globe"
          : name!.startsWith("hero-") ? `mode=hero&variant=${name!.slice(5)}`
          : `mode=${name}`;
        const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
        page.on("pageerror", (error) => errors.push(`${shot}: ${error.message}`));
        page.on("console", (message) => { if (message.type() === "error") errors.push(`${shot}: ${message.text()}`); });
        await page.goto(`${origin}/pawn-studio.html?${query}${extra ? `&${extra}` : ""}`, { waitUntil: "load" });
        await waitReady(page).catch(() => errors.push(`${shot}: never ready`));
        await page.waitForTimeout(Number(args.get("hold") ?? 600));
        const frames = Math.max(1, Number(args.get("frames") ?? 1));
        const every = Number(args.get("every") ?? 400);
        const started = Date.now();
        for (let frame = 0; frame < frames; frame++) {
          if (frame) await page.waitForTimeout(Math.max(0, started + frame * every - Date.now()));
          const suffix = frames > 1 ? `-${String(frame).padStart(2, "0")}` : "";
          const file = join(SHOTS_OUT, `${shot.replace(/[^\w-]+/g, "_")}${suffix}.png`);
          await page.screenshot({ path: file, fullPage: name === "review" });
          console.log(`✓ shot ${shot}${suffix} → ${file}`);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await vite.close();
  }
  if (errors.length) console.log(`Console errors:\n  ${errors.join("\n  ")}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
