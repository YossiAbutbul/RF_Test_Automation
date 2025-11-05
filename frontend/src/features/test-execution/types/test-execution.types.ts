// frontend/src/features/test-execution/types/test-execution.types.ts

export type Protocol = "LoRa" | "LTE" | "BLE";

// ⭐ UPDATED: Added "obw" test mode
export type TestMode = "txPower" | "freqAccuracy" | "obw";

export type StepStatus = "idle" | "doing" | "done" | "error";

// Common step keys across protocols
export type BaseStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "measure"
  | "close";

// LoRa specific steps
export type LoRaStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"
  | "measure"
  | "cwOff"
  | "close";

// LTE specific steps
export type LTEStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "modemOn"
  | "cwOn"
  | "measure"
  | "cwOff"
  | "close";

// BLE Tx Power steps
export type BLETxStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"
  | "saveReset"
  | "reconnectDut"
  | "toneStart"
  | "measure"
  | "close";

// BLE Frequency Accuracy steps
export type BLEFaStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"
  | "measure"
  | "close";

// ⭐ NEW: BLE OBW steps (same as Frequency Accuracy)
export type BLEObwStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"
  | "measure"
  | "close";

// Common props for all run modals
export interface BaseRunModalProps {
  open: boolean;
  onClose: () => void;
  mode?: TestMode;
  testName?: string;
  defaultFreqHz?: number;
  defaultPowerDbm?: number;
  defaultMac?: string;
  minValue?: number | null;
  maxValue?: number | null;
  defaultPpmLimit?: number;
}

// ⭐ UPDATED: BLE-specific props now include OBW parameters
export interface BLERunModalProps extends Omit<BaseRunModalProps, 'defaultPowerDbm'> {
  defaultPowerParamHex?: string;
  
  // OBW specific parameters
  obwDataLength?: string;
  obwPayloadPattern?: string;
  obwPhyType?: string;
}

// Test results
export interface TxPowerResult {
  measuredDbm?: number;
  pass?: boolean;
}

export interface FreqAccuracyResult {
  measuredHz?: number;
  errorHz?: number;
  errorPpm?: number;
  pass?: boolean;
}

// ⭐ NEW: OBW result type (placeholder for future implementation)
export interface OBWResult {
  measuredBandwidth?: number;
  pass?: boolean;
}