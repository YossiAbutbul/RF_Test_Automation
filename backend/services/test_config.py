# backend/services/test_config.py
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import yaml  # type: ignore
except Exception:  # very small fallback if PyYAML isn't available
    yaml = None

log = logging.getLogger(__name__)

# Default location: backend/config/tests.yaml
_DEFAULT_PATH = Path(__file__).resolve().parents[1] / "config" / "tests.yaml"
_ENV_VAR = "RF_TEST_CONFIG"

# Cache + metadata for hot reload
_config_cache: Optional[Dict[str, Any]] = None
_config_path: Optional[Path] = None
_config_mtime: Optional[float] = None


def _load_yaml_text(text: str) -> Dict[str, Any]:
    if yaml is None:
        raise RuntimeError("PyYAML is required to read YAML configs. Please `pip install pyyaml`.")
    data = yaml.safe_load(text) or {}
    if not isinstance(data, dict):
        raise ValueError("Invalid YAML root; expected a mapping.")
    return data


def _resolve_path(path: Optional[str | os.PathLike[str]]) -> Path:
    # order: explicit arg > env var > default path
    p = Path(path or os.getenv(_ENV_VAR, _DEFAULT_PATH))
    return p


def _read_config_file(p: Path) -> Dict[str, Any]:
    if not p.exists():
        log.warning("Config file not found at %s; returning empty config.", p)
        return {}
    try:
        text = p.read_text(encoding="utf-8")
        return _load_yaml_text(text)
    except Exception as e:
        # Do not crash the app if YAML becomes temporarily invalid while editing.
        log.error("Failed to read/parse config %s: %s", p, e)
        raise


def _maybe_reload(p: Path, *, force: bool = False) -> None:
    global _config_cache, _config_path, _config_mtime

    try:
        mtime = p.stat().st_mtime if p.exists() else None
    except Exception:
        mtime = None

    needs_reload = force or _config_cache is None or _config_path != p or (_config_mtime != mtime)

    if not needs_reload:
        return

    if not p.exists():
        # File disappeared—clear cache to avoid serving stale entries.
        _config_cache = {}
        _config_path = p
        _config_mtime = None
        log.warning("Config file %s missing; using empty config.", p)
        return

    # Try to read; if parsing fails, keep old cache (if any) and re-raise for visibility.
    new_cfg = _read_config_file(p)
    _config_cache = new_cfg
    _config_path = p
    _config_mtime = mtime
    log.info("Loaded config from %s (mtime=%s).", p, _config_mtime)


def load_config(path: Optional[str | os.PathLike[str]] = None, *, force: bool = False) -> Dict[str, Any]:
    """
    Load the config with hot-reload. If the file's mtime changes, the cache is refreshed.
    You can also pass force=True to reload unconditionally.
    An env var RF_TEST_CONFIG can override the path.
    """
    p = _resolve_path(path)
    _maybe_reload(p, force=force)
    return _config_cache or {}


def force_reload(path: Optional[str | os.PathLike[str]] = None) -> Dict[str, Any]:
    """
    Force re-read of the YAML file immediately.
    """
    return load_config(path, force=True)


def get_defaults() -> Dict[str, Any]:
    cfg = load_config()
    return cfg.get("defaults", {})


def get_test_config(test_name: str) -> Dict[str, Any]:
    cfg = load_config()
    tests = cfg.get("tests", {})
    return tests.get(test_name, {})


def get_marker_name(default: str = "MARK1") -> str:
    d = get_defaults()
    spec = d.get("spectrum", {})
    return str(spec.get("marker", default))


def get_default_delay_s(default: float = 0.18) -> float:
    d = get_defaults()
    spec = d.get("spectrum", {})
    try:
        return float(spec.get("default_delay_s", default))
    except Exception:
        return default
