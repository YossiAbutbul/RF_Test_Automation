# backend/services/tests_ble.py
from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, Any

from services.tests_common import (
    evt, num,
    ensure_analyzer_async, spec_call, dut_call, managed_ble,
    apply_analyzer_setup,
    get_global_analyzer_ref_offset_db,
)
from services.test_config import (
    get_test_config,
    get_marker_name,
    get_default_delay_s,
)

# --------------------------------------------------------------------------------------
# Config helpers
# --------------------------------------------------------------------------------------

def _resolve_ble_channel_to_freq_hz(channel: int) -> int:
    """
    Your DLL maps BLE channels linearly:
      ch 0 => 2402 MHz, then +2 MHz per channel, up to ch 39 => 2480 MHz.
    We still allow overriding via YAML tests.ble_channel_map if provided.
    """
    try:
        ch_map = get_test_config("ble_channel_map") or {}
        if isinstance(ch_map, dict) and str(channel) in ch_map:
            return int(float(ch_map[str(channel)]))
    except Exception:
        pass

    ch = int(channel)
    if 0 <= ch <= 39:
        return 2_402_000_000 + ch * 2_000_000
    raise ValueError(f"Unsupported BLE channel (expected 0..39): {channel}")

def _parse_hex_or_int(v: str | int) -> int:
    """
    Accept '0x1F', '1F', '31' or int → returns integer value.
    """
    if isinstance(v, int):
        return v
    s = str(v).strip()
    try:
        if s.lower().startswith("0x"):
            return int(s, 16)
        if any(c in "ABCDEFabcdef" for c in s):
            return int(s, 16)
        return int(s, 10)
    except Exception as e:
        raise ValueError(f"Invalid power parameter: {v!r}") from e

# --------------------------------------------------------------------------------------
# BLE — Tx Power (stream)
# --------------------------------------------------------------------------------------

