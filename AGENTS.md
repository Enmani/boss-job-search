# Development

- Node.js 24+. Install dependencies in `plugin/`; run `npm run precheck` at the repository root.
- Keep each code file below 500 lines. Validate inputs at process, browser and storage boundaries.
- Never commit resumes, databases, login data, bridge credentials or local diagnostic logs.
- Fixtures are synthetic. Passing fixtures does not prove a live BOSS session works.
- Page failures, login gates and verification cannot be reported as an empty search.
- Progress records do not send messages or applications. Preserve existing history when refreshing jobs.
- Update the relevant documentation when changing setup, recovery or runtime behavior.
