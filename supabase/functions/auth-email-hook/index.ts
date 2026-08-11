import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { Webhook, WebhookVerificationError } from 'npm:standardwebhooks@1.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import { buildCorsHeaders } from '../_shared/cors.ts'

const CORS_ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version'

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your login link',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<Record<string, unknown>>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = "clariva-club"
const SENDER_DOMAIN = "notify.clariva.club"
const ROOT_DOMAIN = "clariva.club"
const FROM_DOMAIN = "notify.clariva.club" // Domain shown in From address (may be root or sender subdomain)

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://clariva-club.lovable.app"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// ============================================================
// Auth Hook payload — native Supabase shape (Standard Webhooks).
//
// This is NOT the shape Lovable's webhook wrapper previously delivered.
// Lovable's `parseEmailWebhookPayload` normalized Supabase's native hook
// payload into a simplified { run_id, version, data: { action_type, email,
// url, token, ... } } envelope. Supabase's own Send Email Hook sends
// { user, email_data } directly, with no such envelope — no run_id, no
// version, and confirmationUrl is not provided pre-built; it has to be
// constructed from email_data.site_url + token_hash + email_action_type +
// redirect_to. See https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
// ============================================================

interface AuthHookUser {
  id: string
  email: string
  new_email?: string
  phone?: string
}

interface AuthHookEmailData {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
  // Populated alongside token/token_hash for 'email_change' when Secure
  // Email Change is enabled. Field names are intentionally reversed for
  // backward compatibility — see the email_change handling note below.
  token_new: string
  token_hash_new: string
  old_email?: string
}

interface AuthHookPayload {
  user: AuthHookUser
  email_data: AuthHookEmailData
}

class PayloadShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayloadShapeError'
  }
}

function parseAuthHookPayload(raw: unknown): AuthHookPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new PayloadShapeError('Payload is not an object')
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.user !== 'object' || obj.user === null) {
    throw new PayloadShapeError('Missing or invalid "user"')
  }
  if (typeof obj.email_data !== 'object' || obj.email_data === null) {
    throw new PayloadShapeError('Missing or invalid "email_data"')
  }

  const u = obj.user as Record<string, unknown>
  const ed = obj.email_data as Record<string, unknown>

  if (typeof u.email !== 'string') {
    throw new PayloadShapeError('Missing "user.email"')
  }
  if (typeof ed.email_action_type !== 'string') {
    throw new PayloadShapeError('Missing "email_data.email_action_type"')
  }
  if (typeof ed.site_url !== 'string') {
    throw new PayloadShapeError('Missing "email_data.site_url"')
  }

  return {
    user: {
      id: typeof u.id === 'string' ? u.id : '',
      email: u.email,
      new_email: typeof u.new_email === 'string' ? u.new_email : undefined,
      phone: typeof u.phone === 'string' ? u.phone : undefined,
    },
    email_data: {
      token: typeof ed.token === 'string' ? ed.token : '',
      token_hash: typeof ed.token_hash === 'string' ? ed.token_hash : '',
      redirect_to: typeof ed.redirect_to === 'string' ? ed.redirect_to : '',
      email_action_type: ed.email_action_type,
      site_url: ed.site_url,
      token_new: typeof ed.token_new === 'string' ? ed.token_new : '',
      token_hash_new: typeof ed.token_hash_new === 'string' ? ed.token_hash_new : '',
      old_email: typeof ed.old_email === 'string' ? ed.old_email : undefined,
    },
  }
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = buildCorsHeaders(req, {
    'Access-Control-Allow-Headers': 'authorization, content-type',
  })

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  // TODO(Phase 4): still gated on LOVABLE_API_KEY — deliberately untouched
  // until Phase 4, per the task's phase boundaries.
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Builds the action link the way Supabase's own default email templates do:
// hitting its /auth/v1/verify endpoint, which validates token_hash and
// redirects to redirect_to on success.
function buildConfirmationUrl(siteUrl: string, tokenHash: string, actionType: string, redirectTo: string): string {
  const url = new URL('/auth/v1/verify', siteUrl)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', actionType)
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

// Webhook handler - verifies signature and sends email
async function handleWebhook(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const hookSecretRaw = Deno.env.get('AUTH_HOOK_SECRET')

  if (!hookSecretRaw) {
    console.error('AUTH_HOOK_SECRET not configured')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Supabase's dashboard provides the secret as "v1,whsec_<base64>". The
  // Webhook class only auto-strips a bare "whsec_" prefix, so strip "v1,"
  // ourselves first, matching Supabase's own documented usage.
  const hookSecret = hookSecretRaw.replace(/^v1,/, '')
  const rawBody = await req.text()

  let payload: AuthHookPayload
  try {
    const wh = new Webhook(hookSecret)
    const verified = wh.verify(rawBody, Object.fromEntries(req.headers))
    payload = parseAuthHookPayload(verified)
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      // Covers missing headers, unparseable/stale/future timestamp, and
      // signature mismatch — standardwebhooks reports all of these as one
      // error class distinguished only by .message, not a .code. All of
      // them mean the same thing from the caller's perspective: reject
      // with the same response the old @lovable.dev/webhooks-js path used
      // for invalid_signature/missing_timestamp/invalid_timestamp/stale_timestamp.
      console.error('Invalid webhook signature', { error: error.message })
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // SyntaxError (JSON.parse failed on an otherwise-correctly-signed
    // payload) or PayloadShapeError (correctly-signed JSON, wrong shape) —
    // both mean the payload itself is invalid, matching the old
    // invalid_payload/invalid_json response.
    console.error('Invalid webhook payload', { error: error instanceof Error ? error.message : error })
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const emailType = payload.email_data.email_action_type
  console.log('Received auth event', { emailType, email: payload.user.email })

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType })
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // NOTE(email_change): Secure Email Change is enabled for this project, so
  // Supabase populates BOTH token pairs for an email_change event, and per
  // its docs a fully correct implementation sends TWO emails: one to the
  // OLD address using token+token_hash_new, one to the NEW address using
  // token_new+token_hash (the "_new" suffix is intentionally reversed for
  // backward compatibility). Resolving that dual-send is a Phase 2 send-
  // path decision, not a Phase 1 parsing concern. For now this sends a
  // single email to the new address using token+token_hash — equivalent to
  // what Supabase would send if Secure Email Change were off. THIS IS A
  // KNOWN GAP, not a finished implementation — flagged for Phase 2.
  const recipientEmail =
    emailType === 'email_change' ? payload.user.new_email || payload.user.email : payload.user.email

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: recipientEmail,
    confirmationUrl: buildConfirmationUrl(
      payload.email_data.site_url,
      payload.email_data.token_hash,
      emailType,
      payload.email_data.redirect_to
    ),
    token: payload.email_data.token,
    email: payload.user.email,
    oldEmail: payload.email_data.old_email,
    newEmail: payload.user.new_email,
  }

  // Render React Email to HTML and plain text
  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  })

  // Enqueue email for async processing by the dispatcher (process-email-queue).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const messageId = crypto.randomUUID()

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: recipientEmail,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      message_id: messageId,
      to: recipientEmail,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipientEmail,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: recipientEmail })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const corsHeaders = buildCorsHeaders(req, { 'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS })

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req, corsHeaders)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
