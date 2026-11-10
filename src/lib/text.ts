/** Normalizace pro porovnávání názvů: bez diakritiky, malými písmeny. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
