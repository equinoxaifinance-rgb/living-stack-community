import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const coreModule = process.env.LIVING_STACK_TEST_MODULE || path.resolve(import.meta.dirname, '../src/core.mjs');
const {CommunityCore} = await import(pathToFileURL(coreModule));

const workerCode = `
const {workerData, parentPort}=require('node:worker_threads');
const fs=require('node:fs');
(async()=>{
 process.env.LIVING_STACK_STATE_DIR=workerData.root;
 const {CommunityCore}=await import(workerData.module);
 const read=fs.readFileSync;
 // Pause after obtaining bytes to deterministically exercise the read/write race.
 fs.readFileSync=function(file,...args){const bytes=read.call(this,file,...args);if(String(file)===workerData.sessionFile)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);return bytes;};
 const gate=new Int32Array(workerData.gate);
 parentPort.postMessage({ready:true});
 Atomics.wait(gate,0,0);
 try{parentPort.postMessage({result:new CommunityCore()[workerData.method](workerData.args)});}catch(e){parentPort.postMessage({error:e.message});}
})().catch(e=>{throw e});`;

async function race(root, sessionId, method, makeArgs) {
 const gate=new SharedArrayBuffer(4);
 const workers=[0,1].map(i=>new Worker(workerCode,{eval:true,workerData:{root,gate,method:Array.isArray(method)?method[i]:method,args:makeArgs(i),sessionFile:path.join(root,'sessions',sessionId+'.json'),module:pathToFileURL(coreModule).href}}));
 let ready=0;
 const results=await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{
  w.on('error',reject);w.on('message',m=>{if(m.ready){if(++ready===2){Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);}}else resolve(m);});
 })));
 await Promise.all(workers.map(w=>new Promise(resolve=>{if(w.threadId===-1)resolve();else w.once('exit',resolve);})));return results;
}

