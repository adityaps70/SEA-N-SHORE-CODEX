import { CertificateNotVerified, isVisitor, JoinBar } from './certificate-verification-view'

/** A verification link whose code cannot be a certificate code: the normal "not verified" page, with a 404. */
export default async function CertificateNotFound() {
  return <CertificateNotVerified joinBar={(await isVisitor()) ? <JoinBar /> : null} />
}
