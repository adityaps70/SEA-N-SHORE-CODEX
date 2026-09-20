'use client'

import { Check, Smile, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

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
      '🫎', '🦬', '🐘', '🦣', '🦏', '🦛', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃',
      '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮',
      '🐈', '🪶', '🪽', '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️',
      '🍀', '🎍', '🪴', '🎋', '🍃', '🍂', '🍁', '🪺', '🪹', '🍄', '🐚', '🪸',
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
      '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽',
      '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️',
      '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️',
      '⌛', '⏳', '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️',
      '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰',
      '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧲', '🔫',
      '💣', '🪓', '🔪', '🗡️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🔮', '📿', '🧿',
      '🪬', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '🩻', '🩼', '💊', '💉',
      '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚿',
      '🛁', '🪥', '🪒', '🧴', '🧷', '🧹', '🧽', '🪣', '🧼', '🫧', '🗝️', '🔑',
      '🚪', '🪑', '🛋️', '🛏️', '🪞', '🪟', '🧸', '🪆', '🖼️', '🪩', '🛍️', '🎁',
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
      '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '❗', '❕', '❓', '❔', '‼️', '⁉️',
      '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹',
      '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️',
      '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻',
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
const CATEGORY_KEYS = Object.keys(EMOJI_CATEGORIES) as EmojiCategory[]

function isSingleEmoji(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32) return false
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)]
  if (segments.length !== 1) return false
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(trimmed)
}

export function MessageEmojiPicker({
  mode = 'insert',
  currentEmoji = null,
  triggerLabel,
  onSelect,
}: {
  mode?: 'insert' | 'reaction'
  currentEmoji?: string | null
  triggerLabel?: string
  onSelect: (emoji: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [category, setCategory] = useState<EmojiCategory>('smileys')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const visibleEmoji = useMemo(() => EMOJI_CATEGORIES[category].emojis, [category])

  function choose(emoji: string) {
    onSelect(mode === 'reaction' && currentEmoji === emoji ? null : emoji)
    setCustom('')
    if (mode === 'reaction') setOpen(false)
  }

  function chooseCustom() {
    const emoji = custom.trim()
    if (!isSingleEmoji(emoji)) return
    choose(emoji)
  }

  const accessibleTriggerLabel = triggerLabel ?? (mode === 'reaction' ? 'React to message' : 'Add emoji')

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={accessibleTriggerLabel}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={mode === 'reaction'
          ? 'grid size-8 place-items-center rounded-full border border-mist-100 bg-white text-muted shadow-sm transition hover:text-ocean-700'
          : 'grid size-10 place-items-center rounded-full text-navy-900 transition hover:bg-white'}
      >
        <Smile aria-hidden="true" className={mode === 'reaction' ? 'size-4' : 'size-5 text-ocean-700'} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={mode === 'reaction' ? 'Choose reaction emoji' : 'Choose emoji'}
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-mist-100 bg-white p-2 shadow-xl"
        >
          <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
            {CATEGORY_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={`Show ${key} emojis`}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
                className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  category === key
                    ? 'bg-navy-950 text-white'
                    : 'bg-mist-50 text-muted hover:bg-mist-100 hover:text-navy-950'
                }`}
              >
                {EMOJI_CATEGORIES[key].label}
              </button>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto pr-1">
            <div className="grid grid-cols-8 gap-1">
              {visibleEmoji.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  aria-label={mode === 'reaction' ? `React with ${emoji}` : `Insert ${emoji}`}
                  onClick={() => choose(emoji)}
                  className={`grid size-9 place-items-center rounded-lg text-xl transition hover:bg-mist-50 ${currentEmoji === emoji ? 'bg-ocean-50 ring-1 ring-ocean-200' : ''}`}
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
              onClick={() => { onSelect(null); setOpen(false) }}
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
      ) : null}
    </div>
  )
}
