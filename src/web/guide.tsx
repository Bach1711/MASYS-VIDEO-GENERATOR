import type { Hono } from "hono";
import { Layout } from "./layout.js";

// Hướng dẫn gọn trong tool (spec v5.0 mục 16.5, CON-51). Bản chi tiết cho người phụ trách nằm ở HUONG-DAN-CHI-TIET.md trên GitHub.

export const DETAIL_GUIDE_URL = "https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/blob/main/HUONG-DAN-CHI-TIET.md";

const PAUSES: [string, string][] = [
  ["Cần đăng nhập lại Muse", "Bấm Mở cửa sổ Muse, tự đăng nhập (hoặc làm bước kiểm tra bảo mật), rồi bấm Tiếp tục."],
  ["Giao diện Muse thay đổi", "Cửa sổ bot bị tắt thì mở lại rồi Tiếp tục. Vẫn lỗi thì báo người phụ trách (ảnh chụp ở Nhật ký)."],
  ["Muse hết lượt", "Chờ Muse có lượt lại rồi bấm Tiếp tục. Dòng đang gửi dở chuyển Lỗi, không gửi lại."],
  ["Đã đủ video trong ngày", "Hôm sau bấm Tiếp tục."],
  ["Muse sửa nhầm ô", "Mở sheet, xem ô ghi trong lý do (ví dụ E9), sửa lại cho đúng rồi Tiếp tục."],
  ["Lệch dòng trong sheet", "Có người chèn / xoá dòng hoặc đổi ảnh / prompt trên sheet sau khi bấm Tạo video. Nên Huỷ rồi tạo lại."],
  ["Lỗi Google Sheet", "Kiểm tra mạng và quyền chia sẻ sheet cho tool, rồi Tiếp tục."],
];

export function registerGuideRoutes(app: Hono) {
  app.get("/gioi-thieu", (c) => c.redirect("/huong-dan", 301));
  app.get("/huong-dan", (c) =>
    c.html(
      "<!doctype html>" +
        (
          <Layout title="Hướng dẫn">
            <h1>Hướng dẫn</h1>
            <div class="card guide">
              <h2>Lần đầu</h2>
              <p>
                Làm theo <a href="/bat-dau">4 bước bắt đầu</a>: chọn file khoá Google, dán link sheet, đăng nhập Muse, dán link thư mục Drive. Mỗi bước có
                dấu ✅ khi xong.
              </p>
              <h2>Hằng ngày, trên Bảng</h2>
              <ol>
                <li>Mỗi dòng của Bảng là một dòng của Google Sheet: ảnh người mẫu, ảnh áo, prompt, video, trạng thái.</li>
                <li>
                  Sửa ô: bấm <strong>✎</strong> (ô trống thì <strong>+</strong>). Thêm dòng: <strong>+ Thêm dòng</strong>. Chép một prompt cho nhiều dòng:{" "}
                  <strong>Dải prompt ▾</strong>. Tool ghi thẳng lên sheet.
                </li>
                <li>
                  Tích các dòng cần làm (hoặc <strong>☑ Chọn mọi dòng chưa có video</strong>) rồi bấm <strong>▶ Tạo video</strong>.
                </li>
                <li>Bot gửi lần lượt từng dòng cho Muse, mỗi dòng khoảng 3–5 phút. Video xong hiện ngay trên Bảng (bấm ▶ Xem).</li>
              </ol>
              <p class="muted small">
                Ảnh trong sheet là link Drive của file ảnh, đặt chế độ "Bất kỳ ai có đường liên kết". Mỗi ngày tool chỉ tạo tối đa số video đặt trong Cài
                đặt (mặc định 5) để giữ tài khoản Muse an toàn.
              </p>
            </div>
            <div class="card">
              <h2>Khi tool tạm dừng</h2>
              <p class="muted small">Bảng cho biết lý do. Làm theo cột bên phải rồi bấm Tiếp tục: tool không bao giờ gửi lại dòng đã gửi Muse.</p>
              <div class="scroll">
                <table>
                  <tbody>
                    {PAUSES.map(([what, todo]) => (
                      <tr>
                        <td>
                          <strong>{what}</strong>
                        </td>
                        <td>{todo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="card">
              <h2>Gặp lỗi khác</h2>
              <p>
                Chụp màn hình trang tool và cửa sổ đen, gửi người phụ trách. Người phụ trách xem{" "}
                <a href={DETAIL_GUIDE_URL} target="_blank" rel="noreferrer">
                  hướng dẫn chi tiết ↗
                </a>{" "}
                (cài máy mới, khoá Google, cài đặt, sửa khi Muse đổi giao diện, phát hành bản mới).
              </p>
            </div>
          </Layout>
        ),
    ),
  );
}
