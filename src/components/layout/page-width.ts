// Round H (H6): the two page content widths. The tokens live in the `@theme inline` block of src/app/globals.css
// (--container-page-wide / --container-page-narrow), which gives the `max-w-page-wide` and `max-w-page-narrow`
// utilities. Every page's outer content box uses one of them; page-width-contract.test.ts keeps it that way.
//
// Wide: feeds, lists, org and community pages, Learn, Events, job detail, dashboards.
// Narrow: reading and forms: Settings, articles, legal and other single-column pages.
export const PAGE_WIDE = 'mx-auto w-full max-w-page-wide'
export const PAGE_NARROW = 'mx-auto w-full max-w-page-narrow'
