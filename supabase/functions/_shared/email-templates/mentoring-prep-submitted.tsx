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

interface MentoringPrepSubmittedEmailProps {
  recipientName: string
  counterpartName: string
  topic: string
  whenFormatted: string
  fileUrl: string
  notes?: string | null
}

export const MentoringPrepSubmittedEmail = ({
  recipientName,
  counterpartName,
  topic,
  whenFormatted,
  fileUrl,
  notes,
}: MentoringPrepSubmittedEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Preparation file submitted for your mentoring session with {counterpartName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>Preparation file submitted</Heading>
        <Text style={text}>
          Hi {recipientName}, a preparation file has been submitted for your mentoring session with{' '}
          <strong>{counterpartName}</strong>.
        </Text>
        <Text style={muted}>Topic</Text>
        <Text style={{ ...text, margin: '0 0 16px' }}>{topic}</Text>
        <Text style={muted}>When</Text>
        <Text style={{ ...text, margin: '0 0 24px' }}>{whenFormatted}</Text>
        {notes && (
          <>
            <Text style={muted}>Notes from the mentee</Text>
            <Text style={{ ...text, margin: '0 0 24px' }}>{notes}</Text>
          </>
        )}
        <Button style={button} href={fileUrl}>
          View preparation file
        </Button>
        <Text style={footer}>
          This link expires in 7 days. You can also view the file from the session's detail page in Clariva.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MentoringPrepSubmittedEmail
