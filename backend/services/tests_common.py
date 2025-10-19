# backend/services/tests_common.py
from __future__ import annotations
import asyncio
import re
from typing import Any, Iterable, Dict
from contextlib import asynccontextmanager

from services.spectrum_service import ensure_analyzer
from services.dut_ble_service import DUTBLE
from services.test_config import (
    get_test_config,
    get_marker_name,
    get_default_delay_s,
)

try:
    from services.test_config import load_config  # type: ignore
except Exception:  # pragma: no cover
    load_config = None

# ========= Timeouts (seconds) =========
# More tolerant for slow BLE/analyzer handshakes
DEFAULT_CONNECT_TIMEOUT = 25.0   # analyzer connect
DEFAULT_SPEC_TIMEOUT    = 12.0   # single spectrum analyzer command
DEFAULT_DUT_TIMEOUT     = 20.0   # single BLE/DUT command
CLOSE_DUT_TIMEOUT       = 3.0    # fast close for disconnect/off paths
CLOSE_SPEC_TIMEOUT      = 3.0    # quick spectrum tidy-up

# ========= Small helpers =========
_NUM_RE = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")

def num(s: str) -> float:
    m = _NUM_RE.search(str(s))
    if not m:
        raise ValueError(f"Cannot parse number from: {s!r}")
    return float(m.group(0))

def evt(type_: str, **data) -> Dict:
    return {"type": type_, **data}

async def ensure_analyzer_async(timeout: float = DEFAULT_CONNECT_TIMEOUT):
    return await asyncio.wait_for(asyncio.to_thread(ensure_analyzer), timeout=timeout)

async def spec_call(fn, *args, timeout: float = DEFAULT_SPEC_TIMEOUT, **kwargs):
    return await asyncio.wait_for(asyncio.to_thread(fn, *args, **kwargs), timeout=timeout)

async def dut_call(dut: DUTBLE, method: str, *args, timeout: float = DEFAULT_DUT_TIMEOUT, **kwargs):
    return await asyncio.wait_for(asyncio.to_thread(getattr(dut, method), *args, **kwargs), timeout=timeout)

@asynccontextmanager
async def managed_ble(mac: str, *, attempts: int = 3, backoff_s: float = 0.8):
    """
    Async DUT context with connect/disconnect timeouts + a small retry loop
    to handle flaky handshakes. Each attempt uses DEFAULT_DUT_TIMEOUT.
    """
    dut = DUTBLE(mac)
    for i in range(1, attempts + 1):
        try:
            await dut_call(dut, "connect", timeout=DEFAULT_DUT_TIMEOUT)
            break
        except Exception:
            if i < attempts:
                await asyncio.sleep(backoff_s * i)  # linear backoff
            else:
                raise
    try:
        yield dut
    finally:
        try:
            await dut_call(dut, "disconnect", timeout=CLOSE_DUT_TIMEOUT)
        except Exception:
            pass

def get_global_analyzer_ref_offset_db() -> float:
    try:
        if load_config is None:
            return 0.0
        cfg = load_config() or {}
        top = cfg if isinstance(cfg, dict) else {}
        tests = top.get("tests") or {}
        val = top.get("analyzer_analyzer_ref_offset_db", tests.get("analyzer_analyzer_ref_offset_db", 0.0))
        return float(val or 0.0)
    except Exception:
        return 0.0

