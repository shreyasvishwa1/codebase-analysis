import { describe, expect, it } from 'vitest'

import indexHtml from '../index.html?raw'
import robots from '../public/robots.txt?raw'

const SITE = 'https://codebase-analysis.onrender.com'
const publicFiles = Object.keys(import.meta.glob('../public/*'))

function meta(attribute: 'property' | 'name', key: string): string | null {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
  return doc.querySelector(`meta[${attribute}="${key}"]`)?.getAttribute('content') ?? null
}

describe('Link previews', () => {
  it('gives crawlers a title, description and canonical address', () => {
    expect(meta('property', 'og:title')).toMatch(/^CodeBase Analysis/)
    expect(meta('property', 'og:description')).toBeTruthy()
    expect(meta('property', 'og:type')).toBe('website')
    expect(meta('property', 'og:url')).toBe(`${SITE}/`)
  })

  it('points at a large preview image that the site actually serves', () => {
    const image = meta('property', 'og:image')
    expect(image).toBe(`${SITE}/og-image.png`)
    expect(publicFiles).toContain('../public/og-image.png')
    expect(meta('property', 'og:image:width')).toBe('1200')
    expect(meta('property', 'og:image:height')).toBe('630')
    expect(meta('property', 'og:image:alt')).toBeTruthy()
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
  })
})

describe('robots.txt', () => {
  it('is a real robots file that keeps crawlers out of the API', () => {
    expect(robots.split('\n')).toEqual(['User-agent: *', 'Disallow: /api/', ''])
  })
})
