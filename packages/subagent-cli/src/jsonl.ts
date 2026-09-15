import { TextDecoder } from 'node:util'
import { CliFailure } from './failure.ts'
import type { ProtocolLimits } from './adapter.ts'

export const DEFAULT_PROTOCOL_LIMITS: Readonly<ProtocolLimits> = Object.freeze({ maxOutputBytes: 4*1024*1024, maxLineBytes: 1024*1024 })
export function jsonRecord(value: unknown): Record<string,unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CliFailure('invalid-event')
  return value as Record<string,unknown>
}
export function counter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
export function identity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new CliFailure('invalid-event')
  return value
}
export function createJsonLines(accept: (event: Record<string,unknown>)=>void, limits=DEFAULT_PROTOCOL_LIMITS): {push(chunk:Uint8Array):void;end():void} {
  const decoder=new TextDecoder('utf-8',{fatal:true})
  let pending='', size=0, ended=false
  function line(text:string):void {
    if(Buffer.byteLength(text,'utf8')>limits.maxLineBytes)throw new CliFailure('line-limit')
    if(text.trim()==='')return
    let value:unknown
    try { value=JSON.parse(text) } catch { throw new CliFailure('invalid-json') }
    accept(jsonRecord(value))
  }
  function text(value:string):void {
    const lines=(pending+value).split('\n')
    pending=lines.pop()??''
    for(const value of lines)line(value)
    if(Buffer.byteLength(pending,'utf8')>limits.maxLineBytes)throw new CliFailure('line-limit')
  }
  return {
    push(chunk) {
      if(ended)throw new CliFailure('invalid-event')
      size+=chunk.byteLength
      if(size>limits.maxOutputBytes)throw new CliFailure('output-limit')
      let value:string
      try { value=decoder.decode(chunk,{stream:true}) } catch { throw new CliFailure('invalid-utf8') }
      text(value)
    },
    end() {
      if(ended)return
      let tail:string
      try { tail=decoder.decode() } catch { throw new CliFailure('invalid-utf8') }
      text(tail)
      if(pending.trim()!=='')line(pending)
      pending=''; ended=true
    },
  }
}
