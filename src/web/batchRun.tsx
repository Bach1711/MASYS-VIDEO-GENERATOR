import type { Hono } from "hono";
import { getBatch } from "../batch/create.js";
import { folderLink } from "../batch/template.js";
import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { getSheetConfig, sheetName } from "../db/sheetConfigs.js";
import { PAUSE_TEXT, type BatchRunner, type PauseReason } from "../queue/runner.js";
import { Alert, QuotaBox, scanUrl, truncate } from "./components.js";
import { Layout } from "./layout.js";

export const RUN_STATE_TEXT: Record<string, string> = {
  queued: "Chờ chạy",
  checking_row: "Đang kiểm tra dòng",
  sending: "Đang gửi Muse",
  waiting: "Chờ Muse làm video",
  verifying: "Đang kiểm tra video",
  done: "Xong",
  failed: "Lỗi",
  needs_review: "Cần xem",
  skipped_has_video: "Bỏ qua (đã có video)",
  paused_login: "Tạm dừng: cần đăng nhập Muse",
  paused_ui: "Tạm dừng: không thấy ô chat Muse",
  paused_quota: "Tạm dừng: Muse hết lượt",
  paused_limit: "Tạm dừng: đủ giới hạn ngày",
  canceled: "Đã huỷ",
};

export const BATCH_STATUS_TEXT: Record<string, string> = {
  queued: "Chưa chạy",
  running: "Đang chạy",
  paused: "Tạm dừng",
  done: "Đã chạy xong",
  canceled: "Đã huỷ",
};

export const RUN_BADGE: Record<string, string> = {
  done: "b-ready",
  failed: "b-missing_data",
  needs_review: "b-running",
  skipped_has_video: "b-has_video",
};

