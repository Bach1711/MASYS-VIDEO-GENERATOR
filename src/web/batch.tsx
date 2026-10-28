import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import { activeRows, insertBatch, planRuns, type PlannedRun, type RowEdit } from "../batch/create.js";
import { checkSelection } from "../batch/selection.js";
import {
  DEFAULT_SHIRT_TEMPLATE,
  DEFAULT_TEMPLATE,
  fileStamp,
  folderLink,
  isFileStamp,
  lacksShirtSlot,
  NO_SHIRT_SLOT_WARNING,
  validateShirtTemplate,
  validateTemplate,
} from "../batch/template.js";
import { getDailyQuota } from "../db/quota.js";
import { getSettings } from "../db/settings.js";
import { getSheetConfig, sheetName, type SheetConfig } from "../db/sheetConfigs.js";
import { parseDriveLink, type DriveFolder } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import { normalizeHeader } from "../google/mapping.js";
import { logger } from "../logger.js";
import type { ScannedRow } from "../scan/labels.js";
import { scanTab } from "../scan/scan.js";
import { Alert, Hidden, QuotaBox, scanUrl, truncate } from "./components.js";
import { Layout } from "./layout.js";
import type { ScanDeps } from "./scan.js";

/** Dữ liệu form đi qua các bước chỉnh → xem trước → tạo lô. */
interface FormState {
  id: string;
  tab: string;
  rows: number[];
  overwrite: Set<number>;
  edits: Map<number, RowEdit>;
  batchExtra: string;
  folder: string;
  folderLinkInput: string;
  stamp: string;
  previewDigest: string;
}

function readForm(body: Record<string, unknown>): FormState {
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const nums = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(Number).filter(Number.isInteger);
  const rows = [...new Set(nums(body.row))].sort((a, b) => a - b);
  const edits = new Map<number, RowEdit>();
  for (const n of rows) {
    if (typeof body[`prompt_${n}`] === "string") edits.set(n, { prompt: str(`prompt_${n}`), extra: str(`extra_${n}`) });
  }
  const stamp = str("stamp");
  return {
    id: str("id"),
    tab: str("tab"),
    rows,
    overwrite: new Set(nums(body.overwrite)),
    edits,
    batchExtra: str("batchExtra"),
    folder: str("folder"),
    folderLinkInput: str("folderLink").trim(),
    stamp: isFileStamp(stamp) ? stamp : fileStamp(new Date()),
    previewDigest: str("previewDigest"),
  };
}

function digest(runs: PlannedRun[], folderId: string): string {
  const h = createHash("sha256").update(folderId);
  for (const r of runs) h.update(`\u0000${r.row}\u0000${r.requestText}`);
  return h.digest("hex");
}

/** Trường ẩn mang toàn bộ lựa chọn và chỉnh sửa qua các bước. */
function CarryFields(props: { f: FormState; rows: ScannedRow[]; withEdits: boolean }) {
  const { f, rows } = props;
  return (
    <>
      <Hidden name="id" value={f.id} />
      <Hidden name="tab" value={f.tab} />
      <Hidden name="stamp" value={f.stamp} />
      {rows.map((r) => (
        <>
          <Hidden name="row" value={r.row} />
          {r.label === "has_video" && <Hidden name="overwrite" value={r.row} />}
          {props.withEdits && (
            <>
              <Hidden name={`prompt_${r.row}`} value={f.edits.get(r.row)?.prompt ?? r.prompt} />
              <Hidden name={`extra_${r.row}`} value={f.edits.get(r.row)?.extra ?? ""} />
            </>
          )}
        </>
      ))}
      {props.withEdits && (
        <>
          <Hidden name="batchExtra" value={f.batchExtra} />
          <Hidden name="folder" value={f.folder} />
          <Hidden name="folderLink" value={f.folderLinkInput} />
        </>
      )}
    </>
  );
}

