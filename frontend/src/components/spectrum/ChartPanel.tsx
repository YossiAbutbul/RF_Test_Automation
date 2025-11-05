import React from 'react'
import { Card } from "@/shared/components/ui/Card";
export default function ChartPanel(){
  return (
    <Card className='p-4'>
      <div className='font-medium'>Spectrum Analysis</div>
      <div className='text-sm text-zinc-500'>Real-time frequency domain monitoring</div>
      <div className='mt-3 h-[520px] rounded-xl border bg-gradient-to-b from-blue-50 to-blue-100/30 border-zinc-200 grid place-items-center text-sm text-zinc-500'>
        Spectrum chart placeholder
      </div>
    </Card>
  )
}