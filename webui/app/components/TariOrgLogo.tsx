import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

const brandRgb = "244, 66, 80"; // #F44250 — Tari red
const displayFont =
  '"Space Grotesk", "Inter", "Roboto", "Helvetica", "Arial", sans-serif';

const sizes = {
  small: { icon: 20, fontSize: "1rem", gap: 1 },
  medium: { icon: 28, fontSize: "1.5rem", gap: 1.25 },
} as const;

export function TariOrgLogo({
  size = "medium",
}: {
  size?: keyof typeof sizes;
}) {
  const { icon, fontSize, gap } = sizes[size];

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap }}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="16"
          cy="16"
          r="11.5"
          fill="none"
          stroke={`rgb(${brandRgb})`}
          strokeWidth="7"
        />
      </svg>
      <Typography
        component="span"
        sx={{
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.025em",
          color: "text.primary",
        }}
      >
        tari
        <Box component="span" sx={{ color: "primary.main" }}>
          org
        </Box>
      </Typography>
    </Box>
  );
}
