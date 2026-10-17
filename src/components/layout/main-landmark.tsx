'use client'

import { createContext, useContext, type HTMLAttributes } from 'react'

const InsideMain = createContext(false)

/**
 * Round H (H8): the page's one <main id="main-content">, the target of "Skip to content".
 *
 * The member chrome and the signed-out public and marketing shells wrap every page in one, so a page
 * gets a main landmark even when it draws none itself. A page or shared view (legal pages, error and
 * not-found views, the landing page) that also uses MainLandmark renders a plain <div> when it is
 * already inside one, and the <main> itself when it stands alone (a root-level route, a unit test):
 * there is always exactly one main per page.
 */
export function MainLandmark({ children, ...props }: Omit<HTMLAttributes<HTMLElement>, 'id'>) {
  const inside = useContext(InsideMain)
  if (inside) return <div {...props}>{children}</div>
  return (
    // tabIndex -1: the skip link can move focus here (Safari does not follow a fragment to a plain element).
    <main id="main-content" tabIndex={-1} {...props}>
      <InsideMain.Provider value>{children}</InsideMain.Provider>
    </main>
  )
}

/** Round H (H8): the first focusable element of a page; hidden until it receives keyboard focus. */
export function SkipLink() {
  return (
    <a href="#main-content" className="skip-link">
      Skip to content
    </a>
  )
}
