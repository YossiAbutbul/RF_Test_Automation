from __future__ import annotations
import asyncio
import re
from typing import AsyncGenerator, Dict, Optional, Tuple, Any, Iterable
from contextlib import asynccontextmanager

from services.spectrum_service import ensure_analyzer
from services.dut_ble_service import DUTBLE
from services.test_config import (
    get_test_config,          # reads cfg["tests"][name]
    get_marker_name,          # reads top-level marker_name
    get_default_delay_s,      # reads top-level default_delay_s
)

# Try to access the full YAML so we can read the global offset.
try:
    from services.test_config import load_config  # type: ignore
except Exception:  # pragma: no cover
    load_config = None  # fallback if not exported

# ========= Timeouts (seconds) =========
DEFAULT_CONNECT_TIMEOUT = 10.0   # analyzer connect
DEFAULT_SPEC_TIMEOUT    = 8.0    # single spectrum analyzer command
DEFAULT_DUT_TIMEOUT     = 8.0    # single BLE/DUT command
CLOSE_DUT_TIMEOUT       = 3.0    # fast close path

# ========= Helpers =========

_NUM_RE = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")
def _num(s: str) -> float:
    m = _NUM_RE.search(str(s))
    if not m:
        raise ValueError(f"Cannot parse number from: {s!r}")
    return float(m.group(0))

def _evt(type_: str, **data) -> Dict:
    return {"type": type_, **data}

async def _ensure_analyzer(timeout: float = DEFAULT_CONNECT_TIMEOUT):
    return await asyncio.wait_for(asyncio.to_thread(ensure_analyzer), timeout=timeout)

async def _spec_call(fn, *args, timeout: float = DEFAULT_SPEC_TIMEOUT, **kwargs):
    return await asyncio.wait_for(asyncio.to_thread(fn, *args, **kwargs), timeout=timeout)

async def _dut_call(dut: DUTBLE, method: str, *args, timeout: float = DEFAULT_DUT_TIMEOUT, **kwargs):
    return await asyncio.wait_for(asyncio.to_thread(getattr(dut, method), *args, **kwargs), timeout=timeout)

@asynccontextmanager
async def managed_ble(mac: str):
    """Async DUT context with connect/disconnect timeouts, so close is fast."""
    dut = DUTBLE(mac)
    try:
        await _dut_call(dut, "connect", timeout=DEFAULT_DUT_TIMEOUT)
        yield dut
    finally:
        try:
            await _dut_call(dut, "disconnect", timeout=CLOSE_DUT_TIMEOUT)
        except Exception:
            pass

def _get_global_ref_offset_db() -> float:
    try:
        if load_config is None:
            return 0.0
        cfg = load_config()
        if isinstance(cfg, dict):
            return float(cfg.get("ref_offset_db", 0) or 0)
    except Exception:
        pass
    return 0.0

async def _apply_analyzer_setup(
    *,
    spec,
    center_hz: int,
    setup: Dict[str, Any] | None,
    ref_offset_db: float,
) -> Dict[str, Any]:
    """Apply analyzer settings & return the effective params for logging."""
    setup = setup or {}
    eff = {
        "center_hz": int(center_hz),
        "span_hz": int(setup.get("span_hz", 5_000_000)) if setup.get("span_hz") is not None else None,
        "rbw_hz":  int(setup.get("rbw_hz")) if setup.get("rbw_hz") is not None else None,
        "vbw_hz":  int(setup.get("vbw_hz")) if setup.get("vbw_hz") is not None else None,
        "ref_level_dbm": float(setup.get("ref_level_dbm")) if setup.get("ref_level_dbm") is not None else None,
        "ref_offset_db": float(ref_offset_db),
        "use_peak_detector": bool(setup.get("use_peak_detector", True)),
    }

    await _spec_call(spec.set_center_frequency, eff["center_hz"], "HZ")

    if eff["span_hz"] is not None:
        await _spec_call(spec.set_span, eff["span_hz"], "HZ")
    if eff["rbw_hz"] is not None:
        try: await _spec_call(spec.set_rbw, eff["rbw_hz"], "HZ")
        except Exception: pass
    if eff["vbw_hz"] is not None:
        try: await _spec_call(spec.set_vbw, eff["vbw_hz"], "HZ")
        except Exception: pass
    if eff["ref_level_dbm"] is not None:
        try: await _spec_call(spec.set_ref_level, eff["ref_level_dbm"])
        except Exception: pass

    # Apply global ref offset for all tests
    try:
        await _spec_call(spec.set_ref_level_offset, eff["ref_offset_db"])
    except Exception:
        pass

    if eff["use_peak_detector"]:
        try: await _spec_call(spec.set_peak_detector)
        except Exception: pass

    return eff

