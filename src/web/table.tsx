import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Child } from "hono/jsx";
import { planForRows, quickCreateBatch } from "../batch/quick.js";
import type { MuseBot } from "../bot/museBot.js";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import { activeBatch } from "../db/history.js";
import { getDailyQuota } from "../db/quota.js";
import { getSettings } from "../db/settings.js";
import { normalizeHeader } from "../google/mapping.js";
import { fillMissingTitles, getSheetConfig, listSheetConfigs, sheetName, type SheetConfig } from "../db/sheetConfigs.js";
import { parseDriveLink, type DriveClient, type DriveFolder } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import { GoogleApiError } from "../google/http.js";
import { FIELD_TEXT, type EditField } from "../db/sheetEdits.js";
import { addRow, applyFill, CONFLICT_TEXT, editCell, isEditField, lockedRows, parseRowList, planFill, type EditDeps } from "../sheetEdit/edit.js";
import type { SheetsClient } from "../google/sheets.js";
import { logger } from "../logger.js";
import { PAUSE_TEXT, type BatchRunner, type PauseReason } from "../queue/runner.js";
import { LABEL_TEXT, labelRows, type ScannedRow } from "../scan/labels.js";
import { scanTab } from "../scan/scan.js";
import type { ThumbnailCache } from "../scan/thumbnails.js";
import { RUN_BADGE, RUN_STATE_TEXT } from "./batchRun.js";
import { Alert, truncate } from "./components.js";
import { Layout } from "./layout.js";
import { StartSteps, startStatus } from "./start.js";

// Màn hình chính "Bảng" (spec v5.0 mục 16.2, D17, D19): nội dung tab sheet thành bảng, tích chọn dòng,
// một nút Tạo video (tạo lô với mặc định và chạy luôn), trạng thái từng dòng ngay trên bảng.

export interface TableDeps {
  config: AppConfig;
  db: DB;
  sheets?: SheetsClient;
  drive?: DriveClient;
  thumbs?: ThumbnailCache;
  bot?: MuseBot;
  runner?: BatchRunner;
}

/** Cookie nhớ sheet/tab và thư mục lưu video dùng lần trước. */
const COOKIE = "masys_bang";
const FOLDER_COOKIE = "masys_folder";
const YEAR = 60 * 60 * 24 * 365;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
export const tableUrl = (id: string, tab: string, extra = "") => `/?id=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}${extra}`;
const driveView = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

/** Lượt mới nhất của từng dòng trong các lô chưa xong của tab này. */
function liveRuns(db: DB, id: string, tab: string): Map<number, { state: string; error: string | null; batchId: number }> {
  const rows = db
    .prepare(
      `SELECT r.rowNumber AS row, r.state, r.error, r.batchId FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE b.spreadsheetId = ? AND b.tab = ? AND b.status IN ('queued', 'running', 'paused') ORDER BY r.id`,
    )
    .all(id, tab) as { row: number; state: string; error: string | null; batchId: number }[];
  return new Map(rows.map((r) => [r.row, r]));
}

/** Dấu hiệu lô đang chạy thay đổi (trạng thái lô, trạng thái từng lượt): trang tải lại khi khác. */
function batchKey(db: DB): string {
  const b = activeBatch(db);
  if (!b) return "none";
  const runs = db.prepare("SELECT rowNumber, state FROM runs WHERE batchId = ? ORDER BY rowNumber").all(b.id) as { rowNumber: number; state: string }[];
  return `${b.id}:${b.status}:${b.pauseReason ?? ""}:${runs.map((r) => `${r.rowNumber}=${r.state}`).join(",")}`;
}

const gridHash = (grid: string[][]) => createHash("sha1").update(JSON.stringify(grid)).digest("hex").slice(0, 16);

function Thumb(props: { fileId?: string; link: string; alt: string; known: (id?: string) => boolean }) {
  if (!props.link) return <span class="muted">—</span>;
  if (props.fileId && props.known(props.fileId)) {
    return (
      <a href={driveView(props.fileId)} target="_blank" rel="noreferrer" title="Bấm để xem ảnh lớn">
        <img class="thumb" src={`/thumb/${props.fileId}`} alt={props.alt} loading="lazy" width="64" height="64" />
      </a>
    );
  }
  return <span class="muted small">không xem được</span>;
}

/** Ô sửa được trên Bảng (D18): giá trị đầy đủ nằm ở data-value để mở khung sửa; dòng đang tạo video thì không có nút ✎. */
function EditCell(props: { field: EditField; value: string; editable: boolean; class?: string; children: Child }) {
  const label = props.field === "prompt" ? "Sửa prompt" : props.value ? `Đổi link ${FIELD_TEXT[props.field].toLowerCase()}` : `Thêm ${FIELD_TEXT[props.field].toLowerCase()}`;
  return (
    <td class={props.class} data-field={props.field} data-value={props.value}>
      <div class="cellwrap">
        <div class="cellbody">{props.children}</div>
        {props.editable && (
          <button type="button" class="edit" title={label} aria-label={label}>
            {props.field !== "prompt" && !props.value ? "+" : "✎"}
          </button>
        )}
      </div>
    </td>
  );
}

