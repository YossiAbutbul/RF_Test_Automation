import LoRaRunModal from "./LoRaRunModal";
import LteRunModal from "./LteRunModal";
import BleRunModal from "./BleRunModal";

export type Protocol = "LoRa" | "LTE" | "BLE";
export type TestMode = "txPower" | "freqAccuracy";

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
};

export default function RunModal(props: Props) {
  const { protocol } = props;

  if (protocol === "BLE") {
    // BLE modal: unified for both Tx Power and Frequency Accuracy
    return (
      <BleRunModal
        open={props.open}
        onClose={props.onClose}
        mode={props.mode ?? "txPower"}
        defaultMac={props.defaultMac ?? "80E1271FD8B8"}
        defaultFreqHz={props.defaultFreqHz ?? 2_402_000_000}
        defaultPowerParamHex={props.bleDefaultPowerParamHex ?? "31"}
        minValue={props.minValue ?? null}
        maxValue={props.maxValue ?? null}
        defaultPpmLimit={props.defaultPpmLimit ?? 40}
      />
    );
  }

  if (protocol === "LTE") {
    return (
      <LteRunModal
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
