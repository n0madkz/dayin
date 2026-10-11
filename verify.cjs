const {spawnSync}=require('node:child_process');
const files=require('node:fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')).map(f=>'tests/'+f);
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});process.exitCode=result.status||0;
