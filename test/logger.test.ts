import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED } from "../src/logger.js";

const FAKE_PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { log: createLogger(stream), output: () => lines.join("") };
}

describe("logger", () => {
  it("che các trường key/token/cookie ở mọi cấp", () => {
    const { log, output } = capture();
    log.info(
      {
        apiKey: "k-123",
        access_token: "t-456",
        cookie: "c-789",
        nested: { deeper: [{ Authorization: "Bearer xyz", refreshToken: "r-000" }] },
        rowNumber: 5,
      },
      "thử",
    );
    const out = output();
    for (const secret of ["k-123", "t-456", "c-789", "Bearer xyz", "r-000"]) expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
    expect(out).toContain('"rowNumber":5');
  });

  it("không log nội dung khoá service account dù nằm trong trường hay thông điệp", () => {
    const { log, output } = capture();
    const sa = JSON.stringify({ type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: FAKE_PEM });
    log.info({ serviceAccount: JSON.parse(sa) }, "nạp khoá");
    log.info({ raw: sa }, "chuỗi thô");
    log.warn(`lỗi: ${FAKE_PEM}`);
    log.error(new Error(`hỏng ${FAKE_PEM}`));
    const out = output();
    expect(out).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
    expect(out).not.toContain("BEGIN PRIVATE KEY");
  });
});
