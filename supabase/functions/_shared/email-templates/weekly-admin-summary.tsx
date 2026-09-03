/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Body, Container, Head, Heading, Hr, Html, Img, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import { main, container, h1, text, muted, logo, LOGO_URL } from './_styles.ts'

export interface ProgrammeStatRow {
  programmeName: string
  enrolledCount: number
  quizCompletionPct: number | null
  reflectionCompletionPct: number | null
  triadCompletionPct: number | null
  promptResponseRatePct: number | null
}

interface WeeklyAdminSummaryEmailProps {
  weekOf: string
  programmeStats: ProgrammeStatRow[]
  redFlagNames: string[]
  redFlagTotal: number
  confidenceThisWeek: number | null
  confidenceLastWeek: number | null
  topQuotes: string[]
  dashboardUrl: string
}

const sectionHeading = { ...h1, fontSize: '17px', margin: '28px 0 10px' }
const row = { fontSize: '13px', color: '#0a1c26', lineHeight: '1.7', margin: 0 }
const quote = {
  fontSize: '13px',
  color: '#0a1c26',
  lineHeight: '1.6',
  margin: '0 0 10px',
  paddingLeft: '12px',
  borderLeft: '3px solid #3db4d0',
  fontStyle: 'italic' as const,
}

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n)}%`
}

export const WeeklyAdminSummaryEmail = ({
  weekOf,
  programmeStats,
  redFlagNames,
  redFlagTotal,
  confidenceThisWeek,
  confidenceLastWeek,
  topQuotes,
  dashboardUrl,
}: WeeklyAdminSummaryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Weekly programme summary — {weekOf}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="132" height="44" alt="Clariva" style={logo} />
        <Heading style={h1}>Weekly programme summary</Heading>
        <Text style={text}>Week of {weekOf}.</Text>

        <Section>
          <Text style={sectionHeading}>Engagement by programme</Text>
          {programmeStats.length === 0 ? (
            <Text style={row}>No active programmes this week.</Text>
          ) : (
            programmeStats.map((p) => (
              <Text style={row} key={p.programmeName}>
                <strong>{p.programmeName}</strong> ({p.enrolledCount} enrolled) — quiz {pct(p.quizCompletionPct)} ·
                {' '}reflection {pct(p.reflectionCompletionPct)} · triads {pct(p.triadCompletionPct)} · daily prompt{' '}
                {pct(p.promptResponseRatePct)}
              </Text>
            ))
          )}
        </Section>

        <Hr />

        <Section>
          <Text style={sectionHeading}>Red flags — 0 activity in the past 7 days</Text>
          <Text style={row}>{redFlagTotal} participant(s) flagged.</Text>
          {redFlagNames.length > 0 && <Text style={muted}>{redFlagNames.join(', ')}{redFlagTotal > redFlagNames.length ? ', …' : ''}</Text>}
        </Section>

        <Hr />

        <Section>
          <Text style={sectionHeading}>Confidence trend</Text>
          <Text style={row}>
            This week: {confidenceThisWeek != null ? confidenceThisWeek.toFixed(1) : '—'} / 10 · Last week:{' '}
            {confidenceLastWeek != null ? confidenceLastWeek.toFixed(1) : '—'} / 10
          </Text>
        </Section>

        {topQuotes.length > 0 && (
          <>
            <Hr />
            <Section>
              <Text style={sectionHeading}>Reflection highlights (anonymized)</Text>
              {topQuotes.map((q, i) => (
                <Text style={quote} key={i}>
                  “{q}”
                </Text>
              ))}
            </Section>
          </>
        )}

        <Text style={muted}>
          Full detail is on the <a href={dashboardUrl}>admin dashboard</a>. You're receiving this as a weekly
          automated summary for Clariva admins.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default WeeklyAdminSummaryEmail
