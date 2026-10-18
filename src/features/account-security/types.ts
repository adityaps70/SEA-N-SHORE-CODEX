export type AccountQuery = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>
export type AccountTransaction = <T>(work: (query: AccountQuery) => Promise<T>) => Promise<T>

export type SessionRevokeReason =
  | 'signed_out'
  | 'signed_out_remotely'
  | 'signed_out_other_devices'
  | 'password_changed'
  | 'mfa_reset'
