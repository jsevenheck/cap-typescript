/** Helpers for reading and validating environment configuration values. */
const parsePositiveInt = (value: string | undefined, defaultValue: number, minimum = 1): number => {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const normalized = Math.floor(parsed);
  if (normalized < minimum) {
    return defaultValue;
  }

  return normalized;
};

export const parseCleanupCronInterval = (expression: string): number | undefined => {
  const trimmed = expression.trim();

  const minuteMatch = /^\*\/(\d+) \* \* \* \*$/.exec(trimmed);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  }

  const hourMatch = /^0 \*\/(\d+) \* \* \*$/.exec(trimmed);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      return hours * 60 * 60 * 1000;
    }
  }

  return undefined;
};

export const resolvePositiveInt = (
  value: string | undefined,
  defaultValue: number,
  minimum = 1,
): number => parsePositiveInt(value, defaultValue, minimum);
