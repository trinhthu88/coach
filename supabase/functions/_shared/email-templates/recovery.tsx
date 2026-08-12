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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          We received a request to reset your password for {siteName}.
          Click the button below to choose a new one.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reset password
        </Button>
        <Text style={footer}>
          If you didn't request this, you can safely ignore the email — your password won't change.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
