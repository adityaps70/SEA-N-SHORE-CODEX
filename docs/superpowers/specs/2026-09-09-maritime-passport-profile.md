# Sea N Shore Maritime Passport Profile Redesign

## Product intent

Turn the existing Sea N Shore member profile into a professional maritime identity: as complete and editable as LinkedIn, visually personal like a modern social profile, but built around maritime careers and evidence.

The owner profile, public member profile, and recruiter-facing presentation must share one source of truth. No demo-only profile sections and no fake verification claims.

## Experience principles

- The profile should read as a **Maritime Passport**, not a generic social bio.
- Cover image and avatar remain directly editable from the profile.
- Core identity, About, and maritime record remain editable without forcing the member through onboarding again.
- Maritime members get role-specific information. A seafarer profile should expose sea-service concepts; shore/recruiter/company identities should not be forced through a seafarer-only form.
- Important professional evidence is structured, scannable, and useful to recruiters.
- Empty sections should guide the owner to add information; public viewers should not see fake or empty records.
- “Verified” must only be shown when backed by a real verification state. Self-reported credentials must be labelled accordingly.
- Existing Home and onboarding behavior must not be changed as part of this redesign.

## Owner profile information architecture

### 1. Passport header

- Cover image
- Avatar
- Name
- Maritime identity / profile type
- Professional headline
- Location
- Current company
- Availability state
- Edit affordances
- View public profile
- Share / QR entry point
- Download CV entry point

### 2. Profile readiness

Show a completion/readiness score derived from real stored fields. Explain the next missing profile improvements. The score is advisory only; it is not a verification score.

### 3. About and expertise

- Professional summary
- Skills
- Maritime identity chips
- Editable in place for the owner

### 4. Maritime snapshot

For seafarer / maritime-professional identities:

- Rank
- Current vessel
- Current company
- Sailing experience
- Vessel types
- Trading areas
- Availability
- Shore-career preference

The presentation should be recruiter-scannable and editable by the owner.

### 5. Career timeline

Persist structured experience entries. Support at least:

- Sea service
- Shore role
- Training / education-related professional role
- Other maritime role

Each entry can contain title/rank, organisation/company, vessel, vessel type, location, start/end dates, current-role status, description, cargo experience, engine experience and trading areas where applicable.

The form must adapt labels/fields to the selected experience track rather than presenting one generic maritime form.

### 6. Certification wallet

Persist structured credentials with:

- Certificate / CoC name
- Issuing authority
- Credential number (optional)
- Issue date (optional)
- Expiry date or no-expiry state
- Verification state

New credentials are self-reported by default. The UI must not imply formal verification until the verification workflow changes the state.

### 7. Career preferences and visibility

- Availability
- Shore-career interest
- Contact visibility
- Recruiter-facing profile should use the same stored profile and honor public/member visibility boundaries.

### 8. Recommendations and relationship confirmation

The target product includes recommendations and professional relationship confirmation. These should be backed by member-to-member records rather than static endorsements. They may be delivered after the core passport, timeline and wallet schema is live, but the profile architecture must leave a clear section boundary for them.

### 9. Contributions

The target product includes a member contribution/activity view using real Sea N Shore content. Do not manufacture activity.

### 10. Public / recruiter view

Public member pages should use the same Passport sections that are safe to expose publicly. Recruiter scanning should prioritize headline, availability, experience, vessel/cargo/engine exposure, certifications and skills.

### 11. QR and PDF CV

The profile should expose a shareable profile URL suitable for QR sharing and a server-generated professional CV/PDF export. These must be generated from the stored profile rather than a separate CV database.

## Technical constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`
- Branch only: `feat/aws-native-phase-0-1`
- Do not touch `main`, merge, or create a PR.
- Aurora remains the application database.
- Cognito remains `COGNITO_DEFAULT`.
- SES Phase 5B remains paused.
- No production DNS/nameserver changes.
- Do not decommission Vercel or Supabase.
- Additive database migrations only for this profile work.
- Follow RED → GREEN → exact-head CI → guarded migration when schema changes → guarded staging deploy → fresh runtime verification → return switches to `plan`.
