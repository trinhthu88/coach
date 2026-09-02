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

interface DailyPromptEmailProps {
  fullName: string
  promptText: string
  dashboardUrl: string
  isVi?: boolean
}

export const DailyPromptEmail = ({ fullName, promptText, dashboardUrl, isVi }: DailyPromptEmailProps) => (
  <Html lang={isVi ? 'vi' : 'en'} dir="ltr">
    <Head />
    <Preview>{isVi ? 'Gợi ý coaching hôm nay' : "Today's coaching nudge"}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>{isVi ? 'Gợi ý coaching hôm nay' : "Today's coaching nudge"}</Heading>
        <Text style={text}>
          {isVi ? `Chào ${fullName},` : `Hi ${fullName},`}
        </Text>
        <Text style={text}>{promptText}</Text>
        <Button style={button} href={dashboardUrl}>
          {isVi ? 'Trả lời trên bảng điều khiển' : 'Respond on your dashboard'}
        </Button>
        <Text style={footer}>
          {isVi
            ? 'Bạn nhận được email này vì chương trình đào tạo của bạn có bật tính năng gợi ý hàng ngày.'
            : "You're receiving this because your training programme has daily prompts enabled."}
        </Text>
      </Container>
    </Body>
  </Html>
)

export default DailyPromptEmail
