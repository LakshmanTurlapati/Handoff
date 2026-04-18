interface JumpToLiveProps {
  onClick: () => void;
}

export function JumpToLive({ onClick }: JumpToLiveProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        alignSelf: "flex-start",
        minHeight: "44px",
        borderRadius: "999px",
        border: "1px solid #0F766E",
        background: "#0F766E",
        color: "#F6F3ED",
        padding: "10px 16px",
        fontSize: "14px",
        lineHeight: 1.35,
        fontWeight: 600,
      }}
    >
      Jump to live
    </button>
  );
}
