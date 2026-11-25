import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import type { Child } from "hono/jsx";
import { listQueuedRuns, manualSend } from "../bot/manualSend.js";
import { STATE_TEXT, type CheckResult, type MuseBot } from "../bot/museBot.js";
import type { AppConfig } from "../config.js";
import {
  addMuseAccount,
  deleteMuseAccount,
  getActiveMuseAccount,
  listMuseAccounts,
  renameMuseAccount,
  setAccountQuotaExhausted,
  setAccountStreams,
  setActiveMuseAccount,
  type MuseAccount,
} from "../db/accounts.js";
import { activeBatch } from "../db/history.js";
import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { getSettings, MAX_TOTAL_PARALLEL, rememberMuseCheck, setAccountPoolSettings, setHideBotWindow, setMuseReady } from "../db/settings.js";
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
  /** Kiểm tra máy đã cài Chrome; false thì báo cần cài. */
  chromeInstalled?: () => boolean | undefined;
}

const SHOT_NAME = /^[0-9TZ-]+-[a-z_]+\.png$/;

function accountBadge(acc: MuseAccount, isActive: boolean) {
  if (acc.quotaExhaustedAt) {
    return (
      <span class="badge b-missing_data" title={`Báo hết lượt lúc ${new Date(acc.quotaExhaustedAt).toLocaleString("vi-VN")}`}>
        Hết token
      </span>
    );
  }
  if (acc.readyAt) {
    return (
      <span class="badge b-ready" title={`Đã đăng nhập (kiểm tra lúc ${new Date(acc.readyAt).toLocaleString("vi-VN")})`}>
        {isActive ? "Đang dùng · Sẵn sàng" : "Sẵn sàng"}
      </span>
    );
  }
  return <span class={`badge ${isActive ? "b-running" : ""}`}>{isActive ? "Đang dùng · Cần đăng nhập" : "Cần đăng nhập"}</span>;
}

