import fs from "node:fs";
import { Readable } from "node:stream";
import type { Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import { hookTextFor, queueHook, setHookClip, setHookText } from "../bang/rows.js";
import type { HookMerger } from "../bang/hook.js";
import { getHookSettings, setHookDayText, setHookOn } from "../db/settings.js";
import { cleanupIds, clearRowVideo, deleteRows, rowFiles, importedKeys, isFilter, isSlot, labelOf, listRows, countByFilter, getRow, addRow, setPrompt, setSlot, lockedBangRows, planBangFill, applyBangFill, allRowIds, SLOTS, SLOT_TAG, SLOT_TEXT, FILTERS, FILTER_TEXT, BANG_LABEL_TEXT, type BangFilter, type BangLabel, type BangRow, type Slot } from "../bang/rows.js";
import { BangFiles, clipProblem, formatBytes, imageProblem, typeOf } from "../bang/files.js";
import { planImport, runImport, type ImportPlan } from "../bang/importSheet.js";
import { zipName, zipStream, type ZipEntry } from "../bang/zip.js";
import { attachmentText, BANG_KIND_TEXT } from "../bang/request.js";
import { estimateText, insertBangBatch, planBangBatch, type HookChoice } from "../bang/run.js";
import { activeBatch } from "../db/history.js";
import { getSettings } from "../db/settings.js";
import type { BatchRunner } from "../queue/runner.js";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import { APP_NAME } from "../version.js";
import { getDailyQuota } from "../db/quota.js";
import { getSheetConfig, listSheetConfigs, sheetName } from "../db/sheetConfigs.js";
import type { DriveClient } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import type { SheetsClient } from "../google/sheets.js";
import { logger } from "../logger.js";
import { parseRowList } from "../sheetEdit/edit.js";
import { Alert, Hidden, truncate } from "./components.js";
import { Layout } from "./layout.js";
import { QuickStart, quickStatus } from "./start.js";

// Bảng mới (spec v6.0 mục 17.2, 17.6, 17.9; D21, D22): dữ liệu nằm trong tool, ảnh chọn từ máy.
// v1.5.0: mở ở ⚙ Nâng cao → "Bảng mới (đang thử)". v1.6.0 (CON-52): Tạo video, ảnh đính kèm thẳng vào Muse (17.4, 17.5).
// v2.0.0 (CON-72): màn hình chính (cả "/" và /bang-moi); video tải về máy, xem / tải / xoá / dọn trên Bảng (D23, D26).

export interface BangMoiDeps {
  config: AppConfig;
  db: DB;
  sheets?: SheetsClient;
  drive?: DriveClient;
  runner?: BatchRunner;
  hooks?: HookMerger;
}

const BADGE: Record<BangLabel, string> = { ready: "b-ready", missing_data: "b-missing_data", running: "b-running", done: "b-has_video", review: "b-missing_data" };
const parseIds = (v: string) => v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);

const BASE = "/bang-moi";
const bangUrl = (o: { filter?: BangFilter; q?: string; page?: number; ok?: string } = {}) => {
  const p = new URLSearchParams();
  if (o.filter && o.filter !== "all") p.set("loc", o.filter);
  if (o.q) p.set("q", o.q);
  if (o.page && o.page > 1) p.set("trang", String(o.page));
  if (o.ok) p.set("ok", o.ok);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
};
const imageUrl = (name: string) => `${BASE}/anh/${encodeURIComponent(name)}`;
const videoUrl = (name: string) => `${BASE}/video/${encodeURIComponent(name)}`;
const clipUrl = (name: string) => `${BASE}/clip-hook/${encodeURIComponent(name)}`;

/** Tên file khi tải về (17.2): MASYS_<số dòng>_<YYYYMMDD-HHmm>.mp4, theo giờ máy lúc video về. */
export function downloadName(row: number, at: string | null): string {
  const d = at ? new Date(at) : new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `MASYS_${row}_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.mp4`;
}

/** Tên file bản có hook khi tải về: MASYS_<dòng>_<giờ>_hook.mp4 (D30). */
export const hookDownloadName = (row: number, at: string | null) => downloadName(row, at).replace(/\.mp4$/, "_hook.mp4");

/** Phần hook trong ô Video (D30): bản có hook (▶ ⬇), đang ghép, lỗi ghép, nút Ghép hook. */
function HookVideoPart(props: { row: BangRow; locked: boolean; busy: boolean }) {
  const r = props.row;
  const pending = r.hookJob != null || props.busy;
  return (
    <div class="hookpart small">
      {r.hookVideoFile && !pending && (
        <div class="vid" data-src={videoUrl(r.hookVideoFile)} title={r.hookVideoBytes ? `Bản có hook, ${formatBytes(r.hookVideoBytes)}` : "Bản có hook"}>
          <span class="muted">Có hook</span>
          <button type="button" class="edit vid-play" title="Xem bản có hook" aria-label={`Xem bản có hook dòng ${r.id}`}>
            ▶
          </button>
          <a class="edit" href={`${videoUrl(r.hookVideoFile)}?tai=1`} download={hookDownloadName(r.id, r.videoAt)} title="Tải bản có hook" aria-label={`Tải bản có hook dòng ${r.id}`}>
            ⬇
          </a>
        </div>
      )}
      {pending && <div class="muted">⏳ Đang ghép hook…</div>}
      {!pending && r.hookError && (
        <div class="warn-text" title={r.hookError}>
          Ghép hook lỗi: {truncate(r.hookError, 50)}
        </div>
      )}
      {!pending && !props.locked && r.hookClip && (
        <button type="button" class="secondary small hook-merge">
          {r.hookVideoFile || r.hookError ? "Ghép lại hook" : "Ghép hook"}
        </button>
      )}
    </div>
  );
}

/** Ô Hook (D30): clip hook của dòng (bắt buộc khi thêm hook) và câu hook riêng (trống = câu chung hôm nay). */
function HookCell(props: { row: BangRow; locked: boolean }) {
  const r = props.row;
  return (
    <td class="hook" data-value={r.hookText ?? ""}>
      <div class="hook-clip">
        {r.hookClip ? (
          <>
            <a href={clipUrl(r.hookClip)} target="_blank" rel="noreferrer" title="Mở clip hook">
              🎬 Clip hook
            </a>
            {!props.locked && (
              <>
                {" "}
                <button type="button" class="edit clip-pick" title="Đổi clip hook" aria-label={`Đổi clip hook dòng ${r.id}`}>
                  ✎
                </button>
                <button type="button" class="edit clip-unset" title="Bỏ clip hook" aria-label={`Bỏ clip hook dòng ${r.id}`}>
                  ✕
                </button>
              </>
            )}
          </>
        ) : props.locked ? (
          <span class="muted">—</span>
        ) : (
          <button type="button" class="slot-add clip-pick" title="Chọn clip hook (MP4, MOV, WEBM, MKV) hoặc kéo clip vào đây" aria-label={`Thêm clip hook dòng ${r.id}`}>
            +
          </button>
        )}
      </div>
      <div class="cellwrap small">
        <div class="cellbody">{r.hookText ? `“${truncate(r.hookText, 80)}”` : <span class="muted">(câu chung hôm nay)</span>}</div>
        {!props.locked && (
          <button type="button" class="edit hooktext-edit" title="Câu hook riêng của dòng này" aria-label={`Sửa câu hook dòng ${r.id}`}>
            ✎
          </button>
        )}
      </div>
    </td>
  );
}

/** Ô Video (17.2): ảnh nhỏ (ảnh người mẫu) + ▶ xem ngay trên trang (chỉ tải khi bấm), ⬇ Tải về, 🗑 Xoá. */
function VideoCell(props: { row: BangRow; locked: boolean; label: BangLabel; hookOn?: boolean; hookBusy?: boolean }) {
  const r = props.row;
  const showHook = !!r.videoFile && (props.hookOn || !!r.hookVideoFile || r.hookJob != null || !!props.hookBusy);
  if (!r.videoFile) {
    return (
      <td>
        {r.museChatUrl ? (
          <a href={r.museChatUrl} target="_blank" rel="noreferrer" title="Mở cuộc trò chuyện Muse của dòng này">
            {props.label === "done" ? "Mở trong Muse ↗" : "Cuộc trò chuyện ↗"}
          </a>
        ) : (
          <span class="muted">—</span>
        )}
      </td>
    );
  }
  return (
    <td class="video">
      <div class="vid" data-src={videoUrl(r.videoFile)}>
        <button type="button" class="vid-play" title="Xem video" aria-label={`Xem video dòng ${r.id}`}>
          {r.modelFront ? <img class="thumb" src={imageUrl(r.modelFront)} alt="" loading="lazy" width="64" height="64" /> : <span class="thumb" />}
          <span class="vid-icon">▶</span>
        </button>
        <div class="vid-tools">
          <a class="edit" href={`${videoUrl(r.videoFile)}?tai=1`} download={downloadName(r.id, r.videoAt)} title="Tải về máy" aria-label={`Tải video dòng ${r.id}`}>
            ⬇
          </a>
          {!props.locked && (
            <button type="button" class="edit vid-del" title="Xoá video" aria-label={`Xoá video dòng ${r.id}`}>
              🗑
            </button>
          )}
        </div>
        <div class="small muted">
          {r.videoBytes ? formatBytes(r.videoBytes) : ""}
          {r.museChatUrl && (
            <>
              {" · "}
              <a href={r.museChatUrl} target="_blank" rel="noreferrer" title="Mở cuộc trò chuyện Muse của dòng này">
                Muse ↗
              </a>
            </>
          )}
        </div>
      </div>
      {showHook && <HookVideoPart row={r} locked={props.locked} busy={!!props.hookBusy} />}
    </td>
  );
}

