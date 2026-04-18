"use client";

import { useState } from "react";

interface ComposerProps {
  pendingInterrupt: boolean;
  onSendPrompt: (text: string) => void;
  onSteer: (text: string) => void;
  onInterrupt: () => void;
}

export function Composer({
  pendingInterrupt,
  onSendPrompt,
  onSteer,
  onInterrupt,
}: ComposerProps) {
  const [value, setValue] = useState("");

  const hasValue = value.trim().length > 0;

  return (
    <section
      aria-label="Session composer"
      style={{
        position: "sticky",
        bottom: "0",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        borderRadius: "24px 24px 0 0",
        background: "#E4DED4",
        borderTop: "1px solid #D7CEC0",
        boxShadow: "0 -12px 30px rgba(63, 55, 43, 0.08)",
      }}
    >
      <label
        htmlFor="session-composer"
        style={{
          fontSize: "14px",
          lineHeight: 1.35,
          fontWeight: 600,
          color: "#635541",
        }}
      >
        Steer the live turn or start a new prompt
      </label>

      <textarea
        id="session-composer"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Keep the current session moving from your phone."
        rows={value.length > 120 ? 5 : 3}
        style={{
          width: "100%",
          resize: "none",
          borderRadius: "18px",
          border: "1px solid #CBBEAD",
          padding: "16px",
          fontSize: "16px",
          lineHeight: 1.5,
          fontFamily: "inherit",
          color: "#1F1A14",
          background: "#F6F3ED",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "8px",
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (!hasValue) return;
            onSendPrompt(value.trim());
            setValue("");
          }}
          style={{
            minHeight: "44px",
            borderRadius: "999px",
            border: "1px solid #0F766E",
            background: hasValue ? "#0F766E" : "#C0D9D5",
            color: "#F6F3ED",
            fontSize: "14px",
            lineHeight: 1.35,
            fontWeight: 600,
          }}
        >
          Send Prompt
        </button>
        <button
          type="button"
          onClick={() => {
            if (!hasValue) return;
            onSteer(value.trim());
            setValue("");
          }}
          style={{
            minHeight: "44px",
            borderRadius: "999px",
            border: "1px solid #B8AE9F",
            background: "#F6F3ED",
            color: "#3F372B",
            fontSize: "14px",
            lineHeight: 1.35,
            fontWeight: 600,
          }}
        >
          Steer
        </button>
        <button
          type="button"
          onClick={onInterrupt}
          disabled={pendingInterrupt}
          style={{
            minHeight: "44px",
            borderRadius: "999px",
            border: "1px solid #B93815",
            background: pendingInterrupt ? "#F5CFC5" : "#FFF2EE",
            color: "#B93815",
            fontSize: "14px",
            lineHeight: 1.35,
            fontWeight: 600,
          }}
        >
          {pendingInterrupt ? "Interrupting..." : "Interrupt"}
        </button>
      </div>
    </section>
  );
}
