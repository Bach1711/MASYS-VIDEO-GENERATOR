import type { Hono } from "hono";
import { BANG_DEFAULTS, BANG_PLACEHOLDERS, validateBangTemplate } from "../bang/request.js";
import type { Child } from "hono/jsx";
import {
  DEFAULT_SHIRT_TEMPLATE,
  DEFAULT_TEMPLATE,
  lacksShirtSlot,
  NO_SHIRT_SLOT_WARNING,
  PLACEHOLDERS,
  REQUIRED_PLACEHOLDERS,
  SHIRT_PLACEHOLDERS,
  validateShirtTemplate,
  validateTemplate,
  type Placeholder,
} from "../batch/template.js";
import { DEFAULT_MUSE_URL } from "../bot/museSelectors.js";
import {
  getSettings,
  parseRunSettings,
  DEFAULT_DAILY_LIMIT,
  DEFAULT_PARALLEL_VIDEOS,
  MAX_DAILY_LIMIT,
  MAX_PARALLEL_VIDEOS,
  RECOMMENDED_DAILY_LIMIT,
  saveRunSettings,
  setDriveRootFolder,
  setBangTemplate,
  setRequestTemplate,
  setShirtTemplate,
  type BangTemplateKind,
} from "../db/settings.js";
import { parseDriveLink, type DriveFolder } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import { logger } from "../logger.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";
import type { ScanDeps } from "./scan.js";
import type { Updater } from "../update/updater.js";
import { VersionCard } from "./update.js";

