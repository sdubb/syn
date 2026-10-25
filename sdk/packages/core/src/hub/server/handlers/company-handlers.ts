import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	CompanyStore,
	type CompanyCapabilityStatus,
	type CompanyMemoryKind,
	type CompanyMissionStatus,
} from "../company-store";
import { errorReply, okReply } from "./context";

function payloadRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Handles company data entirely inside the Cline Hub transport. */
export function handleCompanyCommand(
	store: CompanyStore,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope | undefined {
	const payload = payloadRecord(envelope.payload);
	try {
		switch (envelope.command) {
			case "company.bootstrap":
				return okReply(envelope, { company: store.snapshot() });
			case "company.profile.get":
				return okReply(envelope, { profile: store.getProfile() });
			case "company.profile.update":
				return okReply(envelope, {
					profile: store.setProfile({
						name: asString(payload.name) ?? "",
						purpose: asString(payload.purpose),
						priorities: asString(payload.priorities),
					}),
				});
			case "company.memory.list":
				return okReply(envelope, { memories: store.listMemories(asNumber(payload.limit)) });
			case "company.memory.search":
				return okReply(envelope, { memories: store.searchMemories(asString(payload.query) ?? "", asNumber(payload.limit)) });
			case "company.memory.upsert":
				return okReply(envelope, {
					memory: store.remember({
						memoryId: asString(payload.memoryId),
						kind: asString(payload.kind) as CompanyMemoryKind | undefined,
						subject: asString(payload.subject),
						content: asString(payload.content) ?? "",
						source: asString(payload.source),
						importance: asNumber(payload.importance),
					}),
				});
			case "company.mission.list":
				return okReply(envelope, { missions: store.listMissions(asNumber(payload.limit)) });
			case "company.mission.upsert": {
				const missionId = asString(payload.missionId);
				return okReply(envelope, {
					mission: missionId
						? store.updateMission({
							missionId,
							title: asString(payload.title),
							goal: asString(payload.goal),
							status: asString(payload.status) as CompanyMissionStatus | undefined,
							nextAction: asString(payload.nextAction),
						})
						: store.upsertMission({
							title: asString(payload.title) ?? "",
							goal: asString(payload.goal) ?? "",
							status: asString(payload.status) as CompanyMissionStatus | undefined,
							nextAction: asString(payload.nextAction),
						}),
				});
			}
			case "company.capability.list":
				return okReply(envelope, { capabilities: store.listCapabilities() });
			case "company.capability.upsert":
				return okReply(envelope, {
					capability: store.upsertCapability({
						name: asString(payload.name) ?? "",
						provider: asString(payload.provider),
						status: (asString(payload.status) ?? "unavailable") as CompanyCapabilityStatus,
						details: asString(payload.details),
					}),
				});
			default:
				return undefined;
		}
	} catch (error) {
		return errorReply(
			envelope,
			"company_command_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}