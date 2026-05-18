/**
 * Port TypeScript de `backend/app/source_classifier.py`.
 *
 * Logique strictement équivalente à la version Python. Les comparaisons
 * `startsWith` et `includes` reproduisent le `s.startswith(...)` et `x in s`
 * du code original.
 */

export interface Classification {
  canal: 'Paid' | 'Organique' | 'Direct' | 'Inconnu'
  sous_canal: string
}

const UNKNOWN: Classification = { canal: 'Inconnu', sous_canal: 'Inconnu' }

const UNKNOWN_SENTINELS = new Set([
  '', 'nan', 'none', 'xxx', '...', 'axel', 'bannarti', 'source-3',
])

const SEO_PATTERNS = [
  'seo', 'article', 'comparatif', 'banniere_art', 'modele_art', 'liste_etf',
  'comment-investir', 'simulateur', 'investir1000e', 'commencez-ici',
  'investissement',
]
const PODCAST_PATTERNS = ['podcast', 'ausha', 'detente-financiere']
const NEWSLETTER_PATTERNS = ['substack', 'sequencelbd', 'mail']
const SOCIAL_PATTERNS = ['linkedin', 'bio-insta', 'bio-facebook']
const OWNED_PATTERNS = [
  'popup', 'livre', 'accueilsite', 'tlmpreb', 'page-outils', 'page-parrainage',
  'footer', 'page-contact', 'page-a-propos', 'page-recherche', 'chatbot',
  'bio-facebook', 'legend',
]
const DIRECT_PATTERNS = ['mon-compte', 'pdv', 'r2', 'direct', 'menu', 'site']

const cache = new Map<string, Classification>()
const unknownLog = new Set<string>()

export function classify(source: string | null | undefined): Classification {
  const original = source == null ? '' : String(source)
  if (cache.has(original)) return cache.get(original)!

  const s = original.toLowerCase().trim()
  if (UNKNOWN_SENTINELS.has(s)) {
    cache.set(original, UNKNOWN)
    return UNKNOWN
  }

  let result: Classification

  if (s.startsWith('ads_pub_') || s === 'ads_retargeting') {
    result = { canal: 'Paid', sous_canal: 'Meta' }
  } else if (s.startsWith('ads2_google') || s.includes('googleads') || s.includes('google-ads') || s.includes('google ads')) {
    result = { canal: 'Paid', sous_canal: 'Google' }
  } else if (s.includes('tiktok')) {
    result = { canal: 'Paid', sous_canal: 'TikTok' }
  } else if (s.startsWith('meta') || s.startsWith('fb-')) {
    result = { canal: 'Paid', sous_canal: 'Meta' }
  } else if (
    s.startsWith('ytb') ||
    s.startsWith('yt-') ||
    s === 'chaineytb' || s === 'post-youtube' || s === 'linktree' || s === 'linktre'
  ) {
    result = { canal: 'Organique', sous_canal: 'YouTube' }
  } else if (SEO_PATTERNS.some((x) => s.includes(x))) {
    result = { canal: 'Organique', sous_canal: 'SEO' }
  } else if (PODCAST_PATTERNS.some((x) => s.includes(x))) {
    result = { canal: 'Organique', sous_canal: 'Podcast' }
  } else if (NEWSLETTER_PATTERNS.some((x) => s.includes(x))) {
    result = { canal: 'Organique', sous_canal: 'Newsletter' }
  } else if (s.startsWith('webi-')) {
    result = { canal: 'Organique', sous_canal: 'Webinaire' }
  } else if (SOCIAL_PATTERNS.some((x) => s.includes(x))) {
    result = { canal: 'Organique', sous_canal: 'Social' }
  } else if (s.startsWith('aff-')) {
    result = { canal: 'Organique', sous_canal: 'Affiliation' }
  } else if (OWNED_PATTERNS.some((x) => s.includes(x))) {
    result = { canal: 'Organique', sous_canal: 'Owned' }
  } else if (DIRECT_PATTERNS.some((x) => s.includes(x))) {
    result = { canal: 'Direct', sous_canal: 'Direct' }
  } else {
    unknownLog.add(original)
    result = UNKNOWN
  }

  cache.set(original, result)
  return result
}

export function getUnknownSources(): string[] {
  return [...unknownLog].sort()
}
