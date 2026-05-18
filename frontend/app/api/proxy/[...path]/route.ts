/**
 * Proxy route — forward client requests to the backend Cloud Run,
 * injecting the X-API-Key header server-side so the secret never reaches
 * the browser. Compatible avec Cloudflare Pages (Workers runtime).
 *
 * Auth modèle (phase 1 migration CF Pages) : X-API-Key uniquement.
 * L'OIDC Cloud Run→Cloud Run a été retiré car le frontend n'est plus
 * dans GCP. Voir plan jiggly-foraging-peach.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@cloudflare/next-on-pages'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

async function proxy(req: NextRequest, params: { path: string[] }) {
  try {
    const env = getRequestContext().env as { BACKEND_URL?: string; BACKEND_API_KEY?: string }
    const BACKEND_URL = env.BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:8000'
    const BACKEND_API_KEY = env.BACKEND_API_KEY || process.env.BACKEND_API_KEY || ''

    const path = '/' + (params.path || []).join('/')
    // next-on-pages injecte `?path=...` dans la query string pour router le catch-all
    // [...path]. On l'enlève avant de forwarder au backend.
    const sp = new URLSearchParams(req.nextUrl.search)
    sp.delete('path')
    const search = sp.toString() ? `?${sp.toString()}` : ''
    const targetUrl = `${BACKEND_URL}${path}${search}`

    const headers: Record<string, string> = {}
    if (BACKEND_API_KEY) headers['X-API-Key'] = BACKEND_API_KEY

    const incomingContentType = req.headers.get('content-type')
    if (incomingContentType) headers['Content-Type'] = incomingContentType

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const body = hasBody ? await req.text() : undefined

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
        cache: 'no-store',
      })
      const text = await upstream.text()
      return new NextResponse(text, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
        },
      })
    } catch (err: any) {
      return NextResponse.json(
        { error: 'upstream_error', target: targetUrl, message: err?.message || String(err) },
        { status: 502 },
      )
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: 'proxy_top_error', message: err?.message || String(err), stack: err?.stack || null },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params)
}
