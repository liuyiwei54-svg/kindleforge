/**
 * Host / Origin guard for every API route.
 *
 * Applied globally through Next middleware (matcher `/api/:path*`) so v1 and
 * v2 routes cannot be reached with a spoofed `Host` from a DNS-rebinding page.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { evaluateRequestOrigin } from './lib/server/origin';

export const config = {
  matcher: ['/api/:path*'],
};

export function middleware(request: NextRequest): NextResponse {
  const result = evaluateRequestOrigin(request.headers);
  if (result.ok) return NextResponse.next();
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
