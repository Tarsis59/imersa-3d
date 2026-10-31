import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_ACESSO, COOKIE_REFRESH } from './lib/cookies';

export function proxy(req: NextRequest) {
  if (req.cookies.has(COOKIE_ACESSO) || req.cookies.has(COOKIE_REFRESH)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/painel/:path*'] };
