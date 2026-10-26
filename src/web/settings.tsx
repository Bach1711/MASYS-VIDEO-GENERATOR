import type { Hono } from "hono";
import type { Child } from "hono/jsx";
import { DEFAULT_TEMPLATE, PLACEHOLDERS, REQUIRED_PLACEHOLDERS, validateTemplate, type Placeholder } from "../batch/template.js";
import { getSettings, setDriveRootFolder, setRequestTemplate } from "../db/settings.js";
import { parseDriveLink, type DriveFolder } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import { logger } from "../logger.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";
import type { ScanDeps } from "./scan.js";

// Trang Cài đặt rút gọn cho CON-38: thư mục Drive gốc và mẫu yêu cầu gửi Muse.
// Các cài đặt còn lại của F7 làm ở CON-41.
export function registerSettingsRoutes(app: Hono, deps: ScanDeps) {
  const { config, db, drive } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (body: Child) => "<!doctype html>" + <Layout title="Cài đặt">{body}</Layout>;

  async function render(opts: { notice?: Child; rootError?: string; templateErrors?: string[]; templateDraft?: string } = {}) {
    const s = getSettings(db);
    let root: DriveFolder | undefined;
    let rootProblem: string | undefined;
    if (s.driveRootFolderId && drive) {
      try {
        root = await drive.getFolder(s.driveRootFolderId);
      } catch (e) {
        rootProblem = describeGoogleError(e, clientEmail);
      }
    }
    const template = opts.templateDraft ?? s.requestTemplate ?? DEFAULT_TEMPLATE;
    return page(
      <>
        <h1>Cài đặt</h1>
        {opts.notice}
        <section class="card">
          <h2>Thư mục Drive gốc</h2>
          <p class="muted">Khi chuẩn bị lô, tool liệt kê các thư mục con của thư mục này để chọn nơi Muse lưu video.</p>
          <p>
            Hiện tại:{" "}
            {root ? (
              <a href={`https://drive.google.com/drive/folders/${root.id}`} target="_blank" rel="noreferrer">
                📁 {root.name} ↗
              </a>
            ) : s.driveRootFolderId ? (
              <span class="warn-text">không mở được ({rootProblem ?? "chưa có service account"})</span>
            ) : (
              <span class="muted">chưa đặt</span>
            )}
          </p>
          {opts.rootError && <Alert kind="warn">{opts.rootError}</Alert>}
          <form method="post" action="/settings/root" class="row">
            <input name="link" type="text" placeholder="Dán link thư mục: https://drive.google.com/drive/folders/…" required />
            <button type="submit">Lưu thư mục gốc</button>
          </form>
        </section>

        <section class="card">
          <h2>Mẫu yêu cầu gửi Muse</h2>
          <p class="muted">
            {s.requestTemplate ? "Đang dùng mẫu đã sửa." : "Đang dùng mẫu gốc (spec §8.2)."} Các chỗ trong ngoặc nhọn được tool tự điền cho từng
            dòng:
          </p>
          <ul class="placeholders">
            {(Object.keys(PLACEHOLDERS) as Placeholder[]).map((p) => (
              <li>
                <code>{`{${p}}`}</code> — {PLACEHOLDERS[p]}
                {REQUIRED_PLACEHOLDERS.includes(p) && <strong> (bắt buộc)</strong>}
              </li>
            ))}
          </ul>
          {opts.templateErrors && opts.templateErrors.length > 0 && (
            <Alert kind="warn">
              Chưa lưu vì mẫu có lỗi:
              <ul>
                {opts.templateErrors.map((e) => (
                  <li>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          <form method="post" action="/settings/template">
            <textarea name="template" rows={16} class="mono">
              {template}
            </textarea>
            <div class="row-between">
              <button
                type="submit"
                name="action"
                value="reset"
                class="secondary"
                onclick="return confirm('Bỏ mẫu đã sửa và quay về mẫu gốc?')"
              >
                Khôi phục mẫu gốc
              </button>
              <button type="submit" name="action" value="save">
                Lưu mẫu
              </button>
            </div>
          </form>
        </section>
        <p class="muted">Các cài đặt khác (thời gian chờ, khoảng nghỉ, giới hạn video/ngày, trang Muse) sẽ có ở ticket CON-41.</p>
      </>,
    );
  }

  app.get("/settings", async (c) => {
    const saved = c.req.query("saved");
    const notice = saved && <Alert kind="ok">{saved === "root" ? "Đã lưu thư mục gốc." : saved === "reset" ? "Đã quay về mẫu gốc." : "Đã lưu mẫu."}</Alert>;
    return c.html(await render({ notice }));
  });

  app.post("/settings/root", async (c) => {
    const body = await c.req.parseBody();
    const link = parseDriveLink(String(body.link ?? ""));
    if (link?.kind !== "folder") return c.html(await render({ rootError: "Link không phải link thư mục Google Drive (…/drive/folders/…)." }), 400);
    if (!drive) return c.html(await render({ rootError: "Chưa nạp được khoá service account." }), 400);
    try {
      const folder = await drive.getFolder(link.id);
      setDriveRootFolder(db, folder.id);
      logger.info({ folderId: folder.id }, "Đã đặt thư mục Drive gốc");
      return c.redirect("/settings?saved=root", 303);
    } catch (e) {
      return c.html(await render({ rootError: describeGoogleError(e, clientEmail) }), 400);
    }
  });

  app.post("/settings/template", async (c) => {
    const body = await c.req.parseBody();
    if (body.action === "reset") {
      setRequestTemplate(db, null);
      return c.redirect("/settings?saved=reset", 303);
    }
    const draft = String(body.template ?? "").replace(/\r\n/g, "\n");
    const errors = validateTemplate(draft);
    if (errors.length) return c.html(await render({ templateErrors: errors, templateDraft: draft }), 400);
    // Lưu đúng mẫu gốc thì coi như dùng mẫu gốc (để sau này mẫu gốc đổi vẫn theo).
    setRequestTemplate(db, draft.trim() === DEFAULT_TEMPLATE.trim() ? null : draft);
    return c.redirect("/settings?saved=template", 303);
  });
}
