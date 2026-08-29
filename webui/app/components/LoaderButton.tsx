import { useState, type ReactNode } from "react";
import { Button, CircularProgress, type ButtonProps } from "@mui/material";

export function LoaderButton({
  children,
  onClick,
  disabled,
  ...otherProps
}: {
  children: ReactNode;
  onClick: () => Promise<void>;
} & Omit<ButtonProps, "onClick">) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      disabled={disabled === true ? true : loading}
      onClick={async () => {
        setLoading(true);
        try {
          await onClick();
        } finally {
          setLoading(false);
        }
      }}
      {...otherProps}
    >
      {loading ? <CircularProgress size="1rem" /> : children}
    </Button>
  );
}