# ========= LTE helpers =========

def _normalize_lte_map(raw: Any) -> Dict[int, int]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[int, int] = {}
    for k, v in raw.items():
        try:
            ek = int(str(k).strip())
            ev = int(float(str(v).strip()))
            out[ek] = ev
        except Exception:
            continue
    return out

def _resolve_earfcn_or_freq(value: int, lte_map_raw: Any) -> Tuple[int, int]:
    lte_map = _normalize_lte_map(lte_map_raw)
    if not lte_map:
        raise ValueError("LTE map is empty. Check config key 'lte_earfcn_map' under tests.yaml:tests.")
    val = int(value)

    # EARFCN given
    if val in lte_map:
        return val, int(lte_map[val])

    # Frequency given
    for earfcn, f_hz in lte_map.items():
        if int(f_hz) == val:
            return int(earfcn), int(f_hz)

    # Small tolerance match (±2 kHz)
    for earfcn, f_hz in lte_map.items():
        if abs(int(f_hz) - val) <= 2_000:
            return int(earfcn), int(f_hz)

    raise ValueError(f"Unsupported LTE EARFCN/frequency: {val}")

# =====================================================================================
# LoRa — Tx Power
# =====================================================================================

async def run_tx_power(
    *, freq_hz: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> Dict:
    measured = None
    try:
        spec = await _ensure_analyzer()
        cfg  = get_test_config("tx_power")
        setup = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        settle = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        # Analyzer setup at start
        await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=setup, ref_offset_db=ref_off)

        # DUT & measure
        async with managed_ble(mac) as dut:
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(settle.get("after_lora_cw_on_s", 0.6)))

            await _spec_call(spec.peak_search, marker); await asyncio.sleep(delay)
            pow_str = await _spec_call(spec.get_marker_power, marker)
            measured = _num(pow_str)

            try: await _dut_call(dut, "lora_cw_off", timeout=CLOSE_DUT_TIMEOUT)
            except Exception: pass

    except asyncio.TimeoutError as te:
        return {"ok": False, "error": f"Timeout: {te}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    passed: Optional[bool] = None
    if measured is not None and (min_value is not None or max_value is not None):
        passed = ((min_value is None) or (measured >= min_value)) and \
                 ((max_value is None) or (measured <= max_value))
    return {"ok": True, "measuredDbm": measured, "pass": passed}


async def run_tx_power_stream(
    *, freq_hz: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra): return _evt("step", key=key, status=status, **extra)

    try:
        yield _evt("start", test="tx-power", params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm})

        cfg  = get_test_config("tx_power")
        setup = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        settle = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        yield step("connectAnalyzer", "start")
        spec = await _ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        # Apply analyzer setup & log all params
        yield step("configureAnalyzer", "start")
        eff = await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=setup, ref_offset_db=ref_off)
        yield _evt("log", message=f"Analyzer: center={eff['center_hz']}Hz span={eff['span_hz']}Hz "
                                  f"RBW={eff['rbw_hz']}Hz VBW={eff['vbw_hz']}Hz "
                                  f"ref={eff['ref_level_dbm']}dBm offset={eff['ref_offset_db']}dB "
                                  f"peakDet={eff['use_peak_detector']}")
        yield step("configureAnalyzer", "done")

        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield step("cwOn", "start", message=f"CW {power_dbm} dBm @ {freq_hz} Hz")
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(settle.get("after_lora_cw_on_s", 0.6)))
            yield step("cwOn", "done")

            yield step("measure", "start")
            await _spec_call(spec.peak_search, marker); await asyncio.sleep(delay)
            pow_str = await _spec_call(spec.get_marker_power, marker)
            measured = _num(pow_str)
            yield step("measure", "done", measuredDbm=measured)

            passed: Optional[bool] = None
            if min_value is not None or max_value is not None:
                passed = ((min_value is None) or (measured >= min_value)) and \
                         ((max_value is None) or (measured <= max_value))
            yield _evt("result", measuredDbm=measured, pass_=passed)

            yield _evt("step", key="cwOff", status="start")
            try:
                await _dut_call(dut, "lora_cw_off", timeout=CLOSE_DUT_TIMEOUT)
                yield _evt("step", key="cwOff", status="done")
            except Exception as e:
                yield _evt("step", key="cwOff", status="error", message=str(e))

    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)

