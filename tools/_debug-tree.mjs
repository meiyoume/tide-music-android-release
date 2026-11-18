import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const ROOT = path.resolve(import.meta.dirname, '..')
const T = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const H = { Authorization: 'Bearer ' + T, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'x' }
const api = 'https://api.github.com/repos/meiyoume/tide-music-android-release'
const SKIP_DIRS = new Set(['node_modules','.git','.gradle','build','build-staging','shots','apk-release','.idea','.vscode','release'])
const SKIP_FILE = [/(^|\/)(local\.properties|keystore\.properties|\.env.*|.*credentials.*|.*secret.*)$/i,/\.(keystore|jks|p12|pem|key|apk|apks|aab|log|tmp|swp)$/i,/^(hs_err_pid|replay_pid)/i,/(^|\/)\.DS_Store$/i,/^\$null$/i,/^\.gitignore$/i,/^README\.md$/i,/^tools\/\.upload-source-cache\.json$/i]
const files=[]
function w(d,r){for(const e of fs.readdirSync(d,{withFileTypes:true})){const rr=r?r+'/'+e.name:e.name;const p=path.join(d,e.name);if(e.isDirectory()){if(SKIP_DIRS.has(e.name)||SKIP_DIRS.has(rr))continue;w(p,rr)}else if(e.isFile()&&!SKIP_FILE.some(re=>re.test(rr)))files.push(rr)}}w(ROOT,'')
const crypto=await import('node:crypto')
const cache=JSON.parse(fs.readFileSync(path.join(ROOT,'tools','.upload-source-cache.json'),'utf8'))
const jobs=[...files.map(rel=>({rel,key:rel+':'+crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT,rel))).digest('hex')})),
  {rel:'.gitignore',key:'.gitignore:extra'},{rel:'android/keystore.properties.example',key:'example:extra'},{rel:'README.md',key:'readme:extra'}]
const items=jobs.map(j=>{const sha=cache[j.key];return {path:j.rel,mode:'100644',type:'blob',sha}})
const missing=items.filter(x=>!x.sha||!/^[0-9a-f]{40}$/.test(x.sha))
console.log('items',items.length,'missing sha',missing.length, missing.slice(0,5))
async function post(tree){const r=await fetch(api+'/git/trees',{method:'POST',headers:H,body:JSON.stringify({tree})});const t=await r.text();return {status:r.status,body:t.slice(0,300)}}
const head=await(await fetch(api+'/git/ref/heads/main',{headers:H})).json()
const commit=await(await fetch(api+'/git/commits/'+head.object.sha,{headers:H})).json()
const base=commit.tree.sha
console.log('base',base)
for(const n of [10,50,100,200,400,600,800,items.length]){
  const r=await post(items.slice(0,n));console.log(n,r.status,r.body.slice(0,160))
  if(r.status!==201)break
}
