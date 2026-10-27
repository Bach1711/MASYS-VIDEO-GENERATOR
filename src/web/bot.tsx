import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import type { Child } from "hono/jsx";
import { listQueuedRuns, manualSend } from "../bot/manualSend.js";
import { STATE_TEXT, type CheckResult, type MuseBot } from "../bot/museBot.js";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { listSheetConfigs, sheetName } from "../db/sheetConfigs.js";
import { logger } from "../logger.js";
import type { BatchRunner } from "../queue/runner.js";
import { Alert, QuotaBox, truncate } from "./components.js";
import { Layout } from "./layout.js";

export interface BotDeps {
  config: AppConfig;
  db: DB;
  bot?: MuseBot;
  runner?: BatchRunner;
  screenshotDir: string;
}

const SHOT_NAME = /^[0-9TZ-]+-[a-z_]+\.png$/;

export function registerBotRoutes(app: Hono, deps: BotDeps) {
  const { db, bot, runner, screenshotDir } = deps;
  let lastCheck: (CheckResult & { at: Date }) | undefined;
  const page = (body: Child) => "<!doctype html>" + <Layout title="Bot Muse">{body}</Layout>;

  function render(notice?: Child) {
    const quota = getDailyQuota(db);
    const runs = listQueuedRuns(db);
    const names = new Map(listSheetConfigs(db).map((c) => [c.spreadsheetId, sheetName(c)]));
    const events = db
      .prepare(
        `SELECT e.at, e.runId, r.rowNumber, e.toState, e.message, e.screenshotPath FROM run_events e JOIN runs r ON r.id = e.runId
         WHERE e.message NOT LIKE 'Tạo lô%' ORDER BY e.id DESC LIMIT 10`,
      )
      .all() as { at: string; runId: number; rowNumber: number; toState: string; message: string; screenshotPath: string | null }[];
    const shot = (p?: string | null) =>
      p && (
        <a href={`/bot/screenshot/${encodeURIComponent(path.basename(p))}`} target="_blank" rel="noreferrer">
          xem ảnh chụp
        </a>
      );
    const open = !!bot?.isOpen;
    return page(
      <>
        <h1>Bot Muse</h1>
        {!bot && <Alert kind="warn">Bot chưa sẵn sàng trong lần chạy này.</Alert>}
        {notice}
        <section class="card">
          <h2>Trình duyệt bot</h2>
          <p class="muted">
            Bot dùng một cửa sổ Chrome riêng, tách khỏi Chrome bạn đang dùng. Lần đầu, bấm <strong>Mở trình duyệt bot</strong> rồi{" "}
            <strong>tự đăng nhập Muse</strong> trong cửa sổ đó. Bot không bao giờ gõ mật khẩu và không tự vượt captcha hay mã xác nhận. Những lần
            sau, Chrome bot tự nhớ đăng nhập.
          </p>
          <p>
            Trình duyệt bot: <strong>{open ? "đang mở" : "đang tắt"}</strong>
            {lastCheck && (
              <>
                {" "}
                · Lần kiểm tra cuối ({lastCheck.at.toLocaleTimeString("vi-VN")}):{" "}
                <span class={`badge ${lastCheck.state === "ready" ? "b-ready" : "b-running"}`}>{STATE_TEXT[lastCheck.state]}</span>{" "}
                {shot(lastCheck.screenshot)}
              </>
            )}
          </p>
          <div class="row">
            <form method="post" action="/bot/open">
              <button type="submit">Mở trình duyệt bot</button>
            </form>
            <form method="post" action="/bot/check">
              <button type="submit" class="secondary">
                Kiểm tra trạng thái
              </button>
            </form>
            {open && (
              <form method="post" action="/bot/close">
                <button type="submit" class="secondary">
                  Đóng trình duyệt bot
                </button>
              </form>
            )}
          </div>
        </section>

        <section class="card">
          <h2>Gửi thử một dòng</h2>
          <p class="muted">
            Gửi thật cho Muse yêu cầu của <strong>một</strong> dòng đang Chờ chạy (tốn 1 video, tính vào giới hạn ngày). Gửi xong, dòng chuyển sang
            "Cần xem" và tool không theo dõi ô Video (muốn tool tự theo dõi và ghi ô Trạng thái thì chạy cả lô ở trang Lô). Lỗi xảy ra sau khi đã bấm Gửi thì không tự gửi lại.
          </p>
          <QuotaBox quota={quota} />
          {runs.length === 0 ? (
            <p class="muted">
              Chưa có dòng nào Chờ chạy. Tạo lô ở <a href="/scan">Quét và chọn dòng</a>.
            </p>
          ) : (
            <form method="post" action="/bot/send" class="row" onsubmit="return confirm('Gửi thật yêu cầu này cho Muse? Tốn 1 video.')">
              <select name="runId" aria-label="Chọn dòng gửi thử">
                {runs.map((r) => (
                  <option value={String(r.id)}>
                    Lô #{r.batchId} · {names.get(r.spreadsheetId) ?? r.spreadsheetId} → {r.tab} · dòng {r.rowNumber} · {truncate(r.promptSent, 50)}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!open || quota.remaining <= 0}>
                Gửi thử cho Muse
              </button>
            </form>
          )}
          {!open && runs.length > 0 && <p class="muted small">Mở trình duyệt bot trước khi gửi.</p>}
        </section>

        {events.length > 0 && (
          <section class="card">
            <h2>Nhật ký bot gần đây</h2>
            <p class="muted small">
              Xem đầy đủ ở <a href="/logs?all=1">Nhật ký</a>.
            </p>
            <table>
              <tbody>
                {events.map((e) => (
                  <tr>
                    <td class="small">{new Date(e.at).toLocaleString("vi-VN")}</td>
                    <td>Dòng {e.rowNumber}</td>
                    <td>
                      {e.message} {shot(e.screenshotPath)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </>,
    );
  }

  app.get("/bot", (c) => c.html(render()));

  app.post("/bot/open", async (c) => {
    if (!bot) return c.html(render(), 503);
    try {
      await bot.open();
      return c.redirect("/bot", 303);
    } catch (e) {
      logger.warn({ err: e }, "Không mở được trình duyệt bot");
      return c.html(render(<Alert kind="warn">Không mở được Chrome. Kiểm tra máy đã cài Google Chrome.</Alert>), 500);
    }
  });

  app.post("/bot/check", async (c) => {
    if (!bot) return c.html(render(), 503);
    lastCheck = { ...(await bot.check()), at: new Date() };
    logger.info({ state: lastCheck.state, url: lastCheck.url }, "Kiểm tra trang Muse");
    return c.redirect("/bot", 303);
  });

  app.post("/bot/close", async (c) => {
    await bot?.close();
    lastCheck = undefined;
    return c.redirect("/bot", 303);
  });

  app.post("/bot/send", async (c) => {
    if (!bot) return c.html(render(), 503);
    const runId = Number((await c.req.parseBody()).runId);
    if (!Number.isInteger(runId)) return c.html(render(<Alert kind="warn">Chưa chọn dòng.</Alert>), 400);
    if (runner?.runningBatchId !== undefined) {
      return c.html(render(<Alert kind="warn">Lô #{runner.runningBatchId} đang chạy; không gửi thử để giữ đúng thứ tự từng dòng (D7).</Alert>), 409);
    }
    const r = await manualSend(db, bot, runId);
    lastCheck = undefined;
    if (r.ok) {
      return c.html(
        render(
          <Alert kind="ok">
            Đã gửi cho Muse.{" "}
            <a href={r.chatUrl} target="_blank" rel="noreferrer">
              Mở cuộc trò chuyện ↗
            </a>{" "}
            · Muse sẽ tự lưu video lên Drive và dán link vào ô Video; bạn xem kết quả trong sheet.
          </Alert>,
        ),
      );
    }
    return c.html(
      render(
        <Alert kind="warn">
          {r.sent ? "Đã bấm Gửi nhưng có vấn đề: " : "Chưa gửi: "}
          {r.message}.{" "}
          {r.sent ? "Dòng chuyển sang Cần xem, không tự gửi lại; mở cửa sổ bot để xem Muse đã nhận chưa." : "Dòng vẫn Chờ chạy."}
        </Alert>,
      ),
      r.sent ? 200 : 409,
    );
  });

  app.get("/bot/screenshot/:name", (c) => {
    const name = c.req.param("name");
    if (!SHOT_NAME.test(name)) return c.notFound();
    const file = path.join(screenshotDir, name);
    if (!fs.existsSync(file)) return c.notFound();
    return c.body(fs.readFileSync(file), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" });
  });
}
