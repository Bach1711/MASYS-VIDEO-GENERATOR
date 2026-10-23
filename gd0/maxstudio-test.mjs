#!/usr/bin/env node
// Giai đoạn 0 — script thử Max-Studio (spec §15, ticket CON-31).
// Không có thư viện ngoài; chạy qua 1Password để key không bao giờ nằm trong file:
//
//   op run --env-file=.env -- node gd0/maxstudio-test.mjs balance
//   op run --env-file=.env -- node gd0/maxstudio-test.mjs video --image gd0/samples/model-01.png
//   op run --env-file=.env -- node gd0/maxstudio-test.mjs status <taskId>
//
// Chế độ API (--mode):
//   v2 (mặc định): chỉ cần Max-Studio API key. Max-Studio dùng tài khoản Google của HỌ → trừ credit Max-Studio.
//   v1:            cần thêm FLOW_TOKEN (JWT của tài khoản Flow) → chạy trên tài khoản Flow của khách.
//
// Kết quả mỗi lần chạy được ghi thêm một dòng vào gd0/out/report.jsonl để điền spec §8.1.

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = (process.env.MAX_STUDIO_BASE_URL || 'https://max-studio.online').replace(/\/$/, '');
const WEB_URL = (process.env.MAX_STUDIO_WEB_URL || 'https://max-studio.shop').replace(/\/$/, '');
const API_KEY = process.env.MAX_STUDIO_API_KEY || '';
const FLOW_TOKEN = process.env.FLOW_TOKEN || '';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

const POLL_EVERY_MS = 12_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const DONE_OK = ['successfully', 'success', 'complete', 'completed', 'done', 'finished'];
const DONE_ERR = ['failed', 'failure', 'error', 'cancelled', 'canceled'];

const DEFAULT_PROMPT =
  'The woman looks at the camera, runs a hand through her hair, smiles and points at the print on her T-shirt. ' +
  'Keep the T-shirt print exactly unchanged: same text, same artwork, sharp and undistorted. ' +
  'Handheld vertical phone video, indoor, natural light, single continuous shot. No dialogue, no music.';

// ── Che bí mật: mọi thứ in ra màn hình hoặc ghi file đều đi qua đây (spec §10) ──
function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  for (const secret of [API_KEY, FLOW_TOKEN]) {
    if (secret && secret.length >= 8) text = text.split(secret).join(`***${secret.slice(-4)}`);
  }
  // Ảnh base64 trong body rất dài — rút gọn cho dễ đọc
  return text.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{40,}/gi, '<base64 đã rút gọn>');
}

function log(...parts) {
  console.log(...parts.map(redact));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) opts[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i];
    else opts._.push(rest[i]);
  }
  return { command, opts };
}

async function call(method, url, body) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'X-API-Key': API_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    // Không tới được máy chủ (mất mạng, DNS, timeout) — quan trọng cho điểm 7
    return { ok: false, httpStatus: 0, networkError: String(err?.cause?.code || err?.name || err), ms: Date.now() - started };
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
  return { ok: res.ok, httpStatus: res.status, json, ms: Date.now() - started };
}

async function getBalance() {
  const r = await call('GET', `${WEB_URL}/api/balance`);
  // "balance" là chuỗi hiển thị ("1,968 credits"); "balance_raw" mới là số
  return { balance: Number(r.json?.balance_raw), raw: r };
}

async function imageToDataUri(path) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(path).toLowerCase()];
  if (!mime) throw new Error(`Không nhận dạng được định dạng ảnh: ${path}`);
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

function buildCreateRequest(mode, image, opts) {
  const common = {
    prompt: opts.prompt || DEFAULT_PROMPT,
    ratio: 'PORTRAIT', // 9:16
    length: Number(opts.length || 8),
    resolution: opts.resolution || '720p',
  };
  if (mode === 'v1') {
    if (!FLOW_TOKEN) throw new Error('Chế độ v1 cần FLOW_TOKEN (item "Flow Token" trong 1Password).');
    return {
      url: `${API_URL}/api/v1/create-task/image-to-video`,
      body: { ...common, mediaId: image, model: [opts.model || 'Veo_3.1-Fast'], jwt: FLOW_TOKEN },
    };
  }
  return {
    url: `${API_URL}/api/v2/create-task/image-to-video`,
    body: { ...common, imageUrl: image, model: opts.model || 'Veo_3.1-Lite_Lower_Priority' },
  };
}

async function pollUntilDone(mode, taskId) {
  const started = Date.now();
  let polls = 0;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    polls++;
    const r = await call('GET', `${API_URL}/api/${mode}/check-status/${encodeURIComponent(taskId)}`);
    const data = r.json?.data && typeof r.json.data === 'object' && !Array.isArray(r.json.data) ? r.json.data : r.json || {};
    const status = String(data.status || data.task_status || '').toLowerCase();
    const elapsed = Math.round((Date.now() - started) / 1000);
    log(`  [${elapsed}s] lần hỏi ${polls}: HTTP ${r.httpStatus} · status=${status || '?'}${r.networkError ? ` · lỗi mạng ${r.networkError}` : ''}`);
    // Lỗi khi hỏi trạng thái: chỉ HỎI LẠI, không bao giờ gửi lại task (spec §7)
    if (DONE_OK.includes(status) || DONE_ERR.includes(status)) return { status, data, polls, waitedMs: Date.now() - started };
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
  return { status: 'timeout', data: null, polls, waitedMs: Date.now() - started };
}

