import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_SAVER_STORAGE_KEY, setDataSaverChosen } from '@/lib/browser/data-saver'
import { DataSaverSetting } from './data-saver-setting'

afterEach(() => {
  setDataSaverChosen(false)
  cleanup()
})

describe('DataSaverSetting (Round P3)', () => {
  it('turns Data saver on and off for this device', () => {
    render(<DataSaverSetting />)
    const toggle = screen.getByRole('switch', { name: 'Data saver' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/Videos load only when you press play/)

    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    expect(window.localStorage.getItem(DATA_SAVER_STORAGE_KEY)).toBe('on')

    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(window.localStorage.getItem(DATA_SAVER_STORAGE_KEY)).toBeNull()
  })
})
