import type { Child } from "hono/jsx";
import { APP_NAME, APP_VERSION } from "../version.js";
import { logoUrl } from "./logo.js";

/** Dải báo lô đang chạy / tạm dừng trên đầu mọi trang (CON-41); createApp gắn vào. */
let statusBanner: (() => Child) | undefined;
export function setStatusBanner(fn: (() => Child) | undefined) {
  statusBanner = fn;
}

/** Dải báo phiên bản (CON-44): vừa cập nhật / quay về, hoặc có bản mới. */
let updateBanner: (() => Child) | undefined;
export function setUpdateBanner(fn: (() => Child) | undefined) {
  updateBanner = fn;
}

export function Layout(props: { title: string; children: Child; /** Bảng tự hiện lô đang chạy nên không cần dải báo lô. */ hideStatus?: boolean }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <link rel="icon" type="image/png" sizes="32x32" href={logoUrl("icon-32.png")} />
        <link rel="icon" type="image/png" sizes="180x180" href={logoUrl("icon-180.png")} />
        <link rel="apple-touch-icon" href={logoUrl("icon-180.png")} />
        <style>{`
          :root { --bg:#f7f7f8; --fg:#1b1b1f; --muted:#5f6068; --card:#fff; --border:#dcdce0; --warn-bg:#fff4e5; --warn-fg:#7a4100; --ok-bg:#e6f6e6; --ok-fg:#1d5a1d; --link:#1f5fbf; --accent:#1f5fbf; }
          @media (prefers-color-scheme: dark) {
            :root { --bg:#141417; --fg:#ececf0; --muted:#a0a1aa; --card:#1d1d22; --border:#33343b; --warn-bg:#3a2a12; --warn-fg:#ffd59a; --ok-bg:#16301a; --ok-fg:#a6e3a6; --link:#8ab4ff; --accent:#3b73d1; }
          }
          body { margin:0; font-family: system-ui, Segoe UI, sans-serif; background:var(--bg); color:var(--fg); }
          main { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
          h1 { font-size: 1.4rem; margin: 0 0 16px; }
          .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:16px; }
          .warn { background:var(--warn-bg); color:var(--warn-fg); border-color:transparent; }
          .muted { color:var(--muted); }
          code { font-family: ui-monospace, Consolas, monospace; }
          h2 { font-size: 1.1rem; margin: 24px 0 8px; }
          nav { border-bottom:1px solid var(--border); background:var(--card); }
          nav .nav-in { max-width:960px; margin:0 auto; padding:10px 16px; display:flex; gap:16px; flex-wrap:wrap; }
          a { color:var(--link); }
          nav .nav-in { align-items:center; }
          nav a.brand { display:flex; align-items:center; gap:8px; font-weight:700; color:var(--fg); text-decoration:none; margin-right:8px; }
          nav a.brand img { width:28px; height:28px; }
          .hero { display:flex; justify-content:center; background:#0b0b12; border-radius:12px; padding:16px; margin-bottom:16px; }
          .hero img { width:180px; height:180px; }
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
          nav .nav-in { max-width: 1100px; }
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
          .thumbs { display:flex; gap:4px; }
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
          pre.notes { max-height:260px; overflow:auto; }
          .update-box { border-top:1px solid var(--border); border-bottom:1px solid var(--border); padding:8px 0 4px; margin-bottom:12px; }
          .banner.ok { background:var(--ok-bg); color:var(--ok-fg); border-color:transparent; }
          .banner.warn { background:var(--warn-bg); color:var(--warn-fg); border-color:transparent; }
          details.menu { position:relative; margin-left:auto; }
          details.menu summary { cursor:pointer; list-style:none; color:var(--link); padding:4px 8px; border:1px solid var(--border); border-radius:6px; }
          details.menu summary::-webkit-details-marker { display:none; }
          details.menu .menu-items { position:absolute; right:0; top:calc(100% + 6px); z-index:10; background:var(--card); border:1px solid var(--border); border-radius:8px; padding:6px 0; min-width:240px; box-shadow:0 6px 20px rgba(0,0,0,.15); display:flex; flex-direction:column; }
          details.menu .menu-items a { padding:8px 14px; text-decoration:none; }
          details.menu .menu-items a:hover { background:var(--bg); }
          .bang-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
          .bang-head .row { align-items:center; }
          .pill { display:inline-block; padding:4px 10px; border-radius:999px; background:var(--card); border:1px solid var(--border); }
          .pill.bad { background:var(--bad-bg); color:var(--bad-fg); border-color:transparent; }
          button.small { padding:4px 8px; font-size:.85rem; }
          table.bang td.prompt { min-width:240px; max-width:420px; }
          table.bang tr.live td { background:var(--warn-bg); }
          table.bang label.inline { display:flex; gap:4px; align-items:center; font-weight:400; margin-top:6px; white-space:nowrap; }
          .running-box { background:var(--info-bg); color:var(--info-fg); border-color:transparent; }
          .actionbar { position:sticky; bottom:0; z-index:5; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin:16px 0 0; box-shadow:0 -4px 16px rgba(0,0,0,.08); }
          .actionbar .run-right { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
          .folder-pick { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
          .folder-pick select { min-width:200px; }
          .folder-pick input { min-width:280px; }
          .inline-label { display:inline; margin:0; font-weight:600; }
          #runBtn { font-size:1.05rem; padding:8px 18px; font-weight:600; }
          .cellwrap { display:flex; gap:4px; align-items:flex-start; }
          .cellbody { flex:1 1 auto; min-width:0; }
          button.edit { background:none; border:1px solid transparent; color:var(--link); padding:2px 6px; font-size:1rem; line-height:1; }
          button.edit:hover { border-color:var(--border); background:var(--bg); }
          .editor { margin-top:8px; display:flex; flex-direction:column; gap:6px; min-width:260px; }
          .editor input { width:100%; box-sizing:border-box; }
          .editor .row { align-items:center; }
          .conflict { background:var(--warn-bg); color:var(--warn-fg); padding:6px 8px; border-radius:6px; white-space:pre-wrap; word-break:break-word; }
          .add-row { align-items:center; margin:10px 0 16px; }
          input.wide { width:100%; box-sizing:border-box; }
          #fillRows { min-width:240px; }
          .small-hero img { width:120px; height:120px; }
          ol.steps { list-style:none; margin:0; padding:0; }
          li.step { display:flex; gap:12px; padding:12px 0; border-top:1px solid var(--border); }
          li.step:first-child { border-top:none; padding-top:4px; }
          .step-mark { font-size:1.3rem; line-height:1.3; }
          .step-body { flex:1 1 auto; display:flex; flex-direction:column; gap:6px; }
          li.step.done strong { color:var(--muted); }
          .step-form .row { align-items:center; }
          .step-form input { flex:1 1 320px; }
          ul.mapping { margin:10px 0 14px; padding-left:20px; }
          .hint { margin-top:4px; }
          table.bang-moi td.slot { text-align:center; min-width:76px; }
          .slot-img { display:flex; flex-direction:column; align-items:center; gap:2px; }
          .slot-tools { display:flex; gap:2px; }
          button.slot-add { width:64px; height:64px; font-size:1.4rem; background:none; color:var(--muted); border:1px dashed var(--border); }
          button.slot-add:hover { color:var(--link); border-color:var(--link); }
          td.slot.over, .dropzone.over { outline:2px dashed var(--link); outline-offset:-2px; }
          td.slot.busy { opacity:.5; }
          .dropzone { border-style:dashed; }
          .filters { gap:6px; }
          .pager { justify-content:center; align-items:center; margin-top:12px; }
          footer { max-width:1100px; margin:0 auto; padding:8px 16px 24px; color:var(--muted); font-size:.85rem; }
          @media (prefers-color-scheme: dark) { :root { --info-bg:#1b2a47; --info-fg:#a9c6ff; --bad-bg:#3d1b1b; --bad-fg:#ffb3b3; } }
        `}</style>
      </head>
      <body>
        <nav>
          <div class="nav-in">
            <a href="/" class="brand" title="MASYS Video Generator">
              <img src={logoUrl("icon-64.png")} alt="" />
              MASYS Video
            </a>
            <a href="/">Bảng</a>
            <details class="menu">
              <summary>⚙ Nâng cao</summary>
              <div class="menu-items">
                <a href="/sheets">Kết nối sheet</a>
                <a href="/bang-moi">Bảng mới (đang thử)</a>
                <a href="/scan">Quét và chọn dòng (kiểu cũ)</a>
                <a href="/batches">Lịch sử lô</a>
                <a href="/logs">Nhật ký</a>
                <a href="/bot">Bot Muse</a>
                <a href="/settings">Cài đặt</a>
                <a href="/bat-dau">Các bước bắt đầu</a>
                <a href="/huong-dan">Hướng dẫn</a>
              </div>
            </details>
          </div>
        </nav>
        <main>
          {updateBanner?.()}
          {!props.hideStatus && statusBanner?.()}
          {props.children}
        </main>
        <footer>
          {APP_NAME} v{APP_VERSION}
        </footer>
      </body>
    </html>
  );
}
