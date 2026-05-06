import { NextResponse } from 'next/server'

const PASSWORD = process.env.AUTH_PASSWORD || 'sinvestir2026'

export async function POST(req: Request) {
  const { password } = await req.json()

  if (password !== PASSWORD) {
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
