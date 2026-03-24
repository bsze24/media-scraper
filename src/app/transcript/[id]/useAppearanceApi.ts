"use client";

import { useState, useCallback } from "react";
import type { TranscriptViewerProps } from "./types";

type Appearance = TranscriptViewerProps["appearance"];
type Speaker = Appearance["speakers"][number];
type Turn = Appearance["turns"][number];
type PrepBullet = Appearance["prep_bullets"][number];

interface EntityTags {
  key_people?: Array<{ name: string; title: string; fund_affiliation: string }>;
  [key: string]: unknown;
}

/** Enrich raw speakers with title/affiliation from entity_tags.key_people */
function enrichSpeakers(
  rawSpeakers: Array<{ name: string; role: string; title?: string; affiliation?: string }>,
  entityTags: EntityTags
): Speaker[] {
  const kpMap = new Map<string, { title?: string; affiliation?: string }>();
  for (const p of entityTags.key_people ?? []) {
    kpMap.set(p.name.toLowerCase(), {
      title: p.title || undefined,
      affiliation: p.fund_affiliation || undefined,
    });
  }
  return rawSpeakers.map((s) => {
    const kp = kpMap.get(s.name.toLowerCase());
    return {
      name: s.name,
      role: s.role as Speaker["role"],
      title: s.title ?? kp?.title,
      affiliation: s.affiliation ?? kp?.affiliation,
    };
  });
}

function getAdminToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)admin_token=([^;]*)/);
  return match ? match[1] : null;
}

