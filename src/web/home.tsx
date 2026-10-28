import type { ServiceAccountStatus } from "../config.js";
import { logoUrl } from "./logo.js";
import { Layout } from "./layout.js";

export function HomePage(props: { serviceAccount: ServiceAccountStatus; dailyVideoLimit: number }) {
  const sa = props.serviceAccount;
  return (
    <Layout title="MASYS Video">
      <div class="hero">
        <img src={logoUrl("masys.png")} alt="MASYS Video Generator" />
      </div>
      <h1>MASYS Video Generator</h1>
      {sa.ok ? (
        <div class="card">
          Service account: <code>{sa.clientEmail}</code>
          <div class="muted">Chia sẻ sheet (quyền sửa) và thư mục Drive (quyền xem) cho email này.</div>
        </div>
      ) : (
        <div class="card warn" role="alert">
          <strong>Chưa nạp được khoá service account.</strong>
          <div>{sa.problem}</div>
        </div>
      )}
      <div class="card">
        <ol>
          <li>
            <a href="/sheets">Kết nối sheet và ánh xạ cột</a> (làm một lần cho mỗi sheet/tab).
          </li>
          <li>
            <a href="/bot">Mở trình duyệt bot</a> và tự đăng nhập Muse (làm một lần, bot nhớ đăng nhập).
          </li>
          <li>
            <a href="/scan">Quét và chọn dòng</a> cần tạo video, rồi bấm <strong>Tạo lô</strong>.
          </li>
          <li>
            Ở trang lô, bấm <strong>Bắt đầu chạy</strong>. Bot gửi lần lượt từng dòng cho Muse; theo dõi ở trang lô, xem lại ở{" "}
            <a href="/batches">Lịch sử lô</a> và <a href="/logs">Nhật ký</a>.
          </li>
        </ol>
        <div class="muted">
          Giới hạn mỗi ngày: {props.dailyVideoLimit} video (đổi ở <a href="/settings">Cài đặt</a>).
        </div>
      </div>
    </Layout>
  );
}
