from pydantic import BaseModel, Field
from typing import Literal


class AnalyzerConnectRequest(BaseModel):
    """
    Request model for connecting to a spectrum analyzer.
    """
    ip: str = Field(..., description="IP address of the spectrum analyzer")
    port: int = Field(default=5555, description="Port for socket connection (default: 5555)")


class AnalyzerResponse(BaseModel):
    """
    Generic response model for analyzer connection or status.
    """
    status: Literal["connected", "disconnected"] = Field(..., description="Connection status")
    identity: str = Field(..., description="Spectrum analyzer identity string")


class FrequencyParam(BaseModel):
    """
    Request model for setting center frequency.
    """
    value: float = Field(..., description="Center frequency value (numeric)")
    units: Literal["HZ", "KHZ", "MHZ", "GHZ"] = Field(default="HZ", description="Frequency units")


class SpanParam(BaseModel):
    """
    Request model for setting span.
    """
    value: float = Field(..., description="Span value (numeric)")
    units: Literal["HZ", "KHZ", "MHZ", "GHZ"] = Field(default="HZ", description="Span units")


class BandwidthParam(BaseModel):
    """
    Request model for setting bandwidth values (RBW or VBW).
    """
    value: float = Field(..., description="Bandwidth value (numeric)")
    units: Literal["HZ", "KHZ", "MHZ", "GHZ"] = Field(default="HZ", description="Bandwidth units")


class RefLevelParam(BaseModel):
    """
    Request model for setting reference level or offset in dB.
    """
    dbm: float = Field(..., description="Reference level or offset value in dBm/dB")


class MarkerNameParam(BaseModel):
    """
    Request model for specifying marker name in peak search or queries.
    """
    mark_name: str = Field(default="MARK1", description="Marker identifier (e.g., MARK1)")


class ScreenshotParam(BaseModel):
    """
    Request model for naming a screenshot to be saved by the analyzer.
    """
    name: str = Field(default="screenshot", description="Base filename for screenshot (no extension)")
