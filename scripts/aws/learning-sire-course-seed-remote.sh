#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
BUCKET="sea-n-shore-staging-310356785722-media"
MENTOR_EMAIL="adityaps700@gmail.com"
COURSE_SLUG="sire-2-0-practical-vessel-inspection-readiness"
COURSE_TITLE="SIRE 2.0: Practical Vessel Inspection Readiness"
OCIMF_VIDEO_URL="https://www.ocimf.org/publications/video/videos/sire-2-0-animation"
THUMBNAIL_SOURCE_URL="https://upload.wikimedia.org/wikipedia/commons/5/5e/Oil_tanker_Abqaiq_in_2003.jpg"
RESOURCE_SOURCE_URL="https://upload.wikimedia.org/wikipedia/commons/8/87/Oil_tanker_deck.jpg"

CLUSTER_JSON=$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier sea-n-shore-staging-aurora --output json)
CLUSTER_ARN=$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")
SECRET_ARN=$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")
[[ "$CLUSTER_ARN" == 'arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora' ]]
[[ -n "$SECRET_ARN" ]]

rds_sql() {
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database sea_n_shore \
    --sql "$1" \
    --output json
}

MENTOR_SQL=$(cat <<'SQL'
select p.id::text, m.id::text
from public.identity_accounts ia
inner join public.profiles p
  on p.id = ia.profile_id
inner join public.learning_mentors m
  on m.user_id = p.id
inner join public.learning_mentor_applications a
  on a.id = m.application_id
 and a.user_id = p.id
where ia.provider = 'cognito'
  and lower(ia.email) = lower('adityaps700@gmail.com')
  and a.status = 'approved'
  and m.status = 'active'
SQL
)
MENTOR_JSON=$(rds_sql "$MENTOR_SQL")
MENTOR_COUNT=$(jq '.records | length' <<<"$MENTOR_JSON")
[[ "$MENTOR_COUNT" -eq 1 ]] || { echo "Expected exactly one approved active mentor for $MENTOR_EMAIL; found $MENTOR_COUNT." >&2; exit 1; }
USER_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$MENTOR_JSON")
MENTOR_ID=$(jq -r '.records[0][1].stringValue // empty' <<<"$MENTOR_JSON")
[[ "$USER_ID" =~ ^[0-9a-f-]{36}$ ]]
[[ "$MENTOR_ID" =~ ^[0-9a-f-]{36}$ ]]

EXISTING_JSON=$(rds_sql "select id::text, mentor_id::text, status, title from public.learning_courses where slug = '$COURSE_SLUG' limit 1")
EXISTING_COUNT=$(jq '.records | length' <<<"$EXISTING_JSON")
if [[ "$EXISTING_COUNT" -eq 0 ]]; then
  CREATE_JSON=$(rds_sql "insert into public.learning_courses (mentor_id, slug, title, description, category, level, language, access_type, price_minor, currency, certificate_enabled, course_format, status) values ('$MENTOR_ID', '$COURSE_SLUG', '$COURSE_TITLE', 'A practical crew-focused course for preparing vessel teams for the SIRE 2.0 inspection process and evidence expectations.', 'Vetting & Inspections', 'intermediate', 'English', 'free', 0, 'INR', false, 'recorded', 'draft') returning id::text")
  COURSE_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$CREATE_JSON")
  COURSE_STATUS="draft"
elif [[ "$EXISTING_COUNT" -eq 1 ]]; then
  COURSE_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$EXISTING_JSON")
  EXISTING_MENTOR_ID=$(jq -r '.records[0][1].stringValue // empty' <<<"$EXISTING_JSON")
  COURSE_STATUS=$(jq -r '.records[0][2].stringValue // empty' <<<"$EXISTING_JSON")
  EXISTING_TITLE=$(jq -r '.records[0][3].stringValue // empty' <<<"$EXISTING_JSON")
  [[ "$EXISTING_MENTOR_ID" == "$MENTOR_ID" ]] || { echo 'The requested course slug is owned by another mentor.' >&2; exit 1; }
  [[ "$EXISTING_TITLE" == "$COURSE_TITLE" ]] || { echo 'The requested course slug already exists with different content.' >&2; exit 1; }
  [[ "$COURSE_STATUS" == draft || "$COURSE_STATUS" == submitted ]] || { echo "Refusing to mutate existing course in status $COURSE_STATUS." >&2; exit 1; }
else
  echo "Unexpected duplicate course rows for $COURSE_SLUG." >&2
  exit 1