export function registerBatchRoutes(app: Hono, deps: ScanDeps) {
  const { config, db, sheets, drive, thumbs } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (title: string, body: Child) => "<!doctype html>" + <Layout title={title}>{body}</Layout>;

  app.post("/batch/prepare", async (c) => prepare(c));

  async function prepare(c: Context) {
    const body = await c.req.parseBody({ all: true });
    const f = readForm(body);
    const step = typeof body.step === "string" ? body.step : "edit";
    const cfg = getSheetConfig(db, f.id, f.tab);
    if (!sheets || !drive || !cfg) return c.text("Yêu cầu không hợp lệ", 400);

    const title = (
      <h1>
        Chuẩn bị lô · {sheetName(cfg)} → {f.tab}
      </h1>
    );
    const back = <a href={scanUrl(f.id, f.tab)}>← Quay lại bảng quét</a>;
    const fail = (msg: Child, status: 400 | 409 | 502 = 400) => c.html(page("Chuẩn bị lô", <>{title}<Alert kind="warn">{msg}</Alert>{back}</>), status);

    const quota = getDailyQuota(db);
    if (f.rows.length === 0) return fail("Chưa chọn dòng nào.");
    if (f.rows.length > quota.remaining) {
      return fail(`Đã chọn ${f.rows.length} dòng nhưng hôm nay chỉ còn ${quota.remaining} video (giới hạn ${quota.limit}/ngày).`);
    }

    // Luôn quét lại: dữ liệu trong sheet có thể vừa đổi giữa các bước.
    let scanned;
    try {
      scanned = await scanTab(sheets, drive, cfg);
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: f.id, tab: f.tab }, "Không quét được tab khi chuẩn bị lô");
      return fail(describeGoogleError(e, clientEmail), 502);
    }
    thumbs?.remember(scanned.images);
    const sel = checkSelection(scanned.rows, f.rows, f.overwrite);
    const busy = activeRows(db, f.id, f.tab);
    const rows = sel.accepted.filter((r) => !busy.has(r.row));
    const rejected = [
      ...sel.rejected,
      ...sel.accepted.filter((r) => busy.has(r.row)).map((r) => ({ row: r.row, why: "đang nằm trong một lô chưa chạy xong" })),
    ].sort((a, b) => a.row - b.row);
    if (rows.length === 0) {
      return fail(<>Không còn dòng nào chạy được: {rejected.map((r) => `dòng ${r.row} (${r.why})`).join("; ")}.</>, 409);
    }
    const rejectedNote = rejected.length > 0 && (
      <Alert kind="warn">Đã bỏ khỏi lô vì dữ liệu vừa thay đổi: {rejected.map((r) => `dòng ${r.row} (${r.why})`).join("; ")}.</Alert>
    );

    const settings = getSettings(db);
    const root = settings.driveRootFolderId;
    let rootFolder: DriveFolder | undefined;
    let subfolders: DriveFolder[] = [];
    let folderProblem: string | undefined;
    if (root) {
      try {
        rootFolder = await drive.getFolder(root);
        subfolders = await drive.listFolders(root);
      } catch (e) {
        folderProblem = `Không đọc được thư mục gốc: ${describeGoogleError(e, clientEmail)}`;
      }
    }
    if (!f.folder) {
      const video = subfolders.find((s) => normalizeHeader(s.name) === "video");
      f.folder = video?.id ?? rootFolder?.id ?? "";
    }

    const editPage = (errors: string[] = []) =>
      c.html(
        page(
          "Chuẩn bị lô",
          <EditForm
            title={title}
            f={f}
            rows={rows}
            quotaBox={<QuotaBox quota={quota} />}
            notes={
              <>
                {rejectedNote}
                {folderProblem && <Alert kind="warn">{folderProblem}</Alert>}
                {errors.length > 0 && (
                  <Alert kind="warn">
                    <ul>
                      {errors.map((e) => (
                        <li>{e}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </>
            }
            rootFolder={rootFolder}
            subfolders={subfolders}
            hasThumb={(id) => !!id && !!thumbs?.isKnown(id)}
            back={back}
          />,
        ),
        errors.length ? 400 : 200,
      );

    if (step === "edit") return editPage();

    // Bước xem trước / tạo lô: kiểm tra thư mục, mẫu, ghép yêu cầu.
    const errors: string[] = [];
    let folderId = f.folder;
    if (f.folderLinkInput) {
      const link = parseDriveLink(f.folderLinkInput);
      if (link?.kind === "folder") folderId = link.id;
      else errors.push("Link thư mục không đúng dạng https://drive.google.com/drive/folders/…");
    }
    let folder: DriveFolder | undefined;
    if (!folderId) errors.push("Chưa chọn thư mục Drive lưu video.");
    else if (!errors.length) {
      try {
        folder = await drive.getFolder(folderId);
      } catch (e) {
        errors.push(describeGoogleError(e, clientEmail));
      }
    }
    const template = settings.requestTemplate ?? DEFAULT_TEMPLATE;
    const templateProblems = validateTemplate(template);
    if (templateProblems.length) errors.push(`Mẫu yêu cầu đang lỗi (sửa ở Cài đặt): ${templateProblems.join(" ")}`);
    const shirtTemplate = settings.shirtTemplate ?? DEFAULT_SHIRT_TEMPLATE;
    const hasShirt = rows.some((r) => r.shirt);
    if (hasShirt) {
      const shirtProblems = validateShirtTemplate(shirtTemplate);
      if (shirtProblems.length) errors.push(`Đoạn ghép áo đang lỗi (sửa ở Cài đặt): ${shirtProblems.join(" ")}`);
    }
    const shirtWarning = hasShirt && lacksShirtSlot(template) ? NO_SHIRT_SLOT_WARNING : undefined;

    let sheetId: number | undefined;
    try {
      sheetId = (await sheets.getSpreadsheet(f.id)).tabs.find((t) => t.title === f.tab)?.sheetId;
      if (sheetId === undefined) errors.push(`Không còn trang tính "${f.tab}" trong file.`);
    } catch (e) {
      errors.push(describeGoogleError(e, clientEmail));
    }
    if (errors.length || !folder || sheetId === undefined) return editPage(errors);

    const plan = planRuns({ cfg, sheetId, folderId: folder.id, batchExtra: f.batchExtra, stamp: f.stamp, template, shirtTemplate, rows, edits: f.edits });
    if (plan.problems.length) return editPage(plan.problems);
    const currentDigest = digest(plan.runs, folder.id);

    const previewPage = (warning?: string) =>
      c.html(
        page(
          "Xem trước",
          <PreviewPage
            title={title}
            f={{ ...f, folder: folder.id, folderLinkInput: "" }}
            rows={rows}
            runs={plan.runs}
            folder={folder}
            digest={currentDigest}
            notes={
              <>
                <QuotaBox quota={quota} />
                {rejectedNote}
                {shirtWarning && <Alert kind="warn">{shirtWarning}</Alert>}
                {warning && <Alert kind="warn">{warning}</Alert>}
              </>
            }
          />,
        ),
        warning ? 409 : 200,
      );

    if (step === "preview") return previewPage();

    // step === "create": chỉ tạo khi đúng y như bản người dùng vừa xem.
    if (rejected.length > 0 || f.previewDigest !== currentDigest) {
      return previewPage("Dữ liệu trong sheet vừa thay đổi nên yêu cầu khác với bản bạn đã xem. Hãy xem lại rồi bấm Tạo lô.");
    }
    const batchId = insertBatch(db, { cfg, folderId: folder.id, batchExtra: f.batchExtra, runs: plan.runs });
    logger.info({ batchId, spreadsheetId: f.id, tab: f.tab, rows: plan.runs.map((r) => r.row) }, "Đã tạo lô");
    return c.redirect(`/batch/${batchId}?created=1`, 303);
  }
}

function EditForm(props: {
  title: Child;
  f: FormState;
  rows: ScannedRow[];
  quotaBox: Child;
  notes: Child;
  rootFolder?: DriveFolder;
  subfolders: DriveFolder[];
  hasThumb: (id?: string) => boolean;
  back: Child;
}) {
  const { f, rows, rootFolder, subfolders } = props;
  return (
    <>
      {props.title}
      <p class="muted">Bước 1/2 · Chỉnh yêu cầu. Phần sửa ở đây chỉ dùng cho lần gửi Muse, không ghi ngược vào Google Sheet.</p>
      {props.quotaBox}
      {props.notes}
      <form method="post" action="/batch/prepare">
        <CarryFields f={f} rows={rows} withEdits={false} />
        <div class="card">
          <label for="batchExtra">Yêu cầu thêm chung cho cả lô</label>
          <textarea id="batchExtra" name="batchExtra" rows={2} placeholder="Ví dụ: giữ nguyên hình in trên áo, nền phòng ngủ sáng">
            {f.batchExtra}
          </textarea>
        </div>
        <div class="card">
          <label for="folder">Thư mục Drive lưu video</label>
          {rootFolder ? (
            <select id="folder" name="folder">
              <option value={rootFolder.id} selected={f.folder === rootFolder.id}>
                📁 {rootFolder.name} (thư mục gốc)
              </option>
              {subfolders.map((s) => (
                <option value={s.id} selected={f.folder === s.id}>
                  📁 {rootFolder.name} / {s.name}
                </option>
              ))}
            </select>
          ) : (
            <div class="muted">
              Chưa đặt thư mục gốc nên chưa có danh sách để chọn. Đặt ở <a href="/settings">Cài đặt</a>, hoặc dán link thư mục bên dưới.
            </div>
          )}
          <label for="folderLink" class="sub">
            Hoặc dán link thư mục khác (nếu điền, tool dùng link này)
          </label>
          <input id="folderLink" name="folderLink" type="text" value={f.folderLinkInput} placeholder="https://drive.google.com/drive/folders/…" />
        </div>
        {rows.map((r) => {
          const e = f.edits.get(r.row);
          return (
            <div class="card row-card">
              <div class="row-head">
                {props.hasThumb(r.imageFileId) && <img class="thumb" src={`/thumb/${r.imageFileId}`} alt={`Ảnh dòng ${r.row}`} width="64" height="64" />}
                {props.hasThumb(r.shirtFileId) && (
                  <img class="thumb" src={`/thumb/${r.shirtFileId}`} alt={`Ảnh áo dòng ${r.row}`} width="64" height="64" />
                )}
                <div>
                  <strong>Dòng {r.row}</strong>
                  {r.label === "has_video" && <span class="badge b-has_video"> Ghi đè</span>}
                  {r.shirt && <span class="badge b-ready"> Ghép áo</span>}
                  <div class="muted small">{truncate(r.image, 80)}</div>
                  {r.shirt && <div class="muted small">Ảnh áo: {truncate(r.shirt, 80)}</div>}
                </div>
              </div>
              <label for={`prompt_${r.row}`}>Prompt</label>
              <textarea id={`prompt_${r.row}`} name={`prompt_${r.row}`} rows={5}>
                {e?.prompt ?? r.prompt}
              </textarea>
              {e && e.prompt.trim() !== r.prompt && <div class="muted small">Đã sửa so với prompt trong sheet.</div>}
              <label for={`extra_${r.row}`} class="sub">
                Yêu cầu thêm riêng dòng này
              </label>
              <textarea id={`extra_${r.row}`} name={`extra_${r.row}`} rows={2}>
                {e?.extra ?? ""}
              </textarea>
            </div>
          );
        })}
        <div class="row-between">
          {props.back}
          <button type="submit" name="step" value="preview">
            Xem trước yêu cầu gửi Muse →
          </button>
        </div>
      </form>
    </>
  );
}

function PreviewPage(props: {
  title: Child;
  f: FormState;
  rows: ScannedRow[];
  runs: PlannedRun[];
  folder: DriveFolder;
  digest: string;
  notes: Child;
}) {
  const { f, runs, folder } = props;
  return (
    <>
      {props.title}
      <p class="muted">Bước 2/2 · Xem trước nguyên văn yêu cầu sẽ gửi cho Muse.</p>
      {props.notes}
      <div class="card">
        {runs.length} dòng · Thư mục lưu video:{" "}
        <a href={folderLink(folder.id)} target="_blank" rel="noreferrer">
          📁 {folder.name} ↗
        </a>
      </div>
      {runs.map((r) => (
        <div class="card">
          <div class="row-between">
            <strong>
              Dòng {r.row}
              {r.overwrite && " · Ghi đè"}
            </strong>
            <span class="muted small">{r.fileName}</span>
          </div>
          <pre class="request">{r.requestText}</pre>
        </div>
      ))}
      <form method="post" action="/batch/prepare" class="row-between">
        <CarryFields f={f} rows={props.rows} withEdits={true} />
        <Hidden name="previewDigest" value={props.digest} />
        <button type="submit" name="step" value="edit" class="secondary">
          ← Quay lại chỉnh
        </button>
        <div>
          <div class="muted small">Tạo lô xong, bấm Bắt đầu chạy ở trang lô để bot gửi Muse.</div>
          <button type="submit" name="step" value="create">
            Tạo lô ({runs.length} dòng)
          </button>
        </div>
      </form>
    </>
  );
}
