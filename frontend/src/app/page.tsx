import { redirect } from 'next/navigation';

// Entry route.
//
// The session is an HttpOnly cookie owned by the BACKEND, so this server
// component cannot read it and must not try: doing so would both fail and
// reintroduce the coupling that caused the OAuth bug.
//
// The previous version read a cookie literally named 'token' here, which was set
// by an older build and no longer exists, so every visitor landed on /login even
// when signed in. Routing is now decided on the client, where AuthContext
// resolves the real session state via /auth/me.
export default async function Page() {
  redirect('/dashboard');
}
