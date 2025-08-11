import React from 'react'
type Tone='green'|'red'|'zinc'|'blue'|'purple'; 
const map:Record<Tone,string>={green:'badge badge-green',red:'badge badge-red',zinc:'badge badge-zinc',blue:'badge badge-blue',purple:'badge bg-violet-50 text-violet-600'};
export const Badge: React.FC<{tone?:Tone; children:React.ReactNode}> = ({tone='zinc', children}) => (<span className={map[tone]}>{children}</span>)