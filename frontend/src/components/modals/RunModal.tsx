import LoRaRunModal from "./LoRaRunModal";
import LteRunModal from "./LteRunModal";
import BleRunModal from "./BleRunModal";

export type Protocol = "LoRa" | "LTE" | "BLE";
export type TestMode = "txPower" | "freqAccuracy";

type Props = {
  open: boolean;
  onClose: () => void;

  protocol: Protocol;          // which modal to render
  mode?: TestMode;             // default "txPower"
  testName?: string;

  defaultFreqHz?: number;
  defaultPowerDbm?: number;    // LoRa/LTE only (BLE uses hex param in its own modal)
  defaultMac?: string;

  minValue?: number | null;
  maxValue?: number | null;

  defaultPpmLimit?: number;    // for freqAccuracy
};

/**
 * Thin orchestrator that renders a protocol-specific modal.
 * - LoRa/LTE: fully wired to backend (unchanged flow)
 * - BLE: UI-only (Power Parameter hex), no backend wiring yet
 */
export default function RunModal(props: Props) {
  const { protocol, ...rest } = props;

  if (protocol === "BLE") {
    return (
      <BleRunModal
        open={props.open}
        onClose={props.onClose}
        defaultMac={props.defaultMac}
        defaultFreqHz={props.defaultFreqHz ?? 2_402_000_000}
        defaultPowerParamHex={"0x1F"}
        minValue={props.minValue ?? null}
        maxValue={props.maxValue ?? null}
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

  // LoRa (default)
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
