import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProfileCredentialRecord } from '../profile-portfolio-types'
import { ProfileCredentialWallet } from './profile-credential-wallet'

vi.mock('../profile-portfolio-actions', () => ({
  createProfileCredential: vi.fn(),
  updateProfileCredential: vi.fn(),
  deleteProfileCredential: vi.fn(),
}))

const credentials: ProfileCredentialRecord[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Certificate of Competency - Master',
    issuer: 'DG Shipping India',
    credentialNumber: 'COC-12345',
    issuedOn: '2023-04-12',
    expiresOn: '2028-04-11',
    noExpiry: false,
    verificationState: 'self_reported',
    sortOrder: 0,
  },
]

afterEach(() => cleanup())

describe('ProfileCredentialWallet', () => {
  it('renders a self-reported CoC under the simple Licences & Credentials heading', () => {
    render(<ProfileCredentialWallet credentials={credentials} />)

    expect(screen.getByRole('heading', { name: 'Licences & Credentials' })).toBeInTheDocument()
    expect(screen.queryByText('CoC & credentials')).not.toBeInTheDocument()
    expect(screen.queryByText(/Keep certificates of competency, STCW training and professional credentials visible in one place/i)).not.toBeInTheDocument()
    expect(screen.getByText('Certificate of Competency - Master')).toBeInTheDocument()
    expect(screen.getByText('DG Shipping India')).toBeInTheDocument()
    expect(screen.getByText('COC-12345')).toBeInTheDocument()
    expect(screen.getByText('Self-reported')).toBeInTheDocument()
    expect(screen.queryByText(/^Verified$/)).not.toBeInTheDocument()
  })

  it('gives the owner a complete credential editor with expiry controls', () => {
    render(<ProfileCredentialWallet credentials={[]} editable />)

    fireEvent.click(screen.getByRole('button', { name: /add credential/i }))

    expect(screen.getByLabelText('Certificate / CoC name')).toBeInTheDocument()
    expect(screen.getByLabelText('Issuing authority')).toBeInTheDocument()
    expect(screen.getByLabelText('Credential number')).toBeInTheDocument()
    expect(screen.getByLabelText('Issue date')).toBeInTheDocument()
    expect(screen.getByLabelText('Expiry date')).toBeInTheDocument()
    expect(screen.getByLabelText('This credential does not expire')).toBeInTheDocument()
    expect(screen.getByText(/new credentials are self-reported/i)).toBeInTheDocument()
  })

  it('hides an empty wallet from public profile viewers', () => {
    render(<ProfileCredentialWallet credentials={[]} />)

    expect(screen.queryByRole('heading', { name: 'Licences & Credentials' })).not.toBeInTheDocument()
  })
})
