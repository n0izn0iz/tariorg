import { Buffer } from "buffer";

export function memberPublicKeyError(publicKey: string): string | null {
  const value = publicKey.trim();

  // Empty inputs are valid for now; callers handle the "required" state.
  if (value.length === 0) {
    return null;
  }

  if (!/^[0-9a-fA-F]+$/.test(value)) {
    return "Must be a hexadecimal public key.";
  }

  if (value.length !== 64 || Buffer.from(value, "hex").length !== 32) {
    return "Must decode to 32 bytes (64 hex characters).";
  }

  return null;
}

type AddressPrefix = "component" | "resource";

/**
 * Returns the 32-byte (64 hex char) body of an address, or `null` if invalid.
 * Accepts either the `component_<hex>` / `resource_<hex>` form or the bare
 * hex tail.
 */
export function addressBody(
  address: string,
  prefix: AddressPrefix,
): string | null {
  const value = address.trim();
  const body = value.startsWith(`${prefix}_`)
    ? value.slice(prefix.length + 1)
    : value;

  if (!/^[0-9a-fA-F]{64}$/.test(body)) {
    return null;
  }

  return body.toLowerCase();
}

export function addressError(
  address: string,
  prefix: AddressPrefix,
): string | null {
  // Empty inputs don't show an error; callers handle the "required" state.
  if (address.trim().length === 0) {
    return null;
  }

  if (addressBody(address, prefix) === null) {
    return `Must be a valid ${prefix} address (64 hex characters).`;
  }

  return null;
}
