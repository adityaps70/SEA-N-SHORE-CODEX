import { CERTIFICATE_TYPE_SEEDS, MARITIME_RANKS, VESSEL_TYPE_SEEDS } from '../maritime-taxonomy'

export type TaxonomyKind = 'rank' | 'vessel' | 'certificate'

/** The names a member can pick for each kind (canonical names only, no duplicates). */
export function taxonomyOptions(kind: TaxonomyKind): string[] {
  switch (kind) {
    case 'rank':
      return MARITIME_RANKS.filter((rank) => !rank.sameAs).map((rank) => rank.name)
    case 'vessel':
      return VESSEL_TYPE_SEEDS.map((vessel) => vessel.name)
    case 'certificate':
      return CERTIFICATE_TYPE_SEEDS.map((certificate) => certificate.name)
  }
}

/**
 * Round G (G0.1): the taxonomy as a native <datalist>, so a text field becomes a searchable list of
 * canonical names that still accepts any other text ("Other"). Typed text maps to a code on save
 * (database triggers, migration 0083); text that matches nothing stays as typed.
 */
export function TaxonomyDatalist({ id, kind }: { id: string; kind: TaxonomyKind }) {
  return (
    <datalist id={id}>
      {taxonomyOptions(kind).map((name) => <option key={name} value={name} />)}
    </datalist>
  )
}
