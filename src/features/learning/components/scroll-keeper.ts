/**
 * Owner (15 Nov): "while creating/editing a course, every time I type or save something the page jumps to the
 * bottom. Keep the scroll position and focus where I am."
 *
 * The course builder re-renders from the server after every save (the save actions revalidate the edit page) and
 * re-renders on every keystroke (the unsaved-changes bar). Neither should move the page, so while someone is typing
 * or has just pressed a button, a jump they did not make is undone:
 *  - the field or button they were using was on screen and the jump took it off screen, or
 *  - nothing is focused and the page leapt more than half a screen down to the bottom.
 * The page goes back to where it was and focus returns to that field. Anything the person does to scroll
 * (wheel, touch, scrollbar, keyboard outside a field, a link) switches the guard off straight away, so their own
 * scrolling and the section links are never undone. The guard lapses a few seconds after the last keystroke or
 * click, which covers a slow save.
 */
export const SCROLL_KEEPER_WINDOW_MS = 5000

type Anchor = {
  y: number
  until: number
  focus: HTMLElement | null
  focusOnScreen: boolean
}

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const element = target as HTMLElement
  return element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
}

function onScreen(element: HTMLElement, viewportHeight: number): boolean {
  const rect = element.getBoundingClientRect()
  if (!rect.width && !rect.height) return false
  return rect.bottom > 0 && rect.top < viewportHeight
}

/** Starts the guard on `win`; returns the function that stops it. */
export function installScrollKeeper(win: Window): () => void {
  const doc = win.document
  let anchor: Anchor | null = null
  let restoring = false

  function focusedElement(): HTMLElement | null {
    const active = doc.activeElement
    if (!active || active === doc.body || active === doc.documentElement) return null
    return active as HTMLElement
  }

  function arm() {
    const focus = focusedElement()
    anchor = {
      y: win.scrollY,
      until: Date.now() + SCROLL_KEEPER_WINDOW_MS,
      focus,
      focusOnScreen: focus ? onScreen(focus, win.innerHeight) : false,
    }
  }

  function release() {
    anchor = null
  }

  function onInput() {
    arm()
  }

  function onClick(event: MouseEvent) {
    const target = event.target as Element | null
    // Links (including the editor's section links) move the page on purpose.
    if (target?.closest?.('a[href]')) {
      release()
      return
    }
    arm()
  }

  function onKeyDown(event: KeyboardEvent) {
    // Typing in a field keeps the guard; keys elsewhere (Page Down, Space, Tab, End, …) are the person scrolling.
    if (isEditable(event.target)) arm()
    else if (event.key !== 'Enter') release()
  }

  function onScroll() {
    if (restoring || !anchor) return
    if (Date.now() > anchor.until) {
      anchor = null
      return
    }
    const y = win.scrollY
    const viewport = win.innerHeight
    const focus = anchor.focus?.isConnected ? anchor.focus : null
    const lostFocusField = Boolean(focus && anchor.focusOnScreen && !onScreen(focus, viewport))
    const nearBottom = doc.documentElement.scrollHeight - viewport - y <= viewport
    const leapToBottom = !focus && y - anchor.y > viewport / 2 && nearBottom
    if (!lostFocusField && !leapToBottom) {
      // A small move (the caret line, a growing field) is fine; measure the next jump from here.
      anchor.y = y
      if (focus) anchor.focusOnScreen = onScreen(focus, viewport)
      return
    }
    restoring = true
    win.scrollTo(win.scrollX, anchor.y)
    restoring = false
    if (focus && focusedElement() !== focus) focus.focus({ preventScroll: true })
  }

  const passive = { capture: true, passive: true } as const
  doc.addEventListener('input', onInput, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('wheel', release, passive)
  doc.addEventListener('touchstart', release, passive)
  doc.addEventListener('pointerdown', onPointerDown, true)
  win.addEventListener('hashchange', release)
  win.addEventListener('scroll', onScroll, { passive: true })

  // A press on the page's own scrollbar lands on the root element.
  function onPointerDown(event: PointerEvent) {
    if (event.target === doc.documentElement) release()
  }

  return () => {
    doc.removeEventListener('input', onInput, true)
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('keydown', onKeyDown, true)
    doc.removeEventListener('wheel', release, passive)
    doc.removeEventListener('touchstart', release, passive)
    doc.removeEventListener('pointerdown', onPointerDown, true)
    win.removeEventListener('hashchange', release)
    win.removeEventListener('scroll', onScroll)
  }
}
