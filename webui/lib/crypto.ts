export function randomUint64() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // Combine two 32-bit halves into a 64-bit unsigned BigInt
  return (BigInt(buf[0]) << 32n) | BigInt(buf[1]);
}
