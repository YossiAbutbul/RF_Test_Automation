import React from 'react'
import { Card } from '@/components/ui/Card'

export default function BuilderBoard({empty=false}:{empty?:boolean}){
  return (
    <Card className='p-4'>
      <div className='flex items-center justify-between'>
        <div>
          <div className='font-semibold'>LORA Test Procedure Builder</div>
          <div className='text-sm text-zinc-500'>Drag tests from the library or reorder existing tests</div>
        </div>
        <div className='flex gap-2'>
          <button className='rounded-xl border px-3 py-2 text-sm'>Load LORA</button>
          <button className='rounded-xl bg-violet-600 text-white px-3 py-2 text-sm'>Save LORA</button>
        </div>
      </div>
      <div className={`mt-3 rounded-xl border border-dashed ${empty?'bg-zinc-50':''} min-h-[220px] grid place-items-center text-sm text-zinc-500`}>
        {empty? 'No LORA tests added yet\nDrag tests from the library to get started' : 'Builder content placeholder'}
      </div>
    </Card>
  )
}
