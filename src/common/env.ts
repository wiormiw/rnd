import * as z from 'zod';

/** An integer environment variable, coerced from its string form. */
export const intEnv = (min = 0) => z.coerce.number().int().min(min);
