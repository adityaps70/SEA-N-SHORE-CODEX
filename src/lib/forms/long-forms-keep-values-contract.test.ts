import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Hotfix P2: React 19 resets a `<form action={fn}>`'s uncontrolled fields after every submit, errors
 * included. These long forms lost what was typed that way; each <form> with an action must also have an
 * onSubmit that submits without the reset (submitWithoutReset, or its own preventDefault and transition).
 */
const LONG_FORMS = [
  'src/features/jobs/components/hiring-job-form.tsx',
  'src/features/events/components/event-form.tsx',
  'src/features/community/components/create-community-form.tsx',
  'src/features/community/components/admin-group-form.tsx',
  'src/features/organizations/components/organization-branding-form.tsx',
  'src/features/profiles/components/profile-card-editing.tsx',
  'src/features/profiles/components/profile-edit-form.tsx',
]

function forms(file: string) {
  const text = readFileSync(path.join(process.cwd(), file), 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: Array<{ line: number; attributes: Set<string> }> = []
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'form') {
      const attributes = new Set(node.attributes.properties.filter(ts.isJsxAttribute).map((property) => property.name.getText(source)))
      found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, attributes })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { found, text }
}

describe('long forms keep what was typed (hotfix P2)', () => {
  it.each(LONG_FORMS)('%s submits without React’s form reset', (file) => {
    const { found, text } = forms(file)
    expect(found.length).toBeGreaterThan(0)
    for (const form of found) {
      expect(form.attributes.has('onSubmit'), `${file}:${form.line} has an onSubmit`).toBe(true)
    }
    expect(text).toMatch(/submitWithoutReset|event\.preventDefault\(\)/)
  })

  it('the profile edit page no longer remounts its form on every error (which reset the rank picker)', () => {
    expect(readFileSync(path.join(process.cwd(), 'src/features/profiles/components/profile-edit-form.tsx'), 'utf8')).not.toMatch(/<form key=/)
  })
})
