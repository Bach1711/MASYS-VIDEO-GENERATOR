import type { Hono } from "hono";
import { Layout } from "./layout.js";

// Hướng dẫn gọn trong tool (spec v5.0 mục 16.5, CON-51; v2.0.0 theo Bảng mới, spec v6.0 mục 17). Bản chi tiết cho người phụ trách nằm ở HUONG-DAN-CHI-TIET.md trên GitHub.

export const DETAIL_GUIDE_URL = "https://github.com/Bach1711/MASYS-VIDEO-GENERATOR/blob/main/HUONG-DAN-CHI-TIET.md";

const PAUSES: [string, string][] = [
  ["Cần đăng nhập lại Muse", "Bấm Mở cửa sổ Muse, tự đăng nhập (hoặc làm bước kiểm tra bảo mật), rồi bấm Tiếp tục."],
  ["Giao diện Muse thay đổi", "Cửa sổ bot bị tắt thì mở lại rồi Tiếp tục. Vẫn lỗi thì báo người phụ trách (ảnh chụp ở Nhật ký)."],
  ["Muse hết lượt", "Chờ Muse có lượt lại rồi bấm Tiếp tục. Dòng đang gửi dở chuyển Lỗi, không gửi lại."],
  ["Đã đủ video trong ngày", "Hôm sau bấm Tiếp tục."],
  ["Tool vừa mở lại", "Bấm Tiếp tục. Dòng đã gửi Muse được theo dõi và tải video tiếp, không gửi lại."],
  ["Muse sửa nhầm ô (Bảng theo sheet)", "Mở sheet, xem ô ghi trong lý do (ví dụ E9), sửa lại cho đúng rồi Tiếp tục."],
  ["Lệch dòng trong sheet (Bảng theo sheet)", "Có người chèn / xoá dòng hoặc đổi ảnh / prompt trên sheet sau khi bấm Tạo video. Nên Huỷ rồi tạo lại."],
  ["Lỗi Google Sheet (Bảng theo sheet)", "Kiểm tra mạng và quyền chia sẻ sheet cho tool, rồi Tiếp tục."],
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
                Làm theo <a href="/bat-dau">2 bước bắt đầu</a>: đăng nhập Muse trong cửa sổ bot, rồi thêm dòng đầu tiên trên Bảng. Không cần Google
                Sheet hay Drive.
              </p>
              <h2>Hằng ngày, trên Bảng</h2>
              <ol>
                <li>
                  Mỗi dòng có 4 ô ảnh: <strong>Mẫu trước</strong>, <strong>Áo trước</strong>, <strong>Mẫu sau</strong>, <strong>Áo sau</strong>. Bấm{" "}
                  <strong>+</strong> để chọn ảnh từ máy, hoặc kéo ảnh vào ô. Kéo nhiều ảnh người mẫu vào khung <em>Thêm dòng</em> thì mỗi ảnh thành
                  một dòng.
                </li>
                <li>
                  Chỉ ảnh người mẫu: video người mẫu. Thêm ảnh áo trước: Muse ghép áo vào người mẫu. Đủ 4 ảnh: <strong>áo hai mặt</strong>, ra một
                  video người mẫu xoay từ trước ra sau.
                </li>
                <li>
                  Viết prompt (✎), hoặc chép một prompt cho nhiều dòng bằng <strong>Dải prompt</strong>. Tích các dòng rồi bấm{" "}
                  <strong>▶ Tạo video</strong>, xem trước rồi bấm <strong>Bắt đầu</strong>.
                </li>
                <li>
                  Bot gửi lần lượt từng dòng cho Muse, mỗi dòng một cuộc trò chuyện trong tab riêng, và chờ nhiều video cùng lúc (mặc định 3, đổi ở
                  Cài đặt → <em>Số video chạy cùng lúc</em>). Xong video nào bot tải về máy và gắn vào đúng dòng đó. Bấm <strong>▶</strong> để xem,{" "}
                  <strong>⬇</strong> để tải về
                  (tên <code>MASYS_&lt;số dòng&gt;_&lt;giờ&gt;.mp4</code>), <strong>🗑</strong> để xoá.
                </li>
                <li>
                  Dùng xong thì <strong>Dọn tất cả</strong> để xoá các dòng Xong cùng ảnh và video, giải phóng chỗ trên máy. Dung lượng đang dùng hiện ở
                  đầu Bảng.
                </li>
              </ol>
              <p class="muted small">
                Mỗi ngày tool chỉ tạo tối đa số video đặt trong Cài đặt (mặc định 100). Máy cần bật suốt lô. Dòng <strong>Cần xem</strong>: bấm{" "}
                <em>Mở trong Muse</em> để xem cuộc trò chuyện; tool không tự gửi lại. Có sheet cũ thì bấm <strong>Nhập từ Google Sheet</strong> (cần
                khoá Google); Bảng theo sheet cũ ở ⚙ Nâng cao.
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
