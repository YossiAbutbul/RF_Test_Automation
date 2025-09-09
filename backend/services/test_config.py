# backend/services/test_config.py
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import yaml  # type: ignore
except Exception:  # very small fallback if PyYAML isn't available
    yaml = None

# Default location: backend/config/tests.yaml
_DEFAULT_PATH = Path(__file__).resolve().parents[1] / "config" / "tests.yaml"
_ENV_VAR = "RF_TEST_CONFIG"

_config_cache: Optional[Dict[str, Any]] = None

def _load_yaml_text(text: str) -> Dict[str, Any]:
    if yaml is None:
        raise RuntimeError("PyYAML is required to read YAML configs. Please `pip install pyyaml`.")
    data = yaml.safe_load(text) or {}
    if not isinstance(data, dict):
        raise ValueError("Invalid YAML root; expected a mapping.")
    return data

def load_config(path: Optional[str | os.PathLike[str]] = None) -> Dict[str, Any]:
    """
    Load and cache the config file. An env var RF_TEST_CONFIG can override the path.
    """
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    cfg_path = Path(path or os.getenv(_ENV_VAR, _DEFAULT_PATH))
    if not cfg_path.exists():
        # Provide a tiny built-in default so code keeps running even without file.
        _config_cache = {
            "version": 1,
            "defaults": {"spectrum": {"marker": "MARK1", "default_delay_s": 1.0}},
            "tests": {
                "tx_power": {
                    "analyzer_setup": {
                        "span_hz": 5_000_000,
                        "rbw_hz": 100_000,
                        "vbw_hz": 100_000,
                        "ref_level_dbm": 20.0,
                        "ref_offset_db": 20.5,
                        "use_peak_detector": True,
                    },
                    "settle": {"after_center_s": 0.0, "after_cw_on_s": 0.6},
                },
                "frequency_accuracy": {
                    "base": {
                        "use_peak_detector": True,
                        "settle_after_center_s": 0.10,
                        "settle_after_cw_on_s": 0.30,
                    },
                    "zooms": [
                        {"span_hz": 2_000_000, "rbw_hz": 1_000, "vbw_hz": 3_000, "delay_s": 0.18},
                        {"span_hz": 100_000,  "rbw_hz": 100,  "vbw_hz": 1_000, "delay_s": 0.18},
                        {"span_hz": 10_000,   "rbw_hz": 100,  "vbw_hz": 1_000, "delay_s": 0.20},
                    ],
                },
            },
        }
        return _config_cache

    text = cfg_path.read_text(encoding="utf-8")
    _config_cache = _load_yaml_text(text)
    return _config_cache

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
