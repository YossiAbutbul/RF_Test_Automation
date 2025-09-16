import { SSEHandlers } from "./types";

// Placeholder for future BLE tests.
export type BLECurrentParams = { mac: string };

export function runBLECurrentConsumption(_p: BLECurrentParams, h: SSEHandlers): EventSource {
  // Simulate a not-implemented stream with a quick EventSource shim
  const es = new EventSource("data:text/event-stream,");
  queueMicrotask(() => {
    h.onStart?.({ type: "start", test: "ble-current", params: {} });
    h.onError?.({ type: "error", error: "BLE tests not implemented in backend yet." });
    h.onDone?.();
    es.close();
  });
  return es;
}
