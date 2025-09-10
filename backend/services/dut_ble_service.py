# backend/services/dut_ble_service.py
from __future__ import annotations

import re
import threading
import time

from pythonnet import load
import clr_init  # vendor-supplied bootstrap (same as your working main_test.py)

# Set after runtime load
BLE_Device = None   # type: ignore
cmd = None          # type: ignore
struct = None       # type: ignore
enums = None        # type: ignore

_ble_loaded = False
_ble_lock = threading.Lock()


def _ensure_ble_runtime_loaded() -> None:
    """Initialize the .NET runtime exactly like your working script."""
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
      - hex string with or without separators: '80E1271FD8DD', 'D5:A9:F0:12:CC:39', '0x80E1271FD8DD'
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
    Flow:
      connect() → lora_cw_on(freq,power) → (measure) → cw_off() → disconnect()
    """
    def __init__(self, mac: str | int):
        _ensure_ble_runtime_loaded()
        self.mac_raw = mac
        self.mac_int = _mac_to_int(mac)
        self.device = BLE_Device(self.mac_int)  # type: ignore
        self._connected = False

    def connect(self) -> None:
        if not self._connected:
            self.device.Connect()
            self._connected = True

    def lora_cw_on(self, freq_hz: int, power_dbm: int) -> None:
        if not self._connected:
            self.connect()
        payload = struct.HWTP_LoraTestCw_t(  # type: ignore
            freq=freq_hz,
            power=power_dbm,
            paMode=enums.hwtp_loratestpamode_e.HWTP_LORA_TEST_PA_AUTO,  # type: ignore
        )
        # small pacing like your working script
        time.sleep(1.0)
        self.device.hwtp_set(cmd.HWTP_DBG_LORA_TEST_CW, payload)  # type: ignore
        time.sleep(0.2)

    def lora_cw_off(self) -> None:
        if not self._connected:
            return
        try:
            self.device.hwtp_get(command=cmd.HWTP_DBG_LORA_TEST_STOP)  # type: ignore
        finally:
            time.sleep(0.05)

    def disconnect(self) -> None:
        if self._connected:
            try:
                self.device.Disconnect()
            finally:
                self._connected = False
