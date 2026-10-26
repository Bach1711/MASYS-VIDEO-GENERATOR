import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkServiceAccount, loadConfig } from "../src/config.js";

describe("checkServiceAccount", () => {
  it("báo rõ khi thiếu biến", () => {
    const r = checkServiceAccount(undefined);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("báo rõ khi chưa chạy qua op run", () => {
    const r = checkServiceAccount("op://vault/item/credential");
    expect(!r.ok && r.problem).toContain("op run");
  });

  it("báo khi JSON hỏng, không lặp lại giá trị", () => {
    const r = checkServiceAccount("{bí-mật-hỏng");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).not.toContain("bí-mật-hỏng");
  });

  it("chỉ giữ email và hai trường cần để xác thực khi khoá hợp lệ", () => {
    const r = checkServiceAccount(
      JSON.stringify({
        type: "service_account",
        client_email: "bot@p.iam.gserviceaccount.com",
        private_key: "PK",
        private_key_id: "kid",
        project_id: "p",
      }),
    );
    expect(r).toEqual({
      ok: true,
      clientEmail: "bot@p.iam.gserviceaccount.com",
      credentials: { client_email: "bot@p.iam.gserviceaccount.com", private_key: "PK" },
    });
  });
});

describe("loadConfig", () => {
  it("đặt DB trong %LOCALAPPDATA%\\masys-video, ngoài repo", () => {
    const c = loadConfig({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" });
    expect(c.dbPath).toBe(path.join("C:\\Users\\u\\AppData\\Local", "masys-video", "data.db"));
    expect(c.port).toBe(4310);
    expect(c.serviceAccount.ok).toBe(false);
  });
});
