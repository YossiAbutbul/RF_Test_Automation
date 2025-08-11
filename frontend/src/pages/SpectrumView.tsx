import React from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import ChartPanel from '@/components/spectrum/ChartPanel'
import RightPanel from '@/components/spectrum/RightPanel'
export default function SpectrumView(){
  return (
    <div>
      <PageHeader title='Spectrum View' subtitle='Analyze real-time frequency domain data' />
      <div className='flex items-center gap-2 mb-3'><button className='rounded-xl bg-blue-100 text-blue-700 px-3 py-1 text-xs'>Live</button><button className='rounded-xl border px-3 py-1 text-xs'>Fullscreen</button><button className='rounded-xl border px-3 py-1 text-xs'>Pause</button></div>
      <div className='grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4'>
        <ChartPanel/>
        <RightPanel/>
      </div>
    </div>
  )
}