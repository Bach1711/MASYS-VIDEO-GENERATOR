import type { ServiceAccountStatus } from "../config.js";
import { Layout } from "./layout.js";

export function HomePage(props: { serviceAccount: ServiceAccountStatus; dailyVideoLimit: number }) {
  const sa = props.serviceAccount;
  return (
    <Layout title="MASYS Video">
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
      <div class="card muted">Giới hạn mỗi ngày: {props.dailyVideoLimit} video. Các chức năng sẽ có ở các bước tiếp theo.</div>
    </Layout>
  );
}
