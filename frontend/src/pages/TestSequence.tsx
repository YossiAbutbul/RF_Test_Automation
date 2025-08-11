import React, { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import AvailableTestsPanel from '@/components/sequence/AvailableTestsPanel'
import BuilderBoard from '@/components/sequence/BuilderBoard'
export default function TestSequence(){
  const [tab,setTab]=useState<'LoRa'|'LTE'|'BLE'>('LoRa')
  return (
    <div>
      <PageHeader title='Test Sequence' subtitle='Define and control your automated test workflows' />
      <div className='flex items-center gap-4 text-sm mb-3'>
        {(['LoRa','LTE','BLE'] as const).map(t=> (
          <button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-lg border ${tab===t?'bg-white shadow-card':'bg-zinc-50 border-transparent'}`}>{t}</button>
        ))}
        <div className='ml-auto text-sm text-zinc-500'>Total Tests: 0</div>
      </div>
      <div className='grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-4'>
        <BuilderBoard empty/>
        <AvailableTestsPanel/>
      </div>
    </div>
  )
}