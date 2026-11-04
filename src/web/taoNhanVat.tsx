import fs from "node:fs";
import type { Context, Hono } from "hono";
import { addNhanVat, tenProblem } from "../anh/nhanVat.js";
import {
  addDraft,
  buildCore,
  buildFillPrompt,
  chooseDraftFile,
  chosenFile,
  CRITERIA,
  criteriaProblems,
  deleteDraft,
  draftBusy,
  draftFiles,
  draftRuns,
  GENDERS,
  getDraft,
  getDraftFile,
  insertNvBatch,
  isNvKind,
  listDrafts,
  markDraftSaved,
  MAX_AGE,
  MIN_AGE,
  NV_KIND_TEXT,
  parseFillAnswer,
  readCriteria,
  REGIONS,
  type Criteria,
  type NvDraft,
  type NvDraftFile,
  type NvKind,
} from "../anh/taoNhanVat.js";
import { BangFiles, typeOf } from "../bang/files.js";
import { FINAL_RUN_STATES } from "../batch/create.js";
import type { AppConfig } from "../config.js";
import { activeBatch } from "../db/history.js";
import type { DB } from "../db/index.js";
import { getImageQuota } from "../db/quota.js";
import { getSettings, setLastNhanVat } from "../db/settings.js";
import { logger } from "../logger.js";
import type { BatchRunner } from "../queue/runner.js";
import { APP_NAME } from "../version.js";
import { RUN_BADGE, RUN_STATE_TEXT } from "./batchRun.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";

// Tạo nhân vật ngay trong app (CON-81, spec 17.14, D35): điền 12 tiêu chí (hoặc nhờ AI khác điền) → ảnh master →
// ảnh turnaround + ảnh face → Lưu vào thư viện Nhân vật.

export interface TaoNhanVatDeps {
  config: AppConfig;
  db: DB;
  runner?: BatchRunner;
}

const BASE = "/nhan-vat/tao";
const draftUrl = (id: number, o: { ok?: string; loi?: string } = {}) => {
  const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return `${BASE}/${id}${q ? `?${q}` : ""}`;
};
const fileUrl = (name: string) => `${BASE}/anh/${encodeURIComponent(name)}`;
const FINAL = new Set<string>(FINAL_RUN_STATES);
const EMPTY = Object.fromEntries(CRITERIA.map((c) => [c.key, ""])) as Criteria;

