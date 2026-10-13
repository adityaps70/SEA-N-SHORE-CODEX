-- Algorithms round G, release 1 (G0 foundation, G1 feed, G2 people you may know).
-- Additive only: new tables, functions, triggers, indexes and nullable columns, plus seed rows. Nothing existing is
-- changed, rewritten or deleted. Backfills of the new nullable code columns run in the app (outbox worker sweep),
-- never here.

-- G0.1 Maritime taxonomy. Ranks mirror features/roles/taxonomy.ts, vessel and certificate types
-- features/taxonomy/maritime-taxonomy.ts (maritime-taxonomy-seed.test.ts keeps them identical).
create or replace function public.taxonomy_normalize(value text) returns text
language sql immutable parallel safe
as $$
  select nullif(btrim(regexp_replace(replace(lower(coalesce(value, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g')), '')
$$;
-- statement-breakpoint
create table if not exists public.maritime_ranks (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  department_key text not null,
  department text not null check (department in ('deck', 'engine', 'electrical', 'catering', 'shore')),
  ladder text not null,
  ladder_level integer not null check (ladder_level between 1 and 99),
  synonyms text[] not null default '{}',
  same_as text null,
  sort_order integer not null default 0
);
-- statement-breakpoint
create table if not exists public.vessel_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  vessel_group text not null check (vessel_group in ('tanker', 'gas', 'dry_bulk', 'container', 'offshore', 'passenger', 'other')),
  synonyms text[] not null default '{}',
  sort_order integer not null default 0
);
-- statement-breakpoint
create table if not exists public.certificate_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  category text not null check (category in ('stcw_basic', 'stcw_advanced', 'tanker', 'gas', 'dp', 'navigation', 'security', 'medical', 'coc')),
  synonyms text[] not null default '{}',
  coc_rank_code text null,
  sort_order integer not null default 0
);
-- statement-breakpoint
insert into public.maritime_ranks (code, name, department_key, department, ladder, ladder_level, synonyms, same_as, sort_order) values
  ('master', 'Master / Captain', 'deck_officers', 'deck', 'deck_officer', 1, array['Captain', 'Master Mariner', 'Master', 'Capt', 'Capt.', 'Ship Master', 'Shipmaster']::text[], null, 1),
  ('chief_officer', 'Chief Officer', 'deck_officers', 'deck', 'deck_officer', 2, array['Chief Mate', 'C/O', 'CO', 'First Officer', 'First Mate', 'Chief Off']::text[], null, 2),
  ('second_officer', 'Second Officer', 'deck_officers', 'deck', 'deck_officer', 3, array['2nd Officer', '2/O', '2nd Mate', 'Second Mate', '2 O', '2nd Off']::text[], null, 3),
  ('third_officer', 'Third Officer', 'deck_officers', 'deck', 'deck_officer', 4, array['3rd Officer', '3/O', '3rd Mate', 'Third Mate', '3rd Off']::text[], null, 4),
  ('junior_deck_officer', 'Junior Officer / Fourth Officer', 'deck_officers', 'deck', 'deck_officer', 5, array['Junior Officer', 'Fourth Officer', '4th Officer', '4/O', 'Junior Deck Officer', '4th Mate']::text[], null, 5),
  ('deck_cadet', 'Deck Cadet / Trainee Officer', 'deck_officers', 'deck', 'deck_officer', 6, array['Deck Cadet', 'Trainee Officer', 'Trainee Navigating Officer', 'TNO', 'Nautical Cadet']::text[], null, 6),
  ('bosun', 'Bosun', 'deck_ratings', 'deck', 'deck_rating', 1, array['Boatswain', 'Bosun', 'Bos''n']::text[], null, 7),
  ('pumpman', 'Pumpman', 'deck_ratings', 'deck', 'deck_rating', 2, array['Pump Man']::text[], null, 8),
  ('able_seaman', 'Able Seaman (AB)', 'deck_ratings', 'deck', 'deck_rating', 3, array['Able Seaman', 'AB', 'A/B', 'Able Seafarer Deck', 'Able Bodied Seaman']::text[], null, 9),
  ('ordinary_seaman', 'Ordinary Seaman (OS)', 'deck_ratings', 'deck', 'deck_rating', 4, array['Ordinary Seaman', 'OS', 'O/S']::text[], null, 10),
  ('deck_trainee', 'Deck Trainee', 'deck_ratings', 'deck', 'deck_rating', 5, array['Trainee Seaman', 'Deck Boy', 'TOS', 'Trainee OS']::text[], null, 11),
  ('chief_engineer', 'Chief Engineer', 'engine_officers', 'engine', 'engine_officer', 1, array['C/E', 'CE', 'Chief Engg', 'Chief Eng', 'Chief Engineer Officer']::text[], null, 12),
  ('second_engineer', 'Second Engineer (2nd Engineer)', 'engine_officers', 'engine', 'engine_officer', 2, array['Second Engineer', '2nd Engineer', '2/E', '2nd Engg', '2nd Eng', 'First Engineer', '1st Engineer']::text[], null, 13),
  ('third_engineer', 'Third Engineer (3rd Engineer)', 'engine_officers', 'engine', 'engine_officer', 3, array['Third Engineer', '3rd Engineer', '3/E', '3rd Engg', '3rd Eng']::text[], null, 14),
  ('fourth_engineer', 'Fourth Engineer (4th Engineer)', 'engine_officers', 'engine', 'engine_officer', 4, array['Fourth Engineer', '4th Engineer', '4/E', '4th Engg', '4th Eng']::text[], null, 15),
  ('junior_engineer', 'Junior Engineer / Fifth Engineer', 'engine_officers', 'engine', 'engine_officer', 5, array['Junior Engineer', 'Fifth Engineer', '5th Engineer', '5/E', 'JE']::text[], null, 16),
  ('engine_cadet', 'Engine Cadet / Trainee Engineer', 'engine_officers', 'engine', 'engine_officer', 6, array['Engine Cadet', 'Trainee Engineer', 'Trainee Marine Engineer', 'TME']::text[], null, 17),
  ('eto', 'Electro-Technical Officer (ETO)', 'engine_officers', 'electrical', 'electrical_officer', 1, array['Electro-Technical Officer', 'Electro Technical Officer', 'ETO', 'Electrical Engineer']::text[], null, 18),
  ('electrical_officer', 'Electrical Officer', 'engine_officers', 'electrical', 'electrical_officer', 2, array['Electrical Officer', 'Electro Officer', 'Elec Officer']::text[], null, 19),
  ('gas_engineer', 'Gas Engineer (LNG / LPG)', 'engine_officers', 'engine', 'gas_engineer', 1, array['Gas Engineer', 'LNG Engineer', 'LPG Engineer', 'Cargo Engineer']::text[], null, 20),
  ('fitter', 'Fitter', 'engine_ratings', 'engine', 'engine_rating', 1, array['Engine Fitter']::text[], null, 21),
  ('motorman', 'Motorman', 'engine_ratings', 'engine', 'engine_rating', 2, array['Motor Man']::text[], null, 22),
  ('oiler', 'Oiler', 'engine_ratings', 'engine', 'engine_rating', 3, array['Greaser']::text[], null, 23),
  ('wiper', 'Wiper', 'engine_ratings', 'engine', 'engine_rating', 4, array[]::text[], null, 24),
  ('engine_trainee', 'Engine Trainee', 'engine_ratings', 'engine', 'engine_rating', 5, array['Trainee Wiper', 'Engine Boy']::text[], null, 25),
  ('electrician', 'Electrician / Electro-Technical Rating', 'engine_ratings', 'electrical', 'electrical_rating', 1, array['Electrician', 'Electro-Technical Rating', 'Electro Technical Rating', 'ETR']::text[], null, 26),
  ('chief_cook', 'Chief Cook', 'catering', 'catering', 'galley', 1, array['Ch Cook', 'Head Cook']::text[], null, 27),
  ('cook', 'Cook', 'catering', 'catering', 'galley', 2, array['Ship Cook']::text[], null, 28),
  ('second_cook', 'Second Cook', 'catering', 'catering', 'galley', 3, array['2nd Cook', 'Assistant Cook']::text[], null, 29),
  ('messman', 'Messman', 'catering', 'catering', 'galley', 4, array['Mess Man', 'Mess Boy', 'General Steward', 'GS']::text[], null, 30),
  ('chief_steward', 'Chief Steward', 'catering', 'catering', 'hotel', 1, array['Ch Steward', 'Head Steward']::text[], null, 31),
  ('steward', 'Steward', 'catering', 'catering', 'hotel', 2, array['Stewardess']::text[], null, 32),
  ('hotel_purser', 'Hotel / Purser staff', 'catering', 'catering', 'purser', 1, array['Purser', 'Hotel Manager', 'Hotel Staff', 'Purser Staff']::text[], null, 33),
  ('dp_operator', 'DP Operator (DPO / SDPO)', 'specialist_offshore', 'deck', 'dp', 1, array['DP Operator', 'DPO', 'SDPO', 'Dynamic Positioning Operator', 'Senior Dynamic Positioning Operator', 'Senior DPO']::text[], null, 34),
  ('crane_operator', 'Crane Operator', 'specialist_offshore', 'deck', 'crane', 1, array['Offshore Crane Operator', 'Crane Op']::text[], null, 35),
  ('rov_pilot', 'ROV Pilot / Technician', 'specialist_offshore', 'deck', 'rov', 1, array['ROV Pilot', 'ROV Technician', 'ROV Pilot Technician']::text[], null, 36),
  ('barge_master', 'Barge Master', 'specialist_offshore', 'deck', 'barge', 1, array['Bargemaster']::text[], null, 37),
  ('oim', 'Offshore Installation Manager (OIM)', 'specialist_offshore', 'deck', 'oim', 1, array['Offshore Installation Manager', 'OIM']::text[], null, 38),
  ('tug_master', 'Tug Master', 'specialist_offshore', 'deck', 'tug', 1, array['Tugmaster', 'Tug Captain']::text[], null, 39),
  ('yacht_crew', 'Yacht Captain / Crew', 'specialist_offshore', 'deck', 'yacht', 1, array['Yacht Captain', 'Yacht Crew', 'Superyacht Crew']::text[], null, 40),
  ('inland_master', 'Inland / River Master', 'specialist_offshore', 'deck', 'inland', 1, array['Inland Master', 'River Master', 'Inland Vessel Master']::text[], null, 41),
  ('marine_pilot', 'Marine Pilot', 'specialist_offshore', 'deck', 'pilot', 1, array['Marine Pilot', 'Harbour Pilot', 'Sea Pilot', 'Pilot']::text[], null, 42),
  ('technical_superintendent', 'Technical Superintendent', 'technical_fleet', 'shore', 'fleet', 3, array['Tech Superintendent', 'Technical Super', 'Superintendent Engineer']::text[], null, 43),
  ('marine_superintendent', 'Marine Superintendent', 'technical_fleet', 'shore', 'marine_superintendent', 1, array['Marine Super', 'Offshore Marine Superintendent', 'Marine Manager']::text[], null, 44),
  ('fleet_manager', 'Fleet Manager', 'technical_fleet', 'shore', 'fleet', 1, array['Fleet Director']::text[], null, 45),
  ('technical_manager', 'Technical Manager', 'technical_fleet', 'shore', 'fleet', 2, array['Technical Director', 'Vessel Manager']::text[], null, 46),
  ('electrical_superintendent', 'Electrical Superintendent', 'technical_fleet', 'shore', 'electrical_superintendent', 1, array['Electrical Super']::text[], null, 47),
  ('site_superintendent', 'New-building / Site Superintendent', 'technical_fleet', 'shore', 'site_superintendent', 1, array['Newbuilding Superintendent', 'New Building Superintendent', 'Site Superintendent', 'Dry Dock Superintendent']::text[], null, 48),
  ('hseq_manager', 'HSEQ Manager', 'hseq_vetting', 'shore', 'hseq', 1, array['QHSE Manager', 'HSSEQ Manager', 'HSE Manager', 'HSSEQ Superintendent', 'Offshore HSE Manager']::text[], null, 49),
  ('dpa', 'Designated Person Ashore (DPA)', 'hseq_vetting', 'shore', 'dpa', 1, array['Designated Person Ashore', 'DPA']::text[], null, 50),
  ('cso', 'Company Security Officer (CSO)', 'hseq_vetting', 'shore', 'cso', 1, array['Company Security Officer', 'CSO']::text[], null, 51),
  ('vetting_manager', 'Vetting Manager / Inspector', 'hseq_vetting', 'shore', 'vetting', 1, array['Vetting Manager', 'Vetting Inspector', 'Vetting Superintendent', 'Marine Assurance Manager']::text[], null, 52),
  ('sire_inspector', 'SIRE / CDI Inspector', 'hseq_vetting', 'shore', 'vetting', 2, array['SIRE Inspector', 'CDI Inspector', 'OCIMF Inspector']::text[], null, 53),
  ('safety_officer', 'Safety Officer', 'hseq_vetting', 'shore', 'hseq', 2, array['HSE Officer', 'Safety Superintendent']::text[], null, 54),
  ('operations_manager', 'Operations Manager', 'operations_commercial', 'shore', 'operations', 1, array['Marine Operations Manager', 'Ops Manager']::text[], null, 55),
  ('ship_operator', 'Ship Operator', 'operations_commercial', 'shore', 'operations', 2, array['Voyage Operator', 'Vessel Operator', 'Cargo Operator']::text[], null, 56),
  ('chartering_manager', 'Chartering Manager / Broker', 'operations_commercial', 'shore', 'commercial', 2, array['Chartering Manager', 'Shipbroker', 'Ship Broker', 'Charterer', 'Chartering Broker']::text[], null, 57),
  ('commercial_manager', 'Commercial Manager', 'operations_commercial', 'shore', 'commercial', 1, array['Commercial Director']::text[], null, 58),
  ('post_fixture', 'Post-fixture / Claims Executive', 'operations_commercial', 'shore', 'post_fixture', 1, array['Post Fixture Executive', 'Post-Fixture Executive', 'Claims Executive', 'Demurrage Analyst']::text[], null, 59),
  ('bunker_trader', 'Bunker Trader', 'operations_commercial', 'shore', 'bunker', 1, array['Bunker Buyer', 'Bunker Broker']::text[], null, 60),
  ('crewing_manager', 'Crewing Manager', 'crewing_manning', 'shore', 'crewing', 1, array['Crew Manager', 'Crew Superintendent', 'Fleet Personnel Manager']::text[], null, 61),
  ('crew_coordinator', 'Crew Coordinator', 'crewing_manning', 'shore', 'crewing', 2, array['Crewing Executive', 'Crewing Officer']::text[], null, 62),
  ('manning_agent', 'Manning Agent', 'crewing_manning', 'shore', 'manning', 1, array['Manning Agency', 'Manning Officer']::text[], null, 63),
  ('travel_logistics', 'Travel / Logistics Coordinator', 'crewing_manning', 'shore', 'crew_travel', 1, array['Travel Coordinator', 'Crew Travel Coordinator']::text[], null, 64),
  ('port_captain', 'Port Captain', 'port_terminal_logistics', 'shore', 'port_captain', 1, array['Port Marine Superintendent']::text[], null, 65),
  ('harbour_master', 'Harbour Master', 'port_terminal_logistics', 'shore', 'harbour_master', 1, array['Harbor Master', 'Deputy Harbour Master']::text[], null, 66),
  ('terminal_manager', 'Terminal Manager', 'port_terminal_logistics', 'shore', 'terminal', 1, array['Marine Terminal Superintendent', 'Port Operations Manager']::text[], null, 67),
  ('port_marine_pilot', 'Marine Pilot', 'port_terminal_logistics', 'shore', 'pilot', 1, array[]::text[], 'marine_pilot', 68),
  ('freight_forwarder', 'Freight Forwarder', 'port_terminal_logistics', 'shore', 'freight', 1, array['Freight Forwarding Executive', 'NVOCC Professional']::text[], null, 69),
  ('shipping_agent', 'Customs / Shipping Agent', 'port_terminal_logistics', 'shore', 'agency', 1, array['Shipping Agent', 'Ship Agent', 'Port Agent', 'Customs Agent', 'Customs Broker']::text[], null, 70),
  ('logistics_executive', 'Logistics Executive', 'port_terminal_logistics', 'shore', 'logistics', 2, array['Logistics Manager', 'Logistics Coordinator']::text[], null, 71),
  ('marine_surveyor', 'Marine Surveyor', 'survey_class_legal_insurance', 'shore', 'marine_surveyor', 1, array['Cargo Surveyor', 'Hull Surveyor', 'Condition Surveyor', 'Marine Warranty Surveyor']::text[], null, 72),
  ('class_surveyor', 'Class Surveyor', 'survey_class_legal_insurance', 'shore', 'class_surveyor', 1, array['Classification Surveyor', 'Flag State Surveyor']::text[], null, 73),
  ('marine_consultant', 'Marine Consultant', 'survey_class_legal_insurance', 'shore', 'consultant', 1, array['Maritime Consultant']::text[], null, 74),
  ('marine_lawyer', 'Marine Lawyer', 'survey_class_legal_insurance', 'shore', 'lawyer', 1, array['Maritime Lawyer', 'Admiralty Lawyer', 'Shipping Lawyer']::text[], null, 75),
  ('pi_insurance', 'P&I / Insurance Executive', 'survey_class_legal_insurance', 'shore', 'insurance', 1, array['P&I Executive', 'P&I Claims Executive', 'P&I Claims Manager', 'Insurance Executive', 'Marine Underwriter', 'Marine Insurance Broker']::text[], null, 76),
  ('average_adjuster', 'Average Adjuster', 'survey_class_legal_insurance', 'shore', 'adjuster', 1, array[]::text[], null, 77),
  ('naval_architect', 'Naval Architect', 'shipyard_engineering', 'shore', 'naval_architect', 1, array[]::text[], null, 78),
  ('shipyard_project_manager', 'Shipyard Project Manager', 'shipyard_engineering', 'shore', 'shipyard', 1, array['Shipyard Manager', 'Yard Project Manager']::text[], null, 79),
  ('marine_engineer_shore', 'Marine Engineer (Shore)', 'shipyard_engineering', 'shore', 'shore_engineer', 1, array['Shore Marine Engineer', 'Port Engineer']::text[], null, 80),
  ('repair_manager', 'Repair Manager', 'shipyard_engineering', 'shore', 'shipyard', 2, array['Ship Repair Manager']::text[], null, 81),
  ('director_ceo', 'Director / CEO', 'management', 'shore', 'management', 1, array['Director', 'CEO', 'Managing Director', 'MD']::text[], null, 82),
  ('general_manager', 'General Manager', 'management', 'shore', 'management', 2, array['GM']::text[], null, 83),
  ('department_head', 'Department Head', 'management', 'shore', 'management', 3, array['Head of Department', 'HOD']::text[], null, 84),
  ('hr_crewing_manager', 'Crewing Manager', 'recruitment_hr', 'shore', 'crewing', 1, array[]::text[], 'crewing_manager', 85),
  ('recruitment_manager', 'Recruitment Manager', 'recruitment_hr', 'shore', 'recruitment', 1, array['Talent Acquisition Manager']::text[], null, 86),
  ('recruiter', 'Recruiter / Talent Acquisition', 'recruitment_hr', 'shore', 'recruitment', 2, array['Recruiter', 'Talent Acquisition', 'Maritime Recruiter', 'Crewing Recruiter']::text[], null, 87),
  ('hr_manager', 'HR Manager', 'recruitment_hr', 'shore', 'hr', 1, array['Human Resources Manager']::text[], null, 88),
  ('hr_executive', 'HR Executive', 'recruitment_hr', 'shore', 'hr', 2, array['Maritime HR Professional', 'HR Officer']::text[], null, 89),
  ('manning_agency_owner', 'Manning Agent / Agency Owner', 'recruitment_hr', 'shore', 'manning', 1, array['Agency Owner']::text[], 'manning_agent', 90),
  ('hr_crew_coordinator', 'Crew Coordinator', 'recruitment_hr', 'shore', 'crewing', 2, array[]::text[], 'crew_coordinator', 91),
  ('payroll_compliance', 'Payroll / Compliance Officer', 'recruitment_hr', 'shore', 'payroll', 1, array['Payroll Officer', 'Compliance Officer']::text[], null, 92),
  ('institute_head', 'Maritime Training Institute Head / Principal', 'training', 'shore', 'faculty', 1, array['Principal', 'Institute Head']::text[], null, 93),
  ('senior_faculty', 'Senior Faculty / Lecturer', 'training', 'shore', 'faculty', 2, array['Senior Faculty', 'Lecturer', 'Maritime Academy Faculty', 'Nautical Instructor', 'Engineering Instructor']::text[], null, 94),
  ('simulator_instructor', 'Simulator Instructor (Bridge / Engine / DP)', 'training', 'shore', 'simulator', 1, array['Simulator Instructor']::text[], null, 95),
  ('stcw_instructor', 'STCW Course Instructor (BST, AFF, Medical)', 'training', 'shore', 'stcw', 1, array['STCW Instructor', 'Maritime Trainer']::text[], null, 96),
  ('assessor_examiner', 'Assessor / Examiner', 'training', 'shore', 'assessor', 1, array['STCW Assessor', 'Examiner', 'Assessor']::text[], null, 97),
  ('online_course_creator', 'Online Course Creator / Coach', 'training', 'shore', 'online', 1, array['Course Creator', 'Coach']::text[], null, 98),
  ('mentor', 'Mentor (Ex-Seafarer)', 'training', 'shore', 'mentor', 1, array['Mentor']::text[], null, 99),
  ('wellbeing_trainer', 'Soft-skills / Wellbeing Trainer', 'training', 'shore', 'wellbeing', 1, array['Soft Skills Trainer', 'Wellbeing Trainer']::text[], null, 100)
on conflict (code) do nothing;
-- statement-breakpoint
insert into public.vessel_types (code, name, vessel_group, synonyms, sort_order) values
  ('oil_tanker', 'Oil Tanker', 'tanker', array['Tanker', 'Oil Tankers', 'Tankers']::text[], 1),
  ('crude_tanker', 'Crude Oil Tanker', 'tanker', array['Crude', 'Crude Tanker', 'Crude Carrier', 'VLCC', 'ULCC', 'Suezmax', 'Aframax']::text[], 2),
  ('product_tanker', 'Product Tanker', 'tanker', array['Product', 'Products Tanker', 'Clean Product Tanker', 'Oil Product Tanker', 'MR Tanker', 'LR1', 'LR2']::text[], 3),
  ('chemical_tanker', 'Chemical Tanker', 'tanker', array['Chemical', 'Chem Tanker', 'Oil Chemical Tanker', 'Oil/Chemical Tanker', 'Chemical Carrier']::text[], 4),
  ('lpg_carrier', 'LPG Carrier', 'gas', array['LPG', 'LPG Tanker', 'VLGC', 'Gas Carrier']::text[], 5),
  ('lng_carrier', 'LNG Carrier', 'gas', array['LNG', 'LNG Tanker', 'LNGC']::text[], 6),
  ('bulk_carrier', 'Bulk Carrier', 'dry_bulk', array['Bulk', 'Bulker', 'Dry Bulk', 'Capesize', 'Panamax', 'Supramax', 'Ultramax', 'Handysize', 'Handymax']::text[], 7),
  ('general_cargo', 'General Cargo', 'dry_bulk', array['General Cargo Ship', 'Multipurpose', 'Multi Purpose', 'MPP', 'Breakbulk', 'Break Bulk']::text[], 8),
  ('container', 'Container Ship', 'container', array['Container', 'Containership', 'Container Vessel', 'Box Ship', 'Feeder']::text[], 9),
  ('ro_ro', 'Ro-Ro', 'other', array['RoRo', 'Ro Ro', 'Roll on Roll off']::text[], 10),
  ('car_carrier', 'Car Carrier', 'other', array['PCC', 'PCTC', 'Vehicle Carrier', 'Car Carrier Ship']::text[], 11),
  ('osv', 'Offshore Support Vessel', 'offshore', array['Offshore Support', 'OSV', 'Offshore Supply Vessel', 'Offshore']::text[], 12),
  ('ahts', 'AHTS', 'offshore', array['Anchor Handling Tug Supply', 'Anchor Handler', 'AHT']::text[], 13),
  ('psv', 'PSV', 'offshore', array['Platform Supply Vessel', 'Platform Supply']::text[], 14),
  ('dp_vessel', 'DP Vessel', 'offshore', array['DP Vessels', 'Dynamic Positioning Vessel', 'DSV', 'Drillship', 'Drill Ship', 'MODU']::text[], 15),
  ('tug', 'Tug', 'offshore', array['Tugboat', 'Tug Boat', 'Harbour Tug']::text[], 16),
  ('dredger', 'Dredger', 'other', array['TSHD', 'CSD', 'Dredging Vessel']::text[], 17),
  ('cruise', 'Cruise Ship', 'passenger', array['Cruise', 'Cruise Liner', 'Cruise Vessel']::text[], 18),
  ('ferry', 'Ferry', 'passenger', array['Ropax', 'Ro Pax', 'Passenger Ferry']::text[], 19),
  ('passenger', 'Passenger Ship', 'passenger', array['Passenger', 'Passenger Vessel']::text[], 20),
  ('reefer', 'Reefer', 'other', array['Refrigerated Cargo', 'Reefer Ship']::text[], 21),
  ('yacht', 'Yacht', 'passenger', array['Superyacht', 'Super Yacht', 'Motor Yacht']::text[], 22)
on conflict (code) do nothing;
-- statement-breakpoint
insert into public.certificate_types (code, name, category, synonyms, coc_rank_code, sort_order) values
  ('stcw_basic', 'STCW Basic Safety (all modules)', 'stcw_basic', array['STCW', 'STCW Basic', 'STCW 95', 'STCW 2010', 'STCW Basic Safety', 'Basic STCW']::text[], null, 1),
  ('bst', 'Basic Safety Training (BST)', 'stcw_basic', array['Basic Safety Training', 'BST']::text[], null, 2),
  ('pst', 'Personal Survival Techniques (PST)', 'stcw_basic', array['Personal Survival Techniques', 'PST', 'PSCRB', 'Proficiency in Survival Craft', 'Survival Craft and Rescue Boats']::text[], null, 3),
  ('fpff', 'Fire Prevention and Fire Fighting (FPFF)', 'stcw_basic', array['Fire Prevention and Fire Fighting', 'FPFF', 'Basic Fire Fighting']::text[], null, 4),
  ('efa', 'Elementary First Aid (EFA)', 'stcw_basic', array['Elementary First Aid', 'EFA']::text[], null, 5),
  ('pssr', 'Personal Safety and Social Responsibilities (PSSR)', 'stcw_basic', array['Personal Safety and Social Responsibilities', 'Personal Safety and Social Responsibility', 'PSSR']::text[], null, 6),
  ('aff', 'Advanced Fire Fighting (AFF)', 'stcw_advanced', array['Advanced Fire Fighting', 'Advanced Firefighting', 'AFF']::text[], null, 7),
  ('mfa', 'Medical First Aid (MFA)', 'stcw_advanced', array['Medical First Aid', 'MFA']::text[], null, 8),
  ('medical_care', 'Medical Care', 'stcw_advanced', array['Medical Care', 'Medical Care on Board', 'MC', 'MECA']::text[], null, 9),
  ('gmdss', 'GMDSS', 'navigation', array['GMDSS GOC', 'General Operator Certificate', 'GOC', 'GMDSS General Operator', 'ROC', 'Restricted Operator Certificate']::text[], null, 10),
  ('ecdis', 'ECDIS', 'navigation', array['Generic ECDIS', 'ECDIS Generic', 'Type Specific ECDIS', 'ECDIS Type Specific']::text[], null, 11),
  ('brm', 'Bridge Resource Management (BRM)', 'navigation', array['Bridge Resource Management', 'BRM', 'BTM', 'Bridge Team Management']::text[], null, 12),
  ('erm', 'Engine Room Resource Management (ERM)', 'navigation', array['Engine Room Resource Management', 'ERM', 'ERRM']::text[], null, 13),
  ('tanker_familiarisation', 'Oil and Chemical Tanker Familiarisation', 'tanker', array['Tanker Familiarisation', 'Tanker Familiarization', 'Oil and Chemical Tanker Familiarization', 'Basic Oil and Chemical Tanker', 'Basic Oil and Chemical Tanker Cargo Operations', 'OCTF', 'TF']::text[], null, 14),
  ('advanced_oil', 'Advanced Oil Tanker', 'tanker', array['Advanced Oil Tanker', 'Advanced Oil Tanker Cargo Operations', 'AOT', 'Advanced Oil Tanker Training']::text[], null, 15),
  ('advanced_chemical', 'Advanced Chemical Tanker', 'tanker', array['Advanced Chemical Tanker', 'Advanced Chemical Tanker Cargo Operations', 'ACT']::text[], null, 16),
  ('gas_familiarisation', 'Liquefied Gas Tanker Familiarisation', 'gas', array['Gas Tanker Familiarisation', 'Gas Tanker Familiarization', 'Basic Liquefied Gas Tanker', 'Basic Liquefied Gas Tanker Cargo Operations', 'LGTF']::text[], null, 17),
  ('advanced_gas', 'Advanced Gas Tanker', 'gas', array['Advanced Gas Tanker', 'Advanced Liquefied Gas Tanker', 'Advanced Liquefied Gas Tanker Cargo Operations', 'AGT']::text[], null, 18),
  ('dp_basic', 'DP Basic (Induction)', 'dp', array['DP Basic', 'DP Induction', 'Dynamic Positioning Basic', 'Dynamic Positioning Induction', 'Dynamic Positioning', 'DP']::text[], null, 19),
  ('dp_advanced', 'DP Advanced (Simulator)', 'dp', array['DP Advanced', 'DP Simulator', 'Dynamic Positioning Advanced', 'Dynamic Positioning Simulator']::text[], null, 20),
  ('dp_certificate', 'DP Operator Certificate', 'dp', array['DPO Certificate', 'Unlimited DP Certificate', 'Limited DP Certificate', 'Nautical Institute DP Certificate']::text[], null, 21),
  ('sso', 'Ship Security Officer (SSO)', 'security', array['Ship Security Officer', 'SSO']::text[], null, 22),
  ('sdsd', 'Designated Security Duties (SDSD)', 'security', array['Security Training for Seafarers with Designated Security Duties', 'Designated Security Duties', 'SDSD', 'Security Awareness', 'PSA', 'Proficiency in Security Awareness']::text[], null, 23),
  ('medical_fitness', 'Seafarer Medical Certificate', 'medical', array['Medical Certificate', 'Medical Fitness Certificate', 'Medical Fitness', 'Seafarer Medical', 'ENG1', 'DG Medical', 'PEME']::text[], null, 24),
  ('coc', 'Certificate of Competency (COC)', 'coc', array['Certificate of Competency', 'COC', 'CoC', 'License', 'Licence']::text[], null, 25),
  ('coc_master', 'COC: Master', 'coc', array['Master COC', 'COC Master', 'Master Unlimited', 'Master FG', 'Master Foreign Going', 'Class 1 Deck', 'Masters Certificate']::text[], 'master', 26),
  ('coc_chief_mate', 'COC: Chief Mate', 'coc', array['Chief Mate COC', 'COC Chief Mate', 'Chief Mate FG', 'Chief Mate Foreign Going', 'Class 2 Deck', 'First Mate COC']::text[], 'chief_officer', 27),
  ('coc_oow_deck', 'COC: Officer in Charge of a Navigational Watch', 'coc', array['OOW COC', 'OOW Deck', 'Second Mate COC', 'Second Mate FG', 'Second Mate Foreign Going', 'Class 3 Deck', 'Watchkeeping Officer Deck', 'NWKO']::text[], 'third_officer', 28),
  ('coc_chief_engineer', 'COC: Chief Engineer', 'coc', array['Chief Engineer COC', 'COC Chief Engineer', 'MEO Class 1', 'Class 1 Engine', 'Class 1 Motor']::text[], 'chief_engineer', 29),
  ('coc_second_engineer', 'COC: Second Engineer', 'coc', array['Second Engineer COC', 'COC Second Engineer', 'MEO Class 2', 'Class 2 Engine', 'Class 2 Motor']::text[], 'second_engineer', 30),
  ('coc_oow_engine', 'COC: Officer in Charge of an Engineering Watch', 'coc', array['EOOW COC', 'OOW Engine', 'MEO Class 4', 'Class 4 Engine', 'Class 4 Motor', 'Watchkeeping Officer Engine']::text[], 'fourth_engineer', 31),
  ('coc_eto', 'COC: Electro-Technical Officer', 'coc', array['ETO COC', 'COC ETO', 'Electro Technical Officer COC']::text[], 'eto', 32),
  ('coc_rating_deck', 'COC: Able Seafarer Deck', 'coc', array['Able Seafarer Deck', 'AB Certificate', 'Watchkeeping Rating Deck', 'Rating Forming Part of a Navigational Watch', 'RFPNW']::text[], 'able_seaman', 33),
  ('coc_rating_engine', 'COC: Able Seafarer Engine', 'coc', array['Able Seafarer Engine', 'Watchkeeping Rating Engine', 'Rating Forming Part of an Engineering Watch', 'RFPEW']::text[], 'motorman', 34)
on conflict (code) do nothing;

-- statement-breakpoint
-- One row per normalised name or synonym, so free text maps to a code with one indexed lookup.
create or replace view public.taxonomy_terms as
  select 'rank'::text as kind, r.code, public.taxonomy_normalize(term) as term, term_order
  from public.maritime_ranks r
  cross join lateral unnest(array[r.name, regexp_replace(r.name, '\s*\([^)]*\)\s*', ' ', 'g')] || r.synonyms) with ordinality as t(term, term_order)
  where r.same_as is null
  union all
  select 'vessel', v.code, public.taxonomy_normalize(term), term_order
  from public.vessel_types v
  cross join lateral unnest(array[v.name, regexp_replace(v.name, '\s*\([^)]*\)\s*', ' ', 'g')] || v.synonyms) with ordinality as t(term, term_order)
  union all
  select 'certificate', c.code, public.taxonomy_normalize(term), term_order
  from public.certificate_types c
  cross join lateral unnest(array[c.name, regexp_replace(c.name, '\s*\([^)]*\)\s*', ' ', 'g')] || c.synonyms) with ordinality as t(term, term_order);
-- statement-breakpoint
-- Canonical codes next to the existing free text (profiles.role_key and jobs.accepted_role_keys already hold rank codes).
alter table public.maritime_profiles
  add column if not exists vessel_type_codes text[] null,
  add column if not exists available_from date null;
-- statement-breakpoint
alter table public.profile_experiences
  add column if not exists rank_code text null,
  add column if not exists vessel_type_code text null;
-- statement-breakpoint
alter table public.profile_credentials
  add column if not exists certificate_type_code text null;
-- statement-breakpoint
alter table public.jobs
  add column if not exists vessel_type_codes text[] null;
-- statement-breakpoint
alter table public.job_certificate_requirements
  add column if not exists certificate_type_code text null;
-- statement-breakpoint
-- Maps one free-text value to its code (null when unknown). Used by the triggers below and the app's backfill sweep.
create or replace function public.taxonomy_code(term_kind text, value text) returns text
language sql stable parallel safe
as $$
  select t.code from public.taxonomy_terms t
  where t.kind = term_kind and t.term = public.taxonomy_normalize(value)
  order by t.term_order
  limit 1
$$;
-- statement-breakpoint
create or replace function public.taxonomy_codes(term_kind text, input_values text[]) returns text[]
language sql stable parallel safe
as $$
  select coalesce(array_agg(distinct code order by code), '{}'::text[])
  from (select public.taxonomy_code(term_kind, value) as code from unnest(coalesce(input_values, '{}'::text[])) as value) mapped
  where code is not null
$$;
-- statement-breakpoint
-- New and edited rows get their codes from the text the member picked or typed ("Other" text stays unmapped).
create or replace function public.fill_maritime_profile_codes() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.vessel_types is distinct from old.vessel_types or new.vessel_type_codes is null then
    new.vessel_type_codes := public.taxonomy_codes('vessel', new.vessel_types);
  end if;
  return new;
end
$$;
-- statement-breakpoint
create or replace trigger maritime_profiles_fill_codes
  before insert or update on public.maritime_profiles
  for each row execute function public.fill_maritime_profile_codes();
-- statement-breakpoint
create or replace function public.fill_profile_experience_codes() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    new.rank_code := public.taxonomy_code('rank', new.title);
  end if;
  if tg_op = 'INSERT' or new.vessel_type is distinct from old.vessel_type then
    new.vessel_type_code := public.taxonomy_code('vessel', new.vessel_type);
  end if;
  return new;
end
$$;
-- statement-breakpoint
create or replace trigger profile_experiences_fill_codes
  before insert or update on public.profile_experiences
  for each row execute function public.fill_profile_experience_codes();
-- statement-breakpoint
create or replace function public.fill_profile_credential_codes() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    new.certificate_type_code := public.taxonomy_code('certificate', new.name);
  end if;
  return new;
end
$$;
-- statement-breakpoint
create or replace trigger profile_credentials_fill_codes
  before insert or update on public.profile_credentials
  for each row execute function public.fill_profile_credential_codes();
-- statement-breakpoint
create or replace function public.fill_job_codes() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.vessel_types is distinct from old.vessel_types or new.vessel_type_codes is null then
    new.vessel_type_codes := public.taxonomy_codes('vessel', new.vessel_types);
  end if;
  return new;
end
$$;
-- statement-breakpoint
create or replace trigger jobs_fill_codes
  before insert or update on public.jobs
  for each row execute function public.fill_job_codes();
-- statement-breakpoint
create or replace function public.fill_job_certificate_codes() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.certificate_name is distinct from old.certificate_name then
    new.certificate_type_code := public.taxonomy_code('certificate', new.certificate_name);
  end if;
  return new;
end
$$;
-- statement-breakpoint
create or replace trigger job_certificate_requirements_fill_codes
  before insert or update on public.job_certificate_requirements
  for each row execute function public.fill_job_certificate_codes();
-- statement-breakpoint
create index if not exists profile_experiences_vessel_match_idx
  on public.profile_experiences (public.taxonomy_normalize(vessel), profile_id)
  where vessel is not null and track = 'sea_service';
-- statement-breakpoint
create index if not exists profile_experiences_organization_match_idx
  on public.profile_experiences (public.taxonomy_normalize(organization), profile_id)
  where organization is not null;
-- statement-breakpoint
create index if not exists profile_credentials_type_idx
  on public.profile_credentials (profile_id, certificate_type_code)
  where certificate_type_code is not null;

-- statement-breakpoint
-- G0.2 Signals. Privacy-light: no IP, no user agent, no text a member typed except search queries (90 days).
create table if not exists public.post_impressions (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1 check (seen_count >= 1),
  primary key (viewer_id, post_id)
);
-- statement-breakpoint
create index if not exists post_impressions_last_seen_idx on public.post_impressions (last_seen_at);
-- statement-breakpoint
create index if not exists post_impressions_post_idx on public.post_impressions (post_id);
-- statement-breakpoint
create table if not exists public.suggestion_dismissals (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('person', 'org', 'community', 'event', 'course', 'job')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, kind, target_id)
);
-- statement-breakpoint
create index if not exists suggestion_dismissals_created_idx on public.suggestion_dismissals (created_at);
-- statement-breakpoint
create table if not exists public.user_mutes (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  muted_profile_id uuid null references public.profiles(id) on delete cascade,
  muted_org_id uuid null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_mutes_one_target check (num_nonnulls(muted_profile_id, muted_org_id) = 1),
  constraint user_mutes_not_self check (muted_profile_id is null or muted_profile_id <> viewer_id)
);
-- statement-breakpoint
create unique index if not exists user_mutes_profile_unique_idx on public.user_mutes (viewer_id, muted_profile_id) where muted_profile_id is not null;
-- statement-breakpoint
create unique index if not exists user_mutes_org_unique_idx on public.user_mutes (viewer_id, muted_org_id) where muted_org_id is not null;
-- statement-breakpoint
create table if not exists public.feed_feedback (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  kind text not null check (kind in ('show_less', 'not_relevant')),
  author_id uuid null references public.profiles(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,
  category text null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, post_id, kind)
);
-- statement-breakpoint
create index if not exists feed_feedback_viewer_created_idx on public.feed_feedback (viewer_id, created_at desc);
-- statement-breakpoint
create table if not exists public.search_queries (
  id bigserial primary key,
  viewer_id uuid null references public.profiles(id) on delete cascade,
  normalized_query text not null check (char_length(normalized_query) between 1 and 80),
  vertical text not null default 'all',
  result_count integer not null default 0 check (result_count >= 0),
  clicked_kind text null,
  cleared_at timestamptz null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create index if not exists search_queries_viewer_created_idx on public.search_queries (viewer_id, created_at desc);
-- statement-breakpoint
create index if not exists search_queries_created_idx on public.search_queries (created_at);
-- statement-breakpoint
create index if not exists search_queries_zero_result_idx on public.search_queries (created_at, normalized_query) where result_count = 0;

-- statement-breakpoint
-- Engagement counts kept by triggers, so the feed reads one row per post instead of counting.
create table if not exists public.post_stats (
  post_id uuid primary key references public.posts(id) on delete cascade,
  reactions integer not null default 0,
  comments integer not null default 0,
  reposts integer not null default 0,
  last_engaged_at timestamptz null,
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
create or replace function public.post_stats_bump(target uuid, reaction_delta integer, comment_delta integer, repost_delta integer)
returns void
language sql
as $$
  insert into public.post_stats as s (post_id, reactions, comments, reposts, last_engaged_at, updated_at)
  select target, greatest(reaction_delta, 0), greatest(comment_delta, 0), greatest(repost_delta, 0),
         case when reaction_delta > 0 or comment_delta > 0 or repost_delta > 0 then now() end, now()
  where exists (select 1 from public.posts p where p.id = target)
  on conflict (post_id) do update set
    reactions = greatest(s.reactions + reaction_delta, 0),
    comments = greatest(s.comments + comment_delta, 0),
    reposts = greatest(s.reposts + repost_delta, 0),
    last_engaged_at = case when reaction_delta > 0 or comment_delta > 0 or repost_delta > 0 then now() else s.last_engaged_at end,
    updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.post_stats_on_reaction() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.post_stats_bump(new.post_id, 1, 0, 0);
  elsif tg_op = 'DELETE' then
    perform public.post_stats_bump(old.post_id, -1, 0, 0);
  end if;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger post_stats_reactions
  after insert or delete on public.post_reactions
  for each row execute function public.post_stats_on_reaction();
-- statement-breakpoint
create or replace function public.post_stats_on_comment() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then perform public.post_stats_bump(new.post_id, 0, 1, 0); end if;
  elsif tg_op = 'DELETE' then
    if old.deleted_at is null then perform public.post_stats_bump(old.post_id, 0, -1, 0); end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform public.post_stats_bump(new.post_id, 0, -1, 0);
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public.post_stats_bump(new.post_id, 0, 1, 0);
  end if;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger post_stats_comments
  after insert or delete or update of deleted_at on public.post_comments
  for each row execute function public.post_stats_on_comment();
-- statement-breakpoint
create or replace function public.post_stats_on_repost() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.repost_of_post_id is not null and new.deleted_at is null then perform public.post_stats_bump(new.repost_of_post_id, 0, 0, 1); end if;
  elsif tg_op = 'DELETE' then
    if old.repost_of_post_id is not null and old.deleted_at is null then perform public.post_stats_bump(old.repost_of_post_id, 0, 0, -1); end if;
  elsif new.repost_of_post_id is not null then
    if old.deleted_at is null and new.deleted_at is not null then
      perform public.post_stats_bump(new.repost_of_post_id, 0, 0, -1);
    elsif old.deleted_at is not null and new.deleted_at is null then
      perform public.post_stats_bump(new.repost_of_post_id, 0, 0, 1);
    end if;
  end if;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger post_stats_reposts
  after insert or delete or update of deleted_at on public.posts
  for each row execute function public.post_stats_on_repost();
-- statement-breakpoint
-- One-time backfill of the counts for posts that already exist (the triggers keep them current from here on).
insert into public.post_stats (post_id, reactions, comments, reposts, last_engaged_at)
select p.id,
       coalesce(r.total, 0),
       coalesce(c.total, 0),
       coalesce(rp.total, 0),
       greatest(r.latest, c.latest, rp.latest)
from public.posts p
left join (select post_id, count(*)::int as total, max(created_at) as latest from public.post_reactions group by post_id) r on r.post_id = p.id
left join (select post_id, count(*)::int as total, max(created_at) as latest from public.post_comments where deleted_at is null group by post_id) c on c.post_id = p.id
left join (select repost_of_post_id as post_id, count(*)::int as total, max(created_at) as latest from public.posts where repost_of_post_id is not null and deleted_at is null group by repost_of_post_id) rp on rp.post_id = p.id
on conflict (post_id) do nothing;

-- statement-breakpoint
-- Ranking switches: one row per area, 'off' (the old behaviour), 'admins' or 'everyone'. Read by the app every 30 s,
-- changed on Admin › Ranking without a deploy.
create table if not exists public.ranking_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  mode text not null default 'off' check (mode in ('off', 'admins', 'everyone')),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(id) on delete set null
);
-- statement-breakpoint
insert into public.ranking_settings (key, mode) values
  ('feed', 'admins'),
  ('people', 'admins')
on conflict (key) do nothing;
-- statement-breakpoint
-- Per-member choices: the feed mode (server-side, so it follows the member across devices), the last visit for
-- the Recent divider, and the two privacy switches.
create table if not exists public.member_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  feed_mode text null check (feed_mode in ('top', 'recent')),
  feed_last_visit_at timestamptz null,
  feed_previous_visit_at timestamptz null,
  show_in_people_suggestions boolean not null default true,
  open_to_recruiters boolean not null default false,
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
-- One ranked snapshot per feed visit (15 minutes). A cursor is a position in it; a reload starts a new visit.
create table if not exists public.feed_sessions (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  visit_id uuid not null,
  post_ids uuid[] not null,
  inserts jsonb not null default '[]'::jsonb,
  stage text not null default 'ranked' check (stage in ('ranked', 'wider', 'explore', 'caught_up')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
-- statement-breakpoint
create index if not exists feed_sessions_viewer_created_idx on public.feed_sessions (viewer_id, created_at desc);
-- statement-breakpoint
create index if not exists feed_sessions_expires_idx on public.feed_sessions (expires_at);
-- statement-breakpoint
-- G2: people you may know, rebuilt nightly and per member after a connect, onboarding, company or rank change.
create table if not exists public.people_suggestions (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  score real not null,
  primary_source text not null,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (viewer_id, candidate_id),
  constraint people_suggestions_not_self check (viewer_id <> candidate_id)
);
-- statement-breakpoint
create index if not exists people_suggestions_viewer_score_idx on public.people_suggestions (viewer_id, score desc);
-- statement-breakpoint
create index if not exists people_suggestions_candidate_idx on public.people_suggestions (candidate_id);
-- statement-breakpoint
-- Daily totals for Admin › Ranking health. Counts only, never member ids.
create table if not exists public.ranking_metrics_daily (
  day date not null,
  metric text not null check (metric ~ '^[a-z][a-z0-9_.]*$'),
  value bigint not null default 0,
  primary key (day, metric)
);

-- statement-breakpoint
-- Indexes the ranked feed reads that do not exist yet (posts by author, group, company and the newest-first feed
-- index already do).
create index if not exists posts_repost_source_idx on public.posts (repost_of_post_id) where repost_of_post_id is not null and deleted_at is null;
-- statement-breakpoint
create index if not exists post_reactions_user_created_idx on public.post_reactions (user_id, created_at desc);
