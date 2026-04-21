"use client";

import React from "react";
import type { TranscriptViewerProps } from "./types";
import { highlightText, highlightQuote, formatTimestamp, KBD_CLASS } from "./helpers";

type Turn = TranscriptViewerProps["appearance"]["turns"][number];
type Speaker = TranscriptViewerProps["appearance"]["speakers"][number];

export interface TurnRendererProps {
  turn: Turn;
  // Display state
  isExpanded: boolean;
  isActive: boolean;
  isTurnHit: boolean;
  isCitedTurn: boolean;
  isSpeakerFiltered: boolean;
  isHost: boolean;
  // Collapse
  collapsedText: string;
  collapsedIsSummary: boolean; // true = AI summary (no highlight), false = first sentence (highlight)
  canCollapse: boolean;
  onToggleExpanded: (turnIndex: number) => void;
  // Active turn
  onSetActive: (turnIndex: number) => void;
  // Playback
  onSeekToTime: (seconds: number) => void;
  // Speaker info
  speakerInfo: Speaker | undefined;
  // Editing text (null handlers = editing disabled, e.g. monologue)
  isEditingText: boolean;
  editingTextValue: string;
  onStartEditText: ((turnIndex: number, text: string) => void) | null;
  onSaveEditText: ((turnIndex: number, text: string) => void) | null;
  onCancelEditText: (() => void) | null;
  onEditTextChange: ((value: string) => void) | null;
  saving: boolean;
  // Speaker re-attribution (null = no dropdown support, e.g. monologue)
  showSpeakerDropdown: boolean;
  speakers: Speaker[] | null;
  allSpeakersGeneric: boolean;
  onTurnSpeakerChange: ((turnIndex: number, oldSpeaker: string, newSpeaker: string) => void) | null;
  onToggleSpeakerDropdown: ((turnIndex: number) => void) | null;
  onScrollToSpeakerPanel: (() => void) | null;
  // Search & quote highlight
  searchQuery: string;
  highlightedQuote: string | null;
  // Onboarding shortcut badges
  showShortcutBadges: boolean;
}

