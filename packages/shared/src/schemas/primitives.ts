import { z } from 'zod';
import { isValidLocalDate } from '../dates';
import { isUuid } from '../ids';
import { MAX_PAISE } from '../money';

export const uuidSchema = z.string().refine(isUuid, 'Invalid id');

/** Strictly positive integer paise, capped. */
export const paiseSchema = z.number().int().positive().max(MAX_PAISE);

/** A real calendar date as "YYYY-MM-DD". */
export const localDateSchema = z.string().refine(isValidLocalDate, 'Invalid date');
