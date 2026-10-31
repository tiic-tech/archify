// Derive the synthetic Windows path fixture from the checkout it will inspect.
import { spawnSync } from 'node:child_process';
import { parseRepositoryRemote } from '../archify/renderers/shared/repository-location.mjs';

export function windowsRepositoryEvidence(repoRoot) {
  const git=(...args)=>{
    const result=spawnSync('git',['-C',repoRoot,...args],{encoding:'utf8'});
    if(result.error||result.status!==0)throw new Error('Could not inspect the evidence repository origin or revision.');
    return result.stdout.trim();
  };
  const remote=parseRepositoryRemote(git('remote','get-url','origin'));
  if(!remote)throw new Error('Evidence repository origin cannot be represented safely.');
  const revision=git('rev-parse','--verify','HEAD^{commit}');
  return {url:remote.url,revision,...(remote.provider&&remote.protocol==='https:'&&remote.endpoint==='standard'?{}:{link_mode:'local-only'})};
}
