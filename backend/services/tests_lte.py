# backend/services/tests_lte.py
from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Optional, Any, Tuple, List

from services.tests_common import (
    evt,
    num,
    ensure_analyzer_async,
    spec_call,
    apply_analyzer_setup,
    zoom_and_center,
    get_global_analyzer_ref_offset_db,
    managed_ble,
    dut_call,
    background_abort_ble,
    background_tidy_spectrum,
    CLOSE_SPEC_TIMEOUT,
)
from services.test_config import get_test_config, get_marker_name, get_default_delay_s


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pretty_err(e: Exception) -> str:
    s = (str(e) or "").strip()
    r = repr(e)
    if not s:
        s = e.__class__.__name__
    if "HwtpStatus" in s or "HwtpStatus" in r:
        return f"DUT transport error (HWTP): {s or r}"
    if "Timeout" in s or "timeout" in s.lower():
        return f"BLE connect/command timeout: {s or r}"
    return s or r


def _to_optional_float(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    return float(v)


def _normalize_lte_map(raw: Any) -> Dict[int, int]:
    out: Dict[int, int] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            try:
                out[int(str(k).strip())] = int(float(str(v).strip()))
            except Exception:
                continue
    return out


def _resolve_earfcn_or_freq(value: int, lte_map_raw: Any) -> Tuple[int, int]:
    """Resolve either an EARFCN or a center frequency (Hz) to (earfcn, center_hz).

    - If *value* matches a key in the map → treat as EARFCN.
    - Else, if *value* matches a center frequency in the map (±2 kHz) → use that EARFCN.
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


_FALLBACK_ZOOMS: List[Dict[str, Any]] = [
    {"span_hz": 2_000_000,  "rbw_hz": 30_000, "vbw_hz": 100_000, "delay_s": 0.20},
    {"span_hz": 200_000,    "rbw_hz": 10_000, "vbw_hz": 30_000,  "delay_s": 0.20},
    {"span_hz": 20_000,     "rbw_hz": 1_000,  "vbw_hz": 3_000,   "delay_s": 0.20},
]


def _load_lte_zooms_from_yaml(delay_default: float) -> List[Dict[str, Any]]:
    cfg = get_test_config("lte_frequency_accuracy") or {}
    raw = (cfg.get("zooms") or []) if isinstance(cfg, dict) else []
    out: List[Dict[str, Any]] = []
    if isinstance(raw, list):
        for z in raw:
            try:
                span = int(z.get("span_hz"))
                rbw = int(z.get("rbw_hz"))
                vbw = int(z.get("vbw_hz"))
                d = float(z.get("delay_s", delay_default))
                if span > 0 and rbw > 0 and vbw > 0:
                    out.append({"span_hz": span, "rbw_hz": rbw, "vbw_hz": vbw, "delay_s": d})
            except Exception:
                continue
    return out if out else _FALLBACK_ZOOMS


# ---------------------------------------------------------------------------
# LTE: Tx Power
# ---------------------------------------------------------------------------

async def run_lte_tx_power(
    *,
    earfcn: int,
    power_dbm: int,
    mac: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> Dict[str, Any]:
    """Non-stream helper: collect the single 'result' event and return a compact dict."""
    result: Dict[str, Any] | None = None
    async for e in run_lte_tx_power_stream(
        earfcn=earfcn,
        power_dbm=power_dbm,
        mac=mac,
        min_value=min_value,
        max_value=max_value,
    ):
        if e.get("type") == "result":
            result = e
    if result is None:
        raise RuntimeError("No result produced by run_lte_tx_power_stream")
    return {
        "ok": True,
        "measuredDbm": result.get("measuredDbm"),
        "pass": result.get("pass_"),
    }


async def run_lte_tx_power_stream(
    *,
    earfcn: int,
    power_dbm: int,
    mac: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """LTE Tx Power streaming generator.

    Design goals:
    - Follow the same simple step model as LoRa Tx Power.
    - Follow the RF sequence that works in main_test.py:
      modem_on → cw_on → measure → abort_test (CW off) → modem_off.
    - Avoid extra retries / safety-aborts that can confuse the modem state.
    """
    def step(key: str, status: str = "start", **extra: Any) -> Dict[str, Any]:
        return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay = get_default_delay_s()

    lte_def = get_test_config("lte_defaults") or {}
    setup = (lte_def.get("analyzer_setup") or {}) if isinstance(lte_def, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()

    # Limits (optional)
    try:
        min_val = _to_optional_float(min_value)
        max_val = _to_optional_float(max_value)
    except Exception as e:
        yield evt("error", error=_pretty_err(e))
        yield evt("done", ok=True)
        return

    spec = None
    cw_on = False
    measured: Optional[float] = None

    try:
        # Map EARFCN / freq → (earfcn, center_hz)
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, center_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        yield evt(
            "start",
            test="lte-tx-power",
            params={
                "mac": mac,
                "earfcn": resolved_earfcn,
                "freq_hz": center_hz,
                "power_dbm": int(power_dbm),
            },
        )

        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec,
            center_hz=int(center_hz),
            setup=setup,
            analyzer_ref_offset_db=ref_off,
        )
        span_hz = eff.get("span_hz") or 0
        rbw_hz = eff.get("rbw_hz") or 0
        vbw_hz = eff.get("vbw_hz") or 0
        yield step(
            "configureAnalyzer",
            "done",
            message=(
                f"Analyzer cfg center={eff['center_hz']/1e6:.1f}MHz "
                f"span={span_hz/1e6:.1f}MHz rbw={rbw_hz/1e3:.1f}KHz "
                f"vbw={vbw_hz/1e3:.1f}KHz ref_off={eff.get('analyzer_ref_offset_db')}dB"
            ),
        )
        center_wait = float((lte_def.get("settle") or {}).get("after_center_s", delay))
        await asyncio.sleep(center_wait)

        # DUT
        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done", message=f"BLE connected {mac}")

            # 1) modem ON — HWTP errors treated as soft (log + continue)
            yield step("modemOn", "start", message="Turning LTE modem on")
            try:
                await dut_call(dut, "lte_modem_on")
            except Exception as e:  # noqa: BLE001
                msg = str(e) or repr(e)
                if "HwtpStatus" in msg or "not a valid HwtpStatus" in msg:
                    # Modem may already be ON; log and continue.
                    yield evt("log", message=f"lte_modem_on warning (ignored): {msg}")
                else:
                    raise RuntimeError(f"lte_modem_on failed: {e}") from e
            yield step("modemOn", "done")

            await asyncio.sleep(float(lte_def.get("modem_ready_wait_s", 0.6)))

            # 2) CW ON — again treat HWTP status codes as soft
            yield step(
                "cwOn",
                "start",
                message=f"CW on @ EARFCN {resolved_earfcn}, {power_dbm} dBm",
            )
            try:
                await dut_call(
                    dut,
                    "lte_cw_on",
                    earfcn=int(resolved_earfcn),
                    power_dbm=int(power_dbm),
                )
            except Exception as e:  # noqa: BLE001
                msg = str(e) or repr(e)
                if "HwtpStatus" in msg or "not a valid HwtpStatus" in msg:
                    yield evt("log", message=f"lte_cw_on warning (ignored): {msg}")
                else:
                    raise RuntimeError(f"lte_cw_on failed: {e}") from e
            await asyncio.sleep(float(lte_def.get("settle_after_cw_on_s", 0.6)))
            cw_on = True
            yield step("cwOn", "done")

            # 3) Measure
            yield step("measure", "start", message="Peak search + read marker power")
            await spec_call(spec.peak_search, marker)
            await asyncio.sleep(delay)
            pow_str = await spec_call(spec.get_marker_power, marker)
            measured = float(num(pow_str))
            yield step("measure", "done", measuredDbm=measured)

            # PASS/FAIL only if at least one limit provided
            if min_val is None and max_val is None:
                passed = None
            else:
                lower_ok = True if min_val is None else (measured >= min_val)
                upper_ok = True if max_val is None else (measured <= max_val)
                passed = lower_ok and upper_ok

            yield evt("result", measuredDbm=measured, pass_=passed)

            # 4) Abort test (CW off) + modem off, under a single 'cwOff' step for the UI
            yield step("cwOff", "start", message="LTE abort test (CW off + modem off)")
            try:
                if cw_on:
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        # Best effort; CW should already be gone in most cases
                        pass
                try:
                    await dut_call(dut, "lte_modem_off")
                except Exception as e:  # noqa: BLE001
                    msg = str(e) or repr(e)
                    if "HwtpStatus" in msg or "not a valid HwtpStatus" in msg:
                        yield evt("log", message=f"lte_modem_off warning (ignored): {msg}")
                    else:
                        # We don't raise here — just log, test already measured.
                        yield evt("log", message=f"lte_modem_off error: {msg}")
            finally:
                cw_on = False
                yield step("cwOff", "done", message="CW off, modem off")

    except asyncio.CancelledError:
        # Frontend aborted — cleanup quickly in the background.
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    except Exception as e:  # noqa: BLE001
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        yield evt("error", error=_pretty_err(e))
    finally:
        yield evt("done", ok=True)


# ---------------------------------------------------------------------------
# LTE: Frequency Accuracy
# ---------------------------------------------------------------------------

async def run_lte_frequency_accuracy(
    *,
    earfcn: int,
    power_dbm: int,
    mac: str,
    ppm_limit: Optional[float] = None,
) -> Dict[str, Any]:
    """Non-stream helper for LTE Frequency Accuracy."""
    result: Dict[str, Any] | None = None
    async for e in run_lte_frequency_accuracy_stream(
        earfcn=earfcn,
        power_dbm=power_dbm,
        mac=mac,
        ppm_limit=ppm_limit,
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
    *,
    earfcn: int,
    power_dbm: int,
    mac: str,
    ppm_limit: Optional[float] = None,
) -> AsyncGenerator[Dict, None]:
    """LTE Frequency Accuracy streaming generator.

    Mirrors the simple LTE Tx Power flow, but:
    - Uses zoom passes from tests.yaml (lte_frequency_accuracy.zooms).
    - Measures marker frequency and computes error in Hz and ppm.
    """
    def step(key: str, status: str = "start", **extra: Any) -> Dict[str, Any]:
        return evt("step", key=key, status=status, **extra)

    marker = get_marker_name()
    delay = get_default_delay_s()

    cfg = get_test_config("lte_frequency_accuracy") or {}
    setup = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    base = (cfg.get("base") or {}) if isinstance(cfg, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()
    zooms = _load_lte_zooms_from_yaml(delay_default=delay)

    try:
        ppm_limit_val = _to_optional_float(ppm_limit)
    except Exception as e:
        yield evt("error", error=_pretty_err(e))
        yield evt("done", ok=True)
        return

    spec = None
    cw_on = False
    measured_hz: Optional[int] = None
    error_hz: Optional[int] = None
    error_ppm: Optional[float] = None

    try:
        lte_map = get_test_config("lte_earfcn_map")
        resolved_earfcn, center_hz = _resolve_earfcn_or_freq(earfcn, lte_map)

        yield evt(
            "start",
            test="lte-frequency-accuracy",
            params={
                "mac": mac,
                "earfcn": resolved_earfcn,
                "freq_hz": center_hz,
                "power_dbm": int(power_dbm),
            },
        )

        # Analyzer
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec,
            center_hz=int(center_hz),
            setup=setup,
            analyzer_ref_offset_db=ref_off,
        )
        yield step(
            "configureAnalyzer",
            "done",
            message=f"Analyzer cfg center={eff['center_hz']/1e6:.1f}MHz",
        )

        settle_cfg = (cfg.get("settle") or {}).get("after_center_s")
        if settle_cfg is None:
            settle_cfg = base.get("settle_after_center_s", delay)
        try:
            center_wait = float(settle_cfg)
        except (TypeError, ValueError):
            center_wait = float(delay)
        await asyncio.sleep(center_wait)

        # DUT
        yield step("connectDut", "start", message=f"DUT {mac}")
        async with managed_ble(mac) as dut:
            yield step("connectDut", "done", message=f"BLE connected {mac}")

            # 1) modem ON
            yield step("modemOn", "start", message="Turning LTE modem on")
            try:
                await dut_call(dut, "lte_modem_on")
            except Exception as e:  # noqa: BLE001
                msg = str(e) or repr(e)
                if "HwtpStatus" in msg or "not a valid HwtpStatus" in msg:
                    yield evt("log", message=f"lte_modem_on warning (ignored): {msg}")
                else:
                    raise RuntimeError(f"lte_modem_on failed: {e}") from e
            yield step("modemOn", "done")

            await asyncio.sleep(float(base.get("modem_ready_base_wait_s", 0.6)))

            # 2) CW ON
            yield step(
                "cwOn",
                "start",
                message=f"CW on @ EARFCN {resolved_earfcn}, {power_dbm} dBm",
            )
            try:
                await dut_call(
                    dut,
                    "lte_cw_on",
                    earfcn=int(resolved_earfcn),
                    power_dbm=int(power_dbm),
                )
            except Exception as e:  # noqa: BLE001
                msg = str(e) or repr(e)
                if "HwtpStatus" in msg or "not a valid HwtpStatus" in msg:
                    yield evt("log", message=f"lte_cw_on warning (ignored): {msg}")
                else:
                    raise RuntimeError(f"lte_cw_on failed: {e}") from e
            await asyncio.sleep(float(base.get("settle_after_lte_cw_on_s", 0.6)))
            cw_on = True
            yield step("cwOn", "done")

            # 3) Zoom passes from YAML
            total = len(zooms)
            for i, z in enumerate(zooms, 1):
                span_hz = int(z["span_hz"])
                rbw_hz = int(z["rbw_hz"])
                vbw_hz = int(z["vbw_hz"])
                d = float(z.get("delay_s", delay))
                yield evt(
                    "log",
                    message=(
                        f"Zoom {i}/{total} → span={span_hz/1e6}MHz "
                        f"rbw={rbw_hz/1e3}KHz vbw={vbw_hz/1e3}KHz"
                    ),
                )
                await zoom_and_center(
                    spec,
                    span_hz=span_hz,
                    rbw_hz=rbw_hz,
                    vbw_hz=vbw_hz,
                    marker=marker,
                    delay=d,
                )

            # 4) Final measure
            yield step(
                "measure",
                "start",
                message="Read marker frequency + compute error/ppm",
            )
            try:
                f1 = await spec_call(spec.get_marker_frequency, marker)
                await asyncio.sleep(delay)
                f2 = await spec_call(spec.get_marker_frequency, marker)
                val = f2 or f1
                measured_hz = int(round(float(num(val))))
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"Failed to read marker frequency: {e}") from e

            error_hz = int(measured_hz - int(center_hz))
            if center_hz:
                error_ppm = (float(error_hz) / float(center_hz)) * 1e6
            else:
                error_ppm = None

            if ppm_limit_val is not None and error_ppm is not None:
                passed = abs(error_ppm) <= ppm_limit_val
            else:
                passed = None

            yield step(
                "measure",
                "done",
                measuredHz=measured_hz,
                errorHz=error_hz,
                errorPpm=error_ppm,
            )
            yield evt(
                "result",
                measuredHz=measured_hz,
                errorHz=error_hz,
                errorPpm=error_ppm,
                pass_=passed,
            )

            # 5) Abort test (CW off) + modem off
            yield step("cwOff", "start", message="LTE abort test (CW off + modem off)")
            try:
                if cw_on:
                    try:
                        await dut_call(dut, "lte_abort_test")
                    except Exception:
                        pass
                try:
                    await dut_call(dut, "lte_modem_off")
                except Exception as e:  # noqa: BLE001
                    msg = str(e) or repr(e)
                    if "HwtpStatus" in msg or "not a valid HwtpStatus" in msg:
                        yield evt("log", message=f"lte_modem_off warning (ignored): {msg}")
                    else:
                        yield evt("log", message=f"lte_modem_off error: {msg}")
            finally:
                cw_on = False
                yield step("cwOff", "done", message="CW off, modem off")

    except asyncio.CancelledError:
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        raise
    except Exception as e:  # noqa: BLE001
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LTE"))
        if spec is not None:
            asyncio.create_task(background_tidy_spectrum(spec))
            asyncio.create_task(spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT))
        yield evt("error", error=_pretty_err(e))
    finally:
        yield evt("done", ok=True)
