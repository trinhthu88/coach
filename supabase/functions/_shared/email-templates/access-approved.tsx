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

interface AccessApprovedEmailProps {
  fullName: string
  confirmationUrl: string
}

export const AccessApprovedEmail = ({
  fullName,
  confirmationUrl,
}: AccessApprovedEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Clariva access has been approved</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>You're approved</Heading>
        <Text style={text}>
          Hi {fullName}, your Clariva access request has been approved. Click below to log in —
          no password needed for this first visit.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Log in to Clariva
        </Button>
        <Text style={footer}>
          This link expires shortly and can only be used once. If you weren't expecting this, you
          can safely ignore the email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default AccessApprovedEmail