# =====================================================================================
# LoRa — Frequency Accuracy (3 zooms)
# =====================================================================================

_DEFAULT_ZOOMS = [
    {"span_hz": 2_000_000,  "rbw_hz": 30_000, "vbw_hz": 100_000, "delay_s": 0.20},
    {"span_hz": 200_000,    "rbw_hz": 10_000, "vbw_hz": 30_000,  "delay_s": 0.20},
    {"span_hz": 20_000,     "rbw_hz": 1_000,  "vbw_hz": 3_000,   "delay_s": 0.20},
]

async def _zoom_and_center(spec, *, span_hz: int, rbw_hz: int, vbw_hz: int, marker: str, delay: float):
    await _spec_call(spec.set_span, span_hz, "HZ");  await asyncio.sleep(delay)
    await _spec_call(spec.set_rbw,  rbw_hz,  "HZ");  await asyncio.sleep(delay)
    await _spec_call(spec.set_vbw,  vbw_hz,  "HZ");  await asyncio.sleep(delay)
    await _spec_call(spec.peak_search, marker);      await asyncio.sleep(delay)
    try:
        if hasattr(spec, "set_marker_to_center_frequency"):
            await _spec_call(spec.set_marker_to_center_frequency, marker)
        else:
            await _spec_call(spec.send_and_wait, spec.cmd.build("set_marker_to_center_frequency", mark_name=marker))
    except Exception:
        pass
    await asyncio.sleep(delay)

def _first_n(it: Iterable[dict], n: int) -> list[dict]:
    out = []
    for z in it:
        out.append(z)
        if len(out) >= n:
            break
    return out

async def run_freq_accuracy(
    *, freq_hz: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> Dict:
    measured_hz = None
    try:
        spec = await _ensure_analyzer()

        cfg   = get_test_config("frequency_accuracy")
        a_set = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        base  = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
        zooms_cfg = (cfg.get("zooms") or []) if isinstance(cfg, dict) else []
        zooms = _first_n(zooms_cfg if zooms_cfg else _DEFAULT_ZOOMS, 3)
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        # Analyzer initial setup (before zooms)
        await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, ref_offset_db=ref_off)

        async with managed_ble(mac) as dut:
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lora_cw_on_s", 0.40)))

            for z in zooms:
                await _zoom_and_center(
                    spec, span_hz=int(z["span_hz"]), rbw_hz=int(z["rbw_hz"]),
                    vbw_hz=int(z["vbw_hz"]), marker=marker, delay=float(z.get("delay_s", delay)),
                )

            f_str = await _spec_call(spec.get_marker_frequency, marker)
            measured_hz = int(round(_num(f_str)))

            try: await _dut_call(dut, "lora_cw_off", timeout=CLOSE_DUT_TIMEOUT)
            except Exception: pass

    except asyncio.TimeoutError as te:
        return {"ok": False, "error": f"Timeout: {te}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    err_hz = (measured_hz - freq_hz) if measured_hz is not None else None
    err_ppm = (1e6 * err_hz / freq_hz) if (err_hz is not None and freq_hz) else None
    passed: Optional[bool] = None
    if ppm_limit is not None and err_ppm is not None:
        passed = abs(err_ppm) <= ppm_limit
    return {"ok": True, "measuredHz": measured_hz, "errorHz": err_hz, "errorPpm": err_ppm, "pass": passed}


async def run_freq_accuracy_stream(
    *, freq_hz: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra): return _evt("step", key=key, status=status, **extra)

    try:
        cfg   = get_test_config("frequency_accuracy")
        a_set = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        base  = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
        zooms_cfg = (cfg.get("zooms") or []) if isinstance(cfg, dict) else []
        zooms = _first_n(zooms_cfg if zooms_cfg else _DEFAULT_ZOOMS, 3)
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        yield _evt("start", test="freq-accuracy",
                   params={"mac": mac, "freq_hz": freq_hz, "power_dbm": power_dbm, "ppm_limit": ppm_limit})

        yield step("connectAnalyzer", "start")
        spec = await _ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        yield step("configureAnalyzer", "start")
        eff = await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, ref_offset_db=ref_off)
        yield _evt("log", message=f"Analyzer: center={eff['center_hz']}Hz span={eff['span_hz']}Hz "
                                  f"RBW={eff['rbw_hz']}Hz VBW={eff['vbw_hz']}Hz "
                                  f"ref={eff['ref_level_dbm']}dBm offset={eff['ref_offset_db']}dB "
                                  f"peakDet={eff['use_peak_detector']}")
        yield step("configureAnalyzer", "done")

        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield step("cwOn", "start", message=f"CW {power_dbm} dBm @ {freq_hz} Hz")
            await _dut_call(dut, "lora_cw_on", freq_hz=freq_hz, power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lora_cw_on_s", 0.40)))
            yield step("cwOn", "done")

            for idx, z in enumerate(zooms, start=1):
                span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"])
                delay_i = float(z.get("delay_s", delay))
                await _zoom_and_center(spec, span_hz=span_hz, rbw_hz=rbw_hz, vbw_hz=vbw_hz, marker=marker, delay=delay_i)
                yield _evt("log", message=f"Zoom {idx}/3: span={span_hz}Hz RBW={rbw_hz}Hz VBW={vbw_hz}Hz")

            yield step("measure", "start")
            f_str = await _spec_call(spec.get_marker_frequency, marker)
            measured_hz = int(round(_num(f_str)))
            err_hz = measured_hz - freq_hz
            err_ppm = 1e6 * err_hz / freq_hz if freq_hz else 0.0
            yield step("measure", "done", measuredHz=measured_hz, errorHz=err_hz, errorPpm=err_ppm)

            pass_val: Optional[bool] = None
            if ppm_limit is not None:
                pass_val = abs(err_ppm) <= ppm_limit
            yield _evt("result", measuredHz=measured_hz, errorHz=err_hz, errorPpm=err_ppm, pass_=pass_val)

            yield _evt("step", key="cwOff", status="start")
            try:
                await _dut_call(dut, "lora_cw_off", timeout=CLOSE_DUT_TIMEOUT)
                yield _evt("step", key="cwOff", status="done")
            except Exception as e:
                yield _evt("step", key="cwOff", status="error", message=str(e))

    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)

