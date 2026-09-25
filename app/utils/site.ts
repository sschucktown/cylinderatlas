export const SITE_URL = 'https://www.cylinderatlas.com'

export function canonicalUrl(path = '/') {
  return new URL(path, SITE_URL).toString()
}
