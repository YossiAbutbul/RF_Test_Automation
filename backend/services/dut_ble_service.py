# backend/services/dut_ble_service.py
from __future__ import annotations

import re
import threading
import time

from pythonnet import load
import clr_init  

# Set after runtime load
BLE_Device = None   # type: ignore
cmd = None          # type: ignore
struct = None       # type: ignore
enums = None        # type: ignore

_ble_loaded = False
_ble_lock = threading.Lock()


def _ensure_ble_runtime_loaded() -> None:
    """Initialize the .NET runtime."""
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
      - hex string with or without separators: 'D5A9F012CC39', 'D5:A9:F0:12:CC:39', '0xD5A9F012CC39'
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
    Unified DUT BLE helper.

    LoRa flow (unchanged):
      connect() → lora_cw_on(freq,power_dBm) → (measure) → lora_cw_off() → disconnect()

    LTE flow (per your spec):
      connect()
      → lte_modem_on()
      → lte_abort_test()              # abort between commands
      → lte_cw_on(earfcn, power_dBm)  # power scaled to *100 internally (23 → 2300)
      → (measure / analyzer ops)
      → lte_abort_test()              # abort between commands
      → lte_modem_off()
      → disconnect()
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
        # Brief pacing to emulate your working flow
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

    # ---------------- LTE ----------------
    def lte_modem_on(self) -> None:
        """HWTP step 1: cat_m_modem_on"""
        if not self._connected:
            self.connect()
        self.device.hwtp_get(cmd.HWTP_AT_MODEM_ON, timeout=10000)  # type: ignore
        time.sleep(0.2)

    def lte_cw_on(self, earfcn: int, power_dbm: int) -> None:
        """HWTP step 2: cat_m_cw_on (23 dBm → 2300)"""
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
        """HWTP step 4: cat_m_abort_test (also used 'between commands' as required)"""
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
        """HWTP step 5: cat_m_modem_off"""
        try:
            self.device.hwtp_get(cmd.HWTP_AT_MODEM_OFF)  # type: ignore
        finally:
            time.sleep(0.1)