async def run_ble_tx_power_stream(
    *,
    mac: str,
    power_param_hex: str | int,            # e.g. "0x1F" or 31 (unused in simple_cw mode)
    channel: int,                          # DLL channel index 0..39 (UI derives from freq)
    min_value: Optional[float] = None,     # pass/fail lower bound (dBm)
    max_value: Optional[float] = None,     # pass/fail upper bound (dBm)
) -> AsyncGenerator[Dict, None]:
    """
    BLE Tx Power streaming generator.

    Two modes:
      A) simple_cw_mode=True (default): connect → tone → measure → done
      B) simple_cw_mode=False: set power → save+reset → reconnect → tone → measure
    """
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)
    spec = None

    try:
        # Load test config
        cfg      = get_test_config("ble_tx_power") or {}
        a_set    = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        settle   = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
        marker   = get_marker_name()
        delay    = get_default_delay_s()
        ref_off  = get_global_analyzer_ref_offset_db()

        duration_s = float(cfg.get("duration_s", 5.0))
        offset_hz  = int(cfg.get("offset_hz", 0))
        simple_cw  = bool(cfg.get("simple_cw_mode", True))
        reset_wait_s        = float(cfg.get("reset_wait_s", 1.8))
        reconnect_attempts  = int(cfg.get("reconnect_attempts", 5))
        reconnect_backoff_s = float(cfg.get("reconnect_backoff_s", 0.35))

        # Resolve center frequency from (channel)
        freq_hz = _resolve_ble_channel_to_freq_hz(int(channel))

        # Normalize the power parameter (not used in simple_cw)
        power_const = _parse_hex_or_int(power_param_hex)

        # Start event
        yield evt(
            "start",
            test="ble-tx-power",
            params={
                "mac": mac,
                "channel": int(channel),
                "freq_hz": int(freq_hz),
                "power_param": int(power_const),
                "duration_s": duration_s,
                "offset_hz": offset_hz,
                "simple_cw_mode": simple_cw,
            },
        )

        # Analyzer: connect + configure
        yield step("connectAnalyzer")
        spec = await ensure_analyzer_async()
        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec,
            center_hz=int(freq_hz),
            setup=a_set,
            analyzer_ref_offset_db=ref_off,
        )

        center_hz = eff.get("center_hz"); span_hz = eff.get("span_hz")
        rbw_hz = eff.get("rbw_hz"); vbw_hz = eff.get("vbw_hz")
        def mhz(x): 
            try: return (float(x)/1e6)
            except Exception: return 0.0

        yield step(
            "configureAnalyzer",
            "done",
            message=(
                f"Analyzer center={mhz(center_hz):.3f} MHz "
                f"span={mhz(span_hz):.3f} MHz "
                + (f"RBW={rbw_hz} Hz " if rbw_hz is not None else "")
                + (f"VBW={vbw_hz} Hz"   if vbw_hz is not None else "")
            ).strip()
        )
        await asyncio.sleep(float(settle.get("after_center_s", delay)))

        # =========================
        # Mode A: SIMPLE CW
        # =========================
        if simple_cw:
            yield step("connectDut", "start", message=f"DUT {mac}")
            async with managed_ble(mac) as dut:
                yield step("connectDut", "done")

                # Clear any stale tone first (prevents -1 HwtpStatus on some builds)
                try:
                    await dut_call(dut, "_send_tone_stop_best_effort")
                except Exception:
                    pass

                tone_ms = int(duration_s * 1000.0)
                yield step(
                    "toneStart", "start",
                    message=f"Tone ch={channel} ({freq_hz/1e6:.3f}MHz) dur={tone_ms}ms offset={offset_hz}Hz"
                )
                # DLL-friendly START with STOP+fallbacks inside
                await dut_call(
                    dut, "ble_test_tone_start",
                    channel=int(channel),
                    duration_ms=tone_ms,
                    offset_hz=int(offset_hz),
                )
                yield step("toneStart", "done")

            # Let CW stabilize, then measure on spectrum
            await asyncio.sleep(max(0.15, min(duration_s * 0.1, 0.5)))

            yield step("measure", "start", message=f"peak_search('{marker}') → get_marker_power('{marker}')")
            await spec_call(spec.peak_search, marker)
            await asyncio.sleep(delay)
            pow_str = await spec_call(spec.get_marker_power, marker)
            measured = float(num(pow_str))
            yield step("measure", "done", measuredDbm=measured)

            # PASS/FAIL (only if limits provided)
            if min_value is None and max_value is None:
                passed = None
            else:
                lower_ok = True if min_value is None else (measured >= float(min_value))
                upper_ok = True if max_value is None else (measured <= float(max_value))
                passed = lower_ok and upper_ok

            yield evt("result", measuredDbm=measured, pass_=passed)
            yield evt("done", ok=True)
            return

        # =========================
        # Mode B: FULL FLOW
        # =========================
        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield step("cwOn", "start", message=f"Set BLE TxPowerConst=0x{power_const:X}")
            await dut_call(dut, "ble_tx_power_set", tx_power_const=int(power_const))
            yield step("cwOn", "done")

            yield step("saveReset", "start", message="Save settings & reset DUT (reconnect after)")
            await dut_call(dut, "ble_save_and_reset")
            yield step("saveReset", "done")

        await asyncio.sleep(reset_wait_s)
        for attempt in range(1, reconnect_attempts + 1):
            try:
                yield step("reconnectDut", "start", message=f"DUT {mac} (post-reset) — attempt {attempt}/{reconnect_attempts}")
                async with managed_ble(mac) as dut:
                    yield step("reconnectDut", "done", attempt=attempt)
                    tone_ms = int(duration_s * 1000.0)
                    yield step("toneStart", "start",
                               message=f"Tone ch={channel} ({freq_hz/1e6:.3f}MHz) dur={tone_ms}ms offset={offset_hz}Hz")
                    await dut_call(dut, "ble_test_tone_start",
                                   channel=int(channel),
                                   duration_ms=tone_ms,
                                   offset_hz=int(offset_hz))
                    yield step("toneStart", "done")
                await asyncio.sleep(max(0.10, min(duration_s * 0.05, 0.30)))
                break
            except Exception as e:
                yield step("reconnectDut", "error", message=f"Reconnect failed: {e!s}")
                if attempt < reconnect_attempts:
                    await asyncio.sleep(reconnect_backoff_s * (1.0 + 0.25 * (attempt - 1)))
                else:
                    raise RuntimeError(f"BLE reconnect failed after {reconnect_attempts} attempts: {e!s}") from e

        yield step("measure", "start", message=f"peak_search('{marker}') → get_marker_power('{marker}')")
        await spec_call(spec.peak_search, marker)
        await asyncio.sleep(delay)
        pow_str = await spec_call(spec.get_marker_power, marker)
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
        if spec is not None:
            try:
                await spec_call(spec.disconnect, timeout=3.0)
            except Exception:
                pass
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)


async def run_ble_tx_power(
    *,
    mac: str,
    power_param_hex: str | int,
    channel: int,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Convenience wrapper that returns the final result dict.
    """
    result: Dict[str, Any] | None = None
    async for e in run_ble_tx_power_stream(
        mac=mac,
        power_param_hex=power_param_hex,
        channel=channel,
        min_value=min_value,
        max_value=max_value,
    ):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_ble_tx_power_stream")
    return {"ok": True, "measuredDbm": result.get("measuredDbm"), "pass": result.get("pass_")}
