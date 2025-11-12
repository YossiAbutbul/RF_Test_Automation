# backend/services/tests_lora.py
from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, Any, List

from services.tests_common import (
    evt,
    num,
    ensure_analyzer_async,
    spec_call,
    dut_call,
    managed_ble,
    apply_analyzer_setup,
    zoom_and_center,
    get_global_analyzer_ref_offset_db,
    background_abort_ble,
    background_tidy_spectrum,
    CLOSE_SPEC_TIMEOUT,
)
from services.test_config import get_test_config, get_marker_name, get_default_delay_s

# ---- Fallback zooms (used only if YAML has no valid list) ----
_FALLBACK_ZOOMS: List[Dict[str, Any]] = [
    {"span_hz": 2_000_000,  "rbw_hz": 30_000, "vbw_hz": 100_000, "delay_s": 0.20},
    {"span_hz": 200_000,    "rbw_hz": 10_000, "vbw_hz": 30_000,  "delay_s": 0.20},
    {"span_hz": 20_000,     "rbw_hz": 1_000,  "vbw_hz": 3_000,   "delay_s": 0.20},
]

# --------- LoRa: Tx Power ---------

async def run_tx_power(
    *, freq_hz: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Non-stream helper that runs LoRa Tx Power and returns the final result dict.
    """
    result: Dict[str, Any] | None = None
    async for e in run_tx_power_stream(freq_hz=freq_hz, power_dbm=power_dbm, mac=mac,
                                       min_value=min_value, max_value=max_value):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_tx_power_stream")
    return {"ok": True, "measuredDbm": result.get("measuredDbm"), "pass": result.get("pass_")}

async def run_tx_power_stream(
    *, freq_hz: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """
    LoRa Tx Power streaming generator.
    Emits: start → step/log → result → done
    Fast abort: on client disconnect, we schedule BLE cw_off + disconnect in background.
    """
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)
    marker = get_marker_name()
    delay  = get_default_delay_s()
    cfg    = get_test_config("tx_power")
    setup  = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    settle = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()

    spec = None
    try:
        yield evt("start", test="tx-power", params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=setup, analyzer_ref_offset_db=ref_off)
        yield step("configureAnalyzer", "done", message=f"Analyzer cfg center={(eff['center_hz'])/1e6}MHz span={(eff.get('span_hz'))/1e6}MHz rbw={(eff.get('rbw_hz'))/1e3}KHz vbw={(eff.get('vbw_hz'))/1e3}KHz ref_off={eff.get('analyzer_ref_offset_db')}dB")
        center_wait = float((cfg.get("settle") or {}).get("after_center_s", delay))
        await asyncio.sleep(center_wait)

        # DUT
        yield step("connectDut", "start")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done", message=f"BLE connected {mac}")

            yield step("cwOn", "start", message=f"LoRa CW on @ {(freq_hz)/1e6} MHz, {power_dbm} dBm")
            await dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(settle.get("after_lora_cw_on_s", 0.6)))
            yield step("cwOn", "done")

            # measure
            yield step("measure", "start", message="Peak search + read marker power")
            await spec_call(spec.peak_search, marker); await asyncio.sleep(delay)
            pow_str = await spec_call(spec.get_marker_power, marker)
            measured = float(num(pow_str))
            yield step("measure", "done", measuredDbm=measured)

            # Show PASS/FAIL only if at least one limit is provided
            if min_value is None and max_value is None:
                passed = None
            else:
                lower_ok = True if min_value is None else (measured >= float(min_value))
                upper_ok = True if max_value is None else (measured <= float(max_value))
                passed = lower_ok and upper_ok

            yield evt("result", measuredDbm=measured, pass_=passed)

            # stop CW quickly but explicitly
            yield step("cwOff", "start", message="LoRa CW off")
            try:
                await dut_call(dut, "lora_cw_off")
            finally:
                yield step("cwOff", "done")

    except asyncio.CancelledError:
        # Client aborted: cleanup fast in background
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LoRa"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        # Do not yield anything else; stream is closing
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        # Best-effort final step mark
        yield evt("done", ok=True)

# --------- LoRa: Frequency Accuracy ---------

def _load_zooms_from_yaml(delay_default: float) -> List[Dict[str, Any]]:
    """
    Read zoom passes from backend/config/tests.yaml.
    Returns a validated list; falls back to _FALLBACK_ZOOMS if missing/invalid.
    """
    cfg = get_test_config("frequency_accuracy")
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
                # skip malformed entries
                continue
    return zooms if zooms else _FALLBACK_ZOOMS

async def run_freq_accuracy(
    *, freq_hz: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Non-stream helper for LoRa Frequency Accuracy.
    """
    result: Dict[str, Any] | None = None
    async for e in run_freq_accuracy_stream(freq_hz=freq_hz, power_dbm=power_dbm, mac=mac, ppm_limit=ppm_limit):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_freq_accuracy_stream")
    return {
        "ok": True,
        "measuredHz": result.get("measuredHz"),
        "errorHz": result.get("errorHz"),
        "errorPpm": result.get("errorPpm"),
        "pass": result.get("pass_"),
    }

async def run_freq_accuracy_stream(
    *, freq_hz: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """
    LoRa Frequency Accuracy streaming generator — zoom passes loaded from YAML.
    """
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay  = get_default_delay_s()
    cfg    = get_test_config("frequency_accuracy")
    setup  = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    settle = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()
    zooms  = _load_zooms_from_yaml(delay_default=delay)

    spec = None
    try:
        yield evt("start", test="frequency-accuracy", params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=setup, analyzer_ref_offset_db=ref_off)
        yield step("configureAnalyzer", "done", message=f"Analyzer cfg center={(eff['center_hz'])/1e6}MHz")
        center_wait = float((cfg.get("settle") or {}).get("after_center_s", delay))
        await asyncio.sleep(center_wait)

        # dut
        yield step("connectDut", "start")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done", message=f"BLE connected {mac}")

            yield step("cwOn", "start", message=f"LoRa CW on @ {(freq_hz)/1e6} MHz, {power_dbm} dBm")
            await dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(settle.get("after_lora_cw_on_s", 0.6)))
            yield step("cwOn", "done")

            # zoom passes from YAML
            total = len(zooms)
            for i, z in enumerate(zooms, 1):
                span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"]); d = float(z.get("delay_s", delay))
                yield evt("log", message=f"Zoom {i}/{total} → span={span_hz/1e6}MHz rbw={rbw_hz/1e3}KHz vbw={vbw_hz/1e3}KHz")
                await zoom_and_center(
                    spec,
                    span_hz=span_hz,
                    rbw_hz=rbw_hz,
                    vbw_hz=vbw_hz,
                    marker=marker,
                    delay=d,
                )

            # final read
            yield step("measure", "start", message="Read marker frequency + compute error/ppm")
            f1 = await spec_call(spec.get_marker_frequency, marker)
            await asyncio.sleep(delay)
            f2 = await spec_call(spec.get_marker_frequency, marker)
            measured = int(float(num(f2 or f1)))

            error_hz = int(measured - int(freq_hz))
            error_ppm = (float(error_hz) / float(freq_hz)) * 1e6 if freq_hz else None
            passed = (abs(error_ppm) <= float(ppm_limit)) if (ppm_limit is not None and error_ppm is not None) else None

            yield step("measure", "done", measuredHz=measured, errorHz=error_hz, errorPpm=error_ppm)
            yield evt("result", measuredHz=measured, errorHz=error_hz, errorPpm=error_ppm, pass_=passed)

            # stop CW
            yield step("cwOff", "start", message="LoRa CW off")
            try:
                await dut_call(dut, "lora_cw_off")
            finally:
                yield step("cwOff", "done")

    except asyncio.CancelledError:
        # client aborted
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LORA"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)

# ---------- LoRa: Occupied Bandwidth (OBW) ----------
async def run_obw(
    *, freq_hz: int, power_dbm: int, mac: str,
    bandwidth: int, datarate: int,
    duration_s: float = 10.0,
) -> Dict[str, Any]:
    """Non-stream helper; returns measuredHz and pass (always None)."""
    result = None
    async for e in run_obw_stream(
        freq_hz=freq_hz,
        power_dbm=power_dbm,
        mac=mac,
        bandwidth=bandwidth,
        datarate=datarate,
        duration_s=duration_s,
    ):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_obw_stream")
    return {"ok": True, "measuredHz": result.get("measuredHz"), "pass": result.get("pass_")}

async def run_obw_stream(
    *, freq_hz: int, power_dbm: int, mac: str,
    bandwidth: int, datarate: int,
    duration_s: float = 10.0,
) -> AsyncGenerator[Dict, None]:
    """LoRa OBW streaming generator emitting UI steps, result and done events."""
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)
    spec = None
    try:
        yield evt("start", test="obw",
                  params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm,
                          "bandwidth": bandwidth, "datarate": datarate,
                          "duration_s": duration_s})

        # Analyzer connect
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        # Configure analyzer: center freq, span 500 kHz, RBW 3 kHz, VBW 10 kHz
        yield step("configureAnalyzer", "start")
        await spec_call(spec.set_center_frequency, freq=freq_hz, units="HZ")
        await spec_call(spec.set_rbw, rbw=3, units="KHZ")
        await spec_call(spec.set_vbw, vbw=10, units="KHZ")
        await spec_call(spec.set_span, span=500, units="KHZ")
        yield step("configureAnalyzer", "done",
                   message=f"Analyzer cfg center={freq_hz/1e6:.3f}MHz span=0.500MHz rbw=3kHz vbw=10kHz")
        await asyncio.sleep(0.5)

        # DUT connect and modulated CW start
        yield step("connectDut", "start")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done", message=f"BLE connected {mac}")
            yield step("cwOn", "start",
                       message=f"LoRa modulated CW on @ {freq_hz/1e6:.3f} MHz, {power_dbm} dBm, bw={bandwidth}, dr={datarate}")
            await dut_call(dut, "lora_modulated_cw_on",
                           freq_hz=freq_hz, power_dbm=power_dbm,
                           bandwidth=bandwidth, datarate=datarate)
            await asyncio.sleep(0.6)
            yield step("cwOn", "done")

            # OBW measure
            yield step("measure", "start", message="Max‑hold accumulate and compute OBW")
            obw_hz = await spec_call(spec.measure_obw_via_max_hold,
                                     duration_s=float(duration_s), pct=99.0)
            measured = float(obw_hz)
            yield step("measure", "done", measuredHz=measured)
            yield evt("result", measuredHz=measured, pass_=None)

            # Stop modulation
            yield step("cwOff", "start", message="LoRa modulated CW off")
            try:
                await dut_call(dut, "lora_modulated_cw_off")
            finally:
                yield step("cwOff", "done")
    except asyncio.CancelledError:
        # On abort, tidy the DUT and analyzer in background
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LORA"))
        if spec:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)
