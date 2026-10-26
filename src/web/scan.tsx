import type { Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import { getDailyQuota, type DailyQuota } from "../db/quota.js";
import { getSheetConfig, listSheetConfigs, type SheetConfig } from "../db/sheetConfigs.js";
import { columnIndex } from "../google/a1.js";
import type { DriveClient } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import type { SheetsClient } from "../google/sheets.js";
import { logger } from "../logger.js";
import { isRunningStatus, LABEL_TEXT, type RowLabel, type ScannedRow } from "../scan/labels.js";
import { parseRowRanges } from "../scan/ranges.js";
import { scanTab } from "../scan/scan.js";
import type { ThumbnailCache } from "../scan/thumbnails.js";
import { Layout } from "./layout.js";

export interface ScanDeps {
  config: AppConfig;
  db: DB;
  sheets?: SheetsClient;
  drive?: DriveClient;
  thumbs?: ThumbnailCache;
}

const LABEL_ORDER: RowLabel[] = ["ready", "has_video", "running", "missing_data"];
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,}$/;

const scanUrl = (id: string, tab: string, extra = "") =>
  `/scan?id=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}${extra}`;

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function Alert(props: { kind: "warn" | "ok"; children: Child }) {
  return (
    <div class={`card ${props.kind}`} role={props.kind === "warn" ? "alert" : "status"}>
      {props.children}
    </div>
  );
}

function QuotaBox(props: { quota: DailyQuota }) {
  const q = props.quota;
  return (
    <div class="card quota">
      Hôm nay: <strong>{q.used}/{q.limit} video</strong>
      <span class="muted"> · còn {q.remaining} lượt (giới hạn mỗi ngày, D13)</span>
    </div>
  );
}

