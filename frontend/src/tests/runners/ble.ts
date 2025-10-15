export type RunBLETxPowerParams = {
  mac: string;
  powerParamHex: string | number;  // send a plain int 6..31
  channel: number;                 // 0..39 (0 => 2402 MHz)
  minValue?: number;
  maxValue?: number;
  simpleCwMode?: boolean;          // true = tone only (no set/reset/verify)
};

export type RunHandlers = {
  onStart?: (e: any) => void;
  onStep?: (e: any) => void;
  onLog?: (e: any) => void;
  onResult?: (e: any) => void;
  onError?: (e: any) => void;
  onDone?: (e: any) => void;
};

const API_PREFIX = (import.meta as any)?.env?.VITE_API_PREFIX ?? "";
const BLE_TX_POWER_STREAM_PATH = "/tests/ble/tx_power/stream";

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    u.append(k, String(v));
  });
  return u.toString();
}

function safeJSON(data: string | null): any {
  if (!data) return {};
  try { return JSON.parse(data); } catch { return { raw: data }; }
}

export function runBLETxPower(params: RunBLETxPowerParams, handlers: RunHandlers = {}): EventSource {
  const url =
    API_PREFIX +
    BLE_TX_POWER_STREAM_PATH +
    "?" +
    qs({
      mac: params.mac,
      powerParamHex: params.powerParamHex,
      channel: params.channel,
      minValue: params.minValue,
      maxValue: params.maxValue,
      simpleCwMode: params.simpleCwMode,
    });

  const es = new EventSource(url, { withCredentials: false } as any);

  const call = (fn: ((e: any) => void) | undefined, payload: any) => { try { fn?.(payload); } catch {} };

  es.addEventListener("start",  (ev) => call(handlers.onStart,  safeJSON((ev as MessageEvent).data)));
  es.addEventListener("step",   (ev) => call(handlers.onStep,   safeJSON((ev as MessageEvent).data)));
  es.addEventListener("log",    (ev) => call(handlers.onLog,    safeJSON((ev as MessageEvent).data)));
  es.addEventListener("result", (ev) => call(handlers.onResult, safeJSON((ev as MessageEvent).data)));
  es.addEventListener("error",  (ev) => {
    const data = (ev as MessageEvent).data ? safeJSON((ev as MessageEvent).data) : { error: "stream error" };
    call(handlers.onError, data);
  });
  es.addEventListener("done",   (ev) => call(handlers.onDone,   safeJSON((ev as MessageEvent).data)));

  es.onmessage = (ev) => {
    const payload = safeJSON(ev.data);
    const t = (payload.type || "").toString().toLowerCase();
    switch (t) {
      case "start":  return call(handlers.onStart, payload);
      case "step":   return call(handlers.onStep, payload);
      case "log":    return call(handlers.onLog, payload);
      case "result": return call(handlers.onResult, payload);
      case "error":  return call(handlers.onError, payload);
      case "done":   return call(handlers.onDone, payload);
    }
  };
  es.onerror = () => call(handlers.onError, { error: "stream error" });

  return es;
}
