import assert from 'node:assert/strict';
import test from 'node:test';
import {syncRegistry,retiredVersions} from '../scripts/sync-registry.mjs';
const manifest={name:'io.github.example/server',version:'0.4.1-beta.1',packages:[]};
const row=(server,status)=>({server,_meta:{'io.modelcontextprotocol.registry/official':{status}}});
function fixture(){const state=new Map(retiredVersions.map(v=>[v,row({...manifest,version:v},'deleted')]));const calls=[];return{state,calls,read:async(n,v)=>state.get(v)||null,execute:args=>{calls.push(args);if(args[0]==='publish')state.set(manifest.version,row(manifest,'active'));else state.set(args.at(-1),row({...manifest,version:args.at(-1)},'deleted'));}};}
test('already published matching version and deleted history are successful no-ops',async()=>{
 const f=fixture();f.state.set(manifest.version,row(manifest,'active'));const r=await syncRegistry({manifest,...f,apply:true});assert.equal(r.decision,'PASS');assert.equal(f.calls.length,0);
});
test('missing publication and active history mutate once and verify downstream state',async()=>{
 const f=fixture();f.state.set(retiredVersions[0],row({...manifest,version:retiredVersions[0]},'active'));await syncRegistry({manifest,...f,apply:true});assert.equal(f.calls.length,2);await syncRegistry({manifest,...f,apply:true});assert.equal(f.calls.length,2);
});
test('manifest mismatch, inactive publication and missing historical status fail closed',async()=>{
 for(const mutate of [f=>f.state.set(manifest.version,row({...manifest,title:'wrong'},'active')),f=>f.state.set(manifest.version,row(manifest,'deleted')),f=>{f.state.set(manifest.version,row(manifest,'active'));f.state.delete(retiredVersions[0]);}]){const f=fixture();mutate(f);await assert.rejects(syncRegistry({manifest,...f,apply:true}));assert.equal(f.calls.length,0);}
});
test('dry run never executes and failed publish readback never passes',async()=>{
 const f=fixture();const plan=await syncRegistry({manifest,...f});assert.equal(plan.decision,'PASS_PLAN');assert.equal(f.calls.length,0);
 await assert.rejects(syncRegistry({manifest,...f,apply:true,execute:()=>{}}),/published_readback_mismatch/);
});
