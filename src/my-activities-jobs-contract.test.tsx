import { render, screen } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AppHeader } from '@/components/navigation/app-header'

describe('My Activities and jobs integration contract', () => {
  it('adds My Activities and icons to the signed-in desktop header', () => {
    const { container } = render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('link', { name: /my activities/i })).toHaveAttribute('href', '/activities')
    expect(container.querySelectorAll('nav[aria-label="Primary"] svg').length).toBeGreaterThanOrEqual(7)
  })

  it('adds an activities route with exactly two post tabs and a separate jobs section', () => {
    const path = 'src/app/(app)/activities/page.tsx'
    expect(existsSync(path)).toBe(true)
    if (!existsSync(path)) return

    const source = readFileSync(path, 'utf8')
    expect(source).toContain('My Posts')
    expect(source).toContain('My Comments')
    expect(source).toContain('Jobs Applied')
  })

  it('adds the additive jobs and activities migration', () => {
    const path = 'infra/aws/database/migrations/0007_jobs_activities.sql'
    expect(existsSync(path)).toBe(true)
    if (!existsSync(path)) return

    const sql = readFileSync(path, 'utf8')
    expect(sql).toContain('create table if not exists public.jobs')
    expect(sql).toContain('create table if not exists public.job_applications')
  })
})
