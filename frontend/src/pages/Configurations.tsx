import React from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
export default function Configurations(){
  return (<div>
    <PageHeader title='Configurations' subtitle='Manage your test parameters and device settings' />
    <div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
      <Card className='p-4 lg:col-span-2'>
        <div className='text-base font-semibold'>DUT Connection</div>
        <div className='subtle'>Connect to Device Under Test</div>
        <div className='mt-4 h-48 rounded-xl border border-dashed border-zinc-300 grid place-items-center text-sm text-zinc-500'>Devices table placeholder (same as earlier build)</div>
        <div className='flex items-center justify-between mt-4 text-sm'><div className='text-rose-600 inline-flex items-center gap-2'><span className='text-lg'>●</span> Disconnected</div><button className='px-4 py-2 rounded-xl bg-violet-600 text-white'>Connect</button></div>
      </Card>
      <div className='space-y-4'>
        <Card className='p-4'>
          <div className='text-base font-semibold'>Analyzer Connection</div>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm'><div><label className='text-xs text-zinc-500'>IP Address</label><input className='field w-full mt-1' defaultValue='192.168.1.100'/></div><div><label className='text-xs text-zinc-500'>Port</label><input className='field w-full mt-1' defaultValue='5555'/></div><div><label className='text-xs text-zinc-500'>Model</label><div className='field w-full mt-1'>Keysight N9020A</div></div><div><label className='text-xs text-zinc-500'>Status</label><div className='mt-1'><Badge tone='green'>Connected</Badge></div></div></div>
          <div className='mt-4 flex justify-end'><button className='px-3 py-2 rounded-xl bg-emerald-500 text-white'>Disconnect</button></div>
        </Card>
        <Card className='p-4'>
          <div className='text-base font-semibold'>Test Parameters</div>
          <div className='mt-3 flex gap-2 flex-wrap'><span className='badge bg-blue-50 text-blue-600'>LoRa</span><span className='badge bg-violet-50 text-violet-600'>LTE</span><span className='badge badge-zinc'>BLE</span></div>
          <textarea className='field w-full min-h-[96px] mt-3' placeholder='Optional – describe special conditions or notes for this test session'/>
        </Card>
      </div>
    </div>
  </div>)
}