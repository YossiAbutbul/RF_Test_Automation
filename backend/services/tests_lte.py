# backend/services/tests_lte.py
from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, Any, Tuple, Iterable, List

from services.tests_common import (
    # events & parsing
    evt, num,
    # analyzer + dut helpers
    ensure_analyzer_async, spec_call, dut_call, managed_ble,
    apply_analyzer_setup, zoom_and_center,
    # config helpers
    get_global_analyzer_ref_offset_db,
    # background cleanup
    background_abort_ble, background_tidy_spectrum,
    # small constants
    CLOSE_SPEC_TIMEOUT,
)
from services.test_config import (
    get_test_config,      # YAML: cfg["tests"][name]
    get_marker_name,      # YAML: defaults.spectrum.marker
    get_default_delay_s,  # YAML: defaults.spectrum.default_delay_s
)

# --------------------------------------------------------------------------------------
# Helpers for LTE map handling.
# --------------------------------------------------------------------------------------

def _normalize_lte_map(raw: Any) -> Dict[int, int]:
    out: Dict[int, int] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        try:
            ek = int(str(k).strip())
            ev = int(float(str(v).strip()))
            out[ek] = ev
        except Exception:
            continue
    return out

def _resolve_earfcn_or_freq(value: int, lte_map_raw: Any) -> Tuple[int, int]:
    """
    Accept either an EARFCN or an exact frequency in Hz and resolve to both.
    Uses a small ±2 kHz tolerance for frequency lookups (mirrors your current behavior).
    """
    lte_map = _normalize_lte_map(lte_map_raw)
    if not lte_map:
        raise ValueError("LTE map is empty. Check config key 'lte_earfcn_map' under tests.yaml:tests.")
    val = int(value)

    # case 1: exact EARFCN
    if val in lte_map:
        return val, int(lte_map[val])

    # case 2: exact frequency (Hz)
    for earfcn, f_hz in lte_map.items():
        if int(f_hz) == val:
            return int(earfcn), int(f_hz)

    # case 3: small tolerance (±2 kHz)
    for earfcn, f_hz in lte_map.items():
        if abs(int(f_hz) - val) <= 2_000:
            return int(earfcn), int(f_hz)

    raise ValueError(f"Unsupported LTE EARFCN/frequency: {val}")

# --------------------------------------------------------------------------------------
# LTE — Tx Power
# --------------------------------------------------------------------------------------

