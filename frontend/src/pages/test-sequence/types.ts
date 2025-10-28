// src/pages/test-sequence/types.ts
export type Protocol = "LoRa" | "LTE" | "BLE";

export type TestItem = {
  id: number;
  type: string;
  name: string;
  minimized?: boolean;

  frequencyText?: string;
  powerText?: string;
  powerBle?: string;
  minValue?: number;
  maxValue?: number;
  ppmLimit?: number;

  // -------- OBW (LoRa)
  bandwidthParam?: string;
  dataRateParam?: string;

  // -------- OBW (LTE)
  mcs?: string;
  nbIndex?: string;
  numRbAlloc?: string;
  posRbAlloc?: string;

  // -------- OBW (BLE)
  dataLength?: string;
  payloadPattern?: string;
  phyType?: string;
};

export type PersistedSeq = {
  tab: Protocol;
  sequences: Record<Protocol, TestItem[]>;
  nextId: number;
};
