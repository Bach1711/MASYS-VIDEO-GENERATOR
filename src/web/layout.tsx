import type { Child } from "hono/jsx";

export function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{`
          :root { --bg:#f7f7f8; --fg:#1b1b1f; --muted:#5f6068; --card:#fff; --border:#dcdce0; --warn-bg:#fff4e5; --warn-fg:#7a4100; }
          @media (prefers-color-scheme: dark) {
            :root { --bg:#141417; --fg:#ececf0; --muted:#a0a1aa; --card:#1d1d22; --border:#33343b; --warn-bg:#3a2a12; --warn-fg:#ffd59a; }
          }
          body { margin:0; font-family: system-ui, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
          main { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
          h1 { font-size: 1.4rem; margin: 0 0 16px; }
          .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:16px; }
          .warn { background:var(--warn-bg); color:var(--warn-fg); border-color:transparent; }
          .muted { color:var(--muted); }
          code { font-family: ui-monospace, Consolas, monospace; }
        `}</style>
      </head>
      <body>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
