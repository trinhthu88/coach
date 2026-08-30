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

interface Competency {
  label: string
  value: string
}

interface MentoringFeedbackSubmittedEmailProps {
  recipientName: string
  mentorName: string
  topic: string
  whenFormatted: string
  competencies: Competency[]
  overallNotes?: string | null
  /** True when this copy goes to the mentor who wrote the feedback, not the mentee it's about. */
  recipientIsMentor?: boolean
}

export const MentoringFeedbackSubmittedEmail = ({
  recipientName,
  mentorName,
  topic,
  whenFormatted,
  competencies,
  overallNotes,
  recipientIsMentor,
}: MentoringFeedbackSubmittedEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {recipientIsMentor ? 'A copy of the feedback you submitted for your mentoring session' : `${mentorName} shared feedback on your mentoring session`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>Mentor feedback is ready</Heading>
        <Text style={text}>
          {recipientIsMentor ? (
            <>Hi {recipientName}, here's a copy of the feedback you submitted for your mentoring session.</>
          ) : (
            <>Hi {recipientName}, <strong>{mentorName}</strong> shared feedback on your mentoring session.</>
          )}
        </Text>
        <Text style={muted}>Topic</Text>
        <Text style={{ ...text, margin: '0 0 16px' }}>{topic}</Text>
        <Text style={muted}>When</Text>
        <Text style={{ ...text, margin: '0 0 24px' }}>{whenFormatted}</Text>
        {competencies
          .filter((c) => c.value)
          .map((c) => (
            <React.Fragment key={c.label}>
              <Text style={muted}>{c.label}</Text>
              <Text style={{ ...text, margin: '0 0 16px' }}>{c.value}</Text>
            </React.Fragment>
          ))}
        {overallNotes && (
          <>
            <Text style={muted}>Overall notes</Text>
            <Text style={{ ...text, margin: '0 0 16px' }}>{overallNotes}</Text>
          </>
        )}
        <Text style={footer}>You can also view this feedback from the session's detail page in Clariva.</Text>
      </Container>
    </Body>
  </Html>
)

export default MentoringFeedbackSubmittedEmail
