import type { Child } from "hono/jsx";
import type { DailyQuota } from "../db/quota.js";

export function Alert(props: { kind: "warn" | "ok"; children: Child }) {
  return (
    <div class={`card ${props.kind}`} role={props.kind === "warn" ? "alert" : "status"}>
      {props.children}
    </div>
  );
}

export function QuotaBox(props: { quota: DailyQuota }) {
  const q = props.quota;
  return (
    <div class="card quota">
      Hôm nay: <strong>{q.used}/{q.limit} video</strong>
      <span class="muted"> · còn {q.remaining} lượt (giới hạn mỗi ngày, D13)</span>
    </div>
  );
}

export function Hidden(props: { name: string; value: string | number }) {
  return <input type="hidden" name={props.name} value={String(props.value)} />;
}

export function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export const scanUrl = (id: string, tab: string, extra = "") =>
  `/scan?id=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}${extra}`;
