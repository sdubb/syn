import {
	createTool,
	type AgentTool,
	validateWithZod,
	zodToJsonSchema,
} from "@cline/shared";
import { Buffer } from "node:buffer";
import { z } from "zod";

const GoogleWorkspaceInputSchema = z.object({
	action: z.enum([
		"gmail_search",
		"gmail_get_message",
		"gmail_create_draft",
		"gmail_send",
		"calendar_list_events",
		"drive_search",
	]),
	query: z.string().optional(),
	message_id: z.string().optional(),
	to: z.string().optional(),
	subject: z.string().optional(),
	body: z.string().optional(),
	max_results: z.number().int().min(1).max(25).optional(),
	time_min: z.string().datetime().optional(),
	time_max: z.string().datetime().optional(),
});

type GoogleFetch = typeof fetch;

function configured(): boolean {
	return Boolean(
		process.env.GOOGLE_WORKSPACE_ACCESS_TOKEN?.trim() ||
		(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
			process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
			process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim()),
	);
}

async function accessToken(fetchImpl: GoogleFetch): Promise<string> {
	const direct = process.env.GOOGLE_WORKSPACE_ACCESS_TOKEN?.trim();
	if (direct) return direct;
	const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
	const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
	const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error(
			"Google Workspace is not configured. Set GOOGLE_WORKSPACE_ACCESS_TOKEN, or GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN.",
		);
	}
	const response = await fetchImpl("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});
	const body = (await response.json()) as { access_token?: unknown; error_description?: unknown };
	if (!response.ok || typeof body.access_token !== "string") {
		throw new Error(`Google token refresh failed: ${typeof body.error_description === "string" ? body.error_description : response.statusText}`);
	}
	return body.access_token;
}

async function googleJson(fetchImpl: GoogleFetch, url: string, init?: RequestInit): Promise<unknown> {
	const token = await accessToken(fetchImpl);
	const response = await fetchImpl(url, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			...(init?.headers ?? {}),
		},
	});
	const body = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message = body && typeof body === "object" && "error" in body
			? JSON.stringify((body as { error: unknown }).error)
			: response.statusText;
		throw new Error(`Google Workspace request failed (${response.status}): ${message}`);
	}
	return body;
}

function url(base: string, values: Record<string, string | number | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== "") query.set(key, String(value));
	}
	const encoded = query.toString();
	return encoded ? `${base}?${encoded}` : base;
}

function draftMessage(to: string, subject: string, body: string): string {
	const message = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
	return Buffer.from(message).toString("base64url");
}

/** Direct Google REST calls from the Cline Hub. No connector proxy or MCP process. */
export function createGoogleWorkspaceTool(fetchImpl: GoogleFetch = fetch): AgentTool {
	return createTool({
		name: "google_workspace",
		description:
			"Use the configured native Google Workspace account to search Gmail, inspect messages, list Calendar events, search Drive, create Gmail drafts, and send Gmail. Use these capabilities to carry out company work and verify facts from the connected account before relying on them.",
		inputSchema: zodToJsonSchema(GoogleWorkspaceInputSchema),
		execute: async (input) => {
			const parsed = validateWithZod(GoogleWorkspaceInputSchema, input);
			const maxResults = parsed.max_results ?? 10;
			switch (parsed.action) {
				case "gmail_search":
					return googleJson(fetchImpl, url("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
						q: parsed.query ?? "", maxResults,
					}));
				case "gmail_get_message":
					if (!parsed.message_id?.trim()) throw new Error("message_id is required for gmail_get_message.");
					return googleJson(fetchImpl, url(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(parsed.message_id)}`, {
						format: "full",
					}));
				case "calendar_list_events":
					return googleJson(fetchImpl, url("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
						singleEvents: "true", orderBy: "startTime", timeMin: parsed.time_min ?? new Date().toISOString(), timeMax: parsed.time_max, maxResults,
					}));
				case "drive_search":
					return googleJson(fetchImpl, url("https://www.googleapis.com/drive/v3/files", {
						q: parsed.query ?? "trashed = false", pageSize: maxResults,
						fields: "files(id,name,mimeType,modifiedTime,webViewLink,description,owners(displayName,emailAddress))",
					}));
				case "gmail_create_draft":
				case "gmail_send": {
					if (!parsed.to?.trim() || !parsed.subject?.trim() || !parsed.body?.trim()) {
						throw new Error(`to, subject and body are required for ${parsed.action}.`);
					}
					const endpoint = parsed.action === "gmail_send"
						? "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
						: "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
					const payload = parsed.action === "gmail_send"
						? { raw: draftMessage(parsed.to, parsed.subject, parsed.body) }
						: { message: { raw: draftMessage(parsed.to, parsed.subject, parsed.body) } };
					return googleJson(fetchImpl, endpoint, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload),
					});
				}
			}
		},
	});
}

export function isGoogleWorkspaceConfigured(): boolean {
	return configured();
}