import fs from "node:fs";
import type { Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import { addNhanVat, deleteNhanVat, fileInUse, getNhanVat, listNhanVat, nhanVatUsage, renameNhanVat, setNhanVatFace, setNhanVatFile, setNhanVatMaster, tenProblem, type NhanVat } from "../anh/nhanVat.js";
import {
  addRow,
  ANH_LABEL_TEXT,
  chooseFile,
  cleanupIds,
  countByFilter,
  deleteFile,
  deleteRows,
  FILTER_TEXT,
  FILTERS,
  filesOf,
  getFile,
  getRow,
  isFilter,
  labelOf,
  listRows,
  lockedAnhRows,
  mainFile,
  setBackOn,
  setNhanVat,
  setPrompt,
  SIDE_TEXT,
  SIDES,
  splitPrompts,
  type AnhFile,
  type AnhFilter,
  type AnhLabel,
  type AnhRow,
  type Side,
} from "../anh/rows.js";
import { applyExport, planExport } from "../anh/export.js";
import { estimateAnhText, insertAnhBatch, planAnhBatch } from "../anh/run.js";
import { ANH_TAO_DIR, BangFiles, formatBytes, imageProblem, NHAN_VAT_DIR, typeOf } from "../bang/files.js";
import type { AppConfig } from "../config.js";
import { activeBatch } from "../db/history.js";
import type { DB } from "../db/index.js";
import { getImageQuota } from "../db/quota.js";
import { getSettings, setLastNhanVat } from "../db/settings.js";
import { logger } from "../logger.js";
import type { BatchRunner } from "../queue/runner.js";
import { APP_NAME } from "../version.js";
import { Alert, Hidden, truncate } from "./components.js";
import { Layout } from "./layout.js";
import { draftOfNhanVat } from "../anh/taoNhanVat.js";
import { COPY_PROMPT_JS, NvDraftsCard, NvPromptsBox } from "./taoNhanVat.js";

// Bảng ảnh và trang Nhân vật (CON-77, spec v6.3 mục 17.13, D31–D33): chạy độc lập với Bảng video; Muse tạo ảnh theo
// character sheet của nhân vật, ảnh tải về máy (tep\anh-tao), người dùng chọn ảnh chính.

export interface BangAnhDeps {
  config: AppConfig;
  db: DB;
  runner?: BatchRunner;
}

const BASE = "/bang-anh";
const NV = "/nhan-vat";
const BADGE: Record<AnhLabel, string> = { ready: "b-ready", missing_data: "b-missing_data", running: "b-running", done: "b-has_video", review: "b-missing_data" };
const parseIds = (v: string) => v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);

const boardUrl = (o: { filter?: AnhFilter; q?: string; page?: number; ok?: string; loi?: string } = {}) => {
  const p = new URLSearchParams();
  if (o.filter && o.filter !== "all") p.set("loc", o.filter);
  if (o.q) p.set("q", o.q);
  if (o.page && o.page > 1) p.set("trang", String(o.page));
  if (o.ok) p.set("ok", o.ok);
  if (o.loi) p.set("loi", o.loi);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
};
export const anhUrl = (name: string) => `${BASE}/anh/${encodeURIComponent(name)}`;
/** Dòng của Bảng video (tìm theo số dòng). */
const videoRowUrl = (id: number) => `/bang-moi?q=${id}`;
export const sheetUrl =(name: string) => `${NV}/anh/${encodeURIComponent(name)}`;

/** Tên file khi tải ảnh về: MASYS_ANH_<dòng>_<truoc|sau>_<YYYYMMDD-HHmm>.<đuôi>, theo giờ máy lúc ảnh về. */
export function anhDownloadName(row: number, side: Side, at: string, file: string): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  const ext = file.split(".").pop() ?? "png";
  return `MASYS_ANH_${row}_${side}_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.${ext}`;
}

/** Chữ có dấu trong đoạn JS chạy trên trang viết thành \uXXXX (như Bảng video), để không phụ thuộc mã hoá trang. */
const ascii = (s: string) => s.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function page(title: string, body: Child) {
  return <Layout title={`${title} · ${APP_NAME}`}>{body}</Layout>;
}

/** Ô ảnh của một mặt: ảnh chính + ◀ ▶ xem các ảnh khác Muse trả, ★ chọn làm ảnh chính, ⬇ tải, 🗑 xoá. */
function ImagesCell(props: { row: AnhRow; side: Side; files: AnhFile[]; locked: boolean; label: AnhLabel }) {
  const list = props.files.filter((f) => f.side === props.side);
  const main = mainFile(props.files, props.side);
  if (props.side === "sau" && !props.row.backOn && !list.length) return <td class="muted small">—</td>;
  if (!main) {
    return <td class="muted small">{props.label === "running" ? "⏳" : "chưa có"}</td>;
  }
  const data = list.map((f) => ({ id: f.id, url: anhUrl(f.file), chosen: f.file === main.file ? 1 : 0 }));
  const idx = list.findIndex((f) => f.file === main.file);
  const what = `${SIDE_TEXT[props.side].toLowerCase()} dòng ${props.row.id}`;
  return (
    <td class="slot anh-cell" data-files={JSON.stringify(data)} data-idx={String(idx)}>
      <div class="slot-img">
        <a class="anh-big" href={anhUrl(main.file)} target="_blank" rel="noreferrer" title="Bấm để xem ảnh lớn">
          <img class="thumb" src={anhUrl(main.file)} alt={what} loading="lazy" width="64" height="64" />
        </a>
        <div class="slot-tools">
          {list.length > 1 && (
            <button type="button" class="edit anh-prev" title="Ảnh trước" aria-label={`Ảnh trước, ${what}`}>
              ◀
            </button>
          )}
          <span class="small anh-pos">
            {idx + 1}/{list.length}
          </span>
          {list.length > 1 && (
            <button type="button" class="edit anh-next" title="Ảnh sau" aria-label={`Ảnh sau, ${what}`}>
              ▶
            </button>
          )}
        </div>
        <div class="slot-tools">
          <span class="anh-star small" title="Ảnh chính">
            ★
          </span>
          {!props.locked && list.length > 1 && (
            <button type="button" class="edit anh-choose" title="Chọn làm ảnh chính" aria-label={`Chọn làm ảnh chính, ${what}`} hidden>
              ☆
            </button>
          )}
          <a class="edit anh-dl" href={`${anhUrl(main.file)}?tai=1`} title="Tải về máy" aria-label={`Tải ${what}`}>
            ⬇
          </a>
          {!props.locked && (
            <button type="button" class="edit anh-del" title="Xoá ảnh này" aria-label={`Xoá ${what}`}>
              🗑
            </button>
          )}
        </div>
      </div>
    </td>
  );
}

