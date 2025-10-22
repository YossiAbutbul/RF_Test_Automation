// frontend/src/api/analyzer.ts

const RAW_BASE =
  (import.meta as any)?.env?.VITE_API_BASE?.trim() || "http://127.0.0.1:8000";
const API_BASE = RAW_BASE.replace(/0\.0\.0\.0/i, "127.0.0.1").replace(/\/$/, "");

function url(path: string) {
  return `${API_BASE}${path}`;
}

// ----- timeout helper -----
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 3000 // fast default
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, {
      mode: "cors",
      ...init,
      signal: init.signal ?? ctrl.signal,
    });
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error(`timeout:${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function httpGet(path: string, timeoutMs = 3000) {
  const res = await fetchWithTimeout(url(path), { method: "GET", cache: "no-store" }, timeoutMs);
  if (res.status === 204) throw new Error("not-connected");
  if (!res.ok) throw new Error(`server-error:${res.status}`);
  return res;
}

async function httpPost(path: string, body?: unknown, timeoutMs = 3000) {
  const res = await fetchWithTimeout(
    url(path),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    },
    timeoutMs
  );
  if (res.status === 204) throw new Error("not-connected");
  if (!res.ok) throw new Error(`server-error:${res.status}`);
  return res;
}

// ----- Connectivity -----
// use a real analyzer endpoint to avoid 404s on "/"
export async function ping(): Promise<boolean> {
  try {
    // snapshot exists in your backend (GET /analyzer/snapshot). If analyzer
    // isn't connected yet, backend should still respond (or 204 which we catch).
    const r = await httpGet("/analyzer/snapshot", 2000);
    return r.ok;
  } catch {
    return false;
  }
}

// ----- Analyzer control -----
export async function connectAnalyzer(ip: string, port: number) {
  console.log("POST", url("/analyzer/connect"), { ip, port });
  const r = await httpPost("/analyzer/connect", { ip, port }, 4000);
  const j = await r.json();
  console.log("connect response:", j);
  return j;
}

export async function disconnectAnalyzer() {
  await httpPost("/analyzer/disconnect", {}, 2000);
}

// Sweep configuration (fan-out shape matches your backend routes)
type SweepParams = {
  centerHz?: number;
  spanHz?: number;
  rbwHz?: number;
  vbwHz?: number;
  refDbm?: number;
  usePeakDetector?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function configureSweep(p: SweepParams) {
  if (p.centerHz != null) await httpPost("/analyzer/set-center-frequency", { value: p.centerHz, units: "HZ" }, 2500);
  await sleep(20);
  if (p.spanHz != null) await httpPost("/analyzer/set-span", { value: p.spanHz, units: "HZ" }, 2500);
  await sleep(20);
  if (p.rbwHz != null) await httpPost("/analyzer/set-rbw", { value: p.rbwHz, units: "HZ" }, 2500);
  await sleep(20);
  if (p.vbwHz != null) await httpPost("/analyzer/set-vbw", { value: p.vbwHz, units: "HZ" }, 2500);
  await sleep(20);
  if (p.refDbm != null) await httpPost("/analyzer/set-ref-level", { dbm: p.refDbm }, 2500);
  await sleep(10);
  if (p.usePeakDetector) await httpPost("/analyzer/enable-peak-detector", {}, 2000);
}

// Polling wants to be snappy
export async function getRawDataCsv(): Promise<string> {
  const res = await httpGet("/analyzer/get-raw-data", 2000);
  const text = (await res.text()).trim();
  if (!text) throw new Error("empty");
  return text;
}

// ----- snapshot (backend provides it) -----
export type AnalyzerSnapshot = {
  centerHz?: number;
  spanHz?: number;
  rbwHz?: number;
  vbwHz?: number;
  refDbm?: number;
  identity?: string; // tolerate if backend adds this later
};

export async function getSnapshot(): Promise<AnalyzerSnapshot> {
  const r = await httpGet("/analyzer/snapshot", 6000);
  return r.json();
}