test('shared-session writers fail closed without losing budget reservations or one-use outcomes',async()=>{
 const previous=process.env.LIVING_STACK_STATE_DIR;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-community-race-'));
 process.env.LIVING_STACK_STATE_DIR=root;
 try{
  const core=new CommunityCore();
  const s=core.sessionStart({scope:'race regression',goal:'budget and one-use protection',budget_limit_usd:1});
  const a=await race(root,s.session_id,'authorizeAction',i=>({session_id:s.session_id,action_id:'race-'+i,action_type:'local',target:'same target',risk:'read',estimated_cost_usd:1}));
  assert.equal(a.filter(x=>x.result?.decision==='PASS').length,1,JSON.stringify(a));
  assert.ok(a.some(x=>x.error==='session_busy_retry'||x.result?.decision==='DENY'));
  assert.equal(core.sessionStatus(s).authorization_count,1);
  const auth=a.find(x=>x.result?.decision==='PASS').result.authorization_id;
  const b=await race(root,s.session_id,'recordOutcome',()=>({session_id:s.session_id,authorization_id:auth,classification:'success',actual_cost_usd:1,evidence:[{type:'verification',ref:'race proof'}]}));
  assert.equal(b.filter(x=>x.result?.decision==='PASS').length,1,JSON.stringify(b));
  assert.ok(b.some(x=>['session_busy_retry','authorization_already_used'].includes(x.error)));
  const state=core.sessionStatus(s);assert.equal(state.outcome_count,1);assert.equal(state.budget.spent_usd,1);assert.equal(state.budget.reserved_usd,0);
 }finally{if(previous===undefined)delete process.env.LIVING_STACK_STATE_DIR;else process.env.LIVING_STACK_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});

test('lock contention fails closed and exceptions release the acquired lock',()=>{
 const previous=process.env.LIVING_STACK_STATE_DIR;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-community-lock-'));process.env.LIVING_STACK_STATE_DIR=root;
 try{
  const core=new CommunityCore();const s=core.sessionStart({scope:'locks',goal:'recover after invalid call',budget_limit_usd:1});
  assert.throws(()=>core.authorizeAction({...s,action_id:'!'}));
  const file=path.join(root,'sessions',s.session_id+'.json.lock');assert.equal(fs.existsSync(file),false);
  for (const [method,args] of [
    ['recordOutcome',{authorization_id:'unknown'}],
    ['checkClaim',{subject:'same',outcome_ids:['unknown'],claim_text:' '}],
    ['sessionClose',{reason:' '}],
  ]) { assert.throws(()=>core[method]({...s,...args}));assert.equal(fs.existsSync(file),false); }
  fs.writeFileSync(file,'external owner');
  assert.throws(()=>core.sessionClose(s),/session_busy_retry/);
  assert.equal(fs.readFileSync(file,'utf8'),'external owner');
  fs.unlinkSync(file);
  assert.equal(core.sessionClose(s).decision,'PASS');assert.equal(fs.existsSync(file),false);
 }finally{if(previous===undefined)delete process.env.LIVING_STACK_STATE_DIR;else process.env.LIVING_STACK_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});

test('close and claim races never append an event after closure',async()=>{
 const previous=process.env.LIVING_STACK_STATE_DIR;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-community-close-'));process.env.LIVING_STACK_STATE_DIR=root;
 try{
  const core=new CommunityCore();const s=core.sessionStart({scope:'close race',goal:'no post-close claim',budget_limit_usd:0});
  const a=core.authorizeAction({...s,action_id:'proof',action_type:'read',target:'same'});
  const o=core.recordOutcome({...s,authorization_id:a.authorization_id,classification:'success',evidence:[{type:'verification',ref:'fixture'}]});
  const result=await race(root,s.session_id,['sessionClose','checkClaim'],i=>i===0?s:{...s,claim_text:'observed',subject:'same',outcome_ids:[o.outcome_id]});
  assert.equal(result.filter(x=>x.result?.decision==='PASS').length,1,JSON.stringify(result));
  assert.ok(result.some(x=>x.error==='session_busy_retry'||x.error==='session_closed'));
  if(core.sessionStatus(s).status==='open')core.sessionClose(s);
  const state=JSON.parse(fs.readFileSync(path.join(root,'sessions',s.session_id+'.json')));
  assert.equal(state.events.at(-1).type,'session_closed');assert.equal(core.sessionStatus(s).ledger_valid,true);
  assert.throws(()=>core.checkClaim({...s,claim_text:'late',subject:'same',outcome_ids:[o.outcome_id]}),/session_closed/);
 }finally{if(previous===undefined)delete process.env.LIVING_STACK_STATE_DIR;else process.env.LIVING_STACK_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});

test('forcibly terminated writer leaves a fail-closed lock and exact-file recovery succeeds',async()=>{
 const previous=process.env.LIVING_STACK_STATE_DIR;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-community-crash-'));process.env.LIVING_STACK_STATE_DIR=root;
 let worker;
 try{
  const core=new CommunityCore();const s=core.sessionStart({scope:'crash recovery',goal:'no lock stealing',budget_limit_usd:1});
  const file=path.join(root,'sessions',s.session_id+'.json');const before=fs.readFileSync(file,'utf8');
  worker=new Worker(`const {workerData,parentPort}=require('node:worker_threads'); const fs=require('node:fs');
   (async()=>{process.env.LIVING_STACK_STATE_DIR=workerData.root; const {CommunityCore}=await import(workerData.module); const original=fs.readFileSync;
    fs.readFileSync=function(p,...args){const b=original.call(this,p,...args);if(String(p)===workerData.file){parentPort.postMessage('held');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return b;};
    new CommunityCore().authorizeAction({...workerData.session,action_id:'crashed',action_type:'read'});
   })();`,{eval:true,workerData:{root,file,session:s,module:pathToFileURL(coreModule).href}});
  await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  await worker.terminate();worker=null;
  assert.equal(fs.existsSync(file+'.lock'),true);assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.throws(()=>core.sessionClose(s),/session_busy_retry/);
  // The test owns this isolated directory and has stopped its only writer.
  fs.copyFileSync(file,file+'.backup');fs.unlinkSync(file+'.lock');
  assert.equal(core.sessionClose(s).decision,'PASS');assert.equal(core.sessionStatus(s).ledger_valid,true);
  assert.equal(fs.readFileSync(file+'.backup','utf8'),before);
 }finally{if(worker)await worker.terminate();if(previous===undefined)delete process.env.LIVING_STACK_STATE_DIR;else process.env.LIVING_STACK_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});

test('read-only status snapshots remain coherent during an atomic session replacement',async()=>{
 const previous=process.env.LIVING_STACK_STATE_DIR;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-community-snapshot-'));process.env.LIVING_STACK_STATE_DIR=root;
 try{
  const core=new CommunityCore();const s=core.sessionStart({scope:'snapshot',goal:'read coherent state',budget_limit_usd:1});
  const pending=race(root,s.session_id,'authorizeAction',i=>({...s,action_id:'snapshot-'+i,action_type:'read',estimated_cost_usd:1}));
  for(let i=0;i<200;i++){
   const state=core.sessionStatus(s);assert.equal(state.authorization_count,state.budget.reserved_usd);assert.equal(state.ledger_valid,true);
   await new Promise(resolve=>setTimeout(resolve,1));
  }
  await pending;const final=core.sessionStatus(s);assert.equal(final.authorization_count,1);assert.equal(final.budget.reserved_usd,1);
 }finally{if(previous===undefined)delete process.env.LIVING_STACK_STATE_DIR;else process.env.LIVING_STACK_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});
