import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { getSettings, parseRunSettings } from "../src/db/settings.js";
import { createApp } from "../src/web/app.js";
// @ts-expect-error script .mjs không có khai báo kiểu
import { findSecrets, run, secretsFromEnv } from "../scripts/check-secrets.mjs";

const ok = { timeoutMinutes: "20", pauseMinSec: "20", pauseMaxSec: "60", dailyVideoLimit: "5", museUrl: "" };

describe("Cài đặt chạy lô (F7)", () => {
  it("kiểm tra dữ liệu nhập", () => {
    expect(parseRunSettings(ok)).toEqual({
      ok: true,
      value: { timeoutMinutes: 20, pauseMinSec: 20, pauseMaxSec: 60, dailyVideoLimit: 5, museUrl: null },
    });
    const bad = parseRunSettings({ timeoutMinutes: "0", pauseMinSec: "60", pauseMaxSec: "20", dailyVideoLimit: "abc", museUrl: "https://evil.example/muse.ai" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(4);
    expect(parseRunSettings({ ...ok, museUrl: "http://muse.ai/" }).ok).toBe(false);
    expect(parseRunSettings({ ...ok, museUrl: "https://www.muse.ai/chat" })).toMatchObject({ ok: true, value: { museUrl: "https://www.muse.ai/chat" } });
    expect(parseRunSettings({ ...ok, timeoutMinutes: "2.5" }).ok).toBe(false);
  });

  it("trang Cài đặt lưu được, báo lỗi khi sai, nhắc rủi ro khi giới hạn > 5, có nút Mở trình duyệt bot", async () => {
    const db = openDatabase(":memory:");
    const app = createApp(loadConfig({}), db);
    const page = await (await app.request("/settings")).text();
    for (const s of ["Thời gian chờ mỗi dòng", "Nghỉ giữa hai dòng", "Giới hạn video mỗi ngày", "Địa chỉ trang Muse", "Thư mục Drive gốc", "Mẫu yêu cầu gửi Muse", 'action="/bot/open"']) {
      expect(page).toContain(s);
    }
    const post = (body: Record<string, string>) => app.request("/settings/run", { method: "POST", body: new URLSearchParams(body) });

    const bad = await post({ ...ok, pauseMaxSec: "5" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Nghỉ nhiều nhất phải lớn hơn hoặc bằng nghỉ ít nhất.");
    expect(getSettings(db).pauseMaxSec).toBe(60);

    const res = await post({ timeoutMinutes: "30", pauseMinSec: "10", pauseMaxSec: "40", dailyVideoLimit: "8", museUrl: "https://muse.ai/" });
    expect(res.status).toBe(303);
    expect(getSettings(db)).toMatchObject({ timeoutMinutes: 30, pauseMinSec: 10, pauseMaxSec: 40, dailyVideoLimit: 8, museUrl: "https://muse.ai/" });
    expect(await (await app.request("/settings?saved=run")).text()).toContain("rủi ro tài");
  });
});

describe("check-secrets (§12.11)", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\\n" + "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC".repeat(10) + "\\n-----END PRIVATE KEY-----\\n";

  it("nhận ra khoá PEM, token Google, cookie Meta; bỏ qua khoá giả ngắn trong test", () => {
    expect(findSecrets(`{"private_key": "${pem}"}`)).toHaveLength(1);
    expect(findSecrets("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----")).toEqual([]);
    // Ghép chuỗi lúc chạy để chính file test này không bị check-secrets báo.
    const j = (...p: string[]) => p.join("");
    expect(findSecrets(j("x\nAuthorization: Bearer ya", "29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxx"))).toEqual([{ pattern: "token truy cập Google", line: 2 }]);
    expect(findSecrets(j("cookie: c_", "user=100012345678; x", "s=12%3Aabcdefghij"))).toHaveLength(1);
    expect(findSecrets(j('[{"name":"da', 'tr","value":"x"}]'))).toHaveLength(1);
    expect(findSecrets("Cần đăng nhập lại Muse")).toEqual([]);
  });

  it("so nguyên văn với khoá thật trong biến môi trường; quét thư mục dữ liệu, bỏ qua hồ sơ bot", () => {
    const body = "AbCdEfGhIj".repeat(20);
    const env = {
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, private_key_id: "0123456789abcdef0123" }),
    };
    expect(secretsFromEnv(env)).toHaveLength(2);
    expect(secretsFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: "op://vault/item/field" })).toEqual([]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "masys-secrets-"));
    try {
      fs.writeFileSync(path.join(dir, "data.db"), "SQLite format 3\0 Đang chạy Xong");
      fs.mkdirSync(path.join(dir, "bot-profile"));
      fs.writeFileSync(path.join(dir, "bot-profile", "Cookies"), ["c_", "user=100012345678"].join(""));
      const clean = run({ root: dir, env: { ...env, MASYS_DATA_DIR: dir }, repo: false });
      expect(clean.findings).toEqual([]);
      expect(clean.comparedRealKey).toBe(true);

      fs.writeFileSync(path.join(dir, "app.log"), `{"msg":"x","key":"${body.slice(60, 140)}"}`);
      const dirty = run({ root: dir, env: { ...env, MASYS_DATA_DIR: dir }, repo: false });
      expect(dirty.findings).toMatchObject([{ group: "dữ liệu", pattern: "khoá service account thật" }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repo hiện tại sạch", () => {
    const root = path.resolve(import.meta.dirname, "..");
    expect(run({ root, env: { MASYS_DATA_DIR: path.join(root, "no-such-dir") } }).findings).toEqual([]);
  });
});
