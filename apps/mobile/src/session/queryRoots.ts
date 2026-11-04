/** Every DeepTutor query key starts with this, so DeepTutor's cached data can be cleared alone. */
export const DT_QUERY_ROOT = 'dt';

/** Every OpenCode query key starts with this. */
export const OC_QUERY_ROOT = 'oc';

/** The query roots that belong to other spaces: everything else is Open WebUI's. */
export const OTHER_SPACE_ROOTS: readonly string[] = [DT_QUERY_ROOT, OC_QUERY_ROOT];
