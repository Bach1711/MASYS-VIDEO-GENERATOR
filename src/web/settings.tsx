import type { Hono } from "hono";
import type { Child } from "hono/jsx";
import { DEFAULT_TEMPLATE, PLACEHOLDERS, REQUIRED_PLACEHOLDERS, validateTemplate, type Placeholder } from "../batch/template.js";
import { DEFAULT_MUSE_URL } from "../bot/museSelectors.js";
import {
  getSettings,
  parseRunSettings,
  RECOMMENDED_DAILY_LIMIT,
  saveRunSettings,
  setDriveRootFolder,
  setRequestTemplate,
} from "../db/settings.js";
import { parseDriveLink, type DriveFolder } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import { logger } from "../logger.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";
import type { ScanDeps } from "./scan.js";

// Trang Cài đặt (F7): chạy lô, trang Muse, thư mục Drive gốc, mẫu yêu cầu gửi Muse.
// Đổi trong lúc lô đang chạy thì áp dụng từ dòng kế tiếp (hàng đợi đọc lại cài đặt mỗi lượt).
export function registerSettingsRoutes(app: Hono, deps: ScanDeps) {
  const { config, db, drive } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (body: Child) => "<!doctype html>" + <Layout title="Cài đặt">{body}</Layout>;

  async function render(
    opts: {
      notice?: Child;
      rootError?: string;
      templateErrors?: string[];
      templateDraft?: string;
      runErrors?: string[];
      runDraft?: Record<string, unknown>;
    } = {},
  ) {
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
        <RunSettingsCard s={opts.runDraft ?? { ...s }} errors={opts.runErrors} />
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
      </>,
    );
  }

  app.get("/settings", async (c) => {
    const saved = c.req.query("saved");
    const text: Record<string, string> = {
      root: "Đã lưu thư mục gốc.",
      reset: "Đã quay về mẫu gốc.",
      template: "Đã lưu mẫu.",
      run: "Đã lưu. Lô đang chạy (nếu có) dùng cài đặt mới từ dòng kế tiếp.",
    };
    const notice = saved && <Alert kind="ok">{text[saved] ?? "Đã lưu."}</Alert>;
    return c.html(await render({ notice }));
  });

  app.post("/settings/run", async (c) => {
    const body = await c.req.parseBody();
    const r = parseRunSettings(body);
    if (!r.ok) return c.html(await render({ runErrors: r.errors, runDraft: body }), 400);
    saveRunSettings(db, r.value);
    logger.info({ ...r.value }, "Đã lưu cài đặt chạy lô");
    return c.redirect("/settings?saved=run", 303);
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

function RunSettingsCard(props: { s: Record<string, unknown>; errors?: string[] }) {
  const v = (k: string) => (props.s[k] === null || props.s[k] === undefined ? "" : String(props.s[k]));
  const limit = Number(props.s.dailyVideoLimit);
  return (
    <section class="card">
      <h2>Chạy lô</h2>
      {props.errors && props.errors.length > 0 && (
        <Alert kind="warn">
          Chưa lưu vì:
          <ul>
            {props.errors.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {limit > RECOMMENDED_DAILY_LIMIT && (
        <Alert kind="warn">
          Giới hạn đang cao hơn mức khuyến nghị {RECOMMENDED_DAILY_LIMIT} video/ngày. Tạo nhiều video tự động mỗi ngày làm tăng rủi ro tài
          khoản Meta bị hạn chế (D13).
        </Alert>
      )}
      <form method="post" action="/settings/run">
        <div class="field">
          <label for="timeoutMinutes">Thời gian chờ mỗi dòng (phút)</label>
          <input id="timeoutMinutes" name="timeoutMinutes" type="number" min="1" max="120" required value={v("timeoutMinutes")} />
          <div class="muted small">Quá thời gian này mà ô Video chưa có link thì dòng chuyển "Cần xem", không gửi lại. Mặc định 20.</div>
        </div>
        <div class="field">
          <label>Nghỉ giữa hai dòng (giây)</label>
          <div class="row">
            <input name="pauseMinSec" type="number" min="0" max="600" required value={v("pauseMinSec")} aria-label="Nghỉ ít nhất (giây)" />
            <span class="muted">đến</span>
            <input name="pauseMaxSec" type="number" min="0" max="600" required value={v("pauseMaxSec")} aria-label="Nghỉ nhiều nhất (giây)" />
          </div>
          <div class="muted small">Tool nghỉ ngẫu nhiên trong khoảng này trước khi gửi dòng sau (D7). Mặc định 20 đến 60.</div>
        </div>
        <div class="field">
          <label for="dailyVideoLimit">Giới hạn video mỗi ngày</label>
          <input id="dailyVideoLimit" name="dailyVideoLimit" type="number" min="1" max="50" required value={v("dailyVideoLimit")} />
          <div class="muted small">Đủ số này thì lô tự tạm dừng đến hôm sau. Mặc định {RECOMMENDED_DAILY_LIMIT} (D13).</div>
        </div>
        <div class="field">
          <label for="museUrl">Địa chỉ trang Muse</label>
          <input id="museUrl" name="museUrl" type="url" placeholder={DEFAULT_MUSE_URL} value={v("museUrl")} />
          <div class="muted small">Để trống là dùng {DEFAULT_MUSE_URL}. Chỉ nhận địa chỉ thuộc muse.ai.</div>
        </div>
        <button type="submit">Lưu cài đặt chạy lô</button>
      </form>
      <h2 class="sub-h">Trình duyệt bot</h2>
      <p class="muted">Cửa sổ Chrome riêng của bot, nơi bạn tự đăng nhập Muse. Xem trạng thái và nhật ký bot ở trang <a href="/bot">Bot Muse</a>.</p>
      <form method="post" action="/bot/open">
        <button type="submit" class="secondary">Mở trình duyệt bot</button>
      </form>
    </section>
  );
}
