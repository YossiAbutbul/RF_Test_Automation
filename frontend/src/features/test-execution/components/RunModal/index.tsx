// frontend/src/features/test-execution/components/RunModal/index.tsx
import LoRaRunModal from "../LoRaRunModal";
import LTERunModal from "../LTERunModal";
import BLERunModal from "../BLERunModal";
import { Protocol, TestMode } from "../../types/test-execution.types";

export type { Protocol, TestMode };

type Props = {
  open: boolean;
  onClose: () => void;
  protocol: Protocol;
  mode?: TestMode;
  testName?: string;

  // Common test parameters
  defaultFreqHz?: number;
  defaultPowerDbm?: number;
  defaultMac?: string;

  // Min/Max for power test
  minValue?: number | null;
  maxValue?: number | null;

  // Frequency accuracy ppm limit
  defaultPpmLimit?: number;

  // BLE-specific
  bleDefaultPowerParamHex?: string;
  
  // ⭐ NEW: BLE OBW parameters
  obwDataLength?: string;
  obwPayloadPattern?: string;
  obwPhyType?: string;
};

export default function RunModal(props: Props) {
  const { protocol } = props;

  if (protocol === "BLE") {
    // ⭐ UPDATED: BLE modal now includes OBW parameters
    return (
      <BLERunModal
        open={props.open}
        onClose={props.onClose}
        mode={props.mode ?? "txPower"}
        defaultMac={props.defaultMac ?? "80E1271FD8B8"}
        defaultFreqHz={props.defaultFreqHz ?? 2_402_000_000}
        defaultPowerParamHex={props.bleDefaultPowerParamHex ?? "31"}
        minValue={props.minValue ?? null}
        maxValue={props.maxValue ?? null}
        defaultPpmLimit={props.defaultPpmLimit ?? 40}
        obwDataLength={props.obwDataLength ?? "1"}
        obwPayloadPattern={props.obwPayloadPattern ?? "1"}
        obwPhyType={props.obwPhyType ?? "2"}
      />
    );
  }

  if (protocol === "LTE") {
    return (
      <LTERunModal
        open={props.open}
        onClose={props.onClose}
        mode={props.mode ?? "txPower"}
        testName={props.testName}
        defaultFreqHz={props.defaultFreqHz}
        defaultPowerDbm={props.defaultPowerDbm}
        defaultMac={props.defaultMac}
        minValue={props.minValue ?? null}
        maxValue={props.maxValue ?? null}
        defaultPpmLimit={props.defaultPpmLimit ?? 20}
      />
    );
  }

  // LoRa
  return (
    <LoRaRunModal
      open={props.open}
      onClose={props.onClose}
      mode={props.mode ?? "txPower"}
      testName={props.testName}
      defaultFreqHz={props.defaultFreqHz}
      defaultPowerDbm={props.defaultPowerDbm}
      defaultMac={props.defaultMac}
      minValue={props.minValue ?? null}
      maxValue={props.maxValue ?? null}
      defaultPpmLimit={props.defaultPpmLimit ?? 20}
    />
  );
}