function page(title: string, body: Child) {
  return <Layout title={`${title} · ${APP_NAME}`}>{body}</Layout>;
}

function ImageCell(props: { row: BangRow; slot: Slot; locked: boolean }) {
  const name = props.row[props.slot];
  const what = `${SLOT_TEXT[props.slot]} dòng ${props.row.id}`;
  return (
    <td class="slot" data-slot={props.slot} title={props.locked ? "" : `Bấm + hoặc kéo ảnh vào đây (${SLOT_TEXT[props.slot]})`}>
      {name ? (
        <div class="slot-img">
          <a href={imageUrl(name)} target="_blank" rel="noreferrer" title="Bấm để xem ảnh lớn">
            <img class="thumb" src={imageUrl(name)} alt={what} loading="lazy" width="64" height="64" />
          </a>
          {!props.locked && (
            <div class="slot-tools">
              <button type="button" class="edit pick" title={`Đổi ảnh ${SLOT_TEXT[props.slot].toLowerCase()}`} aria-label={`Đổi ${what}`}>
                ✎
              </button>
              <button type="button" class="edit unset" title="Bỏ ảnh này" aria-label={`Bỏ ${what}`}>
                ✕
              </button>
            </div>
          )}
        </div>
      ) : props.locked ? (
        <span class="muted">—</span>
      ) : (
        <button type="button" class="slot-add pick" aria-label={`Thêm ${what}`}>
          +
        </button>
      )}
    </td>
  );
}

/** Video của dòng khi tải nhiều dòng (CON-107, CON-112): có bản có hook (đã ghép xong) thì lấy bản đó, không thì bản gốc. */
export function bulkFile(r: BangRow, hookBusy: boolean): { file: string; name: string } | null {
  if (!r.videoFile) return null;
  if (r.hookVideoFile && r.hookJob == null && !hookBusy) return { file: r.hookVideoFile, name: hookDownloadName(r.id, r.videoAt) };
  return { file: r.videoFile, name: downloadName(r.id, r.videoAt) };
}

export function bulkDownload(r: BangRow, hookBusy: boolean): { url: string; name: string } | null {
  const f = bulkFile(r, hookBusy);
  return f && { url: `${videoUrl(f.file)}?tai=1`, name: f.name };
}

