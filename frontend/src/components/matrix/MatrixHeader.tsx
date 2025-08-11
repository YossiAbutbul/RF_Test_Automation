import React from 'react'
import { Card } from '@/components/ui/Card'
export default function MatrixHeader(){
  return (
    <Card className='p-4'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <div>
          <label className='text-xs text-zinc-500'>Select Project</label>
          <select className='field w-full'><option>IoT Sensor Array Project</option></select>
        </div>
        <div>
          <label className='text-xs text-zinc-500'>Select DUT (MAC Address)</label>
          <select className='field w-full'><option>AA:BB:CC:DD:EE:FF (RF_Device_001)</option></select>
        </div>
      </div>
      <div className='mt-3 text-sm text-zinc-500'>Current Configuration • Project: IoT Sensor Array Project • Device: AA:BB:CC:DD:EE:FF</div>
    </Card>
  )
}