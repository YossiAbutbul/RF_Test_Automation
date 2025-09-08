# backend/services/tests_runner.py
from __future__ import annotations
import asyncio
import re
from typing import AsyncGenerator, Dict, Optional
from contextlib import contextmanager

from services.spectrum_service import ensure_analyzer
from services.dut_ble_service import DUTBLE

_NUM_RE = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")
def _num(s: str) -> float:
    m = _NUM_RE.search(str(s))
    if not m:
        raise ValueError(f"Cannot parse number from: {s!r}")
    return float(m.group(0))

@contextmanager
def managed_ble(mac: str):
    dut = DUTBLE(mac)
    try:
        dut.connect()
        yield dut
    finally:
        try:
            dut.disconnect()
        except Exception:
            pass

async def _spec_call(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)

async def _dut_call(dut: DUTBLE, method: str, *args, **kwargs):
    return await asyncio.to_thread(getattr(dut, method), *args, **kwargs)

def _evt(type_: str, **data) -> Dict:
    return {"type": type_, **data}

async def run_tx_power(
    *,
    freq_hz: int,
    power_dbm: int,
    mac: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> Dict:
    measured = None
    try:
        spec = ensure_analyzer()  # auto-connect if needed

        # Configure analyzer (your driver API, units "HZ")
        await _spec_call(spec.set_center_frequency, freq_hz, "HZ")
        await _spec_call(spec.set_span, 5_000_000, "HZ")
        try:    await _spec_call(spec.set_rbw, 100_000, "HZ")
        except: pass
        try:    await _spec_call(spec.set_vbw, 100_000, "HZ")
        except: pass
        try:    await _spec_call(spec.set_ref_level, 0.0)
        except: pass
        try:    await _spec_call(spec.set_ref_level_offset, 20.5)
        except: pass
        try:    await _spec_call(spec.set_peak_detector)
        except: pass

        with managed_ble(mac) as dut:
            await _dut_call(dut, "cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(0.6)

            await _spec_call(spec.peak_search, "MARK1")
            pow_str = await _spec_call(spec.get_marker_power, "MARK1")
            measured = _num(pow_str)

    except Exception as e:
        return {"ok": False, "error": str(e)}

    passed: Optional[bool] = None
    if measured is not None and (min_value is not None or max_value is not None):
        ok_min = (min_value is None) or (measured >= min_value)
        ok_max = (max_value is None) or (measured <= max_value)
        passed = ok_min and ok_max

    return {"ok": True, "measuredDbm": measured, "pass": passed}

async def run_tx_power_stream(
    *,
    freq_hz: int,
    power_dbm: int,
    mac: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra):
        return _evt("step", key=key, status=status, **extra)

    try:
        # first event for the UI
        yield _evt("start", test="tx-power", params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm})

        # Analyzer (auto-connect on first use)
        yield step("connectAnalyzer", "start", message="Ensure analyzer is connected")
        spec = ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        # Configure analyzer
        yield step("configureAnalyzer", "start", message=f"set_center_frequency({freq_hz}, 'HZ')")
        await _spec_call(spec.set_center_frequency, freq_hz, "HZ")
        yield _evt("log", message="set_span(5000000, 'HZ')")
        await _spec_call(spec.set_span, 5_000_000, "HZ")
        if hasattr(spec, "set_rbw"):
            yield _evt("log", message="set_rbw(100000, 'HZ')")
            try: await _spec_call(spec.set_rbw, 100_000, "HZ")
            except Exception: pass
        if hasattr(spec, "set_vbw"):
            yield _evt("log", message="set_vbw(100000, 'HZ')")
            try: await _spec_call(spec.set_vbw, 100_000, "HZ")
            except Exception: pass
        if hasattr(spec, "set_ref_level"):
            yield _evt("log", message="set_ref_level(20.0)")
            try: await _spec_call(spec.set_ref_level, 20.0)
            except Exception: pass
        if hasattr(spec, "set_ref_level_offset"):
            yield _evt("log", message="set_ref_level_offset(20.5)")
            try: await _spec_call(spec.set_ref_level_offset, 20.5)
            except Exception: pass
        if hasattr(spec, "set_peak_detector"):
            yield _evt("log", message="set_peak_detector()")
            try: await _spec_call(spec.set_peak_detector)
            except Exception: pass
        yield step("configureAnalyzer", "done")

        # DUT CW
        yield step("connectDut", "start", message=f"Connecting to DUT {mac}")
        with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield step("cwOn", "start", message=f"cw_on(freq_hz={freq_hz}, power_dbm={power_dbm})")
            await _dut_call(dut, "cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(0.6)
            yield step("cwOn", "done")

            # Measure
            yield step("measure", "start", message="peak_search('MARK1') → get_marker_power('MARK1')")
            await _spec_call(spec.peak_search, "MARK1")
            pow_str = await _spec_call(spec.get_marker_power, "MARK1")
            measured = _num(pow_str)
            yield step("measure", "done", measuredDbm=measured)

            passed: Optional[bool] = None
            if measured is not None and (min_value is not None or max_value is not None):
                ok_min = (min_value is None) or (measured >= min_value)
                ok_max = (max_value is None) or (measured <= max_value)
                passed = ok_min and ok_max

            yield _evt("result", measuredDbm=measured, pass_=passed)

            # ---- New step: CW OFF after measurement ----
            yield _evt("step", key="cwOff", status="start", message="Turning off CW.")
            try:
                await _dut_call(dut, "cw_off")
                yield _evt("step", key="cwOff", status="done")
            except Exception as e:
                yield _evt("step", key="cwOff", status="error", message=str(e))


    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)
