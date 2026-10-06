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

// Sent by send-assessment-feedback-email once Admin approves a review. It
// says only that feedback is ready: the feedback itself stays in the app,
// behind the learner's sign-in.
interface AssessmentFeedbackReleasedEmailProps {
  fullName: string
  /** "triad" or "final_assessment". */
  kind: string
  triadNumber?: number | null
  ctaUrl: string
  isVi?: boolean
}

export function assessmentFeedbackSubject({ kind, triadNumber, isVi }: Pick<AssessmentFeedbackReleasedEmailProps, 'kind' | 'triadNumber' | 'isVi'>) {
  if (kind === 'triad') {
    return isVi ? `Nhận xét cho Triad ${triadNumber} đã sẵn sàng` : `Your feedback for Triad ${triadNumber} is ready`
  }
  return isVi ? 'Kết quả Final Assessment của bạn đã sẵn sàng' : 'Your Final Assessment result is ready'
}

export const AssessmentFeedbackReleasedEmail = ({
  fullName,
  kind,
  triadNumber,
  ctaUrl,
  isVi,
}: AssessmentFeedbackReleasedEmailProps) => {
  const title = assessmentFeedbackSubject({ kind, triadNumber, isVi })
  return (
    <Html lang={isVi ? 'vi' : 'en'} dir="ltr">
      <Head />
      <Preview>{title}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
          <Heading style={h1}>{title}</Heading>
          <Text style={text}>{isVi ? `Chào ${fullName},` : `Hi ${fullName},`}</Text>
          <Text style={text}>
            {kind === 'triad'
              ? isVi
                ? `Người đánh giá đã gửi nhận xét về bài suy ngẫm Triad ${triadNumber} của bạn. Hãy đăng nhập để đọc nhận xét.`
                : `Your assessor has shared feedback on your Triad ${triadNumber} reflection. Sign in to read it.`
              : isVi
                ? 'Người đánh giá đã hoàn tất đánh giá Final Assessment của bạn. Hãy đăng nhập để xem kết quả và nhận xét.'
                : 'Your assessor has completed the review of your Final Assessment. Sign in to see your result and feedback.'}
          </Text>
          <Button style={button} href={ctaUrl}>
            {isVi ? 'Xem nhận xét' : 'Read your feedback'}
          </Button>
          <Text style={footer}>
            {isVi
              ? 'Bạn nhận được email này vì có nhận xét mới cho bạn trong chương trình trên Clariva.'
              : "You're receiving this because new feedback is ready for you in your programme on Clariva."}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default AssessmentFeedbackReleasedEmail
