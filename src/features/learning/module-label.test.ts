import { describe, expect, it } from 'vitest'
import { moduleCrumb, moduleLabel, titleHasModuleNumber } from './module-label'

describe('module labels (Round H, H7)', () => {
  it('recognises titles that already start with a module or section number', () => {
    expect(titleHasModuleNumber('Module 1 · Team Working')).toBe(true)
    expect(titleHasModuleNumber('module 12: Ballast')).toBe(true)
    expect(titleHasModuleNumber('SECTION 3 - Mooring')).toBe(true)
    expect(titleHasModuleNumber('  Unit 2 Basics')).toBe(true)
    expect(titleHasModuleNumber('Module1 Intro')).toBe(true)
    expect(titleHasModuleNumber('Team Working')).toBe(false)
    expect(titleHasModuleNumber('Modules overview')).toBe(false)
    expect(titleHasModuleNumber('The module 1 recap')).toBe(false)
  })

  it('drops the "Module N" label when the title already has it', () => {
    expect(moduleLabel(0, 'Module 1 · Team Working')).toBeNull()
    expect(moduleLabel(1, 'Section 2 Mooring')).toBeNull()
    expect(moduleLabel(0, 'Team Working')).toBe('Module 1')
    expect(moduleLabel(4, 'Ballast')).toBe('Module 5')
  })

  it('uses the numbered title in the breadcrumb, otherwise "Module N"', () => {
    expect(moduleCrumb(0, ' Module 1 · Team Working ')).toBe('Module 1 · Team Working')
    expect(moduleCrumb(2, 'Navigation')).toBe('Module 3')
  })
})
