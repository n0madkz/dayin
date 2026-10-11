const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','tests/server.test.cjs','tests/ui.test.cjs','tests/admin-ui.test.cjs','tests/restaurant-management.test.cjs','tests/qr.test.cjs','tests/customer-disabled.test.cjs'],{stdio:'inherit'});process.exitCode=result.status||0;
