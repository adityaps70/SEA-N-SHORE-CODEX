import { describe, expect, it, vi } from 'vitest'
import { SearchTimeoutError, type SearchHit } from './search-repository'
import { createSearchService } from './search-service'

const hit = (kind: SearchHit['kind'], id: string, score = 300): SearchHit => ({
  kind, id, name: `Placeholder ${kind} ${id}`, subtitle: null, avatarPath: null, slug: `placeholder-${id}`, ownerId: null, score, createdAt: null,
})

describe('search service (round G)', () => {
  it('returns at most 3 people, 2 organizations, 2 communities, 2 jobs and 1 course or event, with links', async () => {
    const search = vi.fn(async () => [
      hit('person', 'p1'), hit('person', 'p2'), hit('person', 'p3'), hit('org', 'o1'), hit('org', 'o2'), hit('community', 'c1'),
      hit('job', 'j1'), hit('job', 'j2'), hit('course', 'k1', 200), hit('event', 'e1', 250),
    ])
    const service = createSearchService({ repository: { search }, sign: async (path) => path })
    const result = await service.suggest('viewer', 'placeholder')
    expect(result.items.map((item) => `${item.kind}:${item.id}`)).toEqual(['person:p1', 'person:p2', 'person:p3', 'org:o1', 'org:o2', 'community:c1', 'job:j1', 'job:j2', 'event:e1'])
    expect(result.items[0]!.href).toBe('/people/placeholder-p1')
    expect(result.items.at(-1)!.href).toBe('/events/e1')
  })

  it('caches organizations, communities and courses per query, never people', async () => {
    const search = vi.fn(async (request: { limits: Record<string, number> }) => Object.keys(request.limits).map((kind) => hit(kind as SearchHit['kind'], kind)))
    const service = createSearchService({ repository: { search: search as never }, sign: async (path) => path })
    await service.suggest('viewer-a', 'Placeholder')
    await service.suggest('viewer-b', 'placeholder ')
    const second = search.mock.calls[1]![0] as { limits: Record<string, number> }
    expect(Object.keys(second.limits).sort()).toEqual(['event', 'job', 'person'])
  })

  it('a statement timeout returns what is ready (partial), never an error', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([hit('org', 'o1')])
      .mockRejectedValueOnce(new SearchTimeoutError())
    const service = createSearchService({ repository: { search }, sign: async (path) => path })
    await service.suggest('viewer', 'placeholder')
    const result = await service.suggest('viewer', 'placeholder')
    expect(result).toMatchObject({ partial: true, items: [{ kind: 'org', id: 'o1' }] })
    search.mockRejectedValueOnce(new SearchTimeoutError())
    await expect(service.page('viewer', 'placeholder', 'people')).resolves.toMatchObject({ partial: true, total: 0 })
  })
})