# =====================================================================================
# LTE — Tx Power
# =====================================================================================

async def run_lte_tx_power(
    *, earfcn: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> Dict:
    measured = None
    try:
        spec = await _ensure_analyzer()

        lte_def = get_test_config("lte_defaults") or {}
        a_set = (lte_def.get("analyzer_setup") or {}) if isinstance(lte_def, dict) else {}
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        # Map resolution
        lte_map = get_test_config("lte_earfcn_map")
        earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        # Analyzer setup
        await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, ref_offset_db=ref_off)

        async with managed_ble(mac) as dut:
            await _dut_call(dut, "lte_modem_on")
            await _dut_call(dut, "lte_abort_test")  # between commands

            await _dut_call(dut, "lte_cw_on", earfcn=int(earfcn), power_dbm=power_dbm)
            await asyncio.sleep(float(lte_def.get("settle_after_cw_on_s", 0.3)))

            await _spec_call(spec.peak_search, marker); await asyncio.sleep(delay)
            pow_str = await _spec_call(spec.get_marker_power, marker)
            measured = _num(pow_str)

            try:
                await _dut_call(dut, "lte_abort_test", timeout=CLOSE_DUT_TIMEOUT)
                await _dut_call(dut, "lte_modem_off", timeout=CLOSE_DUT_TIMEOUT)
            except Exception:
                pass

    except asyncio.TimeoutError as te:
        return {"ok": False, "error": f"Timeout: {te}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    passed: Optional[bool] = None
    if measured is not None and (min_value is not None or max_value is not None):
        passed = ((min_value is None) or (measured >= min_value)) and \
                 ((max_value is None) or (measured <= max_value))
    return {"ok": True, "measuredDbm": measured, "pass": passed}


async def run_lte_tx_power_stream(
    *, earfcn: int, power_dbm: int, mac: str,
    min_value: Optional[float] = None, max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra): return _evt("step", key=key, status=status, **extra)

    try:
        lte_def = get_test_config("lte_defaults") or {}
        a_set = (lte_def.get("analyzer_setup") or {}) if isinstance(lte_def, dict) else {}
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        # Resolve map (accept earfcn or frequency)
        lte_map = get_test_config("lte_earfcn_map")
        try:
            resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)
        except Exception:
            yield _evt("log", message=f"LTE map raw={lte_map!r}")
            raise

        yield _evt("start", test="lte-tx-power",
                   params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz, "power_dbm": power_dbm})

        yield step("connectAnalyzer", "start")
        spec = await _ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        yield step("configureAnalyzer", "start")
        eff = await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, ref_offset_db=ref_off)
        yield _evt("log", message=f"Analyzer: center={eff['center_hz']}Hz span={eff['span_hz']}Hz "
                                  f"RBW={eff['rbw_hz']}Hz VBW={eff['vbw_hz']}Hz "
                                  f"ref={eff['ref_level_dbm']}dBm offset={eff['ref_offset_db']}dB "
                                  f"peakDet={eff['use_peak_detector']}")
        yield step("configureAnalyzer", "done")

        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            try:
                yield _evt("log", message="LTE: modem ON")
                await _dut_call(dut, "lte_modem_on")
            except Exception as e:
                yield _evt("error", error=f"LTE Modem on failed: {e!s}")
                return

            yield _evt("log", message="LTE: abort test (between commands)")
            await _dut_call(dut, "lte_abort_test")

            yield step("cwOn", "start", message=f"CW on @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
            await _dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm)
            await asyncio.sleep(float(lte_def.get("settle_after_cw_on_s", 0.3)))
            yield step("cwOn", "done")

            yield step("measure", "start", message=f"peak_search('{marker}') → get_marker_power('{marker}')")
            await _spec_call(spec.peak_search, marker); await asyncio.sleep(delay)
            pow_str = await _spec_call(spec.get_marker_power, marker)
            measured = _num(pow_str)
            yield step("measure", "done", measuredDbm=measured)

            passed: Optional[bool] = None
            if min_value is not None or max_value is not None:
                passed = ((min_value is None) or (measured >= min_value)) and \
                         ((max_value is None) or (measured <= max_value))
            yield _evt("result", measuredDbm=measured, pass_=passed)

            yield _evt("log", message="LTE: abort + modem off")
            try:
                await _dut_call(dut, "lte_abort_test", timeout=CLOSE_DUT_TIMEOUT)
            except Exception as e:
                yield _evt("log", message=f"Abort failed (continuing): {e}")
            try:
                await _dut_call(dut, "lte_modem_off", timeout=CLOSE_DUT_TIMEOUT)
            except Exception as e:
                yield _evt("log", message=f"Modem off failed (continuing): {e}")

            yield _evt("step", key="cwOff", status="done", message="TX stopped")

    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)

