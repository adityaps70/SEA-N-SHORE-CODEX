import { CERTIFICATE_NOT_FOUND_METADATA, CertificateNotVerified, isVisitor, JoinBar } from './certificate-verification-view'

/** Round H (H5): the same title as an unknown code, since this shows the same "not verified" page. */
export const metadata = CERTIFICATE_NOT_FOUND_METADATA

/** A verification link whose code cannot be a certificate code: the normal "not verified" page, with a 404. */
export default async function CertificateNotFound() {
  return <CertificateNotVerified joinBar={(await isVisitor()) ? <JoinBar /> : null} />
}
