import { z } from 'zod';

/** A Study Direction (ADR-0011). */
export const studyDirections = z.enum(['FORWARD', 'REVERSE']);

/** A Study Direction, Forward unless given. */
export const studyDirection = studyDirections.default('FORWARD');
