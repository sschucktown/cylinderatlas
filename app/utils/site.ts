export const SITE_URL = 'https://www.cylinderatlas.com'

export function canonicalUrl(path = '/') {
  return new URL(path, SITE_URL).toString()
}

export function authRedirectUrl(path: string) {
  if (import.meta.client && /^(localhost|127\\.0\\.0\\.1)$/.test(window.location.hostname)) {
    return new URL(path, window.location.origin).toString()
  }

  return canonicalUrl(path)
}
