# Working in Tech Event Discover

- **[R1-MUST]** Before changing code, read PROJECT_CONTEXT.md, ARCHITECTURE.md and the current phase and gate in ROADMAP.md. The four root documents govern implementation once the owner approves Phase 0.
- **[R1-MUST]** Work only in the approved phase and tier. Keep R2-MUST and LATER-HARDENING out of R1 code, migrations and configuration. Stop at each release gate for the evidence it specifies.
- **[R1-MUST]** Use strict TypeScript, generated database types, versioned SQL migrations and Zod at every input boundary. Keep privileged clients server-only. Curator handlers use the verified user's session for guarded SQL RPCs.
- **[R1-MUST]** Build accessible components. Check keyboard navigation, focus, labels and narrow-screen reflow. Reuse existing domain rules and keep route handlers thin.
- **[R1-MUST]** Render curator, provider and feed content as escaped plain text. Redact emails, OTPs, credentials, feed URLs, invite and unsubscribe tokens, and raw provider payloads from logs. Use opaque IDs, counts, timestamps and safe error codes.
- **[R1-MUST]** Never commit secrets. Use placeholders in .env.example. Never scrape LinkedIn, Unstop or Internshala or use undocumented endpoints or authenticated automation against them.
- **[R1-MUST]** Ask the owner before changing product scope, permissions for a source, reminder behavior or deployment architecture. Update the document that owns a changed decision in the same change and record the reason in ROADMAP.md.
- **[R2-MUST]** Keep reminder eligibility in src/features/reminders/eligibility.ts and the SQL eligibility function it calls. Run both against the same versioned truth-table fixtures with an explicit test clock. Recheck eligibility at the provider boundary.
- **[LATER-HARDENING]** Start deferred work only after the owner approves a later scope.
