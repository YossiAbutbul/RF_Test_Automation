// frontend/src/tests/runners/ble.ts
// Helpers to open Server-Sent Events (SSE) streams for BLE tests.

export type SseHandlers = {
  onStart?: (e: any) => void;
  onStep?: (e: any) => void;
  onLog?: (e: any) => void;
  onResult?: (e: any) => void;
  onError?: (e: any) => void;
  onDone?: (e: any) => void;
};

function qs(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  return q.toString();
}

function wireEvents(es: EventSource, h: SseHandlers) {
  es.addEventListener("start", (ev: MessageEvent) => {
    try { h.onStart?.(JSON.parse(ev.data)); } catch {}
  });
  es.addEventListener("step", (ev: MessageEvent) => {
    try { h.onStep?.(JSON.parse(ev.data)); } catch {}
  });
  es.addEventListener("log", (ev: MessageEvent) => {
    try { h.onLog?.(JSON.parse(ev.data)); } catch {}
  });
  es.addEventListener("result", (ev: MessageEvent) => {
    try { h.onResult?.(JSON.parse(ev.data)); } catch {}
  });
  es.addEventListener("error", (ev: MessageEvent) => {
    // If server sends a structured error event
    try {
      const data = (ev as any).data ? JSON.parse((ev as any).data) : { error: "stream error" };
      h.onError?.(data);
    } catch {
      h.onError?.({ error: "stream error" });
    }
  });
  es.addEventListener("done", (ev: MessageEvent) => {
    try { h.onDone?.(JSON.parse(ev.data)); } catch {}
  });
}

/**
 * Start BLE Tx Power streaming test.
 * Backend endpoint:
 *   GET /tests/ble/tx-power/stream?mac&power_param_hex&channel&min_value&max_value
 */
export function runBLETxPower(
  params: {
    mac: string;
    powerParamHex: string | number;
    channel: number;             // 0..39
    minValue?: number;
    maxValue?: number;
  },
  handlers: SseHandlers
): EventSource {
  const url = `/tests/ble/tx-power/stream?` + qs({
    mac: params.mac,
    power_param_hex: params.powerParamHex, // backend expects snake_case name
    channel: params.channel,
    min_value: params.minValue,
    max_value: params.maxValue,
  });
  const es = new EventSource(url);
  wireEvents(es, handlers);
  return es;
}

/**
 * Start BLE Frequency Accuracy streaming test (3 zooms, no explicit CW stop).
 * Backend endpoint:
 *   GET /tests/ble/frequency-accuracy/stream?mac&channel&ppm_limit
 */
export function runBLEFreqAccuracy(
  params: {
    mac: string;
    channel: number;         // 0..39
    ppmLimit?: number;
  },
  handlers: SseHandlers
): EventSource {
  const url = `/tests/ble/frequency-accuracy/stream?` + qs({
    mac: params.mac,
    channel: params.channel,
    ppm_limit: params.ppmLimit,
  });
  const es = new EventSource(url);
  wireEvents(es, handlers);
  return es;
}

// Convenience namespace export so consumers can import { BLE } from "@/tests/runners"
export const BLE = {
  runBLETxPower,
  runBLEFreqAccuracy,
};

export default BLE;
