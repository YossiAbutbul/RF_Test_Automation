import React, { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import MatrixHeader from '@/components/matrix/MatrixHeader'
import MatrixTable from '@/components/matrix/MatrixTable'
export default function TestMatrix(){
  const [tab,setTab]=useState<'LoRa'|'LTE'|'BLE'>('LoRa')
  return (
    <div>
      <PageHeader title='Test Matrix' subtitle='Configure comprehensive testing coverage matrices' />
      <MatrixHeader/>
      <div className='flex items-center gap-4 text-sm my-3'>
        {(['LoRa','LTE','BLE'] as const).map(t=> <button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-lg border ${tab===t?'bg-white shadow-card':'bg-zinc-50 border-transparent'}`}>{t}</button>)}
        <div className='ml-auto flex gap-2'>
          <button className='rounded-xl border px-3 py-2 text-sm'>Load Matrix</button>
          <button className='rounded-xl border px-3 py-2 text-sm'>Save Matrix</button>
          <button className='rounded-xl bg-violet-500 text-white px-3 py-2 text-sm'>Run Tests</button>
        </div>
      </div>
      <MatrixTable/>
    </div>
  )
}