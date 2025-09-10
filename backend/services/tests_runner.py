# backend/services/tests_runner.py
from __future__ import annotations
import asyncio
import re
from typing import AsyncGenerator, Dict, Optional
from contextlib import contextmanager

from services.spectrum_service import ensure_analyzer
from services.dut_ble_service import DUTBLE
from services.test_config import (
    get_test_config,
    get_marker_name,
    get_default_delay_s,
)

# ---------- shared helpers ----------

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

# =====================================================================================
# Tx Power (existing behavior; now reads analyzer setup from config if present)
# =====================================================================================

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

        # ----- Config -----
        tx_cfg = get_test_config("tx_power")
        setup = tx_cfg.get("analyzer_setup", {})
        settle_cfg = tx_cfg.get("settle", {})
        marker = get_marker_name()
        default_delay = get_default_delay_s()

        # ----- Analyzer setup -----
        await _spec_call(spec.set_center_frequency, freq_hz, "HZ")
        await asyncio.sleep(float(settle_cfg.get("after_center_s", 0.0)))

        # Use configured values when available (fall back to previous defaults)
        span_hz = int(setup.get("span_hz", 5_000_000))
        await _spec_call(spec.set_span, span_hz, "HZ")

        rbw_hz = setup.get("rbw_hz", None)
        if rbw_hz is not None:
            try: await _spec_call(spec.set_rbw, int(rbw_hz), "HZ")
            except Exception: pass

        vbw_hz = setup.get("vbw_hz", None)
        if vbw_hz is not None:
            try: await _spec_call(spec.set_vbw, int(vbw_hz), "HZ")
            except Exception: pass

        if setup.get("ref_level_dbm") is not None:
            try: await _spec_call(spec.set_ref_level, float(setup["ref_level_dbm"]))
            except Exception: pass

        if setup.get("ref_offset_db") is not None:
            try: await _spec_call(spec.set_ref_level_offset, float(setup["ref_offset_db"]))
            except Exception: pass

        if setup.get("use_peak_detector", True):
            try: await _spec_call(spec.set_peak_detector)
            except Exception: pass

        # ----- DUT & measure -----
        with managed_ble(mac) as dut:
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(settle_cfg.get("after_lora_cw_on_s", 0.6)))

            await _spec_call(spec.peak_search, marker); await asyncio.sleep(default_delay)
            pow_str = await _spec_call(spec.get_marker_power, marker)
            measured = _num(pow_str)

            # best-effort CW off
            try:
                await _dut_call(dut, "lora_cw_off")
            except Exception:
                pass

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
        yield _evt("start", test="tx-power", params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm})

        tx_cfg = get_test_config("tx_power")
        setup = tx_cfg.get("analyzer_setup", {})
        settle_cfg = tx_cfg.get("settle", {})
        marker = get_marker_name()
        default_delay = get_default_delay_s()

        # Analyzer
        yield step("connectAnalyzer", "start", message="Ensure analyzer is connected")
        spec = ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        # Configure analyzer from config
        yield step("configureAnalyzer", "start", message=f"set_center_frequency({freq_hz}, 'HZ')")
        await _spec_call(spec.set_center_frequency, freq_hz, "HZ")
        await asyncio.sleep(float(settle_cfg.get("after_center_s", 0.0)))

        span_hz = int(setup.get("span_hz", 5_000_000))
        await _spec_call(spec.set_span, span_hz, "HZ")
        if setup.get("rbw_hz") is not None:
            try: await _spec_call(spec.set_rbw, int(setup["rbw_hz"]), "HZ")
            except Exception: pass
        if setup.get("vbw_hz") is not None:
            try: await _spec_call(spec.set_vbw, int(setup["vbw_hz"]), "HZ")
            except Exception: pass
        if setup.get("ref_level_dbm") is not None:
            try: await _spec_call(spec.set_ref_level, float(setup["ref_level_dbm"]))
            except Exception: pass
        if setup.get("ref_offset_db") is not None:
            try: await _spec_call(spec.set_ref_level_offset, float(setup["ref_offset_db"]))
            except Exception: pass
        if setup.get("use_peak_detector", True):
            try: await _spec_call(spec.set_peak_detector)
            except Exception: pass
        yield step("configureAnalyzer", "done")

        # DUT CW
        yield step("connectDut", "start", message=f"Connecting to DUT {mac}")
        with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield step("cwOn", "start", message=f"CW on @ {freq_hz} Hz, {power_dbm} dBm")
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(settle_cfg.get("after_lora_cw_on_s", 0.6)))
            yield step("cwOn", "done")

            # Measure
            yield step("measure", "start", message=f"peak_search('{marker}') → get_marker_power('{marker}')")
            await _spec_call(spec.peak_search, marker); await asyncio.sleep(default_delay)
            pow_str = await _spec_call(spec.get_marker_power, marker)
            measured = _num(pow_str)
            yield step("measure", "done", measuredDbm=measured)

            passed: Optional[bool] = None
            if measured is not None and (min_value is not None or max_value is not None):
                ok_min = (min_value is None) or (measured >= min_value)
                ok_max = (max_value is None) or (measured <= max_value)
                passed = ok_min and ok_max

            yield _evt("result", measuredDbm=measured, pass_=passed)

            # CW OFF
            yield _evt("step", key="cwOff", status="start", message="Turning off CW.")
            try:
                await _dut_call(dut, "lora_cw_off")
                yield _evt("step", key="cwOff", status="done")
            except Exception as e:
                yield _evt("step", key="cwOff", status="error", message=str(e))

    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)