function RowView(props: { row: BangRow; locked: boolean; hookOn: boolean; hookBusy: boolean }) {
  const r = props.row;
  const own = labelOf(r);
  const { label, problems } = props.locked && own.label !== "running" ? { label: "running" as const, problems: [] } : own;
  const dl = bulkDownload(r, props.hookBusy);
  return (
    <tr data-row={r.id} data-label={label} data-dl={dl?.url} data-dl-name={dl?.name}>
      <td>
        <input type="checkbox" class="pick-row" value={r.id} aria-label={`Chọn dòng ${r.id}`} disabled={props.locked} />
      </td>
      <td>{r.id}</td>
      {SLOTS.map((s) => (
        <ImageCell row={r} slot={s} locked={props.locked} />
      ))}
      <td class="prompt" data-value={r.prompt}>
        <div class="cellwrap">
          <div class="cellbody">{r.prompt ? truncate(r.prompt, 160) : <span class="muted">(chưa có prompt)</span>}</div>
          {!props.locked && (
            <button type="button" class="edit prompt-edit" title="Sửa prompt" aria-label={`Sửa prompt dòng ${r.id}`}>
              ✎
            </button>
          )}
        </div>
      </td>
      {props.hookOn && <HookCell row={r} locked={props.locked} />}
      <VideoCell row={r} locked={props.locked} label={label} hookOn={props.hookOn} hookBusy={props.hookBusy} />
      <td>
        <span class={`badge ${BADGE[label]}`}>{BANG_LABEL_TEXT[label]}</span>
        {problems.length > 0 && (
          <ul class="problems">
            {problems.map((p) => (
              <li>{p}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function registerBangMoiRoutes(app: Hono, deps: BangMoiDeps) {
  const { db, config } = deps;
  const files = new BangFiles(config.dataDir);
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";

  const board = (c: Context) => {
    const filter = isFilter(c.req.query("loc")) ? (c.req.query("loc") as BangFilter) : "all";
    const q = (c.req.query("q") ?? "").trim();
    const list = listRows(db, { filter, q, page: Number(c.req.query("trang") ?? 1) || 1 });
    const counts = countByFilter(db);
    const locked = lockedBangRows(db);
    const quota = getDailyQuota(db);
    const ok = c.req.query("ok");
    const err = c.req.query("loi");
    const readyIds = list.rows.filter((r) => labelOf(r).label === "ready" && !locked.has(r.id)).map((r) => r.id);
    const active = activeBatch(db);
    const blocked = active ? `Lô #${active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo video tiếp.` : "";
    const hook = getHookSettings(db);
    const hookBusy = (id: number) => !!deps.hooks?.isBusy(id);
    const merging = list.rows.some((r) => r.hookJob != null || hookBusy(r.id));
    const live = (!!active && deps.runner?.runningBatchId === active.id && locked.size > 0) || merging;
    return c.html(
      page(
        "Bảng",
        <>
          <QuickStart status={quickStatus(db)} back={c.req.path} compact />
          <div class="bang-head">
            <h1 style="margin:0">Bảng</h1>
            <div class="row">
              <span class="pill">
                Hôm nay {quota.used}/{quota.limit}
              </span>
              <span class="pill" title="Ảnh và video Bảng mới đang lưu trên máy này">
                Đang dùng {formatBytes(files.usedBytes())}
              </span>
            </div>
          </div>
          {list.total === 0 && !q && filter === "all" && (
            <Alert kind="ok">
              Bấm <strong>+ Thêm dòng</strong> rồi bấm <strong>+</strong> ở ô ảnh (hoặc kéo ảnh vào ô), viết prompt, tích dòng và bấm{" "}
              <strong>▶ Tạo video</strong>. Bot gửi ảnh cho Muse, tải video về máy và gắn vào dòng: bấm ▶ để xem, ⬇ để tải về.
            </Alert>
          )}
          {ok && <Alert kind="ok">{ok}</Alert>}
          {err && <Alert kind="warn">{err}</Alert>}

          <div class="row-between">
            <div class="filters row">
              {FILTERS.map((f) => (
                <a class={`button small ${f === filter ? "" : "secondary"}`} href={bangUrl({ filter: f, q })}>
                  {FILTER_TEXT[f]} ({counts[f]})
                </a>
              ))}
            </div>
            <form method="get" action={BASE} class="row" style="flex-wrap:nowrap">
              {filter !== "all" && <Hidden name="loc" value={filter} />}
              <input type="search" name="q" value={q} placeholder="Tìm số dòng hoặc chữ trong prompt" aria-label="Tìm" />
              <button type="submit" class="secondary">
                Tìm
              </button>
            </form>
          </div>

          <div id="dropAdd" class="card dropzone">
            <div class="row" style="align-items:center">
              <button type="button" id="addOne">
                + Thêm dòng
              </button>
              <button type="button" id="addMany" class="secondary">
                Chọn nhiều ảnh người mẫu → mỗi ảnh một dòng
              </button>
              <a class="button secondary" href={`${BASE}/nhap`}>
                Nhập từ Google Sheet
              </a>
              <span id="addMsg" class="small warn-text"></span>
            </div>
            <div class="muted small hint">Hoặc kéo thả nhiều ảnh vào khung này. Nhận JPG, PNG, WEBP, mỗi ảnh tối đa 20 MB.</div>
          </div>

          <div id="fillBox" class="card" hidden>
            <h2>Dải prompt</h2>
            <div class="field">
              <label for="fillSource">Lấy prompt của dòng</label>
              <input id="fillSource" type="number" min="1" />
            </div>
            <div class="field">
              <label class="inline">
                <input type="radio" name="fillMode" value="rows" checked /> Áp cho các dòng
              </label>{" "}
              <input id="fillRows" type="text" placeholder="ví dụ 3-6, 9 (sẵn các dòng đang tích)" />
            </div>
            <div class="field">
              <label class="inline">
                <input type="radio" name="fillMode" value="down" /> Mọi dòng có số lớn hơn dòng nguồn
              </label>
            </div>
            <div class="field">
              <label class="inline">
                <input type="checkbox" id="fillVideo" /> Thay cả dòng đã có video
              </label>
              <div class="muted small">Dòng đang tạo video luôn được bỏ qua.</div>
            </div>
            <div class="row">
              <button type="button" id="fillPreview" class="secondary">
                Xem trước
              </button>
              <button type="button" id="fillGo" hidden>
                Thay prompt
              </button>
            </div>
            <div id="fillMsg" class="small" aria-live="polite"></div>
          </div>

          <div
            id="bangmoi"
            data-ready={readyIds.join(",")}
            data-locked={[...locked].join(",")}
            data-self={bangUrl({ filter, q, page: list.page })}
            data-live={live ? "1" : ""}
          >
            {list.total === 0 ? (
              <div class="card muted">{q || filter !== "all" ? "Không có dòng nào khớp." : "Chưa có dòng nào. Bấm + Thêm dòng hoặc kéo ảnh vào khung trên."}</div>
            ) : (
              <div class="scroll">
                <table class="bang bang-moi">
                  <thead>
                    <tr>
                      <th>Chọn</th>
                      <th>Dòng</th>
                      {SLOTS.map((s) => (
                        <th>{SLOT_TEXT[s]}</th>
                      ))}
                      <th>Prompt</th>
                      {hook.on && <th title="Clip hook (mỗi video một clip) và câu hook riêng; trống thì dùng câu chung hôm nay">Hook</th>}
                      <th>Video</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <RowView row={r} locked={locked.has(r.id)} hookOn={hook.on} hookBusy={hookBusy(r.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {list.pages > 1 && (
              <div class="row pager">
                {list.page > 1 && (
                  <a class="button secondary small" href={bangUrl({ filter, q, page: list.page - 1 })}>
                    ‹ Trang trước
                  </a>
                )}
                <span class="muted">
                  Trang {list.page}/{list.pages} · {list.total} dòng
                </span>
                {list.page < list.pages && (
                  <a class="button secondary small" href={bangUrl({ filter, q, page: list.page + 1 })}>
                    Trang sau ›
                  </a>
                )}
              </div>
            )}
          </div>

          <div class="card actionbar">
            <div class="row" style="align-items:center">
              <button type="button" id="selAll" class="secondary">
                Chọn tất cả (trang này)
              </button>
              <button type="button" id="selReady" class="secondary">
                Chọn mọi dòng sẵn sàng (trang này)
              </button>
              <button type="button" id="selDone" class="secondary">
                Chọn dòng xong (trang này)
              </button>
              <button type="button" id="selNone" class="secondary" disabled title="Bỏ tích mọi dòng đã chọn, kể cả ở trang khác">
                Bỏ chọn
              </button>
              <button type="button" id="dlBtn" class="secondary" disabled title="Gom video các dòng đã chọn (mọi trang) vào một file zip">
                ⬇ Tải các dòng đã chọn
              </button>
              <button type="button" id="fillToggle" class="secondary">
                Dải prompt
              </button>
              <button type="button" id="delBtn" class="secondary" disabled>
                🗑 Xoá dòng đã chọn
              </button>
              <a class="button secondary" href={`${BASE}/don`}>
                Dọn tất cả
              </a>
              <label class="inline hook-toggle" title="Ghép clip hook + câu hook vào đầu mỗi video (như video mẫu)">
                <input type="checkbox" id="hookOn" checked={hook.on} /> Thêm hook
              </label>
            </div>
            <div id="selCount" class="small muted" aria-live="polite"></div>
            <div id="dlMsg" class="small muted" aria-live="polite" hidden></div>
            <form id="zipForm" method="post" action={`${BASE}/tai-zip`} hidden>
              <input type="hidden" name="ids" value="" />
            </form>
            <div class="run-right">
              <span id="runHint" class={`small ${blocked ? "warn-text" : "muted"}`}>{blocked || "Tích các dòng cần tạo video."}</span>
              <button type="button" id="runBtn" disabled data-blocked={blocked ? "1" : ""}>
                ▶ Tạo video
              </button>
            </div>
            {hook.on && (
              <div id="hookBox" class="hookbar">
                <div class="row" style="align-items:center;flex-wrap:nowrap">
                  <label for="hookDay" style="white-space:nowrap">
                    <strong>Câu hook chung hôm nay</strong>
                  </label>
                  <input id="hookDay" type="text" value={hook.dayText} maxlength={200} placeholder="Ví dụ: I want this shirt but I'm broke..." style="flex:1" />
                  <button type="button" id="hookDaySave" class="secondary">
                    Lưu
                  </button>
                  <span id="hookMsg" class="small" aria-live="polite"></span>
                </div>
                <div class="muted small hint">
                  Dòng có câu riêng (✎ ở cột Hook) thì dùng câu riêng. Mỗi dòng cần <strong>clip hook</strong> riêng (+ ở cột Hook). Video về là tool
                  tự ghép, bản gốc vẫn giữ.
                </div>
              </div>
            )}
          </div>
          <input type="file" id="filePick" accept="image/jpeg,image/png,image/webp" hidden />
          <input type="file" id="filesPick" accept="image/jpeg,image/png,image/webp" multiple hidden />
          <input type="file" id="clipPick" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv" hidden />
          <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
        </>,
      ),
    );
  };
  app.get("/", board);
  app.get(BASE, board);

  // Ảnh của Bảng mới: chỉ phục vụ file trong tep\anh, theo tên tool đặt.
  app.get(`${BASE}/anh/:name`, (c) => {
    const p = files.imagePath(c.req.param("name"));
    if (!p) return c.text("Không có ảnh", 404);
    return c.body(fs.readFileSync(p), 200, { "Content-Type": typeOf(p), "Cache-Control": "private, max-age=31536000, immutable" });
  });

  // Video của Bảng mới (17.2): chỉ file trong tep\video. ?tai=1 → tải về với tên MASYS_<dòng>_<giờ>.mp4.
  app.get(`${BASE}/video/:name`, (c) => {
    const name = c.req.param("name");
    const p = files.videoPath(name);
    if (!p) return c.text("Không có video", 404);
    const headers: Record<string, string> = { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=31536000, immutable" };
    if (c.req.query("tai")) {
      const row = db.prepare("SELECT id, videoAt, hookVideoFile FROM bang_rows WHERE videoFile = ? OR hookVideoFile = ?").get(name, name) as
        | { id: number; videoAt: string | null; hookVideoFile: string | null }
        | undefined;
      const id = row?.id ?? Number(name.split("-")[0]);
      const file = row?.hookVideoFile === name ? hookDownloadName(id, row.videoAt) : downloadName(id, row?.videoAt ?? null);
      headers["Content-Disposition"] = `attachment; filename="${file}"`;
    }
    return c.body(fs.readFileSync(p), 200, headers);
  });

  // Clip hook (D30): chỉ file trong tep\hook, theo tên tool đặt.
  app.get(`${BASE}/clip-hook/:name`, (c) => {
    const p = files.clipPath(c.req.param("name"));
    if (!p) return c.text("Không có clip", 404);
    return c.body(fs.readFileSync(p), 200, { "Content-Type": typeOf(p), "Cache-Control": "private, max-age=31536000, immutable" });
  });

  // Mọi yêu cầu sửa đều phải có header riêng: trang web khác không gửi được tới tool mà không bị trình duyệt chặn.
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
    if (lockedBangRows(db).has(id)) return `Dòng ${id} đang tạo video, chưa sửa được.`;
    return null;
  };

  /** Đặt ảnh vào một ô (multipart: row, slot, file). */
  app.post(`${BASE}/anh`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await c.req.parseBody();
    const id = Number(body.row);
    const slot = body.slot;
    const file = body.file;
    if (!isSlot(slot)) return c.json({ ok: false, message: "Ô ảnh không hợp lệ." }, 400);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    if (!(file instanceof File)) return c.json({ ok: false, message: "Chưa chọn ảnh." }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    const problem = imageProblem(data);
    if (problem) return c.json({ ok: false, message: problem });
    const name = files.saveImage(`${id}-${SLOT_TAG[slot]}`, data);
    files.removeImage(setSlot(db, id, slot, name));
    logger.info({ row: id, slot }, "Bảng mới: đã đặt ảnh");
    return c.json({ ok: true, name });
  });

  app.post(`${BASE}/bo-anh`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const id = Number(body?.row);
    if (!body || !isSlot(body.slot)) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    files.removeImage(setSlot(db, id, body.slot, null));
    return c.json({ ok: true });
  });

  const removeFiles = (names: string[]) => names.forEach((f) => files.removeAny(f));

  /** 🗑 trong ô Video: bỏ video (cùng bản có hook) khỏi dòng và xoá file (D26). */
  app.post(`${BASE}/xoa-video`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const id = Number((await json(c))?.row);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    removeFiles(clearRowVideo(db, id));
    logger.info({ row: id }, "Bảng mới: đã xoá video");
    return c.json({ ok: true });
  });

  // ---------- Hook đầu video (CON-74, D30) ----------

  /** Ô "Thêm hook" và câu hook chung hôm nay. */
  app.post(`${BASE}/hook-chung`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    if (typeof body.on === "boolean") setHookOn(db, body.on);
    if (typeof body.text === "string") {
      if (body.text.length > 200) return c.json({ ok: false, message: "Câu hook dài quá (tối đa 200 ký tự)." });
      setHookDayText(db, body.text);
    }
    return c.json({ ok: true });
  });

  /** Chọn / đổi clip hook của dòng (multipart: row, file). */
  app.post(`${BASE}/clip-hook`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await c.req.parseBody();
    const id = Number(body.row);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    const file = body.file;
    if (!(file instanceof File)) return c.json({ ok: false, message: "Chưa chọn clip." }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    const problem = clipProblem(data);
    if (problem) return c.json({ ok: false, message: problem });
    const name = files.saveClip(id, data);
    files.removeAny(setHookClip(db, id, name));
    logger.info({ row: id, bytes: data.length }, "Bảng mới: đã đặt clip hook");
    return c.json({ ok: true, name });
  });

  app.post(`${BASE}/bo-clip-hook`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const id = Number((await json(c))?.row);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    files.removeAny(setHookClip(db, id, null));
    return c.json({ ok: true });
  });

  /** Câu hook riêng của dòng; trống = dùng câu chung hôm nay. */
  app.post(`${BASE}/cau-hook`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const id = Number(body?.row);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    const text = String(body.text ?? "");
    if (text.length > 200) return c.json({ ok: false, message: "Câu hook dài quá (tối đa 200 ký tự)." });
    setHookText(db, id, text);
    return c.json({ ok: true });
  });

  /** Ghép hook cho dòng đã có video (không tốn lượt Muse). */
  app.post(`${BASE}/ghep-hook`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const id = Number((await json(c))?.row);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    const r = getRow(db, id)!;
    if (!r.videoFile) return c.json({ ok: false, message: `Dòng ${id} chưa có video.` });
    if (!r.hookClip || !files.clipPath(r.hookClip)) return c.json({ ok: false, message: `Dòng ${id} chưa có clip hook: bấm + ở cột Hook để chọn.` });
    const text = hookTextFor(r, getHookSettings(db).dayText);
    if (!text) return c.json({ ok: false, message: "Chưa có câu hook: điền câu hook chung hôm nay hoặc câu riêng của dòng (✎ ở cột Hook)." });
    if (!deps.hooks) return c.json({ ok: false, message: "Bộ ghép hook chưa sẵn sàng." });
    queueHook(db, id, text);
    deps.hooks.enqueue(id);
    return c.json({ ok: true, message: `Đang ghép hook cho dòng ${id}.` });
  });

  /** Xoá các dòng đã chọn cùng ảnh và video (D26); dòng đang tạo video bị bỏ qua. */
  app.post(`${BASE}/xoa`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const ids = (Array.isArray(body?.rows) ? body.rows : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0) as number[];
    const locked = lockedBangRows(db);
    const ok = ids.filter((id) => !locked.has(id));
    removeFiles(deleteRows(db, ok));
    logger.info({ rows: ok }, "Bảng mới: đã xoá dòng");
    const skipped = ids.length - ok.length;
    return c.json({ ok: true, message: `Đã xoá ${ok.length} dòng.${skipped ? ` Bỏ qua ${skipped} dòng đang tạo video.` : ""}` });
  });

  /** Tải các dòng đã chọn thành một file zip (CON-112): video có trên máy của từng dòng; dòng chưa có video bị bỏ qua. */
  const zipPlan = (ids: number[]) => {
    const entries: ZipEntry[] = [];
    const skipped: number[] = [];
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
      const r = getRow(db, id);
      const f = r && bulkFile(r, !!deps.hooks?.isBusy(id));
      const p = f && files.videoPath(f.file);
      if (!f || !p) {
        skipped.push(id);
        continue;
      }
      const st = fs.statSync(p);
      entries.push({ name: f.name, path: p, size: st.size, mtime: st.mtime });
    }
    return { entries, skipped };
  };
  const idList = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map(Number).filter((n) => Number.isInteger(n) && n > 0);

  app.post(`${BASE}/tai-zip/xem`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const plan = zipPlan(idList(body?.rows));
    const bytes = plan.entries.reduce((n, e) => n + e.size, 0);
    return c.json({ ok: true, count: plan.entries.length, skipped: plan.skipped, bytes: formatBytes(bytes) });
  });

  // Gửi bằng form (trình duyệt tự hiện hộp Save cho file zip), nên kiểm tra Sec-Fetch-Site như /chay.
  app.post(`${BASE}/tai-zip`, async (c) => {
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const plan = zipPlan(idList(body.ids));
    if (!plan.entries.length) return c.text("Các dòng đã chọn chưa có video nào để tải.", 404);
    const { stream, size } = zipStream(plan.entries);
    const name = zipName();
    logger.info({ files: plan.entries.length, bytes: size }, "Bảng mới: tải zip");
    stream.on("error", (e) => logger.warn({ err: e }, "Bảng mới: tải zip bị dừng"));
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    });
  });

  /** Dọn tất cả (17.9, D26): hỏi lại, hiện số dòng và dung lượng sẽ giải phóng. */
  const cleanupPlan = (includeTodo: boolean) => {
    const ids = cleanupIds(db, includeTodo);
    let bytes = 0;
    for (const id of ids) {
      const r = getRow(db, id);
      if (r) for (const f of rowFiles(r)) bytes += files.fileBytes(f);
    }
    return { ids, bytes };
  };

  app.get(`${BASE}/don`, (c) => {
    const includeTodo = c.req.query("ca") === "1";
    const plan = cleanupPlan(includeTodo);
    const running = lockedBangRows(db).size;
    return c.html(
      page(
        "Dọn tất cả",
        <>
          <h1>Dọn tất cả</h1>
          <p class="muted">
            Xoá các dòng <strong>Xong</strong> cùng ảnh và video của chúng khỏi máy này để giải phóng chỗ. Số dòng đã xoá không dùng lại. Video
            nào còn cần thì bấm ⬇ tải về trước.
          </p>
          <form method="get" action={`${BASE}/don`} class="card">
            <label class="inline">
              <input type="checkbox" name="ca" value="1" checked={includeTodo} onchange="this.form.submit()" /> Xoá cả dòng chưa tạo (chưa có video,
              thiếu dữ liệu, cần xem)
            </label>
          </form>
          {running > 0 && <Alert kind="warn">{running} dòng đang tạo video: không bao giờ bị xoá.</Alert>}
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
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const plan = cleanupPlan(body.ca === "1");
    removeFiles(deleteRows(db, plan.ids));
    logger.info({ rows: plan.ids.length, bytes: plan.bytes }, "Bảng mới: đã dọn");
    return c.redirect(`${BASE}?ok=${encodeURIComponent(`Đã xoá ${plan.ids.length} dòng, giải phóng ${formatBytes(plan.bytes)}.`)}`, 303);
  });

  /** Thêm dòng: không có file → một dòng trống; có file → mỗi ảnh một dòng (Mẫu trước). */
  app.post(`${BASE}/them`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await c.req.parseBody({ all: true });
    const list = ([] as unknown[]).concat(body.files ?? []).filter((f): f is File => f instanceof File);
    if (list.length === 0) {
      const id = addRow(db);
      return c.json({ ok: true, ids: [id], problems: [] });
    }
    const ids: number[] = [];
    const problems: string[] = [];
    for (const f of list) {
      const data = new Uint8Array(await f.arrayBuffer());
      const problem = imageProblem(data);
      if (problem) {
        problems.push(`${f.name}: ${problem}`);
        continue;
      }
      const id = addRow(db);
      setSlot(db, id, "modelFront", files.saveImage(`${id}-${SLOT_TAG.modelFront}`, data));
      ids.push(id);
    }
    logger.info({ added: ids.length, skipped: problems.length }, "Bảng mới: đã thêm dòng từ ảnh");
    return c.json({ ok: true, ids, problems });
  });

  app.post(`${BASE}/prompt`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    const id = Number(body?.row);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const why = editable(id);
    if (why) return c.json({ ok: false, message: why }, 409);
    setPrompt(db, id, String(body.prompt ?? "").trim());
    return c.json({ ok: true });
  });

  const fillTargets = (body: Record<string, unknown>): number[] | null => {
    const source = Number(body.source);
    if (body.mode === "down") return allRowIds(db).filter((id) => id > source);
    return parseRowList(String(body.rows ?? ""));
  };

  app.post(`${BASE}/dai-prompt/xem`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const ids = fillTargets(body);
    if (ids === null) return c.json({ ok: false, message: "Ô dòng chưa đúng dạng, ví dụ: 3-6, 9" });
    const plan = planBangFill(db, Number(body.source), ids, body.includeVideo === true);
    if ("error" in plan) return c.json({ ok: false, message: plan.error });
    const skipped = plan.skipped.length ? ` Bỏ qua: ${plan.skipped.map((s) => `dòng ${s.id} (${s.why})`).join("; ")}.` : "";
    const summary = plan.targets.length
      ? `Sẽ thay prompt của ${plan.targets.length} dòng (dòng ${plan.targets.join(", ")}) bằng prompt của dòng ${Number(body.source)}.${skipped}`
      : `Không có dòng nào cần thay.${skipped}`;
    return c.json({ ok: true, count: plan.targets.length, summary });
  });

  app.post(`${BASE}/dai-prompt`, async (c) => {
    if (!fromPage(c)) return deny(c);
    const body = await json(c);
    if (!body) return c.json({ ok: false, message: "Yêu cầu không hợp lệ" }, 400);
    const ids = fillTargets(body);
    if (ids === null) return c.json({ ok: false, message: "Ô dòng chưa đúng dạng, ví dụ: 3-6, 9" });
    // Tính lại ngay lúc ghi: dòng vừa bị khoá / đã có video giữa lúc xem trước và lúc bấm thì bỏ qua.
    const plan = planBangFill(db, Number(body.source), ids, body.includeVideo === true);
    if ("error" in plan) return c.json({ ok: false, message: plan.error });
    applyBangFill(db, plan);
    return c.json({ ok: true, message: `Đã thay prompt của ${plan.targets.length} dòng.` });
  });

  // ---------- Tạo video (CON-52, spec 17.4, 17.5) ----------
  const hookChoice = (): HookChoice => ({ dayText: getHookSettings(db).dayText, clipExists: (n) => !!files.clipPath(n) });

  app.get(`${BASE}/chuan-bi`, (c) => {
    const ids = parseIds(c.req.query("ids") ?? "");
    const extra = c.req.query("extra") ?? "";
    const hookSet = getHookSettings(db);
    const withHook = c.req.query("hook") === "1";
    const plan = planBangBatch(db, ids, getSettings(db), extra, withHook ? hookChoice() : undefined);
    const quota = getDailyQuota(db);
    const active = activeBatch(db);
    const over = plan.runs.length > quota.remaining;
    const can = plan.runs.length > 0 && !active && !over;
    return c.html(
      page(
        "Tạo video",
        <>
          <h1>Tạo video · {plan.runs.length} dòng</h1>
          <p class="muted">
            Bot gửi lần lượt từng dòng cho Muse, mỗi dòng một cuộc trò chuyện mới trong tab riêng, ảnh đính kèm theo đúng thứ tự bên dưới, và chờ
            tối đa {getSettings(db).parallelVideos} video cùng lúc (đổi ở Cài đặt). Video nào xong thì bot tải về máy và gắn vào đúng dòng đó.
          </p>
          {active && <Alert kind="warn">Lô #{active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo video tiếp.</Alert>}
          {over && (
            <Alert kind="warn">
              Hôm nay còn {quota.remaining} lượt (đã tạo {quota.used}/{quota.limit}) nhưng đang chọn {plan.runs.length} dòng. Bỏ bớt dòng, hoặc nâng
              giới hạn ở <a href="/settings">Cài đặt</a>.
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
            <label class="inline" style="margin-bottom:8px">
              <input type="checkbox" name="hook" value="1" checked={withHook} onchange="this.form.submit()" /> <strong>Thêm hook</strong> vào đầu video
              {withHook && (
                <span class="muted">
                  {" "}
                  · câu chung hôm nay: {hookSet.dayText ? `“${hookSet.dayText}”` : <em>(chưa điền, điền ở Bảng)</em>}
                </span>
              )}
            </label>
            <label for="extra">Yêu cầu thêm chung (không bắt buộc)</label>
            <textarea id="extra" name="extra" rows={2} placeholder="Ví dụ: chuyển động chậm, ánh sáng giữ như ảnh">
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
              <div class="row-between" style="margin-bottom:8px">
                <strong>
                  Dòng {r.row.id} · {BANG_KIND_TEXT[r.request.kind]}
                  {r.overwrite && <span class="muted small"> · đã có video, tạo lại</span>}
                </strong>
              </div>
              <div class="row" style="margin-bottom:8px">
                {r.request.attachments.map((a, i) => (
                  <figure style="margin:0;text-align:center">
                    <img class="thumb" src={imageUrl(a.name)} alt={attachmentText(i, a.slot)} loading="lazy" width="64" height="64" />
                    <figcaption class="small muted">{attachmentText(i, a.slot)}</figcaption>
                  </figure>
                ))}
              </div>
              {r.hookText && r.row.hookClip && (
                <div class="small" style="margin-bottom:8px">
                  <strong>Hook:</strong>{" "}
                  <a href={clipUrl(r.row.hookClip)} target="_blank" rel="noreferrer">
                    🎬 clip hook
                  </a>{" "}
                  + “{r.hookText}” <span class="muted">({r.hookOwn ? "câu riêng của dòng" : "câu chung hôm nay"})</span>
                </div>
              )}
              <details>
                <summary>Yêu cầu gửi Muse</summary>
                <pre class="request">{r.request.text}</pre>
              </details>
            </div>
          ))}
          <form method="post" action={`${BASE}/chay`} class="card actionbar">
            <Hidden name="ids" value={plan.runs.map((r) => r.row.id).join(",")} />
            <Hidden name="extra" value={extra} />
            {withHook && <Hidden name="hook" value="1" />}
            <span class="muted small">
              Hôm nay {quota.used}/{quota.limit} video · {plan.runs.length} dòng mất {estimateText(db, plan.runs.length, getSettings(db))}, máy cần
              bật suốt lô
            </span>
            <div class="row">
              <a class="button secondary" href={BASE}>
                Quay lại
              </a>
              <button type="submit" disabled={!can}>
                ▶ Bắt đầu tạo {plan.runs.length} video
              </button>
            </div>
          </form>
        </>,
      ),
    );
  });

  app.post(`${BASE}/chay`, async (c) => {
    // Chỉ nhận từ chính trang của tool: trình duyệt gắn Sec-Fetch-Site cho mọi yêu cầu gửi form.
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const back = (key: "ok" | "msg", text: string) => c.redirect(`${BASE}?${key === "ok" ? "ok" : "loi"}=${encodeURIComponent(text)}`, 303);
    const runner = deps.runner;
    if (!runner) return back("msg", "Bot chưa sẵn sàng.");
    const active = activeBatch(db);
    if (active) return back("msg", `Lô #${active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo video tiếp.`);
    const extra = String(body.extra ?? "");
    const plan = planBangBatch(db, parseIds(String(body.ids ?? "")), getSettings(db), extra, body.hook === "1" ? hookChoice() : undefined);
    if (plan.runs.length === 0) return back("msg", "Không có dòng nào tạo video được.");
    const quota = getDailyQuota(db);
    if (plan.runs.length > quota.remaining) return back("msg", `Hôm nay chỉ còn ${quota.remaining} lượt.`);
    const batchId = insertBangBatch(db, extra, plan.runs);
    logger.info({ batchId, rows: plan.runs.map((r) => r.row.id) }, "Đã tạo lô từ Bảng mới");
    const started = runner.start(batchId);
    if (!started.ok) return back("msg", started.message);
    const skipped = plan.rejected.length ? ` Bỏ qua: ${plan.rejected.map((r) => `dòng ${r.id} (${r.why})`).join("; ")}.` : "";
    return back("ok", `Đang tạo video cho ${plan.runs.length} dòng (lô #${batchId}). Bot gửi lần lượt từng dòng cho Muse và chờ tối đa ${getSettings(db).parallelVideos} video cùng lúc; bảng tự cập nhật.${skipped}`);
  });

  // ---------- Nhập từ Google Sheet (17.6) ----------
  const sheetChoices = () => listSheetConfigs(db);

  app.get(`${BASE}/nhap`, (c) => {
    const configs = sheetChoices();
    return c.html(page("Nhập từ Google Sheet", <ImportForm configs={configs.map((s) => ({ value: `${s.spreadsheetId}|${s.tab}`, text: `${sheetName(s)} › ${s.tab}` }))} />));
  });

  app.post(`${BASE}/nhap`, async (c) => {
    const body = await c.req.parseBody();
    const [id, ...rest] = String(body.sheet ?? "").split("|");
    const tab = rest.join("|");
    const includeVideo = body.includeVideo === "1";
    const confirm = body.step === "go";
    const configs = sheetChoices().map((s) => ({ value: `${s.spreadsheetId}|${s.tab}`, text: `${sheetName(s)} › ${s.tab}` }));
    const cfg = getSheetConfig(db, id ?? "", tab);
    if (!cfg) return c.html(page("Nhập từ Google Sheet", <ImportForm configs={configs} error="Chọn một trang tính đã kết nối." />), 400);
    if (!deps.sheets || !deps.drive) return c.html(page("Nhập từ Google Sheet", <ImportForm configs={configs} error="Chưa nạp khoá Google nên chưa đọc được sheet." />), 400);
    let plan: ImportPlan;
    try {
      const grid = await deps.sheets.readTab(cfg.spreadsheetId, cfg.tab);
      plan = planImport(grid, cfg, importedKeys(db, `${cfg.spreadsheetId}|${cfg.tab}|`), includeVideo);
    } catch (e) {
      return c.html(page("Nhập từ Google Sheet", <ImportForm configs={configs} error={describeGoogleError(e, clientEmail)} />), 502);
    }
    const selected = `${cfg.spreadsheetId}|${cfg.tab}`;
    if (!confirm || plan.add.length === 0) {
      return c.html(page("Nhập từ Google Sheet", <ImportForm configs={configs} selected={selected} includeVideo={includeVideo} plan={plan} />));
    }
    const result = await runImport(db, files, deps.drive, plan, clientEmail);
    logger.info({ spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, added: result.added.length, problems: result.problems.length }, "Bảng mới: đã nhập từ sheet");
    const okText = `Đã nhập ${result.added.length} dòng từ "${cfg.tab}" (dòng ${result.added[0]!.id}–${result.added[result.added.length - 1]!.id} trên Bảng mới).`;
    if (result.problems.length === 0) return c.redirect(bangUrl({ ok: okText }), 303);
    return c.html(
      page(
        "Nhập từ Google Sheet",
        <>
          <h1>Nhập từ Google Sheet</h1>
          <Alert kind="ok">{okText}</Alert>
          <Alert kind="warn">
            Một số ảnh không tải được, ô ảnh đó để trống (bấm + trên Bảng mới để chọn ảnh từ máy):
            <ul>
              {result.problems.map((p) => (
                <li>{p}</li>
              ))}
            </ul>
          </Alert>
          <a class="button" href={BASE}>
            Về Bảng mới
          </a>
        </>,
      ),
    );
  });
}

