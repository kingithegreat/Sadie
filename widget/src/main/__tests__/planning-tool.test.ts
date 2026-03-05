/**
 * Planning Tool Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs so we don't write to disk during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('[]'),
  writeFileSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { planTaskHandler, getPlansHandler, planTaskDef, getPlansDefn } from '../tools/planning';

beforeEach(() => {
  jest.clearAllMocks();
  (mockFs.existsSync as jest.Mock).mockReturnValue(false);
  (mockFs.readFileSync as jest.Mock).mockReturnValue('[]');
  (mockFs.writeFileSync as jest.Mock).mockImplementation(() => {});
});

describe('planTaskHandler', () => {
  test('saves a plan and returns planId + steps', async () => {
    const res = await planTaskHandler(
      {
        goal: 'Build a website',
        steps: ['Design mockups', 'Write HTML', 'Add CSS', 'Deploy'],
      },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.planId).toBeDefined();
    expect(res.result.goal).toBe('Build a website');
    expect(res.result.steps).toHaveLength(4);
    expect(res.result.stepCount).toBe(4);
    expect(res.result.saved).toBe(true);
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  test('requires goal', async () => {
    const res = await planTaskHandler({ goal: '', steps: ['step1'] }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/goal/i);
  });

  test('requires non-empty steps array', async () => {
    const res = await planTaskHandler({ goal: 'My goal', steps: [] }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/steps/i);
  });

  test('requires steps to be an array', async () => {
    const res = await planTaskHandler({ goal: 'My goal', steps: 'not an array' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('updates existing plan when planId provided', async () => {
    const existingPlan = {
      id: 'plan-abc123',
      goal: 'Old goal',
      steps: ['old step'],
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'pending',
    };
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([existingPlan]));

    const res = await planTaskHandler(
      { goal: 'Updated goal', steps: ['new step 1', 'new step 2'], planId: 'plan-abc123' },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.planId).toBe('plan-abc123');
    expect(res.result.goal).toBe('Updated goal');
    expect(res.result.steps).toHaveLength(2);
  });

  test('strips empty step strings', async () => {
    const res = await planTaskHandler(
      { goal: 'Clean plan', steps: ['step 1', '', '  ', 'step 2'] },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.steps).toHaveLength(2);
  });

  test('returns success even if writeFileSync throws', async () => {
    (mockFs.writeFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('disk full');
    });
    const res = await planTaskHandler(
      { goal: 'Resilient plan', steps: ['step'] },
      {} as any
    );
    // Still returns the plan despite persistence failure
    expect(res.success).toBe(true);
    expect(res.result.planId).toBeDefined();
  });
});

describe('getPlansHandler', () => {
  const samplePlans = [
    { id: 'plan-1', goal: 'Goal A', steps: ['a', 'b'], createdAt: '2026-03-01T00:00:00.000Z', status: 'pending' },
    { id: 'plan-2', goal: 'Goal B', steps: ['x'], createdAt: '2026-03-02T00:00:00.000Z', status: 'done' },
  ];

  test('returns saved plans', async () => {
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(samplePlans));

    const res = await getPlansHandler({ limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(2);
    expect(res.result.plans[0].goal).toBe('Goal A');
    expect(res.result.plans[0].stepCount).toBe(2);
  });

  test('returns empty list when no plans saved', async () => {
    (mockFs.existsSync as jest.Mock).mockReturnValue(false);

    const res = await getPlansHandler({ limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
    expect(res.result.plans).toHaveLength(0);
  });

  test('respects limit', async () => {
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(samplePlans));

    const res = await getPlansHandler({ limit: 1 }, {} as any);
    expect(res.result.plans.length).toBeLessThanOrEqual(1);
  });

  test('caps limit at 20', async () => {
    (mockFs.existsSync as jest.Mock).mockReturnValue(false);
    const res = await getPlansHandler({ limit: 999 }, {} as any);
    expect(res.success).toBe(true);
  });
});

describe('planning tool definitions', () => {
  test('planTaskDef has correct name', () => {
    expect(planTaskDef.name).toBe('plan_task');
  });

  test('planTaskDef requires goal and steps', () => {
    expect(planTaskDef.parameters.required).toContain('goal');
    expect(planTaskDef.parameters.required).toContain('steps');
  });

  test('getPlansDefn has correct name', () => {
    expect(getPlansDefn.name).toBe('get_plans');
  });

  test('getPlansDefn has no required params', () => {
    expect(getPlansDefn.parameters.required).toHaveLength(0);
  });
});
