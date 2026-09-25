export const SITE_URL = 'https://cylinderatlas.vercel.app'

export function canonicalUrl(path = '/') {
  return new URL(path, SITE_URL).toString()
}
