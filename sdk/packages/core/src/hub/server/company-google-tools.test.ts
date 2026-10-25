import { afterEach, describe, expect, it } from "vitest";
import { createGoogleWorkspaceTool } from "./company-google-tools";

const originalToken = process.env.GOOGLE_WORKSPACE_ACCESS_TOKEN;

afterEach(() => {
	if (originalToken === undefined) delete process.env.GOOGLE_WORKSPACE_ACCESS_TOKEN;
	else process.env.GOOGLE_WORKSPACE_ACCESS_TOKEN = originalToken;
});

describe("google_workspace", () => {
	it("uses the configured native Google credential for Gmail search", async () => {
		process.env.GOOGLE_WORKSPACE_ACCESS_TOKEN = "test-token";
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = (async (input: unknown, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return Response.json({ messages: [] });
		}) as unknown as typeof fetch;
		const tool = createGoogleWorkspaceTool(fetchImpl);

		await expect(
			tool.execute({ action: "gmail_search", query: "label:inbox", max_results: 5 }, {} as never),
		).resolves.toEqual({ messages: [] });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain("gmail.googleapis.com/gmail/v1/users/me/messages");
		expect(calls[0].url).toContain("q=label%3Ainbox");
		expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer test-token" });
	});
});