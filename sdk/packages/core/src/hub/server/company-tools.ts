import {
	createTool,
	type AgentTool,
	validateWithZod,
	zodToJsonSchema,
} from "@cline/shared";
import { z } from "zod";
import {
	CompanyStore,
	type CompanyMemoryKind,
	type CompanyMissionStatus,
} from "./company-store";

const ProfileInputSchema = z.object({
	action: z.enum(["get", "set"]),
	name: z.string().optional(),
	purpose: z.string().optional(),
	priorities: z.string().optional(),
});
const MemoryInputSchema = z.object({
	action: z.enum(["remember", "search", "list"]),
	kind: z.enum(["fact", "decision", "preference", "commitment", "note"]).optional(),
	subject: z.string().optional(),
	content: z.string().optional(),
	source: z.string().optional(),
	importance: z.number().int().min(1).max(5).optional(),
	query: z.string().optional(),
	limit: z.number().int().min(1).max(20).optional(),
});

const CapabilityInputSchema = z.object({
	action: z.enum(["list", "set"]),
	name: z.string().optional(),
	provider: z.string().optional(),
	status: z.enum(["available", "connected", "unavailable"]).optional(),
	details: z.string().optional(),
});
const MissionInputSchema = z.object({
	action: z.enum(["create", "update", "list"]),
	mission_id: z.string().optional(),
	title: z.string().optional(),
	goal: z.string().optional(),
	status: z.enum(["active", "blocked", "completed", "cancelled"]).optional(),
	next_action: z.string().optional(),
});

/** Native Hub tools: no external gateway or adapter process. */
export function createCompanyProfileTool(store: CompanyStore): AgentTool {
	return createTool({
		name: "company_profile",
		description:
			"Read or establish the durable company profile: name, purpose and current priorities. Set it when the user clearly establishes or corrects these facts so future Cline sessions start with the same company identity.",
		inputSchema: zodToJsonSchema(ProfileInputSchema),
		execute: async (input) => {
			const parsed = validateWithZod(ProfileInputSchema, input);
			if (parsed.action === "get") return store.getProfile();
			if (!parsed.name?.trim()) throw new Error("name is required when setting the company profile.");
			return store.setProfile({
				name: parsed.name,
				purpose: parsed.purpose,
				priorities: parsed.priorities,
			});
		},
	});
}
export function createCompanyMemoryTool(store: CompanyStore): AgentTool {
	return createTool({
		name: "company_memory",
		description:
			"Read and maintain durable company memory. Search before answering questions about the company, customers, decisions, commitments, priorities or preferences when remembered context could help. Remember only durable information the user establishes or work outcomes that remain useful across sessions.",
		inputSchema: zodToJsonSchema(MemoryInputSchema),
		execute: async (input) => {
			const parsed = validateWithZod(MemoryInputSchema, input);
			if (parsed.action === "list") return store.listMemories(parsed.limit);
			if (parsed.action === "search") return store.searchMemories(parsed.query ?? "", parsed.limit);
			if (!parsed.content?.trim()) throw new Error("content is required when remembering company memory.");
			return store.remember({
				kind: parsed.kind as CompanyMemoryKind | undefined,
				subject: parsed.subject,
				content: parsed.content,
				source: parsed.source ?? "chat",
				importance: parsed.importance,
			});
		},
	});
}

export function createCompanyMissionTool(store: CompanyStore): AgentTool {
	return createTool({
		name: "company_mission",
		description:
			"Create, update or list durable company missions. Use this for multi-step outcomes that should remain visible and resumable beyond the current chat. Record a concrete next action whenever one is known.",
		inputSchema: zodToJsonSchema(MissionInputSchema),
		execute: async (input) => {
			const parsed = validateWithZod(MissionInputSchema, input);
			if (parsed.action === "list") return store.listMissions();
			if (parsed.action === "update") {
				if (!parsed.mission_id?.trim()) throw new Error("mission_id is required when updating a mission.");
				return store.updateMission({
					missionId: parsed.mission_id,
					title: parsed.title,
					goal: parsed.goal,
					status: parsed.status as CompanyMissionStatus | undefined,
					nextAction: parsed.next_action,
				});
			}
			if (!parsed.title?.trim() || !parsed.goal?.trim()) {
				throw new Error("title and goal are required when creating a mission.");
			}
			return store.upsertMission({
				title: parsed.title,
				goal: parsed.goal,
				status: parsed.status as CompanyMissionStatus | undefined,
				nextAction: parsed.next_action,
			});
		},
	});
}
export function createCompanyCapabilitiesTool(store: CompanyStore): AgentTool {
	return createTool({
		name: "company_capabilities",
		description:
			"List the company capabilities and connected systems that are actually available in this Cline Hub. Use it before claiming access to a company system. Update a capability only after a real native integration becomes connected or unavailable.",
		inputSchema: zodToJsonSchema(CapabilityInputSchema),
		execute: async (input) => {
			const parsed = validateWithZod(CapabilityInputSchema, input);
			if (parsed.action === "list") return store.listCapabilities();
			if (!parsed.name?.trim() || !parsed.status) {
				throw new Error("name and status are required when updating a company capability.");
			}
			return store.upsertCapability({
				name: parsed.name,
				provider: parsed.provider,
				status: parsed.status,
				details: parsed.details,
			});
		},
	});
}