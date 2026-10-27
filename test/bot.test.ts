import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MANUAL_NOTE, listQueuedRuns, manualSend } from "../src/bot/manualSend.js";
import { BotError, MuseBot } from "../src/bot/museBot.js";
import { openDatabase } from "../src/db/index.js";

// Trang Muse giả lập theo tên thật đã ghi nhận (museSelectors.ts). Chrome chạy ẩn chỉ trong test.
type Mode = "ready" | "login" | "challenge" | "broken" | "quota" | "nosend" | "nonew" | "approval";
let mode: Mode = "ready";
let received: string[] = [];

const CHAT_PAGE = (m: Mode) => `<!doctype html><html><head><title>Chat — Như</title></head><body>
<a href="/">Chat</a>
<button aria-label="Chats Open chat and side chats" onclick="document.getElementById('side').hidden=false">≡</button>
<nav id="side" aria-label="Side chats" hidden>
  <h3>Start a side chat</h3>
  ${m === "nonew" ? "" : `<button onclick="history.pushState({}, '', '/thread/new'); document.getElementById('log').innerHTML=''">New side chat</button>`}
</nav>
<div id="log" role="log" aria-label="Chat messages"><p>Tin cũ: try again later</p></div>
<textarea aria-label="Message" oninput="document.getElementById('send').hidden=!this.value"></textarea>
<button id="send" hidden onclick="send()">Send</button>
<script>
function send() {
  const t = document.querySelector('textarea');
  ${m === "nosend" ? "return;" : ""}
  fetch('/received', { method: 'POST', body: t.value });
  const p = document.createElement('p'); p.textContent = t.value; document.getElementById('log').append(p);
  t.value = ''; document.getElementById('send').hidden = true;
  ${
    m === "approval"
      ? `const a = document.createElement('div');
  a.innerHTML = '<span>Needs approval</span><p>Allow Như to create or upload files that may be shared in Google Drive?</p><button>Create</button><button>Always allow</button><button>Don&#39;t create</button>';
  a.querySelectorAll('button').forEach((b) => (b.onclick = () => fetch('/received', { method: 'POST', body: 'CLICKED ' + b.textContent })));
  document.body.append(a);`
      : ""
  }
  ${m === "quota" ? `const q = document.createElement('div'); q.textContent = "You've reached your weekly limit."; document.body.append(q);` : `setTimeout(() => history.pushState({}, '', '/thread/abc123XYZ'), 1200);`}
}
</script></body></html>`;

function pageFor(m: Mode): string {
  if (m === "login")
    return `<!doctype html><title>Muse</title><h1>Log in or create an account</h1><label>Mobile number or email<input type="text" aria-label="Mobile number or email"></label>`;
  if (m === "challenge") return `<!doctype html><title>Muse</title><h2>Security check</h2><p>Please complete the captcha.</p>`;
  if (m === "broken") return `<!doctype html><title>Muse</title><p>Đang bảo trì</p>`;
  return CHAT_PAGE(m);
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/received") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(body);
      res.end("ok");
    });
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(pageFor(mode));
});

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"];
const hasChrome = CHROME.some((p) => fs.existsSync(p));

let base = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "masys-bot-"));
let bot: MuseBot | undefined;

