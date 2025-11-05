import React, { useState } from 'react'
import { Card } from "@/shared/components/ui/Card";
export default function RightPanel(){
  const [tab,setTab]=useState<'Config'|'Markers'>('Config')
  return (
    <Card className='p-4 w-full'>
      <div className='flex items-center gap-3 text-sm mb-3'>
        {(['Config','Markers'] as const).map(t=> <button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-full border ${tab===t?'bg-white shadow-card':'bg-zinc-50 border-transparent'}`}>{t}</button>)}
      </div>
      {tab==='Config'? (
        <div className='space-y-3'>
          <div><div className='text-xs text-zinc-500'>Start Freq (MHz)</div><input className='field w-full' defaultValue='800'/></div>
          <div><div className='text-xs text-zinc-500'>Stop Freq (MHz)</div><input className='field w-full' defaultValue='3000'/></div>
          <div className='grid grid-cols-2 gap-3'>
            <div><div className='text-xs text-zinc-500'>RBW (MHz)</div><input className='field w-full' defaultValue='1'/></div>
            <div><div className='text-xs text-zinc-500'>VBW (MHz)</div><input className='field w-full' defaultValue='3'/></div>
          </div>
          <div><div className='text-xs text-zinc-500'>Reference Level (dBm)</div><input className='field w-full' defaultValue='-20'/></div>
          <div><div className='text-xs text-zinc-500'>Detector Type</div><select className='field w-full'><option>Peak</option><option>RMS</option></select></div>
          <button className='rounded-xl bg-violet-600 text-white w-full py-2'>Update Sweep</button>
          <div className='pt-2'>
            <div className='text-sm font-medium'>Display Options</div>
            <label className='flex items-center justify-between pt-2 text-sm'>Max Hold <input type='checkbox'/></label>
            <label className='flex items-center justify-between pt-2 text-sm'>Delta Mode <input type='checkbox'/></label>
          </div>
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='text-sm font-medium'>Markers</div>
          <div><div className='text-xs text-zinc-500'>Add Marker at Frequency (MHz)</div><div className='flex gap-2 mt-1'><input className='field w-full' placeholder='MHz'/><button className='px-3 py-2 rounded-xl border'>+</button></div></div>
          <div className='rounded-xl border border-dashed p-6 text-sm text-zinc-500 grid place-items-center'>No markers added</div>
        </div>
      )}
    </Card>
  )
}