async function apiFetch(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  const token = getAdminToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, data, error: data.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

interface RenameResult {
  turnsUpdated: number;
  bulletsUpdated: number;
}

/** Convert raw DB turn_summaries array to the Record<number, string> the viewer expects */
function transformTurnSummaries(
  raw: unknown
): Appearance["turn_summaries"] {
  if (!raw || !Array.isArray(raw)) return null;
  return Object.fromEntries(
    raw.map((s: { turn_index: number; summary: string }) => [s.turn_index, s.summary])
  );
}

export function useAppearanceApi(appearanceId: string, initial: Appearance) {
  const [speakers, setSpeakers] = useState<Speaker[]>(initial.speakers);
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  const [turnSummaries, setTurnSummaries] = useState(initial.turn_summaries);
  const [prepBullets, setPrepBullets] = useState<PrepBullet[]>(
    initial.prep_bullets
  );
  const [hasInferredAttribution, setHasInferredAttribution] = useState(
    initial.has_inferred_attribution
  );
  // Cache entity_tags for enrichment after any speaker update.
  // Initialize from initial speakers so enrichment works before any rename.
  const [entityTags, setEntityTags] = useState<EntityTags>(() => ({
    key_people: initial.speakers
      .filter((s) => s.title || s.affiliation)
      .map((s) => ({
        name: s.name,
        title: s.title ?? "",
        fund_affiliation: s.affiliation ?? "",
      })),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const recomputeInferred = useCallback((updatedTurns: Turn[]) => {
    setHasInferredAttribution(
      updatedTurns.some(
        (t) => t.attribution === "inferred"
      )
    );
  }, []);

  const clearConfirmation = useCallback(() => setConfirmation(null), []);
  const clearError = useCallback(() => setError(null), []);

  const renameSpeaker = useCallback(
    async (
      oldName: string,
      newName: string
    ): Promise<RenameResult | null> => {
      if (!newName.trim()) return null;
      if (oldName === newName) return null;

      setSaving(true);
      setError(null);
      try {
        const { ok, data, error: apiError } = await apiFetch(
          `/api/appearances/${appearanceId}/rename-speaker`,
          { old_name: oldName, new_name: newName }
        );
        if (!ok) {
          setError(apiError ?? "Rename failed");
          return null;
        }
        if (data.no_op) return null;

        // Update state slices from response
        const rawEntityTags = data.entity_tags as EntityTags;
        setEntityTags(rawEntityTags);
        const newSpeakers = enrichSpeakers(
          data.speakers as Array<{ name: string; role: string; title?: string; affiliation?: string }>,
          rawEntityTags
        );
        const newTurns = data.turns as Turn[];
        setSpeakers(newSpeakers);
        setTurns(newTurns);
        setTurnSummaries(transformTurnSummaries(data.turn_summaries));

        // prep_bullets comes back as PrepBulletsData shape { bullets: [...] }
        const bulletData = data.prep_bullets as { bullets?: PrepBullet[] };
        setPrepBullets(bulletData.bullets ?? []);

        recomputeInferred(newTurns);

        const turnsUpdated = (data.turns_updated as number) ?? 0;
        const bulletsUpdated = (data.bullets_updated as number) ?? 0;
        setConfirmation(
          `Renamed ${oldName} → ${newName} (${turnsUpdated} turns, ${bulletsUpdated} quotes)`
        );
        setTimeout(() => setConfirmation(null), 4000);

        return { turnsUpdated, bulletsUpdated };
      } finally {
        setSaving(false);
      }
    },
    [appearanceId, recomputeInferred]
  );

  const updateSpeaker = useCallback(
    async (
      speakerName: string,
      fields: { role?: string; title?: string; affiliation?: string }
    ): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const { ok, data, error: apiError } = await apiFetch(
          `/api/appearances/${appearanceId}/set-speaker-role`,
          { speaker_name: speakerName, ...fields }
        );
        if (!ok) {
          setError(apiError ?? "Update failed");
          return false;
        }
        if (data.no_op) return true;
        const rawSpeakers = data.speakers as Array<{ name: string; role: string; title?: string; affiliation?: string }>;
        // Compute updated entityTags synchronously so enrichSpeakers
        // uses the fresh values (not the stale closure)
        let currentEntityTags = entityTags;
        if (fields.title !== undefined || fields.affiliation !== undefined) {
          const updated = { ...entityTags, key_people: [...(entityTags.key_people ?? [])] };
          const idx = updated.key_people!.findIndex(
            (p) => p.name.toLowerCase() === speakerName.toLowerCase()
          );
          const entry = {
            name: speakerName,
            title: fields.title ?? rawSpeakers.find((s) => s.name === speakerName)?.title ?? "",
            fund_affiliation: fields.affiliation ?? rawSpeakers.find((s) => s.name === speakerName)?.affiliation ?? "",
          };
          if (idx >= 0) updated.key_people![idx] = entry;
          else updated.key_people!.push(entry);
          currentEntityTags = updated;
          setEntityTags(updated);
        }
        const newSpeakers = enrichSpeakers(rawSpeakers, currentEntityTags);
        setSpeakers(newSpeakers);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [appearanceId, entityTags]
  );

  const correctTurn = useCallback(
    async (
      turnIndex: number,
      field: "speaker" | "text",
      oldValue: string,
      newValue: string
    ): Promise<boolean> => {
      if (!newValue.trim()) return false;
      if (oldValue === newValue) return false;

      setSaving(true);
      setError(null);
      try {
        const { ok, data, error: apiError } = await apiFetch(
          `/api/appearances/${appearanceId}/correct-turn`,
          { turn_index: turnIndex, field, old_value: oldValue, new_value: newValue }
        );
        if (!ok) {
          setError(apiError ?? "Correction failed");
          return false;
        }
        if (data.no_op) return true;
        const newTurns = data.turns as Turn[];
        setTurns(newTurns);
        recomputeInferred(newTurns);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [appearanceId, recomputeInferred]
  );

  return {
    speakers,
    turns,
    turnSummaries,
    prepBullets,
    hasInferredAttribution,
    saving,
    error,
    confirmation,
    clearError,
    clearConfirmation,
    renameSpeaker,
    updateSpeaker,
    correctTurn,
  };
}
