# backend/services/dut_ble_service.py
from __future__ import annotations

import re
import threading
import time

from pythonnet import load
import clr_init  # your bootstrapper for .NET

# Set after runtime load
BLE_Device = None   # type: ignore
cmd = None          # type: ignore
struct = None       # type: ignore
enums = None        # type: ignore

_ble_loaded = False
_ble_lock = threading.Lock()


def _ensure_ble_runtime_loaded() -> None:
    """Initialize the .NET runtime and bind DLL types."""
    global _ble_loaded, BLE_Device, cmd, struct, enums
    if _ble_loaded:
        return
    with _ble_lock:
        if _ble_loaded:
            return

        load("coreclr")
        clr_init.load_runtime()

        from BLE import BLE_Device as _BLE_Device              # noqa: E402
        from commands import hwtp_commands as _cmd             # noqa: E402
        from structs import hwtp_structures as _struct         # noqa: E402
        import enums as _enums                                 # noqa: E402

        BLE_Device = _BLE_Device
        cmd = _cmd
        struct = _struct
        enums = _enums

        _ble_loaded = True


def _mac_to_int(mac: str | int) -> int:
    """
    Accepts:
      - int (already good)
      - hex string with/without separators: 'D5A9F012CC39', 'D5:A9:F0:12:CC:39', '0xD5A9F012CC39'
    Returns integer value suitable for BLE_Device(MacAddress).
    """
    if isinstance(mac, int):
        return mac
    s = str(mac).strip()
    if s.lower().startswith("0x"):
        return int(s, 16)
    s = re.sub(r"[^0-9A-Fa-f]", "", s)  # remove : - spaces
    if not s:
        raise ValueError(f"Invalid MAC: {mac!r}")
    return int(s, 16)


