import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import ListItemButton from "@mui/material/ListItemButton";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { Outlet, useNavigate, Link, useLocation } from "react-router";
import { Stack, Typography, useMediaQuery } from "@mui/material";
import {
  Add,
  ArrowForward,
  Menu as MenuIcon,
  Search,
} from "@mui/icons-material";
import { useOrganizationStore } from "@/lib/orgs-store";
import { useEffect, useState, type FormEvent } from "react";
import { OrgAvatar } from "./components/OrgAvatar";
import { TariOrgLogo } from "./components/TariOrgLogo";
import { AccountButton } from "./components/AccountButton";
import { APP_BAR_HEIGHT } from "./constants";

// Tari brand palette
const BRAND_PRIMARY = "#F44250"; // Tari red
const BRAND_SECONDARY = "#121212"; // Tari ink

// Common typography settings
const fontStack = '"Inter", "Roboto", "Helvetica", "Arial", sans-serif';
const displayFontStack =
  '"Space Grotesk", "Inter", "Roboto", "Helvetica", "Arial", sans-serif';

// Light Theme Configuration
const lightTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: true,
  },
  palette: {
    mode: "light",
    primary: {
      main: BRAND_PRIMARY,
      light: "#ff6b75",
      dark: "#c22e3b",
      contrastText: "#ffffff",
    },
    secondary: {
      main: BRAND_SECONDARY,
      light: "#3a3a3a",
      dark: "#000000",
      contrastText: "#ffffff",
    },
    background: {
      default: "#fafafa", // Very light grey, softer than pure white
      paper: "#ffffff",
    },
    text: {
      primary: "#121212",
      secondary: "#5f6368",
    },
    divider: "#e6e6e6",
  },
  typography: {
    fontFamily: fontStack,
    h1: {
      fontFamily: displayFontStack,
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: displayFontStack,
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h3: { fontFamily: displayFontStack, fontWeight: 600 },
    h4: { fontFamily: displayFontStack, fontWeight: 600 },
    button: {
      textTransform: "none", // Modern apps rarely use all-caps buttons
      fontWeight: 600,
      fontSize: "0.9rem",
    },
    body1: { letterSpacing: "0.01em" },
  },
  shape: {
    borderRadius: 12, // Softer, more modern corners
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0px 4px 12px rgba(244, 66, 80, 0.2)", // Subtle glow on hover
          },
        },
        contained: {
          transition: "all 0.2s ease-in-out",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: "0px 4px 20px rgba(0, 0, 0, 0.05)",
          border: "1px solid rgba(0,0,0,0.04)",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            "& fieldset": { borderColor: "#e0e0e0" },
            "&:hover fieldset": { borderColor: BRAND_PRIMARY },
            "&.Mui-focused fieldset": {
              borderColor: BRAND_PRIMARY,
              borderWidth: 2,
            },
          },
        },
      },
    },
  },
});

// Dark Theme Configuration
const darkTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    dark: true,
  },
  palette: {
    mode: "dark",
    primary: {
      main: BRAND_PRIMARY,
      light: "#ff6b75",
      dark: "#c22e3b",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#f5f5f7", // Inverted ink for dark mode visibility
      light: "#ffffff",
      dark: "#d6d6d9",
      contrastText: "#121212",
    },
    background: {
      default: "#0c0c0e", // Deep black/grey
      paper: "#141416", // Slightly lighter for cards
    },
    text: {
      primary: "#ffffff",
      secondary: "#b0b3b8",
    },
    divider: "#2a2a2d",
  },
  typography: {
    fontFamily: fontStack,
    h1: {
      fontFamily: displayFontStack,
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: displayFontStack,
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h3: { fontFamily: displayFontStack, fontWeight: 600 },
    h4: { fontFamily: displayFontStack, fontWeight: 600 },
    button: {
      textTransform: "none",
      fontWeight: 600,
      fontSize: "0.9rem",
    },
    body1: { letterSpacing: "0.01em" },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0px 4px 12px rgba(244, 66, 80, 0.4)", // Stronger glow in dark mode
          },
        },
        contained: {
          transition: "all 0.2s ease-in-out",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.4)",
          border: "1px solid rgba(255,255,255,0.08)",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            "& fieldset": { borderColor: "#444" },
            "&:hover fieldset": { borderColor: BRAND_PRIMARY },
            "&.Mui-focused fieldset": {
              borderColor: BRAND_PRIMARY,
              borderWidth: 2,
            },
          },
        },
      },
    },
  },
});

// Helper hook example (optional, if you need it later)
/*
import { useMemo } from 'react';
import { useMediaQuery } from '@mui/material';

export function useAppTheme() {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => (prefersDarkMode ? darkModeTheme : lightModeTheme), [prefersDarkMode]);
  return theme;
}
*/

