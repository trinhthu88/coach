// Shared Clariva brand styles for email templates.
// Email body background must always be white (#ffffff).
export const main = {
  backgroundColor: '#ffffff',
  fontFamily: "Montserrat, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  margin: 0,
  padding: 0,
}
export const container = {
  padding: '32px 28px',
  maxWidth: '560px',
}
export const h1 = {
  fontSize: '24px',
  fontWeight: '600' as const,
  color: '#0a1c26',
  margin: '0 0 20px',
  letterSpacing: '-0.01em',
}
export const text = {
  fontSize: '15px',
  color: '#0a1c26',
  lineHeight: '1.6',
  margin: '0 0 20px',
}
export const muted = {
  fontSize: '13px',
  color: '#5a6a72',
  lineHeight: '1.5',
  margin: '24px 0 0',
}
export const link = { color: '#3db4d0', textDecoration: 'underline' }
export const button = {
  backgroundColor: '#3db4d0',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  borderRadius: '10px',
  padding: '12px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
export const codeStyle = {
  fontFamily: "'SF Mono', Menlo, Consolas, monospace",
  fontSize: '24px',
  fontWeight: '600' as const,
  color: '#062f3e',
  letterSpacing: '0.18em',
  background: '#f6f3ee',
  padding: '14px 18px',
  borderRadius: '10px',
  display: 'inline-block',
  margin: '0 0 24px',
}
export const brand = {
  fontFamily: "'Fraunces', Georgia, 'Times New Roman', serif",
  fontWeight: '400' as const,
  fontSize: '20px',
  color: '#062f3e',
  margin: '0 0 28px',
}
export const brandAccent = {
  fontStyle: 'italic' as const,
  color: '#3db4d0',
}
export const footer = {
  fontSize: '12px',
  color: '#5a6a72',
  margin: '32px 0 0',
  borderTop: '1px solid #ece6da',
  paddingTop: '20px',
}
