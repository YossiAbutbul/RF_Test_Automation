// src/api/analyzer.ts
// Dev note: backend router has prefix="/analyzer" (no extra prefix in main.py)

async function httpGet(path: string): Promise<Response> {
  const res = await fetch(path, { method: "GET", cache: "no-store" });
  if (res.status === 204) throw new Error("not-connected");
  if (!res.ok) throw new Error(`server-error:${res.status}`);
  return res;
}

async function httpPost(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) throw new Error("not-connected");
  if (!res.ok) throw new Error(`server-error:${res.status}`);
  return res;
}

export async function connectAnalyzer(ip: string, port: number) {
  const r = await httpPost("/analyzer/connect", { ip, port });
  return r.json();
}

export async function disconnectAnalyzer() {
  const r = await httpPost("/analyzer/disconnect");
  return r.json();
}

// Configure sweep by calling individual endpoints your backend exposes
export async function configureSweep(p: {
  centerHz: number;
  spanHz: number;
  rbwHz: number;
  vbwHz: number;
  refDbm: number;
}) {
  // Order can matter on some instruments: center/span first, then RBW/VBW, then ref level.
  await httpPost("/analyzer/set-center-frequency", { value: p.centerHz, units: "HZ" });
  await httpPost("/analyzer/set-span",             { value: p.spanHz,   units: "HZ" });
  await httpPost("/analyzer/set-rbw",              { value: p.rbwHz,    units: "HZ" });
  await httpPost("/analyzer/set-vbw",              { value: p.vbwHz,    units: "HZ" });
  await httpPost("/analyzer/set-ref-level",        { dbm: p.refDbm });
}

export async function getRawDataCsv(): Promise<string> {
  const res = await httpGet("/analyzer/get-raw-data");
  // Text endpoint (CSV)
  const text = (await res.text()).trim();
  if (!text) throw new Error("not-connected"); // in case server returns empty body
  return text;
}
