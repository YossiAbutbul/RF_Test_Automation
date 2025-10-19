from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional

from services.tests_common import (
    evt, num,
    ensure_analyzer_async, spec_call,
    apply_analyzer_setup,
    get_global_analyzer_ref_offset_db,
)
from services.test_config import (
    get_test_config,
    get_marker_name,
    get_default_delay_s,
)
from services.dut_ble_service import DUTBLE

# === helper: returns the integer contained in a string (user-provided) ===
def find_and_return_number(input_string: str) -> int:
    digits = []
    for char in input_string:
        if char.isdigit():
            digits.append(char)
    if not digits:
        raise ValueError("No digits found in the string.")
    return int("".join(digits))

# Channel map per DLL convention: 0→2402 MHz, +2 MHz per step
def _resolve_ble_channel_to_freq_hz(channel: int) -> int:
    ch = int(channel)
    if 0 <= ch <= 39:
        return 2_402_000_000 + ch * 2_000_000
    raise ValueError(f"Unsupported BLE channel (expected 0..39): {channel}")

def _parse_tx_power(v: int | str) -> int:
    try:
        val = int(v)
    except Exception as e:
        raise ValueError(f"Power parameter must be an integer in [6..31], got {v!r}") from e
    if not (6 <= val <= 31):
        raise ValueError(f"Power parameter out of range [6..31]: {val}")
    return val

