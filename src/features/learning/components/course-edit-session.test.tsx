import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn(), save: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))

import { CourseEditSession, SaveStatus, useUnsavedChanges } from './course-edit-session'

function DraftField({ withSave = true }: { withSave?: boolean }) {
  const [value, setValue] = useState('')
  useUnsavedChanges('draft-field', value.length > 0, 'Material “Inspection evidence”', withSave
    ? async () => {
        const result = await mocks.save(value)
        if (result.ok) setValue('')
        return result
      }
    : undefined)
  return <input aria-label="Draft field" value={value} onChange={(event) => setValue(event.target.value)} />
}

function renderSession(withSave = true) {
  return render(
    <CourseEditSession>
      <a href="/learn/studio">Learning Studio</a>
      <a href="#curriculum">Jump to curriculum</a>
      <DraftField withSave={withSave} />
    </CourseEditSession>,
  )
}

describe('CourseEditSession leave warning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockResolvedValue({ ok: true })
  })

  afterEach(() => cleanup())

  it('lets links work normally when nothing is unsaved', () => {
    renderSession()
    const link = screen.getByRole('link', { name: 'Learning Studio' })
    let blockedByGuard: boolean | null = null
    const recordAndStopJsdomNavigation = (event: Event) => {
      blockedByGuard = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', recordAndStopJsdomNavigation)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    document.removeEventListener('click', recordAndStopJsdomNavigation)
    expect(blockedByGuard).toBe(false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks before following a link away from unsaved edits and can leave without saving', async () => {
    renderSession()
    fireEvent.change(screen.getByLabelText('Draft field'), { target: { value: 'Unsaved lesson text' } })

    const link = screen.getByRole('link', { name: 'Learning Studio' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    act(() => {
      link.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    const dialog = await screen.findByRole('alertdialog', { name: 'You have unsaved changes' })
    expect(dialog).toHaveTextContent('Material “Inspection evidence”')
    expect(screen.getByRole('button', { name: 'Stay on this page' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }))
    expect(mocks.push).toHaveBeenCalledWith('/learn/studio')
  })

  it('saves and then leaves when asked to', async () => {
    renderSession()
    fireEvent.change(screen.getByLabelText('Draft field'), { target: { value: 'Unsaved lesson text' } })
    act(() => {
      screen.getByRole('link', { name: 'Learning Studio' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/learn/studio'))
    expect(mocks.save).toHaveBeenCalledWith('Unsaved lesson text')
  })

  it('stays on the page with the error when saving before leaving fails', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Material title is required.' })
    renderSession()
    fireEvent.change(screen.getByLabelText('Draft field'), { target: { value: 'Unsaved lesson text' } })
    act(() => {
      screen.getByRole('link', { name: 'Learning Studio' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }))

    expect(await screen.findByText('Material “Inspection evidence” could not be saved: Material title is required.')).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Draft field')).toHaveValue('Unsaved lesson text')
  })

  it('closes with Escape and keeps the edits', async () => {
    renderSession(false)
    fireEvent.change(screen.getByLabelText('Draft field'), { target: { value: 'Unsaved lesson text' } })
    act(() => {
      screen.getByRole('link', { name: 'Learning Studio' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    await screen.findByRole('alertdialog')
    expect(screen.queryByRole('button', { name: 'Save and leave' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft field')).toHaveValue('Unsaved lesson text')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not intercept same-page anchors', () => {
    renderSession()
    fireEvent.change(screen.getByLabelText('Draft field'), { target: { value: 'Unsaved' } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    screen.getByRole('link', { name: 'Jump to curriculum' }).dispatchEvent(event)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks the browser to confirm reload or tab close while edits are unsaved', () => {
    renderSession()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(screen.getByLabelText('Draft field'), { target: { value: 'Unsaved' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('SaveStatus', () => {
  afterEach(() => cleanup())

  it.each([
    [{ kind: 'idle' } as const, false, 'All changes saved'],
    [{ kind: 'idle' } as const, true, 'Unsaved changes'],
    [{ kind: 'saving' } as const, true, 'Saving…'],
    [{ kind: 'error', message: 'Refused' } as const, true, 'Not saved — your changes are still here'],
  ])('announces %o (dirty=%s) as “%s”', (state, dirty, copy) => {
    render(<SaveStatus state={state} dirty={dirty} />)
    expect(screen.getByRole('status')).toHaveTextContent(copy)
  })

  it('shows the time of the last save', () => {
    render(<SaveStatus state={{ kind: 'saved', at: '2026-09-27T14:32:00.000Z' }} dirty={false} />)
    const expected = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date('2026-09-27T14:32:00.000Z'))
    expect(screen.getByRole('status')).toHaveTextContent(`Saved at ${expected}`)
  })
})
