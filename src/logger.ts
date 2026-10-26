import pino from "pino";

// Spec §10: không bao giờ log key/token/cookie hay nội dung khoá service account.
// Che theo tên trường ở mọi cấp lồng nhau, và che cả chuỗi trông giống khoá PEM
// dù nằm trong trường có tên vô hại.
const SENSITIVE_KEY =
  /(key|token|cookie|secret|password|passwd|credential|authorization|session|private)/i;
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export const REDACTED = "[ĐÃ CHE]";

export function redactString(value: string): string {
  return value.replace(PEM_BLOCK, REDACTED);
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[vòng lặp]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  // formatters.log chạy trước serializer err của pino: giữ prototype Error để pino vẫn nhận ra loại lỗi.
  const out: Record<string, unknown> =
    value instanceof Error
      ? Object.assign(Object.create(Object.getPrototypeOf(value)), {
          message: redactString(value.message),
          stack: value.stack && redactString(value.stack),
        })
      : {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, seen);
  }
  return out;
}

export function createLogger(destination?: pino.DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        log: (obj) => redact(obj) as Record<string, unknown>,
      },
      hooks: {
        // Che cả phần chữ của thông điệp (đối số chuỗi).
        logMethod(args, method) {
          const [first, second] = args as unknown[];
          // log.error(err) không kèm thông điệp: pino tự lấy err.message làm msg mà không qua bộ che.
          if (first instanceof Error && typeof second !== "string") {
            return method.call(this, { err: first }, redactString(first.message));
          }
          method.apply(this, args.map((a) => (typeof a === "string" ? redactString(a) : a)) as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}

export const logger = createLogger();
