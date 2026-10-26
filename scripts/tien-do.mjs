// Tạo TIEN-DO.html từ TIEN-DO.md để bấm đúp mở bằng trình duyệt, sơ đồ Mermaid hiện thành hình.
// Chạy: npm run tien-do (sau mỗi lần sửa TIEN-DO.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = fs.readFileSync(path.join(root, "TIEN-DO.md"), "utf8").replace(/\r\n/g, "\n");
// Nhúng nguyên văn markdown; chỉ cần tránh chuỗi đóng thẻ script.
const embedded = md.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tiến độ MASYS</title>
<!-- File này được tạo tự động từ TIEN-DO.md bằng "npm run tien-do". Đừng sửa tay. -->
<style>
  :root { --bg:#f7f7f8; --fg:#1b1b1f; --muted:#5f6068; --card:#fff; --border:#dcdce0; --link:#1f5fbf; --code:#f0f0f3; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141417; --fg:#ececf0; --muted:#a0a1aa; --card:#1d1d22; --border:#33343b; --link:#8ab4ff; --code:#24242a; }
  }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui, "Segoe UI", sans-serif; line-height:1.55; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  a { color: var(--link); }
  h1 { font-size: 1.6rem; margin-top: 0; }
  h2 { font-size: 1.2rem; margin-top: 32px; border-bottom:1px solid var(--border); padding-bottom:4px; }
  blockquote { margin: 0 0 16px; padding: 8px 12px; border-left: 3px solid var(--border); color: var(--muted); }
  pre, code { font-family: ui-monospace, Consolas, monospace; background: var(--code); border-radius: 4px; }
  code { padding: 1px 4px; }
  pre { padding: 10px 12px; overflow-x: auto; }
  pre code { padding: 0; }
  .mermaid { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; }
  .tbl { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; background: var(--card); }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  #offline { display:none; padding:10px 12px; border-radius:6px; background:#fff4e5; color:#7a4100; margin-bottom:16px; }
</style>
</head>
<body>
<main>
  <div id="offline">Không tải được thư viện hiển thị (cần mạng). Nội dung gốc ở TIEN-DO.md.</div>
  <div id="content"></div>
</main>
<script type="text/plain" id="source">${embedded}</script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>
  (function () {
    var src = document.getElementById("source").textContent;
    var el = document.getElementById("content");
    if (!window.marked) {
      document.getElementById("offline").style.display = "block";
      el.innerHTML = "<pre></pre>";
      el.firstChild.textContent = src;
      return;
    }
    el.innerHTML = marked.parse(src);
    el.querySelectorAll("table").forEach(function (t) {
      var w = document.createElement("div"); w.className = "tbl";
      t.parentNode.insertBefore(w, t); w.appendChild(t);
    });
    el.querySelectorAll("pre > code.language-mermaid").forEach(function (code) {
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentNode.replaceWith(div);
    });
    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
      mermaid.run({ querySelector: ".mermaid" });
    }
  })();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, "TIEN-DO.html"), html);
console.log("Đã tạo TIEN-DO.html");