fi
[[ "$COURSE_ID" =~ ^[0-9a-f-]{36}$ ]]

THUMBNAIL_KEY="learning/$USER_ID/$COURSE_ID/course_thumbnail/11111111-1111-4111-8111-111111111111.jpg"
RESOURCE_KEY="learning/$USER_ID/$COURSE_ID/course_thumbnail/22222222-2222-4222-8222-222222222222.jpg"

TMP_DIR=$(mktemp -d)
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
THUMBNAIL_FILE="$TMP_DIR/sire-thumbnail.jpg"
RESOURCE_FILE="$TMP_DIR/sire-resource.jpg"

curl -fsSL --retry 3 --retry-delay 2 "$THUMBNAIL_SOURCE_URL" -o "$THUMBNAIL_FILE"
curl -fsSL --retry 3 --retry-delay 2 "$RESOURCE_SOURCE_URL" -o "$RESOURCE_FILE"
for IMAGE_FILE in "$THUMBNAIL_FILE" "$RESOURCE_FILE"; do
  SIZE=$(stat -c%s "$IMAGE_FILE")
  [[ "$SIZE" -gt 10000 && "$SIZE" -le 5242880 ]] || { echo "Unexpected course image size: $SIZE" >&2; exit 1; }
  MIME=$(file --mime-type -b "$IMAGE_FILE")
  [[ "$MIME" == image/jpeg ]] || { echo "Unexpected course image type: $MIME" >&2; exit 1; }
done

aws s3 cp "$THUMBNAIL_FILE" "s3://$BUCKET/$THUMBNAIL_KEY" --region "$AWS_REGION" --content-type image/jpeg --only-show-errors
aws s3 cp "$RESOURCE_FILE" "s3://$BUCKET/$RESOURCE_KEY" --region "$AWS_REGION" --content-type image/jpeg --only-show-errors
aws s3api head-object --region "$AWS_REGION" --bucket "$BUCKET" --key "$THUMBNAIL_KEY" >/dev/null
aws s3api head-object --region "$AWS_REGION" --bucket "$BUCKET" --key "$RESOURCE_KEY" >/dev/null

