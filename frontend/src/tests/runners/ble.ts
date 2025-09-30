// === BLE: Tx Power (SSE) =====================================================

import type { AnyEvt } from "./types";

type Handlers = {
  onStart?: (e: AnyEvt) => void;
  onStep?: (e: AnyEvt) => void;
  onLog?: (e: AnyEvt) => void;
  onResult?: (e: AnyEvt) => void;
  onError?: (e: AnyEvt) => void;
  onDone?: (e: AnyEvt) => void;
};

function _bindStandardHandlers(es: EventSource, handlers: Handlers) {
  es.addEventListener("start",  (ev) => handlers.onStart?.(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("step",   (ev) => handlers.onStep?.(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("log",    (ev) => handlers.onLog?.(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("result", (ev) => handlers.onResult?.(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("error",  (ev) => handlers.onError?.(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("done",   (ev) => handlers.onDone?.(JSON.parse((ev as MessageEvent).data)));
}

export type BLETxPowerParams = {
  mac: string;
  freqHz: number;
  powerDbm: number;
  minValue?: number | null;
  maxValue?: number | null;
};

/**
 * Open an SSE stream to the backend BLE Tx Power test.
 * Backend route: GET /tests/ble/tx-power/stream
 */
export function runBLETxPower(
  { mac, freqHz, powerDbm, minValue = null, maxValue = null }: BLETxPowerParams,
  handlers: Handlers
): EventSource {
  const qs = new URLSearchParams({
    mac: mac.trim(),
    freq_hz: String(freqHz),
    power_dbm: String(powerDbm),
  });
  if (minValue != null) qs.set("min_value", String(minValue));
  if (maxValue != null) qs.set("max_value", String(maxValue));

  const es = new EventSource(`/tests/ble/tx-power/stream?${qs.toString()}`);
  _bindStandardHandlers(es, handlers);
  return es;
}
