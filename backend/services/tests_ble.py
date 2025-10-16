from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, List, Any

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

def _fmt_commas(x: float, decimals: int = 2) -> str:
    """Format with thousands separators and chosen decimals."""
    fmt = f"{{:,.{decimals}f}}"
    return fmt.format(float(x))

def _zoom_unit_str(span_hz: int, rbw_hz: int, vbw_hz: int) -> str:
    """
    Format zoom values as:
      span=2.0MHz rbw=300.0KHz vbw=100.0KHz
    """
    def mhz(v: float) -> str: return f"{v/1e6:.1f}MHz"
    def khz(v: float) -> str: return f"{v/1e3:.1f}KHz"
    return f"span={mhz(span_hz)} rbw={khz(rbw_hz)} vbw={khz(vbw_hz)}"

def _load_ble_zooms_from_yaml(delay_default: float) -> List[Dict[str, Any]]:
    """
    Read zoom passes from backend/config/tests.yaml → tests.ble_frequency_accuracy.zooms
    Returns a validated list; falls back to 3 classic zooms if missing/invalid.
    """
    cfg = get_test_config("ble_frequency_accuracy")
    raw = (cfg.get("zooms") if isinstance(cfg, dict) else None)
    zooms: List[Dict[str, Any]] = []
    if isinstance(raw, list):
        for z in raw:
            try:
                span = int(z.get("span_hz"))
                rbw  = int(z.get("rbw_hz"))
                vbw  = int(z.get("vbw_hz"))
                d    = float(z.get("delay_s", delay_default))
                if span > 0 and rbw > 0 and vbw > 0:
                    zooms.append({"span_hz": span, "rbw_hz": rbw, "vbw_hz": vbw, "delay_s": d})
            except Exception:
                continue
    if zooms:
        return zooms
    # Fallback: 3 zooms like LoRa
    return [
        {"span_hz": 2_000_000, "rbw_hz": 300_000, "vbw_hz": 100_000, "delay_s": delay_default},
        {"span_hz": 200_000,  "rbw_hz": 10_000,  "vbw_hz": 300_000, "delay_s": delay_default},
        {"span_hz": 20_000,   "rbw_hz": 1_000,   "vbw_hz": 3_000,   "delay_s": delay_default},
    ]