function ImportForm(props: { configs: { value: string; text: string }[]; selected?: string; includeVideo?: boolean; plan?: ImportPlan; error?: string }) {
  const p = props.plan;
  return (
    <>
      <h1>Nhập từ Google Sheet</h1>
      <p class="muted">
        Tool chỉ <strong>đọc</strong> sheet: lấy prompt, tải ảnh người mẫu và ảnh áo từ link Drive về máy; mỗi dòng sheet thành một dòng mới trên Bảng mới.
        Không ghi gì lên sheet. Dòng đã nhập lần trước được bỏ qua.
      </p>
      {props.error && <Alert kind="warn">{props.error}</Alert>}
      {props.configs.length === 0 ? (
        <Alert kind="warn">
          Chưa kết nối sheet nào. Kết nối ở <a href="/sheets">Kết nối sheet</a> trước.
        </Alert>
      ) : (
        <form method="post" action={`${BASE}/nhap`} class="card">
          <label for="sheet">Trang tính</label>
          <select id="sheet" name="sheet">
            {props.configs.map((o) => (
              <option value={o.value} selected={o.value === props.selected}>
                {o.text}
              </option>
            ))}
          </select>
          <label class="inline" style="margin-top:10px">
            <input type="checkbox" name="includeVideo" value="1" checked={props.includeVideo} /> Nhập cả dòng đã có video (chỉ lấy prompt và ảnh)
          </label>
          {p && (
            <div class="card" style="margin-top:12px">
              {p.add.length ? (
                <strong>Sẽ thêm {p.add.length} dòng (dòng sheet {p.add.map((a) => a.row).join(", ")}).</strong>
              ) : (
                <strong>Không có dòng nào để nhập.</strong>
              )}
              {p.skipped.length > 0 && <div class="muted small">Bỏ qua: {p.skipped.map((s) => `dòng ${s.row} (${s.why})`).join("; ")}.</div>}
            </div>
          )}
          <div class="row" style="margin-top:12px">
            <button type="submit" name="step" value="preview" class={p?.add.length ? "secondary" : ""}>
              Xem trước
            </button>
            {p && p.add.length > 0 && (
              <button type="submit" name="step" value="go">
                Nhập {p.add.length} dòng
              </button>
            )}
            <a class="button secondary" href={BASE}>
              Huỷ
            </a>
          </div>
        </form>
      )}
    </>
  );
}