if [[ "$COURSE_STATUS" == draft ]]; then
  SEED_SQL=$(cat <<'SQL'
DO $seed$
DECLARE
  v_course uuid := '__COURSE_ID__';
  v_section uuid;
BEGIN
  perform 1 from public.learning_courses where id = v_course and status = 'draft' for update;
  if not found then
    raise exception 'SIRE course is not an editable draft';
  end if;

  delete from public.learning_course_sections where course_id = v_course;

  update public.learning_courses
  set title = 'SIRE 2.0: Practical Vessel Inspection Readiness',
      subtitle = 'A practical, crew-focused guide to preparing for SIRE 2.0 inspections',
      description = 'Build a practical understanding of SIRE 2.0 and prepare vessel teams for a structured, evidence-based inspection. The course focuses on the CVIQ approach, vessel and documentary evidence, human factors, crew engagement, inspection-day discipline and learning from observations. It supplements current OCIMF material and company procedures; it does not replace official requirements or operator guidance. Cover image: U.S. Navy public-domain photograph via Wikimedia Commons.',
      category = 'Vetting & Inspections',
      level = 'intermediate',
      language = 'English',
      thumbnail_path = '__THUMBNAIL_KEY__',
      trailer_path = null,
      learning_outcomes = array[
        'Explain the purpose and practical structure of SIRE 2.0',
        'Prepare vessel evidence and records for an inspection-ready condition',
        'Relate CVIQ questions to vessel systems, procedures and crew practice',
        'Prepare officers and crew for human-factor and role-based engagement',
        'Use inspection observations to strengthen continuous improvement'
      ],
      requirements = array[
        'Basic familiarity with tanker operations and shipboard safety management',
        'Access to current company procedures and the latest applicable OCIMF guidance'
      ],
      target_audience = array[
        'Masters and Chief Engineers',
        'Chief Officers, Second Engineers and junior officers',
        'Marine, technical, safety and vetting superintendents'
      ],
      price_minor = 0,
      discount_price_minor = null,
      currency = 'INR',
      access_type = 'free',
      certificate_enabled = false,
      course_format = 'recorded',
      reviewed_by = null,
      reviewed_at = null,
      admin_review_note = null,
      approved_at = null,
      updated_at = now()
  where id = v_course;

  insert into public.learning_course_sections (course_id, title, position)
  values (v_course, '1. Understanding SIRE 2.0', 0)
  returning id into v_section;

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, external_url, is_preview)
  values (v_section, 'Official OCIMF SIRE 2.0 overview', 'video', 0, 'Start with the official OCIMF animation to understand the intent and inspection model before moving into practical vessel preparation.', 'https://www.ocimf.org/publications/video/videos/sire-2-0-animation', true);

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'What changed and why it matters onboard', 'article', 1, 'Frame SIRE 2.0 as a risk-based inspection process rather than a checklist exercise.', 'SIRE 2.0 moves vessel inspection preparation away from memorising a fixed sequence of questions. The practical mindset is to demonstrate that the vessel, its systems, records and people consistently support safe operation.\n\nFor the vessel team, this means preparation should be continuous. Equipment condition, procedural compliance, records, planned maintenance evidence and crew familiarity need to tell the same operational story. A document that looks correct but is disconnected from what happens on deck or in the engine room is weak evidence.\n\nUse this course as a readiness framework alongside the latest OCIMF material, vessel-specific procedures, company SMS and operator requirements. Always resolve a conflict in favour of the current official or company-controlled requirement.');

  insert into public.learning_course_sections (course_id, title, position)
  values (v_course, '2. CVIQ and the risk-based inspection approach', 1)
  returning id into v_section;

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'How to think about the CVIQ', 'article', 0, 'Understand the CVIQ as a structured inspection framework tailored to vessel and operational risk.', 'The Compiled Vessel Inspection Questionnaire, or CVIQ, should be treated as a structured route through relevant vessel risks. Preparation therefore starts by understanding your vessel profile, trade, equipment, operating history and the procedures that control those risks.\n\nDo not train the crew to recite model answers. Build confidence that each responsible person can explain what they do, why the control exists, what evidence demonstrates compliance, and what action they take when conditions differ from normal.\n\nA useful preparation loop is: identify the system or activity, confirm the governing procedure, inspect the actual condition, review the records, ask the responsible crew member to explain the task, then close any mismatch before the inspection.');

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'From question to onboard evidence', 'article', 1, 'Connect inspection questions to physical condition, records, procedures and crew knowledge.', 'For every high-risk topic, build an evidence chain. First confirm physical condition: equipment should be available, correctly configured, maintained and free from obvious defects. Second confirm documentary evidence: certificates, tests, logs, maintenance records and checklists should be current and internally consistent. Third confirm procedural evidence: the written method should match the actual onboard practice. Fourth confirm human evidence: the people responsible should understand the controls and their own role.\n\nThe strongest readiness signal is alignment across all four layers. If any layer contradicts another, investigate the cause rather than polishing the paperwork.');

  insert into public.learning_course_sections (course_id, title, position)
  values (v_course, '3. Evidence and vessel condition', 2)
  returning id into v_section;

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'Build an inspection-ready evidence chain', 'article', 0, 'Organise evidence so that records support the real condition of the vessel.', 'Readiness is easier to sustain when evidence is owned by the department that creates it. Deck, engine and safety teams should know which records demonstrate critical tests, maintenance, drills, inspections and risk controls.\n\nBefore an inspection, sample records instead of checking only the latest entry. Look for recurring defects, overdue work, inconsistent dates, unexplained alarms, repeated temporary repairs and gaps between planned maintenance and actual condition. Then verify the relevant equipment physically.\n\nAvoid last-minute cosmetic correction of records. If an error is found, correct it transparently under the company procedure and understand why it occurred.');

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, asset_path, is_downloadable)
  values (v_section, 'Photo: tanker deck inspection discussion', 'downloadable_resource', 1, 'Use this tanker-deck photograph as a discussion prompt for equipment condition, access, housekeeping and evidence checks. Photo: Hervé Cozanet via Wikimedia Commons, CC BY-SA 3.0 / CC BY-SA 2.0 FR.', '__RESOURCE_KEY__', true);

  insert into public.learning_course_sections (course_id, title, position)
  values (v_course, '4. Human factors and crew engagement', 3)
  returning id into v_section;

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'Prepare people, not scripts', 'article', 0, 'Build genuine role knowledge and confidence instead of memorised answers.', 'Crew preparation should feel like normal professional coaching, not an oral examination rehearsal. Ask role-specific questions in the work area and let the crew member demonstrate the task when safe to do so.\n\nGood coaching checks four things: the person knows their responsibility, understands the main hazards, can identify the control measures, and knows what to do when the task cannot continue safely. Encourage clear answers based on actual practice. If a person does not know, the correct response is to seek the procedure or responsible officer rather than guess.\n\nLanguage, rank and experience can affect confidence. Senior officers should create an environment where crew can ask questions during preparation without fear of embarrassment.');

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'Run focused onboard readiness conversations', 'article', 1, 'Use short departmental conversations to expose gaps before inspection day.', 'A ten-minute readiness conversation can be more useful than a long classroom briefing. Choose one operational topic, gather the people who actually perform or supervise it, and walk through the job from preparation to completion.\n\nAsk: What can go wrong? Which procedure controls the task? Which permit, checklist or test applies? What would make you stop the job? Where is the emergency control? What recent defect or lesson learned is relevant?\n\nRecord genuine gaps for follow-up. The objective is not to produce perfect answers in the meeting; it is to find and close weaknesses while there is still time to act.');

  insert into public.learning_course_sections (course_id, title, position)
  values (v_course, '5. Inspection-day execution', 4)
  returning id into v_section;

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'Control the day without staging the vessel', 'article', 0, 'Keep the vessel safe, organised and operationally authentic throughout the inspection.', 'Inspection day should begin with normal operational control. Confirm the vessel schedule, permits, simultaneous operations, critical equipment status, visitors, weather limitations and any open defects. The Master and department heads should understand where the inspection can safely proceed and where operational activity takes priority.\n\nKeep documents accessible and current, but do not create a parallel set of inspection-only records. Escort arrangements should help the inspector reach the right location and responsible person efficiently without interfering with safe operations.\n\nIf a defect or uncertainty is identified, be factual. Explain the known condition, immediate control, reporting route and corrective action rather than speculating.');

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'A practical final readiness sweep', 'article', 1, 'Use a cross-functional sweep to find contradictions between condition, records and practice.', 'Complete the final readiness sweep by sampling high-consequence areas rather than trying to re-inspect the entire vessel. Check housekeeping and access, emergency and safety equipment, pollution-prevention controls, mooring and cargo areas, machinery spaces, navigation and bridge records, permits and isolations, planned maintenance evidence, drills and familiarisation records.\n\nFor each sample, ask whether the physical condition, record, procedure and crew explanation agree. Any contradiction deserves attention. Prioritise safety-critical gaps and report issues through the vessel and company management system.');

  insert into public.learning_course_sections (course_id, title, position)
  values (v_course, '6. Observations and continuous improvement', 5)
  returning id into v_section;

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'Respond to observations professionally', 'article', 0, 'Treat observations as evidence to investigate, not simply wording to contest.', 'When an observation is raised, first make sure the immediate safety condition is controlled. Capture the factual circumstances, relevant equipment, people involved and records while the context is fresh. Avoid changing evidence simply to make the observation disappear.\n\nAfter the inspection, separate immediate correction from root-cause work. A replaced item may close the physical defect but not the management-system weakness that allowed it to occur. Look for contributing factors such as unclear ownership, ineffective maintenance intervals, weak verification, poor communication, workload or training gaps.');

  insert into public.learning_lessons (section_id, title, lesson_type, position, summary, article_body)
  values (v_section, 'Turn inspection learning into vessel improvement', 'article', 1, 'Convert findings into actions that strengthen normal operations between inspections.', 'The best SIRE 2.0 preparation happens after the previous inspection, not just before the next one. Share relevant lessons with the vessel team, verify that corrective actions work in practice, and look for similar exposure elsewhere on the vessel or across the fleet.\n\nUse trends from defects, near misses, audits, maintenance history and previous inspection observations to choose where leadership attention is needed. Sustainable readiness is the result of reliable daily operations supported by evidence, not a short-term inspection campaign.');

  if not exists (select 1 from public.learning_course_sections where course_id = v_course) then
    raise exception 'Submission readiness failed: no sections';
  end if;

  if exists (
    select 1 from public.learning_course_sections s
    left join public.learning_lessons l on l.section_id = s.id
    where s.course_id = v_course
    group by s.id having count(l.id) = 0
  ) then
    raise exception 'Submission readiness failed: empty section';
  end if;

  if exists (
    select 1 from public.learning_lessons l
    inner join public.learning_course_sections s on s.id = l.section_id
    where s.course_id = v_course and l.lesson_type = 'article' and btrim(coalesce(l.article_body, '')) = ''
  ) then
    raise exception 'Submission readiness failed: empty article';
  end if;

  if exists (
    select 1 from public.learning_lessons l
    inner join public.learning_course_sections s on s.id = l.section_id
    where s.course_id = v_course
      and l.lesson_type in ('video', 'audio', 'pdf', 'presentation_document', 'downloadable_resource')
      and l.asset_path is null and l.external_url is null
  ) then
    raise exception 'Submission readiness failed: missing media';
  end if;

  update public.learning_courses
  set status = 'submitted', reviewed_by = null, reviewed_at = null, admin_review_note = null, approved_at = null, updated_at = now()
  where id = v_course and status = 'draft';

  if not found then
    raise exception 'SIRE course submission transition failed';
  end if;