function RowView(props: { r: ScannedRow; cfg: SheetConfig; thumbs?: ThumbnailCache }) {
  const { r, cfg, thumbs } = props;
  const thumb = r.imageFileId && thumbs?.isKnown(r.imageFileId);
  return (
    <tr data-row={String(r.row)} data-label={r.label}>
      <td>
        <input type="checkbox" class="sel" name="row" value={String(r.row)} form="run" disabled={!r.selectable} aria-label={`Chọn dòng ${r.row}`} />
      </td>
      <td>{r.row}</td>
      <td>
        {thumb ? (
          <img class="thumb" src={`/thumb/${r.imageFileId}`} alt={`Ảnh dòng ${r.row}`} loading="lazy" width="64" height="64" />
        ) : (
          <span class="muted">—</span>
        )}
      </td>
      <td class="prompt" title={r.prompt}>
        {r.prompt ? truncate(r.prompt, 160) : <span class="muted">(trống)</span>}
      </td>
      <td>
        {r.status || <span class="muted">—</span>}
        {r.video && (
          <div>
            {/^https?:\/\//.test(r.video) ? (
              <a href={r.video} target="_blank" rel="noreferrer">
                Xem video
              </a>
            ) : (
              <span class="muted">{truncate(r.video, 40)}</span>
            )}
          </div>
        )}
      </td>
      <td>
        <span class={`badge b-${r.label}`}>{LABEL_TEXT[r.label]}</span>
        {r.problems.length > 0 && r.label !== "ready" && (
          <ul class="problems">
            {r.problems.map((p) => (
              <li>{p}</li>
            ))}
          </ul>
        )}
      </td>
      <td>
        {r.label === "has_video" && r.canOverwrite && (
          <label class="inline">
            <input type="checkbox" class="ow" name="overwrite" value={String(r.row)} form="run" /> Ghi đè
          </label>
        )}
        {r.label === "running" && (
          <form
            method="post"
            action="/scan/unlock"
            onsubmit={`return confirm('Bỏ khoá dòng ${r.row}? Chỉ làm khi chắc chắn dòng này KHÔNG còn chạy ở đâu (Muse có thể vẫn đang tạo video).')`}
          >
            <input type="hidden" name="id" value={cfg.spreadsheetId} />
            <input type="hidden" name="tab" value={cfg.tab} />
            <input type="hidden" name="row" value={String(r.row)} />
            <button type="submit" class="secondary">
              Bỏ khoá
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

// Chạy trong trình duyệt. parseRowRanges được nhúng nguyên mã để server và trình duyệt hiểu "2-5, 8" như nhau.
const CLIENT_JS = `
${parseRowRanges.toString()}
(function () {
  var run = document.getElementById("run");
  if (!run) return;
  var remaining = Number(run.dataset.remaining), limit = Number(run.dataset.limit);
  var rows = Array.prototype.slice.call(document.querySelectorAll("tr[data-row]"));
  var byRow = {};
  rows.forEach(function (tr) { byRow[tr.dataset.row] = tr; });
  var LABEL = { has_video: "Đã có video", running: "Đang chạy", missing_data: "Thiếu dữ liệu" };

  function sel(tr) { return tr.querySelector(".sel"); }
  function ow(tr) { return tr.querySelector(".ow"); }
  function update() {
    var n = rows.filter(function (tr) { return sel(tr).checked; }).length;
    document.getElementById("count").textContent = "Đã chọn " + n + " dòng";
    var btn = document.getElementById("runBtn"), msg = document.getElementById("runMsg");
    msg.textContent = "";
    if (n > remaining) {
      msg.textContent = remaining === 0
        ? "Hôm nay đã đủ " + limit + " video. Thử lại vào ngày mai hoặc tăng giới hạn trong Cài đặt."
        : "Hôm nay chỉ còn " + remaining + " video (giới hạn " + limit + "/ngày). Bỏ bớt " + (n - remaining) + " dòng.";
    }
    btn.disabled = n === 0 || n > remaining;
  }
  rows.forEach(function (tr) {
    sel(tr).addEventListener("change", update);
    var o = ow(tr);
    if (o) o.addEventListener("change", function () {
      sel(tr).disabled = !o.checked;
      if (!o.checked) sel(tr).checked = false;
      update();
    });
  });
  document.getElementById("selectReady").addEventListener("click", function () {
    rows.forEach(function (tr) { if (tr.dataset.label === "ready") sel(tr).checked = true; });
    update();
  });
  document.getElementById("clearSel").addEventListener("click", function () {
    rows.forEach(function (tr) { sel(tr).checked = false; });
    document.getElementById("rangeMsg").textContent = "";
    update();
  });
  function applyRange() {
    var r = parseRowRanges(document.getElementById("range").value);
    var skipped = [];
    rows.forEach(function (tr) { sel(tr).checked = false; });
    r.rows.forEach(function (n) {
      var tr = byRow[n];
      if (!tr) { skipped.push(n + " (không có dữ liệu)"); return; }
      if (sel(tr).disabled) {
        var why = LABEL[tr.dataset.label] || "không chọn được";
        if (tr.dataset.label === "has_video" && ow(tr)) why += ", cần tích Ghi đè";
        skipped.push(n + " (" + why + ")");
        return;
      }
      sel(tr).checked = true;
    });
    var parts = [];
    if (r.errors.length) parts.push("Không hiểu: " + r.errors.join(", "));
    if (skipped.length) parts.push("Bỏ qua: " + skipped.join("; "));
    document.getElementById("rangeMsg").textContent = parts.join(" · ");
    update();
  }
  document.getElementById("applyRange").addEventListener("click", applyRange);
  document.getElementById("range").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); applyRange(); }
  });
  update();
})();
`;

export function registerScanRoutes(app: Hono, deps: ScanDeps) {
  const { config, db, sheets, drive, thumbs } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (title: string, body: Child) => "<!doctype html>" + <Layout title={title}>{body}</Layout>;
  const noClient = (
    <Alert kind="warn">
      Chưa nạp được khoá service account nên chưa quét được sheet. Xem hướng dẫn ở <a href="/">trang chủ</a>.
    </Alert>
  );

  app.get("/scan", async (c) => {
    const id = c.req.query("id");
    const tab = c.req.query("tab");
    if (!sheets || !drive) return c.html(page("Quét và chọn dòng", <><h1>Quét và chọn dòng</h1>{noClient}</>));

    if (!id || tab === undefined) {
      const configs = listSheetConfigs(db);
      return c.html(
        page(
          "Quét và chọn dòng",
          <>
            <h1>Quét và chọn dòng</h1>
            {configs.length === 0 ? (
              <Alert kind="warn">
                Chưa có sheet nào được ánh xạ cột. Vào <a href="/sheets">Kết nối sheet</a> trước.
              </Alert>
            ) : (
              <div class="card">
                <div class="muted">Chọn sheet/tab để quét:</div>
                <ul>
                  {configs.map((cfg) => (
                    <li>
                      <a class="button" href={scanUrl(cfg.spreadsheetId, cfg.tab)}>
                        Quét
                      </a>{" "}
                      tab <strong>{cfg.tab}</strong> <span class="muted">({cfg.spreadsheetId.slice(0, 8)}…)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>,
        ),
      );
    }

    const cfg = getSheetConfig(db, id, tab);
    if (!cfg) {
      return c.html(
        page("Quét và chọn dòng", <><h1>Quét và chọn dòng</h1><Alert kind="warn">Tab "{tab}" chưa được ánh xạ cột. Vào <a href="/sheets">Kết nối sheet</a>.</Alert></>),
        404,
      );
    }

    let result;
    try {
      result = await scanTab(sheets, drive, cfg);
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: id, tab }, "Không quét được tab");
      return c.html(page("Quét và chọn dòng", <><h1>Quét · {tab}</h1><Alert kind="warn">{describeGoogleError(e, clientEmail)}</Alert></>), 502);
    }
    thumbs?.remember(result.images);
    const quota = getDailyQuota(db);
    const counts = LABEL_ORDER.map((l) => [l, result.rows.filter((r) => r.label === l).length] as const);
    logger.info({ spreadsheetId: id, tab, rows: result.rows.length }, "Đã quét tab");

    const unlocked = c.req.query("unlocked");
    const unlockFail = c.req.query("unlockFail");
    const notice = c.req.query("notice");

    return c.html(
      page(
        `Quét · ${tab}`,
        <>
          <h1>Quét · {tab}</h1>
          {unlocked && <Alert kind="ok">Đã bỏ khoá dòng {unlocked} (xoá chữ "Đang chạy" trong ô Trạng thái).</Alert>}
          {unlockFail && <Alert kind="warn">Không bỏ khoá dòng {unlockFail}: {notice ?? "ô Trạng thái không còn là \"Đang chạy\"."}</Alert>}
          <div class="row-between">
            <div class="muted">
              Quét lúc {new Date(result.scannedAt).toLocaleTimeString("vi-VN")} · {result.rows.length} dòng có dữ liệu ·{" "}
              {counts.map(([l, n], i) => (
                <>
                  {i > 0 && " · "}
                  {LABEL_TEXT[l]}: {n}
                </>
              ))}
            </div>
            <a class="button" href={scanUrl(id, tab)}>
              Quét lại
            </a>
          </div>
          <QuotaBox quota={quota} />
          <div class="card">
            <label for="range">Chọn theo khoảng dòng</label>
            <div class="row">
              <input id="range" type="text" placeholder="Ví dụ: 2-5, 8" />
              <button type="button" id="applyRange">
                Chọn theo khoảng
              </button>
              <button type="button" id="selectReady" class="secondary">
                Chọn mọi dòng chưa có video
              </button>
              <button type="button" id="clearSel" class="secondary">
                Bỏ chọn hết
              </button>
            </div>
            <div id="rangeMsg" class="muted" aria-live="polite"></div>
          </div>
          <form id="run" method="post" action="/batch/preview" class="card row-between" data-remaining={String(quota.remaining)} data-limit={String(quota.limit)}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="tab" value={tab} />
            <div>
              <strong id="count">Đã chọn 0 dòng</strong>
              <div id="runMsg" class="warn-text" aria-live="polite"></div>
            </div>
            <button type="submit" id="runBtn" disabled>
              Chạy
            </button>
          </form>
          {result.rows.length === 0 ? (
            <p class="muted">Tab chưa có dòng dữ liệu nào phía dưới dòng tiêu đề {cfg.headerRow}.</p>
          ) : (
            <div class="scroll">
              <table class="scan">
                <thead>
                  <tr>
                    <th>Chọn</th>
                    <th>Dòng</th>
                    <th>Ảnh</th>
                    <th>Prompt</th>
                    <th>Trạng thái</th>
                    <th>Nhãn</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <RowView r={r} cfg={cfg} thumbs={thumbs} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
        </>,
      ),
    );
  });

  app.post("/scan/unlock", async (c) => {
    const body = await c.req.parseBody();
    const id = String(body.id ?? "");
    const tab = String(body.tab ?? "");
    const row = Number(body.row);
    const cfg = getSheetConfig(db, id, tab);
    if (!sheets || !cfg || !Number.isInteger(row) || row <= cfg.headerRow) return c.text("Yêu cầu không hợp lệ", 400);

    try {
      // Đọc lại ngay trước khi ghi: chỉ xoá khi ô vẫn đúng là "Đang chạy".
      const cells = await sheets.readRow(id, tab, row);
      const status = cells[columnIndex(cfg.colStatus)] ?? "";
      if (!isRunningStatus(status)) return c.redirect(scanUrl(id, tab, `&unlockFail=${row}`), 303);
      await sheets.writeStatus(cfg, row, "");
      logger.info({ spreadsheetId: id, tab, row }, "Đã bỏ khoá dòng");
      return c.redirect(scanUrl(id, tab, `&unlocked=${row}`), 303);
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: id, tab, row }, "Không bỏ khoá được dòng");
      return c.redirect(scanUrl(id, tab, `&unlockFail=${row}&notice=${encodeURIComponent(describeGoogleError(e, clientEmail))}`), 303);
    }
  });

  app.get("/thumb/:fileId", async (c) => {
    const fileId = c.req.param("fileId");
    if (!thumbs || !DRIVE_FILE_ID.test(fileId) || !thumbs.isKnown(fileId)) return c.notFound();
    try {
      const img = await thumbs.get(fileId);
      if (!img) return c.notFound();
      return c.body(img.data as Uint8Array<ArrayBuffer>, 200, {
        "Content-Type": img.contentType,
        "Cache-Control": "private, max-age=3600",
      });
    } catch (e) {
      logger.warn({ err: e, fileId }, "Không lấy được ảnh thu nhỏ");
      return c.notFound();
    }
  });

  // Tạm thời ở CON-37: kiểm tra lại lựa chọn ở phía server rồi tóm tắt.
  // Chỉnh yêu cầu và gửi Muse làm ở CON-38 trở đi.
  app.post("/batch/preview", async (c) => batchPreview(c));

  async function batchPreview(c: Context) {
    const body = await c.req.parseBody({ all: true });
    const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(Number).filter(Number.isInteger);
    const id = String(body.id ?? "");
    const tab = String(body.tab ?? "");
    const rows = [...new Set(list(body.row))].sort((a, b) => a - b);
    const overwrite = new Set(list(body.overwrite));
    const cfg = getSheetConfig(db, id, tab);
    if (!sheets || !drive || !cfg) return c.text("Yêu cầu không hợp lệ", 400);

    const back = <a href={scanUrl(id, tab)}>← Quay lại bảng quét</a>;
    const quota = getDailyQuota(db);
    if (rows.length === 0) return c.html(page("Chạy", <><h1>Chạy</h1><Alert kind="warn">Chưa chọn dòng nào.</Alert>{back}</>), 400);
    if (rows.length > quota.remaining) {
      return c.html(
        page("Chạy", <><h1>Chạy</h1><QuotaBox quota={quota} /><Alert kind="warn">Đã chọn {rows.length} dòng nhưng hôm nay chỉ còn {quota.remaining} video.</Alert>{back}</>),
        400,
      );
    }

    // Quét lại để chắc các dòng vẫn chọn được (có thể ai đó vừa dán link video hay đổi dữ liệu).
    let scanned;
    try {
      scanned = await scanTab(sheets, drive, cfg);
    } catch (e) {
      return c.html(page("Chạy", <><h1>Chạy</h1><Alert kind="warn">{describeGoogleError(e, clientEmail)}</Alert>{back}</>), 502);
    }
    const byRow = new Map(scanned.rows.map((r) => [r.row, r]));
    const accepted: ScannedRow[] = [];
    const rejected: { row: number; why: string }[] = [];
    for (const n of rows) {
      const r = byRow.get(n);
      if (!r) rejected.push({ row: n, why: "không còn dữ liệu" });
      else if (r.selectable) accepted.push(r);
      else if (r.label === "has_video" && r.canOverwrite && overwrite.has(n)) accepted.push(r);
      else rejected.push({ row: n, why: LABEL_TEXT[r.label] });
    }

    return c.html(
      page(
        "Chạy",
        <>
          <h1>Các dòng sẽ chạy · {tab}</h1>
          <QuotaBox quota={quota} />
          {rejected.length > 0 && (
            <Alert kind="warn">
              Đã bỏ khỏi lô vì dữ liệu vừa thay đổi: {rejected.map((r) => `dòng ${r.row} (${r.why})`).join("; ")}.
            </Alert>
          )}
          <div class="card">
            <ul>
              {accepted.map((r) => (
                <li>
                  Dòng {r.row}
                  {r.label === "has_video" && <strong> · Ghi đè</strong>}: <span class="muted">{truncate(r.prompt, 100)}</span>
                </li>
              ))}
            </ul>
          </div>
          <Alert kind="warn">
            Bước tiếp theo (sửa prompt, thêm yêu cầu, chọn thư mục Drive, xem trước yêu cầu gửi Muse) sẽ có ở ticket CON-38. Chưa có gì được gửi
            cho Muse.
          </Alert>
          {back}
        </>,
      ),
    );
  }
}
