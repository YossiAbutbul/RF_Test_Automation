# backend/services/tests_lora.py
from __future__ import annotations
import time
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

def _compute_obw_from_trace(dbm_vals: list[float], span_hz: int, swe_points: int, pct: float = 99.0) -> float:
    n = len(dbm_vals)
    if n < 10:
        raise RuntimeError(f"Trace too short ({n} points)")
    # linear power (mW)
    lin = [10.0 ** (v / 10.0) for v in dbm_vals]
    total = sum(lin)
    if total <= 0.0:
        raise RuntimeError("Non-positive total power in trace")
    peak = max(range(n), key=lambda i: lin[i])
    target = total * (pct / 100.0)
    left = right = peak
    acc = lin[peak]
    while acc < target and (left > 0 or right < n - 1):
        lp = lin[left - 1] if left > 0 else -1.0
        rp = lin[right + 1] if right < n - 1 else -1.0
        if rp > lp and right < n - 1:
            right += 1
            acc += lin[right]
        elif left > 0:
            left -= 1
            acc += lin[left]
        else:
            break
    bin_hz = float(span_hz) / max(1, (swe_points - 1))
    width_bins = max(1, right - left)
    obw_hz = width_bins * bin_hz
    if not (0.0 < obw_hz <= span_hz * 1.05):
        raise ValueError(f"Computed OBW out of range: {obw_hz} Hz (span={span_hz} Hz)")
    return obw_hz

