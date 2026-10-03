import { describe, expect, it } from 'vitest'
import { awsUriEncode, signAwsRequest } from './sigv4'

describe('signAwsRequest', () => {
  it('matches the published AWS Signature Version 4 example (IAM ListUsers)', () => {
    const signed = signAwsRequest(
      {
        method: 'GET',
        url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      },
      {
        credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
        region: 'us-east-1',
        service: 'iam',
        now: new Date('2015-08-30T12:36:00Z'),
      },
    )

    expect(signed.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7')
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
    expect(signed.headers['x-amz-date']).toBe('20150830T123600Z')
  })

  it('double-encodes already-encoded path segments such as an email address', () => {
    const signed = signAwsRequest(
      { method: 'GET', url: `https://email.ap-south-1.amazonaws.com/v2/email/contact-lists/news/contacts/${awsUriEncode('a+b@example.com')}` },
      { credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret', sessionToken: 'token' }, region: 'ap-south-1', service: 'ses', now: new Date('2026-09-27T00:00:00Z') },
    )
    expect(signed.canonicalRequest.split('\n')[1]).toBe('/v2/email/contact-lists/news/contacts/a%252Bb%2540example.com')
    expect(signed.headers['x-amz-security-token']).toBe('token')
    expect(signed.headers.authorization).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token')
  })
})