// Chữ có dấu trong JS viết bằng \\u để không phụ thuộc mã hoá trang; không dùng dấu ` hay ${ } trong đoạn này.
const CLIENT_JS = `
(function () {
  var page = document.getElementById("bangmoi");
  if (!page) return;
  function req(path, init) {
    init.headers = Object.assign({ "X-Masys": "1" }, init.headers || {});
    return fetch(path, init).then(function (r) { return r.json(); });
  }
  function postJson(path, body) { return req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function reload(text) { location.href = page.dataset.self + (page.dataset.self.indexOf("?") < 0 ? "?" : "&") + "ok=" + encodeURIComponent(text); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function imagesOnly(list) { return Array.prototype.filter.call(list, function (f) { return /^image\\//.test(f.type) || /\\.(jpe?g|png|webp)$/i.test(f.name); }); }

  // Đặt ảnh vào một ô.
  function upload(td, file) {
    var row = td.closest("tr").dataset.row, slot = td.dataset.slot;
    var fd = new FormData(); fd.append("row", row); fd.append("slot", slot); fd.append("file", file);
    td.classList.add("busy");
    req("/bang-moi/anh", { method: "POST", body: fd }).then(function (r) {
      if (r.ok) return location.reload();
      td.classList.remove("busy"); alert(r.message);
    }, function () { td.classList.remove("busy"); alert("Kh\\u00f4ng k\\u1ebft n\\u1ed1i \\u0111\\u01b0\\u1ee3c tool."); });
  }
  var filePick = document.getElementById("filePick"), target = null;
  filePick.addEventListener("change", function () { if (target && filePick.files[0]) upload(target, filePick.files[0]); filePick.value = ""; });
  document.querySelectorAll("td.slot .pick").forEach(function (b) {
    b.addEventListener("click", function () { target = b.closest("td"); filePick.click(); });
  });
  document.querySelectorAll("td.slot .unset").forEach(function (b) {
    b.addEventListener("click", function () {
      var td = b.closest("td");
      if (!confirm("B\\u1ecf \\u1ea3nh n\\u00e0y?")) return;
      postJson("/bang-moi/bo-anh", { row: Number(td.closest("tr").dataset.row), slot: td.dataset.slot }).then(function (r) { if (r.ok) location.reload(); else alert(r.message); });
    });
  });
  document.querySelectorAll("td.slot").forEach(function (td) {
    if (!td.querySelector(".pick")) return;
    td.addEventListener("dragover", function (e) { e.preventDefault(); td.classList.add("over"); });
    td.addEventListener("dragleave", function () { td.classList.remove("over"); });
    td.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); td.classList.remove("over");
      var f = imagesOnly(e.dataTransfer.files)[0]; if (f) upload(td, f);
    });
  });

  // Thêm dòng: một dòng trống, hoặc mỗi ảnh một dòng.
  var addMsg = document.getElementById("addMsg");
  function addRows(list) {
    var fd = new FormData();
    list.forEach(function (f) { fd.append("files", f); });
    addMsg.textContent = list.length ? "\\u0110ang th\\u00eam " + list.length + " \\u1ea3nh\\u2026" : "\\u0110ang th\\u00eam\\u2026";
    req("/bang-moi/them", { method: "POST", body: fd }).then(function (r) {
      if (!r.ok) { addMsg.textContent = r.message; return; }
      var text = r.ids.length === 1 ? "\\u0110\\u00e3 th\\u00eam d\\u00f2ng " + r.ids[0] + "." : "\\u0110\\u00e3 th\\u00eam " + r.ids.length + " d\\u00f2ng.";
      if (r.problems.length) text += " Kh\\u00f4ng nh\\u1eadn: " + r.problems.join("; ");
      location.href = "/bang-moi?ok=" + encodeURIComponent(text);
    }, function () { addMsg.textContent = "Kh\\u00f4ng k\\u1ebft n\\u1ed1i \\u0111\\u01b0\\u1ee3c tool."; });
  }
  document.getElementById("addOne").addEventListener("click", function () { addRows([]); });
  var filesPick = document.getElementById("filesPick");
  document.getElementById("addMany").addEventListener("click", function () { filesPick.click(); });
  filesPick.addEventListener("change", function () { var l = imagesOnly(filesPick.files); filesPick.value = ""; if (l.length) addRows(l); });
  var drop = document.getElementById("dropAdd");
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("over");
    var l = imagesOnly(e.dataTransfer.files); if (l.length) addRows(l);
  });
  // Thả ảnh ra ngoài ô thì trình duyệt mở ảnh: chặn lại.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  // Sửa prompt.
  document.querySelectorAll("button.prompt-edit").forEach(function (b) {
    b.addEventListener("click", function () {
      var td = b.closest("td");
      if (td.querySelector(".editor")) return;
      var row = Number(td.closest("tr").dataset.row);
      var box = el("div", "editor"), input = el("textarea");
      input.rows = 5; input.value = td.dataset.value; box.appendChild(input);
      var bar = el("div", "row"), save = el("button", "small", "L\\u01b0u"), cancel = el("button", "secondary small", "Hu\\u1ef7"), msg = el("span", "small warn-text");
      save.type = cancel.type = "button";
      bar.appendChild(save); bar.appendChild(cancel); bar.appendChild(msg); box.appendChild(bar);
      cancel.addEventListener("click", function () { box.remove(); });
      save.addEventListener("click", function () {
        save.disabled = true;
        postJson("/bang-moi/prompt", { row: row, prompt: input.value }).then(function (r) {
          if (r.ok) return reload("\\u0110\\u00e3 l\\u01b0u prompt d\\u00f2ng " + row + ".");
          save.disabled = false; msg.textContent = r.message;
        });
      });
      td.appendChild(box); input.focus();
    });
  });

  // Chọn dòng (CON-112): danh sách dòng đã chọn giữ trong tab này (sessionStorage), đổi trang / lọc / tìm / tự tải lại
  // không mất; đóng tab thì hết. Dòng đang tạo video (khoá) tự rời danh sách.
  var SEL_KEY = "bangMoiChon";
  var sel = {};
  try { (JSON.parse(sessionStorage.getItem(SEL_KEY) || "[]") || []).forEach(function (id) { sel[String(id)] = 1; }); } catch (e) {}
  (page.dataset.locked || "").split(",").forEach(function (id) { if (id) delete sel[id]; });
  function saveSel() { try { sessionStorage.setItem(SEL_KEY, JSON.stringify(Object.keys(sel).map(Number))); } catch (e) {} }
  function checked() { return Object.keys(sel).map(Number).sort(function (a, b) { return a - b; }).map(String); }
  var runBtn = document.getElementById("runBtn"), runHint = document.getElementById("runHint");
  var delBtn = document.getElementById("delBtn"), selNone = document.getElementById("selNone"), selCount = document.getElementById("selCount");
  var dlBtn = document.getElementById("dlBtn"), selAll = document.getElementById("selAll"), dlMsg = document.getElementById("dlMsg");
  var zipForm = document.getElementById("zipForm");
  function boxes() { return Array.prototype.slice.call(document.querySelectorAll("input.pick-row")); }
  function pickable() { return boxes().filter(function (c) { return !c.disabled; }); }
  function setBox(c, on) { c.checked = on; if (on) sel[c.value] = 1; else delete sel[c.value]; }
  boxes().forEach(function (c) { if (c.disabled) delete sel[c.value]; else c.checked = !!sel[c.value]; });
  saveSel();
  // Số dòng đã chọn, có bao nhiêu dòng nằm ở trang khác.
  function selSummary(mid) {
    var n = checked().length;
    var here = boxes().filter(function (c) { return c.checked; }).length;
    return n + " d\\u00f2ng" + (mid || "") + (n > here ? " (g\\u1ed3m " + (n - here) + " d\\u00f2ng \\u1edf trang kh\\u00e1c)" : "");
  }
  function countText() { return checked().length ? "\\u0110\\u00e3 ch\\u1ecdn " + selSummary() + "." : "Ch\\u01b0a ch\\u1ecdn d\\u00f2ng n\\u00e0o."; }
  function syncRun() {
    saveSel();
    var n = checked().length;
    delBtn.disabled = n === 0;
    dlBtn.disabled = n === 0;
    selNone.disabled = n === 0;
    selCount.textContent = countText();
    var list = pickable();
    var all = list.length > 0 && list.every(function (c) { return c.checked; });
    selAll.textContent = all ? "B\\u1ecf ch\\u1ecdn t\\u1ea5t c\\u1ea3 (trang n\\u00e0y)" : "Ch\\u1ecdn t\\u1ea5t c\\u1ea3 (trang n\\u00e0y)";
    selAll.dataset.all = all ? "1" : "";
    if (runBtn.dataset.blocked) return;
    runBtn.disabled = n === 0;
    runHint.textContent = n ? "B\\u1ea5m \\u25b6 T\\u1ea1o video \\u0111\\u1ec3 t\\u1ea1o video cho c\\u00e1c d\\u00f2ng \\u0111\\u00e3 ch\\u1ecdn." : "T\\u00edch c\\u00e1c d\\u00f2ng c\\u1ea7n t\\u1ea1o video.";
  }
  boxes().forEach(function (c) { c.addEventListener("change", function () { setBox(c, c.checked); syncRun(); }); });
  runBtn.addEventListener("click", function () { location.href = "/bang-moi/chuan-bi?ids=" + checked().join(","); });
  // Bỏ chọn: mọi dòng ở mọi trang.
  selNone.addEventListener("click", function () {
    sel = {};
    boxes().forEach(function (c) { c.checked = false; });
    syncRun();
  });
  delBtn.addEventListener("click", function () {
    var ids = checked();
    if (!ids.length || !confirm("Xo\\u00e1 " + selSummary(" \\u0111\\u00e3 ch\\u1ecdn") + " c\\u00f9ng \\u1ea3nh v\\u00e0 video c\\u1ee7a ch\\u00fang? Kh\\u00f4ng l\\u1ea5y l\\u1ea1i \\u0111\\u01b0\\u1ee3c.")) return;
    postJson("/bang-moi/xoa", { rows: ids.map(Number) }).then(function (r) {
      ids.forEach(function (id) { delete sel[id]; });
      saveSel();
      reload(r.message);
    });
  });
  // Ô Video: ▶ mới tải video và phát ngay trên trang; 🗑 xoá video khỏi dòng.
  document.querySelectorAll("button.vid-play").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = document.createElement("video");
      v.controls = true; v.autoplay = true; v.playsInline = true; v.src = b.closest(".vid").dataset.src;
      b.replaceWith(v);
    });
  });
  document.querySelectorAll("button.vid-del").forEach(function (b) {
    b.addEventListener("click", function () {
      var row = Number(b.closest("tr").dataset.row);
      if (!confirm("Xo\\u00e1 video d\\u00f2ng " + row + "? File video tr\\u00ean m\\u00e1y s\\u1ebd b\\u1ecb xo\\u00e1; \\u1ea3nh v\\u00e0 prompt gi\\u1eef nguy\\u00ean.")) return;
      postJson("/bang-moi/xoa-video", { row: row }).then(function (r) { if (r.ok) location.reload(); else alert(r.message); });
    });
  });
  // Đang tạo video: tự tải lại 15 giây một lần, trừ khi đang sửa dở. Dòng đã chọn vẫn giữ sau khi tải lại (CON-112).
  if (page.dataset.live) setInterval(function () {
    if (document.querySelector(".editor") || !document.getElementById("fillBox").hidden || document.querySelector(".vid video")) return;
    if (document.activeElement && document.activeElement.id === "hookDay") return;
    location.reload();
  }, 15000);
  // Chọn tất cả / Bỏ chọn tất cả: mọi dòng trên trang trừ dòng đang tạo video (ô tích bị khoá).
  selAll.addEventListener("click", function () {
    var on = !selAll.dataset.all;
    pickable().forEach(function (c) { setBox(c, on); });
    syncRun();
  });
  // Chọn dòng xong: dòng đã có video (trên trang này; dòng đã chọn ở trang khác giữ nguyên).
  document.getElementById("selDone").addEventListener("click", function () {
    pickable().forEach(function (c) { setBox(c, !!c.closest("tr").dataset.dl); });
    syncRun();
  });
  // Tải các dòng đã chọn (CON-112): tool gom video của mọi dòng đã chọn (mọi trang) vào một file zip, bấm Save một lần.
  dlBtn.addEventListener("click", function () {
    var ids = checked();
    if (!ids.length) return;
    dlMsg.hidden = false;
    dlMsg.textContent = "\\u0110ang ki\\u1ec3m tra\\u2026";
    postJson("/bang-moi/tai-zip/xem", { rows: ids.map(Number) }).then(function (r) {
      var skipText = r.skipped && r.skipped.length ? " B\\u1ecf qua d\\u00f2ng " + r.skipped.join(", ") + " (ch\\u01b0a c\\u00f3 video)." : "";
      if (!r.ok) { dlMsg.textContent = r.message; return; }
      if (!r.count) { dlMsg.textContent = "C\\u00e1c d\\u00f2ng \\u0111\\u00e3 ch\\u1ecdn ch\\u01b0a c\\u00f3 video n\\u00e0o \\u0111\\u1ec3 t\\u1ea3i."; return; }
      zipForm.elements.ids.value = ids.join(",");
      zipForm.submit();
      dlMsg.textContent = "\\u0110ang gom " + r.count + " video (" + r.bytes + ") v\\u00e0o m\\u1ed9t file zip. Khi Chrome h\\u1ecfi, b\\u1ea5m Save m\\u1ed9t l\\u1ea7n r\\u1ed3i gi\\u1ea3i n\\u00e9n ra th\\u01b0 m\\u1ee5c." + skipText;
    }, function () { dlMsg.textContent = "Kh\\u00f4ng k\\u1ebft n\\u1ed1i \\u0111\\u01b0\\u1ee3c tool."; });
  });
  syncRun();
  document.getElementById("selReady").addEventListener("click", function () {
    var ready = (page.dataset.ready || "").split(",");
    pickable().forEach(function (c) { setBox(c, ready.indexOf(c.value) >= 0); });
    syncRun();
  });

  // Dải prompt.
  var fillBox = document.getElementById("fillBox"), fillMsg = document.getElementById("fillMsg"), fillGo = document.getElementById("fillGo");
  document.getElementById("fillToggle").addEventListener("click", function () {
    fillBox.hidden = !fillBox.hidden;
    if (fillBox.hidden) return;
    fillBox.scrollIntoView({ block: "nearest" });
    var c = checked();
    if (c.length && !document.getElementById("fillSource").value) document.getElementById("fillSource").value = c[c.length - 1];
    if (c.length > 1) document.getElementById("fillRows").value = c.slice(0, -1).join(", ");
  });
  function fillBody() {
    var mode = document.querySelector("input[name=fillMode]:checked").value;
    return { source: Number(document.getElementById("fillSource").value), mode: mode, rows: document.getElementById("fillRows").value, includeVideo: document.getElementById("fillVideo").checked };
  }
  document.getElementById("fillPreview").addEventListener("click", function () {
    fillGo.hidden = true; fillMsg.textContent = "\\u2026";
    postJson("/bang-moi/dai-prompt/xem", fillBody()).then(function (r) {
      fillMsg.textContent = r.ok ? r.summary : r.message;
      fillGo.hidden = !(r.ok && r.count > 0);
    });
  });
  fillGo.addEventListener("click", function () {
    fillGo.disabled = true;
    postJson("/bang-moi/dai-prompt", fillBody()).then(function (r) {
      if (r.ok) return reload(r.message);
      fillGo.disabled = false; fillMsg.textContent = r.message;
    });
  });

  // Hook \\u0111\\u1ea7u video (CON-74): \\u00f4 Th\\u00eam hook, c\\u00e2u hook chung h\\u00f4m nay, clip hook v\\u00e0 c\\u00e2u ri\\u00eang c\\u1ee7a t\\u1eebng d\\u00f2ng, Gh\\u00e9p hook.
  var hookOn = document.getElementById("hookOn"), hookBox = document.getElementById("hookBox"), hookMsg = document.getElementById("hookMsg");
  hookOn.addEventListener("change", function () {
    postJson("/bang-moi/hook-chung", { on: hookOn.checked }).then(function (r) {
      if (!r.ok) { alert(r.message); return; }
      location.reload();
    });
  });
  function saveDay() {
    var v = document.getElementById("hookDay").value;
    hookMsg.textContent = "\\u0110ang l\\u01b0u\\u2026";
    postJson("/bang-moi/hook-chung", { text: v }).then(function (r) {
      hookMsg.className = r.ok ? "small ok-text" : "small warn-text";
      hookMsg.textContent = r.ok ? (v.trim() ? "\\u0110\\u00e3 l\\u01b0u c\\u00e2u hook chung h\\u00f4m nay." : "\\u0110\\u00e3 xo\\u00e1 c\\u00e2u hook chung.") : r.message;
    });
  }
  if (hookBox) {
    document.getElementById("hookDaySave").addEventListener("click", saveDay);
    document.getElementById("hookDay").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); saveDay(); } });
  }
  var clipPick = document.getElementById("clipPick"), clipTarget = null;
  function clipsOnly(list) { return Array.prototype.filter.call(list, function (f) { return /^video\\//.test(f.type) || /\\.(mp4|mov|webm|mkv)$/i.test(f.name); }); }
  function uploadClip(td, file) {
    var row = td.closest("tr").dataset.row;
    var fd = new FormData(); fd.append("row", row); fd.append("file", file);
    td.classList.add("busy");
    req("/bang-moi/clip-hook", { method: "POST", body: fd }).then(function (r) {
      if (r.ok) return location.reload();
      td.classList.remove("busy"); alert(r.message);
    }, function () { td.classList.remove("busy"); alert("Kh\\u00f4ng k\\u1ebft n\\u1ed1i \\u0111\\u01b0\\u1ee3c tool."); });
  }
  clipPick.addEventListener("change", function () { if (clipTarget && clipPick.files[0]) uploadClip(clipTarget, clipPick.files[0]); clipPick.value = ""; });
  document.querySelectorAll("td.hook .clip-pick").forEach(function (b) {
    b.addEventListener("click", function () { clipTarget = b.closest("td"); clipPick.click(); });
  });
  document.querySelectorAll("td.hook").forEach(function (td) {
    if (!td.querySelector(".clip-pick")) return;
    td.addEventListener("dragover", function (e) { e.preventDefault(); td.classList.add("over"); });
    td.addEventListener("dragleave", function () { td.classList.remove("over"); });
    td.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); td.classList.remove("over");
      var f = clipsOnly(e.dataTransfer.files)[0]; if (f) uploadClip(td, f);
    });
  });
  document.querySelectorAll("td.hook .clip-unset").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!confirm("B\\u1ecf clip hook c\\u1ee7a d\\u00f2ng n\\u00e0y? File clip tr\\u00ean m\\u00e1y s\\u1ebd b\\u1ecb xo\\u00e1.")) return;
      postJson("/bang-moi/bo-clip-hook", { row: Number(b.closest("tr").dataset.row) }).then(function (r) { if (r.ok) location.reload(); else alert(r.message); });
    });
  });
  document.querySelectorAll("button.hooktext-edit").forEach(function (b) {
    b.addEventListener("click", function () {
      var td = b.closest("td");
      if (td.querySelector(".editor")) return;
      var row = Number(td.closest("tr").dataset.row);
      var box = el("div", "editor"), input = el("input");
      input.type = "text"; input.maxLength = 200; input.value = td.dataset.value; input.placeholder = "\\u0110\\u1ec3 tr\\u1ed1ng = d\\u00f9ng c\\u00e2u chung h\\u00f4m nay"; box.appendChild(input);
      var bar = el("div", "row"), save = el("button", "small", "L\\u01b0u"), cancel = el("button", "secondary small", "Hu\\u1ef7"), msg = el("span", "small warn-text");
      save.type = cancel.type = "button";
      bar.appendChild(save); bar.appendChild(cancel); bar.appendChild(msg); box.appendChild(bar);
      cancel.addEventListener("click", function () { box.remove(); });
      save.addEventListener("click", function () {
        save.disabled = true;
        postJson("/bang-moi/cau-hook", { row: row, text: input.value }).then(function (r) {
          if (r.ok) return reload("\\u0110\\u00e3 l\\u01b0u c\\u00e2u hook d\\u00f2ng " + row + ".");
          save.disabled = false; msg.textContent = r.message;
        });
      });
      td.appendChild(box); input.focus();
    });
  });
  document.querySelectorAll("button.hook-merge").forEach(function (b) {
    b.addEventListener("click", function () {
      b.disabled = true;
      postJson("/bang-moi/ghep-hook", { row: Number(b.closest("tr").dataset.row) }).then(function (r) {
        if (r.ok) return reload(r.message);
        b.disabled = false; alert(r.message);
      });
    });
  });
})();
`;
