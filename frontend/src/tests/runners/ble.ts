// frontend/src/tests/runners/ble.ts
// SSE helpers for BLE tests: Tx Power + Frequency Accuracy

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
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    q.set(k, String(v));
  });
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
    // Server sends a JSON payload on our custom 'error' event
    try { h.onError?.(JSON.parse((ev as any).data)); } catch { h.onError?.({ error: "stream error" }); }
  });
  es.addEventListener("done", (ev: MessageEvent) => {
    try { h.onDone?.(JSON.parse(ev.data)); } catch {}
  });
}

//
// ---- Tx Power ----
//   GET /tests/ble/tx-power/stream?mac&power_param_hex&channel&min_value&max_value
//
export function runBLETxPower(
  params: {
    mac: string;
    powerParamHex: string;
    channel: number;
    minValue?: number;
    maxValue?: number;
  },
  handlers: SseHandlers
): EventSource {
  const url = `/tests/ble/tx-power/stream?` + qs({
    mac: params.mac,
    power_param_hex: params.powerParamHex, // backend uses snake_case
    channel: params.channel,
    min_value: params.minValue,
    max_value: params.maxValue,
  });
  const es = new EventSource(url);
  wireEvents(es, handlers);
  return es;
}

//
// ---- Frequency Accuracy ----
//   GET /tests/ble/frequency-accuracy/stream?mac&channel&ppm_limit
//
export function runBLEFreqAccuracy(
  params: {
    mac: string;
    channel: number;
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

// Convenience namespace export so you can: import { BLE } from "@/tests/runners";
export const BLE = {
  runBLETxPower,
  runBLEFreqAccuracy,
};

export default BLE;
