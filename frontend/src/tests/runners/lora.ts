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

export type LoRaObwParams = {
  mac: string;
  freqHz: number;    // Center frequency in Hz
  powerDbm: number;  // Transmit power in dBm
  bandwidth: number; // LoRa BW index (0–2)
  datarate: number;  // LoRa DR index (0–13)
  duration?: number | null;
};

export function runLoRaObw(p: LoRaObwParams, h: SSEHandlers): EventSource {
  const body: Record<string, any> = {
    mac: p.mac,
    freq_hz: p.freqHz,
    power_dbm: p.powerDbm,
    bandwidth: p.bandwidth,
    datarate: p.datarate,
  };
  if (p.duration != null) body.duration = p.duration;
  return openTestStream("/tests/obw/stream", body, h);
}