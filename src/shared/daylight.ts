/** Sunrise/sunset as fractions of the day (06:00 / 18:00). */
export const SUNRISE = 0.25;
export const SUNSET = 0.75;

/** Sun intensity 0..1 for a time of day: 0 at night, peaking at noon. */
export function sunIntensity(time: number): number {
  if (time <= SUNRISE || time >= SUNSET) return 0;
  const phase = (time - SUNRISE) / (SUNSET - SUNRISE);
  return Math.sin(Math.PI * phase);
}

/**
 * How deep into the night we are, 0 (bright day) .. 1 (full night).
 * Rises through dusk as the sun sinks.
 */
export function nightFactor(time: number): number {
  return 1 - Math.min(1, sunIntensity(time) * 2.5);
}
