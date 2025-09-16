import { SSEHandlers } from "./types";
import { openTestStream } from "@/api/tests"; // same helper you already use in RunModal

export type LoRaTxPowerParams = {
  mac: string;
  freqHz: number;
  powerDbm: number;
  minValue?: number | null;
  maxValue?: number | null;
};

export function runLoRaTxPower(p: LoRaTxPowerParams, h: SSEHandlers): EventSource {
  const body = {
    mac: p.mac,
    freq_hz: p.freqHz,
    power_dbm: p.powerDbm,
    min_value: p.minValue ?? null,
    max_value: p.maxValue ?? null,
  };
  return openTestStream("/tests/tx-power/stream", body, h); 
}

export type LoRaFreqAccParams = {
  mac: string;
  freqHz: number;
  powerDbm: number;
  ppmLimit?: number | null;
};

export function runLoRaFrequencyAccuracy(p: LoRaFreqAccParams, h: SSEHandlers): EventSource {
  const body = {
    mac: p.mac,
    freq_hz: p.freqHz,
    power_dbm: p.powerDbm,
    ppm_limit: p.ppmLimit ?? null,
  };
  return openTestStream("/tests/freq-accuracy/stream", body, h); 
}
