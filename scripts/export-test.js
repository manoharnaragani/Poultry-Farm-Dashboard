import assert from 'node:assert/strict';
import { datePreset, csvCell, makeCsv, exportColumns, reportRows, reportColumns } from '../client/src/exports.js';
import { filterByDate } from '../client/src/dateFilters.js';
let checks=0;
const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
test('last seven days includes today',()=>assert.deepEqual(datePreset('week','2026-10-02'),{from:'2026-09-26',to:'2026-10-02'}));
test('last thirty days includes today',()=>assert.deepEqual(datePreset('month','2026-10-02'),{from:'2026-09-03',to:'2026-10-02'}));
test('yesterday across year boundary',()=>assert.deepEqual(datePreset('yesterday','2026-01-01'),{from:'2025-12-31',to:'2025-12-31'}));
test('previous calendar month',()=>assert.deepEqual(datePreset('previous-month','2026-10-02'),{from:'2026-09-01',to:'2026-09-30'}));
test('leap-year February',()=>assert.deepEqual(datePreset('previous-month','2024-03-15'),{from:'2024-02-01',to:'2024-02-29'}));
test('quotes commas and multiline text',()=>assert.equal(csvCell('A,"B"\nC'),'"A,""B""\nC"'));
test('spreadsheet formulas neutralised',()=>assert.equal(csvCell('  =SUM(1,2)'),"\"'  =SUM(1,2)\""));
test('other dangerous text neutralised',()=>{for(const value of ['+cmd','-cmd','@SUM(A1)','\t=1','\r=1'])assert.ok(csvCell(value).startsWith('"\''));});
test('numeric values remain numeric',()=>assert.equal(csvCell(-12.5),'"-12.5"'));
test('null cells remain empty',()=>assert.equal(csvCell(null),'""'));
const modules={
 eggs:{title:'Egg production',columns:[{key:'date',label:'Date',format:'date'},{key:'totalEggs',label:'Total eggs'}],fields:[{key:'date',label:'Date'},{key:'shed',label:'Shed'},{key:'notes',label:'Notes'}]},
 sales:{title:'Tray sales',columns:[{key:'date',label:'Date',format:'date'},{key:'totalAmount',label:'Amount'}],fields:[{key:'date',label:'Date'}]},
};
const state={eggs:Array.from({length:25},(_,i)=>({id:`egg-${i}`,date:'2026-09-30',shed:i%2 ? 'House A':'House B',totalEggs:10,notes:'Saved note'})),sales:[{id:'sale',date:'2026-09-30',totalAmount:100}]};
const snapshot=JSON.stringify(state);
const rows=reportRows(state,modules,['eggs','sales'],'2026-09-01','2026-09-30');
test('all matching rows included beyond table page size',()=>assert.equal(rows.length,26));
test('specific shed excludes shared sales',()=>{const shed=reportRows(state,modules,['eggs','sales'],'2026-09-01','2026-09-30','House A');assert.equal(shed.length,12);assert.ok(shed.every(row=>row.reportShed==='House A'));});
test('out-of-range report is empty',()=>assert.deepEqual(reportRows(state,modules,['eggs','sales'],'2026-10-01','2026-10-02'),[]));
test('single-day inclusive filter',()=>assert.equal(filterByDate(state.eggs,'date','2026-09-30','2026-09-30').length,25));
test('export preserves source records',()=>assert.equal(JSON.stringify(state),snapshot));
const columns=exportColumns(modules.eggs,state.eggs);
test('record IDs notes and sheds are exported',()=>{for(const key of ['id','notes','shed'])assert.ok(columns.some(column=>column.key===key));});
const csv=makeCsv(rows,reportColumns(rows,modules,['eggs','sales']));
test('UTF-8 BOM supports Excel and Telugu',()=>assert.ok(csv.startsWith('\uFEFF')));
test('report identifies sections',()=>{assert.ok(csv.includes('Egg production'));assert.ok(csv.includes('Tray sales'));});
test('stable ISO dates exported',()=>assert.ok(csv.includes('2026-09-30')));
console.log(`${checks} export checks passed.`);