async def run_obw(
    *, freq_hz: int, power_dbm: int, mac: str,
    bandwidth: int, datarate: int,
    duration_s: float = 2.0,
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
    duration_s: float = 2.0,
) -> AsyncGenerator[Dict, None]:
    """
    LoRa Occupied Bandwidth (OBW) streaming generator.
    Steps: connectAnalyzer -> configureAnalyzer -> connectDut -> cwOn -> measure -> cwOff -> done
    """
    def step(key: str, status: str = "start", **extra) -> Dict[str, Any]:
        return evt("step", key=key, status=status, **extra)

    spec = None
    dut = None  # will capture the managed_ble instance for cleanup
    cfg    = get_test_config("lora_obw")
    setup  = (cfg.get("analyzer_setup") or {}) if isinstance(cfg, dict) else {}
    settle = (cfg.get("settle") or {}) if isinstance(cfg, dict) else {}
    ref_off = get_global_analyzer_ref_offset_db()

    try:
        # announce test start
        yield evt(
            "start",
            test="obw",
            params={
                "mac": mac,
                "freq_hz": freq_hz,
                "power_dbm": power_dbm,
                "bandwidth": bandwidth,
                "datarate": datarate,
                "duration_s": duration_s,
            },
        )

        # ---- Analyzer connect ----
        yield step("connectAnalyzer", "start")
        spec = await ensure_analyzer_async()
        yield step("connectAnalyzer", "done", message="Analyzer connected")

        # ---- Analyzer configure ----
        yield step("configureAnalyzer", "start")
        eff = await apply_analyzer_setup(
            spec=spec,
            center_hz=int(freq_hz),
            setup=setup,
            analyzer_ref_offset_db=ref_off,
        )
        yield step(
            "configureAnalyzer",
            "done",
            message=(
                f"Analyzer cfg center={eff.get('center_hz', freq_hz)/1e6:.3f}MHz "
                f"span={eff.get('span_hz', 500_000)/1e6:.3f}MHz "
                f"rbw={eff.get('rbw_hz', 3000)/1e3:.0f}kHz "
                f"vbw={eff.get('vbw_hz', 10000)/1e3:.0f}kHz "
                f"ref_off={eff.get('analyzer_ref_offset_db', ref_off)}dB"
            ),
        )
        # settle after center frequency (from YAML, fallback 0.25s)
        await asyncio.sleep(float(settle.get("after_center_s", 0.25)))

        # ---- DUT connect and modulated CW ----
        yield step("connectDut", "start")
        async with managed_ble(mac) as _dut:
            dut = _dut  # capture for cleanup
            yield step("connectDut", "done", message=f"BLE connected {mac}")

            yield step(
                "cwOn",
                "start",
                message=(f"LoRa modulated CW on @ {freq_hz/1e6:.3f} MHz, {power_dbm} dBm, bw={bandwidth}, dr={datarate}"),
            )
            await dut_call(
                dut,
                "lora_modulated_cw_on",
                freq_hz=freq_hz,
                power_dbm=power_dbm,
                bandwidth=bandwidth,
                datarate=datarate,
            )
            await asyncio.sleep(float(settle.get("after_lora_cw_on_s", 0.6)))
            yield step("cwOn", "done")

            # ---- Measure OBW ----
            yield step("measure", "start", message="Max-hold accumulate and compute OBW")

            try:
                # 1) Switch analyzer to MaxHold
                await spec_call(spec.max_hold)
                yield evt("log", message="Trace mode -> MAXHold")

                # 2) Accumulate with small keep-alives to avoid idle timeouts
                start_t = asyncio.get_event_loop().time()
                while asyncio.get_event_loop().time() - start_t < float(duration_s):
                    await asyncio.sleep(0.8)
                    # yield evt("log", message="Accumulating…")

                # 3) Fetch trace CSV
                raw_csv = await spec_call(spec.get_raw_data)
                if not raw_csv:
                    raise RuntimeError("Empty trace from analyzer")

                # 4) Parse trace into dBm floats (robust to junk tokens)
                vals_dbm: list[float] = []
                for tok in raw_csv.split(","):
                    tok = tok.strip()
                    if not tok:
                        continue
                    try:
                        vals_dbm.append(float(tok))
                    except ValueError:
                        # keep parsing, skip junk
                        pass
                if len(vals_dbm) < 10:
                    raise RuntimeError(f"Trace too short ({len(vals_dbm)} points)")

                # 5) Ask analyzer for span and sweep points
                try:
                    span_str = await spec_call(spec.query, "FREQ:SPAN?")
                    span_hz = int(round(float(span_str)))
                except Exception as e:
                    raise RuntimeError(f"Cannot determine SPAN (FREQ:SPAN?): {e}")

                try:
                    swe_str = await spec_call(spec.query, "SWE:POIN?")
                    swe_points = int(round(float(swe_str)))
                    if swe_points < 2 or abs(swe_points - len(vals_dbm)) > len(vals_dbm) // 2:
                        swe_points = len(vals_dbm)
                except Exception:
                    swe_points = len(vals_dbm)

                # 6) Compute OBW locally
                obw_hz = _compute_obw_from_trace(vals_dbm, span_hz, swe_points, pct=99.0)

                measured = float(obw_hz)
                yield step("measure", "done", measuredHz=measured)
                yield evt("result", measuredHz=measured, pass_=None)

            except Exception as e:
                # Make the error very explicit
                yield evt("error", error=f"OBW inline failed: {type(e).__name__}: {e}")
                return


            # ---- Modulated CW off ----
            yield step("cwOff", "start", message="LoRa modulated CW off")
            try:
                await dut_call(dut, "lora_cw_off")  # your cw-off path
            finally:
                yield step("cwOff", "done")

    except asyncio.CancelledError:
        # If stream cancelled, perform background abort/cleanup
        if mac:
            asyncio.create_task(background_abort_ble(mac, protocol="LORA"))
        if spec:
            # clear write and disconnect analyzer gracefully
            try:
                await spec_call(spec.clear_write)
            except Exception:
                pass
            asyncio.create_task(background_tidy_spectrum(spec))
            try:
                await spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT)
            except Exception:
                pass
        raise
    except Exception as e:
        yield evt("error", error=str(e))
    finally:
        # ---- Global cleanup (always) ----
        # 1) Analyzer -> WRIT (best-effort)
        if spec:
            try:
                await spec_call(spec.clear_write)  # DISP:TRAC1:MODE WRIT
            except Exception:
                pass
        # 2) CW off (best-effort) — if DUT still around
        if dut:
            try:
                await dut_call(dut, "lora_cw_off")
            except Exception:
                if mac:
                    asyncio.create_task(background_abort_ble(mac, protocol="LORA"))
        # 3) Analyzer disconnect (best-effort)
        if spec:
            try:
                await spec_call(spec.disconnect, timeout=CLOSE_SPEC_TIMEOUT)
            except Exception:
                pass
        yield evt("done", ok=True)

