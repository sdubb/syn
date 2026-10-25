# Company intelligence in Cline Hub

This Phase One capability is part of Cline Hub itself. It does not add a separate backend, adapter process, or a desktop UI surface.

Every new Hub session receives the company profile, the most relevant durable memory, active missions, and the capabilities that are actually connected. Scheduled Hub sessions use the same session creation path, so a recurring responsibility begins with this context too.

The agent receives four native Hub tools:

- `company_profile` — establish or read the company name, purpose, and current priorities.
- `company_memory` — save and search durable decisions, commitments, customer facts, and preferences.
- `company_mission` — create, resume, block, complete, and update multi-step company outcomes.
- `company_capabilities` — inspect the systems and hands currently connected to this Hub.

Company state is stored in Cline's existing data root at `~/.cline/data/db/company.db`.

## Native Google Workspace hand

When the Hub process has Google credentials, it registers the native `google_workspace` tool and reports Google Workspace as connected. The tool makes direct Google REST API calls from Cline Hub; it does not use a connector proxy or a separate service.

Configure one of these before starting the Hub:

```text
GOOGLE_WORKSPACE_ACCESS_TOKEN=<access-token>
```

or:

```text
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
GOOGLE_OAUTH_REFRESH_TOKEN=<refresh-token>
```

With a credential present, the agent can search and inspect Gmail, create and send Gmail messages, list primary Calendar events, and search Drive. The Google OAuth client must be authorized for the corresponding Google APIs.

## Autonomous work

Cline's existing native local runtime remains the physical body: file system, terminal, editor, browser, and Git tools. Its existing scheduled-task facility remains the recurring-work mechanism. Company intelligence supplies the durable identity, memory, missions, and connected-system awareness that those sessions need to act as one continuing company assistant rather than isolated chats.