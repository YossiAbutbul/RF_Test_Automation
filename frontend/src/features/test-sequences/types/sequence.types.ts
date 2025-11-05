// frontend/src/features/test-sequences/types/sequence.types.ts

export type Protocol = "LoRa" | "LTE" | "BLE";

export interface TestItem {
  id: number;
  type: string; // e.g., "Tx Power", "Frequency Accuracy"
  name: string; // editable display name
  minimized?: boolean;

  // Free-form inputs from the card
  frequencyText?: string; // user-entered freq
  powerText?: string; // for LoRa/LTE
  powerBle?: string; // for BLE
  minValue?: number;
  maxValue?: number;
  ppmLimit?: number;
  
  // OBW specific (BLE)
  obwDataLength?: string;
  obwPayloadPattern?: string;
  obwPhyType?: string;
}

export interface PersistedSeq {
  tab: Protocol;
  sequences: Record<Protocol, TestItem[]>;
  nextId: number;
}

export interface DragState {
  draggingCardId: number | null;
  dragOverCardId: number | null;
  dragOverEdge: "above" | "below" | null;
  draggingLibTest: string | null;
  fileDragActive: boolean;
}

export interface RunModalDefaults {
  testName: string;
  type: string;
  mode: "txPower" | "freqAccuracy" | "obw";
  freqHz: number;
  powerDbm?: number;
  powerBle?: string;
  minValue?: number | null;
  maxValue?: number | null;
  ppmLimit?: number;
  defaultMac?: string | null;
  obwDataLength?: string;
  obwPayloadPattern?: string;
  obwPhyType?: string;
}