function newBot(extra: Partial<ConstructorParameters<typeof MuseBot>[0]> = {}) {
  bot = new MuseBot({
    profileDir: path.join(tmp, `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    screenshotDir: path.join(tmp, "screenshots"),
    museUrl: () => `${base}/`,
    headless: true,
    loadTimeoutMs: 1500,
    confirmTimeoutMs: 2500,
    pauseBeforeSendMs: [10, 20],
    ...extra,
  });
  return bot;
}

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await bot?.close();
  bot = undefined;
  mode = "ready";
  received = [];
});
afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const REQUEST = "Hãy tạo một video dọc 9:16 từ ảnh https://drive.google.com/file/d/abc/view\n3. Chỉ sửa đúng ô C2.";

describe.skipIf(!hasChrome)("MuseBot với trang Muse giả lập", () => {
  it("chưa mở trình duyệt → closed; không tự mở", async () => {
    const b = newBot();
    expect(await b.check()).toEqual({ state: "closed" });
    expect(b.isOpen).toBe(false);
    await expect(b.send(REQUEST)).rejects.toMatchObject({ code: "closed", sent: false });
  });

  it("nhận diện trang đăng nhập, kiểm tra bảo mật, sẵn sàng; giao diện lạ → ui_changed + ảnh chụp", async () => {
    const b = newBot();
    mode = "login";
    await b.open();
    expect((await b.check({ reload: true })).state).toBe("login");
    mode = "challenge";
    expect((await b.check({ reload: true })).state).toBe("challenge");
    mode = "ready";
    const ready = await b.check({ reload: true });
    expect(ready).toMatchObject({ state: "ready", url: `${base}/` });
    mode = "broken";
    const broken = await b.check({ reload: true });
    expect(broken.state).toBe("ui_changed");
    expect(broken.screenshot && fs.existsSync(broken.screenshot)).toBe(true);
  }, 30_000);

  it("gửi: mở side chat mới, dán đúng yêu cầu, bấm Send một lần, chờ URL thật của cuộc trò chuyện (không lưu /thread/new)", async () => {
    const b = newBot();
    await b.open();
    const { chatUrl } = await b.send(REQUEST);
    expect(chatUrl).toBe(`${base}/thread/abc123XYZ`);
    expect(received).toEqual([REQUEST]);
  }, 30_000);

  it("chưa đăng nhập thì không gửi, sent=false", async () => {
    const b = newBot();
    mode = "login";
    await b.open();
    await expect(b.send(REQUEST)).rejects.toMatchObject({ code: "login", sent: false });
    expect(received).toEqual([]);
  }, 30_000);

  it("không có nút New side chat → ui_changed, chưa gửi, có ảnh chụp", async () => {
    const b = newBot();
    mode = "nonew";
    await b.open();
    const err = (await b.send(REQUEST).catch((e) => e)) as BotError;
    expect(err).toMatchObject({ code: "ui_changed", sent: false });
    expect(err.screenshot && fs.existsSync(err.screenshot)).toBe(true);
    expect(received).toEqual([]);
  }, 30_000);

  it("Muse báo hết lượt sau khi gửi → quota, sent=true (thông báo cũ trên trang không tính)", async () => {
    const b = newBot();
    mode = "quota";
    await b.open();
    await expect(b.send(REQUEST)).rejects.toMatchObject({ code: "quota", sent: true });
    expect(received).toEqual([REQUEST]);
  }, 30_000);

  it("watch: thấy Muse chờ duyệt (câu chữ thật 27/10/2026) nhưng không bấm nút nào", async () => {
    const b = newBot();
    mode = "approval";
    await b.open();
    expect((await b.watch()).approval).toBe(false);
    await b.send(REQUEST);
    const w = await b.watch();
    expect(w).toMatchObject({ closed: false, login: false, approval: true });
    expect(w.notice).toBeUndefined();
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toEqual([REQUEST]);
  }, 30_000);

  it("bấm Send mà không thấy Muse nhận → send_unconfirmed, sent=true (không gửi lại)", async () => {
    const b = newBot();
    mode = "nosend";
    await b.open();
    await expect(b.send(REQUEST)).rejects.toMatchObject({ code: "send_unconfirmed", sent: true });
    expect(received).toEqual([]);
  }, 30_000);
});

function dbWithRun() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (1, 'S', 'Trang tính1', 'F', 'queued')").run();
  db.prepare("INSERT INTO runs (id, batchId, rowNumber, inputSnapshot, promptSent, requestText, state) VALUES (7, 1, 2, '{}', 'p', ?, 'queued')").run(REQUEST);
  return db;
}
const runRow = (db: ReturnType<typeof dbWithRun>) =>
  db.prepare("SELECT state, sentAt, museChatUrl, error FROM runs WHERE id = 7").get() as Record<string, string | null>;

describe("gửi thử bằng tay (manualSend)", () => {
  const fakeBot = (impl: () => Promise<{ chatUrl: string }>) => ({ send: impl }) as unknown as MuseBot;

  it("thành công → Cần xem, lưu URL cuộc trò chuyện, tính vào giới hạn ngày", async () => {
    const db = dbWithRun();
    expect(listQueuedRuns(db).map((r) => r.id)).toEqual([7]);
    const r = await manualSend(db, fakeBot(async () => ({ chatUrl: "https://muse.ai/thread/xyz123" })), 7);
    expect(r).toEqual({ ok: true, chatUrl: "https://muse.ai/thread/xyz123" });
    expect(runRow(db)).toMatchObject({ state: "needs_review", museChatUrl: "https://muse.ai/thread/xyz123", error: MANUAL_NOTE });
    expect(runRow(db).sentAt).toBeTruthy();
    expect(listQueuedRuns(db)).toEqual([]);
    const states = db.prepare("SELECT fromState, toState FROM run_events WHERE runId = 7 ORDER BY id").all();
    expect(states).toEqual([
      { fromState: "queued", toState: "sending" },
      { fromState: "sending", toState: "needs_review" },
    ]);
  });

  it("lỗi trước khi bấm Gửi → về Chờ chạy, không tính lượt", async () => {
    const db = dbWithRun();
    const r = await manualSend(db, fakeBot(async () => Promise.reject(new BotError("login", "Cần đăng nhập Muse", false))), 7);
    expect(r).toMatchObject({ ok: false, sent: false });
    expect(runRow(db)).toMatchObject({ state: "queued", sentAt: null });
  });

  it("lỗi sau khi bấm Gửi → Cần xem, giữ sentAt, không gửi lại (D9)", async () => {
    let calls = 0;
    const db = dbWithRun();
    const r = await manualSend(
      db,
      fakeBot(async () => {
        calls++;
        throw new BotError("send_unconfirmed", "Đã bấm Gửi nhưng không chắc Muse đã nhận yêu cầu", true, "C:/x.png");
      }),
      7,
    );
    expect(r).toMatchObject({ ok: false, sent: true });
    expect(calls).toBe(1);
    expect(runRow(db)).toMatchObject({ state: "needs_review" });
    expect(runRow(db).sentAt).toBeTruthy();
    expect(db.prepare("SELECT screenshotPath FROM run_events WHERE runId = 7 ORDER BY id DESC LIMIT 1").get()).toEqual({ screenshotPath: "C:/x.png" });
    // Gửi lại lượt đã gửi: bị từ chối.
    expect(await manualSend(db, fakeBot(async () => ({ chatUrl: "x" })), 7)).toMatchObject({ ok: false, sent: false });
  });

  it("hết giới hạn ngày thì không gửi", async () => {
    const db = dbWithRun();
    db.prepare("UPDATE settings SET dailyVideoLimit = 0 WHERE id = 1").run();
    let called = false;
    const r = await manualSend(db, fakeBot(async () => ((called = true), { chatUrl: "x" })), 7);
    expect(r).toMatchObject({ ok: false, sent: false });
    expect(called).toBe(false);
    expect(runRow(db).state).toBe("queued");
  });
});

describe("bảo mật bot", () => {
  it("code bot không đọc cookie hay xuất phiên đăng nhập ra ngoài hồ sơ", () => {
    const dir = path.resolve("src/bot");
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\.cookies\(|addCookies|storageState|document\.cookie/);
    }
  });
});

describe("trang Bot Muse", () => {
  async function setup(send: () => Promise<{ chatUrl: string }>, isOpen = true) {
    const { createApp } = await import("../src/web/app.js");
    const { loadConfig } = await import("../src/config.js");
    const db = dbWithRun();
    const config = loadConfig({ MASYS_DATA_DIR: tmp });
    const fake = { isOpen, send, check: async () => ({ state: "ready" }), open: async () => {}, close: async () => {} } as unknown as MuseBot;
    return { db, app: createApp(config, db, { bot: fake }) };
  }

  it("hiện nút mở trình duyệt, dòng Chờ chạy và giới hạn ngày; khoá nút gửi khi trình duyệt tắt", async () => {
    const { app } = await setup(async () => ({ chatUrl: "x" }), false);
    const html = await (await app.request("/bot")).text();
    expect(html).toContain("Mở trình duyệt bot");
    expect(html).toContain("tự đăng nhập Muse");
    expect(html).toContain("Lô #1");
    expect(html).toContain("dòng 2");
    expect(html).toMatch(/<button type="submit" disabled="">Gửi thử cho Muse<\/button>/);
    expect(html).toContain("Hôm nay: <strong>0/5 video</strong>");
  });

  it("bấm Gửi thử → gửi đúng một lần, báo link cuộc trò chuyện, nhật ký hiện lượt", async () => {
    let calls = 0;
    const { app, db } = await setup(async () => (calls++, { chatUrl: "https://muse.ai/thread/xyz123" }));
    const res = await app.request("/bot/send", { method: "POST", body: new URLSearchParams({ runId: "7" }) });
    const html = await res.text();
    expect(calls).toBe(1);
    expect(html).toContain("Đã gửi cho Muse");
    expect(html).toContain('href="https://muse.ai/thread/xyz123"');
    expect(html).toContain("Nhật ký bot gần đây");
    expect(runRow(db).state).toBe("needs_review");
    const again = await app.request("/bot/send", { method: "POST", body: new URLSearchParams({ runId: "7" }) });
    expect(again.status).toBe(409);
    expect(calls).toBe(1);
  });

  it("ảnh chụp chỉ phục vụ đúng tên file của bot", async () => {
    const { app } = await setup(async () => ({ chatUrl: "x" }));
    expect((await app.request("/bot/screenshot/..%2Fdata.db")).status).toBe(404);
    fs.mkdirSync(path.join(tmp, "screenshots"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "screenshots", "2026-10-26T15-40-00-000Z-ui_changed.png"), "png");
    const ok = await app.request("/bot/screenshot/2026-10-26T15-40-00-000Z-ui_changed.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
  });
});
