/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { main, container, h1, text, button, footer, logo, LOGO_URL } from './_styles.ts'

// One generic template shared by every send-programme-reminders reminder
// kind (overdue assignment, missed triad reflection, upcoming triad
// session) — the copy differs per kind (title/body/CTA), the shell doesn't,
// so this avoids 3-4 near-identical template files for what's just a
// title/body/link swap.
interface ProgrammeReminderEmailProps {
  fullName: string
  title: string
  titleVi?: string
  body: string
  bodyVi?: string
  ctaLabel: string
  ctaLabelVi?: string
  ctaUrl: string
  isVi?: boolean
}

export const ProgrammeReminderEmail = ({
  fullName,
  title,
  titleVi,
  body,
  bodyVi,
  ctaLabel,
  ctaLabelVi,
  ctaUrl,
  isVi,
}: ProgrammeReminderEmailProps) => (
  <Html lang={isVi ? 'vi' : 'en'} dir="ltr">
    <Head />
    <Preview>{(isVi && titleVi) || title}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>{(isVi && titleVi) || title}</Heading>
        <Text style={text}>{isVi ? `Chào ${fullName},` : `Hi ${fullName},`}</Text>
        <Text style={text}>{(isVi && bodyVi) || body}</Text>
        <Button style={button} href={ctaUrl}>
          {(isVi && ctaLabelVi) || ctaLabel}
        </Button>
        <Text style={footer}>
          {isVi
            ? 'Bạn nhận được email này vì đây là một nhắc nhở tự động từ chương trình của bạn trên Clariva.'
            : "You're receiving this as an automated reminder from your programme on Clariva."}
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ProgrammeReminderEmail
