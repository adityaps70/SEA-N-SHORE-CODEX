import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('native LMS phase 1 contract', () => {
  it('defines the additive LMS schema', () => {
    const sql = read('infra/aws/database/migrations/0019_learning_lms_phase_1.sql')
    expect(sql).toContain('navigation_mode')
    expect(sql).toContain("'image'")
    expect(sql).toContain("'external_embed'")
    expect(sql).toContain("'scorm'")
    expect(sql).toContain('release_mode')
    expect(sql).toContain('prerequisite_lesson_id')
    expect(sql).toContain('completion_rule')
    expect(sql).toContain('completion_threshold')
    expect(sql).toContain('max_attempts')
    expect(sql).toContain('learning_scorm_packages')
    expect(sql).toContain('learning_scorm_attempts')
    expect(sql).toContain('learning_assignments')
    expect(sql).toContain('learning_assignment_attempts')
  })

  it('keeps the LMS migration guarded and exact-head CI gated', () => {
    const guard = read('scripts/aws/learning-lms-phase-1-migration-action.txt').trim()
    const workflow = read('.github/workflows/aws-learning-lms-phase-1-migration.yml')
    expect(['plan', 'migrate-once']).toContain(guard)
    expect(workflow).toContain('case "$ACTION" in')
    expect(workflow).toContain('plan|migrate-once')
    expect(workflow).toContain('AWS Infrastructure CI')
    expect(workflow).toContain('310356785722')
    expect(workflow).toContain('migrate-once')
    expect(workflow).toContain('github.sha')
  })

  it('provides native material and SCORM player components', () => {
    const materialPlayer = read('src/features/learning/components/material-player.tsx')
    const scormPlayer = read('src/features/learning/components/scorm-player.tsx')
    expect(materialPlayer).toContain('MaterialPlayer')
    expect(materialPlayer).toContain("case 'image'")
    expect(materialPlayer).toContain("case 'pdf'")
    expect(materialPlayer).toContain("case 'external_embed'")
    expect(materialPlayer).toContain("case 'scorm'")
    expect(scormPlayer).toContain('SCORM')
    expect(scormPlayer).toContain('API_1484_11')
    expect(scormPlayer).toContain('window.API')
  })

  it('adds first-class material controls to Mentor Studio', () => {
    const editor = read('src/features/learning/components/mentor-curriculum-editor.tsx')
    expect(editor).toContain('Add material')
    expect(editor).toContain('Scheduled release')
    expect(editor).toContain('Drip after enrollment')
    expect(editor).toContain('Prerequisite')
    expect(editor).toContain('Maximum attempts')
    expect(editor).toContain('SCORM ZIP')
  })

  it('does not rely on the generic external Open lesson control for normal player content', () => {
    const page = read('src/app/(app)/learn/courses/[slug]/learn/page.tsx')
    expect(page).toContain('MaterialPlayer')
    expect(page).not.toContain('Open lesson resource')
  })
})
