from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from backend.Spectrum import SpectrumAnalyzer

app = FastAPI()

# Allow frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instance of the analyzer
analyzer = SpectrumAnalyzer(ip_address="172.16.10.1")  # Update to your actual IP

# ---- Models for request bodies ----


class FrequencyModel(BaseModel):
    freq: float


class UnitModel(BaseModel):
    value: float
    units: Optional[str] = "HZ"


class SimpleValueModel(BaseModel):
    value: float


class NameModel(BaseModel):
    name: str

# ---- Routes ----


@app.post("/connect")
def connect():
    analyzer.connect()
    return {"status": "connected"}


@app.post("/disconnect")
def disconnect():
    analyzer.disconnect()
    return {"status": "disconnected"}


@app.post("/reset")
def reset():
    analyzer.reset()
    return {"status": "reset complete"}


@app.get("/identify")
def identify():
    return {"response": analyzer.identify()}


@app.post("/set_center_freq")
def set_center_freq(data: FrequencyModel):
    analyzer.set_center_frequency(data.freq)
    return {"status": f"center frequency set to {data.freq} Hz"}


@app.post("/set_span")
def set_span(data: UnitModel):
    analyzer.set_span(data.value, data.units)
    return {"status": f"span set to {data.value} {data.units}"}


@app.post("/set_rbw")
def set_rbw(data: UnitModel):
    analyzer.set_rbw(data.value)
    return {"status": f"RBW set to {data.value} {data.units}"}


@app.post("/set_vbw")
def set_vbw(data: UnitModel):
    analyzer.set_vbw(data.value)
    return {"status": f"VBW set to {data.value} {data.units}"}


@app.post("/set_ref_level")
def set_ref_level(data: SimpleValueModel):
    analyzer.set_ref_level(data.value)
    return {"status": f"Reference level set to {data.value} dBm"}


@app.post("/set_ref_level_offset")
def set_ref_offset(data: SimpleValueModel):
    analyzer.set_ref_level_offset(data.value)
    return {"status": f"Reference offset set to {data.value} dB"}


@app.post("/set_peak_detector")
def set_peak_detector():
    analyzer.set_peak_detector()
    return {"status": "Peak detector set"}


@app.post("/peak_search")
def peak_search():
    analyzer.peak_search()
    return {"status": "Peak search executed"}


@app.get("/get_marker_power")
def get_marker_power():
    return {"power": analyzer.get_marker_power()}


@app.get("/get_marker_frequency")
def get_marker_frequency():
    return {"frequency": analyzer.get_marker_frequency()}


@app.get("/get_rbw")
def get_rbw():
    return {"rbw": analyzer.get_rbw()}


@app.get("/get_vbw")
def get_vbw():
    return {"vbw": analyzer.get_vbw()}


@app.get("/get_span")
def get_span():
    return {"span": analyzer.get_span()}


@app.get("/get_ref_level")
def get_ref_level():
    return {"ref_level": analyzer.get_ref_level()}


@app.get("/get_ref_level_offset")
def get_ref_offset():
    return {"ref_offset": analyzer.get_ref_level_offset()}


@app.post("/take_screenshot")
def take_screenshot(data: NameModel):
    analyzer.take_screenshot(name=data.name)
    return {"status": f"screenshot '{data.name}.png' taken"}


@app.post("/download_screenshot")
def download_screenshot():
    analyzer.download_screenshot_via_ftp()
    return {"status": "screenshot downloaded to local path"}