async def run_lte_tx_power(
    *, earfcn: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Non-stream helper that runs LTE Tx Power and returns the final result dict.
    """
    result: Dict[str, Any] | None = None
    async for e in run_lte_tx_power_stream(
        earfcn=earfcn, power_dbm=power_dbm, mac=mac,
        min_value=min_value, max_value=max_value
    ):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_lte_tx_power_stream")
    return {"ok": True, "measuredDbm": result.get("measuredDbm"), "pass": result.get("pass_")}

async def run_lte_tx_power_stream(
    *, earfcn: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """
    LTE Tx Power streaming generator.
    Emits: start → step/log → result → done
    On Abort (client disconnect): background BLE stop + analyzer disconnect (fast, non-blocking).
    """
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)
    spec = None
    try:
        # Resolve mapping (accept EARFCN or exact freq from UI)
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        # Config & setup
        lte_def = get_test_config("lte_defaults") or {}
        a_set   = (lte_def.get("analyzer_setup") or {}) if isinstance(lte_def, dict) else {}
        marker  = get_marker_name()
        delay   = get_default_delay_s()
        ref_off = get_global_analyzer_ref_offset_db()

        # Start event includes both freq_hz and EARFCN for the UI log
        yield evt("start", test="lte-tx-power",
                  params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer
        yield step("connectAnalyzer")
        spec = await ensure_analyzer_async()
        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, analyzer_ref_offset_db=ref_off)
        yield step("configureAnalyzer", "done", message=f"Analyzer center={(eff['center_hz'])/1e6}MHz span={(eff.get('span_hz'))/1e6}MHz")
        center_wait = float((lte_def.get("settle_after_center_s")) or ((lte_def.get("settle") or {}).get("after_center_s", delay)))
        await asyncio.sleep(center_wait)

        # DUT (BLE)
        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            # Modem on + safety abort (your current flow)
            # Modem on step (visible in UI)
            yield step("modemOn", "start", message="Turning LTE modem on")
            await dut_call(dut, "lte_modem_on")
            await dut_call(dut, "lte_abort_test")  # safety clear
            yield step("modemOn", "done")

            # CW ON
            yield step("cwOn", "start", message=f"CW on @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
            await dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm)
            await asyncio.sleep(float(lte_def.get("settle_after_cw_on_s", 0.3)))
            yield step("cwOn", "done")

            # Measure
            yield step("measure", "start", message=f"peak_search('{marker}') → get_marker_power('{marker}')")
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
            yield step("cwOff", "done", message="Turning CW off")
            yield evt("result", measuredDbm=measured, pass_=passed)

            # Fast modem stop
            try:
                await dut_call(dut, "lte_abort_test")
                await dut_call(dut, "lte_modem_off")
            except Exception:
                pass

    except asyncio.CancelledError:
        # Abort: do not block — close both sessions in the background
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            # quick tidy plus a fast disconnect
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)

# --------------------------------------------------------------------------------------
# LTE — Frequency Accuracy
# --------------------------------------------------------------------------------------

# Sane fallback zooms if YAML has none (your monolith uses a 3-zoom pattern) :contentReference[oaicite:6]{index=6}
_FALLBACK_ZOOMS: List[Dict[str, Any]] = [
    {"span_hz": 2_000_000,  "rbw_hz": 30_000, "vbw_hz": 100_000, "delay_s": 0.20},
    {"span_hz": 200_000,    "rbw_hz": 10_000, "vbw_hz": 30_000,  "delay_s": 0.20},
    {"span_hz": 20_000,     "rbw_hz": 1_000,  "vbw_hz": 3_000,   "delay_s": 0.20},
]

def _load_lte_zooms(delay_default: float) -> List[Dict[str, Any]]:
    cfg = get_test_config("lte_frequency_accuracy") or {}
    raw = (cfg.get("zooms") or []) if isinstance(cfg, dict) else []
    out: List[Dict[str, Any]] = []
    if isinstance(raw, list):
        for z in raw:
            try:
                span = int(z.get("span_hz"))
                rbw  = int(z.get("rbw_hz"))
                vbw  = int(z.get("vbw_hz"))
                d    = float(z.get("delay_s", delay_default))
                if span > 0 and rbw > 0 and vbw > 0:
                    out.append({"span_hz": span, "rbw_hz": rbw, "vbw_hz": vbw, "delay_s": d})
            except Exception:
                continue
    return out if out else _FALLBACK_ZOOMS

async def run_lte_frequency_accuracy(
    *, earfcn: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Non-stream helper for LTE Frequency Accuracy.
    """
    result: Dict[str, Any] | None = None
    async for e in run_lte_frequency_accuracy_stream(
        earfcn=earfcn, power_dbm=power_dbm, mac=mac, ppm_limit=ppm_limit
    ):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_lte_frequency_accuracy_stream")
    return {
        "ok": True,
        "measuredHz": result.get("measuredHz"),
        "errorHz": result.get("errorHz"),
        "errorPpm": result.get("errorPpm"),
        "pass": result.get("pass_"),
    }

async def run_lte_frequency_accuracy_stream(
    *, earfcn: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """
    LTE Frequency Accuracy streaming generator — zooms are taken from YAML.
    """
    def step(key: str, status: str = "start", **extra): return evt("step", key=key, status=status, **extra)
    spec = None
    try:
        # Resolve mapping
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        cfg    = get_test_config("lte_frequency_accuracy") or {}
        a_set  = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        base   = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = get_global_analyzer_ref_offset_db()
        zooms  = _load_lte_zooms(delay_default=delay)

        yield evt("start", test="lte-frequency-accuracy",
                  params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer
        yield step("connectAnalyzer")
        spec = await ensure_analyzer_async()
        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, analyzer_ref_offset_db=ref_off)
        yield step("configureAnalyzer", "done", message=f"Analyzer center={(eff['center_hz'])/1e6}MHz")
        center_wait_raw = (cfg.get("settle") or {}).get("after_center_s")
        if center_wait_raw is None:
            center_wait_raw = base.get("settle_after_center_s", delay)
        try:
            center_wait = float(center_wait_raw)
        except (TypeError, ValueError):
            center_wait = float(delay)

        await asyncio.sleep(center_wait)

        # DUT (BLE)
        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            # Modem on + safety abort
            # Modem on step (visible in UI)
            yield step("modemOn", "start", message="Turning LTE modem on")
            await dut_call(dut, "lte_modem_on")
            await dut_call(dut, "lte_abort_test")
            yield step("modemOn", "done")  

            # CW on
            yield step("cwOn", "start", message=f"CW @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
            await dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lte_cw_on_s", 0.40)))
            yield step("cwOn", "done")

            # Zoom passes from YAML (or fallback)
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

            # Measure marker frequency and compute error/ppm
            yield step("measure", "start", message="Read marker frequency + compute error/ppm")
            f1 = await spec_call(spec.get_marker_frequency, marker)
            await asyncio.sleep(delay)
            f2 = await spec_call(spec.get_marker_frequency, marker)
            measured_hz = int(round(float(num(f2 or f1))))
            error_hz = int(measured_hz - int(freq_hz))
            error_ppm = (float(error_hz) / float(freq_hz)) * 1e6 if freq_hz else None
            passed = (abs(error_ppm) <= float(ppm_limit)) if (ppm_limit is not None and error_ppm is not None) else None

            yield step("measure", "done", measuredHz=measured_hz, errorHz=error_hz, errorPpm=error_ppm)
            yield step("cwOff", "done", message="Turning CW off")
            yield evt("result", measuredHz=measured_hz, errorHz=error_hz, errorPpm=error_ppm, pass_=passed)

            # Fast modem stop
            try:
                await dut_call(dut, "lte_abort_test")
                await dut_call(dut, "lte_modem_off")
            except Exception:
                pass

    except asyncio.CancelledError:
        # Abort: background BLE + analyzer disconnect (fast)
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        yield evt("done", ok=True)