// Trang tiến độ một lô (F6): bắt đầu / tạm dừng / tiếp tục / huỷ và trạng thái từng dòng.
export function registerBatchRunRoutes(app: Hono, deps: { db: DB; runner?: BatchRunner }) {
  const { db, runner } = deps;

  app.get("/batch/:id", (c) => {
    const id = Number(c.req.param("id"));
    const b = Number.isInteger(id) ? getBatch(db, id) : undefined;
    if (!b) return c.notFound();
    const bang = b.source === "bang";
    const cfg = bang ? undefined : getSheetConfig(db, b.spreadsheetId, b.tab);
    const name = bang ? "Bảng mới" : cfg ? sheetName(cfg) : b.spreadsheetId;
    const live = runner?.runningBatchId === b.id;
    const notice = runner?.notices.get(b.id);
    const msg = c.req.query("msg");
    const count = (states: string[]) => b.runs.filter((r) => states.includes(r.state)).length;
    const finished = count(["done", "failed", "needs_review", "skipped_has_video", "canceled"]);
    const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("vi-VN") : "");

    return c.html(
      "<!doctype html>" +
        (
          <Layout title={`Lô #${b.id}`}>
            {live && <meta http-equiv="refresh" content="5" />}
            <h1>
              Lô #{b.id} · {name}
              {!bang && <> → {b.tab}</>}
            </h1>
            {c.req.query("created") && (
              <Alert kind="ok">
                Đã tạo lô {b.runs.length} dòng. Bấm <strong>Bắt đầu chạy</strong> để bot gửi lần lượt từng dòng cho Muse.
              </Alert>
            )}
            {msg && <Alert kind="warn">{msg}</Alert>}
            {notice && <Alert kind="warn">{notice}</Alert>}
            {b.status === "paused" && b.pauseReason && (
              <Alert kind="warn">
                <strong>Lô đang tạm dừng.</strong> {PAUSE_TEXT[b.pauseReason as PauseReason] ?? b.pauseReason}
                {(b.pauseReason === "login" || b.pauseReason === "ui") && (
                  <>
                    {" "}
                    Mở <a href="/bot">Bot Muse</a> để xem cửa sổ bot.
                  </>
                )}
              </Alert>
            )}
            <div class="card row-between">
              <div>
                <div>
                  Trạng thái lô: <strong>{live && b.status === "paused" ? "Đang theo dõi nốt dòng dở" : BATCH_STATUS_TEXT[b.status] ?? b.status}</strong>{" "}
                  · {finished}/{b.runs.length} dòng đã xong
                  {live && <span class="muted small"> · trang tự cập nhật 5 giây một lần</span>}
                </div>
                <div class="muted small">
                  Tạo lúc {new Date(b.createdAt).toLocaleString("vi-VN")}
                  {b.driveFolderId && (
                    <>
                      {" · "}
                      <a href={folderLink(b.driveFolderId)} target="_blank" rel="noreferrer">
                        thư mục lưu video ↗
                      </a>
                    </>
                  )}
                  {b.extraRequest && <> · Yêu cầu thêm chung: {b.extraRequest}</>}
                </div>
              </div>
              <div class="row">
                {(b.status === "queued" || b.status === "paused") && !live && (
                  <form method="post" action={`/batch/${b.id}/start`}>
                    <button type="submit">{b.status === "queued" ? "Bắt đầu chạy" : "Tiếp tục"}</button>
                  </form>
                )}
                {b.status === "running" && live && (
                  <form method="post" action={`/batch/${b.id}/pause`}>
                    <button type="submit" class="secondary">
                      Tạm dừng
                    </button>
                  </form>
                )}
                {(b.status === "queued" || b.status === "paused" || b.status === "running") && (
                  <form
                    method="post"
                    action={`/batch/${b.id}/cancel`}
                    onsubmit="return confirm('Huỷ lô này? Các dòng chưa gửi Muse sẽ không được gửi nữa.')"
                  >
                    <button type="submit" class="secondary">
                      Huỷ lô
                    </button>
                  </form>
                )}
              </div>
            </div>
            {b.status === "canceled" && <Alert kind="warn">Lô đã huỷ. Các dòng chưa gửi Muse không được gửi.</Alert>}
            {(b.status === "queued" || b.status === "paused") && <QuotaBox quota={getDailyQuota(db)} />}
            <div class="scroll">
              <table class="scan">
                <thead>
                  <tr>
                    <th>{bang ? "Dòng (Bảng mới)" : "Dòng"}</th>
                    <th>Trạng thái</th>
                    <th>Kết quả</th>
                    <th>Yêu cầu gửi Muse</th>
                  </tr>
                </thead>
                <tbody>
                  {b.runs.map((r) => (
                    <tr>
                      <td>
                        {r.rowNumber}
                        {r.overwrite ? <div class="muted small">ghi đè</div> : ""}
                      </td>
                      <td>
                        <span class={`badge ${RUN_BADGE[r.state] ?? ""}`}>{RUN_STATE_TEXT[r.state] ?? r.state}</span>
                        <div class="muted small">
                          {r.sentAt && <>gửi {time(r.sentAt)}</>}
                          {r.doneAt && <> · xong {time(r.doneAt)}</>}
                        </div>
                      </td>
                      <td class="small">
                        {r.error && <div>{r.error}</div>}
                        {r.videoLink && (
                          <div>
                            <a href={r.videoLink} target="_blank" rel="noreferrer">
                              video ↗
                            </a>
                          </div>
                        )}
                        {r.museChatUrl && (
                          <div>
                            <a href={r.museChatUrl} target="_blank" rel="noreferrer">
                              cuộc trò chuyện Muse ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td>
                        <details>
                          <summary>{truncate(r.promptSent, 70)}</summary>
                          <pre class="request">{r.requestText}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="row">
              {bang && <a href="/bang-moi">← Quay lại Bảng mới</a>}
              {cfg && <a href={scanUrl(cfg.spreadsheetId, cfg.tab)}>← Quay lại bảng quét</a>}
              <a href={`/logs?all=1&batch=${b.id}`}>Nhật ký của lô này</a>
              <a href="/batches">Lịch sử lô</a>
            </p>
          </Layout>
        ),
    );
  });

  app.post("/batch/:id/start", (c) => {
    const id = Number(c.req.param("id"));
    if (!runner) return c.redirect(`/batch/${id}?msg=${encodeURIComponent("Chưa nạp được khoá service account nên chưa chạy được.")}`, 303);
    const r = runner.start(id);
    return c.redirect(r.ok ? `/batch/${id}` : `/batch/${id}?msg=${encodeURIComponent(r.message)}`, 303);
  });

  app.post("/batch/:id/pause", (c) => {
    const id = Number(c.req.param("id"));
    const ok = runner?.pause(id);
    const msg = ok
      ? "Đã nhận Tạm dừng: dòng đang chờ Muse vẫn được theo dõi cho xong, lô dừng trước dòng tiếp theo."
      : "Lô này không đang chạy.";
    return c.redirect(`/batch/${id}?msg=${encodeURIComponent(msg)}`, 303);
  });

  app.post("/batch/:id/cancel", (c) => {
    const id = Number(c.req.param("id"));
    if (!runner) return c.redirect(`/batch/${id}?msg=${encodeURIComponent("Chưa nạp được khoá service account.")}`, 303);
    const r = runner.cancel(id);
    const msg = !r.ok
      ? r.message
      : r.immediate
        ? "Đã huỷ lô."
        : "Đã nhận Huỷ lô: dòng đang chờ Muse vẫn được theo dõi cho xong, các dòng còn lại sẽ không gửi.";
    return c.redirect(`/batch/${id}?msg=${encodeURIComponent(msg)}`, 303);
  });
}