async def apply_analyzer_setup(
    *,
    spec,
    center_hz: int,
    setup: Dict[str, Any] | None,
    analyzer_ref_offset_db: float,
) -> Dict[str, Any]:
    """
    Apply analyzer settings & return the effective params for logging.
    Keys honored in 'setup': span_hz, rbw_hz, vbw_hz, ref_level_dbm, use_peak_detector.
    """
    setup = setup or {}
    eff = {
        "center_hz": int(center_hz),
        "span_hz": int(setup.get("span_hz", 5_000_000)) if setup.get("span_hz") is not None else None,
        "rbw_hz":  int(setup.get("rbw_hz")) if setup.get("rbw_hz") is not None else None,
        "vbw_hz":  int(setup.get("vbw_hz")) if setup.get("vbw_hz") is not None else None,
        "ref_level_dbm": float(setup.get("ref_level_dbm")) if setup.get("ref_level_dbm") is not None else None,
        "analyzer_ref_offset_db": float(analyzer_ref_offset_db),
        "use_peak_detector": bool(setup.get("use_peak_detector", True)),
    }

    await spec_call(spec.set_center_frequency, eff["center_hz"], "HZ")
    if eff["span_hz"] is not None:
        await spec_call(spec.set_span, eff["span_hz"], "HZ")

    if eff["rbw_hz"] is not None:
        try: await spec_call(spec.set_rbw,  eff["rbw_hz"], "HZ")
        except Exception: pass
    if eff["vbw_hz"] is not None:
        try: await spec_call(spec.set_vbw,  eff["vbw_hz"], "HZ")
        except Exception: pass

    if eff["ref_level_dbm"] is not None:
        try: await spec_call(spec.set_ref_level, eff["ref_level_dbm"])
        except Exception: pass

    try:
        await spec_call(spec.set_ref_level_offset, eff["analyzer_ref_offset_db"])
    except Exception:
        pass

    if eff["use_peak_detector"]:
        try:
            if hasattr(spec, "set_peak_detector"):
                await spec_call(spec.set_peak_detector)
            else:
                if hasattr(spec, "send_and_wait") and hasattr(spec, "cmd"):
                    await spec_call(spec.send_and_wait, spec.cmd.build("set_peak_detector"))
        except Exception:
            pass

    return eff

async def zoom_and_center(
    spec,
    *,
    span_hz: int,
    rbw_hz: int,
    vbw_hz: int,
    marker: str,
    delay: float,
) -> None:
    await spec_call(spec.set_span, span_hz, "HZ");  await asyncio.sleep(delay)
    await spec_call(spec.set_rbw,  rbw_hz,  "HZ");  await asyncio.sleep(delay)
    await spec_call(spec.set_vbw,  vbw_hz,  "HZ");  await asyncio.sleep(delay)
    await spec_call(spec.peak_search, marker);      await asyncio.sleep(delay)
    try:
        if hasattr(spec, "set_marker_to_center_frequency"):
            await spec_call(spec.set_marker_to_center_frequency, marker)
        else:
            if hasattr(spec, "send_and_wait") and hasattr(spec, "cmd"):
                await spec_call(spec.send_and_wait, spec.cmd.build("set_marker_to_center_frequency", mark_name=marker))
    except Exception:
        pass
    await asyncio.sleep(delay)

def first_n(it: Iterable[dict], n: int) -> list[dict]:
    out: list[dict] = []
    for z in it:
        out.append(z)
        if len(out) >= n:
            break
    return out

# ========= Background helpers (restored) =========

def _background(coro: "asyncio.Future[Any] | asyncio.Task[Any] | Any") -> None:
    """
    Fire-and-forget task runner with basic shielding, used by abort paths.
    """
    try:
        if asyncio.iscoroutine(coro):
            asyncio.create_task(coro)
    except Exception:
        pass

async def background_abort_ble(mac: str, *, protocol: str) -> None:
    """
    Best-effort, very fast BLE cleanup in the background:
    - For LoRa: send lora_cw_off
    - For LTE:  send lte_abort_test
    Always disconnect at the end; each step uses short CLOSE_DUT_TIMEOUT.
    """
    dut = DUTBLE(mac)
    try:
        try:
            await dut_call(dut, "connect", timeout=CLOSE_DUT_TIMEOUT)
        except Exception:
            return  # cannot connect — nothing else to do fast

        try:
            if protocol.upper() == "LORA":
                try: await dut_call(dut, "lora_cw_off", timeout=CLOSE_DUT_TIMEOUT)
                except Exception: pass
            elif protocol.upper() == "LTE":
                try: await dut_call(dut, "lte_abort_test", timeout=CLOSE_DUT_TIMEOUT)
                except Exception: pass
        finally:
            try:
                await dut_call(dut, "disconnect", timeout=CLOSE_DUT_TIMEOUT)
            except Exception:
                pass
    except Exception:
        pass

async def background_tidy_spectrum(spec) -> None:
    """
    Optional quick spectrum tidy-up in the background.
    We DO NOT disconnect the LAN session.
    """
    try:
        marker = get_marker_name()
        try: await spec_call(spec.peak_search, marker, timeout=CLOSE_SPEC_TIMEOUT)
        except Exception: pass
    except Exception:
        pass