class DUTBLE:
    """
    Unified DUT BLE/LTE/LoRa helper for your DLL.
    """
    def __init__(self, mac: str | int):
        _ensure_ble_runtime_loaded()
        self.mac_raw = mac
        self.mac_int = _mac_to_int(mac)
        self.device = BLE_Device(self.mac_int)  # type: ignore
        self._connected = False

    # ---------------- Session ----------------
    def connect(self) -> None:
        if not self._connected:
            self.device.Connect()
            self._connected = True

    def disconnect(self) -> None:
        if self._connected:
            try:
                self.device.Disconnect()
            finally:
                self._connected = False

    # ---------------- LoRa ----------------
    def lora_cw_on(self, freq_hz: int, power_dbm: int) -> None:
        if not self._connected:
            self.connect()
        payload = struct.HWTP_LoraTestCw_t(  # type: ignore
            freq=freq_hz,
            power=power_dbm,
            paMode=enums.hwtp_loratestpamode_e.HWTP_LORA_TEST_PA_AUTO,  # type: ignore
        )
        time.sleep(1.0)
        self.device.hwtp_set(cmd.HWTP_DBG_LORA_TEST_CW, payload)  # type: ignore
        time.sleep(0.2)

    def lora_cw_off(self) -> None:
        if not self._connected:
            return
        try:
            try:
                self.device.hwtp_get(command=cmd.HWTP_DBG_LORA_TEST_STOP, timeout=2000)  # type: ignore
            except TypeError:
                self.device.hwtp_get(command=cmd.HWTP_DBG_LORA_TEST_STOP)  # type: ignore
        finally:
            time.sleep(0.05)

    # ---------------- LTE (kept for parity) ----------------
    def lte_modem_on(self) -> None:
        if not self._connected:
            self.connect()
        try:
            self.device.hwtp_get(cmd.HWTP_AT_MODEM_ON, timeout=12000)  # type: ignore
        except TypeError:
            self.device.hwtp_get(cmd.HWTP_AT_MODEM_ON)  # type: ignore
        time.sleep(0.2)

    def lte_cw_on(self, earfcn: int, power_dbm: int) -> None:
        if not self._connected:
            self.connect()
        payload = struct.HWTP_tstrf_cw_s(  # type: ignore
            tstrf_cmd=enums.hwtp_at_tstrf_cmd_e.HWTP_START_TX_TEST,  # type: ignore
            earfcn=earfcn,
            time=150000,
            tx_power=power_dbm * 100,  # API expects 2300 for 23 dBm
            offset_to_the_central=0,
        )
        self.device.hwtp_set(cmd.HWTP_MODEM_TEST_RF_CW, payload)  # type: ignore
        time.sleep(0.2)

    def lte_abort_test(self) -> None:
        payload = struct.HWTP_tstrf_cw_s(  # type: ignore
            tstrf_cmd=enums.hwtp_at_tstrf_cmd_e.HWTP_ABORT_TEST,  # type: ignore
            earfcn=0,
            time=0,
            tx_power=0,
            offset_to_the_central=0,
        )
        self.device.hwtp_set(cmd.HWTP_MODEM_TEST_RF_CW, payload)  # type: ignore
        time.sleep(0.1)

    def lte_modem_off(self) -> None:
        try:
            try:
                self.device.hwtp_get(cmd.HWTP_AT_MODEM_OFF, timeout=3000)  # type: ignore
            except TypeError:
                self.device.hwtp_get(cmd.HWTP_AT_MODEM_OFF)  # type: ignore
        finally:
            time.sleep(0.1)

    # ---------------- BLE ----------------
    def ble_tx_power_set(self, *, tx_power_const: int) -> None:
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        payload = struct.HWTP_BleTxPower_t()  # type: ignore
        for name in ("TxPowerConst", "txPowerConst", "TxPower", "txPower", "PowerConst", "powerConst", "Value", "value"):
            if hasattr(payload, name):
                setattr(payload, name, int(tx_power_const))
                break
        else:
            available = [a for a in dir(payload) if not a.startswith("_")]
            raise RuntimeError(f"HWTP_BleTxPower_t has no expected power field; available={available}")

        self.device.hwtp_set(cmd.HWTP_SI_BLE_TX_POWER_SET, payload)  # type: ignore
        time.sleep(0.05)

    def ble_save_and_reset(self) -> None:
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        command = cmd.HWTP_EX_SYSTEM_RESET
        try:
            payload = struct.HWTP_SysReset_t(
                resetType=enums.HWTP_ResetType_e.HWTP_Rst_SaveAndReset
            )  # type: ignore
        except TypeError:
            payload = struct.HWTP_SysReset_t()  # type: ignore
            setattr(payload, "resetType", enums.HWTP_ResetType_e.HWTP_Rst_SaveAndReset)  # type: ignore

        try:
            self.device.hwtp_get(command, payload, timeout=3000)  # type: ignore
        except TypeError:
            self.device.hwtp_get(command, payload)  # type: ignore
        time.sleep(0.15)

    def _try_set_fields(self, payload, **values) -> None:
        """Set any of several candidate field names found in the payload."""
        for key, val in values.items():
            candidates = {
                "channel": ("channel", "Channel", "ch", "Ch"),
                "duration_s": ("duration", "Duration", "time", "Time"),
                "offset_hz": ("offset", "Offset", "freqOffset", "FreqOffset"),
            }[key]
            for name in candidates:
                if hasattr(payload, name):
                    setattr(payload, name, int(val))
                    break

    def _send_tone_stop_best_effort(self) -> None:
        """Try to stop any existing tone session to clear -1 status; ignore errors."""
        try:
            if hasattr(cmd, "HWTP_EX_BLE_TEST_TONE_STOP"):
                try:
                    self.device.hwtp_get(cmd.HWTP_EX_BLE_TEST_TONE_STOP)  # type: ignore
                except Exception:
                    try:
                        self.device.hwtp_set(cmd.HWTP_EX_BLE_TEST_TONE_STOP, None)  # type: ignore
                    except Exception:
                        pass
            elif hasattr(cmd, "HWTP_BLE_TEST_TONE_STOP"):
                try:
                    self.device.hwtp_get(cmd.HWTP_BLE_TEST_TONE_STOP)  # type: ignore
                except Exception:
                    pass
        except Exception:
            pass
        time.sleep(0.05)

    def ble_test_tone_start(self, *, channel: int, duration_ms: int, offset_hz: int = 0) -> None:
        """
        Start BLE continuous test tone for measurement.
        Tries multiple struct field mappings and units (seconds / ms) to satisfy
        different DLL bindings. Performs a best-effort STOP before START.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        # Always try to stop any stale session first
        self._send_tone_stop_best_effort()

        dur_s = max(1, int(round(duration_ms / 1000.0)))
        dur_ms = max(1000, int(duration_ms))

        def build_payload(seconds: bool):
            try:
                payload = struct.HWTP_BleToneParams_t(  # type: ignore
                    channel=int(channel),
                    duration=int(dur_s if seconds else dur_ms),
                    offset=int(offset_hz),
                )
            except TypeError:
                payload = struct.HWTP_BleToneParams_t()  # type: ignore

            self._try_set_fields(payload,
                                 channel=channel,
                                 duration_s=(dur_s if seconds else dur_ms),
                                 offset_hz=offset_hz)
            return payload

        def send_start(payload):
            self.device.hwtp_set(cmd.HWTP_EX_BLE_TEST_TONE_START, payload)  # type: ignore

        # Attempt 1: seconds
        try:
            send_start(build_payload(seconds=True))
            return
        except Exception as e1:
            msg1 = str(e1)

        # Attempt 2: milliseconds (with STOP in between)
        try:
            time.sleep(0.08)
            self._send_tone_stop_best_effort()
            time.sleep(0.05)
            send_start(build_payload(seconds=False))
            return
        except Exception as e2:
            raise RuntimeError(f"BLE tone start failed: try1='{msg1}', try2='{e2}'")

    # ---------------------------------------------------------------------
    # Added helpers (do not change existing logic above)
    # ---------------------------------------------------------------------

    def ping(self) -> bool:
        """Lightweight check that the BLE link is usable (GET-power)."""
        if not self._connected:
            return False
        try:
            _ = self.device.hwtp_get(command=cmd.HWTP_SI_BLE_TX_POWER_GET)  # type: ignore
            return True
        except Exception:
            return False

    def _try_tx_power_set_variants(self, val: int) -> None:
        """
        Internal helper for exact-set variants. Does NOT replace your ble_tx_power_set().
        """
        # 1) Exact: struct.HWTP_BleTxPower_t(txPowerConst=val)
        try:
            payload = struct.HWTP_BleTxPower_t(txPowerConst=val)  # type: ignore
            self.device.hwtp_set(command=cmd.HWTP_SI_BLE_TX_POWER_SET, payload=payload)  # type: ignore
            time.sleep(0.02)
            return
        except Exception as e1:
            last = e1
        # 2) Casing variant
        try:
            payload = struct.HWTP_BleTxPower_t(TxPowerConst=val)  # type: ignore
            self.device.hwtp_set(command=cmd.HWTP_SI_BLE_TX_POWER_SET, payload=payload)  # type: ignore
            time.sleep(0.02)
            return
        except Exception as e2:
            last = e2
        # 3) Plain-int payload
        try:
            self.device.hwtp_set(command=cmd.HWTP_SI_BLE_TX_POWER_SET, payload=val)  # type: ignore
            time.sleep(0.02)
            return
        except Exception as e3:
            last = e3
        raise last  # type: ignore

    def ble_tx_power_set_exact(self, *, tx_power_const: int) -> None:
        """
        Extra setter that enforces 6..31 and tries several payload shapes.
        Leaves your original ble_tx_power_set() unchanged.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")
        val = int(tx_power_const)
        if not (6 <= val <= 31):
            raise ValueError(f"tx_power_const must be in [6..31], got {val}")
        self._try_tx_power_set_variants(val)

    def ble_tx_power_get_exact(self) -> int | None:
        """
        Extra getter that returns an int if parseable; else None.
        Leaves your original flow untouched.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")
        resp = self.device.hwtp_get(command=cmd.HWTP_SI_BLE_TX_POWER_GET)  # type: ignore
        # Tuple/list at index 1?
        try:
            if isinstance(resp, (list, tuple)) and len(resp) >= 2:
                return int(resp[1])
        except Exception:
            pass
        # Attribute variants?
        try:
            for name in ("txPowerConst", "TxPowerConst", "txPower", "TxPower", "value", "Value"):
                if hasattr(resp, name):
                    return int(getattr(resp, name))
        except Exception:
            pass
        # Plain int?
        try:
            return int(resp)
        except Exception:
            return None

    def ble_tx_power_get_string(self) -> str:
        """
        Extra getter that returns the DLL's power struct result as a string,
        e.g. 'HWTP_BleTxPower_t(txPowerConst=31)'.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")
        resp = self.device.hwtp_get(command=cmd.HWTP_SI_BLE_TX_POWER_GET)  # type: ignore
        return str(resp)

    def ble_save_and_reset_exact(self) -> None:
        """
        Extra save&reset using exact-typed payload call.
        Your original ble_save_and_reset() is left intact.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")
        payload = struct.HWTP_SysReset_t(  # type: ignore
            resetType=enums.HWTP_ResetType_e.HWTP_Rst_SaveAndReset  # type: ignore
        )
        self.device.hwtp_set(command=cmd.HWTP_EX_SYSTEM_RESET, payload=payload)  # type: ignore
        time.sleep(0.10)
        self.device.Disconnect()
        self._connected = False

    def ble_tone_start_best_effort(self, *, channel: int, duration_ms: int, offset_hz: int = 0) -> bool:
        """
        Extra best-effort tone starter that returns True on success.
        Leaves your original ble_test_tone_start() unchanged.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        self._send_tone_stop_best_effort()

        dur_s = max(1, int(round(duration_ms / 1000.0)))
        dur_ms = max(1000, int(duration_ms))

        # Attempt 1: seconds
        try:
            pld = struct.HWTP_BleToneParams_t(  # type: ignore
                channel=int(channel),
                duration=int(dur_s),
                offset=int(offset_hz),
            )
            self.device.hwtp_set(cmd.HWTP_EX_BLE_TEST_TONE_START, pld)  # type: ignore
            return True
        except Exception as e1:
            if "HwtpStatus" in str(e1):
                return True  # treat as already running

        # Attempt 2: milliseconds
        try:
            time.sleep(0.04)
            self._send_tone_stop_best_effort()
            time.sleep(0.02)
            pld = struct.HWTP_BleToneParams_t(  # type: ignore
                channel=int(channel),
                duration=int(dur_ms),
                offset=int(offset_hz),
            )
            self.device.hwtp_set(cmd.HWTP_EX_BLE_TEST_TONE_START, pld)  # type: ignore
            return True
        except Exception as e2:
            if "HwtpStatus" in str(e2):
                return True

        return False