export default function Navigation() {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  return (
    <ThemeProvider theme={prefersDarkMode ? darkTheme : lightTheme}>
      <CssBaseline />
      <NavDrawer />
    </ThemeProvider>
  );
}

const drawerWidth = 256;
const brandRgb = "244, 66, 80"; // #F44250 — Tari red

function NavDrawer() {
  const organizationsFollowed = useOrganizationStore();
  const [viewTarget, setViewTarget] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  let currentOrg = location.pathname.startsWith("/org/")
    ? location.pathname.slice("/org/".length)
    : "";
  if (currentOrg !== "" && !currentOrg.startsWith("component_")) {
    currentOrg = `component_${currentOrg}`;
  }

  const handleView = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = viewTarget.trim();
    if (target) {
      navigate(`/org/${target}`);
    }
  };

  const handleDrawerToggle = () => setMobileOpen((open) => !open);

  // Close the temporary drawer after navigating (e.g. tapping a nav link).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const organizations = Object.entries(organizationsFollowed.organizations);

  const drawer = (
    <>
      <Box sx={{ height: `${APP_BAR_HEIGHT}px` }} />
      <Box
        sx={{
          p: 2,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
        }}
      >
        <Button
          variant="contained"
          startIcon={<Add />}
          component={Link}
          to="/new-org"
          fullWidth
        >
          New organization
        </Button>

        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 1,
          }}
        >
          <Typography
            variant="overline"
            sx={{
              color: "text.secondary",
              fontWeight: 600,
              letterSpacing: "0.08em",
              lineHeight: 1,
            }}
          >
            Organizations
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {organizations.length}
          </Typography>
        </Stack>

        {organizations.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
            No organizations yet.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {organizations.map(([orgId]) => {
              const shortId = orgId.slice("component_".length);
              const active = orgId === currentOrg;
              return (
                <ListItemButton
                  key={orgId}
                  component={Link}
                  to={`/org/${shortId}`}
                  sx={{
                    borderRadius: 1.5,
                    px: 1.25,
                    py: 1,
                    gap: 1.25,
                    color: active ? "primary.main" : "text.primary",
                    bgcolor: active ? `rgba(${brandRgb}, 0.12)` : "transparent",
                    "&:hover": {
                      bgcolor: active
                        ? `rgba(${brandRgb}, 0.18)`
                        : "action.hover",
                    },
                  }}
                >
                  <OrgAvatar orgId={orgId} size={28} />
                  <Typography
                    variant="button"
                    noWrap
                    sx={{ flex: 1, textAlign: "left", fontSize: "0.85rem" }}
                  >
                    {shortId}
                  </Typography>
                  {active && <ArrowForward sx={{ fontSize: 16 }} />}
                </ListItemButton>
              );
            })}
          </Stack>
        )}
      </Box>
    </>
  );

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: "divider",
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
      >
        <Box
          sx={{
            height: `${APP_BAR_HEIGHT}px`,
            display: "flex",
            alignItems: "center",
            gap: 2,
            px: { xs: 1.5, sm: 2 },
          }}
        >
          <IconButton
            color="inherit"
            aria-label="Open navigation drawer"
            onClick={handleDrawerToggle}
            sx={{ display: { md: "none" }, mr: -1 }}
          >
            <MenuIcon />
          </IconButton>

          <Link
            to="/"
            style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            <TariOrgLogo size="small" />
          </Link>

          <Box
            component="form"
            onSubmit={handleView}
            sx={{
              ml: "auto",
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              height: 32,
              width: { xs: 160, sm: 280 },
              minWidth: 0,
              flexShrink: 1,
              px: 1.25,
              borderRadius: "999px",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.default",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
              "&:focus-within": {
                borderColor: "primary.main",
                boxShadow: `0 0 0 3px rgba(${brandRgb}, 0.15)`,
              },
            }}
          >
            <Search sx={{ color: "text.secondary", fontSize: 18 }} />
            <InputBase
              value={viewTarget}
              onChange={(event) => setViewTarget(event.target.value)}
              placeholder="View organization…"
              sx={{
                flex: 1,
                minWidth: 0,
                fontSize: "0.875rem",
                "& .MuiInputBase-input": { padding: 0 },
              }}
            />
            <IconButton
              type="submit"
              size="small"
              aria-label="View organization"
              sx={{
                color: "text.secondary",
                "&:hover": { color: "primary.main" },
              }}
            >
              <ArrowForward sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          <AccountButton />
        </Box>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
        aria-label="organizations"
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          px: 3,
          pb: 3,
          pt: `${APP_BAR_HEIGHT}px`,
          minHeight: "100vh",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