const ascii = (s: string) => s.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function CriteriaForm(props: { ten: string; values: Criteria; blocked: string }) {
  const v = props.values;
  return (
    <form method="post" action={BASE} class="card" id="taoForm">
      <h2>Mô tả nhân vật</h2>
      <label for="ten">Tên nhân vật</label>
      <input id="ten" name="ten" type="text" maxlength={60} value={props.ten} placeholder="Ví dụ: Emma" required />
      <div class="muted small hint">Chỉ cần điền những ô bạn đã có ý tưởng. Các ô còn lại có thể nhờ AI điền ở mục bên dưới.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px 16px;margin-top:12px">
        {CRITERIA.map((c) => (
          <div>
            <label for={`c-${c.key}`}>
              {c.label}
              {c.key === "phuKien" && <span class="muted small"> (không bắt buộc)</span>}
            </label>
            {c.key === "khuVuc" || c.key === "gioiTinh" ? (
              <select id={`c-${c.key}`} name={c.key} data-tieu-chi="1">
                <option value="">Chọn</option>
                {(c.key === "khuVuc" ? REGIONS : GENDERS).map((o) => (
                  <option value={o} selected={v[c.key] === o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : c.key === "tuoi" ? (
              <input id={`c-${c.key}`} name={c.key} data-tieu-chi="1" type="number" min={MIN_AGE} max={MAX_AGE} value={v.tuoi} placeholder={c.example} />
            ) : (
              <input id={`c-${c.key}`} name={c.key} data-tieu-chi="1" type="text" maxlength={200} value={v[c.key]} placeholder={c.example} />
            )}
          </div>
        ))}
      </div>

      <h2 style="margin-top:20px">Nhờ AI điền các ô còn trống</h2>
      <p class="muted small">
        Bấm nút để sao chép prompt, dán sang ChatGPT, Claude hoặc Gemini. Sau đó dán câu trả lời của AI vào ô bên dưới. App chỉ điền vào ô còn trống, ô bạn đã
        điền được giữ nguyên.
      </p>
      <button type="button" id="aiCopy" class="secondary">
        📋 Sao chép prompt nhờ AI điền
      </button>
      <span id="aiMsg" class="small muted" style="margin-left:8px"></span>
      <textarea id="aiPrompt" rows={8} readonly hidden aria-label="Prompt nhờ AI điền" style="margin-top:8px"></textarea>
      <label for="aiAnswer" style="margin-top:10px">
        Câu trả lời của AI
      </label>
      <textarea id="aiAnswer" rows={6} placeholder="Dán 12 dòng AI trả lời vào đây"></textarea>
      <div class="row" style="margin-top:8px">
        <button type="button" id="aiFill" class="secondary">
          Điền vào các ô
        </button>
      </div>

      <h2 style="margin-top:20px">Mô tả sẽ gửi Muse</h2>
      <p id="corePreview" class="muted">Điền đủ tiêu chí để xem mô tả.</p>
      <div class="row-between">
        <span class="small muted">{props.blocked || "Bot gửi prompt cho Muse, không kèm ảnh. Mỗi lần tạo tính 1 lượt ảnh."}</span>
        <button type="submit" disabled={!!props.blocked}>
          ▶ Tạo ảnh master
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: ascii(FORM_JS) }} />
    </form>
  );
}

function KindCard(props: { draft: NvDraft; kind: NvKind; files: NvDraftFile[]; run?: { batchId: number; state: string; error: string | null; museChatUrl: string | null }; canRun: boolean; hint?: string }) {
  const { draft, kind, run } = props;
  const list = props.files.filter((f) => f.kind === kind);
  const main = chosenFile(props.files, kind);
  const running = !!run && !FINAL.has(run.state);
  return (
    <div class="card" id={`kind-${kind}`}>
      <div class="row-between">
        <h2 style="margin:0">{NV_KIND_TEXT[kind]}</h2>
        {run && <span class={`badge ${RUN_BADGE[run.state] ?? ""}`}>{RUN_STATE_TEXT[run.state] ?? run.state}</span>}
      </div>
      {run?.error && <Alert kind="warn">{run.error}</Alert>}
      {props.hint && <p class="muted small">{props.hint}</p>}
      {list.length > 0 && (
        <div class="row" style="margin-top:10px;align-items:flex-start">
          {list.map((f) => (
            <figure style="margin:0;text-align:center">
              <a href={fileUrl(f.file)} target="_blank" rel="noreferrer" title="Bấm để xem ảnh lớn">
                <img
                  src={fileUrl(f.file)}
                  alt={NV_KIND_TEXT[kind]}
                  loading="lazy"
                  style={`width:${kind === "turnaround" ? 427 : 180}px;height:240px;object-fit:contain;border-radius:6px;background:var(--border);${f.id === main?.id ? "outline:3px solid var(--accent, #2563eb)" : ""}`}
                />
              </a>
              <figcaption class="small">
                {f.id === main?.id ? (
                  <strong>★ Đang chọn</strong>
                ) : (
                  <form method="post" action={`${BASE}/${draft.id}/chon/${f.id}`}>
                    <button type="submit" class="secondary small">
                      ★ Chọn ảnh này
                    </button>
                  </form>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div class="row" style="margin-top:10px;align-items:center">
        {!draft.nhanVatId && (
          <form method="post" action={`${BASE}/${draft.id}/chay`}>
            <input type="hidden" name="kind" value={kind} />
            <button type="submit" class={list.length ? "secondary" : ""} disabled={!props.canRun || running}>
              {list.length ? "↻ Tạo lại ảnh này" : `▶ Tạo ${NV_KIND_TEXT[kind].toLowerCase()}`}
            </button>
          </form>
        )}
        {run && (
          <a class="small" href={`/batch/${run.batchId}`}>
            Xem lô #{run.batchId}
          </a>
        )}
        {run?.museChatUrl && (
          <a class="small" href={run.museChatUrl} target="_blank" rel="noreferrer">
            Mở trong Muse ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function registerTaoNhanVatRoutes(app: Hono, deps: TaoNhanVatDeps) {
  const { db, config } = deps;
  const files = new BangFiles(config.dataDir);
  const page = (title: string, body: unknown) => <Layout title={`${title} · ${APP_NAME}`}>{body as never}</Layout>;
  const sameSite = (c: Context) => {
    const site = c.req.header("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  };
  const fromPage = (c: Context) => c.req.header("x-masys") === "1";
  const blockedText = () => {
    const active = activeBatch(db);
    if (active) return `Lô #${active.id} chưa xong. Đợi xong (hoặc Tiếp tục / Huỷ lô đang tạm dừng) rồi tạo tiếp.`;
    if (!deps.runner) return "Bot chưa sẵn sàng.";
    if (getImageQuota(db).remaining < 1) return "Hôm nay đã đủ giới hạn ảnh (đổi ở Cài đặt).";
    return "";
  };

  const formPage = (c: Context, o: { ten?: string; values?: Criteria; err?: string } = {}, status: 200 | 400 = 200) =>
    c.html(
      page(
        "Tạo nhân vật",
        <>
          <div class="bang-head">
            <h1 style="margin:0">Tạo nhân vật</h1>
            <a class="button secondary" href="/nhan-vat">
              ← Nhân vật
            </a>
          </div>
          <p class="muted">
            Điền mô tả, bot nhờ Muse tạo <strong>ảnh master</strong>. Bạn chọn ảnh ưng ý, bot tạo tiếp <strong>ảnh turnaround</strong> và{" "}
            <strong>ảnh face</strong>, rồi bạn bấm <strong>Lưu</strong> để thêm vào thư viện Nhân vật. Phong cách luôn là ảnh chân thực (photorealistic).
          </p>
          {(o.err ?? c.req.query("loi")) && <Alert kind="warn">{o.err ?? c.req.query("loi")}</Alert>}
          {c.req.query("ok") && <Alert kind="ok">{c.req.query("ok")}</Alert>}
          <CriteriaForm ten={o.ten ?? ""} values={o.values ?? EMPTY} blocked={blockedText()} />
          {listDrafts(db).length > 0 && (
            <div class="card">
              <h2>Bản nháp</h2>
              <ul>
                {listDrafts(db).map((d) => (
                  <li>
                    <a href={`${BASE}/${d.id}`}>{d.ten}</a> <span class="muted small">{d.nhanVatId ? "· đã lưu" : "· chưa lưu"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>,
      ),
      status,
    );
  app.get(BASE, (c) => formPage(c));

  // Ảnh bản nháp: chỉ file "nt…" trong tep\anh-tao.
  app.get(`${BASE}/anh/:name`, (c) => {
    const p = files.nvTaoPath(c.req.param("name"));
    if (!p) return c.text("Không có ảnh", 404);
    return c.body(fs.readFileSync(p), 200, { "Content-Type": typeOf(p), "Cache-Control": "private, max-age=31536000, immutable" });
  });

  const jsonBody = async (c: Context): Promise<Record<string, unknown> | null> => {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  /** Mô tả xem trước và prompt nhờ AI điền, theo các ô đang có trên trang. */
  app.post(`${BASE}/xem-truoc`, async (c) => {
    if (!fromPage(c)) return c.json({ ok: false }, 403);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false }, 400);
    const values = readCriteria(body);
    const problems = criteriaProblems(values);
    return c.json({ ok: true, core: problems.length ? "" : buildCore(values), problems, fillPrompt: buildFillPrompt(values) });
  });

  app.post(`${BASE}/doc-tra-loi`, async (c) => {
    if (!fromPage(c)) return c.json({ ok: false }, 403);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false }, 400);
    return c.json({ ok: true, fields: parseFillAnswer(String(body.answer ?? "")) });
  });

  app.post(BASE, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const body = await c.req.parseBody();
    const ten = String(body.ten ?? "");
    const values = readCriteria(body);
    const problem = tenProblem(ten) ?? criteriaProblems(values).join(" ");
    if (problem) return formPage(c, { ten, values, err: problem }, 400);
    const blocked = blockedText();
    if (blocked) return formPage(c, { ten, values, err: blocked }, 400);
    const id = addDraft(db, ten, values);
    const started = deps.runner!.start(insertNvBatch(db, getDraft(db, id)!, ["master"], null));
    logger.info({ draftId: id }, "Đã bắt đầu tạo nhân vật");
    return c.redirect(draftUrl(id, started.ok ? {} : { loi: started.message }), 303);
  });

  app.get(`${BASE}/:id`, (c) => {
    const draft = getDraft(db, Number(c.req.param("id")));
    if (!draft) return c.notFound();
    const list = draftFiles(db, draft.id);
    const runs = draftRuns(db, draft.id);
    const busy = draftBusy(db, draft.id);
    const live = busy && activeBatch(db)?.status === "running";
    const blocked = busy ? "" : blockedText();
    const canRun = !busy && !blocked;
    const master = chosenFile(list, "master");
    const turnaround = chosenFile(list, "turnaround");
    const face = chosenFile(list, "face");
    const ready = !!master && !!turnaround && !!face && !busy;
    const msg = c.req.query("loi");
    return c.html(
      page(
        `Tạo nhân vật ${draft.ten}`,
        <>
          {live && <meta http-equiv="refresh" content="5" />}
          <div class="bang-head">
            <h1 style="margin:0">Tạo nhân vật · {draft.ten}</h1>
            <a class="button secondary" href={BASE}>
              ← Tạo nhân vật
            </a>
          </div>
          {c.req.query("ok") && <Alert kind="ok">{c.req.query("ok")}</Alert>}
          {msg && <Alert kind="warn">{msg}</Alert>}
          {blocked && <Alert kind="warn">{blocked}</Alert>}
          {draft.nhanVatId && (
            <Alert kind="ok">
              Đã lưu vào <a href="/nhan-vat">thư viện Nhân vật</a>. Nhân vật dùng được trên Bảng ảnh.
            </Alert>
          )}
          <div class="card">
            <strong>Mô tả nhân vật</strong>
            <p class="small" style="margin-bottom:0">
              {draft.core}
            </p>
            {live && <div class="muted small">Trang tự cập nhật 5 giây một lần.</div>}
          </div>
          <KindCard draft={draft} kind="master" files={list} run={runs.master} canRun={canRun} hint="Chọn ảnh ưng ý nhất. Ảnh turnaround và ảnh face đều tạo từ ảnh đang chọn." />
          {master && (
            <>
              {!draft.nhanVatId && !turnaround && !face && (
                <form method="post" action={`${BASE}/${draft.id}/chay`} class="card row-between">
                  <span>Dùng ảnh master đang chọn để tạo cả hai ảnh còn lại. Tốn 2 lượt ảnh.</span>
                  <input type="hidden" name="kind" value="ca-hai" />
                  <button type="submit" disabled={!canRun}>
                    ▶ Tạo turnaround và face
                  </button>
                </form>
              )}
              <KindCard draft={draft} kind="turnaround" files={list} run={runs.turnaround} canRun={canRun} hint="Nếu đổi ảnh master, hãy tạo lại ảnh này." />
              <KindCard draft={draft} kind="face" files={list} run={runs.face} canRun={canRun} hint="Nếu đổi ảnh master, hãy tạo lại ảnh này." />
            </>
          )}
          <div class="card actionbar">
            <form method="post" action={`${BASE}/${draft.id}/xoa`} onsubmit={`return confirm(${JSON.stringify(`Xoá bản nháp ${draft.ten} và ảnh của bản nháp? Nhân vật đã lưu không bị ảnh hưởng.`)})`}>
              <button type="submit" class="danger" disabled={busy}>
                Xoá bản nháp
              </button>
            </form>
            {!draft.nhanVatId && (
              <form method="post" action={`${BASE}/${draft.id}/luu`}>
                <button type="submit" disabled={!ready}>
                  💾 Lưu nhân vật
                </button>
              </form>
            )}
          </div>
        </>,
      ),
    );
  });

  const draftOf = (c: Context) => getDraft(db, Number(c.req.param("id")));

  app.post(`${BASE}/:id/chay`, async (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const draft = draftOf(c);
    if (!draft) return c.notFound();
    const back = (loi: string) => c.redirect(draftUrl(draft.id, { loi }), 303);
    if (draft.nhanVatId) return back("Nhân vật này đã lưu.");
    if (draftBusy(db, draft.id)) return back("Bản nháp này đang tạo ảnh.");
    const blocked = blockedText();
    if (blocked) return back(blocked);
    const k = String((await c.req.parseBody()).kind ?? "");
    const kinds: NvKind[] = k === "ca-hai" ? ["turnaround", "face"] : isNvKind(k) ? [k] : [];
    if (!kinds.length) return back("Yêu cầu không hợp lệ.");
    if (kinds.length > getImageQuota(db).remaining) return back(`Hôm nay chỉ còn ${getImageQuota(db).remaining} lượt ảnh.`);
    const master = chosenFile(draftFiles(db, draft.id), "master")?.file ?? null;
    if (k !== "master" && !master) return back("Tạo ảnh master trước.");
    if (k !== "master" && !files.nvTaoPath(master)) return back("Không còn file ảnh master trên máy. Tạo lại ảnh master.");
    const started = deps.runner!.start(insertNvBatch(db, draft, kinds, master));
    return c.redirect(draftUrl(draft.id, started.ok ? {} : { loi: started.message }), 303);
  });

  app.post(`${BASE}/:id/chon/:file`, (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const draft = draftOf(c);
    if (!draft) return c.notFound();
    const f = getDraftFile(db, Number(c.req.param("file")));
    if (f?.draftId === draft.id && !draftBusy(db, draft.id) && !draft.nhanVatId) chooseDraftFile(db, f.id);
    return c.redirect(draftUrl(draft.id), 303);
  });

  /** Chép 3 ảnh đang chọn sang thư viện Nhân vật; bản nháp giữ nguyên đến khi người dùng xoá (D26). */
  app.post(`${BASE}/:id/luu`, (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const draft = draftOf(c);
    if (!draft) return c.notFound();
    if (draft.nhanVatId) return c.redirect(draftUrl(draft.id), 303);
    if (draftBusy(db, draft.id)) return c.redirect(draftUrl(draft.id, { loi: "Bản nháp này đang tạo ảnh." }), 303);
    const list = draftFiles(db, draft.id);
    const read = (kind: NvKind) => {
      const p = files.nvTaoPath(chosenFile(list, kind)?.file);
      return p ? new Uint8Array(fs.readFileSync(p)) : null;
    };
    const [master, turnaround, face] = [read("master"), read("turnaround"), read("face")];
    if (!master || !turnaround || !face) return c.redirect(draftUrl(draft.id, { loi: "Cần đủ ảnh master, turnaround và face." }), 303);
    const id = addNhanVat(db, draft.ten, (nvId) => ({
      file: files.saveNhanVat(nvId, turnaround),
      bytes: turnaround.length,
      faceFile: files.saveNhanVat(nvId, face),
      faceBytes: face.length,
      masterFile: files.saveNhanVat(nvId, master),
      masterBytes: master.length,
    }));
    markDraftSaved(db, draft.id, id);
    if (!getSettings(db).lastNhanVatId) setLastNhanVat(db, id);
    logger.info({ draftId: draft.id, nhanVatId: id }, "Đã lưu nhân vật từ bản nháp");
    return c.redirect(`/nhan-vat?${new URLSearchParams({ ok: `Đã lưu nhân vật ${draft.ten}.` }).toString()}`, 303);
  });

  app.post(`${BASE}/:id/xoa`, (c) => {
    if (!sameSite(c)) return c.text("Yêu cầu không hợp lệ", 403);
    const draft = draftOf(c);
    if (!draft) return c.notFound();
    if (draftBusy(db, draft.id)) return c.redirect(draftUrl(draft.id, { loi: "Bản nháp này đang tạo ảnh, chưa xoá được." }), 303);
    deleteDraft(db, draft.id).forEach((f) => files.removeAny(f));
    return c.redirect(`${BASE}?${new URLSearchParams({ ok: `Đã xoá bản nháp ${draft.ten}.` }).toString()}`, 303);
  });
}

const FORM_JS = `
(function () {
  var form = document.getElementById("taoForm");
  var msg = document.getElementById("aiMsg");
  var boxes = Array.prototype.slice.call(form.querySelectorAll("[data-tieu-chi]"));
  function postJson(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Masys": "1" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function values() {
    var out = {};
    boxes.forEach(function (b) { out[b.name] = b.value; });
    return out;
  }
  function preview() {
    return postJson("/nhan-vat/tao/xem-truoc", values()).then(function (r) {
      var p = document.getElementById("corePreview");
      p.textContent = r.core || ("Còn thiếu: " + r.problems.join(" "));
      return r;
    });
  }
  var timer;
  boxes.forEach(function (b) {
    b.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(preview, 300); });
  });
  document.getElementById("aiCopy").addEventListener("click", function () {
    preview().then(function (r) {
      var area = document.getElementById("aiPrompt");
      area.value = r.fillPrompt;
      area.hidden = false;
      navigator.clipboard.writeText(r.fillPrompt).then(function () {
        msg.textContent = "Đã sao chép. Dán sang AI rồi mang câu trả lời về đây.";
      }, function () {
        area.select();
        msg.textContent = "Chưa sao chép được tự động: bấm Ctrl+C để sao chép đoạn bên dưới.";
      });
    });
  });
  document.getElementById("aiFill").addEventListener("click", function () {
    postJson("/nhan-vat/tao/doc-tra-loi", { answer: document.getElementById("aiAnswer").value }).then(function (r) {
      var n = 0;
      boxes.forEach(function (b) {
        var v = r.fields[b.name];
        if (v && !b.value) { b.value = v; n++; }
      });
      msg.textContent = n ? ("Đã điền " + n + " ô.") : "Không có ô nào được điền thêm.";
      preview();
    });
  });
  preview();
})();
`;
