export function dateOnly(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : value;
}
export function validDate(value) {
  const text = dateOnly(value);
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text;
}
