'use client'

import { Check, Plus, Smile, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const RECENT_EMOJI_KEY = 'sea-n-shore:message-recent-emojis'
const RECENT_EMOJI_LIMIT = 24
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍'] as const

const EMOJI_CATEGORIES = {
  smileys: {
    label: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '😊', '😇', '🙂',
      '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝',
      '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '🙂‍↕️', '😏', '😒',
      '🙂‍↔️', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺',
      '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨',
      '😰', '😥', '😓', '🤗', '🤔', '🫣', '🤭', '🫢', '🫡', '🤫', '🫠', '🤥',
      '😶', '🫥', '😐', '🫤', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲',
      '🥱', '😴', '🤤', '😪', '😵', '😵‍💫', '🤐', '🥴', '🤢', '🤮', '🤧', '😷',
      '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👻', '💀', '☠️', '👽', '🤖', '💩',
    ],
  },
  people: {
    label: 'People',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏',
      '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '🫵',
      '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝',
      '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👂', '👃', '🧠',
      '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫦', '👶', '🧒', '👦',
      '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅',
      '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '🧑‍⚕️', '🧑‍🎓', '🧑‍🏫', '🧑‍⚖️',
      '🧑‍🌾', '🧑‍🍳', '🧑‍🔧', '🧑‍🏭', '🧑‍💼', '🧑‍🔬', '🧑‍💻', '🧑‍🎤', '🧑‍🚀',
      '🧑‍🚒', '👮', '🕵️', '💂', '🥷', '👷', '🫅', '🤴', '👸', '👳', '🧕',
    ],
  },
  animals: {
    label: 'Animals',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁',
      '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦',
      '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝',
      '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️',
      '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🪼', '🦐', '🦞', '🦀',
      '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🦭', '🐊', '🐅', '🐆', '🦓',
      '🫎', '🦬', '🐘', '🦣', '🦏', '🦛', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂',
      '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈',
      '🪶', '🪽', '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀',
      '🎍', '🪴', '🎋', '🍃', '🍂', '🍁', '🪺', '🪹', '🍄', '🐚', '🪸',
    ],
  },
  food: {
    label: 'Food',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍋‍🟩', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈',
      '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🫛', '🥦', '🥬',
      '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🫚', '🥐',
      '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩',
      '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯',
      '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟',
      '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨',
      '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪',
      '🌰', '🥜', '🍯', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🫙', '🍶', '🍺',
      '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊',
    ],
  },
  activities: {
    label: 'Activities',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓',
      '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿',
      '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂',
      '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽',
      '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️',
      '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹',
      '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳',
      '🎮', '🎰', '🧩', '🎉', '🎊', '🎈', '🎁', '✨', '🎆', '🎇', '🧨',
    ],
  },
  travel: {
    label: 'Travel',
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚',
      '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛹', '🛼', '🚨', '🚔', '🚍', '🚘',
      '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂',
      '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸',
      '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🛟', '⛽', '🚧',
      '🚦', '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠',
      '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖',
      '🏠', '🏡', '🏢', '🏥', '🏦', '🏨', '🏪', '🏫', '🏭', '🏗️', '🧱', '🪨',
      '🌅', '🌄', '🌠', '🎇', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁',
    ],
  },
  objects: {
    label: 'Objects',
    emojis: [
      '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '💽',
      '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️',
      '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️',
      '⌛', '⏳', '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️',
      '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰',
      '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🧲', '🔮', '📿',
      '🧿', '🪬', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '🩻', '🩼', '💊',
      '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚿', '🛁',
      '🪥', '🪒', '🧴', '🧷', '🧽', '🪣', '🧼', '🫧', '🗝️', '🔑', '🚪', '🪑',
      '🛋️', '🛏️', '🪞', '🪟', '🧸', '🪆', '🖼️', '🪩', '🛍️', '🎁',
    ],
  },
  symbols: {
    label: 'Symbols',
    emojis: [
      '❤️', '🩷', '🧡', '💛', '💚', '💙', '🩵', '💜', '🤎', '🖤', '🩶', '🤍',
      '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
      '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎',
      '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔',
      '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️',
      '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎',
      '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️',
      '🚷', '🚯', '🚳', '🚱', '📵', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅',
      '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️',
      '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗',
      '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻',
    ],
  },
  flags: {
    label: 'Flags',
    emojis: [
      '🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🇺🇳', '🇮🇳', '🇺🇸', '🇬🇧', '🇦🇺', '🇨🇦',
      '🇸🇬', '🇦🇪', '🇯🇵', '🇰🇷', '🇨🇳', '🇭🇰', '🇲🇾', '🇮🇩', '🇵🇭', '🇹🇭', '🇻🇳', '🇱🇰',
      '🇧🇩', '🇵🇰', '🇳🇵', '🇧🇹', '🇲🇻', '🇸🇦', '🇶🇦', '🇴🇲', '🇧🇭', '🇰🇼', '🇮🇱',
      '🇹🇷', '🇬🇷', '🇨🇾', '🇮🇹', '🇫🇷', '🇩🇪', '🇪🇸', '🇵🇹', '🇳🇱', '🇧🇪', '🇨🇭',
      '🇦🇹', '🇩🇰', '🇳🇴', '🇸🇪', '🇫🇮', '🇮🇸', '🇮🇪', '🇵🇱', '🇨🇿', '🇭🇺', '🇷🇴',
      '🇧🇬', '🇭🇷', '🇸🇮', '🇷🇸', '🇺🇦', '🇧🇷', '🇦🇷', '🇨🇱', '🇲🇽', '🇿🇦', '🇪🇬',
      '🇰🇪', '🇳🇬', '🇲🇦', '🇳🇿',
    ],
  },
} as const

