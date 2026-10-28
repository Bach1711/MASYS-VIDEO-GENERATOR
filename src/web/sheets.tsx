import type { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import type { Child } from "hono/jsx";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import {
  fillMissingTitles,
  getSheetConfig,
  listSheetConfigs,
  saveSheetConfig,
  setSpreadsheetTitle,
  sheetName,
  validateSheetConfig,
  type SheetConfig,
} from "../db/sheetConfigs.js";
import { columnLetter, parseSpreadsheetId } from "../google/a1.js";
import { describeGoogleError, shareHint } from "../google/errors.js";
import { guessColumns, OPTIONAL_ROLE_LABELS, ROLE_LABELS, type ColumnRole } from "../google/mapping.js";
import type { SheetsClient } from "../google/sheets.js";
import { logger } from "../logger.js";
import { Layout } from "./layout.js";

const ROLES = Object.keys(ROLE_LABELS) as ColumnRole[];

function sheetUrl(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}`;
}

function Alert(props: { kind: "warn" | "ok"; children: Child }) {
  return (
    <div class={`card ${props.kind}`} role={props.kind === "warn" ? "alert" : "status"}>
      {props.children}
    </div>
  );
}

function ConnectForm(props: { link?: string }) {
  return (
    <form class="card" method="get" action="/sheets/connect">
      <label for="link">Link Google Sheet</label>
      <div class="row">
        <input id="link" name="link" type="text" required value={props.link ?? ""} placeholder="https://docs.google.com/spreadsheets/d/…" />
        <button type="submit">Đọc danh sách tab</button>
      </div>
    </form>
  );
}

export function registerSheetRoutes(app: Hono, ctx: { config: AppConfig; db: DB; sheets?: SheetsClient }) {
  const { config, db, sheets } = ctx;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (body: Child) => "<!doctype html>" + <Layout title="Kết nối sheet">{body}</Layout>;
  const noClient = (
    <Alert kind="warn">
      Chưa nạp được khoá service account nên chưa kết nối được Google Sheet. Xem hướng dẫn ở <a href="/">trang chủ</a>.
    </Alert>
  );

  app.get("/sheets", async (c) => {
    const saved = c.req.query("saved");
    if (sheets) await fillMissingTitles(db, async (id) => (await sheets.getSpreadsheet(id)).title);
    const configs = listSheetConfigs(db);
    return c.html(
      page(
        <>
          <h1>Kết nối sheet</h1>
          {!sheets && noClient}
          {saved && <Alert kind="ok">Đã lưu ánh xạ cột cho tab "{saved}".</Alert>}
          <ConnectForm />
          <h2>Ánh xạ đã lưu</h2>
          {configs.length === 0 ? (
            <p class="muted">Chưa có.</p>
          ) : (
            <div class="scroll"><table>
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Tab</th>
                  <th>Tiêu đề</th>
                  {ROLES.map((r) => (
                    <th>{ROLE_LABELS[r]}</th>
                  ))}
                  <th>{OPTIONAL_ROLE_LABELS.colShirt}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {configs.map((cfg) => (
                  <tr>
                    <td>
                      <a href={sheetUrl(cfg.spreadsheetId)} target="_blank" rel="noreferrer">
                        {sheetName(cfg)}
                      </a>
                    </td>
                    <td>{cfg.tab}</td>
                    <td>dòng {cfg.headerRow}</td>
                    {ROLES.map((r) => (
                      <td>{cfg[r]}</td>
                    ))}
                    <td>{cfg.colShirt || <span class="muted">—</span>}</td>
                    <td>
                      <a href={`/sheets/map?id=${encodeURIComponent(cfg.spreadsheetId)}&tab=${encodeURIComponent(cfg.tab)}`}>Sửa</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>,
      ),
    );
  });

  app.get("/sheets/connect", async (c) => {
    const link = c.req.query("link") ?? "";
    const id = parseSpreadsheetId(link);
    const header = (
      <>
        <h1>Kết nối sheet</h1>
        <ConnectForm link={link} />
      </>
    );
    if (!sheets) return c.html(page(<>{header}{noClient}</>));
    if (!id) return c.html(page(<>{header}<Alert kind="warn">Không nhận ra link Google Sheet.</Alert></>), 400);

    try {
      const info = await sheets.getSpreadsheet(id);
      const editable = await sheets.canEdit(id);
      // Giữ tên file trong danh sách đã lưu đúng với tên hiện tại (có thể vừa đổi tên).
      setSpreadsheetTitle(db, id, info.title);
      return c.html(
        page(
          <>
            {header}
            {!editable && <Alert kind="warn">{shareHint(clientEmail)}. Hiện service account chỉ có quyền xem nên không ghi được ô Trạng thái.</Alert>}
            <div class="card">
              <strong>{info.title}</strong>
              <div class="muted">Chọn tab để ánh xạ cột:</div>
              <ul>
                {info.tabs.map((t) => (
                  <li>
                    {editable ? (
                      <a href={`/sheets/map?id=${encodeURIComponent(id)}&tab=${encodeURIComponent(t.title)}`}>{t.title}</a>
                    ) : (
                      t.title
                    )}
                    {getSheetConfig(db, id, t.title) && <span class="muted"> · đã ánh xạ</span>}
                  </li>
                ))}
              </ul>
            </div>
          </>,
        ),
      );
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: id }, "Không đọc được sheet");
      return c.html(page(<>{header}<Alert kind="warn">{describeGoogleError(e, clientEmail)}</Alert></>), 502);
    }
  });

  app.get("/sheets/map", async (c) => {
    const id = c.req.query("id") ?? "";
    const tab = c.req.query("tab") ?? "";
    if (!sheets) return c.html(page(<><h1>Ánh xạ cột</h1>{noClient}</>));
    const saved = getSheetConfig(db, id, tab);
    const headerRow = Number(c.req.query("headerRow") ?? saved?.headerRow ?? 1);
    return c.html(page(await mappingForm({ id, tab, headerRow, saved })));
  });

  app.post("/sheets/map", async (c) => {
    const body = await c.req.parseBody();
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    const cfg: SheetConfig = {
      spreadsheetId: str("id"),
      tab: str("tab"),
      headerRow: Number(str("headerRow")),
      colImage: str("colImage"),
      colPrompt: str("colPrompt"),
      colVideo: str("colVideo"),
      colStatus: str("colStatus"),
      colShirt: str("colShirt") || null,
    };
    const problem = validateSheetConfig(cfg);
    if (problem) {
      return c.html(page(await mappingForm({ id: cfg.spreadsheetId, tab: cfg.tab, headerRow: cfg.headerRow, saved: cfg, error: problem })), 400);
    }
    try {
      cfg.spreadsheetTitle = (await sheets?.getSpreadsheet(cfg.spreadsheetId))?.title;
    } catch {
      // vẫn lưu được ánh xạ; tên file sẽ được điền ở lần mở danh sách sau
    }
    saveSheetConfig(db, cfg);
    logger.info({ spreadsheetId: cfg.spreadsheetId, tab: cfg.tab }, "Đã lưu ánh xạ cột");
    // Vào từ nút "+ Thêm sheet" trên Bảng: lưu xong quay về Bảng với trang tính vừa thêm.
    if (getCookie(c, "masys_back") === "bang") {
      deleteCookie(c, "masys_back", { path: "/" });
      return c.redirect(`/?id=${encodeURIComponent(cfg.spreadsheetId)}&tab=${encodeURIComponent(cfg.tab)}&ok=${encodeURIComponent(`Đã thêm trang tính "${cfg.tab}".`)}`, 303);
    }
    return c.redirect(`/sheets?saved=${encodeURIComponent(cfg.tab)}`, 303);
  });

  async function mappingForm(p: { id: string; tab: string; headerRow: number; saved?: SheetConfig; error?: string }) {
    const title = <h1>Ánh xạ cột · {p.tab}</h1>;
    if (!Number.isInteger(p.headerRow) || p.headerRow < 1) {
      return <>{title}<Alert kind="warn">Dòng tiêu đề phải là số nguyên ≥ 1.</Alert></>;
    }
    let headers: string[];
    try {
      headers = await sheets!.readRow(p.id, p.tab, p.headerRow);
    } catch (e) {
      logger.warn({ err: e, spreadsheetId: p.id }, "Không đọc được dòng tiêu đề");
      return <>{title}<Alert kind="warn">{describeGoogleError(e, clientEmail)}</Alert></>;
    }
    // Chỉ dùng bản đã lưu khi vẫn đọc cùng dòng tiêu đề; đổi dòng thì đoán lại.
    const guessed = guessColumns(headers);
    const initial = p.saved && p.saved.headerRow === p.headerRow ? p.saved : guessed;
    // Ánh xạ lưu từ trước khi có cột Ảnh áo (v4.4): gợi ý cột Ảnh áo theo tiêu đề, người dùng bấm Lưu mới áp dụng.
    const shirt = (p.saved?.headerRow === p.headerRow ? p.saved.colShirt : undefined) || guessed.colShirt;
    const columnCount = Math.max(headers.length, 4);
    const options = Array.from({ length: columnCount }, (_, i) => ({ col: columnLetter(i), label: headers[i] ?? "" }));

    return (
      <>
        {title}
        {p.error && <Alert kind="warn">{p.error}</Alert>}
        <form class="card" method="get" action="/sheets/map">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="tab" value={p.tab} />
          <label for="hr">Dòng tiêu đề</label>
          <div class="row">
            <input id="hr" name="headerRow" type="number" min="1" value={String(p.headerRow)} />
            <button type="submit">Đọc lại tiêu đề</button>
          </div>
          {headers.length === 0 && <div class="muted">Dòng {p.headerRow} đang trống.</div>}
        </form>
        <form class="card" method="post" action="/sheets/map">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="tab" value={p.tab} />
          <input type="hidden" name="headerRow" value={String(p.headerRow)} />
          {ROLES.map((role) => (
            <div class="field">
              <label for={role}>{ROLE_LABELS[role]}</label>
              <select id={role} name={role}>
                <option value="">— chọn cột —</option>
                {options.map((o) => (
                  <option value={o.col} selected={initial[role] === o.col}>
                    {o.col}
                    {o.label ? ` — ${o.label}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div class="field">
            <label for="colShirt">{OPTIONAL_ROLE_LABELS.colShirt} (tuỳ chọn)</label>
            <select id="colShirt" name="colShirt">
              <option value="" selected={!shirt}>
                — Không có —
              </option>
              {options.map((o) => (
                <option value={o.col} selected={shirt === o.col}>
                  {o.col}
                  {o.label ? ` — ${o.label}` : ""}
                </option>
              ))}
            </select>
            <div class="muted small">Có ảnh áo thì Muse ghép áo vào ảnh người mẫu trước rồi mới tạo video. Dòng để trống ô Ảnh áo vẫn chạy như thường.</div>
          </div>
          <button type="submit">Lưu ánh xạ</button>
        </form>
      </>
    );
  }
}