# =====================================================================================
# Frequency Accuracy (now fully config-driven)
# =====================================================================================

async def _zoom_and_center(
    spec,
    *,
    span_hz: int,
    rbw_hz: int,
    vbw_hz: int,
    marker: str,
    delay: float,
):
    # Order: span → RBW → VBW → peak → marker->center, with delays after each
    await _spec_call(spec.set_span, span_hz, "HZ");  await asyncio.sleep(delay)
    await _spec_call(spec.set_rbw,  rbw_hz,  "HZ");  await asyncio.sleep(delay)
    await _spec_call(spec.set_vbw,  vbw_hz,  "HZ");  await asyncio.sleep(delay)
    await _spec_call(spec.peak_search, marker);      await asyncio.sleep(delay)

    if hasattr(spec, "set_marker_to_center_frequency"):
        try:
            await _spec_call(spec.set_marker_to_center_frequency, marker)
        except Exception:
            pass
    else:
        # Optional: fall back if you exposed SCPI cmd builder on spec
        try:
            await _spec_call(spec.send_and_wait, spec.cmd.build("set_marker_to_center_frequency", mark_name=marker))
        except Exception:
            pass
    await asyncio.sleep(delay)

async def run_freq_accuracy(
    *,
    freq_hz: int,
    power_dbm: int,
    mac: str,
    ppm_limit: Optional[float] = None,
) -> Dict:
    measured_hz = None
    try:
        spec = ensure_analyzer()

        cfg = get_test_config("frequency_accuracy")
        base = cfg.get("base", {})
        zooms = cfg.get("zooms", [])
        marker = get_marker_name()
        default_delay = get_default_delay_s()

        # Baseline config
        await _spec_call(spec.set_center_frequency, freq_hz, "HZ")
        await asyncio.sleep(float(base.get("settle_after_center_s", 0.10)))
        if base.get("use_peak_detector", True):
            try: await _spec_call(spec.set_peak_detector)
            except Exception: pass

        with managed_ble(mac) as dut:
            # CW ON
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lora_cw_on_s", 0.30)))

            # Zooms
            for z in zooms:
                await _zoom_and_center(
                    spec,
                    span_hz=int(z["span_hz"]),
                    rbw_hz=int(z["rbw_hz"]),
                    vbw_hz=int(z["vbw_hz"]),
                    marker=marker,
                    delay=float(z.get("delay_s", default_delay)),
                )

            # Measure
            f_str = await _spec_call(spec.get_marker_frequency, marker)
            measured_hz = int(round(_num(f_str)))

            # CW OFF after full cycle
            try:
                await _dut_call(dut, "lora_cw_off")
            except Exception:
                pass

    except Exception as e:
        return {"ok": False, "error": str(e)}

    err_hz = (measured_hz - freq_hz) if measured_hz is not None else None
    err_ppm = (1e6 * err_hz / freq_hz) if (err_hz is not None and freq_hz) else None

    passed: Optional[bool] = None
    if ppm_limit is not None and err_ppm is not None:
        passed = abs(err_ppm) <= ppm_limit

    return {"ok": True, "measuredHz": measured_hz, "errorHz": err_hz, "errorPpm": err_ppm, "pass": passed}


