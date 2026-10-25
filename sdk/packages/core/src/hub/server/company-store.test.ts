import { afterEach, describe, expect, it } from "vitest";
import { CompanyStore } from "./company-store";

const stores: CompanyStore[] = [];

function createStore(): CompanyStore {
	const store = new CompanyStore({ dbPath: ":memory:" });
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});

describe("CompanyStore", () => {
	it("persists company memory, missions and available capabilities in one Hub-owned store", () => {
		const store = createStore();
		store.setProfile({
			name: "Acme",
			purpose: "Make customer operations calmer.",
			priorities: "Renew the Northstar account.",
		});
		store.remember({
			kind: "decision",
			subject: "Northstar renewal",
			content: "Offer a three-month extension before the annual renewal.",
			source: "meeting-2026-10-24",
			importance: 5,
		});
		store.upsertMission({
			title: "Prepare Northstar review",
			goal: "Create the meeting brief and follow-up draft.",
			nextAction: "Read the latest customer emails.",
		});
		store.upsertCapability({
			name: "Google Workspace",
			provider: "google",
			status: "connected",
			details: "Gmail, Calendar and Drive",
		});

		expect(store.searchMemories("Northstar")).toHaveLength(1);
		const context = store.buildSystemContext();
		expect(context).toContain("Company: Acme");
		expect(context).toContain("Google Workspace (connected)");
		expect(context).toContain("Prepare Northstar review");
		expect(context).toContain("three-month extension");
	});

	it("updates a mission without losing its established goal", () => {
		const store = createStore();
		const mission = store.upsertMission({
			title: "Prepare customer review",
			goal: "Produce an evidence-backed renewal brief.",
			nextAction: "Read the account email thread.",
		});
		const updated = store.updateMission({
			missionId: mission.missionId,
			status: "blocked",
			nextAction: "Wait for the finance report.",
		});
		expect(updated.goal).toBe("Produce an evidence-backed renewal brief.");
		expect(updated.status).toBe("blocked");
		expect(updated.nextAction).toBe("Wait for the finance report.");
	});
	it("does not expose unavailable capabilities and includes a connected capability without a profile", () => {
		const store = createStore();
		store.upsertCapability({
			name: "Google Workspace",
			status: "connected",
		});
		store.upsertCapability({
			name: "Slack",
			status: "unavailable",
		});
		const context = store.buildSystemContext();
		expect(context).toContain("Google Workspace (connected)");
		expect(context).not.toContain("Slack");
	});
});