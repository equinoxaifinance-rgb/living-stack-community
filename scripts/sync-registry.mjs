import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {stable} from '../src/util.mjs';

export const retiredVersions = ['0.3.4-beta.1','0.3.3-beta.1','0.3.1-beta.1','0.3.0-beta.1'];
const official = entry => entry?._meta?.['io.modelcontextprotocol.registry/official'];
export async function syncRegistry({manifest,read,execute,apply=false}) {
  const actions=[];
  const existing=await read(manifest.name,manifest.version);
  if(existing){
    assert.equal(stable(existing.server),stable(manifest),'published_manifest_mismatch');
    assert.equal(official(existing)?.status,'active','published_version_not_active');
  }else{
    actions.push({action:'publish',version:manifest.version});
    if(apply){
      execute(['publish','server.json']);
      const after=await read(manifest.name,manifest.version);
      assert.equal(stable(after?.server),stable(manifest),'published_readback_mismatch');
      assert.equal(official(after)?.status,'active');
    }
  }
  for(const version of retiredVersions){
    const current=await read(manifest.name,version);
    assert.ok(current,`historical_version_missing:${version}`);
    if(official(current)?.status==='deleted')continue;
    actions.push({action:'retire',version});
    if(apply){
      execute(['status','--status','deleted','--message','Replaced by the limited seven-tool Community proof edition.',manifest.name,version]);
      assert.equal(official(await read(manifest.name,version))?.status,'deleted',`retirement_readback_failed:${version}`);
    }
  }
  return {decision:apply?'PASS':'PASS_PLAN',version:manifest.version,alreadyPublished:!!existing,actions};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const manifest=JSON.parse(fs.readFileSync('server.json','utf8'));
  const read=async(name,version)=>{
    // Individual-version GET deliberately hides deleted entries. The listing
    // with include_deleted is required to distinguish already-retired from
    // unknown history, without attempting a no-op status mutation.
    const url=`https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(name)}&include_deleted=true&limit=100`;
    const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'cache-control':'no-cache'}});
    assert.equal(response.status,200,`registry_read_http_${response.status}`);
    const body=await response.json();
    assert.ok(!body.metadata?.nextCursor,'registry_search_requires_pagination');
    return body.servers.find(entry=>entry.server.name===name&&entry.server.version===version)||null;
  };
  const execute=args=>{const result=spawnSync('./mcp-publisher',args,{stdio:'inherit',shell:false});assert.equal(result.status,0,'publisher_failed');};
  console.log(JSON.stringify(await syncRegistry({manifest,read,execute,apply:process.argv.includes('--apply')})));
}
