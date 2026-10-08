'use client'

import { useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { createLearningMediaUpload, getLearningMediaReadUrl } from '../media-actions'
import { ARTICLE_IMAGE_PATH_ATTRIBUTE } from '../article-html'
import { uploadLearningMediaFile } from './upload-learning-media'

/** Course images keep their storage path; the src shown while editing is a short-lived URL. */
const CourseImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
        parseHTML: (element) => element.getAttribute(ARTICLE_IMAGE_PATH_ATTRIBUTE),
        renderHTML: (attributes) => (attributes.storagePath ? { [ARTICLE_IMAGE_PATH_ATTRIBUTE]: attributes.storagePath } : {}),
      },
    }
  },
})

type Props = {
  courseId: string
  value: string
  onChange: (html: string) => void
  ariaLabel: string
  disabled?: boolean
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-9 items-center justify-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 disabled:opacity-40 ${active ? 'bg-navy-950 text-white' : 'text-navy-900 hover:bg-mist-100'}`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor, courseId, disabled }: { editor: Editor; courseId: string; disabled: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
      quote: current.isActive('blockquote'),
      link: current.isActive('link'),
      table: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  })

  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link address (https://…)', previous ?? 'https://')
    if (url === null) return
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) {
      setError('Links must start with https://, http:// or mailto:.')
      return
    }
    setError(null)
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  async function addImage(file: File) {
    setError(null)
    setUploading(true)
    try {
      const prepared = await createLearningMediaUpload({ courseId, kind: 'lesson_image', mimeType: file.type, size: file.size })
      if (!prepared.ok) {
        setError(prepared.error)
        return
      }
      await uploadLearningMediaFile({ uploadUrl: prepared.upload.uploadUrl, file, onProgress: () => {} })
      const preview = await getLearningMediaReadUrl({ courseId, kind: 'lesson_image', storagePath: prepared.upload.storagePath })
      if (!preview.ok) {
        setError(preview.error)
        return
      }
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: { src: preview.url, alt: file.name.replace(/\.[^.]+$/, ''), storagePath: prepared.upload.storagePath },
      }).run()
    } catch {
      setError('The image didn’t upload. Check your connection and try again.')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const off = disabled
  return (
    <div className="border-b border-mist-200 bg-mist-50/70 px-2 py-1.5">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
        <ToolbarButton label="Heading" active={state.h2} disabled={off} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Subheading" active={state.h3} disabled={off} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="size-4" aria-hidden="true" /></ToolbarButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-mist-200" />
        <ToolbarButton label="Bold" active={state.bold} disabled={off} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Italic" active={state.italic} disabled={off} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Underline" active={state.underline} disabled={off} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Link" active={state.link} disabled={off} onClick={setLink}><Link2 className="size-4" aria-hidden="true" /></ToolbarButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-mist-200" />
        <ToolbarButton label="Bulleted list" active={state.bullet} disabled={off} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Numbered list" active={state.ordered} disabled={off} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Quote" active={state.quote} disabled={off} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Insert table" active={state.table} disabled={off || state.table} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label={uploading ? 'Uploading image…' : 'Insert image'} disabled={off || uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="size-4" aria-hidden="true" />}
        </ToolbarButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-mist-200" />
        <ToolbarButton label="Undo" disabled={off || !state.canUndo} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="size-4" aria-hidden="true" /></ToolbarButton>
        <ToolbarButton label="Redo" disabled={off || !state.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="size-4" aria-hidden="true" /></ToolbarButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void addImage(file)
          }}
        />
      </div>
      {state.table ? (
        <div role="toolbar" aria-label="Table" className="mt-1 flex flex-wrap items-center gap-1 text-xs font-semibold">
          {[
            ['Add row', () => editor.chain().focus().addRowAfter().run()],
            ['Add column', () => editor.chain().focus().addColumnAfter().run()],
            ['Remove row', () => editor.chain().focus().deleteRow().run()],
            ['Remove column', () => editor.chain().focus().deleteColumn().run()],
          ].map(([label, action]) => (
            <button key={label as string} type="button" disabled={off} onMouseDown={(event) => event.preventDefault()} onClick={action as () => void} className="rounded-lg border border-mist-200 bg-white px-2.5 py-1.5 text-navy-900 transition hover:border-teal-300 disabled:opacity-40">
              {label as string}
            </button>
          ))}
          <button type="button" disabled={off} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-rose-700 transition hover:bg-rose-50 disabled:opacity-40">
            <Trash2 className="size-3.5" aria-hidden="true" /> Delete table
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="px-1 pt-1 text-xs font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}

/**
 * The lesson article editor: headings, bold/italic/underline, links, lists, quotes, tables and course
 * images. It produces HTML that the server sanitizes again before saving.
 */
export function ArticleRichTextEditor({ courseId, value, onChange, ariaLabel, disabled = false }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        link: { openOnClick: false, autolink: true, protocols: ['https', 'http', 'mailto'], defaultProtocol: 'https' },
      }),
      CourseImage.configure({ inline: false, allowBase64: false }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        role: 'textbox',
        class: 'lesson-article min-h-56 px-4 py-3 text-[15px] leading-7 text-navy-950 outline-none',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.isEmpty ? '' : current.getHTML()),
  })

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-mist-200 bg-white focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
      {editor ? <Toolbar editor={editor} courseId={courseId} disabled={disabled} /> : null}
      <EditorContent editor={editor} />
    </div>
  )
}
