// Thin wrapper around Resend's REST API. Used by every function that sends a
// transactional email directly (i.e. not through Supabase Auth's Send Email
// Hook, which auth-email-hook handles separately).

interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
}

interface SendEmailResult {
  ok: boolean
  id?: string
  error?: string
}

const SITE_NAME = 'Clariva'
const DEFAULT_FROM_DOMAIN = 'clariva.club'

export async function sendEmail({ to, subject, html, text, from }: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured')
    return { ok: false, error: 'Email sending is not configured' }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from ?? `${SITE_NAME} <noreply@${DEFAULT_FROM_DOMAIN}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('Resend send failed', { status: res.status, body })
    return { ok: false, error: `Resend error ${res.status}: ${body}` }
  }

  const data = await res.json()
  return { ok: true, id: data.id }
}
