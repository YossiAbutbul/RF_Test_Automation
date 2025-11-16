import LoRaRunModal from "./LoRaRunModal";
import LteRunModal from "./LteRunModal";
import BleRunModal from "./BleRunModal";

export type Protocol = "LoRa" | "LTE" | "BLE";
export type TestMode = "txPower" | "freqAccuracy" | "obw";

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

  // BLE-specific (Tx Power)
  bleDefaultPowerParamHex?: string;

  // OBW defaults (optional — each modal has sensible internal defaults)
  // LoRa
  loraObwBandwidthParam?: string;
  loraObwDataRateParam?: string;
  loraObwMaxKhz?: number;


  // LTE
  lteObwMcs?: string;       // default "5"
  lteObwNbIndex?: string;   // default "0"
  lteObwNumRbAlloc?: string;
  lteObwPosRbAlloc?: string;

  // BLE
  bleObwDataLength?: string;     // default "1"
  bleObwPayloadPattern?: string; // default "1"
  bleObwPhyType?: string;        // default "2"
};

export default function RunModal(props: Props) {
  const { protocol } = props;

  if (protocol === "BLE") {
    // BLE modal supports txPower, freqAccuracy, and obw
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
        // OBW defaults
        obwDataLength={props.bleObwDataLength}
        obwPayloadPattern={props.bleObwPayloadPattern}
        obwPhyType={props.bleObwPhyType}
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
        // OBW defaults
        obwMcs={props.lteObwMcs}
        obwNbIndex={props.lteObwNbIndex}
        obwNumRbAlloc={props.lteObwNumRbAlloc}
        obwPosRbAlloc={props.lteObwPosRbAlloc}
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
      // OBW defaults
      obwBandwidthParam={props.loraObwBandwidthParam}
      obwDataRateParam={props.loraObwDataRateParam}
      obwMaxKhz={props.loraObwMaxKhz}

    />
  );
}