type EmojiCategory = keyof typeof EMOJI_CATEGORIES
type PickerCategory = EmojiCategory | 'recent'
const CATEGORY_KEYS = Object.keys(EMOJI_CATEGORIES) as EmojiCategory[]

function isSingleEmoji(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32) return false
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)]
  if (segments.length !== 1) return false
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(trimmed)
}

function readRecentEmoji() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && isSingleEmoji(value)).slice(0, RECENT_EMOJI_LIMIT)
  } catch {
    return []
  }
}

function retainRecentEmoji(current: string[], emoji: string) {
  return [emoji, ...current.filter((value) => value !== emoji)].slice(0, RECENT_EMOJI_LIMIT)
}

export function MessageEmojiPicker({
  mode = 'insert',
  currentEmoji = null,
  triggerLabel,
  align = 'start',
  onSelect,
}: {
  mode?: 'insert' | 'reaction'
  currentEmoji?: string | null
  triggerLabel?: string
  align?: 'start' | 'end'
  onSelect: (emoji: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [expandedReactionPicker, setExpandedReactionPicker] = useState(false)
  const [custom, setCustom] = useState('')
  const [category, setCategory] = useState<PickerCategory>(mode === 'reaction' ? 'symbols' : 'smileys')
  const [recent, setRecent] = useState<string[]>(readRecentEmoji)
  const rootRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setExpandedReactionPicker(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const visibleEmoji = useMemo(
    () => category === 'recent' ? recent : EMOJI_CATEGORIES[category].emojis,
    [category, recent],
  )

  function remember(emoji: string) {
    if (mode !== 'insert') return
    const next = retainRecentEmoji(recent, emoji)
    setRecent(next)
    try {
      window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next))
    } catch {
      // Recent emoji history is optional; message composition remains fully functional.
    }
  }

  function choose(emoji: string) {
    onSelect(mode === 'reaction' && currentEmoji === emoji ? null : emoji)
    remember(emoji)
    setCustom('')
    if (mode === 'reaction') {
      setOpen(false)
      setExpandedReactionPicker(false)
    }
  }

  function chooseCustom() {
    const emoji = custom.trim()
    if (!isSingleEmoji(emoji)) return
    choose(emoji)
  }

  function toggleOpen() {
    setOpen((value) => {
      if (value) setExpandedReactionPicker(false)
      return !value
    })
  }

  const accessibleTriggerLabel = triggerLabel ?? (mode === 'reaction' ? 'React to message' : 'Add emoji')
  const positionClass = align === 'end' ? 'right-0' : 'left-0'

  const fullPicker = (
    <div
      role="menu"
      aria-label={mode === 'reaction' ? 'Choose reaction emoji' : 'Choose emoji'}
      className={`absolute bottom-full ${positionClass} z-50 mb-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-mist-100 bg-white p-2 shadow-xl`}
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {mode === 'insert' && recent.length ? (
          <button
            type="button"
            aria-label="Show recent emojis"
            aria-pressed={category === 'recent'}
            onClick={() => setCategory('recent')}
            className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
              category === 'recent'
                ? 'bg-navy-950 text-white'
                : 'bg-mist-50 text-muted hover:bg-mist-100 hover:text-navy-950'
            }`}
          >
            Recent
          </button>
        ) : null}
        {CATEGORY_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`Show ${key} emojis`}
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
            className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
              category === key
                ? 'bg-navy-950 text-white'
                : 'bg-mist-50 text-muted hover:bg-mist-100 hover:text-navy-950'
            }`}
          >
            {EMOJI_CATEGORIES[key].label}
          </button>
        ))}
      </div>

      <div className="max-h-56 overflow-y-auto overflow-x-hidden pr-1">
        <div className="grid grid-cols-8 gap-1">
          {visibleEmoji.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              aria-label={mode === 'reaction' ? `React with ${emoji}` : `Insert ${emoji}`}
              onClick={() => choose(emoji)}
              className={`grid size-9 place-items-center rounded-lg text-xl transition hover:bg-mist-50 ${
                currentEmoji === emoji ? 'bg-ocean-50 ring-1 ring-ocean-200' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-mist-100 pt-2">
        <label className="sr-only" htmlFor={`custom-emoji-${mode}`}>
          {mode === 'reaction' ? 'Custom emoji reaction' : 'Custom emoji'}
        </label>
        <input
          id={`custom-emoji-${mode}`}
          aria-label={mode === 'reaction' ? 'Custom emoji reaction' : 'Custom emoji'}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder="Any emoji"
          maxLength={32}
          className="min-h-9 min-w-0 flex-1 rounded-xl border border-mist-100 px-3 text-sm outline-none focus:border-ocean-400"
        />
        <button
          type="button"
          aria-label={mode === 'reaction' ? 'Use custom emoji' : 'Insert custom emoji'}
          disabled={!isSingleEmoji(custom)}
          onClick={chooseCustom}
          className="min-h-9 rounded-xl bg-navy-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use
        </button>
      </div>

      {mode === 'reaction' && currentEmoji ? (
        <button
          type="button"
          onClick={() => {
            onSelect(null)
            setOpen(false)
            setExpandedReactionPicker(false)
          }}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          <X aria-hidden="true" className="size-3.5" />
          Remove your reaction
        </button>
      ) : null}

      {mode === 'insert' ? (
        <button
          type="button"
          aria-label="Done choosing emojis"
          onClick={() => setOpen(false)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-ocean-50 px-3 py-2 text-xs font-semibold text-ocean-800 hover:bg-ocean-100"
        >
          <Check aria-hidden="true" className="size-3.5" />
          Done
        </button>
      ) : null}
    </div>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={accessibleTriggerLabel}
        aria-expanded={open}
        onClick={toggleOpen}
        className={mode === 'reaction'
          ? 'grid size-8 place-items-center rounded-full border border-mist-100 bg-white text-muted shadow-sm transition hover:text-ocean-700'
          : 'grid size-10 place-items-center rounded-full text-navy-900 transition hover:bg-white'}
      >
        <Smile aria-hidden="true" className={mode === 'reaction' ? 'size-4' : 'size-5 text-ocean-700'} />
      </button>

      {open && mode === 'reaction' && !expandedReactionPicker ? (
        <div
          role="menu"
          aria-label="Quick reactions"
          className={`absolute bottom-full ${positionClass} z-50 mb-2 flex max-w-[calc(100vw-2rem)] items-center gap-0.5 rounded-full border border-mist-100 bg-white p-1.5 shadow-xl`}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={() => choose(emoji)}
              className={`grid size-9 shrink-0 place-items-center rounded-full text-xl transition hover:bg-mist-50 ${
                currentEmoji === emoji ? 'bg-ocean-50' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            aria-label="More reaction emojis"
            onClick={() => setExpandedReactionPicker(true)}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-mist-50 text-navy-900 transition hover:bg-mist-100"
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      {open && (mode === 'insert' || expandedReactionPicker) ? fullPicker : null}
    </div>
  )
}
