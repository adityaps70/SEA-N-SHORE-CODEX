// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { injectScormBridge, scormBridgeScript } from './scorm-bridge'

const origin = 'https://seanshore.in'

describe('SCORM runtime bridge (Round 14, 2.3)', () => {
  it('goes right after <head>, before any package script runs', () => {
    const html = injectScormBridge('<!doctype html><html><head lang="en"><script src="app.js"></script></head></html>', origin)
    expect(html.indexOf('window.API_1484_11=')).toBeGreaterThan(html.indexOf('<head lang="en">'))
    expect(html.indexOf('window.API_1484_11=')).toBeLessThan(html.indexOf('app.js'))
  })

  it('falls back to after the doctype, or the very start', () => {
    expect(injectScormBridge('<!DOCTYPE html><body>x</body>', origin)).toMatch(/^<!DOCTYPE html><script>/)
    expect(injectScormBridge('<body>x</body>', origin)).toMatch(/^<script>/)
  })

  it('posts only to the site origin and defines both SCORM runtimes', () => {
    const script = scormBridgeScript(origin)
    expect(script).toContain('target="https://seanshore.in"')
    expect(script).toContain('window.API={LMSInitialize')
    expect(script).toContain('window.API_1484_11={Initialize')
    expect(script).not.toContain("'*'")
  })

  it('keeps a synchronous runtime in the frame and mirrors writes to the player', () => {
    const posted: unknown[] = []
    const listeners: Array<(event: { source: unknown; data: unknown }) => void> = []
    const top = { postMessage: (message: unknown) => posted.push(message) }
    const frame: Record<string, unknown> = {
      top,
      addEventListener: (_type: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.push(listener),
    }
    const body = scormBridgeScript(origin).replace(/^<script>|<\/script>$/g, '')
    new Function('window', body)(frame)
    const api = frame.API as Record<string, (...args: string[]) => string>
    const api2004 = frame.API_1484_11 as Record<string, (...args: string[]) => string>
    expect(posted).toEqual([{ type: 'hello', source: 'sns-scorm' }])

    listeners[0]({ source: top, data: { source: 'sns-scorm-host', type: 'init', values: { 'cmi.core.lesson_status': 'not attempted' } } })
    listeners[0]({ source: {}, data: { source: 'sns-scorm-host', type: 'init', values: { 'cmi.core.lesson_status': 'forged' } } })
    expect(api.LMSInitialize()).toBe('true')
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('not attempted')
    expect(api.LMSSetValue('cmi.core.lesson_status', 'completed')).toBe('true')
    expect(api2004.GetValue('cmi.core.lesson_status')).toBe('completed')
    expect(api.LMSCommit()).toBe('true')
    expect(posted.slice(1)).toEqual([
      { type: 'set', key: 'cmi.core.lesson_status', value: 'completed', source: 'sns-scorm' },
      { type: 'commit', values: { 'cmi.core.lesson_status': 'completed' }, source: 'sns-scorm' },
    ])
  })

  it('forwards Esc pressed inside the package to the player (S2: leaving focus mode), and nothing else', () => {
    const posted: unknown[] = []
    const listeners: Record<string, Array<(event: unknown) => void>> = {}
    const top = { postMessage: (message: unknown, target: string) => posted.push({ message, target }) }
    const frame: Record<string, unknown> = {
      top,
      addEventListener: (type: string, listener: (event: unknown) => void) => { (listeners[type] ??= []).push(listener) },
    }
    new Function('window', scormBridgeScript(origin).replace(/^<script>|<\/script>$/g, ''))(frame)
    posted.length = 0
    listeners.keydown!.forEach((listener) => listener({ key: 'Enter' }))
    listeners.keydown!.forEach((listener) => listener({ key: 'Escape' }))
    expect(posted).toEqual([{ message: { type: 'escape', source: 'sns-scorm' }, target: origin }])
  })
})
