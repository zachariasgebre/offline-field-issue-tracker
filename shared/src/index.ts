import { z } from 'zod';

export const categories = ['water_point', 'equipment', 'service_interruption', 'safety', 'maintenance'] as const;
export const priorities = ['low', 'medium', 'high', 'critical'] as const;
export const statuses = ['Draft', 'Submitted', 'Assigned', 'In Progress', 'Resolved', 'Rejected'] as const;
export type Category = typeof categories[number];
export type Priority = typeof priorities[number];
export type Status = typeof statuses[number];
export const locationSchema = z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), text: z.string().max(500).optional() });
export const reportInputSchema = z.object({ clientId: z.string().uuid(), category: z.enum(categories), description: z.string().trim().min(1).max(5000), location: locationSchema.default({}), priority: z.enum(priorities), status: z.enum(statuses).default('Submitted'), reportedAt: z.string().datetime(), customFields: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}) });
export type ReportInput = z.infer<typeof reportInputSchema>;
export const TRANSITIONS: Record<Status, Status[]> = { Draft: ['Submitted'], Submitted: ['Assigned', 'Rejected'], Assigned: ['In Progress', 'Rejected'], 'In Progress': ['Resolved', 'Rejected'], Resolved: [], Rejected: [] };
export const canTransition = (from: Status, to: Status) => TRANSITIONS[from].includes(to);
export class InvalidTransitionError extends Error { constructor(readonly from: Status, readonly to: Status) { super(`Cannot move a report from ${from} to ${to}.`); this.name = 'InvalidTransitionError'; } }
