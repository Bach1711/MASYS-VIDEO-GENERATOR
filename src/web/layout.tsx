import type { Child } from "hono/jsx";
import { APP_NAME, APP_VERSION } from "../version.js";

/** Dải báo lô đang chạy / tạm dừng trên đầu mọi trang (CON-41); createApp gắn vào. */
let statusBanner: (() => Child) | undefined;
export function setStatusBanner(fn: (() => Child) | undefined) {
  statusBanner = fn;
}

export function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{`
          :root { --bg:#f7f7f8; --fg:#1b1b1f; --muted:#5f6068; --card:#fff; --border:#dcdce0; --warn-bg:#fff4e5; --warn-fg:#7a4100; --ok-bg:#e6f6e6; --ok-fg:#1d5a1d; --link:#1f5fbf; --accent:#1f5fbf; }
          @media (prefers-color-scheme: dark) {
            :root { --bg:#141417; --fg:#ececf0; --muted:#a0a1aa; --card:#1d1d22; --border:#33343b; --warn-bg:#3a2a12; --warn-fg:#ffd59a; --ok-bg:#16301a; --ok-fg:#a6e3a6; --link:#8ab4ff; --accent:#3b73d1; }
          }
          body { margin:0; font-family: system-ui, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
          main { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
          h1 { font-size: 1.4rem; margin: 0 0 16px; }
          .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:16px; }
          .warn { background:var(--warn-bg); color:var(--warn-fg); border-color:transparent; }
          .muted { color:var(--muted); }
          code { font-family: ui-monospace, Consolas, monospace; }
          h2 { font-size: 1.1rem; margin: 24px 0 8px; }
          nav { border-bottom:1px solid var(--border); background:var(--card); }
          nav div { max-width:960px; margin:0 auto; padding:10px 16px; display:flex; gap:16px; flex-wrap:wrap; }
          a { color:var(--link); }
          .ok { background:var(--ok-bg); color:var(--ok-fg); border-color:transparent; }
          label { display:block; font-weight:600; margin-bottom:6px; }
          .row { display:flex; gap:8px; flex-wrap:wrap; }
          .row input { flex:1 1 240px; }
          .field { margin-bottom:12px; }
          input, select, button { font:inherit; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--fg); }
          select { min-width: 240px; max-width:100%; }
          button { background:var(--accent); color:#fff; border-color:var(--accent); cursor:pointer; }
          table { width:100%; border-collapse:collapse; background:var(--card); }
          th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); }
          .scroll { overflow-x:auto; }
          main { max-width: 1100px; }
          nav div { max-width: 1100px; }
          button:disabled { opacity:.45; cursor:not-allowed; }
          button.secondary, a.button.secondary { background:var(--card); color:var(--fg); border-color:var(--border); }
          a.button { display:inline-block; padding:6px 10px; border-radius:6px; background:var(--accent); color:#fff; text-decoration:none; border:1px solid var(--accent); }
          input[type=checkbox] { width:18px; height:18px; padding:0; }
          label.inline { display:inline-flex; align-items:center; gap:6px; font-weight:normal; margin:0; }
          .row-between { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
          form.row-between { margin-bottom:16px; }
          .warn-text { color:var(--warn-fg); }
          table.scan td { vertical-align:top; }
          td.prompt { max-width:380px; font-size:.92rem; }
          img.thumb { width:64px; height:64px; object-fit:cover; border-radius:4px; background:var(--border); display:block; }
          .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:.85rem; white-space:nowrap; }
          .b-ready { background:var(--ok-bg); color:var(--ok-fg); }
          .b-has_video { background:var(--info-bg); color:var(--info-fg); }
          .b-running { background:var(--warn-bg); color:var(--warn-fg); }
          .b-missing_data { background:var(--bad-bg); color:var(--bad-fg); }
          textarea { display:block; width:100%; box-sizing:border-box; font:inherit; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--fg); resize:vertical; }
          textarea.mono, pre.request { font-family: ui-monospace, Consolas, monospace; font-size:.88rem; }
          pre.request { white-space:pre-wrap; word-break:break-word; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin:8px 0 0; }
          label.sub { margin-top:12px; }
          .small { font-size:.85rem; }
          .row-head { display:flex; gap:12px; align-items:center; margin-bottom:10px; }
          .card h2 { margin-top:0; }
          ul.placeholders { font-size:.9rem; padding-left:18px; }
          details summary { cursor:pointer; }
          ul.tabs { list-style:none; margin:8px 0 0; padding:0; }
          ul.tabs li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-top:1px solid var(--border); }
          .sheet-group .row-between { margin-bottom:0; }
          ul.problems { margin:4px 0 0; padding-left:18px; font-size:.85rem; color:var(--muted); }
          :root { --info-bg:#e3edff; --info-fg:#173f86; --bad-bg:#fde7e7; --bad-fg:#8a1c1c; }
          .banner { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:10px 14px; margin-bottom:16px; }
          .banner.running { background:var(--info-bg); color:var(--info-fg); border-color:transparent; }
          .tally span { margin-right:10px; white-space:nowrap; }
          h2.sub-h { margin-top:20px; }
          input[type=number] { width:90px; }
          footer { max-width:1100px; margin:0 auto; padding:8px 16px 24px; color:var(--muted); font-size:.85rem; }
          @media (prefers-color-scheme: dark) { :root { --info-bg:#1b2a47; --info-fg:#a9c6ff; --bad-bg:#3d1b1b; --bad-fg:#ffb3b3; } }
        `}</style>
      </head>
      <body>
        <nav>
          <div>
            <a href="/">Trang chủ</a>
            <a href="/sheets">Kết nối sheet</a>
            <a href="/scan">Quét và chọn dòng</a>
            <a href="/batches">Lịch sử lô</a>
            <a href="/logs">Nhật ký</a>
            <a href="/bot">Bot Muse</a>
            <a href="/settings">Cài đặt</a>
          </div>
        </nav>
        <main>
          {statusBanner?.()}
          {props.children}
        </main>
        <footer>
          {APP_NAME} v{APP_VERSION}
        </footer>
      </body>
    </html>
  );
}
