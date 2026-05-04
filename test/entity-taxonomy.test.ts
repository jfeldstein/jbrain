import { describe, test, expect } from 'bun:test';

import type { Link, GraphPath } from '../src/core/types.ts';
import type { LinkBatchInput } from '../src/core/engine.ts';

import { PAGE_TYPE_VALUES, type PageType } from '../src/core/types.ts';
import {
  ENTITY_TYPES,
  ENTITY_REFERENCE_DIRS,
  BACKLINK_ENTITY_DIRS,
  HEALTH_ENTITY_PAGE_TYPES,
  ENRICHMENT_ENTITY_TYPES,
  ENRICHMENT_REFERENCE_DIRS,
  RELATIONSHIP,
  FRONTMATTER_RELATIONSHIP_MAP,
  FS_LINK_TYPE_RULES,
  PAGE_TYPE_INFERENCE_RULES,
  DIR_PATTERN,
  buildEntityDirRegexFragment,
  isEntityReferenceDir,
  isBacklinkEntityDir,
  isHealthEntityPageType,
  inferPageTypeFromPath,
  inferFsLinkTypeByTopDirs,
  asStoredLinkType,
  validateEntityTaxonomy,
  type InferredLinkType,
} from '../src/core/entity-taxonomy.ts';

describe('entity-taxonomy (contract)', () => {
  test('ENTITY_TYPES is a readable fillable form for entity behavior decisions', () => {
    expect(ENTITY_TYPES.map(e => ({
      key: e.key,
      singular: e.singular,
      plural: e.plural,
      dirs: e.referenceDirs,
      pageType: 'pageType' in e ? e.pageType : undefined,
      customBehavior: e.customBehavior,
      enrichment: 'enrichment' in e ? e.enrichment : undefined,
    }))).toEqual([
      {
        key: 'person',
        singular: 'person',
        plural: 'people',
        dirs: ['people'],
        pageType: 'person',
        customBehavior: { backlinks: true, healthMetrics: true },
        enrichment: true,
      },
      {
        key: 'company',
        singular: 'company',
        plural: 'companies',
        dirs: ['companies'],
        pageType: 'company',
        customBehavior: { backlinks: true, healthMetrics: true },
        enrichment: true,
      },
      {
        key: 'employer',
        singular: 'employer',
        plural: 'employers',
        dirs: ['employers'],
        pageType: 'employer',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'meeting',
        singular: 'meeting',
        plural: 'meetings',
        dirs: ['meetings'],
        pageType: 'meeting',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'concept',
        singular: 'concept',
        plural: 'concepts',
        dirs: ['concepts', 'topics'],
        pageType: 'concept',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'ai-research',
        singular: 'AI research concept',
        plural: 'AI research concepts',
        dirs: ['ai-research'],
        pageType: 'ai-research',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'project',
        singular: 'project',
        plural: 'projects',
        dirs: ['project', 'projects'],
        pageType: 'project',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'home-improvement',
        singular: 'home improvement project',
        plural: 'home improvement projects',
        dirs: ['home-improvement'],
        pageType: 'home-improvement',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'civics',
        singular: 'civic entity',
        plural: 'civic entities',
        dirs: ['civics', 'civic'],
        pageType: 'civic',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'source',
        singular: 'source',
        plural: 'sources',
        dirs: ['source'],
        pageType: 'source',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'media',
        singular: 'media item',
        plural: 'media',
        dirs: ['media'],
        pageType: 'media',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'personal',
        singular: 'personal',
        plural: 'personal',
        dirs: ['personal'],
        pageType: 'personal',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
      {
        key: 'finance',
        singular: 'finance',
        plural: 'finance',
        dirs: ['finance'],
        pageType: 'finance',
        customBehavior: { backlinks: false, healthMetrics: false },
        enrichment: undefined,
      },
    ]);
  });

  test('ENTITY_REFERENCE_DIRS is exact and ordered', () => {
    expect(ENTITY_REFERENCE_DIRS).toEqual([
      'people',
      'companies',
      'employers',
      'meetings',
      'concepts',
      'topics',
      'ai-research',
      'project',
      'projects',
      'home-improvement',
      'civics',
      'civic',
      'source',
      'media',
      'personal',
      'finance',
    ]);
  });

  test('BACKLINK_ENTITY_DIRS is exact', () => {
    expect(BACKLINK_ENTITY_DIRS).toEqual(['people', 'companies']);
  });

  test('HEALTH_ENTITY_PAGE_TYPES is exact', () => {
    expect(HEALTH_ENTITY_PAGE_TYPES).toEqual(['person', 'company']);
  });

  test('enrichment entity keys and reference dirs are derived from enrichable rows', () => {
    expect(ENRICHMENT_ENTITY_TYPES.map(e => e.key)).toEqual(['person', 'company']);
    expect(ENRICHMENT_REFERENCE_DIRS).toEqual(['people', 'companies']);
  });

  test('RELATIONSHIP values are exact', () => {
    expect(RELATIONSHIP).toEqual({
      MENTIONS: 'mentions',
      WORKS_AT: 'works_at',
      INVESTED_IN: 'invested_in',
      FOUNDED: 'founded',
      ADVISES: 'advises',
      ATTENDED: 'attended',
      SOURCE: 'source',
      RELATED_TO: 'related_to',
      DISCUSSED_IN: 'discussed_in',
      YC_PARTNER: 'yc_partner',
      LED_ROUND: 'led_round',
      INVOLVED_IN: 'involved_in',
      DEAL_FOR: 'deal_for',
    });
  });

  test('FRONTMATTER_RELATIONSHIP_MAP matches link-extraction.ts behavior', () => {
    expect(FRONTMATTER_RELATIONSHIP_MAP).toEqual([
      // Person pages → companies / employers
      { fields: ['company', 'companies'], pageType: 'person', type: 'works_at', direction: 'outgoing', dirHint: 'companies' },
      { fields: ['founded'], pageType: 'person', type: 'founded', direction: 'outgoing', dirHint: 'companies' },
      // Company pages (incoming relationships — subject of the verb lives elsewhere)
      { fields: ['key_people'], pageType: 'company', type: 'works_at', direction: 'incoming', dirHint: 'people' },
      { fields: ['partner'], pageType: 'company', type: 'yc_partner', direction: 'incoming', dirHint: 'people' },
      { fields: ['investors'], pageType: 'company', type: 'invested_in', direction: 'incoming', dirHint: ['companies', 'people'] },
      { fields: ['lead'], pageType: 'company', type: 'led_round', direction: 'incoming', dirHint: ['companies', 'people'] },
      // Meeting pages
      { fields: ['attendees'], pageType: 'meeting', type: 'attended', direction: 'incoming', dirHint: 'people' },
      // Any page type
      { fields: ['sources'], type: 'discussed_in', direction: 'incoming', dirHint: ['source', 'media'] },
      { fields: ['source'], type: 'source', direction: 'outgoing', dirHint: '' },
      { fields: ['related', 'see_also'], type: 'related_to', direction: 'outgoing', dirHint: '' },
    ]);
  });

  test('DIR_PATTERN is the canonical alternation exported for link extraction', () => {
    expect(DIR_PATTERN).toBe(buildEntityDirRegexFragment());
    expect(DIR_PATTERN).toBe(
      '(?:home-improvement|ai-research|companies|employers|concepts|meetings|personal|projects|finance|project|civics|people|source|topics|civic|media)',
    );
  });

  test('dir membership helpers are consistent', () => {
    expect(isEntityReferenceDir('people')).toBe(true);
    expect(isEntityReferenceDir('topics')).toBe(true);
    expect(isEntityReferenceDir('civics')).toBe(true);
    expect(isEntityReferenceDir('civic')).toBe(true);
    expect(isEntityReferenceDir('ai-research')).toBe(true);
    expect(isEntityReferenceDir('home-improvement')).toBe(true);
    expect(isEntityReferenceDir('employers')).toBe(true);
    expect(isEntityReferenceDir('personal')).toBe(true);
    expect(isEntityReferenceDir('finance')).toBe(true);
    expect(isEntityReferenceDir('funds')).toBe(false);
    expect(isEntityReferenceDir('deals')).toBe(false);
    expect(isEntityReferenceDir('yc')).toBe(false);

    expect(isBacklinkEntityDir('people')).toBe(true);
    expect(isBacklinkEntityDir('companies')).toBe(true);
    expect(isBacklinkEntityDir('meetings')).toBe(false);
  });

  test('isHealthEntityPageType narrows correctly', () => {
    expect(isHealthEntityPageType('person')).toBe(true);
    expect(isHealthEntityPageType('company')).toBe(true);
    expect(isHealthEntityPageType('concept')).toBe(false);
  });

  test('PAGE_TYPE_INFERENCE_RULES matches markdown.ts inferType behavior (high-signal cases)', () => {
    // This mainly asserts that the rules exist and are ordered as expected.
    // Detailed behavior is verified via inferPageTypeFromPath below.
    expect(PAGE_TYPE_INFERENCE_RULES.length).toBeGreaterThan(0);
    expect(PAGE_TYPE_INFERENCE_RULES[0]?.type).toBe('writing');
  });

  test.each([
    ['projects/blog/writing/essay.md', 'writing'],
    ['wiki/analysis/foo.md', 'analysis'],
    ['wiki/guides/foo.md', 'guide'],
    ['wiki/guide/foo.md', 'guide'],
    ['wiki/hardware/foo.md', 'hardware'],
    ['wiki/architecture/foo.md', 'architecture'],
    ['wiki/concepts/foo.md', 'concept'],
    ['wiki/concept/foo.md', 'concept'],
    ['concepts/seed-rounds.md', 'concept'],
    ['people/alice.md', 'person'],
    ['person/alice.md', 'person'],
    ['companies/acme.md', 'company'],
    ['company/acme.md', 'company'],
    ['employers/invisible.md', 'employer'],
    ['topics/ml-safety.md', 'concept'],
    ['topic/ml-safety.md', 'concept'],
    ['ai-research/rl-basics.md', 'ai-research'],
    ['civics/vt-wastewater.md', 'civic'],
    ['civic/city.md', 'civic'],
    ['home-improvement/solar-array.md', 'home-improvement'],
    ['projects/foo.md', 'project'],
    ['project/foo.md', 'project'],
    ['sources/foo.md', 'source'],
    ['source/foo.md', 'source'],
    ['media/foo.md', 'media'],
    ['personal/journal.md', 'personal'],
    ['finance/quarterly.md', 'finance'],
    ['emails/em-0001.md', 'email'],
    ['slack/sl-0001.md', 'slack'],
    ['cal/ev-0001.md', 'calendar-event'],
    ['calendar/ev-0001.md', 'calendar-event'],
    ['notes/n-0001.md', 'note'],
    ['note/n-0001.md', 'note'],
    ['meetings/m-0001.md', 'meeting'],
    ['meeting/m-0001.md', 'meeting'],
  ])('inferPageTypeFromPath(%s) = %s', (path, expected) => {
    expect(inferPageTypeFromPath(path)).toBe(expected as PageType);
  });

  test('inferFsLinkTypeByTopDirs matches extract.ts inferTypeByDir behavior', () => {
    expect(FS_LINK_TYPE_RULES).toEqual([
      { fromDir: 'people', toDir: 'companies', type: 'founded', whenFrontmatterArrayField: 'founded' },
      { fromDir: 'people', toDir: 'companies', type: 'works_at' },
      { fromDir: 'meetings', toDir: 'people', type: 'attended' },
    ]);
    expect(inferFsLinkTypeByTopDirs('people', 'companies', {})).toBe('works_at');
    expect(inferFsLinkTypeByTopDirs('people', 'companies', { founded: ['acme'] })).toBe('founded');
    expect(inferFsLinkTypeByTopDirs('meetings', 'people', {})).toBe('attended');
    expect(inferFsLinkTypeByTopDirs('concepts', 'people', {})).toBe('mentions');
  });

  test('InferredLinkType is derived from RELATIONSHIP values', () => {
    for (const v of Object.values(RELATIONSHIP)) {
      const label: InferredLinkType = v;
      expect(label).toBe(v);
    }
  });

  test('asStoredLinkType bridges inferred labels to stored strings (identity)', () => {
    expect(asStoredLinkType(RELATIONSHIP.WORKS_AT)).toBe('works_at');
    const inferred: InferredLinkType = RELATIONSHIP.MENTIONS;
    const stored: string = inferred;
    expect(stored).toBe('mentions');
  });

  test('DB/API link surfaces remain arbitrary strings, not InferredLinkType-only', () => {
    const link = {
      from_slug: 'a',
      to_slug: 'b',
      link_type: 'legacy_custom_type',
      context: '',
    } as Link;
    const fromRow: string = link.link_type;
    expect(fromRow).toBe('legacy_custom_type');

    const path = {
      from_slug: 'x',
      to_slug: 'y',
      link_type: 'filter_value',
      context: '',
      depth: 1,
    } as GraphPath;
    expect(path.link_type).toBe('filter_value');

    const batch: LinkBatchInput = {
      from_slug: 'p',
      to_slug: 'q',
      link_type: 'arbitrary_api_input',
    };
    expect(batch.link_type).toBe('arbitrary_api_input');
  });
});

describe('entity-taxonomy (validateEntityTaxonomy)', () => {
  test('taxonomy is structurally valid (empty diagnostics)', () => {
    expect(validateEntityTaxonomy()).toEqual([]);
  });

  test('PAGE_TYPE_VALUES has no duplicates (matches derived PageType union)', () => {
    const unique = new Set(PAGE_TYPE_VALUES);
    expect(unique.size).toBe(PAGE_TYPE_VALUES.length);
    const sample: PageType = PAGE_TYPE_VALUES[PAGE_TYPE_VALUES.length - 1]!;
    expect(unique.has(sample)).toBe(true);
  });

  test('every ENTITY_TYPES pageType appears in PAGE_TYPE_VALUES', () => {
    const allowed = new Set<string>(PAGE_TYPE_VALUES as readonly string[]);
    for (const row of ENTITY_TYPES) {
      if ('pageType' in row && row.pageType !== undefined) {
        expect(allowed.has(row.pageType)).toBe(true);
      }
    }
  });
});

