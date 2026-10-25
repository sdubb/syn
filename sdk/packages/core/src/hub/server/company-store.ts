import { createSessionId } from "@cline/shared";
import { loadSqliteDb, nowIso, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import { join } from "node:path";

export type CompanyMemoryKind = "fact" | "decision" | "preference" | "commitment" | "note";
export type CompanyMissionStatus = "active" | "blocked" | "completed" | "cancelled";
export type CompanyCapabilityStatus = "available" | "connected" | "unavailable";

export type CompanyProfile = { name: string; purpose: string; priorities: string; updatedAt: string };
export type CompanyMemoryRecord = {
	memoryId: string;
	kind: CompanyMemoryKind;
	subject: string;
	content: string;
	source: string;
	importance: number;
	createdAt: string;
	updatedAt: string;
};
export type CompanyMissionRecord = {
	missionId: string;
	title: string;
	goal: string;
	status: CompanyMissionStatus;
	nextAction: string;
	createdAt: string;
	updatedAt: string;
};
export type CompanyCapabilityRecord = {
	capabilityId: string;
	name: string;
	provider: string;
	status: CompanyCapabilityStatus;
	details: string;
	updatedAt: string;
};
export type CompanyContextSnapshot = {
	profile?: CompanyProfile;
	memories: CompanyMemoryRecord[];
	missions: CompanyMissionRecord[];
	capabilities: CompanyCapabilityRecord[];
};

const PROFILE_ID = "company";
const MEMORY_KINDS = new Set<CompanyMemoryKind>(["fact", "decision", "preference", "commitment", "note"]);
const MISSION_STATUSES = new Set<CompanyMissionStatus>(["active", "blocked", "completed", "cancelled"]);
const CAPABILITY_STATUSES = new Set<CompanyCapabilityStatus>(["available", "connected", "unavailable"]);

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const trim = (value: string | undefined, fallback = ""): string => value?.trim() || fallback;
const numeric = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

function memoryFromRow(row: Record<string, unknown>): CompanyMemoryRecord {
	return {
		memoryId: text(row.memory_id),
		kind: text(row.kind) as CompanyMemoryKind,
		subject: text(row.subject),
		content: text(row.content),
		source: text(row.source),
		importance: numeric(row.importance),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
	};
}

function missionFromRow(row: Record<string, unknown>): CompanyMissionRecord {
	return {
		missionId: text(row.mission_id),
		title: text(row.title),
		goal: text(row.goal),
		status: text(row.status) as CompanyMissionStatus,
		nextAction: text(row.next_action),
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at),
	};
}

function capabilityFromRow(row: Record<string, unknown>): CompanyCapabilityRecord {
	return {
		capabilityId: text(row.capability_id),
		name: text(row.name),
		provider: text(row.provider),
		status: text(row.status) as CompanyCapabilityStatus,
		details: text(row.details),
		updatedAt: text(row.updated_at),
	};
}

/** Hub-owned company state. Cline itself is the company runtime. */
export class CompanyStore {
	private readonly db: SqliteDb;

	constructor(options: { dbPath?: string } = {}) {
		this.db = loadSqliteDb(options.dbPath ?? join(resolveDbDataDir(), "company.db"));
		this.ensureSchema();
	}

	close(): void {
		this.db.close?.();
	}

