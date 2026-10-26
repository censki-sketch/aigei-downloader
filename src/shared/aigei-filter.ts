const AIGEI_HOSTS = new Set(['aigei.com', 'www.aigei.com'])
const DOWNLOAD_FILTER_FREE = 'is_vip_false'
const DOWNLOAD_FILTER_TOKENS = new Set([
  DOWNLOAD_FILTER_FREE,
  'is_vip_true',
  'copyright_resource'
])

const TERM_FILTER_TYPES = new Set(['game', 'course', 'short_video_variety'])
const TERM_FILTER_PATHS = [/^\/game(?:\/|$)/i, /^\/course(?:\/|$)/i, /^\/sound\/short(?:\/|$)/i]

/**
 * Apply Aigei's own server-side "free" download filter to a list/search URL.
 *
 * Aigei uses `dim=is_vip_false` for metric-based pages and
 * `term=is_vip_false` for term-based pages. This function only changes the
 * outgoing URL; it never filters a response locally.
 */
export function withAigeiServerDownloadFilter(value: string): string {
  let url: URL
  try {
    url = new URL(value, 'https://www.aigei.com')
  } catch {
    return value
  }

  if (!AIGEI_HOSTS.has(url.hostname.toLowerCase())) return url.toString()

  const type = (url.searchParams.get('type') || '').toLowerCase()
  const usesTermFilter = TERM_FILTER_TYPES.has(type) || TERM_FILTER_PATHS.some((pattern) => pattern.test(url.pathname))

  url.pathname = rewritePathDownloadFilter(url.pathname, !usesTermFilter)
  rewriteQueryDownloadFilter(url, usesTermFilter ? 'term' : 'dim', hasFreePathFilter(url.pathname))
  return url.toString()
}

function rewritePathDownloadFilter(pathname: string, allowPathFilter: boolean): string {
  const segments = pathname
    .split('/')
    .map((segment) => {
      const tokens = segment.split('-')
      const hadDownloadFilter = tokens.some((token) => DOWNLOAD_FILTER_TOKENS.has(token))
      const retained = tokens.filter((token) => !DOWNLOAD_FILTER_TOKENS.has(token))
      if (allowPathFilter && hadDownloadFilter) retained.push(DOWNLOAD_FILTER_FREE)
      return retained.join('-')
    })
  return segments
    .filter((segment, index) => segment || index === 0 || index === segments.length - 1)
    .join('/')
}

function rewriteQueryDownloadFilter(url: URL, targetParam: 'dim' | 'term', pathAlreadyFiltered: boolean): void {
  for (const param of ['dim', 'term'] as const) {
    const retained = splitFilterTokens(url.searchParams.get(param)).filter(
      (token) => !DOWNLOAD_FILTER_TOKENS.has(token)
    )
    if (param === targetParam && !pathAlreadyFiltered) retained.push(DOWNLOAD_FILTER_FREE)
    if (retained.length > 0) url.searchParams.set(param, Array.from(new Set(retained)).join('-'))
    else url.searchParams.delete(param)
  }
}

function splitFilterTokens(value: string | null): string[] {
  return (value || '').split('-').map((token) => token.trim()).filter(Boolean)
}

function hasFreePathFilter(pathname: string): boolean {
  return pathname.split(/[\/-]/).includes(DOWNLOAD_FILTER_FREE)
}
