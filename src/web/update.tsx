import type { Hono } from "hono";
import type { Child } from "hono/jsx";
import type { Updater, UpdateJob } from "../update/updater.js";
import { Alert } from "./components.js";
import { Layout } from "./layout.js";

// Kiểm tra / cập nhật / quay về phiên bản (D16). Khung "Phiên bản" nằm trong trang Cài đặt.

const STEP_TEXT: Record<UpdateJob["step"], string> = {
  downloading: "Đang tải bản mới",
  verifying: "Đang kiểm tra file tải về (SHA-256)",
  extracting: "Đang giải nén",
  placing: "Đang chép bản mới vào chỗ",
  backing_up: "Đang sao lưu dữ liệu",
  switching: "Đang khởi động lại bằng bản mới",
  failed: "Cập nhật không thành công",
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const rate = (bps: number) => (bps >= 1024 * 1024 ? `${(bps / 1024 / 1024).toFixed(1)} MB/giây` : `${Math.round(bps / 1024)} KB/giây`);
const dateVi =(iso?: string) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "");

/** Script chờ tool mới lên đúng phiên bản rồi chuyển trang (tiến trình cũ tắt trước, nên đợi vài giây). */
function waitForVersion(version: string, then: string) {
  const js =
    `var t0=Date.now();setTimeout(function p(){fetch('/health').then(function(r){return r.json()}).then(function(h){` +
    `if(h.version===${JSON.stringify(version)})location.href=${JSON.stringify(then)};` +
    `else if(Date.now()-t0>120000)location.href='/settings#phien-ban';else setTimeout(p,1500)` +
    `},function(){setTimeout(p,1500)})},3000)`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

/** Ghi chú phát hành (Markdown đơn giản của GitHub) hiện dạng chữ thường, giữ xuống dòng. */
function Notes(props: { text: string }) {
  return props.text.trim() ? <pre class="request notes">{props.text.trim()}</pre> : <p class="muted">Không có ghi chú thay đổi.</p>;
}

export function VersionCard(props: { updater?: Updater }) {
  const u = props.updater;
  if (!u) return null;
  const latest = u.latest;
  const blocker = u.installBlocker();
  const prev = u.previousVersion();
  return (
    <section class="card" id="phien-ban">
      <h2>Phiên bản</h2>
      <p>
        Đang dùng: <strong>v{u.currentVersion}</strong>
        {u.checkedAt && !u.checkError && !u.hasUpdate() && latest && <span class="muted"> (mới nhất)</span>}
      </p>
      {u.checkError && <Alert kind="warn">Không kiểm tra được: {u.checkError} Tool vẫn dùng bình thường.</Alert>}
      {u.job?.step === "failed" && <Alert kind="warn">Cập nhật lên v{u.job.target} không thành công: {u.job.error}</Alert>}
      {u.hasUpdate() && latest && (
        <div class="update-box">
          <p>
            Có bản mới: <strong>v{latest.version}</strong>
            {latest.publishedAt && <span class="muted"> · phát hành {dateVi(latest.publishedAt)}</span>}
          </p>
          <Notes text={latest.notes} />
          <form method="post" action="/update/install" class="row-head">
            <button type="submit" disabled={!!blocker}>
              Cập nhật lên v{latest.version}
            </button>
            {blocker && <span class="warn-text small">{blocker}</span>}
          </form>
          <p class="muted small">
            Tool tải bản mới, kiểm tra, sao lưu dữ liệu rồi tự khởi động lại (vài phút, tuỳ mạng; mạng đứt giữa chừng thì tool tự tải tiếp). Lịch sử lô, cài đặt, đăng nhập Muse và khoá
            Google giữ nguyên.
          </p>
        </div>
      )}
      <form method="post" action="/update/check" class="row-head">
        <button type="submit" class="secondary">
          Kiểm tra phiên bản
        </button>
        {u.checkedAt && <span class="muted small">Lần kiểm tra cuối: {u.checkedAt.toLocaleTimeString("vi-VN")}</span>}
      </form>
      {prev && (
        <form method="post" action="/update/rollback" class="row-head">
          <button type="submit" class="secondary" disabled={!!blocker}>
            Quay về v{prev}
          </button>
          <span class="muted small">Dùng khi bản mới chạy có vấn đề. Dữ liệu giữ nguyên.</span>
        </form>
      )}
      {!u.canInstall && <p class="muted small">Máy này chạy từ mã nguồn (máy phát triển): chỉ kiểm tra được, cập nhật bằng git.</p>}
    </section>
  );
}

/** Dải báo trên đầu mọi trang: vừa cập nhật / quay về / bản mới lỗi, hoặc có bản mới. */
export function UpdateBanner(props: { updater?: Updater }) {
  const u = props.updater;
  if (!u) return null;
  if (u.notice) {
    return (
      <form method="post" action="/update/dismiss" class={`card banner ${u.notice.kind === "ok" ? "ok" : "warn"}`}>
        <span>{u.notice.text}</span>
        <button type="submit" class="secondary">
          Đã hiểu
        </button>
      </form>
    );
  }
  if (u.hasUpdate() && !u.busy) {
    return (
      <div class="card banner running">
        <span>Có bản mới v{u.latest!.version}.</span>
        <a href="/settings#phien-ban">Xem và cập nhật →</a>
      </div>
    );
  }
  return null;
}

export function registerUpdateRoutes(app: Hono, deps: { updater?: Updater }) {
  const { updater } = deps;
  const page = (title: string, body: Child) => "<!doctype html>" + <Layout title={title}>{body}</Layout>;

  app.post("/update/check", async (c) => {
    if (updater) await updater.check();
    return c.redirect("/settings#phien-ban", 303);
  });

  app.post("/update/install", (c) => {
    if (!updater) return c.redirect("/settings", 303);
    const blocked = updater.installBlocker();
    if (blocked || !updater.hasUpdate()) return c.redirect("/settings#phien-ban", 303);
    void updater.install();
    return c.redirect("/update", 303);
  });

  app.get("/update", (c) => {
    const job = updater?.job;
    if (!job) return c.redirect("/settings#phien-ban", 303);
    if (job.step === "failed") {
      return c.html(
        page(
          "Cập nhật",
          <>
            <h1>Cập nhật lên v{job.target}</h1>
            <Alert kind="warn">
              {job.error} <a href="/settings#phien-ban">Về Cài đặt</a>
            </Alert>
          </>,
        ),
      );
    }
    const progress =
      job.step === "downloading"
        ? ` ${mb(job.bytes)}${job.total ? ` / ${mb(job.total)}` : ""}${job.speed !== undefined && !job.retry ? ` · ${rate(job.speed)}` : ""}`
        : "";
    return c.html(
      page(
        "Đang cập nhật",
        <>
          {job.step !== "switching" && <meta http-equiv="refresh" content="1" />}
          <h1>Cập nhật lên v{job.target}</h1>
          <div class="card">
            <p>
              <strong>{STEP_TEXT[job.step]}</strong>
              {progress}…
            </p>
            {job.step === "placing" && job.slow && (
              <p class="muted">Phần mềm diệt virus đang quét file mới nên phải chờ một chút (tối đa khoảng 1 phút).</p>
            )}
            {job.retry && (
              <p class="warn-text">
                Mạng chập chờn, đang thử lại (lần {job.retry.attempt}/{job.retry.max})… Phần đã tải được giữ lại, không tải lại từ đầu.
              </p>
            )}
            <p class="muted">Đừng đóng cửa sổ đen. Trang tự chuyển khi xong.</p>
          </div>
          {job.step === "switching" && waitForVersion(job.target, "/settings#phien-ban")}
        </>,
      ),
    );
  });

  app.post("/update/rollback", (c) => {
    if (!updater) return c.redirect("/settings", 303);
    const r = updater.rollback();
    if (!r.ok) {
      return c.html(page("Quay về", <Alert kind="warn">{r.message} <a href="/settings#phien-ban">Về Cài đặt</a></Alert>), 409);
    }
    return c.html(
      page(
        "Đang quay về",
        <>
          <h1>Quay về v{r.version}</h1>
          <div class="card">
            <p>
              <strong>Đang khởi động lại bằng v{r.version}…</strong>
            </p>
            <p class="muted">Đừng đóng cửa sổ đen. Trang tự chuyển khi xong.</p>
          </div>
          {waitForVersion(r.version, "/settings#phien-ban")}
        </>,
      ),
    );
  });

  app.post("/update/dismiss", (c) => {
    if (updater) updater.notice = undefined;
    // Chỉ quay lại đúng đường dẫn trong tool, không theo địa chỉ ngoài.
    let back = "/";
    try {
      back = new URL(c.req.header("referer") ?? "/", "http://localhost").pathname;
    } catch {}
    return c.redirect(back, 303);
  });
}
