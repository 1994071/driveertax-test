const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('bookkeeping-workspace.js','utf8'),ctx={isoDate:d=>d.toISOString().slice(0,10)};vm.createContext(ctx);vm.runInContext(src.slice(0,src.indexOf('(() => {')),ctx);
assert.equal(ctx.merchantCategoryKey(' SHELL-Cannock  '),'shell cannock');assert.notEqual(ctx.merchantCategoryKey('Shell Cannock'),ctx.merchantCategoryKey('Shell Birmingham'));
for(const [month,end] of [['2024-02','2024-02-29'],['2026-02','2026-02-28'],['2026-12','2026-12-31']]){assert.equal(ctx.bookkeepingMonthBounds(month).end,end);assert.equal(ctx.bookkeepingMonthBounds(month).start,month+'-01');}
for(const month of ['2026-13','2026-00','1999-12','2026-2','<script>'])assert.throws(()=>ctx.bookkeepingMonthBounds(month));
console.log('PASS monthly calendar boundaries and exact merchant matching.');
