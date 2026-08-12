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
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { main, container, h1, text, link, button, footer, logo, LOGO_URL } from './_styles.ts'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>You're invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Click below to accept and create your account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept invitation
        </Button>
        <Text style={footer}>
          If you weren't expecting this, you can safely ignore the email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
