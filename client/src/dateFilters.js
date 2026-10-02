export function recordDateField(def) {
  return def.columns.find((column) => column.format === 'date')?.key || null;
}

export function filterByDate(rows, field, from = '', to = '') {
  if (!field || (!from && !to)) return [...rows];
  return rows.filter((row) => {
    const date = String(row[field] || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!from || date >= from) && (!to || date <= to);
  });
}
