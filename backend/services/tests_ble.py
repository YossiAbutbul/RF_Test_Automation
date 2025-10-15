from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional

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

# DLL channel: 0→2402 MHz, +2 MHz/step
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
    power_param_hex: int | str,           # name kept for route compat; treated as plain int
    channel: int,                          # 0..39 (0=2402MHz)
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    simple_cw_mode: Optional[bool] = None,  # if True → just tone+measure
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)

    spec = None
    try:
        # Config
        cfg      = get_test_config("ble_tx_power") or {}
        a_set    = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        settle   = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
        marker   = get_marker_name()
        delay    = get_default_delay_s()
        ref_off  = get_global_analyzer_ref_offset_db()

        duration_s = float(cfg.get("duration_s", 5.0))
        offset_hz  = int(cfg.get("offset_hz", 0))
        reset_wait_s        = float(cfg.get("reset_wait_s", 0.8))
        reconnect_attempts  = int(cfg.get("reconnect_attempts", 3))
        reconnect_backoff_s = float(cfg.get("reconnect_backoff_s", 0.25))

        # defaults to full flow unless simple mode requested
        cfg_simple = bool(cfg.get("simple_cw_mode", False))
        simple_cw  = cfg_simple if simple_cw_mode is None else bool(simple_cw_mode)

        # Inputs
        freq_hz = _resolve_ble_channel_to_freq_hz(int(channel))
        power_const = _parse_tx_power(power_param_hex)

        # Start
        yield evt("start", test="ble-tx-power", params={
            "mac": mac, "channel": int(channel), "freq_hz": int(freq_hz),
            "power_param": int(power_const), "duration_s": duration_s,
            "offset_hz": offset_hz, "simple_cw_mode": simple_cw,
        })

        # Analyzer
        yield step("connectAnalyzer")
        spec = await ensure_analyzer_async()
        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec, center_hz=int(freq_hz), setup=a_set, analyzer_ref_offset_db=ref_off
        )
        def mhz(x): 
            try: return (float(x)/1e6)
            except Exception: return 0.0
        yield step("configureAnalyzer","done",
            message=(
                f"Analyzer center={mhz(eff.get('center_hz')):.3f} MHz "
                f"span={mhz(eff.get('span_hz')):.3f} MHz "
                + (f"RBW={eff.get('rbw_hz')} Hz " if eff.get('rbw_hz') is not None else "")
                + (f"VBW={eff.get('vbw_hz')} Hz"   if eff.get('vbw_hz') is not None else "")
            ).strip()
        )
        await asyncio.sleep(float(settle.get("after_center_s", delay)))

        # SIMPLE CW: tone + measure (no set/reset/verify)
        if simple_cw:
            yield step("connectDut", "start", message=f"DUT {mac}")
            async with managed_ble(mac) as dut:
                yield step("connectDut", "done")
                try:
                    await dut_call(dut, "_send_tone_stop_best_effort")
                except Exception:
                    pass
                tone_ms = int(duration_s * 1000.0)
                yield step("toneStart", "start",
                    message=f"Tone ch={channel} ({freq_hz/1e6:.3f}MHz) dur={tone_ms}ms offset={offset_hz}Hz"
                )
                ok = await dut_call(dut, "ble_tone_start_best_effort",
                                    channel=int(channel), duration_ms=tone_ms, offset_hz=int(offset_hz))
                if ok:
                    yield step("toneStart", "done")
                else:
                    yield step("toneStart", "error", message="Tone start returned False (continuing to measure)")
            await asyncio.sleep(max(0.15, min(duration_s * 0.1, 0.5)))

        # FULL FLOW: Set → Save&Reset → Reconnect → Verify → Tone → Measure
        else:
            yield step("connectDut", "start", message=f"DUT {mac}")
            async with managed_ble(mac) as dut:
                yield step("connectDut", "done")

                # 1) Set TX power (EXACT)
                yield step("cwOn", "start", message=f"Set BLE TxPowerConst={power_const}")
                await dut_call(dut, "ble_tx_power_set_exact", tx_power_const=int(power_const), timeout=6.0)
                yield step("cwOn", "done")

                # 2) Save & reset (EXACT) — disconnects by design
                yield step("saveReset", "start", message="Save settings & reset DUT (disconnect)")
                await dut_call(dut, "ble_save_and_reset_exact", timeout=4.0)
                yield step("saveReset", "done")

            # 3) Reconnect quickly
            await asyncio.sleep(reset_wait_s)
            last_err = None
            for attempt in range(1, reconnect_attempts + 1):
                try:
                    yield step("reconnectDut", "start", message=f"DUT {mac} (post-reset) — attempt {attempt}/{reconnect_attempts}")
                    async with managed_ble(mac) as dut2:
                        yield step("reconnectDut", "done", attempt=attempt)

                        # 4) Verify TX power (retry a couple times)
                        ok = False
                        last_rd = None
                        for _ in range(3):
                            last_rd = await dut_call(dut2, "ble_tx_power_get_exact", timeout=3.0)
                            if last_rd is None:
                                ok = True  # no readable value on this build; accept and continue
                                break
                            if int(last_rd) == int(power_const):
                                ok = True
                                break
                            await asyncio.sleep(0.10)
                        if not ok:
                            yield step("cwOn", "error", message=f"Power readback mismatch: expected {power_const}, got {last_rd}")

                        # 5) Start tone
                        try:
                            await dut_call(dut2, "_send_tone_stop_best_effort", timeout=2.0)
                        except Exception:
                            pass
                        tone_ms = int(duration_s * 1000.0)
                        yield step("toneStart", "start",
                                   message=f"Tone ch={channel} ({freq_hz/1e6:.3f}MHz) dur={tone_ms}ms offset={offset_hz}Hz")
                        ok_tone = await dut_call(dut2, "ble_tone_start_best_effort",
                                                 channel=int(channel), duration_ms=tone_ms, offset_hz=int(offset_hz), timeout=4.0)
                        if ok_tone:
                            yield step("toneStart", "done")
                        else:
                            yield step("toneStart", "error", message="Tone start returned False (continuing to measure)")
                    await asyncio.sleep(0.12)
                    last_err = None
                    break
                except Exception as e:
                    last_err = e
                    yield step("reconnectDut", "error", message=f"Reconnect failed: {e!s}")
                    if attempt < reconnect_attempts:
                        await asyncio.sleep(reconnect_backoff_s)
                    else:
                        raise RuntimeError(f"BLE reconnect failed after {reconnect_attempts} attempts: {e!s}") from e

        # Measure on spectrum
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
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)
