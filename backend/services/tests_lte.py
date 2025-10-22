# backend/services/tests_lte.py
from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, Any, Tuple, List, Callable

from services.tests_common import (
    # event helpers
    evt, num,
    # analyzer helpers
    ensure_analyzer_async, spec_call, apply_analyzer_setup, zoom_and_center,
    get_global_analyzer_ref_offset_db,
    # DUT (BLE) helpers
    managed_ble, dut_call,
    # background cleanup utilities
    background_abort_ble, background_tidy_spectrum,
    # constants
    CLOSE_SPEC_TIMEOUT,
)
from services.test_config import (
    get_test_config,
    get_marker_name,
    get_default_delay_s,
)

# --------------------------------------------------------------------------------------
# LTE EARFCN / frequency helpers
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
    Accept either an EARFCN or an exact center frequency in Hz and return both.
    Allows a small ±2 kHz tolerance for frequency lookups.
    """
    lte_map = _normalize_lte_map(lte_map_raw)
    if not lte_map:
        raise ValueError("LTE map is empty. Check tests.yaml: tests.lte_earfcn_map.")
    val = int(value)
    if val in lte_map:
        return val, int(lte_map[val])
    for earfcn, f_hz in lte_map.items():
        if int(f_hz) == val or abs(int(f_hz) - val) <= 2_000:
            return int(earfcn), int(f_hz)
    raise ValueError(f"Unsupported LTE EARFCN/frequency: {val}")

# --------------------------------------------------------------------------------------
# Small utilities (retry, error messages)
# --------------------------------------------------------------------------------------

async def _retry(label: str, fn: Callable[[], Any], *, attempts: int = 2, delay_s: float = 0.20):
    """
    Very small retry wrapper used for fragile DUT commands (modem_on, cw_on).
    """
    last = None
    for i in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as e:
            last = e
            if i < attempts:
                await asyncio.sleep(delay_s)
    raise last or RuntimeError(f"{label} failed")

def _pretty_err(e: Exception) -> str:
    """
    Ensure non-empty, human-friendly error text for the UI.
    """
    s = (str(e) or "").strip()
    r = repr(e)
    if not s:
        s = e.__class__.__name__
    if "HwtpStatus" in s or "HwtpStatus" in r:
        return f"DUT transport error (HWTP): {s or r}"
    if "Timeout" in s or "timeout" in s.lower():
        return f"BLE connect/command timeout: {s or r}"
    return s or r

# ======================================================================================
# LTE — Tx Power
# ======================================================================================

async def run_lte_tx_power(
    *, earfcn: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> Dict[str, Any]:
    result: Optional[Dict[str, Any]] = None
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
    SSE order (aligned to LoRa, and unchanged):
      1) connectDut → 2) modemOn → 3) abortTest → 4) cwOn
      5) measure → 6) abortTest → 7) modemOff → 8) disconnectDut → 9) result
    """
    def step(key: str, status: str = "start", **extra): 
        return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay  = get_default_delay_s()
    lte_def = get_test_config("lte_defaults") or {}
    setup   = (lte_def.get("analyzer_setup") or {}) if isinstance(lte_def, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()

    spec = None
    modem_on_done = False
    cw_on = False
    cleanup_done = False

    try:
        # Resolve mapping/log fields
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        yield evt("start", test="lte-tx-power",
                  params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec, center_hz=int(freq_hz), setup=setup, analyzer_ref_offset_db=ref_off
        )
        yield step(
            "configureAnalyzer", "done",
            message=(f"Analyzer cfg center={eff['center_hz']/1e6:.1f}MHz "
                     f"span={eff.get('span_hz',0)/1e6:.1f}MHz "
                     f"rbw={eff.get('rbw_hz',0)/1e3:.1f}KHz "
                     f"vbw={eff.get('vbw_hz',0)/1e3:.1f}KHz "
                     f"ref_off={eff.get('analyzer_ref_offset_db')}dB")
        )
        await asyncio.sleep(float(lte_def.get("settle_after_center_s", delay)))

        # DUT — connect, then steps
        yield step("connectDut", "start", message=f"DUT {mac}")
        try:
            async with managed_ble(mac) as dut:
                # 1) Connected — no handshake (per your request)
                yield step("connectDut", "done", message=f"BLE connected {mac}")

                # 2) modem on
                yield step("modemOn", "start", message="Turning LTE modem on")
                await _retry("lte_modem_on", lambda: dut_call(dut, "lte_modem_on"), attempts=2, delay_s=0.25)
                modem_on_done = True
                yield step("modemOn", "done")

                # 3) safety abort (ONLY valid when modem is ON)
                yield step("abortTest", "start", message="LTE abort (safety)")
                try:
                    await dut_call(dut, "lte_abort_test")
                except Exception:
                    # some stacks may report no-op if no TX yet; ignore
                    pass
                yield step("abortTest", "done")

                # 4) CW on
                yield step("cwOn", "start", message=f"CW on @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
                await _retry(
                    "lte_cw_on",
                    lambda: dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm),
                    attempts=2, delay_s=0.25
                )
                await asyncio.sleep(float(lte_def.get("settle_after_cw_on_s", 0.40)))
                cw_on = True
                yield step("cwOn", "done")

                # 5) Measure (no DUT calls during measurement)
                yield step("measure", "start", message="Peak search + read marker power")
                await spec_call(spec.peak_search, marker)
                await asyncio.sleep(delay)
                pow_str = await spec_call(spec.get_marker_power, marker)
                measured = float(num(pow_str))
                yield step("measure", "done", measuredDbm=measured)

                # 6) abort (only if modem was ON)
                if modem_on_done:
                    yield step("abortTest", "start", message="LTE abort")
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        pass
                    yield step("abortTest", "done")

                    # indicate CW is off for UI icon
                    yield step("cwOff", "start", message="Turning off CW")
                    yield step("cwOff", "done", message="CW off")

                # 7) modem off (only if modem was ON)
                if modem_on_done:
                    yield step("modemOff", "start", message="LTE modem off")
                    try:
                        await dut_call(dut, "lte_modem_off")
                    except Exception:
                        pass
                    yield step("modemOff", "done")

                # 8) disconnect
                yield step("disconnectDut", "start", message="BLE disconnect")
                try:
                    await dut_call(dut, "disconnect", timeout=1.5)
                except Exception:
                    pass
                yield step("disconnectDut", "done")
                cleanup_done = True

                # 9) result
                if min_value is None and max_value is None:
                    passed = None
                else:
                    lower_ok = True if min_value is None else (measured >= float(min_value))
                    upper_ok = True if max_value is None else (measured <= float(max_value))
                    passed = lower_ok and upper_ok
                yield evt("result", measuredDbm=measured, pass_=passed)

        except Exception as e:
            # Fail inside connect/modem/cw/measure before cleanup
            if modem_on_done and not cleanup_done:
                # We only attempt abort if modem was on; if CW is on, abort stops TX.
                if cw_on:
                    yield evt("step", key="abortTest", status="start", message="LTE abort")
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        # if BLE already dropped, stop TX in background
                        if mac:
                            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
                    yield evt("step", key="abortTest", status="done")

                # modem off (only if modem was on)
                yield evt("step", key="modemOff", status="start", message="LTE modem off")
                # best effort; if link dropped, just show step done
                try:
                    await dut_call(dut, "lte_modem_off")
                except Exception:
                    pass
                yield evt("step", key="modemOff", status="done")

                # disconnect (best-effort)
                yield evt("step", key="disconnectDut", status="start", message="BLE disconnect")
                try:
                    await dut_call(dut, "disconnect", timeout=1.5)
                except Exception:
                    pass
                yield evt("step", key="disconnectDut", status="done")

            yield evt("error", error=_pretty_err(e))

    except asyncio.CancelledError:
        # on cancel, clean up analyzer & try to stop TX
        if mac and modem_on_done:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    finally:
        yield evt("done", ok=True)

# ======================================================================================
# LTE — Frequency Accuracy
# ======================================================================================

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
    result: Optional[Dict[str, Any]] = None
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
    SSE order (aligned to LoRa, and unchanged):
      1) connectDut → 2) modemOn → 3) abortTest → 4) cwOn
      5) zooms + measure → 6) abortTest → 7) modemOff → 8) disconnectDut → 9) result
    """
    def step(key: str, status: str = "start", **extra): 
        return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay  = get_default_delay_s()
    cfg    = get_test_config("lte_frequency_accuracy") or {}
    setup  = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    base   = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()
    zooms  = _load_lte_zooms(delay_default=delay)

    spec = None
    modem_on_done = False
    cw_on = False
    cleanup_done = False

    try:
        # Resolve mapping/log fields
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        yield evt("start", test="lte-frequency-accuracy",
                  params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec, center_hz=int(freq_hz), setup=setup, analyzer_ref_offset_db=ref_off
        )
        yield step("configureAnalyzer", "done", message=f"Analyzer cfg center={eff['center_hz']/1e6:.1f}MHz")

        center_wait_raw = (cfg.get("settle") or {}).get("after_center_s")
        if center_wait_raw is None:
            center_wait_raw = base.get("settle_after_center_s", delay)
        try:
            center_wait = float(center_wait_raw)
        except (TypeError, ValueError):
            center_wait = float(delay)
        await asyncio.sleep(center_wait)

        # DUT — connect, then steps
        yield step("connectDut", "start", message=f"DUT {mac}")
        try:
            async with managed_ble(mac) as dut:
                # 1) Connected — no handshake (per your request)
                yield step("connectDut", "done", message=f"BLE connected {mac}")

                # 2) modem on
                yield step("modemOn", "start", message="Turning LTE modem on")
                await _retry("lte_modem_on", lambda: dut_call(dut, "lte_modem_on"), attempts=2, delay_s=0.25)
                modem_on_done = True
                yield step("modemOn", "done")

                # 3) safety abort (ONLY valid when modem is ON)
                yield step("abortTest", "start", message="LTE abort (safety)")
                try:
                    await dut_call(dut, "lte_abort_test")
                except Exception:
                    pass
                yield step("abortTest", "done")

                # 4) CW on
                yield step("cwOn", "start", message=f"CW @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
                await _retry(
                    "lte_cw_on",
                    lambda: dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm),
                    attempts=2, delay_s=0.25
                )
                await asyncio.sleep(float(base.get("settle_after_lte_cw_on_s", 0.40)))
                cw_on = True
                yield step("cwOn", "done")

                # 5) zooms + measure (no DUT calls during zooms/measure)
                total = len(zooms)
                for i, z in enumerate(zooms, 1):
                    span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"]); d = float(z.get("delay_s", delay))
                    yield evt("log", message=f"Zoom {i}/{total} → span={span_hz/1e6}MHz rbw={rbw_hz/1e3}KHz vbw={vbw_hz/1e3}KHz")
                    await zoom_and_center(spec, span_hz=span_hz, rbw_hz=rbw_hz, vbw_hz=vbw_hz, marker=marker, delay=d)

                yield step("measure", "start", message="Read marker frequency + compute error/ppm")
                f1 = await spec_call(spec.get_marker_frequency, marker)
                await asyncio.sleep(delay)
                f2 = await spec_call(spec.get_marker_frequency, marker)
                measured_hz = int(round(float(num(f2 or f1))))
                error_hz = int(measured_hz - int(freq_hz))
                error_ppm = (float(error_hz) / float(freq_hz)) * 1e6 if freq_hz else None
                yield step("measure", "done", measuredHz=measured_hz, errorHz=error_hz, errorPpm=error_ppm)

                # 6) abort (only if modem was ON)
                if modem_on_done:
                    yield step("abortTest", "start", message="LTE abort")
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        pass
                    yield step("abortTest", "done")

                # 7) modem off (only if modem was ON)
                if modem_on_done:
                    yield step("modemOff", "start", message="LTE modem off")
                    try:
                        await dut_call(dut, "lte_modem_off")
                    except Exception:
                        pass
                    yield step("modemOff", "done")

                # 8) disconnect
                yield step("disconnectDut", "start", message="BLE disconnect")
                try:
                    await dut_call(dut, "disconnect", timeout=1.5)
                except Exception:
                    pass
                yield step("disconnectDut", "done")
                cleanup_done = True

                # 9) result
                passed = (abs(error_ppm) <= float(ppm_limit)) if (ppm_limit is not None and error_ppm is not None) else None
                yield evt("result", measuredHz=measured_hz, errorHz=error_hz, errorPpm=error_ppm, pass_=passed)

        except Exception as e:
            # Fail inside connect/modem/cw/measure before cleanup
            if modem_on_done and not cleanup_done:
                # If CW is on, try to abort to stop TX.
                if cw_on:
                    yield evt("step", key="abortTest", status="start", message="LTE abort")
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        if mac:
                            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
                    yield evt("step", key="abortTest", status="done")

                # modem off (only if modem was on)
                yield evt("step", key="modemOff", status="start", message="LTE modem off")
                try:
                    await dut_call(dut, "lte_modem_off")
                except Exception:
                    pass
                yield evt("step", key="modemOff", status="done")

                # disconnect (best-effort)
                yield evt("step", key="disconnectDut", status="start", message="BLE disconnect")
                try:
                    await dut_call(dut, "disconnect", timeout=1.5)
                except Exception:
                    pass
                yield evt("step", key="disconnectDut", status="done")

            yield evt("error", error=_pretty_err(e))

    except asyncio.CancelledError:
        # on cancel, clean up analyzer & try to stop TX
        if mac and modem_on_done:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    finally:
        yield evt("done", ok=True)
# ======================================================================================


# ======================================================================================
# LTE — Frequency Accuracy
# ======================================================================================

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
    result: Optional[Dict[str, Any]] = None
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
    SSE order (aligned to LoRa, and unchanged):
      1) connectDut → 2) modemOn → 3) abortTest → 4) cwOn
      5) zooms + measure → 6) abortTest → 7) modemOff → 8) disconnectDut → 9) result
    """
    def step(key: str, status: str = "start", **extra): 
        return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay  = get_default_delay_s()
    cfg    = get_test_config("lte_frequency_accuracy") or {}
    setup  = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    base   = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()
    zooms  = _load_lte_zooms(delay_default=delay)

    spec = None
    modem_on_done = False
    cw_on = False
    cleanup_done = False

    try:
        # Resolve mapping/log fields
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        yield evt("start", test="lte-frequency-accuracy",
                  params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec, center_hz=int(freq_hz), setup=setup, analyzer_ref_offset_db=ref_off
        )
        yield step("configureAnalyzer", "done", message=f"Analyzer cfg center={eff['center_hz']/1e6:.1f}MHz")

        center_wait_raw = (cfg.get("settle") or {}).get("after_center_s")
        if center_wait_raw is None:
            center_wait_raw = base.get("settle_after_center_s", delay)
        try:
            center_wait = float(center_wait_raw)
        except (TypeError, ValueError):
            center_wait = float(delay)
        await asyncio.sleep(center_wait)

        # DUT — connect, then steps
        yield step("connectDut", "start", message=f"DUT {mac}")
        try:
            async with managed_ble(mac) as dut:
                # 1) Connected — no handshake (per your request)
                yield step("connectDut", "done", message=f"BLE connected {mac}")

                # 2) modem on
                yield step("modemOn", "start", message="Turning LTE modem on")
                await _retry("lte_modem_on", lambda: dut_call(dut, "lte_modem_on"), attempts=2, delay_s=0.25)
                modem_on_done = True
                yield step("modemOn", "done")

                # 3) safety abort (ONLY valid when modem is ON)
                yield step("abortTest", "start", message="LTE abort (safety)")
                try:
                    await dut_call(dut, "lte_abort_test")
                except Exception:
                    pass
                yield step("abortTest", "done")

                # 4) CW on
                yield step("cwOn", "start", message=f"CW @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
                await _retry(
                    "lte_cw_on",
                    lambda: dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm),
                    attempts=2, delay_s=0.25
                )
                await asyncio.sleep(float(base.get("settle_after_lte_cw_on_s", 0.40)))
                cw_on = True
                yield step("cwOn", "done")

                # 5) zooms + measure (no DUT calls during zooms/measure)
                total = len(zooms)
                for i, z in enumerate(zooms, 1):
                    span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"]); d = float(z.get("delay_s", delay))
                    yield evt("log", message=f"Zoom {i}/{total} → span={span_hz/1e6}MHz rbw={rbw_hz/1e3}KHz vbw={vbw_hz/1e3}KHz")
                    await zoom_and_center(spec, span_hz=span_hz, rbw_hz=rbw_hz, vbw_hz=vbw_hz, marker=marker, delay=d)

                yield step("measure", "start", message="Read marker frequency + compute error/ppm")
                f1 = await spec_call(spec.get_marker_frequency, marker)
                await asyncio.sleep(delay)
                f2 = await spec_call(spec.get_marker_frequency, marker)
                measured_hz = int(round(float(num(f2 or f1))))
                error_hz = int(measured_hz - int(freq_hz))
                error_ppm = (float(error_hz) / float(freq_hz)) * 1e6 if freq_hz else None
                yield step("measure", "done", measuredHz=measured_hz, errorHz=error_hz, errorPpm=error_ppm)

                # 6) abort (only if modem was ON)
                if modem_on_done:
                    yield step("abortTest", "start", message="LTE abort")
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        pass
                    yield step("abortTest", "done")

                    # indicate CW is off for UI icon
                    yield step("cwOff", "start", message="Turning off CW")
                    yield step("cwOff", "done", message="CW off")

                # 7) modem off (only if modem was ON)
                if modem_on_done:
                    yield step("modemOff", "start", message="LTE modem off")
                    try:
                        await dut_call(dut, "lte_modem_off")
                    except Exception:
                        pass
                    yield step("modemOff", "done")

                # 8) disconnect
                yield step("disconnectDut", "start", message="BLE disconnect")
                try:
                    await dut_call(dut, "disconnect", timeout=1.5)
                except Exception:
                    pass
                yield step("disconnectDut", "done")
                cleanup_done = True

                # 9) result
                passed = (abs(error_ppm) <= float(ppm_limit)) if (ppm_limit is not None and error_ppm is not None) else None
                yield evt("result", measuredHz=measured_hz, errorHz=error_hz, errorPpm=error_ppm, pass_=passed)

        except Exception as e:
            # Fail inside connect/modem/cw/measure before cleanup
            if modem_on_done and not cleanup_done:
                if cw_on:
                    yield evt("step", key="abortTest", status="start", message="LTE abort")
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        if mac:
                            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
                    yield evt("step", key="abortTest", status="done")

                yield evt("step", key="modemOff", status="start", message="LTE modem off")
                try:
                    await dut_call(dut, "lte_modem_off")
                except Exception:
                    pass
                yield evt("step", key="modemOff", status="done")

                yield evt("step", key="disconnectDut", status="start", message="BLE disconnect")
                try:
                    await dut_call(dut, "disconnect", timeout=1.5)
                except Exception:
                    pass
                yield evt("step", key="disconnectDut", status="done")

            yield evt("error", error=_pretty_err(e))

    except asyncio.CancelledError:
        # on cancel, clean up analyzer & try to stop TX
        if mac and modem_on_done:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    finally:
        yield evt("done", ok=True)
# ======================================================================================