async def run_freq_accuracy_stream(
    *,
    freq_hz: int,
    power_dbm: int,
    mac: str,
    ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra):
        return _evt("step", key=key, status=status, **extra)

    try:
        cfg = get_test_config("frequency_accuracy")
        base = cfg.get("base", {})
        zooms = cfg.get("zooms", [])
        marker = get_marker_name()
        default_delay = get_default_delay_s()

        yield _evt("start", test="freq-accuracy", params={
            "mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm, "ppm_limit": ppm_limit
        })

        # Analyzer
        yield step("connectAnalyzer", "start", message="Ensure analyzer is connected")
        spec = ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        # Baseline config
        yield step("configureAnalyzer", "start", message=f"set_center_frequency({freq_hz}, 'HZ')")
        await _spec_call(spec.set_center_frequency, freq_hz, "HZ")
        await asyncio.sleep(float(base.get("settle_after_center_s", 1.0)))
        if base.get("use_peak_detector", True):
            try: await _spec_call(spec.set_peak_detector)
            except Exception: pass
        yield step("configureAnalyzer", "done")

        # DUT CW
        yield step("connectDut", "start", message=f"Connecting to DUT {mac}")
        with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield step("cwOn", "start", message=f"CW on @ {freq_hz} Hz, {power_dbm} dBm")
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lora_cw_on_s", 0.30)))
            yield step("cwOn", "done")

            # Zooms (log each profile)
            for idx, z in enumerate(zooms, start=1):
                span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"])
                delay = float(z.get("delay_s", default_delay))
                yield _evt("log", message=f"Zoom {idx} → span={span_hz} Hz, RBW={rbw_hz} Hz, VBW={vbw_hz} Hz (peak → center)")
                await _zoom_and_center(
                    spec,
                    span_hz=span_hz,
                    rbw_hz=rbw_hz,
                    vbw_hz=vbw_hz,
                    marker=marker,
                    delay=delay,
                )

            # Measure & result
            yield step("measure", "start", message=f"get_marker_frequency('{marker}')")
            f_str = await _spec_call(spec.get_marker_frequency, marker)
            measured_hz = int(round(_num(f_str)))
            err_hz = measured_hz - freq_hz
            err_ppm = 1e6 * err_hz / freq_hz if freq_hz else 0.0
            yield step("measure", "done", measuredHz=measured_hz, errorHz=err_hz, errorPpm=err_ppm)

            pass_val: Optional[bool] = None
            if ppm_limit is not None:
                pass_val = abs(err_ppm) <= ppm_limit

            yield _evt("result", measuredHz=measured_hz, errorHz=err_hz, errorPpm=err_ppm, pass_=pass_val)

            # CW OFF only after the full cycle
            yield _evt("step", key="cwOff", status="start", message="Turning off CW.")
            try:
                await _dut_call(dut, "lora_cw_off")
                yield _evt("step", key="cwOff", status="done")
            except Exception as e:
                yield _evt("step", key="cwOff", status="error", message=str(e))

    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)
