import { createServer } from "./server.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
try {
  process.loadEnvFile(resolve(projectRoot, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const configuredStorage = process.env.STORAGE_FILE;
const service = await createServer({
  logger: true,
  ...(configuredStorage === "false"
    ? { storageFile: false }
    : configuredStorage
      ? { storageFile: configuredStorage }
      : {}),
});
const port = Number(process.env.PORT ?? 3102);
const host = process.env.HOST ?? "127.0.0.1";
await service.app.listen({ host, port });
console.info(`Global Fund Evolve server listening on http://${host}:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void service.close();
  });
