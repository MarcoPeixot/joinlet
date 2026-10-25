import {execFileSync} from 'node:child_process';
import {defineConfig,devices} from '@playwright/test';
process.env.JOINLET_PRODUCTION_TEST_PORT??=execFileSync(process.execPath,['-e',"const s=require('node:net').createServer().listen(0,()=>{console.log(s.address().port);s.close();});"],{encoding:'utf8'}).trim();
const port=Number(process.env.JOINLET_PRODUCTION_TEST_PORT);
export default defineConfig({testDir:'./e2e',testMatch:'production-loading.spec.ts',workers:1,retries:0,reporter:'list',use:{baseURL:`http://127.0.0.1:${port}`,viewport:{width:1440,height:1000}},projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],webServer:{command:`bun run preview --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false}});