export const TurnRenderer = React.memo(function TurnRenderer({
  turn,
  isExpanded,
  isActive,
  isTurnHit,
  isCitedTurn,
  isSpeakerFiltered,
  isHost,
  collapsedText,
  collapsedIsSummary,
  canCollapse,
  onToggleExpanded,
  onSetActive,
  onSeekToTime,
  speakerInfo,
  isEditingText,
  editingTextValue,
  onStartEditText,
  onSaveEditText,
  onCancelEditText,
  onEditTextChange,
  saving,
  showSpeakerDropdown,
  speakers,
  allSpeakersGeneric,
  onTurnSpeakerChange,
  onToggleSpeakerDropdown,
  onScrollToSpeakerPanel,
  searchQuery,
  highlightedQuote,
  showShortcutBadges,
}: TurnRendererProps) {
  return (
    <div
      data-turn-index={turn.turn_index}
      onClick={() => onSetActive(turn.turn_index)}
      className={`group relative py-3 px-4 transition-all scroll-mt-20 border-l-[3px] ${
        isActive
          ? 'bg-[#b8860b]/5 border-[#b8860b]'
          : isTurnHit
          ? 'bg-[#eff6ff] border-[#5a8fc7]'
          : isCitedTurn
          ? 'bg-[#b8860b]/5 border-[#b8860b]/40'
          : isSpeakerFiltered
          ? 'border-[#6366f1]/40'
          : 'hover:bg-[#faf9f7] border-transparent'
      }`}
    >
      {/* Turn index (subtle, for debugging) */}
      <span className="absolute top-0.5 right-1 text-[9px] font-mono text-zinc-300 select-all" title={`Turn ${turn.turn_index}`}>
        {turn.turn_index}
      </span>

      {/* Header: timestamp + speaker name/title + cited badge */}
      <div className="flex items-baseline gap-3 mb-1">
        {turn.timestamp_seconds != null && (
          <button
            onClick={() => onSeekToTime(turn.timestamp_seconds!)}
            className="text-[10px] font-mono text-[#999] hover:text-[#b8860b] transition-colors flex-shrink-0"
            title="Jump to timestamp"
          >
            {formatTimestamp(turn.timestamp_seconds)}
          </button>
        )}
        {/* Speaker name — clickable for re-attribution if supported */}
        {onToggleSpeakerDropdown ? (
          <span className="relative">
            <button
              onClick={() => {
                if (allSpeakersGeneric && onScrollToSpeakerPanel) {
                  onScrollToSpeakerPanel();
                } else {
                  onToggleSpeakerDropdown(turn.turn_index);
                }
              }}
              className={`text-[13px] font-medium ${isHost ? 'text-[#666]' : 'text-[#b8860b]'} hover:underline`}
            >
              {turn.speaker}
            </button>
            {showSpeakerDropdown && !allSpeakersGeneric && speakers && onTurnSpeakerChange && (
              <div data-speaker-dropdown className="absolute left-0 top-full z-50 mt-1 bg-white border border-[#e5e3df] shadow-lg py-1 min-w-[140px]">
                {speakers.map((sp) => (
                  <button
                    key={sp.name}
                    onClick={() => onTurnSpeakerChange(turn.turn_index, turn.speaker, sp.name)}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f5f4f2] transition-colors ${
                      sp.name === turn.speaker ? 'text-[#b8860b] font-medium' : 'text-[#555]'
                    }`}
                  >
                    {sp.name}
                  </button>
                ))}
              </div>
            )}
          </span>
        ) : (
          <span className="text-[13px] font-medium text-[#b8860b]">
            {turn.speaker}
          </span>
        )}
        {speakerInfo && (
          <span className="text-[10px] text-[#999]">
            {[speakerInfo.title, speakerInfo.affiliation].filter(Boolean).join(", ")}
          </span>
        )}
        {isCitedTurn && (
          <span className="flex items-center gap-1 text-[9px] text-[#b8860b]/70">
            <span className="w-1 h-1 rounded-full bg-[#b8860b]" />
            cited
          </span>
        )}
        {showShortcutBadges && (
          <span className="hidden md:inline-flex items-center gap-2 ml-auto text-[10px] text-[#999]">
            <span className="inline-flex items-center gap-1"><kbd className={KBD_CLASS}>m</kbd> {isExpanded ? 'collapse' : 'expand'}</span>
            <span className="inline-flex items-center gap-1"><kbd className={KBD_CLASS}>x</kbd> hide</span>
            {turn.timestamp_seconds != null && (
              <span className="inline-flex items-center gap-1"><kbd className={KBD_CLASS}>t</kbd> jump</span>
            )}
          </span>
        )}
      </div>

      {/* Text content — with edit capability */}
      {isEditingText && onSaveEditText && onCancelEditText && onEditTextChange ? (
        <div>
          <textarea
            autoFocus
            value={editingTextValue}
            onChange={(e) => onEditTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancelEditText();
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                onSaveEditText(turn.turn_index, turn.text);
              }
            }}
            onBlur={() => onSaveEditText(turn.turn_index, turn.text)}
            disabled={saving}
            className="w-full text-[14px] leading-[1.6] text-[#333] bg-white border border-[#b8860b]/50 p-2 outline-none focus:border-[#b8860b] resize-none max-h-[300px] overflow-y-auto"
            rows={Math.min(10, Math.max(2, editingTextValue.split("\n").length))}
          />
          <div className="text-[10px] text-[#bbb] mt-1">Cmd+Enter to save, Escape to cancel</div>
        </div>
      ) : (
        <div className="relative group/text">
          <p className={`text-[14px] leading-[1.6] ${
            !isExpanded && isHost ? 'text-[#555] italic' : 'text-[#333]'
          }`}>
            {highlightedQuote && isExpanded
              ? highlightQuote(turn.text, highlightedQuote)
              : isExpanded || isTurnHit
              ? highlightText(turn.text, searchQuery)
              : collapsedIsSummary
              ? collapsedText
              : highlightText(collapsedText, searchQuery)
            }
            {canCollapse && !isTurnHit && (
              <button
                onClick={() => onToggleExpanded(turn.turn_index)}
                className="ml-1 text-[12px] text-[#b8860b] hover:underline transition-colors"
                title={isExpanded ? (collapsedIsSummary ? "Show summary" : "Show less") : "Show full text"}
              >
                {isExpanded ? "[less]" : "[more]"}
              </button>
            )}
          </p>
          {onStartEditText && (
            <button
              onClick={() => onStartEditText(turn.turn_index, turn.text)}
              className="absolute top-0 right-0 p-1 text-[#ccc] hover:text-[#888] opacity-0 group-hover/text:opacity-100 transition-opacity"
              title="Edit text"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
