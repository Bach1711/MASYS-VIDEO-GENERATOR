import type { Hono } from "hono";
import type { Child } from "hono/jsx";
import { checkServiceAccount, type AppConfig, type ServiceAccountCredentials } from "../config.js";
import type { DB } from "../db/index.js";
import { activeBatch } from "../db/history.js";
import { minimalKeyJson, type KeyStore } from "../keyStore.js";
import { logger } from "../logger.js";
import type { BatchRunner } from "../queue/runner.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";

// Trang Cài khoá Google (D15): lần đầu mở bản zip, hoặc "Đổi file khoá" ở Cài đặt.
// Khoá chỉ đi từ form vào bộ nhớ rồi được mã hoá DPAPI; không ghi ra log, SQLite hay thư mục tool.

const MAX_KEY_BYTES = 64 * 1024;

export interface SetupDeps {
  config: AppConfig;
  db: DB;
  keyStore?: KeyStore;
  runner?: BatchRunner;
  /** Thử lấy access token để chắc khoá còn dùng được trước khi lưu. */
  verifyKey?: (credentials: ServiceAccountCredentials) => Promise<void>;
  /** Khởi động lại tool để nạp khoá mới; undefined khi không chạy qua Mo-MASYS.bat. */
  restart?: () => void;
}

/** Bản zip chưa có khoá thì mọi trang dẫn về /setup. Máy phát triển (biến môi trường) thì không. */
export function needsKeySetup(config: AppConfig) {
  return !config.serviceAccount.ok && config.keySource !== "env";
}

export function registerSetupRoutes(app: Hono, deps: SetupDeps) {
  const { config, db, keyStore, runner } = deps;
  const page = (body: Child, status: 200 | 400 | 409 | 500 = 200) => ({
    html: "<!doctype html>" + <Layout title="Cài khoá Google">{body}</Layout>,
    status,
  });

  function busy(): string | undefined {
    const running = runner?.runningBatchId ?? (activeBatch(db)?.status === "running" ? activeBatch(db)?.id : undefined);
    return running !== undefined ? `Lô #${running} đang chạy. Tạm dừng hoặc đợi lô chạy xong rồi mới đổi khoá.` : undefined;
  }

  function render(notice?: Child) {
    const sa = config.serviceAccount;
    const envKey = config.keySource === "env";
    const blocked = busy();
    return (
      <>
        <h1>Cài khoá Google</h1>
        {notice}
        <section class="card">
          <p>
            Tool đọc Google Sheet và kiểm tra Drive bằng một <strong>khoá service account</strong> (file <code>.json</code>). Người phụ trách gửi
            riêng file này cho bạn. Chọn file một lần; tool mã hoá và cất khoá trong máy, chỉ tài khoản Windows này mở được.
          </p>
          {sa.ok ? (
            <p>
              Đang dùng khoá: <code>{sa.clientEmail}</code>{" "}
              <span class="muted">({envKey ? "từ biến môi trường, chạy qua op run" : "đã lưu trong máy"})</span>
            </p>
          ) : (
            <Alert kind="warn">{sa.problem}</Alert>
          )}
        </section>
        {envKey ? (
          <section class="card">
            <p class="muted">
              Máy này đang chạy tool qua <code>op run</code> nên luôn dùng khoá trong biến môi trường <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>. Đổi
              khoá trong 1Password rồi chạy lại tool.
            </p>
          </section>
        ) : (
          <section class="card">
            <h2>{sa.ok ? "Đổi file khoá" : "Chọn file khoá"}</h2>
            {blocked && <Alert kind="warn">{blocked}</Alert>}
            <form method="post" action="/setup/key" enctype="multipart/form-data" class="row">
              <input type="file" name="key" accept=".json,application/json" required />
              <button type="submit" disabled={!!blocked}>
                Lưu khoá
              </button>
            </form>
            <p class="muted small">Sau khi lưu, tool tự khởi động lại trong vài giây.</p>
          </section>
        )}
      </>
    );
  }

  app.get("/setup", (c) => {
    const p = page(render());
    return c.html(p.html, p.status);
  });

  app.post("/setup/key", async (c) => {
    const fail = (msg: string, status: 400 | 409 | 500 = 400) => {
      const p = page(render(<Alert kind="warn">{msg}</Alert>), status);
      return c.html(p.html, p.status);
    };
    if (config.keySource === "env") return fail("Máy này dùng khoá trong biến môi trường (op run); không lưu khoá từ file.", 409);
    if (!keyStore) return fail("Tool chưa sẵn sàng lưu khoá.", 500);
    const blocked = busy();
    if (blocked) return fail(blocked, 409);

    const body = await c.req.parseBody();
    const file = body.key;
    if (!(file instanceof File) || file.size === 0) return fail("Chưa chọn file khoá.");
    if (file.size > MAX_KEY_BYTES) return fail("File quá lớn, không phải file khoá service account.");
    const raw = await file.text();
    const status = checkServiceAccount(raw, "file");
    if (!status.ok) return fail(status.problem);

    if (deps.verifyKey) {
      try {
        await deps.verifyKey(status.credentials);
      } catch {
        return fail(
          "Google không chấp nhận khoá này (có thể khoá đã bị xoá hoặc thu hồi), hoặc máy đang mất mạng. Kiểm tra mạng, hoặc xin người phụ trách file khoá mới.",
        );
      }
    }

    try {
      await keyStore.save(minimalKeyJson(raw));
    } catch (e) {
      logger.warn({ err: e }, "Không lưu được khoá Google");
      return fail("Không mã hoá và lưu được khoá trên máy này.", 500);
    }
    logger.info({ clientEmail: status.clientEmail }, "Đã lưu khoá Google (DPAPI)");

    if (deps.restart) {
      deps.restart();
      return c.html(
        "<!doctype html>" +
          (
            <Layout title="Đang khởi động lại">
              {/* Đợi tiến trình cũ tắt rồi hỏi /health tới khi tool mới lên. */}
              <script
                dangerouslySetInnerHTML={{
                  __html: "setTimeout(function p(){fetch('/health').then(function(r){r.ok?location.href='/':setTimeout(p,1000)},function(){setTimeout(p,1000)})},2500)",
                }}
              />
              <Alert kind="ok">
                Đã lưu khoá cho <code>{status.clientEmail}</code>. Tool đang khởi động lại để dùng khoá mới, trang sẽ tự mở lại sau vài giây.
              </Alert>
            </Layout>
          ),
      );
    }
    const p = page(
      render(
        <Alert kind="ok">
          Đã lưu khoá cho <code>{status.clientEmail}</code>. Tắt tool rồi mở lại để dùng khoá mới.
        </Alert>,
      ),
    );
    return c.html(p.html, p.status);
  });
}
