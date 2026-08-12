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
import { main, container, h1, text, button, footer, muted, logo, LOGO_URL } from './_styles.ts'

interface SessionConfirmedEmailProps {
  recipientName: string
  counterpartName: string
  topic: string
  whenFormatted: string
  meetingUrl: string
}

export const SessionConfirmedEmail = ({
  recipientName,
  counterpartName,
  topic,
  whenFormatted,
  meetingUrl,
}: SessionConfirmedEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your session with {counterpartName} is confirmed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>Session confirmed</Heading>
        <Text style={text}>
          Hi {recipientName}, your session with <strong>{counterpartName}</strong> is confirmed.
        </Text>
        <Text style={muted}>Topic</Text>
        <Text style={{ ...text, margin: '0 0 16px' }}>{topic}</Text>
        <Text style={muted}>When</Text>
        <Text style={{ ...text, margin: '0 0 24px' }}>{whenFormatted}</Text>
        <Button style={button} href={meetingUrl}>
          Join the meeting
        </Button>
        <Text style={footer}>
          Save this email — you can use the button above to join at the scheduled time.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SessionConfirmedEmail