function Row(props: {
  r: ScannedRow;
  run?: { state: string; error: string | null };
  locked: boolean;
  editable: boolean;
  known: (id?: string) => boolean;
  hasShirtCol: boolean;
}) {
  const { r, run, editable } = props;
  const inBatch = !!run;
  const selectable = r.selectable && !inBatch && !props.locked;
  return (
    <tr
      data-row={String(r.row)}
      data-label={r.label}
      class={run && !["queued"].includes(run.state) ? "live" : ""}
      title={editable ? undefined : "Dòng đang tạo video: chưa sửa được"}
    >
      <td>
        <input
          type="checkbox"
          class="sel"
          name="row"
          value={String(r.row)}
          form="run"
          disabled={!selectable}
          aria-label={`Chọn dòng ${r.row}`}
          title={selectable ? undefined : r.label === "has_video" ? "Đã có video: tích Ghi đè nếu muốn làm lại" : r.label === "missing_data" ? "Thiếu dữ liệu: xem lý do ở cột Trạng thái" : undefined}
        />
        {r.label === "has_video" && r.canOverwrite && !inBatch && !props.locked && (
          <label class="inline small" title="Làm lại video cho dòng đã có video (D10)">
            <input type="checkbox" class="ow" name="overwrite" value={String(r.row)} form="run" /> Ghi đè
          </label>
        )}
      </td>
      <td>{r.row}</td>
      <EditCell field="image" value={r.image} editable={editable}>
        <Thumb fileId={r.imageFileId} link={r.image} alt={`Người mẫu dòng ${r.row}`} known={props.known} />
      </EditCell>
      {props.hasShirtCol && (
        <EditCell field="shirt" value={r.shirt} editable={editable}>
          <Thumb fileId={r.shirtFileId} link={r.shirt} alt={`Áo dòng ${r.row}`} known={props.known} />
        </EditCell>
      )}
      <EditCell field="prompt" value={r.prompt} editable={editable} class="prompt">
        <div title={r.prompt}>{r.prompt ? truncate(r.prompt, 140) : <span class="muted">(trống)</span>}</div>
        {r.prompt && (
          <details class="preview" data-row={String(r.row)}>
            <summary class="small">Xem yêu cầu gửi Muse</summary>
            <pre class="request">Đang tải…</pre>
          </details>
        )}
      </EditCell>
      <td>
        {r.video ? (
          /^https?:\/\//.test(r.video) ? (
            <a class="button secondary" href={r.video} target="_blank" rel="noreferrer">
              ▶ Xem
            </a>
          ) : (
            <span class="muted small">{truncate(r.video, 30)}</span>
          )
        ) : (
          <span class="muted">—</span>
        )}
      </td>
      <td>
        {run ? (
          <span class={`badge ${RUN_BADGE[run.state] ?? "b-running"}`}>{RUN_STATE_TEXT[run.state] ?? run.state}</span>
        ) : (
          <span class={`badge b-${r.label}`}>{LABEL_TEXT[r.label]}</span>
        )}
        {run?.error && <div class="small">{run.error}</div>}
        {!run && r.status && r.label !== "ready" && <div class="muted small">{truncate(r.status, 60)}</div>}
        {!run && r.problems.length > 0 && r.label !== "ready" && (
          <ul class="problems">
            {r.problems.map((p) => (
              <li>{p}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

// Chạy trong trình duyệt: đếm dòng đã chọn, Chọn mọi dòng chưa có video, xem yêu cầu từng dòng, tự làm mới.
const CLIENT_JS = `
(function () {
  var run = document.getElementById("run");
  var page = document.getElementById("bang");
  if (!page) return;
  var rows = Array.prototype.slice.call(document.querySelectorAll("tr[data-row]"));
  function sel(tr) { return tr.querySelector(".sel"); }
  function chosen() { return rows.filter(function (tr) { return sel(tr).checked; }).length; }
  function update() {
    if (!run) return;
    var remaining = Number(run.dataset.remaining), limit = Number(run.dataset.limit);
    var n = chosen(), btn = document.getElementById("runBtn"), msg = document.getElementById("runMsg");
    btn.textContent = "▶ Tạo video (" + n + " dòng)";
    msg.textContent = n > remaining
      ? (remaining === 0 ? "Hôm nay đã đủ " + limit + " video. Thử lại ngày mai." : "Hôm nay chỉ còn " + remaining + " video. Bỏ bớt " + (n - remaining) + " dòng.")
      : (n === 0 ? "Tích chọn dòng cần tạo video." : "");
    btn.disabled = run.dataset.blocked === "1" || n === 0 || n > remaining;
  }
  rows.forEach(function (tr) {
    sel(tr).addEventListener("change", update);
    var o = tr.querySelector(".ow");
    if (o) o.addEventListener("change", function () {
      sel(tr).disabled = !o.checked;
      if (!o.checked) sel(tr).checked = false;
      else sel(tr).checked = true;
      update();
    });
  });
  var all = document.getElementById("selectReady");
  if (all) all.addEventListener("click", function () {
    var room = Number(run.dataset.remaining) - chosen(), skipped = 0;
    rows.forEach(function (tr) {
      if (tr.dataset.label !== "ready" || sel(tr).disabled || sel(tr).checked) return;
      if (room > 0) { sel(tr).checked = true; room--; } else skipped++;
    });
    update();
    if (skipped) document.getElementById("runMsg").textContent = "Đã chọn đủ số video còn lại hôm nay; " + skipped + " dòng sẵn sàng chưa được chọn.";
  });
  var none = document.getElementById("clearSel");
  if (none) none.addEventListener("click", function () { rows.forEach(function (tr) { sel(tr).checked = false; }); update(); });
  var folder = document.getElementById("folder"), folderLink = document.getElementById("folderLink");
  function folderValue() {
    if (!folder) return "";
    return folder.value === "__link" ? folderLink.value.trim() : folder.value;
  }
  if (folder) folder.addEventListener("change", function () {
    folderLink.hidden = folder.value !== "__link";
    if (!folderLink.hidden) folderLink.focus();
    document.querySelectorAll("details.preview").forEach(function (d) { delete d.dataset.loaded; d.open = false; });
  });
  document.querySelectorAll("details.preview").forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (!d.open || d.dataset.loaded) return;
      d.dataset.loaded = "1";
      fetch(page.dataset.preview + "&row=" + d.dataset.row + "&folder=" + encodeURIComponent(folderValue())).then(function (r) { return r.text(); })
        .then(function (t) { d.querySelector("pre").textContent = t; }, function () { d.querySelector("pre").textContent = "Không tải được."; });
    });
  });
  update();

  // Sửa ngay trên Bảng (D18): mọi lần ghi đi qua tool, tool đọc lại ô trên sheet trước khi ghi.
  function post(path, body) {
    body.id = page.dataset.sheet; body.tab = page.dataset.tab;
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function done(text) { location.href = page.dataset.self + "&ok=" + encodeURIComponent(text); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  var LINK_HINT = "Dán link Drive của file ảnh (chia sẻ \\u201cBất kỳ ai có đường liên kết\\u201d hoặc chia sẻ cho tool). Để trống để xoá link.";
  function openEditor(td) {
    if (td.querySelector(".editor")) return;
    var field = td.dataset.field, row = Number(td.closest("tr").dataset.row), expected = td.dataset.value;
    var box = el("div", "editor");
    var input = el(field === "prompt" ? "textarea" : "input");
    if (field === "prompt") input.rows = 5; else { input.type = "text"; input.placeholder = "https://drive.google.com/file/d/\\u2026"; }
    input.value = expected;
    box.appendChild(input);
    if (field !== "prompt") box.appendChild(el("div", "muted small", LINK_HINT));
    var current = el("div", "small conflict"); current.hidden = true; box.appendChild(current);
    var bar = el("div", "row"), save = el("button", "small", "Lưu lên sheet"), cancel = el("button", "secondary small", "Huỷ");
    save.type = cancel.type = "button";
    var msg = el("span", "small warn-text");
    bar.appendChild(save); bar.appendChild(cancel); bar.appendChild(msg); box.appendChild(bar);
    cancel.addEventListener("click", function () { box.remove(); });
    save.addEventListener("click", function () {
      save.disabled = true; msg.textContent = "Đang lưu\\u2026";
      post("/bang/sua", { row: row, field: field, expected: expected, value: input.value }).then(function (r) {
        if (r.ok) return r.changed ? done("Đã lưu dòng " + row + " lên sheet.") : box.remove();
        save.disabled = false; msg.textContent = r.message;
        if (r.conflict) { expected = r.current; current.hidden = false; current.textContent = "Trên sheet bây giờ: " + (r.current || "(trống)"); }
      }, function () { save.disabled = false; msg.textContent = "Không kết nối được tool."; });
    });
    td.appendChild(box);
    input.focus();
  }
  document.querySelectorAll("td[data-field] button.edit").forEach(function (b) {
    b.addEventListener("click", function () { openEditor(b.closest("td")); });
  });

  // Thêm dòng: tool ghi vào dòng trống đầu tiên sau dòng dữ liệu cuối.
  var addBox = document.getElementById("addBox");
  var addOpen = document.getElementById("addOpen");
  if (addOpen) addOpen.addEventListener("click", function () { addBox.hidden = !addBox.hidden; if (!addBox.hidden) addBox.querySelector("input, textarea").focus(); });
  var addGo = document.getElementById("addGo");
  if (addGo) addGo.addEventListener("click", function () {
    var msg = document.getElementById("addMsg"), v = function (id) { var e = document.getElementById(id); return e ? e.value : ""; };
    addGo.disabled = true; msg.textContent = "Đang thêm\\u2026";
    post("/bang/them-dong", { image: v("addImage"), shirt: v("addShirt"), prompt: v("addPrompt") }).then(function (r) {
      if (r.ok) return done("Đã thêm dòng " + r.row + " vào sheet.");
      addGo.disabled = false; msg.textContent = r.message;
    }, function () { addGo.disabled = false; msg.textContent = "Không kết nối được tool."; });
  });

  // Dải prompt: xem trước (đếm dòng sẽ thay) → xác nhận → ghi.
  var fillBox = document.getElementById("fillBox");
  var fillOpen = document.getElementById("fillOpen");
  if (fillOpen) fillOpen.addEventListener("click", function () {
    fillBox.hidden = !fillBox.hidden;
    if (fillBox.hidden) return;
    var picked = rows.filter(function (tr) { return sel(tr).checked; }).map(function (tr) { return tr.dataset.row; });
    var rowsInput = document.getElementById("fillRows");
    if (rowsInput && picked.length && !rowsInput.value) rowsInput.value = picked.join(", ");
  });
  var fillGo = document.getElementById("fillGo");
  if (fillGo) fillGo.addEventListener("click", function () {
    var msg = document.getElementById("fillMsg");
    var body = {
      source: Number(document.getElementById("fillSource").value),
      mode: document.querySelector("input[name=fillMode]:checked").value,
      rows: document.getElementById("fillRows").value,
      includeVideo: document.getElementById("fillVideo").checked,
    };
    fillGo.disabled = true; msg.textContent = "Đang đọc sheet\\u2026";
    post("/bang/dai-prompt/xem", body).then(function (r) {
      fillGo.disabled = false;
      if (!r.ok) { msg.textContent = r.message; return; }
      msg.textContent = r.summary;
      if (!r.plan.targets.length || !confirm(r.summary + "\\n\\nGhi lên sheet?")) return;
      fillGo.disabled = true; msg.textContent = "Đang ghi\\u2026";
      return post("/bang/dai-prompt", { prompt: r.plan.prompt, targets: r.plan.targets }).then(function (w) {
        if (w.ok && w.written) return done(w.message);
        fillGo.disabled = false; msg.textContent = w.message;
      });
    }).catch(function () { fillGo.disabled = false; msg.textContent = "Không kết nối được tool."; });
  });
  function editing() {
    return !!document.querySelector(".editor") || (addBox && !addBox.hidden) || (fillBox && !fillBox.hidden);
  }

  // Tự làm mới: lô đổi trạng thái → tải lại; sheet đổi → tải lại nếu chưa chọn gì, không thì báo.
  // Đang sửa ô / thêm dòng / dải prompt thì không tải lại, chỉ báo.
  var every = page.dataset.live === "1" ? 5000 : 30000;
  function poll() {
    fetch(page.dataset.state).then(function (r) { return r.json(); }).then(function (s) {
      if (s.batch !== page.dataset.batch && !editing()) return location.reload();
      if (s.data && s.data !== page.dataset.data) {
        if (chosen() === 0 && !document.querySelector("details.preview[open]") && !editing()) return location.reload();
        document.getElementById("stale").hidden = false;
      }
      setTimeout(poll, every);
    }, function () { setTimeout(poll, every); });
  }
  setTimeout(poll, every);
})();
`;

export function registerTableRoutes(app: Hono, deps: TableDeps, fallback: (c: Context) => Response | Promise<Response>) {
  const { config, db, sheets, drive, thumbs, bot, runner } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (title: string, body: Child) => "<!doctype html>" + <Layout title={title} hideStatus>{body}</Layout>;
  const quick = sheets && drive ? { db, sheets, drive, clientEmail } : undefined;

  /**
   * Thư mục cho ô "Lưu video vào": thư mục gốc và các thư mục con, cộng thư mục dán link lần trước.
   * Chọn sẵn: lần trước, không có thì thư mục con "Video", không có nữa thì thư mục gốc.
   */
  async function folderChoices(c: Context): Promise<{ options: (DriveFolder & { label: string })[]; selected?: string; problem?: string }> {
    const root = getSettings(db).driveRootFolderId;
    const last = getCookie(c, FOLDER_COOKIE);
    const options: (DriveFolder & { label: string })[] = [];
    let problem: string | undefined;
    if (root && drive) {
      try {
        const r = await drive.getFolder(root);
        options.push({ ...r, label: r.name + " (thư mục gốc)" }, ...(await drive.listFolders(root)).map((f) => ({ ...f, label: r.name + " / " + f.name })));
      } catch (e) {
        problem = `Không đọc được thư mục Drive gốc: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (last && DRIVE_ID.test(last) && !options.some((o) => o.id === last) && drive) {
      try {
        const f = await drive.getFolder(last);
        options.push({ ...f, label: f.name });
      } catch {}
    }
    const video = options.find((o) => o.id !== root && normalizeHeader(o.name) === "video");
    const selected = options.find((o) => o.id === last)?.id ?? video?.id ?? options[0]?.id;
    return { options, selected, problem };
  }

  /** Sheet/tab đang xem: theo địa chỉ, rồi theo lần dùng trước, rồi tab đầu tiên đã kết nối. */
  function pickConfig(c: Context): SheetConfig | undefined {
    const id = c.req.query("id");
    const tab = c.req.query("tab");
    if (id && tab !== undefined) return getSheetConfig(db, id, tab);
    try {
      const saved = JSON.parse(getCookie(c, COOKIE) ?? "null") as [string, string] | null;
      const cfg = saved && getSheetConfig(db, saved[0], saved[1]);
      if (cfg) return cfg;
    } catch {}
    return listSheetConfigs(db)[0];
  }

  app.get("/", async (c) => {
    if (!sheets || !drive || listSheetConfigs(db).length === 0) return fallback(c);
    await fillMissingTitles(db, async (sid) => (await sheets.getSpreadsheet(sid)).title).catch(() => {});
    const configs = listSheetConfigs(db);
    const cfg = pickConfig(c);
    if (!cfg) return fallback(c);
    setCookie(c, COOKIE, JSON.stringify([cfg.spreadsheetId, cfg.tab]), { path: "/", maxAge: YEAR, sameSite: "Lax" });
    const folders = await folderChoices(c);

    const quota = getDailyQuota(db);
    const active = activeBatch(db);
    const msg = c.req.query("msg");
    const ok = c.req.query("ok");
    const head = (
      <TableHeader configs={configs} cfg={cfg} quota={quota} active={active} bot={bot} />
    );

    let rows: ScannedRow[];
    let data = "";
    try {
      const result = await scanTab(sheets, drive, cfg);
      thumbs?.remember(result.images);
      rows = result.rows;
      data = gridHash(result.grid);
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: cfg.spreadsheetId, tab: cfg.tab }, "Không đọc được tab cho Bảng");
      return c.html(page("Bảng", <>{head}<Alert kind="warn">{describeGoogleError(e, clientEmail)} <a href={tableUrl(cfg.spreadsheetId, cfg.tab)}>Thử lại</a></Alert></>), 502);
    }

    const runs = liveRuns(db, cfg.spreadsheetId, cfg.tab);
    const live = !!active && active.status === "running";
    const paused = active?.status === "paused";
    const blocked = !runner || !!active;
    const known = (id?: string) => !!id && !!thumbs?.isKnown(id);
    const hasShirtCol = !!cfg.colShirt;
    const ready = rows.filter((r) => r.label === "ready" && !runs.has(r.row)).length;
    const editLocked = lockedRows(db, cfg.spreadsheetId, cfg.tab);
    const canEdit = (r: ScannedRow) => !editLocked.has(r.row) && r.label !== "running";
    const withPrompt = rows.filter((r) => r.prompt);

    return c.html(
      page(
        `Bảng · ${cfg.tab}`,
        <div
          id="bang"
          data-live={live ? "1" : "0"}
          data-batch={batchKey(db)}
          data-data={data}
          data-state={`/bang/state?id=${encodeURIComponent(cfg.spreadsheetId)}&tab=${encodeURIComponent(cfg.tab)}`}
          data-preview={`/bang/preview?id=${encodeURIComponent(cfg.spreadsheetId)}&tab=${encodeURIComponent(cfg.tab)}`}
          data-sheet={cfg.spreadsheetId}
          data-tab={cfg.tab}
          data-self={tableUrl(cfg.spreadsheetId, cfg.tab)}
        >
          {head}
          {ok && <Alert kind="ok">{ok}</Alert>}
          {msg && <Alert kind="warn">{msg}</Alert>}
          <StartSteps status={startStatus(config, db)} clientEmail={clientEmail} back={tableUrl(cfg.spreadsheetId, cfg.tab)} compact />
          <ActiveBatchBox active={active} runner={runner} cfg={cfg} db={db} />
          <div id="stale" class="card warn" hidden>
            Sheet vừa thay đổi. <a href={tableUrl(cfg.spreadsheetId, cfg.tab)}>🔄 Làm mới bảng</a> (các dòng đang chọn sẽ bỏ chọn).
          </div>
          {rows.length === 0 ? (
            <Alert kind="warn">
              Trang tính chưa có dòng dữ liệu nào bên dưới dòng tiêu đề {cfg.headerRow}. Bấm <strong>+ Thêm dòng</strong> ở dưới.
            </Alert>
          ) : (
            <div class="scroll">
              <table class="scan bang">
                <thead>
                  <tr>
                    <th>Chọn</th>
                    <th>Dòng</th>
                    <th>Người mẫu</th>
                    {hasShirtCol && <th>Áo</th>}
                    <th>Prompt</th>
                    <th>Video</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Row r={r} run={runs.get(r.row)} locked={blocked} editable={canEdit(r)} known={known} hasShirtCol={hasShirtCol} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div class="row add-row">
            <button type="button" id="addOpen" class="secondary">
              + Thêm dòng
            </button>
            <span class="muted small">Sửa ô: bấm ✎ (hoặc + khi ô trống). Tool ghi thẳng lên Google Sheet.</span>
          </div>
          <div id="addBox" class="card" hidden>
            <h2>Thêm dòng</h2>
            <p class="muted small">Tool ghi vào dòng trống đầu tiên sau dòng cuối cùng của sheet. Ảnh là link Drive của file ảnh.</p>
            <div class="field">
              <label for="addImage">Ảnh người mẫu</label>
              <input id="addImage" type="text" class="wide" placeholder="https://drive.google.com/file/d/…" />
            </div>
            {hasShirtCol && (
              <div class="field">
                <label for="addShirt">Ảnh áo (không bắt buộc)</label>
                <input id="addShirt" type="text" class="wide" placeholder="https://drive.google.com/file/d/…" />
              </div>
            )}
            <div class="field">
              <label for="addPrompt">Prompt</label>
              <textarea id="addPrompt" rows={4}></textarea>
            </div>
            <div class="row">
              <button type="button" id="addGo">
                Thêm vào sheet
              </button>
              <span id="addMsg" class="small warn-text" aria-live="polite"></span>
            </div>
          </div>
          <div id="fillBox" class="card" hidden>
            <h2>Dải prompt</h2>
            {withPrompt.length === 0 ? (
              <p class="muted">Chưa có dòng nào có prompt để dải.</p>
            ) : (
              <>
                <div class="field">
                  <label for="fillSource">Lấy prompt của dòng</label>
                  <select id="fillSource">
                    {withPrompt.map((r) => (
                      <option value={String(r.row)}>
                        Dòng {r.row}: {truncate(r.prompt, 70)}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="field">
                  <label class="inline">
                    <input type="radio" name="fillMode" value="rows" checked /> Áp cho các dòng
                  </label>{" "}
                  <input id="fillRows" type="text" placeholder="ví dụ 3-6, 9 (sẵn các dòng đang tích)" />
                </div>
                <div class="field">
                  <label class="inline">
                    <input type="radio" name="fillMode" value="down" /> Dải xuống tới dòng cuối
                  </label>
                </div>
                <div class="field">
                  <label class="inline">
                    <input type="checkbox" id="fillVideo" /> Thay cả dòng đã có video
                  </label>
                  <div class="muted small">Dòng đang tạo video luôn được bỏ qua.</div>
                </div>
                <div class="row">
                  <button type="button" id="fillGo">
                    Áp prompt…
                  </button>
                  <span id="fillMsg" class="small warn-text" aria-live="polite"></span>
                </div>
              </>
            )}
          </div>
          {folders.problem && <Alert kind="warn">{folders.problem} Sửa ở ⚙ Nâng cao → Cài đặt, hoặc dán link thư mục ở ô "Lưu video vào".</Alert>}
          <form
            id="run"
            method="post"
            action="/bang/run"
            class="card actionbar"
            data-remaining={String(quota.remaining)}
            data-limit={String(quota.limit)}
            data-blocked={blocked ? "1" : "0"}
          >
            <input type="hidden" name="id" value={cfg.spreadsheetId} />
            <input type="hidden" name="tab" value={cfg.tab} />
            <div class="row">
              <button type="button" id="selectReady" class="secondary" disabled={blocked || ready === 0}>
                ☑ Chọn mọi dòng chưa có video ({ready})
              </button>
              <button type="button" id="clearSel" class="secondary">
                Bỏ chọn
              </button>
              <button type="button" id="fillOpen" class="secondary" title="Chép prompt của một dòng sang nhiều dòng">
                Dải prompt ▾
              </button>
            </div>
            <div class="folder-pick">
              <label for="folder" class="inline-label">Lưu video vào</label>
              <select id="folder" name="folder">
                {folders.options.map((f) => (
                  <option value={f.id} selected={f.id === folders.selected}>
                    📁 {f.label}
                  </option>
                ))}
                <option value="__link" selected={!folders.selected}>
                  Dán link thư mục khác…
                </option>
              </select>
              <input id="folderLink" name="folderLink" type="text" placeholder="https://drive.google.com/drive/folders/…" hidden={!!folders.selected} />
              <span class="muted small">Muse lưu video xong vào thư mục này.</span>
            </div>
            <div class="run-right">
              <span id="runMsg" class="small warn-text" aria-live="polite">
                {blocked && (runner ? (paused ? "Có lô đang tạm dừng: bấm Tiếp tục hoặc Huỷ ở trên trước." : "Đang tạo video, đợi xong rồi chọn tiếp.") : "Chưa sẵn sàng chạy bot.")}
              </span>
              <button type="submit" id="runBtn" disabled>
                ▶ Tạo video (0 dòng)
              </button>
            </div>
            <div class="muted small hint run-hint">Bot gửi lần lượt từng dòng cho Muse, mỗi dòng khoảng 3–5 phút. Cứ để tool chạy, video xong hiện ngay trên bảng.</div>
          </form>
          <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
        </div>,
      ),
    );
  });

  /** Thư mục chọn ở ô "Lưu video vào": mã thư mục, hoặc link dán vào khi chọn "Dán link thư mục khác…". */
  function readFolder(value: string, link: string): { id: string } | { error: string } | undefined {
    if (value === "__link") {
      const parsed = parseDriveLink(link.trim());
      if (!link.trim()) return { error: "Chưa dán link thư mục Drive lưu video." };
      if (parsed?.kind !== "folder") return { error: "Link thư mục không đúng dạng https://drive.google.com/drive/folders/…" };
      return { id: parsed.id };
    }
    if (!value) return undefined;
    return DRIVE_ID.test(value) ? { id: value } : { error: "Thư mục lưu video không hợp lệ." };
  }

  // "+ Thêm sheet" (đường cũ): kết nối nhanh, lưu xong quay về Bảng (CON-51).
  app.get("/bang/them-sheet", (c) => c.redirect("/ket-noi", 303));

  app.get("/bang/state", async (c) => {
    const cfg = getSheetConfig(db, c.req.query("id") ?? "", c.req.query("tab") ?? "");
    if (!cfg || !sheets) return c.json({ batch: batchKey(db) });
    try {
      return c.json({ batch: batchKey(db), data: gridHash(await sheets.readTab(cfg.spreadsheetId, cfg.tab)) });
    } catch {
      return c.json({ batch: batchKey(db) });
    }
  });

  app.get("/bang/preview", async (c) => {
    const cfg = getSheetConfig(db, c.req.query("id") ?? "", c.req.query("tab") ?? "");
    const row = Number(c.req.query("row"));
    if (!cfg || !quick || !Number.isInteger(row)) return c.text("Yêu cầu không hợp lệ", 400);
    try {
      // Chỉ cần chữ trong sheet để ghép yêu cầu, không kiểm tra ảnh trên Drive.
      const r = labelRows(await quick.sheets.readTab(cfg.spreadsheetId, cfg.tab), cfg, new Map()).find((x) => x.row === row);
      if (!r) return c.text(`Dòng ${row} không còn dữ liệu.`, 404);
      const folder = readFolder(c.req.query("folder") ?? "", "");
      if (folder && "error" in folder) return c.text(folder.error, 400);
      const plan = await planForRows(quick, cfg, [r], folder?.id);
      return c.text(plan.ok ? plan.runs[0]!.requestText : plan.message);
    } catch (e) {
      return c.text(describeGoogleError(e, clientEmail), 502);
    }
  });

  // Sửa ngay trên Bảng (D18). Chỉ nhận JSON: trang khác không gửi được kiểu này tới tool mà không bị trình duyệt chặn.
  async function editRequest(c: Context): Promise<{ cfg: SheetConfig; body: Record<string, unknown>; deps: EditDeps } | Response> {
    if (!(c.req.header("content-type") ?? "").startsWith("application/json")) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 415);
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    }
    const cfg = getSheetConfig(db, String(body.id ?? ""), String(body.tab ?? ""));
    if (!cfg || !sheets || !drive) return c.json({ ok: false, message: "Chưa kết nối sheet này hoặc chưa nạp khoá Google." }, 400);
    return { cfg, body, deps: { db, sheets, drive } };
  }
  const googleFail = (c: Context, e: unknown, what: string) => {
    logger.warn({ err: e }, what);
    return c.json({ ok: false, message: e instanceof GoogleApiError ? describeGoogleError(e, clientEmail) : e instanceof Error ? e.message : String(e) }, 502);
  };

  app.post("/bang/sua", async (c) => {
    const req = await editRequest(c);
    if (req instanceof Response) return req;
    const { cfg, body, deps } = req;
    if (!isEditField(body.field)) return c.json({ ok: false, message: "Ô này không sửa được trong tool." }, 400);
    try {
      const r = await editCell(deps, cfg, { row: Number(body.row), field: body.field, expected: String(body.expected ?? ""), value: String(body.value ?? "") });
      if (r.ok && r.changed) logger.info({ spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, row: Number(body.row), field: body.field }, "Đã sửa ô từ Bảng");
      return c.json(r);
    } catch (e) {
      return googleFail(c, e, "Không sửa được ô từ Bảng");
    }
  });

  app.post("/bang/them-dong", async (c) => {
    const req = await editRequest(c);
    if (req instanceof Response) return req;
    const { cfg, body, deps } = req;
    try {
      const r = await addRow(deps, cfg, { image: String(body.image ?? ""), shirt: String(body.shirt ?? ""), prompt: String(body.prompt ?? "") });
      if (r.ok) logger.info({ spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, row: r.row }, "Đã thêm dòng từ Bảng");
      return c.json(r);
    } catch (e) {
      return googleFail(c, e, "Không thêm được dòng từ Bảng");
    }
  });

  const rowsText = (ns: number[]) => ns.join(", ");
  const skippedText = (s: { row: number; why: string }[]) => (s.length ? ` Bỏ qua: ${s.map((x) => `dòng ${x.row} (${x.why})`).join("; ")}.` : "");

  app.post("/bang/dai-prompt/xem", async (c) => {
    const req = await editRequest(c);
    if (req instanceof Response) return req;
    const { cfg, body, deps } = req;
    const mode = body.mode === "down" ? "down" : "rows";
    const rows = mode === "rows" ? parseRowList(String(body.rows ?? "")) : [];
    if (rows === null) return c.json({ ok: false, message: "Ô dòng chưa đúng dạng, ví dụ: 3-6, 9" });
    try {
      const r = await planFill(deps, cfg, { source: Number(body.source), mode, rows, includeVideo: body.includeVideo === true });
      if (!r.ok) return c.json(r);
      const t = r.plan.targets.map((x) => x.row);
      const summary = t.length
        ? `Sẽ thay prompt của ${t.length} dòng (dòng ${rowsText(t)}) bằng prompt của dòng ${Number(body.source)}.${skippedText(r.plan.skipped)}`
        : `Không có dòng nào cần thay.${skippedText(r.plan.skipped)}`;
      return c.json({ ok: true, plan: r.plan, summary });
    } catch (e) {
      return googleFail(c, e, "Không xem trước được dải prompt");
    }
  });

  app.post("/bang/dai-prompt", async (c) => {
    const req = await editRequest(c);
    if (req instanceof Response) return req;
    const { cfg, body, deps } = req;
    const targets = (Array.isArray(body.targets) ? body.targets : []).map((t) => ({ row: Number((t as { row?: unknown }).row), old: String((t as { old?: unknown }).old ?? "") }));
    try {
      const r = await applyFill(deps, cfg, { prompt: String(body.prompt ?? ""), targets });
      logger.info({ spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, rows: r.written }, "Đã dải prompt từ Bảng");
      const parts = [r.written.length ? `Đã thay prompt của ${r.written.length} dòng (dòng ${rowsText(r.written)}).` : "Chưa ghi dòng nào."];
      if (r.conflicts.length) parts.push(`${CONFLICT_TEXT} nên không ghi: dòng ${rowsText(r.conflicts.map((x) => x.row))}.`);
      parts.push(skippedText(r.skipped).trim());
      return c.json({ ok: true, written: r.written.length, message: parts.filter(Boolean).join(" ") });
    } catch (e) {
      return googleFail(c, e, "Không dải được prompt");
    }
  });

  app.post("/bang/run", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const id = typeof body.id === "string" ? body.id : "";
    const tab = typeof body.tab === "string" ? body.tab : "";
    const nums = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(Number).filter(Number.isInteger);
    const cfg = getSheetConfig(db, id, tab);
    if (!cfg || !quick) return c.text("Yêu cầu không hợp lệ", 400);
    const back = (q: string) => c.redirect(tableUrl(id, tab, q), 303);
    if (!runner) return back(`&msg=${encodeURIComponent("Chưa nạp được khoá Google nên chưa chạy được bot.")}`);
    const active = activeBatch(db);
    if (active) return back(`&msg=${encodeURIComponent(`Lô #${active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo video tiếp.`)}`);

    const folder = readFolder(typeof body.folder === "string" ? body.folder : "", typeof body.folderLink === "string" ? body.folderLink : "");
    if (folder && "error" in folder) return back(`&msg=${encodeURIComponent(folder.error)}`);
    const r = await quickCreateBatch(quick, cfg, nums(body.row), new Set(nums(body.overwrite)), folder?.id);
    if (!r.ok) return back(`&msg=${encodeURIComponent(r.message)}`);
    if (folder) setCookie(c, FOLDER_COOKIE, folder.id, { path: "/", maxAge: YEAR, sameSite: "Lax" });
    logger.info({ batchId: r.batchId, spreadsheetId: id, tab, rows: r.runs.map((x) => x.row) }, "Đã tạo lô từ Bảng");
    const started = runner.start(r.batchId);
    if (!started.ok) return back(`&msg=${encodeURIComponent(started.message)}`);
    const skipped = r.rejected.length ? ` Bỏ qua vì dữ liệu vừa đổi: ${r.rejected.map((x) => `dòng ${x.row} (${x.why})`).join("; ")}.` : "";
    return back(`&ok=${encodeURIComponent(`Đang tạo video cho ${r.runs.length} dòng. Bot gửi lần lượt từng dòng cho Muse; bảng tự cập nhật.${skipped}`)}`);
  });

  const batchAction = (path: string, act: (batchId: number) => string) =>
    app.post(path, async (c) => {
      const body = await c.req.parseBody();
      const batchId = Number(body.batch);
      const id = String(body.id ?? "");
      const tab = String(body.tab ?? "");
      const text = Number.isInteger(batchId) ? act(batchId) : "Yêu cầu không hợp lệ";
      return c.redirect(tableUrl(id, tab, `&msg=${encodeURIComponent(text)}`), 303);
    });
  batchAction("/bang/pause", (b) =>
    runner?.pause(b) ? "Đã nhận Tạm dừng: dòng đang chờ Muse vẫn được theo dõi cho xong, các dòng sau chờ bấm Tiếp tục." : "Lô này không đang chạy.",
  );
  batchAction("/bang/continue", (b) => {
    if (!runner) return "Chưa sẵn sàng chạy bot.";
    const r = runner.start(b);
    return r.ok ? "Đã tiếp tục." : r.message;
  });
  batchAction("/bang/cancel", (b) => {
    if (!runner) return "Chưa sẵn sàng chạy bot.";
    const r = runner.cancel(b);
    return !r.ok ? r.message : r.immediate ? "Đã huỷ lô." : "Đã nhận Huỷ: dòng đang chờ Muse vẫn được theo dõi cho xong, các dòng còn lại không gửi.";
  });

  app.post("/bang/open-muse", async (c) => {
    const body = await c.req.parseBody();
    const back = tableUrl(String(body.id ?? ""), String(body.tab ?? ""));
    if (!bot) return c.redirect(back, 303);
    try {
      await bot.open();
      return c.redirect(back, 303);
    } catch (e) {
      logger.warn({ err: e }, "Không mở được trình duyệt bot");
      return c.redirect(`${back}&msg=${encodeURIComponent("Không mở được Chrome. Kiểm tra máy đã cài Google Chrome.")}`, 303);
    }
  });
}

function TableHeader(props: {
  configs: SheetConfig[];
  cfg: SheetConfig;
  quota: { used: number; limit: number; remaining: number };
  active?: { id: number; status: string; pauseReason: string | null };
  bot?: MuseBot;
}) {
  const { cfg, active, quota } = props;
  const needLogin = active?.status === "paused" && active.pauseReason === "login";
  return (
    <div class="bang-head">
      <form method="get" action="/" class="row">
        <select
          name="pick"
          aria-label="Chọn sheet và trang tính"
          onchange="var v=JSON.parse(this.value);location.href='/?id='+encodeURIComponent(v[0])+'&tab='+encodeURIComponent(v[1])"
        >
          {props.configs.map((x) => (
            <option value={JSON.stringify([x.spreadsheetId, x.tab])} selected={x.spreadsheetId === cfg.spreadsheetId && x.tab === cfg.tab}>
              📄 {sheetName(x)} › {x.tab}
            </option>
          ))}
        </select>
        <a class="button secondary" href={tableUrl(cfg.spreadsheetId, cfg.tab)} title="Đọc lại sheet">
          🔄 Làm mới
        </a>
        <a class="button secondary" href="/ket-noi" title="Kết nối thêm một file sheet hoặc trang tính">
          + Thêm sheet
        </a>
      </form>
      <div class="row small">
        <span class="pill" title="Giới hạn video mỗi ngày để giữ tài khoản Muse an toàn. Đổi ở ⚙ Nâng cao → Cài đặt.">
          Hôm nay <strong>{quota.used}/{quota.limit}</strong> video
          {quota.remaining === 0 ? <span class="warn-text"> · đã đủ, mai làm tiếp</span> : <span class="muted"> · còn {quota.remaining}</span>}
        </span>
        <span class={`pill ${needLogin ? "bad" : ""}`}>
          {needLogin ? "⚠ Cần đăng nhập Muse" : props.bot?.isOpen ? "Muse: cửa sổ bot đang mở" : "Muse: tự mở khi tạo video"}
        </span>
        <form method="post" action="/bang/open-muse">
          <input type="hidden" name="id" value={cfg.spreadsheetId} />
          <input type="hidden" name="tab" value={cfg.tab} />
          <button type="submit" class="secondary small">
            Mở cửa sổ Muse
          </button>
        </form>
      </div>
    </div>
  );
}

function ActiveBatchBox(props: { active?: { id: number; status: string; pauseReason: string | null }; runner?: BatchRunner; cfg: SheetConfig; db: DB }) {
  const { active, runner, cfg, db } = props;
  if (!active) return null;
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(state IN ('done','failed','needs_review','skipped_has_video','canceled')) AS finished FROM runs WHERE batchId = ?`,
    )
    .get(active.id) as { total: number; finished: number | null };
  const b = db.prepare("SELECT spreadsheetId, tab FROM batches WHERE id = ?").get(active.id) as { spreadsheetId: string; tab: string };
  const here = b.spreadsheetId === cfg.spreadsheetId && b.tab === cfg.tab;
  const live = runner?.runningBatchId === active.id;
  const notice = runner?.notices.get(active.id);
  const hidden = (
    <>
      <input type="hidden" name="batch" value={String(active.id)} />
      <input type="hidden" name="id" value={cfg.spreadsheetId} />
      <input type="hidden" name="tab" value={cfg.tab} />
    </>
  );
  const reason = active.pauseReason as PauseReason | null;
  return (
    <div class={`card ${active.status === "running" && !notice ? "running-box" : "warn"}`} role="status">
      <div class="row-between">
        <div>
          <strong>
            {active.status === "running"
              ? `Đang tạo video: ${counts.finished ?? 0}/${counts.total} dòng xong`
              : `Đã tạm dừng: ${counts.finished ?? 0}/${counts.total} dòng xong`}
          </strong>
          {!here && (
            <span class="muted small">
              {" "}
              · ở trang tính khác (<a href={tableUrl(b.spreadsheetId, b.tab)}>{b.tab}</a>)
            </span>
          )}
          {active.status === "paused" && reason && (
            <div>
              {reason === "login" ? "Hãy đăng nhập Muse trong cửa sổ bot (hoặc vượt bước kiểm tra bảo mật) rồi bấm Tiếp tục." : PAUSE_TEXT[reason] ?? reason}
            </div>
          )}
          {notice && <div>{notice}</div>}
          <div class="muted small">
            <a href={`/batch/${active.id}`}>Chi tiết lô #{active.id}</a>
          </div>
        </div>
        <div class="row">
          {active.status === "paused" && !live && (
            <form method="post" action="/bang/continue">
              {hidden}
              <button type="submit">Tiếp tục</button>
            </form>
          )}
          {active.status === "running" && live && (
            <form method="post" action="/bang/pause">
              {hidden}
              <button type="submit" class="secondary">
                Tạm dừng
              </button>
            </form>
          )}
          <form method="post" action="/bang/cancel" onsubmit="return confirm('Huỷ lô này? Các dòng chưa gửi Muse sẽ không được gửi nữa.')">
            {hidden}
            <button type="submit" class="secondary">
              Huỷ
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
