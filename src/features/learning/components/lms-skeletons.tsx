/**
 * Learning round E (E10): loading skeletons for the LMS pages, shaped like the page that is coming so nothing jumps
 * when it arrives. The pulse stops for people who ask for reduced motion.
 */

function Block({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-2xl bg-mist-100 motion-safe:animate-pulse ${className}`} />
}

function Loading({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function CatalogueSkeleton() {
  return (
    <Loading label="Loading courses" className="mx-auto w-full max-w-page-wide space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Block className="h-40 rounded-[1.75rem]" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white">
            <Block className="aspect-video rounded-none" />
            <div className="space-y-3 p-5">
              <Block className="h-4 w-1/3" />
              <Block className="h-5 w-4/5" />
              <Block className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  )
}

export function CoursePageSkeleton() {
  return (
    <Loading label="Loading the course" className="mx-auto w-full max-w-page-wide space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Block className="h-72 rounded-[1.75rem] bg-navy-100" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => <Block key={index} className="h-16" />)}
        </div>
        <Block className="h-64" />
      </div>
    </Loading>
  )
}

export function PlayerSkeleton() {
  return (
    <Loading label="Loading the lesson" className="mx-auto grid w-full max-w-page-wide gap-6 px-4 py-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:px-6">
      <div className="hidden space-y-3 lg:block">
        <Block className="h-24" />
        {Array.from({ length: 6 }, (_, index) => <Block key={index} className="h-14" />)}
      </div>
      <div className="space-y-4">
        <Block className="h-11 w-2/3" />
        <Block className="h-9 w-3/4" />
        <Block className="aspect-video" />
        <Block className="h-4 w-1/2" />
      </div>
    </Loading>
  )
}

export function MyLearningSkeleton() {
  return (
    <Loading label="Loading your courses" className="mx-auto w-full max-w-page-wide space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Block className="h-32 rounded-[1.9rem] bg-navy-100 max-md:hidden" />
      <Block className="h-24" />
      <div className="flex gap-2">{Array.from({ length: 3 }, (_, index) => <Block key={index} className="h-11 w-28 rounded-full" />)}</div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <Block key={index} className="h-80 rounded-[1.5rem]" />)}
      </div>
    </Loading>
  )
}

export function StudioSkeleton() {
  return (
    <Loading label="Loading Learning Studio" className="mx-auto w-full max-w-page-wide space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex justify-end gap-2"><Block className="h-11 w-28" /><Block className="h-11 w-36" /></div>
      <Block className="h-40 rounded-[1.8rem] bg-navy-100" />
      <Block className="h-11 w-80 max-w-full" />
      <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Block key={index} className="h-48 rounded-[1.4rem]" />)}</div>
    </Loading>
  )
}

export function CourseEditorSkeleton() {
  return (
    <Loading label="Loading the course editor" className="mx-auto w-full max-w-page-wide space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Block className="h-32 rounded-[1.75rem]" />
      <div className="grid gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">{Array.from({ length: 6 }, (_, index) => <Block key={index} className="h-11" />)}</div>
        <div className="space-y-5">{Array.from({ length: 3 }, (_, index) => <Block key={index} className="h-64 rounded-[1.5rem]" />)}</div>
      </div>
    </Loading>
  )
}