# ============================== BLE Tx Power (kept as-is) ==============================

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
    """
    raw_cfg = get_test_config("ble_tx_power") or {}
    cfg = raw_cfg if isinstance(raw_cfg, dict) else {}

    a_set                 = cfg.get("analyzer_setup") or {}
    marker                = get_marker_name()

    duration_s            = float(cfg.get("duration_s", 5.0))
    offset_hz             = int(cfg.get("offset_hz", 0))

    after_center_s        = float(cfg.get("after_center_s", max(0.05, get_default_delay_s())))
    reset_wait_s          = float(cfg.get("reset_wait_s", 0.60))
    reconnect_attempts    = int(cfg.get("reconnect_attempts", 4))
    reconnect_backoff_s   = float(cfg.get("reconnect_backoff_s", 0.20))
    tone_settle_s         = float(cfg.get("tone_settle_s", 0.25))
    measure_settle_s      = float(cfg.get("measure_settle_s", 0.10))

    freq_hz     = _resolve_ble_channel_to_freq_hz(int(channel))
    power_const = _parse_tx_power(power_param_hex)
    tone_ms     = int(duration_s * 1000.0)

    def step(key: str, status: str, **extra) -> Dict:
        return evt("step", key=key, status=status, **extra)

    yield evt("start", test="ble-tx-power", params={
        "mac": mac, "channel": int(channel), "freq_hz": int(freq_hz),
        "power_param": int(power_const), "duration_s": duration_s,
        "offset_hz": offset_hz, "simple_cw_mode": False,
    })

    spec = None
    dut: Optional[DUTBLE] = None
    dut2: Optional[DUTBLE] = None

    try:
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

        yield step("connectDut", "start", message=f"DUT {mac}")
        dut = DUTBLE(mac); dut.connect()
        yield step("connectDut", "done")

        yield step("cwOn", "start", message=f"Set BLE Power Parameter = {power_const}")
        yield step("readBlePower", "start", message="Read current BLE TxPowerConst")
        current_power: Optional[int] = None
        try:
            resp_str = dut.ble_tx_power_get_string()
            current_power = find_and_return_number(resp_str)
            yield step("readBlePower", "done", message=f"Current TxPowerConst = {current_power}")
        except Exception:
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
            try:
                dut.ble_tx_power_set_exact(tx_power_const=int(power_const))
            except Exception:
                try:
                    dut.disconnect()
                except Exception:
                    pass
                await asyncio.sleep(0.12)
                dut = DUTBLE(mac); dut.connect()
                dut.ble_tx_power_set_exact(tx_power_const=int(power_const))
            yield step("cwOn", "done", message=f"Set BLE Power Parameter = {power_const}")

            yield step("saveReset", "start", message="Save & Reset DUT")
            dut.ble_save_and_reset_exact()  # disconnects by design
            yield step("saveReset", "done")

            await asyncio.sleep(reset_wait_s)
            last_err: Optional[Exception] = None
            for attempt in range(1, reconnect_attempts + 1):
                yield step("reconnectDut", "start", message=f"Reconnect to DUT — attempt {attempt}/{reconnect_attempts}")
                try:
                    dut2 = DUTBLE(mac); dut2.connect()
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
            yield step("cwOn", "done", message=f"Already at {power_const}")
            yield step("saveReset", "start", message="Skip Save & Reset (power already matches)")
            yield step("saveReset", "done")
            yield step("reconnectDut", "start", message="Skip Reconnect (reusing existing BLE session)")
            yield step("reconnectDut", "done")
            dut2 = dut

        try:
            dut2._send_tone_stop_best_effort()
        except Exception:
            pass
        yield step(
            "toneStart",
            "start",
            message=f"Tone ch={channel} ({freq_hz/1e6:.3f}MHz) dur={int(duration_s*1000)}ms offset={int(cfg.get('offset_hz', 0))}Hz",
        )
        tone_ok = dut2.ble_tone_start_best_effort(
            channel=int(channel), duration_ms=int(duration_s*1000), offset_hz=int(cfg.get("offset_hz", 0))
        )
        if tone_ok:
            yield step("toneStart", "done")
        else:
            yield step("toneStart", "error", message="Tone start returned False (continuing to measure)")

        tone_settle_s  = float(cfg.get("tone_settle_s", 0.25))
        measure_wait_s = float(cfg.get("measure_settle_s", 0.10))
        await asyncio.sleep(tone_settle_s)
        yield step("measure", "start", message=f"peak_search('{get_marker_name()}') → get_marker_power('{get_marker_name()}')")
        await spec_call(spec.peak_search, get_marker_name())
        await asyncio.sleep(measure_wait_s)
        pow_str = await spec_call(spec.get_marker_power, get_marker_name())
        measured = float(num(pow_str))
        yield step("measure", "done", measuredDbm=measured)

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
        yield evt("error", error=str(e))
    finally:
        try:
            if 'dut2' in locals() and dut2 and dut2 is not dut:
                dut2.disconnect()
        except Exception:
            pass
        try:
            if 'dut' in locals() and dut:
                dut.disconnect()
        except Exception:
            pass
        # close step & done
        try:
            yield evt("step", key="close", status="done")
        except Exception:
            pass
        yield evt("done", ok=True)


# ============================== BLE Frequency Accuracy (3-zoom, no CW stop, rich logs) ==============================

async def run_ble_frequency_accuracy_stream(
    *,
    mac: str,
    channel: int,
    ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """
    LoRa-style BLE Frequency Accuracy with exactly-3 (or YAML-provided) zoom passes:
      Steps: connectAnalyzer → configureAnalyzer → connectDut → cwOn → measure(zooms) → close
      - No explicit CW stop; tone auto-times-out.
      - For each zoom: apply analyzer params → peak_search → marker_to_center.
      - Logs each zoom in the exact format you requested.
    """
    cfg = get_test_config("ble_frequency_accuracy") or {}
    marker = get_marker_name()
    delay_default = get_default_delay_s()

    a_set = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    after_center_s = float(
        (cfg.get("after_center_s") if isinstance(cfg, dict) else None)
        or (cfg.get("settle_after_center_s") if isinstance(cfg, dict) else None)
        or max(0.05, delay_default)
    )
    tone_duration_ms = int((cfg.get("tone_duration_ms") if isinstance(cfg, dict) else None) or 6000)
    tone_offset_hz   = int((cfg.get("offset_hz") if isinstance(cfg, dict) else None) or 0)
    measure_settle_s = float((cfg.get("measure_settle_s") if isinstance(cfg, dict) else None) or 0.10)

    zooms = _load_ble_zooms_from_yaml(delay_default=delay_default)

    center_hz   = _resolve_ble_channel_to_freq_hz(int(channel))
    expected_hz = float(center_hz)

    def step(key: str, status: str = "start", **extra) -> Dict:
        return evt("step", key=key, status=status, **extra)

    def log(msg: str) -> Dict:
        return evt("log", message=msg)

    # Banner
    yield evt("start", test="ble-frequency-accuracy", params={
        "mac": mac,
        "channel": int(channel),
        "expected_hz": int(expected_hz),
        "ppm_limit": None if ppm_limit is None else float(ppm_limit),
    })

    spec = None
    dut: Optional[DUTBLE] = None

    try:
        # Analyzer connect
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done")
        yield log("Connected to spectrum analyzer")

        # Coarse setup
        yield step("configureAnalyzer", "start")
        _ = await apply_analyzer_setup(
            spec=spec,
            center_hz=int(center_hz),
            setup=a_set,
            analyzer_ref_offset_db=get_global_analyzer_ref_offset_db(),
        )
        yield step("configureAnalyzer", "done", message=f"Center={center_hz/1e6:.3f} MHz (pre-zoom)")
        await asyncio.sleep(after_center_s)
        if a_set:
            yield log(f"Analyzer coarse setup applied: span={a_set.get('span_hz')} Hz, "
                      f"RBW={a_set.get('rbw_hz')} Hz, VBW={a_set.get('vbw_hz')} Hz")

        # DUT connect
        yield step("connectDut", "start", message=f"DUT {mac}")
        dut = DUTBLE(mac); dut.connect()
        yield step("connectDut", "done")
        yield log("DUT connected successfully")

        # Start CW (no stop; auto-timeout)
        yield step(
            "cwOn", "start",
            message=f"BLE Tone ch={channel} ({center_hz/1e6:.3f} MHz), dur={tone_duration_ms} ms, offset={tone_offset_hz} Hz"
        )
        _ = dut.ble_tone_start_best_effort(
            channel=int(channel),
            duration_ms=int(tone_duration_ms),
            offset_hz=int(tone_offset_hz),
        )
        yield step("cwOn", "done")
        yield log("BLE CW started (auto-timeout). Beginning zoom sequence…")

        # Zoom passes
        total = len(zooms)
        for i, z in enumerate(zooms, 1):
            span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"])
            delay_s = float(z.get("delay_s", delay_default))

            # Log exactly as requested
            yield log(f"Zoom {i}/{total} \u2192 {_zoom_unit_str(span_hz, rbw_hz, vbw_hz)}")

            # Apply analyzer params (keep same center)
            _ = await apply_analyzer_setup(
                spec=spec,
                center_hz=int(center_hz),
                setup={"span_hz": span_hz, "rbw_hz": rbw_hz, "vbw_hz": vbw_hz},
                analyzer_ref_offset_db=get_global_analyzer_ref_offset_db(),
            )

            # Let trace settle a bit
            await asyncio.sleep(delay_s)

            # Lock on peak and center the marker
            await spec_call(spec.peak_search, marker)
            try:
                await spec_call(spec.marker_to_center, marker)
            except Exception:
                # If instrument doesn’t expose marker_to_center, the peak_search already placed the marker
                pass

        # Short settle before final read
        await asyncio.sleep(measure_settle_s)

        # Final frequency read (with comma-format in message/logs)
        yield step("measure", "start", message=f"get_marker_frequency('{marker}')")
        f_str = await spec_call(spec.get_marker_frequency, marker)
        measured_hz = float(num(f_str))

        err_hz  = abs(measured_hz - expected_hz)
        err_ppm = (err_hz / expected_hz) * 1e6

        msg = (
            f"Expected={_fmt_commas(expected_hz, 2)} Hz | "
            f"Measured={_fmt_commas(measured_hz, 2)} Hz | "
            f"\u0394f={_fmt_commas(err_hz, 2)} Hz ({_fmt_commas(err_ppm, 2)} ppm)"
        )
        yield step("measure", "done", measuredHz=measured_hz, errorHz=err_hz, errorPpm=err_ppm, message=msg)
        yield log(f"Measured frequency: {_fmt_commas(measured_hz, 2)} Hz "
                  f"(Expected={_fmt_commas(expected_hz, 2)} Hz, "
                  f"\u0394f={_fmt_commas(err_hz, 2)} Hz, {_fmt_commas(err_ppm, 2)} ppm)")

        # Result
        if ppm_limit is None:
            passed = None
            yield log("No PPM limit defined — skipping pass/fail decision.")
        else:
            passed = float(err_ppm) <= float(ppm_limit)
            yield log(f"Result: {'PASS' if passed else 'FAIL'} (limit={ppm_limit:.2f} ppm)")
        yield evt("result", measuredHz=measured_hz, errorHz=err_hz, errorPpm=err_ppm, pass_=passed)

    except asyncio.CancelledError:
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        try:
            if dut:
                dut.disconnect()
                yield log("DUT disconnected.")
        except Exception:
            pass
        try:
            yield step("close", "done")
        except Exception:
            pass
        yield evt("done", ok=True)
