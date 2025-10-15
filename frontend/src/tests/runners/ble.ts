// frontend/src/tests/runners/ble.ts
//
// Lightweight SSE client for BLE Tx Power test.
// Usage:
//   import * as BLE from "./ble";
//   const es = BLE.runBLETxPower({ mac, powerParamHex, channel, minValue, maxValue }, handlers);
//   es.close() // to abort

export type RunBLETxPowerParams = {
  mac: string;
  powerParamHex: string | number;
  channel: number;                // DLL scheme: 0..39 (0 => 2402 MHz)
  minValue?: number;
  maxValue?: number;
};

// Handlers: each is optional; only attach what you need.
export type RunHandlers = {
  onStart?: (e: any) => void;
  onStep?: (e: any) => void;
  onLog?: (e: any) => void;
  onResult?: (e: any) => void;
  onError?: (e: any) => void;
  onDone?: (e: any) => void;
};

// Resolve API prefix (works with Vite; fallback to empty which hits the dev proxy if configured)
const API_PREFIX = (import.meta as any)?.env?.VITE_API_PREFIX ?? "";

// Final endpoint (GET with querystring; must return text/event-stream)
const BLE_TX_POWER_STREAM_PATH = "/tests/ble/tx_power/stream";

// Small helper to build a query string from params object
function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    u.append(k, String(v));
  });
  return u.toString();
}

// Robust JSON parse (never throws)
function safeJSON(data: string | null): any {
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return { raw: data };
  }
}

/**
 * Open the BLE Tx Power streaming endpoint with Server-Sent Events.
 * Returns the EventSource instance (caller is responsible to .close() it on abort/close).
 */
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
    });

  // Note: EventSource ignores most init options in browsers; credentials are controlled by CORS.
  const es = new EventSource(url, { withCredentials: false } as any);

  // Convenience wrapper to guard and call handlers
  const call = (fn: ((e: any) => void) | undefined, payload: any) => {
    try {
      fn?.(payload);
    } catch {
      // swallow handler errors so SSE is not interrupted
    }
  };

  // The server should emit named events: start, step, log, result, error, done
  es.addEventListener("start", (ev) => call(handlers.onStart, safeJSON((ev as MessageEvent).data)));
  es.addEventListener("step", (ev) => call(handlers.onStep, safeJSON((ev as MessageEvent).data)));
  es.addEventListener("log", (ev) => call(handlers.onLog, safeJSON((ev as MessageEvent).data)));
  es.addEventListener("result", (ev) => call(handlers.onResult, safeJSON((ev as MessageEvent).data)));
  es.addEventListener("error", (ev) => {
    // Some servers also send "error" as a named event; also handle native error
    // In native errors, ev is Event not MessageEvent (no .data)
    const data = (ev as MessageEvent).data ? safeJSON((ev as MessageEvent).data) : { error: "stream error" };
    call(handlers.onError, data);
  });
  es.addEventListener("done", (ev) => call(handlers.onDone, safeJSON((ev as MessageEvent).data)));

  // Fallback: some backends emit data on the default "message" channel
  es.onmessage = (ev) => {
    const payload = safeJSON(ev.data);
    if (!payload || typeof payload !== "object") return;
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

  // Network-level errors (e.g., 404 before SSE handshake) show up here
  es.onerror = (_ev) => {
    call(handlers.onError, { error: "stream error" });
    // do not auto-close; let the caller decide (UI might keep log open)
  };

  return es;
}