async def run_ble_tx_power_stream(
    *,
    mac: str,
    power_param_hex: int | str,    # treated as plain int
    channel: int,                   # 0..39 (0=2402MHz)
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    simple_cw_mode: Optional[bool] = None,  # staged flow; may skip set/reset if power already matches
) -> AsyncGenerator[Dict, None]:
    """
    Emits ONLY 'step' events with the exact keys your modal expects:
      connectAnalyzer, configureAnalyzer, connectDut, cwOn, saveReset, reconnectDut, toneStart, measure, close
    - Reads current BLE power (string → int) with find_and_return_number().
    - If current == requested → marks cwOn/saveReset/reconnectDut as done (skipped) and proceeds to tone+measure.
    - Tone → short YAML-driven settle → peak_search → short settle → get_marker_power (while CW is ON).
    """

    # YAML config
    raw_cfg = get_test_config("ble_tx_power") or {}
    cfg = raw_cfg if isinstance(raw_cfg, dict) else {}

    a_set                 = cfg.get("analyzer_setup") or {}
    marker                = get_marker_name()

    duration_s            = float(cfg.get("duration_s", 5.0))
    offset_hz             = int(cfg.get("offset_hz", 0))

    # Settles (extended defaults; overrideable from YAML)
    after_center_s        = float(cfg.get("after_center_s", max(0.05, get_default_delay_s())))
    reset_wait_s          = float(cfg.get("reset_wait_s", 0.60))
    reconnect_attempts    = int(cfg.get("reconnect_attempts", 4))
    reconnect_backoff_s   = float(cfg.get("reconnect_backoff_s", 0.20))
    tone_settle_s         = float(cfg.get("tone_settle_s", 0.25))   # longer default so we’re inside CW
    measure_settle_s      = float(cfg.get("measure_settle_s", 0.10))

    # Inputs
    freq_hz     = _resolve_ble_channel_to_freq_hz(int(channel))
    power_const = _parse_tx_power(power_param_hex)
    tone_ms     = int(duration_s * 1000.0)

    def step(key: str, status: str, **extra) -> Dict:
        return evt("step", key=key, status=status, **extra)

    # Start
    yield evt("start", test="ble-tx-power", params={
        "mac": mac, "channel": int(channel), "freq_hz": int(freq_hz),
        "power_param": int(power_const), "duration_s": duration_s,
        "offset_hz": offset_hz, "simple_cw_mode": False,
    })

    spec = None
    dut: Optional[DUTBLE] = None
    dut2: Optional[DUTBLE] = None

    try:
        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec, center_hz=int(freq_hz), setup=a_set,
            analyzer_ref_offset_db=get_global_analyzer_ref_offset_db()
        )
        def mhz(x):
            try: return float(x)/1e6
            except Exception: return 0.0
        yield step(
            "configureAnalyzer",
            "done",
            message=(
                f"Analyzer center={mhz(eff.get('center_hz')):.3f} MHz "
                f"span={mhz(eff.get('span_hz')):.3f} MHz "
                + (f"RBW={eff.get('rbw_hz')} Hz " if eff.get('rbw_hz') is not None else "")
                + (f"VBW={eff.get('vbw_hz')} Hz"   if eff.get('vbw_hz') is not None else "")
            ).strip(),
        )
        await asyncio.sleep(after_center_s)

        # DUT connect
        yield step("connectDut", "start", message=f"DUT {mac}")
        dut = DUTBLE(mac); dut.connect()
        yield step("connectDut", "done")

        # Read current BLE power (string → int)
        yield step("cwOn", "start", message=f"Set BLE Power Parameter = {power_const}")  # start (we may skip)
        yield step("readBlePower", "start", message="Read current BLE TxPowerConst")
        current_power: Optional[int] = None
        try:
            resp_str = dut.ble_tx_power_get_string()  # e.g., "HWTP_BleTxPower_t(txPowerConst=31)"
            current_power = find_and_return_number(resp_str)
            yield step("readBlePower", "done", message=f"Current TxPowerConst = {current_power}")
        except Exception:
            # fallback: wrapper that tries multiple shapes
            try:
                alt = dut.ble_tx_power_get_exact()
                current_power = int(alt) if alt is not None else None
            except Exception:
                current_power = None
            yield step(
                "readBlePower",
                "done",
                message=f"Current TxPowerConst = {current_power if current_power is not None else '(unavailable)'}",
            )

        need_change = (current_power is None) or (int(current_power) != int(power_const))

        if need_change:
            # Actually set the power
            try:
                dut.ble_tx_power_set_exact(tx_power_const=int(power_const))
            except Exception:
                # fast reconnect & retry (covers sporadic -1 HwtpStatus)
                try:
                    dut.disconnect()
                except Exception:
                    pass
                await asyncio.sleep(0.12)
                dut = DUTBLE(mac); dut.connect()
                dut.ble_tx_power_set_exact(tx_power_const=int(power_const))
            yield step("cwOn", "done", message=f"Set BLE Power Parameter = {power_const}")

            # Save & Reset
            yield step("saveReset", "start", message="Save & Reset DUT")
            dut.ble_save_and_reset_exact()  # disconnects by design
            yield step("saveReset", "done")

            # Reconnect
            await asyncio.sleep(reset_wait_s)
            last_err: Optional[Exception] = None
            for attempt in range(1, reconnect_attempts + 1):
                yield step("reconnectDut", "start", message=f"Reconnect to DUT — attempt {attempt}/{reconnect_attempts}")
                try:
                    dut2 = DUTBLE(mac); dut2.connect()
                    # quick verify (best-effort): read string & parse
                    try:
                        s2 = dut2.ble_tx_power_get_string()
                        rd = find_and_return_number(s2)
                        if int(rd) != int(power_const):
                            dut2.ble_tx_power_set_exact(tx_power_const=int(power_const))
                            await asyncio.sleep(0.06)
                    except Exception:
                        pass
                    yield step("reconnectDut", "done", attempt=attempt)
                    break
                except Exception as e:
                    last_err = e
                    yield step("reconnectDut", "error", message=f"Reconnect failed: {e!s}")
                    await asyncio.sleep(reconnect_backoff_s)
            if dut2 is None:
                raise RuntimeError(f"BLE reconnect failed after {reconnect_attempts} attempts: {last_err!s}")
        else:
            # Already matching — mark the skipped steps as done so the UI goes green
            yield step("cwOn", "done", message=f"Already at {power_const}")
            yield step("saveReset", "start", message="Skip Save & Reset (power already matches)")
            yield step("saveReset", "done")
            yield step("reconnectDut", "start", message="Skip Reconnect (reusing existing BLE session)")
            yield step("reconnectDut", "done")
            dut2 = dut

        # Start tone (UI key 'toneStart')
        try:
            dut2._send_tone_stop_best_effort()
        except Exception:
            pass
        yield step(
            "toneStart",
            "start",
            message=f"Tone ch={channel} ({freq_hz/1e6:.3f}MHz) dur={tone_ms}ms offset={offset_hz}Hz",
        )
        tone_ok = dut2.ble_tone_start_best_effort(
            channel=int(channel), duration_ms=tone_ms, offset_hz=int(offset_hz)
        )
        if tone_ok:
            yield step("toneStart", "done")
        else:
            yield step("toneStart", "error", message="Tone start returned False (continuing to measure)")

        # Measure while CW is ON — longer timing by default (YAML overrideable)
        await asyncio.sleep(tone_settle_s)
        yield step("measure", "start", message=f"peak_search('{marker}') → get_marker_power('{marker}')")
        await spec_call(spec.peak_search, marker)
        await asyncio.sleep(measure_settle_s)
        pow_str = await spec_call(spec.get_marker_power, marker)
        measured = float(num(pow_str))
        yield step("measure", "done", measuredDbm=measured)

        # Final result
        if min_value is None and max_value is None:
            passed = None
        else:
            lower_ok = True if min_value is None else (measured >= float(min_value))
            upper_ok = True if max_value is None else (measured <= float(max_value))
            passed = lower_ok and upper_ok
        yield evt("result", measuredDbm=measured, pass_=passed)

    except asyncio.CancelledError:
        raise
    except Exception as e:
        # Keep SSE alive with a graceful error event
        yield evt("error", error=str(e))
    finally:
        try:
            if dut2 and dut2 is not dut:
                dut2.disconnect()
        except Exception:
            pass
        try:
            if dut:
                dut.disconnect()
        except Exception:
            pass
        yield step("close", "done")
        yield evt("done", ok=True)
