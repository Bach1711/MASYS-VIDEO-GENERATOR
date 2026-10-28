import type { Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import type { MuseBot } from "../bot/museBot.js";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import { getSettings, rememberMuseCheck, setDriveRootFolder } from "../db/settings.js";
import { getSheetConfig, listSheetConfigs, setSpreadsheetTitle } from "../db/sheetConfigs.js";
import { columnIndex, parseSpreadsheetId } from "../google/a1.js";
import { parseDriveLink, type DriveClient } from "../google/drive.js";
import { describeGoogleError, shareHint } from "../google/errors.js";
import { guessColumns, normalizeHeader, OPTIONAL_ROLE_LABELS, ROLE_LABELS, type ColumnGuess, type ColumnRole } from "../google/mapping.js";
import type { SheetsClient } from "../google/sheets.js";
import { logger } from "../logger.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";
import { logoUrl } from "./logo.js";

// Bắt đầu nhanh (spec v5.0 mục 16.5, CON-51): 4 bước có dấu ✅ — khoá Google, dán link sheet, đăng nhập Muse,
// thư mục Drive gốc — và kết nối sheet một bước (tự chọn tab, tự đoán cột, bấm Xác nhận).

export interface StartDeps {
  config: AppConfig;
  db: DB;
  sheets?: SheetsClient;
  drive?: DriveClient;
  bot?: MuseBot;
}

const ROLES = Object.keys(ROLE_LABELS) as ColumnRole[];
/** Đọc tiêu đề tối đa từng này tab khi tự chọn tab. */
const MAX_TABS = 20;

export interface StartStatus {
  key: boolean;
  sheets: number;
  museReadyAt: string | null;
  driveRoot: string | null;
  done: number;
  allDone: boolean;
}

export function startStatus(config: AppConfig, db: DB): StartStatus {
  const s = getSettings(db);
  const key = config.serviceAccount.ok;
  const sheets = listSheetConfigs(db).length;
  const done = [key, sheets > 0, !!s.museReadyAt, !!s.driveRootFolderId].filter(Boolean).length;
  return { key, sheets, museReadyAt: s.museReadyAt, driveRoot: s.driveRootFolderId, done, allDone: done === 4 };
}

const when = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

function Step(props: { n: number; done: boolean; title: string; children?: Child }) {
  return (
    <li class={`step ${props.done ? "done" : ""}`}>
      <span class="step-mark" aria-label={props.done ? "Xong" : "Chưa xong"}>
        {props.done ? "✅" : "⬜"}
      </span>
      <div class="step-body">
        <strong>
          {props.n}. {props.title}
        </strong>
        {props.children}
      </div>
    </li>
  );
}

/**
 * Các bước bắt đầu. `compact`: chỉ hiện bước còn thiếu (đặt trên Bảng); đủ cả 4 bước thì không hiện gì.
 * `back`: trang quay về sau mỗi nút.
 */
export function StartSteps(props: { status: StartStatus; clientEmail: string; problem?: string; back: string; compact?: boolean; rootName?: string }) {
  const { status: s, compact } = props;
  if (compact && s.allDone) return null;
  const show = (done: boolean) => !compact || !done;
  const backField = <input type="hidden" name="back" value={props.back} />;
  return (
    <section class="card start" aria-label="Các bước bắt đầu">
      <h2>{compact ? `Còn ${4 - s.done} bước nữa là dùng được` : `Bắt đầu trong 4 bước (${s.done}/4 xong)`}</h2>
      <ol class="steps">
        {show(s.key) && (
          <Step n={1} done={s.key} title="Khoá Google">
            {s.key ? (
              <div class="muted small">
                Tool dùng email <code>{props.clientEmail}</code>. Chia sẻ sheet (quyền Người chỉnh sửa) và thư mục Drive cho email này.
              </div>
            ) : (
              <div class="small">
                {props.problem ?? "Chưa có khoá Google."} <a href="/setup">Chọn file khoá Google</a> (file .json người phụ trách gửi).
              </div>
            )}
          </Step>
        )}
        {show(s.sheets > 0) && (
          <Step n={2} done={s.sheets > 0} title="Dán link Google Sheet">
            {s.sheets > 0 ? (
              <div class="muted small">
                Đã kết nối {s.sheets} trang tính. <a href="/ket-noi">+ Thêm sheet</a>
              </div>
            ) : (
              <form method="get" action="/ket-noi" class="step-form">
                <div class="row">
                  <input name="link" type="text" required placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Link Google Sheet" disabled={!s.key} />
                  <button type="submit" disabled={!s.key}>
                    Kết nối
                  </button>
                </div>
                <div class="muted small">Chép link trên thanh địa chỉ khi mở sheet. Tool tự tìm cột Ảnh, Prompt, Video, Trạng thái.</div>
              </form>
            )}
          </Step>
        )}
        {show(!!s.museReadyAt) && (
          <Step n={3} done={!!s.museReadyAt} title="Đăng nhập Muse">
            {s.museReadyAt && <div class="muted small">Đã đăng nhập (kiểm tra lúc {when(s.museReadyAt)}).</div>}
            {!s.museReadyAt && (
              <div class="muted small">
                Bấm <strong>Mở cửa sổ Muse</strong>, tự đăng nhập Meta trong cửa sổ Chrome đó (tool không gõ mật khẩu), rồi bấm <strong>Kiểm tra</strong>. Chỉ làm một lần, bot nhớ đăng nhập.
              </div>
            )}
            <div class="row step-form">
              <form method="post" action="/bat-dau/mo-muse">
                {backField}
                <button type="submit" class={s.museReadyAt ? "secondary small" : ""} disabled={!s.key}>
                  Mở cửa sổ Muse
                </button>
              </form>
              <form method="post" action="/bat-dau/kiem-tra-muse">
                {backField}
                <button type="submit" class="secondary" disabled={!s.key}>
                  {s.museReadyAt ? "Kiểm tra lại" : "Kiểm tra"}
                </button>
              </form>
            </div>
          </Step>
        )}
        {show(!!s.driveRoot) && (
          <Step n={4} done={!!s.driveRoot} title="Thư mục Drive lưu video">
            {s.driveRoot ? (
              <div class="muted small">
                {props.rootName ? <>📁 {props.rootName}. </> : null}Đổi ở <a href="/settings">⚙ Nâng cao → Cài đặt</a>.
              </div>
            ) : (
              <form method="post" action="/bat-dau/thu-muc" class="step-form">
                {backField}
                <div class="row">
                  <input name="link" type="text" required placeholder="https://drive.google.com/drive/folders/…" aria-label="Link thư mục Drive" disabled={!s.key} />
                  <button type="submit" disabled={!s.key}>
                    Lưu
                  </button>
                </div>
                <div class="muted small">Thư mục gốc chứa video (ví dụ "MASYS Video"), đã chia sẻ cho email ở bước 1. Muse lưu video vào thư mục con "Video" bên trong.</div>
              </form>
            )}
          </Step>
        )}
      </ol>
    </section>
  );
}

/** Tab nên chọn: theo yêu cầu, rồi tab chưa kết nối mà đoán đủ 4 cột, rồi tab đoán đủ, rồi tab đầu. */
export function pickTab(
  tabs: { title: string; guess: ColumnGuess }[],
  wanted: string | undefined,
  connected: (tab: string) => boolean,
): { title: string; guess: ColumnGuess } | undefined {
  const full = (g: ColumnGuess) => ROLES.every((r) => g[r]);
  return (
    tabs.find((t) => t.title === wanted) ??
    tabs.find((t) => full(t.guess) && !connected(t.title)) ??
    tabs.find((t) => full(t.guess)) ??
    tabs[0]
  );
}

export function registerStartRoutes(app: Hono, deps: StartDeps) {
  const { config, db, sheets, drive, bot } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const problem = config.serviceAccount.ok ? undefined : config.serviceAccount.problem;
  const page = (title: string, body: Child) => "<!doctype html>" + <Layout title={title}>{body}</Layout>;
  const safeBack = (v: unknown) => (typeof v === "string" && /^\/(?!\/)/.test(v) ? v : "/");
  const go = (c: Context, back: string, kind: "ok" | "msg", text: string) =>
    c.redirect(`${back}${back.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`, 303);

  /** Trang bắt đầu đầy đủ: logo + 4 bước. Trang chủ dùng khi chưa kết nối sheet nào. */
  async function startPage(c: Context) {
    const status = startStatus(config, db);
    let rootName: string | undefined;
    if (status.driveRoot && drive) rootName = (await drive.getFolder(status.driveRoot).catch(() => undefined))?.name;
    const ok = c.req.query("ok");
    const msg = c.req.query("msg");
    return c.html(
      page(
        "Bắt đầu · MASYS Video",
        <>
          <div class="hero small-hero">
            <img src={logoUrl("masys.png")} alt="MASYS Video Generator" />
          </div>
          {ok && <Alert kind="ok">{ok}</Alert>}
          {msg && <Alert kind="warn">{msg}</Alert>}
          <StartSteps status={status} clientEmail={clientEmail} problem={problem} back={c.req.path === "/" ? "/" : "/bat-dau"} rootName={rootName} />
          {status.sheets > 0 && (
            <p>
              <a class="button" href="/">
                Mở Bảng →
              </a>
            </p>
          )}
          <p class="muted small">
            Cần giúp? Xem <a href="/huong-dan">Hướng dẫn</a>.
          </p>
        </>,
      ),
    );
  }
  app.get("/bat-dau", startPage);

  app.post("/bat-dau/mo-muse", async (c) => {
    const back = safeBack((await c.req.parseBody()).back);
    if (!bot) return go(c, back, "msg", "Chưa nạp được khoá Google nên chưa mở được bot.");
    try {
      await bot.open();
      return go(c, back, "ok", "Đã mở cửa sổ Muse. Đăng nhập Meta trong cửa sổ đó rồi bấm Kiểm tra.");
    } catch (e) {
      logger.warn({ err: e }, "Không mở được trình duyệt bot");
      return go(c, back, "msg", "Không mở được Chrome. Kiểm tra máy đã cài Google Chrome.");
    }
  });

  app.post("/bat-dau/kiem-tra-muse", async (c) => {
    const back = safeBack((await c.req.parseBody()).back);
    if (!bot) return go(c, back, "msg", "Chưa nạp được khoá Google nên chưa mở được bot.");
    try {
      if (!bot.isOpen) await bot.open();
      const r = await bot.check();
      rememberMuseCheck(db, r.state);
      logger.info({ state: r.state }, "Kiểm tra Muse từ màn hình bắt đầu");
      if (r.state === "ready") return go(c, back, "ok", "Muse đã đăng nhập. ✅");
      if (r.state === "login") return go(c, back, "msg", "Muse chưa đăng nhập. Đăng nhập Meta trong cửa sổ Chrome của bot rồi bấm Kiểm tra lại.");
      if (r.state === "challenge") return go(c, back, "msg", "Muse đang hỏi bước kiểm tra bảo mật. Tự làm bước đó trong cửa sổ Chrome của bot rồi bấm Kiểm tra lại.");
      return go(c, back, "msg", "Không nhận ra trang Muse (có thể Muse đổi giao diện). Báo người phụ trách; ảnh chụp ở ⚙ Nâng cao → Bot Muse.");
    } catch (e) {
      logger.warn({ err: e }, "Không kiểm tra được Muse");
      return go(c, back, "msg", "Không mở được Chrome. Kiểm tra máy đã cài Google Chrome.");
    }
  });

  app.post("/bat-dau/thu-muc", async (c) => {
    const body = await c.req.parseBody();
    const back = safeBack(body.back);
    const link = parseDriveLink(String(body.link ?? ""));
    if (link?.kind !== "folder") return go(c, back, "msg", "Link không phải link thư mục Google Drive (dạng …/drive/folders/…).");
    if (!drive) return go(c, back, "msg", "Chưa nạp được khoá Google.");
    try {
      const folder = await drive.getFolder(link.id);
      setDriveRootFolder(db, folder.id);
      logger.info({ folderId: folder.id }, "Đã đặt thư mục Drive gốc từ màn hình bắt đầu");
      const subs = await drive.listFolders(folder.id).catch(() => []);
      const hasVideo = subs.some((f) => normalizeHeader(f.name) === "video");
      return go(
        c,
        back,
        "ok",
        hasVideo
          ? `Đã lưu thư mục "${folder.name}". Video sẽ vào thư mục con "Video".`
          : `Đã lưu thư mục "${folder.name}". Nên tạo thêm thư mục con tên "Video" bên trong; chưa có thì video lưu thẳng vào "${folder.name}".`,
      );
    } catch (e) {
      return go(c, back, "msg", describeGoogleError(e, clientEmail));
    }
  });

  /** Kết nối sheet một bước: dán link → tự chọn tab, tự đoán cột → Xác nhận. Đoán thiếu cột thì mới hiện chọn cột. */
  app.get("/ket-noi", async (c) => {
    const link = c.req.query("link") ?? "";
    const form = (
      <form class="card" method="get" action="/ket-noi">
        <label for="link">Link Google Sheet</label>
        <div class="row">
          <input id="link" name="link" type="text" required value={link} placeholder="https://docs.google.com/spreadsheets/d/…" />
          <button type="submit">Kết nối</button>
        </div>
        <div class="muted small">Mở sheet, chia sẻ cho {clientEmail ? <code>{clientEmail}</code> : "email của tool"} với quyền Người chỉnh sửa, rồi chép link trên thanh địa chỉ.</div>
      </form>
    );
    const render = (body: Child, status: 200 | 400 | 502 = 200) => c.html(page("Kết nối sheet", <><h1>Kết nối sheet</h1>{form}{body}</>), status);
    if (!link) return render(null);
    if (!sheets) return render(<Alert kind="warn">Chưa nạp được khoá Google. <a href="/setup">Chọn file khoá</a>.</Alert>);
    const id = parseSpreadsheetId(link);
    if (!id) return render(<Alert kind="warn">Không nhận ra link Google Sheet. Link đúng có dạng https://docs.google.com/spreadsheets/d/…</Alert>, 400);

    try {
      const info = await sheets.getSpreadsheet(id);
      setSpreadsheetTitle(db, id, info.title);
      if (!(await sheets.canEdit(id))) {
        return render(
          <Alert kind="warn">
            {shareHint(clientEmail)}. Hiện tool chỉ có quyền xem nên không ghi được ô Trạng thái. Chia sẻ xong bấm <strong>Kết nối</strong> lần nữa.
          </Alert>,
        );
      }
      const tabs = await Promise.all(
        info.tabs.slice(0, MAX_TABS).map(async (t) => ({ title: t.title, guess: guessColumns(await sheets.readRow(id, t.title, 1).catch(() => [])) })),
      );
      const chosen = pickTab(tabs, c.req.query("tab"), (tab) => !!getSheetConfig(db, id, tab));
      if (!chosen) return render(<Alert kind="warn">Sheet này không có trang tính nào.</Alert>);
      const headers = await sheets.readRow(id, chosen.title, 1).catch(() => [] as string[]);
      const missing = ROLES.filter((r) => !chosen.guess[r]);
      const mapUrl = `/sheets/map?id=${encodeURIComponent(id)}&tab=${encodeURIComponent(chosen.title)}&back=bang`;
      const already = getSheetConfig(db, id, chosen.title);
      const tabPicker =
        tabs.length > 1 ? (
          <div class="field">
            <label for="tab">Trang tính</label>
            <select
              id="tab"
              onchange={`location.href='/ket-noi?link='+encodeURIComponent(${JSON.stringify(link)})+'&tab='+encodeURIComponent(this.value)`}
            >
              {tabs.map((t) => (
                <option value={t.title} selected={t.title === chosen.title}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        ) : null;
      if (missing.length) {
        return render(
          <div class="card">
            <strong>📄 {info.title}</strong>
            {tabPicker}
            <p>
              Tool chưa tìm ra cột <strong>{missing.map((r) => ROLE_LABELS[r]).join(", ")}</strong> ở dòng 1 của trang tính "{chosen.title}".
            </p>
            <a class="button" href={mapUrl}>
              Chọn cột
            </a>
          </div>,
        );
      }
      const label = (col?: string) => {
        if (!col) return null;
        const h = headers[columnIndex(col)];
        return (
          <>
            cột <strong>{col}</strong>
            {h ? <span class="muted"> ("{h}")</span> : null}
          </>
        );
      };
      return render(
        <div class="card">
          <strong>📄 {info.title}</strong>
          {tabPicker}
          {already && <Alert kind="ok">Trang tính này đã kết nối. Bấm Xác nhận để dùng lại, hoặc Đổi cột.</Alert>}
          <ul class="mapping">
            {ROLES.map((r) => (
              <li>
                {ROLE_LABELS[r]}: {label(chosen.guess[r])}
              </li>
            ))}
            <li>
              {OPTIONAL_ROLE_LABELS.colShirt}: {chosen.guess.colShirt ? label(chosen.guess.colShirt) : <span class="muted">không có (không bắt buộc)</span>}
            </li>
          </ul>
          <form method="post" action="/sheets/map" class="row">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="tab" value={chosen.title} />
            <input type="hidden" name="headerRow" value="1" />
            {ROLES.map((r) => (
              <input type="hidden" name={r} value={chosen.guess[r] ?? ""} />
            ))}
            <input type="hidden" name="colShirt" value={chosen.guess.colShirt ?? ""} />
            <input type="hidden" name="back" value="bang" />
            <button type="submit">Xác nhận</button>
            <a class="button secondary" href={mapUrl}>
              Đổi cột
            </a>
          </form>
        </div>,
      );
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: id }, "Không đọc được sheet khi kết nối nhanh");
      return render(<Alert kind="warn">{describeGoogleError(e, clientEmail)}</Alert>, 502);
    }
  });

  return { startPage };
}