// Trang Cài đặt (F7): chạy lô, trang Muse, thư mục Drive gốc, mẫu yêu cầu gửi Muse.
// Đổi trong lúc lô đang chạy thì áp dụng từ dòng kế tiếp (hàng đợi đọc lại cài đặt mỗi lượt).
export function registerSettingsRoutes(app: Hono, deps: ScanDeps & { updater?: Updater }) {
  const { config, db, drive } = deps;
  const clientEmail = config.serviceAccount.ok ? config.serviceAccount.clientEmail : "";
  const page = (body: Child) => "<!doctype html>" + <Layout title="Cài đặt">{body}</Layout>;

  async function render(
    opts: {
      notice?: Child;
      rootError?: string;
      templateErrors?: string[];
      templateDraft?: string;
      shirtErrors?: string[];
      shirtDraft?: string;
      runErrors?: string[];
      runDraft?: Record<string, unknown>;
      bang?: { kind: BangTemplateKind; errors: string[]; draft: string };
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
    const shirtTemplate = opts.shirtDraft ?? s.shirtTemplate ?? DEFAULT_SHIRT_TEMPLATE;
    return page(
      <>
        <h1>Cài đặt</h1>
        {opts.notice}
        <RunSettingsCard s={opts.runDraft ?? { ...s }} errors={opts.runErrors} />
        <VersionCard updater={deps.updater} />
        <section class="card">
          <h2>Khoá Google</h2>
          <p>
            Khoá service account:{" "}
            {config.serviceAccount.ok ? <code>{config.serviceAccount.clientEmail}</code> : <span class="warn-text">chưa có</span>}{" "}
            <span class="muted">
              ({config.keySource === "env" ? "từ biến môi trường, chạy qua op run" : config.keySource === "file" ? "đã lưu trong máy, mã hoá theo tài khoản Windows" : "chưa cài"})
            </span>
          </p>
          <a class="button secondary" href="/setup">
            Đổi file khoá
          </a>
        </section>
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
          {lacksShirtSlot(s.requestTemplate ?? DEFAULT_TEMPLATE) && <Alert kind="warn">{NO_SHIRT_SLOT_WARNING}</Alert>}
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

        <section class="card" id="ghep-ao">
          <h2>Đoạn ghép áo</h2>
          <p class="muted">
            {s.shirtTemplate ? "Đang dùng đoạn đã sửa." : "Đang dùng đoạn gốc (spec §8.2)."} Chỉ dòng có ảnh áo mới có đoạn này: tool đặt nó vào chỗ{" "}
            <code>{"{doan_ghep_ao}"}</code> của mẫu trên. Dòng không có ảnh áo thì bỏ trống.
          </p>
          <ul class="placeholders">
            {(Object.keys(SHIRT_PLACEHOLDERS) as (keyof typeof SHIRT_PLACEHOLDERS)[]).map((p) => (
              <li>
                <code>{`{${p}}`}</code> — {SHIRT_PLACEHOLDERS[p]} <strong>(bắt buộc)</strong>
              </li>
            ))}
          </ul>
          {opts.shirtErrors && opts.shirtErrors.length > 0 && (
            <Alert kind="warn">
              Chưa lưu vì đoạn có lỗi:
              <ul>
                {opts.shirtErrors.map((e) => (
                  <li>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          <form method="post" action="/settings/shirt">
            <textarea name="template" rows={5} class="mono">
              {shirtTemplate}
            </textarea>
            <div class="row-between">
              <button
                type="submit"
                name="action"
                value="reset"
                class="secondary"
                onclick="return confirm('Bỏ đoạn đã sửa và quay về đoạn gốc?')"
              >
                Khôi phục đoạn gốc
              </button>
              <button type="submit" name="action" value="save">
                Lưu đoạn ghép áo
              </button>
            </div>
          </form>
        </section>

        <h2 id="bang-moi">Mẫu yêu cầu cho Bảng mới</h2>
        <p class="muted">
          Bảng mới gửi ảnh thẳng vào cuộc trò chuyện Muse theo thứ tự cố định: ảnh 1 người mẫu mặt trước, ảnh 2 áo mặt trước, ảnh 3 người mẫu mặt
          sau, ảnh 4 áo mặt sau. Dòng đủ 4 ảnh dùng <em>mẫu hai mặt</em>; dòng khác dùng <em>mẫu thường</em> (có ảnh áo trước thì thêm đoạn ghép áo).
        </p>
        {BANG_SECTIONS.map((sec) => (
          <BangTemplateCard
            {...sec}
            saved={s[sec.kind]}
            draft={opts.bang?.kind === sec.kind ? opts.bang.draft : undefined}
            errors={opts.bang?.kind === sec.kind ? opts.bang.errors : undefined}
          />
        ))}
      </>,
    );
  }

  app.get("/settings", async (c) => {
    const saved = c.req.query("saved");
    const text: Record<string, string> = {
      root: "Đã lưu thư mục gốc.",
      reset: "Đã quay về mẫu gốc.",
      template: "Đã lưu mẫu.",
      shirt: "Đã lưu đoạn ghép áo.",
      shirtReset: "Đã quay về đoạn ghép áo gốc.",
      bang: "Đã lưu mẫu của Bảng mới.",
      bangReset: "Đã quay về mẫu gốc của Bảng mới.",
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

  app.post("/settings/shirt", async (c) => {
    const body = await c.req.parseBody();
    if (body.action === "reset") {
      setShirtTemplate(db, null);
      return c.redirect("/settings?saved=shirtReset#ghep-ao", 303);
    }
    const draft = String(body.template ?? "").replace(/\r\n/g, "\n");
    const errors = validateShirtTemplate(draft);
    if (errors.length) return c.html(await render({ shirtErrors: errors, shirtDraft: draft }), 400);
    setShirtTemplate(db, draft.trim() === DEFAULT_SHIRT_TEMPLATE.trim() ? null : draft);
    return c.redirect("/settings?saved=shirt#ghep-ao", 303);
  });

  app.post("/settings/bang-moi", async (c) => {
    const body = await c.req.parseBody();
    const kind = BANG_SECTIONS.find((x) => x.kind === body.kind)?.kind;
    if (!kind) return c.text("Yêu cầu không hợp lệ", 400);
    if (body.action === "reset") {
      setBangTemplate(db, kind, null);
      return c.redirect(`/settings?saved=bangReset#${kind}`, 303);
    }
    const draft = String(body.template ?? "").replace(/\r\n/g, "\n");
    const errors = validateBangTemplate(kind, draft);
    if (errors.length) return c.html(await render({ bang: { kind, errors, draft } }), 400);
    setBangTemplate(db, kind, draft.trim() === BANG_DEFAULTS[kind].trim() ? null : draft);
    return c.redirect(`/settings?saved=bang#${kind}`, 303);
  });
}

const BANG_SECTIONS: { kind: BangTemplateKind; title: string; note: string; rows: number }[] = [
  { kind: "bangTemplate", title: "Mẫu thường", note: "Dòng một ảnh người mẫu, hoặc người mẫu + áo mặt trước.", rows: 11 },
  {
    kind: "bangShirtTemplate",
    title: "Đoạn ghép áo",
    note: "Chỉ dòng có ảnh áo mặt trước mới có đoạn này: tool đặt nó vào chỗ {doan_ghep_ao} của mẫu thường.",
    rows: 4,
  },
  {
    kind: "twoSidedTemplate",
    title: "Mẫu hai mặt",
    note: "Dòng đủ 4 ảnh: ghép trước với trước, sau với sau thành ảnh A, B; video cắt cảnh từ mặt trước sang quay lưng (quay lưng vẫn cử động nhẹ), không xoay người liền mạch.",
    rows: 20,
  },
];

function BangTemplateCard(props: (typeof BANG_SECTIONS)[number] & { saved: string | null; draft?: string; errors?: string[] }) {
  const ph = BANG_PLACEHOLDERS[props.kind];
  return (
    <section class="card" id={props.kind}>
      <h2>{props.title}</h2>
      <p class="muted">
        {props.saved ? "Đang dùng bản đã sửa." : "Đang dùng bản gốc (spec 17.4)."} {props.note}
      </p>
      {Object.keys(ph.known).length > 0 && (
        <ul class="placeholders">
          {Object.entries(ph.known).map(([k, text]) => (
            <li>
              <code>{`{${k}}`}</code> — {text}
              {ph.required.includes(k) && <strong> (bắt buộc)</strong>}
            </li>
          ))}
        </ul>
      )}
      {props.errors && props.errors.length > 0 && (
        <Alert kind="warn">
          Chưa lưu vì mẫu có lỗi:
          <ul>
            {props.errors.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      <form method="post" action="/settings/bang-moi">
        <input type="hidden" name="kind" value={props.kind} />
        <textarea name="template" rows={props.rows} class="mono">
          {props.draft ?? props.saved ?? BANG_DEFAULTS[props.kind]}
        </textarea>
        <div class="row-between">
          <button type="submit" name="action" value="reset" class="secondary" onclick="return confirm('Bỏ bản đã sửa và quay về bản gốc?')">
            Khôi phục bản gốc
          </button>
          <button type="submit" name="action" value="save">
            Lưu
          </button>
        </div>
      </form>
    </section>
  );
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
          Giới hạn đang cao hơn {RECOMMENDED_DAILY_LIMIT} video/ngày. Hãy chắc hạn mức Muse của bạn đủ cho số video này; tạo rất nhiều
          video tự động mỗi ngày cũng làm tăng rủi ro tài khoản Meta bị hạn chế.
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
          <input id="dailyVideoLimit" name="dailyVideoLimit" type="number" min="1" max={String(MAX_DAILY_LIMIT)} required value={v("dailyVideoLimit")} />
          <div class="muted small">Đủ số này thì lô tự tạm dừng đến hôm sau. Mặc định {DEFAULT_DAILY_LIMIT}, cao nhất {MAX_DAILY_LIMIT}.</div>
        </div>
        <div class="field">
          <label for="parallelVideos">Số video chạy cùng lúc</label>
          <input id="parallelVideos" name="parallelVideos" type="number" min="1" max={String(MAX_PARALLEL_VIDEOS)} required value={v("parallelVideos")} />
          <div class="muted small">
            Bot gửi lần lượt từng dòng, mỗi dòng một cuộc trò chuyện Muse trong một tab riêng, và chờ tối đa chừng này video cùng lúc
            (D28). 1 là làm xong dòng này mới gửi dòng sau. Mặc định {DEFAULT_PARALLEL_VIDEOS}, cao nhất {MAX_PARALLEL_VIDEOS}.
          </div>
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