# =====================================================================================
# LTE — Frequency Accuracy (NEW)
# =====================================================================================

async def run_lte_frequency_accuracy(
    *, earfcn: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> Dict:
    measured_hz = None
    try:
        spec = await _ensure_analyzer()

        cfg   = get_test_config("lte_frequency_accuracy") or {}
        a_set = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        base  = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
        zooms_cfg = (cfg.get("zooms") or []) if isinstance(cfg, dict) else []
        zooms = _first_n(zooms_cfg if zooms_cfg else _DEFAULT_ZOOMS, 3)
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        # Map resolution (accept earfcn or exact Hz)
        lte_map = get_test_config("lte_earfcn_map")
        earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        # Analyzer initial setup (before zooms)
        await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, ref_offset_db=ref_off)

        async with managed_ble(mac) as dut:
            await _dut_call(dut, "lte_modem_on")
            await _dut_call(dut, "lte_abort_test")  # between commands

            # CW ON (required)
            await _dut_call(dut, "lte_cw_on", earfcn=int(earfcn), power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lte_cw_on_s", 0.40)))

            # 3 zooms to lock peak
            for z in zooms:
                await _zoom_and_center(
                    spec, span_hz=int(z["span_hz"]), rbw_hz=int(z["rbw_hz"]),
                    vbw_hz=int(z["vbw_hz"]), marker=marker, delay=float(z.get("delay_s", delay)),
                )

            # Measure marker frequency
            f_str = await _spec_call(spec.get_marker_frequency, marker)
            measured_hz = int(round(_num(f_str)))

            # Fast close
            try:
                await _dut_call(dut, "lte_abort_test", timeout=CLOSE_DUT_TIMEOUT)
                await _dut_call(dut, "lte_modem_off", timeout=CLOSE_DUT_TIMEOUT)
            except Exception:
                pass

    except asyncio.TimeoutError as te:
        return {"ok": False, "error": f"Timeout: {te}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    err_hz = (measured_hz - freq_hz) if measured_hz is not None else None  # type: ignore[name-defined]
    err_ppm = (1e6 * err_hz / freq_hz) if (err_hz is not None and freq_hz) else None  # type: ignore[name-defined]
    passed: Optional[bool] = None
    if ppm_limit is not None and err_ppm is not None:
        passed = abs(err_ppm) <= ppm_limit
    return {"ok": True, "measuredHz": measured_hz, "errorHz": err_hz, "errorPpm": err_ppm, "pass": passed}


async def run_lte_frequency_accuracy_stream(
    *, earfcn: int, power_dbm: int, mac: str, ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    def step(key: str, status: str = "start", **extra): return _evt("step", key=key, status=status, **extra)

    try:
        cfg   = get_test_config("lte_frequency_accuracy") or {}
        a_set = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
        base  = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
        zooms_cfg = (cfg.get("zooms") or []) if isinstance(cfg, dict) else []
        zooms = _first_n(zooms_cfg if zooms_cfg else _DEFAULT_ZOOMS, 3)
        marker = get_marker_name()
        delay  = get_default_delay_s()
        ref_off = _get_global_ref_offset_db()

        lte_map = get_test_config("lte_earfcn_map")
        try:
            resolved_earfcn, freq_hz = _resolve_earfcn_or_freq(earfcn, lte_map)
        except Exception:
            yield _evt("log", message=f"LTE map raw={lte_map!r}")
            raise

        yield _evt("start", test="lte-frequency-accuracy",
                   params={"mac": mac, "earfcn": resolved_earfcn, "freq_hz": freq_hz,
                           "power_dbm": power_dbm, "ppm_limit": ppm_limit})

        yield step("connectAnalyzer", "start")
        spec = await _ensure_analyzer()
        yield _evt("log", message="Analyzer OK")

        # Apply analyzer setup & log everything
        yield step("configureAnalyzer", "start")
        eff = await _apply_analyzer_setup(spec=spec, center_hz=int(freq_hz), setup=a_set, ref_offset_db=ref_off)
        yield _evt("log", message=f"Analyzer: center={eff['center_hz']}Hz span={eff['span_hz']}Hz "
                                  f"RBW={eff['rbw_hz']}Hz VBW={eff['vbw_hz']}Hz "
                                  f"ref={eff['ref_level_dbm']}dBm offset={eff['ref_offset_db']}dB "
                                  f"peakDet={eff['use_peak_detector']}")
        yield step("configureAnalyzer", "done")

        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done")

            yield _evt("log", message="LTE: modem ON")
            await _dut_call(dut, "lte_modem_on")

            yield _evt("log", message="LTE: abort test (between commands)")
            await _dut_call(dut, "lte_abort_test")

            yield step("cwOn", "start", message=f"CW on @ EARFCN {resolved_earfcn}, {power_dbm} dBm")
            await _dut_call(dut, "lte_cw_on", earfcn=int(resolved_earfcn), power_dbm=power_dbm)
            await asyncio.sleep(float(base.get("settle_after_lte_cw_on_s", 0.40)))
            yield step("cwOn", "done")

            for idx, z in enumerate(zooms, start=1):
                span_hz = int(z["span_hz"]); rbw_hz = int(z["rbw_hz"]); vbw_hz = int(z["vbw_hz"])
                delay_i = float(z.get("delay_s", delay))
                await _zoom_and_center(spec, span_hz=span_hz, rbw_hz=rbw_hz, vbw_hz=vbw_hz, marker=marker, delay=delay_i)
                yield _evt("log", message=f"Zoom {idx}/3: span={span_hz}Hz RBW={rbw_hz}Hz VBW={vbw_hz}Hz")

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

            yield _evt("log", message="LTE: abort + modem off")
            try:
                await _dut_call(dut, "lte_abort_test", timeout=CLOSE_DUT_TIMEOUT)
            except Exception as e:
                yield _evt("log", message=f"Abort failed (continuing): {e}")
            try:
                await _dut_call(dut, "lte_modem_off", timeout=CLOSE_DUT_TIMEOUT)
            except Exception as e:
                yield _evt("log", message=f"Modem off failed (continuing): {e}")

            yield _evt("step", key="cwOff", status="done", message="TX stopped")

    except Exception as e:
        yield _evt("error", error=str(e))
    finally:
        yield _evt("done", ok=True)
