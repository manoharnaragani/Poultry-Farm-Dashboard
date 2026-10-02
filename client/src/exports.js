import { filterByDate, recordDateField } from './dateFilters.js';
const dayString = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function datePreset(preset, day) {
  const [year,month,date] = day.split('-').map(Number);
  const base = new Date(year,month-1,date,12);
  const shift = (days) => { const copy=new Date(base); copy.setDate(copy.getDate()+days); return dayString(copy); };
  if (preset==='yesterday') return {from:shift(-1),to:shift(-1)};
  if (preset==='week') return {from:shift(-6),to:day};
  if (preset==='month') return {from:shift(-29),to:day};
  if (preset==='previous-month') return {from:dayString(new Date(year,month-2,1,12)),to:dayString(new Date(year,month-1,0,12))};
  if (preset==='today') return {from:day,to:day};
  return {from:'',to:''};
}
export function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Excel can execute formulas in quoted cells too; neutralise untrusted text.
  if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'"+text;
  return `"${text.replace(/"/g,'""')}"`;
}
export function makeCsv(rows, columns) {
  const lines = [columns.map((column)=>csvCell(column.label)).join(',')];
  for (const row of rows) lines.push(columns.map((column)=>csvCell(row[column.key])).join(','));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
export function exportColumns(def, rows) {
  const columns = new Map([['id','Record ID']]);
  for (const column of [...def.columns,...def.fields]) {
    if (!column.key || columns.has(column.key)) continue;
    if (def.fields.some((field)=>field.key===column.key) || rows.some((row)=>Object.hasOwn(row,column.key))) columns.set(column.key,column.label);
  }
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.has(key)) columns.set(key,key);
  return [...columns].map(([key,label])=>({key,label}));
}
export function reportRows(state, modules, keys, from, to, shed='all') {
  const result=[];
  for (const key of keys) {
    const def=modules[key];
    const rows=filterByDate(state[key] || [],recordDateField(def),from,to);
    for (const row of rows) {
      // No inferred attribution: shared or worker-only records have no historic shed.
      if (shed!=='all' && row.shed!==shed) continue;
      result.push({...row,reportSection:def.title,reportDate:row[recordDateField(def)] || '',reportShed:row.shed || 'Shared farm record'});
    }
  }
  return result.sort((a,b)=>String(b.reportDate).localeCompare(String(a.reportDate)) || a.reportSection.localeCompare(b.reportSection));
}
export function reportColumns(rows, modules, keys) {
  const columns=new Map([['reportSection','Section'],['reportDate','Record date'],['reportShed','Shed / scope'],['id','Record ID']]);
  for (const key of keys) for (const column of exportColumns(modules[key],rows)) if(!columns.has(column.key)) columns.set(column.key,column.label);
  return [...columns].map(([key,label])=>({key,label}));
}
export function downloadCsv(csv, name) {
  const safeName=name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').slice(0,180) || 'nestledger-export';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url; link.download=safeName+'.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
