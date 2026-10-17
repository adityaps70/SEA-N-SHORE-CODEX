import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Round H (H8): every <input type="file"> has an accessible name: a wrapping <label>, a <label htmlFor> with its
// id, aria-label or aria-labelledby. An input that a labelled button opens instead stays out of the way of
// keyboard and screen reader users with tabIndex={-1} and aria-hidden.

const root = process.cwd()

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : []
  })
}

type Found = { where: string; labelled: boolean }

function attributeMap(element: ts.JsxOpeningLikeElement, source: ts.SourceFile) {
  const map = new Map<string, string>()
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property)) map.set(property.name.getText(source), property.initializer ? property.initializer.getText(source) : 'true')
  }
  return map
}

function fileInputs(): Found[] {
  const found: Found[] = []
  for (const file of tsxFiles(path.join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    if (!/type=["{'`]*file/.test(text)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    // Ids that a <label htmlFor=…> in the same file points at, as written (a string or an expression).
    const labelTargets = new Set<string>()
    const collect = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'label') {
        const htmlFor = attributeMap(node, source).get('htmlFor')
        if (htmlFor) labelTargets.add(htmlFor)
      }
      ts.forEachChild(node, collect)
    }
    collect(source)

    const visit = (node: ts.Node, insideLabel: boolean) => {
      let inside = insideLabel
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'label') inside = true
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'input') {
        const attributes = attributeMap(node, source)
        if (/^["{'`]*file["}'`]*$/.test(attributes.get('type') ?? '')) {
          const id = attributes.get('id')
          const labelled = insideLabel
            || attributes.has('aria-label')
            || attributes.has('aria-labelledby')
            || (id !== undefined && labelTargets.has(id))
            || (attributes.get('tabIndex') === '{-1}' && /^["{]*(true|"true")["}]*$/.test(attributes.get('aria-hidden') ?? ''))
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          found.push({ where: `${path.relative(root, file)}:${line}`, labelled })
        }
      }
      ts.forEachChild(node, (child) => visit(child, inside))
    }
    visit(source, false)
  }
  return found
}

describe('file input labels (Round H, H8)', () => {
  const inputs = fileInputs()

  it('finds the file inputs it is meant to police', () => {
    expect(inputs.length).toBeGreaterThanOrEqual(15)
  })

  it('names every file input or hides it behind the labelled button that opens it', () => {
    expect(inputs.filter((input) => !input.labelled).map((input) => input.where)).toEqual([])
  })
})
