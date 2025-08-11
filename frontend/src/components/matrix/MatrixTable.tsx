import React from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

const ROWS=[
  {status:'Passed', name:'TX Power', value:'14.20 dBm', low:'13.5 dBm', high:'14.5 dBm', result:'Pass'},
  {status:'Passed', name:'Frequency Accuracy', value:'868.00 MHz', low:'867.9 MHz', high:'868.1 MHz', result:'Pass'},
  {status:'Failed', name:'Spurious Emissions', value:'-35.20 dBm', low:'-40 dBm', high:'-30 dBm', result:'Fail'},
  {status:'Not Started', name:'OBW', value:'-', low:'0 kHz', high:'125 kHz', result:'-'},
]
export default function MatrixTable(){
  return (
    <Card className='p-0 overflow-hidden'>
      <div className='p-4 text-sm text-zinc-600'>LoRa Test Execution • <span className='text-zinc-400'>Test results for LoRa protocol</span> <span className='float-right text-zinc-500'>Tests: 2/3 passed</span></div>
      <table className='w-full text-sm'>
        <thead className='bg-zinc-50'>
          <tr className='text-left text-zinc-500'>
            <th className='py-2 px-4'>Status</th><th className='py-2 px-4'>Test Name</th><th className='py-2 px-4'>Measured Value</th><th className='py-2 px-4'>Low Limit</th><th className='py-2 px-4'>High Limit</th><th className='py-2 px-4'>Result</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r,i)=> (
            <tr key={i} className='border-t border-zinc-200'>
              <td className='py-2 px-4'>{r.status==='Passed'?<Badge tone='green'>Passed</Badge>:r.status==='Failed'?<Badge tone='red'>Failed</Badge>:<span className='badge badge-zinc'>Not Started</span>}</td>
              <td className='py-2 px-4'>{r.name}</td>
              <td className='py-2 px-4'>{r.value}</td>
              <td className='py-2 px-4'>{r.low}</td>
              <td className='py-2 px-4'>{r.high}</td>
              <td className='py-2 px-4'>{r.result in ['Pass','Fail']? (r.result=='Pass'?<Badge tone='green'>Pass</Badge>:<Badge tone='red'>Fail</Badge>) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}