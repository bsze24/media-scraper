"use client";

import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type { TranscriptViewerProps } from "./types";
import { KBD_CLASS } from "./helpers";

type Speaker = TranscriptViewerProps["appearance"]["speakers"][number];

const ROLE_OPTIONS = ["host", "guest", "rowspace", "customer", "other"] as const;

export interface SpeakerPanelHandle {
  startEditing(speakerName: string, mode: 'rename' | 'meta'): void;
  cancelEditing(): boolean;
}

export interface SpeakerPanelProps {
  speakers: Speaker[];
  activeSpeaker: string | null;
  onSpeakerClick: (name: string) => void;
  hasInferredAttribution: boolean;
  saving: boolean;
  confirmation: string | null;
  apiError: string | null;
  clearConfirmation: () => void;
  clearError: () => void;
  onRenameSpeaker: (oldName: string, newName: string) => Promise<{ turnsUpdated: number; bulletsUpdated: number } | null>;
  onUpdateSpeaker: (speakerName: string, fields: { role?: string; title?: string; affiliation?: string }) => Promise<boolean>;
  onActiveSpeakerUpdate: (updater: (prev: string | null) => string | null) => void;
  showNumberBadges: boolean;
}

export const SpeakerPanel = forwardRef<SpeakerPanelHandle, SpeakerPanelProps>(function SpeakerPanel({
  speakers,
  activeSpeaker,
  onSpeakerClick,
  hasInferredAttribution,
  saving,
  confirmation,
  apiError,
  clearConfirmation,
  clearError,
  onRenameSpeaker,
  onUpdateSpeaker,
  onActiveSpeakerUpdate,
  showNumberBadges,
}, ref) {
  // Local editing state — only SpeakerPanel reads/writes these
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editingSpeakerName, setEditingSpeakerName] = useState("");
  const [editingSpeakerMeta, setEditingSpeakerMeta] = useState<string | null>(null);
  const [editingSpeakerMetaValue, setEditingSpeakerMetaValue] = useState("");
  const savingGuardRef = useRef(false);

  useImperativeHandle(ref, () => ({
    startEditing(speakerName: string, mode: 'rename' | 'meta') {
      if (mode === 'rename') {
        setEditingSpeaker(speakerName);
        setEditingSpeakerName(speakerName);
      } else {
        const speaker = speakers.find(s => s.name === speakerName);
        setEditingSpeakerMeta(speakerName);
        setEditingSpeakerMetaValue(
          [speaker?.title, speaker?.affiliation].filter(Boolean).join(", ")
        );
      }
    },
    cancelEditing() {
      if (editingSpeaker) {
        setEditingSpeaker(null);
        return true;
      }
      if (editingSpeakerMeta) {
        setEditingSpeakerMeta(null);
        return true;
      }
      return false;
    },
  }));

  const handleSpeakerRename = useCallback(
    async (oldName: string, newName: string) => {
      if (savingGuardRef.current) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) {
        setEditingSpeaker(null);
        return;
      }
      savingGuardRef.current = true;
      setEditingSpeaker(null);
      try {
        await onRenameSpeaker(oldName, trimmed);
        onActiveSpeakerUpdate((prev) => prev === oldName ? trimmed : prev);
      } finally {
        savingGuardRef.current = false;
      }
    },
    [onRenameSpeaker, onActiveSpeakerUpdate]
  );

  const handleRoleChange = useCallback(
    async (speakerName: string, role: string) => {
      await onUpdateSpeaker(speakerName, { role });
    },
    [onUpdateSpeaker]
  );

  const handleSpeakerMetaSave = useCallback(
    async (speakerName: string, currentTitle?: string, currentAffiliation?: string) => {
      if (savingGuardRef.current) return;
      const raw = editingSpeakerMetaValue.trim();
      savingGuardRef.current = true;
      setEditingSpeakerMeta(null);
      const commaIdx = raw.indexOf(",");
      let newTitle: string;
      let newAffiliation: string;
      if (commaIdx >= 0) {
        newTitle = raw.slice(0, commaIdx).trim();
        newAffiliation = raw.slice(commaIdx + 1).trim();
      } else {
        newTitle = raw;
        newAffiliation = "";
      }
      if (newTitle === (currentTitle ?? "") && newAffiliation === (currentAffiliation ?? "")) {
        savingGuardRef.current = false;
        return;
      }
      try {
        await onUpdateSpeaker(speakerName, { title: newTitle, affiliation: newAffiliation });
      } finally {
        savingGuardRef.current = false;
      }
    },
    [onUpdateSpeaker, editingSpeakerMetaValue]
  );

  return (
    <div className="px-3 py-3 border-b border-[#e5e3df]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#999]">Speakers</span>
        {hasInferredAttribution && (
          <span className="text-[9px] text-[#bbb] italic" title="Speaker labels were auto-generated and may not be accurate">
            (auto)
          </span>
        )}
      </div>
      {/* Confirmation / Error banners */}
      {confirmation && (
        <div className="mb-2 px-2 py-1.5 bg-green-50 border border-green-200 text-[11px] text-green-700 flex items-center justify-between">
          <span>{confirmation}</span>
          <button onClick={clearConfirmation} className="text-green-400 hover:text-green-600 ml-2">&times;</button>
        </div>
      )}
      {apiError && (
        <div className="mb-2 px-2 py-1.5 bg-red-50 border border-red-200 text-[11px] text-red-700 flex items-center justify-between">
          <span>{apiError}</span>
          <button onClick={clearError} className="text-red-400 hover:text-red-600 ml-2">&times;</button>
        </div>
      )}
      <div className="space-y-2">
        {speakers.map((s, idx) => {
          const isHost = s.role === "host" || s.role === "rowspace";
          const isEditing = editingSpeaker === s.name;

          return (
            <div
              key={s.name}
              className={`w-full p-2 border transition-colors ${
                isHost
                  ? activeSpeaker === s.name
                    ? 'bg-[#f5f4f2] border-[#ccc]'
                    : 'bg-[#f5f4f2] border-[#e5e3df] hover:border-[#ccc]'
                  : activeSpeaker === s.name
                  ? 'bg-white border-[#b8860b]/30'
                  : 'bg-white border-[#e5e3df] hover:border-[#b8860b]/30'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                {showNumberBadges && idx < 9 && (
                  <kbd className={`${KBD_CLASS} shrink-0`}>{idx + 1}</kbd>
                )}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingSpeakerName}
                    onChange={(e) => setEditingSpeakerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSpeakerRename(s.name, editingSpeakerName);
                      if (e.key === "Escape") { savingGuardRef.current = true; setEditingSpeaker(null); setTimeout(() => { savingGuardRef.current = false; }, 0); }
                    }}
                    onBlur={() => handleSpeakerRename(s.name, editingSpeakerName)}
                    disabled={saving}
                    className="flex-1 text-[12px] font-medium text-[#333] bg-white border border-[#b8860b]/50 px-1.5 py-0.5 outline-none focus:border-[#b8860b]"
                  />
                ) : (
                  <button
                    onClick={() => onSpeakerClick(s.name)}
                    className="flex-1 text-left"
                  >
                    <div className={`text-[12px] font-medium ${isHost ? 'text-[#555]' : activeSpeaker === s.name ? 'text-[#b8860b]' : 'text-[#555]'}`}>
                      {s.name}
                    </div>
                  </button>
                )}
                {!isEditing && (
                  <button
                    onClick={() => {
                      setEditingSpeaker(s.name);
                      setEditingSpeakerName(s.name);
                    }}
                    className="p-0.5 text-[#ccc] hover:text-[#888] transition-colors"
                    title="Rename speaker"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-1">
                {editingSpeakerMeta === s.name ? (
                  <input
                    autoFocus
                    value={editingSpeakerMetaValue}
                    onChange={(e) => setEditingSpeakerMetaValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSpeakerMetaSave(s.name, s.title, s.affiliation);
                      if (e.key === "Escape") { savingGuardRef.current = true; setEditingSpeakerMeta(null); setTimeout(() => { savingGuardRef.current = false; }, 0); }
                    }}
                    onBlur={() => handleSpeakerMetaSave(s.name, s.title, s.affiliation)}
                    disabled={saving}
                    placeholder="Title, Affiliation"
                    className="flex-1 text-[10px] text-[#888] bg-white border border-[#b8860b]/50 px-1.5 py-0.5 outline-none focus:border-[#b8860b]"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingSpeakerMeta(s.name);
                      setEditingSpeakerMetaValue(
                        [s.title, s.affiliation].filter(Boolean).join(", ")
                      );
                    }}
                    className="text-[10px] text-[#888] hover:text-[#b8860b] transition-colors text-left"
                  >
                    {[s.title, s.affiliation].filter(Boolean).join(", ") || (
                      <span className="text-[#ccc] italic">+ Add title</span>
                    )}
                  </button>
                )}
                <select
                  value={s.role}
                  onChange={(e) => handleRoleChange(s.name, e.target.value)}
                  disabled={saving}
                  className="text-[10px] text-[#999] bg-transparent border-none outline-none cursor-pointer hover:text-[#b8860b] transition-colors"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
