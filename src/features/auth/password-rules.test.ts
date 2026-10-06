import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cognitoPasswordRule, failedPasswordRules, PASSWORD_MIN_LENGTH, PASSWORD_RULES, passwordRulesMessage } from './password-rules'

describe('password rules', () => {
  it('match the Cognito user pool password policy exactly', () => {
    const auth = readFileSync(join(process.cwd(), 'infra/aws/app/auth.tf'), 'utf8')
    const policy = /password_policy\s*\{([^}]*)\}/.exec(auth)?.[1] ?? ''
    const value = (key: string) => new RegExp(`${key}\\s*=\\s*(\\w+)`).exec(policy)?.[1]
    expect(Number(value('minimum_length'))).toBe(PASSWORD_MIN_LENGTH)
    expect(value('require_lowercase')).toBe('true')
    expect(value('require_uppercase')).toBe('true')
    expect(value('require_numbers')).toBe('true')
    // No symbol rule in the app because the pool does not require one.
    expect(value('require_symbols')).toBe('false')
    expect(PASSWORD_RULES.map((rule) => rule.id)).toEqual(['length', 'lowercase', 'uppercase', 'number'])
  })

  it('lists exactly the rules a password breaks', () => {
    expect(failedPasswordRules('LongEnoughPass1')).toEqual([])
    expect(failedPasswordRules('')).toEqual(['length', 'lowercase', 'uppercase', 'number'])
    expect(failedPasswordRules('abcdefghijkl')).toEqual(['uppercase', 'number'])
  })

  it('names the failed rules in plain words', () => {
    expect(passwordRulesMessage(['number'])).toBe('Your password needs a number.')
    expect(passwordRulesMessage(['uppercase', 'number'])).toBe('Your password needs an uppercase letter and a number.')
    expect(passwordRulesMessage(['length', 'uppercase', 'number'])).toBe('Your password needs at least 12 characters, an uppercase letter and a number.')
  })

  it('accepts only known Cognito rule reasons', () => {
    expect(cognitoPasswordRule('uppercase')).toBe('uppercase')
    expect(cognitoPasswordRule('symbol')).toBe('symbol')
    expect(cognitoPasswordRule('otp_cooldown')).toBeNull()
    expect(cognitoPasswordRule(null)).toBeNull()
  })
})
