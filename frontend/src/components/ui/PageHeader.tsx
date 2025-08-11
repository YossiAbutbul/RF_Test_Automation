import React from 'react'
export const PageHeader: React.FC<{title:string; subtitle?:string; right?:React.ReactNode}> = ({title,subtitle,right}) => (
  <div className='flex items-end justify-between gap-4 mb-6'>
    <div><h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>{subtitle && <p className='text-sm text-zinc-500 mt-1'>{subtitle}</p>}</div>{right}
  </div>
)