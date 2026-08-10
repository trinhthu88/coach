/**
 * A session can only be marked complete once the coachee's side of the
 * record exists: their written reflection (regular sessions) or their ICF
 * competency feedback (peer sessions). Extracted from SessionDetail.tsx so
 * the rule can be unit tested independently of rendering the page.
 */
export function canMarkSessionComplete(opts: {
  isPeer: boolean;
  coacheeNotes: string;
  peerFeedbackExisted: boolean;
}): boolean {
  return opts.isPeer ? opts.peerFeedbackExisted : opts.coacheeNotes.trim().length > 0;
}