END
$seed$;
SQL
)
  SEED_SQL=${SEED_SQL//__COURSE_ID__/$COURSE_ID}
  SEED_SQL=${SEED_SQL//__THUMBNAIL_KEY__/$THUMBNAIL_KEY}
  SEED_SQL=${SEED_SQL//__RESOURCE_KEY__/$RESOURCE_KEY}
  rds_sql "$SEED_SQL" >/dev/null
fi

VERIFY_SQL=$(cat <<SQL
select c.id::text, c.status, c.thumbnail_path,
       count(distinct s.id)::text,
       count(distinct l.id)::text,
       count(distinct case when l.lesson_type = 'video' and l.external_url = '$OCIMF_VIDEO_URL' then l.id end)::text,
       count(distinct case when l.lesson_type = 'downloadable_resource' and l.asset_path = '$RESOURCE_KEY' then l.id end)::text
from public.learning_courses c
inner join public.learning_mentors m on m.id = c.mentor_id and m.status = 'active'
inner join public.learning_mentor_applications a on a.id = m.application_id and a.status = 'approved'
inner join public.identity_accounts ia on ia.profile_id = m.user_id and ia.provider = 'cognito'
left join public.learning_course_sections s on s.course_id = c.id
left join public.learning_lessons l on l.section_id = s.id
where c.slug = '$COURSE_SLUG' and c.mentor_id = '$MENTOR_ID' and lower(ia.email) = lower('$MENTOR_EMAIL')
group by c.id, c.status, c.thumbnail_path
SQL
)
VERIFY_JSON=$(rds_sql "$VERIFY_SQL")
[[ "$(jq '.records | length' <<<"$VERIFY_JSON")" -eq 1 ]] || { echo 'Unable to verify the seeded SIRE course.' >&2; exit 1; }
VERIFIED_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$VERIFY_JSON")
VERIFIED_STATUS=$(jq -r '.records[0][1].stringValue // empty' <<<"$VERIFY_JSON")
VERIFIED_THUMBNAIL=$(jq -r '.records[0][2].stringValue // empty' <<<"$VERIFY_JSON")
SECTION_COUNT=$(jq -r '.records[0][3].stringValue // empty' <<<"$VERIFY_JSON")
LESSON_COUNT=$(jq -r '.records[0][4].stringValue // empty' <<<"$VERIFY_JSON")
VIDEO_COUNT=$(jq -r '.records[0][5].stringValue // empty' <<<"$VERIFY_JSON")
RESOURCE_COUNT=$(jq -r '.records[0][6].stringValue // empty' <<<"$VERIFY_JSON")

[[ "$VERIFIED_ID" == "$COURSE_ID" ]]
[[ "$VERIFIED_STATUS" == submitted ]]
[[ "$VERIFIED_THUMBNAIL" == "$THUMBNAIL_KEY" ]]
[[ "$SECTION_COUNT" == 6 ]]
[[ "$LESSON_COUNT" == 12 ]]
[[ "$VIDEO_COUNT" == 1 ]]
[[ "$RESOURCE_COUNT" == 1 ]]
aws s3api head-object --region "$AWS_REGION" --bucket "$BUCKET" --key "$THUMBNAIL_KEY" >/dev/null
aws s3api head-object --region "$AWS_REGION" --bucket "$BUCKET" --key "$RESOURCE_KEY" >/dev/null

echo "SIRE_COURSE_ID=$COURSE_ID"
echo "SIRE_COURSE_SLUG=$COURSE_SLUG"
echo "SIRE_COURSE_STATUS=$VERIFIED_STATUS"
echo "SIRE_COURSE_SECTION_COUNT=$SECTION_COUNT"
echo "SIRE_COURSE_LESSON_COUNT=$LESSON_COUNT"
echo 'SIRE_COURSE_PHOTOS_VERIFIED=true'
echo 'SIRE_COURSE_VIDEO_VERIFIED=true'
echo 'SIRE_COURSE_SEED_VERIFIED=true'
