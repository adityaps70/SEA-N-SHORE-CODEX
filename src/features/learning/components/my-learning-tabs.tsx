'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { MY_LEARNING_TABS, type MyLearningTab } from './my-learning-tab-names'

const TAB_LABELS: Record<MyLearningTab, string> = {
  courses: 'Courses',
  certificates: 'Certificates',
  purchases: 'Purchases',
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** `#purchases` (older links) and `#certificates` open their tab. */
function tabFromHash(hash: string): MyLearningTab | null {
  const tab = hash.replace(/^#/, '')
  return tab === 'purchases' || tab === 'certificates' ? tab : null
}

/**
 * My Learning's Courses / Certificates / Purchases tabs (learning round C, C6). The server picks the first tab from
 * `?tab=`; a `#purchases` link opens Purchases. Arrow keys, Home and End move between tabs.
 */
export function MyLearningTabs({
  initialTab,
  panels,
}: {
  initialTab: MyLearningTab
  panels: Record<MyLearningTab, ReactNode>
}) {
  const baseId = useId()
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash, () => '')
  const hashTab = tabFromHash(hash)
  const [chosen, setChosen] = useState<MyLearningTab | null>(null)
  // A navigation to another `?tab=` replaces an earlier click.
  const [seenInitialTab, setSeenInitialTab] = useState(initialTab)
  if (seenInitialTab !== initialTab) {
    setSeenInitialTab(initialTab)
    setChosen(null)
  }
  const active = chosen ?? hashTab ?? initialTab
  const tabRefs = useRef<Partial<Record<MyLearningTab, HTMLButtonElement | null>>>({})

  // A new #purchases link on this page wins over an earlier tab choice.
  useEffect(() => {
    const onHashChange = () => setChosen(null)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // The browser could not scroll to an anchor inside a hidden tab, so scroll once the tab is open.
  useEffect(() => {
    if (!hashTab) return
    document.getElementById(hashTab)?.scrollIntoView({ block: 'start' })
  }, [hashTab])

  function select(tab: MyLearningTab, focus = false) {
    setChosen(tab)
    if (focus) tabRefs.current[tab]?.focus()
    const url = new URL(window.location.href)
    if (tab === 'courses') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    url.hash = ''
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = MY_LEARNING_TABS.indexOf(active)
    const last = MY_LEARNING_TABS.length - 1
    const target = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null
    if (target === null) return
    event.preventDefault()
    select(MY_LEARNING_TABS[target]!, true)
  }

  return (
    <div className="mt-6 max-md:mt-0">
      <div
        role="tablist"
        aria-label="My learning"
        className="flex gap-1 overflow-x-auto border-b border-mist-100 text-sm font-semibold max-md:bg-white max-md:px-4"
      >
        {MY_LEARNING_TABS.map((tab) => {
          const selected = tab === active
          return (
            <button
              key={tab}
              ref={(element) => { tabRefs.current[tab] = element }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab)}
              onKeyDown={onKeyDown}
              className={`-mb-px inline-flex min-h-11 shrink-0 cursor-pointer items-center border-b-2 px-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ocean-500 ${selected ? 'border-ocean-700 text-ocean-800' : 'border-transparent text-muted hover:border-mist-300 hover:text-navy-950'}`}
            >
              {TAB_LABELS[tab]}
            </button>
          )
        })}
      </div>

      {MY_LEARNING_TABS.map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`${baseId}-panel-${tab}`}
          aria-labelledby={`${baseId}-tab-${tab}`}
          hidden={tab !== active}
          tabIndex={0}
        >
          {panels[tab]}
        </div>
      ))}
    </div>
  )
}
