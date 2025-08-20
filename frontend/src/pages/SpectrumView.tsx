import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { useState, useEffect, useRef } from 'react'

export default function SpectrumView() {
  const [tab, setTab] = useState<'Config' | 'Markers'>('Config')
  // Live spectrum state
  const [isLive, setIsLive] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [spectrumData, setSpectrumData] = useState<number[]>([])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const handleLiveToggle = () => {
    setIsLive(prev => !prev)
    setIsPaused(false)
    // call backend start/stop actions
    fetch(`/api/spectrum/${!isLive ? 'start' : 'stop'}`, { method: 'POST' }).catch(() => {})
  }
  const handlePauseToggle = () => {
    setIsPaused(prev => !prev)
  }
  const handleFullscreen = () => {
    const canvas = canvasRef.current
    if (canvas && (canvas as any).requestFullscreen) {
      ;(canvas as any).requestFullscreen()
    }
  }
  // fetch spectrum data from backend
  const fetchSpectrumData = async () => {
    try {
      const res = await fetch('/api/spectrum/data')
      const json = await res.json()
      return json?.data ?? []
    } catch (error) {
      console.error(error)
      return []
    }
  }

  // Poll backend for spectrum data when live and not paused
  useEffect(() => {
    let interval: any
    if (isLive && !isPaused) {
      interval = setInterval(async () => {
        const data = await fetchSpectrumData()
        setSpectrumData(data)
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isLive, isPaused])

  // Draw spectrum data to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // resize canvas to match displayed size
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)
    if (!spectrumData || spectrumData.length === 0) {
      ctx.fillStyle = '#64748b'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(isLive ? 'Waiting for data...' : 'Live mode is off', width / 2, height / 2)
      return
    }
    const max = Math.max(...spectrumData)
    const min = Math.min(...spectrumData)
    ctx.beginPath()
    spectrumData.forEach((val, idx) => {
      const x = (idx / (spectrumData.length - 1)) * width
      const y = height - ((val - min) / (max - min || 1)) * height
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = '#5964DA'
    ctx.lineWidth = 2
    ctx.stroke()
  }, [spectrumData, isLive])

  return (
    <div>
      <PageHeader title="Spectrum View" subtitle="Analyze real-time frequency domain data" />

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={handleLiveToggle}
          className={`rounded-xl px-3 py-1 text-xs ${
            isLive ? 'bg-green-600 text-white' : 'bg-blue-100 text-blue-700'
          }`}
        >
          {isLive ? 'Stop' : 'Live'}
        </button>
        <button
          onClick={handleFullscreen}
          className="rounded-xl border px-3 py-1 text-xs"
        >
          Fullscreen
        </button>
        <button
          onClick={handlePauseToggle}
          disabled={!isLive}
          className={`rounded-xl border px-3 py-1 text-xs ${
            isPaused ? 'bg-zinc-200' : ''
          }`}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4">
        <Card className="p-4">
          <div className="font-medium">Spectrum Analysis</div>
          <div className="text-sm text-zinc-500">Real-time frequency domain monitoring</div>
          <canvas
            ref={canvasRef}
            className="mt-3 w-full h-[520px] rounded-xl border bg-gradient-to-b from-blue-50 to-blue-100/30"
          />
        </Card>

        <Card className="p-4 w-full">
          <div className="flex items-center gap-3 text-sm mb-3">
            {(['Config', 'Markers'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 rounded-full border ${tab === t ? 'bg-white shadow' : 'bg-zinc-50 border-transparent'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'Config' ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-zinc-500">Start Freq (MHz)</div>
                <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="800" />
              </div>
              <div>
                <div className="text-xs text-zinc-500">Stop Freq (MHz)</div>
                <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="3000" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-zinc-500">RBW (MHz)</div>
                  <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="1" />
                </div>
                <div>
                  <div className="text-xs text-zinc-500">VBW (MHz)</div>
                  <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="3" />
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Reference Level (dBm)</div>
                <input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" defaultValue="-20" />
              </div>
              <div>
                <div className="text-xs text-zinc-500">Detector Type</div>
                <select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white">
                  <option>Peak</option>
                  <option>RMS</option>
                </select>
              </div>
              <button className="rounded-xl bg-[#6B77F7] text-white w-full py-2">Update Sweep</button>
              <div className="pt-2">
                <div className="text-sm font-medium">Display Options</div>
                <label className="flex items-center justify-between pt-2 text-sm">
                  Max Hold <input type="checkbox" />
                </label>
                <label className="flex items-center justify-between pt-2 text-sm">
                  Delta Mode <input type="checkbox" />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium">Markers</div>
              <div>
                <div className="text-xs text-zinc-500">Add Marker at Frequency (MHz)</div>
                <div className="flex gap-2 mt-1">
                  <input className="w-full rounded-xl border px-3 py-2 bg-white" placeholder="MHz" />
                  <button className="px-3 py-2 rounded-xl border">+</button>
                </div>
              </div>
              <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500 grid place-items-center">
                No markers added
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
