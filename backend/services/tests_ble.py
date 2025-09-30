from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, Any

from services.tests_common import (
    evt,
    num,
    ensure_analyzer_async,
    spec_call,
    dut_call,
    managed_ble,
    apply_analyzer_setup,
    get_global_analyzer_ref_offset_db,
    background_tidy_spectrum,
    CLOSE_SPEC_TIMEOUT,
)
from services.test_config import (
    get_test_config,
    get_marker_name,
    get_default_delay_s,
)


# ========= Public API (non-stream wrapper, like LoRa) =========

async def run_tx_power(
    *,
    freq_hz: int,
    power_dbm: int,
    mac: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Non-stream helper that runs BLE Tx Power and returns {"ok": True, "measuredDbm": ..., "pass": ...}.
    Mirrors the structure used in tests_lora.py.
    """
    result: Dict[str, Any] | None = None
    async for e in run_tx_power_stream(
        freq_hz=freq_hz,
        power_dbm=power_dbm,
        mac=mac,
        min_value=min_value,
        max_value=max_value,
    ):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_tx_power_stream")
    return {"ok": True, "measuredDbm": result.get("measuredDbm"), "pass": result.get("pass_")}


# ========= Streaming SSE-friendly generator (matches LoRa step keys) =========

async def run_tx_power_stream(
    *,
    freq_hz: int,
    power_dbm: int,
    mac: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """
    BLE Tx Power test flow (step keys identical to LoRa):
      connectAnalyzer → configureAnalyzer → connectDut → cwOn → measure → cwOff → done

    Steps:
      1) Ensure spectrum analyzer and configure from YAML defaults (tests.ble_defaults.analyzer_setup).
      2) Connect DUT (BLE).
      3) Set BLE Tx Power (HWTP_SI_BLE_TX_POWER_SET) using dBm→const mapping.
      4) Save & Reset (placeholder – no-ops until you provide method names).
      5) Reconnect DUT.
      6) Start BLE Test Tone (HWTP_EX_BLE_TEST_TONE_START) using tests.ble_tx_power {channel_map,duration_s,offset_hz}.
      7) Measure peak on spectrum.
      8) Report result; cwOff is UI-only (DLL handles tone/CW).
    """
    def step(key: str, status: str = "start", **extra):  # tiny helper for consistency
        return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay  = get_default_delay_s()
    ref_off = get_global_analyzer_ref_offset_db()

    # ------- YAML defaults -------
    # analyzer setup: tests.ble_defaults.analyzer_setup
    # tone settings:  tests.ble_tx_power.{channel_map, duration_s, offset_hz}
    ble_defaults = get_test_config("ble_defaults") or {}
    ble_tx_cfg   = get_test_config("ble_tx_power") or {}

    setup = (ble_defaults.get("analyzer_setup") or {}) if isinstance(ble_defaults, dict) else {}
    settle_after_power = float(ble_defaults.get("settle_after_power_set_s", 0.30)) if isinstance(ble_defaults, dict) else 0.30

    tone_duration_s = float(ble_tx_cfg.get("duration_s", 5.0)) if isinstance(ble_tx_cfg, dict) else 5.0
    tone_offset_hz  = int(ble_tx_cfg.get("offset_hz", 0)) if isinstance(ble_tx_cfg, dict) else 0

    # Choose a channel: prefer 37 if present, else the first key in channel_map
    channel_map = {}
    if isinstance(ble_tx_cfg, dict):
        cm = ble_tx_cfg.get("channel_map")
        if isinstance(cm, dict):
            # enforce int keys
            channel_map = {int(k): int(v) for k, v in cm.items()}
    channel = 37 if 37 in channel_map else (next(iter(channel_map.keys())) if channel_map else 37)

    # Optional limits from YAML if UI didn’t supply
    if min_value is None:
        try: min_value = float((ble_tx_cfg.get("limits") or {}).get("min_dbm"))
        except Exception: pass
    if max_value is None:
        try: max_value = float((ble_tx_cfg.get("limits") or {}).get("max_dbm"))
        except Exception: pass

    spec = None
    try:
        # Announce
        yield evt("start", test="tx-power", params={
            "protocol": "BLE",
            "mac": mac,
            "freq_hz": int(freq_hz),
            "power_dbm": float(power_dbm),
            "channel": int(channel),
            "duration_s": tone_duration_s,
            "offset_hz": tone_offset_hz,
        })

        # 1) Analyzer connect
        yield step("connectAnalyzer", "start", message="Ensure analyzer is connected")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        # 2) Analyzer setup
        yield step("configureAnalyzer", "start",
                   message=f"Center={freq_hz} Hz, applying RBW/VBW/ref from YAML")
        eff = await apply_analyzer_setup(
            spec=spec,
            center_hz=int(freq_hz),
            setup=setup,
            analyzer_ref_offset_db=ref_off,
        )
        yield step("configureAnalyzer", "done",
                   message=f"Analyzer configured (span={eff.get('span_hz')} Hz, rbw={eff.get('rbw_hz')} Hz, "
                           f"vbw={eff.get('vbw_hz')} Hz, ref={eff.get('ref_level_dbm')})")
        await asyncio.sleep(delay)

        # 3) First BLE connect
        yield step("connectDut", "start", message=f"Connect BLE {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done", message="BLE connected")

            # 4) Set BLE Tx Power (HWTP_SI_BLE_TX_POWER_SET)
            yield step("cwOn", "start", message=f"Set BLE Tx Power → {power_dbm} dBm")
            tx_power_const = _dbm_to_vendor_const(power_dbm)
            await dut_call(dut, "ble_tx_power_set", tx_power_const)
            await asyncio.sleep(settle_after_power)

            # 5) Save & Reset — placeholder (fill in when commands known)
            try:
                # Example (uncomment & rename when you have the real methods):
                # await dut_call(dut, "ble_save_settings")
                # await dut_call(dut, "ble_reset")
                await asyncio.sleep(1.0)  # simulate reboot pause
            except Exception as e:
                # Not fatal; we'll attempt reconnect regardless
                yield evt("log", message=f"Save/Reset skipped/failed: {e}")

        # 6) Reconnect after reset
        yield step("connectDut", "start", message=f"Reconnect BLE {mac}")
        async with managed_ble(mac) as dut2:
            yield step("connectDut", "done", message="BLE reconnected")

            # 7) Start BLE Test Tone (HWTP_EX_BLE_TEST_TONE_START)
            yield evt("log", message=f"Start BLE test tone: ch={channel}, dur={tone_duration_s:.2f}s, "
                                     f"offset={tone_offset_hz} Hz")
            await dut_call(
                dut2,
                "ble_test_tone_start",
                channel=int(channel),
                duration_ms=int(tone_duration_s * 1000.0),
                offset_hz=int(tone_offset_hz),
            )
            # DLL typically drops the BLE link for CW — report cwOn as done for the UI
            yield step("cwOn", "done")

            # 8) Measure on spectrum
            yield step("measure", "start", message="Peak search & read marker power")
            await spec_call(spec.peak_search, get_marker_name()); await asyncio.sleep(delay)

            # Prefer explicit "get_marker_power" and parse
            pow_str = await spec_call(spec.get_marker_power, get_marker_name())
            measured = float(num(pow_str))

            yield step("measure", "done", measuredDbm=measured)
            yield evt("log", message=f"Measured: {measured:.2f} dBm")

            # PASS/FAIL evaluation (optional)
            if min_value is None and max_value is None:
                passed = None
            else:
                lo_ok = True if min_value is None else (measured >= float(min_value))
                hi_ok = True if max_value is None else (measured <= float(max_value))
                passed = lo_ok and hi_ok

            # cwOff — DLL controls the tone; nothing to send (UI polish only)
            yield step("cwOff", "start", message="CW handled by DUT/DLL (no explicit OFF)")
            yield step("cwOff", "done")

            yield evt("result", measuredDbm=measured, pass_=passed)

    except asyncio.CancelledError:
        # Match LoRa fast-abort tidy behavior
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            try:
                asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
            except Exception:
                pass
        raise
    except Exception as e:
        # Mark error and bubble details to UI log
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)


# ========= Helpers =========

def _dbm_to_vendor_const(power_dbm: float | int) -> int:
    """
    Map user dBm to vendor-specific constant expected by HWTP_BleTxPower_t(TxPowerConst=...).
    Current convention: multiply by 100 (e.g., 23.0 dBm → 2300).
    Adjust here if your DLL expects a different mapping.
    """
    return int(round(float(power_dbm) * 100.0))
