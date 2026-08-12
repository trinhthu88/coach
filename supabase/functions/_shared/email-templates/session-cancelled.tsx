/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { main, container, h1, text, footer, muted, logo, LOGO_URL } from './_styles.ts'

interface SessionCancelledEmailProps {
  recipientName: string
  counterpartName: string
  topic: string
  whenFormatted: string
  reason?: string
}

export const SessionCancelledEmail = ({
  recipientName,
  counterpartName,
  topic,
  whenFormatted,
  reason,
}: SessionCancelledEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your session with {counterpartName} was cancelled</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>Session cancelled</Heading>
        <Text style={text}>
          Hi {recipientName}, your session with <strong>{counterpartName}</strong> has been cancelled.
        </Text>
        <Text style={muted}>Topic</Text>
        <Text style={{ ...text, margin: '0 0 16px' }}>{topic}</Text>
        <Text style={muted}>Was scheduled for</Text>
        <Text style={{ ...text, margin: reason ? '0 0 16px' : '0 0 24px' }}>{whenFormatted}</Text>
        {reason && (
          <>
            <Text style={muted}>Reason</Text>
            <Text style={{ ...text, margin: '0 0 24px' }}>{reason}</Text>
          </>
        )}
        <Text style={footer}>
          Head back to Clariva to rebook a session whenever you're ready.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SessionCancelledEmail
