import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkServiceAccount, loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { applyStoredKey, dpapi, KeyStore, minimalKeyJson, UNREADABLE_KEY_PROBLEM, type Protector } from "../src/keyStore.js";
import { APP_VERSION } from "../src/version.js";
import { createApp } from "../src/web/app.js";
import { FAKE_KEY_ENV } from "./fakeKey.js";

// Bộ mã hoá giả: đảo byte để chắc file trên đĩa không phải chữ rõ.
const fakeProtector: Protector = {
  protect: async (plain) => Buffer.from(Buffer.from(plain, "utf8").map((b) => b ^ 0x5a)),
  unprotect: async (data) => Buffer.from(data.map((b) => b ^ 0x5a)).toString("utf8"),
};
const brokenProtector: Protector = {
  protect: fakeProtector.protect,
  unprotect: async () => {
    throw new Error("không giải mã được");
  },
};

const KEY = { type: "service_account", project_id: "p", private_key_id: "kid", private_key: "PK-GIA", client_email: "bot@p.iam.gserviceaccount.com", client_id: "123" };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "masys-key-"));

describe("KeyStore (D15)", () => {
  it("lưu rồi đọc lại được; file trên đĩa không chứa khoá dạng chữ rõ", async () => {
    const store = new KeyStore(tmpDir(), fakeProtector);
    expect(store.exists()).toBe(false);
    expect(await store.load()).toBeUndefined();
    await store.save(JSON.stringify(KEY));
    expect(fs.readFileSync(store.file).toString("latin1")).not.toContain("PK-GIA");
    expect(JSON.parse((await store.load())!)).toEqual(KEY);
  });

  it("minimalKeyJson bỏ các trường không cần", () => {
    expect(JSON.parse(minimalKeyJson("﻿" + JSON.stringify(KEY)))).not.toHaveProperty("client_id");
  });

  it("biến môi trường được ưu tiên; không có thì dùng file; file từ máy khác thì báo chọn lại", async () => {
    const dir = tmpDir();
    const store = new KeyStore(dir, fakeProtector);
    await store.save(JSON.stringify(KEY));

    const fromEnv = loadConfig({ ...FAKE_KEY_ENV, MASYS_DATA_DIR: dir });
    await applyStoredKey(fromEnv, store);
    expect(fromEnv.keySource).toBe("env");
    expect(fromEnv.serviceAccount.ok && fromEnv.serviceAccount.clientEmail).toBe("bot@x.iam.gserviceaccount.com");

    const fromFile = loadConfig({ MASYS_DATA_DIR: dir });
    expect(fromFile.keySource).toBe("none");
    await applyStoredKey(fromFile, store);
    expect(fromFile.keySource).toBe("file");
    expect(fromFile.serviceAccount.ok && fromFile.serviceAccount.clientEmail).toBe(KEY.client_email);

    const otherMachine = loadConfig({ MASYS_DATA_DIR: dir });
    await applyStoredKey(otherMachine, new KeyStore(dir, brokenProtector));
    expect(otherMachine.keySource).toBe("none");
    expect(!otherMachine.serviceAccount.ok && otherMachine.serviceAccount.problem).toBe(UNREADABLE_KEY_PROBLEM);
  });

  it("báo lỗi file khoá bằng lời nói về file, không nhắc 1Password", () => {
    const bad = checkServiceAccount("không phải json", "file");
    expect(!bad.ok && bad.problem).toContain("File đã chọn");
    const notSa = checkServiceAccount(JSON.stringify({ type: "authorized_user" }), "file");
    expect(!notSa.ok && notSa.problem).toContain("service account");
    expect(checkServiceAccount("﻿" + JSON.stringify(KEY), "file").ok).toBe(true);
  });

  it.skipIf(process.platform !== "win32")("DPAPI thật: mã hoá rồi giải mã đúng, có dấu tiếng Việt", async () => {
    const plain = JSON.stringify({ ...KEY, note: "khoá thử – tiếng Việt" });
    const enc = await dpapi.protect(plain);
    expect(enc.toString("latin1")).not.toContain("PK-GIA");
    expect(await dpapi.unprotect(enc)).toBe(plain);
  }, 30_000);
});

function setupApp(opts: { env?: Record<string, string>; verifyFails?: boolean; running?: boolean } = {}) {
  const dir = tmpDir();
  const config = loadConfig({ ...opts.env, MASYS_DATA_DIR: dir });
  const db = openDatabase(":memory:");
  const store = new KeyStore(dir, fakeProtector);
  const restart = vi.fn();
  const verifyKey = vi.fn(async () => {
    if (opts.verifyFails) throw new Error("invalid_grant");
  });
  if (opts.running) {
    db.prepare("INSERT INTO batches (id, spreadsheetId, tab, driveFolderId, status) VALUES (7, 'S', 'T', 'F', 'running')").run();
  }
  const app = createApp(config, db, { keyStore: store, verifyKey, restart });
  const upload = (content: string, name = "khoa.json") => {
    const form = new FormData();
    form.append("key", new File([content], name, { type: "application/json" }));
    return app.request("/setup/key", { method: "POST", body: form });
  };
  return { app, store, restart, verifyKey, upload };
}

describe("logo MASYS (CON-48)", () => {
  it("mọi trang có biểu tượng tab và logo ở thanh trên; ảnh trả về đúng PNG, kể cả khi chưa cài khoá", async () => {
    const { app } = setupApp();
    const page = await (await app.request("/setup")).text();
    expect(page).toContain(`rel="icon" type="image/png" sizes="32x32" href="/logo/icon-32.png?v=${APP_VERSION}"`);
    expect(page).toContain('class="brand"');
    for (const f of ["icon-32.png", "icon-64.png", "icon-180.png", "masys.png"]) {
      const r = await app.request(`/logo/${f}?v=${APP_VERSION}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(r.headers.get("cache-control")).toContain("immutable");
      const png = Buffer.from(await r.arrayBuffer());
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    expect((await app.request("/logo/khong-co.png")).status).toBe(404);
  });

  it("Trang chủ có logo đầy đủ", async () => {
    const { app } = setupApp({ env: FAKE_KEY_ENV });
    expect(await (await app.request("/bat-dau")).text()).toContain(`src="/logo/masys.png?v=${APP_VERSION}"`);
  });
});

describe("trang Cài khoá Google (D15)", () => {
  it("chưa có khoá: trang cần Google Sheet dẫn về /setup; Bảng, Bot, Cài đặt vẫn mở được (v2.0.0)", async () => {
    const { app } = setupApp();
    for (const p of ["/bang-sheet", "/scan", "/sheets", "/ket-noi", "/bang-moi/nhap", "/bat-dau/sheet"]) {
      const r = await app.request(p);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("/setup");
    }
    for (const p of ["/", "/bang-moi", "/bot", "/settings", "/bat-dau"]) expect((await app.request(p)).status).toBe(200);
    const health = await (await app.request("/health")).json();
    expect(health).toMatchObject({ ok: true, app: "masys-video", version: APP_VERSION, serviceAccount: false });
    const page = await (await app.request("/setup")).text();
    expect(page).toContain("Chọn file khoá");
    expect(page).toContain(`v${APP_VERSION}`);
  });

  it("file sai thì báo lỗi, không lưu", async () => {
    const { upload, store, restart } = setupApp();
    const r = await upload("{hỏng");
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("không phải file khoá .json hợp lệ");
    expect(store.exists()).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it("Google từ chối khoá thì không lưu", async () => {
    const { upload, store } = setupApp({ verifyFails: true });
    const r = await upload(JSON.stringify(KEY));
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("Google không chấp nhận khoá");
    expect(store.exists()).toBe(false);
  });

  it("khoá đúng thì kiểm tra với Google, lưu mã hoá, khởi động lại; trang không lặp lại nội dung khoá", async () => {
    const { upload, store, restart, verifyKey } = setupApp();
    const r = await upload(JSON.stringify(KEY));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(KEY.client_email);
    expect(html).not.toContain("PK-GIA");
    expect(verifyKey).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
    expect(JSON.parse((await store.load())!)).not.toHaveProperty("client_id");
  });

  it("máy chạy op run không bị dẫn về /setup và không nhận file khoá", async () => {
    const { app, upload, store } = setupApp({ env: FAKE_KEY_ENV });
    expect((await app.request("/")).status).toBe(200);
    expect(await (await app.request("/setup")).text()).toContain("op run");
    expect((await upload(JSON.stringify(KEY))).status).toBe(409);
    expect(store.exists()).toBe(false);
  });

  it("không đổi khoá khi có lô đang chạy", async () => {
    const { app, upload, store } = setupApp({ running: true });
    expect(await (await app.request("/setup")).text()).toContain("Lô #7 đang chạy");
    expect((await upload(JSON.stringify(KEY))).status).toBe(409);
    expect(store.exists()).toBe(false);
  });

  it("Cài đặt hiện phiên bản, nguồn khoá và nút Đổi file khoá", async () => {
    const { app } = setupApp({ env: FAKE_KEY_ENV });
    const page = await (await app.request("/settings")).text();
    expect(page).toContain(`MASYS Video v${APP_VERSION}`);
    expect(page).toContain("từ biến môi trường");
    expect(page).toContain('href="/setup"');
  });
});

describe("kiểm tra Chrome (D15)", () => {
  it("trang Bot Muse báo cần cài Chrome khi máy chưa có", async () => {
    const make = (installed: boolean) =>
      createApp(loadConfig(FAKE_KEY_ENV), openDatabase(":memory:"), { chromeInstalled: () => installed });
    expect(await (await make(false).request("/bot")).text()).toContain("Máy chưa cài Google Chrome");
    expect(await (await make(true).request("/bot")).text()).not.toContain("Máy chưa cài Google Chrome");
  });
});