function videoUrlsOf(data) {
  const items = Array.isArray(data?.result) ? data.result : [];
  return items
    .map((it) => (typeof it === 'string' ? it : it.fifeUrl || it.fife_url || it.url || it.media_url || it.video_url))
    .filter(Boolean);
}

async function download(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Tải video lỗi HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return { bytes: buf.length, contentType: res.headers.get('content-type') };
}

async function saveReport(entry) {
  await mkdir(OUT_DIR, { recursive: true });
  await appendFile(join(OUT_DIR, 'report.jsonl'), redact(JSON.stringify(entry)) + '\n');
}

async function finishTask(mode, taskId, report) {
  log(`Đang chờ kết quả (hỏi mỗi ${POLL_EVERY_MS / 1000}s, tối đa ${POLL_TIMEOUT_MS / 60000} phút)...`);
  const done = await pollUntilDone(mode, taskId);
  report.finalStatus = done.status;
  report.polls = done.polls;
  report.waitSeconds = Math.round(done.waitedMs / 1000);
  report.finalResponse = done.data;

  const urls = videoUrlsOf(done.data);
  report.videoUrls = urls;
  if (DONE_OK.includes(done.status) && urls.length) {
    const file = join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}_${mode}_${taskId}.mp4`);
    await mkdir(OUT_DIR, { recursive: true });
    const dl = await download(urls[0], file);
    report.download = { file, ...dl };
    log(`✅ Đã tải video: ${file} (${(dl.bytes / 1e6).toFixed(1)} MB, ${dl.contentType})`);
  } else {
    log(`❌ Task kết thúc với trạng thái "${done.status}". Phản hồi cuối:`, done.data);
  }

  const after = await getBalance();
  report.balanceAfter = after.balance;
  if (Number.isFinite(report.balanceBefore) && Number.isFinite(after.balance)) {
    report.creditsSpent = +(report.balanceBefore - after.balance).toFixed(2);
    log(`Số dư: ${report.balanceBefore} → ${after.balance} (tốn ${report.creditsSpent} credit)`);
  }
  await saveReport(report);
  log(`Đã ghi báo cáo vào ${join(OUT_DIR, 'report.jsonl')}`);
}

async function cmdBalance() {
  const bal = await getBalance();
  log('GET /api/balance →', `HTTP ${bal.raw.httpStatus}`, bal.raw.json ?? bal.raw.networkError);
  const quota = await call('GET', `${WEB_URL}/api/v1/quota`);
  log('GET /api/v1/quota →', `HTTP ${quota.httpStatus}`, quota.json ?? quota.networkError);
}

async function cmdVideo(opts) {
  const mode = opts.mode === 'v1' ? 'v1' : 'v2';
  const imagePath = opts.image || opts._[0];
  if (!imagePath) throw new Error('Thiếu --image <đường dẫn ảnh>');

  const before = await getBalance();
  const { url, body } = buildCreateRequest(mode, await imageToDataUri(imagePath), opts);
  const report = {
    at: new Date().toISOString(), mode, image: imagePath, model: body.model, length: body.length,
    resolution: body.resolution, prompt: body.prompt, balanceBefore: before.balance,
  };
  log(`Chế độ ${mode} · model ${JSON.stringify(body.model)} · ${body.length}s · ${body.resolution} · PORTRAIT (9:16)`);
  log(`Số dư trước khi chạy: ${before.balance}`);

  const created = await call('POST', url, body);
  report.create = { httpStatus: created.httpStatus, ms: created.ms, networkError: created.networkError, response: created.json };
  log(`POST ${url} → HTTP ${created.httpStatus} (${created.ms} ms)`, created.json ?? created.networkError);

  const taskId = created.json?.taskid || created.json?.task_id || created.json?.taskId || created.json?.data?.taskid;
  if (!taskId) {
    // Không có taskid: ghi lại nguyên văn lỗi để phân loại mã lỗi (điểm 7)
    report.finalStatus = 'create_failed';
    await saveReport(report);
    log(`❌ Không tạo được task. Đã ghi lỗi vào báo cáo. Kiểm tra số dư sau 1 phút để xem có bị trừ credit không.`);
    process.exitCode = 1;
    return;
  }
  report.taskId = taskId;
  log(`Task id: ${taskId} — nếu script bị tắt giữa chừng, chạy tiếp bằng: status ${taskId}${mode === 'v1' ? ' --mode v1' : ''}`);
  await finishTask(mode, taskId, report);
}

async function cmdStatus(opts) {
  const mode = opts.mode === 'v1' ? 'v1' : 'v2';
  const taskId = opts._[0];
  if (!taskId) throw new Error('Thiếu taskId');
  await finishTask(mode, taskId, { at: new Date().toISOString(), mode, taskId, resumed: true, balanceBefore: NaN });
}

const { command, opts } = parseArgs(process.argv.slice(2));
if (!API_KEY) {
  console.error('Thiếu MAX_STUDIO_API_KEY. Chạy qua: op run --env-file=.env -- node gd0/maxstudio-test.mjs ...');
  process.exit(1);
}
const commands = { balance: cmdBalance, video: cmdVideo, status: cmdStatus };
if (!commands[command]) {
  console.error('Lệnh: balance | video --image <ảnh> [--mode v1|v2] [--prompt ...] [--length 8] | status <taskId> [--mode v1|v2]');
  process.exit(1);
}
commands[command](opts).catch((err) => {
  console.error('Lỗi:', redact(String(err?.stack || err)));
  process.exitCode = 1;
});
