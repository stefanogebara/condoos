# CondoOS Agent Instructions

## Self-Audit Operating Rule

For every user prompt in this repository, explicitly ask internally before finishing:

- What is missing?
- What is untested?
- What could break in production, UX, CX, security, backend, frontend, architecture, data, deployment, or operations?
- Is there a permanent fix available instead of a workaround?
- Did I verify the change with the strongest practical test before shipping?

When the answer exposes a reasonable gap that can be closed in the current session, close it instead of leaving it as a dangling thread. Prefer complete fixes with tests, docs, and automation over partial workarounds.

## Project Standard

- Search before building.
- Test before shipping.
- Treat Playwright, server tests, production smoke checks, and ops drills as part of the product, not optional extras.
- Keep UI, UX, CX, backend, architecture, data integrity, deployment, observability, and security in scope during audits.
- Preserve unrelated user or cofounder changes; do not revert work you did not make.