export function registerBotRoutes(app: Hono, deps: BotDeps) {
  const { db, bot, runner, screenshotDir } = deps;
  let lastCheck: (CheckResult & { at: Date }) | undefined;
  const page = (body: Child) => "<!doctype html>" + <Layout title="Bot Muse">{body}</Layout>;

  /** Đang có lô chạy hoặc còn dòng đang chờ Muse thì khoá đổi/xoá tài khoản bằng tay. */
  function lockReason(): string | undefined {
    if (runner?.runningBatchId !== undefined) return `Lô #${runner.runningBatchId} đang chạy; tạm dừng hoặc đợi xong rồi mới đổi tài khoản.`;
    const b = activeBatch(db);
    if (b?.status === "running") return `Lô #${b.id} đang chạy; tạm dừng hoặc đợi xong rồi mới đổi tài khoản.`;
    return undefined;
  }

  function render(notice?: Child) {
    const quota = getDailyQuota(db);
    const runs = listQueuedRuns(db);
    const accounts = listMuseAccounts(db);
    const activeAcc = getActiveMuseAccount(db);
    const locked = lockReason();
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
        {deps.chromeInstalled?.() === false && (
          <Alert kind="warn">
            <strong>Máy chưa cài Google Chrome.</strong> Bot cần Chrome để điều khiển Muse. Tải và cài Chrome tại{" "}
            <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
              google.com/chrome
            </a>
            , rồi tắt và mở lại tool.
          </Alert>
        )}
        {notice}

        <section class="card">
          <h2>Tài khoản Muse (Multi-Profile)</h2>
          <p class="muted">
            Mỗi tài khoản dùng một hồ sơ Chrome riêng biệt (tự giữ phiên đăng nhập và cookie riêng). Thêm tài khoản mới rồi bấm{" "}
            <strong>Mở trình duyệt</strong> để tự đăng nhập Muse một lần cho tài khoản đó.
          </p>
          <form method="post" action="/bot/accounts/pool-mode" class="row" style="margin:12px 0;align-items:center">
            <label for="totalParallelLimit" class="inline-label">
              Tổng luồng tối đa
            </label>
            <input
              id="totalParallelLimit"
              type="number"
              name="totalParallelLimit"
              min="1"
              max={String(MAX_TOTAL_PARALLEL)}
              value={String(getSettings(db).totalParallelLimit ?? 20)}
              style="width:70px;flex:none"
              aria-label="Tổng luồng tối đa"
            />
            <label class="inline" style="margin-left:8px">
              <input
                type="radio"
                name="accountMode"
                value="round_robin"
                checked={getSettings(db).accountMode === "round_robin"}
              />{" "}
              <strong>Luân phiên</strong> (chạy đồng thời mọi tài khoản sẵn sàng)
            </label>
            <label class="inline">
              <input
                type="radio"
                name="accountMode"
                value="sequential"
                checked={getSettings(db).accountMode !== "round_robin"}
              />{" "}
              <strong>Lần lượt</strong> (hết token tài khoản này mới sang tài khoản kế tiếp)
            </label>
            <button type="submit" class="secondary small">
              Lưu chế độ chạy
            </button>
          </form>
          {locked && <p class="small warn-text">{locked}</p>}
          <div class="scroll">
            <table class="scan">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên tài khoản</th>
                  <th>Luồng (Ảnh / Video)</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => {
                  const isActive = acc.id === activeAcc.id;
                  return (
                    <tr data-account={acc.id} class={isActive ? "live" : undefined}>
                      <td>{acc.id}</td>
                      <td>
                        <strong>{acc.name}</strong>
                        {isActive && <span class="muted small"> (đang chọn)</span>}
                      </td>
                      <td>
                        <form method="post" action="/bot/accounts/streams" class="row" style="align-items:center;flex-wrap:nowrap">
                          <input type="hidden" name="id" value={String(acc.id)} />
                          <span class="small muted" title="Số luồng ảnh tối đa của tài khoản này">🖼</span>
                          <input
                            type="number"
                            name="maxImageStreams"
                            min="1"
                            max="6"
                            value={String(acc.maxImageStreams ?? 2)}
                            style="width:52px;padding:3px 6px;flex:none"
                            aria-label={`Số luồng ảnh của ${acc.name}`}
                            onchange="this.form.submit()"
                          />
                          <span class="small muted" title="Số luồng video tối đa của tài khoản này">🎬</span>
                          <input
                            type="number"
                            name="maxVideoStreams"
                            min="1"
                            max="6"
                            value={String(acc.maxVideoStreams ?? 3)}
                            style="width:52px;padding:3px 6px;flex:none"
                            aria-label={`Số luồng video của ${acc.name}`}
                            onchange="this.form.submit()"
                          />
                        </form>
                      </td>
                      <td>{accountBadge(acc, isActive)}</td>
                      <td>
                        <div class="row" style="align-items:center">
                          {!isActive && (
                            <form method="post" action="/bot/accounts/select">
                              <input type="hidden" name="id" value={String(acc.id)} />
                              <button type="submit" class="small" disabled={!!locked}>
                                Dùng tài khoản này
                              </button>
                            </form>
                          )}
                          <form method="post" action="/bot/accounts/open">
                            <input type="hidden" name="id" value={String(acc.id)} />
                            <button type="submit" class="secondary small" disabled={!!locked && !isActive}>
                              {isActive && open ? "Đưa cửa sổ lên" : "Mở trình duyệt"}
                            </button>
                          </form>
                          {acc.quotaExhaustedAt && (
                            <form method="post" action="/bot/accounts/reset-quota">
                              <input type="hidden" name="id" value={String(acc.id)} />
                              <button type="submit" class="secondary small" title="Bấm khi tài khoản này đã có token trở lại">
                                Đặt lại hết lượt
                              </button>
                            </form>
                          )}
                          <details style="display:inline-block">
                            <summary class="small" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card)">
                              Sửa
                            </summary>
                            <div class="row" style="margin-top:6px;align-items:center">
                              <form method="post" action="/bot/accounts/rename" class="row" style="align-items:center">
                                <input type="hidden" name="id" value={String(acc.id)} />
                                <input type="text" name="name" value={acc.name} required maxlength={60} aria-label={`Tên mới cho ${acc.name}`} style="width:160px;flex:none" />
                                <button type="submit" class="secondary small">
                                  Lưu tên
                                </button>
                              </form>
                              {accounts.length > 1 && (
                                <form
                                  method="post"
                                  action="/bot/accounts/delete"
                                  onsubmit={`return confirm('Xoá tài khoản "${acc.name.replace(/'/g, "")}" khỏi danh sách?')`}
                                >
                                  <input type="hidden" name="id" value={String(acc.id)} />
                                  <button type="submit" class="danger small" disabled={!!locked}>
                                    Xoá
                                  </button>
                                </form>
                              )}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <form method="post" action="/bot/accounts/add" class="row" style="margin-top:12px;align-items:center">
            <input
              type="text"
              name="name"
              required
              maxlength={60}
              placeholder={`Tên tài khoản mới (ví dụ: Tài khoản ${accounts.length + 1})`}
              aria-label="Tên tài khoản Muse mới"
            />
            <button type="submit">+ Thêm tài khoản Muse</button>
          </form>
        </section>

        <section class="card">
          <h2>Trình duyệt bot ({activeAcc.name})</h2>
          <p class="muted">
            Bot dùng một cửa sổ Chrome riêng, tách khỏi Chrome bạn đang dùng. Lần đầu, bấm <strong>Mở trình duyệt bot</strong> rồi{" "}
            <strong>tự đăng nhập Muse</strong> trong cửa sổ đó. Bot không bao giờ gõ mật khẩu và không tự vượt captcha hay mã xác nhận. Những lần
            sau, Chrome bot tự nhớ đăng nhập.
          </p>
          <p>
            Tài khoản đang chọn: <strong>{activeAcc.name}</strong> · Trình duyệt bot: <strong>{open ? "đang mở" : "đang tắt"}</strong>
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
          <form method="post" action="/bot/hide-window" class="row" style="margin-top:12px;align-items:center">
            <input type="hidden" name="hide" value={getSettings(db).hideBotWindow ? "0" : "1"} />
            <label class="inline">
              <input
                type="checkbox"
                checked={getSettings(db).hideBotWindow === 1}
                onchange="this.form.submit()"
              />{" "}
              Tự thu nhỏ (ẩn) cửa sổ Chrome xuống thanh Taskbar khi chạy lô tự động (chỉ hiện lên khi cần đăng nhập hoặc bấm Mở trình duyệt)
            </label>
          </form>
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

  app.get("/bot", (c) => {
    const ok = c.req.query("ok");
    const err = c.req.query("loi");
    return c.html(render(ok ? <Alert kind="ok">{ok}</Alert> : err ? <Alert kind="warn">{err}</Alert> : undefined));
  });

  app.post("/bot/accounts/add", async (c) => {
    const body = await c.req.parseBody();
    const r = addMuseAccount(db, String(body.name ?? ""));
    if (!r.ok) return c.html(render(<Alert kind="warn">{r.message}</Alert>), 400);
    logger.info({ accountId: r.account.id, name: r.account.name }, "Đã thêm tài khoản Muse");
    return c.redirect(`/bot?ok=${encodeURIComponent(`Đã thêm tài khoản "${r.account.name}". Bấm Mở trình duyệt để đăng nhập Muse.`)}`, 303);
  });

  app.post("/bot/accounts/select", async (c) => {
    const blocked = lockReason();
    if (blocked) return c.html(render(<Alert kind="warn">{blocked}</Alert>), 409);
    const id = Number((await c.req.parseBody()).id);
    const current = getActiveMuseAccount(db);
    const r = setActiveMuseAccount(db, id);
    if (!r.ok) return c.html(render(<Alert kind="warn">{r.message}</Alert>), 400);
    if (current.id !== r.account.id) {
      await bot?.close();
      lastCheck = undefined;
    }
    logger.info({ accountId: r.account.id, name: r.account.name }, "Đã chuyển tài khoản Muse");
    return c.redirect(`/bot?ok=${encodeURIComponent(`Đã chuyển sang dùng "${r.account.name}".`)}`, 303);
  });

  app.post("/bot/accounts/open", async (c) => {
    if (!bot) return c.html(render(), 503);
    const id = Number((await c.req.parseBody()).id);
    const current = getActiveMuseAccount(db);
    if (id !== current.id) {
      const blocked = lockReason();
      if (blocked) return c.html(render(<Alert kind="warn">{blocked}</Alert>), 409);
      const r = setActiveMuseAccount(db, id);
      if (!r.ok) return c.html(render(<Alert kind="warn">{r.message}</Alert>), 400);
      await bot.close();
      lastCheck = undefined;
    }
    try {
      await bot.open();
      return c.redirect(`/bot?ok=${encodeURIComponent(`Đã mở trình duyệt cho "${getActiveMuseAccount(db).name}".`)}`, 303);
    } catch (e) {
      logger.warn({ err: e }, "Không mở được trình duyệt bot");
      return c.html(render(<Alert kind="warn">Không mở được Chrome. Kiểm tra máy đã cài Google Chrome.</Alert>), 500);
    }
  });

  app.post("/bot/accounts/rename", async (c) => {
    const body = await c.req.parseBody();
    const r = renameMuseAccount(db, Number(body.id), String(body.name ?? ""));
    if (!r.ok) return c.html(render(<Alert kind="warn">{r.message}</Alert>), 400);
    logger.info({ accountId: r.account.id, name: r.account.name }, "Đã đổi tên tài khoản Muse");
    return c.redirect(`/bot?ok=${encodeURIComponent(`Đã đổi tên thành "${r.account.name}".`)}`, 303);
  });

  app.post("/bot/accounts/reset-quota", async (c) => {
    const id = Number((await c.req.parseBody()).id);
    setAccountQuotaExhausted(db, null, id);
    return c.redirect(`/bot?ok=${encodeURIComponent("Đã đặt lại trạng thái hết token.")}`, 303);
  });

  app.post("/bot/accounts/pool-mode", async (c) => {
    const body = await c.req.parseBody();
    const mode = body.accountMode === "round_robin" ? "round_robin" : "sequential";
    const total = Number(body.totalParallelLimit);
    setAccountPoolSettings(db, mode, total);
    logger.info({ mode, total }, "Đã lưu chế độ chạy nhiều tài khoản Muse");
    return c.redirect(
      `/bot?ok=${encodeURIComponent(`Đã lưu chế độ chạy: ${mode === "round_robin" ? "Luân phiên nhiều tài khoản cùng lúc" : "Lần lượt từng tài khoản"} (tổng luồng tối đa ${getSettings(db).totalParallelLimit}).`)}`,
      303,
    );
  });

  app.post("/bot/accounts/streams", async (c) => {
    const body = await c.req.parseBody();
    const r = setAccountStreams(db, Number(body.id), Number(body.maxVideoStreams), Number(body.maxImageStreams));
    if (!r.ok) return c.html(render(<Alert kind="warn">{r.message}</Alert>), 400);
    return c.redirect(`/bot?ok=${encodeURIComponent(`Đã cập nhật số luồng cho "${r.account.name}" (${r.account.maxImageStreams} ảnh / ${r.account.maxVideoStreams} video).`)}`, 303);
  });

  app.post("/bot/accounts/delete", async (c) => {
    const blocked = lockReason();
    if (blocked) return c.html(render(<Alert kind="warn">{blocked}</Alert>), 409);
    const id = Number((await c.req.parseBody()).id);
    const r = deleteMuseAccount(db, id);
    if (!r.ok) return c.html(render(<Alert kind="warn">{r.message}</Alert>), 400);
    if (r.switchedTo) {
      await bot?.close();
      lastCheck = undefined;
    }
    logger.info({ accountId: id, name: r.removed.name, switchedTo: r.switchedTo?.id }, "Đã xoá tài khoản Muse");
    return c.redirect(
      `/bot?ok=${encodeURIComponent(`Đã xoá "${r.removed.name}"${r.switchedTo ? `, chuyển sang "${r.switchedTo.name}".` : "."}`)}`,
      303,
    );
  });

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
    rememberMuseCheck(db, lastCheck.state);
    if (lastCheck.state === "ready") setAccountQuotaExhausted(db, null);
    logger.info({ state: lastCheck.state, url: lastCheck.url, account: getActiveMuseAccount(db).name }, "Kiểm tra trang Muse");
    return c.redirect("/bot", 303);
  });

  app.post("/bot/close", async (c) => {
    await bot?.close();
    lastCheck = undefined;
    return c.redirect("/bot", 303);
  });

  app.post("/bot/hide-window", async (c) => {
    const hide = (await c.req.parseBody()).hide === "1";
    setHideBotWindow(db, hide);
    if (hide) await bot?.minimizeWindow();
    else await bot?.bringToFront();
    return c.redirect(`/bot?ok=${encodeURIComponent(hide ? "Đã bật tự thu nhỏ cửa sổ Chrome khi chạy lô." : "Đã tắt tự thu nhỏ cửa sổ Chrome.")}`, 303);
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
      setMuseReady(db, new Date().toISOString());
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
