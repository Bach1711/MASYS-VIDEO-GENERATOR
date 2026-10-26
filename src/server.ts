import { serve } from "@hono/node-server";
import { HOST, loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { serviceAccountTokenProvider } from "./google/auth.js";
import { createGoogleHttp } from "./google/http.js";
import { SheetsClient } from "./google/sheets.js";
import { logger } from "./logger.js";
import { createApp } from "./web/app.js";

const config = loadConfig();

if (config.serviceAccount.ok) {
  logger.info({ clientEmail: config.serviceAccount.clientEmail }, "Đã nạp khoá service account");
} else {
  // Không crash: tool vẫn mở được giao diện để hiện hướng dẫn.
  logger.warn(config.serviceAccount.problem);
}

const db = openDatabase(config.dbPath);
logger.info({ dataDir: config.dataDir }, "Đã mở cơ sở dữ liệu");

const sheets = config.serviceAccount.ok
  ? new SheetsClient(createGoogleHttp(serviceAccountTokenProvider(config.serviceAccount.credentials)))
  : undefined;

const app = createApp(config, db, { sheets });
const server = serve({ fetch: app.fetch, hostname: HOST, port: config.port }, (info) => {
  logger.info(`Tool đang chạy tại http://localhost:${info.port}`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