function RowView(props: { row: AnhRow; files: AnhFile[]; locked: boolean; chars: NhanVat[] }) {
  const r = props.row;
  const own = labelOf(r);
  const { label, problems } = props.locked && own.label !== "running" ? { label: "running" as const, problems: [] } : own;
  const busy = props.locked || label === "running";
  return (
    <tr data-row={r.id} data-label={label}>
      <td>
        <input type="checkbox" class="pick-row" value={r.id} aria-label={`Chọn dòng ${r.id}`} disabled={busy} />
      </td>
      <td>{r.id}</td>
      <td>
        <select class="nv-pick" aria-label={`Nhân vật dòng ${r.id}`} disabled={busy} style="min-width:120px">
          {!r.nhanVatTen && <option value="">{r.nhanVatId ? "(đã xoá)" : "(chọn)"}</option>}
          {props.chars.map((c) => (
            <option value={c.id} selected={c.id === r.nhanVatId}>
              {c.ten}
            </option>
          ))}
        </select>
      </td>
      <td class="prompt" data-value={r.prompt}>
        <div class="cellwrap">
          <div class="cellbody">{r.prompt ? truncate(r.prompt, 160) : <span class="muted">(chưa có prompt)</span>}</div>
          {!busy && (
            <button type="button" class="edit prompt-edit" title="Sửa prompt" aria-label={`Sửa prompt dòng ${r.id}`}>
              ✎
            </button>
          )}
        </div>
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="back-on" checked={!!r.backOn} disabled={busy} aria-label={`Thêm ảnh quay lưng dòng ${r.id}`} />
      </td>
      {SIDES.map((s) => (
        <ImagesCell row={r} side={s} files={props.files} locked={busy} label={label} />
      ))}
      <td>
        <span class={`badge ${BADGE[label]}`}>{ANH_LABEL_TEXT[label]}</span>
        {label === "running" && r.runPhase === "back" && <div class="muted small">đang làm ảnh quay lưng</div>}
        {problems.length > 0 && (
          <ul class="problems">
            {problems.map((p) => (
              <li>{p}</li>
            ))}
          </ul>
        )}
        {r.exportedBangRowId && (
          <div class="small">
            {r.exportedAlive ? (
              <a href={videoRowUrl(r.exportedBangRowId)} title="Mở dòng này trên Bảng video">
                Đã xuất → dòng #{r.exportedBangRowId}
              </a>
            ) : (
              <span class="muted">Đã xuất → dòng #{r.exportedBangRowId} (đã xoá trên Bảng video)</span>
            )}
          </div>
        )}
        <div class="small">
          {r.museChatUrl && (
            <a href={r.museChatUrl} target="_blank" rel="noreferrer" title="Mở cuộc trò chuyện Muse của dòng này">
              Mở trong Muse ↗
            </a>
          )}
          {!busy && (label === "done" || label === "review") && (
            <>
              {r.museChatUrl && " · "}
              <a href={`${BASE}/chuan-bi?ids=${r.id}`} title="Tạo lại ảnh cho dòng này (ảnh cũ vẫn giữ)">
                Tạo lại
              </a>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Một ô ảnh trên thẻ nhân vật (CON-88): bấm dấu + chọn ảnh, chọn xong là tải lên ngay. */
function NvSlot(props: { action: string; label: string; ten: string; file: string | null; url: string | null; width: number }) {
  const { action, label, ten, file, url, width } = props;
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  const verb = `${file ? "Đổi" : "Thêm"} ${lower}`;
  return (
    <figure class="nv-slot">
      <div class="nv-box" style={`width:${width}px`}>
        {file && url && (
          <a href={url} target="_blank" rel="noreferrer" title={`Bấm để xem ${lower} lớn`}>
            <img src={url} alt={`${lower} ${ten}`} loading="lazy" />
          </a>
        )}
        <form method="post" action={action} enctype="multipart/form-data">
          <label class={file ? "nv-plus goc" : "nv-plus giua"} title={verb}>
            <b>+</b>
            {!file && <span class="muted small">Chưa có {lower}</span>}
            <input name="file" type="file" accept="image/jpeg,image/png,image/webp" data-nv-upload="1" aria-label={`${verb} cho ${ten}`} />
          </label>
        </form>
      </div>
      <figcaption class="small muted">{label}</figcaption>
    </figure>
  );
}

/** Chọn file xong (bấm xác nhận trên cửa sổ Windows) là gửi luôn; bấm Cancel thì không có sự kiện change nên không đổi gì. */
const NV_UPLOAD_JS = `
document.addEventListener("change", function (e) {
  var i = e.target;
  if (!i.getAttribute || !i.getAttribute("data-nv-upload") || !i.files.length) return;
  i.closest("label").querySelector("b").textContent = "\\u2026";
  i.form.submit();
});
`;

export function registerBangAnhRoutes(app: Hono, deps: BangAnhDeps) {
  const { db, config } = deps;
  const files = new BangFiles(config.dataDir);

  /** Nhân vật mặc định cho dòng mới: nhân vật dùng gần nhất còn trong thư viện, không thì nhân vật đầu tiên. */
  const defaultNhanVat = (chars: NhanVat[]) => chars.find((c) => c.id === getSettings(db).lastNhanVatId) ?? chars[0];

  const board = (c: Context) => {
    const filter = isFilter(c.req.query("loc")) ? (c.req.query("loc") as AnhFilter) : "all";
    const q = (c.req.query("q") ?? "").trim();
    const list = listRows(db, { filter, q, page: Number(c.req.query("trang") ?? 1) || 1 });
    const counts = countByFilter(db);
    const locked = lockedAnhRows(db);
    const quota = getImageQuota(db);
    const chars = listNhanVat(db);
    const def = defaultNhanVat(chars);
    const fileMap = filesOf(db, list.rows.map((r) => r.id));
    const ok = c.req.query("ok");
    const err = c.req.query("loi");
    const readyIds = list.rows.filter((r) => labelOf(r).label === "ready" && !locked.has(r.id)).map((r) => r.id);
    const active = activeBatch(db);
    const blocked = active ? `Lô #${active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo ảnh tiếp.` : "";
    const live = !!active && deps.runner?.runningBatchId === active.id && locked.size > 0;
    return c.html(
      page(
        "Bảng ảnh",
        <>
          <div class="bang-head">
            <h1 style="margin:0">Bảng ảnh</h1>
            <div class="row">
              <span class="pill" title="Số lượt xin ảnh đã gửi Muse hôm nay / giới hạn ảnh mỗi ngày (Cài đặt)">
                Hôm nay {quota.used}/{quota.limit} ảnh
              </span>
              <span class="pill" title="Ảnh Muse tạo và character sheet đang lưu trên máy này">
                Đang dùng {formatBytes(files.usedBytes([ANH_TAO_DIR, NHAN_VAT_DIR]))}
              </span>
              <a class="button secondary" href={NV}>
                👤 Nhân vật ({chars.length})
              </a>
            </div>
          </div>
          {chars.length === 0 && (
            <Alert kind="warn">
              Chưa có nhân vật nào. Vào <a href={NV}>Nhân vật</a>, bấm <strong>+ Thêm nhân vật</strong> và chọn file character sheet, rồi quay lại
              đây thêm dòng.
            </Alert>
          )}
          {chars.length > 0 && list.total === 0 && !q && filter === "all" && (
            <Alert kind="ok">
              Mỗi dòng là một ảnh: chọn nhân vật, viết prompt (dáng, trang phục, bối cảnh), tích <strong>Quay lưng</strong> nếu cần thêm ảnh quay
              lưng của đúng người đó. Tích dòng rồi bấm <strong>▶ Tạo ảnh</strong>: bot gửi character sheet cho Muse, tải ảnh về và gắn vào dòng.
            </Alert>
          )}
          {ok && <Alert kind="ok">{ok}</Alert>}
          {err && <Alert kind="warn">{err}</Alert>}

          <div class="row-between">
            <div class="filters row">
              {FILTERS.map((f) => (
                <a class={`button small ${f === filter ? "" : "secondary"}`} href={boardUrl({ filter: f, q })}>
                  {FILTER_TEXT[f]} ({counts[f]})
                </a>
              ))}
            </div>
            <form method="get" action={BASE} class="row" style="flex-wrap:nowrap">
              {filter !== "all" && <Hidden name="loc" value={filter} />}
              <input type="search" name="q" value={q} placeholder="Tìm số dòng, prompt hoặc tên nhân vật" aria-label="Tìm" />
              <button type="submit" class="secondary">
                Tìm
              </button>
            </form>
          </div>

          {chars.length > 0 && (
            <div class="card">
              <div class="row" style="align-items:center">
                <label for="newNv" class="inline-label">
                  Nhân vật cho dòng mới
                </label>
                <select id="newNv" style="min-width:160px">
                  {chars.map((ch) => (
                    <option value={ch.id} selected={ch.id === def?.id}>
                      {ch.ten}
                    </option>
                  ))}
                </select>
                <button type="button" id="addOne">
                  + Thêm dòng
                </button>
                <button type="button" id="pasteToggle" class="secondary">
                  Dán nhiều prompt
                </button>
                <span id="addMsg" class="small warn-text"></span>
              </div>
              <div id="pasteBox" hidden style="margin-top:10px">
                <textarea id="pasteText" rows={6} placeholder="Mỗi dòng một prompt; mỗi prompt thành một dòng mới trên Bảng ảnh"></textarea>
                <div class="row" style="margin-top:8px;align-items:center">
                  <label class="inline">
                    <input type="checkbox" id="pasteBack" /> Tích Quay lưng cho các dòng này
                  </label>
                  <button type="button" id="pasteGo">
                    Thêm các dòng
                  </button>
                </div>
              </div>
            </div>
          )}

          <div id="banganh" data-ready={readyIds.join(",")} data-self={boardUrl({ filter, q, page: list.page })} data-live={live ? "1" : ""}>
            {list.total === 0 ? (
              <div class="card muted">{q || filter !== "all" ? "Không có dòng nào khớp." : "Chưa có dòng nào."}</div>
            ) : (
              <div class="scroll">
                <table class="bang bang-moi">
                  <thead>
                    <tr>
                      <th>Chọn</th>
                      <th>Dòng</th>
                      <th>Nhân vật</th>
                      <th>Prompt</th>
                      <th title="Tạo thêm ảnh quay lưng của đúng người đó, trong cùng cuộc trò chuyện">Quay lưng</th>
                      <th>{SIDE_TEXT.truoc}</th>
                      <th>{SIDE_TEXT.sau}</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <RowView row={r} files={fileMap.get(r.id) ?? []} locked={locked.has(r.id)} chars={chars} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {list.pages > 1 && (
              <div class="row pager">
                {list.page > 1 && (
                  <a class="button secondary small" href={boardUrl({ filter, q, page: list.page - 1 })}>
                    ‹ Trang trước
                  </a>
                )}
                <span class="muted">
                  Trang {list.page}/{list.pages} · {list.total} dòng
                </span>
                {list.page < list.pages && (
                  <a class="button secondary small" href={boardUrl({ filter, q, page: list.page + 1 })}>
                    Trang sau ›
                  </a>
                )}
              </div>
            )}
          </div>

          <div class="card actionbar">
            <div class="row" style="align-items:center">
              <button type="button" id="selReady" class="secondary">
                Chọn mọi dòng sẵn sàng (trang này)
              </button>
              {chars.length > 1 && (
                <span class="row" style="align-items:center;gap:4px">
                  <select id="bulkNv" aria-label="Nhân vật cho các dòng đã chọn" style="min-width:120px">
                    {chars.map((ch) => (
                      <option value={ch.id}>{ch.ten}</option>
                    ))}
                  </select>
                  <button type="button" id="bulkNvGo" class="secondary" disabled>
                    Đổi nhân vật dòng đã chọn
                  </button>
                </span>
              )}
              <button type="button" id="exportBtn" class="secondary" disabled title="Mỗi dòng đã chọn thành một dòng mới trên Bảng video, ảnh chính làm Mẫu trước / Mẫu sau">
                📤 Xuất sang Bảng video
              </button>
              <button type="button" id="delBtn" class="secondary" disabled>
                🗑 Xoá dòng đã chọn
              </button>
              <a class="button secondary" href={`${BASE}/don`}>
                Dọn tất cả
              </a>
            </div>
            <div class="run-right">
              <span id="runHint" class={`small ${blocked ? "warn-text" : "muted"}`}>{blocked || "Tích các dòng cần tạo ảnh."}</span>
              <button type="button" id="runBtn" disabled data-blocked={blocked ? "1" : ""}>
                ▶ Tạo ảnh
              </button>
            </div>
          </div>
          <script dangerouslySetInnerHTML={{ __html: ascii(BOARD_JS) }} />
        </>,
      ),
    );
  };
  app.get(BASE, board);

  // Ảnh Muse tạo: chỉ file trong tep\anh-tao. ?tai=1 → tải về với tên MASYS_ANH_<dòng>_<mặt>_<giờ>.
  app.get(`${BASE}/anh/:name`, (c) => {
    const name = c.req.param("name");
    const p = files.anhTaoPath(name);
    if (!p) return c.text("Không có ảnh", 404);
    const headers: Record<string, string> = { "Content-Type": typeOf(p), "Cache-Control": "private, max-age=31536000, immutable" };
    if (c.req.query("tai")) {
      const f = db.prepare("SELECT anhRowId, side, createdAt FROM anh_files WHERE file = ?").get(name) as { anhRowId: number; side: Side; createdAt: string } | undefined;
      if (f) headers["Content-Disposition"] = `attachment; filename="${anhDownloadName(f.anhRowId, f.side, f.createdAt, name)}"`;
    }
    return c.body(fs.readFileSync(p), 200, headers);
  });

  // Mọi yêu cầu sửa đều phải có header riêng (như Bảng video).
  const fromPage = (c: Context) => c.req.header("x-masys") === "1";
  const deny = (c: Context) => c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 403);
  const json = async (c: Context): Promise<Record<string, unknown> | null> => {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const editable = (id: number) => {
    if (!getRow(db, id)) return `Không có dòng ${id}.`;
    if (lockedAnhRows(db).has(id)) return `Dòng ${id} đang tạo ảnh, chưa sửa được.`;
    return null;
  };
  const sameSite = (c: Context) => {
    const site = c.req.header("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  };

  /** Thêm dòng: không có prompt → một dòng trống; có đoạn dán → mỗi dòng chữ một dòng mới. */
  app.post(`${BASE}/them`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const nv = getNhanVat(db, Number(body.nhanVatId));
    if (!nv) return c.json({ ok: false, message: "Chọn nhân vật trước (trang Nhân vật)." });
    const prompts = splitPrompts(String(body.prompts ?? ""));
    if (prompts.length > 500) return c.json({ ok: false, message: "Mỗi lần dán tối đa 500 prompt." });
    const back = body.backOn === true;
    const ids = (prompts.length ? prompts : [""]).map((p) => addRow(db, { nhanVatId: nv.id, prompt: p, backOn: back }));
    setLastNhanVat(db, nv.id);
    logger.info({ added: ids.length, nhanVatId: nv.id }, "Bảng ảnh: đã thêm dòng");
    return c.json({ ok: true, ids });
  });

  app.post(`${BASE}/prompt`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const id = Number(body?.row);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    setPrompt(db, id, String(body.prompt ?? ""));
    return c.json({ ok: true });
  });

  /** Đổi nhân vật của một hoặc nhiều dòng (bỏ qua dòng đang tạo ảnh). */
  app.post(`${BASE}/nhan-vat`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const nv = getNhanVat(db, Number(body.nhanVatId));
    if (!nv) return c.json({ ok: false, message: "Không có nhân vật này." });
    const ids = (Array.isArray(body.rows) ? body.rows : [body.row]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0) as number[];
    const okIds = ids.filter((id) => !editable(id));
    for (const id of okIds) setNhanVat(db, id, nv.id);
    setLastNhanVat(db, nv.id);
    const skipped = ids.length - okIds.length;
    return c.json({ ok: true, message: `Đã đổi nhân vật ${okIds.length} dòng sang ${nv.ten}.${skipped ? ` Bỏ qua ${skipped} dòng đang tạo ảnh.` : ""}` });
  });

  app.post(`${BASE}/quay-lung`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const id = Number(body?.row);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    setBackOn(db, id, body.on === true);
    return c.json({ ok: true });
  });

  /** ★ Chọn ảnh chính / 🗑 xoá một ảnh của dòng. */
  const fileAction = (kind: "chon" | "xoa") =>
    app.post(`${BASE}/${kind}-anh`, async (c) => {
      if (!fromPage(c)) return deny(c);
      const f = getFile(db, Number((await json(c))?.file));
      if (!f) return c.json({ ok: false, message: "Không có ảnh này." }, 404);
      const why = editable(f.anhRowId);
      if (why) return c.json({ ok: false, message: why }, 409);
      if (kind === "chon") chooseFile(db, f.id);
      else files.removeAny(deleteFile(db, f.id));
      return c.json({ ok: true });
    });
  fileAction("chon");
  fileAction("xoa");

  /** Xoá các dòng đã chọn cùng ảnh của chúng (D26); dòng đang tạo ảnh bị bỏ qua. */
  app.post(`${BASE}/xoa`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const ids = (Array.isArray(body?.rows) ? body.rows : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0) as number[];
    const locked = lockedAnhRows(db);
    const okIds = ids.filter((id) => !locked.has(id));
    deleteRows(db, okIds).forEach((f) => files.removeAny(f));
    logger.info({ rows: okIds }, "Bảng ảnh: đã xoá dòng");
    const skipped = ids.length - okIds.length;
    return c.json({ ok: true, message: `Đã xoá ${okIds.length} dòng.${skipped ? ` Bỏ qua ${skipped} dòng đang tạo ảnh.` : ""}` });
  });

  const cleanupPlan = (includeTodo: boolean) => {
    const ids = cleanupIds(db, includeTodo);
    let bytes = 0;
    for (const list of filesOf(db, ids).values()) for (const f of list) bytes += files.fileBytes(f.file);
    return { ids, bytes };
  };

  app.get(`${BASE}/don`, (c) => {
    const includeTodo = c.req.query("ca") === "1";
    const plan = cleanupPlan(includeTodo);
    const running = lockedAnhRows(db).size;
    return c.html(
      page(
        "Dọn Bảng ảnh",
        <>
          <h1>Dọn Bảng ảnh</h1>
          <p class="muted">
            Xoá các dòng <strong>Xong</strong> cùng mọi ảnh của chúng khỏi máy này. Ảnh đã xuất sang Bảng video không bị ảnh hưởng. Ảnh nào còn cần
            thì bấm ⬇ tải về trước. Nhân vật không bị xoá.
          </p>
          <form method="get" action={`${BASE}/don`} class="card">
            <label class="inline">
              <input type="checkbox" name="ca" value="1" checked={includeTodo} onchange="this.form.submit()" /> Xoá cả dòng chưa xong (chưa tạo, thiếu
              dữ liệu, cần xem)
            </label>
          </form>
          {running > 0 && <Alert kind="warn">{running} dòng đang tạo ảnh: không bao giờ bị xoá.</Alert>}
          <form method="post" action={`${BASE}/don`} class="card actionbar">
            {includeTodo && <Hidden name="ca" value="1" />}
            <span>
              {plan.ids.length === 0 ? (
                "Không có dòng nào để dọn."
              ) : (
                <>
                  Sẽ xoá <strong>{plan.ids.length} dòng</strong>, giải phóng <strong>{formatBytes(plan.bytes)}</strong>.
                </>
              )}
            </span>
            <div class="row">
              <a class="button secondary" href={BASE}>
                Quay lại
              </a>
              <button type="submit" class="danger" disabled={plan.ids.length === 0}>
                Xoá {plan.ids.length} dòng
              </button>
            </div>
          </form>
        </>,
      ),
    );
  });

  app.post(`${BASE}/don`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const plan = cleanupPlan(body.ca === "1");
    deleteRows(db, plan.ids).forEach((f) => files.removeAny(f));
    logger.info({ rows: plan.ids.length, bytes: plan.bytes }, "Bảng ảnh: đã dọn");
    return c.redirect(boardUrl({ ok: `Đã xoá ${plan.ids.length} dòng, giải phóng ${formatBytes(plan.bytes)}.` }), 303);
  });

  // ---------- Tạo ảnh (17.13) ----------
  const sheetExists = (f: string) => !!files.nhanVatPath(f);

  app.get(`${BASE}/chuan-bi`, (c) => {
    const ids = parseIds(c.req.query("ids") ?? "");
    const extra = c.req.query("extra") ?? "";
    const s = getSettings(db);
    const plan = planAnhBatch(db, ids, s, extra, sheetExists);
    const quota = getImageQuota(db);
    const active = activeBatch(db);
    const over = plan.turns > quota.remaining;
    const can = plan.runs.length > 0 && !active && !over;
    return c.html(
      page(
        "Tạo ảnh",
        <>
          <h1>Tạo ảnh · {plan.runs.length} dòng</h1>
          <p class="muted">
            Bot gửi lần lượt từng dòng cho Muse, mỗi dòng một cuộc trò chuyện mới trong tab riêng, character sheet của nhân vật đính kèm là ảnh 1,
            và chờ tối đa {s.parallelVideos} dòng cùng lúc (đổi ở Cài đặt). Dòng tích Quay lưng: tải xong ảnh mặt trước, bot xin thêm ảnh quay lưng
            ngay trong cuộc trò chuyện đó.
          </p>
          {active && <Alert kind="warn">Lô #{active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo ảnh tiếp.</Alert>}
          {over && (
            <Alert kind="warn">
              Hôm nay còn {quota.remaining} lượt ảnh (đã dùng {quota.used}/{quota.limit}) nhưng lô này cần {plan.turns} lượt (dòng có Quay lưng tính 2).
              Bỏ bớt dòng, hoặc nâng giới hạn ảnh ở <a href="/settings">Cài đặt</a>.
            </Alert>
          )}
          {plan.rejected.length > 0 && (
            <Alert kind="warn">
              Không tạo được:
              <ul>
                {plan.rejected.map((r) => (
                  <li>
                    Dòng {r.id}: {r.why}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <form method="get" action={`${BASE}/chuan-bi`} class="card">
            <Hidden name="ids" value={ids.join(",")} />
            <label for="extra">Yêu cầu thêm chung (không bắt buộc)</label>
            <textarea id="extra" name="extra" rows={2} placeholder="Ví dụ: ánh sáng tự nhiên, phong cách ảnh chụp điện thoại">
              {extra}
            </textarea>
            <div class="row" style="margin-top:8px">
              <button type="submit" class="secondary small">
                Cập nhật xem trước
              </button>
            </div>
          </form>
          {plan.runs.map((r) => (
            <div class="card">
              <div class="row" style="margin-bottom:8px;align-items:center">
                {r.row.nhanVatFile && (
                  <figure style="margin:0;text-align:center">
                    <img class="thumb" src={sheetUrl(r.row.nhanVatFile)} alt={`character sheet ${r.row.nhanVatTen}`} loading="lazy" width="64" height="64" />
                    <figcaption class="small muted">ảnh 1 · {r.row.nhanVatTen}</figcaption>
                  </figure>
                )}
                {r.row.nhanVatFaceFile && (
                  <figure style="margin:0;text-align:center">
                    <img class="thumb" src={sheetUrl(r.row.nhanVatFaceFile)} alt={`ảnh mặt ${r.row.nhanVatTen}`} loading="lazy" width="64" height="64" />
                    <figcaption class="small muted">ảnh 2 · mặt</figcaption>
                  </figure>
                )}
                <strong>
                  Dòng {r.row.id}
                  {r.backText ? " · mặt trước + quay lưng" : " · một ảnh"}
                  {r.again && <span class="muted small"> · đã có ảnh, tạo thêm (ảnh cũ vẫn giữ)</span>}
                </strong>
              </div>
              <details>
                <summary>Yêu cầu gửi Muse</summary>
                <pre class="request">{r.text}</pre>
                {r.backText && (
                  <>
                    <div class="small muted" style="margin-top:6px">
                      Tin thứ hai, gửi sau khi đã có ảnh mặt trước:
                    </div>
                    <pre class="request">{r.backText}</pre>
                  </>
                )}
              </details>
            </div>
          ))}
          <form method="post" action={`${BASE}/chay`} class="card actionbar">
            <Hidden name="ids" value={plan.runs.map((r) => r.row.id).join(",")} />
            <Hidden name="extra" value={extra} />
            <span class="muted small">
              Hôm nay {quota.used}/{quota.limit} ảnh · lô này dùng {plan.turns} lượt, mất {estimateAnhText(db, plan.turns, s)}, máy cần bật suốt lô
            </span>
            <div class="row">
              <a class="button secondary" href={BASE}>
                Quay lại
              </a>
              <button type="submit" disabled={!can}>
                ▶ Bắt đầu tạo ảnh cho {plan.runs.length} dòng
              </button>
            </div>
          </form>
        </>,
      ),
    );
  });

  app.post(`${BASE}/chay`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const back = (key: "ok" | "loi", text: string) => c.redirect(boardUrl({ [key]: text }), 303);
    const runner = deps.runner;
    if (!runner) return back("loi", "Bot chưa sẵn sàng.");
    const active = activeBatch(db);
    if (active) return back("loi", `Lô #${active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo ảnh tiếp.`);
    const extra = String(body.extra ?? "");
    const plan = planAnhBatch(db, parseIds(String(body.ids ?? "")), getSettings(db), extra, sheetExists);
    if (plan.runs.length === 0) return back("loi", "Không có dòng nào tạo ảnh được.");
    const quota = getImageQuota(db);
    if (plan.turns > quota.remaining) return back("loi", `Hôm nay chỉ còn ${quota.remaining} lượt ảnh.`);
    const batchId = insertAnhBatch(db, extra, plan.runs);
    logger.info({ batchId, rows: plan.runs.map((r) => r.row.id) }, "Đã tạo lô từ Bảng ảnh");
    const started = runner.start(batchId);
    if (!started.ok) return back("loi", started.message);
    const skipped = plan.rejected.length ? ` Bỏ qua: ${plan.rejected.map((r) => `dòng ${r.id} (${r.why})`).join("; ")}.` : "";
    return back("ok", `Đang tạo ảnh cho ${plan.runs.length} dòng (lô #${batchId}). Bảng tự cập nhật.${skipped}`);
  });

  // ---------- Xuất sang Bảng video (D34) ----------

  app.get(`${BASE}/xuat`, (c) => {
    const ids = parseIds(c.req.query("ids") ?? "");
    const plan = planExport(db, ids);
    const again = plan.items.filter((it) => it.again);
    const fresh = plan.items.length - again.length;
    return c.html(
      page(
        "Xuất sang Bảng video",
        <>
          <h1>Xuất sang Bảng video</h1>
          <p class="muted">
            Mỗi dòng thành <strong>một dòng mới</strong> trên Bảng video: ảnh chính mặt trước làm <strong>Mẫu trước</strong>, ảnh chính quay lưng
            (nếu có) làm <strong>Mẫu sau</strong>. Ảnh được chép sang, nên xoá ở bảng này không ảnh hưởng bảng kia. Prompt video, Áo trước, Áo sau bạn
            tự thêm trên Bảng video.
          </p>
          {plan.rejected.length > 0 && (
            <Alert kind="warn">
              Không xuất được:
              <ul>
                {plan.rejected.map((r) => (
                  <li>
                    Dòng {r.id}: {r.why}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {plan.items.length > 0 && (
            <div class="scroll card">
              <table class="bang bang-moi">
                <thead>
                  <tr>
                    <th>Dòng ảnh</th>
                    <th>Nhân vật</th>
                    <th>Mẫu trước</th>
                    <th>Mẫu sau</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.items.map((it) => (
                    <tr>
                      <td>{it.row.id}</td>
                      <td>{it.row.nhanVatTen ?? "—"}</td>
                      <td>
                        <img class="thumb" src={anhUrl(it.front.file)} alt={`Mẫu trước từ dòng ${it.row.id}`} loading="lazy" width="64" height="64" />
                      </td>
                      <td>
                        {it.back ? (
                          <img class="thumb" src={anhUrl(it.back.file)} alt={`Mẫu sau từ dòng ${it.row.id}`} loading="lazy" width="64" height="64" />
                        ) : (
                          <span class="muted small">trống</span>
                        )}
                      </td>
                      <td class="small">{it.again ? <span class="warn-text">Đã xuất rồi → dòng #{it.row.exportedBangRowId}</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form method="post" action={`${BASE}/xuat`} class="card actionbar">
            <Hidden name="ids" value={plan.items.map((it) => it.row.id).join(",")} />
            <div>
              {plan.items.length === 0 ? (
                "Không có dòng nào để xuất."
              ) : (
                <>
                  Sẽ thêm <strong id="exportCount">{fresh}</strong> dòng vào Bảng video.
                </>
              )}
              {again.length > 0 && (
                <label class="inline" style="display:block;margin-top:6px">
                  <input
                    type="checkbox"
                    name="lai"
                    value="1"
                    onchange={`document.getElementById('exportCount').textContent = this.checked ? ${plan.items.length} : ${fresh}; document.getElementById('exportGo').disabled = !this.checked && ${fresh} === 0`}
                  />{" "}
                  Xuất lại {again.length} dòng đã xuất (thêm dòng mới nữa trên Bảng video; dòng cũ vẫn giữ)
                </label>
              )}
            </div>
            <div class="row">
              <a class="button secondary" href={BASE}>
                Quay lại
              </a>
              <button type="submit" id="exportGo" disabled={fresh === 0}>
                📤 Xuất
              </button>
            </div>
          </form>
        </>,
      ),
    );
  });

  app.post(`${BASE}/xuat`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const plan = planExport(db, parseIds(String(body.ids ?? "")));
    const r = applyExport(db, files, plan, body.lai === "1");
    logger.info({ done: r.done, failed: r.failed }, "Bảng ảnh: đã xuất sang Bảng video");
    if (r.done.length === 0 && r.failed.length === 0) return c.redirect(boardUrl({ loi: "Không có dòng nào được xuất." }), 303);
    const rows = r.done.map((d) => `#${d.bangRowId}`).join(", ");
    const ok = r.done.length ? `Đã xuất ${r.done.length} dòng sang Bảng video (dòng ${rows}). Vào Bảng video để thêm prompt và ảnh áo.` : "";
    const bad = r.failed.length ? ` Không xuất được: ${r.failed.map((f) => `dòng ${f.id} (${f.why})`).join("; ")}.` : "";
    return c.redirect(boardUrl(ok ? { ok: ok + bad } : { loi: bad.trim() }), 303);
  });

  // ---------- Nhân vật (D32) ----------

  app.get(`${NV}/anh/:name`, (c) => {
    const p = files.nhanVatPath(c.req.param("name"));
    if (!p) return c.text("Không có ảnh", 404);
    return c.body(fs.readFileSync(p), 200, { "Content-Type": typeOf(p), "Cache-Control": "private, max-age=31536000, immutable" });
  });

  const nvPage = (c: Context, o: { ok?: string; err?: string } = {}, status: 200 | 400 = 200) => {
    const chars = listNhanVat(db);
    const ok = o.ok ?? c.req.query("ok");
    const err = o.err ?? c.req.query("loi");
    return c.html(
      page(
        "Nhân vật",
        <>
          <div class="bang-head">
            <h1 style="margin:0">Nhân vật</h1>
            <div class="row">
              <a class="button" href={`${NV}/tao`}>
                ✨ Tạo nhân vật
              </a>
              <a class="button secondary" href={BASE}>
                ← Bảng ảnh
              </a>
            </div>
          </div>
          <p class="muted">
            Mỗi nhân vật có <strong>ảnh 4 góc</strong> (character sheet toàn thân, tự thêm vào đây hoặc bấm <strong>Tạo nhân vật</strong> để bot tạo bằng Muse) và <strong>ảnh mặt</strong> (cận mặt, không bắt buộc
            nhưng nên có). Khi tạo ảnh, bot gửi ảnh 4 góc rồi tới ảnh mặt cho Muse để Muse giữ đúng mặt, tóc, da và dáng của nhân vật. File chỉ nằm
            trên máy này. Đổi ảnh chỉ ảnh hưởng các lần tạo sau.
          </p>
          {ok && <Alert kind="ok">{ok}</Alert>}
          {err && <Alert kind="warn">{err}</Alert>}
          <NvDraftsCard db={db} />
          <form method="post" action={`${NV}/them`} enctype="multipart/form-data" class="card">
            <h2>+ Thêm nhân vật</h2>
            <div class="row" style="align-items:center">
              <input name="ten" type="text" maxlength={60} placeholder="Tên nhân vật, ví dụ: Linh" required aria-label="Tên nhân vật" style="flex:0 1 240px" />
              <button type="submit">Thêm nhân vật</button>
            </div>
            <div class="row" style="align-items:center;margin-top:10px">
              <label>
                Ảnh 4 góc (turnaround) <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
              </label>
              <label>
                Ảnh mặt (face) <input name="face" type="file" accept="image/jpeg,image/png,image/webp" />
              </label>
            </div>
            <div class="muted small hint">Nhận JPG, PNG, WEBP, tối đa 20 MB mỗi ảnh. Ảnh mặt không bắt buộc nhưng giúp Muse giữ mặt giống hơn.</div>
          </form>
          {chars.length === 0 ? (
            <div class="card muted">Chưa có nhân vật nào.</div>
          ) : (
            chars.map((ch) => {
              const used = nhanVatUsage(db, ch.id);
              const draft = draftOfNhanVat(db, ch.id);
              return (
                <div class="card" id={`nv-${ch.id}`}>
                  <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
                    <NvSlot action={`${NV}/${ch.id}/goc`} label="Ảnh gốc" ten={ch.ten} file={ch.masterFile} url={ch.masterFile ? sheetUrl(ch.masterFile) : null} width={124} />
                    <NvSlot action={`${NV}/${ch.id}/file`} label="Ảnh 4 góc" ten={ch.ten} file={ch.file} url={sheetUrl(ch.file)} width={391} />
                    <NvSlot action={`${NV}/${ch.id}/mat`} label="Ảnh mặt" ten={ch.ten} file={ch.faceFile} url={ch.faceFile ? sheetUrl(ch.faceFile) : null} width={160} />
                    <div style="flex:1 1 100%;display:flex;flex-direction:column;gap:10px">
                      <div>
                        <strong style="font-size:1.1rem">{ch.ten}</strong>{" "}
                        <span class="muted small">
                          · {formatBytes(ch.bytes + ch.faceBytes + ch.masterBytes)} · {used} dòng trên Bảng ảnh
                        </span>
                      </div>
                      <form method="post" action={`${NV}/${ch.id}/ten`} class="row" style="align-items:center">
                        <input name="ten" type="text" maxlength={60} value={ch.ten} required aria-label={`Tên mới cho ${ch.ten}`} style="flex:0 1 220px" />
                        <button type="submit" class="secondary small">
                          Đổi tên
                        </button>
                      </form>
                      <NvPromptsBox db={db} nhanVatId={ch.id} />
                      {draft && (
                        <a class="small" href={`${NV}/tao/${draft.id}`}>
                          {ch.faceFile ? "Xem ảnh gốc, tạo lại ảnh" : "Thiếu ảnh face: tạo lại ảnh face"}
                        </a>
                      )}
                      {ch.faceFile && (
                        <form method="post" action={`${NV}/${ch.id}/mat/xoa`}>
                          <button type="submit" class="secondary small" onclick={`return confirm(${JSON.stringify(`Xoá ảnh mặt của ${ch.ten}? Các lần tạo sau chỉ gửi ảnh 4 góc.`)})`}>
                            Xoá ảnh mặt
                          </button>
                        </form>
                      )}
                      <form method="post" action={`${NV}/${ch.id}/xoa`}>
                        <button
                          type="submit"
                          class="danger small"
                          onclick={`return confirm(${JSON.stringify(`Xoá nhân vật ${ch.ten}? Ảnh của nhân vật trên máy sẽ bị xoá. Ảnh đã tạo vẫn giữ; ${used} dòng đang chọn nhân vật này cần chọn nhân vật khác.`)})`}
                        >
                          Xoá nhân vật
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <script dangerouslySetInnerHTML={{ __html: COPY_PROMPT_JS }} />
          <script dangerouslySetInnerHTML={{ __html: NV_UPLOAD_JS }} />
        </>,
      ),
      status,
    );
  };
  app.get(NV, (c) => nvPage(c));

  const readSheet = async (c: Context): Promise<{ data: Uint8Array } | { err: string }> => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return { err: "Chưa chọn file ảnh." };
    const data = new Uint8Array(await file.arrayBuffer());
    const problem = imageProblem(data);
    return problem ? { err: problem } : { data };
  };
  const toNv = (c: Context, o: { ok?: string; loi?: string }) =>
    c.redirect(`${NV}?${new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString()}`, 303);

  app.post(`${NV}/them`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const ten = String(body.ten ?? "");
    const why = tenProblem(ten);
    if (why) return nvPage(c, { err: why }, 400);
    const file = body.file;
    if (!(file instanceof File)) return nvPage(c, { err: "Chưa chọn ảnh 4 góc." }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    const problem = imageProblem(data);
    if (problem) return nvPage(c, { err: problem }, 400);
    // Không chọn ảnh mặt thì trình duyệt vẫn gửi một file rỗng.
    const faceData = body.face instanceof File && body.face.size > 0 ? new Uint8Array(await body.face.arrayBuffer()) : null;
    const faceProblem = faceData && imageProblem(faceData);
    if (faceProblem) return nvPage(c, { err: `Ảnh mặt: ${faceProblem}` }, 400);
    const id = addNhanVat(db, ten, (nvId) => ({
      file: files.saveNhanVat(nvId, data),
      bytes: data.length,
      ...(faceData ? { faceFile: files.saveNhanVat(nvId, faceData), faceBytes: faceData.length } : {}),
    }));
    if (!getSettings(db).lastNhanVatId) setLastNhanVat(db, id);
    logger.info({ nhanVatId: id }, "Đã thêm nhân vật");
    return toNv(c, { ok: `Đã thêm nhân vật ${ten.trim()}.` });
  });

  app.post(`${NV}/:id/ten`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const nv = getNhanVat(db, Number(c.req.param("id")));
    if (!nv) return toNv(c, { loi: "Không có nhân vật này." });
    const ten = String((await c.req.parseBody()).ten ?? "");
    const why = tenProblem(ten);
    if (why) return toNv(c, { loi: why });
    renameNhanVat(db, nv.id, ten);
    return toNv(c, { ok: `Đã đổi tên ${nv.ten} thành ${ten.trim()}.` });
  });

  app.post(`${NV}/:id/file`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const nv = getNhanVat(db, Number(c.req.param("id")));
    if (!nv) return toNv(c, { loi: "Không có nhân vật này." });
    const r = await readSheet(c);
    if ("err" in r) return toNv(c, { loi: r.err });
    const name = files.saveNhanVat(nv.id, r.data);
    const old = setNhanVatFile(db, nv.id, name, r.data.length);
    // Lô đang chờ gửi vẫn cần file cũ để so khớp: chỉ xoá khi không còn lượt nào chưa gửi dùng nó.
    if (old && !fileInUse(db, old)) files.removeAny(old);
    return toNv(c, { ok: `Đã đổi ảnh 4 góc của ${nv.ten}. Các lần tạo ảnh sau dùng ảnh mới.` });
  });

  // Ảnh gốc chỉ để lưu giữ (CON-84): không gửi Muse trên Bảng ảnh.
  app.post(`${NV}/:id/goc`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const nv = getNhanVat(db, Number(c.req.param("id")));
    if (!nv) return toNv(c, { loi: "Không có nhân vật này." });
    const r = await readSheet(c);
    if ("err" in r) return toNv(c, { loi: r.err });
    const old = setNhanVatMaster(db, nv.id, files.saveNhanVat(nv.id, r.data), r.data.length);
    if (old && !fileInUse(db, old)) files.removeAny(old);
    return toNv(c, { ok: `Đã lưu ảnh gốc của ${nv.ten}.` });
  });

  app.post(`${NV}/:id/mat`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const nv = getNhanVat(db, Number(c.req.param("id")));
    if (!nv) return toNv(c, { loi: "Không có nhân vật này." });
    const r = await readSheet(c);
    if ("err" in r) return toNv(c, { loi: r.err });
    const old = setNhanVatFace(db, nv.id, files.saveNhanVat(nv.id, r.data), r.data.length);
    if (old && !fileInUse(db, old)) files.removeAny(old);
    return toNv(c, { ok: `Đã lưu ảnh mặt của ${nv.ten}. Các lần tạo ảnh sau dùng ảnh mới.` });
  });

  app.post(`${NV}/:id/mat/xoa`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const nv = getNhanVat(db, Number(c.req.param("id")));
    if (!nv) return toNv(c, { loi: "Không có nhân vật này." });
    const old = setNhanVatFace(db, nv.id, null, 0);
    if (old && !fileInUse(db, old)) files.removeAny(old);
    return toNv(c, { ok: `Đã xoá ảnh mặt của ${nv.ten}.` });
  });

  app.post(`${NV}/:id/xoa`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const nv = getNhanVat(db, Number(c.req.param("id")));
    if (!nv) return toNv(c, { loi: "Không có nhân vật này." });
    if (fileInUse(db, nv.file) || (nv.faceFile && fileInUse(db, nv.faceFile))) return toNv(c, { loi: `Nhân vật ${nv.ten} đang được dùng trong lô chưa xong. Đợi lô xong rồi xoá.` });
    deleteNhanVat(db, nv.id).forEach((f) => files.removeAny(f));
    logger.info({ nhanVatId: nv.id }, "Đã xoá nhân vật");
    return toNv(c, { ok: `Đã xoá nhân vật ${nv.ten}.` });
  });
}

// Không dùng dấu ` hay ${ } trong đoạn này. Chữ có dấu được đổi sang \uXXXX lúc gửi trang (ascii()).
const BOARD_JS = `
(function () {
  var page = document.getElementById("banganh");
  if (!page) return;
  function req(path, init) {
    init.headers = Object.assign({ "X-Masys": "1" }, init.headers || {});
    return fetch(path, init).then(function (r) { return r.json(); });
  }
  function postJson(path, body) { return req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function reload(text) { location.href = page.dataset.self + (page.dataset.self.indexOf("?") < 0 ? "?" : "&") + "ok=" + encodeURIComponent(text); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function rowOf(node) { return Number(node.closest("tr").dataset.row); }

  // Thêm dòng.
  var addMsg = document.getElementById("addMsg"), newNv = document.getElementById("newNv");
  function addRows(prompts, back) {
    addMsg.textContent = "Đang thêm…";
    postJson("/bang-anh/them", { nhanVatId: Number(newNv.value), prompts: prompts, backOn: back }).then(function (r) {
      if (!r.ok) { addMsg.textContent = r.message; return; }
      location.href = "/bang-anh?ok=" + encodeURIComponent(r.ids.length === 1 ? "Đã thêm dòng " + r.ids[0] + "." : "Đã thêm " + r.ids.length + " dòng.");
    }, function () { addMsg.textContent = "Không kết nối được tool."; });
  }
  if (newNv) {
    document.getElementById("addOne").addEventListener("click", function () { addRows("", false); });
    var pasteBox = document.getElementById("pasteBox");
    document.getElementById("pasteToggle").addEventListener("click", function () { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) document.getElementById("pasteText").focus(); });
    document.getElementById("pasteGo").addEventListener("click", function () {
      var t = document.getElementById("pasteText").value;
      if (!t.trim()) { addMsg.textContent = "Chưa dán prompt nào."; return; }
      addRows(t, document.getElementById("pasteBack").checked);
    });
  }

  // Sửa prompt.
  document.querySelectorAll("button.prompt-edit").forEach(function (b) {
    b.addEventListener("click", function () {
      var td = b.closest("td");
      if (td.querySelector(".editor")) return;
      var row = rowOf(td);
      var box = el("div", "editor"), input = el("textarea");
      input.rows = 5; input.value = td.dataset.value; box.appendChild(input);
      var bar = el("div", "row"), save = el("button", "small", "Lưu"), cancel = el("button", "secondary small", "Huỷ"), msg = el("span", "small warn-text");
      save.type = cancel.type = "button";
      bar.appendChild(save); bar.appendChild(cancel); bar.appendChild(msg); box.appendChild(bar);
      cancel.addEventListener("click", function () { box.remove(); });
      save.addEventListener("click", function () {
        save.disabled = true;
        postJson("/bang-anh/prompt", { row: row, prompt: input.value }).then(function (r) {
          if (r.ok) return reload("Đã lưu prompt dòng " + row + ".");
          save.disabled = false; msg.textContent = r.message;
        });
      });
      td.appendChild(box); input.focus();
    });
  });

  // Nhân vật, Quay lưng của từng dòng.
  document.querySelectorAll("select.nv-pick").forEach(function (s) {
    s.addEventListener("change", function () {
      postJson("/bang-anh/nhan-vat", { row: rowOf(s), nhanVatId: Number(s.value) }).then(function (r) { if (r.ok) location.reload(); else alert(r.message); });
    });
  });
  document.querySelectorAll("input.back-on").forEach(function (c) {
    c.addEventListener("change", function () {
      postJson("/bang-anh/quay-lung", { row: rowOf(c), on: c.checked }).then(function (r) { if (r.ok) location.reload(); else { alert(r.message); c.checked = !c.checked; } });
    });
  });

  // Ảnh của dòng: ◀ ▶ xem các ảnh, ★ ảnh chính, ☆ chọn làm ảnh chính, ⬇ tải, 🗑 xoá.
  document.querySelectorAll("td.anh-cell").forEach(function (td) {
    var list = JSON.parse(td.dataset.files), i = Number(td.dataset.idx);
    var img = td.querySelector("img"), big = td.querySelector("a.anh-big"), pos = td.querySelector(".anh-pos");
    var star = td.querySelector(".anh-star"), choose = td.querySelector(".anh-choose"), dl = td.querySelector(".anh-dl");
    function show() {
      var f = list[i];
      img.src = f.url; big.href = f.url; dl.href = f.url + "?tai=1";
      pos.textContent = (i + 1) + "/" + list.length;
      star.hidden = !f.chosen;
      if (choose) choose.hidden = !!f.chosen;
    }
    var prev = td.querySelector(".anh-prev"), next = td.querySelector(".anh-next");
    if (prev) prev.addEventListener("click", function () { i = (i + list.length - 1) % list.length; show(); });
    if (next) next.addEventListener("click", function () { i = (i + 1) % list.length; show(); });
    if (choose) choose.addEventListener("click", function () {
      postJson("/bang-anh/chon-anh", { file: list[i].id }).then(function (r) { if (r.ok) location.reload(); else alert(r.message); });
    });
    var del = td.querySelector(".anh-del");
    if (del) del.addEventListener("click", function () {
      if (!confirm("Xoá ảnh này khỏi máy? Không lấy lại được.")) return;
      postJson("/bang-anh/xoa-anh", { file: list[i].id }).then(function (r) { if (r.ok) location.reload(); else alert(r.message); });
    });
  });

  // Chọn dòng, Tạo ảnh, Xoá, Đổi nhân vật hàng loạt.
  function checked() { return Array.prototype.map.call(document.querySelectorAll("input.pick-row:checked"), function (c) { return c.value; }); }
  var runBtn = document.getElementById("runBtn"), runHint = document.getElementById("runHint"), delBtn = document.getElementById("delBtn"), bulkGo = document.getElementById("bulkNvGo");
  function sync() {
    var n = checked().length;
    delBtn.disabled = n === 0;
    exportBtn.disabled = n === 0;
    if (bulkGo) bulkGo.disabled = n === 0;
    if (runBtn.dataset.blocked) return;
    runBtn.disabled = n === 0;
    runHint.textContent = n ? "Đã chọn " + n + " dòng." : "Tích các dòng cần tạo ảnh.";
  }
  document.querySelectorAll("input.pick-row").forEach(function (c) { c.addEventListener("change", sync); });
  runBtn.addEventListener("click", function () { location.href = "/bang-anh/chuan-bi?ids=" + checked().join(","); });
  var exportBtn = document.getElementById("exportBtn");
  exportBtn.addEventListener("click", function () { location.href = "/bang-anh/xuat?ids=" + checked().join(","); });
  delBtn.addEventListener("click", function () {
    var ids = checked();
    if (!ids.length || !confirm("Xoá " + ids.length + " dòng đã chọn cùng mọi ảnh của chúng? Không lấy lại được.")) return;
    postJson("/bang-anh/xoa", { rows: ids.map(Number) }).then(function (r) { reload(r.message); });
  });
  if (bulkGo) bulkGo.addEventListener("click", function () {
    postJson("/bang-anh/nhan-vat", { rows: checked().map(Number), nhanVatId: Number(document.getElementById("bulkNv").value) }).then(function (r) { if (r.ok) reload(r.message); else alert(r.message); });
  });
  document.getElementById("selReady").addEventListener("click", function () {
    var ready = (page.dataset.ready || "").split(",");
    document.querySelectorAll("input.pick-row").forEach(function (c) { c.checked = ready.indexOf(c.value) >= 0; });
    sync();
  });
  // Đang tạo ảnh: tự tải lại 15 giây một lần, trừ khi đang sửa dở hoặc đang chọn dòng.
  if (page.dataset.live) setInterval(function () {
    if (document.querySelector(".editor") || checked().length) return;
    var pb = document.getElementById("pasteBox");
    if (pb && !pb.hidden) return;
    location.reload();
  }, 15000);
})();
`;
