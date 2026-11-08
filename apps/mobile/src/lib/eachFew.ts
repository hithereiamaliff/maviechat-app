import { describeError } from './errors';

/** Runs `work` on each item, a few at a time, and says which failed and why. */
export async function eachFew<T>(items: T[], work: (item: T) => Promise<unknown>, nameOf: (item: T) => string): Promise<string[]> {
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      try {
        await work(item);
      } catch (error) {
        failed.push(`${nameOf(item)}: ${describeError(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return failed;
}

/** The first failure, and how many more. */
export const failures = (failed: string[]): string => `${failed[0]}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ''}`;
