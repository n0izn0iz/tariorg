export function OrgAvatar({
  orgId,
  size = "20rem",
}: {
  orgId: string;
  size?: string | number | undefined;
}) {
  return (
    <img
      src={`https://api.dicebear.com/10.x/blobs/svg?seed=${orgId}`}
      width={size}
      height={size}
      style={{
        display: "inline-block",
        verticalAlign: "center",
        borderRadius: 4,
      }}
    />
  );
}
