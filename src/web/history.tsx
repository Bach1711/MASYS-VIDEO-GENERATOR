import path from "node:path";
import type { Hono } from "hono";
import type { DB } from "../db/index.js";
import { activeBatch, listBatches, listLogs, PROBLEM_STATES } from "../db/history.js";
import { listSheetConfigs, sheetName } from "../db/sheetConfigs.js";
import { PAUSE_SHORT, type BatchRunner, type PauseReason } from "../queue/runner.js";
import { BATCH_STATUS_TEXT, RUN_BADGE, RUN_STATE_TEXT } from "./batchRun.js";
import { truncate } from "./components.js";
import { Layout } from "./layout.js";

/** Link xem ảnh chụp màn hình lỗi (phục vụ ở /bot/screenshot, chỉ tên file trong thư mục ảnh chụp). */
export const screenshotHref = (p: string) => `/bot/screenshot/${encodeURIComponent(path.basename(p))}`;

/** Dải báo trên đầu mọi trang khi có lô đang chạy hoặc tạm dừng. */
export function StatusBanner(props: { db: DB; runner?: BatchRunner }) {
  const b = activeBatch(props.db);
  if (!b) return null;
  const live = props.runner?.runningBatchId === b.id;
  const notice = props.runner?.notices.get(b.id);
  const text =
    b.status === "running"
      ? `Lô #${b.id} đang chạy`
      : `Lô #${b.id} đang tạm dừng: ${PAUSE_SHORT[b.pauseReason as PauseReason] ?? "chờ bấm Tiếp tục"}${live ? " (đang theo dõi nốt dòng dở)" : ""}`;
  return (
    <div class={`card banner ${b.status === "running" && !notice ? "running" : "warn"}`} role="status">
      <span>
        <strong>{text}</strong>
        {notice && <> · {notice}</>}
      </span>
      <a href={`/batch/${b.id}`}>Xem lô →</a>
    </div>
  );
}

export function registerHistoryRoutes(app: Hono, deps: { db: DB }) {
  const { db } = deps;

  app.get("/batches", (c) => {
    const batches = listBatches(db);
    const names = new Map(listSheetConfigs(db).map((cfg) => [cfg.spreadsheetId, sheetName(cfg)]));
    return c.html(
      "<!doctype html>" +
        (
          <Layout title="Lịch sử lô">
            <h1>Lịch sử lô</h1>
            {batches.length === 0 ? (
              <p class="muted">
                Chưa có lô nào. Tạo lô ở <a href="/scan">Quét và chọn dòng</a>.
              </p>
            ) : (
              <div class="scroll">
                <table class="scan">
                  <thead>
                    <tr>
                      <th>Lô</th>
                      <th>Tạo lúc</th>
                      <th>Sheet → trang tính</th>
                      <th>Số dòng</th>
                      <th>Kết quả</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr>
                        <td>
                          <a href={`/batch/${b.id}`}>#{b.id}</a>
                        </td>
                        <td class="small">
                          {new Date(b.createdAt).toLocaleString("vi-VN")}
                          {b.lastSentAt && <div class="muted">gửi Muse lần cuối {new Date(b.lastSentAt).toLocaleString("vi-VN")}</div>}
                        </td>
                        <td>
                          {names.get(b.spreadsheetId) ?? b.spreadsheetId} → {b.tab}
                          {b.extraRequest && <div class="muted small">Yêu cầu thêm: {truncate(b.extraRequest, 60)}</div>}
                        </td>
                        <td>{b.total}</td>
                        <td class="small tally">
                          {b.done > 0 && <span>✅ {b.done} xong</span>}
                          {b.failed > 0 && <span>❌ {b.failed} lỗi</span>}
                          {b.needsReview > 0 && <span>⚠️ {b.needsReview} cần xem</span>}
                          {b.skipped > 0 && <span>⏭ {b.skipped} bỏ qua</span>}
                          {b.canceled > 0 && <span>✖ {b.canceled} đã huỷ</span>}
                        </td>
                        <td>
                          {BATCH_STATUS_TEXT[b.status] ?? b.status}
                          {b.status === "paused" && b.pauseReason && (
                            <div class="muted small">{PAUSE_SHORT[b.pauseReason as PauseReason] ?? b.pauseReason}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p class="muted small">Bấm số lô để xem từng dòng và nguyên văn yêu cầu đã gửi Muse.</p>
          </Layout>
        ),
    );
  });

  app.get("/logs", (c) => {
    const all = c.req.query("all") === "1";
    const batchParam = Number(c.req.query("batch"));
    const batchId = Number.isInteger(batchParam) && batchParam > 0 ? batchParam : undefined;
    const logs = listLogs(db, { all, batchId });
    const href = (o: { all: boolean }) => {
      const q = new URLSearchParams();
      if (o.all) q.set("all", "1");
      if (batchId) q.set("batch", String(batchId));
      const s = q.toString();
      return s ? `/logs?${s}` : "/logs";
    };
    return c.html(
      "<!doctype html>" +
        (
          <Layout title="Nhật ký">
            <h1>Nhật ký{batchId && <> · lô #{batchId}</>}</h1>
            <div class="row-between">
              <span class="muted">
                {all ? "Đang xem tất cả các bước." : "Đang xem lỗi, các dòng cần xem và các lần bot chụp màn hình."} Mới nhất ở trên.
              </span>
              <span class="row">
                <a class="button secondary" href={href({ all: !all })}>
                  {all ? "Chỉ xem lỗi" : "Xem tất cả"}
                </a>
                {batchId && (
                  <a class="button secondary" href={all ? "/logs?all=1" : "/logs"}>
                    Mọi lô
                  </a>
                )}
              </span>
            </div>
            {logs.length === 0 ? (
              <p class="muted">{all ? "Chưa có gì trong nhật ký." : "Không có lỗi nào. 🎉"}</p>
            ) : (
              <div class="scroll">
                <table class="scan">
                  <thead>
                    <tr>
                      <th>Lúc</th>
                      <th>Lô · dòng</th>
                      <th>Trạng thái</th>
                      <th>Nội dung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((e) => (
                      <tr>
                        <td class="small">{new Date(e.at).toLocaleString("vi-VN")}</td>
                        <td>
                          <a href={`/batch/${e.batchId}`}>#{e.batchId}</a> · dòng {e.rowNumber}
                        </td>
                        <td>
                          <span class={`badge ${PROBLEM_STATES.includes(e.toState) ? "b-running" : RUN_BADGE[e.toState] ?? ""}`}>
                            {RUN_STATE_TEXT[e.toState] ?? e.toState}
                          </span>
                        </td>
                        <td>
                          {e.message}
                          {e.screenshotPath && (
                            <>
                              {" "}
                              <a href={screenshotHref(e.screenshotPath)} target="_blank" rel="noreferrer">
                                xem ảnh chụp
                              </a>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p class="muted small">
              Nhật ký chỉ ghi các bước của tool (không có khoá service account, mật khẩu hay cookie). Ảnh chụp màn hình nằm trên máy này, ngoài
              thư mục code.
            </p>
          </Layout>
        ),
    );
  });
}
