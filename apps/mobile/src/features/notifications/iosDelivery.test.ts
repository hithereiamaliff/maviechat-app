import { describe, expect, it } from 'vitest';
import { deliveryProblem } from './iosDelivery';

type Ios = Parameters<typeof deliveryProblem>[0];
const ios = (settings: { status: number; allowsAlert: boolean | null; alertStyle: number }) => settings as unknown as Ios;

describe('iOS notification settings', () => {
  it('says nothing when banners show', () => {
    expect(deliveryProblem(ios({ status: 2, allowsAlert: true, alertStyle: 1 }))).toBeNull();
    expect(deliveryProblem(ios({ status: 2, allowsAlert: true, alertStyle: 2 }))).toBeNull();
    expect(deliveryProblem(undefined)).toBeNull();
  });

  it('names what keeps banners away', () => {
    expect(deliveryProblem(ios({ status: 1, allowsAlert: false, alertStyle: 0 }))).toMatch(/off for MavieChat/);
    expect(deliveryProblem(ios({ status: 3, allowsAlert: true, alertStyle: 1 }))).toMatch(/quietly/);
    expect(deliveryProblem(ios({ status: 2, allowsAlert: false, alertStyle: 0 }))).toMatch(/not to show/);
    expect(deliveryProblem(ios({ status: 2, allowsAlert: true, alertStyle: 0 }))).toMatch(/Banners are off/);
  });
});
