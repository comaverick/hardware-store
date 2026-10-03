// A captured ceiling corner can be smaller than a floor or wall. Keep its
// area requirement consistent from discovery through final replacement;
// independent observations and local evidence still authorize every cell.
export const MIN_CEILING_PATCH_AREA = 0.35;

export const structuralRepairMinimumArea = kind =>
  kind === 'ceiling' ? MIN_CEILING_PATCH_AREA : 0.7;
