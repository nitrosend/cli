export const EXIT_CODES = {
  ok: 0,
  usage: 64,
  data: 65,
  unavailable: 69,
  internal: 70,
  temporary: 75,
  permission: 77,
  unsupported: 78
} as const;

export type ExitCodeName = keyof typeof EXIT_CODES;
