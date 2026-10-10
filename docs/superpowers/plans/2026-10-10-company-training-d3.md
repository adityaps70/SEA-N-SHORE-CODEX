# Learning round D, part 3: company training (seat packs for crew)

The owner approved the D3 design on 10 October with these answers:

1. **Pricing:** seat packs. A company buys N seats of one course at the course price per seat, with volume discounts:
   10+ seats 10% off, 50+ seats 20% off. One B2B GST invoice per pack (company name + GSTIN from C4).
2. **Validity:** unassigned seats can be assigned for 12 months from purchase. Once assigned, the learner's access
   follows the course's normal plan and expiry.
3. **Who can be assigned:** only Sea N Shore members who accept the company's invitation (email invite; non-members
   join first). The member consents to share assigned-course progress and those certificates with the company, and
   nothing else.
4. **Refunds:** unassigned seats are refundable within 30 days of purchase, via credit note. Assigned seats are not
   refundable, but a seat can be reassigned to another crew member if the first learner hasn't passed 10% progress.

The owner wants to see the company dashboard screenshot before the deploy arm.

## Migration 0079 (`company-training-migration`, from the template)

Additive only. No existing check is relaxed and no existing row is changed.

- `course_payment_orders` gets `seat_company_id`, `seat_quantity`, `seat_unit_price_minor` and
  `seat_volume_discount_basis_points` (all null for every existing order). A new check ties them together and to the
  amount: `amount_minor = seat_unit_price_minor × seat_quantity`.
  - A pack's `list_price_minor` is the list price × seats, and its `discount_price_minor` is the pack total when that
    is lower. So the existing amount check holds without being relaxed.
- `company_training_seats`: one row per seat. Status `available`, `assigned`, `refund_pending` or `refunded`, plus
  `valid_until` (purchase + 12 months), the learner and enrolment of an assigned seat, and `times_assigned`.
- `learning_enrollments.company_seat_id`: the seat an enrolment came from.
- `company_training_seat_refunds`: at most one per pack (the pack's invoice takes one credit note).
- `company_training_invitations`: an email invitation with its own email delivery columns, like the round C course
  invitations, so no learning email kind is widened.
- `company_training_learners`: the crew. Status `active`, `withdrawn` or `removed`; the company's vessel and rank tags;
  and the consent version and time.
- `company_training_consent_events`: an append-only ledger (a trigger refuses changes; rows go only when the member or
  company is erased).

## Design decisions made while building

- **Seat orders reuse the course order table.** The C4 invoice and credit note tables reference
  `course_payment_orders`, so a pack is a course order with the seat columns set. It goes through the same gateways,
  webhooks, return page, invoice, earning and 7-day hold. Nobody is enrolled by the purchase.
- **Price per seat.** The plan's price (its sale price when set) less the volume discount, rounded to the paisa per
  seat. Every seat costs the same, so a refund of k seats is exactly k × the price per seat. Promo codes do not apply
  to packs.
- **Rupees and a GSTIN only.** A pack needs the company name and GSTIN, so packs are sold in INR. USD (export) packs
  are not offered.
- **Who buys.** The owner, administrators and learning managers (`lms_manager`) of a verified organization. Platform
  admins can view. A company cannot buy seats of its own courses; it adds its crew in Studio.
- **Refunds.**
  - Refunding every seat of an untouched pack is the ordinary full order refund (full credit note, earning reversed).
  - Otherwise the chosen seats are held, the gateway refunds their price, and in one transaction a partial credit note
    is issued and a negative earning adjustment for that share is added.
  - A gateway refusal gives the seats back; the refund can be tried again.
  - One refund per pack, because C4 gives an invoice one credit note.
  - Once seats are assigned or refunded on their own, the course team's or Sea N Shore's full order refund is refused
    for the pack.
- **Invoice access.** Every training admin of the buying company can download a pack's invoice and credit note, not
  only the person who paid.

## Checklist

- [x] Step 0: companies and roles, C4 checkout, invoices, credit notes and refunds, round C invitations, roster
  progress, certificates
- [x] Migration 0079 + guarded runner `company-training-migration` (post-apply checks: 5 tables, 5 columns, the
  consent trigger, no existing order turned into a pack)
- [x] Seat packs: price with volume discount, checkout, seats on payment (12 months), B2B GST invoice, earning
- [x] Refund of unassigned seats within 30 days: partial credit note and earning adjustment, or the whole order; the
  webhook settles pending refunds
- [x] Crew: email invitations (worker sweep, one email each, sign-up link for newcomers), accept with consent,
  decline, stop sharing, removal by the company; vessel and rank tags
- [x] Assign seats to active crew (the pack's plan access from the day of assignment, batch for batch courses),
  move a seat while the learner is at 10% or less
- [x] Company training page (Manage page → Crew training): overview dashboard (seats, completion, certificates
  expiring in 90 days, by vessel, by rank, assigned seats), seats (buy, packs, invoices, refunds), crew; CSV export
  (audited with its row count)
- [x] Learner side: invitation page with the consent wording, My Learning card with Stop sharing; "Company seat" on
  the course roster
- [x] Dashboard screenshot sent to the owner (sample data, desktop and 390 px)
- [ ] PR 1, PR 2, one migration, one deploy, rearm, Remote Verify

## More decisions made while building

- **Consent covers the company, not each course.** Accepting the invitation is the consent; each seat the company
  then gives is shared under it and the learner is told by the usual enrolment email.
- **Privacy.** The dashboard reads only the company's own seats and, for members who share, the enrolment and
  certificate made from that seat. A member who stopped sharing, or was taken off the crew, shows only that the seat
  is used; their progress, certificate and (after removal) tags are not shown or exported.
- **Moving a seat.** Allowed at 10% progress or less, not once the course is completed, and not after the learner
  stopped sharing. The first learner's access from the seat ends (their enrolment is revoked); the seat keeps a count
  of how many times it was given.
- **No new email kind or notification type.** Invitation emails go out from their own table (like round C course
  invitations); the learner hears about an assigned course through the existing enrolment notification. No database
  check had to be relaxed.
- **Not built (not in the owner's answers):** due dates and reminders for assignments, CSV import of crew, and course
  packs with several courses. They can follow if wanted.
