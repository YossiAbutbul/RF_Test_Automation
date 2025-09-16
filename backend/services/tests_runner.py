# backend/services/tests_runner.py
"""
Compatibility shim: delegate test runners to protocol-specific modules.

We keep the old public function names so existing routes/callers
continue to work unchanged, while the real logic lives in:
  - services/tests_lora.py
  - services/tests_lte.py
"""

from __future__ import annotations

# LoRa
from services.tests_lora import (
    run_tx_power as run_tx_power,
    run_tx_power_stream as run_tx_power_stream,
    run_freq_accuracy as run_freq_accuracy,
    run_freq_accuracy_stream as run_freq_accuracy_stream,
)

# LTE
from services.tests_lte import (
    run_lte_tx_power as run_lte_tx_power,
    run_lte_tx_power_stream as run_lte_tx_power_stream,
    run_lte_frequency_accuracy as run_lte_frequency_accuracy,
    run_lte_frequency_accuracy_stream as run_lte_frequency_accuracy_stream,
)

__all__ = [
    # LoRa
    "run_tx_power",
    "run_tx_power_stream",
    "run_freq_accuracy",
    "run_freq_accuracy_stream",
    # LTE
    "run_lte_tx_power",
    "run_lte_tx_power_stream",
    "run_lte_frequency_accuracy",
    "run_lte_frequency_accuracy_stream",
]
