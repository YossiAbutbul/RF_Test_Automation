import { SSEHandlers } from "./types";
import { openTestStream } from "@/api/tests";

// Accept either EARFCN or frequency; backend resolves mapping & echoes params on "start".
export type LTETxPowerParams = {
  mac: string;
  powerDbm: number;
  earfcn?: number;  // preferred if you have it
  freqHz?: number;  // ok too — backend maps to EARFCN (see tests_runner). :contentReference[oaicite:4]{index=4}
  minValue?: number | null;
  maxValue?: number | null;
};

export function runLTETxPower(p: LTETxPowerParams, h: SSEHandlers): EventSource {
  const body: any = {
    mac: p.mac,
    power_dbm: p.powerDbm,
    min_value: p.minValue ?? null,
    max_value: p.maxValue ?? null,
  };
  if (typeof p.earfcn === "number") body.earfcn = p.earfcn;
  else if (typeof p.freqHz === "number") body.freq_hz = p.freqHz;

  // Keep your existing LTE path shape from RunModal
  return openTestStream("/tests/lte-tx-power/stream", body, h); // :contentReference[oaicite:5]{index=5}
}

export type LTEFreqAccParams = {
  mac: string;
  powerDbm: number;
  earfcn?: number;
  freqHz?: number;
  ppmLimit?: number | null;
};

export function runLTEFrequencyAccuracy(p: LTEFreqAccParams, h: SSEHandlers): EventSource {
  const body: any = {
    mac: p.mac,
    power_dbm: p.powerDbm,
    ppm_limit: p.ppmLimit ?? null,
  };
  if (typeof p.earfcn === "number") body.earfcn = p.earfcn;
  else if (typeof p.freqHz === "number") body.freq_hz = p.freqHz;

  return openTestStream("/tests/lte-frequency-accuracy/stream", body, h); // :contentReference[oaicite:6]{index=6}
}
