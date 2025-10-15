from __future__ import annotations

import re
import threading
import time

from pythonnet import load
import clr_init  # your .NET bootstrapper

# Bound after runtime load
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
    """Accepts '80E1271FD8DD', '80:E1:27:1F:D8:DD', '0x80E1271FD8DD' or int."""
    if isinstance(mac, int):
        return mac
    s = str(mac).strip()
    if s.lower().startswith("0x"):
        return int(s, 16)
    s = re.sub(r"[^0-9A-Fa-f]", "", s)
    if not s:
        raise ValueError(f"Invalid MAC: {mac!r}")
    return int(s, 16)


class DUTBLE:
    """
    Thin helper wrapping your DLL. All BLE functions here follow your proven calls.
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

    # ---------------- BLE: TX power (EXACT per your snippet) ----------------
    def ble_tx_power_set_exact(self, *, tx_power_const: int) -> None:
        """
        Set BLE TX power with exactly:
            cmd.HWTP_SI_BLE_TX_POWER_SET
            struct.HWTP_BleTxPower_t(txPowerConst=<int 6..31>)
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        try:
            val = int(tx_power_const)
        except Exception:
            raise ValueError(f"tx_power_const must be an integer, got {tx_power_const!r}")
        if not (6 <= val <= 31):
            raise ValueError(f"tx_power_const must be in [6..31], got {val}")

        payload = struct.HWTP_BleTxPower_t(txPowerConst=val)  # type: ignore
        self.device.hwtp_set(command=cmd.HWTP_SI_BLE_TX_POWER_SET, payload=payload)  # type: ignore
        time.sleep(0.03)

    def ble_tx_power_get_exact(self) -> int | None:
        """
        Read current BLE TX power exactly with:
            cmd.HWTP_SI_BLE_TX_POWER_GET
        Returns int if parsed, else None.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        resp = self.device.hwtp_get(command=cmd.HWTP_SI_BLE_TX_POWER_GET)  # type: ignore

        # Your test showed: print(res[1]). Handle tuple/list/struct/int variants safely.
        try:
            if isinstance(resp, (list, tuple)) and len(resp) >= 2:
                return int(resp[1])
        except Exception:
            pass
        try:
            for name in ("txPowerConst", "TxPowerConst", "txPower", "TxPower", "value", "Value"):
                if hasattr(resp, name):
                    return int(getattr(resp, name))
        except Exception:
            pass
        try:
            return int(resp)
        except Exception:
            return None

    # ---------------- BLE: save & reset (EXACT per your snippet) ----------------
    def ble_save_and_reset_exact(self) -> None:
        """
        Save and reset exactly with:
            cmd.HWTP_EX_SYSTEM_RESET via hwtp_set
            struct.HWTP_SysReset_t(resetType=enums.HWTP_ResetType_e.HWTP_Rst_SaveAndReset)
        Then Disconnect() as in your working code.
        """
        if not self._connected:
            raise RuntimeError("BLE device not connected")

        payload = struct.HWTP_SysReset_t(  # type: ignore
            resetType=enums.HWTP_ResetType_e.HWTP_Rst_SaveAndReset  # type: ignore
        )
        self.device.hwtp_set(command=cmd.HWTP_EX_SYSTEM_RESET, payload=payload)  # type: ignore
        time.sleep(0.10)
        # Your sample explicitly disconnects after reset:
        self.device.Disconnect()
        self._connected = False

    # ---------------- BLE: tone (robust, EX start) ----------------
    def _send_tone_stop_best_effort(self) -> None:
        """Stop any existing tone; ignore errors."""
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
        time.sleep(0.03)

    def ble_tone_start_best_effort(self, *, channel: int, duration_ms: int, offset_hz: int = 0) -> bool:
        """
        Start BLE tone using EX start; try seconds then milliseconds.
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
            time.sleep(0.05)
            self._send_tone_stop_best_effort()
            time.sleep(0.03)
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

    # Back-compat used elsewhere
    def ble_test_tone_start(self, *, channel: int, duration_ms: int, offset_hz: int = 0) -> None:
        ok = self.ble_tone_start_best_effort(channel=channel, duration_ms=duration_ms, offset_hz=offset_hz)
        if not ok:
            raise RuntimeError("BLE tone start failed")