	private ensureSchema(): void {
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA busy_timeout = 5000;");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS company_profile (
				profile_id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				purpose TEXT NOT NULL DEFAULT '',
				priorities TEXT NOT NULL DEFAULT '',
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS company_memory (
				memory_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				subject TEXT NOT NULL DEFAULT '',
				content TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT '',
				importance INTEGER NOT NULL DEFAULT 3,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE VIRTUAL TABLE IF NOT EXISTS company_memory_fts USING fts5(memory_id UNINDEXED, subject, content, source);
			CREATE TABLE IF NOT EXISTS company_mission (
				mission_id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				goal TEXT NOT NULL,
				status TEXT NOT NULL,
				next_action TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS company_capability (
				capability_id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				provider TEXT NOT NULL DEFAULT 'native',
				status TEXT NOT NULL,
				details TEXT NOT NULL DEFAULT '',
				updated_at TEXT NOT NULL
			);
		`);
	}

	getProfile(): CompanyProfile | undefined {
		const row = this.db.prepare("SELECT name, purpose, priorities, updated_at FROM company_profile WHERE profile_id = ?").get(PROFILE_ID);
		return row
			? { name: text(row.name), purpose: text(row.purpose), priorities: text(row.priorities), updatedAt: text(row.updated_at) }
			: undefined;
	}

	setProfile(input: { name: string; purpose?: string; priorities?: string }): CompanyProfile {
		const name = trim(input.name);
		if (!name) throw new Error("Company name is required.");
		const updatedAt = nowIso();
		const profile = { name, purpose: trim(input.purpose), priorities: trim(input.priorities), updatedAt };
		this.db.prepare(`INSERT INTO company_profile (profile_id, name, purpose, priorities, updated_at)
			VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET
			name = excluded.name, purpose = excluded.purpose, priorities = excluded.priorities, updated_at = excluded.updated_at`).run(
			PROFILE_ID, profile.name, profile.purpose, profile.priorities, profile.updatedAt,
		);
		return profile;
	}

	remember(input: { memoryId?: string; kind?: CompanyMemoryKind; subject?: string; content: string; source?: string; importance?: number }): CompanyMemoryRecord {
		const content = trim(input.content);
		if (!content) throw new Error("Company memory content is required.");
		const kind = input.kind ?? "note";
		if (!MEMORY_KINDS.has(kind)) throw new Error("Unknown company memory kind.");
		const memoryId = trim(input.memoryId, createSessionId("memory_"));
		const subject = trim(input.subject);
		const source = trim(input.source, "chat");
		const importance = Math.max(1, Math.min(5, Math.round(input.importance ?? 3)));
		const now = nowIso();
		const existing = this.db.prepare("SELECT created_at FROM company_memory WHERE memory_id = ?").get(memoryId);
		const createdAt = existing ? text(existing.created_at) : now;
		this.db.prepare(`INSERT INTO company_memory (memory_id, kind, subject, content, source, importance, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET
			kind = excluded.kind, subject = excluded.subject, content = excluded.content, source = excluded.source,
			importance = excluded.importance, updated_at = excluded.updated_at`).run(
			memoryId, kind, subject, content, source, importance, createdAt, now,
		);
		this.db.prepare("DELETE FROM company_memory_fts WHERE memory_id = ?").run(memoryId);
		this.db.prepare("INSERT INTO company_memory_fts (memory_id, subject, content, source) VALUES (?, ?, ?, ?)").run(memoryId, subject, content, source);
		return { memoryId, kind, subject, content, source, importance, createdAt, updatedAt: now };
	}

	listMemories(limit = 20): CompanyMemoryRecord[] {
		return this.db.prepare("SELECT * FROM company_memory ORDER BY importance DESC, updated_at DESC LIMIT ?")
			.all(Math.max(1, Math.min(100, Math.trunc(limit)))).map(memoryFromRow);
	}

	searchMemories(query: string, limit = 8): CompanyMemoryRecord[] {
		const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
		const needle = trim(query);
		if (!needle) return this.listMemories(safeLimit);
		try {
			const hits = this.db.prepare(`SELECT m.* FROM company_memory_fts f JOIN company_memory m ON m.memory_id = f.memory_id
				WHERE company_memory_fts MATCH ? ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`).all(needle, safeLimit);
			if (hits.length) return hits.map(memoryFromRow);
		} catch {
			// Natural language is not always valid FTS5 syntax; fall through to LIKE.
		}
		return this.db.prepare(`SELECT * FROM company_memory WHERE subject LIKE ? OR content LIKE ? OR source LIKE ?
			ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(`%${needle}%`, `%${needle}%`, `%${needle}%`, safeLimit).map(memoryFromRow);
	}

	upsertMission(input: { missionId?: string; title: string; goal: string; status?: CompanyMissionStatus; nextAction?: string }): CompanyMissionRecord {
		const title = trim(input.title);
		const goal = trim(input.goal);
		if (!title || !goal) throw new Error("Mission title and goal are required.");
		const status = input.status ?? "active";
		if (!MISSION_STATUSES.has(status)) throw new Error("Unknown mission status.");
		const missionId = trim(input.missionId, createSessionId("mission_"));
		const nextAction = trim(input.nextAction);
		const now = nowIso();
		const existing = this.db.prepare("SELECT created_at FROM company_mission WHERE mission_id = ?").get(missionId);
		const createdAt = existing ? text(existing.created_at) : now;
		this.db.prepare(`INSERT INTO company_mission (mission_id, title, goal, status, next_action, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mission_id) DO UPDATE SET
			title = excluded.title, goal = excluded.goal, status = excluded.status, next_action = excluded.next_action, updated_at = excluded.updated_at`).run(
			missionId, title, goal, status, nextAction, createdAt, now,
		);
		return { missionId, title, goal, status, nextAction, createdAt, updatedAt: now };
	}

	getMission(missionId: string): CompanyMissionRecord | undefined {
		const id = trim(missionId);
		if (!id) return undefined;
		const row = this.db.prepare("SELECT * FROM company_mission WHERE mission_id = ?").get(id);
		return row ? missionFromRow(row) : undefined;
	}

	updateMission(input: {
		missionId: string;
		title?: string;
		goal?: string;
		status?: CompanyMissionStatus;
		nextAction?: string;
	}): CompanyMissionRecord {
		const existing = this.getMission(input.missionId);
		if (!existing) throw new Error("Mission was not found.");
		return this.upsertMission({
			missionId: existing.missionId,
			title: input.title?.trim() || existing.title,
			goal: input.goal?.trim() || existing.goal,
			status: input.status ?? existing.status,
			nextAction: input.nextAction ?? existing.nextAction,
		});
	}
	listMissions(limit = 12): CompanyMissionRecord[] {
		return this.db.prepare("SELECT * FROM company_mission WHERE status IN ('active', 'blocked') ORDER BY updated_at DESC LIMIT ?")
			.all(Math.max(1, Math.min(100, Math.trunc(limit)))).map(missionFromRow);
	}

	upsertCapability(input: { name: string; provider?: string; status: CompanyCapabilityStatus; details?: string }): CompanyCapabilityRecord {
		const name = trim(input.name);
		if (!name) throw new Error("Capability name is required.");
		if (!CAPABILITY_STATUSES.has(input.status)) throw new Error("Unknown capability status.");
		const provider = trim(input.provider, "native");
		const details = trim(input.details);
		const now = nowIso();
		const existing = this.db.prepare("SELECT capability_id FROM company_capability WHERE name = ?").get(name);
		const capabilityId = existing ? text(existing.capability_id) : createSessionId("capability_");
		this.db.prepare(`INSERT INTO company_capability (capability_id, name, provider, status, details, updated_at)
			VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET
			provider = excluded.provider, status = excluded.status, details = excluded.details, updated_at = excluded.updated_at`).run(
			capabilityId, name, provider, input.status, details, now,
		);
		return { capabilityId, name, provider, status: input.status, details, updatedAt: now };
	}

	listCapabilities(): CompanyCapabilityRecord[] {
		return this.db.prepare("SELECT * FROM company_capability ORDER BY name ASC").all().map(capabilityFromRow);
	}

	snapshot(): CompanyContextSnapshot {
		return {
			profile: this.getProfile(),
			memories: this.listMemories(8),
			missions: this.listMissions(8),
			capabilities: this.listCapabilities().filter((item) => item.status !== "unavailable"),
		};
	}

	buildSystemContext(): string {
		const snapshot = this.snapshot();
		if (!snapshot.profile && !snapshot.memories.length && !snapshot.missions.length && !snapshot.capabilities.length) return "";
		const lines = ["<company-context>"];
		if (snapshot.profile) {
			lines.push(`Company: ${snapshot.profile.name}`);
			if (snapshot.profile.purpose) lines.push(`Purpose: ${snapshot.profile.purpose}`);
			if (snapshot.profile.priorities) lines.push(`Priorities: ${snapshot.profile.priorities}`);
		}
		if (snapshot.capabilities.length) lines.push(`Available company capabilities: ${snapshot.capabilities.map((item) => `${item.name} (${item.status})`).join(", ")}`);
		if (snapshot.missions.length) {
			lines.push("Active missions:");
			for (const mission of snapshot.missions) lines.push(`- ${mission.title}: ${mission.goal}${mission.nextAction ? ` Next: ${mission.nextAction}` : ""}`);
		}
		if (snapshot.memories.length) {
			lines.push("Durable memory:");
			for (const memory of snapshot.memories) lines.push(`- [${memory.kind}] ${memory.subject ? `${memory.subject}: ` : ""}${memory.content}`);
		}
		lines.push("Use company_memory before answering company-specific questions when stored context may help. Remember durable facts, decisions, commitments, preferences and mission outcomes with source 'chat'. Do not claim unavailable capabilities are connected.", "</company-context>");
		return lines.join("\n");
	}
}