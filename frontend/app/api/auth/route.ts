import { NextResponse } from 'next/server'
import { getRequestContext } from '@cloudflare/next-on-pages'

export const runtime = 'edge'

export async function POST(req: Request) {
  const { password } = await req.json()
  const expected =
    (getRequestContext().env as { AUTH_PASSWORD?: string }).AUTH_PASSWORD ||
    process.env.AUTH_PASSWORD ||
    'sinvestir2026'

  if (password !== expected) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('auth_token', 'authenticated', {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'lax',
  })
  return res
}
